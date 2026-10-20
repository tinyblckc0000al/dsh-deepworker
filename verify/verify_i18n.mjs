// Dictionary guard.
//
// A duplicated key in an object literal is silently allowed and the LAST one wins —
// the same shadowing that hides dead code, except here it hid a translation. Four
// English strings had been appended into the Chinese dictionary, so `zh["retry.noText"]`
// resolved to English while every other label stayed Chinese. The user saw exactly one
// English toast in an otherwise Chinese UI.
//
// Also checks key parity, and that a Chinese entry is not a long English sentence.
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const lines = code.split('\n');
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);

/** The line range of an object literal starting at `var NAME = {`, by brace depth. */
function block(name) {
  const startRe = new RegExp('^\\s*var ' + name + ' = \\{$');
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (startRe.test(lines[i])) { start = i; break; }
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (depth === 0 && i > start) return { start, end: i };
  }
  return null;
}

const zh = block('zh');
const en = block('en');
if (!zh || !en) {
  console.error('FAIL: could not locate the zh / en dictionary literals');
  process.exit(1);
}

const entries = (range) => {
  const out = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const m = /^\s*"([A-Za-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/.exec(lines[i]);
    if (m) out.push({ key: m[1], value: m[2], line: i + 1 });
  }
  return out;
};
const zhEntries = entries(zh);
const enEntries = entries(en);
console.log('dictionary entries -> zh ' + zhEntries.length + ' | en ' + enEntries.length);
if (zhEntries.length < 50 || enEntries.length < 50) fail('a dictionary looks truncated; the split is wrong');

// 1) no duplicate keys inside one dictionary
for (const [label, list] of [['zh', zhEntries], ['en', enEntries]]) {
  const seen = new Map();
  for (const item of list) {
    if (seen.has(item.key)) {
      fail(label + ' declares "' + item.key + '" twice (lines ' + seen.get(item.key) + ' and ' + item.line + '); the last one wins silently');
    }
    seen.set(item.key, item.line);
  }
}
if (failures === 0) ok('no duplicate keys in either dictionary');

// 2) the two dictionaries must describe the same keys
const zhKeys = new Set(zhEntries.map((e) => e.key));
const enKeys = new Set(enEntries.map((e) => e.key));
const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k));
const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k));
if (onlyZh.length > 0) fail('missing from en: ' + onlyZh.join(', '));
if (onlyEn.length > 0) fail('missing from zh: ' + onlyEn.join(', '));
if (onlyZh.length === 0 && onlyEn.length === 0) ok('zh and en cover the same ' + zhKeys.size + ' keys');

// 3) a long entry in the Chinese dictionary with no Chinese characters is a leak: an
//    English string pasted into the wrong block is exactly how the bug above happened.
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;
// Placeholders are not prose: "{index}. {prompt} → {response}" is a legitimate template.
const prose = (value) => value.replace(/\{[a-zA-Z0-9_]+\}/g, ' ');
const leaks = zhEntries.filter((e) => e.value.length > 24 && !CJK.test(e.value) && /[A-Za-z]{4,}/.test(prose(e.value)));
if (leaks.length > 0) {
  for (const leak of leaks) console.error('  line ' + leak.line + ': zh["' + leak.key + '"] has no Chinese: ' + leak.value.slice(0, 60));
  fail(leaks.length + ' long entry(ies) in zh look like English');
} else {
  ok('no long English text in the zh dictionary');
}

console.log(failures === 0 ? '\nDICTIONARY CHECKS PASSED' : '\n' + failures + ' check(s) failed');
process.exit(failures === 0 ? 0 : 1);
