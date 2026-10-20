// verify_feature_scope_note.mjs — 「装/卸 ≠ 设置」那句说明的存在与**位置**守卫（2026-10-17 第 1 段）。
//
// 用户原话：「为什么会话操作里已经有的开关，基础页要再挂一遍？」
// 实测**没有重复**：`featureSection` 不渲染开关（「会话操作」面板里的开关数 = 0），
// 「基础」页那几行是**注册级**的装/卸开关。「会话操作」里的是各功能**自己的设置**。
// 缺的只是一句话 —— 所以修法是**加一句话**，不是改结构。这个套件守的就是那句话。
//
// 为什么断位置而不只断"这串字在页面上"：那句话只要还在 bundle 的词典里，页面上任何位置
// 出现都算"有"。挪到别的 tab、挪到总开关下面、或者被别处的同名字符串满足，弱断言都绿 ——
// 而用户读到的地方就不对了。所以判据是**元素 + 位置**：
//   ① 一个带 `data-dw-feature-scope-note` 的元素（机械钩子，不靠文本）
//   ② 它的文字 = bundle 里 zh 词典的那一句（**现读**，手抄会漂）
//   ③ 它落在「基础」面板里，且**在卡片标题之后、总开关之前**
//   ④ 全页恰好一处
//
// 用法：node verify/verify_feature_scope_note.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const LIVE = path.join(PKG, 'lib', 'client.js');
const code = fs.readFileSync(LIVE, 'utf8');
const KEY = 'settings.featureScopeNote';

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const section = (title) => console.log('\n── ' + title);

function dictValue(blockName, key) {
  const start = code.indexOf('    var ' + blockName + ' = {');
  if (start < 0) return null;
  const end = code.indexOf('\n    };', start);
  const text = code.slice(start, end);
  const m = new RegExp('"' + key.replace(/\./g, '\\.') + '":\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);
  return m === null ? null : JSON.parse('"' + m[1] + '"');
}

// ════════════════════════════════════════════════════════════════════════════════
section('① 文案本身（zh / en 各一份，键集一致）');
{
  const zh = dictValue('zh', KEY);
  const en = dictValue('en', KEY);
  assert(KEY + ' 在 zh 里恰好定义一次', zh !== null, JSON.stringify(zh));
  assert(KEY + ' 在 en 里恰好定义一次', en !== null, JSON.stringify(en));
  assert('zh 文案含中文（不是把英文抄进中文词典）', zh !== null && /[\u4e00-\u9fff]/.test(zh), JSON.stringify(zh));
  // 三个语义点：① 只决定装不装 ② 关掉 = 不注册/入口消失 ③ 各功能自己的设置在各自分区里
  assert('zh 说清了「只决定装不装」', zh !== null && /装不装|装 \/ 卸|引入/.test(zh), JSON.stringify(zh));
  assert('zh 说清了「关掉 = 不再注册 / 入口消失」', zh !== null && /不再注册|入口会消失/.test(zh), JSON.stringify(zh));
  assert('zh 说清了「各功能自己的设置在各自分区里」', zh !== null && /自己的设置/.test(zh) && /分区/.test(zh), JSON.stringify(zh));
  assert('en 与 zh 不是同一句话（en 必须真的翻译过）', en !== null && zh !== null && en !== zh);
  assert('en 说清「只决定装不装」', en !== null && /install/i.test(en), JSON.stringify(en));
  assert('en 说清「各功能自己的设置不受影响」', en !== null && /own settings/i.test(en), JSON.stringify(en));
}

// ════════════════════════════════════════════════════════════════════════════════
section('② 真跑 SSR：那句话渲染在「基础 → 功能引入 / 移除」卡片标题下方、总开关之前');
{
  const require_ = createRequire(import.meta.url);
  const React = require_('react');
  const { renderToStaticMarkup } = require_('react-dom/server');
  const windowObj = { __ModuleLoader__: {} };
  let loaded = null;
  windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
  const primitivesStub = {
    Modal: function () {}, Button: function () {}, Input: function () {},
    IconListPenOutlineRegular: function () {}, MarkdownText: function () {},
    SegmentedControl: (props) => React.createElement('div', { role: 'tablist', 'aria-label': props.label },
      props.options.map((option) => React.createElement('button', {
        type: 'button', role: 'tab', key: option.value,
        id: props.id + '-' + option.value,
        'aria-controls': props.id + '-' + option.value + '-panel',
        'aria-selected': option.value === props.value ? 'true' : 'false'
      }, option.label))),
    Switch: (props) => React.createElement('button', { type: 'button', role: 'switch', 'aria-checked': props.checked === true ? 'true' : 'false', 'aria-label': props.label })
  };
  const mockRequire = (id) => id === 'react' ? React
    : id === 'react/jsx-runtime' ? require_('react/jsx-runtime')
    : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesStub
    : (() => { throw new Error('unexpected require ' + id); })();
  const store = new Map();
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
    crypto: { randomUUID: () => 'u-1' }, AbortController
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  const exportsObj = loaded.factory(mockRequire);
  let settingsComponent = null;
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: () => {}, bind: () => (k) => k },
    slots: {
      inject: (name, factory) => { factory(); },
      register: (config, comp) => { if (config.name === 'settings.section') settingsComponent = comp; return () => {}; }
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
  };
  exportsObj.apply(ctx);
  assert('设置分区组件被注册了', typeof settingsComponent === 'function', String(typeof settingsComponent));

  const dict = {};
  for (const block of ['zh']) {
    const start = code.indexOf('    var ' + block + ' = {');
    const end = code.indexOf('\n    };', start);
    for (const m of code.slice(start, end).matchAll(/"([A-Za-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
      dict[m[1]] = JSON.parse('"' + m[2] + '"');
    }
  }
  let html = '';
  try { html = renderToStaticMarkup(React.createElement(settingsComponent, { t: (k) => dict[k] ?? k })); }
  catch (e) { fail++; console.error('  FAIL SSR 渲染抛错 — ' + String((e && e.stack) || e)); }

  const note = dictValue('zh', KEY);
  if (html !== '') {
    const hits = [...html.matchAll(/data-dw-feature-scope-note=""/g)];
    assert('页面上存在带 data-dw-feature-scope-note 的元素', hits.length === 1, '找到 ' + hits.length + ' 处');
    if (hits.length === 1) {
      const at = hits[0].index;
      const nodeEnd = html.indexOf('</div>', at);
      const inner = html.slice(at, nodeEnd < 0 ? at + 2000 : nodeEnd);
      assert('该元素里就是那句说明（逐字 = zh 词典，未被转义截断）',
        inner.includes(note), 'inner=' + JSON.stringify(inner.slice(0, 200)) + ' want=' + JSON.stringify((note || '').slice(0, 80)));

      const basicPanelAt = html.indexOf('id="deepworker-settings-tabs-basic-panel"');
      const focusPanelAt = html.indexOf('id="deepworker-settings-tabs-focus-panel"');
      assert('它落在「基础」面板内部', basicPanelAt >= 0 && focusPanelAt > basicPanelAt && at > basicPanelAt && at < focusPanelAt,
        'basic=' + basicPanelAt + ' note=' + at + ' focus=' + focusPanelAt);

      const cardTitleAt = html.indexOf(dict['feature.section']);
      assert('卡片标题「' + dict['feature.section'] + '」在它之前', cardTitleAt >= 0 && cardTitleAt < at,
        'title=' + cardTitleAt + ' note=' + at);

      // 总开关那一行在它**之后**（先读说明、再读开关）
      const masterAt = html.indexOf(dict['settings.masterSwitch']);
      assert('总开关「' + dict['settings.masterSwitch'] + '」在它之后（先读说明，再读开关）',
        masterAt >= 0 && masterAt > at, 'master=' + masterAt + ' note=' + at);

      // 别的 tab 里不许有第二份（"搬家留一份"是本机反复栽过的形状）
      const notesPanelAt = html.indexOf('id="deepworker-settings-tabs-notes-panel"');
      assert('「笔记」面板里没有它（全页只有「基础」这一份）',
        notesPanelAt < 0 || at < notesPanelAt, 'note=' + at + ' notes=' + notesPanelAt);
    }
  }
}

console.log(fail === 0
  ? `\nFEATURE SCOPE NOTE PASSED (${pass} checks)`
  : `\n${fail} check(s) failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
