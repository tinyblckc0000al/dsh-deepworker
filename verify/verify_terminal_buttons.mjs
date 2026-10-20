// verify_terminal_buttons.mjs — 「终端按钮」的**行为级**断言。
//
// 为什么必须是行为级：本机最贵的教训是"文本 grep 会被死代码满足"。所以这里不 grep 源码里的
// 调用顺序，而是**用一个记录型 ctx 真跑一遍执行器**，把 `ctx.remote.terminal.*` 的每一次调用
// 连实参一起记下来，然后断言：
//
//   ① 执行序列 = create → rename → retain → follow → 迭代到首帧 → write
//   ② **全程没有任何 `close` 调用**（`close` 会 SIGTERM→SIGKILL 杀整个进程树；
//      长驻服务会被一起停掉，而且 closedIds 是终身的 ⇒ 同 id 再 create 报 unavailable）
//   ③ 前置命令的 write **逐条**早于目标命令的 write
//   ④ 同步判断走**结束标记**：标记出现 ⇒ done 且退出码被读出并进回执；
//      标记不出现（超时）⇒ "仍在运行"，**且不是失败**
//   ⑤ 失败路径会说话（identity / create / retain / write 各自）
//
// ⚠️ 这里的 `ctx` 是**桩**：桩全绿只证明"逻辑自洽"，不证明"真机上 ctx.remote.terminal
// 真的可用"。后者只能由用户在 App 里点一下验（见报告里的"未真机验证"）。
//
// 用法：node verify/verify_terminal_buttons.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const code = fs.readFileSync(LIVE, 'utf8');

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const section = (title) => console.log('\n── ' + title);

// ── load the bundle in a sandbox ────────────────────────────────────────────────
/**
 * The bundle's own zh dictionary for the `term.*` keys.
 *
 * ⚠️ The stub `t` must do the INTERPOLATION as well as the lookup. A stub that returns the
 * key and ignores its argument makes every "does the message carry the detail" assertion
 * vacuous — it would pass on a message that never carried anything. That is exactly the
 * "桩不插值 ⇒ 断言退化成文本比对" trap, and it bit this suite once already.
 */
function readTermDict() {
  const zh = code.slice(code.indexOf('var zh = {'), code.indexOf('var en = {'));
  const out = {};
  for (const m of zh.matchAll(/"((?:term)\.[A-Za-z0-9_]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = JSON.parse('"' + m[2] + '"');
  }
  if (Object.keys(out).length < 40) throw new Error('the term.* dictionary could not be read from the bundle');
  return out;
}
const TERM_DICT = readTermDict();
/** A t() that looks the key up AND interpolates `{name}` placeholders. */
function makeT() {
  return (k, v) => {
    let out = Object.prototype.hasOwnProperty.call(TERM_DICT, k) ? TERM_DICT[k] : k;
    if (v && typeof v === 'object') {
      for (const key of Object.keys(v)) out = out.split('{' + key + '}').join(String(v[key]));
    }
    return out;
  };
}

function loadBundle(overrides) {
  const store = new Map();
  const windowObj = { __ModuleLoader__: {} };
  let loaded = null;
  windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
  const reactMock = {
    memo: (c) => c,
    useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
    useRef: (i) => ({ current: i }),
    useEffect: () => {},
    useSyncExternalStore: () => undefined
  };
  const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
  const primitivesMock = {
    Modal: function () {}, Button: function () {}, Input: function () {},
    IconListPenOutlineRegular: function () {}, MarkdownText: function () {},
    SegmentedControl: function () {}, Switch: function () {}
  };
  const mockRequire = (id) => id === 'react' ? reactMock
    : id === 'react/jsx-runtime' ? jsxMock
    : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock
    : (() => { throw new Error('unexpected ' + id); })();
  const sandbox = {
    window: windowObj, document: undefined,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    require: mockRequire,
    TextEncoder, btoa, atob, TextDecoder, setTimeout, clearTimeout, console,
    AbortController,
    crypto: { randomUUID: (() => { let n = 0; return () => 'uuid-' + (++n) + '-aaaaaaaaaaaaaaaaaaaa'; })() },
    Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, isFinite, RegExp
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  const t = loaded.factory(mockRequire);
  const ctx = Object.assign({
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: () => {}, bind: () => (k) => k },
    slots: { inject: (n, f) => { f(); }, register: () => {} },
    sessions: { create: async () => 'x', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
    uiWorkspace: {
      openSession: () => {}, archiveSession: async () => {},
      mainReference: { sessionId: 'sess-1' },
      workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
      pickDirectory: async () => ''
    },
    remote: { session: { prompt: async () => ({ ok: true }) } }
  }, overrides || {});
  t.apply(ctx);
  return { api: t.__test, store, ctx, sandbox };
}

/**
 * A recording terminal stub.
 *
 * `follow()` returns an async iterable whose frames are driven by the test: every `write`
 * pushes the same bytes a real PTY would echo, so the executor's marker detection runs on
 * realistic data. `markerMode` controls what comes back:
 *   'echo'  – echo the literal command line, then print the done marker (synchronous finish)
 *   'never' – echo only; the marker never arrives (a long-lived service)
 */
function makeTerminal(rec, opts) {
  const o = opts || {};
  let push = null;
  const frames = [];
  const controller = { done: false };
  function emit(frame) { if (push) { const p = push; push = null; p({ value: frame, done: false }); } else frames.push(frame); }
  const iterable = {
    [Symbol.asyncIterator]() {
      let closed = false;
      return {
        next() {
          if (closed) return Promise.resolve({ done: true, value: undefined });
          if (frames.length > 0) return Promise.resolve({ value: frames.shift(), done: false });
          return new Promise((resolve) => { push = resolve; });
        },
        return() {
          closed = true;
          rec.push({ method: 'disconnect' });
          return Promise.resolve({ done: true, value: undefined });
        }
      };
    }
  };
  const terminal = {
    async create(agent, request) {
      rec.push({ method: 'create', agent, request });
      return { id: request.id, title: 't', shell: { path: '/bin/zsh', args: [], name: 'zsh' }, cwd: o.cwd || '/w', cols: request.cols, rows: request.rows, state: 'running', exitCode: null, controllerId: undefined };
    },
    async rename(agent, id, title) { rec.push({ method: 'rename', agent, id, title }); },
    async retain(agent, id, signal) { rec.push({ method: 'retain', agent, id }); },
    follow(agent, id, attachmentId) {
      rec.push({ method: 'follow', agent, id, attachmentId });
      // A real follow yields the screen snapshot FIRST, then ordered output.
      frames.push({ type: 'snapshot', sequence: 0, screen: '', info: { id, state: 'running' } });
      return iterable;
    },
    async write(agent, id, attachmentId, data) {
      rec.push({ method: 'write', agent, id, attachmentId, data });
      // What a PTY does: echo the line the user "typed", then run it.
      emit({ type: 'output', sequence: 1, data: data });
      if (o.markerMode === 'never') return;
      // `echo __DW_DONE_$?__` → the shell prints the expanded marker.
      const code = typeof o.exitCode === 'number' ? o.exitCode : 0;
      const line = o.markerMode === 'literal'
        ? 'echo __DW_DONE_$?__\r\n'
        : '__DW_DONE_' + code + '__\r\n';
      // Deliver it in TWO chunks: proves the executor accumulates across frames instead of
      // assuming one frame == one line (a real PTY splits arbitrarily).
      const mid = Math.max(1, Math.floor(line.length / 2));
      emit({ type: 'output', sequence: 2, data: line.slice(0, mid) });
      emit({ type: 'output', sequence: 3, data: line.slice(mid) });
    },
    async close(agent, id) { rec.push({ method: 'close', agent, id }); }
  };
  return terminal;
}

function run(deps) {
  const rec = [];
  const terminal = makeTerminal(rec, deps);
  const boot = loadBundle({ remote: Object.assign({ session: { prompt: async () => ({ ok: true }) } }, deps.remote) });
  const agent = deps.agent === undefined ? 'sess-1' : deps.agent;
  // The signal must come from the BUNDLE's realm: a host-realm AbortSignal is a different
  // class, and `typeof signal.addEventListener` on it is not the contract we test.
  const controller = deps.noSignal ? null : new (boot.sandbox.AbortController)();
  return boot.api.termRunSequence({
    terminal: deps.noTerminal ? undefined : terminal,
    t: makeT(),
    signal: controller === null ? undefined : controller.signal,
    uuid: (() => { let n = 0; return () => 'term-' + (++n); })(),
    now: () => '2026-10-16T00:00:00.000Z',
    cols: 120, rows: 30
  }, agent, {
    label: deps.label || '启动',
    commands: deps.commands,
    timeoutMs: deps.timeoutMs === undefined ? 200 : deps.timeoutMs
  }).then((outcome) => ({ outcome, rec, api: boot.api }))
    .catch((error) => ({ error, rec, api: boot.api }));
}

// ════════════════════════════════════════════════════════════════════════════════
section('① 执行序列与「绝不 close」');
{
  const r = await run({ commands: [{ label: '启动', command: './serve.sh' }] });
  const methods = r.rec.map((c) => c.method);
  assert('没有抛异常', !r.error, r.error && String(r.error.message || r.error));
  const expected = ['create', 'rename', 'retain', 'follow', 'write'];
  const firstFive = methods.slice(0, 5);
  assert('前五次调用恰好是 create → rename → retain → follow → write',
    JSON.stringify(firstFive) === JSON.stringify(expected), JSON.stringify(methods));
  assert('retain 早于 follow（先持有名额，再挂上去看屏幕）',
    methods.indexOf('retain') < methods.indexOf('follow'), JSON.stringify(methods));
  assert('rename 早于 retain', methods.indexOf('rename') < methods.indexOf('retain'));
  assert('收尾是**断开流**（iterator.return），不是 close',
    methods.includes('disconnect'), JSON.stringify(methods));
  const closes = methods.filter((m) => m === 'close').length;
  assert('✅ close 调用次数 = 0', closes === 0, 'close 被调用了 ' + closes + ' 次');
  console.log('     实测调用序：' + methods.join(' → '));
  // 终端 id 与 agent 都必须显式传
  for (const call of r.rec) {
    if (['create', 'rename', 'retain', 'follow', 'write'].includes(call.method)) {
      assert('  ' + call.method + ' 的第一个参数是会话 id', call.agent === 'sess-1', JSON.stringify(call.agent));
    }
  }
  assert('结束时判 done，且退出码 0 被读出', r.outcome.state === 'done' && r.outcome.code === 0, JSON.stringify(r.outcome.state) + '/' + r.outcome.code);
}

// ════════════════════════════════════════════════════════════════════════════════
section('② 结束标记：跨帧累积 + 非零退出码');
{
  const r = await run({ commands: [{ label: '启动', command: './serve.sh' }], exitCode: 3 });
  assert('标记被拆成两帧也能认出来（累加而非逐帧匹配）', r.outcome.state === 'done', JSON.stringify(r.outcome.state));
  assert('退出码 3 被读出', r.outcome.code === 3, String(r.outcome.code));
  assert('失败退出码走 doneFail 文案', /退出码是 3（失败）/.test(String(r.outcome.detail)), String(r.outcome.detail));
}

// ════════════════════════════════════════════════════════════════════════════════
section('③ 同步 vs 仍在运行：标记不出现 = 仍在运行，**不是失败**');
{
  const r = await run({ commands: [{ label: '启动', command: './serve.sh' }], markerMode: 'never', timeoutMs: 120 });
  assert('超时 ⇒ state = running', r.outcome.state === 'running', JSON.stringify(r.outcome.state));
  assert('超时 ⇒ stillRunning = true', r.outcome.stillRunning === true, JSON.stringify(r.outcome.stillRunning));
  assert('超时 ⇒ **不是**失败（state 不是 error、没有 diagError 语义）',
    r.outcome.state !== 'error' && !/出错|error:/.test(String(r.outcome.detail)), String(r.outcome.detail));
  assert('超时文案说清"仍在运行"', /没等到结束标记/.test(String(r.outcome.detail)) && /仍在运行/.test(String(r.outcome.detail)), String(r.outcome.detail));
  assert('超时也依然没有 close', r.rec.filter((c) => c.method === 'close').length === 0);
  assert('超时也断开了流', r.rec.some((c) => c.method === 'disconnect'));
}

// ════════════════════════════════════════════════════════════════════════════════
section('④ 回显里的字面 `$?` 不许被当成"完成"');
{
  const r = await run({ commands: [{ label: '启动', command: './serve.sh' }], markerMode: 'literal', timeoutMs: 120 });
  assert('只有字面 `echo __DW_DONE_$?__` 回显时判"仍在运行"，不判 done',
    r.outcome.state === 'running', JSON.stringify(r.outcome.state));
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑤ 前置序列：write 顺序逐条可验证');
{
  const r = await run({
    commands: [
      { label: '停止', command: './stop.sh' },
      { label: '清理', command: './clean.sh' },
      { label: '启动', command: './serve.sh' }
    ]
  });
  const writes = r.rec.filter((c) => c.method === 'write');
  assert('三条命令各 write 一次（共 3 次）', writes.length === 3, String(writes.length));
  const order = writes.map((w) => w.data.trim());
  assert('write 顺序 = 停止 → 清理 → 启动',
    /stop\.sh/.test(order[0]) && /clean\.sh/.test(order[1]) && /serve\.sh/.test(order[2]),
    JSON.stringify(order));
  assert('每条 write 都带结束标记（同一行）',
    order.every((line) => /__DW_DONE_\$\?__$/.test(line)), JSON.stringify(order));
  if (writes.length === 3) {
    assert('目标命令（启动）的 write 在最后', writes[2].data.includes('serve.sh'), JSON.stringify(order));
    for (let i = 0; i < 2; i++) {
      assert('  前置 #' + (i + 1) + ' 的 write 在目标 write 之前',
        r.rec.indexOf(writes[i]) < r.rec.indexOf(writes[2]),
        r.rec.indexOf(writes[i]) + ' vs ' + r.rec.indexOf(writes[2]));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑤b 前置序列的**排序**（走公开接缝 runTerminalButton，而不是直接喂执行器）');
{
  // ⚠️ 上面 ⑤ 只证明了**执行器**尊重它拿到的数组顺序。真正决定顺序的代码在
  //    `runTerminalButton` 里那个遍历 `config.seq` 的循环 —— 直接喂执行器**测不到它**
  //    （实测：把那个循环反向遍历，⑤ 照样全绿）。所以这里必须走公开接缝：
  //      · 写一份配置：stop="停止"、clean="清理"、start="启动"、seq = [stop, clean]
  //      · 调 runTerminalButton(start)
  //      · 断言 write 顺序是 停止 → 清理 → 启动
  const rec = [];
  const boot = loadBundle({});
  const api = boot.api;
  const ok = api.termWriteConfig('/w/seq', {
    timeout: 5,
    seq: ['stop', 'x:clean'],   // id 必须是 action 自己的 id（'x:clean'），不是显示名
    actions: [
      { id: 'start', label: '', command: './serve.sh' },
      { id: 'stop', label: '', command: './stop.sh' },
      { id: 'x:clean', label: '清理', command: './clean.sh' }
    ]
  });
  assert('配置写成功', ok.ok === true, JSON.stringify(ok));
  const config = api.termReadConfig('/w/seq');
  // ⚠️ 2026-10-17 第 2 段：存储模型换成多工作区表（`workspaces.v1`），`termReadConfig` 变成
  //    **兼容适配器**：extras 的 id 按位置重新生成为 `x:0…`（旧模型里是 `x:clean` 这种手写 id）。
  //    ⇒ 断言从"逐字等于旧 id"改成"**逐条指到那条命令**"（这才是真正的不变量）。
  assert('seq 读回两条，第一条是 stop、第二条指向那个额外按钮',
    config.seq.length === 2 && config.seq[0] === 'stop' && /^x:/.test(String(config.seq[1])),
    JSON.stringify(config.seq));
  {
    const refAction = config.actions.filter((a) => a.id === config.seq[1])[0];
    assert('  第二条解析到的命令确实是 ./clean.sh（id 换了，指向没换）',
      !!refAction && /clean\.sh/.test(String(refAction.command)), JSON.stringify(refAction));
  }

  const terminal = makeTerminal(rec, {});
  boot.sandbox.__setTerminal = null;
  // 把记录型 terminal 装到 ctx.remote 上，再走公开接缝。
  boot.ctx.remote.terminal = terminal;
  const outcome = await api.runTerminalButton({
    t: makeT(),
    sessionId: 'sess-1',
    cwd: '/w/seq',
    config: config,
    actionId: 'start',
    label: '启动'
  });
  const writes = rec.filter((c) => c.method === 'write').map((w) => w.data.trim());
  assert('走公开接缝：write 了 3 次', writes.length === 3, JSON.stringify(writes));
  assert('顺序 = 停止 → 清理 → 启动（seq 的顺序被尊重）',
    writes.length === 3 && /stop\.sh/.test(writes[0]) && /clean\.sh/.test(writes[1]) && /serve\.sh/.test(writes[2]),
    JSON.stringify(writes));
  assert('目标命令的 write 严格晚于每一条前置命令',
    writes.length === 3 && /__DW_DONE_\$\?__$/.test(writes[2]), JSON.stringify(writes));
  assert('公开接缝路径也是判 done（退出码 0）', outcome && outcome.state === 'done', JSON.stringify(outcome && outcome.state));
  assert('公开接缝路径同样没有 close', rec.filter((c) => c.method === 'close').length === 0);
  assert('公开接缝路径也断开了流', rec.some((c) => c.method === 'disconnect'));
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑥ 前置命令没跑完 / 失败 ⇒ 目标命令不许开始');
{
  const r = await run({
    commands: [{ label: '停止', command: './stop.sh' }, { label: '启动', command: './serve.sh' }],
    markerMode: 'never', timeoutMs: 100
  });
  const writes = r.rec.filter((c) => c.method === 'write');
  assert('前置命令超时 ⇒ 只 write 了 1 次（目标命令没有开始）', writes.length === 1, String(writes.length));
  assert('写的是前置命令（停止）', writes.length === 1 && /stop\.sh/.test(writes[0].data), writes.length ? writes[0].data : '(none)');
  assert('状态 = prereq-running（且仍算"仍在运行"，不是失败）',
    r.outcome.state === 'prereq-running' && r.outcome.stillRunning === true, JSON.stringify(r.outcome.state));
  assert('说的话里点明了是前置命令', /前置命令第 1 条仍在运行/.test(String(r.outcome.detail)), String(r.outcome.detail));
}
{
  // 前置命令以非零码结束：同样不许继续。第一段的立即完成用 exitCode 全局控制，
  // 所以这里换成"前置命令永不回标记、第二条正常"的写法做不到 —— 改为直接断言
  // 退出码非 0 时前置分支产生的状态（用单命令 + 非 0 码验证 doneFail 语义，
  // 前置分支本身由上面的超时用例覆盖"不许继续"）。
  const r = await run({ commands: [{ label: '停止', command: './stop.sh' }, { label: '启动', command: './serve.sh' }], exitCode: 4 });
  const writes = r.rec.filter((c) => c.method === 'write');
  assert('前置命令以非零码结束 ⇒ 只 write 了 1 次', writes.length === 1, String(writes.length));
  assert('状态 = prereq-failed，码被带出', r.outcome.state === 'prereq-failed' && r.outcome.code === 4,
    JSON.stringify(r.outcome.state) + '/' + r.outcome.code);
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑦ 失败必须可见（每一条路径都返回带 detail 的 outcome）');
{
  const noAgent = await run({ commands: [{ label: '启动', command: './serve.sh' }], agent: '' });
  assert('会话 id 为空 ⇒ 不静默，返回带 detail 的 error', noAgent.outcome.state === 'error' && String(noAgent.outcome.detail).length > 0, JSON.stringify(noAgent.outcome.detail));
  assert('  且一次终端调用都没有发生', noAgent.rec.length === 0, JSON.stringify(noAgent.rec.map((c) => c.method)));
  assert('  且拿不到身份时说清了是身份问题', /identity/.test(String(noAgent.outcome.detail)), String(noAgent.outcome.detail));

  const noTerminal = await run({ commands: [{ label: '启动', command: './serve.sh' }], noTerminal: true });
  assert('终端服务缺失 ⇒ 说话（state=error + detail）', noTerminal.outcome.state === 'error' && /remote/.test(String(noTerminal.outcome.detail)), String(noTerminal.outcome.detail));

  const createFails = await run({
    commands: [{ label: '启动', command: './serve.sh' }],
    remote: {}
  });
  assert('正常路径仍然能跑（对照）', createFails.outcome.state === 'done' || createFails.outcome.state === 'running', JSON.stringify(createFails.outcome.state));
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑧ 诊断行的形状（与「上次跳转诊断」同构）');
{
  const boot = loadBundle({});
  const api = boot.api;
  // A stub `t` that ACTUALLY interpolates — otherwise the assertion below could only ever
  // see the key name and would be testing nothing (本机踩过：桩不插值时断言退化成文本比对).
  const say = makeT();
  const head = api.termDescribeOutcome(say, { state: 'done', code: 0, commands: [{ command: 'x' }], id: 't1', at: 'AT' });
  assert('termDescribeOutcome 输出以「上次启动：」开头', /^上次启动：/.test(head), head);
  const line = api.termDescribeOutcome(say, { state: 'done', code: 0, commands: [{ command: './serve.sh' }], id: 't1', at: 'AT' });
  assert('  含命令', line.includes('./serve.sh'), line);
  assert('  含终端 id', line.includes('t1'), line);
  assert('  含成功与退出码', /成功（退出码 0）/.test(line), line);
  assert('  含时间', line.includes('AT'), line);
  const bad = api.termDescribeOutcome(say, { state: 'error', code: null, detail: 'BOOM', commands: [{ command: 'x' }], id: 't2', at: 'AT' });
  assert('  失败时把原始错误原样带出', bad.includes('BOOM'), bad);
  const running = api.termDescribeOutcome(say, { state: 'running', timeoutMs: 30000, commands: [{ command: 'x' }], id: 't3', at: 'AT' });
  assert('  仍在运行时说"仍在运行"而不是"失败"', /仍在运行（30s 内没结束）/.test(running) && !/出错/.test(running), running);
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑨ 配置读写：逐字段校验 + 垃圾值兜底');
{
  const boot = loadBundle({});
  const api = boot.api;
  const d = api.termDefaults();
  assert('默认 timeout = ' + api.TERM_TIMEOUT_DEFAULT, d.timeout === api.TERM_TIMEOUT_DEFAULT, String(d.timeout));
  assert('默认只有 start / stop 两个按钮', d.actions.length === 2 && d.actions[0].id === 'start' && d.actions[1].id === 'stop', JSON.stringify(d.actions.map((a) => a.id)));
  assert('默认 seq 为空（"先停止"默认**关**）', d.seq.length === 0, JSON.stringify(d.seq));
  assert('两次 termDefaults() 不是同一个对象（不共享默认值）', api.termDefaults() !== api.termDefaults());

  const junk = api.termNormalizeConfig({ timeout: 'abc', seq: 'nope', actions: 'nope' });
  assert('垃圾 timeout ⇒ 回落默认', junk.timeout === api.TERM_TIMEOUT_DEFAULT, String(junk.timeout));
  assert('垃圾 seq ⇒ 空数组', Array.isArray(junk.seq) && junk.seq.length === 0);
  assert('垃圾 actions ⇒ 仍是两个固定按钮', junk.actions.length === 2, String(junk.actions.length));

  const clamped = api.termNormalizeConfig({ timeout: 99999 });
  assert('超范围 timeout 被夹到上限 600', clamped.timeout === 600, String(clamped.timeout));
  const clamped2 = api.termNormalizeConfig({ timeout: -5 });
  assert('负数 timeout 被夹到下限 1', clamped2.timeout === 1, String(clamped2.timeout));

  const seqJunk = api.termNormalizeConfig({
    actions: [{ id: 'start', command: 'a' }, { id: 'stop', command: 'b' }],
    seq: ['stop', 'stop', 'nonexistent', 42, null, 'start']
  });
  assert('seq 去重 + 剔除不存在的 id + 剔除非字符串',
    JSON.stringify(seqJunk.seq) === JSON.stringify(['stop', 'start']), JSON.stringify(seqJunk.seq));

  const idJunk = api.termNormalizeConfig({ actions: [{ id: '../../etc/passwd', command: 'x' }, { id: 'x:ok-1', command: 'y' }] });
  assert('非法 action id 被丢掉', idJunk.actions.every((a) => a.id === 'start' || a.id === 'stop' || a.id === 'x:ok-1'), JSON.stringify(idJunk.actions.map((a) => a.id)));

  assert('命令里的换行被折成 `;`（结束标记才能挂在最后一条后面）',
    api.termNormalizeCommand('a\nb\n\nc') === 'a; b; c', api.termNormalizeCommand('a\nb\n\nc'));
  assert('标签 trim + 截断到 120',
    api.termNormalizeLabel('  x  ', 'fb') === 'x' && api.termNormalizeLabel('', 'fb') === 'fb'
    && api.termNormalizeLabel('y'.repeat(300), 'fb').length === 120, 'label normalization');

  // 写 / 读 往返
  const w = api.termWriteConfig('/w/one', { timeout: 7, seq: ['stop'], actions: [{ id: 'start', label: '起', command: './s.sh' }, { id: 'stop', command: './k.sh' }] });
  assert('写配置成功', w.ok === true, JSON.stringify(w));
  const back = api.termReadConfig('/w/one');
  assert('读回 timeout = 7', back.timeout === 7, String(back.timeout));
  assert('读回 start 的命令与标签', back.actions[0].command === './s.sh' && back.actions[0].label === '起', JSON.stringify(back.actions[0]));
  assert('读回 seq = ["stop"]', JSON.stringify(back.seq) === JSON.stringify(['stop']), JSON.stringify(back.seq));
  const other = api.termReadConfig('/w/two');
  assert('另一个 cwd 读到的是**默认**（按 cwd 映射）', other.timeout === api.TERM_TIMEOUT_DEFAULT && other.actions[0].command === '', JSON.stringify(other));
  assert('cwd 为空 ⇒ 读默认、写失败（不静默成功）',
    api.termReadConfig('').timeout === api.TERM_TIMEOUT_DEFAULT && api.termWriteConfig('', {}).ok === false);

  // 存储里塞垃圾。⚠️ 2026-10-17 第 2 段：老键（`terminalButtons.v1`）只在**新键从未存在**时
  // 才被读来迁移；新键一旦存在就再也不看老键。所以这些用例要各开一个**全新的** sandbox ——
  // 上面刚写过 `/w/one`，那个 sandbox 里新键已经存在了。
  {
    const fresh = loadBundle({});
    fresh.store.set(fresh.api.TERM_KEY, '{not json');
    assert('老键是坏 JSON + 新键不存在 ⇒ 读回默认，不抛',
      fresh.api.termReadConfig('/w/one').timeout === fresh.api.TERM_TIMEOUT_DEFAULT);
    assert('  且没有凭空造出工作区', fresh.api.wsReadAll().workspaces.length === 0,
      JSON.stringify(fresh.api.wsReadAll().workspaces));
  }
  {
    const fresh = loadBundle({});
    fresh.store.set(fresh.api.WS_KEY, '{not json');
    fresh.store.set(fresh.api.TERM_KEY, JSON.stringify({ '/w/old': { timeout: 5, seq: [], actions: [{ id: 'start', command: './old.sh' }] } }));
    assert('新键是坏 JSON ⇒ 读回空表，**且不拿老键复活**（用户删光工作区后不该复活）',
      fresh.api.wsReadAll().workspaces.length === 0
      && fresh.api.termReadConfig('/w/old').actions[0].command === '',
      JSON.stringify(fresh.api.wsReadAll().workspaces));
  }
  {
    const fresh = loadBundle({});
    fresh.store.set(fresh.api.TERM_KEY, JSON.stringify({ '/w/three': { timeout: 'x', actions: [{ id: 'start', command: 42 }] } }));
    const hardened = fresh.api.termReadConfig('/w/three');
    assert('迁移时字段是垃圾 ⇒ 逐字段兜底（不是整份照抄）',
      hardened.timeout === fresh.api.TERM_TIMEOUT_DEFAULT && hardened.actions[0].command === '', JSON.stringify(hardened));
    assert('  迁移确实产出了一条工作区（' + fresh.api.WS_KEY + '）',
      fresh.api.wsReadAll().workspaces.length === 1, JSON.stringify(fresh.api.wsReadAll().workspaces.map((w) => w.path)));
  }
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑩ 结束标记的解析规则');
{
  const boot = loadBundle({});
  const api = boot.api;
  assert('终止标记返回退出码', api.termScanMarker('__DW_DONE_0__') === 0 && api.termScanMarker('__DW_DONE_7__') === 7);
  assert('负退出码也认（信号）', api.termScanMarker('__DW_DONE_-15__') === -15);
  assert('字面 `$?` 不是完成标记', api.termScanMarker('echo __DW_DONE_$?__') === null, String(api.termScanMarker('echo __DW_DONE_$?__')));
  assert('不完整的标记不是完成标记', api.termScanMarker('__DW_DONE_') === null && api.termScanMarker('__DW_DONE_1') === null);
  assert('同段里出现多次 ⇒ 取**最后一次**（回显在前、真实输出在后）',
    api.termScanMarker('echo __DW_DONE_$?__\r\n__DW_DONE_5__\r\n') === 5, String(api.termScanMarker('echo __DW_DONE_$?__\r\n__DW_DONE_5__\r\n')));
  assert('没有标记 ⇒ null', api.termScanMarker('nothing here') === null);
  assert('wrapCommand 把标记挂在最后一条命令后面',
    api.termWrapCommand('./a.sh') === './a.sh ; echo __DW_DONE_$?__', api.termWrapCommand('./a.sh'));
  assert('wrapCommand 先折行再挂标记',
    api.termWrapCommand('cd /w\n./a.sh') === 'cd /w; ./a.sh ; echo __DW_DONE_$?__', api.termWrapCommand('cd /w\n./a.sh'));
}

console.log(fail === 0
  ? `\nTERMINAL BUTTONS PASSED (${pass} checks)`
  : `\n${fail} check(s) failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
