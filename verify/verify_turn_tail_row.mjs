// verify_turn_tail_row.mjs — 2026-10-17 第 1 段：「回退到此」按用户要求**删除**（不是死代码，
// 它连着 fork、右键菜单与一个 planner，所以必须逐处删、并证明"没连带删掉别的"）。
//
// 用户原话是「不要影响这些功能的正常使用」⇒ 这个套件不靠 grep 交差，它**真的把那排按钮渲染出来**：
//   ① 行为级：turn > 1 时轮末恰好 **4 颗**按钮、**顺序固定**、**每一颗都带 onClick**。
//      「编辑重发」已移到用户气泡下面（原生定位按钮），不再属于这排。
//      （删除前 turn > 1 是 6 颗，第一颗就是「回退到此」⇒ 5 是"真的少了那一颗"的证据。）
//   ② 行为级：点「在此分支」**真的走到 fork** —— 走真实 inject 接缝 → doFork → ctx.sessions.fork，
//      计数必须恰好 1。这是"fork 没被连带删掉"的证据（用户特意点了这一条）。
//   ③ 扫描式：两个词典（**运行时 register 进去的那两份**，不是源码里手抄的）都没有 action.rollback；
//      源码里 onRollback / rollbackPlan / 回退到此 / Roll back here / ask("rollback") 零命中。
//   ④ 扫描式（防误删）：forkBefore / doFork / action.branch / action.resend / action.retry
//      与另外四个 handler 必须仍在。
//
// 每条断言都做过变异（把坏写法重新做出来，确认这里会红）：verify_turn_tail_row_mutations.mjs。
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);

/** 那排按钮的固定文案与固定顺序 —— 用户逐字点名的那 5 个。 */
const EXPECTED_ROW = ['引用回复', '重试本轮', '在此分支', '选模式新建'];

// ── 沙箱：只做"装得下工厂 + 能渲染组件"的最小 mock（与 verify_menu.mjs 同形）─────────────
let loaded = null;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const win = { __ModuleLoader__: { load: (r) => { loaded = r; } }, innerWidth: 1200, innerHeight: 800 };
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const doc = {
  body: { appendChild() {}, removeChild() {} }, documentElement: {},
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  querySelectorAll: () => [], querySelector: () => null
};
// 组件只用到这四个 react API（bundle 里 grep 计数：useState 54 / useEffect 8 / useRef 3 / memo 1）。
const react = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxrt = { jsx, jsxs: jsx, Fragment: 'Fragment' };
const primitives = { Modal: function () {}, Button: function () {} };
const mockRequire = (id) => id === 'react' ? react
  : id === 'react/jsx-runtime' ? jsxrt
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives
  : (() => { throw new Error('unexpected ' + id); })();
const sandbox = { window: win, setTimeout, clearTimeout, document: doc, localStorage, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

const t = (k, params) => {
  let value = ({
    'action.retry': '重试本轮', 'action.branch': '在此分支', 'action.resend': '编辑重发',
    'action.quote': '引用回复', 'action.newMode': '选模式新建',
    'feature.nameTurnActions': '会话操作', 'feature.disabled': '「{name}」已移除'
  }[k] ?? k);
  if (params) for (const key of Object.keys(params)) value = value.split('{' + key + '}').join(String(params[key]));
  return value;
};

// ── 夹具：真的 apply() 一次，抓 (a) 运行时词典 (b) 槽描述符 (c) fork 调用 ────────────────
let dicts = null;
let registered = null;
const forkCalls = [];
const openedSessions = [];
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: (ns, pairs) => { dicts = pairs; return () => {}; }, bind: () => t },
  slots: {
    inject: (name, fn) => { fn(); },
    register: (desc, comp) => {
      if (desc && desc.name === 'conversation.chat.turnTail') registered = { desc, comp };
      return () => {};
    }
  },
  sessions: {
    create: async () => 'created',
    fork: async (arg) => { forkCalls.push(arg); return 'child-1'; }
  },
  shortcuts: { register: () => function () {} },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: (id) => { openedSessions.push(id); },
    archiveSession: async () => {},
    mainReference: { sessionId: 'sess-1' },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    pickDirectory: async () => ''
  },
  remote: {
    session: { prompt: async () => ({ ok: true }), cancel: async () => ({ ok: true }), page: async () => ({ ok: false }) },
    agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
    workspace: { create: async () => ({ ok: true }) }
  }
};
exportsObj.apply(ctx);

if (!dicts || !dicts.zh || !dicts.en) {
  fail('the dictionaries were never registered (locale.register)');
} else {
  ok('apply() registered both dictionaries: zh ' + Object.keys(dicts.zh).length + ' / en ' + Object.keys(dicts.en).length + ' keys');
}
if (!registered) {
  fail('the turn-tail slot (conversation.chat.turnTail) was never registered');
  console.error('\nTURN-TAIL ROW CHECKS FAILED');
  process.exit(1);
}

/** 经**真实 inject 接缝**拿到 props（forkBefore/forkAt 是 apply 自己绑的，不是测试自造的）。 */
function wiredProps(turnRecord, seq) {
  const fromSlot = registered.desc.inject('sess-1');
  return Object.assign({}, fromSlot, {
    turn: turnRecord,
    seq: seq,
    t: t,
    useProjection: () => [{ turn: turnRecord.turn, seq: turnRecord.start.seq, prompt: 'hi' }],
    inputActions: { setDraft: () => {} },
    userText: () => 'ORIGINAL MESSAGE'
  });
}

/** 渲染一次，返回 { row, buttons }（buttons 是那排里的按钮元素，顺序 = 渲染顺序）。 */
function renderRow(props) {
  const tree = registered.comp(props);
  const rows = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    const style = node.props && node.props.style;
    // rowStyle 是 factory 作用域里的同一个常量对象（height/minHeight/maxHeight 都钉在 22px）。
    if (node.type === 'div' && style && style.height === '22px' && style.maxHeight === '22px' && style.flexWrap === 'nowrap') {
      rows.push(node);
      return;
    }
    if (node.props && node.props.children !== undefined) walk(node.props.children);
  })(tree);
  if (rows.length !== 1) fail('expected exactly ONE action row in the render, got ' + rows.length);
  const row = rows[0];
  const children = row && row.props && row.props.children;
  const list = Array.isArray(children) ? children : [children];
  const buttons = list.filter((item) => item && item.type === 'button');
  return { row, buttons };
}

const waitTicks = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── ① 行为级：turn > 1 恰好 4 颗、顺序固定、每颗都带 onClick ─────────────────────────────
{
  const props = wiredProps({ turn: 3, status: 'closed', start: { seq: 5 }, end: { seq: 10 } }, 10);
  const { buttons } = renderRow(props);
  const labels = buttons.map((b) => (typeof b.props.children === 'string' ? b.props.children : '<非文本>'));
  console.log('  turn=3 row ->', JSON.stringify(labels));
  if (buttons.length !== 4) {
    fail('a turn > 1 must render exactly 4 action buttons, got ' + buttons.length + ' ' + JSON.stringify(labels));
  }
  if (labels.join('|') !== EXPECTED_ROW.join('|')) {
    fail('the row must be exactly [' + EXPECTED_ROW.join(' / ') + '] in this order, got ' + JSON.stringify(labels));
  }
  const withoutOnClick = buttons.filter((b) => typeof b.props.onClick !== 'function');
  if (withoutOnClick.length > 0) {
    fail(withoutOnClick.length + ' button(s) have NO onClick (they would look alive and do nothing): '
      + JSON.stringify(withoutOnClick.map((b) => b.props.children)));
  }
  if (buttons.length === 4 && labels.join('|') === EXPECTED_ROW.join('|') && withoutOnClick.length === 0) {
    ok('turn > 1 -> exactly 4 buttons, fixed order, every one has onClick');
  }
}

// ── ①b 行为级：第一轮也是同一组 4 颗 ──
{
  for (const turnNumber of [0, 1]) {
    const { buttons } = renderRow(wiredProps({ turn: turnNumber, status: 'closed', start: { seq: 5 }, end: { seq: 10 } }, 10));
    const labels = buttons.map((b) => (typeof b.props.children === 'string' ? b.props.children : '<非文本>'));
    if (labels.join('|') !== EXPECTED_ROW.join('|')) {
      fail('turn ' + turnNumber + ' must render the SAME 4 buttons in the same order, got ' + JSON.stringify(labels));
    }
  }
  ok('turn 0 / turn 1 -> the same 4 buttons (the row no longer varies with the turn number)');
}

// ── ② 行为级：「在此分支」真的走 fork（真实 inject 接缝 → doFork → ctx.sessions.fork）─────
await (async () => {
  forkCalls.length = 0;
  openedSessions.length = 0;
  const { buttons } = renderRow(wiredProps({ turn: 3, status: 'closed', start: { seq: 5 }, end: { seq: 10 } }, 10));
  const branch = buttons.find((b) => b.props.children === '在此分支');
  if (!branch) {
    fail('the row must still contain 在此分支, got ' + JSON.stringify(buttons.map((b) => b.props.children)));
    return;
  }
  if (typeof branch.props.onClick !== 'function') {
    fail('「在此分支」 has no onClick, so it cannot be clicked at all');
    return;
  }
  branch.props.onClick();
  await waitTicks(20);
  console.log('  branch click -> ctx.sessions.fork calls =', forkCalls.length, JSON.stringify(forkCalls));
  if (forkCalls.length !== 1) {
    fail('「在此分支」 must call ctx.sessions.fork exactly ONCE, got ' + forkCalls.length);
    return;
  }
  const call = forkCalls[0];
  if (!call || call.sessionId !== 'sess-1' || call.atSeq !== 10) {
    fail('the fork must be addressed to this session at the turn end (atSeq=10), got ' + JSON.stringify(call));
    return;
  }
  if (openedSessions.length !== 1 || openedSessions[0] !== 'child-1') {
    fail('the child session must be opened after the fork, got ' + JSON.stringify(openedSessions));
    return;
  }
  ok('「在此分支」 -> ctx.sessions.fork x1 ({sessionId, atSeq:10}) + openSession(child-1)');
})();

// ── ③ 扫描式：本功能必须彻底消失（词典 + 源码）──────────────────────────────────────────
{
  const needles = ['action.rollback', 'onRollback', '回退到此', 'Roll back here', 'rollbackPlan', 'ask("rollback")'];
  const hits = needles.filter((needle) => code.includes(needle));
  if (hits.length > 0) fail('the deleted feature still appears in the bundle: ' + JSON.stringify(hits));
  else ok('source scan -> zero hits for ' + JSON.stringify(needles));

  const dictHits = [];
  for (const [name, dict] of [['zh', dicts.zh], ['en', dicts.en]]) {
    if (Object.prototype.hasOwnProperty.call(dict, 'action.rollback')) dictHits.push(name + '.action.rollback');
  }
  if (dictHits.length > 0) fail('the registered dictionaries still define the key: ' + JSON.stringify(dictHits));
  else ok('both registered dictionaries (zh + en) are free of action.rollback');
}

// ── ④ 扫描式（防误删）：fork 与另外 4 颗按钮的实现必须还在 ───────────────────────────────
{
  const mustKeep = [
    'forkBefore', 'doFork',
    '"action.branch"', '"action.resend"', '"action.retry"',
    'function onBranch(', 'function onRetryTurn(', 'function onResendOpen(',
    'function onQuote(', 'function onModeOpen('
  ];
  const missing = mustKeep.filter((needle) => !code.includes(needle));
  if (missing.length > 0) fail('the deletion went too far — these must still exist: ' + JSON.stringify(missing));
  else ok('keep-guard -> forkBefore / doFork / action.branch / action.resend / action.retry + the other 4 handlers all present');

  // 词典里的 4 个文案必须仍在（删 key 时最容易连带删错相邻行）。
  const dictMissing = [];
  for (const [name, dict] of [['zh', dicts.zh], ['en', dicts.en]]) {
    for (const key of ['action.retry', 'action.branch', 'action.resend', 'action.quote', 'action.newMode']) {
      if (typeof dict[key] !== 'string' || dict[key] === '') dictMissing.push(name + '.' + key);
    }
  }
  if (dictMissing.length > 0) fail('these copy keys must still be defined: ' + JSON.stringify(dictMissing));
  else ok('keep-guard -> both dictionaries still define action.retry / branch / resend / quote / newMode');
}

if (failures > 0) {
  console.error('\n' + failures + ' check(s) failed');
  console.error('TURN-TAIL ROW CHECKS FAILED');
  process.exit(1);
}
console.log('\nTURN-TAIL ROW CHECKS PASSED');
