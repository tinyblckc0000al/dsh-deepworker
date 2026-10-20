#!/usr/bin/env node
/**
 * verify_terminal_config_file.mjs — 「命令按钮」页的 agent 批量配置入口。
 *
 * 契约（用户 2026-10-18 定稿）：
 *   · 只做 命令按钮 这一页；JSON 一种格式；
 *   · 文件 = 当前工作区的 `.dsh-deepworker.buttons.json`；
 *   · **整份替换**现有工作区列表；
 *   · **不轮询**，只有页面上的「立即读取」；
 *   · 严格校验：任一条错误整份拒绝，错误必须显示；
 *   · 文件里的命令绝不自动执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const TARGET = process.env.HA_CLIENT_JS || path.join(PKG, 'lib', 'client.js');
const src = fs.readFileSync(TARGET, 'utf8');
const where = path.relative(PKG, TARGET);

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const assert = (m, cond, detail) => { if (cond) ok(m); else fail(m + (detail === undefined ? '' : ': ' + detail)); };

/* ── minimal DOM / React / ctx ───────────────────────────────────────────── */
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
  querySelectorAll: () => []
};
const events = [];
const win = {
  innerWidth: 1200, innerHeight: 800,
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
  dispatchEvent(ev) { events.push(ev && ev.type); for (const fn of this.listeners[ev.type] || []) fn(ev); return true; },
  listeners: {}
};
const windowObj = Object.assign({ __ModuleLoader__: { load: (r) => { loaded = r; } }, Event: function FakeWindowEvent(type) { this.type = type; } }, win);
let loaded = null;
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function () {}, Button: function () {}, Input: function () {}, Checkbox: function () {}, Switch: function () {} };
const mockRequire = (id) => id === 'react' ? reactMock
  : id === 'react/jsx-runtime' ? jsxMock
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock
  : (() => { throw new Error('unexpected ' + id); })();
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
function FakeEvent(type) { this.type = type; }
const sandbox = {
  window: windowObj, setTimeout, clearTimeout, document: doc, localStorage, require: mockRequire,
  TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console, Event: FakeEvent
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

const CONFIG = {
  version: 1,
  workspaces: [
    {
      path: '/tmp/a', label: 'alpha',
      start: { label: 'Start', command: 'echo a' },
      stop: { label: 'Stop', command: 'echo stop' },
      extras: [{ label: 'Restart', command: 'echo r' }],
      preStart: ['stop'], timeoutSec: 45, stopBeforeStart: true
    },
    { path: '/tmp/b', start: { command: 'echo b' } }
  ]
};
let fileReadResult = { ok: true, value: JSON.stringify(CONFIG) };
let readCalls = 0;
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => t },
  slots: { inject: (n, f) => { f(); }, register: () => {} },
  sessions: { create: async () => 'x', fork: async () => 'y', binding: () => undefined },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: () => {}, archiveSession: async () => {},
    mainReference: { sessionId: 'sess-1' },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: '/tmp/ws', title: 'ws', sessionIds: ['sess-1'] }] }) } },
    pickDirectory: async () => '/tmp/picked'
  },
  remote: {
    session: { prompt: async () => ({ ok: true }) },
    agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
    workspace: { create: async () => ({ ok: true }) },
    workspaceFiles: {
      read: (id, file, range) => {
        readCalls += 1;
        return Promise.resolve(fileReadResult);
      }
    }
  }
};
const ZH = {
  'term.fileTitle': '从工作区文件读取',
  'term.fileHint': 'agent 可以写这个文件',
  'term.filePath': '文件',
  'term.fileRead': '立即读取',
  'term.fileReading': '读取中…',
  'term.fileMissing': '未找到文件',
  'term.fileApplied': '已应用 {n} 个工作区',
  'term.fileUnchanged': '文件没变化',
  'term.fileInvalid': '文件有错误，未应用',
  'term.fileNoCwd': '拿不到 cwd',
  'term.fileNoApi': '不支持读取',
  'term.fileFailed': '读取失败',
  'term.fileReplaced': '整份替换',
  'term.fileErrors': '错误'
};
const t = (k, params) => {
  let value = ZH[k] === undefined ? k : ZH[k];
  if (params) for (const key of Object.keys(params)) value = value.split('{' + key + '}').join(String(params[key]));
  return value;
};
store.set('dsh.xh-deepworker.settings', JSON.stringify({ featureFind: false }));
try { exportsObj.apply(ctx); } catch (e) { /* stub ctx may partially fail; __test is what matters */ }
const bridge = exportsObj.__test;
if (bridge === undefined) { console.error('FAIL: __test seam missing'); process.exit(1); }

console.log('存储迁移');
assert('legacy settings copied to the new key', store.get('dsh.deepworker.settings') === store.get('dsh.xh-deepworker.settings'));
assert('legacy value is readable through the new key', bridge.readSettings().featureFind === false);
assert('legacy key kept for rollback', store.has('dsh.xh-deepworker.settings'));
assert('migration pairs old/new settings', /dsh\.xh-deepworker\.settings/.test(src) && /dsh\.deepworker\.settings/.test(src));

/* ── 1. parser ───────────────────────────────────────────────────────────── */
console.log('解析 / 校验');
const parse = bridge.parseTerminalConfigFile;
assert('parseTerminalConfigFile is exported', typeof parse === 'function');
assert('TERM_CONFIG_FILE is the agreed name', bridge.TERM_CONFIG_FILE === '.dsh-deepworker.buttons.json', String(bridge.TERM_CONFIG_FILE));

{
  const r = parse(JSON.stringify(CONFIG));
  assert('valid JSON parses', r.ok === true, JSON.stringify(r.errors));
  assert('two workspaces normalized', r.ok && r.store.workspaces.length === 2);
  if (r.ok) {
    const a = r.store.workspaces[0];
    assert('start command kept', a.start.command === 'echo a');
    assert('extra label kept', a.extras[0].label === 'Restart');
    assert('preStart kept', a.preStart.length === 1 && a.preStart[0] === 'stop');
    assert('timeout kept', a.timeoutSec === 45);
    assert('stopBeforeStart kept', a.stopBeforeStart === true);
    assert('label defaults to basename', r.store.workspaces[1].label === 'b', r.store.workspaces[1].label);
    const hb = bridge.wsNormalizeEntry({
      path: '/tmp/header', label: 'header',
      start: { label: 'Start', command: 'echo start' },
      stop: { label: 'Stop', command: 'echo stop' },
      extras: [{ label: 'Restart', command: 'echo restart' }],
      header: ['stop', 'Restart', 'start']
    }, '/tmp/header');
    assert('header order is preserved', hb.header.join('|') === 'stop|Restart|start', JSON.stringify(hb && hb.header));
    assert('header actions follow the order', bridge.wsHeaderActions(hb).map((a) => a.id).join('|') === 'stop|x:0|start', JSON.stringify(bridge.wsHeaderActions(hb)));
    assert('header clone keeps order', bridge.wsClone(hb).header.join('|') === 'stop|Restart|start');
    assert('omitted header means all actions', bridge.wsHeaderActions(bridge.wsNormalizeEntry({ path: '/tmp/header2', start: { command: 'a' }, stop: { command: 'b' } }, '/tmp/header2')).length === 2);

    assert('normalization caps at 4000', bridge.termNormalizeCommand('x'.repeat(4001)).length === 4000);
  }
}
function expectError(label, mutation, fieldPart) {
  const raw = JSON.parse(JSON.stringify(CONFIG));
  mutation(raw);
  const r = parse(JSON.stringify(raw));
  if (r.ok) { fail(label + ': parser accepted an invalid file'); return; }
  if (!r.errors.some((e) => String(e.path + ' ' + e.field + ' ' + e.message).includes(fieldPart))) {
    fail(label + ': error does not mention "' + fieldPart + '": ' + JSON.stringify(r.errors));
  } else ok(label);
}
expectError('relative path rejected', (r) => { r.workspaces[0].path = 'relative/path'; }, 'path');
expectError('duplicate path rejected', (r) => { r.workspaces[1].path = '/tmp/a'; }, 'duplicate');
expectError('extra without label rejected', (r) => { r.workspaces[0].extras[0].label = ''; }, 'extras[0]');
expectError('unknown preStart ref rejected', (r) => { r.workspaces[0].preStart = ['nope']; }, 'preStart');
expectError('version 2 rejected', (r) => { r.version = 2; }, 'version');
expectError('overlong start command rejected', (r) => { r.workspaces[0].start.command = 'x'.repeat(4001); }, 'start.command');
expectError('overlong extra command rejected', (r) => { r.workspaces[0].extras[0].command = 'x'.repeat(4001); }, 'extras[0].command');
expectError('fatal start command rejected', (r) => { r.workspaces[0].start.command = 'rm -rf /'; }, 'fatal command');
expectError('fatal extra command rejected', (r) => { r.workspaces[0].extras[0].command = 'mkfs.ext4 /dev/sda1'; }, 'fatal command');
expectError('unknown header ref rejected', (r) => { r.workspaces[0].header = ['nope']; }, 'header');
expectError('non-array header rejected', (r) => { r.workspaces[0].header = 'start'; }, 'header');
expectError('duplicate header ref rejected', (r) => { r.workspaces[0].header = ['start', 'start']; }, 'header');
assert('header UI is rendered', src.includes('term.headerTitle') && src.includes('data-dw-header-row'));

assert('command limit is 4000', src.includes('TERM_FIELD_MAX = 4000'));
assert('all command inputs carry maxLength', (src.match(/maxLength: TERM_FIELD_MAX/g) || []).length === 5);
assert('UI save rejects overlong drafts', src.includes('function draftCommandTooLong') && src.includes('draftCommandTooLong(draft)'));
assert('fatal command detector is exported', typeof bridge.termFatalReason === 'function');
assert('rm -rf / is fatal', bridge.termFatalReason('rm -rf /') === 'rm-system');
assert('rm -rf ./build is allowed', bridge.termFatalReason('rm -rf ./build') === null);
assert('mkfs is fatal', bridge.termFatalReason('mkfs.ext4 /dev/sda1') === 'mkfs');
assert('dd to device is fatal', bridge.termFatalReason('dd if=/dev/zero of=/dev/sda') === 'dd-device');
assert('UI save rejects fatal drafts', src.includes('function draftFatalReason') && src.includes('draftFatalReason(draft)'));
assert('runtime job carries fatal reason', src.includes('fatal: fatal') && src.includes('if (job.fatal)'));
expectError('empty command set rejected', (r) => { delete r.workspaces[0].start; delete r.workspaces[0].stop; r.workspaces[0].extras = []; }, 'command');
{
  const r = parse('{ not json');
  assert('malformed JSON rejected', r.ok === false && r.errors.some((e) => e.field === 'json'));
}

/* ── 1b. per-extra pre-commands ─────────────────────────────────────────── */
console.log('\n每个额外按钮的前置序列');
{
  const entry = bridge.wsNormalizeEntry({
    path: '/tmp/pre', label: 'pre',
    stop: { label: 'Stop', command: 'echo stop' },
    extras: [{ label: 'Restart', command: 'echo restart', pre: ['stop'] }]
  }, '/tmp/pre');
  assert('extra pre is normalized', entry !== null && entry.extras[0].pre.length === 1 && entry.extras[0].pre[0] === 'stop', JSON.stringify(entry && entry.extras));
  const cloned = bridge.wsClone(entry);
  assert('clone keeps extra pre', cloned.extras[0].pre.length === 1);
  const job = bridge.termJobForEntry(entry, 'x:0', t);
  assert('extra x:0 resolves and runs stop before itself', job !== null && job.commands.map((c) => c.command).join('|') === 'echo stop|echo restart', JSON.stringify(job && job.commands));
  const byLabel = bridge.termJobForEntry(entry, 'Restart', t);
  assert('extra by label gets the same pre sequence', byLabel !== null && byLabel.commands.map((c) => c.command).join('|') === 'echo stop|echo restart', JSON.stringify(byLabel && byLabel.commands));
  const self = bridge.wsNormalizeEntry({
    path: '/tmp/pre2', label: 'pre2',
    extras: [{ label: 'A', command: 'echo a', pre: ['A'] }]
  }, '/tmp/pre2');
  assert('an extra cannot pre-run itself', self !== null && self.extras[0].pre.length === 0, JSON.stringify(self && self.extras));
}
{
  const raw = JSON.parse(JSON.stringify(CONFIG));
  raw.workspaces[0].extras = [{ label: 'Restart', command: 'echo r', pre: ['stop'] }];
  const r = parse(JSON.stringify(raw));
  assert('file parser keeps extras[].pre', r.ok && r.store.workspaces[0].extras[0].pre[0] === 'stop', JSON.stringify(r.errors));
}
{
  const raw = JSON.parse(JSON.stringify(CONFIG));
  raw.workspaces[0].extras = [{ label: 'A', command: 'echo a', pre: ['A'] }];
  const r = parse(JSON.stringify(raw));
  assert('file parser rejects a self pre-reference', r.ok === false && r.errors.some((e) => e.field === 'pre'), JSON.stringify(r.errors));
}

/* ── 1c. output logs (B ring, A file wrapper) ──────────────────────────── */
console.log('\n输出日志');
{
  const entry = bridge.wsNormalizeEntry({ path: '/tmp/log', label: 'log', logToFile: true, start: { command: 'echo hi' } }, '/tmp/log');
  assert('logToFile is normalized', entry !== null && entry.logToFile === true);
  const first = bridge.termLoggedCommand('/tmp/log', 'echo hi', '.dsh-deepworker/logs/a.log', true, 'x');
  const second = bridge.termLoggedCommand('/tmp/log', 'echo hi', '.dsh-deepworker/logs/a.log', false, 'x');
  assert('file wrapper creates the log directory and truncates on the first command', first.includes('mkdir -p .dsh-deepworker/logs') && first.includes(' > ') && first.includes('__DW_DONE_') && first.includes('tail -n 40'));
  assert('file wrapper appends subsequent commands', second.includes(' >> '));
  const raw = JSON.parse(JSON.stringify(CONFIG));
  raw.workspaces[0].logToFile = true;
  const r = parse(JSON.stringify(raw));
  assert('file parser keeps logToFile', r.ok && r.store.workspaces[0].logToFile === true, JSON.stringify(r.errors));
}
{
  bridge.clearTermLogs();
  bridge.appendTermLog({ at: '2026-10-18T00:00:00Z', label: 'x', workspace: '/tmp/x', action: 'start', state: 'done', code: 0, output: 'hello world', logPath: '/tmp/x/.dsh-deepworker/logs/a.log' });
  const logs = bridge.readTermLogs();
  assert('B ring stores the output', logs.length === 1 && logs[0].output === 'hello world' && logs[0].logPath.endsWith('a.log'), JSON.stringify(logs));
  bridge.clearTermLogs();
  assert('B ring can be cleared', bridge.readTermLogs().length === 0);
}

/* ── 2. file read applies / rejects without touching the store ───────────── */
console.log('\n读取与回填');
assert('testHooks.currentCwd is filled', typeof bridge.hooks.currentCwd === 'function');
if (typeof bridge.hooks.currentCwd === 'function') {
  assert('currentCwd comes from the ownership account', bridge.hooks.currentCwd() === '/tmp/ws', bridge.hooks.currentCwd());
}
assert('pickDirectory seam is filled', typeof bridge.hooks.pickDirectory === 'function');
if (typeof bridge.hooks.pickDirectory === 'function') {
  const pendingPick = bridge.hooks.pickDirectory();
  assert('pickDirectory returns the host promise', pendingPick !== null && typeof pendingPick.then === 'function');
  const picked = await pendingPick;
  assert('pickDirectory returns the host result', picked === '/tmp/picked', String(picked));
}
assert('readTerminalConfigFile is exported', typeof bridge.readTerminalConfigFile === 'function');
const before = bridge.wsReadAll().workspaces.length;
const applied = await bridge.readTerminalConfigFile();
assert('valid file applies', applied.status === 'applied' && applied.count === 2, JSON.stringify(applied));
assert('store was replaced', bridge.wsReadAll().workspaces.length === 2);
assert('terminal-config event emitted', events.includes('dsh-deepworker:terminal-config'), JSON.stringify(events));
{
  const current = JSON.stringify(CONFIG);
  fileReadResult = { ok: true, value: current };
  const again = await bridge.readTerminalConfigFile();
  assert('unchanged file is not re-applied', again.status === 'unchanged', JSON.stringify(again));
}
{
  fileReadResult = { ok: true, value: '{ broken' };
  const bad = await bridge.readTerminalConfigFile();
  assert('invalid file reports invalid', bad.status === 'invalid' && Array.isArray(bad.errors), JSON.stringify(bad));
  assert('invalid file leaves the store intact', bridge.wsReadAll().workspaces.length === 2);
}
{
  fileReadResult = { ok: false };
  const missing = await bridge.readTerminalConfigFile();
  assert('missing file reports missing', missing.status === 'missing', JSON.stringify(missing));
}

/* ── 2b. new attach API (DSH 0.2.1-rc.2) ───────────────────────────────── */
console.log('\n终端 attach API');
{
  const sent = [];
  let frameResolve = null;
  const handle = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return new Promise((resolve) => { frameResolve = () => resolve({ value: { type: 'output', data: '__DW_DONE_0__\n' }, done: false }); });
        },
        return() { return Promise.resolve({ done: true }); }
      };
    },
    send(command) {
      sent.push(command);
      setTimeout(() => { if (frameResolve) { const fn = frameResolve; frameResolve = null; fn(); } }, 0);
    }
  };
  const terminal = {
    create: async () => ({ id: 't1' }),
    rename: async () => {},
    attach: async () => ({
      ...handle,
      [Symbol.asyncIterator]() {
        let first = true;
        return {
          next() {
            if (first) { first = false; return Promise.resolve({ value: { type: 'snapshot' }, done: false }); }
            return handle[Symbol.asyncIterator]().next();
          },
          return() { return Promise.resolve({ done: true }); }
        };
      }
    })
  };
  const outcome = await bridge.termRunSequence(
    { terminal, t: (k) => k, uuid: () => 't1', now: () => 'now' },
    'sess-1',
    { label: 'x', commands: [{ label: 'x', command: 'echo hi' }], timeoutMs: 1000, cwd: '/tmp/x' }
  );
  assert('new attach path writes a write frame', sent.length === 1 && sent[0].type === 'write' && String(sent[0].data).includes('echo hi'), JSON.stringify(sent));
  assert('new attach path sees the end marker', outcome.state === 'done' && outcome.code === 0, JSON.stringify(outcome));
  assert('new attach path captures output for the B log', typeof outcome.output === 'string' && outcome.output.includes('__DW_DONE_0__'), JSON.stringify(outcome.output));
}

/* ── 3. wiring / no polling / manual button ─────────────────────────────── */
console.log('\n接线');
assert('no 5s polling for the file', !/setInterval\([^)]*readTerminalConfigFile/.test(src));
assert('the page has an immediate read button', /t\("term\.fileRead"\)/.test(src) && /"term-file-read"/.test(src));
assert('the page shows the file status', /"data-dw-term-file-status"/.test(src));
assert('the page shows parser errors', /"term-file-errors"/.test(src));
assert('the file replaces the whole list (status wording)', /"term\.fileReplaced"/.test(src));
assert('header subscribes to the terminal-config event', /addEventListener\("dsh-deepworker:terminal-config"/.test(src));
assert('wsWriteAll dispatches the event', /dispatchEvent\(new window\.Event\("dsh-deepworker:terminal-config"\)\)/.test(src));
assert('cwd falls back to the session snapshot', /binding\.session\.getSnapshot\(\)/.test(src) && /state\.cwd/.test(src));
assert('workspaces render as a table', /"ws-table"/.test(src) && /"th-workspace"/.test(src));
assert('table has all four column labels', ['term.wsColWorkspace', 'term.wsColStart', 'term.wsColStop', 'term.wsColActions'].every((key) => src.includes('"' + key + '"')));
assert('new workspace opens a modal', /"term-new-modal"/.test(src) && /term\.wsCreate/.test(src) && /newOpen/.test(src));
assert('each extra has its own pre editor', /"editor-extra-pre"/.test(src) && /term\.extraPreFor/.test(src) && /patchExtraPreList/.test(src));
assert('recent output panel exists', /"term-logs"/.test(src) && /term\.logsTitle/.test(src) && /appendTermLog/.test(src));
assert('per-workspace file log toggle exists', /term\.logToFile/.test(src) && /termLoggedCommand/.test(src));
assert('remote.terminal is declared in the client inject list', /var inject = \[[^\]]*"remote\.terminal"/.test(src));
assert('the inline add form is gone', !/ws-add-form/.test(src) && !/newPathState/.test(src));
assert('empty extra rows survive editing', /normalized\.extras = merged\.extras/.test(src));
assert('new-workspace modal opens on the next tick', /setTimeout\(function \(\) \{ setNewOpen\(true\); \}, 0\)/.test(src));
assert('new-workspace modal ignores the opening click tail', /Date\.now\(\) - newOpenedAt\.current < 300/.test(src));

if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed (${where})`);
  process.exit(1);
}
console.log(`\nPASS: the button page reads an agent-authored JSON file on demand, strictly, and never polls (${where})`);
process.exit(0);
