#!/usr/bin/env node
/**
 * verify_notes_capture.mjs — 笔记的两个新入口必须真的接线、真的会说话：
 *   ① 对话里选中文字 → 右键「存为笔记」
 *   ② 笔记页 →「从剪贴板存为笔记」（读不到剪贴板时退回粘贴框，不静默失败）
 *
 * 为什么用结构断言而不是只看文本：本机反复踩过"文本在、行为没接"的假绿。
 * 这里每条都钉住**触发条件 → 调用 → 失败回执**三段，并且由配套的
 * verify_notes_capture_mutations.mjs 逐条证明它们会红。
 *
 * 用法：node verify/verify_notes_capture.mjs
 *       HA_CLIENT_JS=/tmp/x.mjs node verify/verify_notes_capture.mjs   # 变异体
 * 退出码：0 = 全绿；1 = 至少一条红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const TARGET = process.env.HA_CLIENT_JS || path.join(PKG, 'lib', 'client.js');
const src = fs.readFileSync(TARGET, 'utf8');
const where = path.relative(PKG, TARGET);

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const count = (re) => { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); const m = src.match(g); return m === null ? 0 : m.length; };
const must = (re, n, label) => {
  const got = count(re);
  if (got !== n) { fail(`${label}: expected ${n} occurrence(s), found ${got}`); return false; }
  ok(`${label} (${n})`);
  return true;
};
const mustAtLeast = (re, n, label) => {
  const got = count(re);
  if (got < n) { fail(`${label}: expected at least ${n} occurrence(s), found ${got}`); return false; }
  ok(`${label} (${got})`);
  return true;
};
const block = (startMark, endMark) => {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a < 0 ? 0 : a);
  if (a < 0 || b < 0 || b <= a) return null;
  return src.slice(a, b);
};

/* ── 1. 双语词典：每个新键必须恰好两份（zh + en）──────────────────────────── */
console.log('i18n');
const KEYS = [
  'menu.saveNote',
  'notes.savedFromSelection',
  'notes.selectionEmpty',
  'notes.fromClipboard',
  'notes.clipboardEmpty',
  'notes.clipboardFailed',
  'notes.clipboardHint',
  'notes.clipboardSave',
  'notes.clipboardCancel',
  'notes.clipboardSaved',
];
for (const key of KEYS) {
  const re = new RegExp('"' + key.replace(/[.]/g, '\\.') + '"\\s*:');
  must(re, 2, `${key} exists in both dictionaries`);
}

/* ── 2. 右键菜单：受 featureNotes 门控，且两处都挂 ───────────────────────── */
console.log('\n右键「存为笔记」');
{
  const menuFn = block('function installContextMenu(t, options) {', 'function onPointerDown(ev) {');
  if (menuFn === null || !/var notesOn = featureEnabled\("featureNotes"\);/.test(menuFn)) {
    fail('the context menu does not read the featureNotes gate');
  } else ok('context menu reads the featureNotes gate');
}
must(/if \(notesOn && selected !== ""\) items\.push\(makeItem\(t\("menu\.saveNote"\)/, 1, 'user-message menu adds the note item only when a selection exists');
mustAtLeast(/makeItem\(t\("menu\.saveNote"\)/g, 2, 'the note item is wired in both menu paths (message row + selection)');
mustAtLeast(/saveSelectionNote\(/g, 3, 'saveSelectionNote is defined and called from both paths');

{
  const fn = block('function saveSelectionNote(text, ev, sourceSessionId, sourceTurn) {', 'function onContextMenu(ev) {');
  if (fn === null) fail('saveSelectionNote body could not be located');
  else {
    if (!/var value = String\(text == null \? "" : text\)\.trim\(\);/.test(fn)) fail('saveSelectionNote does not trim/normalize the selection');
    else ok('saveSelectionNote normalizes the selected text');
    if (!/writeNotes\(next\)/.test(fn)) fail('saveSelectionNote never persists through writeNotes()');
    else ok('saveSelectionNote persists through writeNotes()');
    if (!/if \(!stored\.ok\)/.test(fn)) fail('saveSelectionNote ignores writeNotes() failure — a full store would look saved');
    else ok('saveSelectionNote branches on the write result');
    if (!/notes\.writeFailed[^\n]*always: true/.test(fn)) fail('saveSelectionNote does not report a failed write with always:true (it would be silenced by the notice switch)');
    else ok('saveSelectionNote reports write failure visibly');
    if (!/notes\.savedFromSelection/.test(fn)) fail('saveSelectionNote never reports success');
    else ok('saveSelectionNote reports success');
  }
}

/* 选区路径：引用关掉时笔记必须仍然出现（这是两个独立开关）。 */
{
  const re = /if \(!quoteOn\) \{\s*if \(fallbackItems\.length > 0\) openMenu\(ev, fallbackItems\);\s*return;\s*\}/;
  if (!re.test(src)) fail('when quote is off the selection path still returns early — 「存为笔记」would disappear with the quote switch');
  else ok('selection path keeps 「存为笔记」available when quote is off');
}

/* ── 3. 笔记页：剪贴板入口 ──────────────────────────────────────────────── */
console.log('\n笔记页「从剪贴板存为笔记」');
must(/function fromClipboard\(\) \{/, 1, 'fromClipboard handler exists');
must(/nav\.clipboard\.readText\(\)\.then\(function \(value\) \{/, 1, 'fromClipboard reads the async clipboard');
must(/\}, fallback\);/, 1, 'clipboard read rejection is handled (no unhandled rejection)');
must(/var fallback = function \(\) \{ setClipOpen\(true\); setClipText\(""\); \};/, 1, 'rejection opens the paste-box fallback');
must(/if \(String\(value == null \? "" : value\)\.trim\(\) === ""\) \{[\s\S]{0,200}notes\.clipboardEmpty/, 1, 'empty clipboard is reported, not silently saved');
must(/addText\(value\);/, 1, 'successful read goes through the shared addText path');
must(/function addText\(value\) \{/, 1, 'addText helper exists');
must(/return stored\.ok;/, 1, 'addText returns the real write result');
must(/if \(addText\(clipText\[0\]\)\) \{/, 1, 'the fallback dialog closes only after a successful write');

/* 按钮与粘贴框 */
must(/onClick: fromClipboard/, 1, 'the clipboard button is wired');
must(/children: t\("notes\.fromClipboard"\)/, 1, 'the clipboard button has a visible label');
must(/clipOpen\[0\] \?/, 1, 'the paste-box fallback is rendered conditionally');
must(/children: t\("notes\.clipboardFailed"\)/, 1, 'the fallback explains why it opened');
must(/placeholder: t\("notes\.clipboardHint"\)/, 1, 'the fallback tells the user to paste');
must(/disabled: clipText\[0\]\.trim\(\) === ""/, 1, 'the fallback save button refuses empty input');
must(/children: t\("notes\.clipboardSave"\)/, 1, 'the fallback save button has a visible label');

/* 失败必须可见：写本地存储失败时不能装作保存成功。 */
console.log('\n失败可见性');
mustAtLeast(/showNotice\(t\("notes\.writeFailed"\)/g, 2, 'both note-writing paths report storage failure');
mustAtLeast(/notes\.writeFailed[^\n]*always: true/, 1, 'storage failure bypasses the notice switch (always:true)');

/* ── 收口 ─────────────────────────────────────────────────────────────── */
if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed (${where})`);
  process.exit(1);
}
console.log(`\nPASS: both note-capture entries are wired, gated, and speak on failure (${where})`);
process.exit(0);
