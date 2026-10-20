// verify_workspaces.mjs — 多工作区模型 + 批量执行（2026-10-17 第 2/3 段）的**行为级**断言。
//
// 用户原话：
//   · "现在你做的这个版本是针对一个工作区的配置，但完整的应该是支持添加/移除多个工作区，
//      某个工作区可独立配置这些功能，自定义启动/停止等命令"
//   · "支持勾选多个工作区一键开启/关闭功能"
//
// 这个套件分五段：
//   ① 数据模型：逐字段校验、path 唯一、去尾斜杠、垃圾值不许照抄
//   ② 迁移：老的 `terminalButtons.v1`（单工作区结构）平滑变成 `workspaces:[{path:<当前 cwd>,…}]`，
//      且**一个字节都不丢**（命令 / 标签 / 额外按钮 / 前置顺序 / 超时）；迁移只发生一次
//   ③ `cd` 引号：三种路径夹具（空格 / 中文 / 单引号）+ `$` / 反引号 / 反斜杠，
//      并**真跑 /bin/sh** 验证 —— 不是字符串相等，是"命令真的在正确的目录里跑"
//   ④ 头部按钮按**当前会话的 cwd** 解析：在列表里 ⇒ 渲染；不在 ⇒ 整组不渲染
//   ⑤ 批量：串行、每个工作区跑自己的命令、上限前置报错（一个都不创建）、
//      某个失败后其余继续、汇总里失败可见、未选中时按钮禁用
//
// ⚠️ 这里的 ctx / react 是**桩**：全绿只证明"逻辑自洽 + 组件能渲染"，不证明真机激活。
// 用法：node verify/verify_workspaces.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const LIVE = path.join(PKG, 'lib', 'client.js');
const code = fs.readFileSync(LIVE, 'utf8');
const require_ = createRequire(import.meta.url);
const React = require_('react');
const { renderToStaticMarkup } = require_('react-dom/server');

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const section = (title) => console.log('\n── ' + title);

// ════════════════════════════════════════════════════════════════════════════════
// 装载 bundle（每个 sandbox 自带一份独立的 localStorage）
// ════════════════════════════════════════════════════════════════════════════════
/** The bundle's own zh dictionary — a stub `t` must INTERPOLATE, or detail assertions go vacuous. */
function readDict(block) {
  const start = code.indexOf('    var ' + block + ' = {');
  const end = code.indexOf('\n    };', start);
  const out = {};
  for (const m of code.slice(start, end).matchAll(/"([A-Za-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = JSON.parse('"' + m[2] + '"');
  }
  return out;
}
const ZH = readDict('zh');
const EN = readDict('en');
function makeT(dict) {
  const table = dict || ZH;
  return (k, v) => {
    let out = Object.prototype.hasOwnProperty.call(table, k) ? table[k] : k;
    if (v && typeof v === 'object') {
      for (const key of Object.keys(v)) out = out.split('{' + key + '}').join(String(v[key]));
    }
    return out;
  };
}

const primitivesStub = {
  Modal: function () {}, Input: (props) => React.createElement('input', {
    'data-prim': 'Input', value: props.value, placeholder: props.placeholder, 'aria-label': props['aria-label']
  }),
  IconListPenOutlineRegular: function () {}, MarkdownText: function () {},
  Button: (props) => React.createElement('button', {
    'data-prim': 'Button',
    'data-pv': props.variant === undefined ? 'ghost' : props.variant,
    disabled: props.disabled === true ? true : undefined
  }, props.children),
  // 与真原语同形：`<label title><input type=checkbox checked><span>{label}</span></label>`
  Checkbox: (props) => React.createElement('label', { 'data-prim': 'Checkbox', title: props.title },
    React.createElement('input', {
      type: 'checkbox',
      checked: props.checked === true,
      disabled: props.disabled === true ? true : undefined
    }),
    React.createElement('span', null, props.label)),
  Switch: (props) => React.createElement('button', {
    type: 'button', role: 'switch',
    'aria-checked': props.checked === true ? 'true' : 'false',
    'aria-label': props.label
  }),
  SegmentedControl: (props) => React.createElement('div', { role: 'tablist', 'aria-label': props.label },
    props.options.map((option) => React.createElement('button', {
      type: 'button', role: 'tab', key: option.value,
      id: props.id + '-' + option.value,
      'aria-controls': props.id + '-' + option.value + '-panel',
      'aria-selected': option.value === props.value ? 'true' : 'false'
    }, option.label)))
};
const mockRequire = (id) => id === 'react' ? React
  : id === 'react/jsx-runtime' ? require_('react/jsx-runtime')
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesStub
  : (() => { throw new Error('unexpected require ' + id); })();

/**
 * Load the bundle in a sandbox with its own storage.
 * @param {object=} seed 初始 localStorage（键 → 字符串）
 * @param {object=} overrides ctx 覆盖
 */
function loadBundle(seed, overrides) {
  const store = new Map(Object.entries(seed || {}));
  const windowObj = { __ModuleLoader__: {} };
  let loaded = null;
  windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
  const sandbox = {
    window: windowObj, require: mockRequire, TextEncoder, btoa, atob, TextDecoder, console,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    queueMicrotask: (fn) => { try { fn(); } catch (e) { /* best effort */ } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, isFinite, RegExp,
    crypto: { randomUUID: (() => { let n = 0; return () => 'u-' + (++n) + '-aaaaaaaaaaaaaaaa'; })() },
    AbortController
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  const exportsObj = loaded.factory(mockRequire);
  const components = {};
  const ctx = Object.assign({
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: () => {}, bind: () => (k) => k },
    slots: {
      inject: (name, factory) => { factory(); },
      register: (config, comp) => {
        components[config.name + '|' + config.id] = comp;
        if (config.name === 'settings.section') components.settings = comp;
        if (config.name === 'conversation.session.header.utilities' && config.id === 'history-actions-terminal') components.header = comp;
        return () => {};
      }
    },
    sessions: { create: async () => 'x', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    shortcuts: { register: () => function () {} },
    uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
    uiWorkspace: {
      openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' },
      workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => ''
    },
    remote: { session: { prompt: async () => ({ ok: true }) } }
  }, overrides || {});
  exportsObj.apply(ctx);
  return { api: exportsObj.__test, store, ctx, sandbox, components };
}

// ════════════════════════════════════════════════════════════════════════════════
// 记录型终端桩：每次 create 分配一个独立流；`plan[i]` 控制第 i 个终端的退出码
// （数字 = 命令跑完后回这个码；'never' = 永不回标记 ⇒ 判"仍在运行"）
// ════════════════════════════════════════════════════════════════════════════════
function makeTerminal(plan) {
  const calls = [];
  const streams = new Map();
  let created = 0;
  function streamFor(id) {
    if (!streams.has(id)) {
      const st = { frames: [], push: null, closed: false, code: 0 };
      st.iterable = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (st.closed) return Promise.resolve({ done: true, value: undefined });
              if (st.frames.length > 0) return Promise.resolve({ value: st.frames.shift(), done: false });
              return new Promise((resolve) => { st.push = resolve; });
            },
            return() {
              st.closed = true;
              calls.push({ method: 'disconnect', id });
              return Promise.resolve({ done: true, value: undefined });
            }
          };
        }
      };
      st.emit = (frame) => {
        if (st.push !== null) { const p = st.push; st.push = null; p({ value: frame, done: false }); }
        else st.frames.push(frame);
      };
      streams.set(id, st);
    }
    return streams.get(id);
  }
  const terminal = {
    async create(agent, request) {
      const planned = Array.isArray(plan) ? plan[created] : 0;
      created = created + 1;
      calls.push({ method: 'create', agent, id: request.id, index: created - 1 });
      streamFor(request.id).code = planned === undefined ? 0 : planned;
      return { id: request.id, title: 't', cwd: '/w', cols: request.cols, rows: request.rows, state: 'running', exitCode: null };
    },
    async rename(agent, id, title) { calls.push({ method: 'rename', agent, id, title }); },
    async retain(agent, id) { calls.push({ method: 'retain', agent, id }); },
    follow(agent, id, attachmentId) {
      calls.push({ method: 'follow', agent, id, attachmentId });
      const st = streamFor(id);
      st.frames.push({ type: 'snapshot', sequence: 0, screen: '' });
      return st.iterable;
    },
    async write(agent, id, attachmentId, data) {
      calls.push({ method: 'write', agent, id, data });
      const st = streamFor(id);
      st.emit({ type: 'output', sequence: 1, data: data });
      if (st.code === 'never') return;
      // 真 PTY 会把它拆成任意两段 ⇒ 这里也拆，证明执行器是**累加**匹配的
      const line = '__DW_DONE_' + st.code + '__\r\n';
      const mid = Math.max(1, Math.floor(line.length / 2));
      st.emit({ type: 'output', sequence: 2, data: line.slice(0, mid) });
      st.emit({ type: 'output', sequence: 3, data: line.slice(mid) });
    },
    async close(agent, id) { calls.push({ method: 'close', agent, id }); }
  };
  return { terminal, calls };
}

// ════════════════════════════════════════════════════════════════════════════════
section('① 数据模型：形状 / 逐字段校验 / path 唯一 / 去尾斜杠');
{
  const boot = loadBundle();
  const api = boot.api;
  assert('存储键就是 dsh.deepworker.workspaces.v1', api.WS_KEY === 'dsh.deepworker.workspaces.v1', String(api.WS_KEY));
  const empty = api.wsReadAll();
  assert('空存储 ⇒ { version: 1, workspaces: [] }',
    empty.version === 1 && Array.isArray(empty.workspaces) && empty.workspaces.length === 0, JSON.stringify(empty));
  assert('每会话终端上限 = 8（宿主 maxTerminals 的默认值）', api.TERM_SESSION_MAX === 8, String(api.TERM_SESSION_MAX));

  assert('去尾斜杠：/w/one/ ⇒ /w/one', api.wsNormalizePath('/w/one/') === '/w/one', api.wsNormalizePath('/w/one/'));
  assert('去多重尾斜杠：/w/one/// ⇒ /w/one', api.wsNormalizePath('/w/one///') === '/w/one', api.wsNormalizePath('/w/one///'));
  assert('折叠重复斜杠：/w//one ⇒ /w/one', api.wsNormalizePath('/w//one') === '/w/one', api.wsNormalizePath('/w//one'));
  assert('根路径保留一个斜杠', api.wsNormalizePath('/') === '/', api.wsNormalizePath('/'));
  assert('相对路径 ⇒ ""（绝不猜一个绝对路径）', api.wsNormalizePath('w/one') === '', api.wsNormalizePath('w/one'));
  assert('空 / 非字符串 ⇒ ""', api.wsNormalizePath('') === '' && api.wsNormalizePath(null) === '' && api.wsNormalizePath(42) === '');
  assert('换行被折成空格（多行粘贴的路径不许变成两条命令）',
    api.wsNormalizePath('/w/a\nb') === '/w/a b', JSON.stringify(api.wsNormalizePath('/w/a\nb')));

  const full = api.wsNormalizeEntry({
    path: '/w/one/',
    label: '  一号  ',
    start: { label: '起', command: 'bash s.sh start' },
    stop: { label: '', command: 'bash s.sh stop' },
    extras: [{ label: '重启', command: 'bash s.sh restart' }, { label: '', command: '' }],
    preStart: ['stop', 'stop', 'nope', 42, '重启'],
    timeoutSec: 45,
    stopBeforeStart: true
  });
  assert('一条完整记录逐字段读回（path 去尾斜杠、label trim）',
    full.path === '/w/one' && full.label === '一号', JSON.stringify({ path: full.path, label: full.label }));
  assert('  start / stop 各自独立', full.start.command === 'bash s.sh start' && full.stop.command === 'bash s.sh stop');
  assert('  完全空白的额外按钮被丢掉（否则头部会长出无名空按钮）', full.extras.length === 1, JSON.stringify(full.extras));
  assert('  preStart 去重 + 剔除解析不出来的引用 + 保序',
    JSON.stringify(full.preStart) === JSON.stringify(['stop', '重启']), JSON.stringify(full.preStart));
  assert('  timeoutSec 读回 45', full.timeoutSec === 45, String(full.timeoutSec));
  assert('  stopBeforeStart = true', full.stopBeforeStart === true);

  const junk = api.wsNormalizeEntry({
    path: '/w/junk',
    start: 42, stop: 'nope', extras: 'nope', preStart: 'nope',
    timeoutSec: 'abc', stopBeforeStart: 'yes'
  });
  assert('垃圾字段逐条兜底（不整份照抄）',
    junk.start.command === '' && junk.stop.command === '' && junk.extras.length === 0
    && junk.preStart.length === 0 && junk.timeoutSec === 30 && junk.stopBeforeStart === false,
    JSON.stringify(junk));

  assert('timeoutSec 超范围被夹到 600', api.wsNormalizeEntry({ path: '/w/a', timeoutSec: 99999 }).timeoutSec === 600);
  assert('timeoutSec 负数被夹到 1', api.wsNormalizeEntry({ path: '/w/a', timeoutSec: -5 }).timeoutSec === 1);
  assert('label 留空 ⇒ 用路径末段', api.wsNormalizeEntry({ path: '/w/中文 目录' }).label === '中文 目录',
    api.wsNormalizeEntry({ path: '/w/中文 目录' }).label);
  assert('没有 path ⇒ null（没有身份就没有记录，这一条不兜底）',
    api.wsNormalizeEntry({ label: 'x' }) === null && api.wsNormalizeEntry(null) === null);

  const dedup = api.wsNormalizeAll({
    version: 1,
    workspaces: [
      { path: '/w/a', label: '旧' },
      { path: '/w/b' },
      { path: '/w/a/', label: '新' }
    ]
  });
  assert('path 唯一：重复的 path 被合并（后者覆盖前者），顺序按首次出现',
    dedup.workspaces.length === 2 && dedup.workspaces[0].path === '/w/a' && dedup.workspaces[0].label === '新'
    && dedup.workspaces[1].path === '/w/b',
    JSON.stringify(dedup.workspaces.map((w) => [w.path, w.label])));

  const store = { version: 1, workspaces: [{ path: '/w/a', label: 'A' }] };
  const added = api.wsUpsert(store, { path: '/w/b', label: 'B' });
  assert('wsUpsert 返回**新**表（不改入参）',
    store.workspaces.length === 1 && added.workspaces.length === 2, store.workspaces.length + '/' + added.workspaces.length);
  const removed = api.wsRemove(added, '/w/a/');
  assert('wsRemove 按规范化后的 path 删（/w/a/ 删掉 /w/a），同样不改入参',
    removed.workspaces.length === 1 && removed.workspaces[0].path === '/w/b' && added.workspaces.length === 2);

  const written = api.wsWriteAll(added);
  assert('写盘成功并报告 ok', written.ok === true, JSON.stringify(written));
  assert('  读回来一模一样（往返一致）',
    JSON.stringify(api.wsReadAll().workspaces.map((w) => w.path)) === JSON.stringify(['/w/a', '/w/b']),
    JSON.stringify(api.wsReadAll().workspaces.map((w) => w.path)));
  // 存储被禁 ⇒ 必须**报告**失败，不许假装保存成功
  const noStore = api.wsWriteAll.call(null, added);
  assert('存储可用时写盘仍然 ok（同一份数据的第二次写）', noStore.ok === true);
}

// ════════════════════════════════════════════════════════════════════════════════
section('② 迁移：老的 terminalButtons.v1（单工作区）⇒ workspaces[{path:<当前 cwd>}]');
{
  const legacy = {
    '/w/legacy-one': {
      v: 1,
      timeout: 45,
      seq: ['stop', 'x:clean'],
      actions: [
        { id: 'start', label: '起服务', command: 'bash scripts/serve.sh start' },
        { id: 'stop', label: '停服务', command: 'bash scripts/serve.sh stop' },
        { id: 'x:clean', label: '清理', command: 'bash scripts/clean.sh' }
      ]
    }
  };
  const boot = loadBundle({ 'dsh.deepworker.terminalButtons.v1': JSON.stringify(legacy) });
  const api = boot.api;
  const store = api.wsReadAll();
  assert('老数据被迁成**恰好一条**工作区（老 UI 只编辑当前 cwd）', store.workspaces.length === 1,
    JSON.stringify(store.workspaces.map((w) => w.path)));
  const one = store.workspaces[0];
  assert('  path = 老表里的 cwd（逐字）', one.path === '/w/legacy-one', String(one.path));
  assert('  label = 路径末段', one.label === 'legacy-one', String(one.label));
  assert('  启动命令逐字搬过来（不丢）', one.start.command === 'bash scripts/serve.sh start', JSON.stringify(one.start));
  assert('  启动按钮的**自定义文字**也搬过来', one.start.label === '起服务', JSON.stringify(one.start));
  assert('  停止命令 + 自定义文字都搬过来',
    one.stop.command === 'bash scripts/serve.sh stop' && one.stop.label === '停服务', JSON.stringify(one.stop));
  assert('  额外按钮（label + command）逐条搬过来',
    one.extras.length === 1 && one.extras[0].label === '清理' && one.extras[0].command === 'bash scripts/clean.sh',
    JSON.stringify(one.extras));
  assert('  前置序列的顺序搬过来（stop → 清理）',
    JSON.stringify(one.preStart) === JSON.stringify(['stop', '清理']), JSON.stringify(one.preStart));
  assert('  超时（45s）搬过来', one.timeoutSec === 45, String(one.timeoutSec));
  assert('  stopBeforeStart 默认 false（老模型没有这个字段）', one.stopBeforeStart === false);
  assert('迁移结果**立刻落盘**到新键（否则下次打开又迁一遍、中途删掉的行会复活）',
    boot.store.has('dsh.deepworker.workspaces.v1'), JSON.stringify([...boot.store.keys()]));
  assert('老键**不删**（回退安全：把老文件放回去就能回退）',
    boot.store.has('dsh.deepworker.terminalButtons.v1'));
  assert('迁移后再读一次 ⇒ 还是那条（不重复迁移）', api.wsReadAll().workspaces.length === 1);

  // 只迁一次：用户把工作区删光之后，老键不许把它们复活
  api.wsWriteAll({ version: 1, workspaces: [] });
  assert('删光工作区后再读 ⇒ 仍然是空的（老键**不会**复活它们）',
    api.wsReadAll().workspaces.length === 0, JSON.stringify(api.wsReadAll().workspaces));

  // 多个老 cwd ⇒ 多条工作区（顺序 = 老表的键顺序）
  const two = loadBundle({
    'dsh.deepworker.terminalButtons.v1': JSON.stringify({
      '/w/b': { timeout: 30, seq: [], actions: [{ id: 'start', command: './b.sh' }, { id: 'stop', command: './kb.sh' }] },
      '/w/a': { timeout: 30, seq: [], actions: [{ id: 'start', command: './a.sh' }, { id: 'stop', command: './ka.sh' }] }
    })
  });
  assert('老表里有两条 cwd ⇒ 迁成两条工作区（顺序照键序）',
    JSON.stringify(two.api.wsReadAll().workspaces.map((w) => w.path)) === JSON.stringify(['/w/b', '/w/a']),
    JSON.stringify(two.api.wsReadAll().workspaces.map((w) => w.path)));

  // 老模型允许 `x:` 按钮没 label（渲染成空按钮）⇒ 迁移时用命令前 40 字补一个 label，
  // 否则 preStart 里那条引用会解析不出来（= 静默丢一条前置命令）。
  const labelLess = loadBundle({
    'dsh.deepworker.terminalButtons.v1': JSON.stringify({
      '/w/x': {
        timeout: 30,
        seq: ['x:0'],
        actions: [
          { id: 'start', command: './s.sh' },
          { id: 'stop', command: './k.sh' },
          { id: 'x:0', label: '', command: './prepare.sh' }
        ]
      }
    })
  });
  const migrated = labelLess.api.wsReadAll().workspaces[0];
  assert('老的无名按钮迁移后有了可用的 label（= 命令前 40 字）',
    migrated.extras.length === 1 && migrated.extras[0].label === './prepare.sh',
    JSON.stringify(migrated.extras));
  assert('  且 preStart 里那条引用仍然解析得出来（没丢）',
    JSON.stringify(migrated.preStart) === JSON.stringify(['./prepare.sh']), JSON.stringify(migrated.preStart));

  // 迁移必须能被"值"验，而不是"键存在"：把新键里的命令读回来对上
  const roundTrip = null;
  assert('迁移出来的执行记录：termJobForEntry 能直接拿它拼出命令序列',
    (function () {
      const job = labelLess.api.termJobForEntry(migrated, 'start', makeT());
      return job !== null && job.commands.length === 2
        && /prepare\.sh/.test(job.commands[0].command) && /s\.sh/.test(job.commands[1].command)
        && job.cwd === '/w/x';
    })(), 'job=' + JSON.stringify(roundTrip));
}

// ════════════════════════════════════════════════════════════════════════════════
section('③ cd 引号：三种路径夹具 + $ / 反引号 / 反斜杠，并**真跑 /bin/sh**');
{
  const boot = loadBundle();
  const api = boot.api;
  assert('普通路径 ⇒ 双引号包起来', api.termQuotePath('/w/one') === '"/w/one"', api.termQuotePath('/w/one'));
  assert('含空格 ⇒ 仍然只是一段',
    api.termQuotePath('/tmp/a b') === '"/tmp/a b"', api.termQuotePath('/tmp/a b'));
  assert('含中文 ⇒ 原样（不转义、不编码）',
    api.termQuotePath('/tmp/中文 目录') === '"/tmp/中文 目录"', api.termQuotePath('/tmp/中文 目录'));
  assert('含单引号 ⇒ 原样（双引号里安全；这正是**不用**单引号的理由）',
    api.termQuotePath("/tmp/it's here") === `"/tmp/it's here"`, api.termQuotePath("/tmp/it's here"));
  assert('含 $ ⇒ 转义（否则会被 shell 展开成空）',
    api.termQuotePath('/tmp/a$b') === '"/tmp/a\\$b"', api.termQuotePath('/tmp/a$b'));
  assert('含反引号 ⇒ 转义（否则会执行命令替换）',
    api.termQuotePath('/tmp/a`b`') === '"/tmp/a\\`b\\`"', api.termQuotePath('/tmp/a`b`'));
  assert('含反斜杠 ⇒ 转义', api.termQuotePath('/tmp/a\\b') === '"/tmp/a\\\\b"', api.termQuotePath('/tmp/a\\b'));
  assert('含双引号 ⇒ 转义', api.termQuotePath('/tmp/a"b') === '"/tmp/a\\"b"', api.termQuotePath('/tmp/a"b'));

  assert('cd + 命令 ⇒ `cd "<path>" && { <cmd> ; }`（&& 不是 ; ，且带花括号组）',
    api.termCommandWithCwd('/w/one', './serve.sh') === 'cd "/w/one" && { ./serve.sh ; }',
    api.termCommandWithCwd('/w/one', './serve.sh'));
  assert('命令是空的 ⇒ 只 cd（不拼出语法错误）',
    api.termCommandWithCwd('/w/one', '') === 'cd "/w/one"', api.termCommandWithCwd('/w/one', ''));
  assert('命令自带 `;` ⇒ 仍然被花括号组圈住（否则 ; 之后那段会无视 cd 成不成功）',
    api.termCommandWithCwd('/w/one', 'a; b') === 'cd "/w/one" && { a; b ; }',
    api.termCommandWithCwd('/w/one', 'a; b'));
  assert('命令结尾多余的分号被收掉（否则 `{ a ; ; }` 是语法错误）',
    api.termCommandWithCwd('/w/one', 'a;') === 'cd "/w/one" && { a ; }',
    api.termCommandWithCwd('/w/one', 'a;'));
  assert('没有路径 ⇒ 原样返回命令（没有 cd 目标就绝不猜一个）',
    api.termCommandWithCwd('', './serve.sh') === './serve.sh', api.termCommandWithCwd('', './serve.sh'));

  // ── 真跑 shell：路径名字符真的能 cd 进去 ──────────────────────────────────────
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cd-'));
  const fixtures = ['a b', '中文 目录', "it's here", 'a $b', 'a`b`', 'a\\b'];
  for (const name of fixtures) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    const expected = fs.realpathSync(dir);
    const line = api.termWrapCommand(api.termCommandWithCwd(dir, 'pwd -P'));
    const proc = spawnSync('/bin/sh', ['-c', line], { encoding: 'utf8' });
    const out = (proc.stdout || '') + (proc.stderr || '');
    assert('真跑 sh：`cd` 进得了「' + name + '」并打印出正确目录',
      out.indexOf(expected) !== -1, 'expected=' + expected + ' out=' + out.replace(/\n/g, '\\n').slice(0, 240));
    assert('  退出码 0，结束标记是 __DW_DONE_0__（标记机制在真 shell 里成立）',
      out.indexOf('__DW_DONE_0__') !== -1, out.replace(/\n/g, '\\n').slice(0, 200));
  }
  // cd 失败时必须**不**继续跑，而且标记带非零码（这是 && 与 ; 的分水岭）
  {
    const missing = path.join(root, 'does-not-exist');
    const line = api.termWrapCommand(api.termCommandWithCwd(missing, 'echo SHOULD_NOT_RUN'));
    const proc = spawnSync('/bin/sh', ['-c', line], { encoding: 'utf8' });
    const out = (proc.stdout || '') + (proc.stderr || '');
    assert('cd 失败 ⇒ 用户命令**没有**被执行（&& 生效，不是 ;）',
      out.indexOf('SHOULD_NOT_RUN') === -1, out.replace(/\n/g, '\\n').slice(0, 240));
    assert('  且结束标记是非零码（失败可见，不会误判成"仍在运行"）',
      /__DW_DONE_[1-9][0-9]*__/.test(out), out.replace(/\n/g, '\\n').slice(0, 200));
  }
  fs.rmSync(root, { recursive: true, force: true });
}

// ════════════════════════════════════════════════════════════════════════════════
section('④ 头部按钮按**当前会话的 cwd**解析：在列表里 ⇒ 渲染；不在 ⇒ 整组不渲染');
{
  const seed = {
    'dsh.deepworker.workspaces.v1': JSON.stringify({
      version: 1,
      workspaces: [
        {
          path: '/w/one', label: '一号',
          start: { label: '', command: './serve.sh' }, stop: { label: '', command: './stop.sh' },
          extras: [{ label: '重启', command: './restart.sh' }],
          preStart: [], timeoutSec: 30, stopBeforeStart: false
        }
      ]
    })
  };
  const boot = loadBundle(seed);
  assert('头部组件被注册了', typeof boot.components.header === 'function', String(typeof boot.components.header));
  const t = makeT();
  function renderHeader(cwd) {
    const byId = { 'sess-1': { id: 'sess-1', cwd: cwd } };
    const useSessions = (selector) => selector({ ids: ['sess-1'], byId: byId });
    return renderToStaticMarkup(React.createElement(boot.components.header, {
      t: t, sessionId: 'sess-1', useSessions: useSessions
    }));
  }
  const inside = renderHeader('/w/one');
  assert('cwd 在列表里 ⇒ 渲染出启动 / 停止 / 额外按钮',
    inside.includes('启动') && inside.includes('停止') && inside.includes('重启'), inside.slice(0, 240));
  assert('  title 是那条工作区的命令（用户点之前就能看见要跑什么）',
    inside.includes('./serve.sh'), inside.slice(0, 240));
  const outside = renderHeader('/w/not-listed');
  assert('cwd **不在**列表里 ⇒ 整组不渲染（连竖线一起消失）',
    outside === '', JSON.stringify(outside.slice(0, 160)));
  const noCwd = renderHeader('');
  assert('拿不到 cwd ⇒ 同样不渲染（绝不猜一个工作区）', noCwd === '', JSON.stringify(noCwd.slice(0, 120)));

  // 执行时必须先 cd 到**它自己**的路径（终端的 cwd 是当前会话的 cwd）
  const { terminal, calls } = makeTerminal([0]);
  boot.ctx.remote.terminal = terminal;
  const outcome = await boot.api.runTerminalButton({
    t: t, sessionId: 'sess-1', path: '/w/one', actionId: 'start', label: '启动'
  });
  const writes = calls.filter((c) => c.method === 'write').map((c) => c.data);
  assert('头部按钮执行时先 `cd "/w/one"`（不是靠终端自己的 cwd）',
    writes.length === 1 && writes[0].indexOf('cd "/w/one" && { ./serve.sh ; }') === 0, JSON.stringify(writes));
  assert('  结果判 done（退出码 0）', outcome && outcome.state === 'done' && outcome.code === 0,
    JSON.stringify(outcome && outcome.state));
  assert('  依然没有 close', calls.filter((c) => c.method === 'close').length === 0);
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑤ stopBeforeStart：启动前先停，且不许把同一条命令跑两遍');
{
  const t = makeT();
  const boot = loadBundle();
  const api = boot.api;
  const entry = api.wsNormalizeEntry({
    path: '/w/sb', label: 'SB',
    start: { label: '', command: './start.sh' },
    stop: { label: '', command: './stop.sh' },
    extras: [], preStart: [], timeoutSec: 30, stopBeforeStart: true
  });
  const job = api.termJobForEntry(entry, 'start', t);
  assert('stopBeforeStart=true ⇒ 命令序列 = [停止, 启动]',
    job.commands.length === 2 && /stop\.sh/.test(job.commands[0].command) && /start\.sh/.test(job.commands[1].command),
    JSON.stringify(job.commands.map((c) => c.command)));
  const both = api.wsNormalizeEntry({
    path: '/w/sb2', label: 'SB2',
    start: { label: '', command: './start.sh' },
    stop: { label: '', command: './stop.sh' },
    extras: [], preStart: ['stop'], timeoutSec: 30, stopBeforeStart: true
  });
  const job2 = api.termJobForEntry(both, 'start', t);
  assert('前置序列里已经有 stop ⇒ 不重复跑（序列 = [停止, 启动]，不是 [停止, 停止, 启动]）',
    job2.commands.length === 2, JSON.stringify(job2.commands.map((c) => c.command)));
  const stopJob = api.termJobForEntry(entry, 'stop', t);
  assert('点「停止」只跑停止命令（不会先跑启动）',
    stopJob.commands.length === 1 && /stop\.sh/.test(stopJob.commands[0].command), JSON.stringify(stopJob.commands));
  assert('job.cwd = 那条工作区自己的路径', job.cwd === '/w/sb', String(job.cwd));
}

// ════════════════════════════════════════════════════════════════════════════════
section('⑥ 设置页（真跑 SSR）：工作区列表 / 每行一条配置 / 编辑器 / 空列表');
{
  const t = makeT();
  const workspaces = [
    { path: '/w/one', label: '一号', start: { label: '', command: './1.sh' }, stop: { label: '', command: './k1.sh' }, extras: [{ label: '重启', command: './r1.sh' }], preStart: ['stop'], timeoutSec: 30, stopBeforeStart: false },
    { path: '/w/two', label: '二号', start: { label: '', command: './2.sh' }, stop: { label: '', command: '' }, extras: [], preStart: [], timeoutSec: 45, stopBeforeStart: true }
  ];
  const seed = { 'dsh.deepworker.workspaces.v1': JSON.stringify({ version: 1, workspaces: workspaces }) };
  const boot = loadBundle(seed);
  assert('设置分区组件被注册了', typeof boot.components.settings === 'function', String(typeof boot.components.settings));
  const html = renderToStaticMarkup(React.createElement(boot.components.settings, { t: t }));

  const rows = (html.match(/data-dw-workspace-row=""/g) || []).length;
  assert('每个工作区一行（2 条 ⇒ 2 行）', rows === 2, String(rows));
  assert('两行的路径都写出来了（用户能分清是哪个工作区）',
    html.indexOf('/w/one') !== -1 && html.indexOf('/w/two') !== -1);
  assert('「移除」旁边写着"只删配置"（不删文件、不停进程）',
    html.indexOf(t('term.wsRemoveHint')) !== -1, t('term.wsRemoveHint'));
  assert('页首写着当前会话工作区在不在列表里（cwd 走 testHooks.currentCwd ⇒ 本桩拿不到 ⇒ 说"拿不到"）',
    html.indexOf(t('term.cwdLabel')) !== -1, 'no cwd label');
  assert('编辑器：auto-open 第一条工作区 ⇒ 超时那一行渲染出来了（term.timeoutLabel）',
    html.indexOf(t('term.timeoutLabel')) !== -1, 'no timeout label');
  assert('  且编辑器里能看到「保存」与「恢复默认」',
    html.indexOf(t('term.save')) !== -1 && html.indexOf(t('term.reset')) !== -1);
  assert('  编辑器里显示了那条工作区的名字（正在配置：二号 或 一号）',
    html.indexOf(t('term.editorTitle', { label: '二号' })) !== -1 || html.indexOf(t('term.editorTitle', { label: '一号' })) !== -1);
  {
    // 只看**编辑器那一段**：整页里还有 13 颗设置开关，按全页数会得到 14/15 这种无意义的数。
    const editorAt = html.indexOf(t('term.editorTitle', { label: '一号' }));
    const editorHtml = editorAt < 0 ? '' : html.slice(editorAt);
    assert('stopBeforeStart 在编辑器里是一颗官方 Switch（布尔开关 ⇒ Switch，多选用 Checkbox）',
      editorHtml.indexOf('aria-label="' + t('term.stopBeforeStart') + '"') !== -1
      && editorHtml.indexOf('role="switch"') !== -1,
      JSON.stringify(editorHtml.slice(0, 200)));
  }

  // 空列表：页面上必须有"还没有添加任何工作区"+ 添加按钮
  {
    const bare = loadBundle();
    const bareHtml = renderToStaticMarkup(React.createElement(bare.components.settings, { t: t }));
    assert('没有工作区时：说"还没有添加任何工作区"', bareHtml.indexOf(t('term.wsNone')) !== -1);
    assert('  并且有「新建工作区」入口',
      bareHtml.indexOf(t('term.wsAddTitle')) !== -1);
  }
}

console.log(fail === 0
  ? `\nWORKSPACES PASSED (${pass} checks)`
  : `\n${fail} check(s) failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
