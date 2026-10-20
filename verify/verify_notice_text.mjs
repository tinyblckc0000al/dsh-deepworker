/**
 * verify_notice_text.mjs — 任务 12：**提示 / 通知文案里不得出现 `✅`**（用户 2026-10-13）。
 *
 * 用户原话：「不要在气泡里出现 ✅」。本插件的提示走两条通道（页面内气泡 + macOS 系统通知），
 * 两条通道**读的是同一批 i18n 字符串**（`showNotice(text, ev, opts)` 把 `text` 同时交给
 * `raiseNotice()` 与气泡 `textContent`）⇒ 改字符串就同时覆盖两者。
 *
 * ✅ 的禁止范围是**全部词典值**（2026-10-17 起）：用户看过设置页状态行的「未锁定 ✅」后
 * 明确说那个勾没有信息含量 ⇒ 设置页不再有例外。JS 注释里的 ✅ 不是文案，保持原样。
 * 断言走的是**「调用点 → 文案键 → 词典值」的链路**：只检查**真的会被 showNotice 送出去**的文本。
 *
 * 链路是这样算出来的（确定性闭包，不靠猜文案）：
 *   1. 源码里每一行含 `showNotice(` 的调用点，先按**已知形状**校验（新写法必须显式加进来，
 *      否则直接 FAIL ⇒ 「新代码带 ✅」不可能悄悄溜过去）；
 *   2. 形状里引用的所有实参变量（text/reason/message/copy）与 `t("...")` 键进入种子集；
 *   3. 反复展开：变量 → 它在源码里的赋值右侧 → 那些右侧里出现的 `t("...")` 键 / 模板字面量；
 *      参数名（message 等）按全局同名赋值展开（保守取并集，宁可多查不可漏查）；
 *   4. 每个可达键：zh 与 en 的词典值都不得含 `✅`；模板字面量的每个 `{...}` 替身再用
 *      **字面前缀**把词典里的候选值圈出来，候选值同样不得含 `✅`（防模板拼接进来的 ✅）。
 *
 * 同时守住：zh/en 键集必须一致，且任何词典值都不得带 `✅`。
 *
 * ## 任务 13（2026-10-13）追加：气泡定位 = 顶部正中，且**只用 CSS**
 * 同一批提示文案的另一半：用户要求气泡固定出现在**顶部水平居中**（不再跟着点击坐标跑）。
 * 第 7 节断言 `showNotice` 的**函数体**（先剥注释，避免被中文注释里的旧写法满足/破坏）：
 *   ① 签名仍是 `(text, ev, opts)` —— `ev` 保留，只是不再用于定位；
 *   ② 函数体里**没有** `style.left =` / `style.top =` / `ev.clientX` / `ev.clientY` / `window.innerWidth`；
 *   ③ 建气泡的样式串里**有** `left:50%` + `translateX(-50%)` + `top:<n>px` + `max-width:calc(100vw - <n>px)`；
 *   ④ z-index / 圆角 / 字号 / 底色 / textContent / appendChild 都还在（改定位不顺手改别的）。
 * 变异检验在 `verify_notice_text_mutations.mjs`（把定位改回点击坐标 ⇒ 必须红在第 7 节那条断言上）。
 *
 * ## 任务 14（2026-10-13）追加：气泡配色必须"一眼看出是浮层"
 * 用户原话：「气泡颜色再稍微变化一点，现在看起来跟后面的标题栏快融为一体了」→
 * 「调彩色边框或者换成浅灰背景色」→「边框细一点」→「蓝色再浅一丢丢」。
 * 第 7.6 节守这一组要求，且**按主题里解析出来的真实色值**判（不按 token 名字猜）：
 *   ① 底色 ≠ 同主题的 `--dsw-alias-bg-base`（浅色 #f9fafb vs #fff；深色 #353638 vs #151517）；
 *   ② 描边是强调色且**只比原蓝浅一档**（亮度 > 1.15×，同时边框 vs 底色对比度 ≥ 2.6:1 / 5.5:1）；
 *   ③ 「浮起来」的证据 ≥ 2 项（底色 token / ≥1px 实心描边 / 外扩阴影）；
 *   ④ 文字对比度 ≥ 7:1；⑤ 用到的每个 `--dsw-*` 都在真实主题包名单里。
 * 变异检验（同文件）把底色改回 `bg-layer-1`、把描边改回灰或改得太浅/几乎没改 ⇒ 都必须红。
 *
 * 用法：无参跑线上 `lib/client.js`；`HA_CLIENT_JS=<file>` 供变异检验读副本。
 * 与既有套件同构：无参运行 PASS/FAIL。
 */
import fs from 'node:fs';

const source = process.env.HA_CLIENT_JS || new URL('../lib/client.js', import.meta.url);
const code = fs.readFileSync(source, 'utf8');

const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const ok = (m) => console.log('  ok   ' + m);
const assert = (cond, m) => { if (!cond) fail(m); };
const eq = (a, b, m) => assert(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');

const CHECK = '\u2705';                    // ✅ —— 一个字符，别被编辑器/复制弄成变体
eq(CHECK.length, 1, 'CHECK 必须是单个码位');

/* ───────────────────────── 1. 词典（zh / en） ───────────────────────── */
const lines = code.split('\n');

/** 与 verify_i18n.mjs 同构：按大括号深度找 `var NAME = {` 的字面量范围。 */
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
const zhRange = block('zh');
const enRange = block('en');
assert(zhRange !== null && enRange !== null, '找不到 zh / en 词典字面量');

/** 词典条目：key → { value, line }。转义按 JS 词法解（严格模式解析失败即 FAIL）。 */
function entries(range, label) {
  const out = new Map();
  for (let i = range.start + 1; i < range.end; i++) {
    const m = /^\s*"([A-Za-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/.exec(lines[i]);
    if (!m) continue;
    let value;
    try { value = JSON.parse('"' + m[2] + '"'); }
    catch (e) { fail(label + ' 第 ' + (i + 1) + ' 行的值不是合法 JS 字符串字面量：' + m[2]); }
    if (out.has(m[1])) fail(label + ' 重复声明了 "' + m[1] + '"（第 ' + out.get(m[1]).line + ' 行与第 ' + (i + 1) + ' 行）');
    out.set(m[1], { value, line: i + 1 });
  }
  return out;
}
const zh = entries(zhRange, 'zh');
const en = entries(enRange, 'en');
assert(zh.size > 50 && en.size > 50, '词典看起来被截断了（zh ' + zh.size + ' / en ' + en.size + '）');
ok('词典：zh ' + zh.size + ' 键 / en ' + en.size + ' 键');

/* ───────────────────────── 2. 调用点：先按已知形状校验 ───────────────────────── */
/**
 * `showNotice(...)` 的已知形状。每一个都锚定在**实参怎么来**上：
 * 目的是让「新加了一个 showNotice 调用点」变成 FAIL（新写法必须显式进这张表），
 * 而不是靠人肉记得回来改断言。
 */
const SHAPES = [
  // —— 直接是词典键（含三元选键） ——
  /^showNotice\(t\("([A-Za-z0-9_.]+)"\)(,|$)/,
  /^showNotice\(t\(isWs \? "([A-Za-z0-9_.]+)" : "([A-Za-z0-9_.]+)",/,
  /^showNotice\(locked \? t\("([A-Za-z0-9_.]+)"\) : t\("([A-Za-z0-9_.]+)"\)/,
  /^showNotice\(unlocked \? t\("([A-Za-z0-9_.]+)"\) : t\("([A-Za-z0-9_.]+)"\)/,
  /^showNotice\(t\("([A-Za-z0-9_.]+)", \{/,
  /^showNotice\(t\("([A-Za-z0-9_.]+)"\) \+/,
  /^showNotice\(t\("([A-Za-z0-9_.]+)"\)$/,
  /^showNotice\(t\("([A-Za-z0-9_.]+)"\), \{/,
  /^showNotice\(t\(result\.ok \? "([A-Za-z0-9_.]+)" : "([A-Za-z0-9_.]+)"/,
  /^showNotice\(\(result\.ok \? t\("([A-Za-z0-9_.]+)"\)/,
  // —— 实参是变量 / 属性（进闭包继续展开） ——
  /^showNotice\(text, (ev|\{)/,
  /^showNotice\(reason, (ev|\{)/,
  /^showNotice\(message, \{/,
  /^showNotice\(copy\.notFound, ev\)?/,
  /^showNotice\(say\("([A-Za-z0-9_.]+)"\)/,
  // 2026-10-16 终端按钮：这一句的文案是**已经拼好的**回执（`outcome.detail`），
  // 键在 termRunSequence 里就选好了（term.done / term.doneFail / term.stillRunning / …）。
  // 形状与 text / reason / message 完全同类：进闭包继续展开，不是裸字面量。
  /^showNotice\(String\(outcome\.detail \|\| ""\), \{/,
  /^showNotice\(translate\("([A-Za-z0-9_.]+)"\)/,
  // 2026-10-17 第 2/3 段：批量执行器的**汇总句**。文案由 `termBatchMessage()` 拼好
  // （键是 term.batchOkAll / term.batchSummary / term.batchNoSelection / term.batchTooMany …），
  // 与 `say("key")` 完全同类：调用点只拿到一个已拼好的字符串。先落本地变量 `batchText`
  // 再传，形状才锚得住（直接传 `summary.message` 没有形状可认）。
  /^showNotice\(batchText, \{/,
  // —— 硬编码的调试/自检文案（不是词典键，直接看字面量） ——
  /^showNotice\("【专注锁/,
  // 2026-10-15 功能开关：被关掉的入口经各自的 i18n 接缝说话。`turnSay` 是 HistoryTurnActions
  // 的 props 接缝（工厂/组件作用域看不到 apply 的 t ⇒ 形状与 say / translate 完全同类）。
  /^showNotice\(turnSay\("([A-Za-z0-9_.]+)"/,
];

/**
 * 取 `open`（指向 `showNotice(` 的那个 `(`）起、括号平衡为止的**实参列表**。
 * 只数圆括号即可：形状表里没有函数体/对象里的 `)` 结构。找不到平衡点就返回 null。
 */
function balancedArgs(open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {          // 跳过字符串 / 模板里的括号
      const quote = ch;
      for (i++; i < code.length; i++) {
        if (code[i] === '\\') { i++; continue; }
        if (code[i] === quote) break;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return code.slice(open + 1, i); }
  }
  return null;
}

const RAW = /(^|[^\w.$])showNotice\(/g;

/**
 * 等长注释掩码：把行注释 / 块注释的每个字符换成空格（`\n` 保持不动，所以掩码与源码
 * **同长、同行数**，索引可直接对齐）。字符串/模板里的 `//` **不算**注释（先记引号状态）。
 *
 * 为什么要它：下面的 `callLines` 扫的是**原始源码**里的 `showNotice(`。注释里出现这个词
 * 就会被当成一个"调用点"，更糟的是——如果那个 `(` 不平衡（例如注释里只有一个反引号包着的
 * `showNotice(`），`balancedArgs` 会一路扫到文件尾返回 null，整个套件直接死在
 * "括号不平衡"。2026-10-15 就是这么撞上的：client.js 里一条说明注释写了 `showNotice(`。
 * 修法是让仪器能分辨"这行是注释"，而不是让所有人以后都别在注释里写这个函数名。
 *
 * 已知局限（不修，因为代价大于收益）：正则字面量里的 `//` 仍会被当成注释起点，于是在**同一行**
 * 更靠后的真实调用点会被跳过 —— 需要 `var re = /a\/\/b/; showNotice(…)` 这种形状才会命中。
 */
function commentMask(text) {
  const out = text.split('');
  let quote = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote !== null) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i += 1; continue; }
    if (ch === '/' && next === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') { out[j] = ' '; j += 1; }
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j += 1;
      j = Math.min(text.length, j + 2);
      for (let k = i; k < j; k += 1) if (text[k] !== '\n') out[k] = ' ';
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

// 掩码自己也是仪器 ⇒ 必须能同时说"是"和"不是"（AGENTS.md 纪律 10/11）。
{
  const masked = (text, needle) => commentMask(text)[text.indexOf(needle)] === ' ';
  assert(masked('var a = 1; // showNotice(x)', 'showNotice') === true, '注释掩码自检失败：行注释里的 showNotice 没被掩掉');
  assert(masked('showNotice(x);', 'showNotice') === false, '注释掩码自检失败：真实调用点被误掩 ⇒ 会把调用点漏掉');
  assert(masked('var u = "http://x//y";\nshowNotice(a);', 'showNotice') === false, '注释掩码自检失败：字符串里的 // 被误当注释起点了');
  assert(commentMask('/* a */ showNotice(b);').indexOf('showNotice') !== -1, '注释掩码自检失败：块注释之后的代码被误伤');
  assert(masked('/* a\nb */ showNotice(c);', 'showNotice') === false, '注释掩码自检失败：跨行块注释之后被误伤');
  assert(commentMask('a//b\nc').length === 'a//b\nc'.length && commentMask('a/*b*/c').length === 'a/*b*/c'.length,
    '注释掩码自检失败：掩码必须与源码等长（否则索引对不上）');
}

const MASK = commentMask(code);
const callLines = [];
let rawMatch;
while ((rawMatch = RAW.exec(code)) !== null) {
  const at = rawMatch.index + rawMatch[1].length;                            // 指向 `showNotice`
  if (MASK[at] === ' ') continue;                                            // 在注释里 ⇒ 不是调用点
  const open = at + 'showNotice'.length;                                     // 指向 `(`
  const line = code.slice(0, rawMatch.index).split('\n').length;
  // 排除定义与 `__test` 包装（后者是 `testHooks.showNotice = function (a, b, c) {…}`，
  // 前面的 `testHooks.` 已经被 `[^\w.$]` 挡住）。
  const before = code.slice(Math.max(0, rawMatch.index - 30), rawMatch.index + 10);
  if (/function showNotice/.test(before)) continue;
  const args = balancedArgs(open);
  if (args === null) fail('第 ' + line + ' 行的 showNotice 括号不平衡，无法取实参');
  // 折成一行：形状表锚在「实参怎么来」上，换行不改变身份
  callLines.push({ line, text: 'showNotice(' + args.replace(/\s+/g, ' ').trim() });
}
assert(callLines.length > 40, 'showNotice 调用点太少（' + callLines.length + '），形状表的锚定方式可能坏了');

const unmatched = [];
for (const call of callLines) {
  if (!SHAPES.some((re) => re.test(call.text))) unmatched.push(call);
}
if (unmatched.length > 0) {
  for (const call of unmatched) console.error('  第 ' + call.line + ' 行：' + call.text.slice(0, 150));
  fail(unmatched.length + ' 个 showNotice 调用点不在已知形状表里 —— 新增的调用点必须显式进 SHAPES，' +
    '否则「新文案带 ✅」会被漏掉');
}
ok('源码：' + callLines.length + ' 个 showNotice 调用点全部落在已知形状表内');

/* ───────────────────────── 3. 从调用点算出「可达的文案」 ───────────────────────── */
/** 第 3 步的可达标识符种子（形状表里以变量/属性形式传进 showNotice 的那些）。 */
const SEED_IDENTS = ['text', 'reason', 'message', 'copy', 'focusRequestText', 'result', 'isWs', 'locked', 'unlocked', 'batchText'];
/** 参数名 → 全局同名赋值也算（保守取并集）：宁可多查，不可漏查。 */
const PARAM_IDENTS = ['message', 'text', 'reason'];

/** 源码里所有 `ident = ...` 的赋值右侧（到该语句结束的行为止）。 */
function assignmentRhs(ident) {
  const out = [];
  const re = new RegExp('(?:^|[^\\w.$])' + ident.replace(/\$/g, '\\$') + '\\s*=\\s*([^;]*);', 'g');
  let m;
  while ((m = re.exec(code)) !== null) out.push({ at: m.index, rhs: m[1] });
  return out;
}

/** 文本里所有 `t("key")` / `say("key")` / `translate("key")` 的键。 */
function keysIn(text) {
  const out = [];
  const re = /\b(?:t|say|translate)\(\s*"([A-Za-z0-9_.]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** 文本里所有模板字面量（处理 `${}` 嵌套与转义反引号）。 */
function templatesIn(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') continue;
    let j = i + 1, depth = 0;
    const parts = [];
    let buf = '';
    for (; j < text.length; j++) {
      const ch = text[j];
      if (ch === '\\') { buf += text[j + 1]; j++; continue; }
      if (depth === 0 && ch === '`') break;
      if (ch === '$' && text[j + 1] === '{') { parts.push(buf); buf = ''; depth++; j++; continue; }
      if (depth > 0 && ch === '}') { depth--; j++; continue; }
      if (depth === 0) buf += ch;
    }
    if (depth === 0 && j < text.length) { parts.push(buf); out.push(parts); }
    i = j;
  }
  return out;
}

/** 词典值匹配 `parts`（`{...}` 占位符按字面前缀分段）。 */
function templatesMatching(parts) {
  const segs = [];
  for (const part of parts) {
    const split = part.split(/\{[A-Za-z0-9_]+\}/);
    for (const s of split) if (s !== '') segs.push(s);
  }
  const head = (parts[0] || '').split(/\{[A-Za-z0-9_]+\}/)[0];
  const out = [];
  for (const [key, item] of zh) {
    if (head !== '' && !item.value.startsWith(head)) continue;
    if (segs.every((s) => item.value.indexOf(s) !== -1)) out.push(key);
  }
  return out;
}

const reachedKeys = new Map();        // key → 第一条把它带进来的调用点行号
const reachedTemplates = [];          // { line, parts }
const reachedHardcoded = [];          // { line, text }

// 3.1 调用点本身带来的键（形状表捕获组里的都是键）
for (const call of callLines) {
  for (const re of SHAPES) {
    const m = re.exec(call.text);
    if (!m) continue;
    for (let g = 1; g < m.length; g++) {
      if (typeof m[g] === 'string' && m[g] !== '' && zh.has(m[g])) {
        if (!reachedKeys.has(m[g])) reachedKeys.set(m[g], call.line);
      }
      if (typeof m[g] === 'string' && m[g] !== '' && !zh.has(m[g]) && /^focus\.|^notice\.|^quote\./.test(m[g])) {
        fail('第 ' + call.line + ' 行的调用点引用了不存在的键 "' + m[g] + '"');
      }
    }
    break;
  }
  // 硬编码调试文案：不是词典键，直接看字面量
  const hard = /^showNotice\("([^"]*)"/.exec(call.text);
  if (hard && !/^[A-Za-z0-9_.]+$/.test(hard[1])) reachedHardcoded.push({ line: call.line, text: hard[1] });
}

// 3.2 闭包展开：变量 → 赋值右侧 → 其中的键 / 模板
const identSeen = new Set();
const pending = [...SEED_IDENTS];
while (pending.length > 0) {
  const ident = pending.pop();
  if (identSeen.has(ident)) continue;
  identSeen.add(ident);
  for (const { at, rhs } of assignmentRhs(ident)) {
    for (const key of keysIn(rhs)) {
      if (!zh.has(key)) fail('变量 "' + ident + '" 的赋值引用了不存在的键 "' + key + '"');
      if (!reachedKeys.has(key)) reachedKeys.set(key, 0);
    }
    for (const parts of templatesIn(rhs)) {
      reachedTemplates.push({ line: 0, parts });
      for (const key of templatesMatching(parts)) if (!reachedKeys.has(key)) reachedKeys.set(key, 0);
    }
    // 右侧里又调了别的函数 ⇒ 那些函数体里的赋值也要看（用 `f(` 的出现把它排进队列）
    const callRe = /([A-Za-z_$][A-Za-z0-9_$]*)\(/g;
    let cm;
    while ((cm = callRe.exec(rhs)) !== null) {
      const name = cm[1];
      if (name === 't' || name === 'say' || name === 'translate' || name === 'JSON' || name === 'String') continue;
      if (!identSeen.has(name)) pending.push(name);
    }
  }
}
// 参数名：全局同名赋值也算
for (const ident of PARAM_IDENTS) if (!identSeen.has(ident)) pending.push(ident);
while (pending.length > 0) {
  const ident = pending.pop();
  if (identSeen.has(ident)) continue;
  identSeen.add(ident);
  for (const { rhs } of assignmentRhs(ident)) {
    for (const key of keysIn(rhs)) if (!reachedKeys.has(key)) reachedKeys.set(key, 0);
    for (const parts of templatesIn(rhs)) {
      reachedTemplates.push({ line: 0, parts });
      for (const key of templatesMatching(parts)) if (!reachedKeys.has(key)) reachedKeys.set(key, 0);
    }
  }
}

// 3.3 模板字面量的文本身份就是闭包之外的另一半：调用点上的模板也要收（如 notes.imported 那条）
for (const call of callLines) {
  for (const parts of templatesIn(call.text)) {
    reachedTemplates.push({ line: call.line, parts });
    for (const key of templatesMatching(parts)) if (!reachedKeys.has(key)) reachedKeys.set(key, call.line);
  }
}

assert(reachedKeys.size > 30, '可达文案键只有 ' + reachedKeys.size + ' 个 —— 闭包看起来没展开，断言会假绿');
ok('闭包：从 ' + callLines.length + ' 个调用点算出 ' + reachedKeys.size + ' 个可达文案键 + ' +
  reachedTemplates.length + ' 个模板字面量（标识符 ' + identSeen.size + ' 个）');

/* ───────────────────────── 4. 断言：可达文案里没有 ✅ ───────────────────────── */
/** 这些键**必须**真的被走到（否则闭包退化成空集，断言会假绿）。 */
const MUST_BE_REACHED = [
  'focus.lockedWorkspace', 'focus.lockedLocal', 'focus.unlockedLocal', 'focus.wrapEscaped',
  'focus.expired', 'focus.sentLock', 'focus.sentUnlock', 'focus.requested',
];
for (const key of MUST_BE_REACHED) {
  assert(reachedKeys.has(key), '键 "' + key + '" 必须可达（它是 showNotice 的实参；不达说明闭包坏了）');
}

const badZh = [];
const badEn = [];
for (const [key, at] of reachedKeys) {
  const z = zh.get(key);
  const e = en.get(key);
  assert(z !== undefined, 'zh 缺少可达键 "' + key + '"');
  assert(e !== undefined, 'en 缺少可达键 "' + key + '"（键集不一致）');
  if (z.value.indexOf(CHECK) !== -1) badZh.push({ key, line: z.line, value: z.value, from: at });
  if (e.value.indexOf(CHECK) !== -1) badEn.push({ key, line: e.line, value: e.value, from: at });
}
for (const bad of badZh) console.error('  zh["' + bad.key + '"] 第 ' + bad.line + ' 行仍含 ✅：' + bad.value + '（来自第 ' + bad.from + ' 行的调用点）');
for (const bad of badEn) console.error('  en["' + bad.key + '"]（来自第 ' + bad.from + ' 行的调用点）：' + bad.value);
assert(badZh.length === 0 && badEn.length === 0,
  '提示/通知文案里仍有 ✅：zh ' + badZh.length + ' 条 / en ' + badEn.length + ' 条（用户要求气泡里不再出现 ✅）');
ok('提示/通知文案：' + reachedKeys.size + ' 个可达键（zh + en = ' + (reachedKeys.size * 2) + ' 条值）一条都不含 ✅');

// 模板字面量的候选值（防「✅ 是拼接进去的」）：候选同样不得含 ✅
const badTmpl = [];
for (const t of reachedTemplates) {
  for (const key of templatesMatching(t.parts)) {
    const z = zh.get(key), e = en.get(key);
    if ((z && z.value.indexOf(CHECK) !== -1) || (e && e.value.indexOf(CHECK) !== -1)) badTmpl.push({ key, parts: t.parts, line: t.line });
  }
}
for (const bad of badTmpl) console.error('  模板候选 zh/en["' + bad.key + '"] 含 ✅（模板 ' + JSON.stringify(bad.parts) + '）');
assert(badTmpl.length === 0, '模板字面量圈出来的候选文案里有 ' + badTmpl.length + ' 条含 ✅');

// 硬编码调试文案
for (const hard of reachedHardcoded) {
  assert(hard.text.indexOf(CHECK) === -1, '第 ' + hard.line + ' 行的硬编码提示文案含 ✅：' + hard.text);
}
ok('模板候选 + ' + reachedHardcoded.length + ' 条硬编码提示文案：都不含 ✅');

/* ───────────────────────── 5. 断言：设置页文案也不许带 ✅ ───────────────────────── */
/**
 * 2026-10-17：用户看设置页状态行问「这个勾有啥信息含量」⇒ ✅ 已删除。
 * 这条从"保留清单"反转成"任何词典值都不许带 ✅"：以后谁再往设置页文案里塞一个勾，
 * 这里会直接红（不再有设置页例外）。
 */
{
  const offenders = [];
  for (const [key, rec] of zh) if (rec.value.includes(CHECK)) offenders.push('zh.' + key + ' = ' + rec.value);
  for (const [key, rec] of en) if (rec.value.includes(CHECK)) offenders.push('en.' + key + ' = ' + rec.value);
  assert(offenders.length === 0, '所有词典值都不许带 ✅（设置页也一样）：' + offenders.join(' | '));
  ok('所有词典值都不含 ✅（设置页文案不再是例外）');
}

// 注释里的 ✅ 不是文案：原样保留（它不该被当成文案来清，也不该让它满足任何断言）
// ⚠️ 必须断言**精确条数**，不能只断言 "> 0"：仓库里正好有 2 处注释带 ✅，只删其中一处时
//    "至少 1 处" 仍然成立 ⇒ 变异 ⑧（verify_notice_text_mutations.mjs）会**静默变绿**。
//    2026-10-15 实测到的假绿：变异 ⑧ 报 "套件仍然全绿"。改法与 dsh-ha-core/verify/verify_step1_plan.mjs
//    的 SUITE_READERS 同一手法（census 断言）：删掉或新增任何一处注释 ✅ 都会变红。
const COMMENT_CHECK_LINES = 2;
const commentMentions = lines.filter((l) => l.indexOf(CHECK) !== -1 && /^\s*\/\//.test(l));
assert(commentMentions.length === COMMENT_CHECK_LINES, '源码注释里的 ✅ 必须原样保留（它是注释、不是文案）：期望正好 ' + COMMENT_CHECK_LINES + ' 行，实际 ' + commentMentions.length + ' 行 —— 删/增都必须同步更新这条 census');
ok('保留：源码注释里的 ✅ 原样不动（' + commentMentions.length + ' 行）');

/* ───────────────────────── 6. 断言：zh / en 键集一致 ───────────────────────── */
const onlyZh = [...zh.keys()].filter((k) => !en.has(k));
const onlyEn = [...en.keys()].filter((k) => !zh.has(k));
assert(onlyZh.length === 0 && onlyEn.length === 0,
  'zh / en 键集不一致：只有 zh ' + JSON.stringify(onlyZh) + ' / 只有 en ' + JSON.stringify(onlyEn));
ok('zh / en 键集一致（各 ' + zh.size + ' 键）');

/* ───────────── 7. 断言：气泡定位 = 顶部正中，且**只用 CSS**（任务 13，2026-10-13） ───────────── */
/**
 * 用户原话（2026-10-13）：气泡要**顶部水平居中**。以前按点击坐标定位
 * （`noticeEl.style.left = Math.min(ev.clientX, …)` + `style.top = ev.clientY + 12`）⇒ 提示跟着
 * 点击位置跑，屏幕各处都出现，还要靠 `window.innerWidth` 算像素（窗口一缩放就错位）。
 *
 * 纪律：断言前先**剥掉注释**。新的实现故意在中文注释里引用旧写法（"以前…… `ev.clientX`/`ev.clientY`"），
 * 直接对全文 grep 会被**注释**满足/破坏 —— 这正是 AGENTS.md 说的"文本断言被死代码/散文满足"。
 */
function stripLineComments(text) {
  return text.split('\n').map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote !== null) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
const codeNoComments = stripLineComments(code);
const linesNoComments = stripLineComments(lines.join('\n')).split('\n');

// 7.0 前置自检：剥注释这一步本身必须有效（否则下面的断言可能被注释满足 ⇒ 变异检验会假红/假绿）
const stripSelftest = stripLineComments('var a = 1; // ev.clientX 只是注释\nvar b = "http://x//y"; // note');
assert(stripSelftest.indexOf('ev.clientX') === -1, '剥注释自检失败：行注释没被剥掉');
assert(stripSelftest.indexOf('"http://x//y"') !== -1, '剥注释自检失败：字符串里的 // 被误伤');

// 7.1 找到 showNotice 的**函数定义**，按大括号平衡取函数体（字符串/模板/注释里的括号都跳过）
const defIdx = codeNoComments.indexOf('function showNotice(');
assert(defIdx >= 0, '找不到 showNotice 的函数定义');
const defLine = codeNoComments.slice(0, defIdx).split('\n').length;
const openBrace = codeNoComments.indexOf('{', defIdx);
assert(openBrace >= 0, 'showNotice 定义后找不到函数体的 `{`');
let body = null;
{
  let depth = 0;
  for (let i = openBrace; i < codeNoComments.length; i++) {
    const ch = codeNoComments[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      for (i++; i < codeNoComments.length; i++) {
        if (codeNoComments[i] === '\\') { i++; continue; }
        if (codeNoComments[i] === quote) break;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { body = codeNoComments.slice(openBrace + 1, i); break; } }
  }
}
assert(body !== null, 'showNotice 的函数体括号不平衡，取不到函数体');
assert(body.indexOf('data-history-actions-notice') !== -1 && body.indexOf('document.createElement') !== -1,
  '取到的 showNotice 函数体不像那个建气泡的函数（是不是找到了别的 showNotice？）');

// 7.2 签名：`ev` 必须仍在（调用点还在传；删参数/改调用点是更大的改动面）
const sig = codeNoComments.slice(defIdx, openBrace).replace(/\s+/g, ' ');
const sigMatch = /function showNotice\(text, ev, opts\)/.exec(sig);
assert(sigMatch !== null, 'showNotice 的签名必须仍是 (text, ev, opts)：' + sig.slice(0, 120));
ok('定位：签名仍是 ' + sigMatch[0] + '（ev 保留在参数里，只是不再用于定位）');

// 7.3 反面：函数体里**不得**再用点击坐标定气泡位置
const BAD_POS = [
  [/\.style\.left\s*=/, '函数体里出现 `noticeEl.style.left = …`（改用 CSS 居中了，不该再算像素）'],
  [/\.style\.top\s*=/, '函数体里出现 `noticeEl.style.top = …`（改用 CSS 居中了，不该再算像素）'],
  [/ev\.clientX/, '函数体里仍出现 `ev.clientX`（定位不得依赖点击坐标）'],
  [/ev\.clientY/, '函数体里仍出现 `ev.clientY`（定位不得依赖点击坐标）'],
  [/window\.innerWidth/, '函数体里仍出现 `window.innerWidth`（窗口缩放会跑偏；居中必须交给 CSS）'],
  [/window\.innerHeight/, '函数体里仍出现 `window.innerHeight`（同上）'],
];
for (const [re, msg] of BAD_POS) {
  assert(!re.test(body), msg + ' —— 见 verify_notice_text.mjs 第 7 节（气泡必须顶部正中、由 CSS 居中）');
}
ok('定位：函数体里没有 ev.clientX / ev.clientY / style.left / style.top / window.innerWidth（' + BAD_POS.length + ' 条反面断言）');

// 7.4 正面：用于创建气泡的**那一条 style 字符串**必须同时含 CSS 水平居中 + 顶部 + 限宽
/**
 * ⚠️ 必须**按引号取到整条语句**：CSS 串自己就带 `;`（`position:fixed;top:14px;…`），
 * 用 `indexOf(';')` 截会把串截成 `"position:fixed` ⇒ 断言对着**半个串**判，正面/反面都会假。
 * （这条自检写下来就是因为第一版真踩了：候选 bundle 明明有 `left:50%`，套件却报缺失。）
 */
function statementAt(text, start) {
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === ';') return text.slice(start, i + 1);
  }
  return text.slice(start);
}
const SAMPLES = [
  'x = "a;b;c";',
  'y = "a\\";b";',
  'z = `p;q`;',
];
for (const sample of SAMPLES) {
  const stmt = statementAt(sample, sample.indexOf('=') + 1);
  assert(stmt === sample.slice(sample.indexOf('=') + 1),
    'statementAt 自检失败（取到的语句不等于输入）：' + JSON.stringify(sample) + ' → ' + JSON.stringify(stmt));
}
assert(statementAt('style.cssText = "left:50%;top:1px;"; rest', 0) === 'style.cssText = "left:50%;top:1px;";',
  'statementAt 自检失败：字符串里的 `;` 没有被正确跳过');
assert(statementAt('t = {"a": 1}; tail', 0) === 't = {"a": 1};',
  'statementAt 自检失败：对象字面量里的 `;` 边界不对');
const cssLines = [];
for (const call of ['style.cssText', 'style.setProperty']) {
  const at = body.indexOf(call);
  if (at === -1) continue;
  const stmt = statementAt(body, at);
  assert(stmt.indexOf('position:fixed') !== -1 && stmt.indexOf('left') !== -1,
    '取到的样式语句看起来被截断了（不含 position:fixed/left）：' + JSON.stringify(stmt.slice(0, 120)));
  cssLines.push(stmt);
}
assert(cssLines.length > 0, 'showNotice 函数体里找不到设置样式的那条语句（style.cssText）');
const cssText = cssLines.join(' ; ');
const HAVE = [
  [/\bleft\s*:\s*50%/, '`left:50%`（CSS 水平居中的一半）'],
  [/translateX\(-50%\)/, '`translateX(-50%)`（CSS 水平居中的另一半）'],
  [/\btop\s*:\s*\d+px/, '`top:<n>px`（距顶一小段，例 14px）'],
  // 任务 15：限宽从「只跟视口走」改成**紧凑上限 + 窄窗口仍响应式**：
  // `min(<紧凑上限>px, calc(100vw - <留白>px))`。两条都要在，缺哪条都不算。
  [/\bmax-width\s*:\s*min\(\s*\d+px\s*,\s*calc\(100vw\s*-\s*\d+px\)\s*\)/, '`max-width:min(<紧凑上限>px, calc(100vw - <留白>px))`（既紧凑又不溢出）'],
];
for (const [re, msg] of HAVE) assert(re.test(cssText), '创建气泡的样式里缺少 ' + msg + '：' + cssText.slice(0, 200));
const topPx = Number((/\btop\s*:\s*(\d+)px/.exec(cssText) || [])[1]);
const capPx = Number((/max-width\s*:\s*min\(\s*(\d+)px/.exec(cssText) || [])[1]);
const insetPx = Number((/calc\(100vw\s*-\s*(\d+)px\)/.exec(cssText) || [])[1]);
assert(topPx >= 8 && topPx <= 24, '距顶 "top:' + topPx + 'px" 不在 8–24px 这一小段距离内');
// 任务 15（用户 2026-10-13）：「气泡太宽了 —— 收回成一张紧凑卡片」。所以除了视口留白，
// 还必须有**紧凑上限**：≤ 460px（用户给的可微调范围），且宽到还能装下满屏长的文案而不挤成一条。
assert(Number.isFinite(capPx), '紧凑上限解析不出数字：' + cssText.slice(0, 200));
assert(capPx <= 460,
  '紧凑上限 ' + capPx + 'px 超过 460px ⇒ 气泡太宽了（用户 2026-10-13：「气泡太宽了 —— 收回成一张紧凑卡片」，上限不得超 460px）');
assert(capPx >= 280,
  '紧凑上限 ' + capPx + 'px 太小（正常宽度下会把长文案挤成一条条窄行，用户的诉求是"紧凑"不是"窄条"）');
assert(insetPx >= 16, 'calc(100vw - ' + insetPx + 'px) 的留白太小（窄窗口会贴边）');
assert(/width\s*:\s*fit-content/.test(cssText), '紧凑上限之外必须保留 `width:fit-content`（短文案不该撑成固定宽卡片）');
ok('定位：气泡样式 = CSS 居中（left:50% + translateX(-50%)）· 距顶 ' + topPx + 'px · 限宽 min(' + capPx + 'px 紧凑上限, calc(100vw - ' + insetPx + 'px) 窄窗口留白)');

// 7.5 保留的面：z-index / 圆角 / 字号 / 文字色 + 文本 + 追加到 body（改定位/改配色不该顺手改掉这些）
const KEEP_STYLE = [
  [/z-index\s*:\s*2147483000/, 'z-index 必须保留'],
  [/\bborder-radius\s*:\s*8px/, '圆角必须保留'],
  [/\bfont-size\s*:\s*12px/, '字号必须保留'],
  [/\bline-height\s*:\s*18px/, '行高必须保留'],
  [/var\(--dsw-alias-label-primary\)/, '文字色 token 必须保留'],
];
for (const [re, msg] of KEEP_STYLE) assert(re.test(cssText), msg + '：' + cssText.slice(0, 200));
assert(/noticeEl\.textContent\s*=\s*text/.test(body), '气泡必须仍把 text 写进 textContent');
assert(/document\.body\.appendChild\(noticeEl\)/.test(body), '气泡必须仍被 appendChild 到 body');
ok('定位：改定位没有顺手改掉 z-index / 圆角 / 字号 / 行高 / 文字色 / textContent / appendChild');

/* ── 7.6 任务 14（2026-10-13）：气泡必须**一眼看出是浮层** ─────────────────────────
 * 用户原话（先）：「气泡颜色再稍微变化一点，现在看起来跟后面的标题栏快融为一体了」；
 * 用户原话（后，指定方向）：「调彩色边框或者换成浅灰背景色」⇒ 就这两条，不加别的装饰元素。
 * 位置/尺寸/层级语义是上一条任务的成果（第 7.4/7.5 节继续守着），这一节只守**视觉分离**：
 *
 *   ① 底色必须是**中性灰面**：值在主题包里解析出来必须 ≠ 同主题的 --dsw-alias-bg-base
 *      （浅色主题 #f9fafb vs #fff；深色主题 #353638 vs #151517）。「浅灰」在深色主题下
 *      就是"稍亮的深灰"，不是照字面用浅灰 —— 断言按**解析后的真实色值**判，不按名字猜。
 *   ② 描边必须是**强调色**（彩色边框）且**只比原来的蓝浅一档**：来源必须是 --dsw-alias-link，
 *      或由它与 white 的 color-mix 派生（用户 2026-10-13：「调彩色边框」→「边框细一点」→「蓝色再浅一丢丢」）。
 *      断言按**解析后算出来的真实色值**判：亮度必须比原蓝色高（确实变浅）、但对比度不能掉到看不见。
 *      ⚠️ 不能改回 --dsw-alias-border-l3（灰描边）—— 改回去必须红。
 *   ③ 「浮起来」的证据至少两项成立：底色 ≠ 页面底色 / 有 ≥1px 实心描边 / 有主题外扩阴影。
 *      只改一项（例如只把阴影换成 prominent）不足以判绿 —— 用户要的是"明显拉开"。
 *   ④ 文字对比度不得下降：文字色仍是 --dsw-alias-label-primary（未动），且**解析后**在
 *      两套主题下与气泡底色的 WCAG 对比度都 ≥ 7:1（实测浅色 ~18:1 / 深色 ~11.6:1）。
 *   ⑤ 用到的**每一个** `var(--dsw-*)` 都必须在**真实主题包**的变量名单里。
 *      ⚠️ 这条是本机真实踩过的坑：曾用不存在的 `--dsw-specific-sidebar-width` ⇒ 永久
 *      fallback 到硬编码像素。所以名单**优先从 app.asar 的主题包现读**（只读），
 *      app.asar 不在时退回**同一个名单的固化副本**（内容逐字相同，见白名单常量）。
 *      `--dsw-specific-sidebar-width` 必须**不在**名单里 —— 反向校准：名单真的在筛东西。
 */
const FLOAT_EVIDENCE = [
  [/\bbackground\s*:\s*var\(--dsw-[a-z0-9-]+\)/, '底色由主题 token 指定'],
  [/\bborder\s*:\s*(?:[1-9]\d*(?:\.\d+)?px|0?\.\d+px)\s+solid\s+(?:var\(--dsw-[a-z0-9-]+\)|color-mix\([^;]*var\(--dsw-[a-z0-9-]+\)[^;]*\))/, '有 ≥1px 实心描边'],
  [/box-shadow\s*:\s*var\(--dsw-elevation-(?:prominent|soft|panel)\)/, '有主题外扩阴影'],
];
const floatCount = FLOAT_EVIDENCE.filter(([re]) => re.test(cssText)).length;
assert(floatCount >= 2,
  '气泡"高于背景"的证据必须至少两项（底色 token / 实心描边 / 外扩阴影），实际 ' + floatCount + ' 项：' + cssText.slice(0, 240));

const bgToken = (/\bbackground\s*:\s*var\((--dsw-[a-z0-9-]+)\)/.exec(cssText) || [])[1];
assert(bgToken !== undefined, '气泡样式里没有 `background:var(--dsw-…)`：' + cssText.slice(0, 240));
// 边框：`<n>px solid <色>`（色可以是 var(--dsw-…) 或 var(--dsw-…) 与 white 的 color-mix）
const borderDecl = (/\bborder\s*:\s*([1-9]\d*(?:\.\d+)?px|0?\.\d+px)\s+solid\s+(var\(--dsw-[a-z0-9-]+\)|color-mix\([^;]*\))/.exec(cssText) || []);
assert(borderDecl.length > 0, '气泡样式里没有 `border:<n>px solid <色>`：' + cssText.slice(0, 240));
assert(parseFloat(borderDecl[1]) === 1,
  '气泡描边宽度必须**恰好** 1px（用户 2026-10-13：「边框细一点」，且明令不许 2px / 不许 outline / 不许双层描边加粗），实际 ' + borderDecl[1] + '：' + cssText.slice(0, 240));
const borderColorCss = borderDecl[2];
/** 边框色里引用的主题变量（简单 var 一个；color-mix 取**线性那一项**的 token，即被调浅的那个）。 */
const borderTokens = (() => {
  if (/^var\(/.test(borderColorCss)) return [(/var\((--dsw-[a-z0-9-]+)\)/.exec(borderColorCss) || [])[1]];
  const stops = [];
  const re = /(--dsw-[a-z0-9-]+)(?:\s+([0-9.]+)%)?|([0-9.]+)%/g;
  let m;
  while ((m = re.exec(borderColorCss)) !== null) stops.push({ token: m[1] || null, pct: m[2] !== undefined ? Number(m[2]) : (m[3] !== undefined ? Number(m[3]) : null) });
  return stops.filter((s) => s.token).map((s) => s.token);
})();
assert(borderTokens.length > 0 && borderTokens.every((t) => t !== undefined),
  '边框色里找不到主题变量：' + borderColorCss);
const borderToken = borderTokens[0];
/** color-mix 里指定的两个权重（缺省时 CSS 规则是各 50%）。 */
const borderMixPcts = (() => {
  const nums = (borderColorCss.match(/([0-9.]+)%/g) || []).map((s) => parseFloat(s));
  if (nums.length >= 2) return nums;
  if (nums.length === 1) return [nums[0], 100 - nums[0]];
  return [50, 50];
})();

/** 用到的 var(--dsw-*) 全部要在真实主题包名单里（名单**只读** app.asar，绝不改它） */
const USED_VARS = Array.from(new Set(cssText.match(/--dsw-[a-z0-9-]+/g) || [])).sort();
assert(USED_VARS.length > 0, '样式串里一个 --dsw-* 变量都没有？' + cssText.slice(0, 200));

/** 主题包里定义过的 `--dsw-*`（>= 上面 USED_VARS 用到的那些），优先现读 app.asar。 */
const FALLBACK_THEME_VARS = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay', '--dsw-alias-bg-module-platform',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3',
  '--dsw-alias-border-l4', '--dsw-alias-brand-primary', '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-link',
  '--dsw-alias-toast-bg', '--dsw-alias-tooltip-bg', '--dsw-elevation-panel', '--dsw-elevation-prominent',
  '--dsw-elevation-soft', '--dsw-elevation-stroke', '--dsw-elevation-stroke-color',
  '--dsw-radius-lg', '--dsw-radius-md', '--dsw-radius-sm',
  '--dsw-static-neutral-bluish-60', '--dsw-static-neutral-bluish-800', '--dsw-static-neutral-bluish-850',
  '--dsw-static-neutral-bluish-875', '--dsw-static-neutral-bluish-950',
  '--dsw-specific-bubble', '--dsw-specific-selector', '--dsw-specific-sidebar-fill', '--dsw-specific-tip',
];
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const THEME_INNER = 'dsh-client-ui-theme/lib/client.js';
let themeCss = null;
/** app.asar 的目录头与数据区起点（只读用；第 8 节还要按路径现读**其它** bundle 的槽位注册）。 */
let asarHeader = null;
let asarBaseOffset = -1;
/** 按路径后缀从 app.asar 现读一个文件（只读；读不到返回 null，绝不猜）。 */
function readAsarEntry(innerSuffix) {
  if (!asarHeader) return null;
  let entry = null;
  (function walk(node, prefix) {
    for (const [name, val] of Object.entries(node.files || {})) {
      const p = prefix + '/' + name;
      if (val.files) walk(val, p);
      else if (p === innerSuffix) entry = val;
    }
  })(asarHeader, '');
  if (!entry) return null;
  const fd = fs.openSync(ASAR, 'r');
  try {
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, asarBaseOffset + parseInt(entry.offset, 10));
    return buf;
  } finally { fs.closeSync(fd); }
}
try {
  if (fs.existsSync(ASAR)) {
    const fd = fs.openSync(ASAR, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const jsonSize = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    asarHeader = JSON.parse(jsonBuf.toString('utf8'));
    asarBaseOffset = 8 + head.readUInt32LE(4);
    fs.closeSync(fd);
    const entry = (() => {
      let e = null;
      (function walk(node, prefix) {
        for (const [name, val] of Object.entries(node.files || {})) {
          const p = prefix + '/' + name;
          if (val.files) walk(val, p);
          else if (p.endsWith('/' + THEME_INNER)) e = val;
        }
      })(asarHeader, '');
      return e;
    })();
    if (entry) {
      const fd2 = fs.openSync(ASAR, 'r');
      const buf = Buffer.alloc(entry.size);
      fs.readSync(fd2, buf, 0, entry.size, asarBaseOffset + parseInt(entry.offset, 10));
      themeCss = buf.toString('utf8');
      fs.closeSync(fd2);
    }
  }
} catch (e) { themeCss = null; asarHeader = null; asarBaseOffset = -1; }

const themeVars = themeCss
  ? Array.from(new Set(themeCss.match(/--dsw-[a-z0-9-]+/g) || [])).sort()
  : FALLBACK_THEME_VARS;
const themeSource = themeCss
  ? 'app.asar 现读（' + themeVars.length + ' 个变量）'
  : 'app.asar 读不到 ⇒ 退回固化副本（' + themeVars.length + ' 个变量）';
const themeHas = (name) => themeVars.indexOf(name) !== -1;
assert(!themeHas('--dsw-specific-sidebar-width'),
  '主题变量名单居然含有不存在的 --dsw-specific-sidebar-width —— 名单不可信（' + themeSource + '）');
assert(themeHas('--dsw-alias-bg-layer-1'),
  '主题变量名单里找不到 --dsw-alias-bg-layer-1 —— 名单来源不对（' + themeSource + '）');
const missingVars = USED_VARS.filter((v) => !themeHas(v));
assert(missingVars.length === 0,
  '气泡样式用了主题里不存在的变量：' + JSON.stringify(missingVars) + '（名单来源 ' + themeSource + '）');

/** 解析主题 token 的实际色值（只读 app.asar；解析不出来就返回 null，绝不猜）。 */
function themeDecls(css) {
  const out = {};
  // ⚠️ 块里最后一条声明后面跟的是 `}` 而不是 `;`（`…--dsw-alias-tip:…;background-color:var(--dsw-alias-bg-base)}`），
  // 所以分隔符必须是 `[;} ]`，否则**恰好** `--dsw-alias-bg-base` 会被漏掉（实测被漏过）。
  const re = /(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) out[m[1]] = m[2].trim();
  return out;
}
function themeScopes() {
  if (!themeCss) return null;
  // ⚠️ `body[data-ds-dark-theme]{` 在同一份 CSS 里出现多次（静态色板 / alias 块 / 菜单覆盖…），
  // 所以锚点必须带**紧随其后的第一个变量名**才唯一：`{--dsw-static-` 是色板，`{--dsw-alias-bg-base` 是 alias。
  const darkAt = themeCss.indexOf('body[data-ds-dark-theme]{--dsw-alias-bg-base');
  const darwinAt = themeCss.indexOf('html[data-platform=darwin]');
  if (darkAt < 0) return null;
  const endDark = darwinAt > darkAt ? darwinAt : themeCss.length;
  // 浅色作用域 = 文件开头 → 深色 alias 块之前（含浅色色板 + 浅色 alias）；
  // 深色作用域 = 深色 alias 块 → darwin 覆盖之前（**不含**开头那一段：它属于浅色作用域）。
  // ⚠️ 两条链都必须能看见全局 `--dsw-static-*` 色板 —— `--dsw-specific-selector` 在深色块里
  // 指向 `--dsw-static-neutral-bluish-800`，而那条声明在色板块里，不在 alias 块里。
  // 实测踩过两次：① 两条链共用一份色板 ⇒ 深色被解析成浅色；② 深色链只切 alias 块 ⇒ 链断。
  // 做法：色板取「深色 alias 块之前的最后一份」（真正级联生效的那一份），alias 按主题各自覆盖。
  const palette = themeDecls(themeCss.slice(0, darkAt));
  const lightAll = Object.assign({}, palette);   // 浅色 alias 已在 palette 切片里按出现顺序覆盖
  const darkAll = Object.assign({}, palette);
  const aDark = themeDecls(themeCss.slice(darkAt, endDark));   // 深色 alias 覆盖同名项
  Object.assign(darkAll, aDark);
  const make = (globals) => (name) => {
    let v = name;
    for (let i = 0; i < 12; i++) {
      const hit = globals[v];
      if (!hit) return null;
      const m = /var\((--dsw-[a-z0-9-]+)/.exec(hit);
      if (!m) return hit;
      v = m[1];
    }
    return null;
  };
  return { light: make(lightAll), dark: make(darkAll) };
}
/** #rgb / #rrggbb / #rrggbbaa → 对比度用的相对亮度。 */
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const parse = (s) => parseInt(s, 16);
  if (h.length === 3) return [parse(h[0] + h[0]), parse(h[1] + h[1]), parse(h[2] + h[2])];
  if (h.length === 6 || h.length === 8) return [parse(h.slice(0, 2)), parse(h.slice(2, 4)), parse(h.slice(4, 6))];
  return null;
}
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
const contrast = (a, b) => {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** `color-mix(in srgb, A p%, white q%)`：按 sRGB 分量线性混合（与 CSS 的 sRGB 插值同算法）。 */
const mixHex = (a, b, pa) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return null;
  const p = pa / 100;
  return rgbToHex([0, 1, 2].map((i) => A[i] * p + B[i] * (1 - p)));
};
/** 把边框色的 CSS 表达式在这个主题作用域里算成实际色值（解析不出来返回 null，绝不猜）。 */
function resolveBorderColor(cssExpr, resolve) {
  if (/^var\(/.test(cssExpr)) return resolve((/var\((--dsw-[a-z0-9-]+)\)/.exec(cssExpr) || [])[1]);
  const lower = cssExpr.toLowerCase();
  if (!/^color-mix\(/.test(lower)) return null;
  const stopA = /var\((--dsw-[a-z0-9-]+)\)\s*([0-9.]+)%/.exec(cssExpr);
  // 第二个停靠点常常省略百分比（`… 85%, white`）⇒ CSS 规则是"另一项补足"（100-85=15）。
  const stopB = /\b(white|black|transparent)\b\s*(?:([0-9.]+)%)?/.exec(lower);
  if (!stopA || !stopB) return null;
  const base = resolve(stopA[1]);
  if (base === null) return null;
  const bw = { white: '#ffffff', black: '#000000', transparent: null }[stopB[1]];
  if (bw === null) return null;
  const whiteW = stopB[2] !== undefined ? Number(stopB[2]) : 100 - Number(stopA[2]);
  return mixHex(base, bw, 100 - whiteW);
}

if (!themeCss) {
  // 实时色值断言需要主题包；缺包时退化为「用到的变量都在白名单里」（第 ①/② 条降级，明写原因）。
  ok('变量核实（降级）：' + USED_VARS.length + ' 个 --dsw-* 都在固化白名单里 —— ' + USED_VARS.join(' ') +
    '（' + themeSource + ' ⇒ 无法核对实时色值，第 ①/② 条只做到"变量名存在"）');
  assert(bgToken !== '--dsw-alias-bg-layer-1',
    '气泡底色不得是 --dsw-alias-bg-layer-1（浅色主题 = 纯白，与标题栏同色）：' + cssText.slice(0, 240));
  assert(borderTokens.indexOf('--dsw-alias-border-l3') === -1,
    '气泡描边不得仍是 --dsw-alias-border-l3（淡灰描边，用户要求彩色边框）：' + cssText.slice(0, 240));
} else {
  const scopes = themeScopes();
  assert(scopes !== null, '主题包里找不到浅色/深色 alias 块 —— 色值断言无法进行');
  const rows = [];
  const resolved = {};
  for (const [label, resolve] of [['浅色', scopes.light], ['深色', scopes.dark]]) {
    const bg = resolve(bgToken);
    const base = resolve(borderToken);          // --dsw-alias-link 的原色
    const border = resolveBorderColor(borderColorCss, resolve);
    const label1 = resolve('--dsw-alias-label-primary');
    const page = resolve('--dsw-alias-bg-base');
    const oldBorder = resolve('--dsw-alias-border-l3');
    assert(base !== null, label + '主题下解析不出 ' + borderToken + ' 的色值（token 名存在但取值链断）');
    assert(border !== null,
      label + '主题下算不出边框色 `' + borderColorCss + '`（只支持 `var(--dsw-…)` 或它与 white 的 color-mix）');
    assert(bg !== null, label + '主题下解析不出 ' + bgToken + ' 的色值');
    assert(page !== null, label + '主题下解析不出 --dsw-alias-bg-base（页面底色）');
    assert(label1 !== null, label + '主题下解析不出 --dsw-alias-label-primary（文字色）');
    assert(bg !== page,
      label + '主题：气泡底色 ' + bg + '（' + bgToken + '）与页面底色 ' + page + ' 相同 ⇒ 会"融为一体"');
    assert(border !== oldBorder,
      label + '主题：气泡描边 ' + border + ' 与原来的 --dsw-alias-border-l3（' + oldBorder + '）相同 ⇒ 彩色边框没生效');
    // 「蓝色再浅一丢丢」= 亮度**升**（更浅），但幅度只要一档：对比度不能掉到看不见。
    // 阈值 1.15 是按实测定的：85% + 15% 白 ⇒ 浅色亮度 ×1.353、深色 ×1.168（深色原蓝本身已较浅，
    // 同样比例下抬得更少）。1.15 能挡住"没改"和"只挪一点点"，1.2 会把深色那一档误判成没生效。
    const lb = luminance(base), ln = luminance(border);
    assert(lb !== null && ln !== null, label + '主题：算不出亮度（' + base + ' / ' + border + '）');
    assert(ln > lb * 1.15,
      label + '主题：边框 ' + border + ' 不比原蓝 ' + base + ' 浅（亮度 ' + ln.toFixed(4) + ' vs ' + lb.toFixed(4) + '，要求 > 1.15×）');
    const ratio = contrast(label1, bg);
    assert(ratio !== null, label + '主题：算不出对比度（' + label1 + ' / ' + bg + '）');
    assert(ratio >= 7,
      label + '主题：文字色 ' + label1 + ' 在气泡底色 ' + bg + ' 上的对比度只有 ' + ratio.toFixed(2) + ':1（要求 ≥ 7:1）');
    const visMin = label === '浅色' ? 2.6 : 5.5;
    const vis = contrast(border, bg);
    assert(vis !== null && vis >= visMin,
      label + '主题：边框 ' + border + ' 与气泡底色 ' + bg + ' 的对比度只有 ' + (vis === null ? 'NaN' : vis.toFixed(2)) +
      ':1（要求 ≥ ' + visMin + ':1，浅一档后仍要看得见那条边）');
    rows.push(label + '主题：底色 ' + bgToken + ' = ' + bg + '（页面底色 ' + page + '）· 描边 ' + borderColorCss +
      ' = ' + border + '（原蓝 ' + borderToken + ' = ' + base + '，亮度 ×' + (ln / lb).toFixed(2) + '）· 文字 ' +
      '--dsw-alias-label-primary = ' + label1 + ' → 对比度 ' + ratio.toFixed(1) + ':1（边框 vs 底色 ' + vis.toFixed(2) + ':1）');
    resolved[label === '浅色' ? 'light' : 'dark'] = { bg: bg, border: border, label: label1, page: page, base: base };
  }
  // ⚠️ 防"两条链共用一份色板"再次悄悄发生：两套主题解析出来的值必须真的不同
  // （浅色 #f9fafb/#4176e6 vs 深色 #353638/#7aaaff）。这是那类 bug 的回归守卫。
  assert(resolved.light.bg !== resolved.dark.bg,
    '浅色/深色解析出同一个底色 ' + resolved.light.bg + ' ⇒ 两条 token 链很可能共用了同一份色板（守卫）');
  assert(resolved.light.base !== resolved.dark.base,
    '浅色/深色解析出同一个描边原色 ' + resolved.light.base + ' ⇒ 两条 token 链很可能共用了同一份色板（守卫）');
  ok('浮层：两条 token 链各自解析成功且互不相同（浅色 ' + resolved.light.bg + '/' + resolved.light.base +
    ' vs 深色 ' + resolved.dark.bg + '/' + resolved.dark.base + '）');
  ok('浮层：' + floatCount + '/3 项"高于背景"的证据成立 —— ' +
    FLOAT_EVIDENCE.filter(([re]) => re.test(cssText)).map(([, m]) => m).join(' + '));
  for (const r of rows) ok('浮层·色值（' + themeSource + '）：' + r);
}
ok('变量核实：气泡用到的 ' + USED_VARS.length + ' 个 --dsw-* 全部存在于主题包 —— ' + USED_VARS.join(' ') + '（名单来源：' + themeSource + '）');

/* ── 8. 任务 15（2026-10-13）：「专注」排到最前 + 计时不再挤动别的按钮 ────────────────
 * 用户原话：「把『专注』移到那一行最前面」；抖动现象：「它的文字每秒变宽变窄，把左边的
 * 『查找 / 存为笔记』挤动」。这两条与气泡无关，但同属一次任务，落在同一个套件里守。
 *
 * ① order：`conversation.session.header.utilities` 是**跨插件共享的升序 list 槽位**
 *    （app.asar 的槽位契约：`kind: "list"`，排序键 `(priority ?? 0)` 再 `(order ?? 0)`，
 *    未写 order 的条目 = 0）。所以「排最前」= order **小于**同槽位其它条目的最小 order。
 *    ⚠️ 断言的是**关系**（全表最小），不是某个魔法值 —— 将来别人把别的条目挪前，这条会红。
 * ② 计时样式：label 那个 span 必须带等宽数字（`fontVariantNumeric: "tabular-nums"` 或
 *    `fontFeatureSettings:'"tnum"'`）**且**有 `minWidth`（按最宽形态估的固定宽度）。
 *    只改样式、不动文案（label 仍是 focusHeaderLabel()，无 emoji）。
 */
function balancedBlock(text, openIdx) {
  const open = text[openIdx], close = { '(': ')', '{': '}', '[': ']' }[open];
  if (close === undefined) return null;
  let depth = 0, i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i++;
      while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
    i++;
  }
  return null;
}
/** 剥掉注释（先用 `/*`→`//` 归一再逐行去 `//`），让断言不可能被中文注释满足。 */
const codeOnly = code.replace(/\/\*/g, '//').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const SLOT = 'conversation.session.header.utilities';
/**
 * 从任意一段 JS 文本里解析 `ctx.slots.register({ … }, Component)` 的注册配置。
 * 用**括号平衡**匹配（不是正则到第一个 `}`），所以 block 里再嵌对象也取得全。
 * 返回 [{ name, id, order, declared }]；解析不出名字的块跳过（保守，不猜）。
 */
function parseRegisterBlocks(text) {
  const rows = [];
  let at = 0, guard = 0;
  while (guard++ < 500) {
    const idx = text.indexOf('slots.register({', at);
    if (idx === -1) break;
    const brace = text.indexOf('{', idx);
    const block = balancedBlock(text, brace);
    at = idx + 1;
    if (block === null) continue;
    const name = (/name\s*:\s*"([^"]+)"/.exec(block) || [])[1]
      || (/name\s*:\s*'([^']+)'/.exec(block) || [])[1];
    if (name === undefined) continue;
    const id = (/id\s*:\s*"([^"]+)"/.exec(block) || [])[1]
      || (/id\s*:\s*'([^']+)'/.exec(block) || [])[1];
    const orderRaw = (/order\s*:\s*(-?\d+(?:\.\d+)?)/.exec(block) || [])[1];
    rows.push({ name, id: id === undefined ? null : id, order: orderRaw === undefined ? 0 : Number(orderRaw), declared: orderRaw !== undefined });
  }
  return rows;
}
const SLOT_ROWS = parseRegisterBlocks(codeOnly).filter((r) => r.name === SLOT);
{
  assert(/slots\.register\(\{/.test(codeOnly), '源码里找不到任何 `slots.register({` —— 槽位 order 表无法建立');
  assert(SLOT_ROWS.length >= 3, '槽位 ' + SLOT + ' 的注册项只有 ' + SLOT_ROWS.length + ' 个？至少应有 focus/find/digest 三个');
  for (const r of SLOT_ROWS) {
    assert(r.id !== null, '槽位 ' + SLOT + ' 的注册项缺 id（list 槽位要求 id）：' + JSON.stringify(r));
  }
  const focusRow = SLOT_ROWS.filter((r) => r.id === 'history-actions-focus');
  eq(focusRow.length, 1, '槽位 ' + SLOT + ' 里应当恰好有一个 id = "history-actions-focus" 的注册项');
  const focusOrder = focusRow[0].order;
  const others = SLOT_ROWS.filter((r) => r.id !== 'history-actions-focus');
  assert(others.length > 0, '槽位 ' + SLOT + ' 里除「专注」之外没有别的条目？顺序断言无从谈起');
  assert(focusOrder > -50,
    '「专注」的 order = ' + focusOrder + ' 是个极端负值（要求不用负数极端值，-10 量级即可）');
  const sorted = SLOT_ROWS.slice().sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
  ok('槽位 ' + SLOT + ' 本插件注册项 order（升序）：' +
    sorted.map((r) => r.id + '=' + r.order + (r.declared ? '' : '（未写 ⇒ list 槽默认 0）')).join(' · '));

  /* ── 跨插件全表：槽位**共享**，所以「最前」必须对**所有**条目成立，不能只看本插件。
   * 表来源：app.asar 里每一个 client bundle 现读（只读），在槽位名之后的有界窗口里取紧跟着的
   * `id:` / `order:`（shipped bundle 是 minified，id 与 order 紧跟 name；窗口 60 字符）。
   * 这正是 AGENTS.md 的坑：曾用了不存在的变量 ⇒ 任何"凭记忆"都不算数，必须现读。 */
  const shippers = [
    ['open-in-app(@deepseek-ai/dsh-client-ui-open-in-app)', '@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js'],
    ['schedule-catalog(@deepseek-ai/dsh-client-ui-schedule)', '@deepseek-ai/dsh-client-ui-schedule/lib/client.js'],
    ['session-log-download(@deepseek-ai/dsh-session-log-export)', '@deepseek-ai/dsh-session-log-export/lib/client.js'],
  ];
  const SHIPPED_ROWS = [];
  if (asarHeader) {
    for (const [label, suffix] of shippers) {
      const buf = readAsarEntry('/dsh/node_modules/' + suffix);
      if (!buf) continue;
      const text = buf.toString('utf8');
      let i = 0, guard2 = 0;
      while (guard2++ < 50) {
        const at = text.indexOf(SLOT, i);
        if (at === -1) break;
        const win = text.slice(at + SLOT.length, at + SLOT.length + 60);
        const id = (/id:\s*"([^"]+)"/.exec(win) || [])[1] || (/id:\s*'([^']+)'/.exec(win) || [])[1];
        if (id !== undefined) {
          const orderRaw = (/order:\s*(-?\d+)/.exec(win) || [])[1];
          SHIPPED_ROWS.push({ id, order: orderRaw === undefined ? 0 : Number(orderRaw), declared: orderRaw !== undefined, src: label });
        }
        i = at + SLOT.length;
      }
    }
  }
  const FULL = SLOT_ROWS.map((r) => ({ id: r.id, order: r.order, declared: r.declared, src: '本插件' }))
    .concat(SHIPPED_ROWS.map((r) => ({ id: r.id, order: r.order, declared: r.declared, src: r.src })));
  if (asarHeader) {
    assert(SHIPPED_ROWS.length >= 3,
      'app.asar 在，却没从 shipped bundle 里解析出 ≥3 个槽位注册项（实际 ' + SHIPPED_ROWS.length + '）—— 表构建失败，顺序断言会假绿');
    assert(SHIPPED_ROWS.some((r) => r.id === 'open-in-app'),
      'shipped 表里没有 open-in-app —— 解析窗口取错了（它是该槽位 order 最小的条目）');
  }
  // ⚠️ 2026-10-16 这条不变量的**范围**收窄了，理由是一次真实的需求冲突：
  //   · 2026-10-13 用户要求「专注」排到那一行**最前面**（它的计时文字每秒变宽，放最右
  //     会把左边的按钮挤动）。
  //   · 2026-10-16 用户看真机截图后要求**终端按钮那一组排到官方【打开】前面**
  //     （`open-in-app` = -10）⇒ 该组必须 < -10 ⇒ 必然也排在「专注」(-12) 前面。
  //   两者不能同时成立。用户的原话优先，而 2026-10-13 那条要求的**真实目的**是
  //   "计时文字不要挤动**官方那几个**按钮" —— 那个目的与终端组无关（终端组自己带着竖线，
  //   而且它的宽度不随秒数变化）。所以断言改成：专注必须排在所有**非本插件**条目的前面。
  //   仍然会红的情形：有人把 focus 挪到 open-in-app 右边（那正是当年要修的现象）。
  const minShipped = Math.min.apply(null, FULL.filter((r) => r.id !== 'history-actions-focus' && r.src !== '本插件').map((r) => r.order));
  assert(focusOrder < minShipped,
    '「专注」的 order = ' + focusOrder + ' 不比**非本插件**条目的最小值 ' + minShipped +
    ' 小 ⇒ 它的计时文字会挤动官方按钮（用户 2026-10-13 的原话）');
  const fullSorted = FULL.slice().sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
  // 全表第一条现在是终端按钮组（-20）——那是 2026-10-16 用户明确要求的。
  eq(fullSorted[0].id, 'history-actions-terminal',
    '按 order 升序（同值按 id 稳定）排完第一条不是终端按钮组 ⇒ 用户要求"排在【打开】前面"没落实');
  ok((asarHeader ? '槽位 ' + SLOT + ' 跨插件 order 全表（app.asar 现读 + 本插件，升序）：'
    : '槽位 ' + SLOT + ' 只核到本插件（app.asar 读不到，跨插件表降级）：') +
    fullSorted.map((r) => r.id + '=' + r.order + (r.declared ? '' : '（未写 ⇒ 默认 0）')).join(' · '));
  ok('槽位 ' + SLOT + ' 「专注」order = ' + focusOrder + ' < **非本插件**条目最小值 ' + minShipped +
    ' ⇒ 它排在官方那几个按钮之前；计时文字每秒变宽时不会挤动它们。' +
    '（全表第一条现在是终端按钮组 ' + fullSorted[0].id + '=' + fullSorted[0].order +
    '，那是 2026-10-16 用户明确要求的"排在【打开】前面"）');
}

/* ② 计时样式：等宽数字 + min-width（按最宽形态估，宁可略宽也不要每 tick 变宽变窄） */
{
  const focusAt = codeOnly.indexOf('function FocusAction(');
  assert(focusAt !== -1, '源码里找不到 `function FocusAction(` —— 计时样式无从校验');
  const brace = codeOnly.indexOf('{', focusAt);
  const body = balancedBlock(codeOnly, brace);
  assert(body !== null && body.length > 200, 'FocusAction 函数体取不到（大括号不平衡？）');
  assert(/countdown/.test(body), 'FocusAction 函数体里找不到 countdown —— 取到的可能不是这个函数');
  // 样式必须给在**这个** label 上（两种合法写法都要能过）：① React 内联 style 对象（驼峰键）；
  // ② 该节点自己的 cssText 串（连字符键）。这里只做「有没有落在 label 上」的存在性前置，
  // 真正的内容断言在下面（两种写法都会被查）。
  const labelAt = body.indexOf('}, "label")');
  assert(labelAt !== -1, 'FocusAction 里找不到计时那个 label 子节点（`}, "label")`）—— 计时样式该加在它身上');
  const spanAt = body.lastIndexOf('react_jsx_runtime.jsx)("span", {', labelAt);
  assert(spanAt !== -1, 'label 子节点不是 `jsx("span", …)` 写法 —— 取不到样式对象');
  const spanObj = balancedBlock(body, body.indexOf('{', spanAt));
  assert(spanObj !== null, 'label 那个 span 的配置对象取不到（大括号不平衡？）');
  // 排版相关的量只应出现在这个 span 上：别处（按钮本身 headerActionStyle）动它会把整行都改样。
  const styleObj = spanObj;
  const styleText = spanObj;
  const flat = styleText.replace(/\s+/g, '');
  // 等宽数字：驼峰 `fontVariantNumeric` / 连字符 `font-variant-numeric` / `font-feature-settings:"tnum"`
  const monoHit = flat.match(/fontVariantNumeric:"?(tabular-nums)"?|font-variant-numeric:tabular-nums|fontFeatureSettings:"[^"]*tnum[^"]*"|fontFeatureSettings:'[^']*tnum[^']*'|font-feature-settings:[^;"]*tnum/);
  assert(monoHit !== null,
    '计时的 label 样式里没有等宽数字（`fontVariantNumeric: "tabular-nums"` / `font-variant-numeric:tabular-nums` / `font-feature-settings:"tnum"`）⇒ 数字宽度仍会每秒变，抖动没解决：' + styleText.slice(0, 240));
  assert(!/fontVariantNumeric:"normal"|font-variant-numeric:normal/.test(flat),
    '等宽数字被设成 `normal`，等于没开：' + styleText.slice(0, 240));
  const mw = (/minWidth:"([^"]+)"|minWidth:'([^']+)'/.exec(flat) || [])
    || (/min-width:([^;"]+)/.exec(styleText) || []);
  const mwVal = mw[1] !== undefined ? mw[1].trim() : (mw[2] !== undefined ? mw[2].trim() : undefined);
  assert(mwVal !== undefined, '计时的 label 样式里没有 `minWidth` / `min-width`（按最宽形态给一个固定最小宽）⇒ 锁定前后宽度会变：' + styleText.slice(0, 240));
  assert(/^\d+(?:\.\d+)?(?:px|em|rem|ch)$/.test(mwVal), 'minWidth 必须是带单位的长度（px/em/rem/ch），实际 ' + JSON.stringify(mwVal));
  if (/em$/.test(mwVal)) {
    assert(parseFloat(mwVal) >= 5,
      'minWidth = ' + mwVal + ' @13px 字号只有 ' + (parseFloat(mwVal) * 13).toFixed(0) + 'px，装不下「解除专注 12:34」⇒ 最长形态仍会溢出/抖动');
  } else if (/px$/.test(mwVal)) {
    assert(parseFloat(mwVal) >= 62, 'minWidth = ' + mwVal + ' 装不下「解除专注 12:34」（约 65px @13px）');
  }
  assert(parseFloat(mwVal) <= 160, 'minWidth = ' + mwVal + ' 太宽（标题栏是紧凑条，别为了防抖留一大片空）');
  // 反面：文案没被顺手改（用户明说「只改样式，不动文案」）
  assert(/focus\.headerLockShort/.test(spanObj) && /focus\.headerUnlockShort/.test(spanObj),
    '计时 label 的文案键被改了（要求只改样式、不动文案：仍是 focusHeaderLabel 那条路径）：' + styleText.slice(0, 240));
  assert(spanObj.indexOf('\u2705') === -1, '计时 label 里出现了 ✅（用户已确认要无 emoji）');
  ok('计时样式：label 上 minWidth=' + mwVal + ' + 等宽数字 ' + (monoHit[0] || monoHit[1] || 'tnum') +
    ' ⇒ 每个 tick 宽度不变，左侧按钮不被挤动（文案未动）');
}

/* ───────────────────────── 9. 留痕：改动清单（便于复查） ───────────────────────── */
for (const key of MUST_BE_REACHED) {
  console.log('  · ' + key + '  zh[' + zh.get(key).line + ']=' + JSON.stringify(zh.get(key).value) +
    '  en[' + en.get(key).line + ']=' + JSON.stringify(en.get(key).value));
}

console.log('');
console.log('PASS: every dictionary value (zh + en) is ✅-free, not just showNotice-reachable ones; zh/en key sets match; the bubble is CSS-centred at the top and never positioned from click coordinates');
