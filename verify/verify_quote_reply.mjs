#!/usr/bin/env node
/**
 * 「引用回复」的默认目标必须是助手回复，不是用户提问。
 *
 * 回归背景：按钮挂在助手 turnTail 上，但无选区时曾回退 currentPrompt()（用户提问），
 * 于是「引用回复」实际引用了用户气泡。这里锁住三件事：
 *   1. 无选区时只走 assistantText；
 *   2. assistantText 来自 assistant-step 的 text blocks；
 *   3. 两者都没有时明确提示，不静默引用用户消息。
 */
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TARGET = path.join(PKG, 'lib/client.js');
const src = fs.readFileSync(TARGET, 'utf8');
let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failed++; console.error('  FAIL ' + m); };
const need = (re, m) => { if (re.test(src)) ok(m); else bad(m); };

need(/function assistantTextOf\(targetSessionId, turnNumber\)/, 'assistantTextOf exists');
need(/node\.kind !== "assistant-step"/, 'assistantTextOf reads assistant-step nodes');
need(/block\.kind === "text"[\s\S]{0,120}parts\.push\(block\.text\)/, 'assistantTextOf collects text blocks');
need(/assistantText: function \(turnNumber\) \{ return assistantTextOf\(sessionId, turnNumber\); \}/, 'turnTail injects assistantText');

const at = src.indexOf('function onQuote()');
if (at < 0) bad('onQuote not found');
else {
  const body = src.slice(at, src.indexOf('\n      }', at) + 8);
  if (/assistantText\(turnNumber\)/.test(body)) ok('onQuote falls back to assistantText'); else bad('onQuote does not use assistantText');
  if (!/currentPrompt\(\)/.test(body)) ok('onQuote no longer falls back to currentPrompt'); else bad('onQuote still falls back to the user prompt');
  if (/quote\.noAssistant/.test(body)) ok('onQuote says when there is no quotable reply'); else bad('onQuote silently returns without a notice');
  if (/fallback\.indexOf\(sel\) >= 0/.test(body)) ok('selection is used only when it is part of the assistant reply'); else bad('selection is not checked against the assistant reply');
  if (!/if \(sel !== ""\) \{ applyQuote\(sel\); return; \}/.test(body)) ok('no unconditional selection-first quote'); else bad('selection-first quote still bypasses the assistant reply');
  if (/function quoteFirstLine\(text\)/.test(src)) ok('quoteFirstLine helper exists'); else bad('quoteFirstLine helper missing');
  if (/var line = quoteFirstLine\(fallback\)/.test(body) && /applyQuote\(line, \{ ellipsis: true \}\)/.test(body)) ok('whole-reply fallback is reduced to one line with an ellipsis'); else bad('whole-reply fallback does not use a one-line ellipsis');
  if (/options\.ellipsis === true/.test(src) && /rendered\.slice\(0, -1\) \+ "…/.test(src)) ok('ellipsis is display-only; stored body stays raw'); else bad('ellipsis handling is missing or mutates the stored body');
}
need(/"quote\.noAssistant"/, 'quote.noAssistant locale key exists');

if (failed) { console.error(`\nQUOTE REPLY: ${failed} failed`); process.exit(1); }
console.log('\nQUOTE REPLY PASSED');
