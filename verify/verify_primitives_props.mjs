#!/usr/bin/env node
/**
 * verify_primitives_props.mjs — **类级别**守卫：插件传给官方原语的**具名 prop 值**、
 * 以及插件引用的**每一个 `--dsw-*` 设计变量**，都必须在 app.asar 里有定义。
 *
 * ── 为什么要有它（2026-10-16 的真实缺陷）─────────────────────────────────────────────
 * `dsh-deepworker/lib/client.js` 有 **3 处** 写 `variant: "secondary"`。而
 * `@deepseek-ai/dsh-client-ui-primitives` 的 `Button` **只支持四档**，实现是
 *
 *     className: clsx(css$3.button, css$3[variant], css$3[size], className)
 *     （app.asar: /dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js:3220）
 *
 * ⇒ 传一个不存在的档位时 `css$3[variant]` 是 `undefined`，被 clsx **静默丢掉**：那颗按钮
 * 只剩裸 `.button`（透明、无描边、无 hover/active 反馈），观感像"一段点得动的文字"。
 * 这不是"少写了个样式"，而是**非法值被静默吞掉**这一整类缺陷 —— 所以这里守的是**类**：
 * 任何传进官方原语的具名 prop 字面量，以及任何引用的设计变量，越界即红。
 *
 * ── 设计的四条硬要求（逐条对应，不许放宽）────────────────────────────────────────────
 *   ① **合法集合从 app.asar 动态解析**，绝不硬编码四个名字。
 *      硬编码的断言会在 DSH 升级**增加**档位时变成**假红**，在档位**改名**后变成**假绿**。
 *      所以这里解析 `Button.module.css` 的类名集合再减去 Button 自己用的结构类
 *      （`.button` / `.icon`），并且**额外反向核对**编译后的产品 CSS：每个解析出来的
 *      名字都必须在 web-frontend 的产物 CSS 里真实存在（`._<name>_<hash>_<line>`）——
 *      这样"解析器漏了/多算了"不会悄悄发生。
 *   ② **扫不到任何 variant 必须判红**。"扫不到" ≠ "都合法"（本机反复踩的"空操作/假绿"）。
 *   ③ **定位按括号配平的程序化定位**，不做整行文本 grep：先找到 `primitives.Button` 调用点，
 *      再配平它后面那一个对象的 `{}`，然后只在这一层取键。这样"某个调用点被挪走/重排"
 *      不会让断言落到别的组件上，也不会因为缩进变化静默失配。
 *   ④ **`icon` 只判"存在且非裸 null/undefined 字面量"，不判类型**：
 *      真实现只在 `icon != null` 时渲染外壳（`index.js:3221`），所以 `icon: null` 与省略等价、
 *      是**合法**的；`icon: "abc"` 读起来可疑，但 `React` 允许把字符串当子节点渲染 ——
 *      断言成红会变成假红。这里只把**没有绑定值/类型装错**一类（裸 `null`、裸 `undefined`）
 *      判为"省略即可"，并核对该调用点是否真的省略。
 *
 * 用法：
 *   node verify/verify_primitives_props.mjs                      # 检查线上 lib/client.js
 *   HA_CLIENT_JS=/tmp/x.mjs node verify/verify_primitives_props.mjs   # 变异体
 * 退出码：0 = 全绿；1 = 至少一条红。（与 17 个既有套件同构：PASS/FAIL。）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const LIVE = path.join(PKG, 'lib', 'client.js');
const TARGET = process.env.HA_CLIENT_JS || LIVE;
const ASAR = process.env.HA_ASAR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);

/* ────────────────────────────── app.asar 只读读取器 ────────────────────────────── */
//
// 只读、不改。`new URL(...).pathname` 在本仓库（路径含中文）不解码，所以一律 `fileURLToPath`
// 或直接拼绝对路径。读不到就返回 null —— 绝不猜、绝不回退到硬编码，见第 1 节。

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const jsonSize = head.readUInt32LE(12);
  const jsonBuf = Buffer.alloc(jsonSize);
  fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
  return { fd, header: JSON.parse(jsonBuf.toString('utf8')), base: 8 + headerSize, size: headerSize };
}
function asarReadAll(asar) {
  const out = [];
  (function walk(node, prefix) {
    for (const [name, val] of Object.entries(node.files || {})) {
      const p = prefix + '/' + name;
      if (val.files) walk(val, p);
      else if (val.offset !== undefined) out.push({ path: p, offset: parseInt(val.offset, 10), size: val.size });
    }
  })(asar.header, '');
  return out;
}
function asarFileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}
function asarRead(asar, entry) {
  const buf = Buffer.alloc(entry.size);
  fs.readSync(asar.fd, buf, 0, entry.size, asar.base + entry.offset);
  return buf;
}
const bySuffix = (entries, suffix) => {
  const hit = entries.filter((e) => e.path.endsWith(suffix));
  return hit.length === 1 ? hit[0] : null;
};

if (!fs.existsSync(ASAR)) {
  console.error(`FAIL: app.asar not found at ${ASAR} — this suite cannot verify anything without the real theme/primitives`);
  process.exit(1);
}
const asar = openAsar(ASAR);
const ASAR_FILES = asarReadAll(asar);

/* ────────────── 1. 从**编译产物**动态解析 Button 的档位 / 尺寸 ────────────── */
//
// DSH 0.2.1-rc.1 起，`@deepseek-ai/dsh-client-ui-primitives` 不再以独立包/文件形式放在
// app.asar 里：它的 CSS-module 映射与组件签名被编译进 `dsh-web-frontend/dist/assets/index-*.js`，
// 类名被编译进同目录的 `*.css`（形如 `_primary_1rv3m_36`）。
//
// ⇒ 合法集合的来源必须跟着走：从**编译后的 JS** 里解析
//     `{button:qI,md:KI,sm:GI,primary:YI,ghost:XI,outline:QI,toolbar:ez,icon:tz}`
//   从**编译后的 CSS** 里取每个类的规则体（尺寸契约仍然核对 height）。
// 任何一份读不到都直接红 —— **绝不**回退到硬编码列表（那会在 DSH 改档位时变成假绿）。

const FE_JS_ENTRIES = ASAR_FILES.filter((e) => /dsh-web-frontend\/dist\/assets\/index-[^/]+\.js$/.test(e.path));
const FE_CSS_ENTRIES = ASAR_FILES.filter((e) => /dsh-web-frontend\/dist\/assets\/.+\.css$/.test(e.path));
if (FE_JS_ENTRIES.length === 0) {
  console.error('FAIL: the compiled web-frontend JS is missing from app.asar — the Button CSS-module map cannot be derived (refusing to fall back to a hard-coded list)');
  process.exit(1);
}
if (FE_CSS_ENTRIES.length === 0) {
  console.error('FAIL: the compiled web-frontend CSS is missing from app.asar — the Button class set cannot be verified');
  process.exit(1);
}
const FE_JS = FE_JS_ENTRIES.map((e) => asarRead(asar, e).toString('utf8')).join('\n');
const FE_CSS = FE_CSS_ENTRIES.map((e) => asarRead(asar, e).toString('utf8')).join('\n');

/** minified 变量 → 编译后的类名（`qI="_button_1rv3m_2"`）。 */
const CLASS_LITERALS = new Map();
for (const m of FE_JS.matchAll(/([A-Za-z_$][\w$]*)="(_[A-Za-z0-9]+_[A-Za-z0-9]+_\d+)"/g)) {
  CLASS_LITERALS.set(m[1], m[2]);
}

/** 找到 Button 的 CSS-module 映射对象：键是 prop 名，值是类名（minified 变量或字面量）。
 *  判据不是"键叫 primary"这种硬编码，而是：
 *    · 必须含 `button` 键，且它解析出来的类以 `_button_` 开头；
 *    · 至少 4 个键；
 *    · 所有类属于**同一个 CSS-module hash**（同一源文件编译出来的类共享 hash）。 */
function findButtonCssMap(text) {
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)=\{([^{}]{0,1200})\}/g)) {
    const name = m[1];
    const body = m[2];
    if (!/(^|,)button:/.test(body)) continue;
    const pairs = [];
    for (const p of body.matchAll(/([A-Za-z_$][\w$]*):(?:"(_[A-Za-z0-9]+_[A-Za-z0-9]+_\d+)"|([A-Za-z_$][\w$]*))/g)) {
      const cls = p[2] || CLASS_LITERALS.get(p[3]);
      if (cls !== undefined) pairs.push([p[1], cls]);
    }
    if (pairs.length < 4) continue;
    const hashes = new Set(pairs.map(([, cls]) => (cls.match(/_([A-Za-z0-9]+)_\d+$/) || [])[1]).filter(Boolean));
    if (hashes.size !== 1) continue;
    const button = pairs.find(([key]) => key === 'button');
    if (button === undefined || !button[1].startsWith('_button_')) continue;
    return { name, pairs, hash: Array.from(hashes)[0] };
  }
  return null;
}

const BUTTON_MAP = findButtonCssMap(FE_JS);
if (BUTTON_MAP === null) {
  console.error('FAIL: could not locate the Button CSS-module map in the compiled web-frontend JS — the primitive may have been rewritten; re-read it before trusting this suite');
  process.exit(1);
}

/** 找到 Button 签名：`forwardRef(function({variant:…,size:…,icon:…,className:…}`，
 *  并且 className 表达式确实用 `映射变量.button` / `[variant]` / `[size]` / `.icon`。
 *  这样"具名 prop 清单"是**读出来的**，不是记住的。 */
function findButtonSignature(text, mapName) {
  for (const m of text.matchAll(/forwardRef\(function\(\{([^}]*)\}/g)) {
    const named = m[1].split(',').map((s) => s.trim().split(/[:=\s]/)[0]).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    if (!(named.includes('variant') && named.includes('size') && named.includes('icon') && named.includes('className'))) continue;
    const after = text.slice(m.index, m.index + 900);
    if (!after.includes(mapName + '.button') || !after.includes(mapName + '.icon')) continue;
    const variantVar = (m[1].match(/variant:([A-Za-z_$][\w$]*)/) || [])[1];
    const sizeVar = (m[1].match(/size:([A-Za-z_$][\w$]*)/) || [])[1];
    if (!variantVar || !sizeVar) continue;
    if (!after.includes('[' + variantVar + ']') || !after.includes('[' + sizeVar + ']')) continue;
    return { named, raw: m[1].trim(), variantVar, sizeVar };
  }
  return null;
}

const BUTTON_SIG = findButtonSignature(FE_JS, BUTTON_MAP.name);
if (BUTTON_SIG === null) {
  fail('could not locate the Button signature (forwardRef(function({variant,size,icon,className}…))) in the compiled web-frontend JS — re-read the primitive before trusting this suite');
} else {
  ok(`Button signature read from the compiled web-frontend JS: { ${BUTTON_SIG.raw} } ⇒ named props audit targets = [${BUTTON_SIG.named.join(', ')}]`);
}

/** 编译后的 CSS 里，某个类（含 `:hover` 等状态规则）的全部规则体。 */
function cssRulesForClass(css, cls) {
  const out = [];
  const re = new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\s*(?=[:{,])[^{}]*\\{([^}]*)\\}', 'g');
  for (const m of css.matchAll(re)) out.push(m[1]);
  return out.join(' ');
}

const CSS_CLASSES = BUTTON_MAP.pairs.map(([key]) => key).sort();
const CSS_BLOCKS = new Map();
for (const key of CSS_CLASSES) {
  const cls = BUTTON_MAP.pairs.find(([k]) => k === key)[1];
  const body = cssRulesForClass(FE_CSS, cls);
  if (body === '') fail(`class "${key}" (${cls}) mapped by the Button CSS module has no rule in the compiled web-frontend CSS — the parse is not describing the running build`);
  CSS_BLOCKS.set(key, body);
}
const CSS_ALL_CLASSES = CSS_CLASSES.slice();
const CSS_ALL_BODIES = CSS_BLOCKS;
const CSS_BASE_NAMES = new Set(CSS_CLASSES);

/** Button 自己用掉的结构类：`css$3.button`（基线）与 `css$3.icon`（icon 外壳）。
 *  它们**不是**档位 —— 这份清单来自编译后签名里的 `className:clsx(…button…, …[variant], …[size]…)`
 *  与 `o1.icon`，由"档位集合非空"的下方断言兜底，不是凭记忆写的。 */
const STRUCTURAL_CLASSES = ['button', 'icon'];

/** 尺寸维度：`size="md"` 是 36px 档、`size="sm"` 是 28px 档。
 *  这里写的 `md`/`sm` 是**契约名字**，不是硬编码判据：下面的契约自检会先核实它们
 *  确实在 CSS-module 映射里，而且确实各自带 `height:` 规则 —— 一旦 DSH 把尺寸改名，
 *  契约自检会在集合计算**之前**报红，新名字不会被静默当档位。 */
const SIZE_CONTRACT = { md: 36, sm: 28 };
const LEGAL_SIZES = Object.keys(SIZE_CONTRACT).sort();

for (const [size, px] of Object.entries(SIZE_CONTRACT)) {
  if (!CSS_BLOCKS.has(size)) fail(`size "${size}" is not a key in the Button CSS module (keys=[${CSS_CLASSES.join(', ')}]) — the size contract in this suite no longer matches the primitive`);
  else if (!new RegExp('height:\\s*' + px + 'px').test(CSS_BLOCKS.get(size))) fail(`.${size} in the compiled Button CSS does not declare height: ${px}px — the size contract changed; re-read the primitive before trusting this suite`);
}

/** 变体块只声明颜色/描边/背景（`primary` / `ghost` / `outline` / `toolbar` 里没有 height）。 */
const looksLikeVariantBlock = (cls) => /(background|color|border)\s*:/.test(CSS_BLOCKS.get(cls) || '');

const LEGAL_VARIANTS = CSS_CLASSES.filter((c) => !STRUCTURAL_CLASSES.includes(c) && !LEGAL_SIZES.includes(c)).sort();

if (LEGAL_VARIANTS.length === 0) {
  fail(`no variant class parsed out of the compiled Button CSS module (classes=[${CSS_CLASSES.join(', ')}]) — the parser is broken, refusing to call an empty set "all legal"`);
}
if (LEGAL_VARIANTS.some((v) => LEGAL_SIZES.includes(v))) {
  fail(`the variant set overlaps the size set ([${LEGAL_VARIANTS.join(', ')}] vs [${LEGAL_SIZES.join(', ')}]) — the two dimensions were not separated correctly`);
}

/** 反向：CSS 里若出现一个带 height 的类，而它既不在尺寸契约里、也不像变体块，说明
 *  原语可能新增了一个维度 ⇒ 报红要求人工重读，而不是把它算进档位集合里。 */
for (const cls of CSS_ALL_CLASSES) {
  const body = CSS_BLOCKS.get(cls) || '';
  if (!/height:\s*\d+px/.test(body)) continue;
  if (cls in SIZE_CONTRACT || STRUCTURAL_CLASSES.includes(cls) || looksLikeVariantBlock(cls)) continue;
  fail(`.${cls} in the compiled Button CSS declares a height but is neither in the size contract {${Object.keys(SIZE_CONTRACT).join(', ')}} nor a colour-only variant block — a new dimension may have appeared; re-read the primitive before trusting this suite`);
}

/* 反向核对：映射里每个类名都必须在**编译产物** CSS 里真实存在（`._<name>_<hash>_<n>`）。
 * 这一条抓的是"映射解析错了"与"我读的 JS/CSS 不是同一份构建"。 */
{
  const missing = [];
  for (const [key] of BUTTON_MAP.pairs) {
    const cls = BUTTON_MAP.pairs.find(([k]) => k === key)[1];
    if (!new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\b').test(FE_CSS)) missing.push(`${key} => ${cls}`);
  }
  if (missing.length > 0) fail(`class(es) mapped by the Button CSS module do not exist in the compiled product CSS: ${missing.join(', ')} — the parse is not describing the running build`);
  else ok(`Button CSS module parsed from the compiled web-frontend JS (hash ${BUTTON_MAP.hash}): legal variants = [${LEGAL_VARIANTS.join(', ')}]; sizes = [${LEGAL_SIZES.join(', ')}]`);
}


/* ────────────────────────────── 2. 挑出传给 Button 的 props ────────────────────────────── */

const src = fs.readFileSync(TARGET, 'utf8');
const SRC_LINES = src.split('\n');
const lineOf = (offset) => src.slice(0, offset).split('\n').length;
const label = (offset) => `${path.relative(PKG, TARGET)}:${lineOf(offset)}`;

/* 先**掩掉注释**再找调用点：这个 bundle 里有一处 `primitives.Button` 出现在
 * JSDoc 里（`client.js:7182` 附近的注释块），不掩掉就会把它当成一个"定位不到 props
 * 对象"的调用点 ⇒ 假红。掩码**保持字节长度**（注释字节 → 空格），所以下标与原文一一对应，
 * `lineOf` 仍然准。掩码函数会自检"掩前掩后字节长度相同"，并断言至少掩掉一处注释。 */
function maskComments(text) {
  const out = text.split('');
  const spans = [];
  let i = 0, masked = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    masked += to - from;
    spans.push([from, to]);
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === quote) { i++; break; }
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); const to = e < 0 ? text.length : e + 2; blank(i, to); i = to; continue; }
    if (c === '/' && text[i + 1] === '/') { let j = i; while (j < text.length && text[j] !== '\n') j++; blank(i, j); i = j; continue; }
    i++;
  }
  const maskedText = out.join('');
  if (maskedText.length !== text.length) throw new Error(`comment masking changed the byte length (${text.length} -> ${maskedText.length}); offsets would no longer line up`);
  return { text: maskedText, masked, spans };
}
const MASK = maskComments(src);
if (MASK.masked === 0) {
  fail(`no comment was masked in ${path.relative(PKG, TARGET)} — the comment masker is broken, and an unmasked comment can be mistaken for a call site`);
}
const srcCode = MASK.text;

/** 掩掉的注释区间（升序、不重叠）—— 之后的配平/取键扫描用二分查找跳过它们。
 *  用区间而不是"占位符正则"是有意的：占位符是**有界的**（本文件实测最长块注释 1203 字节），
 *  任何固定长度的探测窗口都会在长注释上判错，而判错的后果是"把注释里的东西当代码"。 */
const COMMENT_SPANS = MASK.spans;
const spanAt = (i) => {
  let lo = 0, hi = COMMENT_SPANS.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (COMMENT_SPANS[mid][0] <= i) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && i < COMMENT_SPANS[best][1] ? COMMENT_SPANS[best] : null;
};


/** 括号/方括号配平扫描：从 `open`（必须是 `{` 或 `[`）开始，跳过字符串与注释，
 *  返回配对闭合符的下标。找不到返回 -1。 */
function matchBracket(text, open) {
  const OPEN = text[open];
  if (OPEN !== '{' && OPEN !== '[') return -1;
  const CLOSE = OPEN === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    const span = spanAt(i); if (span !== null) { i = span[1] - 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === quote) break;
      }
      continue;
    }
    if (c === OPEN) depth++;
    else if (c === CLOSE) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 取出 `primitives.Button` 之后那一个 props 对象的范围（`{}` 的内侧）。
 *  `jsx(primitives.Button, {…})` / `jsxs(primitives.Button, {…}, key)` 都覆盖。 */
function propsObjectAt(text, callAt) {
  let i = callAt + 'primitives.Button'.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === ',') i++;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{') return null;
  const close = matchBracket(text, i);
  return close < 0 ? null : { start: i, end: close };
}

/** 只取**顶层**的 `key: value`（跳过嵌套对象/数组/括号/字符串/注释）。
 *  这是本套件的关键点：`style: { resize: "vertical" }` 里的 `resize` 是**第二层**，
 *  绝不能被当成 Button 的 prop（既有 3 处 `size` 误读的坑就在这里）。 */
function topLevelProps(text, open, close) {
  const out = [];
  let i = open + 1;
  while (i < close) {
    while (i < close && /[\s,]/.test(text[i])) i++;
    if (i >= close) break;
    const span1 = spanAt(i); if (span1 !== null) { i = Math.min(span1[1], close); continue; }
    if (text[i] === '/' && text[i + 1] === '/') { while (i < close && text[i] !== '\n') i++; continue; }
    if (text[i] === '.' && text[i + 1] === '.' && text[i + 2] === '.') break;   // 顶层展开：不再逐个声明
    if (text[i] === '[') break;                                                  // 计算键：放弃解析，后面按"没有 variant"判定（红）
    let key = null, keyStart = i;
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let j = i + 1, buf = '';
      for (; j < close; j++) { if (text[j] === '\\') { buf += text[j + 1]; j++; continue; } if (text[j] === quote) break; buf += text[j]; }
      key = buf; i = j + 1;
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 64));
      if (!m) { i++; continue; }
      key = m[0]; i += m[0].length;
    }
    while (i < close && /\s/.test(text[i])) i++;
    if (text[i] !== ':') { i++; continue; }        // 简写 `{children}` —— 没有值，跳过
    i++;
    while (i < close && /\s/.test(text[i])) i++;
    const valueStart = i;
    // 找值的结尾：顶层逗号（在嵌套深度 0 处）
    let depth = 0;
    while (i < close) {
      const c = text[i];
      const span2 = spanAt(i); if (span2 !== null) { i = Math.min(span2[1], close); continue; }
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        for (i++; i < close; i++) { if (text[i] === '\\') { i++; continue; } if (text[i] === quote) break; }
        i++; continue;
      }
      if (c === '/' && text[i + 1] === '/') { while (i < close && text[i] !== '\n') i++; continue; }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
      else if (c === ',' && depth === 0) break;
      i++;
    }
    // 值要**去掉尾部的逗号与空白**：当这个 prop 是对象里最后一个时，扫描会在 `}` 处
    // 退出循环（`}` 不属于值），切片因此会带上缩进甚至**下一个 prop 的字面量**。
    // 实测：重排成 `size: "sm",\n variant: "outline"\n }` 后，variant 的原始切片是
    // `"outline"\n            disabled: busy` ⇒ 字面量正则失配 ⇒ **假红**。
    const rawValue = text.slice(valueStart, i);
    const value = rawValue.replace(/[\s,]+$/, '');
    out.push({ key, value, valueStart, keyStart });
    if (text[i] === ',') i++;
  }
  return out;
}

const CALL_RE = /primitives\.Button/g;
const calls = [];
{
  let m;
  while ((m = CALL_RE.exec(srcCode)) !== null) {
    const at = m.index;
    const obj = propsObjectAt(srcCode, at);
    if (obj === null) {
      fail(`${label(at)}: primitives.Button is used but its props object could not be located — refusing to skip this call site (an unparsed call site is exactly how a guard goes silently green)`);
      continue;
    }
    calls.push({ at, start: obj.start, end: obj.end, props: topLevelProps(srcCode, obj.start, obj.end) });
  }
}

/* 类别断言①：调用点数量。**扫不到 = 红**（"扫不到"不等于"都合法"）。 */
if (calls.length === 0) {
  fail(`no primitives.Button call site matched in ${path.relative(PKG, TARGET)} — the locator found nothing, which is NOT the same as "all values are legal" (this is the empty-scan false-green this repository has hit before)`);
} else {
  ok(`located ${calls.length} primitives.Button call site(s) in ${path.relative(PKG, TARGET)} (bracket-balanced, per-call-site)`);
}

/* 类别断言② + ③：variant / size 字面量必须落在动态解析出来的集合里。 */
const variantHits = [];
const sizeHits = [];
for (const call of calls) {
  for (const prop of call.props) {
    if (prop.key !== 'variant' && prop.key !== 'size') continue;
    const lit = /^"([^"]*)"$/.exec(prop.value.trim());
    const where = label(prop.valueStart);
    if (lit === null) {
      fail(`${where}: Button ${prop.key} is not a string literal (${prop.value.trim().slice(0, 60)}) — this guard only admits literal values; a computed value must be enumerated here explicitly rather than skipped silently`);
      continue;
    }
    const value = lit[1];
    if (prop.key === 'variant') variantHits.push({ value, where });
    else sizeHits.push({ value, where });
  }
}

if (variantHits.length === 0) {
  fail(`scanned ${calls.length} Button call site(s) but found ZERO variant literals — the scan is a no-op; refusing to report green (empty scan ≠ all legal)`);
} else {
  const bad = variantHits.filter((h) => !LEGAL_VARIANTS.includes(h.value));
  if (bad.length > 0) {
    for (const h of bad) fail(`${h.where}: illegal Button variant "${h.value}" — legal values parsed from app.asar are [${LEGAL_VARIANTS.join(', ')}]; an unknown variant makes css$3[variant] undefined, clsx drops it, and the button renders with no fill, no stroke and no hover feedback`);
  } else {
    ok(`all ${variantHits.length} Button variant literal(s) are legal: ${Array.from(new Set(variantHits.map((h) => h.value))).join(', ')}`);
  }
}
{
  const bad = sizeHits.filter((h) => !LEGAL_SIZES.includes(h.value));
  if (bad.length > 0) for (const h of bad) fail(`${h.where}: illegal Button size "${h.value}" — legal sizes are [${LEGAL_SIZES.join(', ')}]`);
  else if (sizeHits.length === 0) ok('no explicit Button size literal (every call takes the default "md")');
  else ok(`all ${sizeHits.length} Button size literal(s) are legal: ${Array.from(new Set(sizeHits.map((h) => h.value))).join(', ')}`);
}

/* 类别断言④：`icon` —— 且只做"省略 vs 裸 null/undefined"这一条**明确**的判定。 */
{
  const icons = [];
  for (const call of calls) for (const prop of call.props) if (prop.key === 'icon') icons.push(prop);
  if (icons.length === 0) ok('no Button call passes icon (nothing to check beyond the signature read above)');
  else {
    const illegal = icons.filter((p) => /^(null|undefined)$/.test(p.value.trim()));
    for (const p of illegal) fail(`${label(p.valueStart)}: Button icon is the bare literal "${p.value.trim()}" — omit the prop instead (the real Button only renders the icon shell when icon != null, so a bare null/undefined is a no-op that hides the intent)`);
    if (illegal.length === 0) ok(`all ${icons.length} Button icon prop(s) carry a real value`);
  }
}

/* 类别断言⑤：遍历一遍所有具名 prop，把**类型装错**的挑出来。
 *  这里**不**断言 onClick 的返回类型（合法）—— 下面这条 `must` 只覆盖"绑定值"这一类明确错误。
 *  另外把 `style` 单独列出来：本套件的既定纪律是"插件不许用 style 覆盖官方按钮的外观"，
 *  真出现时打印为提示（不是红）：它可能是有意的，而**判红必须能被复查**。 */
{
  const KEY = /^[A-Za-z_$][\w$]*$/;
  const EVENTISH = /^on[A-Z]/;
  let named = 0;
  for (const call of calls) {
    for (const prop of call.props) {
      if (/^\d+$/.test(prop.key)) continue;                 // 数组元素（jsxs 的 children 数组）
      if (!KEY.test(prop.key)) fail(`${label(prop.keyStart)}: Button received a non-identifier prop key "${prop.key}" — inspect this call site by hand`);
      else named++;
      const t = prop.value.trim();
      if (prop.key === 'className' && !/^"/.test(t)) fail(`${label(prop.valueStart)}: Button className is not a string literal (${t.slice(0, 60)}) — className is a named prop of the primitive and its value must be inspectable here`);
      if (prop.key === 'style' && t.startsWith('{')) console.log(`         note: ${label(prop.valueStart)} passes \`style\` to Button — that overrides the primitive's own metrics; confirm it is deliberate`);
      if (prop.key === 'size' && !/^"/.test(t)) { /* 已由上面 ② 报红 */ }
      // onClick 的值是**函数表达式**、**函数引用**（标识符）或箭头函数都合法 ——
      // 这里只排除明确不是函数的字面量（字符串/数字/裸 true/false/null）。
      if (EVENTISH.test(prop.key) && /^("[^"]*"|'[^']*'|\d|true$|false$|null$|undefined$)/.test(t)) {
        fail(`${label(prop.valueStart)}: Button ${prop.key} is not a function value (${t.slice(0, 60)}) — a non-function handler is spread straight onto the native button by ...rest`);
      }
    }
  }
  ok(`audited ${named} named prop(s) across ${calls.length} Button call site(s) (${Array.from(new Set(calls.flatMap((c) => c.props.map((p) => p.key)))).filter((k) => !/^\d+$/.test(k)).sort().join(', ')})`);
}

/* ────────────── 3. 每一个 --dsw-* 设计变量都必须在 app.asar 里有定义 ────────────── */

/** 从 asar 里**全部**文本资源解析 `--dsw-*` 的定义（`--name:`，允许名字与冒号间有空白 ——
 *  CSS 合法，且这样抓不会因为格式差异漏掉一个真实定义而误报）。 */
const DEF_RE = /--dsw-[A-Za-z0-9_-]+\s*:/g;
const DEFINED = new Map();          // varName -> [{ path, line }]（最多记 3 处）
const SCAN_CANDIDATES = ASAR_FILES.filter((e) => e.size > 0 && e.size <= 3_000_000);
for (const entry of SCAN_CANDIDATES) {
  let text;
  try { text = asarRead(asar, entry).toString('utf8'); } catch { continue; }
  if (!text.includes('--dsw-')) continue;
  for (const m of text.matchAll(DEF_RE)) {
    const name = m[0].slice(0, m[0].length - 1).replace(/\s*:$/, '').trim();
    if (!DEFINED.has(name)) DEFINED.set(name, []);
    const list = DEFINED.get(name);
    if (list.length < 3) list.push({ path: entry.path, line: text.slice(0, m.index).split('\n').length });
  }
}
if (DEFINED.size === 0) fail('no --dsw-* definition was found anywhere in app.asar — the extraction is broken; refusing to call an empty set "all defined"');
else ok(`extracted ${DEFINED.size} --dsw-* definition(s) from app.asar (${SCAN_CANDIDATES.length} candidate resource(s) scanned)`);

/** 运行期注入的变量白名单：**只有**在 asar 的定义扫描里确实找不到、且能逐字给出注入点时才允许。
 *  每一条都带**来源**；下面的自检会去那个来源文件里核实这个变量真的出现在那里 ——
 *  白名单因此不能用来"放宽成找不到就跳过"。 */
const RUNTIME_INJECTED = [
  // 当前为空：插件引用的 22 个变量**全部**能在 app.asar 里逐字找到定义（见报告）。
  // 留这个结构是为了下一次：真要放行时必须写 { name, source, why }，且 source 会被核实。
];
for (const w of RUNTIME_INJECTED) {
  const entry = ASAR_FILES.find((e) => e.path.endsWith(w.source.file));
  if (!entry) { fail(`whitelist entry ${w.name} names a source that does not exist in app.asar: ${w.source.file}`); continue; }
  const text = asarRead(asar, entry).toString('utf8');
  const at = text.indexOf(w.name);
  if (at < 0) { fail(`whitelist entry ${w.name} claims to be injected at ${w.source.file} but that file does not mention it — the whitelist is stale, remove or correct it`); continue; }
  const line = text.slice(0, at).split('\n').length;
  ok(`whitelisted runtime-injected variable ${w.name} ⇒ ${w.source.file}:${line} (${w.why})`);
}
const WHITELIST = new Map(RUNTIME_INJECTED.map((w) => [w.name, w.source]));

/** 插件里**所有** `var(--dsw-…)` 引用（不止 UI 串：整个 client.js）。
 *  正则刻意用 `var\(\s*(--dsw-…)` 而不是裸 `--dsw-` —— 字符串字面量里的 `--dsw-x` 不是引用。 */
const USED = new Map();   // varName -> [{ line, form }]
for (const m of src.matchAll(/var\(\s*(--dsw-[A-Za-z0-9_-]+)/g)) {
  const name = m[1];
  if (!USED.has(name)) USED.set(name, []);
  USED.get(name).push({ line: lineOf(m.index), form: src.slice(m.index, m.index + 60).split('\n')[0] });
}
if (USED.size === 0) {
  fail(`no var(--dsw-…) reference was found in ${path.relative(PKG, TARGET)} — the extraction is broken (empty scan ≠ all defined)`);
} else {
  const undefinedVars = [];
  const whitelisted = [];
  for (const [name, uses] of USED) {
    if (DEFINED.has(name)) continue;
    if (WHITELIST.has(name)) { whitelisted.push(name); continue; }
    undefinedVars.push({ name, uses });
  }
  for (const v of undefinedVars) {
    const where = v.uses.slice(0, 3).map((u) => `line ${u.line}`).join(', ');
    fail(`${path.relative(PKG, TARGET)}: var(${v.name}) is referenced but has NO definition anywhere in app.asar (${where}; ${v.uses.length} use(s)) — a missing design token silently falls back to nothing: the declaration is dropped and the element renders unstyled`);
  }
  if (undefinedVars.length === 0) {
    ok(`all ${USED.size} referenced --dsw-* variable(s) have a definition in app.asar${whitelisted.length ? ` (+ ${whitelisted.length} whitelisted runtime injection(s): ${whitelisted.join(', ')})` : ''}`);
  }
  console.log('         referenced → defined at:');
  for (const [name, uses] of [...USED].sort()) {
    const defs = DEFINED.get(name) || [];
    const src0 = defs.length ? `${defs[0].path}:${defs[0].line}` : `WHITELIST ${WHITELIST.get(name) ? WHITELIST.get(name).file + ':' + WHITELIST.get(name).line : ''}`;
    console.log(`           ${name.padEnd(38)} ${String(uses.length).padStart(2)} use(s)  ←  ${src0}${defs.length > 1 ? ` (+${defs.length - 1} more definition site(s))` : ''}`);
  }
}

/* ────────────────────────────── 收口 ────────────────────────────── */

fs.closeSync(asar.fd);
if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed (${path.relative(PKG, TARGET)})`);
  process.exit(1);
}
console.log('\nPASS: every primitive prop value and every --dsw-* design variable is legal against the live app.asar');
console.log(`      (target ${path.relative(PKG, TARGET)}; asar ${ASAR}; ${asarFileSize(ASAR)} bytes)`);
process.exit(0);
