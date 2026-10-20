// Scope guard: a factory-scope component must not call an apply-scope helper.
//
// This is the bug that crashed the Desktop app's boot:
//   ReferenceError: mutatedPathsOf is not defined        (slot entry crash)
//   ReferenceError: digestOpen is not defined            (boot: 1 entry did not activate)
// The component is defined BEFORE `apply()`, so everything declared inside apply is
// invisible to it; reaching one is a runtime ReferenceError, and DSH catches a slot
// entry failure by dropping the entry — the app then reports a boot failure.
//
// The legal bridges are props (`props.listSessions`, `props.userText`, …) and the
// apply-filled `testHooks` seam.
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

// ── masking ─────────────────────────────────────────────────────────────────────
// Comments, string literals and regex literals cannot call anything; drop them so prose,
// messages and patterns never produce a false positive.
//
// ⚠️ Regex literals were added on 2026-10-16 for a concrete reason: the terminal-button
// marker pattern is `/__DW_DONE_(-?\d+)__/g`, and a text scan read `__DW_DONE_(` as a call
// to a function nobody declares. The old code stripped comments and '…'/"…" only.
//
// ⚠️ Backtick-quoted text is deliberately NOT stripped: this file uses backticks inside
// regex literals, and stripping there once swallowed a neighbouring declaration, producing
// a false 'never declared'. A guard that cries wolf is as harmful as none.

/**
 * Blank out regex literals (body AND flags), character by character.
 *
 * This is a MASKER, not a parser: it only has to be right for THIS bundle. A `/` opens a
 * literal when the previous significant character cannot END an expression
 * (`=`, `(`, `,`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `;`, `+`, `-`, `*`, `%`, `~`, `^`,
 * `<`, `>`, newline or nothing). Character classes are honoured, so `[/]` does not close it
 * early; a backslash escapes the next character.
 */
function maskRegexLiterals(text) {
  const ENDS_EXPRESSION = /[\w$)\]}'"]/;
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '/') { out.push(ch); i++; continue; }
    let j = out.length - 1;
    while (j >= 0 && (out[j] === ' ' || out[j] === '\t')) j--;
    const prev = j >= 0 ? out[j] : '\n';
    if (ENDS_EXPRESSION.test(prev)) { out.push(ch); i++; continue; }
    let k = i + 1;
    let closed = -1;
    let inClass = false;
    while (k < text.length && text[k] !== '\n') {
      if (text[k] === '\\') { k += 2; continue; }
      if (text[k] === '[') inClass = true;
      else if (text[k] === ']') inClass = false;
      else if (text[k] === '/' && !inClass) { closed = k; break; }
      k++;
    }
    if (closed < 0) { out.push(ch); i++; continue; }
    let f = closed + 1;
    while (f < text.length && /[a-z]/i.test(text[f])) f++;
    out.push(' 0 ');
    i = f;
  }
  return out.join('');
}

const stripped = maskRegexLiterals(
  code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
);

const applyAt = stripped.indexOf('function apply(ctx) {');
const applyEnd = stripped.indexOf('exports.apply = apply;');
if (applyAt < 0 || applyEnd < 0 || applyEnd <= applyAt) fail('could not locate apply() in the bundle');
const factory = stripped.slice(0, applyAt);
const applyPart = stripped.slice(applyAt, applyEnd);

/** Names declared inside apply(): invisible to anything above it. */
const applyNames = new Set(
  [...applyPart.matchAll(/\n\s*(?:function|var|const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1])
);
/**
 * Names the factory part declares anywhere, which are treated as legally shadowing an
 * apply name.
 *
 * This is deliberately coarse. A precise lexical analysis would also model sibling
 * functions, and it was tried: indentation-based boundary detection produced false
 * positives on every `t(...)` inside a component (they take `t` from props), which is
 * worse than the false negative it fixed. Coarse still catches four of the five real
 * violations this plugin has had — `mutatedPathsOf`, `sessionTitleOf`, `saveDigestNote`,
 * `clip` — each of which was declared ONLY inside apply.
 *
 * KNOWN GAP: a name declared as a local alias inside a SIBLING factory function is
 * treated as bound. `activeSessionId` slipped through exactly that way. When adding a
 * factory-scope call, check that the name is declared in the same function.
 *
 * KNOWN GAP 2 (2026-10-16): this direction only catches "factory calls apply". The
 * opposite — an apply-scope helper defined in the MIDDLE of apply calling a helper that is
 * nested inside a LATER apply-scope function — is invisible here. That exact shape shipped
 * once (the terminal settings editor called `grey`, which lives inside
 * `HistoryActionsSettings`) and it was caught by verify_render's SSR pass instead:
 * `ReferenceError: grey is not defined`. Keep the SSR suite; it covers this direction.
 */
const factoryOwn = new Set(
  [...factory.matchAll(/\n\s*(?:function|var|const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1])
);

const violations = [];
for (const name of applyNames) {
  if (factoryOwn.has(name)) continue; // declared somewhere in the factory part
  const re = new RegExp('(?<![\\w.$])' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
  for (const match of factory.matchAll(re)) {
    violations.push({ name, line: factory.slice(0, match.index).split('\n').length });
  }
}

console.log('apply-scope names ->', applyNames.size, '| factory-scope calls into them ->', violations.length);
if (violations.length > 0) {
  for (const v of violations.slice(0, 20)) console.error('  line ' + v.line + ': ' + v.name + '(...)');
  fail('a factory-scope component calls apply-scope helpers; route them through props or testHooks');
}

// Duplicate function declarations silently shadow — the LAST one wins, and the
// earlier one becomes dead code that still satisfies text-grep assertions. Two of the
// reported bugs were exactly this: an old DigestAction (save directly, no dialog) and
// an old saveDigestNote (de-duplicating merge path) shadowing their own fixes.
// Names may legitimately repeat when each lives in its own closure.
const ALLOWED_DUPLICATES = new Set(['onKey']); // one per document-listener closure
const declarations = new Map();
for (const match of stripped.matchAll(/^\s*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) {
  const line = stripped.slice(0, match.index).split('\n').length;
  if (!declarations.has(match[1])) declarations.set(match[1], []);
  declarations.get(match[1]).push(line);
}
const shadowed = [...declarations.entries()].filter(([name, lines]) => lines.length > 1 && !ALLOWED_DUPLICATES.has(name));
console.log('duplicate declarations ->', shadowed.length === 0 ? 'none' : JSON.stringify(shadowed));
if (shadowed.length > 0) {
  for (const [name, lines] of shadowed) console.error('  ' + name + ' declared at lines ' + lines.join(', '));
  fail('a later declaration shadows an earlier one; the earlier copy is dead code');
}

// A call to a name nobody defines is a ReferenceError at *click* time, so neither
// `node --check` nor an SSR render catches it. (A range replacement once deleted a
// definition while its caller stayed behind.) Every bare call must resolve to a
// declaration, a parameter, or a known global.
const GLOBALS = new Set([
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'Promise', 'Math', 'Date', 'JSON', 'Object', 'String', 'Number', 'Array', 'Boolean',
  'Error', 'TypeError', 'RegExp', 'Set', 'Map', 'WeakMap', 'Symbol', 'BigInt', 'Function',
  'console', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'btoa', 'atob', 'TextEncoder', 'TextDecoder', 'structuredClone', 'fetch', 'URL',
  'requestAnimationFrame', 'cancelAnimationFrame', 'require',
  // 2026-10-16 终端按钮用到：取消/超时用的 AbortController、终端 id 用的 crypto。
  'AbortController', 'AbortSignal', 'crypto',
  'Highlight', 'CSS', 'Node', 'NodeFilter', 'Range', 'Element', 'Text', 'getComputedStyle',
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'Proxy', 'Reflect', 'Intl', 'globalThis', 'WeakSet', 'if', 'for', 'while', 'switch',
  'catch', 'return', 'typeof', 'new', 'function', 'await', 'delete', 'void', 'in', 'of',
  'super', 'this', 'class', 'try', 'else', 'do', 'case', 'throw', 'yield'
]);
const bound = new Set();
for (const m of stripped.matchAll(/\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) bound.add(m[1]);
for (const m of stripped.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) bound.add(m[1]);
for (const m of stripped.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/[=:]/)[0].trim();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) bound.add(name);
  }
}
const unresolved = [];
for (const m of stripped.matchAll(/(?<![\w.$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
  const name = m[1];
  // 名字以 `$` 结尾再"调用"：真 JS 里合法但极罕见（标识符允许 `$`），而在本仓里它一定是
  // **字符串/模板里的 shell 代码**，例如结束标记 `__DW_DONE_$?__` 被前面某个 `(...)` 接上。
  // 按形状排除，绝不往 GLOBALS 里塞一个不存在的函数名 —— 那是把这条守卫废掉。
  if (/\$$/.test(name)) continue;
  if (bound.has(name) || GLOBALS.has(name)) continue;
  unresolved.push({ name, line: stripped.slice(0, m.index).split('\n').length });
}
const uniqueUnresolved = [...new Map(unresolved.map((u) => [u.name, u])).values()];
console.log('unresolved calls ->', uniqueUnresolved.length === 0 ? 'none' : JSON.stringify(uniqueUnresolved));
if (uniqueUnresolved.length > 0) {
  for (const u of uniqueUnresolved.slice(0, 20)) console.error('  line ' + u.line + ': ' + u.name + '(...) is never declared');
  fail('a call targets a name that is never declared in this bundle');
}

// The seam itself must be filled, or the guarded call sites silently do nothing.
for (const name of ['mutatedPathsOf', 'sessionTitleOf', 'conversationDigest', 'saveDigestNote']) {
  if (!applyPart.includes('testHooks.' + name + ' = ' + name)) {
    fail('testHooks.' + name + ' is never filled by apply(), so factory-scope callers get nothing');
  }
}
console.log('scope guard OK (no shadowing; seam filled)');
