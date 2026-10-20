#!/usr/bin/env node
/**
 * verify_bundle_health.mjs — 「本地全绿、真机崩」的**静态**预检器（任务 8 第一部分交付物）。
 *
 * 两种身份：
 *   ① 无参运行（套件成员）：`node verify/verify_bundle_health.mjs` ⇒ 检查线上
 *      `lib/client.js`，与 17 个既有套件一样 PASS/FAIL。
 *   ② CLI / 库：
 *        node verify/verify_bundle_health.mjs <bundle.js> [--id <期望的注册 id>]
 *        node verify/verify_bundle_health.mjs --against <good.js> <candidate.js>
 *      `checkText/checkFile/diffText` 被 mutations 套件直接 import（不靠子进程）。
 *
 * 为什么要这个东西（真机事实，2026-10-12/13 五次）：
 *   DSH 把每个插件的客户端 bundle 用 `window.__ModuleLoader__.load({id, factory})` 注册，
 *   宿主把**多个** bundle 拼成一条 `plugins/??a/client.js,b/client.js,…&rev=…` 的 combo
 *   脚本（dsh-client-modules/README.md:75「grouped into combo route keys」）。一条 combo 里
 *   任何一个 bundle 解析失败或注册失败，用户看到的是
 *   `dsh-deepworker: import failed (see console for the import error)` —— 而
 *   `node --check` / `vm.Script` / 套件 17/17 **全都不会红**。
 *
 * 本脚本把「本地能查的」与「只有真机能查的」明确分开：
 *   本地能查 ⇒ 这里断言（字节层 / 词法层 / 结构层 / 加载层）。
 *   只有真机能查 ⇒ 报告里如实写「未查清」，绝不假装覆盖。
 *
 * 退出码：0 = 全绿；1 = 至少一条红。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const C = { red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', dim: '\u001b[2m', off: '\u001b[0m' };
let findings = [];
let notes = [];
function resetFindings() { findings = []; notes = []; }
function ok(msg) { findings.push({ level: 'ok', msg }); }
function bad(msg) { findings.push({ level: 'bad', msg }); }
function warn(msg) { findings.push({ level: 'warn', msg }); }

/* ────────────────────────────── 1. 字节层 ────────────────────────────── */

/** 出现在源码任何位置都算**硬错误**的不可见字符。 */
const HARD_DANGEROUS = [
  [0x2028, 'LINE SEPARATOR', '在 classic script（<script> 拼接体）里是行终止符 ⇒ 会切断字符串字面量/正则'],
  [0x2029, 'PARAGRAPH SEPARATOR', '同上'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE / BOM', '文件中间的 BOM 让「同一个字面量」在字节层不再等价'],
  [0x0085, 'NEXT LINE (NEL)', '部分词法器当行终止符'],
  [0x200b, 'ZERO WIDTH SPACE', '不可见字符：拼进文案就永远看不出来，且会让字面量比较悄悄不相等'],
  [0xfffc, 'OBJECT REPLACEMENT CHARACTER', '通常是编码事故的残留'],
  [0xfffd, 'REPLACEMENT CHARACTER', '通常是编码事故的残留'],
];
/** 只在**字面量**里出现才算问题（emoji 家族序列合法使用 ZWJ/ZWNJ）。 */
const SOFT_DANGEROUS = [
  [0x200c, 'ZERO WIDTH NON-JOINER', 'emoji 序列会合法使用；出现在文案里多半是手滑'],
  [0x200d, 'ZERO WIDTH JOINER', 'emoji 序列会合法使用；出现在文案里多半是手滑'],
  [0x00a0, 'NO-BREAK SPACE', '看起来像空格，比较时不相等'],
  [0x2060, 'WORD JOINER', '不可见字符'],
];

function scanCodepoints(file, text) {
  const hard = [], soft = [];
  for (const [cp, name, why] of HARD_DANGEROUS) {
    // U+FEFF 只在**非开头**位置才算硬错（开头的 BOM 上面已经单独报过）
    const ch = String.fromCodePoint(cp);
    let n = text.split(ch).length - 1;
    if (cp === 0xfeff && text.charCodeAt(0) === 0xfeff) n -= 1;
    if (n > 0) hard.push(`U+${cp.toString(16).toUpperCase()} ${name} × ${n}（${why}）`);
  }
  for (const [cp, name, why] of SOFT_DANGEROUS) {
    const ch = String.fromCodePoint(cp);
    const n = text.split(ch).length - 1;
    if (n > 0) soft.push(`U+${cp.toString(16).toUpperCase()} ${name} × ${n}（${why}）`);
  }
  return { hard, soft };
}

function byteLayer(file, buf) {
  if (buf.length === 0) { bad(`${file}: 文件为空`); return; }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bad(`${file}: 文件以 UTF-8 BOM 开头`);
  else ok(`${file}: 无 BOM`);

  let text;
  try { text = buf.toString('utf8'); } catch (e) { bad(`${file}: 不是合法 UTF-8 (${e.message})`); return; }
  // 反向验证：重编码必须字节相同（能抓住替换字符/截断的非法序列）
  if (!Buffer.from(text, 'utf8').equals(buf)) bad(`${file}: UTF-8 往返不字节相同（存在截断/替换字符）`);
  else ok(`${file}: UTF-8 往返字节相同`);

  const cr = (buf.toString('latin1').match(/\r/g) || []).length;
  const lf = (buf.toString('latin1').match(/\n/g) || []).length;
  if (cr > 0) bad(`${file}: 含 ${cr} 个 CR（CRLF 混入；本仓约定纯 LF）`); else ok(`${file}: 纯 LF（CR=0, LF=${lf}）`);

  if (buf[buf.length - 1] !== 0x0a) bad(`${file}: 结尾没有换行（combo 拼接时会把下一个 bundle 接在同一行 ⇒ 直接解析失败）`);
  else ok(`${file}: 结尾有换行`);

  if (/[\u2028\u2029]/.test(text)) bad(`${file}: 含 U+2028/U+2029 —— 拼接成 combo 后一定解析失败`);
  else ok(`${file}: 无 U+2028/U+2029`);

  const cp = scanCodepoints(file, text);
  if (cp.hard.length > 0) bad(`${file}: 含硬错误不可见字符 —— ${cp.hard.join(' | ')}`);
  else ok(`${file}: 无硬错误不可见字符`);
  if (cp.soft.length > 0) warn(`${file}: 可疑不可见字符 —— ${cp.soft.join(' | ')}`);
  else ok(`${file}: 无可疑不可见字符`);

  const nonBmp = new Set();
  for (const ch of text) if (ch.codePointAt(0) > 0xffff) nonBmp.add(ch);
  if (nonBmp.size > 0) notes.push(`${file}: 非 BMP 字符 ${[...nonBmp].map((c) => c + ' (U+' + c.codePointAt(0).toString(16).toUpperCase() + ')').join(', ')}`);
  if (text.includes('</script')) bad(`${file}: 含 </script —— 内联进 <script> 会提前闭合`);
  else ok(`${file}: 无 </script`);
  return text;
}

/* ────────────────────────────── 2. 结构层 ────────────────────────────── */

function structureLayer(file, text, expectId) {
  const m = /^window\.__ModuleLoader__\.load\(\{/.exec(text.slice(0, 200));
  if (!m) bad(`${file}: 开头不是 window.__ModuleLoader__.load({ ... })`);
  else ok(`${file}: 开头是 window.__ModuleLoader__.load({`);

  // 末尾是 `});\n`（bundle 的收口）
  if (!/\}\);\s*$/.test(text)) bad(`${file}: 末尾不是 "});"`); else ok(`${file}: 末尾是 "});"`);

  const loadCalls = text.split('__ModuleLoader__').length - 1;
  if (loadCalls !== 1) bad(`${file}: __ModuleLoader__ 出现 ${loadCalls} 次（期望恰好 1 次；重复注册会抛 duplicate factory registration）`);
  else ok(`${file}: __ModuleLoader__ 恰好 1 次`);

  // 括号平衡（先剥掉字符串/注释，见 tokenize），这里只做整体粗查
  const spans = tokenize(text);
  const codeOnly = stripSpans(text, spans, 'code');
  const bal = countBalance(codeOnly);
  if (bal.ok) ok(`${file}: 代码区括号/花括号/方括号平衡`);
  else bad(`${file}: 代码区括号不平衡 —— ${bal.detail}`);

  const idMatch = /id:\s*"([^"]+)"/.exec(text.slice(0, 400));
  if (!idMatch) bad(`${file}: 前 400 字节里找不到 id: "..."`);
  else {
    ok(`${file}: 注册 id = "${idMatch[1]}"`);
    if (expectId !== undefined && idMatch[1] !== expectId) bad(`${file}: 注册 id 应为 "${expectId}"，实际 "${idMatch[1]}"`);
  }
  if (!/factory:\s*(\(|function)/.test(text.slice(0, 600))) bad(`${file}: 找不到 factory: (require) => {`); else ok(`${file}: 有 factory：函数`);
}

/* ────────────────────────────── 3. 加载层 ────────────────────────────── */

function loadLayer(file, text, expectId) {
  const code = text;
  // 3a. 语法（classic script 语义）
  try { new vm.Script(code, { filename: file }); ok(`${file}: vm.Script 解析通过`); }
  catch (e) { bad(`${file}: vm.Script 解析失败 —— ${e.message}`); return null; }

  // 3b. 真的执行一次（拿一个假 window.__ModuleLoader__ 接住注册）
  let loaded = null;
  const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } } };
  const sandbox = { window: windowObj, TextEncoder, btoa, atob, URL, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {} };
  sandbox.globalThis = sandbox;
  try {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: file });
  } catch (e) { bad(`${file}: 顶层执行抛错 —— ${e.constructor.name}: ${e.message}`); return null; }
  if (loaded === null) { bad(`${file}: 执行后没有调用 __ModuleLoader__.load（脚本没跑到注册）`); return null; }
  ok(`${file}: 顶层执行成功并注册`);

  // 3c. factory 必须能被调用且不抛
  const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {}, createElement: () => null };
  const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
  const primMock = { Modal: function () {}, Button: function () {} };
  const need = (id) => id === 'react' ? reactMock : id === 'react/jsx-runtime' ? jsxMock : id === '@deepseek-ai/dsh-client-ui-primitives' ? primMock : (() => { throw new Error('unexpected require ' + id); })();
  let exportsObj = null;
  try { exportsObj = loaded.factory(need); }
  catch (e) { bad(`${file}: factory(require) 抛错 —— ${e.constructor.name}: ${e.message}`); return null; }
  ok(`${file}: factory(require) 成功`);

  const keys = Object.keys(exportsObj || {}).sort().join(',');
  if (typeof exportsObj.apply !== 'function') bad(`${file}: exports.apply 不是函数（真机报 "expect function or object with an apply method"）`);
  else ok(`${file}: exports.apply 是函数`);
  if (!Array.isArray(exportsObj.inject)) bad(`${file}: exports.inject 不是数组`);
  else ok(`${file}: exports.inject = [${exportsObj.inject.length} 项]（keys=${keys}）`);
  return exportsObj;
}

/* ────────────────────────────── 4. 词法层（+ 差异落点） ────────────────────────────── */

/**
 * 极简 JS 词法器：返回 [{kind:'code'|'string'|'comment'|'regex'|'template', start, end}]。
 * 目标不是完整 JS 语法，而是「一个字节改动到底落在字符串/注释里，还是落在代码里」——
 * 后者意味着这次编辑**改了结构**（当年两次真机崩溃都是这一类）。
 */
export function tokenize(src) {
  const spans = [];
  let i = 0;
  const n = src.length;
  let prevSig = '';                       // 上一个非空白、非注释字符 —— 判断 `/` 是正则还是除号
  let codeStart = 0;
  const pushCode = (end) => { if (end > codeStart) spans.push({ kind: 'code', start: codeStart, end }); };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      pushCode(i);
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      spans.push({ kind: 'comment', start: i, end: j });
      i = j; codeStart = i; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      pushCode(i);
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      spans.push({ kind: 'comment', start: i, end: j });
      i = j; codeStart = i; continue;
    }
    if (c === '"' || c === "'") {
      pushCode(i);
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === '\n') break;       // 未闭合字符串：停在行尾（下一轮会把它标成 code）
        j++;
      }
      spans.push({ kind: 'string', start: i, end: j });
      i = j; codeStart = i; prevSig = '"'; continue;
    }
    if (c === '`') {
      pushCode(i);
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') { j++; break; }
        j++;
      }
      spans.push({ kind: 'template', start: i, end: j });
      i = j; codeStart = i; prevSig = '`'; continue;
    }
    if (c === '/' && (prevSig === '' || '(,=:[!&|?{};+-*%^~<>'.includes(prevSig))) {
      pushCode(i);
      let j = i + 1, inClass = false, okRe = true;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { j++; break; }
        else if (d === '\n') { okRe = false; break; }
        j++;
      }
      if (okRe) { spans.push({ kind: 'regex', start: i, end: j }); i = j; codeStart = i; prevSig = '/'; continue; }
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  pushCode(n);
  return spans;
}

export function stripSpans(src, spans, keepKind) {
  let out = '';
  for (const s of spans) if (s.kind === keepKind) out += src.slice(s.start, s.end);
  return out;
}

function countBalance(code) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') stack.push({ c, i });
    else if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) return { ok: false, detail: `第 ${i} 个字符 ${c} 没有匹配的 ${pairs[c]}` };
    }
  }
  if (stack.length > 0) return { ok: false, detail: `未闭合的 ${JSON.stringify(stack.slice(-3).map((s) => s.c))}` };
  return { ok: true };
}

/* ────────────────────────────── 5. 差异落点（--against） ────────────────────────────── */

/**
 * 行级 diff，返回 [{tag:'equal'|'replace'|'delete'|'insert', a1,a2,b1,b2}]。
 * 先用公共前后缀把搜索空间砍掉，再在中间做 LCS（DP）——对本仓 6882 行的 bundle 足够快，
 * 且不依赖系统 `diff`（套件必须在任何机器上都能跑）。
 */
export function lineDiff(al, bl) {
  let pre = 0;
  const minL = Math.min(al.length, bl.length);
  while (pre < minL && al[pre] === bl[pre]) pre++;
  let suf = 0;
  while (suf < minL - pre && al[al.length - 1 - suf] === bl[bl.length - 1 - suf]) suf++;
  const A = al.slice(pre, al.length - suf), B = bl.slice(pre, bl.length - suf);
  const n = A.length, m = B.length;
  const ops = [];
  if (pre > 0) ops.push({ tag: 'equal', a1: 0, a2: pre, b1: 0, b2: pre });
  if (n > 4000 || m > 4000) {
    // 兜底：太大就整段当 replace（本仓不会走到：差异很小，前后缀已经砍干净）
    if (n > 0 || m > 0) ops.push({ tag: 'replace', a1: pre, a2: pre + n, b1: pre, b2: pre + m });
  } else {
    // LCS 长度表
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = A[i] === B[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
      }
    }
    let i = 0, j = 0;
    const raw = [];
    while (i < n && j < m) {
      if (A[i] === B[j]) { raw.push({ tag: 'equal', a: i, b: j }); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) { raw.push({ tag: 'delete', a: i, b: j }); i++; }
      else { raw.push({ tag: 'insert', a: i, b: j }); j++; }
    }
    while (i < n) { raw.push({ tag: 'delete', a: i, b: j }); i++; }
    while (j < m) { raw.push({ tag: 'insert', a: i, b: j }); j++; }
    // 把相邻的非 equal 合成一块 replace/delete/insert
    let k = 0;
    while (k < raw.length) {
      if (raw[k].tag === 'equal') {
        const s = k;
        while (k < raw.length && raw[k].tag === 'equal') k++;
        ops.push({ tag: 'equal', a1: pre + raw[s].a, a2: pre + raw[k - 1].a + 1, b1: pre + raw[s].b, b2: pre + raw[k - 1].b + 1 });
        continue;
      }
      const s = k;
      let aMin = Infinity, aMax = -1, bMin = Infinity, bMax = -1;
      while (k < raw.length && raw[k].tag !== 'equal') {
        if (raw[k].tag === 'delete') { aMin = Math.min(aMin, raw[k].a); aMax = Math.max(aMax, raw[k].a); }
        if (raw[k].tag === 'insert') { bMin = Math.min(bMin, raw[k].b); bMax = Math.max(bMax, raw[k].b); }
        k++;
      }
      const a1 = aMin === Infinity ? pre + raw[s].a : pre + aMin;
      const a2 = aMax === -1 ? a1 : pre + aMax + 1;
      const b1 = bMin === Infinity ? pre + raw[s].b : pre + bMin;
      const b2 = bMax === -1 ? b1 : pre + bMax + 1;
      const tag = (a2 > a1 && b2 > b1) ? 'replace' : (a2 > a1 ? 'delete' : 'insert');
      ops.push({ tag, a1, a2, b1, b2 });
    }
  }
  if (suf > 0) ops.push({ tag: 'equal', a1: al.length - suf, a2: al.length, b1: bl.length - suf, b2: bl.length });
  return ops;
}

function allowedSpan(kind) { return kind === 'string' || kind === 'template' || kind === 'comment'; }

function diffLayer(goodFile, goodBuf, candFile, candBuf) {
  const a = goodBuf.toString('utf8'), b = candBuf.toString('utf8');
  const aSpans = tokenize(a), bSpans = tokenize(b);
  // 行号 → 字符偏移（精确；不能拿 indexOf 猜，重复行会指错位置）
  const offsetOf = (lines, idx) => { let o = 0; for (let i = 0; i < idx && i < lines.length; i++) o += lines[i].length + 1; return o; };
  const find = (spans, pos) => spans.find((s) => pos >= s.start && pos < s.end);

  // 差异可能不止一块（BUILD + 若干文案）。逐行对齐，把「被拉长的一整段」拆成真正变化的行。
  const al = a.split('\n'), bl = b.split('\n');

  // ── 判据：**代码区（剥掉字符串/注释/正则后的内容序列）必须完全一致** ──
  //
  // 这是整个检查的核心不变式。为什么用「代码区序列」而不是「逐行差异的端点落在哪个 span」：
  // 一次会话里常有多处文案改动，而「公共前后缀」会把它们之间的一切都吞成一个巨大区间；
  // 那个区间的起点在字符串里、终点在代码里 ⇒ 逐行端点判定既会假红、也说不清哪里变了。
  // 反过来，把每个字符串/注释的内容**原位替换成占位符**再比对：
  //   · 行号、缩进、标点全部保留 ⇒ 指出的差异就是**真正改了结构**的那些位置；
  //   · 字符串里放什么（U+2028、零宽字符、emoji）都不影响判定 ⇒ 不假红。
  const mask = (s, spans) => {
    let out = '', last = 0;
    const sorted = spans.slice().sort((x, y) => x.start - y.start);
    for (const sp of sorted) {
      out += s.slice(last, sp.start);
      const body = s.slice(sp.start, sp.end);
      out += allowedSpan(sp.kind) ? '\u0000'.repeat(body.length) : body;
      last = sp.end;
    }
    return out + s.slice(last);
  };
  // ⚠️ 掩码会把字符串内容的**长度**一起抹掉 ⇒ 掩码本身逐字符比会假红。
  // 正确判据：先把掩码按行对齐，再问「这些不同，是不是全都只是 NUL 个数不同」。
  // 若某一行除了 NUL 个数之外还有别的字符不同（或行数不同）⇒ **真的改了结构**。
  const maskA = mask(a, aSpans), maskB = mask(b, bSpans);
  const codeOps = lineDiff(maskA.split('\n'), maskB.split('\n')).filter((o) => o.tag !== 'equal');
  const mal = maskA.split('\n'), mbl = maskB.split('\n');
  const realCodeOps = [];
  for (const o of codeOps) {
    if (o.tag !== 'replace' || (o.a2 - o.a1) !== (o.b2 - o.b1)) { realCodeOps.push(o); continue; }
    let onlyNulCounts = true;
    for (let k = 0; k < (o.a2 - o.a1); k++) {
      const x = mal[o.a1 + k].replace(/\u0000+/g, '\u0001');
      const y = mbl[o.b1 + k].replace(/\u0000+/g, '\u0001');
      if (x !== y) { onlyNulCounts = false; break; }
    }
    if (!onlyNulCounts) realCodeOps.push(o);
  }
  if (realCodeOps.length === 0) {
    ok(`${candFile}: **代码区**逐字符完全一致（剥掉字符串/注释/正则后；行数与代码行都没动）⇒ 这次编辑没有改结构`);
  } else {
    bad(`${candFile}: 代码区有 ${realCodeOps.length} 处不同 ⇒ 这次编辑改了**结构**（node --check 绿也可能真机崩）`);
    for (const o of realCodeOps.slice(0, 8)) {
      for (let i = o.a1; i < Math.min(o.a2, o.a1 + 3); i++) notes.push(`    代码差异 @A 第 ${i + 1} 行：${JSON.stringify(mal[i].replace(/\u0000/g, '·').slice(0, 200))}`);
      for (let i = o.b1; i < Math.min(o.b2, o.b1 + 3); i++) notes.push(`    代码差异 @B 第 ${i + 1} 行：${JSON.stringify(mbl[i].replace(/\u0000/g, '·').slice(0, 200))}`);
    }
  }

  // ── 逐块列出**词法层**的差异（文案改了哪几句，人看得见） ──
  const ops = lineDiff(al, bl);
  const narrow = (aStart, aEnd, bStart, bEnd) => {
    let p = 0;
    const mn = Math.min(aEnd - aStart, bEnd - bStart);
    while (p < mn && a[aStart + p] === b[bStart + p]) p++;
    let sfx = 0;
    while (sfx < mn - p && a[aEnd - 1 - sfx] === b[bEnd - 1 - sfx]) sfx++;
    return [{ start: aStart + p, end: aEnd - sfx }, { start: bStart + p, end: bEnd - sfx }];
  };
  let nChanged = 0;
  for (const op of ops) {
    if (op.tag === 'equal') continue;
    nChanged++;
    const aStartChar = offsetOf(al, op.a1), bStartChar = offsetOf(bl, op.b1);
    const aEndChar = offsetOf(al, op.a2), bEndChar = offsetOf(bl, op.b2);
    const [ra, rb] = narrow(aStartChar, aEndChar, bStartChar, bEndChar);
    const os = find(aSpans, ra.start), ns = find(bSpans, rb.start);
    const contained = (spans, r) => spans.some((sp) => r.start >= sp.start && r.end <= sp.end && allowedSpan(sp.kind));
    const pureText = ra.end > ra.start && rb.end > rb.start && contained(aSpans, ra) && contained(bSpans, rb);
    notes.push(`  词法改动 #${nChanged} @A 第 ${op.a1 + 1} 行 / B 第 ${op.b1 + 1} 行  [${os ? os.kind : '(code)'} → ${ns ? ns.kind : '(code)'}]  ${pureText ? '落在字面量/注释内' : '跨出字面量（见上面的代码差异）'}  -${ra.end - ra.start}/+${rb.end - rb.start} 字符`);
    if (pureText) {
      notes.push(`    旧值: ${JSON.stringify(a.slice(ra.start, ra.end).slice(0, 160))}`);
      notes.push(`    新值: ${JSON.stringify(b.slice(rb.start, rb.end).slice(0, 160))}`);
    }
  }

  // 字面量集合：新增/删除的字符串本身也要过一遍危险字符
  const litA = aSpans.filter((s) => s.kind === 'string' || s.kind === 'template').map((s) => a.slice(s.start, s.end));
  const litB = bSpans.filter((s) => s.kind === 'string' || s.kind === 'template').map((s) => b.slice(s.start, s.end));
  const setA = new Set(litA), setB = new Set(litB);
  const added = [...setB].filter((x) => !setA.has(x));
  const removed = [...setA].filter((x) => !setB.has(x));
  notes.push(`${candFile}: 字面量 旧=${litA.length} 新=${litB.length}（新增 ${added.length} / 消失 ${removed.length}）`);
  for (const s of added) {
    if (/[\u2028\u2029\u200b-\u200d\ufeff\u0085]/.test(s)) bad(`${candFile}: 新增字面量含危险不可见字符：${JSON.stringify(s)}`);
  }
  // 新增字面量里的反斜杠 / 反引号：只在**同一行内**出现才是问题（换行是 \n 转义，正常）
  for (const s of added) {
    const body = s.slice(1, -1);
    if (body.includes('\\') && !/\\[nrt"'\\/bfu0-9x]/.test(body)) warn(`${candFile}: 新增字面量含可疑反斜杠转义：${JSON.stringify(s)}`);
  }
  return { added, removed };
}

/* ────────────────────────────── 6. i18n 键集（本插件特有） ────────────────────────────── */

function i18nLayer(file, text) {
  const grab = (name) => {
    const at = text.indexOf(`var ${name} = {`);
    if (at === -1) return null;
    const end = text.indexOf('\n    };', at);
    const body = text.slice(at, end === -1 ? text.length : end);
    const keys = [];
    const re = /"([^"]+)"\s*:/g;
    let m;
    while ((m = re.exec(body)) !== null) keys.push(m[1]);
    return keys;
  };
  const zh = grab('zh'), en = grab('en');
  if (zh === null || en === null) { warn(`${file}: 找不到 zh / en 词典，跳过键集比对`); return; }
  const onlyZh = zh.filter((k) => !en.includes(k));
  const onlyEn = en.filter((k) => !zh.includes(k));
  if (onlyZh.length === 0 && onlyEn.length === 0) ok(`${file}: zh/en 键集一致（${zh.length} 键）`);
  else bad(`${file}: zh/en 键集不一致 —— 只在 zh: ${JSON.stringify(onlyZh)}；只在 en: ${JSON.stringify(onlyEn)}`);
}

/* ────────────────────────────── 对外接口 ────────────────────────────── */

function readFileOrDie(p) {
  if (!fs.existsSync(p)) { console.error(`${C.red}找不到文件: ${p}${C.off}`); process.exit(1); }
  return fs.readFileSync(p);
}

/**
 * 检查一份 bundle 的文本。**不打印、不退出**（打印与退出由 runCli 负责）。
 * @returns {{ok:boolean, findings:Array, notes:Array, cleanText:string, i18n:any}}
 */
export function checkText(text, opts = {}) {
  resetFindings();
  const file = opts.file || '(text)';
  const expectId = opts.expectId;
  const b = Buffer.from(text, 'utf8');
  const t = byteLayer(file, b);
  if (t !== undefined) {
    structureLayer(file, t, expectId);
    loadLayer(file, t, expectId);
    i18nLayer(file, t);
  }
  const nBad = findings.filter((f) => f.level === 'bad').length;
  return { ok: nBad === 0, findings: findings.slice(), notes: notes.slice(), cleanText: t };
}

/** 检查一个文件。 */
export function checkFile(file, opts = {}) {
  const buf = readFileOrDie(file);
  const r = checkText(buf.toString('utf8'), Object.assign({}, opts, { file }));
  r.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  r.bytes = buf.length;
  return r;
}

/** 比对两份文本：差异是否**只**落在字面量/注释里。 */
export function diffText(goodText, candText, opts = {}) {
  resetFindings();
  const goodFile = opts.goodFile || '(good)', candFile = opts.candFile || '(candidate)';
  diffLayer(goodFile, Buffer.from(goodText, 'utf8'), candFile, Buffer.from(candText, 'utf8'));
  const nBad = findings.filter((f) => f.level === 'bad').length;
  return { ok: nBad === 0, findings: findings.slice(), notes: notes.slice() };
}

/** 打印一组 findings，返回退出码。 */
function emit(r, title) {
  if (title !== undefined) console.log(title);
  for (const f of r.findings) {
    const mark = f.level === 'ok' ? `${C.green}✅${C.off}` : f.level === 'warn' ? `${C.yellow}⚠️ ${C.off}` : `${C.red}❌${C.off}`;
    console.log(`${mark} ${f.msg}`);
  }
  if (r.notes.length > 0) {
    console.log(`\n${C.dim}--- 备注（不是失败） ---${C.off}`);
    for (const nline of r.notes) console.log(`${C.dim}· ${nline}${C.off}`);
  }
  const nOk = r.findings.filter((f) => f.level === 'ok').length;
  const nWarn = r.findings.filter((f) => f.level === 'warn').length;
  const nBad = r.findings.filter((f) => f.level === 'bad').length;
  console.log(`\n${nBad === 0 ? C.green + 'GREEN' : C.red + 'RED'}${C.off}: ${nOk} ok / ${nWarn} warn / ${nBad} bad`);
  return nBad === 0 ? 0 : 1;
}

export function runCli(argv) {
  let exitCode = 0;
  if (argv[0] === '--against') {
    const goodFile = argv[1], candFile = argv[2];
    if (!goodFile || !candFile) { console.error('用法: --against <good.js> <candidate.js>'); return 2; }
    const aBuf = readFileOrDie(goodFile), bBuf = readFileOrDie(candFile);
    console.log(`${C.dim}=== 差异落点检查 ===${C.off}\n  good: ${goodFile}  sha256=${crypto.createHash('sha256').update(aBuf).digest('hex')}\n  cand: ${candFile}  sha256=${crypto.createHash('sha256').update(bBuf).digest('hex')}\n  good bytes=${aBuf.length}  cand bytes=${bBuf.length}`);
    const d = diffText(aBuf.toString('utf8'), bBuf.toString('utf8'), { goodFile, candFile });
    console.log('');
    exitCode = Math.max(exitCode, emit(d));
    console.log(`\n${C.dim}=== candidate 自身的健康检查 ===${C.off}`);
    const c = checkFile(candFile, { expectId: undefined });
    console.log(`${candFile}  ${c.bytes} bytes  sha256=${c.sha256}`);
    exitCode = Math.max(exitCode, emit(c));
    return exitCode;
  }
  const file = argv.find((a) => !a.startsWith('--'));
  const idIdx = argv.indexOf('--id');
  const expectId = idIdx === -1 ? undefined : argv[idIdx + 1];
  if (!file) {
    // 套件成员的默认行为：检查线上 bundle（17 个既有套件的调用方式完全一致）
    const live = new URL('../lib/client.js', import.meta.url);
    const c = checkFile(fileURLToPath(live), { expectId: 'dsh-deepworker' });
    console.log(`${fileURLToPath(live)}  ${c.bytes} bytes  sha256=${c.sha256}`);
    return emit(c);
  }
  const c = checkFile(file, { expectId });
  console.log(`${file}  ${c.bytes} bytes  sha256=${c.sha256}`);
  return emit(c);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(runCli(process.argv.slice(2)));
