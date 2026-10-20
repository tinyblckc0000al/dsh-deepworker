import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } } };
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxRuntimeMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function(){}, Button: function(){} };
const mockRequire = (id) => id === 'react' ? reactMock : id === 'react/jsx-runtime' ? jsxRuntimeMock : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock : (() => { throw new Error('unexpected require ' + id); })();
const sandbox = { window: windowObj, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

let registered = null;
const calls = { created: [], selected: [], prompted: [], opened: [], wsCreated: [], picks: 0 };
const wsItems = [
  { workspaceId: 'ws-a', title: 'project', path: '/Users/x/work/project', sessionIds: ['source-1'], updatedAt: 't' },
  { workspaceId: 'ws-b', title: 'Other', path: '/Users/x/other', sessionIds: [], updatedAt: 't' }
];
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: (n, f) => { f(); }, register: (c) => { if (c.name === 'conversation.chat.turnTail') registered = c; } },
  sessions: {
    create: async (opts) => { calls.created.push(opts); return 'new-session-' + calls.created.length; },
    // The REAL ClientSessions summary shape carries `id`, not `sessionId`
    // (api-session-controller); the mock used to repeat our own mistake and hid it.
    list: { getSnapshot: () => ({ ids: ['source-1', 'other-7', 'legacy-3', 'blank-5', 'untitled-6', 'broken-4'], byId: {
      'source-1': { id: 'source-1', title: 'project讨论', cwd: '/Users/x/work/project', updatedAt: 3000 },
      'other-7': { id: 'other-7', title: '另一个对话', cwd: '/Users/x/other', updatedAt: 2000 },
      'legacy-3': { sessionId: 'legacy-3', title: '旧字段形状', cwd: '/Users/x/legacy', updatedAt: 1000 },
      'blank-5': { id: 'blank-5', title: 'session-blank-5', cwd: '/Users/x/p', blank: true },
      'untitled-6': { id: 'untitled-6', title: 'session-untitled-6', cwd: '/Users/x/p', updatedAt: 500 },
      'broken-4': { title: '没有 id 的脏数据' }
    } }) }
  },
  uiWorkspace: {
    openSession: (id) => calls.opened.push(id),
    workspaces: { list: { getSnapshot: () => ({ items: wsItems, pinnedSessionIds: [], archivedSessionIds: [], phase: 'ready' }) } },
    pickDirectory: async () => { calls.picks++; return '/Users/x/picked-dir'; }
  },
  remote: {
    session: { prompt: async (r) => { calls.prompted.push(r); return { ok: true, value: { accepted: true } }; } },
    agentPresets: { list: async () => ({ ok: true, value: { presets: [{ id: 'standard', name: '标准', isDefault: true }, { id: 'ptc', name: 'PTC' }] } }), select: async (s, p) => { calls.selected.push([s, p]); return { ok: true, value: p }; } },
    workspace: { create: async (req) => { calls.wsCreated.push(req); return { ok: true, value: { workspace: { workspaceId: 'ws-new', title: 'picked-dir', path: req.path, sessionIds: [], updatedAt: 't' }, created: true } }; } }
  }
};
exportsObj.apply(ctx);
if (!registered) fail('slot not registered');
console.log('inject ->', JSON.stringify(exportsObj.inject));
if (!exportsObj.inject.includes('remote.workspace')) fail('remote.workspace not injected');

const props = registered.inject('source-1');
// listWorkspaces reads the client workspace model
const rows = props.listWorkspaces();
console.log('listWorkspaces ->', JSON.stringify(rows.map(r => ({ id: r.id, title: r.title }))));
if (rows.length !== 2 || rows[0].id !== 'ws-a') fail('workspace list wrong');
if (rows[0].sessionIds.indexOf('source-1') === -1) fail('sessionIds not carried');

// pickWorkspace registers a directory
const picked = await props.pickWorkspace();
console.log('pickWorkspace ->', JSON.stringify(picked), 'remote calls ->', JSON.stringify(calls.wsCreated));
if (calls.picks !== 1) fail('pickDirectory not called');
if (calls.wsCreated[0].path !== '/Users/x/picked-dir') fail('workspace.create path wrong');
if (picked.id !== 'ws-new') fail('picked workspace id wrong');

// createWithMode applies workspaceId
const id = await props.createWithMode('source-1', 'ptc', 'ws-b', '继续 X');
console.log('createWithMode(ws-b) ->', id, 'create opts ->', JSON.stringify(calls.created));
if (id !== 'new-session-1') fail('createWithMode id wrong');
if (calls.created[0].workspaceId !== 'ws-b') fail('workspaceId not passed to create: ' + JSON.stringify(calls.created[0]));
if (calls.selected[0][0] !== 'new-session-1' || calls.selected[0][1] !== 'ptc') fail('preset select wrong');
const sent = calls.prompted[0];
if (sent.mode !== 'queue' || sent.sessionId !== 'new-session-1') fail('prompt payload wrong');
if (!sent.content[0].text.startsWith('@[project讨论](dsh-session:')) fail('mention should carry the source title as its label, got: ' + sent.content[0].text);
console.log('prompt text ->', JSON.stringify(sent.content[0].text));

// ---- the reference source is explicit and can differ from the active session ----
const sessions = props.listSessions();
console.log('listSessions ->', JSON.stringify(sessions.map((r) => ({ id: r.id, title: r.title, at: r.at }))));
if (sessions.length === 0) fail('listSessions returned nothing: the picker would show "(nothing to reference)"');
if (sessions.length !== 4) fail('session list wrong (expected 4 usable rows, got ' + sessions.length + '): ' + JSON.stringify(sessions.map((r) => r.id)));
if (sessions.map((r) => r.id).join(',') !== 'source-1,other-7,legacy-3,untitled-6') fail('session ids wrong: ' + JSON.stringify(sessions.map((r) => r.id)));
// a blank session has nothing to reference and would only show a raw id
if (sessions.some((r) => r.id === 'blank-5')) fail('blank sessions must be hidden from the reference picker');
// an untitled session keeps a short id instead of a 40-char canonical title
const untitled = sessions.find((r) => r.id === 'untitled-6');
if (!untitled || untitled.title !== 'untitled-6'.slice(0, 18)) fail('untitled sessions must show a short id, got ' + JSON.stringify(untitled));
if (untitled.title.length >= 40) fail('the raw canonical title must not be shown whole');
if (untitled.at !== 500) fail('the row must carry updatedAt so look-alikes can be told apart');
if (sessions[0].at !== 3000) fail('updatedAt not mapped');
if (sessions[0].title !== 'project讨论') fail('session title not mapped');
if (sessions[0].path !== '/Users/x/work/project') fail('session cwd not mapped to path');
if (sessions.some((r) => r.id === 'broken-4')) fail('a summary without any id must be skipped');

calls.prompted.length = 0; calls.selected.length = 0; calls.created.length = 0;
await props.createWithMode('other-7', 'ptc', 'ws-a', '接着聊');
const mentionText = calls.prompted[0].content[0].text;
const encoded = Buffer.from(JSON.stringify('other-7'), 'utf8').toString('base64url');
console.log('mention for chosen source ->', JSON.stringify(mentionText.split('\n')[0]));
if (mentionText.indexOf('dsh-session:' + encoded) === -1) fail('mention did not use the chosen source: ' + mentionText);
if (mentionText.indexOf('@[另一个对话]') !== 0) fail('mention label should be the chosen source title: ' + mentionText);

// no-workspace path
await props.createWithMode('source-1', 'standard', '', '');
console.log('createWithMode(no ws) opts ->', JSON.stringify(calls.created[1]));
if (calls.created[1] !== undefined && Object.keys(calls.created[1] || {}).length !== 0) fail('empty create should pass no workspaceId, got ' + JSON.stringify(calls.created[1]));

console.log('\nWORKSPACE CHECKS PASSED');
