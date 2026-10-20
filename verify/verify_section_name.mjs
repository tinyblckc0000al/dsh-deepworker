// verify_section_name.mjs — 设置分区改名为 DeepWorker 之后的**扫描式**守卫。
//
// 为什么是扫描式，不是逐条 grep：2026-10-16 用户把设置分区从「历史操作」改名成
// 「DeepWorker」，而**指向那个分区的句子**散在 6 个文案键里（focus.wrapUnlock /
// settings.applyFailures.toast / feature.disabled / feature.notesOffBanner /
// settings.tabsLabel / settings.title）。只改标题、漏改指路句的后果本机反复栽过：
// 用户照着「设置 → 历史操作」去找，而那个菜单项已经不存在了。
// ⇒ 这里断言的是**整份 bundle 里一个残留字样都没有**，而不是"这几行改过了"。
//
// ⚠️ 只扫**字符串字面量**，不扫代码注释。第一版扫全文件，结果被注释里的散文
// （「…→ 再写设置 → 再说话）。」）打红 —— 检查器的形状比被检查的东西还宽，
// 它拦下的就不是缺陷而是噪声。`verify_hygiene.mjs` 用同样的办法屏蔽注释。
//
// 这是回归守卫，不是判定器。用法：node verify/verify_section_name.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const CLIENT = path.join(PKG, 'lib', 'client.js');

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const code = fs.readFileSync(CLIENT, 'utf8');

/**
 * The same file with comments blanked out: pointers live in string literals, prose lives
 * in comments, and only the former is our business. Line comments are cut only OUTSIDE a
 * string, so a `//` inside a URL would not truncate a real pointer.
 */
const literalOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((line) => {
    let quote = null, cut = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote !== null) { if (ch === quote && line[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') { cut = i; break; }
    }
    return cut < 0 ? line : line.slice(0, cut);
  })
  .join('\n');
const literalLines = literalOnly.split('\n');

// ── 1) 分区标题本身就是新名字（zh 与 en 各一次，不许有一个落下） ──────────────
{
  const titles = [...code.matchAll(/"settings\.title":\s*"([^"]*)"/g)].map((m) => m[1]);
  assert('settings.title 出现 2 次（zh + en）', titles.length === 2, 'got ' + titles.length);
  assert('settings.title 两处都是 DeepWorker',
    titles.length === 2 && titles.every((v) => v === 'DeepWorker'), JSON.stringify(titles));
  // 品牌名不翻译：en 与 zh 必须逐字节相同
  assert('settings.title 中英逐字相同（品牌名不翻译）', titles[0] === titles[1], JSON.stringify(titles));
}

// ── 2) 子标题同理 ──────────────────────────────────────────────────────────
{
  const labels = [...code.matchAll(/"settings\.tabsLabel":\s*"([^"]*)"/g)].map((m) => m[1]);
  assert('settings.tabsLabel 出现 2 次', labels.length === 2, 'got ' + labels.length);
  assert('settings.tabsLabel 不含旧名',
    labels.every((v) => !/历史操作|History actions/.test(v)), JSON.stringify(labels));
}

// ── 3) 扫描：旧名一个残留都不许有（字符串字面量范围内） ─────────────────────
{
  const all = [];
  for (let i = 0; i < literalLines.length; i++) {
    if (/历史操作|History actions/.test(literalLines[i])) all.push([i + 1, literalLines[i].trim()]);
  }
  assert('bundle 的字符串里旧名 `历史操作` / `History actions` 一个残留都没有',
    all.length === 0,
    all.map(([n, l]) => 'line ' + n + ': ' + l.slice(0, 120)).join('\n         '));

  // 用户可见的指路形状：设置/Settings 与旧名同句 —— 这是最致命的一种，单独报
  const pointers = all.filter(([, l]) => /(设置|Settings)/.test(l));
  assert('字符串里没有「设置 → 历史操作 / Settings → History actions」这类指路',
    pointers.length === 0,
    pointers.map(([n, l]) => 'line ' + n + ': ' + l.slice(0, 120)).join('\n         '));
}

// ── 4) 扫描：**任何**指向设置分区的句子都必须指向一个真实存在的分区 ──────────
//    闭集的意义：新增指路句若拼错分区名（"DeepWroker"），这条立刻红。
{
  const KNOWN_SECTIONS = new Set([
    'DeepWorker',                                                                   // 本插件分区
    '基础', 'Basic', '专注锁', 'Focus lock', '笔记', 'Notes', '会话操作', 'Session actions',   // 四个 tab
    '调试', 'Debug', '存储位置', 'Storage location',                                   // 折叠小节
    '功能开关', 'Features', '功能引入 / 移除', 'Introduce / remove features'
  ]);
  const POINTER = /(?:设置|Settings)[ \t]*→[ \t]*([^\s，。、）)（(：:；;*|"\n]+)/g;
  const offenders = [];
  for (const m of literalOnly.matchAll(POINTER)) {
    const head = m[1].split('→')[0].trim();
    let known = false;
    for (let n = head.length; n > 0; n--) {
      if (KNOWN_SECTIONS.has(head.slice(0, n))) { known = true; break; }
    }
    if (!known) offenders.push(m[0].slice(0, 90));
  }
  assert('所有「设置 → …」指路都指向一个真实存在的分区',
    offenders.length === 0,
    offenders.join('\n         ') +
      (offenders.length ? '\n         (已知分区: ' + [...KNOWN_SECTIONS].join(' / ') + ')' : ''));
}

// ── 4b) 闭集必须与 bundle 同步：settings.tab.* / settings.section.* 各有 zh + en 两份 ──
{
  const KEYS = ['settings.tab.basic', 'settings.tab.focus', 'settings.tab.notes', 'settings.tab.actions',
    'settings.section.debug', 'settings.section.storage'];
  const labels = [];
  for (const key of KEYS) {
    const escaped = key.replace(/\./g, '\\.');
    for (const m of code.matchAll(new RegExp('"' + escaped + '":\\s*"([^"]*)"', 'g'))) labels.push(m[1]);
  }
  assert('settings.tab.* / settings.section.* 每个键都有 zh + en 两个字面值',
    labels.length === KEYS.length * 2, 'got ' + labels.length + ': ' + JSON.stringify(labels));
  // 闭集里必须真的含这些字面值，否则"已知分区"与现实脱节
  const KNOWN = new Set(['基础', 'Basic', '专注锁', 'Focus lock', '笔记', 'Notes', '会话操作', 'Session actions', '调试', 'Debug', '存储位置', 'Storage location']);
  const missing = labels.filter((l) => !KNOWN.has(l));
  assert('闭集与实际 tab / section 名一致（没有脱节的分区名）', missing.length === 0, JSON.stringify(missing));
}

// ── 5) 夹具不许比实现"旧"：verify_render 的词典里不许留旧名 ─────────────────
//    夹具手抄文案会漂 —— 漂了之后所有文本断言都退化成"裸键名也匹配"。
//    守卫自己（以及 verify_hygiene）必须写出这两个词才能检查它们，所以跳过。
{
  const SELF = new Set(['verify_section_name.mjs', 'verify_section_name_mutations.mjs', 'verify_hygiene.mjs']);
  const drifted = [];
  for (const f of fs.readdirSync(HERE)) {
    if (!/^verify_.*\.mjs$/.test(f) || SELF.has(f)) continue;
    const text = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const line of text.split('\n')) {
      if (/历史操作|History actions/.test(line)) drifted.push(f + ': ' + line.trim().slice(0, 100));
    }
  }
  assert('verify/ 里没有指向旧分区名的夹具文案', drifted.length === 0, drifted.join('\n         '));
}

// ── 6) README 同步（用户按文档找菜单项，文档说错同样会把人带沟里） ─────────
{
  const drifted = [];
  for (const f of ['README.md', 'README.en.md']) {
    const text = fs.readFileSync(path.join(PKG, f), 'utf8');
    for (const line of text.split('\n')) {
      if (/历史操作|History actions/.test(line)) drifted.push(f + ': ' + line.trim().slice(0, 100));
    }
  }
  assert('README.md / README.en.md 不含旧分区名', drifted.length === 0, drifted.join('\n         '));
}

console.log(fail === 0
  ? `\nSECTION NAME GUARD PASSED (${pass} checks)`
  : `\n${fail} check(s) failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
