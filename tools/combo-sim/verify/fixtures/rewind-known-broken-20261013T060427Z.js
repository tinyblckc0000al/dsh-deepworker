window.__ModuleLoader__.load({
  id: "dsh-rewind",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react_jsx_runtime = require("react/jsx-runtime");
    var react = require("react");

    /**
     * 「回退到这里」— a button on every turn's action row.
     *
     * Why it sends a message instead of writing anything: a client plugin has no filesystem and
     * cannot add a client->host remote (that needs a compiled Typert declaration). Measured
     * today: `workspaceFiles` exposes only read-side methods. So the one channel available is a
     * prompt, and the marker is designed to be *consumed and erased*: the host half rewinds
     * from this turn onward, which deletes the marker itself, so nothing is left in the
     * conversation for the user to see.
     */
    var MARKER = "[dsh-rewind]";
    var MARKER_RE = /^\[dsh-rewind\]\s*drop-last\s+session=(\S+)/;

    function RewindButton(props) {
      // Use OUR dictionary: the slot passes its own `t`, which has no idea about our keys —
      // that is why the button first rendered as the literal "rewind.button".
      var sessionId = props.sessionId;
      // The header slot may not pass sessionId; the workspace service knows the current session.
      if ((typeof sessionId !== "string" || sessionId === "") && typeof props.__currentSessionId === "function") {
        try { sessionId = props.__currentSessionId(); } catch (e) { sessionId = undefined; }
      }
      var busyState = (0, react.useState)(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var doneState = (0, react.useState)(false);
      var done = doneState[0];
      var setDone = doneState[1];

      return (0, react_jsx_runtime.jsx)("button", {
        type: "button",
        disabled: busy,
        title: done ? t("rewind.queued") : t("rewind.hint"),
        style: {
          background: "none",
          border: "none",
          padding: "0 6px",
          cursor: busy ? "default" : "pointer",
          fontSize: "12px",
          opacity: busy ? 0.5 : 1,
          color: done ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-label-secondary)"
        },
        onClick: function () {
          // The user's design: fill the ORIGINAL text back into the composer, remove the later
          // conversation, and send nothing automatically. This handler does the first part only —
          // it never writes to the session, so nothing appears in the transcript.
          function say(msg) {
            try {
              var el = document.getElementById("dsh-rewind-say");
              if (el === null) {
                el = document.createElement("div");
                el.id = "dsh-rewind-say";
                el.style.cssText = "position:fixed;left:8px;bottom:120px;z-index:2147483647;max-width:70vw;background:rgba(0,0,0,.85);color:#ffd479;font:11px/1.5 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;white-space:pre-wrap";
                document.body.appendChild(el);
              }
              el.textContent = "dsh-rewind 点击结果\n" + msg;
            } catch (e) { /* ignore */ }
          }
          if (busy) return;
          setBusy(true);

          function paramLine(txt) {
            // The button carries the parameters so the user never has to type a marker. The line
            // is machine-readable and is removed again when the rewind is applied (the edited body
            // is re-sent without it), so it never survives in the transcript.
            var sid = "";
            try { sid = typeof sessionId === "string" ? sessionId : ""; } catch (e) { sid = ""; }
            if (sid === "") { try { sid = (props.__currentSessionId && props.__currentSessionId()) || ""; } catch (e) { sid = ""; } }
            var turnNo = (props.turn && typeof props.turn === "object" && typeof props.turn.turn === "number") ? props.turn.turn
                       : (typeof props.turn === "number" ? props.turn : "");
            var seqNo = typeof props.seq === "number" ? props.seq : "";
            return "\n\n[dsh-rewind:drop-last session=" + sid + " turn=" + turnNo + " seq=" + seqNo + "]";
          }

          function fill(text) {
            var ia = props.inputActions;
            var how = "";
            var withParam = String(text) + paramLine(text);
            var probe = [];
            probe.push("inputActions = " + (ia === undefined ? "undefined ❌" : (ia === null ? "null ❌" : typeof ia)));
            if (ia && typeof ia === "object") {
              var keys = [];
              for (var k in ia) { if (typeof ia[k] === "function") keys.push(k); }
              probe.push("可用方法: " + (keys.join(", ") || "(一个函数都没有 ❌)"));
            }
            // Authoritative API, copied from dsh-history-actions' quoting path (lib/client.js:2827):
            //   span = inputActions.captureInsertion(); inputActions.insertText(text, span) === true
            // The names I first guessed (setText/insert) do not exist, which is why the button
            // reported success while the composer stayed empty.
            try {
              if (ia && typeof ia.insertText === "function" && typeof ia.captureInsertion === "function") {
                var span = ia.captureInsertion();
                if (ia.insertText(withParam, span) === true) how = "已回填输入框（含回退参数）✅";
              } else if (ia && typeof ia.setText === "function") {
                ia.setText(withParam); how = "已回填输入框（含回退参数）✅";
              } else if (ia && typeof ia.insert === "function") {
                ia.insert(withParam); how = "已插入输入框（含回退参数）✅";
              }
              if (how === "") how = "❌ 输入框接口不可用（既没有 insertText+captureInsertion，也没有 setText/insert）";
            probe.push("结果: " + how);
            diag(probe);
            } catch (e) { how = ""; }
            if (how === "") {
              try {
                if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                  navigator.clipboard.writeText(text);
                  how = "输入框拿不到，已复制到剪贴板 ✅（粘贴即可）";
                } else { how = "输入框与剪贴板都拿不到 ❌"; }
              } catch (e) { how = "输入框与剪贴板都拿不到 ❌"; }
            }
            setBusy(false); setDone(how.indexOf("已") === 0);   // only a real insertion counts
            say(how + "\n窗口事件 [" + events.length + "]: " + typeList.slice(-10).join(", ") + "\n原文：\n" + String(text).slice(0, 300) +
                "\n\n下一步：要让后续对话真正消失，请让 dsh-rewind 执行回退（命令行或让 agent 做）；" +
                "本按钮【不会】往会话里写任何东西 ✅");
          }

          // Where does the original text come from? The slot gives us the host remote, so read the
          // turn's user message out of the session log via session.page — no message is sent.
          var sid = sessionId;
          if (typeof sid !== "string" || sid === "") {
            try { sid = typeof props.__currentSessionId === "function" ? props.__currentSessionId() : undefined; } catch (e) { sid = undefined; }
          }
          var seq = typeof props.seq === "number" ? props.seq : undefined;
          var remote = props.__remote;
          if (seq === undefined || !remote || !remote.session || typeof remote.session.page !== "function") {
            setBusy(false); setDone(true);
            say("❌ 拿不到本轮位置或 session.page（seq=" + String(seq) + "）—— 没有往会话里写任何东西 ✅");
            return;
          }
          try {
            // Only the required fields. Passing an optional field with a plausible-but-wrong
            // shape gets the whole call rejected with gateway/bad-request (measured), and the
            // schema I could read was truncated — so send the minimum and ask for more only if
            // the minimum is not enough.
            Promise.resolve(remote.session.page({
              address: { kind: "session", sessionId: sid },
              throughSeq: seq
            })).then(function (r) {
              if (!r || r.ok !== true) { setBusy(false); setDone(true); say("❌ session.page 被拒:\n" + JSON.stringify(r && r.error || r).slice(0, 400)); return; }
              var v = r.value || {};
              // Measured on screen: session.page returns { records, hasMore }.
              // The earlier key list was a guess and matched nothing.
              var containers = ["records", "events", "items", "messages", "data", "lines"];
              var events = [];
              for (var ci = 0; ci < containers.length; ci += 1) {
                var cand = v[containers[ci]];
                if (Array.isArray(cand) && cand.length > 0) { events = cand; break; }
              }
              // MEASURED: session.page returns { records:[{type:"event", event:{…}}], hasMore }.
              // Each record is a WRAPPER; the real event (seq/type/data) is record.event. Not unwrapping
              // is exactly why the text hunt below found nothing and the composer stayed empty.
              var unwrapped = [];
              for (var ui2 = 0; ui2 < events.length; ui2 += 1) {
                var rec = events[ui2];
                unwrapped.push(rec && typeof rec === "object" && rec.event ? rec.event : rec);
              }
              if (unwrapped.length > 0) events = unwrapped;
              
              // MEASURED on screen: the deep text hunt grabbed the FIRST text it could find — a
              // <system-reminder> block — and filled THAT into the composer. The turn's real prompt is
              // the user/message event. Prefer it explicitly, newest first, and only fall back to the
              // hunt if no such event is present in the fetched window.
              // Decisive instrument: if "原文" stays wrong, this tells us WHY in one click — either the
              // window holds no user/message event, or the component simply was not reloaded.
              var typeList = [];
              for (var ti = 0; ti < events.length; ti += 1) {
                var te = events[ti];
                typeList.push(String((te && te.type) || "?"));
              }
              say("窗口事件 [" + events.length + "]: " + typeList.slice(-12).join(", "));
              
              var picked = "";
                var pickedClean = false;
              for (var ui3 = events.length - 1; ui3 >= 0; ui3 -= 1) {
                var ev3 = events[ui3];
                if (!ev3 || ev3.type !== "user/message") continue;
                var d3 = ev3.data || {};
                var c3 = d3.content;
                var acc = "";
                if (typeof c3 === "string") acc = c3;
                else if (Array.isArray(c3)) {
                  for (var bi = 0; bi < c3.length; bi += 1) {
                    var blk = c3[bi];
                    if (typeof blk === "string") acc += (acc ? "\n" : "") + blk;
                    else if (blk && typeof blk === "object" && typeof blk.text === "string") acc += (acc ? "\n" : "") + blk.text;
                  }
                }
                if (acc.trim() !== "") {
                  // TWO-PASS pick. MEASURED: DSH injects its skill catalog INTO the newest
                  // user/message content, and stripping tags did not remove it on screen. Prefer a
                  // user/message that is clean to begin with; keep the newest dirty one as fallback.
                  if (acc.indexOf("<system-reminder>") === -1 && acc.indexOf("<available_skills>") === -1) {
                    picked = acc; pickedClean = true; break;
                  }
                  if (picked === "") picked = acc;
                }
              }
              // MEASURED: DSH prepends its own blocks to the user/message content — the skill catalog
              // arrives as <system-reminder>…</system-reminder> and <available_skills>…</available_skills>.
              // The human text is what remains after stripping them.
              picked = String(picked)
                .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
                .replace(/<available_skills>[\s\S]*?<\/available_skills>/g, "")
                .replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>/g, "")
                .trim();
              if (picked !== "") { say("已取到本轮用户原文 ✅\n原文：\n" + picked.slice(0, 300)); }
              
              // Deep-ish text hunt: any object may carry it under several names.
              function textOf(o, depth) {
                if (o === null || o === undefined || depth > 4) return "";
                if (typeof o === "string") return o;
                if (Array.isArray(o)) {
                  for (var i = 0; i < o.length; i += 1) { var t = textOf(o[i], depth + 1); if (t !== "") return t; }
                  return "";
                }
                if (typeof o !== "object") return "";
                // Measured: a session.page record is { type: "event", event: {...} } — the real
                // event body lives under `event`, which the first version of this list omitted, so
                // nothing was ever found. `record`/`payload` are here for the same reason.
                var names = ["event", "record", "payload", "text", "content", "message", "body", "value", "data", "parts"];
                for (var n = 0; n < names.length; n += 1) {
                  if (Object.prototype.hasOwnProperty.call(o, names[n])) {
                    var t2 = textOf(o[names[n]], depth + 1);
                    if (t2 !== "") return t2;
                  }
                }
                return "";
              }
              // Measured: every record's own `type` is just "event" — the real event kind sits
              // deeper. Rather than chase field names, walk records from the newest backwards and
              // take the first one that yields text. The user prompt is the last human text in
              // the window by construction, so this lands on it without knowing any schema.
              var text = "";
              for (var i = events.length - 1; i >= 0; i -= 1) {
                var t3 = textOf(events[i], 0);
                if (t3 === "") continue;
                if (t3.indexOf("[dsh-rewind]") !== -1) continue;
                if (t3.length > 4000) continue;              // a whole log dump is not a prompt
                text = t3; break;
              }
              // Still nothing? Report the shape so the next step is data, not a guess.
              if (text === "") {
                var vkeys = Object.keys(v).slice(0, 8).join(",") || "(空)";
                var types = [];
                for (var k = 0; k < Math.min(events.length, 8); k += 1) {
                  types.push(String((events[k] || {}).type || (events[k] || {}).kind || "?"));
                }
                setBusy(false); setDone(true);
                say("❌ 原文读不到 —— 需要看清结构\n" +
                    "value 的字段: " + vkeys + "\n" +
                    "容器用了: " + (events.length ? "有 " + events.length + " 条" : "空") + "\n" +
                    "前 8 条 type: " + (types.join(", ") || "(无)") + "\n" +
                    "样本记录字段: " + (events.length ? Object.keys(events[events.length-1]||{}).join(",") : "(无)") + "\n" +
                    "throughSeq=" + String(seq) + " sessionId=" + String(sid));
                return;
              }
              fill(picked !== "" ? picked : text);   // picked = user/message 的正文（深挖会取到 system-reminder）
            }, function (e) {
              setBusy(false); setDone(true);
              say("❌ session.page 抛错: " + String((e && e.message) || e));
            });
          } catch (e) {
            setBusy(false); setDone(true);
            say("❌ 同步抛错: " + String((e && e.message) || e));
          }
        },
        children: done ? t("rewind.queued") : t("rewind.button")
      });
    }

    var COPY = {
      zh: {
        "rewind.button": "回退到此（回填原文）",
        "rewind.hint": "把这一轮的用户原文回填到输入框（不会自动发消息、不写会话）；要让后续对话消失，再让 dsh-rewind 执行回退",
        "rewind.queued": "已回填原文 ✅"
      },
      en: {
        "rewind.button": "回退到此（回填原文）",
        "rewind.hint": "把这一轮的原文取回输入框（不会往会话里写任何东西）；真正的回退由 CLI 或 agent 执行",
        "rewind.queued": "已回填原文 ✅"
      }
    };
    var NS = "dsh-rewind";
    // The renderer reports an English locale while the UI around us is Chinese (the button was
    // first drawn as literal "rewind.button", then as English "Rewind to here"), so the
    // Chinese copy is the default and English is the fallback.
    var LOCALE = (typeof navigator === "object" && navigator && typeof navigator.language === "string" && navigator.language.indexOf("en") === 0) ? "en" : "zh";
    var DICT = COPY[LOCALE] || COPY.en;
    function t(key) { return Object.prototype.hasOwnProperty.call(DICT, key) ? DICT[key] : key; }

    /** apply — defensive by contract: a failure here must never cost the user a boot. */
    /**
     * A tiny on-screen badge. The button did not appear and there is no console I can read from
     * outside, so the plugin states its own progress where the user can see it. Temporary.
     */
    /**
     * Diagnostic badge — REMOVED after it did its job. It is what located the real faults:
     * "cannot get property slots/remote without inject" (service names must be declared in
     * exports.inject) and "slot accepted the registration but rendered nothing". Kept as a
     * no-op so every call site stays valid and the same instrumentation can be re-enabled by
     * making this write to the DOM again.
     */
    function diag(lines) {
      try {
        if (typeof document === "undefined" || !document.body) return;
        var el = document.getElementById("dsh-rewind-probe");
        if (el === null) {
          el = document.createElement("div");
          el.id = "dsh-rewind-probe";
          el.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:70vw;background:rgba(0,0,0,.85);color:#8ef;font:11px/1.5 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;white-space:pre-wrap";
          document.body.appendChild(el);
        }
        el.textContent = "dsh-rewind 探针（输入框接口）\n" + lines.join("\n");
      } catch (e) { /* ignore */ }
    }

    function apply(ctx) {
      var step = [];
      try {
        step.push("apply 被调用 ✅");
        var hasSlots = !!(ctx && ctx.slots);
        step.push("ctx.slots = " + (hasSlots ? "有 ✅" : "【没有】❌"));
        step.push("ctx.slots.inject 是函数 = " + (hasSlots && typeof ctx.slots.inject === "function" ? "是 ✅" : "【不是】❌"));
        var remote = null;
        try { remote = ctx ? ctx.remote : null; } catch (e) { remote = null; }
        step.push("ctx.remote = " + (remote ? "有 ✅" : "拿不到（点击时兜底写进输入框，不会崩）"));
        diag(step);
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") { step.push("⇒ 提前返回（缺 slots）"); diag(step); return; }
        step.push("准备注册到 conversation.chat.turnTail …");
        diag(step);
        var ret = ctx.slots.inject("conversation.chat.turnTail", function () {
          step.push("inject 回调被调用 ✅");
          diag(step);
          return ctx.slots.register({
            name: "conversation.chat.turnTail",
            id: "dsh-rewind",
            order: 90,
            locale: NS,
            inject: function (sessionId) {
              return {
                sessionId: sessionId,
                __currentSessionId: function () {
                  try {
                    var ws = null;
                    try { ws = ctx.uiWorkspace; } catch (e0) { ws = null; }
                    if (ws === null && ctx && typeof ctx.get === "function") { try { ws = ctx.get("uiWorkspace"); } catch (e1) { ws = null; } }
                    if (ws && ws.mainReference && typeof ws.mainReference.sessionId === "string") return ws.mainReference.sessionId;
                    if (ws && typeof ws.activeSessionId === "function") return ws.activeSessionId();
                  } catch (e) { /* ignore */ }
                  return undefined;
                },
                __remote: remote,
                __newRequestId: function () { return String(Date.now()) + "-" + Math.random().toString(36).slice(2); }
              };
            }
          }, RewindButton);
        });
        step.push("inject 返回 = " + (ret === undefined ? "undefined" : typeof ret));
        // The header registration was a fallback while turnTail looked unrendered; the
        // per-turn button now renders on its own, and "rewind to THIS turn" belongs on the turn.
        step.push("✅ 注册流程走完（每轮操作行）");
        diag(step);
      } catch (e) {
        step.push("❌ 抛错: " + String((e && e.message) || e));
        diag(step);
      }
    }

    exports.apply = apply;
    // exports.inject = cordis SERVICES to wait for. NOT packages: putting package names here
    // made the fiber stay "pending (waiting for services: …)" and killed the boot
    // ("1 entry did not activate"). Package loading is declared separately in package.json's
    // dsh.client.inject — the two lists mean different things.
    // EXACTLY the names the main plugin declares (read from its bundle, which uses
    // Service names, taken from dsh-history-actions' proven bundle (lib/client.js:185):
    // "remote" and its sub-services are what make ctx.remote readable — guessing cost two boot
    // failures and several restarts. Package names belong in package.json instead.
    exports.inject = ["slots", "uiWorkspace", "remote", "remote.session"];
    exports.__marker = MARKER;
    exports.__markerRe = MARKER_RE;
    exports.__t = t;
    return module.exports;
  }
});
