import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } } };
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxRuntimeMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function(){}, Button: function(){} };
const mockRequire = (id) => id === 'react' ? reactMock : id === 'react/jsx-runtime' ? jsxRuntimeMock : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock : (() => { throw new Error('unexpected require ' + id); })();
const sandbox = { window: windowObj, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

// ---- capture registration + inject face ----
let registered = null;
const calls = { created: 0, selected: [], prompted: [], opened: [], cancelled: [] };
let cancelBehaviour = { ok: true };
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (name, factory) => { factory(); },
    register: (config) => { if (config.name === 'conversation.chat.turnTail') registered = config; }
  },
  sessions: { create: async () => { calls.created++; return 'new-session-1'; }, fork: async (opts) => { calls.forked = calls.forked || []; calls.forked.push(opts); return 'child-session-2'; } },
  uiWorkspace: { openSession: (id) => calls.opened.push(id), workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '' },
  remote: {
    session: {
      prompt: async (req) => { calls.prompted.push(req); return { ok: true, value: { accepted: true } }; },
      cancel: async (args) => { calls.cancelled.push(args); return cancelBehaviour; }
    },
    agentPresets: {
      list: async () => ({ ok: true, value: { presets: [
        { id: 'standard', name: '标准模式', description: '默认', isDefault: true },
        { id: 'ptc', name: 'PTC', description: 'programmatic tool calling' },
        { id: 'broken-one', name: 'Broken', broken: true }
      ] } }),
      select: async (sessionId, presetId) => { calls.selected.push([sessionId, presetId]); return { ok: true, value: presetId }; }
    }
  }
};
exportsObj.apply(ctx);
if (!registered || registered.name !== 'conversation.chat.turnTail') { console.error('FAIL: slot not registered'); process.exit(1); }

// ---- exercise the injected business face ----
const props = registered.inject('source-session-9');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
if (typeof props.listPresets !== 'function') fail('listPresets missing');
if (typeof props.createWithMode !== 'function') fail('createWithMode missing');

const presets = await props.listPresets();
console.log('listPresets ->', JSON.stringify(presets));
if (presets.length !== 2) fail('broken preset not filtered (got ' + presets.length + ')');
if (presets[0].id !== 'standard' || presets[0].name !== '标准模式' || presets[0].isDefault !== true) fail('preset mapping wrong');
if (!presets.some(p => p.id === 'ptc')) fail('ptc missing');

const newId = await props.createWithMode('source-session-9', 'ptc', '', '继续做 X');
console.log('createWithMode ->', newId);
if (calls.selected.length !== 1 || calls.selected[0][0] !== 'new-session-1' || calls.selected[0][1] !== 'ptc') fail('preset select call wrong: ' + JSON.stringify(calls.selected));
if (calls.prompted.length !== 1) fail('prompt not sent');
const sent = calls.prompted[0];
if (sent.sessionId !== 'new-session-1') fail('prompt target wrong');
// ---- conformance with the real typert wire schema for session/prompt ----
function validatePromptRequest(req) {
  const errors = [];
  if (typeof req.requestId !== 'string') errors.push('requestId must be string');
  if (typeof req.sessionId !== 'string') errors.push('sessionId must be string');
  if (req.mode !== 'queue' && req.mode !== 'steer') errors.push('mode must be "queue"|"steer", got ' + JSON.stringify(req.mode));
  if (!Array.isArray(req.content)) errors.push('content must be array');
  else for (const part of req.content) {
    if (part.type === 'text') { if (typeof part.text !== 'string') errors.push('text part needs text:string'); }
    else if (part.type === 'image') { if (part.attachment === undefined) errors.push('image part needs attachment'); }
    else if (part.type === 'file') { if (typeof part.receiptId !== 'string') errors.push('file part needs receiptId'); }
    else errors.push('unknown content type ' + JSON.stringify(part.type));
  }
  if (req.clientTimeZone !== undefined && typeof req.clientTimeZone !== 'string') errors.push('clientTimeZone must be string');
  return errors;
}
const schemaErrors = validatePromptRequest(sent);
if (schemaErrors.length > 0) fail('prompt payload violates wire schema: ' + schemaErrors.join('; '));
console.log('prompt payload conforms to SessionPromptRequest wire schema (mode=' + sent.mode + ')');
const text = sent.content[0].text;
console.log('prompt text ->', JSON.stringify(text));
const expectedMention = '@[之前的对话](dsh-session:' + Buffer.from(JSON.stringify('source-session-9'), 'utf8').toString('base64url') + ')';
if (!text.startsWith(expectedMention)) fail('mention prefix wrong');
if (!text.includes('继续做 X')) fail('user text missing');
if (calls.opened[calls.opened.length - 1] !== 'new-session-1') fail('new session not opened');

// ---- resend path shares the same wire payload ----
calls.prompted.length = 0;
const childId = await props.resend(41, '改过的内容');
console.log('resend ->', childId, 'fork opts ->', JSON.stringify(calls.forked));
if (childId !== 'child-session-2') fail('resend child id wrong');
if (!calls.forked || calls.forked[0].atSeq !== 41 || calls.forked[0].sessionId !== 'source-session-9') fail('resend fork boundary wrong');
if (calls.prompted.length !== 1) fail('resend did not prompt');
const resent = calls.prompted[0];
const resendErrors = validatePromptRequest(resent);
if (resendErrors.length > 0) fail('resend payload violates wire schema: ' + resendErrors.join('; '));
// The host decides placement from the mode:
//   placement = running ? (mode === "steer" ? "steering" : "queued") : "transcript"
// A resend must run NOW, so "queue" was the bug that left the edited message pending.
if (resent.mode !== 'steer' || resent.sessionId !== 'child-session-2') fail('resend payload wrong: a resend must steer, not queue');
if (resent.content[0].text !== '改过的内容') fail('resend text wrong');
console.log('resend payload conforms (mode=' + resent.mode + ')');
// resend must carry image/attachment blocks unchanged; an edit replaces only the text part
calls.prompted.length = 0;
const imagePart = { type: 'image', attachment: { id: 'img-1', mime: 'image/png' } };
await props.resend(41, [{ type: 'text', text: '改过的内容' }, imagePart]);
const withImage = calls.prompted[0];
if (!withImage || !Array.isArray(withImage.content) || withImage.content.length !== 2) fail('image resend content shape wrong');
if (withImage.content[0].type !== 'text' || withImage.content[0].text !== '改过的内容') fail('image resend lost edited text');
if (withImage.content[1].type !== 'image' || withImage.content[1].attachment.id !== 'img-1') fail('image resend lost the image attachment');
console.log('image resend keeps text + attachment');


// failure path: preset select refusal must abort before prompt
calls.selected.length = 0; calls.prompted.length = 0;
ctx.remote.agentPresets.select = async () => ({ ok: false, error: { code: 'agent-preset/locked', message: 'This session has already started', details: {} } });
let threw = false;
try { await props.createWithMode('source-session-9', 'ptc', '', ''); } catch (e) { threw = true; console.log('refusal surfaced ->', e.message); }
if (!threw) fail('refusal did not throw');
if (calls.prompted.length !== 0) fail('prompted despite refusal');

// ---- retry / resend must STOP the running turn first ----
//
// Reported by a user: after editing and confirming, the original turn kept running and the
// edited message simply joined its queue. `session.cancel` is the Host's own "stop the
// active turn" call (the same one Esc Esc uses). Three things must hold: it is called with
// the session id, it happens BEFORE the fork/send, and a failure is surfaced not swallowed.
{
  const seam = exportsObj.__test.cancelActiveTurn;
  cancelBehaviour = { ok: true };
  const okResult = await seam('sess-cancel-1');
  if (okResult.ok !== true) fail('a successful cancel must report ok');
  if (calls.cancelled.length !== 1) fail('the Host cancel must be called exactly once');
  if (calls.cancelled[0].sessionId !== 'sess-cancel-1') fail('the Host cancel must carry the session id');

  cancelBehaviour = { ok: false, error: { code: 'session/not-running', message: 'nothing is running' } };
  const bad = await seam('sess-cancel-1');
  if (bad.ok !== false) fail('a rejected cancel must not report ok');
  if (bad.error !== 'nothing is running') fail('the rejection reason must be unwrapped, got ' + JSON.stringify(bad.error));

  const empty = await seam('');
  if (empty.ok !== false) fail('an empty session id must fail');

  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const sendEdited = source.match(/function sendEdited\([\s\S]*?\n      \}/);
  if (!sendEdited) fail('sendEdited was not found');
  const orderStop = sendEdited[0].indexOf('stopRunningTurn(');
  const orderSend = sendEdited[0].indexOf('resend(');
  if (orderStop === -1 || orderSend === -1 || orderStop > orderSend) {
    fail('the stop must come BEFORE the resend, got stop@' + orderStop + ' send@' + orderSend);
  }
  const stopFn = source.match(/function stopRunningTurn\(\)[\s\S]*?\n      \}/);
  if (!stopFn) fail('stopRunningTurn was not found');
  // The old gate `turn.status !== "running"` was the CAUSE of the reported bug: the turn being
  // edited had FAILED while the session was busy elsewhere, so no cancel happened, the fork
  // carried the original text, and the edited message merely queued behind it.
  if (/turn\.status !== "running"/.test(stopFn[0])) fail('stopRunningTurn must NOT gate on this turn\'s status (that gate caused "the original resends and my edit queues")');
  if (!/cancelTurn\(\)/.test(stopFn[0])) fail('stopRunningTurn must always reach the cancel seam');
  if (!/cancelTurn\(\)/.test(stopFn[0])) fail('the stop must go through the injected cancel');
  // Presence of the call is not enough: both failure branches must report, and a mutation
  // that empties one of them would still satisfy a whole-function regex.
  const rejectBranch = stopFn[0].match(/result\.ok === false\) \{[\s\S]{0,220}?\}/);
  if (!rejectBranch) fail('the rejected-cancel branch was not found');
  if (!/showNotice/.test(rejectBranch[0])) fail('a rejected cancel must be reported, not swallowed');
  const throwBranch = stopFn[0].match(/\}, function \(e\) \{[\s\S]{0,220}?\}/);
  if (!throwBranch) fail('the throwing-cancel branch was not found');
  if (!/showNotice/.test(throwBranch[0])) fail('a throwing cancel must be reported, not swallowed');
  const applyCancel = source.match(/function cancelActiveTurn\(sessionId\)[\s\S]*?\n      \}/);
  if (!applyCancel) fail('cancelActiveTurn was not found');
  if (!/remote\.session\.cancel\(\{ sessionId: sessionId \}\)/.test(applyCancel[0])) {
    fail('the Host call must be session.cancel with the session id');
  }
  if (!/typeof ctx\.remote\.session\.cancel !== "function"/.test(applyCancel[0])) {
    fail('a Host without session.cancel must be reported as unsupported, not thrown');
  }
  console.log('  ok   retry/resend stops the running turn first, and a failed stop is reported');
}

// ---- a click that cannot proceed must say why ----
//
// Five paths used to do nothing at all: the context menu bypasses the disabled button, the
// archive step and the hand-over reader swallowed their failures, a missing cancel seam was
// treated as success, and run() had no timeout — so an op that never settles disables the
// button forever. Every one of them is a click with no feedback.
{
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

  // busy guards must speak (three of them — the fourth was 「回退到此」's handler, deleted on
  // 2026-10-17; the count is asserted so a NEW entry point cannot arrive without a guard):
  // a disabled button does not protect the context menu.
  const busySpots = (source.match(/if \(busy\[0\]\) \{/g) || []).length;
  const busyNotices = (source.match(/t\("dialog\.busy"\)/g) || []).length;
  if (busySpots !== 3) fail('expected three dialog entry points, got ' + busySpots);
  if (busyNotices !== 3) fail('every busy guard must report, got ' + busyNotices + '/3');

  // run() must be able to give up
  const runFn = source.match(/function run\(op, fallbackErrorKey\)[\s\S]*?\n      \}/);
  if (!runFn) fail('run() was not found');
  if (!/setTimeout\(/.test(runFn[0]) || !/clearTimeout\(/.test(runFn[0])) fail('run() must time out and clear its timer');
  // The VALUE matters: a "timeout" of an hour is indistinguishable from none, and a
  // presence-only check lets that slip through.
  const timeoutConst = source.match(/var RUN_TIMEOUT_MS = (\d+);/);
  if (!timeoutConst) fail('the run timeout constant is missing');
  if (Number(timeoutConst[1]) > 600000) fail('the run timeout must be a sane bound, got ' + timeoutConst[1]);
  if (Number(timeoutConst[1]) < 1000) fail('the run timeout must allow a real operation, got ' + timeoutConst[1]);
  if (!/error\.timeout/.test(source)) fail('the timeout must have its own message');

  // the other three silent paths must report
  const archiveBranch = source.match(/archiveSession\(sessionId\)[\s\S]{0,400}?\}\);/);
  if (!archiveBranch || !/showNotice/.test(archiveBranch[0])) fail('a failed archive must be reported');
  const stopFn = source.match(/function stopRunningTurn\(\)[\s\S]*?\n      \}/);
  if (!stopFn || !/resend\.cancelUnavailable/.test(stopFn[0])) fail('a missing cancel seam must be reported');
  const touchedAt = source.indexOf('testHooks.mutatedPathsOf(sessionId, turnNumber)');
  if (touchedAt === -1) fail('the hand-over reader was not found');
  const touchedBlock = source.slice(touchedAt, touchedAt + 400);
  if (!/catch \(e\) \{[\s\S]{0,220}?showNotice/.test(touchedBlock)) {
    fail('a failed hand-over read must be reported');
  }

  console.log('  ok   every non-runnable click reports why (busy / archive / seam / timeout / hand-over)');
}

console.log('\nFLOW CHECKS PASSED');
