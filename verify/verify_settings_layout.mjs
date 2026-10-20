#!/usr/bin/env node
/** Layout regressions: extra-button actions stay in the row; section dividers do not double. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(process.env.HA_CLIENT_JS || path.join(HERE, '..', 'lib', 'client.js'), 'utf8');
let failed = 0;
const fail = (m) => { failed++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const assert = (m, c) => c ? ok(m) : fail(m);
function between(a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  return i >= 0 && j > i ? src.slice(i, j) : '';
}
assert('extra row is a three-column grid (no wrap)', src.includes('gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto"'));
assert('extra actions are a no-grow flex group', src.includes('"extra-actions-" + index') && src.includes('justifySelf: "end"') && src.includes('width: "auto", flex: "0 0 auto"'));
assert('quote section does not add borderTop over the previous row', !between('featureSection("featureQuote"', 'featureSection("featureFind"').includes('borderTop'));
assert('find section does not add borderTop over the previous row', !between('featureSection("featureFind"', '(0, react_jsx_runtime.jsx)("div", {\n                  style: { borderTop').includes('borderTop'));
assert('notification section does not add borderTop over feature rows', !between('// ③ 通知', '// ④ 调试').includes('borderTop'));
assert('notes storage does not add borderTop over the digest row', !between('// 存储位置', '}, "storage-section"').includes('borderTop'));
assert('workspace rows have vertical breathing room', src.includes('padding: "14px 10px"') && src.includes('padding: "9px 10px"'));
assert('workspace table has room before horizontal scroll', src.includes('minWidth: "960px"'));
assert('workspace name truncates instead of overlapping the path', src.includes('textOverflow: "ellipsis", whiteSpace: "nowrap"') && src.includes('"name-" + entry.path'));
assert('editor save/reset are right-aligned', src.includes('justifyContent: "flex-end"') && src.includes('"editor-actions"'));
assert('actions column is sticky on the right', src.includes('width: "12%", position: "sticky", right: 0') && src.includes('position: "sticky", right: 0, zIndex: 1'));
if (failed) { console.error(`\n${failed} FAILURE(S)`); process.exit(1); }
console.log('\nsettings layout: GREEN');
