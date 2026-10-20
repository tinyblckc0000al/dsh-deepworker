/**
 * verify_debug_gate.mjs — 「编辑重发」路径上的诊断仪表必须**默认关闭**，只有调试开关打开时才动作。
 *
 * 【为什么要这条套件】
 * 编辑重发路径上留着一整套**无守卫**的诊断仪表（全文件 `DEBUG|__DEV__|debugTrace` 命中 0，
 * 也就是说它不受任何开关控制）：
 *   · `ctx.remote.session.rename({ sessionId, title: ttl.slice(0,200) })`，其中
 *     `ttl = "[ha] ok=… err=… cutBound=… prevEnd=… loaded=… gap=… cont=… n=…"` ——
 *     **每次走这条路径都会把用户的会话标题改写成诊断串**。改名不是"提示"，它改的是用户自己的数据。
 *   · 五处 `showNotice(t("resend.trace*"))` —— 每次编辑重发都弹诊断气泡。
 *
 * 用户 2026-10-15 的决定：**默认关闭，只有调试开关打开时才调用**。
 * 这份套件把这个决定变成可执行断言，并且**每一条都做过变异检验**（见
 * `verify_debug_gate_mutations.mjs`：去掉门控 / 默认值改 true / 断开复选框绑定，三条都必须变红）。
 *
 * 【怎么做到"真的调用次数 = 0"】
 * 不数文本、不数 grep：装载**真 bundle**，apply 进一个**记录型 ctx**（`remote.session.rename`
 * 把每次调用记下来），从 `conversation.chat.turnTail` 槽拿到真的 `props.resend`，跑真正的重发路径。
 * 开关为假 ⇒ `calls.renamed.length === 0` 且**零个** `[data-history-actions-notice]` 气泡；
 * 开关为真 ⇒ 两者都发生。功能逻辑（fork / steer prompt / openSession / page）两种状态下都一样。
 *
 * 复选框那一条同样是**行为**断言而不是文本断言：把设置组件 SSR 出来，定位那个复选框，然后
 * **翻转存储里的值再渲染一次**，要求 `checked` 跟着变。只改键名（把 `row("debugResendTrace", …)`
 * 换成别的键）在文本上依然"引用了"那个 i18n 键，但复选框会跟着**别的**键动 ⇒ 这条会红。
 *
 * 与既有套件同构：无参运行 PASS/FAIL；`HA_CLIENT_JS=<file>` 供变异检验读临时副本。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SOURCE = process.env.HA_CLIENT_JS || fileURLToPath(new URL('../lib/client.js', import.meta.url));
const code = fs.readFileSync(SOURCE, 'utf8');

let failures = 0;
let checks = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => { checks++; console.log('  ok   ' + m); };
const assert = (cond, m) => { if (!cond) fail(m); return !!cond; };
const eq = (a, b, m) => assert(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');

console.log('edit-and-resend diagnostic gate  (' + SOURCE + ')\n');

/* ═══════════════ 1. 源码级：开关存在、默认 false、每个调用点都在门后 ═══════════════ */
console.log('① 源码级：默认关 + 每个调用点都在门后');
{
  // 1a) SETTING_DEFAULTS 里必须有一个**布尔**键，且默认 false。按块取，避免命中别处的同名串。
  const at = code.indexOf('var SETTING_DEFAULTS = {');
  assert(at !== -1, '找不到 SETTING_DEFAULTS');
  const end = code.indexOf('\n    };', at);
  const defaults = code.slice(at, end === -1 ? at + 2000 : end);
  assert(/\bdebugResendTrace:\s*false\b/.test(defaults),
    'SETTING_DEFAULTS 必须声明 debugResendTrace: false（默认关闭）');
  assert(!/\bdebugResendTrace:\s*(true|"[^"]*"|\d)/.test(defaults),
    'debugResendTrace 的默认值必须是布尔 false（布尔键只接受布尔值的语义不得破坏）');
  ok('SETTING_DEFAULTS 含 debugResendTrace，默认 false');

  // 1b) 唯一的读法：工厂作用域的 helper，读 readSettings()，且 === true。
  assert(code.includes('function resendTraceEnabled() {'), '必须有 resendTraceEnabled() 这个唯一读法');
  const helperAt = code.indexOf('function resendTraceEnabled() {');
  const helper = code.slice(helperAt, code.indexOf('\n    }', helperAt) + 6);
  assert(helper.includes('readSettings().debugResendTrace === true'),
    'resendTraceEnabled() 必须读 readSettings().debugResendTrace === true');
  // 失败必须视为关闭（读设置抛错绝不能成为改写标题的理由）：
  assert(/catch\s*\([^)]*\)\s*\{\s*return false;\s*\}/.test(helper),
    'resendTraceEnabled() 出错时必须 return false（绝不因读设置失败而改动用户标题）');
  assert(helper.indexOf('throw') === -1, 'resendTraceEnabled() 不得抛错');
  ok('resendTraceEnabled() 读 readSettings().debugResendTrace === true，异常一律 false');

  const lines = code.split('\n');
  const guardBefore = (lineIndex) => {
    for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 4; i--) {
      if (lines[i].trim() === '') continue;
      return lines[i];
    }
    return '';
  };

  // 1c) rename：调用行前面那一行必须是门。
  const renameMarker = 'ctx.remote.session.rename({ sessionId: sessionId, title: ttl.slice(0, 200) });';
  const renameHits = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(renameMarker)) renameHits.push(i);
  eq(renameHits.length, 1, '诊断改名必须恰好一处');
  if (renameHits.length === 1) {
    const guard = guardBefore(renameHits[0]);
    assert(guard.includes('resendTraceEnabled()'),
      '诊断改名必须在 resendTraceEnabled() 门内；实际上一行是：' + guard.trim());
    if (guard.includes('resendTraceEnabled()')) ok('session.rename 的门控行：' + guard.trim().slice(0, 130));
  }

  // 1d) 五处 resend.trace* 气泡，每一处都必须由 `resendTraceOn` 把门。两种形状都接受：
  //     门在同一个表达式语句里（`resendTraceOn && showNotice(…)`），或**紧邻上一行**是
  //     `if (resendTraceOn) {`。
  //     2026-10-15 之前只有前一种，而那**不是风格选择**：走查器
  //     `dsh-combo-sim/verify/verify_scope_refs.mjs` 不绑定匿名函数的形参 ——
  //     `function (result) {` 的 `(` 被当成函数名吃掉，泄漏的形参窗口落在下一个 `(`（也就是
  //     `showNotice(`）上，`result` 只因"恰好被扫到"才算已声明；插一条 `if (...)` 会把窗口
  //     提前关掉 ⇒ 多出第 53 条假阳性，被误报的正是 `result`（那个回调自己的形参）。
  //     走查器修好后（线上基线 **0**，并自带"插入 `if (...)` 不得涨数"的回归夹具），
  //     这里恢复常规写法。
  const traceHits = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes('showNotice(t("resend.trace')) traceHits.push(i);
  eq(traceHits.length, 5, '重发诊断气泡必须恰好五处（tracePage×2 / trace / traceSplice / traceChild）');
  let unguarded = 0;
  for (const i of traceHits) {
    const same = /resendTraceOn\s*&&\s*showNotice\(t\("resend\.trace/.test(lines[i]);
    const above = guardBefore(i);
    const guardedElsewhere = above.includes('resendTraceEnabled()') || above.includes('resendTraceOn');
    if (!same && !guardedElsewhere) {
      unguarded++;
      fail('第 ' + (i + 1) + ' 行的诊断气泡没有门控：' + lines[i].trim().slice(0, 130));
    }
  }
  if (traceHits.length === 5 && unguarded === 0) ok('五处 resend.trace* 气泡全部由 resendTraceOn 门控（同一表达式语句，或紧邻上一行的 if 行）');

  // 1d-2) `resendTraceOn` 只能来自 `resendTraceEnabled()`：恰好两处初始化（两个函数各一次），
  //       并且全部出现次数就是「2 处初始化 + 5 处使用」。注释先剥掉（这段代码的注释里也写了
  //       这个变量名，按原样数会多算）。
  const plain = code.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.split('//')[0]).join('\n');
  const initCount = (plain.match(/var resendTraceOn = resendTraceEnabled\(\);/g) || []).length;
  eq(initCount, 2, 'resendTraceOn 必须恰好两处初始化（findPendingSpliceBefore / doResend），且都来自 resendTraceEnabled()');
  const useCount = (plain.match(/(?<![\w$])resendTraceOn(?![\w$])/g) || []).length;
  eq(useCount, initCount + traceHits.length, 'resendTraceOn 的出现次数必须正好是「初始化 2 + 使用 5」，多一处就意味着有别的赋值');
  if (initCount === 2 && useCount === 7) ok('resendTraceOn：2 处初始化（都读 resendTraceEnabled()）+ 5 处使用 = 7 次');

  // 1e) 复选框存在，且与**设置键**绑定（不是随便一个键）。
  assert(code.includes('row("debugResendTrace", t("settings.debugResendTrace"))'),
    '设置页必须有 row("debugResendTrace", t("settings.debugResendTrace")) —— 复选框与设置键直接绑定');
  ok('设置页复选框源码：row("debugResendTrace", t("settings.debugResendTrace"))');

  // 1f) i18n 两个词典都要有（verify_i18n 查键集一致性，这里就近把这条钉在功能套件里）。
  const zhAt = code.indexOf('    var zh = {');
  const enAt = code.indexOf('    var en = {');
  assert(zhAt !== -1 && enAt !== -1, '找不到 zh / en 词典');
  const zhBlock = code.slice(zhAt, code.indexOf('\n    };', zhAt));
  const enBlock = code.slice(enAt, code.indexOf('\n    };', enAt));
  assert(zhBlock.includes('"settings.debugResendTrace":'), 'zh 词典缺少 settings.debugResendTrace');
  assert(enBlock.includes('"settings.debugResendTrace":'), 'en 词典缺少 settings.debugResendTrace');
  ok('zh / en 都有 settings.debugResendTrace');
}

/* ═══════════════ 2. 装载真 bundle（记录型 ctx + 记录型 DOM） ═══════════════ */
// 源码级检查可能已经红过；那不该拦住**行为**检查（两边都要各自说话）。所以只统计
// "装载/驱动"这一段自己的失败，用它决定要不要提前退出。
const failuresBeforeLoad = failures;
const req = createRequire(new URL('../', import.meta.url));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const primMock = {
  Modal: function () {}, Button: function () {}, Input: function () {}, IconListPenOutlineRegular: function () {},
  MarkdownText: (p) => React.createElement('div', null, p.text),
  // ── 2026-10-16 四 tab 改版：设置页的开关换成官方 `Switch`、分区条换成 `SegmentedControl`。
  //    这里复刻它们在真 bundle 里的属性形状（`Switch` 渲染成 `<button role="switch"
  //    aria-checked>`，`label` 只进 aria-label；`SegmentedControl` 渲染 tablist + tab 按钮），
  //    下面的 §4 就是靠 `aria-checked` 判断"开关跟着它自己的设置键"的。
  Switch: (p) => React.createElement('button', {
    type: 'button', role: 'switch',
    'aria-checked': p.checked === true ? 'true' : 'false',
    'aria-label': p.label
  }, React.createElement('span', null)),
  // 2026-10-17 第 2 段：命令按钮页的工作区多选用官方 `Checkbox`（渲染成
  // `<label><input type="checkbox"><span>{label}</span></label>`）。本套件的存储桩是空的
  // ⇒ 一条工作区都没有、一个 Checkbox 都不会渲染；桩仍然补上，免得"以后种了数据突然崩"。
  Checkbox: (p) => React.createElement('label', { 'data-prim': 'Checkbox' },
    React.createElement('input', { type: 'checkbox', checked: p.checked === true, onChange: () => {} }),
    React.createElement('span', null, p.label)),
  SegmentedControl: (p) => React.createElement('div', { role: 'tablist', 'aria-label': p.label },
    p.options.map((o) => React.createElement('button', {
      type: 'button', role: 'tab', key: o.value,
      id: p.id + '-' + o.value, 'aria-controls': p.id + '-' + o.value + '-panel',
      'aria-selected': o.value === p.value ? 'true' : 'false'
    }, o.label)))
};
const mockRequire = (id) => id === 'react' ? React
  : id === 'react/jsx-runtime' ? req('react/jsx-runtime')
    : id === '@deepseek-ai/dsh-client-ui-primitives' ? primMock
      : (() => { throw new Error('unexpected require ' + id); })();

const store = new Map();
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } }, innerWidth: 1400, innerHeight: 900 };
// 真定时器只会拖住进程：气泡的 6s 自动关闭在这里不需要跑。
const inertTimers = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
const sandbox = {
  window: windowObj,
  document: undefined,            // apply 期没有 DOM ⇒ 所有 DOM 贡献自己短路
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  require: mockRequire, TextEncoder, TextDecoder, btoa, atob, console,
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON,
  ...inertTimers
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
assert(loaded !== null && loaded.id === 'dsh-deepworker', 'bundle 必须以 dsh-deepworker 注册');

const SESSION_ID = 'session-debuggate-0001';
const calls = { renamed: [], forked: [], prompted: [], opened: [], paged: [] };
/** settings.section / conversation.chat.turnTail 都按 `register(config, component)` 注册。 */
const registrations = {};

// 会话内容：turn/end 之后有两条待发 splice（seq 3、4）。boundary=6 ⇒ beforeSeq=7 ⇒
// prevEnd=2、最早 splice=3 ⇒ cut 前移到 2 ⇒ traceSplice 也会走。功能值与诊断值都能看见。
const EVENTS = [
  { type: 'permission/preset', seq: 0, data: {} },
  { type: 'turn/start', seq: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: 2, data: { turn: 1, reason: 'completed' } },
  { type: 'agent/inbox/spliced', seq: 3, data: { target: 'next-turn', start: 0, inserted: [{ id: 'm2', role: 'user', content: [{ type: 'text', text: 'Q2' }] }] } },
  { type: 'agent/inbox/spliced', seq: 4, data: { target: 'next-turn', start: 0, inserted: [{ id: 'm3', role: 'user', content: [{ type: 'text', text: 'Q3' }] }] } },
  { type: 'model/selection', seq: 5, data: {} }
];

const ctx = {
  effect: (fn) => { if (typeof fn === 'function') fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (key) => key },
  slots: {
    inject: (n, f) => { if (typeof f === 'function') f(); },
    register: (config, component) => { if (config && config.name) registrations[config.name] = { config: config, component: component }; return function () {}; }
  },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  sessions: {
    create: async () => 'new-1',
    fork: async (o) => { calls.forked.push(o); return 'child-1'; },
    list: { getSnapshot: () => ({ ids: [SESSION_ID], byId: { [SESSION_ID]: { id: SESSION_ID, title: 'T' } } }) }
  },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: (id) => calls.opened.push(id), openWorkspace: () => {}, startSession: () => {},
    replaceMain: () => {}, clearMain: () => {}, archiveSession: async () => {},
    mainReference: { sessionId: SESSION_ID },
    workspaces: { list: { getSnapshot: () => ({ items: [], pinnedSessionIds: [], archivedSessionIds: [], phase: 'ready' }) } },
    pickDirectory: async () => ''
  },
  remote: {
    session: {
      page: async (r) => { calls.paged.push(r); return { ok: true, value: { records: EVENTS.map((e) => ({ type: 'event', event: e })) } }; },
      rename: (arg) => { calls.renamed.push(arg); return Promise.resolve({ ok: true }); },
      prompt: async (r) => { calls.prompted.push(r); return { ok: true }; },
      cancel: async () => ({ ok: true })
    },
    agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
    workspace: { create: async () => ({ ok: true }) }
  }
};

const exportsObj = loaded.factory(mockRequire);
exportsObj.apply(ctx);
const api = exportsObj.__test;
assert(api && typeof api.readSettings === 'function' && typeof api.writeSettings === 'function', '设置读写接缝必须存在');

/* 记录型 DOM：只数带标记的气泡 */
function makeDoc() {
  const created = [];
  const doc = {
    created: created,
    addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      const el = {
        tagName: String(tag), attributes: {}, textContent: '', style: { cssText: '', left: '', top: '' },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
        remove() {}, appendChild() {}, addEventListener() {}
      };
      created.push(el);
      return el;
    },
    body: { appendChild() {} }, head: { appendChild() {} },
    querySelector: () => null, querySelectorAll: () => []
  };
  return doc;
}
const bubbles = (d) => d.created.filter((el) => el.hasAttribute && el.hasAttribute('data-history-actions-notice'));

const turnTail = registrations['conversation.chat.turnTail'];
assert(!!turnTail && !!turnTail.config && typeof turnTail.config.inject === 'function', '必须注册 conversation.chat.turnTail（重发入口在这里）');
if (!turnTail || !turnTail.config) { console.error("\n" + failures + " check(s) failed (bundle could not be driven)"); process.exit(1); }
const props = turnTail.config.inject(SESSION_ID);
assert(!!props && typeof props.resend === 'function', 'turnTail 的 inject 必须给出 resend()');
if (failures > failuresBeforeLoad) { console.error('\n' + failures + ' check(s) failed (bundle could not be driven)'); process.exit(1); }

function resetStore() { store.clear(); }
function setStore(patch) {
  const next = api.readSettings();
  for (const k in patch) next[k] = patch[k];
  const w = api.writeSettings(next);
  assert(w && w.ok === true, 'writeSettings 必须成功：' + JSON.stringify(w));
}
const runResend = async () => {
  calls.renamed.length = 0; calls.forked.length = 0; calls.prompted.length = 0; calls.opened.length = 0; calls.paged.length = 0;
  const doc = makeDoc();
  sandbox.document = doc;
  await props.resend(6, 'EDITED TEXT', { start: 7, end: 8, prev: 2 });
  return doc;
};

const checksAll = (...results) => results.every(function (r) { return r === true; });

/* ═══════════════ 3. 行为：开关为假 ⇒ 零改名、零气泡、功能原样 ═══════════════ */
console.log('\n② 行为：开关为假（默认）⇒ 绝不改名、绝不弹诊断气泡，功能一行不变');
{
  resetStore();
  const defaultOff = eq(api.readSettings().debugResendTrace, false, '空存储时 readSettings().debugResendTrace 必须是 false（默认关）');
  const doc = await runResend();
  const renamedZero = eq(calls.renamed.length, 0, '开关为假时 ctx.remote.session.rename 的调用次数必须是 0');
  const bubblesZero = eq(bubbles(doc).length, 0, '开关为假时不得产生任何 [data-history-actions-notice] 诊断气泡');
  // 功能逻辑必须一模一样：fork 一次、openSession 一次、steer 提示一次、page 被读一次。
  const forkOnce = eq(calls.forked.length, 1, '功能：必须 fork 一次');
  const forkCut = eq(calls.forked[0] && calls.forked[0].atSeq, 2, '功能：fork 边界必须仍然前移到 2（诊断不参与决策）');
  const openedOnce = eq(calls.opened.length, 1, '功能：必须打开子会话一次');
  const promptOnce = eq(calls.prompted.length, 1, '功能：必须把编辑后的文本送进子会话一次');
  const steer = eq(calls.prompted[0] && calls.prompted[0].mode, 'steer', '功能：重发必须仍然是 steer');
  const pagedOnce = eq(calls.paged.length, 1, '功能：page 仍然被读一次（读前驱 splice 是功能，不是诊断）');
  if (checksAll(defaultOff, renamedZero, bubblesZero, forkOnce, forkCut, openedOnce, promptOnce, steer, pagedOnce)) {
    ok('开关为假：rename=0 · 气泡=0 · fork=1(atSeq=2) · openSession=1 · steer prompt=1 · page=1');
  }
}
{
  // 显式写 false（而不是"键不存在"）也必须一样。
  resetStore();
  setStore({ debugResendTrace: false });
  const doc = await runResend();
  const renamedZeroExplicit = eq(calls.renamed.length, 0, '显式 debugResendTrace=false 时 rename 调用次数必须是 0');
  const bubblesZeroExplicit = eq(bubbles(doc).length, 0, '显式 debugResendTrace=false 时不得弹诊断气泡');
  if (checksAll(renamedZeroExplicit, bubblesZeroExplicit)) ok('显式 false 与缺失键同一行为（都关）');
}
{
  // 存储坏掉（getItem 抛错）⇒ 视为关闭，绝不改名，也绝不抛错。
  resetStore();
  const good = sandbox.localStorage.getItem;
  sandbox.localStorage.getItem = () => { throw new Error('storage exploded'); };
  let doc = null;
  try { doc = await runResend(); } catch (e) { fail('读设置抛错时重发路径不得抛错：' + (e && e.message)); }
  sandbox.localStorage.getItem = good;
  if (doc) {
    const a = eq(calls.renamed.length, 0, '读设置抛错 ⇒ 必须视为关闭，rename 调用次数 = 0');
    const b = eq(bubbles(doc).length, 0, '读设置抛错 ⇒ 不得弹诊断气泡');
    const c = eq(calls.forked.length, 1, '读设置抛错不得影响功能（仍然 fork 一次）');
    if (checksAll(a, b, c)) ok('读设置抛错 ⇒ 视为关闭（rename=0、气泡=0）、功能不受影响、且不抛错');
  }
}

console.log('\n③ 行为：开关为真 ⇒ 改名与气泡都发生（证明开关真的接线了）');
{
  resetStore();
  setStore({ debugResendTrace: true });
  const roundTrip = eq(api.readSettings().debugResendTrace, true, '写 true 后必须读回 true（设置键真的往返）');
  const doc = await runResend();
  const renamedOnce = eq(calls.renamed.length, 1, '开关为真时 ctx.remote.session.rename 必须被调用一次');
  let titleOk = false;
  if (calls.renamed.length === 1) {
    const arg = calls.renamed[0];
    const sameSession = eq(String(arg && arg.sessionId), SESSION_ID, '改名必须针对当前会话');
    const looksDiag = assert(/^\[ha\] ok=/.test(String(arg && arg.title)), '改名的标题必须就是那条诊断串（[ha] ok=…）：' + String(arg && arg.title).slice(0, 60));
    const capped = assert(String(arg && arg.title).length <= 200, '标题必须仍然被截到 200 字以内');
    titleOk = checksAll(sameSession, looksDiag, capped);
    if (titleOk) ok('开关为真：rename 一次，title=' + String(arg && arg.title).slice(0, 56) + '…');
  }
  const bubblesShown = assert(bubbles(doc).length >= 1, '开关为真时必须出现诊断气泡，实际 ' + bubbles(doc).length);
  if (bubblesShown) ok('开关为真：诊断气泡 ' + bubbles(doc).length + ' 个');
  const forkStill = eq(calls.forked.length, 1, '开关为真时功能仍必须 fork 一次');
  const promptStill = eq(calls.prompted.length, 1, '开关为真时功能仍必须 steer 一次');
  const steerStill = eq(calls.prompted[0] && calls.prompted[0].mode, 'steer', '开关为真时重发仍必须是 steer');
  if (checksAll(roundTrip, renamedOnce, titleOk, bubblesShown, forkStill, promptStill, steerStill)) {
    ok('开关为真：rename=1 · 气泡≥1 · fork=1 · steer=1（功能不变）');
  }
}

/* ═══════════════ 4. 设置页复选框：存在，且**跟着那个键**动 ═══════════════ */
console.log('\n④ 设置页复选框：与 debugResendTrace 绑定（翻转设置 ⇒ checked 跟着变）');
{
  const settingsReg = registrations['settings.section'];
  assert(!!settingsReg && !!settingsReg.component, '必须注册 settings.section 且带上组件');
  if (settingsReg && settingsReg.component) {
    const settingsComponent = settingsReg.component;
    // `t` 返回键名本身：调试开关的标签就是唯一串 "settings.debugResendTrace"，便于在 HTML 里定位。
    const t = (key) => key;
    const renderSettings = () => renderToStaticMarkup(React.createElement(settingsComponent, { t: t }));
    /** 定位标签**左边最近的那个**开关，读出它有没有开。
     *  2026-10-16：控件从裸 `<input type="checkbox">` 换成官方 `Switch`
     *  （`<button role="switch" aria-checked="true|false">`）—— 读法跟着换，语义不变。 */
    const checkedOf = (html, label) => {
      const at = html.indexOf(label);
      if (at === -1) return null;
      const switchAt = html.indexOf('role="switch"', at);
      if (switchAt === -1) return null;
      const openAt = html.lastIndexOf('<button', switchAt);
      if (openAt === -1) return null;
      const gt = html.indexOf('>', openAt);
      return /aria-checked="true"/.test(html.slice(openAt, gt + 1));
    };
    resetStore();
    setStore({ debugResendTrace: false });
    const htmlOff = renderSettings();
    resetStore();
    setStore({ debugResendTrace: true });
    const htmlOn = renderSettings();
    const off = checkedOf(htmlOff, 'settings.debugResendTrace');
    const on = checkedOf(htmlOn, 'settings.debugResendTrace');
    assert(off !== null, '设置页必须渲染出 debugResendTrace 这个开关（标签找不到）');
    eq(off, false, 'debugResendTrace=false ⇒ 该复选框必须未勾选（checked 必须跟着这个键）');
    eq(on, true, 'debugResendTrace=true ⇒ 该复选框必须勾选（checked 必须跟着这个键）');
    if (off === false && on === true) ok('复选框存在且与 debugResendTrace 绑定：false ⇒ 未勾选，true ⇒ 勾选');
    // 顺带：设置页开关总数必须 ≥ 5（四个行为开关 + 这一个诊断开关）。
    const count = (htmlOn.match(/role="switch"/g) || []).length;
    assert(count >= 5, '设置页开关数量必须 ≥ 5（含新加的诊断开关），实际 ' + count);
    // 落点也必须是用户要求的那个：**默认折叠**的「调试」<details> 里（与「刷新状态」
    // 「把自检发给我」同处）。这是结构断言，不是文本断言：标签必须夹在最近的一对
    // <details>…</details> 中间，且那个 <details> 的标签上**没有** open 属性。
    // ⚠️ 2026-10-16 合并（第 2 条批评"怎么有两个调试"）：内层那个同名（中文也叫「调试」）的
    //    `focus.debug` 折叠已经删掉并入外层 ⇒ 这里再补一条"最近的 details 必须是**外层**
    //    那个（`settings.section.debug`）"。本套件的 `t` 返回键名，所以判据就是键名 ——
    //    语义比"在某个折叠里"精确：**不许**再套一层内层折叠。
    const labelAt = htmlOn.indexOf('settings.debugResendTrace');
    const detailsAt = labelAt === -1 ? -1 : htmlOn.lastIndexOf('<details', labelAt);
    const closeAt = labelAt === -1 ? -1 : htmlOn.indexOf('</details>', labelAt);
    const openTag = detailsAt === -1 ? '' : htmlOn.slice(detailsAt, htmlOn.indexOf('>', detailsAt) + 1);
    const summaryText = detailsAt === -1 || closeAt === -1 ? null : (/<summary[^>]*>([^<]*)<\/summary>/.exec(htmlOn.slice(htmlOn.indexOf('>', detailsAt) + 1, closeAt)) || [null, null])[1];
    const inCollapsedFold = detailsAt !== -1 && closeAt !== -1 && detailsAt < labelAt && labelAt < closeAt && !/\bopen\b/.test(openTag);
    assert(inCollapsedFold, '调试开关必须落在默认折叠的「调试」<details> 折叠区里（与「刷新状态」「把自检发给我」同处）；实际最近的 details 开标签=' + JSON.stringify(openTag.slice(0, 80)));
    assert(summaryText !== null && summaryText.trim() === 'settings.section.debug',
      '调试开关所在的折叠区必须是**外层**那一个（summary = settings.section.debug）；整页只许有一个「调试」折叠（内层 focus.debug 已合并删除）；实际=' + JSON.stringify(summaryText));
    if (inCollapsedFold) ok('开关落在默认折叠的「调试」<details> 里（' + openTag.slice(0, 46) + '…）');
  }
}

console.log('\n' + (failures === 0 ? 'DEBUG GATE CHECKS PASSED (' + checks + ' ok)' : failures + ' check(s) failed'));
process.exit(failures === 0 ? 0 : 1);
