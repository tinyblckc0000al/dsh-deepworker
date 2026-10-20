/**
 * verify_task10_notice_channel_mutations.mjs — 任务 10（2）＋**任务 11（①②）** 的**变异检验**。
 *
 * 把每一处最容易写错的地方**改回去**，断言 `verify_task10_notice_channel.mjs` 必须变红，
 * 而且红在**对应的那条**断言上。只看「退出码非 0」不够：一个无关的崩溃也能让退出码非 0。
 *
 * 每个变异都必须让套件红：
 *   ① 把**兜底去掉**（systemOnly 一律提前返回、不画气泡）  ⇒ 「权限被拒 ⇒ 必须回退画气泡」
 *   ② 把**其它通知也改成 systemOnly**（默认值反了）        ⇒ 「其它用途仍必须画气泡」
 *   ③ raiseNotice 掏空（只 `return true` 不真的构造）      ⇒ 「系统通道必须真的发出了一次系统通知」
 *   ④ 把**作用域过滤挪到发送/绘制之后**                    ⇒ 顺序守卫
 *   ⑤ 某一条专注锁调用点**漏掉** systemOnly                ⇒ 「专注锁调用点数不对：锁到期」
 *   ⑥ 某一条非专注锁调用点**误加** systemOnly              ⇒ 「带 systemOnly 的调用点必须恰好 19 处」
 *   ⑦ `readSettings` 改回**白名单**（只回读 3 个键）        ⇒ 「readSettings().focusNativeNotice 必须 === false」
 *   ⑧ 静音改成**恒 allowed:true**                          ⇒ 「静音必须真生效」
 *   ⑨ 拆掉**跨作用域接缝**（showNotice 直接调 activeSessionId） ⇒ 作用域越界守卫
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
const SUITE = path.join(here, 'verify_task10_notice_channel.mjs');
const LIVE = path.join(here, '..', 'lib', 'client.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-task10-notice-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } };

function runSuite(file) {
  try {
    const out = execFileSync(process.execPath, [SUITE], { encoding: 'utf8', env: Object.assign({}, process.env, { HA_CLIENT_JS: file }), stdio: ['ignore', 'pipe', 'pipe'] });
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

const BASE = process.env.HA_TASK10_BASE || LIVE;
const src = fs.readFileSync(BASE, 'utf8');

console.log(`tmp: ${tmp}\nbase: ${BASE} (${Buffer.byteLength(src)} bytes)\n`);

console.log('基线');
{
  const r = runSuite(BASE);
  assert('基线 bundle 上套件必须全绿（本套件的前提）', r.code === 0, 'exit=' + r.code + '\n' + r.out.split('\n').slice(-6).join('\n'));
}

const mutations = [
  {
    name: '① 把兜底去掉（systemOnly 一律提前返回、不再画气泡）',
    make: (s) => mutate(s,
      '      if (systemOnly && systemUsable && native === true) return { channel: "system", native: true };',
      '      if (systemOnly) return { channel: "system", native: native };   // MUTATION: fallback removed',
      'notice/no-fallback'),
    expectFail: '权限被拒 ⇒ 必须回退画气泡',
  },
  {
    name: '② 把其它通知也改成 systemOnly（默认值反了 ⇒ 所有气泡消失）',
    make: (s) => mutate(s,
      '      var systemOnly = !!(opts && opts.systemOnly === true);',
      '      var systemOnly = !(opts && opts.systemOnly === false);   // MUTATION: everything is system-only now',
      'notice/all-system-only'),
    expectFail: '其它用途的通知仍必须画页面内气泡',
  },
  {
    name: '③ raiseNotice 被掏空（只宣称成功、不真的构造系统通知）',
    make: (s) => mutate(s,
      '        new window.Notification("DeepSeek Harness", { body: String(text == null ? "" : text) });\n        return true;',
      '        return true;   // MUTATION: claims success without raising anything',
      'notice/raise-emptied'),
    expectFail: '系统通道必须真的发出了一次系统通知',
  },
  {
    name: '④ 作用域过滤被挪到发送/绘制之后（静音会话仍能收到系统通知）',
    make: (s) => {
      let out = mutate(s,
        '      try {\n        if (!noticeAllowed({ settings: readSettings(), sessionId: noticeScopeSessionId() }).allowed) {\n          return { channel: "suppressed", native: false };\n        }\n      } catch (e) { /* a broken filter must not swallow the message: fall through and show it */ }\n',
        '      // MUTATION: the scope filter moved below the send\n',
        'notice/filter-removed');
      out = mutate(out,
        '      if (systemOnly && systemUsable && native === true) return { channel: "system", native: true };\n      closeNotice();',
        '      if (systemOnly && systemUsable && native === true) return { channel: "system", native: true };\n      try {\n        if (!noticeAllowed({ settings: readSettings(), sessionId: noticeScopeSessionId() }).allowed) {\n          return { channel: "suppressed", native: false };\n        }\n      } catch (e) { /* MUTATION: broken filter */ }\n      closeNotice();',
        'notice/filter-moved-below');
      return out;
    },
    expectFail: '作用域过滤必须在 raiseNotice 之前',
  },
  {
    name: '⑤ 一条专注锁调用点漏掉 systemOnly（到期提示又画起气泡）',
    make: (s) => mutate(s,
      'showNotice(t("focus.expired"), { clientX: 24, clientY: 80, systemOnly: true })',
      'showNotice(t("focus.expired"), { clientX: 24, clientY: 80 })',
      'notice/missing-system-only'),
    // 红在**点名清单**上：这一条专注锁调用点的 systemOnly 计数从 1 掉到 0
    //（清单的计数断言先于「这一行必须带 systemOnly」跑）。
    expectFail: '专注锁调用点数不对：锁到期',
  },
  {
    name: '⑥ 一条非专注锁调用点误加 systemOnly（笔记提示被误伤）',
    make: (s) => mutate(s,
      'showNotice(t("notes.copied"), { clientX: 24, clientY: 24 })',
      'showNotice(t("notes.copied"), { clientX: 24, clientY: 24, systemOnly: true })',
      'notice/wrong-system-only'),
    // 两条断言都会红（总数 20 ≠ 19；且「其它用途不得带」）。总数断言先跑，所以点名它。
    expectFail: '带 systemOnly 的 showNotice 调用点必须恰好 19 处',
  },
  {
    name: '⑦ readSettings 改回白名单（只回读 3 个原开关 ⇒ 原生通知关不掉）',
    make: (s) => mutate(s,
      '          for (var k in parsed) {\n            if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue;\n            // Assigning `__proto__` would rewrite the prototype of `out` instead of adding a key.\n            if (k === "__proto__") continue;\n            if (typeof SETTING_DEFAULTS[k] === "boolean") {\n              if (typeof parsed[k] === "boolean") out[k] = parsed[k];\n            } else {\n              out[k] = parsed[k];\n            }\n          }',
      '          var whitelist = { quoteProvenance: true, retryNote: true, archiveOriginal: true };   // MUTATION: the 3-key whitelist is back\n          for (var k in whitelist) {\n            if (typeof parsed[k] === "boolean") out[k] = parsed[k];\n          }',
      'settings/whitelist-only'),
    expectFail: 'readSettings().focusNativeNotice 必须 === false',
  },
  {
    name: '⑧ 静音改成恒 allowed:true（mute 列表形同不存在）',
    make: (s) => mutate(s,
      '        for (var i = 0; i < muted.length; i++) {\n          if (sameSessionId(muted[i], sessionId)) return { allowed: false, reason: "muted" };\n        }',
      '        for (var i = 0; i < muted.length; i++) {\n          if (false && sameSessionId(muted[i], sessionId)) return { allowed: false, reason: "muted" };   // MUTATION: the mute list is ignored\n        }',
      'notice/mute-ignored'),
    expectFail: '静音必须真生效',
  },
  {
    name: '⑨ 拆掉跨作用域接缝（showNotice 直接调 apply 作用域的 activeSessionId）',
    make: (s) => mutate(s,
      'sessionId: noticeScopeSessionId()',
      'sessionId: activeSessionId()',
      'notice/scope-seam-cut'),
    expectFail: 'showNotice 必须通过 noticeScopeSessionId() 读当前会话',
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
    !effective ? '变异没生效（源串找不到）' : (r.code === 0 ? '套件仍然全绿' : '红了，但不是这条断言：' + (r.out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') || '(无 FAIL 行)')));
  if (effective && r.code !== 0 && hit) {
    const line = r.out.split('\n').find((l) => l.startsWith('FAIL'));
    console.log(`       ↳ ${line}`);
  }
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
