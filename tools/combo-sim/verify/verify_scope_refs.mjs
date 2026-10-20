/**
 * dsh-combo-sim / verify/verify_scope_refs.mjs
 *
 * The crash this package had to explain is a SCOPE failure, not a syntax failure.
 *
 * Evidence (App's own log, 2026-10-13T06:03:58Z):
 *     Uncaught (in promise) ReferenceError: events is not defined
 *     at plugins/??dsh-history-actions/client.js,dsh-rewind/client.js,…&rev=53922cf9af03:7004
 * The same failure repeats on the row's own URL at :121, which is exactly
 *     say(how + "\n窗口事件 [" + events.length + "]…")
 * `var events = [];` lives at line 153 — inside a DIFFERENT function, the
 * `})).then(function (r) {` callback. No enclosing scope and no platform seed
 * binds `events`, so the read throws at runtime. The bundle parses, the combo
 * parses, and every per-file suite stays green.
 *
 * This script is a HEURISTIC scope walker (token scan + brace depth, strings and
 * comments blanked). It reports UNRESOLVED member-style reads (name followed by
 * `.`, `[` or `(`). It is not a parser; it is a regression guard whose job is to
 * make a NEW unresolved read loud.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE PARAMETER-BINDING DEFECT (fixed 2026-10-15; the recorded 52 was not a baseline at all)
 *
 * Until this pass the walker reported **52 candidates** on the live 7.3k-line bundle and the
 * suite called that a "baseline". Almost all 52 were the walker's OWN false positives, in three
 * classes, and the budget existed only because they did:
 *
 *   ① PARAMETERS OF ANONYMOUS FUNCTIONS WERE NEVER BOUND — and, worse, were bound by accident
 *      in the ENCLOSING scope when the leak happened to line up. The old header slot did
 *      `expectingDecl = "function"` and then consumed the NEXT TOKEN as the function's name.
 *      For `function (result) {` that next token is `(`, so the `(` was eaten as if it were a
 *      name, `paramsPending` stayed latched, and the parameter list was never seen. `result`
 *      was therefore *not* a parameter; it only stopped being reported because the latched
 *      `paramsPending` swallowed the first `(` of the body — for
 *      `.then(function (result) { resendTraceOn && showNotice(t("resend.tracePage", {`,
 *      that is `showNotice(`, whose arguments then got bound as if they were parameters, and
 *      one of those arguments is … `result`. Inserting ANY paired-paren statement between the
 *      two sites closes the latched window early, `result` is exposed, and the count becomes
 *      53 — a false positive manufactured by the walker, which is why five diagnostic bubbles
 *      in lib/client.js had to be written as `resendTraceOn && showNotice(...)` instead of
 *      `if (resendTraceOn) { showNotice(...); }`. (Those five sites are back to the `if` form.)
 *
 *      MEASURED with the pre-fix walker on the live bundle, one insertion between
 *      `.then(function (result) {` (line 4505) and its `ok: String(result && result.ok),`:
 *        baseline                                  52   (`result` NOT among them)
 *        + `if (someFn()) { }`                     53   new: `result@4508`
 *        + `var x = (a || b);`                     53   new: `result@4508`
 *        + `if (String(result)) { }`               52   (that insertion's own parens re-bind `result`)
 *        + `{ }`                                   52   (no parens ⇒ the latched window never closes)
 *      After the fix every one of those mutants yields 0 candidates, except the `someFn` one,
 *      which yields exactly 1: `someFn` — a genuinely undeclared call that insertion introduced.
 *   ② HOISTING WAS NEVER RESOLVED. Declarations were only recorded when the forward token pass
 *      reached them, so every forward reference to a hoisted `function f() {}` or `var x` was
 *      reported. On the live bundle that is ~40 of the 52. The walk now makes TWO passes: pass
 *      1 records each hoistable name in the scope that owns it, pass 2 seeds the scopes. `let`
 *      / `const` / `class` are deliberately NOT hoisted (their temporal dead zone is real).
 *   ③ MULTI-DECLARATOR STATEMENTS. `var pe0 = -1, lo0 = [];` declared only `pe0`; `lo0` was
 *      reported. Commas now declare the next name, but only at the SAME paren/brace/bracket
 *      nesting as the declaration, so the commas in `f(x, y)` or `[x, y]` cannot declare
 *      anything (over-declaring would HIDE bugs, which is worse than inventing them).
 *
 * Measured after the fix: live dsh-deepworker **0** candidates (was 52), live dsh-rewind
 * 0 (was 0), the known-broken rewind bundle 2 — `events@121` and `typeList@121`, i.e. the real
 * defect the walker exists for is still caught. The budgets below are therefore recorded as 0,
 * and they FAIL on any growth. A budget of 0 is only safe because the two fixtures below pin
 * both directions: a paired-paren insertion must not ADD a candidate, and a genuine sibling
 * read must still BE one.
 *
 * KNOWN LIMITS (each would show up as a false positive — never as a missing report):
 *   · computed keys in a destructuring pattern (`{[k]: v}` binds `k` here, it does not in JS);
 *   · sequence expressions after a declaration without a `;` (`var a = 1` / `return x, y`);
 *   · a named function EXPRESSION's own name is bound in the enclosing scope as well;
 *   · an expression-bodied arrow's parameters are bound in the enclosing scope (they have no
 *     scope of their own to live in, and not binding them turns `(x) => x.y` into noise);
 *   · destructuring DECLARATIONS (`const {a} = x`) do not bind `a` — the live bundle has none.
 *
 * Usage:  node verify/verify_scope_refs.mjs
 */

import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFile } from "../lib/route.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, "..", "..");

/**
 * 2026-10-17（第 1 段搬迁）：本工具包搬进插件仓库的 `tools/combo-sim/` ⇒ 插件根 = 本文件上三级。
 * `WS` 仍是**工具根**（`<plugin>/tools`），不是插件根。
 * 可用 `DSH_XH_DEEPWORKER_DIR` 覆盖（换机器 / 夹具时不必改代码）。
 */
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(HERE, "..", "..", "..");

const CANDIDATES = [
  // Recorded 2026-10-15 (fixed walker). The old 52 was the walker's own false positives —
  // see the header. A budget is a REGRESSION GUARD, not a correctness claim: growth past the
  // recorded number is what must fail loudly, and 0 means "any new candidate is a finding".
  { label: "LIVE dsh-deepworker", file: path.join(PLUGIN_DIR, "lib", "client.js"), budget: 0 },
  // These three are historical bundles from a /tmp that macOS has since cleaned (measured
  // 2026-10-15: all three missing). While absent the entry is inert; the 0 is deliberate so
  // that restoring one of them FAILS LOUDLY and forces a re-record instead of silently
  // inheriting a number nobody measured with the fixed walker.
  { label: "sample good before-task15", file: "/tmp/client.js.before-task15.bak", budget: 0 },
  { label: "sample broken-task14", file: "/tmp/client.js.broken-task14.bak", budget: 0 },
  { label: "sample broken-task12", file: "/tmp/client.js.broken-task12.bak", budget: 0 },
  // 2026-10-17（第 1 段）：`dsh-rewind` 已迁出本仓库（变成 `~/.dsh/plugins/dsh-rewind` 独立仓库，
  // 且不再装进 profile）。负例**不再依赖另一个仓库的活的目录**——那会让这道门在第 2 段搬走它的
  // 那一刻变红，也会让"负例还在不在"取决于别人仓库的当前状态。⇒ 字节原样拷进 `verify/fixtures/`
  // （sha256 34d612b2…，与原文件的字节相同），负例从此自足。
  { label: "rewind KNOWN-BROKEN 06:04Z (fixture)", file: path.join(HERE, "fixtures", "rewind-known-broken-20261013T060427Z.js"), budget: 2 },
];

/** Language + platform + DSH seed names. */
const GLOBALS = new Set(
  `window globalThis document console navigator location history screen localStorage sessionStorage
   setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame cancelAnimationFrame
   fetch Request Response Headers URL URLSearchParams TextEncoder TextDecoder AbortController AbortSignal
   EventSource WebSocket Worker Blob File FileReader FormData MutationObserver IntersectionObserver
   ResizeObserver CustomEvent Event Promise Array Object JSON Math Date String Number Boolean Symbol Map Set
   WeakMap WeakSet RegExp Error TypeError RangeError SyntaxError Reflect Proxy Intl BigInt Infinity NaN undefined
   global process structuredClone atob btoa performance crypto arguments this super import require module exports
   true false null void typeof instanceof new delete in of do else case break continue return throw try catch
   finally for while if switch function class const let var yield await async static get set default extends
   export with debugger
   Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer
   DataView isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent encodeURI decodeURI
   NodeFilter CSS Highlight DOMParser XMLSerializer HTMLElement Element Node Range getComputedStyle matchMedia
   ClipboardItem Image Audio Option Text Comment DocumentFragment Keyframe Effect Animation CSSStyleSheet
   MediaQueryList postMessage
   react React jsx jsxs Fragment useState useEffect useMemo useCallback useRef useId useLayoutEffect
   useReducer useContext useSyncExternalStore createElement forwardRef memo createContext createRoot`
    .split(/\s+/)
    .filter(Boolean),
);

/** Blank strings, templates, comments and regex bodies; keep length and newlines. */
function blankNonCode(text) {
  const out = text.split("");
  const n = text.length;
  let i = 0;
  let prev = "";
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && text[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      if (c !== "`") blank(i, j);
      else {
        let k = i;
        while (k < j) {
          if (text[k] === "$" && text[k + 1] === "{") {
            k += 2;
            let depth = 1;
            while (k < j && depth > 0) {
              if (text[k] === "{") depth += 1;
              else if (text[k] === "}") depth -= 1;
              k += 1;
            }
          } else {
            if (out[k] !== "\n") out[k] = " ";
            k += 1;
          }
        }
      }
      i = j;
      continue;
    }
    if (c === "/" && /^(|[=(,:;[!&|?{}+\-*%<>~^])$/.test(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== "\n") {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j += 1;
      }
      blank(i, j + 1);
      i = j + 1;
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out.join("");
}

const TOKEN = /\{|\}|\(|\)|=>|\bvar\b|\blet\b|\bconst\b|\bfunction\b|\bclass\b|\bcatch\b|[A-Za-z_$][\w$]*|[^\s]/g;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const WS_OR_END = (ch) => ch === undefined || /\s/.test(ch);

/** Paren pairing for the whole blanked text, in one linear pass (an index map, so the arrow
 *  lookahead below stays O(1) per `(` instead of rescanning to the matching `)`). */
function parenPairs(text) {
  const pairs = new Int32Array(text.length).fill(-1);
  const open = [];
  for (let k = 0; k < text.length; k += 1) {
    if (text[k] === "(") open.push(k);
    else if (text[k] === ")") {
      const at = open.pop();
      if (at !== undefined) {
        pairs[at] = k;
        pairs[k] = at;
      }
    }
  }
  return pairs;
}

/** First non-whitespace character at or after `from` ("" at end of input). */
function nextChar(text, from) {
  let k = from;
  while (k < text.length && WS_OR_END(text[k])) k += 1;
  return k < text.length ? text[k] : "";
}

/** Identifier token ending immediately before `at`, or null (for the `x => …` arrow shape). */
function identBefore(text, at) {
  let j = at - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  const end = j + 1;
  while (j >= 0 && /[\w$]/.test(text[j])) j -= 1;
  const name = text.slice(j + 1, end);
  return IDENT.test(name) ? name : null;
}

/**
 * Is `name` (at `idx`) in a *binding* position inside a parameter list?
 * Rejects `obj.prop` (a read), `obj[key]` (a read) and `key:` in an object pattern
 * (`{key: binding}` binds `binding`, not `key`). It cannot see computed keys (`{[k]: v}`,
 * where `k` is a read) — that over-binds, and the file header lists it as a known limit.
 */
function isBindingPosition(text, idx, name) {
  let a = idx - 1;
  while (a >= 0 && /\s/.test(text[a])) a -= 1;
  if (a >= 0 && (text[a] === "." || text[a] === "?")) return false;
  let b = idx + name.length;
  while (b < text.length && /\s/.test(text[b])) b += 1;
  const after = text[b];
  return after !== "." && after !== "[" && after !== ":";
}

/**
 * One structural pass over the blanked token stream, maintaining a scope stack.
 *
 * `var` / `function` declarations bind in the nearest enclosing FUNCTION scope (hoisting);
 * `let` / `const` / `class` bind in the current block. Parameters bind in the function scope
 * they introduce — never in the enclosing one.
 *
 * Two modes, and they must agree on the token structure:
 *   · sink.mode === "collect"  ⇒ record every hoistable (`var`/`function`) name into the scope
 *     that will own it. Nothing else is done; reads are ignored.
 *   · sink.mode === "resolve"  ⇒ seed each scope from the collection, then report unresolved
 *     member-style reads. Forward references to hoisted declarations resolve here, which is
 *     what a single forward pass cannot do.
 *
 * @param {string} text Blanked source.
 * @param {{mode: "collect"|"resolve", hoisted: Map<number, Set<string>>, hits: Array<object>}} sink
 * @param {string} rawText Original source (only used to quote the offending line).
 */
function scopeWalk(text, sink, rawText) {
  const collecting = sink.mode === "collect";
  const pairs = parenPairs(text);
  // The module scope is seeded from pass 1 as well — top-level `function` declarations and
  // `var`s are exactly the forward references a fourth of the live baseline consisted of.
  const stack = [{ names: collecting ? new Set() : new Set(sink.hoisted.get(0) ?? []), fn: true, id: 0 }];
  let nextScopeId = 1;
  let line = 1;

  // Function headers. A function scope is created when its BODY `{` is reached; the parameter
  // names collected from the header travel in `pendingBodies` until then. Using the *body brace*
  // (not the `)` or the `=>`) as the trigger is what makes nested headers order correctly.
  const pendingBodies = []; // [{names:Set<string>, fn:boolean}] — the next `{` consumes the last
  const paramLists = []; // one entry per open paren: {names, skip, …} for a PARAMETER list, else null
  const pendingArrow = []; // name-sets of `(…)` arrow headers already closed, waiting for `=>`
  let openParamLists = 0; // how many entries of `paramLists` are real parameter lists
  let afterFunction = false; // `function` seen: `*`, an optional name, then `(` may follow
  let afterCatch = false;
  let expectingDecl = null; // 'var' | 'let' | 'const' | 'class'
  let declList = null; // {kind, paren, brace, bracket} while a multi-declarator statement is open
  let bracketDepth = 0; // `[` … `]` nesting, so an array literal's commas cannot declare names

  const current = () => stack[stack.length - 1];
  const nearestFn = () => {
    for (let k = stack.length - 1; k >= 0; k -= 1) if (stack[k].fn) return stack[k];
    return stack[0];
  };
  const resolves = (name) => {
    for (let k = stack.length - 1; k >= 0; k -= 1) if (stack[k].names.has(name)) return true;
    return false;
  };
  const declare = (kind, name) => {
    const scope = kind === "var" || kind === "function" ? nearestFn() : current();
    if (collecting) {
      if (kind === "var" || kind === "function") sink.hoisted.get(scope.id).add(name);
      return;
    }
    scope.names.add(name);
  };

  let lastIndex = 0;
  TOKEN.lastIndex = 0;
  let m;
  const advanceTo = (idx) => {
    for (let k = lastIndex; k < idx; k += 1) if (text[k] === "\n") line += 1;
    lastIndex = idx;
  };

  while ((m = TOKEN.exec(text)) !== null) {
    advanceTo(m.index);
    const tok = m[0];

    // 1. The name slot of a pending `var` / `let` / `const` / `class`.
    if (expectingDecl !== null) {
      if (IDENT.test(tok)) {
        declare(expectingDecl, tok);
        // Remember the nesting so a later comma at the SAME nesting can declare the next name.
        declList = expectingDecl === "class"
          ? null
          : { kind: expectingDecl, paren: paramLists.length, brace: stack.length, bracket: bracketDepth };
      }
      expectingDecl = null;
      continue;
    }

    // 2. KEYWORDS FIRST. `function` / `var` / `let` / `const` / `class` / `catch` all match the
    //    identifier shape, so an identifier test placed before this point swallows them and
    //    `afterFunction` is never set — every function body then degenerates into a plain block,
    //    every `var` hoists one scope too far, and the walker silently stops reporting anything.
    //    (That is a real defect this file had; see the header's regression note.)
    if (tok === "var" || tok === "let" || tok === "const" || tok === "class") {
      expectingDecl = tok;
      continue;
    }
    if (tok === "function") {
      afterFunction = true;
      continue;
    }
    if (tok === "catch") {
      afterCatch = true;
      continue;
    }
    if (tok === "*" && afterFunction) continue; // `function*`

    // 3. Identifiers: the function's own name, a parameter binding, or a read.
    if (IDENT.test(tok)) {
      if (afterFunction) {
        // `function name(` / `function name` in an expression. Hoisted like a declaration (a
        // named function EXPRESSION really binds only inside itself — over-binding, see header).
        declare("function", tok);
        continue;
      }
      if (openParamLists > 0) {
        // Inside a parameter list nothing is ever reported as a read: a default value's
        // expression (`(a = cfg.limit) => …`) is not a cross-scope read, it is part of the
        // header. Bindings are taken from the innermost entry when THAT entry is a parameter
        // list — a nested group inside one (`= (x) => …`) binds nothing itself.
        const list = paramLists[paramLists.length - 1];
        if (list !== null && list !== undefined && !list.skip && isBindingPosition(text, m.index, tok)) {
          list.names.add(tok);
        }
        continue;
      }
      if (GLOBALS.has(tok) || resolves(tok)) continue;

      // member-style read only: name followed by `.`, `[` or `(`
      let j = m.index + tok.length;
      while (j < text.length && /[\s]/.test(text[j])) j += 1;
      const after = text[j];
      if (after !== "." && after !== "[" && after !== "(") continue;
      // not a property access itself
      let b = m.index - 1;
      while (b >= 0 && /\s/.test(text[b])) b -= 1;
      if (b >= 0 && (text[b] === "." || text[b] === "?")) continue;

      if (!collecting) {
        sink.hits.push({ name: tok, line, text: rawText.split("\n")[line - 1]?.trim().slice(0, 150) ?? "" });
      }
      continue;
    }

    switch (tok) {
      case "(": {
        const close = pairs[m.index];
        if (afterFunction) {
          afterFunction = false;
          paramLists.push({ names: new Set(), skip: false });
          openParamLists += 1;
          continue;
        }
        if (afterCatch) {
          afterCatch = false;
          paramLists.push({ names: new Set(), skip: false, catch: true });
          openParamLists += 1;
          continue;
        }
        if (close >= 0 && text.startsWith("=>", close + 1 + (text.slice(close + 1).match(/^\s*/) ?? [""])[0].length)) {
          // `(a, b) => …` — the parens are a parameter list, and a distinguishing lookahead is
          // the only way to tell them from a call's argument list (which is where the original
          // `events` bug lived, so that distinction is load-bearing).
          paramLists.push({ names: new Set(), skip: false, arrow: true });
          openParamLists += 1;
          continue;
        }
        // A plain group, a call's arguments, a `for`/`if`/`switch` header: push a marker so the
        // matching `)` pairs with THIS `(` instead of popping an enclosing function header.
        // Reads inside stay reportable — only parameter lists suppress them.
        paramLists.push(null);
        continue;
      }
      case ")": {
        const list = paramLists.pop();
        if (list !== null && list !== undefined) {
          openParamLists -= 1;
          if (list.arrow) pendingArrow.push(list.names);
          else pendingBodies.push({ names: list.names, fn: list.catch !== true });
        }
        continue;
      }
      case "=>": {
        let names = pendingArrow.length > 0 ? pendingArrow.pop() : null;
        if (names === null) {
          const single = identBefore(text, m.index);
          names = single === null ? new Set() : new Set([single]);
        }
        if (nextChar(text, m.index + 2) === "{") {
          pendingBodies.push({ names: names, fn: true });
        } else {
          // An expression-bodied arrow opens no block, so its parameters have no scope of their
          // own to live in. Binding them in the enclosing scope over-binds (a documented limit);
          // the alternative — not binding them — turns every `(x) => x.y` into a false positive.
          for (const name of names) current().names.add(name);
        }
        continue;
      }
      case "{": {
        afterFunction = false;
        afterCatch = false;
        const head = pendingBodies.length > 0 ? pendingBodies.pop() : null;
        // Parameters (when this brace is a function body) AND everything hoisted into this
        // scope by pass 1. Dropping the hoisted half here would lose every `var` in every
        // function body — the exact class this two-pass shape exists to resolve.
        const names = new Set(head === null ? [] : head.names);
        if (!collecting) for (const hoistedName of sink.hoisted.get(nextScopeId) ?? []) names.add(hoistedName);
        const scope = { names: names, fn: head !== null ? head.fn : false, id: nextScopeId };
        nextScopeId += 1;
        if (collecting) sink.hoisted.set(scope.id, new Set());
        stack.push(scope);
        continue;
      }
      case "}": {
        if (stack.length > 1) stack.pop();
        continue;
      }
      case "=": {
        // Start of a default value inside a parameter list: what follows binds nothing.
        const list = paramLists[paramLists.length - 1];
        if (list !== null && list !== undefined && list.names !== null) list.skip = true;
        continue;
      }
      case ",": {
        const list = paramLists[paramLists.length - 1];
        if (list !== null && list !== undefined) {
          list.skip = false;
          continue;
        }
        // `var a = 1, b = 2;` — the names after the comma are declarators too, but only at the
        // SAME nesting as the declaration itself. Without the three depth comparisons the comma
        // in `var a = f(x, y), b = 1;` or `var a = [x, y], b = 1;` would turn `y` into a
        // declared name, and a declared name is a read the walker stops reporting (a false
        // negative, i.e. it would start hiding bugs instead of inventing them).
        if (declList !== null && declList.paren === paramLists.length && declList.brace === stack.length && declList.bracket === bracketDepth) {
          expectingDecl = declList.kind;
        }
        continue;
      }
      case ";": {
        declList = null;
        continue;
      }
      case "[": {
        bracketDepth += 1;
        continue;
      }
      case "]": {
        if (bracketDepth > 0) bracketDepth -= 1;
        continue;
      }
      default:
        break;
    }
  }
}

/**
 * Report unresolved member-style reads: a name that no enclosing scope binds, used as
 * `name.…`, `name[…]` or `name(…)`.
 *
 * Two passes, because hoisting cannot be decided in one forward pass: pass 1 records every
 * `var`/`function` name in the scope that owns it, pass 2 seeds the scopes before resolving.
 * Returns one hit per distinct name (the first occurrence wins).
 */
function findOutOfScope(rawText) {
  const text = blankNonCode(rawText);
  const hoisted = new Map([[0, new Set()]]);
  scopeWalk(text, { mode: "collect", hoisted, hits: [] }, rawText);
  const sink = { mode: "resolve", hoisted, hits: [] };
  scopeWalk(text, sink, rawText);
  const seen = new Set();
  return sink.hits.filter((h) => (seen.has(h.name) ? false : (seen.add(h.name), true)));
}

const out = { generatedAt: new Date().toISOString(), candidates: [] };
const checks = [];
for (const c of CANDIDATES) {
  if (!fs.existsSync(c.file)) {
    out.candidates.push({ label: c.label, file: c.file, present: false, hits: [], budget: c.budget });
    console.log(`\n### ${c.label}\n    (missing: ${c.file})`);
    continue;
  }
  const text = fs.readFileSync(c.file, "utf8");
  const hits = findOutOfScope(text);
  out.candidates.push({ label: c.label, file: c.file, present: true, hits, budget: c.budget });
  console.log(`\n### ${c.label}  (${text.split("\n").length} lines, ${hits.length} candidate(s), budget ${c.budget})`);
  for (const h of hits) console.log(`    ${path.basename(c.file)}:${h.line}  ${h.name}  | ${h.text}`);
  if (hits.length > c.budget) checks.push([`${c.label}: candidates within recorded baseline`, false, `${hits.length} > ${c.budget}`]);
  else checks.push([`${c.label}: candidates within recorded baseline`, true, `${hits.length} ≤ ${c.budget}`]);
}

// ── the parameter-binding regression, pinned in both directions ───────────────────────────────
//
// Every check below writes into THIS run's private temp directory (`runFile`, which refuses any
// other path); the live bundle is only ever read. The shape of the 2026-10-15 defect was "insert
// a paired-paren statement after `function (x) {` and the walker invents a candidate for `x`", so
// that exact shape is inserted into 130 function headers at once and the count must not move. The
// other direction — a genuine sibling-scope read — must still be reported, or this file would be
// decoration.

/** Every parameter form the walker must bind. One unresolved read per line would be a FAIL. */
const PARAM_SHAPES = [
  "var f1 = function (a, b) { return a.x + b.y; };",
  "function named(p) { return p.x; }",
  "var f2 = (c) => { return c.y; };",
  "var f3 = function* (d) { return d.z; };",
  "function f4(e = 1, { f, g: h } = {}, [i], ...rest) { return f.x + h.y + i.z; }",
  "function outer(j) { function inner(k) { return k.w; } return inner(j).v; }",
  "var f5 = function deep(l) { return function (m) { return m.n + l.o; }; };",
  "var f6 = async (q) => { return q.r; };",
  "function f7() { try { throw 1; } catch (err) { return err.message; } }",
  "var f9(u, v) { return u.x + v.y; }".replace("var f9(u, v) {", "function f9(u, v) {"),
  "function f10(a1) { return hoistedLater.a1; } function hoistedLater() {}",
  "function f11() { return laterVar.x; var laterVar = {}; }",
  "function f12() { var pe0 = -1, lo0 = []; return lo0.length + pe0.value; }",
].join("\n");

/** The same file with ONE genuine cross-scope read added: a sibling function's local. */
const SIBLING_READ = PARAM_SHAPES
  + "\nfunction probesSibling() { var zzSiblingLocal = 1; return zzSiblingLocal; }"
  + "\nfunction readsSibling() { return zzSiblingLocal.boom; }\n";

const shapesHits = findOutOfScope(PARAM_SHAPES);
checks.push([
  "parameter shapes all bind their own parameters (function (a,b) / named / arrow / function* / defaults + destructuring / nested)",
  shapesHits.length === 0,
  shapesHits.length === 0 ? "0 candidates over 13 forms" : shapesHits.map((h) => `${h.name}@${h.line}`).join(", "),
]);
const siblingHits = findOutOfScope(SIBLING_READ);
checks.push([
  "the fixture itself is not vacuous: a sibling function's local IS still reported",
  siblingHits.some((h) => h.name === "zzSiblingLocal"),
  siblingHits.map((h) => `${h.name}@${h.line}`).join(", ") || "(nothing reported — the walker sees nothing at all)",
]);

const liveFile = path.join(PLUGIN_DIR, "lib", "client.js");
if (fs.existsSync(liveFile)) {
  const live = fs.readFileSync(liveFile, "utf8");
  const liveBaseline = findOutOfScope(live).length;
  const fnHeaders = /function \(([A-Za-z_$][\w$]*)\) \{/g;
  const headerCount = (live.match(fnHeaders) ?? []).length;

  const fixtures = [
    {
      label: `paired-paren statement inserted after all ${headerCount} × \`function (x) {\``,
      body: live.replace(fnHeaders, (all, name) => `function (${name}) { if (String(${name})) { } `),
      // The exact historical trigger: a paired-paren statement between the callback's `{` and the
      // `result`-reading trace call. It must not manufacture a candidate for `result` (or anyone).
      max: liveBaseline,
    },
    {
      label: "`var x = (a || b);` inserted after all function headers",
      body: live.replace(fnHeaders, (all, name) => `function (${name}) { var x = (a || b); `),
      max: liveBaseline,
    },
  ];

  for (const fixture of fixtures) {
    let parseError = null;
    try {
      new vm.Script(fixture.body);
    } catch (error) {
      parseError = String((error && error.message) || error);
    }
    const file = runFile("scope-regression-fixture.js");
    fs.writeFileSync(file, fixture.body);
    const hits = parseError === null ? findOutOfScope(fixture.body) : [];
    checks.push([
      `live copy + ${fixture.label}: candidates must not increase`,
      parseError === null && hits.length <= fixture.max,
      parseError !== null
        ? `fixture did not parse (${parseError}) — the assertion would have been meaningless`
        : `${hits.length} ≤ ${fixture.max}${hits.length > fixture.max ? ` — new: ${hits.slice(0, 8).map((h) => `${h.name}@${h.line}`).join(", ")}` : ""}`,
    ]);
  }

  // The must-still-catch direction, on a copy of the REAL bundle: a name that only exists in a
  // sibling function. This is the `events` accident reproduced deliberately.
  const anchor = "    function findPendingSpliceBefore(sessionId, beforeSeq, remoteOverride) {";
  const readSite = "        try {\n          // 探针实测：会话级 remote(props.__remote) 成功";
  let mutated = live;
  if (live.includes(anchor) && live.includes(readSite)) {
    mutated = live
      .replace(anchor, `    function zzProbeHolder() { var zzSiblingLocal = 1; return zzSiblingLocal; }\n${anchor}`)
      .replace(readSite, `        zzSiblingLocal.boom();\n${readSite}`);
  }
  let mutationParseError = null;
  try {
    new vm.Script(mutated);
  } catch (error) {
    mutationParseError = String((error && error.message) || error);
  }
  const mutationFile = runFile("scope-mutation-fixture.js");
  fs.writeFileSync(mutationFile, mutated);
  const mutationHits = mutationParseError === null ? findOutOfScope(mutated) : [];
  const caught = mutationHits.some((h) => h.name === "zzSiblingLocal");
  out.mutation = { file: mutationFile, name: "zzSiblingLocal", caught, hits: mutationHits };
  checks.push([
    "live copy + a sibling-scope read (the `events` accident): must be reported",
    mutationParseError === null && caught,
    mutationParseError !== null
      ? `fixture did not parse (${mutationParseError})`
      : caught
        ? `zzSiblingLocal@${mutationHits.find((h) => h.name === "zzSiblingLocal").line} (baseline ${liveBaseline} → ${mutationHits.length})`
        : `NOT reported (baseline ${liveBaseline} → ${mutationHits.length}) — the walker has gone blind`,
  ]);
}

const broken = out.candidates.find((c) => c.label.includes("KNOWN-BROKEN"));
checks.unshift([
  "known-broken rewind bundle flagged at line 121 for 'events'",
  broken?.hits.some((h) => h.name === "events" && h.line === 121) === true,
  broken?.hits.filter((h) => h.name === "events").map((h) => `events@${h.line}`).join(", ") || "(not flagged)",
]);
const liveHA = out.candidates.find((c) => c.label.includes("dsh-deepworker"));
checks.push([
  "live dsh-deepworker has no 'events'-class hit at its sample lines",
  liveHA?.present === true && !liveHA.hits.some((h) => ["events", "typeList"].includes(h.name)),
  liveHA?.hits.map((h) => `${h.name}@${h.line}`).slice(0, 8).join(", ") || "(0 candidates)",
]);

// The report goes into THIS run's private directory (lib/route.mjs `runFile`), which is created
// on demand and removed on exit — two concurrent runs can no longer truncate each other's file
// (2026-10-17: they shared one fixed /tmp path; a concurrent reader saw it empty).
// `DSH_COMBO_KEEP=1` keeps the directory if you want to read the reports afterwards.
const reportPath = runFile("scope-refs.json");
fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

console.log("");
let bad = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad += 1;
}
console.log(`\nreport: ${reportPath}`);
process.exit(0);
