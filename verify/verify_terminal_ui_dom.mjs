#!/usr/bin/env node
/**
 * verify_terminal_ui_dom.mjs — real-DOM interaction checks for the command-buttons page.
 *
 * Why this suite exists: the SSR suites render once and never attach event handlers.
 * They could not catch two real bugs:
 *   · "加一个按钮" appended an empty row that wsNormalizeEntry dropped on the same tick;
 *   · the new-workspace dialog could be closed by the tail of the click that opened it.
 * This suite mounts the actual settings component in jsdom and clicks the real controls.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';

const PKG = new URL('..', import.meta.url).pathname;
const code = fs.readFileSync(process.env.HA_CLIENT_JS || (PKG + 'lib/client.js'), 'utf8');
let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const fail = (m, detail) => { failed++; console.error('FAIL: ' + m + (detail === undefined ? '' : ': ' + detail)); };
const assert = (m, cond, detail) => { if (cond) ok(m); else fail(m, detail); };

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.test' });
const { window } = dom;
global.window = window;
global.document = window.document;

let loaded = null;
const W = {
  __ModuleLoader__: { load(r) { loaded = r; } },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  innerWidth: 1200, innerHeight: 800, Event: window.Event
};
const store = new Map();
store.set('dsh.deepworker.workspaces.v1', JSON.stringify({
  version: 1,
  workspaces: [{
    path: '/tmp/ws', label: 'ws',
    start: { label: '启动', command: 'echo hi' },
    stop: { label: '停止', command: 'echo bye' },
    extras: [], preStart: [], timeoutSec: 30, stopBeforeStart: false
  }]
}));

const primitives = {
  Modal: ({ open, title, children, footer, onClose }) => open ? jsxRuntime.jsxs('div', {
    'data-dw-modal': '',
    children: [
      jsxRuntime.jsx('div', { 'data-mask': '', onClick: onClose }, 'mask'),
      jsxRuntime.jsxs('div', {
        children: [
          jsxRuntime.jsx('h2', { children: title }, 'title'),
          children,
          jsxRuntime.jsx('div', { 'data-footer': '', children: footer }, 'footer')
        ]
      }, 'panel')
    ]
  }) : null,
  Input: (p) => jsxRuntime.jsx('input', {
    'data-prim': 'Input', value: p.value, placeholder: p.placeholder,
    'aria-label': p['aria-label'], onChange: p.onChange
  }),
  Button: (p) => jsxRuntime.jsx('button', {
    type: 'button', disabled: p.disabled === true, onClick: p.onClick, children: p.children
  }),
  Checkbox: (p) => jsxRuntime.jsxs('label', {
    'data-prim': 'Checkbox',
    children: [
      jsxRuntime.jsx('input', {
        type: 'checkbox', checked: p.checked === true, disabled: p.disabled === true,
        onChange: (e) => p.onChange(e.target.checked)
      }, 'input'),
      jsxRuntime.jsx('span', { children: p.label }, 'label')
    ]
  }),
  Switch: (p) => jsxRuntime.jsx('button', {
    type: 'button', role: 'switch', 'aria-checked': String(p.checked === true),
    'aria-label': p.label, onClick: () => p.onChange(!(p.checked === true)), children: p.label
  }),
  SegmentedControl: (p) => jsxRuntime.jsx('div', {
    role: 'tablist',
    children: (p.options || []).map((o) => jsxRuntime.jsx('button', {
      type: 'button', role: 'tab', 'aria-selected': String(o.value === p.value),
      onClick: () => p.onChange(o.value), children: o.label
    }, o.value))
  }),
  IconListPenOutlineRegular: () => null,
  MarkdownText: ({ text }) => jsxRuntime.jsx('div', { children: text })
};
const mockRequire = (id) => id === 'react' ? React
  : id === 'react/jsx-runtime' ? jsxRuntime
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives
  : (() => { throw new Error('unexpected require ' + id); })();

const sandbox = {
  window: W, document: window.document, require: mockRequire,
  TextEncoder, btoa, atob, TextDecoder, console,
  setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  setInterval: () => 0, clearInterval: () => {},
  queueMicrotask: (fn) => Promise.resolve().then(fn),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, isFinite, RegExp,
  crypto: { randomUUID: (() => { let n = 0; return () => 'u-' + (++n) + '-aaaaaaaaaaaaaaaa'; })() },
  AbortController, Event: window.Event, CustomEvent: window.CustomEvent
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

const components = {};
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (n, f) => { f(); },
    register: (config, comp) => {
      if (config.name === 'settings.section') components.settings = comp;
      return () => {};
    }
  },
  sessions: { create: async () => 'x', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  shortcuts: { register: () => () => {} },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => ''
  },
  remote: { session: { prompt: async () => ({ ok: true }) } }
};
exportsObj.apply(ctx);
if (!components.settings) throw new Error('settings.section component was not registered');

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
const t = (k, v) => {
  let out = Object.prototype.hasOwnProperty.call(ZH, k) ? ZH[k] : k;
  if (v && typeof v === 'object') for (const key of Object.keys(v)) out = out.split('{' + key + '}').join(String(v[key]));
  return out;
};

const root = createRoot(window.document.getElementById('root'));
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
root.render(React.createElement(components.settings, { t, busy: false }));
await wait(100);

console.log('命令按钮：真实 DOM 交互');
const buttons = () => [...window.document.querySelectorAll('button')];
const byText = (text) => buttons().find((b) => (b.textContent || '').trim() === text);
assert('page renders the new-workspace toolbar action', window.document.body.textContent.includes('新建工作区'));

// 1) 加一个按钮 must add a visible row immediately (the empty row may not be dropped during editing).
const addExtra = byText('加一个按钮');
assert('add-extra button exists', addExtra !== undefined);
const inputCountBefore = window.document.querySelectorAll('input').length;
if (addExtra) addExtra.click();
await wait(30);
const inputCountAfter = window.document.querySelectorAll('input').length;
assert('add-extra appends a visible label + command row', inputCountAfter === inputCountBefore + 2, inputCountBefore + ' -> ' + inputCountAfter);

// 2) One click checks; a second click unchecks. It must not toggle twice on one click.
const checkbox = window.document.querySelector('input[type=checkbox]');
assert('workspace checkbox exists', checkbox !== null);
if (checkbox) {
  checkbox.click();
  await wait(30);
  assert('one click checks the workspace', checkbox.checked === true);
  // Simulate the 5s focus-refresh re-render of the settings page. The command-buttons
  // editor is declared inside the settings component; without a stable component type
  // React would remount it here and the checked box would reset.
  root.render(React.createElement(components.settings, { t, busy: false }));
  await wait(30);
  const checkedAfterParentRender = window.document.querySelector('input[type=checkbox]');
  assert('a parent re-render keeps the checkbox checked', checkedAfterParentRender !== null && checkedAfterParentRender.checked === true);
  if (checkedAfterParentRender) checkedAfterParentRender.click();
  await wait(30);
  const uncheckedAfterSecondClick = window.document.querySelector('input[type=checkbox]');
  assert('a second click unchecks it', uncheckedAfterSecondClick !== null && uncheckedAfterSecondClick.checked === false);
}

// 3) The new-workspace dialog must survive the opening click and close only on request.
const newButton = byText('新建工作区');
assert('new-workspace button exists', newButton !== undefined);
if (newButton) newButton.click();
await wait(80);
const modalOpen = window.document.querySelector('[data-dw-modal]') !== null;
assert('new-workspace dialog stays open after the click', modalOpen);
if (modalOpen) {
  const mask = window.document.querySelector('[data-mask]');
  if (mask) mask.click();
  await wait(30);
  assert('the mask is ignored during the opening window', window.document.querySelector('[data-dw-modal]') !== null);
  root.render(React.createElement(components.settings, { t, busy: false }));
  await wait(30);
  assert('a parent re-render keeps the new-workspace dialog open', window.document.querySelector('[data-dw-modal]') !== null);
  const cancel = byText('取消');
  assert('dialog has an explicit cancel action', cancel !== undefined);
  if (cancel) cancel.click();
  await wait(30);
  assert('cancel closes the dialog', window.document.querySelector('[data-dw-modal]') === null);
}

root.unmount();
dom.window.close();
if (failed > 0) {
  console.error(`\nFAIL: ${failed} interaction check(s) failed`);
  process.exit(1);
}
console.log('\nTERMINAL UI DOM PASSED');
process.exit(0);
