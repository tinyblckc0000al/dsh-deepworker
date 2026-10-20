import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } } };
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function(){}, Button: function(){} };
const mockRequire = (id) => id === 'react' ? reactMock : id === 'react/jsx-runtime' ? jsxMock : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock : (() => { throw new Error('unexpected ' + id); })();
const sandbox = { window: windowObj, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

// Chat target snapshot: turn 0 owns a user node with two text blocks + an image
const userNode = { kind: 'user', key: 'k-user', data: { content: [
  { type: 'text', text: '第一行文字' },
  { type: 'image', mediaType: 'image/png', data: 'xxx' },
  { type: 'text', text: '第二行文字' }
] } };
const assistantNode = { kind: 'assistant-step', key: 'k-a', data: {} };
const chatSnapshot = {
  locations: { getTurn: (n) => (n === 0 ? ['k-user', 'k-a'] : []) },
  nodes: { get: (k) => (k === 'k-user' ? userNode : k === 'k-a' ? assistantNode : undefined) }
};
let snapshot = chatSnapshot;
let bindingCalls = [];
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: (n, f) => { f(); }, register: (c) => { if (c.name === 'conversation.chat.turnTail') registered = c; } },
  sessions: { create: async () => 'x', fork: async () => 'y' },
  uiConversation: { binding: (id) => { bindingCalls.push(id); return { target: (name) => ({ getSnapshot: () => (name === 'chat' ? snapshot : undefined) }) }; } },
  uiWorkspace: { openSession: () => {}, archiveSession: async () => {}, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '' },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
};
let registered = null;
exportsObj.apply(ctx);
if (!exportsObj.inject.includes('uiConversation')) fail('uiConversation not injected');

const props = registered.inject('sess-1');
if (typeof props.userText !== 'function') fail('userText not provided');

const text = props.userText(0);
console.log('userText(0) ->', JSON.stringify(text));
if (text !== '第一行文字\n第二行文字') fail('user text wrong: ' + JSON.stringify(text));
if (!bindingCalls.includes('sess-1')) fail('chat binding not resolved from the session id');

// unknown turn -> empty
if (props.userText(7) !== '') fail('unknown turn should yield empty text');
// no snapshot at all -> empty, no throw
snapshot = undefined;
if (props.userText(0) !== '') fail('missing snapshot should yield empty text');
// throwing binding -> empty, no throw
ctx.uiConversation.binding = () => { throw new Error('boom'); };
if (props.userText(0) !== '') fail('throwing binding should yield empty text');

console.log('\nPROMPT-TEXT CHECKS PASSED');
