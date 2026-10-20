#!/usr/bin/env node
/**
 * verify_bundle_health_mutations.mjs — 变异检验：把「能导致真机 `import failed` 的每一种
 * 写入事故」重新做出来，断言 `_bundle_health.mjs` 的检查器**必须报红**；同时断言
 * 已知好版本报绿、纯文案改动报绿。
 *
 * 为什么：本机五次「本地全绿、真机崩」。一个检查器若不能在已知坏例上变红，它就等于没有。
 * 本套件断言的是**检查器本身**的可信度，不是插件行为；所有变异都只写**临时目录**
 * （AGENTS.md：测试不许碰真实路径）。
 *
 * 用法：node verify/verify_bundle_health_mutations.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkText, checkFile, diffText } from './_bundle_health.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOOD = path.join(here, '..', 'lib', 'client.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-bundle-mut-'));

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const firstBad = (r) => r.findings.filter((f) => f.level === 'bad').map((f) => f.msg.replace(/^[^:]*:\s*/, '')).slice(0, 2).join(' | ');

const src = fs.readFileSync(GOOD, 'utf8');
console.log(`tmp: ${tmp}\nbase: ${GOOD} (${Buffer.byteLength(src)} bytes)\n`);

/* ── 0. 基线：好版本必须绿（本套件自己的前提） ───────────────────────── */
console.log('基线');
{
  const r = checkFile(GOOD, { expectId: 'dsh-deepworker' });
  assert('已知好版本（线上 lib/client.js）→ GREEN', r.ok, firstBad(r));
  assert('  且注册 id 就是 dsh-deepworker',
    r.findings.some((f) => f.level === 'ok' && f.msg.includes('注册 id = "dsh-deepworker"')));
}

/* ── 变异集合：每一个都必须 RED ─────────────────────────────────────── */
const mutations = [
  {
    name: '文案里混入 U+2028（行分隔符）—— 拼接成 combo 后必崩',
    make: (s) => s.replace('工作区粒度暂不可用，已放行', '工作区粒度\u2028暂不可用，已放行'),
  },
  {
    name: '文案里混入零宽字符 U+200B',
    make: (s) => s.replace('工作区粒度暂不可用，已放行', '工作区粒度\u200b暂不可用，已放行'),
  },
  {
    name: '文案里混入 </script',
    make: (s) => s.replace('"focus.wrapWorkspace": "🔒 专注中', '"focus.wrapWorkspace": "</script> 专注中'),
  },
  {
    name: '结尾换行被吃掉（combo 会把下一个 bundle 接在同一行）',
    make: (s) => s.replace(/\n$/, ''),
  },
  {
    name: 'LF 被换成 CRLF',
    make: (s) => s.replace(/\n/g, '\r\n'),
  },
  {
    name: '写入时留了半份（截断到 70%）',
    make: (s) => s.slice(0, Math.floor(s.length * 0.7)),
  },
  {
    name: '引号被换掉（"…" → \'…\'）：语法仍合法，但改了结构',
    make: (s) => s.replace('"notes.title": "笔记"', "'notes.title': '笔记'"),
  },
  {
    name: '文案里删掉键值对的逗号（对象结构被破坏）',
    make: (s) => s.replace('"focus.wrapWorkspace": "🔒 专注中（工作区粒度）：工作区粒度暂不可用，已放行。",', '"focus.wrapWorkspace": "🔒 专注中（工作区粒度）：工作区粒度暂不可用，已放行。"'),
  },
  {
    name: '注册 id 被改错（宿主按 id 找 factory ⇒ loaded without registering）',
    make: (s) => s.replace('id: "dsh-deepworker"', 'id: "dsh-xh-deepworke"'),
  },
  {
    name: '整份 bundle 写了两遍（duplicate factory registration）',
    make: (s) => s + s,
  },
  {
    name: '代码里多一个右花括号（结构改动）',
    make: (s) => s.replace('\n    var testHooks = {};', '\n    }\n    var testHooks = {};'),
  },
  {
    name: 'BOM 开头',
    make: (s) => '\ufeff' + s,
  },
];

console.log('\n变异（每一个都必须 RED）');
for (const m of mutations) {
  const mutated = m.make(src);
  const effective = mutated !== src;      // 变异必须真的落到字节上；否则「没红」可能只是没生效
  const r = checkText(mutated, { file: m.name, expectId: 'dsh-deepworker' });
  assert(m.name + ' → RED', effective && !r.ok, effective ? '检查器没抓到（exit=0）' : '变异没生效（src 里找不到目标串）');
  if (effective && !r.ok) console.log(`       ↳ ${firstBad(r)}`);
}

/* ── 差异落点：结构改动必须红，纯文案改动必须绿 ────────────────────── */
console.log('\n差异落点（--against 的等价调用）');
{
  const onlyText = src.replace('工作区粒度暂不可用，已放行', '另一个纯文案');
  assert('只改文案值 → GREEN', diffText(src, onlyText).ok);

  const renamed = src.replace('function paintLockedSessions() {', 'function paintLockedSessions2() {');
  const r2 = diffText(src, renamed);
  const structuralMsg = r2.findings.some((f) => f.level === 'bad' && f.msg.includes('结构'));
  assert('改了函数名（结构改动）→ RED 且指出"结构"', !r2.ok && structuralMsg, !r2.ok ? '红了但没说是结构改动' : '没红');
  assert('  结构改动靠的是代码区比对，不是语法错误',
    r2.findings.some((f) => f.level === 'bad' && f.msg.includes('代码区')));

  // 关键鉴别力：**代码里只多了一个空格**必须被抓到（掩码只抹字符串内容，不抹代码）
  const spaced = src.replace('function paintLockedSessions() {', 'function paintLockedSessions () {');
  const r3 = diffText(src, spaced);
  assert('代码里多一个空格 → RED（代码区比对有鉴别力）', !r3.ok, '没红：掩码把代码也抹掉了？');

  // 反向：字符串**内容**长度变化不影响代码区判定（否则每次改文案都假红）
  const grown = src.replace('工作区粒度暂不可用，已放行', '工作区粒度暂不可用，已放行（这一次把文案写长很多很多很多）');
  assert('文案变长（字符串长度变化）→ GREEN（不假红）', diffText(src, grown).ok);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
