#!/usr/bin/env node
/**
 * verify_primitives_props_mutations.mjs — 变异检验：证明 `verify_primitives_props.mjs`
 * 的每一条断言**真的能红**，而且红的理由是对的。
 *
 * 为什么：本机纪律"一个检查器若不能在已知坏例上变红，它就等于没有"。这一套尤其重要，
 * 因为在写它的过程中就实测到两个**假红/假绿**陷阱：
 *   · `variant` 集合若不排掉尺寸类，`size="md"` 会被当成合法档位（假绿面）；
 *   · 注释掩码一开始返回 `false` 而调用点判 `!== null` ⇒ 每一处都被当成注释、下标变成
 *     `NaN` ⇒ 扫到 **0** 个调用点。当时若把"扫不到"当"都合法"，就是本机反复踩的
 *     "空操作/假绿"。所以下面每一条都断言**红在哪一句**（`expect`），不只是"红了"。
 *
 * 所有变异都只写 `/tmp` 的副本；**绝不**触碰线上 `lib/client.js`（HMR 会发布被监视目录里的
 * 每一次写盘）。app.asar 从不修改：升档/改名这一类变异走 `HA_PRIMITIVES_CSS` 覆盖，
 * 让检查器去读一份"升级后的" Button.module.css 副本。
 *
 * 用法：node verify/verify_primitives_props_mutations.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'verify_primitives_props.mjs');
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-prim-mut-'));

const SOURCE = fs.readFileSync(LIVE, 'utf8');
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };

/** 从 app.asar 现读一个文件（只读；读不到抛错 —— 变异体没有"猜"的余地）。 */
function readAsar(suffix) {
  const fd = fs.openSync(ASAR, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const base = 8 + headerSize;
    let entry = null;
    (function walk(node, prefix) {
      for (const [name, val] of Object.entries(node.files || {})) {
        const p = prefix + '/' + name;
        if (val.files) walk(val, p);
        else if (p.endsWith(suffix)) entry = val;
      }
    })(header, '');
    if (!entry) throw new Error('not in app.asar: ' + suffix);
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, base + parseInt(entry.offset, 10));
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

/** 从 app.asar 列出所有匹配的文件路径。 */
function asarPaths(re) {
  const fd = fs.openSync(ASAR, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const out = [];
    (function walk(node, prefix) {
      for (const [name, val] of Object.entries(node.files || {})) {
        const p = prefix + '/' + name;
        if (val.files) walk(val, p);
        else if (re.test(p)) out.push(p);
      }
    })(header, '');
    return out;
  } finally { fs.closeSync(fd); }
}

// DSH 0.2.1-rc.1 起 primitives 不再是独立文件：映射与签名在 index-*.js，类名在 *.css。
const FE_JS_PATHS = asarPaths(/dsh-web-frontend\/dist\/assets\/index-[^/]+\.js$/);
const FE_CSS_PATHS = asarPaths(/dsh-web-frontend\/dist\/assets\/.+\.css$/);
if (FE_JS_PATHS.length !== 1) throw new Error(`expected exactly one compiled web-frontend index-*.js, got ${FE_JS_PATHS.length}`);
if (FE_CSS_PATHS.length === 0) throw new Error('no compiled web-frontend CSS found in app.asar');
const FE_JS_PATH = FE_JS_PATHS[0];

/** 检查器会读的**全部** app.asar 条目。变异时把整张表写成一份真的 asar，只替换被点名
 *  的那一份编译产物 —— 这样变异一定落到检查器真正读的文件上，而不是一个它不看的副本上。 */
const REAL_ASAR_VIEW = {};
for (const p of [...FE_JS_PATHS, ...FE_CSS_PATHS]) REAL_ASAR_VIEW[p] = readAsar(p);

/** 跑一次检查器，返回 { code, out, failLines }。 */
function runSuite({ src, asarView = null }) {
  const file = path.join(TMP, `client-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, src);
  const env = Object.assign({}, process.env, { HA_CLIENT_JS: file });
  if (asarView) {
    const override = path.join(TMP, `asar-${Math.random().toString(36).slice(2)}.asar`);
    buildAsar(override, asarView);
    env.HA_ASAR = override;
  }
  const proc = spawnSync(process.execPath, [SUITE], { encoding: 'utf8', env, cwd: path.join(HERE, '..') });
  const out = (proc.stdout || '') + (proc.stderr || '');
  const failLines = out.split('\n').filter((l) => /^FAIL\b/.test(l.trim())).map((l) => l.trim());
  return { code: proc.status, out, failLines };
}

/** 把一张 `路径 → 内容` 表写成一个**真的能读**的 asar。
 *
 *  ⚠️ 头部**不手搓**：本轮实测手搓过两次，两次都把字段写错（一次 JSON 长度放在偏移 12 之后，
 *  一次干脆少了 4 字节），结果检查器 `JSON.parse` 抛 `SyntaxError`，变异"红了"却红在一个与
 *  被测断言**完全无关**的理由上 —— 那是比不测更糟的假信号。
 *  所以这里改成：**从真 app.asar 逐字节取头部区当模板**，只重写"每条路径 → (offset,size)"
 *  与数据区。头部字段因此一定与真机同构，而检查器走的仍是它自己的真实读取器。 */
function buildAsar(file, view) {
  const fd = fs.openSync(ASAR, 'r');
  const probe = Buffer.alloc(16);
  fs.readSync(fd, probe, 0, 16, 0);
  const headerSize = probe.readUInt32LE(4);
  const jsonSize = probe.readUInt32LE(12);
  const headerRegion = Buffer.alloc(8 + headerSize);
  fs.readSync(fd, headerRegion, 0, 8 + headerSize, 0);
  fs.closeSync(fd);
  const realJson = JSON.parse(headerRegion.slice(16, 16 + jsonSize).toString('utf8'));

  const keep = [];
  (function walk(node, prefix) {
    for (const [name, val] of Object.entries(node.files || {})) {
      const p2 = prefix + '/' + name;
      if (val.files) walk(val, p2); else keep.push({ path: p2, size: val.size, offset: parseInt(val.offset, 10) });
    }
  })(realJson, '');

  const missing = Object.keys(view).filter((p2) => !keep.some((e) => e.path === p2));
  if (missing.length > 0) throw new Error('buildAsar: view names path(s) absent from the real app.asar: ' + missing.join(', '));

  const root = {};
  const datas = [];
  let offset = 0;
  for (const e of keep) {
    if (!Object.prototype.hasOwnProperty.call(view, e.path)) continue;
    const data = Buffer.from(view[e.path], 'utf8');
    const parts = e.path.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const leaf = i === parts.length - 1;
      if (leaf) node[parts[i]] = { size: data.length, offset: String(offset) };
      else { node[parts[i]] = node[parts[i]] || { files: {} }; node = node[parts[i]].files; }
    }
    datas.push(data);
    offset += data.length;
  }

  const json = Buffer.from(JSON.stringify({ files: root }), 'utf8');
  const jsonPadded = json.length + (4 - (json.length % 4)) % 4;

  // ── 头布局（这一版**逐字节对齐真 asar**，而且下面有 round-trip 自检守着）──────────────
  //   偏移 0  : 4                pickle 的 size 字段宽度
  //   偏移 4  : jsonPadded + 8   头总长 → **数据区起点 = 8 + u32[4] = 16 + jsonPadded**
  //   偏移 8  : jsonPadded       4 字节对齐后的字符串长度
  //   偏移 12 : json.length      **未对齐**的字符串长度（检查器读这一栏当 JSON 长度）
  //   偏移 16 : JSON 本体，长度恰为 json.length，其后补齐到 jsonPadded，数据区紧随其后
  // ⚠️ 偏移 4 那一栏必须是 `jsonPadded + 8`。本轮在这上面连栽三次：写成别的值时数据区会
  //    **整体前移 3 字节**（每个条目的头几字节变成上一段的尾巴），检查器于是读到
  //    `}}\u0000\u0000/* Button sizes…` 这种"JSON 能解析、内容却错位"的 CSS ——
  //    变异红了，但红在一个与断言无关的解析事故上。所以下面加了一条**写进去再读出来**的自检：
  //    任何一个字节对不上就抛错，绝不让"错位的 asar"冒充研究结论。
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(jsonPadded + 8, 4);
  head.writeUInt32LE(jsonPadded, 8);
  head.writeUInt32LE(json.length, 12);
  const padded = Buffer.alloc(jsonPadded);
  json.copy(padded, 0);
  const bytes = Buffer.concat([head, padded, ...datas]);
  fs.writeFileSync(file, bytes);

  // ── round-trip 自检：用**检查器同一套读法**把每个条目读回来，必须逐字节相同 ─────────────
  {
    const rfd = fs.openSync(file, 'r');
    const rh = Buffer.alloc(16);
    fs.readSync(rfd, rh, 0, 16, 0);
    const rHeaderSize = rh.readUInt32LE(4);
    const rJsonSize = rh.readUInt32LE(12);
    const rjb = Buffer.alloc(rJsonSize);
    fs.readSync(rfd, rjb, 0, rJsonSize, 16);
    const rHeader = JSON.parse(rjb.toString('utf8'));
    const rBase = 8 + rHeaderSize;
    let index = 0;
    (function verify(node, prefix) {
      for (const [name, val] of Object.entries(node.files || {})) {
        const p2 = prefix + '/' + name;
        if (val.files) { verify(val, p2); continue; }
        const got = Buffer.alloc(val.size);
        fs.readSync(rfd, got, 0, val.size, rBase + parseInt(val.offset, 10));
        const want = datas[index++];
        if (!got.equals(want)) {
          throw new Error('buildAsar round-trip mismatch for ' + p2 + ': got ' + JSON.stringify(got.slice(0, 24).toString('utf8')) + ' want ' + JSON.stringify(want.slice(0, 24).toString('utf8')));
        }
      }
    })(rHeader, '');
    fs.closeSync(rfd);
  }
}

/** 一条变异：改源码或改 CSS，断言整体红且**红在期望的那一句话上**。 */
function mutation({ name, mutate, expect, viewMutate = null, wantNoFail = false }) {
  const src = mutate ? mutate(SOURCE) : SOURCE;
  let asarView = null;
  if (viewMutate) {
    asarView = viewMutate(Object.assign({}, REAL_ASAR_VIEW));
    const changed = Object.keys(asarView).filter((k) => asarView[k] !== REAL_ASAR_VIEW[k]);
    if (changed.length === 0) { fail(`${name}: the asar-view mutation did not change any file`); return; }
  }
  const effective = (mutate ? src !== SOURCE : true) || asarView !== null;
  if (!effective) { fail(`${name}: the mutation did not change anything (anchor missing) — a no-op mutation proves nothing`); return; }
  const r = runSuite({ src, asarView });
  if (wantNoFail) {
    if (r.code !== 0 || r.failLines.length > 0) fail(`${name}: expected GREEN but got exit=${r.code} ${r.failLines.slice(0, 2).join(' | ')}`);
    else console.log(`  ok   ${name} -> GREEN (as required)`);
    return;
  }
  if (r.code === 0 || r.failLines.length === 0) { fail(`${name}: the checker stayed GREEN — this mutation must be RED`); return; }
  const hit = r.failLines.find((l) => expect.test(l));
  if (!hit) { fail(`${name}: went RED but not for the expected reason.\n        want /${expect.source}/\n        got: ${r.failLines.slice(0, 4).join('\n             ')}`); return; }
  console.log(`  ok   ${name} -> RED`);
  console.log(`         ↳ ${hit.slice(0, 210)}`);
}

/* 定位锚点必须唯一 —— 复用检查器真正读的那个文件。 */
const mustReplace = (s, needle, replacement, what) => {
  const n = s.split(needle).length - 1;
  if (n !== 1) throw new Error(`anchor "${what}" occurs ${n} time(s), expected exactly 1`);
  return s.replace(needle, replacement);
};

console.log(`tmp:     ${TMP}`);
console.log(`suite:   ${SUITE}`);
console.log(`live:    ${LIVE} (${Buffer.byteLength(SOURCE)} bytes)`);
console.log(`asar:    ${ASAR}\n`);

/* ── 0. 基线 ─────────────────────────────────────────────────────────────── */
console.log('基线');
{
  const r = runSuite({ src: SOURCE });
  if (r.code === 0 && r.failLines.length === 0) console.log('  ok   the live bundle (after the fix) is GREEN, including the variant scan finding ≥1 literal');
  else fail(`the baseline should be GREEN after the fix, got exit=${r.code}: ${r.failLines.slice(0, 3).join(' | ')}`);
  if (/located \d+ primitives\.Button call site/.test(r.out)) console.log('  ok   the locator reports a non-zero call-site count (no silent empty scan)');
  else fail('the baseline output does not report a call-site count');
}

/* ── 1. 任务点名的三条核心变异 ────────────────────────────────────────────── */
console.log('\n核心变异（任务点名）');
mutation({
  name: '① 插入一个不存在的档位 variant: "frobnicate" ⇒ 红，并报出文件:行号 + 该非法值',
  mutate: (s) => mustReplace(s, 'variant: "primary",\n              disabled: draft[0].trim() === "" || busy[0],',
    'variant: "frobnicate",\n              disabled: draft[0].trim() === "" || busy[0],', 'resend submit variant'),
  expect: /illegal Button variant "frobnicate"/,
});
mutation({
  name: '② 单个调用点的合法档位**改名**（primary → emphasized）⇒ 红（证明集合是解析来的、不是硬编码）',
  mutate: (s) => mustReplace(s, 'variant: "primary",\n              disabled: draft[0].trim() === "" || busy[0],',
    'variant: "emphasized",\n              disabled: draft[0].trim() === "" || busy[0],', 'resend submit variant rename'),
  expect: /illegal Button variant "emphasized"/,
});
mutation({
  name: '②c 把所有合法档位**全部改名**（primary → emphasized、outline → stroked）⇒ 红（同样证明不是硬编码）',
  mutate: (s) => s.replace(/variant: "primary"/g, 'variant: "emphasized"').replace(/variant: "outline"/g, 'variant: "stroked"'),
  expect: /illegal Button variant "(emphasized|stroked)"/,
});
mutation({
  name: '②b 映射里**整档改名**（primary → emphasized，模拟 DSH 升级），插件仍传 primary ⇒ 红',
  mutate: null,
  viewMutate: (view) => {
    const js = view[FE_JS_PATH];
    const out = js.replace(/([A-Za-z_$][\w$]*)=\{([^{}]*button:[^{}]*)\}/, (all, name, body) => {
      if (!/(^|,)primary:/.test(body)) throw new Error('primary key not found in the Button CSS-module map');
      return name + '={' + body.replace(/(^|,)primary:/, '$1emphasized:') + '}';
    });
    if (out === js) throw new Error('map-key rename mutation was a no-op');
    view[FE_JS_PATH] = out;
    return view;
  },
  expect: /illegal Button variant "primary"/,
});
mutation({
  name: '③ 插入非法 size: "lg" ⇒ 红（尺寸维度也守）',
  mutate: (s) => mustReplace(s, 'variant: "outline",\n            size: "sm",', 'variant: "outline",\n            size: "lg",', 'smallButton size'),
  expect: /illegal Button size "lg"/,
});

/* ── 2. "扫不到" 必须红（空操作/假绿）────────────────────────────────────── */
console.log('\n空扫描 / 假绿');
mutation({
  name: '④ 整份 client.js 清空 ⇒ 红（扫不到调用点 ≠ 都合法）',
  mutate: () => '',
  expect: /no primitives\.Button call site matched|not a valid|unexpected/i,
});
mutation({
  name: '⑤ 所有 variant 字面量被抹掉（改成计算值）⇒ 红（0 个字面量 = 空扫描）',
  mutate: (s) => s.replace(/variant: "[a-z]+"/g, 'variant: pickVariant()'),
  expect: /ZERO variant literals|not a string literal/,
});
mutation({
  name: '⑥ 同一对象内把 size 写到 variant 前面（重排不应假红）⇒ 绿',
  mutate: (s) => mustReplace(s, 'variant: "outline",\n            size: "sm",', 'size: "sm",\n            variant: "outline",', 'smallButton reorder'),
  expect: /.^/,
  wantNoFail: true,
});
mutation({
  name: '⑥b **新增**一个合法的 size: "md" 到某个原本省略 size 的调用点 ⇒ 绿（合法值不得假红）',
  mutate: (s) => mustReplace(s, 'variant: "primary",\n                  disabled: digestBusy[0],',
    'size: "md",\n                  variant: "primary",\n                  disabled: digestBusy[0],', 'digest save add size md'),
  expect: /.^/,
  wantNoFail: true,
});

/* ── 3. --dsw-* 设计变量 ─────────────────────────────────────────────────── */
console.log('\n设计变量');
mutation({
  name: '⑦ 引用一个 asar 里不存在的变量（--dsw-alias-border-tertiary，本机真栽过）⇒ 红',
  mutate: (s) => mustReplace(s, 'border: "0.5px solid var(--dsw-alias-border-l4)", borderRadius: "4px",',
    'border: "0.5px solid var(--dsw-alias-border-tertiary)", borderRadius: "4px",', 'border-l4 → 不存在的 tertiary'),
  expect: /--dsw-alias-border-tertiary.*NO definition/,
});
mutation({
  name: '⑦b 引用 --dsw-alias-state-warning-primary（本机真栽过的第二个）⇒ 红',
  mutate: (s) => mustReplace(s, 'color: "var(--dsw-alias-state-error-primary)", fontSize: "13px", lineHeight: "20px", flex: "0 0 auto"',
    'color: "var(--dsw-alias-state-warning-primary)", fontSize: "13px", lineHeight: "20px", flex: "0 0 auto"', 'state-error → state-warning (notes off banner)'),
  expect: /--dsw-alias-state-warning-primary.*NO definition/,
});
mutation({
  name: '⑧ 把**全部** var(--dsw-*) 删掉 ⇒ 红（一个引用都没有 = 提取失效，不是"全都有定义"）',
  mutate: (s) => s.replace(/var\(--dsw-[A-Za-z0-9_-]+\)/g, 'inherit'),
  expect: /no var\(--dsw-…\)|no var\(--dsw-/,
});

/* ── 4. 注释 / 定位鲁棒性（写这套件时实测过的两个陷阱）──────────────────── */
console.log('\n定位鲁棒性（实测陷阱）');
mutation({
  name: '⑨ 文档注释里出现的 primitives.Button 不得被当成调用点（否则假红）：把注释里的那句改成一个"坏调用"形状 ⇒ 仍绿',
  mutate: (s) => mustReplace(s, '// doc-comment probe: primitives.Button("secondary") is a comment, not a call.',
    '// doc-comment probe: primitives.Button("frobnicate") is a comment, not a call.', 'doc-comment probe'),
  expect: /.^/,
  wantNoFail: true,
});
mutation({
  name: '⑩ Button props 里嵌套的 style.size（第二层）不得被当成 Button 的 size ⇒ 绿',
  // 锚点就是 digest 模态里那颗 Button 的 props 对象的**内层 style**（全局唯一）。
  // 原来写的锚点是 `resize: "vertical", minHeight: "110px"` —— 实测该文本**在文件里不存在**
  // （那是凭记忆写的），所以这条变异一直抛"锚点找不到"，等于没测。
  mutate: (s) => mustReplace(s,
    'display: "flex", flexDirection: "column", gap: "12px", maxHeight: "58vh", overflowY: "auto"',
    'display: "flex", flexDirection: "column", gap: "12px", size: "huge", maxHeight: "58vh", overflowY: "auto"',
    'nested style probe inside a Button props object'),
  expect: /.^/,
  wantNoFail: true,
});

/* ── 5. 尺寸契约（防"新档位被静默当合法"）───────────────────────────────── */
console.log('\n尺寸契约');
mutation({
  name: '⑪ .sm 的 height 被改掉（28px → 30px，编译产物 CSS）⇒ 红（契约失效必须喊，不是把新值当合法）',
  mutate: null,
  viewMutate: (view) => {
    const key = FE_CSS_PATHS.find((p) => /\._sm_[A-Za-z0-9]+_\d+\{[^}]*height:\s*28px/.test(view[p]));
    if (!key) throw new Error('the compiled .sm rule with height:28px was not found');
    const before = view[key];
    view[key] = before.replace(/(\._sm_[A-Za-z0-9]+_\d+\{[^}]*height:\s*)28px/, '$130px');
    if (view[key] === before) throw new Error('sm-height mutation was a no-op');
    return view;
  },
  expect: /\.sm in .* does not declare height: 28px|size contract changed/,
});
mutation({
  name: '⑫ 映射里多出一个带 height 的新维度类 lg ⇒ 红（新维度必须人工确认）',
  mutate: null,
  viewMutate: (view) => {
    const js = view[FE_JS_PATH];
    const map = js.match(/\{[^{}]*button:[^{}]*\}/);
    const hash = (js.match(/_button_([A-Za-z0-9]+)_\d+/) || [])[1];
    if (!map || !hash) throw new Error('Button CSS-module map or hash not found');
    const cls = '_lg_' + hash + '_999';
    view[FE_JS_PATH] = js.replace(map[0], map[0].slice(0, -1) + ',lg:"' + cls + '"}');
    const key = FE_CSS_PATHS[0];
    view[key] = view[key] + '\n.' + cls + '{height:44px}\n';
    return view;
  },
  expect: /\.lg in .* declares a height but is neither in the size contract/,
});

/* ── 6. 白名单本身不得成为后门 ───────────────────────────────────────────── */
console.log('\n白名单（不得放宽成"找不到就跳过"）');
{
  // 白名单为空时，任何"找不到定义就放行"的实现都会让 ⑦ 变绿 —— 上面 ⑦ 已经证明它红。
  // 这里再加一条：把白名单塞进一个**来源不存在**的条目，检查器必须自己报红。
  const src = fs.readFileSync(SUITE, 'utf8');
  const patched = src.replace(
    'const RUNTIME_INJECTED = [',
    "const RUNTIME_INJECTED = [{ name: '--dsw-alias-fake-injected', source: { file: '/nope/does-not-exist.js', line: 1 }, why: 'mutation' },",
  );
  if (patched === src) fail('⑬ could not patch the whitelist (anchor missing) — the whitelist back-door test is a no-op');
  else {
    const file = path.join(TMP, 'suite-whitelist-probe.mjs');
    fs.writeFileSync(file, patched);
    const proc = spawnSync(process.execPath, [file], { encoding: 'utf8', env: Object.assign({}, process.env, { HA_CLIENT_JS: LIVE }), cwd: path.join(HERE, '..') });
    const out = (proc.stdout || '') + (proc.stderr || '');
    if (proc.status !== 0 && /whitelist entry --dsw-alias-fake-injected names a source that does not exist/.test(out)) {
      console.log('  ok   ⑬ 白名单条目指向不存在的来源 ⇒ RED');
      console.log('         ↳ whitelist entry --dsw-alias-fake-injected names a source that does not exist in app.asar');
    } else {
      fail(`⑬ a whitelist entry naming a non-existent source was accepted (exit=${proc.status}); the whitelist is a back door.\n        ${out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 2).join('\n        ')}`);
    }
  }
}

console.log(`\n${failures === 0 ? 'GREEN' : 'RED'}: ${failures === 0 ? 'every mutation landed where it was supposed to' : failures + ' failure(s)'}`);
// `KEEP_TMP=1` 保留临时目录，方便在变异失败时手工复现那个 asar（默认清理）。
if (!process.env.KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true }); else console.log('TMP kept: ' + TMP);
process.exit(failures === 0 ? 0 : 1);
