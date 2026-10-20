// verify_tab_names.mjs — 设置页 tab 名的**改名守卫**（2026-10-17 第 1 段）。
//
// 用户原话：「「终端」tab 改名「命令按钮」」。
//
// 为什么需要独立的守卫（verify_render.mjs 已经断了 tab 名与顺序）：
//   ① 改名是**两件事**：zh 与 en 各一份词典。只改中文、漏了英文，页面在英文界面下仍然写着
//      "Terminal" —— 而 verify_render 只渲染中文那一份，它**看不见** en。
//   ② 改名有**边界**：`term.settingsTitle` / `term.featureName` 都是「终端按钮」，
//      指的是**真的终端**（头部那颗点下去会开一个 PTY）。把它们一起改掉就是过度改名：
//      说的和做的不一样。这里同时钉住"该改的改了、不该改的没动"。
//   ③ 这里是**真跑 SSR** 断按钮文字，不是 grep 词典：词典写着「命令按钮」而组件渲染的是
//      别处（例如写死字面量）时，只读词典的断言会绿。
//
// 用法：node verify/verify_tab_names.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const LIVE = path.join(PKG, 'lib', 'client.js');
const code = fs.readFileSync(LIVE, 'utf8');

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const section = (title) => console.log('\n── ' + title);

/** The zh / en dictionary literal as text (same boundary rule as verify_i18n.mjs). */
function dictBlock(name) {
  const start = code.indexOf('    var ' + name + ' = {');
  if (start < 0) return null;
  const end = code.indexOf('\n    };', start);
  if (end < 0) return null;
  return code.slice(start, end);
}
/** Every `"key": "value"` of a dictionary, in file order. */
function entries(name) {
  const text = dictBlock(name);
  if (text === null) return null;
  const out = [];
  for (const m of text.matchAll(/"([A-Za-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.push({ key: m[1], value: JSON.parse('"' + m[2] + '"') });
  }
  return out;
}
const zh = entries('zh');
const en = entries('en');
assert('zh / en 两份词典都读到了', zh !== null && en !== null && zh.length > 100 && en.length > 100,
  (zh ? zh.length : 'null') + ' / ' + (en ? en.length : 'null'));

const pick = (list, key) => {
  const hit = list.filter((e) => e.key === key);
  return hit.length === 1 ? hit[0].value : null;
};

// ════════════════════════════════════════════════════════════════════════════════
section('① 第 5 个 tab 的名字：zh = 命令按钮 / en = Commands');
{
  const zhName = pick(zh, 'settings.tab.terminal');
  const enName = pick(en, 'settings.tab.terminal');
  assert('zh settings.tab.terminal 恰好定义一次', zhName !== null, JSON.stringify(zh.filter((e) => e.key === 'settings.tab.terminal')));
  assert('en settings.tab.terminal 恰好定义一次', enName !== null, JSON.stringify(en.filter((e) => e.key === 'settings.tab.terminal')));
  assert('zh 名字 = 命令按钮', zhName === '命令按钮', JSON.stringify(zhName));
  assert('en 名字 = Commands', enName === 'Commands', JSON.stringify(enName));
  // 旧名不许在**任何** settings.tab.* 上残留（改名最典型的坏形状：新键加了、旧值还在）
  const staleZh = zh.filter((e) => /^settings\.tab\./.test(e.key) && e.value === '终端');
  const staleEn = en.filter((e) => /^settings\.tab\./.test(e.key) && e.value === 'Terminal');
  assert('没有任何 settings.tab.* 的值还是旧名「终端」', staleZh.length === 0, JSON.stringify(staleZh));
  assert('没有任何 settings.tab.* 的值还是旧名 "Terminal"', staleEn.length === 0, JSON.stringify(staleEn));
}

// ════════════════════════════════════════════════════════════════════════════════
section('② tab 顺序与 value（改名不许顺手挪位置）');
{
  const src = code.slice(code.indexOf('var SETTINGS_TABS = ['), code.indexOf('];', code.indexOf('var SETTINGS_TABS = [')));
  const values = [...src.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]);
  const keys = [...src.matchAll(/labelKey:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert('5 个 tab 的 value 顺序 = basic / focus / notes / actions / terminal',
    values.join('|') === 'basic|focus|notes|actions|terminal', JSON.stringify(values));
  assert('5 个 tab 的 labelKey 与 value 一一对应',
    keys.join('|') === values.map((v) => 'settings.tab.' + v).join('|'), JSON.stringify(keys));
  // labelKey 必须是**字面量**（拼接会让 verify_hygiene 看不见引用 ⇒ 误报 unused）。
  // ⚠️ 只扫代码、不扫注释：SETTINGS_TABS 的文档注释里**就是**用那串拼接举例的。
  const codeOnly = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  assert('labelKey 一律是字面量键名（没有 t("settings.tab." + value) 那种拼接）',
    (codeOnly.match(/t\("settings\.tab\."\s*\+/g) || []).length === 0);
}

// ════════════════════════════════════════════════════════════════════════════════
section('③ 改名不许过度：页内标题跟 tab 同名，**功能名**（指的是真终端）保留原名');
{
  // 两件事，两个键，别混：
  //   · `term.settingsTitle` = 这一页的**标题** ⇒ 跟 tab 同名（tab 叫命令按钮，页内也这么叫，
  //     否则用户会看到"tab 命令按钮 / 页内标题 终端按钮"这种对不上的组合）；
  //   · `term.featureName`   = 「基础 → 功能引入 / 移除」里那一档的**名字** ⇒ 讲的就是
  //     "点头部按钮会开一个终端跑命令"，那是真的终端 ⇒ 保留「终端按钮」。
  const zhTitle = pick(zh, 'term.settingsTitle');
  const enTitle = pick(en, 'term.settingsTitle');
  const zhFeature = pick(zh, 'term.featureName');
  const enFeature = pick(en, 'term.featureName');
  assert('zh term.settingsTitle 与 tab 同名（命令按钮）', zhTitle === '命令按钮', JSON.stringify(zhTitle));
  assert('en term.settingsTitle 与 tab 同名（Command buttons）', enTitle === 'Command buttons', JSON.stringify(enTitle));
  assert('zh term.featureName 仍是「终端按钮」（指的是真终端，不是 tab 名）', zhFeature === '终端按钮', JSON.stringify(zhFeature));
  assert('en term.featureName 仍是 "Terminal buttons"', enFeature === 'Terminal buttons', JSON.stringify(enFeature));
}

// ════════════════════════════════════════════════════════════════════════════════
section('④ 真跑 SSR：tab 条上渲染出来的第 5 个按钮文字就是「命令按钮」');
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
    // 与真原语同形：`<div role="tablist">` 里一串 `<button role="tab" id=… aria-controls=…>`
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
  for (const e of zh) dict[e.key] = e.value;
  const ti = (k) => dict[k] ?? k;
  let html = '';
  try { html = renderToStaticMarkup(React.createElement(settingsComponent, { t: ti })); }
  catch (e) { fail++; console.error('  FAIL SSR 渲染抛错 — ' + String((e && e.stack) || e)); }
  if (html !== '') {
    const tabs = [...html.matchAll(/<button([^>]*role="tab"[^>]*)>([^<]*)<\/button>/g)];
    assert('SSR 渲染出 5 个 tab', tabs.length === 5, String(tabs.length));
    const names = tabs.map((m) => m[2].trim());
    assert('渲染出来的 tab 名 = 基础 / 专注锁 / 笔记 / 会话操作 / 命令按钮',
      names.join('|') === '基础|专注锁|笔记|会话操作|命令按钮', names.join(' / '));
    assert('第 5 个 tab 的 id 仍是 deepworker-settings-tabs-terminal（value 未改）',
      tabs.length === 5 && /id="deepworker-settings-tabs-terminal"/.test(tabs[4][1]), tabs.length === 5 ? tabs[4][1].slice(0, 120) : '(no 5th tab)');
    assert('页面上**没有**任何 tab 按钮叫「终端」',
      !names.includes('终端'), names.join(' / '));
  }
}

console.log(fail === 0
  ? `\nTAB NAMES PASSED (${pass} checks)`
  : `\n${fail} check(s) failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
