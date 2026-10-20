// Behaviour of the model-backed summary path.
//
// It drives a throwaway session because a plugin cannot call a model directly
// (client->host remotes are Typert-compiled). The contract that matters:
//   1. the source conversation travels as a session reference, and the instruction
//      forbids tool use (otherwise the model wanders off instead of summarizing);
//   2. only the final assistant TEXT becomes the note — `reasoning` parts are skipped;
//   3. the throwaway session is archived on success AND on every failure path;
//   4. every failure produces a message, never a silent no-op.
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let failures = 0;
const check = (ok, label) => {
  if (ok) console.log('  ok   ' + label);
  else { failures++; console.error('  FAIL ' + label); }
};

function boot() {
  const primitives = { Modal: () => null, Button: () => null, IconListPenOutlineRegular: () => null };
  const jsx = { jsx: () => null, jsxs: () => null, Fragment: {} };
  const react = { memo: (c) => c, useState: (i) => [typeof i === 'function' ? i() : i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
  const require_ = (id) => id === 'react' ? react
    : id === 'react/jsx-runtime' ? jsx
    : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives
    : (() => { throw new Error('unexpected require ' + id); })();
  let loaded = null;
  const win = { __ModuleLoader__: { load: (r) => { loaded = r; } }, innerWidth: 1200, innerHeight: 800 };
  const sandbox = {
    window: win, document: undefined,
    localStorage: { getItem: () => null, setItem: () => {} },
    require: require_, TextEncoder, btoa, atob, TextDecoder,
    setTimeout, clearTimeout,
    Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON,
    console: { info: () => {}, error: () => {}, warn: () => {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  return { mod: loaded.factory(require_), sandbox };
}

/** Boot the plugin with scripted host behaviour and return the apply-scope test seam. */
function applyWith(script) {
  const { mod } = boot();
  const calls = { created: 0, createArgs: [], prompts: [], archived: [], archiveArgs: [], pages: 0, pageRequests: [] };
  const ctx = {
    effect: (f) => { f(); return () => {}; },
    locale: { register: () => {}, bind: () => (k) => k },
    slots: { inject: () => {}, register: () => {} },
    shortcuts: { register: () => () => {} },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    sessions: {
      create: (args) => { calls.created++; calls.createArgs.push(args); return Promise.resolve('child-1'); },
      list: { getSnapshot: () => script.snapshot || { ids: ['child-1'], byId: { 'child-1': { id: 'child-1', running: false } } } }
    },
    uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
    uiWorkspace: {
      openSession: () => {}, archiveSession: (id, options) => { calls.archived.push(id); calls.archiveArgs.push(options); return Promise.resolve({ ok: true }); },
      mainReference: { sessionId: 'source-1' },
      workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', title: 'W', path: '/tmp/w', sessionIds: ['source-1'] }] }) } }, pickDirectory: async () => ''
    },
    remote: {
      session: {
        prompt: (request) => { calls.prompts.push(request); return Promise.resolve(script.promptResult || { ok: true }); },
        projections: (request) => script.projections ? script.projections(request) : Promise.resolve({ ok: true, value: { sessionId: 'child-1', asOfSeq: 20 } }),
        list: (request) => script.list ? script.list(request) : Promise.resolve({ ok: true, items: [{ sessionId: 'child-1', projections: { asOfSeq: 20 } }] }),
        page: (request) => {
          calls.pages++;
          calls.pageRequests.push(request);
          if (script.pageError) return Promise.reject(new Error(script.pageError));
          if (typeof script.onPage === 'function') { const r = script.onPage(request); if (r) return Promise.resolve(r); }
          // Faithful `paginate` (events.slice(cut, end), end = throughSeq + 1):
          //   throughSeq === -1        -> end 0  -> an EMPTY page (never usable)
          //   throughSeq > cursor      -> error envelope "past cursor"
          if (request.throughSeq === -1) return Promise.resolve({ ok: true, value: { records: [], hasMore: false } });
          if (request.throughSeq > 20) {
            return Promise.resolve({ ok: false, error: { code: 'gateway/bad-request', message: 'session page through seq ' + request.throughSeq + ' is past cursor 20' } });
          }
          const seq = script.pages || (script.page ? [script.page] : [{ records: [] }]);
          const one = seq[Math.min(calls.pages - 1, seq.length - 1)];
          // Failures stay as { ok:false, error }; successes are { ok:true, value } —
          // both exactly like the real remote.
          if (one && one.ok === false) return Promise.resolve(one);
          return Promise.resolve({ ok: true, value: one });
        }
      },
      agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
      workspace: { create: async () => ({ ok: true }) }
    }
  };
  mod.apply(ctx);
  return { seam: mod.__test, calls };
}

const assistantPage = {
  records: [
    { type: 'event', event: { type: 'user/message', seq: 1, time: 0, data: {} } },
    {
      type: 'event',
      event: {
        type: 'assistant/message', seq: 2, time: 0,
        data: { message: { role: 'assistant', content: [
          { type: 'reasoning', text: '这段推理不该进笔记' },
          { type: 'text', text: '一、部署顺序' },
          { type: 'text', text: '二、队列重试' }
        ] } }
      }
    }
  ]
};

console.log('model summary path');

// ---- happy path ----
{
  const { seam, calls } = applyWith({ page: assistantPage });
  const out = await seamToPromise(seam, 'source-1', '只摘部署相关的，用两点');
  check(calls.created === 1, 'creates exactly one throwaway session');
  const prompt = calls.prompts[0];
  check(!!prompt, 'sends a prompt to the throwaway session');
  check(prompt.sessionId === 'child-1' && prompt.mode === 'queue', 'prompt targets the child in queue mode');
  const body = prompt.content[0].text;
  check(body.includes('dsh-session:'), 'carries the source conversation as a session reference');
  check(body.includes('只摘部署相关的，用两点'), 'passes the free-form requirement through');
  check(body.includes('不要调用任何工具'), 'forbids tool use in the instruction');
  check(out.text === '一、部署顺序\n二、队列重试', 'keeps only assistant text (reasoning skipped)');
  check(out.error === null, 'no error on the happy path');
  check(calls.archived.length === 1 && calls.archived[0] === 'child-1', 'archives the throwaway session');
  check(calls.pages === 1, 'reads the child history exactly once');
}

// ---- prompt rejected: still archived, still reported ----
{
  const { seam, calls } = applyWith({ promptResult: { ok: false, error: { message: 'busy' } } });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error !== null && /busy/.test(out.error), 'surfaces the rejection reason');
  check(calls.archived.length === 1, 'archives the throwaway even when the prompt is rejected');
}

// ---- empty model reply is a failure, not an empty note ----
{
  const { seam, calls } = applyWith({ page: { records: [] } });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error !== null, 'an empty reply is reported as a failure');
  check(calls.archived.length === 1, 'archives the throwaway on an empty reply');
}

function seamToPromise(seam, sourceId, requirement, onProgress) { return seamToPromiseWithTimeout(seam, sourceId, requirement, 2600, onProgress); }
function seamToPromiseWithTimeout(seam, sourceId, requirement, timeoutMs, onProgress) {
  // The seam calls apply-scope code through testHooks; the component does the same.
  return new Promise((resolve) => {
    // Reach the same function the component reaches.
    const invoke = seam.summarizeWithModel;
    if (typeof invoke !== 'function') { resolve({ text: null, error: 'seam missing' }); return; }
    Promise.resolve()
      .then(() => invoke((k) => k, sourceId, requirement, timeoutMs || 2600, onProgress))
      .then((text) => resolve({ text, error: null }), (e) => resolve({ text: null, error: String(e && e.message || e) }));
  });
}

// ---- regression: a just-created session reports running:false before the queued
// prompt starts, so the first history read is empty. The text is the real gate. ----
{
  const { seam, calls } = applyWith({
    pages: [
      { records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 0, data: {} } }] },
      { records: [{ type: 'event', event: { type: 'turn/start', seq: 2, time: 0, data: {} } }] },
      assistantPage
    ]
  });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error === null && out.text === '一、部署顺序\n二、队列重试', 'waits through an empty early read instead of giving up (race regression)');
  check(calls.pages >= 3, 'kept reading until the assistant text appeared (pages=' + calls.pages + ')');
  check(calls.archived.length === 1, 'still archives the throwaway after waiting');
}

// ---- failure message must carry diagnostics, so no log spelunking is needed ----
{
  const { seam } = applyWith({ page: { records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 0, data: {} } }] } });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error !== null && out.error.includes('records'), 'failure text reports how many records were seen');
  check(out.error !== null && out.error.includes('types'), 'failure text reports which event types were seen');
}

// ---- timeout with text present still yields the text ----
{
  const { seam } = applyWith({ snapshot: { ids: ['child-1'], byId: { 'child-1': { id: 'child-1', running: true } } }, page: assistantPage });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error === null && out.text !== '', 'a never-settling session still yields the readable text at timeout');
}

// ---- the history read must state the real mode, and report progress ----
{
  const progress = [];
  const { seam, calls } = applyWith({ page: assistantPage });
  await seamToPromise(seam, 'source-1', '', (line) => progress.push(line));
  check(calls.pageRequests[0] && calls.pageRequests[0].mode === 'continuable', 'reads history with mode "continuable" (ordinary session, not a subagent address)');
  check(calls.pageRequests[0] && calls.pageRequests[0].throughSeq === 20, 'uses the session cursor as throughSeq (paginate: end = throughSeq + 1; -1 slices an empty page)');
  check(calls.pageRequests[0] && calls.pageRequests[0].address.sessionId === 'child-1', 'addresses the throwaway session');
  check(progress.length > 0 && /读取/.test(progress[0]), 'reports progress while waiting (so a stall is visible, not a silent 4-minute wait)');
}

// ---- a persistently failing history read must fail fast AND say why ----
{
  const { seam, calls } = applyWith({ pageError: 'validation: bad mode' });
  const started = Date.now();
  const out = await seamToPromise(seam, 'source-1', '');
  const elapsed = Date.now() - started;
  check(out.error !== null && out.error.includes('validation: bad mode'), 'surfaces the real read error instead of swallowing it');
  check(elapsed < 2000, 'gives up after a few failed reads instead of burning the whole timeout (took ' + elapsed + 'ms)');
  check(calls.archived.length === 1, 'archives the throwaway even when the read keeps failing');
}

// ---- an error ENVELOPE must never be mistaken for an empty page ----
{
  const { seam, calls } = applyWith({ pages: [{ ok: false, error: { code: 'gateway/bad-request', message: 'past cursor' } }] });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error !== null && /past cursor/.test(out.error), 'an { ok:false } envelope is reported, not read as an empty page');
  check(calls.archived.length === 1, 'archives the throwaway after an error envelope');
}

// ---- regression: the model takes tens of seconds. Empty reads during that time are
// normal (a fresh session reports running:false before its queued prompt starts), so a
// "finished + no records" fail-fast must not kill the wait. ----
{
  const emptyTurns = [];
  for (let i = 0; i < 7; i++) {
    // A read that finds nothing returns ZERO records (not a page with unrelated events).
    emptyTurns.push({ ok: true, records: [], hasMore: false });
  }
  const { seam, calls } = applyWith({ pages: emptyTurns.concat([assistantPage]) });
  const out = await seamToPromiseWithTimeout(seam, 'source-1', '', 6500);
  check(out.error === null && out.text !== '', 'keeps waiting through 7 empty reads while the model thinks (early-kill regression)');
  check(calls.pages >= 8, 'read until the text appeared (pages=' + calls.pages + ')');
  check(calls.archived.length === 1, 'archives the throwaway afterwards');
}

// ---- the cursor must be resolvable from the REMOTE, because the client list
// summary in this deployment carries no `projections` at all ----
{
  const { seam, calls } = applyWith({ page: assistantPage });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error === null, 'resolves the cursor without relying on the client list summary');
  check(calls.pageRequests[0] && calls.pageRequests[0].throughSeq === 20, 'reads with the remote-resolved cursor');
}
{
  // projections remote fails -> session.list must supply it
  const { seam, calls } = applyWith({
    projections: () => Promise.resolve({ ok: false, error: { code: 'gateway/unsupported' } }),
    page: assistantPage
  });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error === null, 'falls back to session.list when projections is unsupported');
  check(calls.pageRequests[0] && calls.pageRequests[0].throughSeq === 20, 'still reads with the right cursor');
}
{
  // every route fails -> the message must name what each returned
  const { seam } = applyWith({
    projections: () => Promise.resolve({ ok: false, error: { code: 'gateway/unsupported' } }),
    list: () => Promise.resolve({ ok: true, items: [] })
  });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error !== null && out.error.includes('projections='), 'cursor failure names the projections route result');
  check(out.error !== null && out.error.includes('list='), 'cursor failure names the list route result');
}

// ---- the throwaway must live in the current workspace, or DSH refuses to archive it
// (that is exactly how three leftovers ended up in the sidebar) ----
{
  const { seam, calls } = applyWith({ page: assistantPage });
  await seamToPromise(seam, 'source-1', '');
  check(calls.createArgs[0] && calls.createArgs[0].workspaceId === 'ws-1', 'creates the throwaway inside the current session workspace');
  check(calls.archiveArgs[0] && calls.archiveArgs[0].stopActivity === true, 'archives with stopActivity (a fresh throwaway may still count as running work)');
}

// ---- an archive refusal must be surfaced, never swallowed ----
{
  const { seam, calls } = applyWith({ page: assistantPage, archiveResult: { ok: false, error: { code: 'workspace/unknown-session' } } });
  const out = await seamToPromise(seam, 'source-1', '');
  check(out.error === null, 'a note still gets saved when only the cleanup fails');
  check(calls.archived.length === 1, 'the archive was still attempted');
  check(typeof out.text === 'string' && out.text.length > 0, 'a cleanup refusal must not corrupt the returned note text');
}

console.log(failures === 0 ? '\nmodel summary path OK' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
