import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// Capture the module loader registration
let loaded = null;
const windowObj = {
  __ModuleLoader__: { load: (reg) => { loaded = reg; } }
};

// Minimal mock require (components aren't rendered during apply; only referenced)
const reactMock = {
  memo: (c) => c,
  useState: (init) => [init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: (fn) => {}
};
const jsxRuntimeMock = {
  jsx: (...a) => a,
  jsxs: (...a) => a,
  Fragment: Symbol('Fragment')
};
const primitivesMock = { Modal: function(){}, Button: function(){} };

function mockRequire(id) {
  if (id === 'react') return reactMock;
  if (id === 'react/jsx-runtime') return jsxRuntimeMock;
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesMock;
  throw new Error('unexpected require: ' + id);
}

const sandbox = {
  window: windowObj,
  require: mockRequire,
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'client.js' });
} catch (e) {
  console.error('LOAD/EVAL FAILED:', e);
  process.exit(1);
}

if (!loaded) { console.error('FAIL: __ModuleLoader__.load not called'); process.exit(1); }
console.log('OK: bundle registered id =', loaded.id);

const mod = { exports: {} };
loaded.factory(mockRequire).then ? null : null; // factory is sync
const exportsObj = loaded.factory(mockRequire);
// factory returns module.exports; but exports set on a local module. Re-run: factory sets exports on its own module and returns module.exports.
console.log('OK: factory exports keys =', Object.keys(exportsObj));
console.log('    apply =', typeof exportsObj.apply, ', inject =', JSON.stringify(exportsObj.inject));

// Run apply with a mock ctx capturing registrations
const calls = {
  shortcuts: [], effects: [], locale: [], slotInject: [], slotRegister: [] };
const ctx = {
  effect: (fn, label) => { calls.effects.push(label); fn(); return () => {}; },
  locale: { register: (ns, d) => calls.locale.push({ ns, keys: Object.keys(d.zh) }), bind: () => (key) => key },
  shortcuts: {
    register: (command) => {
      if (command.defaults === undefined) throw new Error("shortcuts.register reads defaults['desktop:macos']; defaults must be an object");
      calls.shortcuts.push({ id: command.id, defaults: Object.keys(command.defaults || {}), regions: command.regions, resolve: typeof command.resolve });
      return () => {};
    }
  },
  slots: {
    inject: (name, factory) => {
      calls.slotInject.push(name);
      factory(); // factory body calls ctx.slots.register(config, component)
    },
    register: (config, component) => {
      calls.slotRegister.push({ name: config.name, id: config.id, key: config.key, order: config.order, locale: config.locale, inject: typeof config.inject });
    }
  },
  sessions: { fork: async () => 'child-id' },
  uiWorkspace: { openSession: () => {} },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true, value: 'standard' }) } }
};

try {
  exportsObj.apply(ctx);
  console.log('OK: apply() ran without throwing');
} catch (e) {
  console.error('FAIL: apply() threw:', e);
  process.exit(1);
}

console.log('    effects:', JSON.stringify(calls.effects));
console.log('    locale registrations:', JSON.stringify(calls.locale));
console.log('    slot.inject:', JSON.stringify(calls.slotInject));
console.log('    slot.register:', JSON.stringify(calls.slotRegister));

// Assertions
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
if (!calls.locale.some(l => l.ns === 'dsh-deepworker')) fail('locale not registered');
if (!calls.slotInject.includes('conversation.chat.turnTail')) fail('turnTail slot not injected');
const reg = calls.slotRegister.find(r => r.name === 'conversation.chat.turnTail' && r.id === 'history-actions');
if (!reg) fail('turnTail slot register missing id history-actions');
if (reg.order !== 5) fail('turnTail order mismatch: ' + reg.order);
if (reg.inject !== 'function') fail('turnTail inject not a function');

if (!calls.slotInject.includes('sidebar.footer.action')) fail('sidebar.footer.action slot not injected');
const notesReg = calls.slotRegister.find(r => r.name === 'sidebar.footer.action' && r.id === 'history-actions-notes');
if (!notesReg) fail('sidebar.footer.action register missing id history-actions-notes');
if (notesReg.locale !== 'dsh-deepworker') fail('notes action must declare its locale namespace, got ' + notesReg.locale);
console.log('OK: both slots registered (turnTail + sidebar.footer.action)');

// the notes page must be a fresh `main` key: that is what makes it a page, not a dialog
if (!calls.slotInject.includes('main')) fail('main slot not injected');
const pageReg = calls.slotRegister.find(r => r.name === 'main' && r.key === 'history-actions-notes');
if (!pageReg) fail('main panel key history-actions-notes not registered');
if (pageReg.locale !== 'dsh-deepworker') fail('notes page must declare its locale namespace');
if (pageReg.inject !== 'function') fail('notes page must expose selectPanel through inject');
if (!exportsObj.inject.includes('layout')) fail('the layout service (selectPanel) must be injected');
console.log('OK: notes is registered as its own central panel key');

if (!calls.slotInject.includes('settings.section')) fail('settings.section slot not injected');
const settingsReg = calls.slotRegister.find(r => r.name === 'settings.section' && r.id === 'history-actions');
if (!settingsReg) fail('settings.section register missing id history-actions');
if (settingsReg.locale !== 'dsh-deepworker') fail('settings section must declare its locale namespace');
console.log('OK: the plugin contributes its own settings section');

// the digest belongs next to the session title, not only inside the notes page
if (!calls.slotInject.includes('conversation.session.header.utilities')) fail('session header utilities slot not injected');
if (calls.slotInject.includes('conversation.session.header.actions')) fail('the digest must live in the right-aligned utilities, not beside the title');
const digestReg = calls.slotRegister.find(r => r.name === 'conversation.session.header.utilities' && r.id === 'history-actions-digest');
if (!digestReg) fail('session header digest action not registered');
if (digestReg.locale !== 'dsh-deepworker') fail('digest action must declare its locale namespace');
if (digestReg.order !== 50) fail('digest action must order far enough right, got ' + digestReg.order);
console.log('OK: the digest action sits in the session header');

// editable application commands: they must be rebindable, i.e. registered with
// defaults through ctx.shortcuts.register (never registerFixed, which is read-only)
if (!exportsObj.inject.includes('shortcuts')) fail('the shortcuts service must be injected');
const ids = calls.shortcuts.map((c) => c.id).sort();
console.log('shortcut commands ->', JSON.stringify(calls.shortcuts));
if (ids.join(',') !== 'deepworker.digest,deepworker.find,deepworker.notes.open,deepworker.notes.search') {
  fail('shortcut commands missing/extra: ' + JSON.stringify(ids));
}
// ⚠️ 2026-10-15: `web:linux` is gone on purpose — it was never a legal claim. DSH admits only
// `windows`/`macos` into the widened Web rule (dsh-client-shortcuts/lib/client.js:111) and on
// web+linux only primary+Slash / primary+shift+Comma|Period pass. The KeyF+primary+alt claim
// there made register() throw `Unsupported Web shortcut: deepworker.find`, and because
// register is atomic the WHOLE command stayed unregistered (`find=failed` in Settings).
const FIND_PLATFORMS = ['desktop:macos', 'desktop:windows', 'desktop:linux', 'web:macos', 'web:windows'];
for (const entry of calls.shortcuts) {
  // `defaults` must exist (the service indexes into it). Commands stay unbound by default
  // so they cannot collide with another plugin's binding — EXCEPT find, which ships a real
  // binding: an unreachable feature is not finished, and mod+f is provably free in DSH.
  if (!Array.isArray(entry.defaults)) fail('command ' + entry.id + ' must carry a defaults object');
  if (entry.id === 'deepworker.find') {
    const claimed = [...entry.defaults].sort().join(',');
    if (claimed !== [...FIND_PLATFORMS].sort().join(',')) {
      fail('find must claim exactly the platform bindings, got ' + JSON.stringify(entry.defaults));
    }
    if (entry.defaults.indexOf('web:linux') !== -1) {
      fail('find must NOT claim the illegal web:linux profile (DSH rejects KeyF+primary+alt there)');
    }
    continue;
  }
  if (entry.defaults.length !== 0) fail('command ' + entry.id + ' must claim no default combination, got ' + JSON.stringify(entry.defaults));
  if (entry.resolve !== 'function') fail('command ' + entry.id + ' must resolve its target');
}
if (!calls.shortcuts.every((c) => c.regions.includes('page') && c.regions.includes('editable'))) {
  fail('commands must declare their regions');
}
if (!calls.effects.some((label) => label === 'dsh-deepworker: shortcut commands')) fail('shortcut effect not owned');

/** Runs one bundle text in a bare vm context and returns its registered factory. */
function loadFactory(source, filename) {
  let reg = null;
  const win = { __ModuleLoader__: { load: (r) => { reg = r; } } };
  const sandbox = { window: win, TextEncoder, btoa, atob, URL, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename });
  if (reg === null) throw new Error(filename + ': did not register with __ModuleLoader__');
  return reg.factory;
}

// ── 自包含（2026-10-16）：本包不再接线外置共享层 ─────────────────────────────────────────
// 2026-10-15 曾有一版 readout（可达 ⇒ `core=0.1.0 fn=yes`；缺席 ⇒ `core=FAIL(...)`），靠
// package.json 的 dsh.client.external 把一个外置共享层挂成 Loader 行。那一版是"阶段 1a：
// 只读数" —— 真正被调用的 sameSessionId 一直就在本 bundle 里，从未切换到共享层那份。
// 共享层现已合回本包 ⇒ 这里的语义反转成"必须没有外部层"。
// 两条断言各配一个变异（把 bug 改回去，确认断言会红；不做变异的断言是死断言 —— 纪律 11）。
// 变异只在内存字符串上做，从不写盘，更不碰被 HMR 监视的 lib/client.js。
const SHARED_LAYER_PKG = 'dsh-ha-core'; // 只作"禁止出现"的判据；本 bundle 里出现即判红

const LIVE_BUILD = (code.match(/var BUILD = "([^"]+)"/) || [null, '(none)'])[1];
const CORE_TOKEN = 'core=builtin';

function sharedLayerLines(source) {
  return source.split('\n').map((l, i) => ({ line: i + 1, text: l }))
    .filter((x) => x.text.includes(SHARED_LAYER_PKG));
}

// ① buildStatus() 必须报"共享层是内建的"，且不许出现任何版本号读数（那会是一句谎话）。
const marker = exportsObj.__test.buildStatus();
if (typeof marker !== 'string') fail('__test.buildStatus() must return a string, got ' + typeof marker);
if (!marker.includes(LIVE_BUILD)) fail('the build marker must carry the live BUILD, got ' + JSON.stringify(marker));
if (!marker.includes('md=builtin')) fail('the build marker must carry md=builtin, got ' + JSON.stringify(marker));
if (!marker.includes(CORE_TOKEN)) fail('the build marker must carry ' + CORE_TOKEN + ', got ' + JSON.stringify(marker));
if (/core=\d/.test(marker)) fail('a version-number core readout would be a LIE after unwiring: ' + JSON.stringify(marker));
if (/[\r\n\t]/.test(marker)) fail('the build marker must be a single line, got ' + JSON.stringify(marker));
console.log('OK: build marker ->', JSON.stringify(marker));

// ② the bundle must not reference the external shared layer anywhere — code OR comments.
const refs = sharedLayerLines(code);
if (refs.length !== 0) {
  fail('the bundle must not reference ' + SHARED_LAYER_PKG + ' at all; found ' + refs.length
    + ' line(s): ' + JSON.stringify(refs.slice(0, 3)));
}
console.log('OK: zero references to the external shared layer in the bundle');

// Mutation ①: require the shared layer again ⇒ assertion ② must go red.
const REF_ANCHOR = 'var primitives = require("@deepseek-ai/dsh-client-ui-primitives");';
if (!code.includes(REF_ANCHOR)) fail('mutation anchor is gone from the bundle: ' + JSON.stringify(REF_ANCHOR));
const MUTATED_REF = code.replace(REF_ANCHOR, REF_ANCHOR + '\n    var resurrected = require("' + SHARED_LAYER_PKG + '");');
if (MUTATED_REF === code) fail('mutation ① changed no bytes');
if (sharedLayerLines(MUTATED_REF).length === 0) {
  fail('mutation ① (shared layer re-required) was NOT caught ⇒ assertion ② is dead');
}
console.log('OK: mutation ① (shared layer re-required) is caught by assertion ②');

// Mutation ②: turn the built-in token back into a version readout ⇒ assertion ① must go red.
const CORE_ANCHOR = 'var CORE_MODE = "builtin";';
if (!code.includes(CORE_ANCHOR)) fail('mutation anchor is gone from the bundle: ' + JSON.stringify(CORE_ANCHOR));
const MUTATED_MARKER = code.replace(CORE_ANCHOR, 'var CORE_MODE = "0.1.0";');
if (MUTATED_MARKER === code) fail('mutation ② changed no bytes');
const mutFactory = loadFactory(MUTATED_MARKER, '(mutation: lying core readout)');
const mutMarker = mutFactory(mockRequire).__test.buildStatus();
if (mutMarker.includes(CORE_TOKEN) || !/core=\d/.test(mutMarker)) {
  fail('mutation ② (core=<version> readout) was NOT caught ⇒ assertion ① is dead; got ' + JSON.stringify(mutMarker));
}
console.log('OK: mutation ② (lying core readout) is caught by assertion ①');

console.log('\nALL CHECKS PASSED');
