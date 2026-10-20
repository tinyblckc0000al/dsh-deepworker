// The jump highlight must be DRIVEN, not grepped.
//
// Every earlier assertion about it only checked that certain names appear in the source —
// which is not verification (a dead function satisfies a text match). This suite runs the
// real logic against a small but honest DOM: it finds the ranges, attributes them to turns,
// wraps the right one, and then proves the wrapper is removed again and the transcript is
// byte-identical afterwards.
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const ok = (m) => console.log('  ok   ' + m);

// ---------------------------------------------------------------- minimal DOM
let textNodeCount = 0;
function makeText(value, parent) {
  return { nodeType: 3, nodeValue: value, parentElement: parent, __id: ++textNodeCount };
}
function makeEl(tag, attrs = {}) {
  const el = {
    nodeType: 1,                                   // an Element, or `nodeType === 1` checks lie
    tagName: String(tag).toUpperCase(),
    attributes: Object.assign({}, attrs),
    childNodes: [],
    parentNode: null,
    style: {},
    scrolled: 0,
    textContent: '',
    appendChild(child) {
      child.parentNode = el;
      if (child.nodeType === 3) child.parentElement = el;
      el.childNodes.push(child);
      el.refreshText();
      return child;
    },
    replaceChild(next, prev) {
      const at = el.childNodes.indexOf(prev);
      if (at < 0) throw new Error('replaceChild: not a child');
      next.parentNode = el;
      if (next.nodeType === 3) next.parentElement = el;
      el.childNodes[at] = next;
      // A real DOM detaches the removed node; a mock that keeps it attached hides bugs.
      if (prev) prev.parentNode = null;
      el.refreshText();
      return prev;
    },
    refreshText() {
      el.textContent = el.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join('');
    },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attributes, name) ? el.attributes[name] : null; },
    setAttribute(name, value) { el.attributes[name] = String(value); },
    closest(selector) {
      let node = el;
      while (node) {
        if (selector === '[data-chat-turn]' && node.getAttribute('data-chat-turn') !== null) return node;
        if (selector === '#dsh-ha-find' && node.attributes.id === 'dsh-ha-find') return node;
        node = node.parentNode;
      }
      return null;
    },
    scrollIntoView() { el.scrolled += 1; },
    remove() {
      const parent = el.parentNode;
      if (!parent) return;
      const at = parent.childNodes.indexOf(el);
      if (at >= 0) parent.childNodes.splice(at, 1);
      parent.refreshText();
      el.parentNode = null;
    },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; },
    contains() { return false; },
    normalize() {
      // Merge adjacent text nodes, the way the real DOM does.
      const merged = [];
      for (const child of el.childNodes) {
        const last = merged[merged.length - 1];
        if (last && last.nodeType === 3 && child.nodeType === 3) last.nodeValue += child.nodeValue;
        else merged.push(child);
      }
      el.childNodes = merged;
      el.refreshText();
    },
    querySelectorAll() { return []; }
  };
  return el;
}
function makeWalker(root) {
  const all = [];
  (function visit(node) {
    if (node.nodeType === 3) { all.push(node); return; }
    for (const child of node.childNodes) visit(child);
  })(root);
  let index = -1;
  return { nextNode: () => (++index < all.length ? all[index] : null) };
}
function makeRange(documentRef) {
  return {
    startContainer: null, startOffset: 0, endContainer: null, endOffset: 0,
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    surroundContents(span) {
      const node = this.startContainer;
      if (node.__refuseWrap) throw new Error('this node refuses wrapping (test)');
      if (node !== this.endContainer) throw new Error('cross-node range');
      const parent = node.parentElement;
      if (!parent) throw new Error('detached');
      const text = node.nodeValue;
      const before = text.slice(0, this.startOffset);
      const middle = text.slice(this.startOffset, this.endOffset);
      const after = text.slice(this.endOffset);
      span.appendChild(documentRef.createTextNode(middle));
      const at = parent.childNodes.indexOf(node);
      const replacement = [];
      if (before !== '') replacement.push(documentRef.createTextNode(before));
      replacement.push(span);
      if (after !== '') replacement.push(documentRef.createTextNode(after));
      for (const next of replacement) {
        next.parentNode = parent;
        if (next.nodeType === 3) next.parentElement = parent;
      }
      parent.childNodes.splice(at, 1, ...replacement);
      span.parentNode = parent;
      parent.refreshText();
    },
    extractContents() { throw new Error('not used in this suite'); },
    insertNode() { throw new Error('not used in this suite'); }
  };
}

// ---------------------------------------------------------------- transcript
//
// Turn 1 holds the same phrase twice; turn 2 holds it once. A jump to turn 2 must wrap the
// occurrence in turn 2 — not the first match overall.
const root = makeEl('div', { 'data-conversation-scroll': '' });
const phrase = 'typeof Highlight === "undefined"';
const turn1 = makeEl('div', { 'data-chat-turn': '1' });
const turn1b = makeEl('div', { 'data-chat-turn': '1' });
const turn2 = makeEl('div', { 'data-chat-turn': '2' });
root.appendChild(turn1);
root.appendChild(turn1b);
root.appendChild(turn2);
const t1 = turn1.appendChild(makeText('▍ first ' + phrase + ' here', turn1));
turn1b.appendChild(makeText('▍ again ' + phrase, turn1b));
const t2 = turn2.appendChild(makeText('▍ target ' + phrase + ' end', turn2));

const documentRef = {
  head: makeEl('head'),
  body: makeEl('body'),
  createTextNode: (value) => makeText(value, null),
  createElement: (tag) => makeEl(tag),
  createTreeWalker: (r) => makeWalker(r),
  createRange: () => makeRange(documentRef),
  querySelector: (selector) => (selector === '[data-conversation-scroll]' ? root : null),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

const timers = [];
const intervals = [];
const store = new Map();
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
  window: windowObj,
  document: documentRef,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  require: mockRequire, TextEncoder, btoa, atob, TextDecoder,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  setInterval: (fn) => { intervals.push(fn); return intervals.length; },
  clearInterval: (id) => { intervals[id - 1] = null; },
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console
};
sandbox.globalThis = sandbox;
sandbox.NodeFilter = { SHOW_TEXT: 4 };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);
const bridge = exportsObj.__test;

exportsObj.apply({
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: (n, f) => { f(); }, register: () => {} },
  sessions: { create: async () => 'x', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
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

// A text node the walker can reach must also have a parentElement — otherwise it is
// skipped as "detached" and a real occurrence silently disappears. Keeping the mock honest
// here is what exposed the missing re-render case below.
function assertParentsAttached(node, where) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3 && child.parentElement !== node) {
      fail('text node in ' + where + ' has no parentElement; the mock is not DOM-like');
    }
    if (child.nodeType === 1) assertParentsAttached(child, where + '>' + child.tagName);
  }
}
assertParentsAttached(root, 'root');
ok('every reachable text node is properly attached (mock is DOM-like)');

// ---------------------------------------------------------------- 1. ranges
// Counting MATCHES, not segments: the phrase contains spaces, whitespace is skipped on
// both sides, so a single match naturally splits into several runs.
const matches = bridge.collectMatches(phrase);
if (matches.length !== 3) fail('expected 3 occurrences across the transcript, got ' + matches.length);
if (matches[0].ranges[0].startContainer !== t1) fail('matches must come back in document order');
if (matches[2].ranges[0].startContainer !== t2) fail('the last match must be the one in turn 2');
const firstRange = matches[0].ranges[0];
if (firstRange.startOffset !== '▍ first '.length) fail('the first run must start right after the prefix, got ' + firstRange.startOffset);
// One range per text node, covering the spaces in between — a node-splitting wrap would
// invalidate a second range in the same node.
if (firstRange.endOffset - firstRange.startOffset !== phrase.length) {
  fail('the range must cover the whole phrase, got ' + (firstRange.endOffset - firstRange.startOffset));
}
ok('every occurrence is found, in document order, with exact offsets');

// ---------------------------------------------------------------- 2. the wrap
if (bridge.highlightQuoteInTurn(2, phrase) !== true) fail('a jump to turn 2 must land: ' + bridge.describeJump());
const diag = bridge.describeJump();
if (diag.indexOf('wrapped=yes') === -1) fail('the diagnostic must report the wrap: ' + diag);
if (diag.indexOf('turn=2') === -1) fail('the diagnostic must name the turn: ' + diag);
const wrappedAt = turn2.textContent.indexOf(phrase);
if (wrappedAt === -1) fail('the phrase must still be present after wrapping');
// A phrase containing spaces becomes SEVERAL runs (whitespace is skipped on both sides), so
// count wrappers semantically: every run wrapped, the text unchanged, other turns untouched.
const spans = turn2.childNodes.filter((n) => n.nodeType === 1 && n.getAttribute && n.getAttribute('data-ha-jump') === '1');
if (spans.length < 1) fail('the phrase must be wrapped, got ' + spans.length);
for (const one of spans) {
  if (one.style.backgroundColor === '') fail('every wrapper must be visibly styled');
  if (one.textContent === '') fail('a wrapper must not be empty');
}
if (spans.map((n) => n.textContent).join('') !== phrase) {
  fail('the wrappers together must hold the phrase verbatim: ' + JSON.stringify(spans.map((n) => n.textContent)));
}
if (turn1.textContent.indexOf(phrase) === -1 || turn1b.textContent.indexOf(phrase) === -1) {
  fail('the other occurrences must keep their text');
}
if (turn1.childNodes[0].nodeType !== 3 || turn1b.childNodes[0].nodeType !== 3) {
  fail('the other occurrences must not be wrapped at all');
}
// The WRAPPER must be scrolled, not the original text node: `surroundContents` splits or
// replaces that node, so scrolling it is a silent no-op in a real DOM (this suite's mock
// was too forgiving and hid exactly that bug).
if (spans[0].scrolled === 0) fail('the jump must scroll the WRAPPER element into view');
ok('the wrapper itself is scrolled (not the split-away text node)');
ok('the occurrence in the TARGET turn is wrapped, styled, and scrolled to');

// ---------------------------------------------------------------- 3. cleanup
if (timers.length === 0) fail('the flash must end on a timer');
const before = turn2.textContent;
for (const timer of timers) timer();
timers.length = 0;
if (turn2.textContent !== before) fail('cleanup must restore the text exactly');
if (turn2.querySelectorAll === undefined) fail('sanity');
if (turn2.childNodes.length !== 1 || turn2.childNodes[0].nodeType !== 3) {
  fail('cleanup must leave a single text node, got ' + turn2.childNodes.length);
}
if (turn2.childNodes[0].nodeValue !== before) fail('the restored text node must hold the original text');
if (spans.some((one) => one.parentNode !== null)) fail('every wrapper must be removed by cleanup');
ok('the wrapper is removed and the transcript is restored verbatim');

// ---------------------------------------------------------------- 2b. multi-line
// A quoted sentence is not obliged to live in one text node: a multi-line quote — or one
// crossing an inline element — is split by the renderer. Searching node by node finds
// NOTHING for those, which is why they used to fall back to flashing the turn.
{
  const turn3 = makeEl('div', { 'data-chat-turn': '3' });
  root.appendChild(turn3);
  const firstLine = '▍ 第一行前半 ';
  const secondLine = '后半在这里';
  const a = turn3.appendChild(makeText(firstLine, turn3));
  turn3.appendChild(makeEl('strong'));
  const b = turn3.appendChild(makeText(secondLine, turn3));   // same block, different node
  const multi = '第一行前半 后半在这里';
  const found = bridge.collectMatches(multi);
  if (found.length !== 1) fail('a phrase split across text nodes must be ONE match, got ' + found.length);
  if (found[0].ranges.length !== 2) fail('the match must have one segment per text node, got ' + found[0].ranges.length);
  if (found[0].ranges[0].startContainer !== a) fail('the first segment must be in the first node');
  if (found[0].ranges[1].startContainer !== b) fail('the second segment must be in the second node');
  if (found[0].ranges[0].startOffset !== '▍ '.length) fail('the first segment must start at the right offset');
  ok('a phrase split across text nodes is found as one match with two segments');

  if (bridge.highlightQuoteInTurn(3, multi) !== true) fail('a multi-line jump must land: ' + bridge.describeJump());
  const spans = turn3.childNodes.filter((n) => n.nodeType === 1 && n.getAttribute && n.getAttribute('data-ha-jump') === '1');
  if (spans.length !== 2) fail('both segments must be wrapped, got ' + spans.length);
  if (turn3.textContent.indexOf(multi) === -1) fail('the re-wrapped text must still read correctly');
  const beforeMulti = turn3.textContent;
  for (const timer of timers) timer();
  timers.length = 0;
  if (turn3.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
    fail('every segment must be unwrapped again');
  }
  if (turn3.textContent !== beforeMulti) fail('the multi-line block must be restored verbatim');
  ok('every segment is wrapped, then unwrapped, restoring the text');
}

// ---------------------------------------------------------------- 2b1. real case
// The exact shape that failed in the app: the quote is a markdown TABLE, so the stored body
// (taken from the selection) has tabs and newlines, while the rendered transcript is a set
// of cells with NO separators at all. Both sides are therefore compared whitespace-free.
{
  const turn6 = makeEl('div', { 'data-chat-turn': '6' });
  root.appendChild(turn6);
  // DOM as the renderer produces it — a markdown table becomes separate cells with NO
  // separators at all (and no bars: those belong to the QUOTING message, not the source).
  turn6.appendChild(makeEl('td'));
  turn6.appendChild(makeText('环节', turn6));
  turn6.appendChild(makeEl('td'));
  turn6.appendChild(makeText('做法', turn6));
  turn6.appendChild(makeEl('tr'));
  turn6.appendChild(makeEl('td'));
  turn6.appendChild(makeText('查找', turn6));
  turn6.appendChild(makeEl('td'));
  turn6.appendChild(makeText('把整篇文本拍平成一个字符串再搜', turn6));
  const stored = '环节\t做法\n查找\t把整篇文本拍平成一个字符串再搜';
  const matches = bridge.collectMatches(stored);
  if (matches.length !== 1) fail('a whitespace-only difference must still match, got ' + matches.length);
  if (matches[0].ranges.length < 2) fail('the match must map back to more than one text node');
  if (bridge.highlightQuoteInTurn(6, stored) !== true) fail('the table quote must land: ' + bridge.describeJump());
  const wrapped = turn6.childNodes.filter((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1');
  if (wrapped.length < 2) fail('every mapped segment must be wrapped, got ' + wrapped.length);
  const before6 = turn6.textContent;
  for (const timer of timers) timer();
  timers.length = 0;
  if (turn6.textContent !== before6) fail('the table quote must be restored verbatim');
  ok('a table-rendered quote lands even though the DOM has no separators');
}

// ---------------------------------------------------------------- 2b2. normalisation
// The recorded body is normalised (blank runs collapsed, trailing spaces trimmed) and a
// long quote is clipped with `…`; the transcript holds the raw text. An exact match then
// fails, which used to silently degrade a multi-line quote to "flash the turn".
{
  const turn5 = makeEl('div', { 'data-chat-turn': '5' });
  root.appendChild(turn5);
  // Unique wording on purpose: another case in this suite already put similar text in a
  // different turn, and a shared phrase would be attributed to whichever turn comes first.
  turn5.appendChild(makeText('唯一标记乙\t第二行才存在的独特文字', turn5));
  const stored = '唯一标记甲\t第一行不存在\n唯一标记乙\t第二行才存在的独特文字';
  const cands = bridge.needleCandidates(stored);
  if (cands.length < 2) fail('a multi-line body must offer line-level fallbacks, got ' + JSON.stringify(cands));
  if (cands[0] !== stored) fail('the whole body must be tried first');
  if (bridge.needleCandidates('').length !== 0) fail('an empty phrase has no candidates');
  if (bridge.needleCandidates('短').length !== 0) fail('a too-short phrase is not a usable needle');
  const clipped = '唯一标记乙\t第二行才存在的独特文字…';
  const clippedCands = bridge.needleCandidates(clipped);
  if (!clippedCands.some((c) => !/…$/.test(c))) fail('a clipped body must offer a marker-free candidate: ' + JSON.stringify(clippedCands));
  if (bridge.highlightQuoteInTurn(5, stored) !== true) {
    fail('a missing first line must still land on the second: ' + bridge.describeJump());
  }
  if (!turn5.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
    fail('the line-level fallback must wrap something');
  }
  const before5 = turn5.textContent;
  for (const timer of timers) timer();
  timers.length = 0;
  if (turn5.textContent !== before5) fail('the fallback wrap must still restore verbatim');
  ok('a normalised or clipped quote still lands, via line-level fallbacks');
}

// ---------------------------------------------------------------- 2c. rollback
// A multi-segment match is wrapped segment by segment. If a later segment cannot be
// wrapped, the earlier ones must be taken back out — a half-highlighted sentence is worse
// than no highlight at all, because it silently misrepresents where the quote came from.
{
  const turn4 = makeEl('div', { 'data-chat-turn': '4' });
  root.appendChild(turn4);
  const head = '▍ 甲部分 ';
  const tail = '乙部分在这里';
  const n1 = turn4.appendChild(makeText(head, turn4));
  const n2 = turn4.appendChild(makeText(tail, turn4));
  n2.__refuseWrap = true;
  const target = '甲部分 乙部分在这里';
  const before4 = turn4.textContent;
  if (bridge.highlightQuoteInTurn(4, target) !== false) fail('a partially wrappable match must not claim success');
  if (turn4.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
    fail('the first segment must be rolled back when a later one fails');
  }
  if (turn4.textContent !== before4) fail('a rolled-back attempt must not alter the text');
  if (bridge.describeJump().indexOf('wrapped=NO') === -1) fail('the diagnostic must report the failure: ' + bridge.describeJump());
  if (n1.parentElement !== turn4) fail('the first text node must still be attached');
  n2.__refuseWrap = false;
  ok('a partially wrappable match rolls back instead of leaving half a highlight');
}

// ---------------------------------------------------------------- 3b. re-render
// The transcript is React-rendered. A re-render replaces the text node and takes the
// wrapper with it — which looks exactly like "it jumped but never highlighted". The keeper
// interval must re-apply it, and the diagnostic must record that it had to.
{
  if (bridge.highlightQuoteInTurn(2, phrase) !== true) fail('second jump must land: ' + bridge.describeJump());
  const wrapper = turn2.childNodes.find((n) => n.nodeType === 1 && n.getAttribute && n.getAttribute('data-ha-jump') === '1');
  if (!wrapper) fail('the wrapper must exist before simulating a re-render');
  // React re-renders the block from its own model: the wrapper disappears and a fresh text
  // node with the same text takes its place. Simulating that faithfully matters — just
  // deleting the wrapper would also delete the phrase, which is not what happens.
  wrapper.remove();                                    // React unmounts its old subtree
  for (const stale of turn2.childNodes.slice()) stale.parentNode = null;
  turn2.childNodes.length = 0;
  turn2.appendChild(makeText('▍ target ' + phrase + ' end', turn2));
  turn2.refreshText();
  if (turn2.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
    fail('the simulated re-render must drop the wrapper');
  }
  if (turn2.textContent.indexOf(phrase) === -1) fail('the text must come back with the re-render');
  // Only the CURRENT interval: ticking an older jump's keeper would (correctly) refuse and
  // stop, but it would also make this test depend on unrelated earlier cases.
  const keepers = intervals.filter(Boolean);
  if (keepers.length === 0) fail('the highlight must be kept alive against re-renders');
  keepers[keepers.length - 1]();
  // A stale ticker must refuse to touch the current highlight.
  if (keepers.length > 1) {
    const before = turn2.textContent;
    keepers[0]();
    if (turn2.textContent !== before) fail('a stale keeper must not re-wrap the current highlight');
  }
  const re = turn2.childNodes.find((n) => n.nodeType === 1 && n.getAttribute('data-ha-jump') === '1');
  if (!re) fail('the keeper must re-apply the wrapper after a re-render');
  if (bridge.describeJump().indexOf('reapplied=1') === -1) fail('the diagnostic must count re-applications: ' + bridge.describeJump());
  if (turn2.textContent.indexOf(phrase) === -1) fail('the phrase must survive re-wrapping');
  ok('a React re-render that eats the wrapper is detected and repaired');
}

// ---------------------------------------------------------------- 4. misses
if (bridge.highlightQuoteInTurn(99, phrase) !== false) fail('a turn with no match must not claim success');
if (bridge.describeJump().indexOf('hit=-1') === -1) fail('the diagnostic must say why: ' + bridge.describeJump());
if (bridge.highlightQuoteInTurn(2, '') !== false) fail('an empty phrase must not claim success');
if (bridge.describeJump().indexOf('phrase=0c') === -1) fail('an empty phrase must be reported as such');
if (bridge.collectRanges('不存在的文字').length !== 0) fail('a missing phrase yields no ranges');
// The flash has a lifetime, so a wrapper being present is not itself a leak. What must
// never happen is a wrapper surviving the timer (or a failed jump creating one).
for (const timer of timers) timer();
timers.length = 0;
if (turn2.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
  fail('after the flash ends no wrapper may remain');
}
// ---- a failed jump on a FRESH turn must leave the text untouched ----
// Deliberately independent of the earlier cases: turn2 has been wrapped, cleaned up and
// re-rendered several times by now, and re-entrant test calls there say nothing about the
// product. A fresh turn isolates the property that matters: a jump that finds nothing (or
// finds it in another turn) must not alter a single character.
{
  const turn7 = makeEl('div', { 'data-chat-turn': '7' });
  root.appendChild(turn7);
  const fresh = '▍ 独立的一行 仅此一处 不该被改动';
  turn7.appendChild(makeText(fresh, turn7));
  if (bridge.highlightQuoteInTurn(9, '这一段在第九轮里不存在') !== false) fail('a jump with nothing to find must not claim success');
  if (turn7.textContent !== fresh) fail('a failed jump must not touch any turn');
  if (bridge.highlightQuoteInTurn(7, '这一段在第七轮里也不存在') !== false) fail('a phrase missing from the turn must fail');
  if (turn7.textContent !== fresh) fail('a miss inside the right turn must not touch anything');
  ok('a jump that finds nothing leaves the transcript byte-identical');
}

if (bridge.highlightQuoteInTurn(99, phrase) !== false) fail('a turn with no match must not claim success');
if (bridge.describeJump().indexOf('hit=-1') === -1) fail('the diagnostic must say why: ' + bridge.describeJump());
if (bridge.highlightQuoteInTurn(2, '') !== false) fail('an empty phrase must not claim success');
if (bridge.describeJump().indexOf('phrase=0c') === -1) fail('an empty phrase must be reported as such');
if (bridge.collectRanges('不存在的文字').length !== 0) fail('a missing phrase yields no ranges');
// The flash has a lifetime, so a wrapper being present is not itself a leak. What must
// never happen is a wrapper surviving the timer (or a failed jump creating one).
for (const timer of timers) timer();
timers.length = 0;
if (turn2.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
  fail('after the flash ends no wrapper may remain');
}
if (bridge.highlightQuoteInTurn(99, phrase) !== false) fail('sanity: a missing turn still fails');
if (turn2.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
  fail('a jump that found nothing must not paint');
}
ok('a miss is reported, never silently painted');

// ---------------------------------------------------------------- 5. full cycle
// The property above, checked on a CLEAN turn with no test history: wrap it, let the
// keeper repair a simulated re-render, then let the flash expire. The text must come back
// byte-identical — no doubled fragments, no leftovers.
{
  const turn8 = makeEl('div', { 'data-chat-turn': '8' });
  root.appendChild(turn8);
  const original = '▍ cycle 甲 乙丙丁 戊己庚辛';
  const rebuild = () => {
    turn8.childNodes.length = 0;
    turn8.appendChild(makeText(original, turn8));
    turn8.refreshText();
  };
  rebuild();
  const needle = '甲乙丙丁 戊己庚辛';
  if (bridge.highlightQuoteInTurn(8, needle) !== true) fail('the cycle jump must land: ' + bridge.describeJump());
  if (turn8.textContent !== original) fail('wrapping must not change the text: ' + JSON.stringify(turn8.textContent));
  // Simulate React re-rendering the block, then let the keeper repair it.
  turn8.childNodes.forEach((n) => { n.parentNode = null; });
  rebuild();
  const tick = intervals.filter(Boolean).pop();
  if (typeof tick !== 'function') fail('the keeper interval must exist');
  tick();
  if (turn8.textContent !== original) fail('the keeper must not change the text: ' + JSON.stringify(turn8.textContent));
  if (!turn8.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
    fail('the keeper must re-apply the wrapper after a re-render');
  }
  for (const timer of timers) timer();
  timers.length = 0;
  if (turn8.textContent !== original) {
    fail('the full cycle must restore the text exactly, got ' + JSON.stringify(turn8.textContent));
  }
  if (turn8.childNodes.some((n) => n.getAttribute && n.getAttribute('data-ha-jump') === '1')) {
    fail('the full cycle must leave no wrapper');
  }
  ok('wrap → re-render → repair → expire restores the text exactly');
}

console.log('\nHIGHLIGHT CHECKS PASSED');
