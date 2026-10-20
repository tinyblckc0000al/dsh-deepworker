// In-conversation find.
//
// The contract that matters is that a match carries a TURN: that is what makes it
// jumpable (`[data-turn-tail="<turn>"]`). DSH's own `session.search` returns
// session-level snippets with no turn or seq, so it cannot place a hit in the
// transcript — and its FTS tokenizer cannot match a Chinese substring like "部署" at
// all, which is the main reason this exists.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req2 = createRequire(new URL('../', import.meta.url))  // 插件自己的 node_modules（不再借用工作区）;
const React = req2('react');
const jsx = req2('react/jsx-runtime');
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (ok, label) => { if (ok) console.log('  ok   ' + label); else { failures++; console.error('  FAIL ' + label); } };

const primitives = { Modal: () => null, Button: () => null, IconListPenOutlineRegular: () => null };
const req = (id) => id === 'react' ? React : id === 'react/jsx-runtime' ? jsx
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : (() => { throw new Error('unexpected ' + id); })();
let loaded = null;
const sandbox = {
  window: { __ModuleLoader__: { load: (r) => { loaded = r; } } }, document: undefined,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  require: req, TextEncoder, btoa, atob, TextDecoder, setTimeout, clearTimeout,
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const mod = loaded.factory(req);
mod.apply({
  effect: (f) => { f(); return () => {}; }, locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: () => {}, register: () => {} }, shortcuts: { register: () => () => {} },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  sessions: { create: async () => 'x', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: { openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 's' }, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '' },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
});
const find = mod.__test.findInConversation;

const outline = [
  { turn: 1, prompt: '帮我改一下部署脚本', response: '好的，先看 deploy.sh 的结构。' },
  { turn: 2, prompt: '为什么队列会重试两次', response: '因为 ack 超时后没有幂等键。' },
  { turn: 3, prompt: 'Deploy 的日志在哪', response: '在 ~/.dsh/logs 下面。' }
];

console.log('in-conversation find');

check(find('', outline).length === 0, 'an empty query matches nothing');
check(find('   ', outline).length === 0, 'whitespace only matches nothing');
check(find(undefined, outline).length === 0, 'undefined query is safe');
check(find('部署', outline).length === 1, 'matches a Chinese substring (DSH FTS cannot)');
check(find('部署', outline)[0].turn === 1, 'match carries its turn — this is what makes it jumpable');
check(find('部署', outline)[0].side === 'prompt', 'a prompt hit is labelled as such');
check(find('幂等键', outline)[0].side === 'response', 'a response hit is labelled as such');
check(find('deploy', outline).length === 2, 'case-insensitive, and finds every occurrence');
check(find('DEPLOY', outline).length === 2, 'upper case behaves the same');
check(find('队列', outline)[0].turn === 2, 'the right turn for a later match');
check(find('的', outline).length === 2, 'a common character matches in the two turns that contain it');
check(find('不存在的词', outline).length === 0, 'no match returns an empty list');
check(find('部署', undefined).length === 0, 'a missing outline is safe');
check(find('部署', [null, {}, { turn: 'x' }]).length === 0, 'junk outline entries are skipped');

// ordering + both-sides
{
  const both = find('ack', [{ turn: 5, prompt: 'ack 是什么', response: 'ack 是确认' }]);
  check(both.length === 2 && both[0].side === 'prompt' && both[1].side === 'response', 'one turn can match on both sides');
  const many = find('日志', [
    { turn: 9, prompt: '日志', response: '' },
    { turn: 4, prompt: '', response: '日志在这里' }
  ]);
  check(many.map((m) => m.turn).join(',') === '9,4', 'results follow the outline order (the transcript order)');
}

// snippets
{
  const long = 'x'.repeat(120) + '部署脚本' + 'y'.repeat(120);
  const hit = find('部署', [{ turn: 1, prompt: long, response: '' }])[0];
  check(hit.snippet.indexOf('部署') !== -1, 'the snippet contains the hit');
  check(hit.snippet.length < 90, 'the snippet is clipped, not the whole message');
  check(hit.snippet.slice(0, 1) === '…' && hit.snippet.slice(-1) === '…', 'a clipped snippet is marked on both sides');
  const short = find('部署', [{ turn: 1, prompt: '部署', response: '' }])[0];
  check(short.snippet === '部署', 'a short match is not padded with ellipses');
}

// ---- every match must carry the app's OWN anchor ----
// The right-side index scrolls by `data-chat-anchor-key`; the turnOutline projection
// publishes exactly that key. Jumping by a guessed attribute is how the first version
// managed to scroll nowhere.
{
  const withAnchors = [
    { turn: 1, anchorKey: 'flow:aaa', prompt: '部署脚本', response: '' },
    { turn: 2, anchorKey: 'flow:bbb', prompt: '', response: '部署完成' },
    { turn: 3, prompt: '部署没有 anchorKey', response: '' }
  ];
  const hits = find('部署', withAnchors);
  check(hits.length === 3, 'three turns match');
  check(hits[0].anchor === 'flow:aaa', 'a match carries the turn anchorKey');
  check(hits[1].anchor === 'flow:bbb', 'each match carries its own anchor');
  check(hits[2].anchor === '', 'a missing anchorKey becomes an empty anchor, not undefined');
}

// ---- the find command ships a real default binding ----
// "Unbound command" was the honest state while the mechanism was unproven; a feature
// nobody can reach is not finished. mod+f is free in DSH, but a browser eats it for its
// own find, so the web targets use primary+alt (DSH's own convention for that case).
{
  const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const block = code.match(/var FIND_KEY_DEFAULTS = \{[\s\S]*?\n        \};/);
  check(block !== null, 'the find key defaults exist');
  const text = block === null ? '' : block[0];
  // ⚠️ 2026-10-15: the `web:linux` profile was REMOVED — it was never legal. DSH's
  // `isWebBindingAllowed` (app.asar dsh-client-shortcuts/lib/client.js:109-131) widens the rule
  // ONLY for `platform === "windows" || platform === "macos"`; on web+linux just three
  // hard-coded combinations are admitted (primary+Slash, primary+shift+Comma, primary+shift+Period).
  // `KeyF + primary + alt` there made `ctx.shortcuts.register` throw
  // `Unsupported Web shortcut: deepworker.find` for the WHOLE command (register is atomic —
  // it throws before `commands.set`), so `deepworker.find` never entered the command table
  // and Settings printed `find=failed: …`. The five remaining profiles all pass.
  const KEPT = ['desktop:macos', 'desktop:windows', 'desktop:linux', 'web:macos', 'web:windows'];
  for (const platform of KEPT) {
    check(text.indexOf('"' + platform + '"') !== -1, 'binding declared for ' + platform);
  }
  check(text.indexOf('"web:linux"') === -1, 'the illegal web:linux profile must NOT be claimed');
  const claimedKeys = text.match(/"(?:desktop|web):[a-z]+"\s*:/g) || [];
  check(claimedKeys.length === KEPT.length,
    'exactly ' + KEPT.length + ' profiles are claimed, got ' + JSON.stringify(claimedKeys));
  check(/code: "KeyF"/.test(text), 'the binding is the F key');
  check(/modifiers: \["primary", "alt"\]/.test(text.split('web:macos')[1] || ''), 'the web binding avoids the browser find');
  // Anchor on the closing paren at the SAME indent: a lazy match stops at the first
  // ");", which is the one inside the label callback.
  const findDecl = code.match(/"deepworker\.find",[\s\S]{0,600}?\n        \);/);
  check(findDecl !== null && findDecl[0].indexOf('FIND_KEY_DEFAULTS') !== -1, 'the find command receives the default binding');
  check(/defaults: defaults \|\| \{\}/.test(code), 'declare() forwards the defaults');
}

console.log(failures === 0 ? '\nFIND CHECKS PASSED' : '\n' + failures + ' check(s) failed');
process.exit(failures === 0 ? 0 : 1);
