/**
 * dsh-combo-sim / tools/extract-asar.mjs
 *
 * Minimal asar reader: lists, extracts or greps files inside an app.asar without
 * any dependency. Used to produce the read-only inputs under
 * /tmp/dsh-combo-extract/ (the extraction CACHE: `lib/route.mjs` EXTRACT_ROOT) and to quote
 * exact sources in README.md. This is the only writer of that path — the verify suites write
 * into their own per-run temp directory instead.
 *
 * Usage:
 *   node tools/extract-asar.mjs list  <asar> [regex]
 *   node tools/extract-asar.mjs cat   <asar> <key> [outFile|--stdout]
 *   node tools/extract-asar.mjs grep  <asar> <regex>
 *
 * Notes / limitations (as encountered on this machine's app.asar):
 *   - entries with `unpacked: true` have no inline offset; they live in
 *     `<asar>.unpacked/` and are skipped here (reported).
 *   - the header's `offset` is relative to the start of the data section.
 */

import fs from "node:fs";
import path from "node:path";

const [cmd, asarPath, ...rest] = process.argv.slice(2);
if (!cmd || !asarPath) {
  console.error("usage: node tools/extract-asar.mjs <list|cat|grep> <asar> [...]");
  process.exit(2);
}

const fd = fs.openSync(asarPath, "r");
const header = (() => {
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const pickleSize = head.readUInt32LE(4);
  const jsonSize = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonSize);
  fs.readSync(fd, json, 0, jsonSize, 16);
  return { tree: JSON.parse(json.toString("utf8")), base: 16 + pickleSize };
})();

function walk(node, prefix, visit) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const key = `${prefix}/${name}`;
    if (entry.files) walk(entry, key, visit);
    else visit(key, entry);
  }
}

function readEntry(key, entry) {
  if (entry.offset === undefined) throw new Error(`${key} is unpacked (no inline offset)`);
  const buf = Buffer.alloc(entry.size);
  fs.readSync(fd, buf, 0, entry.size, header.base + Number(entry.offset));
  return buf;
}

if (cmd === "list") {
  const re = rest[0] ? new RegExp(rest[0]) : null;
  let count = 0;
  let unpacked = 0;
  walk(header.tree, "", (key, entry) => {
    if (re && !re.test(key)) return;
    count += 1;
    if (entry.offset === undefined) unpacked += 1;
    console.log(`${String(entry.size ?? 0).padStart(9)}  ${entry.offset === undefined ? "U" : " "}  ${key}`);
  });
  console.error(`-- ${count} entries matched (${unpacked} unpacked/skipped)`);
} else if (cmd === "cat") {
  const key = rest[0];
  const out = rest[1];
  let entry = null;
  walk(header.tree, "", (k, e) => {
    if (k === `/${key}`) entry = e;
  });
  if (!entry) {
    console.error(`no such key: ${key}`);
    process.exit(1);
  }
  const buf = readEntry(key, entry);
  if (!out || out === "--stdout") process.stdout.write(buf);
  else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.error(`wrote ${out} (${buf.length} bytes)`);
  }
} else if (cmd === "grep") {
  const re = new RegExp(rest[0]);
  let files = 0;
  let hits = 0;
  let skippedUnpacked = 0;
  walk(header.tree, "", (key, entry) => {
    if (entry.offset === undefined) {
      skippedUnpacked += 1;
      return;
    }
    const text = readEntry(key, entry).toString("utf8");
    if (!re.test(text)) return;
    files += 1;
    text.split("\n").forEach((line, i) => {
      if (re.test(line)) {
        hits += 1;
        console.log(`${key}:${i + 1}: ${line.trim().slice(0, 300)}`);
      }
    });
  });
  console.error(`-- ${files} files matched, ${hits} lines, ${skippedUnpacked} unpacked entries skipped`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
