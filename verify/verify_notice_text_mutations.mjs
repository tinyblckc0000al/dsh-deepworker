/**
 * verify_notice_text_mutations.mjs — 任务 12（「提示 / 通知文案不得含 ✅」）的**变异检验**。
 *
 * 把 ✅ **加回**某条提示文案 ⇒ `verify_notice_text.mjs` 必须变红，而且红在**对应的那条**断言上。
 * 只看「退出码非 0」不够：一个无关的崩溃也能让退出码非 0。
 *
 * 每个变异都必须让套件红：
 *   ① zh 的某条气泡文案把 ✅ 加回去            ⇒ 「提示/通知文案里仍有 ✅」
 *   ② en 的某条气泡文案把 ✅ 加回去            ⇒ 同上（中英两边都要清）
 *   ③ zh 与 en 同时加回去（最像「有人回滚了」） ⇒ 同上
 *   ④ 设置页那条 `focus.free` 的 ✅ 被**删掉** ⇒ 「设置页文案必须保留 ✅（防误删）」（反向守卫）
 *   ⑤ en 词典删掉一个键（键集不一致）          ⇒ 「zh / en 键集不一致」
 *   ⑥ 模板候选：给 `focus.requested` 加 ✅     ⇒ 同上（它是 showNotice 拼接用的键）
 *   ⑦ 新增一个**形状表之外**的 showNotice 调用点 ⇒ 「调用点不在已知形状表里」（防新代码溜过去）
 *   ⑧ 注释里的 ✅ 被删掉                       ⇒ 「注释里的 ✅ 必须原样保留」
 *
 * 任务 13（2026-10-13，气泡顶部正中）追加 ⑤ 条：
 *   ⑨ 定位改回点击坐标（`style.left = Math.min(ev.clientX, …)` + `style.top = ev.clientY + 12`）
 *      ⇒ 「函数体里出现 `noticeEl.style.left`」（**最重要的那条**：用户看到的正是这个回滚）
 *   ⑩ 居中那两行 CSS 被拆掉（`left:50%` / `translateX(-50%)` 没了）⇒ 「样式里缺少 left:50%」
 *   ⑪ 距顶被改成贴边（`top:0px`）⇒ 「距顶 top:0px 不在 8–24px」
 *   ⑫ 换汤不换药：`left:50%+translateX` 改成 `left:calc(50vw - 140px)`（还是像素/视口算的）
 *      ⇒ 「样式里缺少 left:50%」
 *   ⑬ ✅ 加回 `focus.expired`（重点那条气泡文案）⇒ 「提示/通知文案里仍有 ✅」
 *
 * ⚠️ 纪律：所有变异都只写**临时目录**（AGENTS.md「测试不许碰真实路径」），
 * 通过 `HA_CLIENT_JS` 让套件读变异副本，绝不碰被 HMR 监视的 `lib/client.js`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(here, 'verify_notice_text.mjs');
const LIVE = path.join(here, '..', 'lib', 'client.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-notice-text-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

function runSuite(file) {
  try {
    const out = execFileSync(process.execPath, [SUITE], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { HA_CLIENT_JS: file }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

/** 按锚点精确替换：`anchor` 必须在 base 里**唯一**，否则直接报错（静默不生效的变异最坑）。 */
function mutate(src, anchor, replacement, label) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点不唯一（' + n + ' 次）：' + label + ' :: ' + JSON.stringify(anchor.slice(0, 80)));
  return src.replace(anchor, replacement);
}

/**
 * 基线 bundle：默认线上 `lib/client.js`。
 * 候选体检（发布**前**验 `.pending-client.js`）时用 `HA_CLIENT_JS` 指过去 —— 与
 * `verify_task8_mask_timer_mutations.mjs` 同构：子进程读的是**显式传进去的那一份文件**，
 * 不依赖父进程的 loader 重定向（`--import` 的 register 不会继承给子进程）。
 * `HA_NOTICE_TEXT_BASE` 优先（老用法保持不变）。
 */
const BASE = process.env.HA_NOTICE_TEXT_BASE || process.env.HA_CLIENT_JS || LIVE;
const CHECK = '\u2705';
const src = fs.readFileSync(BASE, 'utf8');

/**
 * 任务 14（气泡配色）后，气泡的 `style.cssText` 是一个**很长的整串** —— 变异里再硬编码一遍
 * 就会变成"改了实现忘了改变异锚点"的静默失效（锚点找不到时 `mutate` 会抛错，但抛在读到文件之前
 * 就没机会报）。所以这里**从基线文件里现取**那一条语句，变异照着它做替换。
 */
const OLD_CSS = (() => {
  const m = /noticeEl\.style\.cssText = "([^"]+)";/.exec(src);
  if (!m) throw new Error('基线里找不到 noticeEl.style.cssText = "…";（变异锚点无法生成）');
  return m[1];
})();

/**
 * 任务 15 起，气泡/计时这两处的锚点**一律从基线里现取**（含任务 14 起就有的"整串 cssText"惯例）：
 * 硬编码一遍就等于"改了实现忘了改变异锚点"，而且锚点写错时 `mutate` 会**抛错**而不是静默 ——
 * 抛在套件里是噪音，不是断言。下面每个片段都直接从当前基线里抠出来，缺失即报错。
 */
function cssSlice(re, what) {
  const m = re.exec(OLD_CSS);
  if (!m) throw new Error('基线气泡 cssText 里找不到 ' + what + '（变异锚点无法生成）：' + OLD_CSS.slice(0, 200));
  return m[1];
}
const CSS = {
  bg: cssSlice(/background:([^;]+)/, 'background'),
  border: cssSlice(/border:([^;]+)/, 'border'),
  maxW: cssSlice(/max-width:([^;]+)/, 'max-width'),
  fixed: cssSlice(/^([^;]*position:fixed[^;]*)/, 'position:fixed 那一段'),
};
const COUNTDOWN_ANCHOR = (() => {
  const mm = /var countdown = ([^;]+);/.exec(src);
  if (!mm) throw new Error('基线里找不到 countdown 的格式化语句（计时抖动变异的锚点无法生成）');
  return 'var countdown = ' + mm[1] + ';';
})();
/** 计时 label 的等宽数字声明（取到才说明基线真的开了等宽数字）。 */
const MONO_DECL = (() => {
  const m = /fontVariantNumeric: "tabular-nums"/.exec(src) || /fontVariantNumeric:"tabular-nums"/.exec(src);
  if (!m) throw new Error('基线里找不到计时的 fontVariantNumeric: "tabular-nums"（计时变异的锚点无法生成）');
  return m[0];
})();
/** 计时 label 的 minWidth 声明。 */
const MINW_DECL = (() => {
  const m = /minWidth: "[^"]+"/.exec(src) || /minWidth:"[^"]+"/.exec(src);
  if (!m) throw new Error('基线里找不到计时的 minWidth（计时变异的锚点无法生成）');
  return m[0];
})();
/** 「专注」的 order 声明：从 `id: "history-actions-focus"` 之后找第一个 `order: <n>`。 */
const FOCUS_ORDER_ANCHOR = (() => {
  const mm = /(id: "history-actions-focus",[\s\S]{0,600}?order: )(-?\d+)/.exec(src);
  if (!mm) throw new Error('基线里找不到 history-actions-focus 的 order（ordering 变异的锚点无法生成）');
  return { prefix: mm[1], value: mm[2] };
})();

console.log('tmp: ' + tmp + '\nbase: ' + BASE + ' (' + Buffer.byteLength(src) + ' bytes)\n');

console.log('基线');
{
  const r = runSuite(BASE);
  assert('基线 bundle 上套件必须全绿（本套件的前提）', r.code === 0,
    'exit=' + r.code + '\n' + r.out.split('\n').slice(-6).join('\n'));
}

const mutations = [
  {
    name: '① zh 气泡文案把 ✅ 加回去（focus.unlockedLocal）',
    make: (s) => mutate(s,
      '"focus.unlockedLocal": "已解除专注，其它会话恢复可用",',
      '"focus.unlockedLocal": "已解除专注，其它会话恢复可用 ' + CHECK + '",',
      'notice/zh-check-back'),
    expectFail: '提示/通知文案里仍有 ✅',
  },
  {
    name: '② en 气泡文案把 ✅ 加回去（focus.lockedLocal）',
    make: (s) => mutate(s,
      '"focus.lockedLocal": "Locked the other sessions for {n} min — only this one stays usable",',
      '"focus.lockedLocal": "Locked the other sessions for {n} min — only this one stays usable ' + CHECK + '",',
      'notice/en-check-back'),
    expectFail: '提示/通知文案里仍有 ✅',
  },
  {
    name: '③ zh 与 en 同时加回去（最像「有人整体回滚」）',
    make: (s) => {
      let out = mutate(s,
        '"focus.wrapEscaped": "已解除专注并撤掉拦截：其它会话恢复可用",',
        '"focus.wrapEscaped": "已解除专注并撤掉拦截：其它会话恢复可用 ' + CHECK + '",',
        'notice/both-zh');
      out = mutate(out,
        '"focus.wrapEscaped": "Focus off and the interception removed: the other sessions are usable again",',
        '"focus.wrapEscaped": "Focus off and the interception removed: the other sessions are usable again ' + CHECK + '",',
        'notice/both-en');
      return out;
    },
    expectFail: '提示/通知文案里仍有 ✅',
  },
  {
    name: '④ 往设置页文案 focus.free 加回 ✅ ⇒ 红（设置页不再有例外）',
    make: (s) => mutate(s, '"focus.free": "未锁定",', '"focus.free": "未锁定 ' + CHECK + '",', 'settings-check-added'),
    expectFail: '所有词典值都不许带 ✅',
  },
  {
    name: '⑤ en 词典删掉一个**非气泡**键（键集不一致）',
    // 用 `focus.scopeLabel`（设置页文案，不在 showNotice 可达集里）⇒ 前面的「可达键必须完整」
    // 不会先红，红的正是第 6 节那条键集断言。
    make: (s) => mutate(s, '      "focus.scopeLabel": "Keep usable:",\n', '', 'dict/en-key-removed'),
    expectFail: 'zh / en 键集不一致',
  },
  {
    name: '⑤b en 词典删掉一个**气泡**键 ⇒ 可达集合不再完整',
    make: (s) => mutate(s, '      "focus.sentUnlock": "Unlock request sent",\n', '', 'dict/en-notice-key-removed'),
    expectFail: 'en 缺少可达键 "focus.sentUnlock"',
  },
  {
    name: '⑥ 拼接用的模板候选键加 ✅（focus.requested）',
    make: (s) => mutate(s,
      '"focus.requested": "已把请求写进输入框，按回车即可：",',
      '"focus.requested": "已把请求写进输入框，按回车即可 ' + CHECK + '：",',
      'notice/template-candidate'),
    expectFail: '提示/通知文案里仍有 ✅',
  },
  {
    name: '⑦ 新增一个形状表之外的 showNotice 调用点（新代码想溜过去）',
    // ⚠️ 2026-10-16：这条锚点原来是 2 参形状 `showNotice(t("notice.cleared"), { clientX: 24, clientY: 80 });`
    //    —— 那一族按钮的回执后来补了 `{ always: true }`（关掉「通知与气泡」时它们必须仍然说话），
    //    锚点跟着改成新的 3 参形状。锚点失配 `mutate` 会抛错（要求唯一命中），不会静默变空操作。
    make: (s) => mutate(s,
      '        showNotice(t("notice.cleared"), { clientX: 24, clientY: 80 }, { always: true });',
      '        showNotice(someOtherHelper(t), { clientX: 24, clientY: 80 });   // MUTATION: a new shape\n        showNotice(t("notice.cleared"), { clientX: 24, clientY: 80 }, { always: true });',
      'shape/unknown-call-site'),
    expectFail: '个 showNotice 调用点不在已知形状表里',
  },
  {
    name: '⑧ 源码注释里的 ✅ 被删掉（它不是文案，不该被清）',
    make: (s) => mutate(s,
      '会话的入口全部点不开，当前会话照常打开」' + CHECK + '）。这里只做两件事',
      '会话的入口全部点不开，当前会话照常打开」）。这里只做两件事',
      'keep/comment-check-removed'),
    expectFail: '源码注释里的 ✅ 必须原样保留',
  },
  /* ── 任务 13（气泡顶部正中 / 只用 CSS）── */
  {
    name: '⑨ 定位改回点击坐标（旧写法）⇒ 顶部正中必须变红',
    make: (s) => {
      let out = mutate(s,
        '      noticeEl.style.cssText = "' + OLD_CSS + '";',
        '      noticeEl.style.cssText = "position:fixed;z-index:2147483000;max-width:280px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;box-shadow:var(--dsw-elevation-panel);padding:8px 10px;font-size:12px;line-height:18px;";\n      noticeEl.style.left = Math.min(ev.clientX, Math.max(0, window.innerWidth - 300)) + "px";\n      noticeEl.style.top = Math.max(0, ev.clientY + 12) + "px";',
        'position/back-to-click-coords');
      out = mutate(out,
        '      noticeEl.textContent = text;',
        '      noticeEl.textContent = text;\n      // MUTATION-13: 定位改回点击坐标（顶部正中的实现被回滚）',
        'position/back-to-click-coords-marker');
      return out;
    },
    expectFail: '函数体里出现 `noticeEl.style.left',
  },
  {
    name: '⑩ 居中那两行 CSS 被拆掉（left:50% 没了，像素定位也不回来）⇒ 必须变红',
    make: (s) => mutate(s,
      'position:fixed;top:14px;left:50%',
      'position:fixed;top:14px;z-index:2147483000;max-width:280px;',
      'position/centering-removed'),
    // `left` 整段被删掉 ⇒ `statementAt` 的存在性守卫先命中（它要求取到的语句含 position:fixed/left），
    // 所以这里红的是那条守卫，而不是 HAVE 里的 `left:50%` —— 两者都证明"居中没了"，但断言名不同。
    expectFail: '取到的样式语句看起来被截断了',
  },
  {
    name: '⑪ 距顶被改成贴边（top:0px）⇒ 必须变红',
    make: (s) => mutate(s, 'position:fixed;top:14px;left:50%', 'position:fixed;top:0px;left:50%', 'position/glued-to-top'),
    expectFail: '距顶 "top:0px" 不在 8–24px',
  },
  {
    name: '⑫ 换汤不换药：气泡的 CSS 居中被换成视口像素算（left:calc(50vw - 140px)）⇒ 必须变红',
    // ⚠️ 锚点必须够长：`left:50%;transform:translateX(-50%)` 在文件里出现 **2 次**
    // （另一处是第 1099 行的重试提示条 `.wrap`，不是 showNotice 的气泡）⇒ 锚点要带上前面的
    // `position:fixed;top:14px;` 才是唯一的。锚点不唯一时 mutate 会直接抛错（不静默）。
    make: (s) => mutate(s,
      'position:fixed;top:14px;left:50%;transform:translateX(-50%)',
      'position:fixed;top:14px;left:calc(50vw - 140px)',
      'position/pixel-centering'),
    expectFail: '创建气泡的样式里缺少 `left:50%`',
  },
  {
    name: '⑬ ✅ 加回一条气泡文案（重点那条 focus.expired）⇒ 必须变红',
    make: (s) => mutate(s,
      '"focus.expired": "专注已结束：其它会话恢复可用（同时发出系统通知，窗口最小化也能看到）",',
      '"focus.expired": "专注已结束：其它会话恢复可用' + CHECK + '（同时发出系统通知，窗口最小化也能看到）",',
      'notice/zh-check-back-expired'),
    expectFail: '提示/通知文案里仍有 ✅',
  },
  /* ── 任务 14（气泡配色：中性灰底 + 彩色边框）── */
  {
    name: '⑭ 配色整体回滚成起点版本（bg-layer-1 + 灰描边 + panel 阴影）⇒ 必须变红',
    // 变异说明：这就是用户看到的"融为一体"那一版。**只回滚配色**，保留任务 15 的紧凑限宽，
    // 这样红的正是「底色与页面底色相同」那条，而不是限宽那条（两条都该红，但断言要各归各位）。
    make: (s) => mutate(s,
      '      noticeEl.style.cssText = "' + OLD_CSS + '";',
      '      noticeEl.style.cssText = "' + OLD_CSS
        .replace('background:' + CSS.bg, 'background:var(--dsw-alias-bg-layer-1)')
        .replace('border:' + CSS.border, 'border:1px solid var(--dsw-alias-border-l3)') + '";',
      'color/back-to-layer-1'),
    expectFail: '气泡底色',
  },
  {
    name: '⑮ 边框改回灰描边（--dsw-alias-border-l3）⇒ 彩色边框必须变红',
    make: (s) => mutate(s, 'border:' + CSS.border,
      'border:1px solid var(--dsw-alias-border-l3)', 'color/grey-border-back'),
    expectFail: '彩色边框没生效',
  },
  {
    name: '⑯ 蓝色调浅过头（与白色各 50%）⇒ 「只浅一档」必须变红',
    // 防"用力过猛"：白占 50% 就近乎淡白，与用户「再浅一丢丢」不符。
    // 这一档实测红在**可见度下限**（边框 vs 底色 1.84:1 < 2.6:1），不是"没变浅" —— 两者都算过火/不足的守卫。
    // ⚠️ 锚点必须带上 `border:1px solid `：源码注释里也逐字引用了这条 color-mix（锚点不唯一会抛错）。
    make: (s) => mutate(s, 'border:' + CSS.border,
      'border:1px solid color-mix(in srgb, var(--dsw-alias-link) 50%, white)', 'color/too-washed-out'),
    expectFail: '浅一档后仍要看得见那条边',
  },
  {
    name: '⑰ 蓝色几乎没调（与白色仅 2%）⇒ 「再浅一丢丢」必须变红',
    // 另一头的守卫：只挪一丁点等于没改，用户看不出来。
    make: (s) => mutate(s, 'border:' + CSS.border,
      'border:1px solid color-mix(in srgb, var(--dsw-alias-link) 98%, white)', 'color/barely-changed'),
    expectFail: '不比原蓝',
  },
  /* ── 任务 15（2026-10-13）：① 紧凑卡片 ② 边框恰好 1px ③ 中和灰底 + 描边 ④ 专注最前 + 计时不抖 ── */
  {
    name: '⑱ 限宽改回 calc(100vw - 32px)（"气泡太宽了"那一版）⇒ 紧凑卡片必须变红',
    make: (s) => mutate(s, 'width:fit-content;max-width:' + CSS.maxW, 'width:fit-content;max-width:calc(100vw - 32px)', 'width/back-to-viewport-only'),
    expectFail: '紧凑上限',
  },
  {
    name: '⑲ 边框改成 2px（用户明令不许加粗）⇒ 恰好 1px 必须变红',
    // 锚点用当前边框声明的 `1px` 那一段，避免"注释里也写了 color-mix"造成的锚点歧义。
    make: (s) => mutate(s, 'border:' + CSS.border,
      'border:' + CSS.border.replace('1px', '2px'), 'border/too-thick'),
    expectFail: '恰好** 1px',
  },
  {
    name: '⑳ 底色回滚成 bg-layer-1（与标题栏融为一体的那一版，保留 1px 彩色描边）⇒ 必须变红',
    make: (s) => mutate(s, '      noticeEl.style.cssText = "' + OLD_CSS + '";',
      '      noticeEl.style.cssText = "' + OLD_CSS
        .replace('background:' + CSS.bg, 'background:var(--dsw-alias-bg-layer-1)') + '";',
      'color/layer-1-back'),
    expectFail: '气泡底色',
  },
  {
    name: '㉑ 用没核实过的主题变量（--dsw-specific-sidebar-width）⇒ 白名单断言必须变红',
    // 这是 AGENTS.md 里真实踩过的坑：用了不存在的 token ⇒ 永久 fallback。名单必须真的在筛。
    make: (s) => mutate(s, 'background:' + CSS.bg,
      'background:var(--dsw-specific-sidebar-width)', 'vars/unverified-token'),
    expectFail: '主题里不存在的变量',
  },
  {
    name: '㉒ 「专注」order 改回 60（排到最右、计时又开始挤左边按钮）⇒ 顺序断言必须变红',
    make: (s) => mutate(s, FOCUS_ORDER_ANCHOR.prefix + FOCUS_ORDER_ANCHOR.value,
      FOCUS_ORDER_ANCHOR.prefix + '60', 'order/focus-back-to-60'),
    // 2026-10-16：那条不变量收窄成「必须排在**非本插件**条目之前」（终端按钮组要排在
    // 【打开】前面 ⇒ 它必然也在「专注」前面；详见 verify_notice_text.mjs 里的注释）。
    // 所以期望文案跟着改成**现在真正**会红的那一条 —— 旧文案已不存在，不改就是
    // "红了但不是这条断言"（等于这条变异没在测它想测的东西）。
    expectFail: '不比**非本插件**条目的最小值',
  },
  {
    name: '㉓ 去掉 tabular-nums（计时每位数字宽度又变）⇒ 抖动守卫必须变红',
    make: (s) => mutate(s, MONO_DECL + ', ', '', 'timer/no-tabular-nums'),
    expectFail: '没有等宽数字',
  },
  {
    name: '㉔ 去掉 min-width（锁定前后宽度又变）⇒ 抖动守卫必须变红',
    make: (s) => mutate(s, MINW_DECL + ', ', '', 'timer/no-min-width'),
    expectFail: '没有 `minWidth`',
  },
];

console.log('\n变异（每一个都必须 RED，且红在对应的断言上）');
for (const m of mutations) {
  const mutated = m.make(src);
  const effective = mutated !== src;
  const file = path.join(tmp, m.name.replace(/[^\w]+/g, '_').slice(0, 40) + '.js');
  fs.writeFileSync(file, mutated, 'utf8');
  const r = runSuite(file);
  const hit = r.out.indexOf(m.expectFail) !== -1;
  assert(m.name + ' → RED@对应断言', effective && r.code !== 0 && hit,
    !effective ? '变异没生效（源串找不到）'
      : (r.code === 0 ? '套件仍然全绿'
        : '红了，但不是这条断言：' + (r.out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') || '(无 FAIL 行)')));
  if (effective && r.code !== 0 && hit) {
    const line = r.out.split('\n').find((l) => l.startsWith('FAIL'));
    console.log('       ↳ ' + line);
  }
}

console.log('\n' + (fail === 0 ? 'GREEN' : 'RED') + ': ' + pass + ' passed / ' + fail + ' failed');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
