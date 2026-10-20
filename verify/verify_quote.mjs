// Quote insertion must never destroy the composer draft, and notes must survive
// a browser-local round trip while tolerating malformed stored data.
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const windowObj = { __ModuleLoader__: {}, innerWidth: 1200, innerHeight: 800 };
let loaded = null;
windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function () {}, Button: function () {}, IconListPenOutlineRegular: function () {} };
const mockRequire = (id) => id === 'react' ? reactMock
  : id === 'react/jsx-runtime' ? jsxMock
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock
  : (() => { throw new Error('unexpected ' + id); })();
const sandbox = {
  window: windowObj, localStorage, require: mockRequire, TextEncoder, btoa, atob, TextDecoder,
  setTimeout, clearTimeout, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);
const bridge = exportsObj.__test;
if (!bridge || typeof bridge.insertQuoteIntoDraft !== 'function') fail('insertQuoteIntoDraft is not exposed for testing');

// Some helpers read the Chat store through the apply() closure, so apply() must run.
let currentSnapshot = { locations: { getTurn: () => [] }, nodes: { get: () => undefined, values: () => [] } };
exportsObj.apply({
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: (n, f) => { f(); }, register: () => {} },
  sessions: { create: async () => 'x', fork: async () => 'y', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => currentSnapshot }) }) },
  uiWorkspace: {
    openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => ''
  },
  remote: {
    session: { prompt: async () => ({ ok: true }) },
    agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
    workspace: { create: async () => ({ ok: true }) }
  }
});

// ---- the composer must never lose what the user already typed ----
//
// The action face's real contract (read from dsh-client-ui-conversation):
//   captureInsertion() -> {start, end, draftRev}
//   insertText(text, span) -> false when span.draftRev !== rev, then caret-inserts
//   setDraft(text) -> replaces the WHOLE draft (never a fallback)
// So: the span is mandatory, a stale rev is retried, and setDraft must never be called.
function composer(initial) {
  const state = { draft: initial, rev: 1, setDraftCalls: 0, insertTextCalls: 0, bumpRevOnFail: false };
  return {
    state,
    api: {
      captureInsertion: () => ({ start: state.draft.length, end: state.draft.length, draftRev: state.rev }),
      insertText: (text, span) => {
        state.insertTextCalls += 1;
        if (!span || span.draftRev !== state.rev) return false;
        if (state.bumpRevOnFail) { state.bumpRevOnFail = false; state.rev += 1; return false; }
        state.draft = state.draft.slice(0, span.start) + text + state.draft.slice(span.end);
        return true;
      },
      setDraft: (value) => { state.setDraftCalls += 1; state.draft = value; }
    }
  };
}

const quote = '> 要我加吗\n\n↳ 引自本轮第 3 轮\n\n';
{
  const c = composer('先写好的内容');
  const outcome = bridge.insertQuoteIntoDraft(c.api, quote);
  if (outcome !== 'inserted') fail('expected an insertion, got ' + outcome);
  if (c.state.setDraftCalls !== 0) fail('setDraft must never be used');
  if (!c.state.draft.startsWith('先写好的内容')) fail('the existing draft was destroyed');
  if (c.state.draft.indexOf('引自本轮第 3 轮') === -1) fail('the quote was not written');
}
{
  const c = composer('');
  const outcome = bridge.insertQuoteIntoDraft(c.api, quote);
  if (outcome !== 'inserted') fail('an empty draft should insert too, got ' + outcome);
  if (c.state.setDraftCalls !== 0) fail('setDraft must never be used, not even for an empty draft');
  if (c.state.draft !== quote) fail('at offset 0 the quote needs no leading newline: ' + JSON.stringify(c.state.draft));
}
{
  // A stale rev must be retried with a fresh span, not abandoned.
  const c = composer('内容');
  c.state.bumpRevOnFail = true;
  const outcome = bridge.insertQuoteIntoDraft(c.api, quote);
  if (outcome !== 'inserted') fail('a stale caret must be retried, got ' + outcome);
  if (c.state.insertTextCalls < 2) fail('the retry must actually re-attempt');
  if (c.state.draft.indexOf('内容') !== 0) fail('the draft was lost across the retry');
}
{
  // The exact shape that used to be read as "the draft is empty".
  const state = { draft: '光标在最前面', setDraftCalls: 0 };
  const outcome = bridge.insertQuoteIntoDraft({
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: () => false,
    setDraft: (v) => { state.setDraftCalls += 1; state.draft = v; }
  }, quote);
  if (outcome !== 'failed') fail('an empty span at 0 must not be read as an empty draft');
  if (state.setDraftCalls !== 0) fail('an empty span at 0 must never trigger setDraft');
  if (state.draft !== '光标在最前面') fail('the draft must be intact');
}
{
  const refused = bridge.insertQuoteIntoDraft({ insertText: () => false, setDraft: () => { throw new Error('setDraft must not be reachable'); } }, quote);
  if (refused !== 'failed') fail('a refusing composer must fail closed, got ' + refused);
  const noSpan = bridge.insertQuoteIntoDraft({ insertText: () => true }, quote);
  if (noSpan !== 'failed') fail('without captureInsertion there is no valid span, so it must fail closed');
  const throwing = { captureInsertion: () => { throw new Error('boom'); }, insertText: () => true };
  if (bridge.insertQuoteIntoDraft(throwing, quote) !== 'failed') fail('a throwing captureInsertion must fail closed');
  const badSpan = { captureInsertion: () => ({ start: 0 }), insertText: () => true };
  if (bridge.insertQuoteIntoDraft(badSpan, quote) !== 'failed') fail('an incomplete span must fail closed');
  if (bridge.insertQuoteIntoDraft({ insertText: () => { throw new Error('boom'); }, captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) }, quote) !== 'failed') fail('a throwing insertText must fail closed');
  if (bridge.insertQuoteIntoDraft(undefined, quote) !== 'failed') fail('a missing input service must fail closed');
  if (bridge.insertQuoteIntoDraft({}, quote) !== 'failed') fail('an empty input service must fail closed');
}

// ---- legacy chip anchors still resolve to their turn ----
// An earlier version wrote the anchor as a bare `@第N轮` to make the chat render a chip.
// That chip is a FILE chip (the token is not a known session), so it promised "open a
// file" and clicked through to a broken preview; anchors are plain text again. Old
// messages still carry those chips, and clicking one must jump to the turn, not open a
// file — hence this parser, with strict matching so a real file reference is never
// mistaken for a turn.
{
  if (bridge.parseTurnChip('@第99轮') !== 99) fail('the wire form with @ parses');
  if (bridge.parseTurnChip('第99轮') !== 99) fail('the CHIP text has no @ (projectUserText drops it) and must still parse');
  if (bridge.parseTurnChip('@第1轮') !== 1) fail('a single-digit turn parses');
  if (bridge.parseTurnChip('@第123456轮') !== 123456) fail('a long turn parses');
  if (bridge.parseTurnChip('@file.txt') !== null) fail('a file reference must NOT be read as a turn');
  if (bridge.parseTurnChip('file2.txt') !== null) fail('a file name containing a digit must NOT be read as a turn');
  if (bridge.parseTurnChip('@some-session') !== null) fail('a session label must NOT be read as a turn');
  if (bridge.parseTurnChip('第99轮还有别的字') !== null) fail('the match must be the WHOLE chip, not a prefix');
  if (bridge.parseTurnChip('') !== null || bridge.parseTurnChip(null) !== null) fail('empty input is safe');
  if (bridge.parseTurnChip('@第99999999999999999999轮') !== null) fail('an out-of-range turn must be rejected');
}

// ---- a jump lands on WHAT was quoted in that turn, not merely on the turn ----
{
  const sid = 'sess-jump';
  bridge.rememberQuote({ sessionId: sid, turn: 5, seq: 50, marker: 'm1', quote: '老的那句', at: 1 });
  bridge.rememberQuote({ sessionId: sid, turn: 5, seq: 51, marker: 'm2', quote: '新的那句', at: 2 });
  bridge.rememberQuote({ sessionId: sid, turn: 9, seq: 90, marker: 'm3', quote: '', at: 3 });
  const newest = bridge.findQuoteRecord(sid, 5);
  if (!newest || newest.quote !== '新的那句') fail('the newest record for the turn wins');
  if (bridge.findQuoteRecord(sid, 9) !== null) fail('a record without a body cannot anchor a landing');
  if (bridge.findQuoteRecord(sid, 7) !== null) fail('an unquoted turn resolves to null');
  if (bridge.findQuoteRecord(sid, 'x') !== null) fail('a non-numeric turn resolves to null');
  if (bridge.findQuoteRecord('other', 5) !== null) fail('records are scoped to their session');
}

// ---- an anchor present as TEXT still resolves ----
// The point of writing the anchor into the message is that it survives without the
// localStorage record: copied to another machine, pasted, or typed by hand. Spacing is
// allowed to vary; only the number matters.
{
  const a = bridge.parseTurnAnchor('↳ 引自本轮第 104 轮 · seq 7680');
  if (!a || a.turn !== 104 || a.seq !== 7680) fail('the canonical anchor parses with its seq');
  if (bridge.parseTurnAnchor('↳ 引自本轮第 104轮').turn !== 104) fail('a hand-typed anchor without the space parses');
  if (bridge.parseTurnAnchor('引自本轮第  7  轮').turn !== 7) fail('extra spacing parses');
  if (bridge.parseTurnAnchor('随便写的文字') !== null) fail('text without an anchor resolves to null');
  if (bridge.parseTurnAnchor('') !== null) fail('empty text resolves to null');
  if (bridge.parseTurnAnchor(null) !== null) fail('null input resolves to null');
  if (bridge.parseTurnAnchor('引自本轮第 99999999999999999999 轮') !== null) fail('an out-of-range turn is rejected');
  // The exact shape a user typed by hand — extra words after the anchor, no space.
  const typed = bridge.parseTurnAnchor('↳ 引自本轮第 104轮 test3');
  if (!typed || typed.turn !== 104) fail('a hand-typed anchor with trailing words must parse');
  const noSeq = bridge.parseTurnAnchor('↳ 引自本轮第 12 轮');
  if (noSeq.seq !== undefined) fail('a missing seq is undefined, not NaN');
  // And the jump lookup falls back to the text when no record matches.
  const synthetic = bridge.findQuoteInText('session-without-records', '↳ 引自本轮第 88 轮 · seq 9');
  if (!synthetic || synthetic.turn !== 88) fail('a text-only anchor must still be jumpable');
}

// ---- a message can carry SEVERAL anchors, and each must be offered ----
// Guessing "the newest" for a message with two anchors is a quiet wrong answer; the menu
// lists them instead.
{
  const many = bridge.findAllTurnAnchors([
    '▍ 甲',
    '▍ ↳ 引自本轮第 107 轮 · seq 7845',
    '▍ ↳ 引自本轮第 109 轮',
    '▍ ↳ 引自本轮第 104轮'
  ].join('\n'));
  if (many.length !== 3) fail('every anchor must be found, got ' + many.length);
  if (many[0].turn !== 107 || many[0].seq !== 7845) fail('the first anchor keeps its seq');
  if (many[1].turn !== 109 || many[1].seq !== undefined) fail('a seq-less anchor is fine');
  if (many[2].turn !== 104) fail('a hand-typed anchor is found too');
  if (bridge.findAllTurnAnchors('没有锚点').length !== 0) fail('no anchors means an empty list');
  if (bridge.findAllTurnAnchors(null).length !== 0) fail('null is safe');
  // The seq must belong to ITS anchor, not to a later one on the same line run.
  const seqScope = bridge.findAllTurnAnchors('↳ 引自本轮第 5 轮\n↳ 引自本轮第 6 轮 · seq 60');
  if (seqScope[0].seq !== undefined) fail('a seq on the next anchor must not leak backwards');
  if (seqScope[1].seq !== 60) fail('the second anchor keeps its own seq');
}

// ---- a match must be attributed to the turn it sits in ----
// A turn spans several flow items (user message, assistant reply, tool rows). Scoping the
// search to one element missed the quoted sentence whenever it lived in another item of
// the same turn — the normal case when quoting the assistant.
{
  if (bridge.pickIndexForTurn([7, 104, 109], 104) !== 1) fail('the match inside the wanted turn wins');
  if (bridge.pickIndexForTurn([104, 7, 104], 104) !== 0) fail('the first match inside the turn wins');
  if (bridge.pickIndexForTurn([7, 8], 104) !== -1) fail('no match in the turn means -1 (fall back to the turn)');
  if (bridge.pickIndexForTurn([], 104) !== -1) fail('an empty list means -1');
  if (bridge.pickIndexForTurn([-1, -1, 5], 5) !== 2) fail('unattributable matches are skipped');
}

// ---- several quotes in ONE message ----
// A marker repeats (two quotes from the same turn carry the identical text), so the
// marker alone cannot identify which quote a click meant. The quoted BODY is stored for
// that, and a selection pins exactly one.
{
  const sid = 'sess-multi';
  const body = 'dfasfasfa\n> captureInsertion:\n\n↳ 引自本轮第 93 轮\n\n> 另一句\n\n↳ 引自本轮第 91 轮\n\n';
  bridge.rememberQuote({ sessionId: sid, turn: 93, seq: 100, marker: '↳ 引自本轮第 93 轮', quote: 'captureInsertion:', at: 1 });
  bridge.rememberQuote({ sessionId: sid, turn: 91, seq: 80, marker: '↳ 引自本轮第 91 轮', quote: '另一句', at: 2 });

  const older = bridge.findQuoteInText(sid, body, '> captureInsertion:\n\n↳ 引自本轮第 93 轮');
  if (!older || older.turn !== 93) fail('a selection over the older quote must resolve to turn 93, got ' + JSON.stringify(older && older.turn));
  const newer = bridge.findQuoteInText(sid, body, '> 另一句\n\n↳ 引自本轮第 91 轮');
  if (!newer || newer.turn !== 91) fail('a selection over the newer quote must resolve to turn 91');
  // Without a selection the body is still more distinctive than the marker, and
  // newest-first decides between quotes that both match.
  const byBody = bridge.findQuoteInText(sid, body, '');
  if (!byBody || byBody.turn !== 91) fail('without a selection the newest matching quote wins');
  // A selection that matches nothing falls back to the body/marker path rather than null.
  const fallback = bridge.findQuoteInText(sid, body, '与两处引用都无关的文字');
  if (!fallback) fail('an unrelated selection must still fall back, not return null');
  // Same-turn quotes share a marker, so the body is the only discriminator.
  bridge.rememberQuote({ sessionId: sid, turn: 7, seq: 10, marker: '↳ 引自本轮第 7 轮', quote: '甲', at: 3 });
  bridge.rememberQuote({ sessionId: sid, turn: 7, seq: 10, marker: '↳ 引自本轮第 7 轮', quote: '乙', at: 4 });
  const sameTurn = bridge.findQuoteInText(sid, '> 甲\n\n↳ 引自本轮第 7 轮', '> 甲\n\n↳ 引自本轮第 7 轮');
  if (!sameTurn || sameTurn.quote !== '甲') fail('an identical marker must be disambiguated by the quoted body');
  if (bridge.findQuoteInText(sid, '完全没有引用的消息', '') !== null) fail('a message with no quote must resolve to null');
  if (bridge.findQuoteInText(sid, '', '') !== null) fail('an empty message must resolve to null');
  const cross = bridge.findQuoteInText('other-session', body, '');
  if (cross !== null && cross.fromText !== true) {
    fail("another session's RECORD must not leak; only a text anchor may resolve here");
  }
  // The marker can be edited out of a message while the quoted body survives; the body
  // pass must still find the record there.
  const bodyOnly = bridge.findQuoteInText(sid, '只剩正文：另一句 但 marker 被删掉了', '');
  if (!bodyOnly || bodyOnly.turn !== 91) fail('a surviving quoted body must still resolve without its marker');
  // blockquote must hand the body out, since that is what gets recorded.
  if (bridge.blockquote('甲乙').body !== '甲乙') fail('blockquote must expose the quoted body');
}

// ---- a quote is a bar-bounded block, and a long one is clipped ----
{
  const short = bridge.blockquote('很短的一句');
  if (short.text !== '▍ 很短的一句\n') fail('a short quote is one bared line: ' + JSON.stringify(short.text));
  if (short.body !== '很短的一句' || short.clipped !== false) fail('the body is stored without the bar');
  if (bridge.blockquote('   ').text !== '') fail('a blank selection quotes nothing');
  if (bridge.blockquote(null).text !== '') fail('null is safe');
  // Line breaks survive: a quoted snippet keeps its shape, and every line carries the bar
  // so the boundary is visible in plain text (the app does not render user markdown).
  const multi = bridge.blockquote('第一行\n第二行');
  if (multi.text !== '▍ 第一行\n▍ 第二行\n') fail('each line of a multi-line quote gets the bar: ' + JSON.stringify(multi.text));
  if (multi.body !== '第一行\n第二行') fail('the stored body keeps its line break');
  // Blank runs collapse instead of producing a stack of empty bars.
  const gaps = bridge.blockquote('甲\n\n\n乙');
  if (gaps.text !== '▍ 甲\n▍\n▍ 乙\n') fail('blank runs collapse to one bared gap: ' + JSON.stringify(gaps.text));
  const long = bridge.blockquote('字'.repeat(bridge.QUOTE_MAX_CHARS + 120));
  if (long.clipped !== true) fail('an over-long quote must report itself as clipped');
  if (long.text.indexOf('…') === -1) fail('a clipped quote must be marked');
  if (long.body.length > bridge.QUOTE_MAX_CHARS + 2) fail('a clipped body must really be short');
  // Every line of the rendered block is bounded, including the provenance line added later.
  const bar = '▍ ';
  if (bridge.blockquote('x').text.split('\n').filter((l) => l !== '').every((l) => l.startsWith(bar) || l === '▍') !== true) {
    fail('every non-empty line must carry the bar');
  }
}

// ---- notes: browser-local round trip ----// ---- notes: browser-local round trip ----
bridge.writeNotes([
  { id: 'n1', text: '硬刷新：Cmd + Shift + R', at: 2 },
  { id: 'n2', text: '插件目录 /tmp/dsh-deepworker', at: 1 }
]);
const notes = bridge.readNotes();
console.log('notes ->', JSON.stringify(notes.map((n) => n.text)));
if (notes.length !== 2 || notes[0].id !== 'n1') fail('notes round trip failed');
if (!store.has(bridge.NOTES_KEY)) fail('notes were not persisted under ' + bridge.NOTES_KEY);

store.set(bridge.NOTES_KEY, '{ this is not json');
if (bridge.readNotes().length !== 0) fail('malformed notes must degrade to an empty list');
store.set(bridge.NOTES_KEY, JSON.stringify([{ id: 'ok', text: 'fine' }, null, { nope: 1 }]));
const filtered = bridge.readNotes();
console.log('malformed entries dropped ->', JSON.stringify(filtered.map((n) => n.id)));
if (filtered.length !== 1 || filtered[0].id !== 'ok') fail('notes must drop malformed entries');

// ---- import: JSON round trip, plain lines, duplicates, junk ----
const existing = [{ id: 'a', text: '已有的一条', at: 1 }];
{
  const exported = JSON.stringify([{ id: 'a', text: '已有的一条' }, { id: 'b', text: '新来的' }]);
  const merged = bridge.mergeNotes(existing, exported);
  console.log('json import ->', merged.added, JSON.stringify(merged.list.map((n) => n.text)));
  if (merged.added !== 1) fail('json import must add exactly the new note, added=' + merged.added);
  if (merged.list.length !== 2) fail('json import merged wrong length');
  if (merged.list[1].id === 'b') fail('imported notes must get fresh ids, not reuse the payload ids');
}
{
  const merged = bridge.mergeNotes(existing, '第一条\n\n- 第二条\n第三条');
  console.log('text import ->', merged.added, JSON.stringify(merged.list.map((n) => n.text)));
  if (merged.added !== 3) fail('plain-text import (bullets, blank lines) wrong: ' + merged.added);
  if (merged.list.some((n) => n.text === '')) fail('blank lines must not become notes');
}
{
  const merged = bridge.mergeNotes(existing, '不是 JSON { 坏数据');
  if (merged.added !== 1) fail('malformed JSON must fall back to one-note-per-line');
}
{
  const merged = bridge.mergeNotes(existing, '[]');
  if (merged.added !== 0 || merged.list.length !== 1) fail('an empty payload must change nothing');
}

// ---- a retry must fork BEFORE the turn: a fork seed is a verbatim prefix slice,
// ---- so forking at the end would also inherit the not-yet-sent queue and both
// ---- sessions would then deliver it.
{
  const forkSeq = bridge.retryForkSeq({ turn: 5, start: { seq: 101 }, end: { seq: 140 }, status: 'failed' });
  console.log('retry fork seq ->', forkSeq, '(turn spans 101..140; must be the seq before it)');
  if (forkSeq !== 100) fail('a retry must fork just before the turn (100), got ' + forkSeq);
  if (forkSeq === 140) fail('forking at the turn end would duplicate the queued inbox');
  if (bridge.retryForkSeq({ turn: 5 }) !== undefined) fail('a turn without a start must not fork');
  if (bridge.retryForkSeq(undefined) !== undefined) fail('a missing turn must not fork');
  if (bridge.retryForkSeq({ turn: 5, start: { seq: 'nope' } }) !== undefined) fail('a non-numeric start must not fork');
  if (bridge.retryForkSeq({ turn: 0, start: { seq: 1 } }) !== 0) fail('a turn starting at seq 1 must fork at 0');
  if (bridge.retryForkSeq({ turn: 0, start: { seq: 0 } }) !== undefined) fail('a negative boundary must not be used (atSeq must be a non-negative seq)');
}

// ---- the retry hands over what the failed attempt already changed ----
{
  const snap = {
    locations: { getTurn: () => ['k-a', 'k-b', 'k-c'] },
    nodes: { get: (k) => ({
      'k-a': { data: { content: [
        { kind: 'tool-call', name: 'write', argsRaw: JSON.stringify({ path: 'backend/app/agent/conversation.py' }) },
        { kind: 'tool-call', name: 'edit', argsRaw: JSON.stringify({ path: 'backend/app/channels/ruliu.py' }) }
      ] } },
      'k-b': { data: { content: [
        { kind: 'tool-call', name: 'write', argsRaw: JSON.stringify({ path: 'backend/app/agent/conversation.py' }) },
        { kind: 'tool-call', name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'view', path: 'ignored-view.py' }) },
        { kind: 'tool-call', name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'str_replace', path: 'backend/app/policy.py' }) },
        { kind: 'tool-call', name: 'read', argsRaw: JSON.stringify({ path: 'ignored-read.py' }) },
        { kind: 'tool-call', name: 'edit', argsRaw: '{ malformed' }
      ] } },
      'k-c': { data: { name: 'write', argsRaw: JSON.stringify({ path: 'backend/tests/test_x.py' }) } }
    })[k] }
  };
  currentSnapshot = snap;
  const paths = bridge.mutatedPathsOf('sess-1', 3);
  console.log('mutated paths ->', JSON.stringify(paths));
  if (paths.join(',') !== 'backend/app/agent/conversation.py,backend/app/channels/ruliu.py,backend/app/policy.py,backend/tests/test_x.py') {
    fail('mutated path extraction wrong: ' + JSON.stringify(paths));
  }
  if (paths.indexOf('ignored-view.py') !== -1) fail('a read-only str_replace_editor view must not count');
  if (paths.indexOf('ignored-read.py') !== -1) fail('read must not count');
}

// ---- the conversation digest reads turns, asks and changed files ----
{
  const digestSnap = {
    timeline: { turnOrder: [0, 1, 2] },
    locations: { getTurn: (t) => ['u' + t] },
    nodes: {
      get: (k) => ({
        u0: { kind: 'user', data: { content: [{ type: 'text', text: '  先把   工作区  改好  ' }] } },
        u1: { kind: 'user', data: { content: [{ type: 'text', text: '再改 policy' }] } },
        u2: { kind: 'user', data: { content: [
          { type: 'text', text: '收尾' },
          { kind: 'tool-call', name: 'edit', argsRaw: JSON.stringify({ path: 'a.py' }) }
        ] } }
      })[k]
    }
  };
  currentSnapshot = digestSnap;
  const digest = bridge.conversationDigest('sess-1');
  console.log('digest ->', JSON.stringify(digest));
  if (digest.turns !== 3) fail('digest turn count wrong');
  if (digest.asks.length !== 3) fail('digest must collect every ask, got ' + digest.asks.length);
  if (digest.asks[0] !== '先把 工作区 改好') fail('digest must collapse whitespace: ' + JSON.stringify(digest.asks[0]));
  if (digest.files.join(',') !== 'a.py') fail('digest must fold changed files: ' + JSON.stringify(digest.files));
  if (bridge.conversationDigest === null) fail('digest seam missing');

  // with the official turnOutline the digest becomes a per-turn outline
  currentSnapshot = digestSnap;
  const outline = [
    { turn: 0, prompt: '  先把工作区改好  ', response: '已改好 conversation.py' },
    { turn: 1, prompt: '再改 policy', response: '' },
    { turn: 2, prompt: '收尾', response: '完成' }
  ];
  const outlined = bridge.conversationDigest('sess-1', outline);
  console.log('outline digest ->', JSON.stringify(outlined));
  if (outlined.source !== 'outline') fail('the turnOutline must take precedence over the store fallback');
  if (outlined.turns !== 3 || outlined.steps.length !== 3) fail('outline digest turn count wrong');
  if (outlined.steps[0].prompt !== '先把工作区改好') fail('outline prompt must be whitespace-collapsed: ' + JSON.stringify(outlined.steps[0].prompt));
  if (outlined.steps[0].response !== '已改好 conversation.py') fail('outline response missing');
  if (outlined.steps[1].response !== '') fail('an empty response must stay empty for the caller to label');
  if (outlined.files.join(',') !== 'a.py') fail('outline digest must still fold changed files: ' + JSON.stringify(outlined.files));

  // options: keyword filter, answer length, max turns
  const filtered = bridge.conversationDigest('sess-1', outline, { keyword: 'policy', responseLimit: 320 });
  console.log('keyword filter ->', JSON.stringify(filtered.steps.map((x) => x.prompt)));
  if (filtered.steps.length !== 1 || filtered.steps[0].prompt !== '再改 policy') {
    fail('keyword filter must keep only matching turns: ' + JSON.stringify(filtered.steps));
  }
  if (filtered.turns !== 3) fail('filtering must not change the reported turn count');
  const capped = bridge.conversationDigest('sess-1', outline, { maxTurns: 2 });
  if (capped.steps.length !== 2 || capped.steps[0].prompt !== '再改 policy') fail('maxTurns must keep the most recent turns');
  const long = bridge.conversationDigest('sess-1', outline, { responseLimit: 320 });
  if (long.steps[0].response !== '已改好 conversation.py') fail('a longer limit must not alter short text');
  const noMatch = bridge.conversationDigest('sess-1', outline, { keyword: 'zzz-not-there' });
  if (noMatch.steps.length !== 0) fail('a keyword with no match must yield no steps');

  // no outline -> the store fallback still works
  const storeOnly = bridge.conversationDigest('sess-1');
  if (storeOnly.source !== 'store') fail('without an outline the store fallback must be used');

  // an empty window digests to nothing rather than throwing
  currentSnapshot = { timeline: { turnOrder: [] }, locations: { getTurn: () => [] }, nodes: { get: () => undefined } };
  const empty = bridge.conversationDigest('sess-1');
  if (empty.turns !== 0 || empty.asks.length !== 0) fail('an empty conversation must digest to zero turns');
  const emptyOutline = bridge.conversationDigest('sess-1', []);
  if (emptyOutline.source !== 'store') fail('an empty outline array must fall back, not produce an empty summary');
}

// ---- settings: defaults, round trip, junk tolerance ----
{
  const fresh = bridge.readSettings();
  if (fresh.quoteProvenance !== true || fresh.retryNote !== true || fresh.archiveOriginal !== true) {
    fail('settings defaults wrong: ' + JSON.stringify(fresh));
  }
  bridge.writeSettings({ quoteProvenance: false, retryNote: false, archiveOriginal: false });
  const saved = bridge.readSettings();
  console.log('settings round trip ->', JSON.stringify(saved));
  if (saved.quoteProvenance !== false || saved.retryNote !== false || saved.archiveOriginal !== false) fail('settings round trip failed');
  if (!store.has(bridge.SETTINGS_KEY)) fail('settings must persist under ' + bridge.SETTINGS_KEY);

  store.set(bridge.SETTINGS_KEY, '{ not json');
  if (bridge.readSettings().quoteProvenance !== true) fail('malformed settings must fall back to defaults');
  store.set(bridge.SETTINGS_KEY, JSON.stringify({ quoteProvenance: 'yes', junk: 1 }));
  const partial = bridge.readSettings();
  if (partial.quoteProvenance !== true) fail('a non-boolean setting must be ignored, not coerced');
  if (partial.archiveOriginal !== true) fail('a missing key must keep its default');
  store.delete(bridge.SETTINGS_KEY);
  console.log('settings junk tolerance OK');
}

// ---- a digest is a snapshot: saving it again must ADD, not be de-duped away ----
{
  const base = [{ id: 'a', text: '已有的一条', at: 1 }];
  const first = bridge.appendNote(base, '【会话摘要】同样的内容');
  const second = bridge.appendNote(first.list, '【会话摘要】同样的内容');
  console.log('repeat digest save -> added', first.added, '+', second.added, 'total', second.total);
  if (first.added !== 1 || second.added !== 1) fail('an identical digest must still be saved the second time');
  if (second.total !== 3) fail('the note count must grow: ' + second.total);
  const ids = second.list.map((n) => n.id);
  if (new Set(ids).size !== ids.length) fail('appended notes must get fresh unique ids');
  const blank = bridge.appendNote(base, '   ');
  if (blank.added !== 0 || blank.total !== 1) fail('an empty digest must not create an empty note');
  // the import path keeps its duplicate rule
  const imported = bridge.mergeNotes(base, JSON.stringify([{ text: '已有的一条' }]));
  if (imported.added !== 0) fail('import must still skip duplicates');
}

{
  // The quote anchor must land in the MESSAGE TEXT: that is what makes provenance
  // durable and readable by any later reader without a client->host remote. It must
  // carry the seq (a turn number alone is ambiguous after compaction or a fork), and
  // the seq must be CONCATENATED — placeholders in `t()` proved unreliable for keys
  // that are not exercised daily, and a silent non-substitution would drop the anchor.
  const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  if (!code.includes('" · seq " + endSeq')) fail('the quote marker must append the seq by concatenation');
  for (const line of code.split('\n')) {
    if (line.includes('"quote.provenance"') && line.includes('{seq}')) {
      fail('quote.provenance must not rely on a {seq} placeholder');
    }
  }
  if (!code.includes('rememberQuote({')) fail('the localStorage record must stay for the in-page jump');
}

console.log('\nQUOTE-INSERT AND NOTES CHECKS PASSED');
