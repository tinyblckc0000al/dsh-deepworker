import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

// ---- minimal DOM good enough for the context-menu code ----
function makeEl(tag) {
  return {
    tagName: tag, children: [], style: {}, attributes: {}, textContent: '', type: '',
    onclick: null, parentElement: null, removed: false,
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    remove() { this.removed = true; },
    contains(node) { return node === this || this.children.indexOf(node) >= 0; },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; },
    setAttribute(n, v) { this.attributes[n] = String(v); },
    removeAttribute(n) { delete this.attributes[n]; },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, closest: () => null
  };
}
const body = makeEl('body');
const docEl = makeEl('html');
const doc = {
  body, documentElement: docEl, listeners: {},
  addEventListener(t, fn) { this.listeners[t] = fn; },
  removeEventListener(t) { delete this.listeners[t]; },
  createElement: (tag) => makeEl(tag),
  querySelectorAll: (selector) => (selector === '[data-turn-tail]' ? doc.turnTails : [])
};
doc.turnTails = [];
const win = { innerWidth: 1200, innerHeight: 800 };

let loaded = null;
const windowObj = Object.assign({ __ModuleLoader__: { load: (r) => { loaded = r; } } }, win);
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function(){}, Button: function(){} };
const mockRequire = (id) => id === 'react' ? reactMock : id === 'react/jsx-runtime' ? jsxMock : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock : (() => { throw new Error('unexpected ' + id); })();
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const sandbox = { window: windowObj, setTimeout, clearTimeout, document: doc, localStorage, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

// Mirrors the real translator: it substitutes {placeholders}. A mock that returns the raw
// key hides exactly the interpolation bugs this plugin has had.
const t = (k, params) => {
  let value = ({ 'action.resend': '编辑重发', 'action.retry': '重试本轮', 'action.branch': '在此分支', 'menu.quoteSelection': '引用选中文字', 'menu.saveNote': '存为笔记', 'notes.savedFromSelection': '选中内容已存为笔记', 'notes.stored': '库存 {count} 条', 'notes.selectionEmpty': '没有选中任何内容', 'menu.newInWorkspace': '在此工作区新建引用对话', 'menu.jumpToQuote': '跳到引用出处', 'quote.jumpFailed': '那一轮不在已加载的窗口里', 'quote.selection': '↳ 引自在会话中选中的文字', 'quote.provenance': '↳ 引自本轮第 {turn} 轮', 'quote.clipped': '（引文过长已截断）', 'quote.empty': '没有可引用的内容', 'quote.insertFailed': '引用插入失败', 'quote.noComposer': '当前会话没有可写入的输入框' }[k] ?? k);
  if (params) for (const key of Object.keys(params)) value = value.split('{' + key + '}').join(String(params[key]));
  return value;
};
let registered = null;
const draftCalls = [];
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => t },
  slots: { inject: (n, f) => { f(); }, register: (c) => { if (c.name === 'conversation.chat.turnTail') registered = c; } },
  sessions: { create: async () => 'x', fork: async () => 'y' },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: { openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' }, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '' },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
};
exportsObj.apply(ctx);
const bridge = exportsObj.__test;
if (!bridge || !Array.isArray(bridge.menuListeners)) fail('test seam missing');

// the component would set these; emulate a mounted component for session 'sess-1'
bridge.activeComposer.sessionId = 'sess-1';
// Quoting inserts; it must never replace. The mock mirrors the real action contract:
// a mandatory span with a matching draftRev, and a setDraft that the plugin must not use.
bridge.activeComposer.actions = {
  captureInsertion: () => ({ start: 5, end: 5, draftRev: 1 }),
  insertText: (text, span) => {
    if (!span || span.draftRev !== 1) return false;
    draftCalls.push(text);
    return true;
  },
  setDraft: () => { draftCalls.push('SETDRAFT-MUST-NOT-BE-USED'); }
};
const requests = [];
bridge.menuListeners.push((req) => requests.push(req));

function userNode(turn) {
  const el = makeEl('div');
  el.attributes['data-chat-flow-kind'] = 'user';
  el.attributes['data-chat-turn'] = String(turn);
  el.parentElement = body;
  return el;
}
function fireOn(target) {
  let prevented = false;
  doc.listeners.contextmenu({ target: target, clientX: 40, clientY: 60, preventDefault: () => { prevented = true; } });
  return prevented;
}

// ---- case 1: right-click one of MY messages ----
const prevented = fireOn(userNode(0));
if (!prevented) fail('user-message right-click did not preventDefault');
if (body.children.length !== 1) fail('menu not appended (children=' + body.children.length + ')');
const menu = body.children[0];
const labels = menu.children.map((b) => b.textContent);
console.log('user-message menu ->', JSON.stringify(labels));
// No selection: edit/retry only. Branch is a turn action, not a user-message action.
if (labels.length !== 2) fail('the user-message menu must offer 2 items without a selection, got ' + labels.length);
if (labels[0] !== '编辑重发' || labels[1] !== '重试本轮') fail('menu labels wrong: ' + JSON.stringify(labels));

// pick "编辑重发"
menu.children[0].onclick();
console.log('published request ->', JSON.stringify(requests[0]));
if (requests.length !== 1) fail('menu pick did not publish a request');
const req = requests[0];
if (req.sessionId !== 'sess-1' || req.turn !== 0 || req.kind !== 'edit') fail('request wrong: ' + JSON.stringify(req));
if (!menu.removed) fail('menu was not closed after the pick');

// ---- case 2: no branch in the user-message menu ----
body.children.length = 0;
requests.length = 0;
fireOn(userNode(3));
const turnThreeLabels = body.children[0].children.map((b) => b.textContent);
console.log('turn-3 menu ->', JSON.stringify(turnThreeLabels));
if (turnThreeLabels.length !== 2) fail('a turn > 1 without a selection must offer the SAME 2 items, got ' + JSON.stringify(turnThreeLabels));

// ---- case 3: quoting the user's own message with a selection ----
body.children.length = 0;
requests.length = 0;
sandbox.window.getSelection = () => ({ toString: () => '选中的文字' });
win.getSelection = sandbox.window.getSelection;
fireOn(userNode(1));
if (body.children[0].children.length !== 4) fail('a selection must add quote + save-note, got ' + body.children[0].children.length);
body.children[0].children[2].onclick();
if (requests[0].kind !== 'quote' || requests[0].turn !== 1) fail('quote request wrong: ' + JSON.stringify(requests[0]));
console.log('quote on turn 1 ->', JSON.stringify(requests[0]));
sandbox.window.getSelection = () => ({ toString: () => '' });
win.getSelection = sandbox.window.getSelection;

// ---- case 4: an assistant node with a selection still quotes the selection ----
body.children.length = 0;
requests.length = 0;
draftCalls.length = 0;
const assistantEl = makeEl('div');
assistantEl.attributes['data-chat-flow-kind'] = 'assistant-step';
assistantEl.attributes['data-chat-turn'] = '2';
assistantEl.parentElement = body;
win.getSelection = () => ({ toString: () => '选中的一段' });
const savedGetSelection = sandbox.window.getSelection;
sandbox.window.getSelection = () => ({ toString: () => '选中的一段' });
fireOn(assistantEl);
if (body.children.length !== 1) fail('assistant selection menu not shown');
if (body.children[0].children.length !== 2) fail('assistant menu should offer the quote item and 「存为笔记」, got ' + body.children[0].children.length);
if (body.children[0].children[1].textContent !== '存为笔记') fail('assistant menu is missing the save-note item: ' + body.children[0].children[1].textContent);
body.children[0].children[0].onclick();
console.log('assistant selection quote ->', JSON.stringify(draftCalls[0]));
if (!draftCalls[0] || draftCalls[0].indexOf('▍ 选中的一段') === -1) fail('selection quote missing its bar: ' + JSON.stringify(draftCalls[0]));
// It must also carry the provenance marker, and a leading newline so it never glues
// onto text the user already typed.
// The selection sits inside a flow node that carries data-chat-turn, so the marker must
// name the turn — the same, jumpable wording the turn-row quote button uses.
if (!/引自本轮第 \d+ 轮/.test(draftCalls[0])) fail('a selection inside a turn must name the turn: ' + JSON.stringify(draftCalls[0]));
if (!/▍ ↳ 引自本轮第 \d+ 轮/.test(draftCalls[0])) fail('the provenance line must sit inside the bar too: ' + JSON.stringify(draftCalls[0]));
if (draftCalls[0].charAt(0) !== '\n') fail('a quote must start on its own line');
if (requests.length !== 0) fail('assistant selection must not publish a turn request');

// 同一个菜单里的「存为笔记」必须真的落盘（不是只画了一颗按钮）。
{
  const before = JSON.parse(localStorage.getItem('dsh.deepworker.notes') || '[]');
  body.children[0].children[1].onclick();
  const after = JSON.parse(localStorage.getItem('dsh.deepworker.notes') || '[]');
  if (after.length !== before.length + 1) fail('assistant selection save-note did not persist exactly one note');
  else if (after[after.length - 1].text !== '选中的一段') fail('save-note stored the wrong text: ' + JSON.stringify(after[after.length - 1]));
  else console.log('assistant selection save-note -> ok');
}

// ---- case 5: retry from the menu ----
body.children.length = 0;
requests.length = 0;
fireOn(userNode(2));
body.children[0].children[1].onclick();
if (requests[0].kind !== 'retry' || requests[0].turn !== 2) fail('retry request wrong: ' + JSON.stringify(requests[0]));
console.log('retry on turn 2 ->', JSON.stringify(requests[0]));

// ---- case 6: right-click a WORKSPACE row in the sidebar ----
body.children.length = 0;
requests.length = 0;
const workspaceRow = makeEl('div');
workspaceRow.attributes['data-row-key'] = 'workspace:ws-b';
workspaceRow.parentElement = body;
const rowTarget = makeEl('span');
rowTarget.parentElement = workspaceRow;
const wsEv = fireOn(rowTarget);
if (!wsEv) fail('workspace-row right-click did not preventDefault');
if (body.children.length !== 1) fail('workspace menu not shown');
const wsLabels = body.children[0].children.map((b) => b.textContent);
console.log('workspace menu ->', JSON.stringify(wsLabels));
if (wsLabels.length !== 1 || wsLabels[0] !== '在此工作区新建引用对话') fail('workspace menu labels wrong: ' + JSON.stringify(wsLabels));
body.children[0].children[0].onclick();
console.log('workspace request ->', JSON.stringify(requests[0]));
const wsReq = requests[0];
if (wsReq.kind !== 'newModeInWorkspace' || wsReq.workspaceId !== 'ws-b' || wsReq.sessionId !== 'sess-1' || wsReq.claimed !== false) {
  fail('workspace request wrong: ' + JSON.stringify(wsReq));
}

// ---- round trip: what the component records is what the menu resolves ----
bridge.rememberQuote({ sessionId: 'sess-1', turn: 7, seq: 12, marker: '↳ 引自本轮第 7 轮', at: 1 });
const rt = bridge.findQuoteInText('sess-1', '> x\n\n↳ 引自本轮第 7 轮\n要');
console.log('round trip ->', JSON.stringify(rt && { turn: rt.turn, seq: rt.seq }));
if (!rt || rt.turn !== 7 || rt.seq !== 12) fail('record -> find round trip failed');
// "本轮第 7 轮" means THIS conversation's turn 7, so a text anchor legitimately resolves
// here. What must never happen is borrowing the OTHER session's record (its seq, body).
const crossMenu = bridge.findQuoteInText('sess-OTHER', '> x\n\n↳ 引自本轮第 7 轮');
if (crossMenu !== null && crossMenu.fromText !== true) fail("another session's record must not leak");
if (crossMenu !== null && crossMenu.seq !== undefined) fail("a text anchor must not borrow another session's seq");

// ---- every entry point must use the SHARED jump ----
// The chip path landed on the quoted sentence; the context-menu path only scrolled to the
// turn, so "jumped but no highlight" depended on which entry the user took.
{
  const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  if (!/function jumpToQuote\(/.test(code)) fail('the shared jump helper is missing');
  const menuJump = code.match(/makeItem\(t\("menu\.jumpToQuote"\), function \(\) \{[\s\S]{0,200}?\}\)/);
  if (!menuJump) fail('the jump menu item was not found');
  if (!/jumpToQuote\(/.test(menuJump[0])) fail('the context-menu jump must use the shared helper, not scrollToTurn alone');
  if (/scrollToTurn\(/.test(menuJump[0])) fail('the context-menu jump must not scroll without landing');
}

// ---- the jump must not depend on the CSS Custom Highlight API ----
// That API can be present and still paint nothing (its `::highlight()` rule supports only
// a few properties, and it can be unavailable). It failed silently twice; the jump now
// finds ranges without it and paints by wrapping the text.
{
  const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const fn = code.match(/function highlightQuoteInTurn\([\s\S]*?\n    \}/);
  if (!fn) fail('highlightQuoteInTurn was not found');
  if (/highlightMatches\(/.test(fn[0])) fail('the jump must not go through the CSS Custom Highlight API');
  if (!/collectMatches\(/.test(fn[0])) fail('the jump must collect matches without any API');
  if (!/wrapMatch\(/.test(fn[0])) fail('the jump must paint by wrapping the text');
  // Presence of the name is not enough: the ASSIGNMENT is what arms the cleanup, and the
  // timer callback is what runs it. Assert both, or a mutation that drops one slips through.
  if (!/jumpCleanup = wrapped/.test(fn[0])) fail('the wrapper must be remembered so it can be removed');
  // Anchor on the timeout constant: a character budget truncates as soon as the callback
  // grows, which is a brittle assertion rather than a strict one.
  const flashTimer = fn[0].match(/setTimeout\(function \(\) \{[\s\S]*?\}, JUMP_HIGHLIGHT_MS\)/);
  if (!flashTimer) fail('the flash must end on a timer');
  if (!/jumpCleanup/.test(flashTimer[0])) fail('the flash timer must remove the wrapper');
  if (!/clearInterval/.test(flashTimer[0])) fail('the flash timer must also stop the keeper');
  if (!/function wrapRange\(/.test(code)) fail('wrapRange is missing');
  if (!/function wrapMatch\(/.test(code)) fail('wrapMatch is missing (multi-segment wrapping)');
  const wrap = code.match(/function wrapRange\([\s\S]*?\n    \}/);
  if (!/data-ha-jump/.test(wrap[0])) fail('the wrapper must be marked so it can be found and removed');
  if (!/replaceChild/.test(wrap[0])) fail('the wrapper must restore the original text node');
  if (!/scrollIntoView/.test(fn[0])) fail('the jump must scroll the phrase itself, not the turn boundary');
  if (/data-turn-tail/.test(fn[0])) fail('the jump must not target the turn TAIL (that is the end of the turn)');
}
if (bridge.findQuoteInText('sess-1', '没有出处标记的消息') !== null) fail('must not match a message without the marker');

// ---- a message that quotes an earlier turn offers a provenance jump ----
body.children.length = 0;
requests.length = 0;
const marker = '↳ 引自本轮第 3 轮';
store.set('dsh.deepworker.quotes', JSON.stringify([
  { sessionId: 'sess-1', turn: 3, seq: 99, marker: marker, at: 1 }
]));
// 选区不能泄漏到下一次右键：真实用户点走之后选区会被清空，假窗口不会。
win.getSelection = () => ({ toString: () => '' });
sandbox.window.getSelection = () => ({ toString: () => '' });
const tail = makeEl('div');
tail.attributes['data-turn-tail'] = '3';
let scrolled = 0;
tail.scrollIntoView = () => { scrolled++; };
doc.turnTails = [tail];
const quotedRow = makeEl('div');
quotedRow.attributes['data-chat-flow-kind'] = 'user';
quotedRow.attributes['data-chat-turn'] = '4';
quotedRow.parentElement = body;
quotedRow.textContent = '> 要我加吗\n\n' + marker + '\n要';
const quotedChip = makeEl('span');
quotedChip.parentElement = quotedRow;
fireOn(quotedChip);
const quotedLabels = body.children[0].children.map((b) => b.textContent);
console.log('quoted-message menu ->', JSON.stringify(quotedLabels));
if (quotedLabels.length !== 3) fail('expected edit/retry/jump without a selection, got ' + quotedLabels.length);
if (quotedLabels[2] !== '跳到引用出处') fail('jump item label wrong: ' + quotedLabels[2]);
body.children[0].children[2].onclick();
console.log('jump -> scrollIntoView calls =', scrolled);
if (scrolled !== 1) fail('jump did not scroll the quoted turn into view');

// a message WITHOUT the marker offers no jump item
body.children.length = 0;
const plainRow = makeEl('div');
plainRow.attributes['data-chat-flow-kind'] = 'user';
plainRow.attributes['data-chat-turn'] = '5';
plainRow.parentElement = body;
plainRow.textContent = '普通消息';
const plainChip = makeEl('span');
plainChip.parentElement = plainRow;
fireOn(plainChip);
if (body.children[0].children.length !== 2) fail('unquoted message must not offer the jump');

// ---- the ungrouped bucket (key "") offers nothing ----
body.children.length = 0;
requests.length = 0;
const ungroupedRow = makeEl('div');
ungroupedRow.attributes['data-row-key'] = 'workspace:';
ungroupedRow.parentElement = body;
const ugTarget = makeEl('span');
ugTarget.parentElement = ungroupedRow;
fireOn(ugTarget);
if (body.children.length !== 0) fail('ungrouped bucket must not offer the action');
console.log('ungrouped bucket -> no menu (ok)');

// ---- a selection quote names the SAME precise anchor the turn-row button does ----
// The DOM carries no seq attribute, so the seq comes from the outline projection. Without
// it the menu path would say only "本轮第 N 轮", which goes stale once a conversation is
// compacted or forked.
{
  body.children.length = 0;
  const before = draftCalls.length;
  bridge.latestOutline.sessionId = 'sess-1';
  bridge.latestOutline.entries = [{ turn: 2, seq: 202, prompt: 'x', response: 'y' }];
  const node = makeEl('div');
  node.attributes['data-chat-flow-kind'] = 'assistant-step';
  node.attributes['data-chat-turn'] = '2';
  node.parentElement = body;
  win.getSelection = () => ({ toString: () => '选中的一段' });
  sandbox.window.getSelection = () => ({ toString: () => '选中的一段' });
  fireOn(node);
  if (body.children.length === 0) fail('the selection context menu did not open');
  const menu = body.children[0];
  if (menu.children.length !== 2) fail('an assistant selection offers quote + 「存为笔记」, got ' + menu.children.length);
  if (menu.children[1].textContent !== '存为笔记') fail('the second assistant-selection item is not 「存为笔记」: ' + menu.children[1].textContent);
  menu.children[0].onclick();
  const written = draftCalls.slice(before).join(' | ');
  if (written === '') fail('the quote item wrote nothing — test setup is wrong');
  if (written.indexOf('引自本轮第 2 轮') === -1) fail('the quote must name the turn: ' + JSON.stringify(written));
  if (written.indexOf('seq 202') === -1) fail('the quote must carry the outline seq: ' + JSON.stringify(written));
  bridge.latestOutline.sessionId = null;
  bridge.latestOutline.entries = [];
}

// ---- a menu command that throws must say so ----
//
// The bridge used to swallow a listener's exception with no trace: the menu closed and
// nothing happened. This plugin has hit that exact shape (a factory-scope handler calling
// into apply scope), so the failure has to be visible.
{
  const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const fn = code.match(/function publishMenuRequest\([\s\S]*?\n    \}/);
  if (!fn) fail('publishMenuRequest was not found');
  const catchBlock = fn[0].match(/catch \(e\) \{[\s\S]*?\}/);
  if (!catchBlock) fail('the listener guard was not found');
  if (!/showNotice/.test(catchBlock[0])) fail('a throwing listener must be reported, not swallowed');
  if (!/menu\.listenerFailed/.test(code)) fail('the notice key for a broken listener is missing');
  console.log('  ok   a menu listener that throws is reported instead of silently killing the menu');
}

console.log('\nCONTEXT-MENU CHECKS PASSED');
