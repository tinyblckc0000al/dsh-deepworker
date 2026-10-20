import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

function makeEl(tag) {
  return {
    tagName: tag, children: [], style: {}, attributes: {}, textContent: '',
    parentElement: null, removed: false,
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    remove() { this.removed = true; },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); },
    setAttribute(n, v) { this.attributes[n] = v; },
    removeAttribute(n) { delete this.attributes[n]; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
  };
}
const body = makeEl('body');
const head = makeEl('head');
const docEl = makeEl('html');
const doc = {
  body, head, documentElement: docEl, listeners: {},
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
  createElement: (tag) => makeEl(tag)
};
const windowObj = { __ModuleLoader__: {}, innerWidth: 1200, innerHeight: 800 };

let loaded = null;
windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function(){}, Button: function(){} };
const mockRequire = (id) => id === 'react' ? reactMock : id === 'react/jsx-runtime' ? jsxMock : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock : (() => { throw new Error('unexpected ' + id); })();
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const sandbox = { window: windowObj, document: doc, localStorage, require: mockRequire, TextEncoder, btoa, atob, TextDecoder, setTimeout, clearTimeout, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

// turn 0 carries a hidden session-reference context node right after the user message
const referenceNode = { kind: 'context', data: { source: { kind: 'session-reference', form: 'recall', version: 1, references: [
  { sessionId: 'sess-source-1', label: '之前的对话', inputIndex: 0 },
  { sessionId: 'sess-other-9', label: '另一个会话', inputIndex: 1 }
] } } };
const userNode = { kind: 'user', data: { content: [{ type: 'text', text: '@之前的对话\n\n我现在改好了工作区' }] } };
const snapshots = {
  'sess-1': {
    locations: { getTurn: (n) => (n === 0 ? ['k-user', 'k-ctx'] : n === 5 ? ['k-only'] : []) },
    nodes: {
      get: (k) => (k === 'k-user' ? userNode : k === 'k-ctx' ? referenceNode : k === 'k-only' ? userNode : undefined),
      values: () => [userNode, referenceNode]
    }
  }
};
const opened = [];
let registered = null;
const dict = { 'ref.noSession': '找不到当前会话，无法定位引用', 'ref.notFound': '找不到这条引用的原始会话记录' };
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => dict[k] ?? k },
  slots: { inject: (n, f) => { f(); }, register: (c) => { if (c.name === 'conversation.chat.turnTail') registered = c; } },
  sessions: { create: async () => 'x', fork: async () => 'y' },
  uiConversation: { binding: (id) => ({ target: () => ({ getSnapshot: () => snapshots[id] }) }) },
  uiWorkspace: { openSession: (id) => opened.push(id), archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' }, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '' },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
};
exportsObj.apply(ctx);
exportsObj.__test.activeComposer.sessionId = 'sess-1';

// style tag injected for affordance
const styleTag = head.children.find((el) => el.tagName === 'style' && /data-ref-chip/.test(el.textContent));
if (!styleTag) fail('cursor style tag not injected');
if (!/data-ref-chip="session"/.test(styleTag.textContent)) fail('cursor rule does not target session chips');
console.log('affordance css ->', styleTag.textContent);

function turnWrapper(turn) {
  const w = makeEl('div');
  w.attributes['data-chat-turn'] = String(turn);
  w.parentElement = body;
  return w;
}
function chipIn(wrapper, title) {
  const bubble = makeEl('div');
  const chip = makeEl('span');
  chip.attributes['data-ref-chip'] = 'session';
  chip.attributes['title'] = title;
  bubble.parentElement = wrapper;
  chip.parentElement = bubble;
  return chip;
}
function click(target) {
  const ev = { target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  const handlers = doc.listeners['click'] || [];
  if (handlers.length === 0) fail('no click listener registered');
  for (const fn of handlers) fn(ev);
  return ev;
}

// ---- jump to the referenced session ----
const ev = click(chipIn(turnWrapper(0), '@之前的对话'));
console.log('opened ->', JSON.stringify(opened), 'prevented ->', ev.defaultPrevented);
if (opened.length !== 1 || opened[0] !== 'sess-source-1') fail('did not open the referenced session: ' + JSON.stringify(opened));
if (!ev.defaultPrevented || !ev.stopped) fail('click was not claimed');

// ---- a different label picks its own reference ----
opened.length = 0;
click(chipIn(turnWrapper(0), '@另一个会话'));
if (opened[0] !== 'sess-other-9') fail('label match failed: ' + JSON.stringify(opened));

// ---- a chip whose wrapper carries NO data-chat-turn still resolves ----
opened.length = 0;
const bareChip = makeEl('span');
bareChip.attributes['data-ref-chip'] = 'session';
bareChip.attributes['title'] = '@之前的对话';
bareChip.parentElement = body;   // no [data-chat-turn] ancestor at all
click(bareChip);
console.log('no data-chat-turn ->', JSON.stringify(opened));
if (opened.length !== 1 || opened[0] !== 'sess-source-1') fail('window-wide fallback failed: ' + JSON.stringify(opened));

// ---- a window with no reference record at all does nothing (and says so) ----
snapshots['sess-noref'] = {
  locations: { getTurn: () => ['k-user'] },
  nodes: { get: (k) => (k === 'k-user' ? userNode : undefined), values: () => [userNode] }
};
ctx.uiWorkspace.mainReference = { sessionId: 'sess-noref' };
body.children.length = 0;
opened.length = 0;
const e2 = click(chipIn(turnWrapper(0), '@之前的对话'));
if (opened.length !== 0) fail('opened a session although the window has no reference record');
if (e2.defaultPrevented) fail('unresolvable chip must not claim the click');
const notice2 = body.children.find((el) => el.hasAttribute && el.hasAttribute('data-history-actions-notice'));
if (!notice2) fail('unresolvable chip must explain itself');
console.log('unresolvable window -> no navigation, notice shown (ok)');
ctx.uiWorkspace.mainReference = { sessionId: 'sess-1' };

// ---- a file/skill chip is left alone ----
opened.length = 0;
const wrapper = turnWrapper(0);
const otherChip = makeEl('span');
otherChip.attributes['data-ref-chip'] = 'file';
otherChip.attributes['title'] = '@/tmp/x.txt';
otherChip.parentElement = wrapper;
click(otherChip);
if (opened.length !== 0) fail('file chip must not be handled');

// ---- an unknown active session does nothing (and says why) ----
opened.length = 0;
body.children.length = 0;
ctx.uiWorkspace.mainReference = { sessionId: 'sess-does-not-exist' };
exportsObj.__test.activeComposer.sessionId = null;
click(chipIn(turnWrapper(0), '@之前的对话'));
if (opened.length !== 0) fail('unknown active session must not navigate');
ctx.uiWorkspace.mainReference = { sessionId: 'sess-1' };
exportsObj.__test.activeComposer.sessionId = 'sess-1';

// ---- a chip whose title still carries the wire URI resolves without the log ----
opened.length = 0;
exportsObj.__test.activeComposer.sessionId = 'sess-1';
ctx.uiWorkspace.mainReference = { sessionId: 'nonexistent-session' }; // snapshot lookup would fail
const uriChip = chipIn(turnWrapper(9), '@[之前的对话](dsh-session:' + Buffer.from(JSON.stringify('sess-direct-7'), 'utf8').toString('base64url') + ')');
const e3 = click(uriChip);
console.log('wire-uri chip ->', JSON.stringify(opened));
if (opened.length !== 1 || opened[0] !== 'sess-direct-7') fail('wire URI in the title did not resolve: ' + JSON.stringify(opened));
if (!e3.defaultPrevented) fail('wire-uri click was not claimed');
ctx.uiWorkspace.mainReference = { sessionId: 'sess-1' };

// ---- a dead chip must SAY why instead of doing nothing ----
body.children.length = 0;
opened.length = 0;
exportsObj.__test.activeComposer.sessionId = 'sess-1';
ctx.uiWorkspace.mainReference = { sessionId: 'sess-unknown' };
const e4 = click(chipIn(turnWrapper(0), '@之前的对话'));
const notice = body.children.find((el) => el.getAttribute && el.hasAttribute && el.hasAttribute('data-history-actions-notice'));
if (!notice) fail('unresolvable chip showed no notice');
console.log('failure notice ->', JSON.stringify(notice.textContent));
if (!/找不到/.test(notice.textContent)) fail('failure notice is not the localized reason: ' + notice.textContent);
if (opened.length !== 0) fail('unresolvable chip must not navigate');
ctx.uiWorkspace.mainReference = { sessionId: 'sess-1' };

// ---- the branch-link table is the last resort when the log has no record ----
const face = registered.inject('sess-source-1');
await face.createWithMode('sess-source-1', 'ptc', '', 'hi');
const links = JSON.parse(store.get('dsh.deepworker.mode-links') || '{}');
console.log('recorded branch links ->', JSON.stringify(links));
if (links['x'] !== 'sess-source-1') fail('createWithMode did not record the branch link');
snapshots['x'] = { locations: { getTurn: () => [] }, nodes: { get: () => undefined, values: () => [] } };
ctx.uiWorkspace.mainReference = { sessionId: 'x' };
body.children.length = 0;
opened.length = 0;
click(chipIn(turnWrapper(0), '@之前的对话'));
console.log('link-table fallback ->', JSON.stringify(opened));
if (opened.length !== 1 || opened[0] !== 'sess-source-1') fail('link-table fallback failed: ' + JSON.stringify(opened));
ctx.uiWorkspace.mainReference = { sessionId: 'sess-1' };

console.log('\nSESSION-REFERENCE CLICK CHECKS PASSED');
