#!/usr/bin/env node
/**
 * 编辑重发必须挂在用户气泡下面，而不是助手 turnTail 里。
 *
 * DSH 0.2.1-rc.2 没有 user-actions 槽位，所以这是一个**有意的 DOM 定位回退**：
 * 原生按钮挂到 body，用 [data-chat-turn] + userRow 找到用户气泡，position:fixed
 * 贴在气泡下方。这里锁住源码形状；真实 DOM 位置只能真机验。
 */
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TARGET = process.env.HA_CLIENT_JS || path.join(PKG, 'lib/client.js');
const src = fs.readFileSync(TARGET, 'utf8');
let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failed++; console.error('  FAIL ' + m); };
const need = (re, m) => { if (re.test(src)) ok(m); else bad(m); };

need(/data-dw-user-edit/, 'native user-edit button marker exists');
need(/querySelectorAll\('\[data-chat-turn="/, 'locates the turn container');
need(/\[class\*="userRow"\]/, 'locates the user bubble row');
need(/document\.body\.appendChild\(button\)/, 'mounts the button outside React-managed rows');
need(/position:fixed/, 'positions it relative to the viewport');
need(/resendRef\.current\(\)/, 'click invokes the existing resend dialog');
need(/action\.resend/, 'resend copy key remains');

// 这排 turnTail 不再直接渲染编辑重发按钮。
const rowAt = src.indexOf('function HistoryTurnActions');
const rowEnd = src.indexOf('return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment', rowAt);
const rowSrc = rowAt < 0 || rowEnd < 0 ? '' : src.slice(rowAt, rowEnd);
if (rowSrc !== '' && !/onClick: onResendOpen/.test(rowSrc)) ok('turnTail no longer renders the edit button');
else bad('turnTail still renders onClick: onResendOpen');

if (failed) { console.error(`\nUSER EDIT ANCHOR: ${failed} failed`); process.exit(1); }
console.log('\nUSER EDIT ANCHOR PASSED');
