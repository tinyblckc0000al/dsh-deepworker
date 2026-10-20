// Tags on notes.
//
// The contract that matters: storage stays clean (no `#`, no duplicates, no blanks),
// old notes keep working, and a tag survives both the append path (digests, where
// duplicates are intentional) and the merge path (imports, where they are not).
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req2 = createRequire(new URL('../', import.meta.url))  // 插件自己的 node_modules（不再借用工作区）;
const React = req2('react');
const jsx = req2('react/jsx-runtime');
const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (ok, label) => { if (ok) console.log('  ok   ' + label); else { failures++; console.error('  FAIL ' + label); } };

let stored = null;
const store = new Map();
const primitives = { Modal: () => null, Button: () => null, IconListPenOutlineRegular: () => null };
const req = (id) => id === 'react' ? React : id === 'react/jsx-runtime' ? jsx
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : (() => { throw new Error('unexpected ' + id); })();
let loaded = null;
const win = { __ModuleLoader__: { load: (r) => { loaded = r; } } };
const sandbox = {
  window: win, document: undefined,
  // Map-backed on purpose: the old mock could only hold the notes key, so a test could
  // not observe a BACKUP key — which is exactly what the corrupt-data fix writes.
  // `stored` stays the notes mirror (the suite seeds notes through it); `store` carries
  // every other key, so a test CAN observe a backup key — which the notes-only mock could not.
  localStorage: { getItem: (k) => (k === 'dsh.deepworker.notes' ? stored : (store.has(k) ? store.get(k) : null)), setItem: (k, v) => { store.set(k, String(v)); if (k === 'dsh.deepworker.notes') stored = String(v); }, removeItem: (k) => { store.delete(k); if (k === 'dsh.deepworker.notes') stored = null; } },
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
const api = mod.__test;

console.log('tag storage');

// ---- normalisation ----
{
  const norm = api.normalizeTags;
  check(JSON.stringify(norm('#部署')) === '["部署"]', 'a leading # is stripped');
  check(JSON.stringify(norm('  a , b ，c  ')) === '["a","b","c"]', 'commas and spaces split, full-width comma too');
  check(JSON.stringify(norm(['x', 'x', ' y'])) === '["x","y"]', 'duplicates collapse');
  check(JSON.stringify(norm(['', '  ', null])) === '[]', 'blanks are dropped');
  check(JSON.stringify(norm('#')) === '[]', 'a lone # is not a tag');
  check(norm(new Array(30).fill(0).map((_, i) => 't' + i)).length === 12, 'at most 12 tags');
  check(JSON.stringify(norm(['x'.repeat(40)])) === '[]', 'over-long tags are rejected');
  check(JSON.stringify(norm(undefined)) === '[]', 'undefined is safe');
  check(JSON.stringify(norm([123])) === '["123"]', 'numbers become text');
}

// ---- counts ----
{
  const tags = api.allTags([{ tags: ['b'] }, { tags: ['a', 'b'] }, { tags: [] }]);
  check(tags.length === 2, 'only used tags are listed');
  check(tags[0].tag === 'b' && tags[0].count === 2, 'ordered by count');
  check(tags[1].tag === 'a' && tags[1].count === 1, 'then by name');
  check(api.allTags([]).length === 0, 'empty list has no tags');
}

// ---- old notes stay valid, and tags reach storage ----
{
  stored = JSON.stringify([{ id: 'old', text: '不带标签的旧笔记' }]);
  const notes = api.readNotes();
  check(notes.length === 1 && Array.isArray(notes[0].tags) && notes[0].tags.length === 0, 'an old note gains an empty tag array');

  const appended = api.appendNote(notes, '新笔记', ['#排障', '排障', '部署']);
  check(JSON.stringify(appended.list[1].tags) === '["排障","部署"]', 'appendNote normalises the tags it stores');
  check(appended.list[0].tags.length === 0, 'the existing note is untouched');

  const merged = api.mergeNotes(notes, JSON.stringify([{ text: '导入的', tags: ['#导入'] }]));
  check(JSON.stringify(merged.list[1].tags) === '["导入"]', 'mergeNotes keeps imported tags');
  check(merged.added === 1, 'the import still counts as one');

  const noTags = api.appendNote([], '没有标签', undefined);
  check(JSON.stringify(noTags.list[0].tags) === '[]', 'omitting tags stores an empty array, not undefined');
}

// ---- a tag survives a storage round trip ----
{
  stored = null;
  const first = api.appendNote(api.readNotes(), '带标签的笔记', '排障, 部署');
  stored = JSON.stringify(first.list);
  const back = api.readNotes();
  check(JSON.stringify(back[0].tags) === '["排障","部署"]', 'tags survive write -> read');
}

// ---- filtering: a deleted tag must release the filter by itself ----
{
  const notes = [
    { id: 'a', text: '第一条', tags: ['排障'] },
    { id: 'b', text: '第二条', tags: ['部署', '排障'] },
    { id: 'c', text: '第三条', tags: [] }
  ];
  check(api.activeTagOf(notes, '排障') === '排障', 'an existing tag stays active');
  check(api.activeTagOf(notes, '不存在的标签') === '', 'a tag nobody carries is dropped (this is what un-sticks the page)');
  check(api.activeTagOf(notes, '') === '', 'no tag means no filter');
  check(api.filterNotes(notes, '', '排障').length === 2, 'tag filter narrows the list');
  check(api.filterNotes(notes, '', api.activeTagOf(notes, '删掉的标签')).length === 3, 'a deleted tag shows everything again');
  check(api.filterNotes(notes, '第三条', '').length === 1, 'search still narrows');
  check(api.filterNotes(notes, '部署', '').length === 1, 'search matches a tag name');
  check(api.filterNotes(notes, '#部署', '').length === 1, 'search tolerates a leading #');
  check(api.filterNotes(notes, '', '').length === 3, 'no filter shows all');
  check(api.filterNotes(notes, '', '')[0].id === 'c', 'newest first (last stored is shown first)');
  check(api.filterNotes(notes, '排障', '部署').length === 1, 'tag and search compose');
  check(api.filterNotes([], '', '').length === 0, 'empty list is safe');
}

// ---- storage failures must be reported, and the cap must be honest ----
//
// Three faults lived in writeNotes/writeSettings, all invisible to these suites because
// every harness had a setItem that always succeeds:
//   * the failure was swallowed, so callers said "saved" over nothing
//   * the 300-cap applied on write only, so the UI kept rows that were never stored
//   * a corrupt blob was overwritten with no copy — unrecoverable data loss
{
  const note = (i) => ({ id: 'n' + i, text: 'note ' + i, at: i });
  const small = [note(1), note(2)];
  const realSet = sandbox.localStorage.setItem;

  const big = [];
  for (let i = 0; i < 400; i++) big.push(note(i));
  const capped = api.writeNotes(big);
  check(capped.ok === true, 'a normal write reports ok');
  check(capped.list.length === 300, 'the stored list is capped (got ' + capped.list.length + ')');
  check(capped.dropped === 100, 'the dropped count is reported (got ' + capped.dropped + ')');
  check(api.readNotes().length === 300, 'storage holds exactly the capped list');
  check(capped.list[capped.list.length - 1].id === 'n399', 'the NEWEST notes survive the cap');

  sandbox.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const failed = api.writeNotes(small);
  const failedSettings = api.writeSettings({ quoteProvenance: true });
  sandbox.localStorage.setItem = realSet;
  check(failed.ok === false, 'a failing note write reports ok:false');
  check(/Quota/.test(failed.error || ''), 'the failure reason is carried (' + JSON.stringify(failed.error) + ')');
  check(failedSettings.ok === false, 'a failing settings write reports ok:false');

  // A corrupt blob must be copied aside before the next write overwrites it.
  stored = '{not json';
  store.set('dsh.deepworker.notes', '{not json');
  const recovered = api.writeNotes(small);
  const backups = [...store.keys()].filter((k) => k.indexOf(api.CORRUPT_BACKUP_PREFIX) === 0);
  check(recovered.ok === true, 'writing over a corrupt blob still succeeds');
  check(backups.length === 1, 'the corrupt blob is backed up (got ' + backups.length + ')');
  check(backups.length === 1 && store.get(backups[0]) === '{not json', 'the backup holds the original bytes');
  check(api.readNotes().length === 2, 'the new list is readable after the overwrite');
}

console.log(failures === 0 ? '\nTAG CHECKS PASSED' : '\n' + failures + ' check(s) failed');
process.exit(failures === 0 ? 0 : 1);
