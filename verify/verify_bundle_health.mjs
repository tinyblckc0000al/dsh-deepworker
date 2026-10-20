#!/usr/bin/env node
/**
 * verify_bundle_health.mjs — 套件成员 + CLI 薄壳（任务 8 第一部分）。
 *
 * 真正的检查逻辑在 `_bundle_health.mjs`（故意不叫 `verify_*.mjs`：它需要参数，不能当套件成员，
 * 而本文件**无参**运行 ⇒ 与 17 个既有套件同构，PASS/FAIL）。
 *
 * 无参（默认）：检查线上 `lib/client.js`，期望注册 id `dsh-deepworker`。
 *   node verify/verify_bundle_health.mjs
 * CLI：
 *   node verify/verify_bundle_health.mjs <bundle.js> [--id <期望的注册 id>]
 *   node verify/verify_bundle_health.mjs --against <good.js> <candidate.js>
 */
import { runCli } from './_bundle_health.mjs';

process.exit(runCli(process.argv.slice(2)));
