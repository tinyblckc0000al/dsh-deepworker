#!/usr/bin/env node
/**
 * verify_notes_capture_mutations.mjs — 证明 verify_notes_capture.mjs 的每条断言**真的会红**。
 *
 * 纪律：检查器若不能在已知坏例上变红，就等于没有。每条变异都断言**红在期望的那一句**，
 * 而不只是"红了"；所有变异只写 /tmp 的副本，绝不触碰线上 lib/client.js。
 *
 * 用法：node verify/verify_notes_capture_mutations.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'verify_notes_capture.mjs');
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const SOURCE = fs.readFileSync(LIVE, 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-notes-mut-'));

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };

function runSuite(src) {
  const file = path.join(TMP, `client-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, src);
  const proc = spawnSync(process.execPath, [SUITE], { encoding: 'utf8', env: Object.assign({}, process.env, { HA_CLIENT_JS: file }) });
  const out = (proc.stdout || '') + (proc.stderr || '');
  return { code: proc.status, out, failLines: out.split('\n').filter((l) => /^FAIL\b/.test(l.trim())).map((l) => l.trim()) };
}

const mustReplace = (s, needle, replacement, what) => {
  const n = s.split(needle).length - 1;
  if (n !== 1) throw new Error(`anchor "${what}" occurs ${n} time(s), expected exactly 1`);
  return s.replace(needle, replacement);
};

function mutation({ name, mutate, expect }) {
  const src = mutate(SOURCE);
  if (src === SOURCE) { fail(`${name}: the mutation did not change the file (anchor missing) — a no-op proves nothing`); return; }
  const r = runSuite(src);
  if (r.code === 0 || r.failLines.length === 0) { fail(`${name}: the checker stayed GREEN — this mutation must be RED`); return; }
  const hit = r.failLines.find((l) => expect.test(l));
  if (!hit) { fail(`${name}: went RED but not for the expected reason.\n        want /${expect.source}/\n        got: ${r.failLines.slice(0, 4).join('\n             ')}`); return; }
  console.log(`  ok   ${name} -> RED`);
  console.log(`         ↳ ${hit.slice(0, 200)}`);
}

console.log(`tmp:   ${TMP}`);
console.log(`suite: ${SUITE}`);
console.log(`live:  ${LIVE} (${Buffer.byteLength(SOURCE)} bytes)\n`);

console.log('基线');
{
  const r = runSuite(SOURCE);
  if (r.code === 0 && r.failLines.length === 0) console.log('  ok   the live bundle is GREEN');
  else fail(`the baseline should be GREEN, got exit=${r.code}: ${r.failLines.slice(0, 3).join(' | ')}`);
}

console.log('\n词典 / 门控');
mutation({
  name: '① 删掉英文词典里的 menu.saveNote ⇒ 红（两种语言必须都有）',
  mutate: (s) => mustReplace(s, '      "menu.saveNote": "Save to notes",\n', '', 'en menu.saveNote'),
  expect: /menu\.saveNote exists in both dictionaries: expected 2 occurrence\(s\), found 1/,
});
mutation({
  name: '② 右键菜单不再读 featureNotes 开关（恒为真）⇒ 红',
  mutate: (s) => mustReplace(s,
    '        var quoteOn = featureEnabled("featureQuote");\n        var notesOn = featureEnabled("featureNotes");\n',
    '        var quoteOn = featureEnabled("featureQuote");\n        var notesOn = true;\n',
    'notesOn gate'),
  expect: /context menu does not read the featureNotes gate/,
});
mutation({
  name: '③ 去掉"必须有选中内容"的条件（没选中也挂菜单项）⇒ 红',
  mutate: (s) => mustReplace(s, 'if (notesOn && selected !== "") items.push', 'if (notesOn) items.push', 'selection guard'),
  expect: /user-message menu adds the note item only when a selection exists/,
});
mutation({
  name: '④ 引用关掉时选区直接 return（笔记跟着消失）⇒ 红',
  mutate: (s) => mustReplace(s,
    '        if (!quoteOn) {\n          if (fallbackItems.length > 0) openMenu(ev, fallbackItems);\n          return;\n        }\n',
    '        if (!quoteOn) return;\n',
    'quote/notes independence'),
  expect: /when quote is off the selection path still returns early/,
});
mutation({
  name: '⑤ 选区路径不再创建 noteItem（只剩消息行一条路）⇒ 红',
  mutate: (s) => mustReplace(s,
    '        var noteItem = notesOn ? makeItem(t("menu.saveNote"), function () { saveSelectionNote(selected, ev, sessionId, turn); }) : null;\n',
    '        var noteItem = null;\n',
    'selection noteItem'),
  expect: /the note item is wired in both menu paths|saveSelectionNote is defined and called from both paths/,
});

console.log('\n剪贴板');
mutation({
  name: '⑥ 删掉 readText 的拒绝分支 ⇒ 红（读不到剪贴板会变成未处理拒绝）',
  mutate: (s) => mustReplace(s, '            }, fallback);\n', '            });\n', 'readText rejection'),
  expect: /clipboard read rejection is handled|rejection opens the paste-box fallback/,
});
mutation({
  name: '⑦ 空剪贴板不再报空（静默继续）⇒ 红',
  mutate: (s) => mustReplace(s, 'if (String(value == null ? "" : value).trim() === "") {', 'if (false) {', 'empty clipboard check'),
  expect: /empty clipboard is reported/,
});
mutation({
  name: '⑧ 剪贴板按钮不再接到 fromClipboard ⇒ 红',
  mutate: (s) => mustReplace(s, 'onClick: fromClipboard,', 'onClick: function () {},', 'clipboard button handler'),
  expect: /the clipboard button is wired/,
});
mutation({
  name: '⑨ 退回粘贴框不再解释原因（只剩一个空框）⇒ 红',
  mutate: (s) => mustReplace(s, '                  children: t("notes.clipboardFailed")\n', '', 'clipboardFailed line'),
  expect: /the fallback explains why it opened|notes\.clipboardFailed exists in both dictionaries/,
});
mutation({
  name: '⑩ addText 谎报成功（恒返回 true）⇒ 红',
  mutate: (s) => mustReplace(s, 'return stored.ok;', 'return true;', 'addText result'),
  expect: /addText returns the real write result/,
});
mutation({
  name: '⑪ 粘贴框无论写没写成都会关闭 ⇒ 红',
  mutate: (s) => mustReplace(s,
    'if (addText(clipText[0])) {',
    'addText(clipText[0]);\n          if (true) {',
    'fallback close on success'),
  expect: /the fallback dialog closes only after a successful write/,
});

console.log('\n失败必须可见');
mutation({
  name: '⑫ 选区存笔记的写失败不再走 always（会被通知开关吞掉）⇒ 红',
  mutate: (s) => mustReplace(s,
    'showNotice(t("notes.writeFailed") + " " + (stored.error || ""), ev, { always: true });',
    'showNotice(t("notes.writeFailed") + " " + (stored.error || ""), ev);',
    'saveSelectionNote always'),
  expect: /saveSelectionNote does not report a failed write with always:true|storage failure bypasses the notice switch/,
});

console.log(`\n${failures === 0 ? 'GREEN' : 'RED'}: ${failures === 0 ? 'every mutation landed where it was supposed to' : failures + ' failure(s)'}`);
if (!process.env.KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true }); else console.log('TMP kept: ' + TMP);
process.exit(failures === 0 ? 0 : 1);
