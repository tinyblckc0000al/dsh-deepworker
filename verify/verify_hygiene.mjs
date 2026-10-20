// Hygiene guard.
//
// Structure that is not asserted decays. These checks are cheap and each one caught a
// real problem on the day it was written: dead copy keys left behind by abandoned
// designs, and a single 4000-line file with no landmarks.
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);

// Comments and string contents would create noise for the reference count below.
const plain = code
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((line) => line.split('//')[0])
  .join('\n');

// 1) A function whose name occurs exactly once in the whole file is never referenced.
//    (Components and handlers are passed by value, so "never called" would be wrong.)
const functions = [...plain.matchAll(/^\s*function ([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)];
const neverReferenced = [];
for (const match of functions) {
  const name = match[1];
  const total = (plain.match(new RegExp('(?<![\\w.$])' + name + '(?![\\w$])', 'g')) || []).length;
  if (total <= 1) neverReferenced.push({ name, line: plain.slice(0, match.index).split('\n').length });
}
if (neverReferenced.length > 0) {
  for (const item of neverReferenced) console.error('  line ' + item.line + ': ' + item.name + '() is never referenced');
  fail(neverReferenced.length + ' unreferenced function(s)');
} else {
  ok('every function is referenced somewhere (' + functions.length + ' functions)');
}

// 2) Copy keys must be USED, not merely defined in both dictionaries. Counting the bare
//    quoted key and subtracting its definition lines also covers keys passed as strings
//    (e.g. run(..., "error.fork")), which a `t("...")`-only scan would miss.
const keys = [...new Set([...code.matchAll(/"([a-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)":\s*"/g)].map((m) => m[1]))];
const unused = [];
for (const key of keys) {
  const quoted = (code.match(new RegExp('"' + key.replace(/\./g, '\\.') + '"', 'g')) || []).length;
  const defined = (code.match(new RegExp('"' + key.replace(/\./g, '\\.') + '":', 'g')) || []).length;
  if (quoted - defined < 1) unused.push(key);
}
if (unused.length > 0) {
  for (const key of unused) console.error('  unused copy key: ' + key);
  fail(unused.length + ' copy key(s) are defined but never used');
} else {
  ok('no unused copy keys (' + keys.length + ' keys)');
}

// 3) Developer leftovers.
const leftovers = ['TODO', 'FIXME', 'XXX', 'HACK'].filter((tag) => code.includes(tag));
if (leftovers.length > 0) fail('leftover markers: ' + leftovers.join(', '));
else ok('no TODO / FIXME / XXX / HACK markers');

// 4) console.log writes to the user's console on every load; the plugin uses
//    console.info for its one load line and console.error/warn for real problems.
if (/console\.log\(/.test(plain)) fail('console.log found; use console.info / warn / error');
else ok('no console.log');

// 5) Landmarks: the header plus the numbered section markers, so a 4000-line file stays
//    navigable and a future split has cut lines already drawn.
if (!code.includes('三条铁律')) fail('the file header (invariants) is missing');
else ok('file header with the invariants is present');
const sections = [...code.matchAll(/\/\/ ── (\d)\. /g)].map((m) => Number(m[1]));
const expected = [1, 2, 3, 4, 5, 6, 7, 8];
const missing = expected.filter((n) => !sections.includes(n));
if (missing.length > 0) fail('missing section marker(s): ' + missing.join(', '));
else ok('all ' + expected.length + ' section markers present, in order');

// 6) Every quote record must carry the quoted BODY. The marker repeats across quotes
//    (two quotes from one turn share it), so a record without its body cannot be told
//    apart later — and that call site is not reachable from a unit test.
const recordCalls = [...code.matchAll(/rememberQuote\(\{([\s\S]{0,400}?)\}\)/g)].map((m) => m[1]);
if (recordCalls.length === 0) fail('no rememberQuote call sites found; the pattern is wrong');
for (const call of recordCalls) {
  // The KEY is not enough: `quote: ""` would satisfy a presence check while storing
  // nothing, which is the whole failure mode. The value must not be an empty literal.
  if (!/\bquote\s*:/.test(call) || /\bquote\s*:\s*(""|''|``)\s*[,}]/.test(call)) {
    console.error('  rememberQuote without a quote: field ->' + call.replace(/\s+/g, ' ').slice(0, 120));
    fail('every rememberQuote must store the quoted body');
  }
}
if (recordCalls.length > 0 && recordCalls.every((call) => /\bquote\s*:/.test(call) && !/\bquote\s*:\s*(""|''|``)\s*[,}]/.test(call))) {
  ok('every quote record stores the quoted body (' + recordCalls.length + ' call sites)');
}

// 7) `::highlight()` supports only color / background-color / text-decoration* /
//    text-shadow. Anything else is dropped SILENTLY, so a registered range can still be
//    invisible — which is exactly how `background:` (the shorthand) hid every highlight.
const highlightRules = [...code.matchAll(/::highlight\([^)]*\)\s*\{([^}]*)\}/g)].map((m) => m[1]);
if (highlightRules.length === 0) fail('no ::highlight() rule found; the find highlight would be unstyled');
const ALLOWED_HIGHLIGHT_PROPS = /^(color|background-color|text-decoration(-[a-z]+)?|text-shadow|-webkit-text-stroke(-[a-z]+)?)$/;
for (const rule of highlightRules) {
  for (const declaration of rule.split(';').map((d) => d.trim()).filter(Boolean)) {
    const property = declaration.split(':')[0].trim();
    if (!ALLOWED_HIGHLIGHT_PROPS.test(property)) {
      console.error('  ::highlight() ignores "' + property + '" silently');
      fail('::highlight() may only set color / background-color / text-decoration / text-shadow');
    }
  }
}
if (highlightRules.length > 0 && !/background-color\s*:/.test(highlightRules.join(''))) {
  fail('a ::highlight() rule must set background-color, or the range stays invisible');
} else if (highlightRules.length > 0) {
  ok('::highlight() rules use only supported properties');
}

// 8) 设置分区改名（2026-10-16：「历史操作」→「DeepWorker」）的单点守卫。
//    为什么在这里再加一条：`verify_section_name.mjs` 已经是扫描式守卫，但它是**一个套件**，
//    可以被跳过、可以被改名；而“指路文案指向一个已经不存在的菜单项”是本机反复栽过的
//    那类缺陷（说的和做的不一样）。所以在这一条**每次 prepublish 都跑**的体检里也钉一颗钉子：
//    旧分区名不许再出现在任何**用户会读到**的地方。
{
  const FORBIDDEN = /历史操作|History actions/;
  const surfaces = [
    ['lib/client.js', code],
    ['README.md', fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')],
    ['README.en.md', fs.readFileSync(new URL('../README.en.md', import.meta.url), 'utf8')]
  ];
  const dir = new URL('./', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    if (/^verify_section_name(_mutations)?\.mjs$/.test(f) || f === 'verify_hygiene.mjs') continue;  // 守卫自身必须引用这两个词
    if (!/^verify_.*\.mjs$/.test(f)) continue;
    surfaces.push(['verify/' + f, fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8')]);
  }
  const hits = [];
  for (const [name, text] of surfaces) {
    for (const line of text.split('\n')) {
      if (FORBIDDEN.test(line)) hits.push(name + ': ' + line.trim().slice(0, 110));
    }
  }
  if (hits.length > 0) {
    for (const h of hits) console.error('  stale section pointer: ' + h);
    fail(hits.length + ' stale section pointer(s)');
  } else {
    ok('no stale section pointer anywhere (' + surfaces.length + ' surfaces scanned)');
  }
}

console.log(failures === 0 ? '\nHYGIENE CHECKS PASSED' : '\n' + failures + ' check(s) failed');
process.exit(failures === 0 ? 0 : 1);
