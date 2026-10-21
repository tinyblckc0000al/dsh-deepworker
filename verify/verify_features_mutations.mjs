#!/usr/bin/env node
/**
 * verify_features_mutations.mjs — 变异检验：证明 verify_features.mjs / verify_render.mjs 的
 * 功能开关断言**真的能红**，而不是靠同一条文本 grep 撑着。
 *
 * 每条变异都写在 `/tmp` 的副本上；**绝不**触碰线上 `lib/client.js`
 * （AGENTS.md：HMR 会发布被监视目录里的每一次写盘）。
 *
 * 任务点名的三条在这里各有一条：
 *   · 把一个开关的默认值改掉                        -> mutation ①/①b
 *   · 去掉某个门控                                  -> mutation ②③④⑤⑥⑦
 *   · 把文案改回与行为不符（"请求解锁"）             -> mutation ⑧
 *
 * ── 2026-10-16 第 3 段加固：为什么每一条都要重写锚点 ────────────────────────────────────
 * 设置页改成四 tab、开关语义从"关掉但保留入口"改成"**不引入 ⇒ 不注册**"之后，实测有 4 条
 * 变异**失配**成空操作或假绿（⑨⑩⑪ 空操作、⑨ 还一度切掉半份文件）：
 *   · 空操作 = 看起来在测、其实什么都没测 —— 比没有更糟；
 *   · 锚点写死空格/字面量（`variant: "secondary"`、`section: "common"`、"高级" 折叠区）会随
 *     改版静默失效。
 * 所以这一版做了三件事：
 *   ① **按元素边界程序化定位**：先用一个**唯一**的结构特征（函数定义、字面量块、调用点、
 *      key/子文本）找到目标，再在那一小段里改 —— 不再依赖缩进或整行字面量。
 *   ② **命中必须唯一**：`mustReplace` / `mustReplaceRe` 在 0 次或 >1 次匹配时**抛错**
 *      （`String.replace` 的静默不命中是这类套件最危险的失败模式）。
 *   ③ **改动幅度必须有界**：`maxChange` 断言这次变异只动了目标那一小块。这一条直接来自
 *      第 2 段踩到的真实事故：⑨ 按 `}),` 找收尾时一路找到文件后面，切掉半份文件 ⇒ 变异体
 *      语法错误，套件虽然红了，但红在"文件都解析不了"，不是在验行为。
 *
 * ── 2026-10-16 第 4 段（三条新批评）新增 ⑮⑯⑰⑱ ────────────────────────────────────────
 * 设置页这次的改动是"换控件 / 合并折叠 / 改文案"，三条都属于**结构或文案**，光看文本或数量
 * 抓不住（把 `smallButton` 改回手写 `<button>`，按钮的数量与可见文字**一个字都不变**）。
 * 所以新写了三层结构守卫，并各配一条变异证明它真的能红：
 *   · ⑮ `smallButton` 改回裸 `"button"`        -> 源码层（必须调 primitives.Button）
 *   · ⑯ 设置页混进一颗手写 `<button>`           -> 结构层（每颗按钮必须带官方原语的标记）
 *   · ⑰ 再插一个 summary 也叫「调试」的折叠      -> 结构层（整页**恰好一个**「调试」折叠）
 *   · ⑱ 存储位置文案改回"页面上的"              -> 文案层（必须指路到「笔记」页 + 逐字点名按钮）
 *
 * ── 2026-10-16 第 5 段（二次分组：三处搬家）新增 ⑲⑳㉑㉒㉓ ────────────────────────────────
 * 用户看真机截图后指出两处错位（「引用回复」住在会话内容里；「编辑重发/重试时默认归档原
 * 对话」挂在「引用」小标题底下）+ 一处搬家（「存储位置」基础 → 笔记）。这次改的是**位置**，
 * 而"这串字在页面上出现过"在搬家**前**与**后**都成立 ⇒ 那种断言对搬家完全无感（假绿）。
 * 所以 verify_render.mjs 里新写的分组断言全部按**面板边界 + 小节边界**定位，并各配一条
 * "搬回去"的变异证明它真的能红：
 *   · ⑲ 「归档原对话」搬回「引用」小节          -> 必须断在轮次操作小节的区间内
 *   · ⑳ 「引用回复」整节搬回「笔记」面板        -> 必须断在会话操作面板内
 *   · ㉑ 「存储位置」整节搬回「基础」面板        -> 不许留在基础面板 + 全页恰好一份
 *   · ㉒ `FEATURE_META.featureQuote.tab` 与 JSX 脱钩 -> 面板级与小节级灰态必须指同一档
 *   · ㉓ 面板 value 没跟着 tab 改名（notes→content） -> 派生的 id 必须整体跟过去
 * ⚠️ ⑲⑳㉑ 是**整块搬家**：diffSpan 的跨度 = 2 ×（摘除点与插入点之间的距离），所以这三条的
 * `maxChange` 按实测距离定（921 / 3406 / 13066），仍远小于 449,794 字节的 bundle ——
 * 它们挡的是"定位器跑偏、切掉半个文件"，不是"允许大改动"。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const FEATURES = path.join(HERE, 'verify_features.mjs');
const RENDER = path.join(HERE, 'verify_render.mjs');
const SOURCE = fs.readFileSync(LIVE, 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-features-mut-'));

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };

// ── 定位器：命中必须唯一，否则抛错（绝不静默变成空操作）──────────────────────────────
/** 把 `needle` 替换成 `replacement`，要求**恰好一次**命中。 */
function mustReplace(s, needle, replacement, what) {
  const n = s.split(needle).length - 1;
  if (n !== 1) throw new Error('anchor "' + what + '" occurs ' + n + ' time(s), expected exactly 1');
  return s.replace(needle, replacement);
}
/** 把正则的**唯一**匹配替换掉；0 次或多次都抛错。 */
function mustReplaceRe(s, re, replacement, what) {
  const all = s.match(new RegExp(re.source, 'g'));
  if (all === null || all.length !== 1) throw new Error('anchor "' + what + '" matched ' + (all === null ? 0 : all.length) + ' time(s), expected exactly 1');
  return s.replace(re, replacement);
}
/**
 * 一个 `var NAME = { … }` 对象字面量的源码切片。
 * ⚠️ 只在**值是布尔/数字**的字面量上用它（本文件只用于 SETTING_DEFAULTS）：花括号是按字符
 * 数配平的，字符串里带不平衡花括号的内容会骗过它。
 */
function objectLiteral(s, signature) {
  const at = s.indexOf(signature);
  if (at < 0) throw new Error('element not found: ' + signature);
  if (s.indexOf(signature, at + 1) !== -1) throw new Error('element signature is ambiguous: ' + signature);
  const open = s.indexOf('{', at + signature.length - 1);
  if (open < 0) throw new Error('element has no brace: ' + signature);
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start: at, end: i + 1, text: s.slice(at, i + 1) }; }
  }
  throw new Error('unbalanced literal: ' + signature);
}
/**
 * 一个 `var NAME = { … };` 词典块的切片，用与 verify_i18n.mjs **同一条**边界规则
 * （`\n    };` 收尾）—— 不按花括号配平，因为词典里有 `"{index}. {prompt}"` 这类占位符。
 */
function dictBlock(s, name) {
  const start = s.indexOf('    var ' + name + ' = {');
  if (start < 0) throw new Error('dictionary not found: ' + name);
  const end = s.indexOf('\n    };', start);
  if (end < 0) throw new Error('dictionary end not found: ' + name);
  return { start, end: end + '\n    };'.length, text: s.slice(start, end + '\n    };'.length) };
}
/** 用 `{start, end, text}` 替换 s 里的这一段。 */
function spliceBlock(s, block, replacementText) {
  return s.slice(0, block.start) + replacementText + s.slice(block.end);
}
/** 第一处与最后一处差异之间的跨度（用来断言"只动了目标那一小块"）。 */
function diffSpan(a, b) {
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { start, removed: endA - start, added: endB - start, span: (endB - start) + (endA - start) };
}

/**
 * Each mutation declares the suite it must be caught by and a required substring in the
 * failure output, so "caught for the wrong reason" cannot pass as caught.
 *
 * 每条还声明 `maxChange`：这次变异允许改动的最大字节数（改动跨度超过它 ⇒ 定位器跑偏了，
 * 直接判失败，而不是让一个"把半个文件切掉"的变异体去把套件搞红）。
 */
const MUTATIONS = [
  {
    name: '① 开关默认值被改掉（featureNotice: true -> false）',
    suite: FEATURES,
    maxChange: 64,
    apply: (s) => {
      const block = objectLiteral(s, 'var SETTING_DEFAULTS = {');
      return spliceBlock(s, block, mustReplace(block.text, 'featureNotice: true,', 'featureNotice: false,', 'SETTING_DEFAULTS.featureNotice'));
    },
    expect: /featureNotice defaults to true/
  },
  {
    name: '①b 开关默认值被改掉（featureFocusLock: true -> false）',
    suite: FEATURES,
    maxChange: 64,
    apply: (s) => {
      const block = objectLiteral(s, 'var SETTING_DEFAULTS = {');
      return spliceBlock(s, block, mustReplace(block.text, 'featureFocusLock: true,', 'featureFocusLock: false,', 'SETTING_DEFAULTS.featureFocusLock'));
    },
    expect: /featureFocusLock defaults to true/
  },
  {
    name: '② 去掉「通知与气泡」门控（showNotice 不再读开关）',
    suite: FEATURES,
    maxChange: 160,
    apply: (s) => mustReplaceRe(
      s,
      // 门控由三个 token 唯一确定：featureNotice + opts.always + systemOnly。不依赖空格。
      /if \(!featureEnabled\("featureNotice"\)[^\n]*opts\.always[^\n]*systemOnly[^\n]*\) \{/,
      'if (false && !(opts && opts.always === true) && systemOnly !== true) {',
      'showNotice 的 featureNotice 门控'),
    expect: /with the switch OFF the same notice draws nothing/
  },
  {
    name: '③ 去掉专注锁门控（focusWrapDecide 不再读开关）',
    suite: FEATURES,
    maxChange: 120,
    apply: (s) => mustReplace(
      s,
      'if (!featureEnabled("featureFocusLock")) return { allow: true, reason: "feature-off" };',
      'if (false) return { allow: true, reason: "feature-off" };',
      'focusWrapDecide 的 featureFocusLock 门控'),
    expect: /reason says feature-off|must allow every switch/
  },
  {
    name: '④ 去掉"自己的错误"豁免（关掉通知 ⇒ 连报警器一起关）',
    suite: FEATURES,
    maxChange: 200,
    apply: (s) => mustReplaceRe(
      s,
      /if \(!featureEnabled\("featureNotice"\)[^\n]*opts\.always[^\n]*systemOnly[^\n]*\) \{/,
      'if (!featureEnabled("featureNotice")) {',
      'showNotice 的 featureNotice 门控（整条豁免一起删）'),
    expect: /opts\.always|systemOnly/
  },
  {
    name: '⑤ 关掉专注锁时不再撤销拦截器（featureFocusLockOff 空转）',
    suite: FEATURES,
    maxChange: 120,
    apply: (s) => mustReplaceRe(
      s,
      /try \{ ok = focusWrapUnwrapAll\(\) !== false; \} catch \(e\) \{ ok = false; \}/,
      'try { ok = true; } catch (e) { ok = false; }',
      'featureFocusLockOff 里的 focusWrapUnwrapAll'),
    expect: /unwrapped|WRAPPED|wrapped=0/
  },
  {
    name: '⑥ 命令不再看开关（declareIf 里不读 featureEnabled）',
    // 2026-10-16：语义从"注册了但 resolve 返回 unhandled"改成"**不引入 ⇒ 不注册**"，
    // 所以门控点从 `declare` 的 resolve 内搬到了 `declareIf` 的入口。旧锚点因此变成空操作。
    suite: FEATURES,
    maxChange: 64,
    apply: (s) => {
      const sig = 'var declareIf = function (featureKey,';
      const fn = s.indexOf(sig);
      if (fn < 0) throw new Error('anchor missing: the declareIf definition');
      if (s.indexOf(sig, fn + 1) !== -1) throw new Error('anchor ambiguous: more than one declareIf definition');
      const gate = 'if (!featureEnabled(featureKey)) return;';
      const at = s.indexOf(gate, fn);
      if (at < 0) throw new Error('anchor missing: the declareIf feature gate');
      // 结构断言：这个门必须是 declareIf 的**第一件事**，在它调用 declare 之前。
      const call = s.indexOf('declare(id, label, aliases, run, defaults);', fn);
      if (call < 0 || at > call) throw new Error('anchor misplaced: the declareIf gate is not before its declare() call');
      return s.slice(0, at) + 'if (false) return;' + s.slice(at + gate.length);
    },
    expect: /must register ZERO contributions|NOT INTRODUCED/
  },
  {
    name: '⑧ 文案改回与行为不符（立即解锁 -> 请求解锁）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      // 断言改的是**中文**词典那一块（英文块里不该有这四个字），而不是"文件里随便一处"。
      const block = dictBlock(s, 'zh');
      if (!block.text.includes('"focus.unlockSession": "立即解锁",')) throw new Error('anchor missing: zh focus.unlockSession');
      return spliceBlock(s, block, mustReplace(block.text, '"focus.unlockSession": "立即解锁",', '"focus.unlockSession": "请求解锁",', 'zh focus.unlockSession'));
    },
    expect: /请求解锁/
  },
  {
    name: '⑩ 折叠区默认态被改（调试 从默认收起变成默认展开）',
    // 2026-10-16 四 tab 改版：旧锚点是「高级」折叠区 —— 那一节**已经不存在了**（低频设置
    // 分别搬进三个功能 tab），所以旧锚点会变成**空操作**。现存的**唯一**折叠区是「调试」，
    // 所以这条回归守卫跟着搬到它身上：把默认收起改成默认展开，套件必须红。
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      const marker = 't("settings.section.debug")';
      const at = s.indexOf(marker);
      if (at < 0) throw new Error('anchor missing: settings.section.debug');
      if (s.indexOf(marker, at + 1) !== -1) throw new Error('anchor ambiguous: more than one settings.section.debug');
      const open = s.lastIndexOf('settingsSection(', at);
      if (open < 0) throw new Error('anchor missing: the settingsSection call that owns 调试');
      // 只在那次 `settingsSection(...)` 调用的**自己那一小段**里改第 4 个实参。
      const region = s.slice(open, at + marker.length + 200);
      const flipped = mustReplace(region, ', null, false,', ', null, true,', 'settingsSection(调试) 的 openByDefault 实参');
      return s.slice(0, open) + flipped + s.slice(open + region.length);
    },
    expect: /the 调试 section must be default-collapsed/
  },
  {
    name: '⑪ 功能开关一档从界面消失（引用 不再列出，总数也随之少一个）',
    // 2026-10-16（两轮）：清单从设置页组件里的字面量数组搬到了工厂作用域的 `FEATURE_KEYS`
    // 常量（`FEATURE_META` 提供文案键），锚点跟着搬到那条常量上 —— 删掉 "featureQuote"
    // 就是"这一档不再出现在界面里"，语义一字不变。
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      const sig = 'var FEATURE_KEYS = [';
      const start = s.indexOf(sig);
      if (start < 0) throw new Error('anchor missing: FEATURE_KEYS');
      const end = s.indexOf('];', start);
      if (end < 0) throw new Error('anchor missing: the FEATURE_KEYS close');
      const arr = s.slice(start, end);
      return s.slice(0, start) + mustReplace(arr, '"featureQuote", ', '', 'FEATURE_KEYS 的 featureQuote 项') + s.slice(end);
    },
    // 2026-10-16: 开关总数由 13 改成 12（底部重复块删掉了它的第二份诊断开关）。
    // 2026-10-16 四 tab 改版：控件换成 `Switch`，计数断言的措辞跟着变成 "Switch rows"。
    // 2026-10-16 第 4 轮：新增「全部功能」总开关 ⇒ 13（12 + 1）。
    // ⚠️ 2026-10-16 加第 8 档后，这个变异会先撞上另一条同样正确的断言：
    //    「FEATURE_META must declare one tab per FEATURE_KEY」——删掉一个 FEATURE_KEY 会让
    //    FEATURE_META 比它多一项。两条都是"这一档从界面消失"的合法受害者，所以 expect 同时
    //    接受三种措辞（原来是 must name 引用 / expected exactly 13 …）。
    expect: /must name 引用|must declare one tab per FEATURE_KEY|expected exactly \d+ (Switch rows|switches)/
  },
  {
    name: '⑫ 开关的 checked 表达式改读别的键（row(...) 调用点一字不动）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => mustReplaceRe(
      s,
      /: \(key === "focusNativeNotice" \? state\[0\]\[key\] !== false : state\[0\]\[key\] === true\);/,
      ': (key === "focusNativeNotice" ? state[0][key] !== false : state[0]["retryNote"] === true);',
      'row() 的 checked 表达式'),
    expect: /flipping exactly two settings|checked|勾选/
  },
  // ── 2026-10-16 打磨新增的两条批评，各配一条变异：证明那两条回归守卫真的能红 ──────────
  {
    name: '⑬ 全开徽章颜色改回 state-error 红（第 2 条批评被回滚）',
    suite: RENDER,
    maxChange: 200,
    apply: (s) => mustReplaceRe(
      s,
      /color: offNow\.length === 0 \? "var\(--dsw-alias-label-tertiary\)" : "var\(--dsw-alias-state-error-primary\)",/,
      'color: "var(--dsw-alias-state-error-primary)",',
      '全部已引入那行徽章的三元'),
    expect: /all-on badge must not be red/
  },
  {
    name: '⑬b 徽章颜色恒为中性灰（三元不再分流 ⇒ 关掉一档也不报警）',
    suite: RENDER,
    maxChange: 200,
    apply: (s) => mustReplaceRe(
      s,
      /color: offNow\.length === 0 \? "var\(--dsw-alias-label-tertiary\)" : "var\(--dsw-alias-state-error-primary\)",/,
      'color: "var(--dsw-alias-label-tertiary)",',
      '全部已引入那行徽章的三元'),
    expect: /with a feature actually off the badge MUST be red/
  },
  {
    name: '⑭ 「刷新状态」被挪回「专注锁」（第 4 条批评被回滚：调试动作混进锁操作）',
    suite: RENDER,
    maxChange: 640,
    apply: (s) => {
      // 2026-10-16 四 tab 改版：旧的锚点写死了缩进与结构（`}, "focus-unlock")\n … ] }),`），
      // 改版后**逐字失配** ⇒ 静默变成空操作。改成按**元素边界**程序化定位：
      // 锁/解锁那一排按钮的 key `"focus-unlock")` 之后、那个 children 数组的收尾 `] })`
      // 之前，插进第二份「刷新状态」—— 正是打磨时删掉的形状（读起来像第三种锁操作）。
      const key = '"focus-unlock")';
      const at = s.indexOf(key);
      if (at < 0) throw new Error('refresh-relocation anchor missing: the focus-unlock key');
      if (s.indexOf(key, at + 1) !== -1) throw new Error('refresh-relocation anchor is ambiguous: more than one focus-unlock key');
      const close = s.indexOf('] })', at);
      if (close < 0) throw new Error('refresh-relocation anchor missing: the lock/unlock children close');
      const extra = ',\n'
        + '                    (0, react_jsx_runtime.jsx)("button", { type: "button", style: { fontSize: "12px", padding: "4px 10px", cursor: "pointer" }, onClick: function () { setFocus(typeof readFocus === "function" ? readFocus() : null); }, children: t("focus.refresh") }, "focus-refresh-common")\n'
        + '                  ';
      return s.slice(0, close) + extra + s.slice(close);
    },
    expect: /must live in the 调试 section|exactly ONE 刷新状态/
  },
  // ── 2026-10-16 第 4 段：三条新批评各配一条变异，外加"以后又混进手写按钮"的同类形状 ──────
  {
    name: '⑮ 设置页次要按钮改回手写 <button>（第 1 条批评"按钮好丑"被回滚）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      // 按**元素边界**定位：`smallButton` 的函数体（从它的定义到它自己那一行的收尾 `\n        }`），
      // 在那一段里把官方原语换成裸字符串 `"button"`。不依赖缩进以外的任何字面量。
      const sig = 'function smallButton(';
      const at = s.indexOf(sig);
      if (at < 0) throw new Error('smallButton anchor missing: the helper definition');
      if (s.indexOf(sig, at + 1) !== -1) throw new Error('smallButton anchor is ambiguous: more than one definition');
      const end = s.indexOf('\n        }', at);
      if (end < 0) throw new Error('smallButton anchor missing: the function close');
      const body = s.slice(at, end);
      if (!body.includes('primitives.Button')) throw new Error('smallButton precondition failed: it does not render primitives.Button');
      return s.slice(0, at) + mustReplace(body, 'primitives.Button', '"button"', 'smallButton 的官方 Button') + s.slice(end);
    },
    expect: /must render the official primitives\.Button/
  },
  {
    name: '⑯ 设置页混进一颗手写 <button>（第 1 条批评的同类形状）',
    suite: RENDER,
    maxChange: 300,
    apply: (s) => {
      // 只加一颗手写按钮，`smallButton` 一个字不动 ⇒ 源码层守卫（它只看 smallButton）是绿的，
      // 这一条只能靠**结构层**守卫抓住：渲染出来的 HTML 里每一颗非 switch / 非 tab 按钮
      // 都必须带官方 `Button` 桩打的 `data-prim="Button"`。
      const marker = 'settingsSection(t("settings.section.debug")';
      const at = s.indexOf(marker);
      if (at < 0) throw new Error('raw-button anchor missing: the 调试 settingsSection call');
      if (s.indexOf(marker, at + 1) !== -1) throw new Error('raw-button anchor is ambiguous: more than one 调试 settingsSection call');
      const extra = '(0, react_jsx_runtime.jsx)("button", { type: "button", onClick: function () {}, children: t("settings.shortcutNone") }, "raw-extra"),\n                ';
      return s.slice(0, at) + extra + s.slice(at);
    },
    expect: /NOT rendered by the official Button primitive/
  },
  {
    name: '⑰ 两个「调试」折叠复活（第 2 条批评"怎么有两个调试"被回滚）',
    suite: RENDER,
    maxChange: 200,
    apply: (s) => {
      // 在外层那一个之前再插一个 summary 也叫「调试」的折叠 —— 正是用户看到的形状
      // （外层 `settings.section.debug` + 内层 `focus.debug`，中文同名）。
      const marker = 'settingsSection(t("settings.section.debug")';
      const at = s.indexOf(marker);
      if (at < 0) throw new Error('second-fold anchor missing: the 调试 settingsSection call');
      if (s.indexOf(marker, at + 1) !== -1) throw new Error('second-fold anchor is ambiguous: more than one 调试 settingsSection call');
      const extra = 'settingsSection("调试", null, null, false, null),\n                ';
      return s.slice(0, at) + extra + s.slice(at);
    },
    expect: /EXACTLY ONE 调试/
  },
  {
    name: '⑱ 存储位置文案改回"页面上的"（第 3 条批评"导出在哪"被回滚）',
    suite: RENDER,
    maxChange: 400,
    apply: (s) => {
      // 断言改的是**中文**词典那一块，而不是"文件里随便一处"。
      const block = dictBlock(s, 'zh');
      const key = '"settings.storage": "';
      const at = block.text.indexOf(key);
      if (at < 0) throw new Error('storage-note anchor missing: zh settings.storage');
      if (block.text.indexOf(key, at + 1) !== -1) throw new Error('storage-note anchor is ambiguous: more than one zh settings.storage');
      const valueStart = at + key.length;
      const valueEnd = block.text.indexOf('",', valueStart);
      if (valueEnd < 0) throw new Error('storage-note anchor missing: the end of the zh settings.storage value');
      const legacy = '笔记存储位置：浏览器本地（localStorage）—— 设备间迁移请用页面上的「复制全部 / 导入」。';
      const patched = block.text.slice(0, valueStart) + legacy + block.text.slice(valueEnd);
      return spliceBlock(s, block, patched);
    },
    expect: /must not say 页面上的/
  },
  // ── 2026-10-16 二次分组：三处搬家各配一条"搬回去"的变异（外加两条"改名只改一半"）─────
  //    为什么必须补：搬家这类改动的失败模式是"搬了一半 / 搬回去 / 两边各留一份"，而
  //    「这串字在页面上出现过」在搬家**前**与**后**都成立 ⇒ 不配变异的搬家断言是假绿。
  //    每条都按**元素边界**定位（调用签名 / 那一行的行首行尾 / 块自己的 `})),` 收尾），
  //    不依赖缩进以外的任何字面量；`maxChange` 按"整块搬走"的跨度放宽但仍远小于文件。
  {
    name: '⑲ 「归档原对话」搬回「引用」小节（被指出的错位被回滚）',
    suite: RENDER,
    maxChange: 1200,
    apply: (s) => {
      // 先在轮次操作小节里把这一行连行尾一起摘掉，再插到「引用」小节里 quoteProvenance
      // 那一行之后 —— 正是用户截图里看到的形状（挂在「引用」小标题底下）。
      const row = 'row("archiveOriginal", t("settings.archiveOriginal"))';
      const at = s.indexOf(row);
      if (at < 0) throw new Error('archive-row anchor missing');
      if (s.indexOf(row, at + 1) !== -1) throw new Error('archive-row anchor is ambiguous');
      const lineStart = s.lastIndexOf('\n', at) + 1;
      const lineEnd = s.indexOf('\n', at) + 1;
      const line = s.slice(lineStart, lineEnd);
      const out = s.slice(0, lineStart) + s.slice(lineEnd);
      const host = 'row("quoteProvenance", t("settings.quoteProvenance"))';
      const hostAt = out.indexOf(host);
      if (hostAt < 0) throw new Error('quote-row anchor missing after the removal');
      const hostEnd = out.indexOf('\n', hostAt);
      return out.slice(0, hostEnd) + ',\n' + line.slice(0, -1) + out.slice(hostEnd);
    },
    expect: /must sit INSIDE the 轮次操作 section/
  },
  {
    name: '⑳ 「引用回复」整节搬回「笔记」tab（第 1 处错位被回滚）',
    suite: RENDER,
    maxChange: 4200,
    apply: (s) => {
      // 整块 `featureSection("featureQuote", …)` 从会话操作面板搬回笔记面板 —— 正是
      // 用户截图里"引用回复住在会话内容里"的形状。
      const sig = 'featureSection("featureQuote", ';
      const at = s.indexOf(sig);
      if (at < 0) throw new Error('quote-section anchor missing');
      if (s.indexOf(sig, at + 1) !== -1) throw new Error('quote-section anchor is ambiguous');
      const close = s.indexOf('})),', at);
      if (close < 0) throw new Error('quote-section anchor missing: its close');
      const lineStart = s.lastIndexOf('\n', at) + 1;
      const blockEnd = s.indexOf('\n', close) + 1;
      const block = s.slice(lineStart, blockEnd);
      const out = s.slice(0, lineStart) + s.slice(blockEnd);
      const host = '                // 存储位置（小字）';
      const hostAt = out.indexOf(host);
      if (hostAt < 0) throw new Error('notes-panel insertion anchor missing');
      return out.slice(0, hostAt) + block + out.slice(hostAt);
    },
    expect: /must live in the 会话操作 panel/
  },
  {
    name: '㉑ 「存储位置」整节搬回「基础」tab（第 3 处搬家被回滚）',
    suite: RENDER,
    // 实测 16040（2026-10-17：第 2 段的三处界面改动在基础 / 笔记两页各加了注释，"
    // 摘除点 ↔ 插入点"的距离又长了一点）。预算挡的是"定位器跑偏、切掉半个文件"，不是
    // "允许大改动" —— 20 KB 相对 541 KB 的 bundle 仍然是同量级的紧预算；跑偏会是几十万字节。
    maxChange: 30000,
    apply: (s) => {
      // 注释 + div 整节从笔记面板摘出来，塞回基础面板底部「调试」折叠之前。
      const sig = '                // 存储位置（小字）';
      const at = s.indexOf(sig);
      if (at < 0) throw new Error('storage-section anchor missing');
      if (s.indexOf(sig, at + 1) !== -1) throw new Error('storage-section anchor is ambiguous');
      const marker = 'sectionHeading(t("settings.section.storage"))';
      const markerAt = s.indexOf(marker, at);
      if (markerAt < 0) throw new Error('storage-section anchor missing: its heading');
      const closer = '\n                })';
      const close = s.indexOf(closer, markerAt);
      if (close < 0) throw new Error('storage-section anchor missing: its close');
      const block = s.slice(at, close + closer.length);
      const comma = s.lastIndexOf(',\n', at);
      if (comma < 0) throw new Error('storage-section anchor missing: the separator before it');
      const out = s.slice(0, comma) + s.slice(at + block.length);
      const host = '                // ④ 调试（默认收起）\n';
      const hostAt = out.indexOf(host);
      if (hostAt < 0) throw new Error('basic-panel insertion anchor missing');
      return out.slice(0, hostAt) + block + ',\n' + out.slice(hostAt);
    },
    expect: /must NOT stay on 基础/
  },
  {
    name: '㉒ FEATURE_META 与 JSX 脱钩（featureQuote.tab 说 notes，实际画在会话操作）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      const line = 'featureQuote: { name: "feature.nameQuote", desc: "feature.descQuote", tab: "actions" },';
      const at = s.indexOf(line);
      if (at < 0) throw new Error('FEATURE_META.featureQuote anchor missing');
      if (s.indexOf(line, at + 1) !== -1) throw new Error('FEATURE_META.featureQuote anchor is ambiguous');
      return s.slice(0, at) + line.replace('tab: "actions"', 'tab: "notes"') + s.slice(at + line.length);
    },
    expect: /says tab="notes" in FEATURE_META/
  },
  {
    name: '㉓ 面板 value 没跟着 tab 改名（settingsPanel("notes") 退回 "content"）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      const sig = 'settingsPanel("notes", ';
      const at = s.indexOf(sig);
      if (at < 0) throw new Error('notes-panel anchor missing');
      if (s.indexOf(sig, at + 1) !== -1) throw new Error('notes-panel anchor is ambiguous');
      return s.slice(0, at) + 'settingsPanel("content", ' + s.slice(at + sig.length);
    },
    expect: /old tab value content is still in the DOM/
  },
  // ── 2026-10-16 锁死事故（第 6 段）：四条新变异 ──────────────────────────────────────────
  // 真机事故：功能全关之后「基础」页整页点不动（`pointerEvents:"none"`），而那一页是**唯一**
  // 装着恢复路径的地方 ⇒ 用户被锁死。修法是"恢复页永不整块禁用" + "灰态提示只说一次未引入"。
  // 这四条分别把两个修复各自回退成原状，证明新断言真的能红 —— 不是文本 grep。
  //   · ㉔ 把"恢复页豁免"删掉（回到 `tabAllOff` 自动判定）—— 全关 ⇒ 整页灰 ⇒ 必须红
  //        （2026-10-17：豁免从单值 `RECOVERY_TAB` 变成集合 `NO_PANEL_GREY_TABS`，锚点跟着换）
  //   · ㉕ 只禁用「引入 / 移除」那张卡片（不禁用整页）—— 开关与内联重载被关在灰态里 ⇒ 必须红
  //   · ㉖ 把重复文案改回来（正文又带上「未引入：」）⇒ 必须红
  //   · ㉗ 顶部主重载在"有未引入项"时 disabled ⇒ 必须红
  // ⚠️ 前两条与最后一条都属于"页面看起来没变、只是点不动"这一类：HTML 里文字一个字不少，
  //    纯文本断言全会绿。所以它们只能由**渲染 + 祖先链**判据抓住。
  {
    name: '㉔ 「基础」面板的整块禁用被改回来（NO_PANEL_GREY_TABS 豁免被删）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => mustReplace(
      s,
      'var allOff = tabAllOff(value) && NO_PANEL_GREY_TABS.indexOf(value) === -1;',
      'var allOff = tabAllOff(value);',
      'settingsPanel 的 NO_PANEL_GREY_TABS 豁免'),
    expect: /LOCKOUT/
  },
  {
    name: '㉕ 只禁用「引入 / 移除」卡片（整页不灰，但那 7 个开关与内联重载全被关在灰态里）',
    suite: RENDER,
    maxChange: 128,
    apply: (s) => mustReplace(
      s,
      '                // ② 功能引入 / 移除 —— 本页的视觉主体：卡片 + 15px 标题 + 每行灰字说明。\n                (0, react_jsx_runtime.jsxs)("div", {\n                  style: {',
      '                // ② 功能引入 / 移除 —— 本页的视觉主体：卡片 + 15px 标题 + 每行灰字说明。\n                (0, react_jsx_runtime.jsxs)("div", {\n                  "aria-disabled": "true",\n                  style: {',
      '功能引入 / 移除 卡片'),
    expect: /LOCKOUT/
  },
  {
    name: '㉖ 重复文案被改回来（正文又带上「未引入：」，前缀与正文各说一次）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => {
      // 只改**中文词典**里那一条正文，正是真机上看到的那一行
      // （`未引入 · 未引入：重试 / 在此分支 / …都不注册。`）。
      const block = dictBlock(s, 'zh');
      return spliceBlock(s, block, mustReplace(
        block.text,
        '"feature.hintTurnActionsOff": "重试 / 在此分支 / 编辑重发 / 选模式新建的入口与命令都不注册。",',
        '"feature.hintTurnActionsOff": "未引入：重试 / 在此分支 / 编辑重发 / 选模式新建的入口与命令都不注册。",',
        'zh feature.hintTurnActionsOff 正文'));
    },
    expect: /repeats the word/
  },
  {
    name: '㉘ 一键全关不再先解锁（整步被删 ⇒ 功能关了、人还被锁在里面）',
    suite: FEATURES,
    maxChange: 200,
    apply: (s) => mustReplace(
      s,
      '        var needsUnlock = list.indexOf("featureFocusLock") !== -1;',
      '        var needsUnlock = false;',
      'featureOffTransaction 的 needsUnlock 判据'),
    expect: /must have released it/
  },
  {
    name: '㉙ 解锁失败仍然继续关（解锁失败闸门被短路）',
    suite: FEATURES,
    maxChange: 64,
    apply: (s) => mustReplace(
      s,
      '          rel = focusReleaseAllLocks();\n          if (rel.ok !== true) {',
      '          rel = focusReleaseAllLocks();\n          if (false && rel.ok !== true) {',
      'featureOffTransaction 的解锁失败闸门'),
    expect: /must write NOTHING/
  },
  {
    // ⚠️ **单点**改动的“顺序反过来”：在解锁那一步**之前**先把设置写一遍。
    //    这样存储调用序就变成 setItem → removeItem → setItem ⇒“清锁必须先于写设置”
    //    这条断言必红。用**单点**改动（而不是把两块对调）是因为 `diffSpan` 量的是
    //    **首末差异之间的距离** —— 两处分散的改动会把中间整段都算进预算，
    //    那就不再是“只动了目标那一小块”了。
    name: '㉚ 顺序反过来（解锁之前先把设置写进去）',
    suite: FEATURES,
    maxChange: 200,
    apply: (s) => mustReplace(
      s,
      '        if (needsUnlock) {\n          rel = focusReleaseAllLocks();',
      '        if (needsUnlock) {\n          var pre = readSettings(); for (var jp = 0; jp < list.length; jp++) pre[list[jp]] = false; writeSettings(pre);\n          rel = focusReleaseAllLocks();',
      'featureOffTransaction：解锁之前先写设置的顺序反转'),
    expect: /must UNLOCK FIRST/
  },
  {
    name: '㉛ 只解锁会话级、漏掉工作区级（FOCUS_LOCK_KINDS 少一档）',
    suite: FEATURES,
    maxChange: 24,
    apply: (s) => mustReplace(
      s,
      'var FOCUS_LOCK_KINDS = ["session", "workspace"];',
      'var FOCUS_LOCK_KINDS = ["session"];',
      'FOCUS_LOCK_KINDS 的粒度清单'),
    expect: /must have released the WORKSPACE-granularity lock too/
  },
  {
    // ⚠️ 这条是**整块搬家**：把总开关那一行（含它的「需重载」提示）从卡片顶部搬到 7 档之后。
    //    diffSpan 的跨度 = 2 ×（摘除点与插入点之间的距离）量级，所以 maxChange 按实测定
    //    （与 ⑲⑳㉑ 同一族）。2026-10-17 实测 3281（行清单加了 SWITCH_HOME 过滤、那一行
    //    的提示从按钮换成文字，跨度略长）⇒ 预算放到 3600。它挡的是"定位器跑偏、切掉半个文件"。
    name: '㉜ 「全部功能」总开关从卡片顶部搬走（挪到 7 档之后）',
    suite: RENDER,
    maxChange: 3600,
    apply: (s) => {
      const rowMark = '                    row("__all__", t("settings.masterSwitch"), function () {';
      const at = s.indexOf(rowMark);
      if (at < 0) throw new Error('anchor missing: the master row');
      if (s.indexOf(rowMark, at + 1) !== -1) throw new Error('anchor ambiguous: more than one master row');
      const endMark = '                    // 「全部功能都已引入」是**配置读数**、不是系统健康状况 ⇒ 中性灰（label-tertiary）。';
      const end = s.indexOf(endMark, at);
      if (end < 0) throw new Error('anchor missing: the master inline reload');
      const block = s.slice(at, end + endMark.length);
      let out = s.slice(0, at) + s.slice(end + endMark.length);
      const listMark = '(0, react_jsx_runtime.jsx)("div", { children: FEATURES.filter(function (f) { return SWITCH_HOME[f.key] === undefined; }).map(function (f) { return featureRow(f); }) })';
      const listAt = out.indexOf(listMark);
      if (listAt < 0) throw new Error('anchor missing: the FEATURES.map row list');
      const insertAt = listAt + listMark.length;
      return out.slice(0, insertAt) + ',\n' + block.replace(/\s+$/, '') + out.slice(insertAt);
    },
    expect: /must sit at the TOP of the 功能引入\/移除 card/
  },
  {
    name: '㉞ 按钮③「清除范围设置」的回执丢掉 always:true（通知关掉后它又变哑巴）',
    suite: FEATURES,
    maxChange: 64,
    apply: (s) => mustReplace(
      s,
      'showNotice(t("notice.cleared"), { clientX: 24, clientY: 80 }, { always: true });',
      'showNotice(t("notice.cleared"), { clientX: 24, clientY: 80 });',
      '清除范围设置的回执'),
    expect: /receipt family must carry|must STILL speak/
  },
  {
    name: '㉟ 「没有当前会话」的原因回执丢掉 always:true（点了按钮、没做成、还不说话）',
    suite: FEATURES,
    maxChange: 64,
    apply: (s) => mustReplace(
      s,
      'showNotice(t("notice.noSession"), { clientX: 24, clientY: 80 }, { always: true });',
      'showNotice(t("notice.noSession"), { clientX: 24, clientY: 80 });',
      'scopeIdOrComplain 的 notice.noSession'),
    expect: /receipt family must carry|must STILL be shown/
  },
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ── 2026-10-17 第 2 段（三处界面改动）的六条变异 ──────────────────────────────────────────
  //   每一条把**一处**改动回退成旧形状，证明对应的新断言真的会红：
  //     ① 内联重载按钮被加回来（用户要求"保留最上面的重载按钮就行了"）
  //     ② 「改动需重载」那句**文字**提示被删（按钮删了、提示也没了 = 用户不知道为什么没变）
  //     ③ SWITCH_HOME 清空（摘要开关搬回基础 ⇒ 基础 8 颗、笔记 0 颗）
  //     ④ 笔记页那颗摘要开关被删（笔记 1 -> 0）
  //     ⑤ 第 5 个 tab（终端）被删
  //     ⑥ tab 顺序被改（终端挪到会话操作之前）
  //     ⑦ 终端面板的 value 被改名（aria-controls 指向一个不存在的面板）
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    name: '㊳ 「基础」页那 7 颗被换成"少了引用、多了摘要"（搬家的方向被反过来）',
    suite: RENDER,
    maxChange: 160,
    // 单点改（`diffSpan` 量的是第一处与最后一处差异的跨度，两处相隔 80 多行 = 跑偏）：
    // 过滤条件从"按 SWITCH_HOME 排除"换成"排除引用" ⇒ 基础页仍然是 **7 颗**（数没变），
    // 但**摘要**又回到了基础页 ⇒ 这正是"搬家被回滚、旧位置留了一份"的形状，必须红。
    apply: (s) => mustReplace(
      s,
      'FEATURES.filter(function (f) { return SWITCH_HOME[f.key] === undefined; })',
      'FEATURES.filter(function (f) { return f.key !== "featureQuote"; })',
      '基础页功能开关的过滤条件'),
    expect: /must NOT stay on the 基础 page/
  },
  {
    name: '㊴ 笔记页那颗开关被换成「引用」（摘要于是从页面上彻底消失）',
    suite: RENDER,
    maxChange: 128,
    // 换而不是删：删掉会让页面上少一颗（总数 13）⇒ 先红的是上游的计数断言。
    // 换成另一档 ⇒ 总数仍是 14、基础页仍是 7 颗，只有"笔记页那一颗是什么"变了。
    apply: (s) => mustReplace(
      s,
      '                    digestItem === null ? null : featureRow(digestItem, { heading: true }),',
      '                    featureRow(featureItem("featureQuote")),',
      '笔记页的摘要开关行'),
    // ⚠️ 这条会先撞上更上游的"每一档的名字都必须在页面上"那条（摘要没了）—— 同一件事、
    //    更早出口。按**实际最先报出来**的那句钉住（钉错了就会变成"红得对但理由不对"）。
    expect: /must name 摘要/
  },
  {
    name: '㊵ 第 5 个 tab（终端）被删（只剩 4 个 tab）',
    suite: RENDER,
    maxChange: 300,
    apply: (s) => mustReplace(
      s,
      '        { value: "actions", labelKey: "settings.tab.actions" },\n' +
        '        // 2026-10-17：给终端按钮单独一个 tab（用户原话："启动按钮没有单独的tab页吗"）。\n' +
        '        // 顺序在「会话操作」之后；value = `terminal`，面板 id / aria-controls 由同一个 value 拼。\n' +
        '        { value: "terminal", labelKey: "settings.tab.terminal" }',
      '        { value: "actions", labelKey: "settings.tab.actions" }',
      'SETTINGS_TABS 的第 5 项'),
    expect: /must render exactly 5 tabs/
  },
  {
    name: '㊶ tab 顺序被改（终端挪到「会话操作」之前）',
    suite: RENDER,
    maxChange: 400,
    apply: (s) => mustReplace(
      s,
      '        { value: "actions", labelKey: "settings.tab.actions" },\n' +
        '        // 2026-10-17：给终端按钮单独一个 tab（用户原话："启动按钮没有单独的tab页吗"）。\n' +
        '        // 顺序在「会话操作」之后；value = `terminal`，面板 id / aria-controls 由同一个 value 拼。\n' +
        '        { value: "terminal", labelKey: "settings.tab.terminal" }',
      '        { value: "terminal", labelKey: "settings.tab.terminal" },\n' +
        '        { value: "actions", labelKey: "settings.tab.actions" }',
      'SETTINGS_TABS 的顺序'),
    expect: /tab names \/ order must be exactly/
  },
  {
    name: '㊷ 终端面板的 value 被改名（aria-controls 指向一个不存在的面板）',
    suite: RENDER,
    maxChange: 64,
    apply: (s) => mustReplace(
      s,
      'settingsPanel("terminal", ',
      'settingsPanel("term", ',
      'settingsPanel 的 terminal 面板'),
    expect: /aria-controls|no such panel/
  }
];

function runSuite(suite, candidate) {
  const proc = spawnSync(process.execPath, [suite], {
    cwd: path.join(HERE, '..'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { HA_CLIENT_JS: candidate }),
    maxBuffer: 32 * 1024 * 1024
  });
  return { status: proc.status === null ? -1 : proc.status, output: (proc.stdout || '') + (proc.stderr || '') };
}

// ── 锚点体检：每条变异必须**命中且只动一小块**（0 次 = 空操作；跑偏 = 切掉半个文件）──
/** 体检一次变异：返回 `{ ok, reason, body }`。守卫本身也要能红 —— 见下面的 GUARD_PROBES。 */
function auditMutation(applyFn, maxChange) {
  let body;
  try {
    body = applyFn(SOURCE);
  } catch (e) {
    return { ok: false, reason: 'threw: ' + String((e && e.message) || e), body: null };
  }
  if (body === SOURCE) return { ok: false, reason: 'no-op (changed no bytes)', body: null };
  const span = diffSpan(SOURCE, body);
  const budget = maxChange === undefined ? 1200 : maxChange;
  if (span.removed + span.added > budget) {
    return { ok: false, reason: 'budget: changed ' + (span.removed + span.added) + ' byte(s) > ' + budget + ' — the locator ran away from its target', body: null, span };
  }
  return { ok: true, reason: 'changed -' + span.removed + '/+' + span.added + ' bytes, span ' + span.span + ', budget ' + budget, span, body };
}

console.log('\n锚点体检（apply 到未变异源码上）');
const bodies = [];
for (let i = 0; i < MUTATIONS.length; i++) {
  const mutation = MUTATIONS[i];
  const verdict = auditMutation(mutation.apply, mutation.maxChange);
  bodies.push(verdict.body);
  if (!verdict.ok) fail('锚点体检: mutation "' + mutation.name + '" ' + verdict.reason);
  else console.log('  ok   hit: ' + mutation.name + '  (' + verdict.reason + ')');
}

// ── 体检器的自检：故意写坏的定位器**必须**被拒（守卫不能是空的）────────────────────────
// 三条探针各对应第 2/3 段真实踩到的一种失败模式：
//   · 空操作      —— 锚点改版后不再存在，`String.replace` 静默什么都不改（"看起来在测"）；
//   · 歧义锚点    —— 锚点命中多处（改错地方，或者改了一处却以为改的是目标）；
//   · 跑偏（跨度）—— ⑨ 的旧收尾锚点 `}),` 一路找到文件后面，切掉半份文件（套件红了，但红在
//                    "文件都解析不了"）。这一条正是 `maxChange` 存在的理由。
{
  const GUARD_PROBES = [
    { name: '空操作（锚点已不存在）', want: /no-op/, apply: (s) => s.replace('这串字在源码里不存在', 'x') },
    { name: '歧义锚点（命中多处）', want: /expected exactly 1/, apply: (s) => mustReplace(s, 'featureEnabled', 'featureEnabled', '歧义探针') },
  ];
  for (const probe of GUARD_PROBES) {
    const verdict = auditMutation(probe.apply, probe.maxChange);
    if (verdict.ok) fail('体检器自检: 探针「' + probe.name + '」竟然通过了体检 —— 守卫是空的');
    else if (!probe.want.test(verdict.reason)) fail('体检器自检: 探针「' + probe.name + '」被拒了，但理由不对（期望 /' + probe.want.source + '/，实际 "' + verdict.reason + '"）');
    else console.log('  ok   体检器自检: 探针「' + probe.name + '」被拒 ✓  ' + verdict.reason.slice(0, 110));
  }
}

// Baseline: the unmutated bundle must be green in BOTH suites, or the mutations prove nothing.
console.log('');
for (const suite of [FEATURES, RENDER]) {
  const base = runSuite(suite, LIVE);
  if (base.status !== 0) {
    fail('baseline: ' + path.basename(suite) + ' is red on the unmutated bundle; mutations would be meaningless\n' + base.output.slice(-1500));
  } else {
    console.log('  ok   baseline: ' + path.basename(suite) + ' is green on the unmutated bundle');
  }
}

console.log('');
let caught = 0;
for (let i = 0; i < MUTATIONS.length; i++) {
  const mutation = MUTATIONS[i];
  const body = bodies[i];
  if (body === null || body === SOURCE) continue;   // already reported by the anchor audit
  const file = path.join(TMP, 'mut-' + i + '.js');
  fs.writeFileSync(file, body);
  const result = runSuite(mutation.suite, file);
  const caughtIt = result.status !== 0 && mutation.expect.test(result.output);
  if (caughtIt) {
    caught++;
    const lines = result.output.split('\n').filter((l) => /^FAIL/.test(l));
    console.log('  ok   caught: ' + mutation.name + '  [' + path.basename(mutation.suite) + ']  (' + lines.length + ' FAIL line(s))');
    for (const line of lines.slice(0, 2)) console.log('         ↳ ' + line.trim().slice(0, 150));
  } else if (result.status !== 0) {
    fail('mutation "' + mutation.name + '" made a suite red for the WRONG reason (expected /' + mutation.expect.source + '/ in the output):\n' + result.output.slice(-900));
  } else {
    fail('mutation NOT caught: ' + mutation.name + ' (suite ' + path.basename(mutation.suite) + ' stayed green)');
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
if (failures > 0) {
  console.error('\n' + caught + '/' + MUTATIONS.length + ' mutations caught, ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nall ' + MUTATIONS.length + ' mutations caught, every anchor hit exactly once (no-op / runaway anchors are failures too)');
