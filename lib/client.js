window.__ModuleLoader__.load({
  id: "dsh-deepworker",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react_jsx_runtime = require("react/jsx-runtime");
    var react = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    // ── 自包含（2026-10-16）：已撤掉对外置共享层的接线 ──────────────────────────
    // 曾经有一版用 package.json 的 dsh.client.external + require() 去读本仓那个外置共享层
    // 目录（仓库根下的 ha-core 包），但那一版是"阶段 1a：只读数，不切换行为" —— 本文件里这份
    // sameSessionId 一直是真正被调用的那一份，从未切换到共享层那份（见本文件 §2 定义）。
    // 现在共享层已合回本包：没有外部 require，也没有任何外置依赖。
    // 回归守卫在 verify/verify_plugin.mjs：本文件里再出现那个包名即判红。
    /** 共享层是内建的 —— 与 md=builtin 同形：都是编译期事实，不是运行期探测，不可能撒谎。 */
    var CORE_MODE = "builtin";
    // doc-comment probe: primitives.Button("secondary") is a comment, not a call.

    var NS = "dsh-deepworker";
    // Bump on every change: the loaded page can then be identified at a glance
    // ───────────────────────────────────────────────────────────────────────────
    // dsh-deepworker (DeepWorker) — 一个客户端插件，做四件事：
    //   ① 会话操作：重试本轮 / 在此分支 / 编辑重发 / 引用回复 / 选模式新建
    //   ② 笔记：独立一页 —— Markdown 渲染、标签筛选、编辑重存、搜索、导出导入
    //   ③ 总结存入笔记：确定性摘要 · 让模型总结（临时会话，跑完自动归档）
    //   ④ 会话内查找：高亮命中 + 用 anchorKey 定位
    //
    // 分区（按代码顺序）：1 Markdown 渲染 · 2 基础工具 · 3 文案词典 · 4 笔记数据层
    //                    5 会话内查找 · 6 轮内操作组件 · 7 浮层 · 8 apply 接线
    //
    // 三条铁律（违反会静默出错或拖垮宿主；详见 docs/diagnostic-lessons.md）：
    //   A. 组件在 factory 作用域，看不到 apply() 里的任何东西 —— 走 props 或 testHooks。
    //   B. 每个贡献必须经 guard 隔离：apply 里抛一次 = "1 entry did not activate" = App 起不来。
    //   C. 用户触发的动作要么生效、要么说话 —— 不许静默 return。
    // ───────────────────────────────────────────────────────────────────────────

    // (console line + the caption in the mode dialog), which makes "did my
    // refresh actually take?" answerable without guessing.
    var BUILD = "2026-10-21T19:37Z";
    /** Installed package version. Keep in sync with package.json (the gate asserts it). */
    var VERSION = "0.1.5";
    var UPDATE_REGISTRY_URL = "https://registry.npmjs.org/dsh-deepworker/latest";
    var UPDATE_PAGE_URL = "https://www.npmjs.com/package/dsh-deepworker";
    var REPO_URL = "https://github.com/tinyblckc0000al/dsh-deepworker";
    var UPDATE_TIMEOUT_MS = 4000;
    // Filled by apply(). Two callers share it: the test harness, and factory-scope
    // components that need an apply-scope reader (a component cannot see apply's
    // scope, and a bare call there is a ReferenceError that crashes a slot entry).
    /** How long a finished session may show no records before we call the read broken. */
    var EMPTY_PAGE_GRACE_MS = 60000;
    /**
     * One line that answers "which build is this, and is the markdown renderer
     * reachable?" — the two facts every rendering question here starts with. Asking
     * the user to describe what they see is slower and less exact than this.
     */
    function buildStatus() {
      return "DeepWorker · " + BUILD + " · md=builtin · core=" + CORE_MODE;
    }

    /** Strict enough for npm versions: 1.2.3, optional prerelease. */
    function versionParts(value) {
      var match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
      if (match === null) return null;
      return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] || "" };
    }
    /** Numeric compare; stable > prerelease. Unknown versions compare equal (never claim an update). */
    function compareVersions(a, b) {
      var pa = versionParts(a);
      var pb = versionParts(b);
      if (pa === null || pb === null) return 0;
      if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
      if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
      if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
      if (pa.pre === pb.pre) return 0;
      if (pa.pre === "") return 1;
      if (pb.pre === "") return -1;
      return pa.pre > pb.pre ? 1 : -1;
    }
    /** Manual-only registry read. Never called at load; the UI calls it from the button. */
    function fetchLatestVersion() {
      return new Promise(function (resolve, reject) {
        if (typeof fetch !== "function") { reject(new Error("fetch unavailable")); return; }
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timer = setTimeout(function () { if (controller !== null) controller.abort(); }, UPDATE_TIMEOUT_MS);
        var options = { cache: "no-store", headers: { accept: "application/json" } };
        if (controller !== null) options.signal = controller.signal;
        fetch(UPDATE_REGISTRY_URL, options).then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        }).then(function (body) {
          clearTimeout(timer);
          var version = body && body.version;
          if (versionParts(version) === null) throw new Error("invalid version");
          resolve(String(version));
        }, function (error) {
          clearTimeout(timer);
          reject(error);
        });
      });
    }
    /**
     * Built-in markdown rendering for notes.
     *
     * The app's own renderer (`primitives.MarkdownText`) is not reliably reachable from
    // ── 1. Markdown 渲染（内建实现，不依赖宿主符号是否可达）───────────────────
     * a third-party bundle, and when it is missing a fallback must still render — a note
     * showing literal `#` and `**` is a broken note. This covers what notes actually
     * contain: headings, bold/italic, inline code, links, fenced code, lists, quotes,
     * rules, paragraphs.
     */
    var MD = {
      h: [15, 14, 13, 13, 12, 12],
      code: { background: "var(--dsw-alias-bg-layer-1)", border: "0.5px solid var(--dsw-alias-border-l4)", borderRadius: "4px", padding: "0 4px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
      pre: { background: "var(--dsw-alias-bg-layer-1)", border: "0.5px solid var(--dsw-alias-border-l4)", borderRadius: "var(--dsw-radius-lg)", padding: "10px 12px", overflowX: "auto", margin: "0 0 8px" },
      quote: { borderLeft: "2px solid var(--dsw-alias-border-l4)", paddingLeft: "10px", color: "var(--dsw-alias-label-secondary)", margin: "0 0 8px" },
      link: { color: "var(--dsw-alias-label-primary)", textDecoration: "underline" },
      list: { margin: "0 0 8px", paddingLeft: "22px" },
      rule: { border: "0", borderTop: "0.5px solid var(--dsw-alias-border-l4)", margin: "10px 0" }
    };
    function mdInline(text, keyBase) {
      var out = [];
      var rest = String(text == null ? "" : text);
      var re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]+\))/;
      var n = 0;
      while (rest !== "") {
        var m = re.exec(rest);
        if (!m) { out.push(rest); break; }
        if (m.index > 0) out.push(rest.slice(0, m.index));
        var tok = m[0];
        var key = keyBase + "_" + (n++);
        if (tok.slice(0, 2) === "**") out.push((0, react_jsx_runtime.jsx)("strong", { children: tok.slice(2, -2) }, key));
        else if (tok.charAt(0) === "`") out.push((0, react_jsx_runtime.jsx)("code", { style: MD.code, children: tok.slice(1, -1) }, key));
        else if (tok.charAt(0) === "[") {
          var link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
          out.push(link
            ? (0, react_jsx_runtime.jsx)("a", { href: link[2], target: "_blank", rel: "noreferrer noopener", style: MD.link, children: link[1] }, key)
            : tok);
        } else out.push((0, react_jsx_runtime.jsx)("em", { children: tok.slice(1, -1) }, key));
        rest = rest.slice(m.index + tok.length);
      }
      return out.length === 0 ? [""] : out;
    }
    function mdBlocks(text, keyBase) {
      var lines = String(text == null ? "" : text).split("\n");
      var blocks = [];
      var i = 0, k = 0;
      var bullet = /^\s*[-*+]\s+/;
      var ordered = /^\s*\d+[.)]\s+/;
      var isBlockStart = /^(\s*```|\s*#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>) /;
      while (i < lines.length) {
        var line = lines[i];
        var key = keyBase + "_b" + (k++);
        if (/^\s*```/.test(line)) {
          var buf = []; i++;
          while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
          i++;
          blocks.push((0, react_jsx_runtime.jsx)("pre", { style: MD.pre, children: (0, react_jsx_runtime.jsx)("code", { children: buf.join("\n") }) }, key));
          continue;
        }
        var head = /^(#{1,6})\s+(.*)$/.exec(line);
        if (head) {
          var level = head[1].length;
          blocks.push((0, react_jsx_runtime.jsxs)("div", {
            style: { fontSize: MD.h[level - 1] + "px", fontWeight: level <= 2 ? 600 : 500, lineHeight: "22px", margin: "0 0 6px", color: "var(--dsw-alias-label-primary)" },
            children: mdInline(head[2], key)
          }, key));
          i++; continue;
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          blocks.push((0, react_jsx_runtime.jsx)("hr", { style: MD.rule }, key));
          i++; continue;
        }
        if (bullet.test(line) || ordered.test(line)) {
          var listRe = bullet.test(line) ? bullet : ordered;
          var isOrdered = !bullet.test(line);
          var items = [];
          while (i < lines.length && listRe.test(lines[i])) { items.push(lines[i].replace(listRe, "")); i++; }
          var rows = items.map(function (item, index) {
            return (0, react_jsx_runtime.jsxs)("li", { style: { margin: "0 0 2px" }, children: mdInline(item, key + "_i" + index) }, key + "_i" + index);
          });
          blocks.push(isOrdered
            ? (0, react_jsx_runtime.jsx)("ol", { style: MD.list, children: rows }, key)
            : (0, react_jsx_runtime.jsx)("ul", { style: MD.list, children: rows }, key));
          continue;
        }
        if (/^\s*>\s?/.test(line)) {
          var quoted = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
          blocks.push((0, react_jsx_runtime.jsxs)("div", { style: MD.quote, children: mdInline(quoted.join(" "), key) }, key));
          continue;
        }
        if (/^\s*$/.test(line)) { i++; continue; }
        var para = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart.test(lines[i])) { para.push(lines[i]); i++; }
        blocks.push((0, react_jsx_runtime.jsxs)("div", { style: { margin: "0 0 8px" }, children: mdInline(para.join(" "), key) }, key));
      }
      return blocks;
    }
    /** Render note text. Always produces markdown, never raw `#`/`**`. */
    function MarkdownBody(props) {
      var text = props && typeof props.text === "string" ? props.text : "";
      return (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "14px", lineHeight: "22px", wordBreak: "break-word" }, children: mdBlocks(text, "md") });
    }

    var testHooks = {};
    /**
    // ── 2. 基础工具：构建标记 / 时间戳 / 转义 ────────────────────────────
     * Reload the whole client. The Desktop app wires no reload shortcut at all
     * (`Cmd+R` and `Cmd+Shift+R` both do nothing), so a plugin-owned command and a
     * button in the settings section are the only manual way to force a re-fetch of
     * the boot graph and its bundles.
     */
    // Shortcut registration outcomes, surfaced in the settings page. A silently
    // swallowed rejection is how the commands went missing from ⌘/ before.
    var shortcutStatus = {};
    // Set by the "open notes and search" command so the page focuses its box on mount.
    var pendingNotesSearch = false;
    // The `turnOutline` projection is only reachable from a slot that receives
    // `useProjection` (the turnTail), while the digest runs on the notes page.
    // The mounted turn row publishes it here, tagged with its session.
    var latestOutline = { sessionId: null, entries: [] };
    /** "MM-DD HH:MM" — enough to tell two look-alike sessions apart, locale-neutral. */
    function formatStamp(ms) {
      if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "";
      var d = new Date(ms);
    // ── 3. 文案词典：zh / en 键集必须完全一致（verify_i18n 强制）───────────────
      var pad = function (n) { return n < 10 ? "0" + n : String(n); };
      return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    var inject = ["slots", "sessions", "layout", "shortcuts", "uiConversation", "uiWorkspace", "remote", "remote.session", "remote.agentPresets", "remote.workspace", "remote.workspaceFiles", "remote.terminal", "locale"];

    var zh = {
      "action.retry": "重试本轮",
      "action.branch": "在此分支",
      "action.resend": "编辑重发",
      "action.quote": "引用回复",
      "quickAsk.action": "随手百科",
      "quickAsk.title": "随手百科",
      "quickAsk.failed": "随手百科失败：",
      "quickAsk.loading": "正在查…",
      "quickAsk.saveNote": "存入笔记",
      "quickAsk.saved": "已存入笔记",
      "quickAsk.newSession": "生成新会话",
      "quickAsk.newSessionFailed": "生成会话失败：",
      "quickAsk.sessionInstruction": "以下内容作为背景，不要现在回答；等我输入指令后再处理。",
      "phrase.button": "短语",
      "phrase.empty": "还没有短语，点「管理」添加。",
      "phrase.manage": "管理短语",
      "phrase.done": "完成",
      "phrase.add": "添加短语",
      "phrase.label": "名称",
      "phrase.text": "内容",
      "phrase.delete": "删除",
      "phrase.insertFailed": "插入短语失败：先把光标放回输入框。",
      "quickAsk.noAnswer": "没有拿到回答。",
      "menu.quoteSelection": "引用选中文字",
      "menu.saveNote": "存为笔记",
      "menu.newInWorkspace": "在此工作区新建引用对话",
      "menu.listenerFailed": "这个菜单命令没能执行（已记下原因）：",
      "menu.jumpToQuote": "跳到引用出处",
      "quote.selection": "↳ 引自在会话中选中的文字",
      "quote.provenance": "↳ 引自本轮第 {turn} 轮",
      "quote.turnLabel": "第 {turn} 轮",
      "quote.clipped": "（引文过长已截断，完整内容见对应轮次）",
      "quote.noComposer": "当前会话没有可写入的输入框",
      "find.button": "在本次会话中查找（已加载的窗口内）",
      "find.buttonShort": "查找",
      "find.placeholder": "在本次会话中查找…",
      "find.prev": "上一个（Shift+Enter）",
      "find.next": "下一个（Enter）",
      "find.close": "关闭（Esc）",
      "find.notInWindow": "这一轮不在已加载的窗口里：往上翻加载历史后再试",
      "quote.jumpFailed": "那一轮不在已加载的窗口里：往上翻加载历史后再试",
      "quote.jumpNoPhrase": "这次引用没有记录被引用的正文（可能是手打/复制来的锚点）",
      "quote.insertFailed": "没能插进输入框（光标位置丢了），引用没有写进去；再点一次或先点一下输入框",
      "notes.title": "笔记",
      "notes.add": "添加",
      "notes.placeholder": "随手记一条，比如：硬刷新 Cmd + Shift + R",
      "notes.empty": "还没有笔记。写一条，之后可以随时翻出来复制。",
      "notes.copy": "复制",
      "notes.delete": "删除",
      "notes.copied": "已复制到剪贴板",
      "notes.unit": "条",
      "notes.back": "返回对话",
      "notes.searchTitle": "打开笔记并搜索",
      "digest.button": "总结当前对话存为笔记",
      "digest.buttonShort": "存为笔记",
      "digest.optTitle": "总结并存入笔记",
      "digest.modeLabel": "总结方式",
      "digest.modeAuto": "确定性摘要",
      "digest.modeModel": "让模型总结",
      "digest.modelHint": "会新建一个临时会话，把你的要求和这段对话一起交给模型；跑完自动归档。会花 token，并需要等待几秒到几十秒。",
      "digest.modelRequirement": "你想要的总结（自由描述）。例如：只摘和部署有关的，用三点，给同事看的语气。",
      "digest.modelBusy": "模型总结中…",
      "digest.modelProgress": "进度：",
      "digest.modelStarting": "已发出，等待模型…",
      "digest.modelCanLeave": "可以关掉这个窗口去干别的：任务在后台继续，完成或失败时会有提示。",
      "digest.modelFailed": "模型总结失败",
      "digest.cleanupFailed": "临时会话归档失败（它会留在侧栏，可手动归档）",
      "digest.errorLabel": "失败原因（可选中复制）",
      "digest.modelUnavailable": "模型总结当前不可用（插件未就绪）",
      "digest.optHint": "默认是「确定性摘要」：全程本地、不调用模型、不花 token；关键词按字面匹配（轮次里出现这几个字才收录），长度和格式只影响排版。它忠于原文，但不懂同义词，也可能漏掉语义相关却没出现关键词的轮次。想要语义理解：在总结弹窗的「总结方式」里切到「让模型总结」（会新建临时会话、花 token，等几秒到几十秒）。",
      "digest.optKeyword": "字面关键词，如：部署, 队列（留空 = 全部轮次）",
      "digest.optTags": "标签，逗号分隔（可空）",
      "digest.optLength": "回答长度",
      "digest.optLengthShort": "短",
      "digest.optLengthMid": "中",
      "digest.optLengthLong": "长",
      "digest.optFormat": "格式",
      "digest.optFormatOutline": "编号大纲",
      "digest.optFormatMd": "Markdown 列表",
      "digest.optFormatPlain": "纯文本",
      "digest.optSave": "存为笔记",
      "digest.optCancel": "取消",
      "digest.noHost": "没能打开选项气泡：当前会话还没有可承载它的组件（先滚动一下对话或等本轮结束再试）。",
      "digest.saved": "已存为一条笔记",
      "digest.savedTotal": "共",
      "digest.nothing": "这个会话还没有可总结的内容",
      "digest.head": "【会话摘要 · {title}】",
      "digest.meta": "{turns} 轮 · 改动 {files} 个文件",
      "digest.asks": "诉求：",
      "digest.files": "改动：",
      "settings.title": "DeepWorker",
      "settings.nativeNotice": "提醒用系统通知（屏幕右上角，可进通知中心）",
      "settings.quoteProvenance": "引用时写入出处行（↳ 引自本轮第 N 轮）",
      "settings.retryNote": "重试时附带「已改动这些文件」提示",
      "settings.debugResendTrace": "调试：编辑重发时输出诊断跟踪（默认关；打开后会改写会话标题）",
      "settings.archiveOriginal": "编辑重发 / 重试时默认归档原对话",
      "settings.reloadHint": "插件或功能开关改动后请 Cmd+Q 完全退出再开；重载界面不会重建插件宿主。",
      "update.title": "版本与更新",
      "update.current": "当前版本",
      "update.idle": "手动检查 npm 上的最新版本。",
      "update.check": "检查更新",
      "update.checking": "检查中…",
      "update.latest": "已是最新版本",
      "update.available": "有新版本 {version}",
      "update.failed": "检查失败：{detail}",
      "update.manual": "打开发布页",
      "update.repo": "打开仓库",
      "update.copy": "复制更新命令",
      "update.copied": "已复制",
      "update.hint": "只检查，不自动安装；升级后请 Cmd+Q 完全重启。",
      "update.network": "网络不可用或被拦截",
      "settings.storage": "笔记存储位置：只在这台电脑的浏览器里（localStorage），不进对话、不占 token。设备间迁移：先打开侧栏的「笔记」页，在那一页点「复制全部」导出、点「导入」粘贴回来。",
      "settings.shortcutsHint": "除「会话内查找」默认绑 ⌘F（web 端 ⌘⌥F）外，其余命令都不预设按键（避免和其它插件冲突），可在 ⌘ / 面板里自行指派。",
      "settings.shortcutStatus": "命令注册状态：",
      "settings.applyFailures": "启动时有贡献注册失败：",
      "settings.lastJump": "上次跳转诊断（没高亮时才有）：",
      "focus.title": "专注锁",
      "focus.lockSession": "锁定本会话",
      "focus.unlockSession": "立即解锁",
      "focus.unknown": "状态还没读出来：页面会自己读一次，也可以点「刷新状态」重新读。",
      "focus.free": "未锁定",
      "focus.locked": "🔒 专注中",
      "focus.refresh": "刷新状态",
      "focus.report": "把自检发给我",
      "focus.headerLock": "专注：锁住其它会话，只留这一个可用（30 分钟，可随时解）",
      "focus.headerLockShort": "专注",
      "focus.headerUnlock": "解除专注（其它会话恢复可用）",
      "focus.headerUnlockShort": "解除专注",
      "focus.requestLock": "【专注锁】请锁住其它会话，只留这个会话可用（30 分钟，冷却 0）。",
      "focus.requestUnlock": "【专注锁】请解除专注：其它会话恢复可用。",
      "focus.sentLock": "已发送专注请求（其它会话将被锁住）",
      "focus.sentUnlock": "已发送解锁请求",
      "focus.sendFailed": "请求发送失败：",
      "focus.rowLocked": "已锁住：专注期间不可用",
      "focus.dialogTitle": "专注：锁住其它会话",
      "focus.dialogHint": "选一个时长，然后直接锁上 —— 只留当前会话可用，不会往对话里发任何消息。",
      "focus.dialogConfirm": "锁上",
      "focus.remaining": "剩余",
      "focus.until": "到",
      "focus.howToUnlock": "提前解：点标题栏的「解除专注」，或设置里的「立即解锁」",
      "focus.expired": "专注已结束：其它会话恢复可用（同时发出系统通知，窗口最小化也能看到）",
      "focus.defaultsTitle": "默认专注配置",
      "focus.defaultsHint": "开启后，点头部「专注」直接按下面的范围和时长上锁，不再弹窗。",
      "focus.defaultsEnable": "使用默认配置，不弹窗",
      "focus.defaultsEnableHint": "关闭时仍会弹出范围/时长选择框。",
      "focus.defaultsScope": "默认范围",
      "focus.defaultsMinutes": "默认时长",
      "focus.defaultsSession": "本会话",
      "focus.defaultsWorkspace": "当前工作区",
      "focus.defaultsMinutesHint": "1–10080 分钟",
      "focus.scopeLabel": "白名单：",
      "focus.scopeFallback": "没找到这个会话所属的工作区（它可能还没归组），已按【只留当前会话】上锁",
      "focus.scopeSession": "只留当前会话",
      "focus.scopeWorkspace": "只留当前工作区",
      "focus.lockedWorkspace": "已锁上其它工作区（{n} 分钟）—— 本工作区内的会话都可用",
      "focus.customLabel": "自定义时长：",
      "focus.minutesUnit": "分钟（最多 10080 = 7 天）",
      "focus.minutes": "{n} 分钟",
      "focus.lockedLocal": "已锁上其它会话（{n} 分钟）—— 只留当前会话可用",
      "focus.unlockedLocal": "已解除专注，其它会话恢复可用",
      "focus.wrapBlocked": "🔒 专注中：已拦下切换会话（剩 {n}s）。",
      "focus.wrapWorkspace": "🔒 专注中（工作区粒度）：工作区粒度暂不可用，已放行。",
      "focus.wrapUnlock": "想提前脱身：点标题栏的「解除专注」，或设置 → DeepWorker 里的「立即解锁」。",
      "focus.wrapEscaped": "已解除专注并撤掉拦截：其它会话恢复可用",
      "focus.wrapEscapeFailed": "已撤掉拦截（本地锁写入失败：请重载界面，或手动清 dsh.deepworker.focusLocal）。",
      "common.cancel": "取消",
      "notice.title": "通知哪些会话",
      "notice.hint": "①「只通知本会话」= 其它会话的提示全部静默；②「静音/取消静音本会话」逐个会话屏蔽；③「清除范围设置」恢复通知全部。",
      "notice.onlyThis": "只通知本会话",
      "notice.muteThis": "静音/取消静音本会话",
      "notice.clear": "清除范围设置",
      "notice.onlySet": "已设为只通知：",
      "notice.muted": "已静音：",
      "notice.unmuted": "已取消静音：",
      "notice.cleared": "已清除范围设置（恢复通知全部会话）",
      "notice.noSession": "拿不到当前会话 id，无法设置范围。",
      "focus.requested": "已把请求写进输入框，按回车即可：",
      "settings.applyFailures.toast": "DeepWorker 有贡献注册失败（详见 设置 → DeepWorker）：\n",
      "digest.turnLine": "{index}. {prompt} → {response}",
      "digest.noPrompt": "(无提问)",
      "digest.noResponse": "(无回答)",
      "notes.pageHint": "随手记的命令和提醒 —— 只存在这台浏览器里，不进对话、不占 token。",
      "retry.note": "（说明：本轮之前有一次尝试在完成前中断了，它已经改动过这些文件：{paths}。请先确认它们的现状再继续，不要重复覆盖。）",
      "notes.search": "搜索笔记…（Ctrl/⌘ + F）",
      "notes.clear": "清除",
      "notes.count": "{shown} / {total} 条",
      "notes.noMatch": "没有匹配的笔记",
      "notes.tagAll": "全部",
      "notes.edit": "编辑",
      "notes.editSave": "保存",
      "notes.editCancel": "取消",
      "notes.editHint": "⌘/Ctrl+Enter 保存 · Esc 取消 · 内容按 Markdown 渲染",
      "notes.edited": "笔记已更新",
      "notes.tagAdd": "标签",
      "notes.tagConfirm": "加上",
      "notes.tagCancel": "取消",
      "notes.tagPlaceholder": "标签，逗号分隔",
      "notes.tagFiltered": "已筛选",
      "notes.export": "复制全部",
      "notes.exported": "全部笔记已复制到剪贴板（JSON）。换电脑后点「导入」粘贴回来即可。",
      "notes.exportFailed": "复制失败：剪贴板不可用",
      "notes.import": "导入",
      "notes.importHint": "粘贴「复制全部」得到的 JSON；或者每行一条直接粘。重复的会自动跳过。",
      "notes.importConfirm": "确认导入",
      "notes.importCancel": "取消",
      "notes.imported": "已导入",
      "notes.writeFailed": "没能写入本地存储（改动不会保留）：",
      "notes.stored": "库存 {count} 条",
      "notes.dropped": "超出上限丢弃 {count} 条",
      "notes.copyFailed": "复制失败（剪贴板不可用）：",
      "notes.emptyEdit": "正文清空后没有可保存的内容",
      "notes.savedFromSelection": "选中内容已存为笔记",
      "notes.selectionEmpty": "没有选中任何内容",
      "notes.fromClipboard": "从剪贴板存为笔记",
      "notes.clipboardEmpty": "剪贴板里没有文本",
      "notes.clipboardFailed": "读不到剪贴板（可能没有权限）。把内容粘贴到下面，再点「存为笔记」。",
      "notes.clipboardHint": "把剪贴板内容粘贴到这里（⌘/Ctrl+V），然后存为笔记。",
      "notes.clipboardSave": "存为笔记",
      "notes.clipboardCancel": "取消",
      "notes.clipboardSaved": "已从剪贴板存为笔记",
      "modal.resend.title": "编辑并重新发送",
      "resend.running": "这一轮还在跑：确定后会先把它停下，再在新分支里发出。",
      "resend.runningEditReady": "已停止本轮，原文已填回输入框；修改后发送即可。",
      "resend.runningEditNoComposer": "已停止本轮，但当前输入框没有可写入的接口。",
      "resend.runningEditAttachments": "这条消息含图片/附件：回填只带文字，附件需要重新添加。",
      "resend.wireParts": "发送失败，请求形状：{parts}",
      "resend.sendingBranch": "已切到新分支，正在发送…",
      "resend.sentBranch": "已发送到新分支，等待回复。",
      "resend.preparing": "正在准备附件…",
      "resend.prepared": "附件准备完成，正在创建分支…",
      "resend.prepareTimeout": "准备附件超时（15 秒），没有创建分支。",
      "resend.cancelFailed": "没能停下正在跑的那一轮（它可能仍在继续）：",
      "resend.cancelUnavailable": "这个版本没法自动停下正在跑的那一轮：新内容会排队，请先按 Esc Esc 停一下。",
      "resend.archiveFailed": "新分支已发出，但原对话没能归档（它还在列表里）：",
      "retry.noteFailed": "没能读出这次改动过的文件，重试的交接说明会缺失：",
      "dialog.busy": "上一步还没结束，请稍等（按钮已禁用）",
      "error.timeout": "操作超时（两分钟没有返回）",
      "resend.noBoundary": "读不到这一轮的起点，没法安全重发（退到\"轮末\"会把原消息一起带过去）。请改用「在此分支」。",
      "resend.trace": "重发跟踪：fork atSeq={at} · 本轮 start={start} / end={end} · 上一轮 seq={prev}",
      "resend.traceSplice": "重发跟踪：发现待办 splice@{splice} ⇒ 边界前移到 {cut}",
      "resend.tracePage": "重发跟踪·page：ok={ok} err={err} 事件数={n}",
      "resend.traceChild": "重发跟踪：子会话={child}（fork 点 {at}）",
      "resend.empty": "这条消息的原文读不到（本轮内容可能不在已加载窗口里），所以没法重发。",
      "retry.noText": "读不到这一轮的原文（本轮内容可能不在已加载窗口里），没法重试。",
      "retry.noBoundary": "定位不到这一轮的起点，没法新建分支。",
      "modal.resend.hint": "DSH 的会话日志只追加、已发送的消息无法原地改写，所以这里会在这一轮之前开一个延续分支，把编辑后的内容作为新消息发出。勾选下面的选项会把原对话归档，让它看起来就是同一段对话被改了。",
      "modal.resend.archive": "把原对话归档（可在「归档」里找回）",
      "modal.resend.submit": "发送",
      "inline.addImage": "添加图片",
      "inline.removeImage": "移除图片",
      "inline.noContent": "文字和图片至少保留一项。",
      "action.newMode": "选模式新建",
      "modal.newMode.title": "新建对话并选择模式",
      "modal.newMode.hint": "DSH 在会话开始后就锁定预设，所以只有全新对话能选模式。这里会新建一个对话、应用你选的模式，并把下面指定的对话作为引用上下文带过去。",
      "modal.newMode.modeLabel": "模式",
      "modal.newMode.sourceLabel": "引用对话",
      "modal.newMode.sourceCurrent": "（当前对话）",
      "modal.newMode.sourceEmpty": "（没有可引用的对话）",
      "modal.newMode.workspaceLabel": "工作区",
      "modal.newMode.workspaceNew": "＋ 新建工作区…",
      "modal.newMode.workspacePicking": "正在选择目录…",
      "modal.newMode.workspaceEmpty": "（没有已注册的工作区，将使用默认目录）",
      "modal.newMode.placeholder": "（可选）想对这段引用对话说的话；留空则默认「请基于上面引用的对话继续」",
      "modal.newMode.submit": "创建并发送",
      "modal.newMode.loading": "正在加载模式…",
      "error.fork": "创建分支失败",
      "error.prompt": "发送失败",
      "error.presets": "加载模式失败",
      "error.presetSelect": "设置模式失败",
      "error.workspace": "工作区操作失败",
      "ref.noSession": "找不到当前会话，无法定位引用",
      "ref.notFound": "找不到这条引用的原始会话记录：可能不在已加载的窗口里（往上翻加载历史再点），或记录已被压缩移除",
      "quote.empty": "（无内容）",
      "quote.noAssistant": "这条回复还没有可引用的正文；先选中要引用的文字。",

      // ── 设置页改版 + 功能开关（2026-10-15）──────────────────────────────────────
      "settings.section.debug": "调试",
      "settings.failureBanner": "⚠ {commands} 个命令注册失败 · {contributions} 项贡献注册失败（详见下方「调试」）",
      "settings.shortcutNone": "（没有已注册的命令）",
      "settings.coreProbe": "核心探针：",
      "feature.offPrefix": "未引入：",
      "feature.hintGenericOff": "这个功能不会被注册（不挂槽位、不开定时器、不装监听器、不注册命令）；Cmd+Q 完全退出再开后生效。",
      "feature.hintFocusLockOff": "不注册切换会话的拦截器，也不画侧栏掩层；Cmd+Q 完全退出再开后彻底不拦。",
      "feature.hintNoticeOff": "系统通知与气泡都不再注册（插件自身的错误提示仍然会显示）。",
      "feature.hintFindOff": "查找按钮、快捷键命令与查找栏都不注册，入口整个消失。",
      "feature.hintQuoteOff": "右键菜单项、引用芯片与出处行都不注册。",
      "feature.hintDigestOff": "摘要按钮与命令都不注册，也不会再新建临时会话。",
      "feature.hintNotesOff": "笔记页、侧栏入口与搜索命令都不注册；已存的笔记不会被删除。",
      "feature.hintTurnActionsOff": "重试 / 在此分支 / 编辑重发 / 选模式新建的入口与命令都不注册。",
      "feature.hintTerminalOff": "会话头部的启动 / 停止按钮不注册（槽位条目整个消失），也不会开任何终端。",
      "settings.versionTitle": "构建版本",
      "settings.section.storage": "存储位置",
      "settings.featureSummary": "未引入 {n} 项：{list}",
      "settings.featureAllOn": "全部功能都已引入",
      "settings.featureAllOnHint": "「移除」= 这个功能根本不注册（不挂槽位、不开定时器、不装监听器、不注册命令），所以要 Cmd+Q 完全退出再开才生效。",
      "settings.debugHint": "诊断读数：出问题时先来这里。",
      "feature.section": "功能引入 / 移除",
      "feature.disabled": "{name} 已关闭（设置 → DeepWorker 里可以打开）",
      "feature.nameFocusLock": "专注锁",
      "feature.nameNotice": "通知与气泡",
      "feature.nameFind": "会话内查找",
      "feature.nameQuote": "引用",
      "feature.nameDigest": "摘要",
      "feature.nameNotes": "笔记",
      "feature.nameTurnActions": "轮次操作",
      "feature.offSuffix": "未引入",
      "feature.notesOffBanner": "笔记功能已关闭（设置 → DeepWorker → 功能开关 里可以打开）。存下来的笔记没有被删除。",
      "settings.unlockLocalHint": "只影响这台电脑上的拦截：立即解锁并撤掉切换会话的拦截，不发送任何消息。",
      "settings.unlockLocalShort": "不动拦截之外的东西",
      // ── 设置页四 tab 改版（2026-10-16）──────────────────────────────────────────
      // 每个新键都必须被真实引用（verify_hygiene 会红），这里是唯一的定义处。
      "settings.tab.basic": "基础",
      "settings.tab.focus": "专注锁",
      "settings.tab.notes": "笔记",
      "settings.tab.actions": "会话操作",
      "settings.tab.terminal": "命令按钮",
      "settings.tabsLabel": "DeepWorker 设置分区",
      "feature.descFocusLock": "锁住其它会话，只留这一个可用；随时可解。",
      "feature.descNotice": "把提醒发到系统通知中心（屏幕右上角，可进通知中心）。",
      "feature.descFind": "在已加载的会话窗口里查找并高亮命中。",
      "feature.descQuote": "把选中的文字作为带出处的引用写进输入框。",
      "feature.descDigest": "把当前对话压成一条笔记（确定性摘要，或让模型总结）。",
      "feature.descNotes": "侧栏脚的笔记页：Markdown、标签、搜索、导出导入。",
      "feature.descTurnActions": "重试 / 在此分支 / 编辑重发 / 选模式新建。",
      "settings.turnActionsHint": "这些操作各自挂在轮末的槽位上；移除后槽位不再注册，入口整行消失。",
      "settings.tabIntroOff": "该功能未引入 —— 到「基础」里打开它",
      // 2026-10-17：用户原话「为什么会话操作里已经有的开关，基础页要再挂一遍？」——
      // 实测**没有重复**（会话操作里那几行是各功能**自己的设置**，本页这 7 档是
      // 注册级的总开关）。所以缺的只是一句话：把两种开关的区别写在卡片标题下面。
      "settings.featureScopeNote": "这些开关只决定装不装某个功能：关掉 = 它不再注册，入口会消失。每个功能自己的设置在各自的分区里，不受这里的按钮影响。",
      // ── 2026-10-16 第 4 轮：「一键全开 / 全关」总开关 ───────────────────────────
      // 关之前必须先解锁 ⇒ 下面几句里有"已先解除专注锁"这一类**顺序回执**；解锁失败那句
      // 必须说清"一个功能都没关"（宁可关不掉，也不能把人锁死）。
      "settings.masterSwitch": "全部功能（一键全开 / 全关）",
      "settings.masterDescOn": "关掉它 = {total} 档全部移除（移除之前会先解除所有专注锁）",
      "settings.masterDescPartial": "现在只引入了 {on}/{total} 档 —— 打开它 = 全部引入；关掉它 = 全部移除",
      "settings.masterDescOff": "打开它 = {total} 档全部引入",
      "settings.masterOnDone": "已把 {total} 档功能全部引入",
      "settings.masterOffDone": "已先解除专注锁（{scopes}），再把 {total} 档功能全部移除",
      "settings.masterOffNoLock": "本机没有生效中的专注锁；已把 {total} 档功能全部移除",
      "settings.focusOffDone": "已先解除专注锁（{scopes}），再关闭「专注锁」",
      "settings.focusOffNoLock": "本机没有生效中的专注锁；已关闭「专注锁」",
      "settings.masterUnlockFailed": "没能解除专注锁（{detail}），所以一个功能都没关 —— 宁可关不掉，也不能把你锁在里面",
      "settings.masterHookMissing": "设置页与动作内核没接上（这是缺陷）：所以什么都没改",
      "settings.scopeSession": "会话级",
      "settings.scopeWorkspace": "工作区级",
      // ── 终端按钮（2026-10-16）────────────────────────────────────────────────
      // 头部一组「启动 / 停止」按钮：点一下 = 在该会话的工作区新开一个终端跑那条命令。
      // 命令是用户自己敲的（信任级别等同他在终端手打），所以不做二次确认。
      "term.buttonStart": "启动",
      "term.buttonStop": "停止",
      "term.emptyCommand": "「{label}」还没配命令 —— 到 设置 → DeepWorker → 命令按钮 里给这个工作区填一条。",
      "term.noCwd": "拿不到这个会话的工作区（cwd），所以不知道在哪儿跑。没有开终端。",
      "term.noRemote": "这个客户端的终端服务不可用（ctx.remote.terminal 不在），没有开终端。",
      "term.notIntroduced": "「终端按钮」这一档没有引入（设置 → DeepWorker → 基础）。",
      "term.alreadyRunning": "「{label}」还在运行，等它结束再点。",
      "term.stateRunning": "运行中",
      "term.stateDone": "成功",
      "term.stateFailed": "失败",
      "term.starting": "正在启动：{command}",
      "term.createFailed": "开终端失败（{step}）：{detail}",
      "term.stepCreate": "create",
      "term.stepRetain": "retain",
      "term.stepFollow": "follow",
      "term.stepWrite": "write",
      "term.beforeRunning": "「{label}」的前置命令第 {n} 条仍在运行，所以后面的命令没有执行。",
      "term.done": "「{label}」执行完毕，退出码 {code}。",
      "term.doneFail": "「{label}」执行完毕，但退出码是 {code}（失败）。",
      "term.stillRunning": "「{label}」命令写进去了；{seconds}s 内没等到结束标记 ⇒ 判定为仍在运行（对常驻服务这是正常的，不算失败）。",
      "term.streamEnded": "终端在命令跑完之前就结束了（没有出现结束标记）。",
      "term.aborted": "这次运行被取消/超时打断了。",
      "term.unexpected": "终端调用抛了异常：{detail}",
      "term.diagPrefix": "上次启动：",
      "term.diagOk": "成功（退出码 {code}）",
      "term.diagFail": "失败（退出码 {code}）",
      "term.diagRunning": "仍在运行（{seconds}s 内没结束）",
      "term.diagError": "出错：{detail}",
      "term.diagAborted": "已取消",
      "term.settingsTitle": "命令按钮",
      "term.settingsHint": "头部按钮按**当前会话的工作区**解析；终端不在侧栏面板、不显示输出。每一档只负责启动 / 停止。",
      "term.startLabelLabel": "「启动」的按钮文字",
      "term.stopLabelLabel": "「停止」的按钮文字",
      "term.startCommandLabel": "启动命令",
      "term.stopCommandLabel": "停止命令",
      "term.startBeforeLabel": "点「启动」时，先按顺序跑这些命令",
      "term.startBeforeHint": "这里只配「启动」前要跑的命令：只能挑已定义的动作（停止，或填了命令的额外按钮），每个最多一次；为空 = 直接跑启动命令。额外按钮自己的前置在它那一行的「前置」里配。",
      "term.startBeforeEmpty": "（没有前置命令）",
      "term.sequenceAdd": "加入",
      "term.sequenceAddAll": "全部加入",
      "term.sequencePickPlaceholder": "选择动作…",
      "term.sequenceRemove": "移出序列",
      "term.sequenceUp": "上移",
      "term.sequenceDown": "下移",
      "term.logToFile": "把输出写入 .dsh-deepworker/logs/",
      "term.logToFileHint": "每次运行一个文件；常驻服务会持续写。日志可能包含敏感信息。",
      "term.logsTitle": "最近输出（{n}）",
      "term.logsShow": "查看",
      "term.logsHide": "收起",
      "term.logsClear": "清空",
      "term.logsEmpty": "还没有运行记录。",
      "term.logsCopy": "复制输出",
      "term.logsCopied": "已复制输出",
      "term.logsCopyFailed": "复制失败",
      "term.logsPath": "日志文件",
      "term.timeoutLabel": "判定「仍在运行」前等多少秒",
      "term.timeoutHint": "命令跑完后终端会回一行结束标记；等这么久还没等到，就判定为仍在运行（常驻服务会一直是这样，不是失败）。",
      "term.fileTitle": "从工作区文件读取",
      "term.fileToggle": "从文件导入",
      "term.fileHint": "agent 可以写当前工作区里的这个 JSON 文件，再点「立即读取」批量回填；不轮询、不自动执行命令。",
      "term.filePath": "文件",
      "term.fileRead": "立即读取",
      "term.fileReading": "读取中…",
      "term.fileMissing": "未找到文件（现有配置保持不变）",
      "term.fileApplied": "已应用 {n} 个工作区",
      "term.fileUnchanged": "文件没变化",
      "term.fileInvalid": "文件有错误，未应用",
      "term.fileNoCwd": "拿不到当前会话的工作区（cwd），无法定位文件",
      "term.fileNoApi": "当前环境不支持读取工作区文件",
      "term.fileFailed": "读取或写入失败",
      "term.fileReplaced": "文件会整份替换现有工作区列表",
      "term.fileErrors": "错误",
      "term.cwdLabel": "当前工作区",
      "term.save": "保存",
      "term.saveFailed": "没能写入本地存储：{detail}",
      "term.reset": "恢复默认",
      "term.resetDone": "已恢复默认（启动 / 停止两条命令被清空）",
      "term.seqStart": "启动命令",
      "term.commandPlaceholder": "要跑的命令（留空 = 这个按钮不做事）",
      "term.commandTooLong": "命令最多 {max} 个字符；请缩短或拆到前置序列。",
      "term.commandFatal": "拒绝：这条命令可能删除系统/主目录或破坏磁盘（{rule}）。请改写后再保存。",
      "term.labelPlaceholder": "按钮文字",
      "term.preview": "预览：点「{start}」会依次跑 → {list}",
      // ── 多工作区 + 批量（2026-10-17 第 2/3 段）────────────────────────────────
      // 用户原话："完整的应该是支持添加/移除多个工作区，某个工作区可独立配置这些功能，
      // 自定义启动/停止等命令"、"支持勾选多个工作区一键开启/关闭功能"。
      "term.wsHint": "每个工作区独立配置自己的启动 / 停止命令与额外按钮；头部那一组按钮按**当前会话的工作区**解析。",
      "term.wsListTitle": "工作区（{n}）",
      "term.wsNone": "还没有添加任何工作区 —— 在下面填一个绝对路径加进来，或用上面的「把当前工作区加入列表」。",
      "term.wsAddTitle": "新建工作区",
      "term.wsPathPlaceholder": "工作区绝对路径（例如 /path/to/project）",
      "term.wsCreate": "创建",
      "term.wsCancel": "取消",
      "term.wsColName": "名称",
      "term.wsColWorkspace": "工作区",
      "term.wsColPath": "路径",
      "term.wsColStart": "启动",
      "term.wsColStop": "停止",
      "term.wsColExtra": "额外",
      "term.wsColActions": "操作",
      "term.wsPick": "选择目录…",
      "term.wsPickUnavailable": "这个客户端没有可用的目录选择器 —— 直接在输入框里填绝对路径即可。",
      "term.wsBadPath": "路径必须是绝对路径（以 / 开头）。没有添加。",
      "term.wsExists": "这个工作区已经在列表里了。",
      "term.wsAdded": "已添加工作区：{label}",
      "term.wsEdit": "配置",
      "term.wsRemove": "移除",
      "term.wsRemoveHint": "「移除」只删这条配置：不删任何文件、不停止任何进程。",
      "term.wsRemoved": "已移除配置：{label}（没有删任何文件，也没有停任何进程）",
      "term.wsSaved": "已保存这个工作区的配置",
      "term.wsLabelLabel": "显示名",
      "term.wsLabelPlaceholder": "显示名（留空 = 用路径末段）",
      "term.wsCurrentIn": "已在列表里 —— 头部会显示它的按钮。",
      "term.wsCurrentNot": "还没加入列表 ⇒ 头部**不会**显示命令按钮。加到下面就来。",
      "term.wsAddCurrent": "把当前工作区加入列表",
      "term.wsNoStart": "没配启动命令",
      "term.wsNoStop": "没配停止命令",
      "term.editorTitle": "正在配置：{label}",
      "term.editorHint": "这些命令会先 cd 到这个工作区自己的目录再跑。",
      "term.editorEmpty": "选中左侧的工作区后在这里配置。",
      "term.extraTitle": "额外按钮",
      "term.extraHint": "填按钮文字和命令；保存后按钮出现在会话头部，命令在这个工作区里执行。",
      "term.extraPreTitle": "前置",
      "term.extraPreFor": "前置命令：{label}",
      "term.extraPreHint": "只在这个按钮执行前跑，按顺序；只能选已定义动作，每个最多一次。不影响启动。",
      "term.extraPreEmpty": "（没有前置命令）",
      "term.extraPreClose": "收起",
      "term.sequenceNoActions": "还没有可加入的动作：先给停止或额外按钮填命令。",
      "term.sequenceNoMore": "没有更多可加入的动作：额外按钮需要先填命令；每个动作最多加入一次。",
      "term.extraEmpty": "（没有额外按钮）",
      "term.extraAdd": "加一个按钮",
      "term.headerTitle": "顶部按钮",
      "term.headerHint": "选择哪些动作出现在会话头部，并调整顺序；全部取消则不显示整组。",
      "term.headerNone": "当前没有选中任何顶部按钮。",
      "term.headerReset": "恢复默认（全部、原顺序）",
      "term.extraRemove": "删除",
      "term.stopBeforeStart": "点「启动」时先跑停止命令",
      "term.stopBeforeStartHint": "打开 = 启动前先执行上面的停止命令。如果前置序列里已经有「停止」，不会重复跑。",
      "term.batchTitle": "批量操作",
      "term.batchStart": "启动选中（{n}）",
      "term.batchStop": "停止选中（{n}）",
      "term.batchDisabled": "先勾选至少一个工作区。",
      "term.batchTooMany": "选中了 {n} 个工作区，但一个会话最多同时持有 {max} 个终端 —— 请减到 {max} 个或更少。**一个都没有启动。**",
      "term.batchRunning": "正在逐个执行：{done}/{total}",
      "term.batchNoSelection": "没有选中任何工作区，一条命令都没有执行。",
      "term.batchMissing": "这条工作区配置已经不在了",
      "term.batchItemFailed": "「{label}」失败：{detail}",
      "term.batchVerbStart": "启动",
      "term.batchVerbStop": "停止",
      "term.batchOkAll": "批量{verb}完成：{ok}/{total} 个成功。",
      "term.batchSummary": "批量{verb}：{ok}/{total} 个成功，{fail} 个失败 —— {list}",
      "term.featureName": "终端按钮",
      "term.featureDesc": "会话头部的启动 / 停止按钮：新开终端跑你配的命令。",
    };
    var en = {
      "action.retry": "Retry this turn",
      "action.branch": "Branch here",
      "action.resend": "Edit & resend",
      "action.quote": "Quote reply",
      "quickAsk.action": "Quick wiki",
      "quickAsk.title": "Quick wiki",
      "quickAsk.failed": "Quick wiki failed: ",
      "quickAsk.loading": "Looking it up…",
      "quickAsk.saveNote": "Save to notes",
      "quickAsk.saved": "Saved to notes",
      "quickAsk.newSession": "New session",
      "quickAsk.newSessionFailed": "Could not create session: ",
      "quickAsk.sessionInstruction": "Treat the following as background. Do not answer now; wait for my instruction.",
      "phrase.button": "Phrases",
      "phrase.empty": "No phrases yet — open Manage to add one.",
      "phrase.manage": "Manage phrases",
      "phrase.done": "Done",
      "phrase.add": "Add phrase",
      "phrase.label": "Name",
      "phrase.text": "Text",
      "phrase.delete": "Delete",
      "phrase.insertFailed": "Could not insert the phrase; click the composer and try again.",
      "quickAsk.noAnswer": "No answer returned.", 
      "menu.quoteSelection": "Quote selection",
      "menu.saveNote": "Save to notes",
      "menu.newInWorkspace": "New referencing chat in this workspace",
      "menu.listenerFailed": "This menu command could not run (reason recorded):",
      "menu.jumpToQuote": "Jump to the quoted source",
      "quote.selection": "↳ quoted from text selected in the conversation",
      "quote.provenance": "↳ quoted from turn {turn}",
      "quote.turnLabel": "turn {turn}",
      "quote.clipped": " (quote was long, so it is clipped; the full text is in the turn)",
      "quote.noComposer": "this conversation has no composer to insert into",
      "find.button": "Find in this conversation (loaded window)",
      "find.buttonShort": "Find",
      "find.placeholder": "Find in this conversation…",
      "find.prev": "Previous (Shift+Enter)",
      "find.next": "Next (Enter)",
      "find.close": "Close (Esc)",
      "find.notInWindow": "That turn is outside the loaded window: scroll up to load history, then try again",
      "quote.jumpFailed": "That turn is outside the loaded window: scroll up to load history, then try again",
      "quote.jumpNoPhrase": "this quote has no recorded body (a hand-typed or copied anchor)",
      "quote.insertFailed": "Could not insert into the composer (the caret position was lost), so the quote was not written: click the composer, then try again",
      "notes.title": "Notes",
      "notes.add": "Add",
      "notes.placeholder": "Jot something down, e.g. hard refresh is Cmd + Shift + R",
      "notes.empty": "No notes yet. Write one and copy it back out whenever you need it.",
      "notes.copy": "Copy",
      "notes.delete": "Delete",
      "notes.copied": "Copied to clipboard",
      "notes.unit": "notes",
      "notes.back": "Back to conversation",
      "notes.searchTitle": "Open notes and search",
      "digest.button": "Summarize this conversation into a note",
      "digest.buttonShort": "Save as note",
      "digest.optTitle": "Summarize into a note",
      "digest.modeLabel": "How to summarize",
      "digest.modeAuto": "Deterministic digest",
      "digest.modeModel": "Let a model summarize",
      "digest.modelHint": "Creates a throwaway session, hands your request and this conversation to the model, then archives it. Costs tokens and takes seconds to a minute.",
      "digest.modelRequirement": "What you want, in your own words. e.g. only what relates to deploys, three bullets, tone for a colleague.",
      "digest.modelBusy": "Model is summarizing…",
      "digest.modelProgress": "Progress:",
      "digest.modelStarting": "sent, waiting for the model…",
      "digest.modelCanLeave": "You can close this window and keep working: it continues in the background and notifies you when it finishes or fails.",
      "digest.modelFailed": "Model summary failed",
      "digest.cleanupFailed": "the throwaway session could not be archived (it stays in the sidebar; archive it manually)",
      "digest.errorLabel": "Reason (selectable — copy it out)",
      "digest.modelUnavailable": "Model summary is unavailable (plugin not ready)",
      "digest.optHint": "The default is the deterministic digest: fully local, no model call, no tokens. Keywords match literally (a turn is kept only when it contains one of them); length and format only shape the output. It is faithful to the source, but it does not understand synonyms and can miss semantically related turns that never mention a keyword. For semantic understanding, switch «How to summarize» to «Let a model summarize» in the summary dialog (a throwaway session, costs tokens, takes a moment).",
      "digest.optKeyword": "Literal keywords, e.g. deploy, queue (empty = every turn)",
      "digest.optTags": "Tags, comma separated (optional)",
      "digest.optLength": "Answer length",
      "digest.optLengthShort": "Short",
      "digest.optLengthMid": "Medium",
      "digest.optLengthLong": "Long",
      "digest.optFormat": "Format",
      "digest.optFormatOutline": "Numbered outline",
      "digest.optFormatMd": "Markdown list",
      "digest.optFormatPlain": "Plain text",
      "digest.optSave": "Save as note",
      "digest.optCancel": "Cancel",
      "digest.noHost": "The options dialog could not open: this conversation has no mounted component to host it yet (scroll the conversation or wait for the turn to finish, then retry).",
      "digest.saved": "Saved as a note",
      "digest.savedTotal": "total",
      "digest.nothing": "This conversation has nothing to digest yet",
      "digest.head": "[Conversation digest · {title}]",
      "digest.meta": "{turns} turns · {files} files changed",
      "digest.asks": "Asks:",
      "digest.files": "Changed:",
      "settings.title": "DeepWorker",
      "settings.nativeNotice": "Deliver notices as system notifications (top right, Notification Center)",
      "settings.quoteProvenance": "Write the source line into a quote (↳ quoted from turn N)",
      "settings.retryNote": "Attach the 'already changed these files' note to a retry",
      "settings.debugResendTrace": "Debug: emit the edit-and-resend trace (off by default; it renames the session title)",
      "settings.archiveOriginal": "Archive the original by default on resend / retry",
      "settings.reloadHint": "After changing the plugin or a feature switch, Cmd+Q and reopen the app; reloading the renderer does not rebuild the plugin host.",
      "update.title": "Version & updates",
      "update.current": "Installed",
      "update.idle": "Check npm for the latest version manually.",
      "update.check": "Check for updates",
      "update.checking": "Checking…",
      "update.latest": "Up to date",
      "update.available": "Version {version} is available",
      "update.failed": "Check failed: {detail}",
      "update.manual": "Open release page",
      "update.repo": "Open repository",
      "update.copy": "Copy update command",
      "update.copied": "Copied",
      "update.hint": "Check only, no automatic install; Cmd+Q fully after upgrading.",
      "update.network": "Network unavailable or blocked",
      "settings.storage": "Notes live only in this browser on this machine (localStorage); they never enter a conversation or cost tokens. To move them across devices, open the Notes page from the sidebar, press Copy all there to export, then Import to paste them back.",
      "settings.shortcutsHint": "Except Find in conversation (⌘F, or ⌘⌥F on the web), these commands ship without default keys (to avoid colliding with other plugins); assign them in the ⌘/ panel.",
      "settings.shortcutStatus": "Command registration:",
      "settings.applyFailures": "A contribution failed to register at startup:",
      "settings.lastJump": "last jump diagnostics (present only when the highlight did not land):",
      "focus.title": "Focus lock",
      "focus.lockSession": "Lock this session",
      "focus.unlockSession": "Unlock now",
      "focus.unknown": "The state has not been read yet: the page reads it once by itself, and Refresh state reads it again.",
      "focus.free": "Not locked",
      "focus.locked": "🔒 Focused",
      "focus.refresh": "Refresh state",
      "focus.report": "Send me the self-check",
      "focus.headerLock": "Focus: lock the OTHER sessions, keeping only this one usable",
      "focus.headerLockShort": "Focus",
      "focus.headerUnlock": "Stop focusing (other sessions become usable)",
      "focus.headerUnlockShort": "Unfocus",
      "focus.requestLock": "[focus-lock] Please lock the OTHER sessions, keeping only this one usable (30 min, cooldown 0).",
      "focus.requestUnlock": "[focus-lock] Please stop focusing: make the other sessions usable again.",
      "focus.sentLock": "Focus request sent (the other sessions will be locked)",
      "focus.sentUnlock": "Unlock request sent",
      "focus.sendFailed": "Could not send the request: ",
      "focus.rowLocked": "Locked out: unavailable while focusing",
      "focus.dialogTitle": "Focus: lock the other sessions",
      "focus.dialogHint": "Pick a duration and lock directly — only this session stays usable, and nothing is sent into the conversation.",
      "focus.dialogConfirm": "Lock",
      "focus.remaining": "left",
      "focus.until": "until",
      "focus.howToUnlock": "To stop early: click \"Unfocus\" in the header, or \"Unlock\" in Settings",
      "focus.expired": "Focus ended: the other sessions are usable again (a system notification was posted too)",
      "focus.defaultsTitle": "Default focus settings",
      "focus.defaultsHint": "When enabled, the header Focus button locks immediately with the scope and duration below — no dialog.",
      "focus.defaultsEnable": "Use defaults, no dialog",
      "focus.defaultsEnableHint": "When off, the scope/duration dialog still opens.",
      "focus.defaultsScope": "Default scope",
      "focus.defaultsMinutes": "Default duration",
      "focus.defaultsSession": "This session",
      "focus.defaultsWorkspace": "This workspace",
      "focus.defaultsMinutesHint": "1–10080 minutes",
      "focus.scopeLabel": "Keep usable:",
      "focus.scopeFallback": "this session is not in any workspace yet, so it locked the session only",
      "focus.scopeSession": "this session only",
      "focus.scopeWorkspace": "this workspace only",
      "focus.lockedWorkspace": "Locked the other workspaces for {n} min — every session in THIS workspace stays usable",
      "focus.customLabel": "Custom:",
      "focus.minutesUnit": "minutes (max 10080 = 7 days)",
      "focus.minutes": "{n} min",
      "focus.lockedLocal": "Locked the other sessions for {n} min — only this one stays usable",
      "focus.unlockedLocal": "Focus off; the other sessions are usable again",
      "focus.wrapBlocked": "🔒 Focusing: the session switch was blocked ({n}s left).",
      "focus.wrapWorkspace": "🔒 Focusing (workspace scope): workspace-level locking is not available, so this was allowed.",
      "focus.wrapUnlock": "To get out early: click \"Unfocus\" in the header, or \"Unlock\" under Settings → DeepWorker.",
      "focus.wrapEscaped": "Focus off and the interception removed: the other sessions are usable again",
      "focus.wrapEscapeFailed": "The interception is removed, but writing the local lock failed: reload the UI, or clear dsh.deepworker.focusLocal manually.",
      "common.cancel": "Cancel",
      "notice.title": "Which sessions notify me",
      "notice.hint": "1) Only this session: everything else is silenced. 2) Mute/unmute this session. 3) Clear scope: notify every session again.",
      "notice.onlyThis": "Only this session",
      "notice.muteThis": "Mute / unmute this session",
      "notice.clear": "Clear scope",
      "notice.onlySet": "Only notifying:",
      "notice.muted": "Muted:",
      "notice.unmuted": "Unmuted:",
      "notice.cleared": "Scope cleared (notify every session again)",
      "notice.noSession": "No session id available; cannot set the scope.",
      "focus.requested": "The request is in the composer — press Enter:",
      "settings.applyFailures.toast": "DeepWorker had a failed contribution (see Settings → DeepWorker):\n",
      "digest.turnLine": "{index}. {prompt} -> {response}",
      "digest.noPrompt": "(no prompt)",
      "digest.noResponse": "(no answer)",

      // ── settings redesign + feature switches (2026-10-15) ─────────────────────
      "settings.section.debug": "Debug",
      "settings.failureBanner": "⚠ {commands} command(s) failed to register · {contributions} contribution(s) failed (details under Debug below)",
      "settings.shortcutNone": "(no commands registered)",
      "settings.coreProbe": "Core probe:",
      "feature.offPrefix": "not introduced: ",
      "feature.hintGenericOff": "the feature is never registered (no slot, no timer, no listener, no command). It takes effect after you reload the interface.",
      "feature.hintFocusLockOff": "the session-switch interceptor and the sidebar dimming are never registered; reload the interface to drop them for good.",
      "feature.hintNoticeOff": "system notifications and bubbles are never registered (the plugin's own error notices still are).",
      "feature.hintFindOff": "the Find button, its shortcut command and the find bar are never registered; the entry disappears entirely.",
      "feature.hintQuoteOff": "the context-menu item, the reference chips and the provenance line are never registered.",
      "feature.hintDigestOff": "the digest button and command are never registered, and no throwaway session is created.",
      "feature.hintNotesOff": "the notes page, the sidebar entry and the search command are never registered; nothing stored is deleted.",
      "feature.hintTurnActionsOff": "the retry / branch / edit-and-resend / new-mode entries and commands are never registered.",
      "feature.hintTerminalOff": "the start / stop buttons in the session header are never registered (the slot entry disappears) and no terminal is ever opened.",
      "settings.versionTitle": "Build",
      "settings.section.storage": "Storage location",
      "settings.featureSummary": "{n} not introduced: {list}",
      "settings.featureAllOn": "Every feature is introduced",
      "settings.featureAllOnHint": "Removing a feature means it is never registered (no slot, no timer, no listener, no command), so it takes effect after you press Reload interface.",
      "settings.debugHint": "Diagnostic readouts: start here when something is wrong.",
      "feature.section": "Introduce / remove features",
      "feature.disabled": "{name} is turned off (you can turn it back on in Settings → DeepWorker)",
      "feature.nameFocusLock": "Focus lock",
      "feature.nameNotice": "Notices & bubbles",
      "feature.nameFind": "Find in conversation",
      "feature.nameQuote": "Quoting",
      "feature.nameDigest": "Digest",
      "feature.nameNotes": "Notes",
      "feature.nameTurnActions": "Turn actions",
      "feature.offSuffix": "not introduced",
      "feature.notesOffBanner": "Notes are turned off (Settings → DeepWorker → Features turns them back on). Nothing stored was deleted.",
      "settings.unlockLocalHint": "Affects this machine's interception only: unlock right now and drop the session-switch interceptor. No message is sent.",
      "settings.unlockLocalShort": "Nothing but this machine's interception changes.",
      // ── four-tab settings redesign (2026-10-16) ───────────────────────────────
      // Every new key must be genuinely referenced (verify_hygiene turns red otherwise).
      "settings.tab.basic": "Basic",
      "settings.tab.focus": "Focus lock",
      "settings.tab.notes": "Notes",
      "settings.tab.actions": "Session actions",
      "settings.tab.terminal": "Commands",
      "settings.tabsLabel": "DeepWorker settings sections",
      "feature.descFocusLock": "Locks every other session so only this one is reachable; unlock any time.",
      "feature.descNotice": "Sends reminders to the system notification centre (top right of the screen).",
      "feature.descFind": "Finds and highlights hits inside the loaded conversation window.",
      "feature.descQuote": "Writes the selected text into the composer as a quote with its provenance.",
      "feature.descDigest": "Compresses this conversation into one note (deterministic digest, or let a model summarise).",
      "feature.descNotes": "The sidebar-foot notes page: markdown, tags, search, export/import.",
      "feature.descTurnActions": "Retry / branch here / edit-and-resend / new chat with mode.",
      "settings.turnActionsHint": "Each of these hangs on a turn-tail slot; removing it means the slot is never registered and the whole row of buttons disappears.",
      "settings.tabIntroOff": "This feature is not introduced — turn it on in Basic",
      "settings.featureScopeNote": "These switches only decide whether a feature is installed: off means it is not registered at all and its entries disappear. Each feature's own settings live in its own section and are unaffected by these switches.",
      // ── 2026-10-16 round 4: the master "introduce / remove all" switch ──────────
      "settings.masterSwitch": "All features (master on / off)",
      "settings.masterDescOn": "Turning it off removes all {total} (every focus lock is released first)",
      "settings.masterDescPartial": "Only {on}/{total} are introduced — turn it on to introduce them all; off to remove them all",
      "settings.masterDescOff": "Turning it on introduces all {total}",
      "settings.masterOnDone": "All {total} features are introduced",
      "settings.masterOffDone": "Released the focus locks first ({scopes}), then removed all {total} features",
      "settings.masterOffNoLock": "No focus lock was active; all {total} features were removed",
      "settings.focusOffDone": "Released the focus locks first ({scopes}), then turned Focus lock off",
      "settings.focusOffNoLock": "No focus lock was active; Focus lock is off",
      "settings.masterUnlockFailed": "Could not release the focus lock ({detail}), so no feature was turned off — better to leave it on than to lock you in",
      "settings.masterHookMissing": "The settings page and the action kernel are not wired together (a defect): nothing was changed",
      "settings.scopeSession": "session-level",
      "settings.scopeWorkspace": "workspace-level",
      // ── Terminal buttons (2026-10-16) ─────────────────────────────────────────
      // One row of start / stop buttons in the session header: a click opens a NEW
      // terminal in THIS session's workspace and runs the configured command. The user
      // typed those commands, so they get no second confirmation.
      "term.buttonStart": "Start",
      "term.buttonStop": "Stop",
      "term.emptyCommand": "\"{label}\" has no command yet — set one for this workspace under Settings → DeepWorker → Commands.",
      "term.noCwd": "Could not resolve this session's workspace (cwd), so there is nowhere to run. No terminal was opened.",
      "term.noRemote": "The terminal service is unavailable on this client (ctx.remote.terminal is missing). No terminal was opened.",
      "term.notIntroduced": "The terminal-buttons feature is not introduced (Settings → DeepWorker → Basic).",
      "term.alreadyRunning": "\"{label}\" is still running; wait for it to finish.",
      "term.stateRunning": "Running",
      "term.stateDone": "Done",
      "term.stateFailed": "Failed",
      "term.starting": "Starting: {command}",
      "term.createFailed": "Could not open a terminal ({step}): {detail}",
      "term.stepCreate": "create",
      "term.stepRetain": "retain",
      "term.stepFollow": "follow",
      "term.stepWrite": "write",
      "term.beforeRunning": "Pre-command #{n} for \"{label}\" is still running, so the commands after it were not executed.",
      "term.done": "\"{label}\" finished with exit code {code}.",
      "term.doneFail": "\"{label}\" finished with exit code {code} (failure).",
      "term.stillRunning": "\"{label}\" was sent; no end marker within {seconds}s, so it is treated as still running (normal for a long-lived service, not a failure).",
      "term.streamEnded": "The terminal ended before the command reported an end marker.",
      "term.aborted": "This run was cancelled or timed out.",
      "term.unexpected": "The terminal call threw: {detail}",
      "term.diagPrefix": "Last start: ",
      "term.diagOk": "ok (exit {code})",
      "term.diagFail": "failed (exit {code})",
      "term.diagRunning": "still running (no end marker within {seconds}s)",
      "term.diagError": "error: {detail}",
      "term.diagAborted": "cancelled",
      "term.settingsTitle": "Command buttons",
      "term.settingsHint": "Header buttons resolve the **current session's workspace**; the terminal is not listed in the sidebar and its output is not shown. Each entry only starts and stops things.",
      "term.startLabelLabel": "Start button text",
      "term.stopLabelLabel": "Stop button text",
      "term.startCommandLabel": "Start command",
      "term.stopCommandLabel": "Stop command",
      "term.startBeforeLabel": "When Start is clicked, run these first, in order",
      "term.startBeforeHint": "This list is only for commands before Start: pick defined actions (stop, or an extra button with a command), each at most once; empty = run the start command directly. An extra button configures its own pre on its row.",
      "term.startBeforeEmpty": "(no pre-commands)",
      "term.sequenceAdd": "Add",
      "term.sequenceAddAll": "Add all",
      "term.sequencePickPlaceholder": "Choose an action…",
      "term.sequenceRemove": "Remove from the sequence",
      "term.sequenceUp": "Move up",
      "term.sequenceDown": "Move down",
      "term.logToFile": "Write output to .dsh-deepworker/logs/",
      "term.logToFileHint": "One file per run; long-running services keep writing. Logs may contain secrets.",
      "term.logsTitle": "Recent output ({n})",
      "term.logsShow": "Show",
      "term.logsHide": "Hide",
      "term.logsClear": "Clear",
      "term.logsEmpty": "No runs yet.",
      "term.logsCopy": "Copy output",
      "term.logsCopied": "Output copied",
      "term.logsCopyFailed": "Copy failed",
      "term.logsPath": "Log file",
      "term.timeoutLabel": "Seconds to wait before deciding \"still running\"",
      "term.timeoutHint": "When a command finishes the shell prints an end marker; if it has not appeared after this long the command is treated as still running (a long-lived service always looks like this — not a failure).",
      "term.fileTitle": "Read from a workspace file",
      "term.fileToggle": "Import from file",
      "term.fileHint": "An agent can write this JSON file in the current workspace, then click Read now to bulk-fill the list. No polling, and commands are never executed automatically.",
      "term.filePath": "File",
      "term.fileRead": "Read now",
      "term.fileReading": "Reading…",
      "term.fileMissing": "File not found (the existing configuration is unchanged)",
      "term.fileApplied": "Applied {n} workspace(s)",
      "term.fileUnchanged": "The file has not changed",
      "term.fileInvalid": "The file has errors; nothing was applied",
      "term.fileNoCwd": "Cannot resolve the current session's cwd, so the file cannot be located",
      "term.fileNoApi": "This environment cannot read workspace files",
      "term.fileFailed": "Read or write failed",
      "term.fileReplaced": "The file replaces the whole workspace list",
      "term.fileErrors": "Errors",
      "term.cwdLabel": "Current workspace",
      "term.save": "Save",
      "term.saveFailed": "Could not write to local storage: {detail}",
      "term.reset": "Restore defaults",
      "term.resetDone": "Defaults restored (the start and stop commands are cleared)",
      "term.seqStart": "start command",
      "term.commandPlaceholder": "The command to run (empty = this button does nothing)",
      "term.commandTooLong": "A command may be at most {max} characters; shorten it or split it into pre-sequences.",
      "term.commandFatal": "Rejected: this command may delete the system/home or destroy a disk ({rule}). Rewrite it before saving.",
      "term.labelPlaceholder": "Button text",
      "term.preview": "Preview: clicking \"{start}\" runs, in order → {list}",
      "term.featureName": "Terminal buttons",
      // ── multi-workspace + batch (2026-10-17, segment 2/3) ────────────────────
      "term.wsHint": "Each workspace has its own start / stop commands and extra buttons; the header group resolves against **the current session's workspace**.",
      "term.wsListTitle": "Workspaces ({n})",
      "term.wsNone": "No workspace yet — type an absolute path below, or use “Add the current workspace” above.",
      "term.wsAddTitle": "New workspace",
      "term.wsPathPlaceholder": "Absolute workspace path (e.g. /path/to/project)",
      "term.wsCreate": "Create",
      "term.wsCancel": "Cancel",
      "term.wsColName": "Name",
      "term.wsColWorkspace": "Workspace",
      "term.wsColPath": "Path",
      "term.wsColStart": "Start",
      "term.wsColStop": "Stop",
      "term.wsColExtra": "Extras",
      "term.wsColActions": "Actions",
      "term.wsPick": "Choose a folder…",
      "term.wsPickUnavailable": "No directory picker is available in this client — type the absolute path in the box instead.",
      "term.wsBadPath": "The path must be absolute (start with /). Nothing was added.",
      "term.wsExists": "That workspace is already in the list.",
      "term.wsAdded": "Added workspace: {label}",
      "term.wsEdit": "Configure",
      "term.wsRemove": "Remove",
      "term.wsRemoveHint": "“Remove” deletes only this configuration entry: no file is deleted and no process is stopped.",
      "term.wsRemoved": "Removed the configuration for {label} (no file deleted, no process stopped)",
      "term.wsSaved": "Saved this workspace's configuration",
      "term.wsLabelLabel": "Display name",
      "term.wsLabelPlaceholder": "Display name (blank = last path segment)",
      "term.wsCurrentIn": "already in the list — the header shows its buttons.",
      "term.wsCurrentNot": "not in the list ⇒ the header shows **no** command buttons. Add it below and they appear.",
      "term.wsAddCurrent": "Add the current workspace",
      "term.wsNoStart": "no start command",
      "term.wsNoStop": "no stop command",
      "term.editorTitle": "Configuring: {label}",
      "term.editorHint": "These commands cd into this workspace's own directory first.",
      "term.editorEmpty": "Select a workspace on the left to edit it here.",
      "term.extraTitle": "Extra buttons",
      "term.extraHint": "Fill in a label and a command; after saving it appears in the session header and runs in this workspace.",
      "term.extraPreTitle": "Pre",
      "term.extraPreFor": "Pre-commands: {label}",
      "term.extraPreHint": "Run these only before this button, in order; only defined actions, each at most once. Start is unaffected.",
      "term.extraPreEmpty": "(no pre-commands)",
      "term.extraPreClose": "Close",
      "term.sequenceNoActions": "No actions to add yet: give stop or an extra button a command first.",
      "term.sequenceNoMore": "No more actions to add: an extra button needs a command first; each action can be added once.",
      "term.extraEmpty": "(no extra buttons)",
      "term.extraAdd": "Add a button",
      "term.headerTitle": "Header buttons",
      "term.headerHint": "Choose which actions appear in the session header, and in what order. Deselect all to hide the group.",
      "term.headerNone": "No header buttons selected.",
      "term.headerReset": "Reset to all, natural order",
      "term.extraRemove": "Delete",
      "term.stopBeforeStart": "Run the stop command before start",
      "term.stopBeforeStartHint": "On = run the stop command above first. If “stop” is already in the pre-start sequence it is not run twice.",
      "term.batchTitle": "Batch",
      "term.batchStart": "Start selected ({n})",
      "term.batchStop": "Stop selected ({n})",
      "term.batchDisabled": "Tick at least one workspace first.",
      "term.batchTooMany": "{n} workspaces selected, but one session holds at most {max} terminals — reduce it to {max} or fewer. **Nothing was started.**",
      "term.batchRunning": "Running one by one: {done}/{total}",
      "term.batchNoSelection": "No workspace was selected; nothing ran.",
      "term.batchMissing": "that workspace configuration no longer exists",
      "term.batchItemFailed": "“{label}” failed: {detail}",
      "term.batchVerbStart": "start",
      "term.batchVerbStop": "stop",
      "term.batchOkAll": "Batch {verb} finished: {ok}/{total} succeeded.",
      "term.batchSummary": "Batch {verb}: {ok}/{total} succeeded, {fail} failed — {list}",
      "term.featureDesc": "Start / stop buttons in the session header that open a terminal and run your command.",

      "notes.pageHint": "Commands and reminders you jot down. They stay in this browser: never part of a conversation, never billed as context.",
      "retry.note": "(Note: an earlier attempt at this turn was interrupted before it finished and already changed these files: {paths}. Check their current state before continuing; do not overwrite them blindly.)",
      "notes.search": "Search notes… (Ctrl/⌘ + F)",
      "notes.clear": "Clear",
      "notes.count": "{shown} / {total}",
      "notes.noMatch": "No note matches",
      "notes.tagAll": "All",
      "notes.tagAdd": "Tag",
      "notes.tagConfirm": "Add",
      "notes.tagCancel": "Cancel",
      "notes.tagPlaceholder": "tags, comma separated",
      "notes.tagFiltered": "filtered",
      "notes.edit": "Edit",
      "notes.editSave": "Save",
      "notes.editCancel": "Cancel",
      "notes.editHint": "⌘/Ctrl+Enter saves · Esc cancels · rendered as markdown",
      "notes.edited": "Note updated",
      "resend.running": "This turn is still running: confirming will stop it first, then send in a new branch.",
      "resend.runningEditReady": "Turn stopped; the original text is back in the composer. Edit it and send.",
      "resend.runningEditNoComposer": "Turn stopped, but the composer has no writable interface.",
      "resend.runningEditAttachments": "This message has images/files: only the text is restored; re-attach them before sending.",
      "resend.wireParts": "Send failed; request shape: {parts}",
      "resend.sendingBranch": "Switched to the new branch; sending…",
      "resend.sentBranch": "Sent to the new branch; waiting for the reply.",
      "resend.preparing": "Preparing attachments…",
      "resend.prepared": "Attachments prepared; creating the branch…",
      "resend.prepareTimeout": "Preparing attachments timed out (15s); no branch was created.",
      "resend.cancelFailed": "Could not stop the running turn (it may still be working):",
      "resend.cancelUnavailable": "This build cannot stop the running turn automatically: the new message will queue — press Esc Esc first.",
      "resend.archiveFailed": "The new branch was sent, but the original conversation could not be archived (it is still listed):",
      "retry.noteFailed": "Could not read which files this attempt changed, so the retry hand-over note is missing:",
      "dialog.busy": "The previous step is still running; the button is disabled — please wait",
      "error.timeout": "the operation timed out (no result after two minutes)",
      "resend.noBoundary": "Cannot read this turn's start, so a safe resend is impossible (falling back to the turn's end would carry the original message over). Use \"Branch here\" instead.",
      "resend.trace": "Resend trace: fork atSeq={at} · this turn start={start} / end={end} · previous turn seq={prev}",
      "resend.traceSplice": "Resend trace: pending splice@{splice} ⇒ boundary moved to {cut}",
      "resend.tracePage": "Resend trace·page: ok={ok} err={err} events={n}",
      "resend.traceChild": "Resend trace: child={child} (fork point {at})",
      "resend.empty": "The message text for this turn could not be read (it may be outside the loaded window), so there is nothing to resend.",
      "retry.noText": "The prompt text for this turn could not be read (it may be outside the loaded window), so there is nothing to retry.",
      "retry.noBoundary": "This turn's start could not be located, so no branch could be created.",
      "notes.export": "Copy all",
      "notes.exported": "Every note is on the clipboard as JSON. On another machine press Import and paste it back.",
      "notes.exportFailed": "Copy failed: the clipboard is unavailable",
      "notes.import": "Import",
      "notes.importHint": "Paste the JSON from Copy all, or just paste one note per line. Duplicates are skipped.",
      "notes.importConfirm": "Import",
      "notes.importCancel": "Cancel",
      "notes.imported": "Imported",
      "notes.writeFailed": "Could not write to local storage (the change will not survive):",
      "notes.stored": "{count} stored",
      "notes.dropped": "{count} dropped over the cap",
      "notes.copyFailed": "Copy failed (clipboard unavailable):",
      "notes.emptyEdit": "Nothing to save: the text is empty",
      "notes.savedFromSelection": "Selection saved to notes",
      "notes.selectionEmpty": "Nothing is selected",
      "notes.fromClipboard": "Save clipboard as note",
      "notes.clipboardEmpty": "The clipboard has no text",
      "notes.clipboardFailed": "Could not read the clipboard (permission may be denied). Paste it below, then save it as a note.",
      "notes.clipboardHint": "Paste the clipboard here (Cmd/Ctrl+V), then save it as a note.",
      "notes.clipboardSave": "Save as note",
      "notes.clipboardCancel": "Cancel",
      "notes.clipboardSaved": "Clipboard saved as a note",
      "modal.resend.title": "Edit and resend",
      "modal.resend.hint": "DSH's session log is append-only, so a sent message cannot be rewritten in place. This continues in a forked branch from before this turn and sends the edited text as a new message. Tick the option below to archive the original so it reads as the same conversation being edited.",
      "modal.resend.archive": "Archive the original conversation (recoverable under Archived)",
      "modal.resend.submit": "Send",
      "inline.addImage": "Add image",
      "inline.removeImage": "Remove image",
      "inline.noContent": "Keep at least one text or image part.",
      "action.newMode": "New chat with mode",
      "modal.newMode.title": "New chat with a chosen mode",
      "modal.newMode.hint": "DSH locks a preset once a conversation starts, so only a brand-new conversation can choose one. This creates a new conversation, applies the mode you pick, and carries the conversation chosen below over as referenced context.",
      "modal.newMode.modeLabel": "Mode",
      "modal.newMode.sourceLabel": "Referenced conversation",
      "modal.newMode.sourceCurrent": " (current)",
      "modal.newMode.sourceEmpty": "(no conversation available to reference)",
      "modal.newMode.workspaceLabel": "Workspace",
      "modal.newMode.workspaceNew": "+ New workspace…",
      "modal.newMode.workspacePicking": "Choosing a directory…",
      "modal.newMode.workspaceEmpty": "(no registered workspace — the default directory is used)",
      "modal.newMode.placeholder": "(optional) what to say about the referenced conversation; empty sends \"continue from the referenced conversation\"",
      "modal.newMode.submit": "Create and send",
      "modal.newMode.loading": "Loading modes…",
      "error.fork": "Failed to create branch",
      "error.prompt": "Failed to send",
      "error.presets": "Failed to load modes",
      "error.presetSelect": "Failed to set mode",
      "error.workspace": "Workspace operation failed",
      "ref.noSession": "Could not resolve the active Session, so the reference cannot be located",
      "ref.notFound": "The referenced Session record was not found: it may be outside the loaded window (scroll up to load history, then click again), or it was compacted away",
      "quote.empty": "(empty)",
      "quote.noAssistant": "This reply has no quotable text yet; select the text you want to quote.",
    };

    /** Longest quote kept verbatim; the anchor below always points at the full source. */
    var QUOTE_MAX_CHARS = 280;
    /** The quote bar. Kept in one place so the body and its provenance share a border. */
    var QUOTE_BAR = "▍ ";
    function quoteBarLine(text) {
      return QUOTE_BAR + String(text == null ? "" : text) + "\n";
    }
    /**
     * Quote a selection as a VISUALLY BOUNDED block.
     *
     * A user message is plain text in DSH — the app does not render it as markdown — and a
     * plugin cannot style another component's message. So the boundary has to be carried
     * by the characters themselves. `> ` (a markdown marker) reads as noise in plain
     * text; a vertical bar per line reads as a quote immediately, and line breaks are
     * preserved so a quoted snippet keeps its shape.
     *
     * @returns {{ text: string, body: string, clipped: boolean }} `body` is the quoted
     *   text without the bar — stored so a later click can tell several quotes inside one
     *   message apart (markers alone cannot).
     */
    function blockquote(text) {
      var raw = String(text == null ? "" : text).replace(/\r\n?/g, "\n").trim();
      if (raw === "") return { text: "", body: "", clipped: false };
      var clipped = raw.length > QUOTE_MAX_CHARS;
      if (clipped) raw = raw.slice(0, QUOTE_MAX_CHARS).replace(/\s+\S*$/, "") + "…";
      // Collapse runs of blank lines; keep meaningful line breaks.
      var lines = raw.split("\n").map(function (line) { return line.replace(/\s+$/, ""); });
      var kept = [];
      for (var i = 0; i < lines.length; i++) {
        if (lines[i] === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
        kept.push(lines[i]);
      }
      var body = kept.join("\n");
      var rendered = kept.map(function (line) { return line === "" ? "▍" : QUOTE_BAR + line; }).join("\n");
      return { text: rendered + "\n", body: body, clipped: clipped };
    }
    /**
     * A whole-reply quote keeps exactly one non-empty line. The line is the
     * searchable body; the turn/seq anchor is the authoritative location.
     */
    function quoteFirstLine(text) {
      var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\s+$/, "").trim();
        if (line !== "") return line;
      }
      return "";
    }
    function selectionText() {
      try {
        return typeof window !== "undefined" && window.getSelection ? (window.getSelection().toString() || "") : "";
      } catch (e) {
        return "";
      }
    }
    function newRequestId() {
      return "history-resend-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
    // Canonical session-reference mention: `@[label](dsh-session:<base64url(JSON id)>)`.
    function b64url(text) {
      var bytes = new TextEncoder().encode(text);
      var bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function formatMention(sessionId, label) {
      var shown = String(label == null || label === "" ? sessionId : label).replace(/[\\\]]/g, function (m) {
        return "\\" + m;
      });
      return "@[" + shown + "](dsh-session:" + b64url(JSON.stringify(sessionId)) + ")";
    }
    // Inverse of formatMention: `dsh-session:<base64url(JSON.stringify(id))>`.
    function decodeSessionReferenceUri(text) {
      var match = /dsh-session:([A-Za-z0-9_-]+)/.exec(String(text == null ? "" : text));
      if (match === null) return undefined;
      try {
        var binary = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var decoded = JSON.parse(new TextDecoder().decode(bytes));
        return typeof decoded === "string" && decoded !== "" ? decoded : undefined;
      } catch (e) {
        return undefined;
      }
    }
    function errorMessage(e) {
      if (e == null) return "unknown error";
      if (typeof e === "string") return e;
      if (e && e.message) return e.message;
      if (e && e.error && e.error.message) return e.error.message;
      return String(e);
    }

    var buttonStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      border: "0",
      background: "transparent",
      color: "var(--dsw-alias-label-tertiary)",
      cursor: "pointer",
      font: "inherit",
      fontSize: "12px",
      lineHeight: "18px",
      padding: "2px 6px",
      borderRadius: "var(--dsw-radius-sm)",
      whiteSpace: "nowrap",
      flex: "0 0 auto"
    };
    // This row is a feature contribution rendered into ui-chat's turn-tail root
    // (`.d1vkyW_root { flex-direction: column; gap: 16px }`), BEFORE the shipped
    // action row. Its height MUST stay constant: the chat follows the tail with
    // a ResizeObserver while pinned to the floor, so any height change scrolls
    // the viewport. Hence nowrap + a fixed height + overflow hidden.
    // No negative margins: the row is the root's FIRST child, so there is no gap
    // above it to cancel — a negative margin-top would drag it out of the
    // container and overlap the content above (observed: it covered the
    // assistant's question row).
    var rowStyle = {
      display: "flex",
      flexWrap: "nowrap",
      alignItems: "center",
      gap: "2px",
      height: "22px",
      minHeight: "22px",
      maxHeight: "22px",
      overflow: "hidden",
      whiteSpace: "nowrap"
    };

    // Workspace / mode pickers stay a fixed height no matter how many entries
    // exist, so a long list cannot stretch the dialog.
    var selectTriggerStyle = {
      width: "100%",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      textAlign: "left",
      border: "0.5px solid var(--dsw-alias-border-l4)",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      borderRadius: "var(--dsw-radius-lg)",
      padding: "8px 12px",
      cursor: "pointer",
      font: "inherit"
    };
    var dropdownStyle = {
      position: "absolute",
      left: 0,
      right: 0,
      top: "calc(100% + 4px)",
      zIndex: 12,
      maxHeight: "220px",
      overflowY: "auto",
      background: "var(--dsw-alias-bg-layer-1)",
      border: "0.5px solid var(--dsw-alias-border-l3)",
      borderRadius: "var(--dsw-radius-lg)",
      boxShadow: "var(--dsw-elevation-panel)",
      padding: "4px"
    };
    var dropdownBackdropStyle = {
      position: "fixed",
      inset: 0,
      zIndex: 11
    };
    var optionStyle = {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      textAlign: "left",
      border: "0",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      borderRadius: "6px",
      padding: "6px 10px",
      cursor: "pointer",
      font: "inherit",
      overflow: "hidden"
    };
    // Notes live in the browser, keyed away from the session log: they are a
    // personal scratchpad, not conversation content.
    // Client-side switches. They change real behaviour (quote markers, retry notes,
    // the archive default), never anything the Host owns.
    var SETTINGS_KEY = "dsh.deepworker.settings";
    // EVERY key the settings surface can write, with the value used when storage has nothing
    // (or nothing usable) for it. The three original switches were the whole list once, and
    // that whitelist WAS the bug: `writeSettings({focusNativeNotice:false})` and the notice
    // scope keys were stored but never read back, so the "native notice" switch could not be
    // turned off and mute/only-this-session were no-ops.
    var SETTING_DEFAULTS = {
      quoteProvenance: true,
      // ── 专注锁的默认配置（2026-10-18）────────────────────────────────────
      // enabled=false 时保留原来的范围/时长选择框；开启后头部的「专注」直接使用
      // scope/minutes，不再弹窗。scope/minutes 即使关闭也保留，方便下次打开。
      focusDefaultEnabled: false,
      focusDefaultScope: "session",
      focusDefaultMinutes: 30,
      retryNote: true,
      archiveOriginal: true,
      focusNativeNotice: true,
      noticeOnlySession: "",
      noticeMutedSessions: [],
      // The edit-and-resend DIAGNOSTIC trace. Boolean, so storage can only ever set it to a
      // literal `true` — and the default is FALSE: the trace draws bubbles and (worse) RECLAIMS
      // the session title, which is user-owned data. A diagnostic that ships ON by default is
      // not a diagnostic, it is a defect.
      debugResendTrace: false,
      // ── 功能总开关（2026-10-15）。默认 true = 老用户升级后行为不变 ──────────────
      // 每一个都必须在这里声明：readSettings 的布尔严格校验只认 SETTING_DEFAULTS 里
      // 是 boolean 的键；不声明就走 else 分支，任意垃圾值照抄进内存（手改 localStorage
      // 也不行 —— 会被回落到默认值）。判定统一走 featureEnabled()（!== false）。
      featureFocusLock: true,
      featureNotice: true,
      featureFind: true,
      featureQuote: true,
      featureDigest: true,
      featureNotes: true,
      featureTurnActions: true
    };
    /** Default for `key`, copied so a stored list can never mutate the shared default. */
    function settingDefault(key) {
      var value = SETTING_DEFAULTS[key];
      return Array.isArray(value) ? value.slice() : value;
    }
    /**
     * Read the settings, MERGING what storage holds over the defaults.
     *
     * Merge, not filter: callers save the whole object back on every write (`var next =
     * readSettings(); ...; writeSettings(next)`), so any key this build does not know about
     * — an older/newer version, or something hand-edited into localStorage — would be
     * silently dropped by a whitelist copy. The boolean-valued keys stay strict booleans:
     * a corrupt value falls back to its default instead of becoming a truthy string.
     */
    function readSettings() {
      var out = {};
      for (var key in SETTING_DEFAULTS) out[key] = settingDefault(key);
      try {
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SETTINGS_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object") {
          for (var k in parsed) {
            if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue;
            // Assigning `__proto__` would rewrite the prototype of `out` instead of adding a key.
            if (k === "__proto__") continue;
            if (typeof SETTING_DEFAULTS[k] === "boolean") {
              if (typeof parsed[k] === "boolean") out[k] = parsed[k];
            } else {
              out[k] = parsed[k];
            }
          }
        }
      } catch (e) {
        /* fall back to defaults */
      }
      return out;
    }
    /**
     * Normalize the focus-lock defaults. Unknown scope falls back to session; minutes are
     * clamped to the same 1..10080 range the dialog enforces. This is the only reader.
     */
    function focusDefaultsFrom(settings) {
      var source = settings !== null && typeof settings === "object" ? settings : {};
      var scope = source.focusDefaultScope === "workspace" ? "workspace" : "session";
      var minutes = Number(source.focusDefaultMinutes);
      if (!Number.isFinite(minutes) || minutes < 1) minutes = 30;
      minutes = Math.min(10080, Math.floor(minutes));
      return { enabled: source.focusDefaultEnabled === true, scope: scope, minutes: minutes };
    }
    /**
     * Persist settings, REPORTING whether it worked.
     *
     * It used to swallow the failure and return nothing, so callers went on to say
     * "saved" while storage kept the old value — a user-visible lie whenever the quota is
     * full or storage is unavailable. Silence is the one thing this plugin must not do.
     * @returns {{ok: boolean, error?: string}}
     */
    function writeSettings(next) {
      try {
        if (typeof localStorage === "undefined") return { ok: false, error: "no storage" };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    // ── 功能开关（2026-10-15）────────────────────────────────────────────────
    // 为什么必须有这一段：槽位条目不会因为 localStorage 变了就重绘（ui-renderer 的
    // slots.inject 只在【声明世代】变化时重跑 callback），所以"让别处的 UI 跟着重画"
    // 需要一个我们自己的订阅者列表，而不是指望框架。故意极小：一个数组 + 同步调用 +
    // 逐个 try/catch —— 一个监听者抛错绝不能让"写设置"失败，也不能跳过别的监听者。
    /** @type {Array<function(): void>} */
    var settingsListeners = [];
    function onSettingsChanged(fn) {
      settingsListeners.push(fn);
      return function () {
        var i = settingsListeners.indexOf(fn);
        if (i !== -1) settingsListeners.splice(i, 1);
      };
    }
    function notifySettingsChanged() {
      for (var i = 0; i < settingsListeners.length; i++) {
        try { settingsListeners[i](); } catch (e) {
          try { console.error("[dsh-deepworker] settings listener failed: " + String((e && e.message) || e)); } catch (e2) { /* no console */ }
        }
      }
    }
    /**
     * Is a feature master switch ON?
     *
     * The rule is "default ON, only an explicit false turns it off" (`!== false`), NOT
     * `=== true`. That distinction is load-bearing: with `=== true`, a key that storage has
     * never seen reads as "off" and the feature silently disappears for every existing user.
     * Any failure reads as ON, so a broken store can never be mistaken for "the user turned
     * everything off".
     * @param {string} key
     * @returns {boolean}
     */
    function featureEnabled(key) {
      try {
        return readSettings()[key] !== false;
      } catch (e) {
        return true;
      }
    }
    /**
     * 七个功能总开关的键名（**显示顺序**，也是设置页「功能引入 / 移除」的行顺序）。
     *
     * 一处定义、三处用：apply 时的"引入快照"、设置页的行清单、以及注册门
     * （`guard.injectIf` / `guard.effectIf` / `declareIf`）。以前设置页里还各存了一份同样
     * 内容的数组 —— 两份清单迟早会漂。
     */
    var FEATURE_KEYS = ["featureFocusLock", "featureNotes", "featureFind", "featureQuote", "featureDigest", "featureTurnActions", "featureNotice", "featureTerminal"];
    /**
     * 每一档的文案键与归属 tab；与 FEATURE_KEYS 一一对应。
     *
     * ⚠️ 2026-10-16 二次分组（用户看真机截图后指出的两处错位）：
     *   · 「引用回复」在界面上就是**消息动作栏里的一颗按钮**（与「重试本轮 / 在此分支 /
     *     编辑重发 / 选模式新建」并排）⇒ 它属于**会话操作**，不属于"内容"。
     *   · 「编辑重发 / 重试时默认归档原对话」跟引用毫无关系（它管的是编辑重发/重试的行为）
     *     ⇒ 它归 `featureTurnActions`（轮次操作）那一节。
     *   · 笔记 / 摘要留在「笔记」tab（含「存储位置」）。
     */
    var FEATURE_META = {
      featureFocusLock: { name: "feature.nameFocusLock", desc: "feature.descFocusLock", tab: "focus" },
      featureNotes: { name: "feature.nameNotes", desc: "feature.descNotes", tab: "notes" },
      featureFind: { name: "feature.nameFind", desc: "feature.descFind", tab: "actions" },
      featureQuote: { name: "feature.nameQuote", desc: "feature.descQuote", tab: "actions" },
      featureDigest: { name: "feature.nameDigest", desc: "feature.descDigest", tab: "notes" },
      featureTurnActions: { name: "feature.nameTurnActions", desc: "feature.descTurnActions", tab: "actions" },
      featureNotice: { name: "feature.nameNotice", desc: "feature.descNotice", tab: "basic" },
      // 2026-10-16 新增：头部终端按钮。默认**引入**（featureEnabled 的规则是 `!== false`），
      // 但没配命令时按钮点了只说话、不开终端。
      featureTerminal: { name: "term.featureName", desc: "term.featureDesc", tab: "terminal" }
    };
    /**
     * Is the edit-and-resend DIAGNOSTIC trace switched on? Default OFF.
     *
     * The resend path used to rename the user's session to `[ha] ok=… err=… cutBound=… …` and
     * draw trace bubbles on EVERY edit-and-resend, with no guard at all. A rename is not a
     * notice: it overwrites a title the user owns, and it did so silently. The trace is now
     * behind one explicit switch, and this is the only reader of it.
     *
     * Failure is ALWAYS "off". `readSettings()` already swallows a corrupt store internally,
     * but this wrapper does not rely on that: a throw here must never be the reason a title
     * gets rewritten, so the catch returns false rather than propagating.
     * @returns {boolean}
     */
    function resendTraceEnabled() {
      try {
        return readSettings().debugResendTrace === true;
      } catch (e) {
        return false;
      }
    }



    /**
     * 一个必定匹配 `/^[\w-]{1,128}$/` 的终端 id。
     *
     * 优先 `crypto.randomUUID()`（宿主那侧的 WebTerminalId 就是 uuid；同 id 幂等 ⇒ 用 uuid
     * 才不会撞上"上次那个已经 close 过的 id"，因为 `closedIds` 是**终身**的）。
     * 拿不到 `crypto`（老宿主 / 测试桩）时退化成时间戳 + 计数器 —— 仍然是 `[\w-]`。
     */
    var TERM_ID_SEQ = 0;
    function termNewId() {
      try {
        var c = typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function" ? crypto : null;
        if (c !== null) return c.randomUUID();
      } catch (e) { /* fall through */ }
      TERM_ID_SEQ = TERM_ID_SEQ + 1;
      return "dw-" + Date.now().toString(36) + "-" + TERM_ID_SEQ.toString(36);
    }
    // ── 3b. 终端按钮：配置（localStorage，按 cwd 映射）+ 执行器 ────────────────
    //
    // 为什么存在客户端 localStorage 而不是宿主设置：`settings.*` 需要一条**已注册的、
    // 带 Cordis Config schema 的宿主插件行**，客户端插件做不到。键名沿用本仓既有风格。
    var TERM_KEY = "dsh.deepworker.terminalButtons.v1";
    var TERM_TIMEOUT_DEFAULT = 30;
    var TERM_TIMEOUT_MIN = 1;
    var TERM_TIMEOUT_MAX = 600;
    var TERM_LABEL_MAX = 120;
    var TERM_FIELD_MAX = 4000;
    /** 两个固定按钮的 id；附加按钮的 id 一律 `x:<n>`，永不可能是 `start` / `stop`。 */
    var TERM_FIXED = ["start", "stop"];
    /**
     * 某个 cwd 的配置模板。**每次都新建一份**，绝不共享对象 —— 共享的默认值会被一次
     * 写入静默改掉（本机踩过：默认值对象被 `out[key]` 就地改，之后所有人的"默认值"都变了）。
     */
    function termDefaultActions() {
      return [{ id: "start", label: "", command: "" }, { id: "stop", label: "", command: "" }];
    }
    function termDefaults() {
      return { v: 1, timeout: TERM_TIMEOUT_DEFAULT, seq: [], actions: termDefaultActions() };
    }
    /**
     * 清理一条命令：换行折成 `;`（结束标记必须挂在**最后一条**命令后面，多行命令会让它
     * 只挂到最后一行），去掉 NUL，并截断到上限。
     */
    /** Best-effort denylist for destructive shell commands. Not a security sandbox. */
    var TERM_FATAL_RULES = [
      { id: "rm-system", re: /\brm\s+(?:-[a-z]*[rf][a-z]*\s+){1,2}(?:--no-preserve-root\s+)?["']?(?:\/|\/\*|~|~\/\*|\$HOME|\$\{HOME\}|\.\/?|\*)["']?(?:\s|;|$)/i },
      { id: "rm-home", re: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:Users|home)\/[^/\s]+\/?\s*$/i },
      { id: "mkfs", re: /\bmkfs(?:\.[a-z0-9]+)?\b/i },
      { id: "dd-device", re: /\bdd\b[^\n]*\bof=\/dev\/(?:disk|sd|nvme|hd|mmcblk|rdisk)/i },
      { id: "write-device", re: />\s*\/dev\/(?:disk|sd|nvme|hd|mmcblk|rdisk)/i },
      { id: "power", re: /(?:^|[;&|]\s*)(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b/i },
      { id: "kill-init", re: /\bkill\s+-9\s+1\b/i },
      { id: "fork-bomb", re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
      { id: "chmod-root", re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i },
      { id: "find-root-delete", re: /\bfind\s+\/\s+[^\n]*-delete\b/i }
    ];
    /** @returns {string|null} rule id when the command should never be stored/run. */
    function termFatalReason(raw) {
      var text = termNormalizeCommand(raw);
      if (text === "") return null;
      for (var i = 0; i < TERM_FATAL_RULES.length; i++) {
        if (TERM_FATAL_RULES[i].re.test(text)) return TERM_FATAL_RULES[i].id;
      }
      return null;
    }
    function termNormalizeCommand(raw) {
      var text = typeof raw === "string" ? raw : "";
      text = text.replace(/\r\n?/g, "\n").replace(/\n+/g, "; ");
      text = text.split("\u0000").join("");
      return text.length > TERM_FIELD_MAX ? text.slice(0, TERM_FIELD_MAX) : text;
    }
    /** 清理一个标签：单行、trim、截断到 120（宿主 rename 的上限）。 */
    function termNormalizeLabel(raw, fallback) {
      var text = typeof raw === "string" ? raw : "";
      text = text.replace(/\r?\n/g, " ").split("\u0000").join("").trim();
      if (text === "") return fallback;
      return text.length > TERM_LABEL_MAX ? text.slice(0, TERM_LABEL_MAX) : text;
    }
    /**
     * 逐字段校验一份配置。**垃圾值不许照抄进内存** —— 每个字段各自兜底。形状与本仓既有的
     * readSettings 一致：未知/坏值只影响它自己那一个字段。
     */
    function termNormalizeConfig(raw) {
      var out = termDefaults();
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
      var timeout = raw.timeout;
      if (typeof timeout === "number" && isFinite(timeout)) {
        timeout = Math.round(timeout);
        out.timeout = Math.min(TERM_TIMEOUT_MAX, Math.max(TERM_TIMEOUT_MIN, timeout));
      }
      // actions：先收固定两个，再收形状合法的附加项。附加按钮第 3 段才用得上，
      // 但校验现在就写好 —— 否则第 3 段要回头改校验，而"改校验"最容易漏。
      var seen = {};
      if (Array.isArray(raw.actions)) {
        for (var i = 0; i < raw.actions.length; i++) {
          var item = raw.actions[i];
          if (item === null || typeof item !== "object") continue;
          var id = typeof item.id === "string" ? item.id : "";
          var okId = id === "start" || id === "stop" || /^x:[A-Za-z0-9_-]{1,32}$/.test(id);
          if (!okId || seen[id] === true) continue;
          seen[id] = true;
          var command = termNormalizeCommand(item.command);
          var label = termNormalizeLabel(item.label, "");
          var found = -1;
          for (var k = 0; k < out.actions.length; k++) if (out.actions[k].id === id) found = k;
          if (found >= 0) out.actions[found] = { id: id, label: label, command: command };
          else out.actions.push({ id: id, label: label, command: command });
        }
      }
      // 固定两个永远排在最前（id 也稳定），其余保持数组顺序。
      var head = [], tail = [];
      for (var j = 0; j < out.actions.length; j++) {
        (out.actions[j].id === "start" || out.actions[j].id === "stop" ? head : tail).push(out.actions[j]);
      }
      head.sort(function (a, b) { return TERM_FIXED.indexOf(a.id) - TERM_FIXED.indexOf(b.id); });
      out.actions = head.concat(tail);
      // seq：只允许引用**真实存在**的 action id，且不重复。
      if (Array.isArray(raw.seq)) {
        for (var q = 0; q < raw.seq.length; q++) {
          var ref = raw.seq[q];
          if (typeof ref !== "string" || out.seq.indexOf(ref) >= 0) continue;
          var exists = false;
          for (var a = 0; a < out.actions.length; a++) if (out.actions[a].id === ref) exists = true;
          if (exists) out.seq.push(ref);
        }
      }
      return out;
    }
    // ── 3b-ii. 多工作区模型（2026-10-17 第 2 段）──────────────────────────────
    //
    // 用户原话："现在你做的这个版本是针对一个工作区的配置，但完整的应该是支持添加/移除多个
    // 工作区，某个工作区可独立配置这些功能，自定义启动/停止等命令"。
    //
    // 唯一事实来源 = `dsh.deepworker.workspaces.v1`，形状（逐字照需求书）：
    //   {
    //     version: 1,
    //     workspaces: [
    //       { path: "/abs/path",                 // 唯一键（规范化：去尾斜杠、必须绝对路径）
    //         label: "显示名",                   // 默认取 path 的末段
    //         start: { label: "启动", command: "bash scripts/serve.sh start" },
    //         stop:  { label: "停止", command: "bash scripts/serve.sh stop" },
    //         extras: [ { label: "重启", command: "…" } ],   // 可增删改名
    //         preStart: [ "<动作的 label 或 id>" ],           // 前置命令序列（可排序）
    //         timeoutSec: 30,
    //         stopBeforeStart: false }            // 点启动时先跑停止命令
    //     ]
    //   }
    //
    // 四条纪律：
    //   ① **逐字段校验**：垃圾值只影响它自己那一个字段，绝不整份照抄进内存。
    //   ② **path 唯一**：`wsNormalizeAll` 按 path 去重（后出现的覆盖前面的）。
    //   ③ **老的 `terminalButtons.v1` 平滑迁移**（单工作区时代按 cwd 存的那张映射表）：
    //      新键**从未存在**时，把老表里每一个 cwd 转成一条工作区（老 UI 只编辑当前 cwd，
    //      所以通常正好一条 ⇒ 与需求"迁移成 workspaces:[{path:<当前 cwd>,…}]"逐字一致）。
    //      迁移**不删老键**（回退安全）；新键一旦存在就再也不读老键（删光工作区后不会复活）。
    //   ④ **读一律经过这里**：读不到/坏值退化成空表，绝不抛（读失败 ≠ 崩）。
    var WS_KEY = "dsh.deepworker.workspaces.v1";
    var WS_VERSION = 1;
    /**
     * 一个会话最多同时持有多少个终端 —— 宿主 `maxTerminals` 的**默认值就是 8**
     * （现读 app.asar: `dsh-api-terminal-controller/lib/index.js` 的 config schema；
     * 超过它 create 会抛 `terminal/limit-reached`）。
     * ⚠️ 客户端**读不到**宿主那份配置（它在 loader 配置里，不在 remote 的读接口上）
     * ⇒ 按默认值做**前置**检查：批量的"提前报错、一个都不创建"必须发生在任何 create 之前。
     */
    var TERM_SESSION_MAX = 8;

    /** 路径末段（显示名默认值）。 */
    function wsBasename(raw) {
      var text = typeof raw === "string" ? raw.replace(/\/+$/, "") : "";
      if (text === "") return "";
      var at = text.lastIndexOf("/");
      return at < 0 ? text : text.slice(at + 1);
    }
    /**
     * 规范化一个工作区路径：单行、去首尾空白、折叠重复斜杠、**去尾斜杠**（根路径保留一个）、
     * 必须是**绝对**路径。非法（相对 / 空）⇒ 返回 ""，调用方一律按"没有这个路径"处理，绝不猜。
     */
    function wsNormalizePath(raw) {
      var text = typeof raw === "string" ? raw.replace(/[\r\n\t]+/g, " ").trim() : "";
      if (text === "") return "";
      if (text.charAt(0) !== "/") return "";
      text = text.replace(/\/{2,}/g, "/");
      while (text.length > 1 && text.charAt(text.length - 1) === "/") text = text.slice(0, -1);
      return text;
    }
    /** 一个 start / stop / extra 动作：逐字段兜底。 */
    function wsNormalizeAction(raw) {
      var out = { label: "", command: "" };
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
      out.label = termNormalizeLabel(raw.label, "");
      out.command = termNormalizeCommand(raw.command);
      return out;
    }
    /**
     * 把一个 preStart / 按钮引用解析成 `{ id, label, command }`。
     * 引用键的约定（需求原话是"动作的 label 或 id"）：
     *   · `start` / `stop` 是**固定两个动作的 id**；
     *   · 其它按钮用它的 **label** 当引用键（extras 没有 id 字段）。
     * @returns {{id:string,label:string,command:string}|null}
     */
    function wsResolveAction(entry, ref) {
      if (entry === null || typeof entry !== "object" || typeof ref !== "string" || ref === "") return null;
      if (ref === "start") return { id: "start", label: entry.start.label, command: entry.start.command };
      if (ref === "stop") return { id: "stop", label: entry.stop.label, command: entry.stop.command };
      var extras = Array.isArray(entry.extras) ? entry.extras : [];
      for (var i = 0; i < extras.length; i++) {
        if (extras[i].label === ref) return { id: "x:" + i, label: extras[i].label, command: extras[i].command };
      }
      return null;
    }
    /** All action refs in their natural order: start/stop, then extra labels. */
    function wsActionRefs(entry) {
      var refs = ["start", "stop"];
      var extras = entry !== null && typeof entry === "object" && Array.isArray(entry.extras) ? entry.extras : [];
      for (var i = 0; i < extras.length; i++) if (extras[i].label !== "") refs.push(extras[i].label);
      return refs;
    }
    /** Header order; null = all in natural order (old records), [] = show none. */
    function wsHeaderRefs(entry) {
      var all = wsActionRefs(entry);
      if (entry === null || typeof entry !== "object" || !Array.isArray(entry.header)) return all;
      var out = [];
      for (var i = 0; i < entry.header.length; i++) {
        var ref = entry.header[i];
        if (typeof ref !== "string" || ref === "") continue;
        if (all.indexOf(ref) < 0 || out.indexOf(ref) >= 0) continue;
        out.push(ref);
      }
      return out;
    }
    function wsHeaderActions(entry) {
      var refs = wsHeaderRefs(entry);
      var out = [];
      for (var i = 0; i < refs.length; i++) {
        var action = wsResolveAction(entry, refs[i]);
        if (action !== null) out.push(action);
      }
      return out;
    }
    /**
     * 逐字段校验一条工作区记录。
     * @param {*} raw
     * @param {string=} fallbackPath 调用方已规范化好的 path
     * @returns {object|null} 路径非法 ⇒ null（没有 path 就没有身份 —— 这一条不能兜底）
     */
    function wsNormalizeEntry(raw, fallbackPath) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
      var path = wsNormalizePath(raw.path);
      if (path === "") path = wsNormalizePath(fallbackPath);
      if (path === "") return null;
      var start = wsNormalizeAction(raw.start);
      var stop = wsNormalizeAction(raw.stop);
      var extras = [];
      var rawExtras = Array.isArray(raw.extras) ? raw.extras : [];
      for (var i = 0; i < rawExtras.length && extras.length < 32; i++) {
        var extra = wsNormalizeAction(rawExtras[i]);
        // 完全空白的一行不是"按钮"，是残留 ⇒ 丢掉（否则头部会长出一颗无名的空按钮）
        if (extra.label === "" && extra.command === "") continue;
        extras.push({ label: extra.label, command: extra.command, pre: [] });
      }
      var timeoutSec = TERM_TIMEOUT_DEFAULT;
      if (typeof raw.timeoutSec === "number" && isFinite(raw.timeoutSec)) timeoutSec = Math.round(raw.timeoutSec);
      // 兼容老字段名（`terminalButtons` 时代叫 `timeout`，单位同样是秒）
      else if (typeof raw.timeout === "number" && isFinite(raw.timeout)) timeoutSec = Math.round(raw.timeout);
      timeoutSec = Math.min(TERM_TIMEOUT_MAX, Math.max(TERM_TIMEOUT_MIN, timeoutSec));
      var entry = {
        path: path,
        label: termNormalizeLabel(raw.label, "") || wsBasename(path),
        start: start,
        stop: stop,
        extras: extras,
        preStart: [],
        timeoutSec: timeoutSec,
        stopBeforeStart: raw.stopBeforeStart === true,
        logToFile: raw.logToFile === true,
        header: null
      };
      // preStart：只允许引用**这个工作区里真的定义了的动作**，且不重复。
      // ⚠️ 引用解析不出来的条目**丢掉** —— 但序列列表是照着同一份数据渲染的，所以"丢"
      //    用户下一眼就看得见（列表短了），不是静默。
      if (Array.isArray(raw.preStart)) {
        for (var q = 0; q < raw.preStart.length; q++) {
          var ref = raw.preStart[q];
          if (typeof ref !== "string" || ref === "" || entry.preStart.indexOf(ref) >= 0) continue;
          if (wsResolveAction(entry, ref) === null) continue;
          entry.preStart.push(ref);
        }
      }
      // 每个额外按钮自己的前置序列：只引用本工作区已有动作，不重复、不引用自己。
      for (var ei = 0; ei < entry.extras.length; ei++) {
        var rawPre = rawExtras[ei] && Array.isArray(rawExtras[ei].pre) ? rawExtras[ei].pre : [];
        for (var pi = 0; pi < rawPre.length; pi++) {
          var pRef = rawPre[pi];
          if (typeof pRef !== "string" || pRef === "") continue;
          if (entry.extras[ei].pre.indexOf(pRef) >= 0) continue;
          var pResolved = wsResolveAction(entry, pRef);
          if (pResolved === null || pResolved.command === "") continue;
          if (pResolved.id === "x:" + ei) continue;
          entry.extras[ei].pre.push(pRef);
        }
      }
      if (Array.isArray(raw.header)) {
        var header = [];
        var refs = wsActionRefs(entry);
        for (var hi = 0; hi < raw.header.length; hi++) {
          var href = raw.header[hi];
          if (typeof href !== "string" || href === "") continue;
          if (refs.indexOf(href) < 0 || header.indexOf(href) >= 0) continue;
          header.push(href);
        }
        entry.header = header;
      }
      return entry;
    }
    /** 整张表：逐条校验 + 按 path 去重（后出现的覆盖前面的）。 */
    function wsNormalizeAll(raw) {
      var out = { version: WS_VERSION, workspaces: [] };
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
      var list = Array.isArray(raw.workspaces) ? raw.workspaces : [];
      for (var i = 0; i < list.length && out.workspaces.length < 64; i++) {
        var entry = wsNormalizeEntry(list[i], "");
        if (entry === null) continue;
        var replaced = false;
        for (var k = 0; k < out.workspaces.length; k++) {
          if (out.workspaces[k].path === entry.path) { out.workspaces[k] = entry; replaced = true; break; }
        }
        if (!replaced) out.workspaces.push(entry);
      }
      return out;
    }
    // ── 3b-iii. 工作区配置文件（agent 批量入口）────────────────────────────────
    //
    // 文件 = 当前会话工作区里的 `.dsh-deepworker.buttons.json`。它不是新的存储根：
    // 客户端读它、**整份替换** `workspaces.v1`，之后 UI 仍是唯一编辑面。与 UI 的宽松
    // 校验不同，这里**任一条错误都整份拒绝** —— 静默丢半张表比不生效更难查。
    var TERM_CONFIG_FILE = ".dsh-deepworker.buttons.json";
    var TERM_CONFIG_MAX_CHARS = 200000;
    function termConfigFail(where, field, message) {
      return { path: where, field: field, message: message };
    }
    /** Character count after the same newline/NUL normalization the executor uses. */
    function termCommandChars(raw) {
      var text = typeof raw === "string" ? raw : "";
      return text.replace(/\r\n?/g, "\n").split("\u0000").join("").length;
    }
    /** @returns {{ok:boolean, errors:Array, store:object|null}} */
    function parseTerminalConfigFile(text) {
      var raw = String(text == null ? "" : text);
      if (raw.length > TERM_CONFIG_MAX_CHARS) { return { ok: false, errors: [termConfigFail("file", "size", "file is larger than " + TERM_CONFIG_MAX_CHARS + " characters")], store: null }; }
      if (raw.trim() === "") { return { ok: false, errors: [termConfigFail("file", "empty", "file is empty")], store: null }; }
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, errors: [termConfigFail("file", "json", String((e && e.message) || e))], store: null }; }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { return { ok: false, errors: [termConfigFail("file", "root", "root must be an object")], store: null }; }
      var errors = [];
      if (parsed.version !== undefined && parsed.version !== 1) errors.push(termConfigFail("file", "version", "version must be 1"));
      if (!Array.isArray(parsed.workspaces)) errors.push(termConfigFail("file", "workspaces", "workspaces must be an array"));
      if (errors.length > 0) return { ok: false, errors: errors, store: null };
      if (parsed.workspaces.length > 64) errors.push(termConfigFail("file", "workspaces", "at most 64 workspaces are allowed"));
      var seen = {};
      var store = { version: WS_VERSION, workspaces: [] };
      for (var i = 0; i < parsed.workspaces.length && i < 64; i++) {
        var item = parsed.workspaces[i];
        var where = "workspaces[" + i + "]";
        if (item === null || typeof item !== "object" || Array.isArray(item)) { errors.push(termConfigFail(where, "entry", "workspace must be an object")); continue; }
        var path = wsNormalizePath(item.path);
        if (path === "") { errors.push(termConfigFail(where + ".path", "path", "an absolute path is required")); continue; }
        if (seen[path] === true) { errors.push(termConfigFail(where + ".path", "path", "duplicate path: " + path)); continue; }
        seen[path] = true;
        if (item.start && termCommandChars(item.start.command) > TERM_FIELD_MAX) errors.push(termConfigFail(where + ".start.command", "command", "command is longer than " + TERM_FIELD_MAX + " characters"));
        if (item.stop && termCommandChars(item.stop.command) > TERM_FIELD_MAX) errors.push(termConfigFail(where + ".stop.command", "command", "command is longer than " + TERM_FIELD_MAX + " characters"));
        var fatalStart = item.start && termFatalReason(item.start.command);
        if (fatalStart) errors.push(termConfigFail(where + ".start.command", "command", "fatal command rejected: " + fatalStart));
        var fatalStop = item.stop && termFatalReason(item.stop.command);
        if (fatalStop) errors.push(termConfigFail(where + ".stop.command", "command", "fatal command rejected: " + fatalStop));
        var start = wsNormalizeAction(item.start);
        var stop = wsNormalizeAction(item.stop);
        var extras = [];
        var rawExtras = Array.isArray(item.extras) ? item.extras : [];
        if (rawExtras.length > 32) errors.push(termConfigFail(where + ".extras", "extras", "at most 32 extra buttons are allowed"));
        for (var j = 0; j < rawExtras.length && j < 32; j++) {
          var extra = wsNormalizeAction(rawExtras[j]);
          if (extra.label === "" || extra.command === "") { errors.push(termConfigFail(where + ".extras[" + j + "]", "label/command", "both label and command are required")); continue; }
          if (termCommandChars(rawExtras[j] && rawExtras[j].command) > TERM_FIELD_MAX) { errors.push(termConfigFail(where + ".extras[" + j + "].command", "command", "command is longer than " + TERM_FIELD_MAX + " characters")); continue; }
          var fatalExtra = termFatalReason(rawExtras[j] && rawExtras[j].command);
          if (fatalExtra) { errors.push(termConfigFail(where + ".extras[" + j + "].command", "command", "fatal command rejected: " + fatalExtra)); continue; }
          extras.push({ label: extra.label, command: extra.command, pre: Array.isArray(rawExtras[j].pre) ? rawExtras[j].pre : [] });
        }
        var hasCommand = start.command !== "" || stop.command !== "" || extras.length > 0;
        if (!hasCommand) errors.push(termConfigFail(where, "command", "at least one start/stop/extra command is required"));
        var entry = wsNormalizeEntry({
          path: path,
          label: item.label,
          start: item.start,
          stop: item.stop,
          extras: extras,
          preStart: item.preStart,
          timeoutSec: item.timeoutSec,
          timeout: item.timeout,
          stopBeforeStart: item.stopBeforeStart,
          logToFile: item.logToFile
        }, path);
        if (entry === null) { errors.push(termConfigFail(where, "entry", "could not normalize this workspace")); continue; }
        if (item.header !== undefined) {
          if (!Array.isArray(item.header)) errors.push(termConfigFail(where + ".header", "header", "header must be an array"));
          else {
            var headerSeen = {};
            for (var hh = 0; hh < item.header.length; hh++) {
              var href = item.header[hh];
              if (typeof href !== "string" || href === "") { errors.push(termConfigFail(where + ".header[" + hh + "]", "header", "non-empty action reference required")); continue; }
              if (headerSeen[href] === true) { errors.push(termConfigFail(where + ".header[" + hh + "]", "header", "duplicate action reference: " + href)); continue; }
              headerSeen[href] = true;
              if (wsResolveAction(entry, href) === null) errors.push(termConfigFail(where + ".header[" + hh + "]", "header", "unknown action reference: " + href));
            }
          }
        }
        if (Array.isArray(item.preStart)) {
          for (var q = 0; q < item.preStart.length; q++) {
            var ref = item.preStart[q];
            if (typeof ref !== "string" || ref === "") { errors.push(termConfigFail(where + ".preStart[" + q + "]", "preStart", "non-empty action reference required")); continue; }
            if (wsResolveAction(entry, ref) === null) errors.push(termConfigFail(where + ".preStart[" + q + "]", "preStart", "unknown action reference: " + ref));
          }
        }
        for (var xi = 0; xi < entry.extras.length; xi++) {
          var rawOwnPre = rawExtras[xi] && Array.isArray(rawExtras[xi].pre) ? rawExtras[xi].pre : [];
          for (var xp = 0; xp < rawOwnPre.length; xp++) {
            var ownRef = rawOwnPre[xp];
            if (typeof ownRef !== "string" || ownRef === "") { errors.push(termConfigFail(where + ".extras[" + xi + "].pre[" + xp + "]", "pre", "non-empty action reference required")); continue; }
            var ownResolved = wsResolveAction(entry, ownRef);
            if (ownResolved === null) { errors.push(termConfigFail(where + ".extras[" + xi + "].pre[" + xp + "]", "pre", "unknown action reference: " + ownRef)); continue; }
            if (ownResolved.id === "x:" + xi) errors.push(termConfigFail(where + ".extras[" + xi + "].pre[" + xp + "]", "pre", "an extra button cannot pre-run itself"));
            else if (ownResolved.command === "") errors.push(termConfigFail(where + ".extras[" + xi + "].pre[" + xp + "]", "pre", "referenced action has no command: " + ownRef));
          }
        }
        store.workspaces.push(entry);
      }
      if (errors.length > 0) return { ok: false, errors: errors, store: null };
      return { ok: true, errors: [], store: wsNormalizeAll(store) };
    }

    /** 深拷一条工作区：draft 与已保存的那份必须脱钩（改 draft 不许改到存储里的对象）。 */
    function wsClone(entry) {
      var copy = {
        path: entry.path,
        label: entry.label,
        start: { label: entry.start.label, command: entry.start.command },
        stop: { label: entry.stop.label, command: entry.stop.command },
        extras: [],
        preStart: entry.preStart.slice(),
        timeoutSec: entry.timeoutSec,
        stopBeforeStart: entry.stopBeforeStart === true,
        logToFile: entry.logToFile === true,
        header: Array.isArray(entry.header) ? entry.header.slice() : null
      };
      var extras = Array.isArray(entry.extras) ? entry.extras : [];
      for (var i = 0; i < extras.length; i++) copy.extras.push({ label: extras[i].label, command: extras[i].command, pre: Array.isArray(extras[i].pre) ? extras[i].pre.slice() : [] });
      return copy;
    }
    /** 老映射表（`terminalButtons.v1`）：只供**迁移**读，新代码一个字节都不写它。 */
    function wsReadLegacyMap() {
      try {
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(TERM_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return parsed;
      } catch (e) {
        return {};
      }
    }
    /**
     * 把一条老配置（`{v,timeout,seq,actions}`）翻成一条工作区记录。
     * 老模型按 cwd 存、只有 start/stop/`x:…` 三类 action，seq 里存的是 action id。
     * 新模型用 label 引用 extras ⇒ 老 `x:…` 的 label 为空时用命令前 40 字补一个
     * （老 UI 里那种按钮本来就渲染成空文字，补上只会更好认）。
     */
    function wsEntryFromLegacy(path, raw) {
      var normalizedPath = wsNormalizePath(path);
      if (normalizedPath === "") return null;
      var legacy = termNormalizeConfig(raw);
      var start = { label: "", command: "" };
      var stop = { label: "", command: "" };
      var extras = [];
      for (var i = 0; i < legacy.actions.length; i++) {
        var action = legacy.actions[i];
        if (action.id === "start") start = { label: action.label, command: action.command };
        else if (action.id === "stop") stop = { label: action.label, command: action.command };
        else if (action.command !== "") {
          extras.push({ label: action.label !== "" ? action.label : action.command.slice(0, 40), command: action.command });
        }
      }
      var preStart = [];
      for (var q = 0; q < legacy.seq.length; q++) {
        var ref = legacy.seq[q];
        if (ref === "start" || ref === "stop") { preStart.push(ref); continue; }
        for (var a = 0; a < legacy.actions.length; a++) {
          if (legacy.actions[a].id !== ref) continue;
          var label = legacy.actions[a].label !== "" ? legacy.actions[a].label : termNormalizeCommand(legacy.actions[a].command).slice(0, 40);
          if (label !== "") preStart.push(label);
        }
      }
      return wsNormalizeEntry({
        path: normalizedPath,
        label: wsBasename(normalizedPath),
        start: start,
        stop: stop,
        extras: extras,
        preStart: preStart,
        timeoutSec: legacy.timeout,
        stopBeforeStart: false
      }, normalizedPath);
    }
    /**
     * 读整张工作区表（**唯一读取入口**）。新键从未存在时做一次老数据迁移。
     * 任何损坏都不抛 —— 退化成空表（读不到 ≠ 崩）。
     */
    function wsReadAll() {
      var raw = null;
      var hadNew = false;
      try {
        if (typeof localStorage !== "undefined") {
          var text = localStorage.getItem(WS_KEY);
          if (text !== null) { hadNew = true; raw = JSON.parse(text); }
        }
      } catch (e) {
        // 新键存在但是坏 JSON：**不迁移**（否则会凭空复活用户已经删掉的工作区）。
        return wsNormalizeAll(null);
      }
      if (hadNew) return wsNormalizeAll(raw);
      var legacy = wsReadLegacyMap();
      var paths = Object.keys(legacy);
      var migrated = { version: WS_VERSION, workspaces: [] };
      for (var i = 0; i < paths.length; i++) {
        var entry = wsEntryFromLegacy(paths[i], legacy[paths[i]]);
        if (entry === null) continue;
        migrated.workspaces.push(entry);
      }
      if (migrated.workspaces.length > 0) {
        // 迁移结果**立刻落盘**：否则下次打开又要迁一遍，而且中途删掉的行会复活。
        if (!wsWriteAll(migrated).ok) return wsNormalizeAll(null);
        return wsNormalizeAll(migrated);
      }
      return migrated;
    }
    /**
     * 写整张表。与 `writeSettings` 同形：**报告**是否成功，绝不假装保存成功
     * （配额满 / 存储被禁时用户必须看到一句话，而不是一个"已保存"的谎）。
     * @returns {{ok:boolean, error?:string}}
     */
    function wsWriteAll(store) {
      try {
        if (typeof localStorage === "undefined") return { ok: false, error: "no storage" };
        localStorage.setItem(WS_KEY, JSON.stringify(wsNormalizeAll(store)));
        try {
          if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.Event === "function") {
            window.dispatchEvent(new window.Event("dsh-deepworker:terminal-config"));
          }
        } catch (e2) { /* a listener must never break the write */ }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    /** 按 path 找一条（找不到返回 null —— 调用方一律按"没配置"处理，绝不猜一个）。 */
    function wsFind(store, path) {
      var key = wsNormalizePath(path);
      if (key === "" || store === null || !Array.isArray(store.workspaces)) return null;
      for (var i = 0; i < store.workspaces.length; i++) if (store.workspaces[i].path === key) return store.workspaces[i];
      return null;
    }
    /** 插入或替换一条（返回**新表**，不改入参）。 */
    function wsUpsert(store, entry) {
      var next = wsNormalizeAll(store);
      var normalized = wsNormalizeEntry(entry, "");
      if (normalized === null) return next;
      for (var i = 0; i < next.workspaces.length; i++) {
        if (next.workspaces[i].path === normalized.path) { next.workspaces[i] = normalized; return next; }
      }
      next.workspaces.push(normalized);
      return next;
    }
    /** 删掉一条（返回**新表**）。只删配置，不碰任何文件、不停任何进程。 */
    function wsRemove(store, path) {
      var next = wsNormalizeAll(store);
      var key = wsNormalizePath(path);
      var kept = [];
      for (var i = 0; i < next.workspaces.length; i++) if (next.workspaces[i].path !== key) kept.push(next.workspaces[i]);
      next.workspaces = kept;
      return next;
    }
    /** 某个路径对应的那条工作区（头部按钮与设置页共用同一个判据）。 */
    function termWorkspaceEntry(path) {
      return wsFind(wsReadAll(), path);
    }
    /**
     * 把一条工作区翻成**老配置形状**（`{v,timeout,seq,actions}`）。
     * 为什么保留这层：执行器与头部按钮都按这个形状消费配置，而"配置长什么样"与"命令怎么跑"
     * 是两件事 —— 换存储模型不该顺手重写执行器。extras 的 id 在这里按位置生成 `x:0…`
     * （只在这一份快照里有效，**不落盘**）。
     */
    function wsToLegacyConfig(entry) {
      var out = termDefaults();
      if (entry === null || typeof entry !== "object") return out;
      out.timeout = entry.timeoutSec;
      var actions = [
        { id: "start", label: entry.start.label, command: entry.start.command },
        { id: "stop", label: entry.stop.label, command: entry.stop.command }
      ];
      var extras = Array.isArray(entry.extras) ? entry.extras : [];
      for (var i = 0; i < extras.length; i++) actions.push({ id: "x:" + i, label: extras[i].label, command: extras[i].command });
      out.actions = actions;
      var seq = [];
      var preStart = Array.isArray(entry.preStart) ? entry.preStart : [];
      for (var q = 0; q < preStart.length; q++) {
        var resolved = wsResolveAction(entry, preStart[q]);
        if (resolved !== null) seq.push(resolved.id);
      }
      out.seq = seq;
      return out;
    }
    /** 读某个工作区路径的配置（**老形状**）；读不到 ⇒ 一份**全新**的默认配置。 */
    function termReadConfig(cwd) {
      var entry = termWorkspaceEntry(cwd);
      return entry === null ? termDefaults() : wsToLegacyConfig(entry);
    }
    /**
     * 给某个工作区路径写配置（**兼容层**，老形状）。
     * 新 UI 不走这里（它直接编辑工作区表）；保留它是因为：
     *   · 行为套件按 `termWriteConfig(cwd, config)` 的契约在验执行器；
     *   · 它是"给一个还不在列表里的路径配命令"的等价物 ⇒ **会新增**那条工作区
     *     （否则写进去读不出来，就是"说得比做得多"）。
     * @returns {{ok:boolean, error?:string}}
     */
    function termWriteConfig(cwd, config) {
      try {
        if (typeof localStorage === "undefined") return { ok: false, error: "no storage" };
        var path = wsNormalizePath(cwd);
        if (path === "") return { ok: false, error: "no cwd" };
        var store = wsReadAll();
        var entry = wsEntryFromLegacy(path, config);
        if (entry === null) return { ok: false, error: "bad config" };
        var existing = wsFind(store, path);
        if (existing !== null) {
          // 老形状里没有这两个字段 ⇒ 保留用户已经配好的值（绝不因为一次老接口写入把它们抹掉）
          entry.label = existing.label;
          entry.stopBeforeStart = existing.stopBeforeStart;
        }
        return wsWriteAll(wsUpsert(store, entry));
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    // ── 3b-iv. 最近输出（B，默认开）────────────────────────────────────────────
    // 执行器从 attach 流里逐帧拿到 output；这里只留最近若干条，供设置页「最近输出」查看。
    // A（写文件）是每个工作区自己的开关，见 termLoggedCommand。
    var TERM_LOG_KEY = "dsh.deepworker.termLogs";
    var TERM_LOG_MAX_ENTRIES = 20;
    var TERM_LOG_MAX_TOTAL = 200000;
    var TERM_LOG_MAX_ENTRY = 40000;
    function readTermLogs() {
      try {
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(TERM_LOG_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        var out = [];
        for (var i = 0; i < parsed.length && out.length < TERM_LOG_MAX_ENTRIES; i++) {
          var item = parsed[i];
          if (item === null || typeof item !== "object") continue;
          out.push({
            at: typeof item.at === "string" ? item.at : "",
            label: typeof item.label === "string" ? item.label : "",
            workspace: typeof item.workspace === "string" ? item.workspace : "",
            action: typeof item.action === "string" ? item.action : "",
            state: typeof item.state === "string" ? item.state : "",
            code: typeof item.code === "number" ? item.code : null,
            output: typeof item.output === "string" ? item.output.slice(-TERM_LOG_MAX_ENTRY) : "",
            logPath: typeof item.logPath === "string" ? item.logPath : ""
          });
        }
        return out;
      } catch (e) { return []; }
    }
    function writeTermLogs(list) {
      try {
        if (typeof localStorage === "undefined") return false;
        localStorage.setItem(TERM_LOG_KEY, JSON.stringify((Array.isArray(list) ? list : []).slice(0, TERM_LOG_MAX_ENTRIES)));
        return true;
      } catch (e) { return false; }
    }
    function appendTermLog(record) {
      try {
        var item = {
          at: record && typeof record.at === "string" ? record.at : new Date().toISOString(),
          label: record && typeof record.label === "string" ? record.label : "",
          workspace: record && typeof record.workspace === "string" ? record.workspace : "",
          action: record && typeof record.action === "string" ? record.action : "",
          state: record && typeof record.state === "string" ? record.state : "",
          code: record && typeof record.code === "number" ? record.code : null,
          output: record && typeof record.output === "string" ? record.output.slice(-TERM_LOG_MAX_ENTRY) : "",
          logPath: record && typeof record.logPath === "string" ? record.logPath : ""
        };
        var list = readTermLogs();
        list.unshift(item);
        var total = 0;
        var kept = [];
        for (var i = 0; i < list.length && kept.length < TERM_LOG_MAX_ENTRIES; i++) {
          total += list[i].output.length;
          if (total > TERM_LOG_MAX_TOTAL && kept.length > 0) break;
          kept.push(list[i]);
        }
        writeTermLogs(kept);
        try {
          if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.Event === "function") {
            window.dispatchEvent(new window.Event("dsh-deepworker:term-log"));
          }
        } catch (e2) { /* listener is best effort */ }
        return true;
      } catch (e) { return false; }
    }
    function clearTermLogs() {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(TERM_LOG_KEY);
        try {
          if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.Event === "function") {
            window.dispatchEvent(new window.Event("dsh-deepworker:term-log"));
          }
        } catch (e2) { /* best effort */ }
        return true;
      } catch (e) { return false; }
    }
    /**
     * A（可选）：把命令输出写进工作区的 .dsh-deepworker/logs/ 下。
     * 先生成日志路径，再用 shell 重定向；结束标记挂在**重定向之后**，所以退出码仍是命令的。
     */
    function termLoggedCommand(cwd, command, logRel, first, title) {
      var path = wsNormalizePath(cwd);
      var body = termNormalizeCommand(command).replace(/[;\s]+$/, "");
      var redirect = first === true ? ">" : ">>";
      var quotedLog = termQuotePath(logRel);
      var group = "echo " + termQuotePath("=== " + title + " ===") + "; " + body + " ;";
      var prefix = path === "" ? "" : "cd " + termQuotePath(path) + " && ";
      return prefix + "mkdir -p .dsh-deepworker/logs && { " + group + " } " + redirect + " " + quotedLog + " 2>&1; __dw=$?; tail -n 40 " + quotedLog + "; echo __DW_DONE_${__dw}__";
    }
    /** 一个 action 的最终可见标签 = 用户设置，或出厂默认（只有固定两个有默认）。 */
    function termActionLabel(action, t) {
      if (action && typeof action.label === "string" && action.label !== "") return action.label;
      if (action && action.id === "start") return t("term.buttonStart");
      if (action && action.id === "stop") return t("term.buttonStop");
      return "";
    }
    /** 配置里**已经写好命令**的 action（按 actions 顺序），供「前置序列」挑选。 */
    function termDefinedActions(config) {
      var out = [];
      for (var i = 0; i < config.actions.length; i++) {
        var a = config.actions[i];
        if (typeof a.command === "string" && a.command !== "") out.push(a);
      }
      return out;
    }
    /**
     * 把一条命令包成"跑完会回一行结束标记"的**一行**：
     *   <命令> ; echo __DW_DONE_$?__
     *
     * `$?` 在用户敲进去的字面文本里**只出现一次**（外壳回显的是 `echo __DW_DONE_$?__`），
     * 而命令真正跑完时输出的是 `echo __DW_DONE_0__`。两者的正则形状不同，所以回显不会
     * 被误判成"完成"；取值时**取最后一次**匹配（见 termScanMarker）。
     */
    var TERM_MARKER_HEAD = "__DW_DONE_";
    var TERM_MARKER_RE = /__DW_DONE_(-?\d+)__/g;
    function termWrapCommand(command) {
      return termNormalizeCommand(command) + " ; echo " + TERM_MARKER_HEAD + "$?__";
    }
    /** 在一段累积输出里找**最后一次**完整的结束标记；没有就返回 null。 */
    function termScanMarker(text) {
      var source = typeof text === "string" ? text : "";
      TERM_MARKER_RE.lastIndex = 0;
      var last = null;
      var m;
      while ((m = TERM_MARKER_RE.exec(source)) !== null) last = Number(m[1]);
      if (last !== null && isFinite(last)) return last;
      return null;
    }
    /**
     * 把一个工作区路径包成 shell 能吃的**双引号**字面量。
     *
     * 为什么是双引号而不是单引号：单引号里不能再出现单引号（`it's` 这种目录名会让整条命令
     * 语法错误）；双引号里只需要转义 `\ " $ ` ` 四个字符，**空格、中文、单引号都原样安全**。
     * （三种路径夹具在 verify_workspaces.mjs 里真跑 `/bin/sh -c 'cd … && pwd'` 验过。）
     */
    function termQuotePath(raw) {
      var text = typeof raw === "string" ? raw : "";
      var escaped = text.replace(/([\\"$`])/g, "\\$1");
      return '"' + escaped + '"';
    }
    /**
     * `cd <工作区> && { <命令> ; }` —— **别的工作区的命令必须先进它自己的目录**。
     *
     * 为什么终端的 cwd 不够：终端的 cwd = **当前会话**的 cwd（宿主按会话给）。给列表里另一个
     * 工作区跑启动命令时，不 cd 就会在错的地方启动服务 —— 那是最糟的一种"看起来成功了"。
     * 三处都不能省：
     *   ① `cd` 后面**必须**带引号（路径可能含空格 / 中文 / 单引号）；
     *   ② `&&` 而不是 `;` —— cd 失败时**不许**继续在原 cwd 里跑；
     *   ③ `{ … ; }` 花括号组 —— 用户命令里可能自带 `;`（多行输入会被折成 `; `），
     *      没有这个组时 `cd X && a; b` 里的 `b` 会无视 cd 成不成功，`$?` 也变成 `b` 的。
     * 路径为空（或不是绝对路径）⇒ 只返回命令本身（没有可 cd 的目标，绝不猜一个）。
     */
    function termCommandWithCwd(cwd, command) {
      var path = wsNormalizePath(cwd);
      var body = termNormalizeCommand(command);
      var trimmed = body.replace(/[;\s]+$/, "");
      if (path === "") return trimmed;
      if (trimmed === "") return "cd " + termQuotePath(path);
      return "cd " + termQuotePath(path) + " && { " + trimmed + " ; }";
    }
    /**
     * 一个工作区 + 一个动作 → 一次执行任务（命令序列**只**用这个工作区自己的配置拼）。
     * @param {object} entry 工作区记录（已归一化）
     * @param {string} ref `start` / `stop` / 某个 extra 的 label
     * @param {Function} t
     * @returns {{label:string, commands:{label:string,command:string}[], timeoutMs:number, cwd:string}|null}
     *   没有可跑的命令 ⇒ null（调用方必须只说话、绝不开一个空终端）
     */
    function termJobForEntry(entry, ref, t) {
      if (entry === null || typeof entry !== "object" || entry.path === undefined) return null;
      var target = null;
      var targetIndex = -1;
      if (ref === "start" || ref === "stop") {
        target = wsResolveAction(entry, ref);
      } else if (/^x:\d+$/.test(ref)) {
        targetIndex = parseInt(ref.slice(2), 10);
        var direct = entry.extras[targetIndex];
        if (direct !== undefined) target = { id: ref, label: direct.label, command: direct.command };
      } else {
        target = wsResolveAction(entry, ref);
        if (target !== null && /^x:\d+$/.test(target.id)) targetIndex = parseInt(target.id.slice(2), 10);
      }
      if (target === null) return null;
      var commands = [];
      if (ref === "start") {
        // ① 「点启动时先跑停止」= 显式布尔（需求书里的 `stopBeforeStart`）。
        //    ⚠️ 如果 preStart 里**已经**有 stop，就不再重复：同一条命令跑两遍会把刚起来的
        //    服务又停掉 —— 顺序反了就是灾难。
        if (entry.stopBeforeStart === true && entry.preStart.indexOf("stop") < 0
          && entry.stop.command !== "" && entry.start.command !== "") {
          commands.push({ label: termActionLabel({ id: "stop", label: entry.stop.label }, t), command: entry.stop.command });
        }
        // ② 前置序列：用户挑的顺序，逐条解析（解析不出来的跳过 —— 归一化时已经剔过一遍）
        for (var q = 0; q < entry.preStart.length; q++) {
          var pre = wsResolveAction(entry, entry.preStart[q]);
          if (pre === null || pre.command === "" || pre.id === "start") continue;
          commands.push({ label: termActionLabel({ id: pre.id, label: pre.label }, t), command: pre.command });
        }
      }
      // 额外按钮自己的前置序列：按顺序跑，解析不出来的跳过（归一化已剔过一遍）。
      // 只取被引用动作的**命令**，不再递归它自己的前置，避免环。
      if (targetIndex >= 0) {
        var targetExtra = entry.extras[targetIndex];
        var ownPre = targetExtra && Array.isArray(targetExtra.pre) ? targetExtra.pre : [];
        for (var op = 0; op < ownPre.length; op++) {
          var preAction = wsResolveAction(entry, ownPre[op]);
          if (preAction === null || preAction.command === "" || preAction.id === target.id) continue;
          commands.push({ label: termActionLabel({ id: preAction.id, label: preAction.label }, t), command: preAction.command });
        }
      }
      if (target.command !== "") {
        commands.push({ label: termActionLabel({ id: target.id, label: target.label }, t), command: target.command });
      } else if (commands.length === 0) {
        return null;
      }
      var fatal = null;
      for (var ff = 0; ff < commands.length; ff++) { var fr = termFatalReason(commands[ff].command); if (fr) { fatal = fr; break; } }
      return {
        label: entry.label,
        commands: commands,
        fatal: fatal,
        timeoutMs: Math.max(TERM_TIMEOUT_MIN, Math.round(entry.timeoutSec || TERM_TIMEOUT_DEFAULT)) * 1000,
        cwd: entry.path,
        logToFile: entry.logToFile === true
      };
    }

    /**
     * 在 `follow` 流上等结束标记。
     *
     * ⚠️ 判据是**结束标记**，不是 `WebTerminalInfo.state`：那个 state 反映的是**外壳 PTY**
     * （交互式 shell 里命令跑完后 shell 还活着 ⇒ state 一直是 `running`）⇒ 拿它当判据会
     * 永远得到"仍在运行"。标记由命令自己产出，所以它才是"这行命令跑完了"的证据。
     *
     * @returns {Promise<{kind:"done",code:number}|{kind:"timeout"}|{kind:"ended"}|{kind:"aborted",reason:string}>}
     */
    function termWaitForMarker(iterator, signal, timeoutMs) {
      return new Promise(function (resolve) {
        var settled = false;
        var buffer = "";
        var captured = "";
        var timer = null;
        var onAbort = null;
        // signal 可能**根本不存在**（老宿主 / 测试桩 / 没有 AbortController 的环境）。
        // 没有它就只是"不能取消"，绝不是"崩溃" —— 所以这里一律按可选处理。
        var sig = signal === undefined || signal === null ? null : signal;
        function finish(value) {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          if (onAbort !== null && sig !== null && typeof sig.removeEventListener === "function") {
            sig.removeEventListener("abort", onAbort);
          }
          value.output = captured;
          resolve(value);
        }
        onAbort = function () {
          finish({ kind: "aborted", reason: String(sig === null || sig.reason === undefined ? "aborted" : sig.reason) });
        };
        if (sig !== null && typeof sig.addEventListener === "function") sig.addEventListener("abort", onAbort);
        if (sig !== null && sig.aborted === true) { onAbort(); return; }
        timer = setTimeout(function () { finish({ kind: "timeout" }); }, timeoutMs);
        (async function pump() {
          try {
            for (;;) {
              if (settled) return;
              var step = await iterator.next();
              if (settled) return;
              if (step.done === true) { finish({ kind: "ended" }); return; }
              var frame = step.value;
              // 只累加**原始输出**帧：snapshot 是整屏重放，会把早先的输出再算一遍。
              if (frame && frame.type === "output" && typeof frame.data === "string") {
                buffer = (buffer + frame.data).slice(-65536);
                captured = (captured + frame.data).slice(-TERM_LOG_MAX_ENTRY);
                var code = termScanMarker(buffer);
                if (code !== null) { finish({ kind: "done", code: code }); return; }
              }
            }
          } catch (e) {
            finish({ kind: "ended" });
          }
        })();
      });
    }
    /**
     * 在**新开的终端**里按顺序跑一批命令。
     *
     * 顺序是硬要求（用户要能验）：
     *   create → rename → retain → follow → 迭代到首帧 → write
     * `retain` 在 `follow` **之前**（先持有名额，再挂上去看屏幕）。
     *
     * ⚠️⚠️ **绝不调用 `close`**：`close` 会 SIGTERM→SIGKILL 杀**整个进程树**（长驻服务会被
     * 一起停掉），而且 `closedIds` 是终身的（同 id 再 create 报 `terminal/unavailable`）。
     * 收尾一律是**断开这条流**（`iterator.return()`），进程照活。
     *
     * @param {object} deps `{ terminal, t, signal, now, uuid, cols, rows }`
     * @param {string} agent 会话 id —— **必须显式当第一个参数传**：插件的 onClick 跑在根 ctx，
     *   会走 `direct` 回退路径，宿主拿它反解 Agent（会话不活跃会自动 resume）。
     * @param {{label:string, commands:{label:string,command:string}[], timeoutMs:number}} job
     */
    async function termRunSequence(deps, agent, job) {
      var terminal = deps && deps.terminal;
      var t = deps && typeof deps.t === "function" ? deps.t : function (k) { return k; };
      var signal = deps && deps.signal;
      var timeoutMs = job.timeoutMs;
      var newUuid = deps && typeof deps.uuid === "function" ? deps.uuid : function () { return String(Date.now()); };
      var steps = [];
      function record(name, ok, detail) {
        steps.push({ step: name, ok: ok, detail: detail === undefined ? null : detail });
      }
      var label = job.label;
      var id = newUuid();
      var ran = [];
      var runOutput = "";
      var outcome = {
        state: "error",
        code: null,
        detail: "",
        steps: steps,
        id: id,
        label: label,
        commands: job.commands,
        timeoutMs: timeoutMs,
        ran: ran,
        at: (deps && typeof deps.now === "function" ? deps.now() : new Date().toISOString())
      };
      Object.defineProperty(outcome, "output", { enumerable: true, get: function () { return runOutput; } });
      var logRel = "";
      var logFirst = true;
      if (job.logToFile === true) {
        var stamp = (deps && typeof deps.now === "function" ? deps.now() : new Date().toISOString()).replace(/[:.]/g, "-");
        var safeLabel = String(label || "run").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "run";
        logRel = ".dsh-deepworker/logs/" + stamp + "-" + safeLabel + ".log";
        outcome.logPath = (job.cwd === "" ? "" : job.cwd.replace(/\/+$/, "") + "/") + logRel;
      }

      if (typeof agent !== "string" || agent === "") {
        record("identity", false, "empty agent");
        outcome.detail = "identity: empty agent id";
        return outcome;
      }
      if (!terminal || typeof terminal.create !== "function") {
        record("remote", false, "ctx.remote.terminal missing");
        outcome.detail = "remote: terminal service missing";
        return outcome;
      }

      var iterator = null;
      var cleanup = async function () {
        // **断开流**，不是 close。收尾失败要吞掉：它不该覆盖真正的结论。
        if (iterator === null) return;
        var it = iterator;
        iterator = null;
        try { if (typeof it.return === "function") await it.return(); } catch (e) { /* disconnect is best effort */ }
      };

      try {
        // ① create —— 同 id 幂等；id 必须匹配 /^[\w-]{1,128}$/ ⇒ randomUUID 最稳。
        var info;
        try {
          info = await terminal.create(agent, { id: id, cols: deps.cols || 120, rows: deps.rows || 30 });
          record("create", true, id);
        } catch (e) {
          record("create", false, String((e && e.message) || e));
          outcome.detail = t("term.createFailed", { step: t("term.stepCreate"), detail: String((e && e.message) || e) });
          return outcome;
        }
        var terminalId = info && typeof info.id === "string" && info.id !== "" ? info.id : id;
        outcome.id = terminalId;

        // ② rename —— 给终端打标记，用户回头能认出这是谁开的。
        try {
          await terminal.rename(agent, terminalId, termNormalizeLabel("DeepWorker · " + label, "DeepWorker"));
          record("rename", true, label);
        } catch (e) {
          // rename 失败不致命（终端已经在跑了），但**必须记下来**。
          record("rename", false, String((e && e.message) || e));
        }

        // ③/④ 挂到终端上。DSH 0.2.1-rc.2 的 remote 是 attach()（返回带 send() 的
        // handle），更早的版本是 retain() + follow() + write()。两条路都留着：
        // 真机走 attach，老宿主/老套件仍走 follow。
        var useAttach = typeof terminal.attach === "function";
        var attachment = null;
        var attachSeq = 0;
        if (useAttach) {
          try {
            attachment = await terminal.attach(agent, terminalId, signal);
            iterator = attachment && typeof attachment[Symbol.asyncIterator] === "function"
              ? attachment[Symbol.asyncIterator]()
              : attachment;
            var first = await iterator.next();
            if (first.done === true) throw new Error("attach ended before its snapshot");
            record("follow", true, "snapshot");
          } catch (e) {
            record("follow", false, String((e && e.message) || e));
            outcome.detail = t("term.createFailed", { step: t("term.stepFollow"), detail: String((e && e.message) || e) });
            await cleanup();
            return outcome;
          }
        } else {
          // ③ retain（老 API）—— 独立的 stream，作用是持有名额、防止空闲 2 小时被回收。
          try {
            await terminal.retain(agent, terminalId, signal);
            record("retain", true, null);
          } catch (e) {
            record("retain", false, String((e && e.message) || e));
            outcome.detail = t("term.createFailed", { step: t("term.stepRetain"), detail: String((e && e.message) || e) });
            return outcome;
          }

          // ④ follow（老 API）—— 必须先把流迭代到**第一帧**（snapshot），之后 write 才拿得到 attachmentId。
          var attachmentId = newUuid();
          try {
            var stream = terminal.follow(agent, terminalId, attachmentId, signal);
            iterator = stream && typeof stream[Symbol.asyncIterator] === "function" ? stream[Symbol.asyncIterator]() : stream;
            var first = await iterator.next();
            if (first.done === true) throw new Error("follow ended before its snapshot");
            record("follow", true, "snapshot");
          } catch (e) {
            record("follow", false, String((e && e.message) || e));
            outcome.detail = t("term.createFailed", { step: t("term.stepFollow"), detail: String((e && e.message) || e) });
            await cleanup();
            return outcome;
          }
        }

        // ⑤ 逐条 write。上一条的结束标记必须**先到**，才轮到下一条。
        for (var i = 0; i < job.commands.length; i++) {
          var entry = job.commands[i];
          var isLast = i === job.commands.length - 1;
          var which = isLast ? "target" : "pre" + (i + 1);
          var stepName = isLast ? label : label + " · 前置 " + (i + 1);
          try {
            // ⚠️ 每个工作区的命令都必须先 `cd` 到**它自己**的路径：终端的 cwd 是**当前会话**
            //    的 cwd，跑列表里别的工作区的命令不 cd 就会在错的地方启动服务（那是最糟的
            //    一种"看起来成功了"）。引号与 `&&` 花括号组的理由见 termCommandWithCwd。
            var wrappedCommand;
            if (job.logToFile === true) {
              wrappedCommand = termLoggedCommand(job.cwd, entry.command, logRel, logFirst, stepName);
              logFirst = false;
            } else {
              wrappedCommand = termWrapCommand(termCommandWithCwd(job.cwd, entry.command));
            }
            var line = wrappedCommand + "\n";
            if (useAttach) {
              if (attachment === null || typeof attachment.send !== "function") throw new Error("terminal.attach did not return send()");
              attachSeq = attachSeq + 1;
              attachment.send({ type: "write", sequence: attachSeq, data: line });
            } else {
              await terminal.write(agent, terminalId, attachmentId, line);
            }
            record("write:" + which, true, entry.command);
          } catch (e) {
            record("write:" + which, false, String((e && e.message) || e));
            outcome.detail = t("term.createFailed", { step: t("term.stepWrite"), detail: String((e && e.message) || e) });
            await cleanup();
            return outcome;
          }
          var wait = await termWaitForMarker(iterator, signal, timeoutMs);
          if (wait && typeof wait.output === "string") runOutput = (runOutput + wait.output).slice(-TERM_LOG_MAX_ENTRY);
          if (wait.kind === "aborted") {
            record("wait:" + which, false, "aborted");
            ran.push({ label: entry.label, code: null, state: "aborted" });
            outcome.state = "aborted";
            outcome.detail = t("term.aborted");
            await cleanup();
            return outcome;
          }
          if (wait.kind === "ended") {
            record("wait:" + which, false, "stream ended");
            ran.push({ label: entry.label, code: null, state: "ended" });
            outcome.state = "error";
            outcome.detail = t("term.streamEnded");
            await cleanup();
            return outcome;
          }
          if (wait.kind === "timeout") {
            // ⚠️ 超时**不是失败**：常驻服务跑起来之后就一直不回标记。
            record("wait:" + which, false, "timeout");
            ran.push({ label: entry.label, code: null, state: "running" });
            if (!isLast) {
              // 前置命令没跑完 ⇒ 后面的**不许开始**（否则"顺序可验证"就是假的）。
              outcome.state = "prereq-running";
              outcome.stillRunning = true;
              outcome.detail = t("term.beforeRunning", { label: label, n: i + 1 });
              await cleanup();
              return outcome;
            }
            outcome.state = "running";
            outcome.stillRunning = true;
            outcome.detail = t("term.stillRunning", { label: label, seconds: Math.round(timeoutMs / 1000) });
            await cleanup();
            return outcome;
          }
          // wait.kind === "done"
          record("wait:" + which, true, wait.code);
          ran.push({ label: entry.label, code: wait.code, state: "done" });
          if (!isLast && wait.code !== 0) {
            // 前置命令**失败** ⇒ 后面的不许开始（停不下来却继续启动是最糟的形状）。
            outcome.state = "prereq-failed";
            outcome.code = wait.code;
            outcome.detail = t("term.doneFail", { label: stepName, code: wait.code });
            await cleanup();
            return outcome;
          }
          if (isLast) {
            outcome.state = "done";
            outcome.code = wait.code;
            outcome.detail = wait.code === 0
              ? t("term.done", { label: label, code: wait.code })
              : t("term.doneFail", { label: label, code: wait.code });
          }
        }
        await cleanup();
        return outcome;
      } catch (e) {
        record("unexpected", false, String((e && e.message) || e));
        outcome.state = "error";
        outcome.detail = t("term.unexpected", { detail: String((e && e.message) || e) });
        await cleanup();
        return outcome;
      }
    }
    /** 把一次运行结果压成「调试」里那一行（形状与「上次跳转诊断」同构）。 */
    function termDescribeOutcome(t, outcome) {
      if (!outcome) return "";
      var tail;
      if (outcome.state === "done") tail = t("term.diagOk", { code: String(outcome.code) });
      else if (outcome.state === "running" || outcome.state === "prereq-running") {
        tail = t("term.diagRunning", { seconds: String(Math.round((outcome.timeoutMs || 0) / 1000)) });
      } else if (outcome.state === "aborted") tail = t("term.diagAborted");
      else if (outcome.detail) tail = t("term.diagError", { detail: outcome.detail });
      else tail = t("term.diagFail", { code: String(outcome.code) });
      var cmds = outcome.commands || [];
      var cmd = cmds.length > 0 ? cmds[cmds.length - 1].command : "";
      var termId = outcome.id === undefined || outcome.id === null ? "" : String(outcome.id);
      return t("term.diagPrefix") + cmd + " · 终端 " + termId + " · " + tail + " · " + outcome.at;
    }

    /**
     * 批量的汇总句：**成功几个、失败几个、分别是哪些、为什么**。
     * 失败项必须带原因（detail 由执行器拼好），否则用户只知道"失败了"却不知道"为什么"。
     * @param {Function} t
     * @param {object} summary runTerminalBatch 的返回值
     * @returns {string}
     */
    function termBatchMessage(t, summary) {
      if (summary === null || typeof summary !== "object") return "";
      if (typeof summary.refused === "string" && summary.refused !== "") return summary.refused;
      var verb = summary.action === "stop" ? t("term.batchVerbStop") : t("term.batchVerbStart");
      var items = Array.isArray(summary.items) ? summary.items : [];
      if (summary.failed === 0 && summary.skipped === 0) {
        return t("term.batchOkAll", { verb: verb, ok: summary.ok, total: summary.total });
      }
      var bad = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        // 用每项自带的 ok 标记（state=done 也可能是非零退出码）。
        if (item.ok === true) continue;
        bad.push(item.label + "（" + (typeof item.detail === "string" && item.detail !== "" ? item.detail : item.state) + "）");
      }
      return t("term.batchSummary", { verb: verb, ok: summary.ok, total: summary.total, fail: summary.failed + summary.skipped, list: bad.join("；") });
    }

    // ── 4. 笔记数据层：localStorage + 标签规范化 ───────────────────────────────
    var NOTES_KEY = "dsh.deepworker.notes";
    /**
     * Notes are labelled with free-form tags. Normalising on every write keeps storage
     * clean and makes tag comparison exact (no leading `#`, no duplicates, no blanks).
     */
    function normalizeTags(input) {
      var out = [];
      var list = Array.isArray(input)
        ? input
        : (typeof input === "string" ? input.split(/[,，;；\s]+/) : []);
      for (var i = 0; i < list.length && out.length < 12; i++) {
        var tag = String(list[i] == null ? "" : list[i]).trim().replace(/^#+/, "").replace(/\s+/g, " ");
        if (tag === "" || tag.length > 24) continue;
        if (out.indexOf(tag) === -1) out.push(tag);
      }
      return out;
    }
    /** Every tag in use, with how many notes carry it, ordered by count then name. */
    function allTags(list) {
      var counts = {};
      for (var i = 0; i < list.length; i++) {
        var tags = normalizeTags(list[i] && list[i].tags);
        for (var j = 0; j < tags.length; j++) counts[tags[j]] = (counts[tags[j]] || 0) + 1;
      }
      return Object.keys(counts).sort(function (a, b) {
        if (counts[b] !== counts[a]) return counts[b] - counts[a];
        return a < b ? -1 : 1;
      }).map(function (tag) { return { tag: tag, count: counts[tag] }; });
    }
    /**
     * The tag actually filtering the list, or "" — derived from the notes themselves.
     *
     * Deleting the tag that was filtering must release the filter by itself: keeping it
     * in state is what left the page stuck on "0 / 2 · filtered" with no way back.
     */
    function activeTagOf(list, wanted) {
      if (typeof wanted !== "string" || wanted === "") return "";
      var tags = allTags(list);
      for (var i = 0; i < tags.length; i++) if (tags[i].tag === wanted) return wanted;
      return "";
    }
    /**
     * Notes to show: newest first, narrowed by tag and then by the search box.
     * Search matches tags too, so "#部署" and "部署" both find the labelled notes.
     */
    function filterNotes(list, query, activeTag) {
      var needle = String(query == null ? "" : query).trim().toLowerCase();
      var tag = typeof activeTag === "string" ? activeTag : "";
      var rows = [];
      for (var i = list.length - 1; i >= 0; i--) {
        var entry = list[i];
        if (!entry || typeof entry.text !== "string") continue;
        var entryTags = normalizeTags(entry.tags);
        if (tag !== "" && entryTags.indexOf(tag) === -1) continue;
        if (needle !== "") {
          var inText = entry.text.toLowerCase().indexOf(needle) !== -1;
          var inTags = entryTags.join(" ").toLowerCase().indexOf(needle.replace(/^#/, "")) !== -1;
          if (!inText && !inTags) continue;
        }
        rows.push(entry);
      }
      return rows;
    }
    function readNotes() {
      try {
        // 「笔记」总开关：关掉后笔记一条也不读 —— 这是"根本不产生内容"那一类，比"读了但
        // 界面上不画"更彻底（也避免关掉开关后 digest 仍然往笔记里追加）。
        if (!featureEnabled("featureNotes")) return [];
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(NOTES_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(function (n) { return n && typeof n.text === "string"; })
          .map(function (n) {
            return { id: n.id, text: n.text, at: n.at, tags: normalizeTags(n.tags) };
          });
      } catch (e) {
        return [];
      }
    }
    /** How many notes are kept. Callers must show the list that was actually stored. */
    var NOTES_MAX = 300;
    /** Where an unparseable blob is copied before it is overwritten. */
    var CORRUPT_BACKUP_PREFIX = "dsh.deepworker.corrupt.";
    /**
     * Persist notes, reporting success, the stored list, and how many were dropped.
     *
     * Three separate faults lived here: the failure was swallowed (so callers claimed
     * "saved"), the 300-cap was applied only on write while callers kept the untruncated
     * list (so the UI showed rows that were never stored), and a corrupt blob was
     * overwritten without a copy — permanently destroying data nothing else can restore.
     * @returns {{ok: boolean, list: Array, dropped: number, error?: string}}
     */
    function writeNotes(list) {
      var input = Array.isArray(list) ? list : [];
      var capped = input.slice(-NOTES_MAX);
      var result = { ok: false, list: capped, dropped: Math.max(0, input.length - capped.length) };
      try {
        if (typeof localStorage === "undefined") { result.error = "no storage"; return result; }
        // Keep a copy of anything unparseable: this file never removes keys, so without a
        // backup the next write is the point of no return.
        try {
          var raw = localStorage.getItem(NOTES_KEY);
          if (raw !== null) {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) localStorage.setItem(CORRUPT_BACKUP_PREFIX + Date.now(), raw);
          }
        } catch (e) {
          try { localStorage.setItem(CORRUPT_BACKUP_PREFIX + Date.now(), String(localStorage.getItem(NOTES_KEY))); } catch (e2) { /* keep going */ }
        }
        localStorage.setItem(NOTES_KEY, JSON.stringify(capped));
        result.ok = true;
        return result;
      } catch (e) {
        result.error = String((e && e.message) || e);
        return result;
      }
    }
    // The session header renders session-level actions as borderless icon+label
    // chips; a bordered Button stood out badly next to them.
    var headerActionStyle = {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      border: "0",
      background: "transparent",
      cursor: "pointer",
      color: "var(--dsw-alias-label-secondary)",
      font: "inherit",
      fontSize: "13px",
      lineHeight: "20px",
      padding: "4px 6px",
      borderRadius: "var(--dsw-radius-md)"
    };
    var notesButtonStyle = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      border: "0",
      background: "transparent",
      cursor: "pointer",
      color: "var(--dsw-alias-label-secondary)",
      font: "inherit",
      fontSize: "13px",
      lineHeight: "20px",
      padding: "6px",
      borderRadius: "var(--dsw-radius-md)"
    };
    /** A short window of text around the hit, for the match list. */
    function snippetAround(text, needle) {
      var hay = String(text == null ? "" : text);
      var at = hay.toLowerCase().indexOf(String(needle).toLowerCase());
      if (at < 0) return hay.replace(/\s+/g, " ").trim().slice(0, 60);
      var from = Math.max(0, at - 30);
      var to = Math.min(hay.length, at + needle.length + 30);
      return (from > 0 ? "…" : "") + hay.slice(from, to).replace(/\s+/g, " ").trim() + (to < hay.length ? "…" : "");
    }
    /**
     * Find a query inside the loaded conversation window.
     *
     * Built on the `turnOutline` projection the turn component already publishes, so the
     * result carries a TURN number — which is what makes a match jumpable: the chat DOM
    // ── 5. 会话内查找：纯函数匹配 + CSS Custom Highlight 高亮 ───────────────────
     * exposes `[data-turn-tail="<turn>"]`, the same anchor the quote jump uses.
     * DSH's own `session.search` returns session-level snippets with no turn or seq, so
     * it cannot place a hit inside the transcript.
     * @returns {Array<{turn:number, side:"prompt"|"response", snippet:string}>}
     */
    function findInConversation(query, outline) {
      var needle = String(query == null ? "" : query).trim().toLowerCase();
      if (needle === "") return [];
      var entries = Array.isArray(outline) ? outline : [];
      var out = [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry || typeof entry.turn !== "number") continue;
        var prompt = typeof entry.prompt === "string" ? entry.prompt : "";
        var response = typeof entry.response === "string" ? entry.response : "";
        var anchor = typeof entry.anchorKey === "string" ? entry.anchorKey : "";
        if (prompt.toLowerCase().indexOf(needle) !== -1) {
          out.push({ turn: entry.turn, side: "prompt", anchor: anchor, snippet: snippetAround(prompt, needle) });
        }
        if (response.toLowerCase().indexOf(needle) !== -1) {
          out.push({ turn: entry.turn, side: "response", anchor: anchor, snippet: snippetAround(response, needle) });
        }
      }
      return out;
    }
    /** Scroll a turn into view and flash it, so a jump is visible rather than assumed. */
    function flashTurn(turn, anchor) {
      if (typeof document === "undefined" || typeof document.querySelector !== "function") return false;
      // The right-side index scrolls by `data-chat-anchor-key`, and the `turnOutline`
      // projection publishes exactly that key per turn. Prefer it over guessed
      // attributes: it is the app's own anchor rather than one inferred from the DOM.
      var node = null;
      if (typeof anchor === "string" && anchor !== "") {
        node = document.querySelector('[data-chat-anchor-key="' + anchor + '"]');
      }
      if (node === null) node = document.querySelector('[data-turn-tail="' + turn + '"]');
      if (node === null) node = document.querySelector('[data-chat-turn="' + turn + '"]');
      if (node === null) return false;
      try {
        if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
        var previous = node.style.outline;
        node.style.outline = "2px solid var(--dsw-alias-label-primary)";
        setTimeout(function () { node.style.outline = previous; }, 900);
      } catch (e) {
        return false;
      }
      return true;
    }

    /**
     * In-conversation find bar.
     *
     * Imperative DOM on purpose: this codebase's proven paths for transient UI are the
     * notice and the context menu, both plain DOM, while React state in a slot entry has
     * been the unreliable one. The bar needs no slot and survives re-renders of the chat.
     */
    function closeFindBar() {
      if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
      var existing = document.getElementById("dsh-ha-find");
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      clearFindHighlights();
    }
    function openFindBar(t) {
      if (typeof document === "undefined" || typeof document.createElement !== "function" || !document.body) return false;
      // 「会话内查找」总开关：关掉后不开查找栏；调用方（命令 / header 按钮）负责说话。
      if (!featureEnabled("featureFind")) return false;
      closeFindBar();
      function mkButton(label, title) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = title;
        btn.style.cssText = "border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;padding:2px 6px;border-radius:var(--dsw-radius-sm);cursor:pointer;";
        return btn;
      }
      var wrap = document.createElement("div");
      wrap.id = "dsh-ha-find";
      wrap.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483100;display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px;";
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = t("find.placeholder");
      input.style.cssText = "width:260px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);padding:5px 8px;font:inherit;font-size:13px;";
      var count = document.createElement("span");
      count.style.cssText = "min-width:56px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;";
      var prev = mkButton("↑", t("find.prev"));
      var next = mkButton("↓", t("find.next"));
      var close = mkButton("✕", t("find.close"));
      var matches = [];
      var ranges = null;
      var index = 0;
      function render() {
        if (input.value.trim() === "") { count.textContent = ""; return; }
        count.textContent = matches.length === 0 ? "0/0" : (index + 1) + "/" + matches.length;
      }
      function move(step) {
        if (matches.length === 0) return;
        index = (index + step + matches.length) % matches.length;
        render();
        if (ranges !== null) {
          if (!focusRange(ranges, index)) showNotice(t("find.notInWindow"), { clientX: 24, clientY: 80 });
          return;
        }
        // No Highlight API: fall back to the turn-boundary jump.
        if (!flashTurn(matches[index].turn, matches[index].anchor)) showNotice(t("find.notInWindow"), { clientX: 24, clientY: 80 });
      }
      function search() {
        var query = input.value;
        ranges = highlightMatches(query);
        if (ranges !== null) {
          // The DOM is the truth for what is on screen: the count matches the highlights.
          matches = [];
          for (var i = 0; i < ranges.length; i++) matches.push({ turn: -1, side: "dom", snippet: "" });
        } else {
          matches = findInConversation(query, latestOutline.entries);
        }
        index = 0;
        render();
        if (matches.length > 0) move(0);
      }
      input.addEventListener("input", search);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); move(ev.shiftKey ? -1 : 1); return; }
        if (ev.key === "Escape") { ev.preventDefault(); closeFindBar(); }
      });
      prev.addEventListener("click", function () { move(-1); });
      next.addEventListener("click", function () { move(1); });
      close.addEventListener("click", closeFindBar);
      wrap.appendChild(input);
      wrap.appendChild(count);
      wrap.appendChild(prev);
      wrap.appendChild(next);
      wrap.appendChild(close);
      document.body.appendChild(wrap);
      if (typeof input.focus === "function") input.focus();
      return true;
    }

    /** One chip style shared by the filter bar and the per-note labels. */
    function noteTagChipStyle(active) {
      return {
        display: "inline-flex",
        alignItems: "center",
        fontSize: "11px",
        lineHeight: "16px",
        padding: "1px 7px",
        borderRadius: "999px",
        border: "0.5px solid var(--dsw-alias-border-l4)",
        color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
        background: active ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
        cursor: "pointer",
        userSelect: "none"
      };
    }
    var notesRowStyle = {
      display: "flex",
      alignItems: "flex-start",
      gap: "6px",
      padding: "8px 10px",
      border: "0.5px solid var(--dsw-alias-border-l3)",
      borderRadius: "var(--dsw-radius-lg)"
    };
    var notesMiniButtonStyle = {
      flex: "0 0 auto",
      border: "0",
      background: "transparent",
      cursor: "pointer",
      color: "var(--dsw-alias-label-tertiary)",
      font: "inherit",
      fontSize: "12px",
      lineHeight: "18px",
      padding: "2px 4px",
      borderRadius: "var(--dsw-radius-sm)"
    };
    var notesInputStyle = {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      border: "0.5px solid var(--dsw-alias-border-l4)",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      borderRadius: "var(--dsw-radius-lg)",
      padding: "8px 12px",
      font: "inherit",
      fontSize: "14px",
      lineHeight: "22px",
      resize: "vertical",
      minHeight: "160px"
    };
    var notesPageInputStyle = {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      border: "0.5px solid var(--dsw-alias-border-l4)",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      borderRadius: "var(--dsw-radius-lg)",
      padding: "10px 12px",
      font: "inherit",
      fontSize: "14px",
      lineHeight: "22px",
      resize: "vertical",
      minHeight: "180px"
    };
    var notesSearchStyle = {
      flex: "1 1 auto",
      minWidth: 0,
      boxSizing: "border-box",
      border: "0.5px solid var(--dsw-alias-border-l4)",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      borderRadius: "var(--dsw-radius-lg)",
      padding: "6px 10px",
      font: "inherit",
      fontSize: "13px",
      lineHeight: "20px"
    };
    var notesImportStyle = {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      border: "0.5px solid var(--dsw-alias-border-l4)",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      borderRadius: "var(--dsw-radius-lg)",
      padding: "8px 12px",
      font: "inherit",
      fontSize: "13px",
      lineHeight: "20px",
      resize: "vertical",
      minHeight: "96px"
    };
    var optionTitleStyle = {
      fontSize: "13px",
      lineHeight: "20px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    };
    var optionPathStyle = {
      fontSize: "11px",
      lineHeight: "16px",
      color: "var(--dsw-alias-label-tertiary)",
      direction: "rtl",
      textAlign: "left",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    };

    // Latest mounted session's composer face, for the right-click quote menu.
    var activeComposer = { sessionId: null, actions: null };
    // Branch links this plugin itself created (child -> source), persisted per
    // browser: a session-reference chip must still resolve when the durable
    // reference record is outside the loaded window or was compacted away.
    var MODE_LINKS_KEY = "dsh.deepworker.mode-links";
    function readModeLinks() {
      try {
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(MODE_LINKS_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        return {};
      }
    }
    function rememberModeLink(childSessionId, sourceSessionId) {
      try {
        if (typeof localStorage === "undefined") return;
        var links = readModeLinks();
        links[childSessionId] = sourceSessionId;
        var keys = Object.keys(links);
        for (var i = 0; i < keys.length - 200; i++) delete links[keys[i]];
        localStorage.setItem(MODE_LINKS_KEY, JSON.stringify(links));
      } catch (e) {
        /* best effort only */
      }
    }
    // Document-level menu -> mounted turn component bridge. Each turn's component
    // owns its own boundary seqs and prefill, so it handles only its own turn.
    var menuListeners = [];
    /**
     * Hand a menu pick to whichever mounted component claims it.
     *
     * A listener that throws used to be swallowed with no trace at all: the menu closed and
     * nothing happened, which is indistinguishable from a dead menu. This plugin has hit
     * exactly that shape before (a factory-scope handler calling into apply scope), so a
     * failure here must be visible — and reported once, not once per listener.
     */
    function publishMenuRequest(request, translate) {
      var listeners = menuListeners.slice();
      var say = typeof translate === "function" ? translate : function (key) { return key; };
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i](request);
        } catch (e) {
          /* a broken listener must not swallow the menu pick */
          showNotice(say("menu.listenerFailed") + " " + String((e && e.message) || e), { clientX: 24, clientY: 24 });
        }
      }
    }

    // ── 6. 轮内操作组件（factory 作用域：只能 props + testHooks）────────────────
    var HistoryTurnActions = (0, react.memo)(function HistoryTurnActions(props) {
      var turn = props.turn;
      var seq = props.seq;
      var t = props.t;
      var useProjection = props.useProjection;
      var inputActions = props.inputActions;
      var sessionId = props.sessionId;
      var forkBefore = props.forkBefore;
      var forkAt = props.forkAt;
      var resend = props.resend;
      var cancelTurn = props.cancelTurn;
      var listPresets = props.listPresets;
      var useProjection = props.useProjection;
      var listSessions = props.listSessions;
      var listWorkspaces = props.listWorkspaces;
      var pickWorkspace = props.pickWorkspace;
      var userText = props.userText;
      var userContent = props.userContent;
      var assistantText = props.assistantText;
      var archiveSession = props.archiveSession;
      var createWithMode = props.createWithMode;

      var editing = (0, react.useState)(false);
      var setEditing = editing[1];
      var draft = (0, react.useState)("");
      var setDraft = draft[1];
      var editContentRef = (0, react.useRef)(null);
      var inlineEditRef = (0, react.useRef)(null);
      // 「轮次操作」总开关（2026-10-15）。`say` 可能来自 props，也可能没有（SSR 桩）；
      // 兜底必须仍然"说话"，绝不静默 return —— 那正是本机列为缺陷的形状。
      var turnSay = typeof say === "function" ? say : function (key, params) {
        if (typeof t !== "function") return String(key);
        var out = t(key);
        if (params) for (var pk in params) if (Object.prototype.hasOwnProperty.call(params, pk)) out = String(out).split("{" + pk + "}").join(String(params[pk]));
        return out;
      };
      /**
       * Turn actions are a family (retry / branch / resend / new-mode). The name
       * comes through the SAME i18n seam as the notice itself: factory scope cannot see
       * apply's `t`, and `t(...)` there is a ReferenceError that crashes the slot entry.
       */
      function turnActionsName() { return turnSay("feature.nameTurnActions"); }
      /** false = the switch is off, and the user has just been told so. */
      function turnActionsAllowed() {
        if (featureEnabled("featureTurnActions")) return true;
        showNotice(turnSay("feature.disabled", { name: turnActionsName() }), { clientX: 24, clientY: 80 });
        return false;
      }
      var busy = (0, react.useState)(false);
      var setBusy = busy[1];
      var error = (0, react.useState)(null);
      var setError = error[1];
      var selectionRef = (0, react.useRef)("");
      var modeOpen = (0, react.useState)(false);
      var setModeOpen = modeOpen[1];
      var presets = (0, react.useState)([]);
      var setPresets = presets[1];
      var presetId = (0, react.useState)("");
      var setPresetId = presetId[1];
      var presetState = (0, react.useState)("idle");
      var setPresetState = presetState[1];
      var modeDraft = (0, react.useState)("");
      var setModeDraft = modeDraft[1];
      var workspaces = (0, react.useState)([]);
      var setWorkspaces = workspaces[1];
      var workspaceId = (0, react.useState)("");
      var setWorkspaceId = workspaceId[1];
      var workspaceBusy = (0, react.useState)(false);
      var setWorkspaceBusy = workspaceBusy[1];
      var workspaceOpen = (0, react.useState)(false);
      var setWorkspaceOpen = workspaceOpen[1];
      var outline = typeof useProjection === "function" ? useProjection("turnOutline") : undefined;
      (0, react.useEffect)(function () {
        latestOutline = { sessionId: sessionId, entries: Array.isArray(outline) ? outline : [] };
      }, [outline, sessionId]);
      var sources = (0, react.useState)([]);
      var setSources = sources[1];
      var sourceId = (0, react.useState)("");
      var setSourceId = sourceId[1];
      var sourceOpen = (0, react.useState)(false);
      var setSourceOpen = sourceOpen[1];
      var digestOpen = (0, react.useState)(false);
      var setDigestOpen = digestOpen[1];
      var digestKeyword = (0, react.useState)("");
      var setDigestKeyword = digestKeyword[1];
      var digestLength = (0, react.useState)(160);
      var setDigestLength = digestLength[1];
      var digestFormat = (0, react.useState)("outline");
      var setDigestFormat = digestFormat[1];
      var digestMode = (0, react.useState)("auto");
      var setDigestMode = digestMode[1];
      var digestRequirement = (0, react.useState)("");
      var setDigestRequirement = digestRequirement[1];
      var digestBusy = (0, react.useState)(false);
      var setDigestBusy = digestBusy[1];
      var digestProgress = (0, react.useState)("");
      var setDigestProgress = digestProgress[1];
      var digestError = (0, react.useState)("");
      var setDigestError = digestError[1];
      var digestTags = (0, react.useState)("");
      var setDigestTags = digestTags[1];
      var archiveOriginal = (0, react.useState)(function () { return readSettings().archiveOriginal; });
      var setArchiveOriginal = archiveOriginal[1];

      (0, react.useEffect)(function () {
        return function () { removeInlineEdit(); };
      }, []);
      (0, react.useEffect)(function () {
        var prev = activeComposer;
        activeComposer = { sessionId: sessionId, actions: inputActions || null };
        return function () {
          if (activeComposer.sessionId === sessionId) activeComposer = prev;
        };
      }, [sessionId, inputActions]);

      // `turn` arrives as a Turn record ({ turn, start, end, status, steps }),
      // never a number: the number is `turn.turn`, and start/end carry the raw
      // turn/start and turn/end events so no projection is needed.
      var turnNumber = turn !== null && typeof turn === "object" ? turn.turn : turn;
      var outline = [];
      if (typeof useProjection === "function") {
        outline = useProjection("turnOutline") || [];
      }
      var outlineEntry = Array.isArray(outline) ? (outline.find(function (o) {
        return o && o.turn === turnNumber;
      }) || null) : null;
      var startSeq = turn !== null && typeof turn === "object" && turn.start && typeof turn.start.seq === "number"
        ? turn.start.seq
        : (outlineEntry && typeof outlineEntry.seq === "number" ? outlineEntry.seq : undefined);
      var before = startSeq !== undefined && startSeq > 0 ? startSeq - 1 : undefined;
      var endSeq = turn !== null && typeof turn === "object" && turn.end && typeof turn.end.seq === "number" ? turn.end.seq : seq;
      // Where the PREVIOUS turn ends. The user message of THIS turn sits after it, so cutting
      // here is what actually removes the old message from the child — `start.seq - 1` did not,
      // because start.seq is the turn's own start, not the user message's position.
      var prevSeq;
      try {
        if (Array.isArray(outline)) {
          for (var oi = 0; oi < outline.length; oi++) {
            var oe = outline[oi];
            if (oe && oe.turn === turnNumber) {
              var pe = oi > 0 ? outline[oi - 1] : null;
              if (pe && typeof pe.seq === "number") prevSeq = pe.seq;
              break;
            }
          }
        }
      } catch (e) { prevSeq = undefined; }
      // Read the original prompt lazily: the Chat node store may publish the
      // turn's user node after this component first rendered.
      function currentPrompt() {
        var text = "";
        if (typeof userText === "function" && turnNumber !== undefined) {
          try {
            text = userText(turnNumber) || "";
          } catch (e) {
            text = "";
          }
        }
        if (text === "" && outlineEntry && typeof outlineEntry.prompt === "string") text = outlineEntry.prompt;
        return text;
      }
      function currentContent() {
        if (typeof userContent === "function" && turnNumber !== undefined) {
          try {
            var content = userContent(turnNumber);
            if (Array.isArray(content) && content.length > 0) return content;
          } catch (e) { /* fall through to text */ }
        }
        var text = currentPrompt();
        return text === "" ? [] : [{ type: "text", text: text }];
      }
      function textOfContent(content) {
        if (!Array.isArray(content)) return "";
        var parts = [];
        for (var ci = 0; ci < content.length; ci++) {
          var block = content[ci];
          if (block && block.type === "text" && typeof block.text === "string") parts.push(block.text);
        }
        return parts.join("\n");
      }
      function hasNonTextContent(content) {
        if (!Array.isArray(content)) return false;
        for (var ci = 0; ci < content.length; ci++) {
          var block = content[ci];
          if (block && (block.type === "image" || block.type === "file")) return true;
        }
        return false;
      }
      function contentWithText(content, text) {
        var source = Array.isArray(content) ? content : [];
        var out = [];
        var replaced = false;
        for (var ci = 0; ci < source.length; ci++) {
          var block = source[ci];
          if (block && block.type === "text") {
            if (replaced) continue;
            out.push(Object.assign({}, block, { text: text }));
            replaced = true;
          } else {
            out.push(block);
          }
        }
        if (!replaced && text !== "") out.unshift({ type: "text", text: text });
        return out;
      }
      function contentWithTextSuffix(content, suffix) {
        return contentWithText(content, textOfContent(content) + suffix);
      }
      // The Chat UI owns the user bubble and exposes no slot for it, so the
      // operations on the user's own message arrive from the right-click menu
      // (see installContextMenu) as a request addressed to this exact turn.
      var menuHandlerRef = (0, react.useRef)(null);
      menuHandlerRef.current = function (request) {
        if (!request) return;
        if (request.sessionId !== undefined && request.sessionId !== sessionId) return;
        if (request.turn !== undefined && request.turn !== turnNumber) return;
        if (request.kind === "digestOptions") {
          // Session-scoped: exactly one mounted turn component claims it.
          if (request.claimed === true) return;
          request.claimed = true;
          setDigestOpen(true);
          return;
        }
        if (request.kind === "newModeInWorkspace") {
          // Session-scoped, not turn-scoped: exactly one mounted turn component
          // claims it, so a single dialog opens.
          if (request.claimed === true) return;
          request.claimed = true;
          onModeOpen();
          if (typeof request.workspaceId === "string" && request.workspaceId !== "") setWorkspaceId(request.workspaceId);
          return;
        }
        if (request.turn === undefined) return;
        if (request.kind === "edit") {
          if (openInlineEdit()) return;
          var editContent = currentContent();
          editContentRef.current = editContent;
          setDraft(textOfContent(editContent) || currentPrompt());
          setError(null);
          setEditing(true);
          return;
        }
        if (request.kind === "retry") {
          onRetryTurn();
          return;
        }
        if (request.kind === "branch") {
          run(function () { return forkAt(endSeq); }, "error.fork");
          return;
        }
        if (request.kind === "quote") {
          var selected = typeof request.text === "string" ? request.text.trim() : "";
          if (selected !== "") applyQuote(selected);
          else showNotice(t("quote.empty"), { clientX: 24, clientY: 96 });
        }
      };
      (0, react.useEffect)(function () {
        var listener = function (request) {
          if (menuHandlerRef.current) menuHandlerRef.current(request);
        };
        menuListeners.push(listener);
        return function () {
          var index = menuListeners.indexOf(listener);
          if (index >= 0) menuListeners.splice(index, 1);
        };
      }, []);
      var selectedWorkspace = null;
      for (var wi = 0; wi < workspaces[0].length; wi++) {
        if (workspaces[0][wi].id === workspaceId[0]) { selectedWorkspace = workspaces[0][wi]; break; }
      }
      var selectedSource = null;
      for (var si = 0; si < sources[0].length; si++) {
        if (sources[0][si].id === sourceId[0]) { selectedSource = sources[0][si]; break; }
      }

      /**
       * Run one dialog operation, with a timeout.
       *
       * Without it an op that never settles left the button disabled forever with nothing
       * on screen: no error, no spinner change, no way to try again.
       */
      var RUN_TIMEOUT_MS = 120000;
      function run(op, fallbackErrorKey) {
        setBusy(true);
        setError(null);
        var settled = false;
        var finish = function (message) {
          if (settled) return;
          settled = true;
          setBusy(false);
          if (message !== null) {
            setError(message);
            // The dialog shows it, but a closed or scrolled dialog would hide it —
            // "I clicked and nothing happened" must never be the only signal.
            showNotice(message, { clientX: 24, clientY: 80 });
          }
        };
        var timer = setTimeout(function () {
          finish(t(fallbackErrorKey) + ": " + t("error.timeout"));
        }, RUN_TIMEOUT_MS);
        Promise.resolve().then(op).then(function () {
          clearTimeout(timer);
          finish(null);
        }, function (e) {
          clearTimeout(timer);
          finish(t(fallbackErrorKey) + ": " + errorMessage(e));
        });
      }
      function onBranch() {
        if (!turnActionsAllowed()) return;
        if (busy[0]) {
          showNotice(t("dialog.busy"), { clientX: 24, clientY: 80 });
          return;
        }
        run(function () {
          return forkAt(endSeq);
        }, "error.fork");
      }
      function onResendOpen() {
        if (!turnActionsAllowed()) return;
        if (openInlineEdit()) return;
        var content = currentContent();
        var text = textOfContent(content) || currentPrompt();
        editContentRef.current = content;
        setDraft(text);
        setError(null);
        setEditing(true);
        if (turn && turn.status === "running") {
          showNotice(t("resend.running"), { clientX: 24, clientY: 80 });
        }
        if (text.trim() === "" && !hasNonTextContent(content)) {
          showNotice(t("resend.empty"), { clientX: 24, clientY: 80 });
        }
      }
      function removeInlineEdit() {
        if (inlineEditRef.current && inlineEditRef.current.parentNode) inlineEditRef.current.parentNode.removeChild(inlineEditRef.current);
        inlineEditRef.current = null;
      }
      function openInlineEdit() {
        if (before === undefined || before === null) {
          showNotice(t("resend.noBoundary"), { clientX: 24, clientY: 80 });
          return true;
        }
        var host = null;
        try {
          var nodes = document.querySelectorAll('[data-chat-turn="' + turnNumber + '"]');
          for (var hi = 0; hi < nodes.length; hi++) {
            host = nodes[hi].matches('[class*="userRow"]') ? nodes[hi] : nodes[hi].querySelector('[class*="userRow"]');
            if (host) break;
          }
        } catch (e) { host = null; }
        if (!host) return false;
        removeInlineEdit();
        var source = currentContent();
        var removed = {};
        var added = [];
        var box = document.createElement("div");
        box.setAttribute("data-dw-inline-edit", "");
        box.style.cssText = "margin-top:6px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px;width:100%;box-sizing:border-box;";
        var ta = document.createElement("textarea");
        ta.value = textOfContent(source) || currentPrompt();
        ta.rows = 3;
        ta.style.cssText = "width:100%;min-height:72px;resize:vertical;box-sizing:border-box;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;";
        var rail = document.createElement("div");
        rail.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;";
        var add = document.createElement("button");
        add.type = "button";
        add.textContent = t("inline.addImage");
        add.style.cssText = "font:inherit;font-size:12px;line-height:18px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;";
        var picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.multiple = true;
        picker.style.display = "none";
        var actions = document.createElement("div");
        actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = t("term.wsCancel");
        cancel.style.cssText = "font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;";
        var submit = document.createElement("button");
        submit.type = "button";
        submit.textContent = t("modal.resend.submit");
        submit.style.cssText = "font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border:1px solid var(--dsw-alias-button-primary-fill);border-radius:6px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);cursor:pointer;";
        var rebuildRef = { fn: function () {
          rail.textContent = "";
          for (var si = 0; si < source.length; si++) {
            var block = source[si];
            if (!block || block.type !== "image" || removed[si] === true) continue;
            rail.appendChild(imageChip(block, si, null));
          }
          for (var ai = 0; ai < added.length; ai++) rail.appendChild(imageChip(added[ai], -1, ai));
          rail.appendChild(add);
        } };
        function addImageFile(file) {
          if (!file || (file.type || "").indexOf("image/") !== 0) return;
          var reader = new window.FileReader();
          reader.onload = function () {
            var result = String(reader.result || "");
            var comma = result.indexOf(",");
            if (comma > 0) {
              added.push({ type: "image", data: result.slice(comma + 1), name: file.name || "pasted-image.png", mime: file.type || "image/png" });
              rebuildRef.fn();
            }
          };
          reader.readAsDataURL(file);
        }
        function imageChip(block, sourceIndex, addedIndex) {
          var chip = document.createElement("span");
          chip.style.cssText = "position:relative;display:inline-flex;align-items:center;gap:4px;padding:2px 4px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);";
          var img = document.createElement("img");
          img.style.cssText = "width:24px;height:24px;object-fit:cover;border-radius:4px;display:block;";
          try {
            if (block && block.data) img.src = "data:" + ((block.mediaType || block.mime || "image/png")) + ";base64," + block.data;
            else if (block && block.attachment && typeof testHooks.imageUrl === "function") {
              var direct = typeof testHooks.peekImageUrl === "function" ? testHooks.peekImageUrl(sessionId, block.attachment) : "";
              if (direct) img.src = direct;
              else {
                var resolved = testHooks.imageUrl(sessionId, block.attachment);
                if (resolved && typeof resolved.then === "function") {
                  resolved.then(function (url) { if (url) img.src = url; }, function () { img.style.display = "none"; });
                } else if (resolved) img.src = resolved;
              }
            }
          } catch (e) { /* no preview */ }
          var name = block && block.name ? block.name : (block && block.attachment && block.attachment.name ? block.attachment.name : t("inline.addImage"));
          var label = document.createElement("span");
          label.textContent = name.length > 18 ? name.slice(0, 16) + "…" : name;
          var kill = document.createElement("button");
          kill.type = "button";
          kill.textContent = "×";
          kill.title = t("inline.removeImage");
          kill.style.cssText = "border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:14px;cursor:pointer;padding:0 2px;";
          kill.addEventListener("click", function () {
            if (sourceIndex >= 0) removed[sourceIndex] = true;
            else added.splice(addedIndex, 1);
            rebuildRef.fn();
          });
          chip.appendChild(img); chip.appendChild(label); chip.appendChild(kill);
          return chip;
        }
        add.addEventListener("click", function () { picker.click(); });
        picker.addEventListener("change", function () {
          var files = picker.files ? Array.prototype.slice.call(picker.files) : [];
          files.forEach(addImageFile);
          picker.value = "";
        });
        ta.addEventListener("paste", function (ev) {
          var dt = ev.clipboardData;
          if (!dt) return;
          var files = [];
          if (dt.files && dt.files.length > 0) files = Array.prototype.slice.call(dt.files);
          else if (dt.items) {
            for (var pi = 0; pi < dt.items.length; pi++) {
              if (dt.items[pi].kind === "file") {
                var f = dt.items[pi].getAsFile();
                if (f) files.push(f);
              }
            }
          }
          if (files.length === 0) return;
          ev.preventDefault();
          files.forEach(addImageFile);
        });
        box.addEventListener("dragover", function (ev) { ev.preventDefault(); });
        box.addEventListener("drop", function (ev) {
          var dt = ev.dataTransfer;
          if (!dt || !dt.files || dt.files.length === 0) return;
          ev.preventDefault();
          Array.prototype.slice.call(dt.files).forEach(addImageFile);
        });
        cancel.addEventListener("click", removeInlineEdit);
        submit.addEventListener("click", function () {
          var text = ta.value;
          var out = [];
          for (var si = 0; si < source.length; si++) {
            var block = source[si];
            if (!block) continue;
            if (block.type === "text") continue;
            if (block.type === "image" && removed[si] === true) continue;
            out.push(block);
          }
          for (var ai = 0; ai < added.length; ai++) out.push(added[ai]);
          if (text.trim() === "" && !hasNonTextContent(out)) { showNotice(t("inline.noContent"), { clientX: 24, clientY: 80 }); return; }
          var payload = contentWithText(out, text);
          removeInlineEdit();
          run(function () { return sendEdited(before, payload, archiveOriginal[0]); }, "error.prompt");
        });
        box.appendChild(ta); box.appendChild(rail); box.appendChild(picker); box.appendChild(actions);
        actions.appendChild(cancel); actions.appendChild(submit);
        host.insertBefore(box, host.lastElementChild);
        inlineEditRef.current = box;
        rebuildRef.fn();
        return true;
      }
      // Resending/retrying always forks BEFORE the turn, so the failed or
      // interrupted attempt never enters the new history — the clean way to
      // retry a task without polluting the model's context.
      function sendEdited(boundary, payload, shouldArchive) {
        // Stop the running turn FIRST. Forking and sending while it works would leave it
        // running and merely queue the new prompt — the original would keep going.
        return stopRunningTurn().then(function () {
          // The seqs live in THIS component scope; the apply-scope seam cannot see them, so they
          // must be handed over explicitly (the trace used to print "?" for exactly this reason).
          return resend(boundary, payload, { start: startSeq, end: endSeq, prev: prevSeq });
        }).then(function (childId) {
          if (!shouldArchive || typeof archiveSession !== "function") return childId;
          return Promise.resolve()
            .then(function () { return archiveSession(sessionId); })
            .then(function () { return childId; }, function (e) {
              // The new branch is running, but the ORIGINAL is still in the list — and the
              // user asked for it to be archived.
              showNotice(t("resend.archiveFailed") + " " + errorMessage(e), { clientX: 24, clientY: 80 });
              return childId;
            });
        });
      }
      /**
       * Stop this turn if it is running, and say so if that fails.
       *
       * A failed cancel must be visible: the user would otherwise get a queued message and
       * a running original with no explanation — the exact confusion this fixes.
       * @returns {Promise<void>} resolves either way; failure is surfaced, not thrown.
       */
      function stopRunningTurn() {
        // Do NOT gate on THIS turn's status. The reported bug ("the original is sent again and
        // my edit just queues") came from exactly that gate: the turn being edited had FAILED
        // while the session was busy elsewhere, so no cancel happened, the fork carried the
        // original text, and the edited message queued behind it. `session.cancel` is the
        // Host's own stop; harmless when nothing runs, and a failure is surfaced below.
        if (typeof cancelTurn !== "function") {
          // Saying nothing keeps the running turn alive while the new message queues —
          // exactly the confusion this function exists to remove.
          showNotice(t("resend.cancelUnavailable"), { clientX: 24, clientY: 80 });
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(function () { return cancelTurn(); })
          .then(function (result) {
            if (result && result.ok === false) {
              showNotice(t("resend.cancelFailed") + " " + (result.error || ""), { clientX: 24, clientY: 80 });
            }
          }, function (e) {
            showNotice(t("resend.cancelFailed") + " " + errorMessage(e), { clientX: 24, clientY: 80 });
          });
      }
      // Retry forks AT THE END of the turn, not before it. The prefix then carries
      // the turn's durable events (tool calls and their results), so:
      //   * the model can see what that attempt already did, and
      //   * DSH's fork-seed closes any unanswered call with TOOL_OUTCOME_UNKNOWN
      //     ("outcome is unknown ... verify external state ... do not retry blindly").
      // Forking before the turn (what this used to do) threw both away.
      function onRetryTurn() {
        if (!turnActionsAllowed()) return;
        if (busy[0]) {
          showNotice(t("dialog.busy"), { clientX: 24, clientY: 80 });
          return;
        } // re-entrancy only: the same click is already running
        var content = currentContent();
        var text = textOfContent(content) || currentPrompt();
        if (text.trim() === "" && !hasNonTextContent(content)) {
          showNotice(t("retry.noText"), { clientX: 24, clientY: 80 });
          return;
        }
        var boundary = retryForkSeq(turn);
        if (boundary === undefined) {
          showNotice(t("retry.noBoundary"), { clientX: 24, clientY: 80 });
          return;
        }
        // The child cannot inherit the attempt's records (see retryForkSeq), so hand
        // over what it changed in words — otherwise it redoes completed work.
        var touched = [];
        // `mutatedPathsOf` lives inside apply(); a factory-scope component reaches
        // apply-scope readers through this seam (the same one the test harness uses).
        if (readSettings().retryNote && typeof testHooks.mutatedPathsOf === "function") {
          try {
            touched = testHooks.mutatedPathsOf(sessionId, turnNumber) || [];
          } catch (e) {
            touched = [];
            // Silently dropping the hand-over note makes the child redo finished work.
            showNotice(t("retry.noteFailed") + " " + errorMessage(e), { clientX: 24, clientY: 80 });
          }
        }
        var body = touched.length === 0
          ? content
          : contentWithTextSuffix(content, "\n\n" + t("retry.note", { paths: touched.join("、") }));
        if (!Array.isArray(body) || body.length === 0) body = [{ type: "text", text: text }];
        run(function () {
          return sendEdited(boundary, body, archiveOriginal[0]);
        }, "error.prompt");
      }
      function onResendSubmit() {
        if (busy[0]) {
          showNotice(t("dialog.busy"), { clientX: 24, clientY: 80 });
          return;
        }
        var editContent = editContentRef.current;
        if (draft[0].trim() === "" && !hasNonTextContent(editContent)) {
          showNotice(t("resend.empty"), { clientX: 24, clientY: 80 });
          return;
        }
        // No endSeq fallback: forking AFTER the turn carries the original turn into the child,
        // which reads as "the original got sent again". If the turn's start is unknown, say so.
        if (before === undefined || before === null) {
          showNotice(t("resend.noBoundary"), { clientX: 24, clientY: 80 });
          return;
        }
        // Cut exactly at `turn/start` minus one — and NOT anywhere earlier.
        //
        // Read from the host source (@deepseek-ai/dsh-session-turn-outline): "the loop logs
        // `turn/start` BEFORE the turn's prompt and steps". So the event order is
        //   seq N   turn/start
        //   seq N+1 user/message      <- the message being re-edited
        // Cutting at N-1 therefore excludes BOTH the user message and the reply, while keeping
        // every earlier turn intact. Cutting at the previous turn's seq (tried earlier) goes one
        // turn too far and silently drops that turn's content.
        var boundary = before;
        var shouldArchive = archiveOriginal[0];
        var payload = contentWithText(editContent, draft[0]);
        if (!Array.isArray(payload) || payload.length === 0) payload = [{ type: "text", text: draft[0] }];
        editContentRef.current = null;
        setEditing(false);
        run(function () {
          return sendEdited(boundary, payload, shouldArchive);
        }, "error.prompt");
      }
      // Quote + provenance. The marker goes into the message text so the model
      // knows which turn was quoted; the exact marker is also recorded so the UI
      // can resolve the source without parsing localized copy.
      function applyQuote(text, options) {
        if (!inputActions) return;
        // Quote first: the record needs the quoted BODY, which is what lets a later
        // click pick this quote out of a message that holds several.
        var quoted = blockquote(text);
        if (quoted.text === "") {
          showNotice(t("quote.empty"), { clientX: 24, clientY: 96 });
          return;
        }
        var marker = "";
        if (turnNumber !== undefined && readSettings().quoteProvenance) {
          // The anchor goes into the MESSAGE TEXT on purpose: the session log is
          // append-only and durable, so the provenance stays readable by any later
          // reader (agent, export, another device) without a client->host remote —
          // which a hand-written plugin cannot add. The seq makes it exact; the turn
          // alone stays ambiguous once a conversation is compacted or forked.
          // Built by concatenation: placeholders in `t()` proved unreliable for some
          // keys, so only the turn (which is known to interpolate) goes through it.
          // Chip for prominence, plain text for precision: the chip cannot hold the seq,
          // and a turn number alone goes stale once a conversation is compacted or forked.
          marker = t("quote.provenance", { turn: turnNumber }) + (typeof endSeq === "number" ? " · seq " + endSeq : "");
          if (quoted.clipped) marker += t("quote.clipped");
          rememberQuote({
            sessionId: sessionId,
            turn: turnNumber,
            seq: endSeq,
            marker: marker,
            quote: quoted.body,
            anchor: outlineAnchorFor(turnNumber),
            at: Date.now()
          });
        }
        // The provenance sits INSIDE the bar: the whole thing reads as one quoted block.
        // For a whole-reply excerpt the display ends with an ellipsis, while the
        // stored body stays verbatim so the jump-back search still finds it.
        var rendered = quoted.text;
        if (options && options.ellipsis === true && rendered !== "") {
          rendered = rendered.charAt(rendered.length - 1) === "\n"
            ? rendered.slice(0, -1) + "…\n"
            : rendered + "…";
        }
        var quote = rendered + (marker === "" ? "" : quoteBarLine(marker)) + "\n";
        if (insertQuoteIntoDraft(inputActions, quote) === "failed") {
          showNotice(t("quote.insertFailed"), {
            clientX: Math.max(0, (typeof window === "undefined" ? 0 : window.innerWidth) / 2 - 140),
            clientY: 96
          });
        }
      }
      function onQuote() {
        // The button lives under the assistant reply, so the reply is the target.
        // A selection is accepted only when it is actually part of that reply;
        // selecting text in the user bubble must not turn this into a user quote.
        var fallback = "";
        if (typeof assistantText === "function" && turnNumber !== undefined) {
          try { fallback = assistantText(turnNumber) || ""; } catch (e) { fallback = ""; }
        }
        var sel = selectionRef.current.trim();
        if (sel !== "" && fallback.indexOf(sel) >= 0) { applyQuote(sel); return; }
        var line = quoteFirstLine(fallback);
        if (line !== "") { applyQuote(line, { ellipsis: true }); return; }
        showNotice(t("quote.noAssistant"), { clientX: 24, clientY: 96 });
      }
      function captureSelection() {
        selectionRef.current = selectionText();
      }
      // The user bubble has no action slot in DSH 0.2.1-rc.2. Keep the button
      // visually under that bubble with a body-level fixed element, positioned
      // from [data-chat-turn] + the userRow class. It is intentionally a fallback
      // to the platform slot, not a replacement for core UI.
      var resendRef = (0, react.useRef)(onResendOpen);
      resendRef.current = onResendOpen;
      (0, react.useEffect)(function () {
        if (turnNumber === undefined || typeof document === "undefined") return undefined;
        var host = null;
        var button = null;
        var timer = 0;
        var observer = null;
        function findHost() {
          var nodes = document.querySelectorAll('[data-chat-turn="' + turnNumber + '"]');
          for (var i = 0; i < nodes.length; i++) {
            var row = nodes[i].matches('[class*="userRow"]') ? nodes[i] : nodes[i].querySelector('[class*="userRow"]');
            if (row) return row;
          }
          return null;
        }
        function placeBeforeActions() {
          if (!host) return;
          var actions = host.lastElementChild;
          if (!actions || actions === button) host.appendChild(button);
          else host.insertBefore(button, actions);
        }
        function mount() {
          timer = 0;
          host = findHost();
          if (!host) { timer = setTimeout(mount, 100); return; }
          if (button) { placeBeforeActions(); return; }
          button = document.createElement("button");
          button.type = "button";
          button.setAttribute("data-dw-user-edit", "");
          button.textContent = t("action.resend");
          button.style.cssText = "display:inline-flex;align-self:flex-end;align-items:center;justify-content:center;margin:0 0 4px 0;padding:1px 6px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;";
          button.addEventListener("click", function () { resendRef.current(); });
          placeBeforeActions();
          var MO = typeof window !== "undefined" ? window.MutationObserver : undefined;
          if (typeof MO === "function") {
            observer = new MO(function () {
              if (!host) return;
              if (!button || button.parentNode !== host) { placeBeforeActions(); return; }
              var actions = host.lastElementChild;
              if (actions && actions !== button && button.nextElementSibling !== actions) placeBeforeActions();
            });
            observer.observe(host, { childList: true });
          }
        }
        mount();
        return function () {
          if (timer !== 0) clearTimeout(timer);
          if (observer) observer.disconnect();
          if (button && button.parentNode) button.parentNode.removeChild(button);
          button = null;
          host = null;
        };
      }, [turnNumber]);
      function onModeOpen() {
        if (!turnActionsAllowed()) return;
        if (busy[0]) return;
        setError(null);
        setModeDraft("");
        setWorkspaceOpen(false);
        setSourceOpen(false);
        setModeOpen(true);
        // The referenced conversation defaults to the one on screen and is shown,
        // so the choice is explicit rather than implied.
        var options = [];
        try {
          options = typeof listSessions === "function" ? (listSessions() || []) : [];
        } catch (e) {
          options = [];
        }
        // The conversation on screen is a valid source by definition, so the picker
        // can never render as "(nothing to reference)".
        var listed = false;
        for (var oi = 0; oi < options.length; oi++) {
          if (options[oi] && options[oi].id === sessionId) { listed = true; break; }
        }
        if (!listed) {
          var title = "";
          if (typeof testHooks.sessionTitleOf === "function") {
            try { title = testHooks.sessionTitleOf(sessionId) || ""; } catch (e) { title = ""; }
          }
          options = [{ id: sessionId, title: title || sessionId.slice(0, 18), path: "", at: 0 }].concat(options);
        }
        setSources(options);
        setSourceId(sessionId);
        // Workspaces re-read on every open so a just-created one is present;
        // default to the workspace this Session already belongs to.
        var rows = listWorkspaces();
        setWorkspaces(rows);
        var owned = "";
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].sessionIds.indexOf(sessionId) !== -1) { owned = rows[i].id; break; }
        }
        setWorkspaceId(owned);
        if (presetState[0] === "ready") return;
        setPresetState("loading");
        Promise.resolve()
          .then(function () { return listPresets(); })
          .then(function (rows2) {
            setPresets(rows2);
            var fallback = "";
            for (var i = 0; i < rows2.length; i++) {
              if (rows2[i].isDefault) { fallback = rows2[i].id; break; }
            }
            setPresetId(rows2.length > 0 ? (fallback || rows2[0].id) : "");
            setPresetState("ready");
          }, function (e) {
            setPresetState("error");
            setError(t("error.presets") + ": " + errorMessage(e));
          });
      }
      function onPickWorkspace() {
        if (workspaceBusy[0]) return;
        setWorkspaceBusy(true);
        setError(null);
        Promise.resolve()
          .then(function () { return pickWorkspace(); })
          .then(function (row) {
            setWorkspaceBusy(false);
            if (!row) return;
            setWorkspaces(function (current) {
              if (current.some(function (w) { return w.id === row.id; })) return current;
              return current.concat([row]);
            });
            setWorkspaceId(row.id);
          }, function (e) {
            setWorkspaceBusy(false);
            setError(t("error.workspace") + ": " + errorMessage(e));
          });
      }
      function onModeSubmit() {
        if (busy[0] || presetId[0] === "") return;
        setBusy(true);
        setError(null);
        Promise.resolve()
          .then(function () { return createWithMode(sourceId[0] || sessionId, presetId[0], workspaceId[0], modeDraft[0]); })
          .then(function () {
            setBusy(false);
            setModeOpen(false);
          }, function (e) {
            setBusy(false);
            setError(t("error.presetSelect") + ": " + errorMessage(e));
          });
      }

      function digestChip(label, active, onClick) {
        return (0, react_jsx_runtime.jsx)("button", {
          type: "button",
          onClick: onClick,
          style: active
            ? Object.assign({}, notesMiniButtonStyle, { color: "var(--dsw-alias-label-primary)", border: "0.5px solid var(--dsw-alias-border-l4)" })
            : notesMiniButtonStyle,
          children: label
        }, label);
      }
      function onDigestSave() {
        if (digestBusy[0]) return;
        if (digestMode[0] === "model") {
          // Model-backed: a throwaway session carries the conversation to the model.
          setDigestBusy(true);
          setDigestProgress("");
          setDigestError("");
          var source = sessionId;
          Promise.resolve()
            .then(function () {
              if (typeof testHooks.summarizeWithModel !== "function") throw new Error(t("digest.modelUnavailable"));
              return testHooks.summarizeWithModel(t, source, digestRequirement[0], 0, setDigestProgress);
            })
            .then(function (text) {
              var added = appendNote(readNotes(), text, digestTags[0]);
              var storedDigest = writeNotes(added.list);
              setDigestBusy(false);
              setDigestProgress("");
              setDigestOpen(false);
              if (!storedDigest.ok) {
                showNotice(t("notes.writeFailed") + " " + (storedDigest.error || ""), { clientX: 24, clientY: 24 }, { always: true });
              } else {
                showNotice(t("digest.saved") + " · " + t("digest.savedTotal") + " " + storedDigest.list.length + " " + t("notes.unit"), { clientX: 24, clientY: 24 });
              }
            }, function (error) {
              // The toast disappears; the dialog keeps the reason readable and selectable
              // so it can be copied out verbatim.
              var reason = errorMessage(error);
              setDigestBusy(false);
              setDigestProgress("");
              setDigestError(reason);
              showNotice(t("digest.modelFailed") + ": " + reason, { clientX: 24, clientY: 80 });
            });
          return;
        }
        var result = { ok: false, total: 0 };
        try {
          if (typeof testHooks.saveDigestNote === "function") {
            result = testHooks.saveDigestNote(t, { keyword: digestKeyword[0], responseLimit: digestLength[0], format: digestFormat[0], tags: normalizeTags(digestTags[0]) });
          }
        } catch (e) {
          result = { ok: false, total: 0 };
        }
        if (!result.ok) {
          setDigestError(t("digest.nothing"));
          showNotice(t("digest.nothing"), { clientX: 24, clientY: 24 });
          return;
        }
        setDigestOpen(false);
        showNotice(t("digest.saved") + " · " + t("digest.savedTotal") + " " + result.total + " " + t("notes.unit"), { clientX: 24, clientY: 24 });
      }

      return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
        children: [
          (0, react_jsx_runtime.jsxs)("div", {
            style: rowStyle,
            children: [
              (0, react_jsx_runtime.jsx)("button", {
                type: "button",
                style: buttonStyle,
                onPointerDown: captureSelection,
                onClick: onQuote,
                children: t("action.quote")
              }),
              (0, react_jsx_runtime.jsx)("button", {
                type: "button",
                disabled: busy[0],
                style: busy[0] ? Object.assign({}, buttonStyle, { opacity: 0.4, cursor: "default" }) : buttonStyle,
                onClick: onRetryTurn,
                children: t("action.retry")
              }),
              (0, react_jsx_runtime.jsx)("button", {
                type: "button",
                disabled: busy[0],
                style: busy[0] ? Object.assign({}, buttonStyle, { opacity: 0.4, cursor: "default" }) : buttonStyle,
                onClick: onBranch,
                children: t("action.branch")
              }),
              (0, react_jsx_runtime.jsx)("button", {
                type: "button",
                disabled: busy[0],
                style: busy[0] ? Object.assign({}, buttonStyle, { opacity: 0.4, cursor: "default" }) : buttonStyle,
                onClick: onModeOpen,
                children: t("action.newMode")
              }),
              // The error rides inside the fixed-height row so showing it can
              // never change the turn's height.
              error[0] !== null ? (0, react_jsx_runtime.jsx)("span", {
                style: {
                  color: "var(--dsw-alias-state-error-primary)",
                  fontSize: "11px",
                  lineHeight: "18px",
                  marginLeft: "6px",
                  minWidth: 0,
                  flex: "1 1 auto",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis"
                },
                title: error[0],
                children: error[0]
              }) : null
            ]
          }),
          (0, react_jsx_runtime.jsx)(primitives.Modal, {
            open: editing[0],
            title: t("modal.resend.title"),
            closeLabel: t("action.branch"),
            onClose: function () { setEditing(false); },
            footer: (0, react_jsx_runtime.jsx)(primitives.Button, {
              variant: "primary",
              disabled: draft[0].trim() === "" || busy[0],
              onClick: onResendSubmit,
              children: t("modal.resend.submit")
            }),
            children: (0, react_jsx_runtime.jsxs)("div", {
              children: [
                (0, react_jsx_runtime.jsx)("div", {
                  style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", marginBottom: "10px" },
                  children: t("modal.resend.hint")
                }),
                (0, react_jsx_runtime.jsx)("textarea", {
                  value: draft[0],
                  autoFocus: true,
                  rows: 6,
                  style: {
                    width: "100%",
                    boxSizing: "border-box",
                    background: "var(--dsw-alias-bg-layer-1)",
                    color: "var(--dsw-alias-label-primary)",
                    border: "0.5px solid var(--dsw-alias-border-l4)",
                    borderRadius: "var(--dsw-radius-lg)",
                    padding: "12px 14px",
                    font: "inherit",
                    fontSize: "14px",
                    lineHeight: "22px",
                    resize: "vertical",
                    minHeight: "96px"
                  },
                  onChange: function (e) { setDraft(e.target.value); }
                }),
                (0, react_jsx_runtime.jsxs)("label", {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "12px",
                    fontSize: "12px",
                    lineHeight: "18px",
                    color: "var(--dsw-alias-label-secondary)",
                    cursor: "pointer"
                  },
                  children: [
                    (0, react_jsx_runtime.jsx)("input", {
                      type: "checkbox",
                      checked: archiveOriginal[0],
                      onChange: function (e) { setArchiveOriginal(e.target.checked); }
                    }),
                    (0, react_jsx_runtime.jsx)("span", { children: t("modal.resend.archive") })
                  ]
                })
              ]
            })
          }),
          (0, react_jsx_runtime.jsx)(primitives.Modal, {
            className: "dsh-ha-form-dialog",
            open: modeOpen[0],
            title: t("modal.newMode.title"),
            closeLabel: t("action.newMode"),
            onClose: function () { setModeOpen(false); },
            footer: (0, react_jsx_runtime.jsx)(primitives.Button, {
              variant: "primary",
              disabled: busy[0] || presetId[0] === "" || presetState[0] !== "ready",
              onClick: onModeSubmit,
              children: t("modal.newMode.submit")
            }),
            children: (0, react_jsx_runtime.jsxs)("div", {
              style: { maxHeight: "58vh", overflowY: "auto" },
              children: [
                (0, react_jsx_runtime.jsx)("div", {
                  style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: "18px", marginBottom: "12px" },
                  children: t("modal.newMode.hint")
                }),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", margin: "0 0 6px" },
                  children: t("modal.newMode.sourceLabel")
                }),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { position: "relative", marginBottom: "12px" },
                  children: [
                    sourceOpen[0] ? (0, react_jsx_runtime.jsx)("div", {
                      style: dropdownBackdropStyle,
                      onClick: function () { setSourceOpen(false); }
                    }) : null,
                    (0, react_jsx_runtime.jsx)("button", {
                      type: "button",
                      disabled: busy[0],
                      "aria-expanded": sourceOpen[0],
                      onClick: function () { setSourceOpen(!sourceOpen[0]); },
                      style: busy[0] ? Object.assign({}, selectTriggerStyle, { cursor: "default" }) : selectTriggerStyle,
                      children: [
                        (0, react_jsx_runtime.jsxs)("span", {
                          style: { display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 auto" },
                          children: [
                            (0, react_jsx_runtime.jsx)("span", {
                              style: optionTitleStyle,
                              children: selectedSource === null
                                ? t("modal.newMode.sourceEmpty")
                                : selectedSource.title + (selectedSource.id === sessionId ? t("modal.newMode.sourceCurrent") : "")
                            }),
                            selectedSource !== null && (selectedSource.path !== "" || formatStamp(selectedSource.at) !== "") ? (0, react_jsx_runtime.jsx)("span", {
                              style: optionPathStyle,
                              children: [selectedSource.path, formatStamp(selectedSource.at)].filter(function (part) { return part !== ""; }).join(" · ")
                            }) : null
                          ]
                        }),
                        (0, react_jsx_runtime.jsx)("span", {
                          style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" },
                          children: "▾"
                        })
                      ]
                    }),
                    sourceOpen[0] ? (0, react_jsx_runtime.jsx)("div", {
                      style: dropdownStyle,
                      children: sources[0].length === 0 ? (0, react_jsx_runtime.jsx)("div", {
                        style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", padding: "6px 10px" },
                        children: t("modal.newMode.sourceEmpty")
                      }) : sources[0].map(function (row) {
                        var active = sourceId[0] === row.id;
                        return (0, react_jsx_runtime.jsxs)("button", {
                          type: "button",
                          onClick: function () { setSourceId(row.id); setSourceOpen(false); },
                          style: active ? Object.assign({}, optionStyle, { background: "var(--dsw-alias-interactive-bg-hover)" }) : optionStyle,
                          children: [
                            (0, react_jsx_runtime.jsx)("div", {
                              style: optionTitleStyle,
                              children: row.title + (row.id === sessionId ? t("modal.newMode.sourceCurrent") : "")
                            }),
                            (row.path !== "" || formatStamp(row.at) !== "") ? (0, react_jsx_runtime.jsx)("div", {
                              style: optionPathStyle,
                              children: [row.path, formatStamp(row.at)].filter(function (part) { return part !== ""; }).join(" · ")
                            }) : null
                          ]
                        }, row.id);
                      })
                    }) : null
                  ]
                }),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", margin: "0 0 6px" },
                  children: t("modal.newMode.modeLabel")
                }),
                presetState[0] === "loading" ? (0, react_jsx_runtime.jsx)("div", {
                  style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginBottom: "12px" },
                  children: t("modal.newMode.loading")
                }) : (0, react_jsx_runtime.jsx)("div", {
                  style: { display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px", maxHeight: "180px", overflowY: "auto" },
                  children: presets[0].map(function (p) {
                    var active = presetId[0] === p.id;
                    return (0, react_jsx_runtime.jsxs)("button", {
                      type: "button",
                      disabled: busy[0],
                      onClick: function () { setPresetId(p.id); },
                      style: {
                        textAlign: "left",
                        border: active ? "1px solid var(--dsw-alias-button-primary-fill)" : "0.5px solid var(--dsw-alias-border-l4)",
                        background: active ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
                        color: "var(--dsw-alias-label-primary)",
                        borderRadius: "var(--dsw-radius-lg)",
                        padding: "8px 12px",
                        cursor: busy[0] ? "default" : "pointer",
                        font: "inherit"
                      },
                      children: [
                        (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "13px", lineHeight: "20px" }, children: p.name }),
                        p.description !== "" ? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" }, children: p.description }) : null
                      ]
                    }, p.id);
                  })
                }),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", margin: "0 0 6px" },
                  children: t("modal.newMode.workspaceLabel")
                }),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { position: "relative", marginBottom: "8px" },
                  children: [
                    workspaceOpen[0] ? (0, react_jsx_runtime.jsx)("div", {
                      style: dropdownBackdropStyle,
                      onClick: function () { setWorkspaceOpen(false); }
                    }) : null,
                    (0, react_jsx_runtime.jsxs)("button", {
                      type: "button",
                      disabled: busy[0] || workspaceBusy[0],
                      "aria-expanded": workspaceOpen[0],
                      onClick: function () { setWorkspaceOpen(!workspaceOpen[0]); },
                      style: busy[0] || workspaceBusy[0] ? Object.assign({}, selectTriggerStyle, { cursor: "default" }) : selectTriggerStyle,
                      children: [
                        (0, react_jsx_runtime.jsxs)("span", {
                          style: { display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 auto" },
                          children: [
                            (0, react_jsx_runtime.jsx)("span", {
                              style: optionTitleStyle,
                              children: selectedWorkspace !== null ? selectedWorkspace.title : t("modal.newMode.workspaceEmpty")
                            }),
                            selectedWorkspace !== null && selectedWorkspace.path !== "" ? (0, react_jsx_runtime.jsx)("span", {
                              style: optionPathStyle,
                              children: selectedWorkspace.path
                            }) : null
                          ]
                        }),
                        (0, react_jsx_runtime.jsx)("span", {
                          style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" },
                          children: "▾"
                        })
                      ]
                    }),
                    workspaceOpen[0] ? (0, react_jsx_runtime.jsx)("div", {
                      style: dropdownStyle,
                      children: workspaces[0].length === 0 ? (0, react_jsx_runtime.jsx)("div", {
                        style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", padding: "6px 10px" },
                        children: t("modal.newMode.workspaceEmpty")
                      }) : workspaces[0].map(function (w) {
                        var active = workspaceId[0] === w.id;
                        return (0, react_jsx_runtime.jsxs)("button", {
                          type: "button",
                          onClick: function () { setWorkspaceId(w.id); setWorkspaceOpen(false); },
                          style: active ? Object.assign({}, optionStyle, { background: "var(--dsw-alias-interactive-bg-hover)" }) : optionStyle,
                          children: [
                            (0, react_jsx_runtime.jsx)("div", { style: optionTitleStyle, children: w.title }),
                            w.path !== "" ? (0, react_jsx_runtime.jsx)("div", { style: optionPathStyle, children: w.path }) : null
                          ]
                        }, w.id);
                      })
                    }) : null
                  ]
                }),
                (0, react_jsx_runtime.jsx)("button", {
                  type: "button",
                  disabled: busy[0] || workspaceBusy[0],
                  onClick: onPickWorkspace,
                  style: {
                    border: "0.5px solid var(--dsw-alias-border-l3)",
                    background: "transparent",
                    color: "var(--dsw-alias-label-secondary)",
                    borderRadius: "var(--dsw-radius-lg)",
                    padding: "6px 12px",
                    cursor: busy[0] || workspaceBusy[0] ? "default" : "pointer",
                    font: "inherit",
                    fontSize: "13px",
                    lineHeight: "20px",
                    marginBottom: "12px"
                  },
                  children: workspaceBusy[0] ? t("modal.newMode.workspacePicking") : t("modal.newMode.workspaceNew")
                }),
                (0, react_jsx_runtime.jsx)("textarea", {
                  value: modeDraft[0],
                  rows: 3,
                  placeholder: t("modal.newMode.placeholder"),
                  style: {
                    width: "100%",
                    boxSizing: "border-box",
                    background: "var(--dsw-alias-bg-layer-1)",
                    color: "var(--dsw-alias-label-primary)",
                    border: "0.5px solid var(--dsw-alias-border-l4)",
                    borderRadius: "var(--dsw-radius-lg)",
                    padding: "10px 12px",
                    font: "inherit",
                    fontSize: "13px",
                    lineHeight: "20px",
                    resize: "vertical",
                    minHeight: "64px"
                  },
                  onChange: function (e) { setModeDraft(e.target.value); }
                }),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { marginTop: "10px", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)" },
                  children: "DeepWorker · " + BUILD
                })
              ]
            })
          }),
          (0, react_jsx_runtime.jsx)(primitives.Modal, {
            className: "dsh-ha-form-dialog",
            open: digestOpen[0],
            title: t("digest.optTitle"),
            closeLabel: t("digest.optCancel"),
            onClose: function () { setDigestOpen(false); },
            footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
              children: [
                (0, react_jsx_runtime.jsx)(primitives.Button, {
                  variant: "outline",
                  onClick: function () { setDigestOpen(false); },
                  children: t("digest.optCancel")
                }, "cancel"),
                (0, react_jsx_runtime.jsx)(primitives.Button, {
                  variant: "primary",
                  disabled: digestBusy[0],
                  onClick: onDigestSave,
                  children: digestBusy[0] ? t("digest.modelBusy") : t("digest.optSave")
                }, "save")
              ]
            }),
            children: (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", flexDirection: "column", gap: "12px", maxHeight: "58vh", overflowY: "auto" },
              children: [
                (0, react_jsx_runtime.jsx)("div", {
                  style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
                  children: t("digest.optHint")
                }),
                (0, react_jsx_runtime.jsxs)("div", {
                  children: [
                    (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", marginBottom: "4px", color: "var(--dsw-alias-label-tertiary)" }, children: t("digest.modeLabel") }),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", gap: "6px" },
                      children: [
                        digestChip(t("digest.modeAuto"), digestMode[0] === "auto", function () { setDigestMode("auto"); }),
                        digestChip(t("digest.modeModel"), digestMode[0] === "model", function () { setDigestMode("model"); })
                      ]
                    })
                  ]
                }),
                digestMode[0] === "model" ? (0, react_jsx_runtime.jsxs)("div", {
                  children: [
                    (0, react_jsx_runtime.jsx)("div", {
                      style: { fontSize: "12px", lineHeight: "18px", marginBottom: "6px", color: "var(--dsw-alias-state-warn-primary)" },
                      children: t("digest.modelHint")
                    }),
                    (0, react_jsx_runtime.jsx)("textarea", {
                      value: digestRequirement[0],
                      rows: 3,
                      placeholder: t("digest.modelRequirement"),
                      onChange: function (e) { setDigestRequirement(e.target.value); },
                      style: {
                        width: "100%",
                        boxSizing: "border-box",
                        background: "var(--dsw-alias-bg-layer-1)",
                        color: "var(--dsw-alias-label-primary)",
                        border: "0.5px solid var(--dsw-alias-border-l4)",
                        borderRadius: "var(--dsw-radius-lg)",
                        padding: "10px 12px",
                        font: "inherit",
                        fontSize: "13px",
                        lineHeight: "20px",
                        resize: "vertical",
                        minHeight: "64px"
                      }
                    }, "requirement")
                  ]
                }) : null,
                digestBusy[0] ? (0, react_jsx_runtime.jsx)("div", {
                  style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", wordBreak: "break-word" },
                  children: t("digest.modelProgress") + " " + (digestProgress[0] || t("digest.modelStarting"))
                }) : null,
                digestBusy[0] ? (0, react_jsx_runtime.jsx)("div", {
                  style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
                  children: t("digest.modelCanLeave")
                }) : null,
                digestBusy[0] ? null : (0, react_jsx_runtime.jsx)("input", {
                  value: digestTags[0],
                  placeholder: t("digest.optTags"),
                  onChange: function (e) { setDigestTags(e.target.value); },
                  style: notesSearchStyle
                }, "tags"),
                digestMode[0] === "model" ? null : (0, react_jsx_runtime.jsx)("input", {
                  value: digestKeyword[0],
                  placeholder: t("digest.optKeyword"),
                  onChange: function (e) { setDigestKeyword(e.target.value); },
                  style: notesSearchStyle
                }, "keyword"),
                digestMode[0] === "model" ? null : (0, react_jsx_runtime.jsxs)("div", {
                  children: [
                    (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", marginBottom: "4px", color: "var(--dsw-alias-label-tertiary)" }, children: t("digest.optLength") }),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", gap: "6px" },
                      children: [
                        digestChip(t("digest.optLengthShort"), digestLength[0] === 80, function () { setDigestLength(80); }),
                        digestChip(t("digest.optLengthMid"), digestLength[0] === 160, function () { setDigestLength(160); }),
                        digestChip(t("digest.optLengthLong"), digestLength[0] === 320, function () { setDigestLength(320); })
                      ]
                    })
                  ]
                }),
                digestMode[0] === "model" ? null : (0, react_jsx_runtime.jsxs)("div", {
                  children: [
                    (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", marginBottom: "4px", color: "var(--dsw-alias-label-tertiary)" }, children: t("digest.optFormat") }),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", gap: "6px" },
                      children: [
                        digestChip(t("digest.optFormatOutline"), digestFormat[0] === "outline", function () { setDigestFormat("outline"); }),
                        digestChip(t("digest.optFormatMd"), digestFormat[0] === "md", function () { setDigestFormat("md"); }),
                        digestChip(t("digest.optFormatPlain"), digestFormat[0] === "plain", function () { setDigestFormat("plain"); })
                      ]
                    })
                  ]
                }),
                digestError[0] !== "" ? (0, react_jsx_runtime.jsxs)("div", {
                  style: {
                    background: "var(--dsw-alias-bg-layer-1)",
                    border: "0.5px solid var(--dsw-alias-border-l4)",
                    borderRadius: "var(--dsw-radius-lg)",
                    padding: "8px 10px",
                    fontSize: "12px",
                    lineHeight: "18px",
                    color: "var(--dsw-alias-state-error-primary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    userSelect: "text",
                    maxHeight: "30vh",
                    overflowY: "auto"
                  },
                  children: [
                    (0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 600, marginBottom: "2px" }, children: t("digest.errorLabel") }),
                    (0, react_jsx_runtime.jsx)("div", { children: digestError[0] })
                  ]
                }) : null
              ]
            })
          })
        ]
      });
    });

    // Right-click menu, document-scoped. The Chat UI owns the user bubble and
    // publishes no slot for it, but every node wrapper carries
    // `data-chat-flow-kind` + `data-chat-turn`, so on one of the user's own
    // messages this offers the message operations; elsewhere in the transcript
    // it offers "quote selection".
    testHooks.insertPhrase = function (text) {
      var value = typeof text === "string" ? text : "";
      if (value.trim() === "") return false;
      var actions = activeComposer && activeComposer.actions;
      if (!actions || typeof actions.insertText !== "function" || typeof actions.captureInsertion !== "function") return false;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          var span = actions.captureInsertion();
          if (!span || typeof span.start !== "number" || typeof span.end !== "number" || span.draftRev === undefined) return false;
          if (actions.insertText((span.start > 0 ? "\n" : "") + value, span) === true) return true;
        } catch (e) { /* retry with a fresh caret */ }
      }
      return false;
    };

    function installContextMenu(t, options) {
      if (typeof document === "undefined") return function () {};
      var beginRunningEdit = options && typeof options.beginRunningEdit === "function" ? options.beginRunningEdit : null;
      var quickExplain = options && typeof options.quickExplain === "function" ? options.quickExplain : null;
      var menuEl = null;
      function closeMenu() {
        if (menuEl) { menuEl.remove(); menuEl = null; }
      }
      function closestFlowNode(node) {
        while (node && node !== document.body && node !== document.documentElement) {
          if (node.hasAttribute && node.hasAttribute("data-chat-flow-kind")) return node;
          node = node.parentElement;
        }
        return null;
      }
      function isInConversation(node) {
        var el = node;
        while (el && el !== document.body && el !== document.documentElement) {
          if (el.hasAttribute && el.hasAttribute("data-conversation-scroll")) return true;
          el = el.parentElement;
        }
        return closestFlowNode(node) !== null;
      }
      function makeItem(label, pick) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.style.cssText = "display:block;width:100%;text-align:left;background:none;border:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px;border-radius:6px;cursor:pointer;";
        btn.onmouseenter = function () { btn.style.background = "var(--dsw-alias-interactive-bg-hover)"; };
        btn.onmouseleave = function () { btn.style.background = "none"; };
        btn.onclick = function () { closeMenu(); pick(); };
        return btn;
      }
      function openMenu(ev, buttons) {
        ev.preventDefault();
        closeMenu();
        menuEl = document.createElement("div");
        menuEl.style.cssText = "position:fixed;z-index:2147483000;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;box-shadow:var(--dsw-elevation-panel);padding:4px;min-width:170px;";
        menuEl.style.left = Math.min(ev.clientX, Math.max(0, window.innerWidth - 200)) + "px";
        menuEl.style.top = Math.min(ev.clientY, Math.max(0, window.innerHeight - 26 * buttons.length - 16)) + "px";
        for (var i = 0; i < buttons.length; i++) menuEl.appendChild(buttons[i]);
        document.body.appendChild(menuEl);
      }
      /** Save the selected conversation text as a note without leaving the chat. */
      function saveSelectionNote(text, ev) {
        var value = String(text == null ? "" : text).trim();
        if (value === "") {
          showNotice(t("notes.selectionEmpty"), ev, { always: true });
          return;
        }
        var next = readNotes();
        next.push({
          id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text: value,
          at: Date.now()
        });
        var stored = writeNotes(next);
        if (!stored.ok) {
          showNotice(t("notes.writeFailed") + " " + (stored.error || ""), ev, { always: true });
          return;
        }
        showNotice(t("notes.savedFromSelection") + " · " + t("notes.stored", { count: stored.list.length }), ev, { always: true });
      }
      function onContextMenu(ev) {
        // 「引用」总开关：关掉时"引用选中文字 / 跳到出处"整个菜单项不出现（设计稿 §4.2
        // 对右键菜单这一档的要求 —— 菜单项直接不出现比点了才说更干净），其余动作不受影响。
        var quoteOn = featureEnabled("featureQuote");
        var notesOn = featureEnabled("featureNotes");
        // Workspace rows in the sidebar address themselves as
        // `data-row-key="workspace:<id>"` and carry no shipped context menu, so a
        // right-click here offers "start a referencing conversation in it".
        var rowNode = closestByAttribute(ev.target, "data-row-key", undefined);
        if (rowNode !== null) {
          var rowKey = rowNode.getAttribute("data-row-key") || "";
          if (rowKey.indexOf("workspace:") === 0) {
            var targetWorkspaceId = rowKey.slice("workspace:".length);
            var current = typeof options.activeSessionId === "function" ? options.activeSessionId() : undefined;
            if (targetWorkspaceId !== "" && typeof current === "string" && current !== "") {
              openMenu(ev, [makeItem(t("menu.newInWorkspace"), function () {
                publishMenuRequest({
                  kind: "newModeInWorkspace",
                  sessionId: current,
                  workspaceId: targetWorkspaceId,
                  claimed: false
                , t});
              })]);
              return;
            }
          }
        }
        var flow = closestFlowNode(ev.target);
        var kind = flow === null ? null : flow.getAttribute("data-chat-flow-kind");
        var rawTurn = flow === null ? null : flow.getAttribute("data-chat-turn");
        var turn = rawTurn === null || rawTurn === "" ? undefined : Number(rawTurn);
        // 刚分叉出来的子会话里，被点的气泡可能【没有】data-chat-turn（新会话的消息节点是另一套
        // 渲染）⇒ 菜单整排消失（用户实测："重新编辑过的消息，右键没有编辑重发等菜单"）。
        // 回退：往上找最近的带该属性的祖先。只放宽"从哪里取 turn"，不改任何现有行为。
        if (turn === undefined && flow !== null && flow.parentElement) {
          var anc = flow.parentElement;
          while (anc && turn === undefined) {
            try {
              var av = anc.getAttribute ? anc.getAttribute("data-chat-turn") : null;
              if (av !== null && av !== "" && Number.isSafeInteger(Number(av))) turn = Number(av);
            } catch (eA) {}
            anc = anc.parentElement;
          }
        }
        var sessionId = activeComposer.sessionId;
        var selected = selectionText().trim();
        if (kind === "user" && typeof sessionId === "string" && sessionId !== ""
          && turn !== undefined && Number.isSafeInteger(turn)) {
          var ask = function (requestKind, text) {
            return function () {
              publishMenuRequest({ sessionId: sessionId, turn: turn, kind: requestKind, text: text }, t);
            };
          };
          var editAction = ask("edit");
          try {
            if (beginRunningEdit && !document.querySelector('[data-turn-tail="' + turn + '"]')) {
              editAction = function () { beginRunningEdit(sessionId, turn); };
            }
          } catch (e) { /* keep the slot path if the DOM cannot be queried */ }
          var items = [
            makeItem(t("action.resend"), editAction),
            makeItem(t("action.retry"), ask("retry"))
          ];
          // 引用关掉 ⇒ 不再提供"引用选中文字"（这一档的可见性由设置页承担）。
          // 分支属于“整轮”动作，只放在助手动作条；用户消息菜单不重复。
          if (quoteOn && selected !== "") items.push(makeItem(t("menu.quoteSelection"), ask("quote", selected)));
          if (quickExplain && selected !== "") items.push(makeItem(t("quickAsk.action"), function () { quickExplain(selected); }));
          if (notesOn && selected !== "") items.push(makeItem(t("menu.saveNote"), function () { saveSelectionNote(selected, ev); }));
          // A message that quotes an earlier turn (our own marker) can jump back.
          var body = flow === null ? "" : String(flow.textContent || "");
          var anchors = quoteOn ? findAllTurnAnchors(body) : [];
          var plan = quoteJumpPlan(body, selected, anchors);
          var quoted = plan.mode === "selected" ? findQuoteInText(sessionId, body, selected) : null;
          if (plan.mode === "multiple") {
            // Several anchors: let the user pick instead of guessing the newest.
            for (var ai = 0; ai < anchors.length; ai++) {
              (function (anchor) {
                var record = findQuoteRecord(sessionId, anchor.turn);
                var label = t("menu.jumpToQuote") + " · " + t("quote.turnLabel", { turn: anchor.turn })
                  + (anchor.seq === undefined ? "" : " · seq " + anchor.seq);
                items.push(makeItem(label, function () {
                  if (!jumpToQuote(anchor.turn, record === null ? "" : record.quote, record === null ? null : record.anchor, t)) {
                    showNotice(t("quote.jumpFailed"), ev);
                  }
                }));
              })(anchors[ai]);
            }
          } else if (plan.mode === "single") {
            // Exactly one anchor in this turn: use it directly. (Before, this case leaned on
            // body matching, which is what misfired.)
            (function (anchor) {
              var record = findQuoteRecord(sessionId, anchor.turn);
              items.push(makeItem(t("menu.jumpToQuote"), function () {
                if (!jumpToQuote(anchor.turn, record === null ? "" : record.quote, record === null ? null : record.anchor, t)) {
                  showNotice(t("quote.jumpFailed"), ev);
                }
              }));
            })(anchors[0]);
          } else if (quoted !== null && typeof quoted.turn === "number") {
            items.push(makeItem(t("menu.jumpToQuote"), function () {
              if (!jumpToQuote(quoted.turn, quoted.quote, quoted.anchor, t)) showNotice(t("quote.jumpFailed"), ev);
            }));
          }
          openMenu(ev, items);
          return;
        }
        if (selected === "" || !isInConversation(ev.target)) return;
        // 「引用」「存为笔记」「随手百科」是独立能力：引用关掉/没有 composer 不应连带消失。
        var quickItem = quickExplain ? makeItem(t("quickAsk.action"), function () { quickExplain(selected); }) : null;
        var noteItem = notesOn ? makeItem(t("menu.saveNote"), function () { saveSelectionNote(selected, ev); }) : null;
        var fallbackItems = [quickItem, noteItem].filter(function (item) { return item !== null; });
        if (!quoteOn) {
          if (fallbackItems.length > 0) openMenu(ev, fallbackItems);
          return;
        }
        if (!activeComposer.actions) {
          showNotice(t("quote.noComposer"), ev);
          if (fallbackItems.length > 0) openMenu(ev, fallbackItems);
          return;
        }
        // A selection usually sits inside one turn; when it does, say WHICH turn, so the
        // marker is jumpable exactly like the turn-row quote's marker. Only a selection
        // that cannot be attributed falls back to the generic wording.
        var flow = closestFlowNode(ev.target);
        var turnAttr = flow && typeof flow.getAttribute === "function" ? flow.getAttribute("data-chat-turn") : null;
        var turn = turnAttr === null || turnAttr === "" ? null : Number(turnAttr);
        if (turn !== null && isNaN(turn)) turn = null;
        var quoteItem = makeItem(t("menu.quoteSelection"), function () {
          // Same rule as the turn-row quote button: insert, never replace. This path
          // called setDraft, so quoting from the menu wiped the composer too.
          var quoted = blockquote(selected);
          if (quoted.text === "") { showNotice(t("quote.empty"), ev); return; }
            // The outline projection carries each turn's seq, so a selection quote can name
          // the same precise anchor the turn-row button does. The DOM has no seq attribute,
          // which is why this lookup — not a node attribute — is the way to get it.
          var anchorSeq = null;
          if (turn !== null) {
            for (var oi = 0; oi < latestOutline.entries.length; oi++) {
              var outlineEntry = latestOutline.entries[oi];
              if (outlineEntry && outlineEntry.turn === turn && typeof outlineEntry.seq === "number") {
                anchorSeq = outlineEntry.seq;
                break;
              }
            }
            if (latestOutline.sessionId !== null && latestOutline.sessionId !== (typeof options.activeSessionId === "function" ? options.activeSessionId() : undefined)) {
              anchorSeq = null;
            }
          }
          var marker = turn === null ? t("quote.selection") : t("quote.provenance", { turn: turn }) + (anchorSeq === null ? "" : " · seq " + anchorSeq);
          if (quoted.clipped) marker += t("quote.clipped");
          if (turn !== null) {
            // Register the same record the jump uses, so 「跳到引用出处」 works here too.
            rememberQuote({
              sessionId: typeof options.activeSessionId === "function" ? options.activeSessionId() : undefined,
              turn: turn,
              seq: anchorSeq,
              marker: marker,
              quote: quoted.body,
              anchor: outlineAnchorFor(turn),
              at: Date.now()
            });
          }
          if (insertQuoteIntoDraft(activeComposer.actions, quoted.text + quoteBarLine(marker) + "\n") === "failed") {
            showNotice(t("quote.insertFailed"), ev);
          }
        });
        openMenu(ev, [quickItem, quoteItem, noteItem].filter(function (item) { return item !== null; }));
      }
      function onPointerDown(ev) {
        if (menuEl && !menuEl.contains(ev.target)) closeMenu();
      }
      function onKey(ev) {
        if (ev.key === "Escape") closeMenu();
      }
      document.addEventListener("contextmenu", onContextMenu);
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKey, true);
      return function () {
        document.removeEventListener("contextmenu", onContextMenu);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKey, true);
        closeMenu();
      };
    }

    // Quote provenance. The quote carries a readable marker in the message text
    // (so the model knows what was quoted), and the exact marker string is also
    // recorded here so the UI can resolve the source without parsing localized copy.
    var QUOTES_KEY = "dsh.deepworker.quotes";
    function readQuotes() {
      try {
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(QUOTES_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    function rememberQuote(record) {
      try {
        if (typeof localStorage === "undefined") return;
        var list = readQuotes();
        list.push(record);
        while (list.length > 200) list.shift();
        localStorage.setItem(QUOTES_KEY, JSON.stringify(list));
      } catch (e) {
        /* best effort only */
      }
    }
    /**
     * Which quote in this message did the user mean?
     *
     * A message can hold SEVERAL quotes, and markers repeat (two quotes from the same
     * turn carry the identical marker), so matching the marker alone cannot tell them
     * apart: the first match wins and the wrong source gets offered.
     *
     * Resolution order:
     *   1. the SELECTION, when there is one — it pins exactly one quote;
     *   2. the quoted BODY (stored per record, far more distinctive than a marker);
     *   3. the marker, as the original fallback.
     * Newest first at every step.
     */
    /**
     * Can this turn jump to a quoted source, and in how many ways?
     *
     * The rule is anchored on the MARKER (`↳ 引自本轮第 N 轮 · seq M`), which is text this
     * plugin wrote and therefore unambiguous. Matching the quoted BODY against the turn
     * instead produced a false positive on every message whose text was itself once quoted:
     * quoting "SPM是什么" made the turn "SPM是什么" look like it contained a quote.
     *
     * A selection may still drive the jump, but only when something is actually selected —
     * that is the feature where the user highlights text and asks where it came from.
     * @returns {{mode: "none"|"single"|"multiple"|"selected", count: number, anchors: Array}}
     */
    function quoteJumpPlan(bodyText, selectedText, anchors) {
      var list = Array.isArray(anchors) ? anchors : findAllTurnAnchors(typeof bodyText === "string" ? bodyText : "");
      if (list.length > 1) return { mode: "multiple", count: list.length, anchors: list };
      if (list.length === 1) return { mode: "single", count: 1, anchors: list };
      var selected = typeof selectedText === "string" ? selectedText.trim() : "";
      if (selected === "") return { mode: "none", count: 0, anchors: [] };
      return { mode: "selected", count: 1, anchors: [] };
    }

    function findQuoteInText(sessionId, text, preferred) {
      if (typeof text !== "string" || text === "") return null;
      var hint = typeof preferred === "string" ? preferred : "";
      var list = readQuotes();
      // Four passes, strongest evidence first. They must be separate passes: a marker
      // repeats across quotes (two quotes from one turn share it verbatim), so testing
      // "body OR marker" inside one pass lets a newer quote win on its marker alone.
      var passes = [
        function (record, body, marker) { return hint !== "" && body !== "" && hint.indexOf(body) !== -1; },
        function (record, body, marker) { return hint !== "" && marker !== "" && hint.indexOf(marker) !== -1; },
        function (record, body, marker) { return body !== "" && text.indexOf(body) !== -1; },
        function (record, body, marker) { return marker !== "" && text.indexOf(marker) !== -1; }
      ];
      for (var p = 0; p < passes.length; p++) {
        for (var i = list.length - 1; i >= 0; i--) {
          var record = list[i];
          if (!record || record.sessionId !== sessionId) continue;
          var marker = typeof record.marker === "string" ? record.marker : "";
          var body = typeof record.quote === "string" ? record.quote : "";
          if (passes[p](record, body, marker)) return record;
        }
      }
      // Last resort: the anchor is present as TEXT. That covers a quote copied from
      // another machine, pasted by hand, or typed with different spacing.
      var fromText = parseTurnAnchor(text);
      if (fromText === null && hint !== "") fromText = parseTurnAnchor(hint);
      return fromText;
    }
    /**
     * Parse an anchor that is present as TEXT in a message.
     *
     * This is what makes an anchor portable. The plugin's own records live in
     * localStorage, so a quote copied to another device, pasted by hand, or typed with
     * different spacing had no jump at all — even though the turn number was right there
     * in the text. The surrounding words are allowed to vary: only the number matters.
     */
    var TURN_ANCHOR_RE = /引自本轮第\s*(\d+)\s*轮/;
    var SEQ_ANCHOR_RE = /seq\s*(\d+)/;
    /**
     * Every anchor present in a message, in order.
     *
     * One message can quote several places, so it can carry several anchors. Offering a
     * single "jump to the source" item forces a guess (newest wins) — which is exactly the
     * kind of quiet wrong answer this plugin avoids. Listing them lets the user pick.
     * @returns {Array<{turn:number, seq:(number|undefined), marker:string}>}
     */
    function findAllTurnAnchors(text) {
      var raw = String(text == null ? "" : text);
      var out = [];
      var re = new RegExp(TURN_ANCHOR_RE.source, "g");
      var m;
      while ((m = re.exec(raw)) !== null) {
        var value = Number(m[1]);
        if (!Number.isSafeInteger(value)) continue;
        // Bound the seq search to THIS line: a window of N characters would steal the
        // next anchor's seq, and a wrong seq is worse than no seq.
        var lineEnd = raw.indexOf("\n", m.index);
        var tail = raw.slice(m.index, lineEnd === -1 ? raw.length : lineEnd);
        var seq = SEQ_ANCHOR_RE.exec(tail);
        var seqValue = seq === null ? null : Number(seq[1]);
        out.push({
          turn: value,
          seq: seqValue !== null && Number.isSafeInteger(seqValue) ? seqValue : undefined,
          marker: m[0]
        });
        if (out.length >= 8) break;
      }
      return out;
    }
    function parseTurnAnchor(text) {
      var raw = String(text == null ? "" : text);
      var turn = TURN_ANCHOR_RE.exec(raw);
      if (turn === null) return null;
      var value = Number(turn[1]);
      if (!Number.isSafeInteger(value)) return null;
      var seq = SEQ_ANCHOR_RE.exec(raw);
      var seqValue = seq === null ? null : Number(seq[1]);
      return {
        turn: value,
        seq: seqValue !== null && Number.isSafeInteger(seqValue) ? seqValue : undefined,
        marker: turn[0],
        quote: "",
        at: 0,
        fromText: true
      };
    }

    /**
     * The Host anchor key for a turn, when the outline knows it.
     *
     * `flashTurn` prefers a host anchor over a turn-tail lookup, but no writer ever stored
     * one — so that branch was dead and every jump fell back to the END of the turn. The
     * outline projection carries the key, so records can now supply it.
     * @returns {string|undefined}
     */
    function outlineAnchorFor(turn) {
      if (typeof turn !== "number") return undefined;
      for (var i = 0; i < latestOutline.entries.length; i++) {
        var entry = latestOutline.entries[i];
        if (entry && entry.turn === turn && typeof entry.anchorKey === "string" && entry.anchorKey !== "") {
          return entry.anchorKey;
        }
      }
      return undefined;
    }

    /**
     * The most recent quote record for one turn — i.e. WHAT a chip jump should land on.
     * Newest first because one turn can be quoted more than once.
     * @returns {object|null}
     */
    function findQuoteRecord(sessionId, turn) {
      if (typeof turn !== "number" || !Number.isSafeInteger(turn)) return null;
      var list = readQuotes();
      for (var i = list.length - 1; i >= 0; i--) {
        var record = list[i];
        if (!record || record.sessionId !== sessionId || record.turn !== turn) continue;
        if (typeof record.quote === "string" && record.quote !== "") return record;
      }
      return null;
    }

    // Turn tails carry `data-turn-tail="<turn>"`; scrolling the node into view is
    // the whole jump — no navigation service exists for a single turn.
    function scrollToTurn(turn) {
      if (typeof document === "undefined") return false;
      var nodes;
      try {
        nodes = document.querySelectorAll("[data-turn-tail]");
      } catch (e) {
        return false;
      }
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || typeof node.getAttribute !== "function") continue;
        if (node.getAttribute("data-turn-tail") !== String(turn)) continue;
        try {
          node.scrollIntoView({ block: "center", behavior: "smooth" });
          return true;
        } catch (e) {
          try { node.scrollIntoView(); return true; } catch (e2) { return false; }
        }
      }
      return false;
    }

    /**
     * Put a quote into the composer without destroying an existing draft.
     * `caretSpan()` falls back to the end of the draft, so inserting at the caret
     * both respects the user's cursor and preserves whatever they already typed.
     * @returns "inserted" | "replaced" (empty draft only) | "failed"
     */
    /**
     * Put a quote into the composer WITHOUT ever destroying what is already there.
     *
     * The composer's action face is explicit about its contract:
     *
     *   captureInsertion: () => ({ ...caretSpan(), draftRev: rev })
     *   insertText: (text, span) => {
     *     if (phase === "adjudicating" || phase === "submitting" || disposed) return false;
     *     if (span.draftRev !== rev) return false;        // a stale caret is refused
     *     return editor.insertAsyncText(span, text);
     *   }
     *   setDraft: (text) => …                              // replaces the WHOLE draft
     *
     * Two consequences, both learned the hard way:
     *   - the span is mandatory (dropping it throws inside the action), so insertion is
     *     caret-based and a draft that already has text is preserved;
     *   - `setDraft` is a full replacement, so it must never be a fallback. An earlier
     *     version used it whenever an empty caret span looked like "the draft is empty",
     *     and quoting wiped whatever the user had typed.
     *
     * A stale rev is retried once: the draft can change between capture and insert.
     * @returns {"inserted" | "failed"}
     */
    function insertQuoteIntoDraft(inputActions, quote) {
      if (!inputActions || typeof inputActions !== "object") return "failed";
      if (typeof inputActions.insertText !== "function") return "failed";
      if (typeof inputActions.captureInsertion !== "function") return "failed";
      for (var attempt = 0; attempt < 2; attempt++) {
        var span = null;
        try {
          span = inputActions.captureInsertion();
        } catch (e) {
          return "failed";
        }
        if (!span || typeof span.start !== "number" || typeof span.end !== "number" || typeof span.draftRev === "undefined") {
          return "failed";
        }
        try {
          // A newline keeps the quote off the text that is already there; at offset 0
          // there is nothing to separate from.
          if (inputActions.insertText((span.start > 0 ? "\n" : "") + quote, span) === true) return "inserted";
        } catch (e) {
          /* a stale rev can throw; loop once with a fresh span */
        }
      }
      return "failed";
    }

    /**
     * Where a retry forks: immediately BEFORE the turn.
     *
     * Forking at the turn's END would look better on paper (the child inherits the
     * attempt's durable events and DSH's `openTurnClosers` can seed
     * TOOL_OUTCOME_UNKNOWN guidance), but a fork seed is a VERBATIM slice:
     *
     *   const prefix = events.slice(0, boundary + 1);      // dsh-session buildForkSeed
     *
     * so it also inherits every `agent/inbox/spliced` — the NOT-YET-SENT queue. Both
     * the parent and the child would then claim and deliver the same queued messages.
     * There is no remote to remove queue entries, so the only safe boundary is before
     * the turn; the attempt's work is carried in words instead (see retryNote).
     */
    function retryForkSeq(turn) {
      if (!turn || !turn.start || typeof turn.start.seq !== "number") return undefined;
      var boundary = turn.start.seq - 1;
      // `atSeq` must name an existing, non-negative event sequence.
      return boundary >= 0 ? boundary : undefined;
    }

    /**
     * Merge an import payload into the note list.
     * Accepts this plugin's exported JSON (an array of `{text}`) or plain text with
     * one note per line; blank lines and duplicates (by text) are skipped.
     * @returns {{ list: Array, added: number }}
     */
    function mergeNotes(existing, raw) {
      var incoming = null;
      try {
        var parsed = JSON.parse(String(raw));
        if (Array.isArray(parsed)) incoming = parsed;
      } catch (e) {
        incoming = null;
      }
      if (incoming === null) {
        incoming = String(raw).split("\n").map(function (line) {
          return { text: line.replace(/^\s*[-*]\s+/, "").trim() };
        });
      }
      var next = existing.slice();
      var seen = {};
      for (var i = 0; i < next.length; i++) seen[next[i].text] = true;
      var added = 0;
      for (var j = 0; j < incoming.length; j++) {
        var entry = incoming[j];
        var value = entry && typeof entry.text === "string" ? entry.text.trim() : "";
        if (value === "" || seen[value] === true) continue;
        seen[value] = true;
        next.push({
          id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text: value,
          at: Date.now(),
          tags: normalizeTags(entry && entry.tags)
        });
        added++;
      }
      return { list: next, added: added };
    }

    /**
     * Append one note WITHOUT the duplicate rule `mergeNotes` applies.
     * A digest is a snapshot: saving it again later is intentional (the
     * conversation has moved on), and even saving it twice verbatim is the user's
     * call — silently dropping it was the bug.
     * @returns {{ list: Array, added: number, total: number }}
     */
    function appendNote(existing, text, tags) {
      var next = existing.slice();
      var value = String(text == null ? "" : text).trim();
      var added = 0;
      if (value !== "") {
        next.push({
          id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text: value,
          at: Date.now(),
          tags: normalizeTags(tags)
        });
        added = 1;
      }
      return { list: next, added: added, total: next.length };
    }

    // The shipped Modal sizes its card at `min(380px, 100%)`, which is far too
    // narrow for a scratchpad or a form. These own-class rules win on the doubled
    // class selector, so no `!important` (and no shipped class name) is needed.
    var DIALOG_STYLE_ID = "history-actions-dialog-size";
    var DIALOG_CSS = [
      ".dsh-ha-notes-dialog.dsh-ha-notes-dialog{width:min(880px,100%);max-height:100%}",
      ".dsh-ha-form-dialog.dsh-ha-form-dialog{width:min(600px,100%);max-height:100%}",
      ".dsh-ha-wide-dialog.dsh-ha-wide-dialog{width:min(640px,100%)}"
    ].join("");
    /**
     * Find highlighting uses the CSS Custom Highlight API: it paints ranges without
     * touching the DOM, so React's reconciler never sees foreign nodes. The earlier
     * version only scrolled to the turn boundary and flashed an outline, which is
     * invisible when the match is already on screen — the user saw "2/2" and nothing else.
     */
    function installFindStyles() {
      if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
      // 样式注入不依赖功能开关：它在激活时一次性注入，随后一直留着（关掉查找只是不开栏）。
      // 这里读开关就会撞上 §5.3 那个"关掉再打开 ⇒ 幂等守卫让它永远注入不上"的坑，所以
      // 刻意不 gate —— 高亮样式本身无害，只有查找栏会用它。
      if (document.getElementById("dsh-ha-find-style") !== null) return;
      var style = document.createElement("style");
      style.id = "dsh-ha-find-style";
      // `::highlight()` accepts only a handful of properties — `color`,
      // `background-color`, `text-decoration*`, `text-shadow`. The shorthand `background`
      // is NOT one of them: it is dropped silently, leaving dark text on a dark theme,
      // which is why a range could be registered and still be invisible.
      style.textContent = [
        "::highlight(dsh-ha-find){background-color:#ffe08a;color:#1c1c1c;}",
        "::highlight(dsh-ha-find-current){background-color:#ff9f43;color:#1c1c1c;}"
      ].join("\n");
      document.head.appendChild(style);
    }
    /**
     * Turn anchor written as a mention so the chat renders a CHIP for it.
     *
     * `projectUserText` turns any `@token` into a chip, which is the only structured
     * element a user message can carry (the bubble does not render markdown). A token
     * that is not a known session renders as a FILE chip, so the click handler
     * intercepts it in the capture phase before the file opener sees it.
     *
     * `@第93轮` / `@turn93` — no space inside the token, or only the first word chips.
     */
    /**
     * The turn a legacy chip stands for, or null when the chip is a real reference.
     *
     * Why this exists at all: an earlier version wrote the anchor as a bare `@第N轮` in
     * order to get the chat to render a CHIP for it. The chip turned out to be a FILE
     * chip (the token is not a known session), so it promised "open a file" and clicking
     * it opened a broken preview. Writing the anchor as plain text again fixes that, and
     * this parser keeps the OLD messages working: their chips are still in the transcript,
     * so clicking one must still jump to the turn instead of the file opener.
     *
     * The visible chip text drops the `@` (projectUserText renders `label.slice(1)`), so
     * both forms must parse. Matching is strict on purpose — `file2.txt` is a real file
     * reference and must NOT be read as turn 2.
     */
    var TURN_CHIP_RE = /^@?第(\d+)轮$/;
    function parseTurnChip(label) {
      var m = TURN_CHIP_RE.exec(String(label == null ? "" : label).trim());
      if (m === null) return null;
      var turn = Number(m[1]);
      return Number.isSafeInteger(turn) ? turn : null;
    }
    // ── 专注锁：客户端侧判定（状态从对话记录里读，不需要任何新通道）────────────
    /**
     * The newest focus-lock state written into a transcript.
     *
     * The client cannot read the lock file (no filesystem, and a hand-written plugin cannot
     * add a host RPC). But the CLI's output lands in the conversation, and the client renders
     * the conversation — so the transcript IS the channel. Enforcement only has to work in
     * the session the user is about to leave, and that session can see its own transcript.
     */
    var FOCUS_MARKER = "[focus-lock-state]";
    function parseFocusLockState(text) {
      var raw = String(text == null ? "" : text);
      var at = raw.lastIndexOf(FOCUS_MARKER);
      if (at === -1) return null;
      var rest = raw.slice(at + FOCUS_MARKER.length);
      // The rendered DOM can split this JSON across element boundaries and drop the newline,
      // so "read to the newline and parse" returned null even when the marker WAS present
      // (measured: 标记在会话根=true, marker=读不到). Parse from the first `{` and brace-match:
      // try the longest candidate first, then progressively shorter ones.
      var parsed = null;
      var open = rest.indexOf("{");
      if (open !== -1) {
        for (var end = rest.length; end > open; end--) {
          if (rest.charAt(end - 1) !== "}") continue;
          try { parsed = JSON.parse(rest.slice(open, end).trim()); break; } catch (e) { /* shorter */ }
        }
        if (parsed !== null && typeof parsed === "object") {
          // A whole lock-file object may sit here too; accept it via the file parser.
          if (parsed.locked === undefined && parsed.enabled !== undefined) return parseFocusLockFile(rest.slice(open));
        }
      }
      if (parsed === null) {
        var stop = rest.indexOf("\n");
        var line = (stop === -1 ? rest : rest.slice(0, stop)).trim();
        try { parsed = JSON.parse(line); } catch (e) { return null; }
      }
      if (parsed === null || typeof parsed !== "object") return null;
      if (parsed.locked !== true) return { locked: false };
      if (parsed.kind !== "session" && parsed.kind !== "workspace") return null;
      if (typeof parsed.targetId !== "string" || parsed.targetId === "") return null;
      var untilMs = typeof parsed.until === "string" ? Date.parse(parsed.until) : NaN;
      if (!Number.isFinite(untilMs)) return null;
      return {
        locked: true,
        kind: parsed.kind,
        targetId: parsed.targetId,
        untilMs: untilMs,
        canUnlockNow: parsed.canUnlockNow === true,
        waitSeconds: typeof parsed.waitSeconds === "number" ? parsed.waitSeconds : 0,
        unlocks: typeof parsed.unlocks === "number" ? parsed.unlocks : 0
      };
    }
    /**
     * The request the UI can send when it cannot write the state itself.
     *
     * A client plugin cannot write the lock file (no fs) and cannot add a host RPC, so the
     * composer is the one channel it has: the user presses enter and the agent performs the
     * lock. Wording is fixed so the intent is unambiguous on the other side.
     * @returns {string}
     */
    function focusRequestText(action, kind, minutes) {
      var target = kind === "workspace" ? "工作区" : "会话";
      if (action === "unlock") return "【专注锁】请解锁（如果冷却还没到，就告诉我还要等多久）。";
      var mins = typeof minutes === "number" && minutes > 0 ? minutes : 30;
      return "【专注锁】请锁上这个" + target + "，持续 " + mins + " 分钟，冷却 10 分钟。";
    }

    /**
     * Read a sidebar row's key as a navigation target.
     *
     * The workspace UI marks rows `session:<id>` and `workspace:<key>` (read from
     * dsh-client-ui-workspace). Parsing is separated from intercepting so the decision can be
     * tested without a DOM.
     * @returns {{sessionId?: string, workspaceId?: string}|null}
     */
    /**
     * Parse the lock state the way the WORKSPACE FILE carries it.
     *
     * The file is plain JSON. The transcript-marker parser looks for `[focus-lock-state] {…}`
     * and therefore returned null for every file — which is why the UI lock stayed inert even
     * once the read itself worked.
     * @returns {object|null}
     */
    function parseFocusLockFile(text) {
      var raw = String(text == null ? "" : text);
      var trimmed = raw.replace(/^\s+/, "");
      if (trimmed.charAt(0) === "{") {
        var data = null;
        try { data = JSON.parse(trimmed); } catch (e) { data = null; }
        if (data !== null && typeof data === "object") {
          if (data.enabled !== true) return { locked: false };
          if ((data.kind === "session" || data.kind === "workspace")
            && typeof data.targetId === "string" && data.targetId !== ""
            && typeof data.untilMs === "number" && Number.isFinite(data.untilMs)) {
            return { locked: true, kind: data.kind, targetId: data.targetId, untilMs: data.untilMs,
              canUnlockNow: true, waitSeconds: 0,
              unlocks: Array.isArray(data.unlocks) ? data.unlocks.length : 0 };
          }
          return null;
        }
      }
      return parseFocusLockState(raw);
    }

    /**
     * Human-readable lock status for the settings row.
     *
     * The old line printed `targetId` and an ISO timestamp — both are internal ids, and the
     * state itself came from the host file cache, so a local lock never showed up at all.
     * This takes the EFFECTIVE state and says what the user needs: locked or not, which
     * scope, and how long is left.
     */
    function describeFocusState(state, translate, nowMs) {
      var now = typeof nowMs === "number" ? nowMs : Date.now();
      if (state === null || typeof state !== "object") return translate("focus.unknown");
      if (state.locked !== true) return translate("focus.free");
      var left = state.untilMs - now;
      if (!(left > 0)) return translate("focus.free");
      var minutes = Math.max(1, Math.ceil(left / 60000));
      var scope = state.kind === "workspace" ? translate("focus.scopeWorkspace") : translate("focus.scopeSession");
      return translate("focus.locked") + " · " + scope + " · "
        + translate("focus.remaining") + " " + translate("focus.minutes", { n: minutes });
    }

    function focusRowTarget(rowKey) {
      var raw = String(rowKey == null ? "" : rowKey);
      if (raw.indexOf("session:") === 0 && raw.length > 8) return { sessionId: raw.slice(8) };
      if (raw.indexOf("workspace:") === 0 && raw.length > 10) return { workspaceId: raw.slice(10) };
      return null;
    }

    /**
     * Compare two session ids tolerantly.
     *
     * The host sees `session-<uuid>` (measured) while the client's own id may be the bare
     * uuid. A strict === then never matches and the entire UI lock silently does nothing —
     * which is exactly what the user reported ("can still open other sessions").
     */
    function sameSessionId(a, b) {
      var x = String(a == null ? "" : a);
      var y = String(b == null ? "" : b);
      if (x === "" || y === "") return false;
      if (x === y) return true;
      return x.replace(/^session-/, "") === y.replace(/^session-/, "");
    }

    /** Is the lock live AND is the user currently inside it? */
    function focusHolds(state, where, nowMs) {
      if (state === null || state.locked !== true) return false;
      var now = typeof nowMs === "number" ? nowMs : Date.now();
      if (state.untilMs <= now) return false;              // expired: the way out is time itself
      var sessionId = where && typeof where.sessionId === "string" ? where.sessionId : "";
      var workspaceId = where && typeof where.workspaceId === "string" ? where.workspaceId : "";
      if (state.kind === "session") return sameSessionId(sessionId, state.targetId);
      return workspaceId !== "" && workspaceId === state.targetId;
    }
    /**
     * May the user move from where they are to `target`?
     * @returns {{blocked: boolean, reason?: string}}
     */
    function focusVerdict(state, where, target, nowMs) {
      if (!focusHolds(state, where, nowMs)) return { blocked: false };
      var sessionId = target && typeof target.sessionId === "string" ? target.sessionId : "";
      var workspaceId = target && typeof target.workspaceId === "string" ? target.workspaceId : "";
      var inside = state.kind === "session"
        ? (sessionId !== "" && sessionId === state.targetId)
        : (workspaceId !== "" && workspaceId === state.targetId);
      if (inside) return { blocked: false };
      return {
        blocked: true,
        reason: "专注锁：锁定期间只能待在" + (state.kind === "session" ? "这个会话" : "这个工作区")
          + "，直到 " + new Date(state.untilMs).toISOString()
      };
    }

    /** The element the chat renders its transcript into. */
    function conversationRoot() {
      if (typeof document === "undefined" || typeof document.querySelector !== "function") return null;
      return document.querySelector("[data-conversation-scroll]");
    }
    /**
     * Paint every occurrence of `query` inside the transcript.
     * @returns {Array<Range>} matched ranges in document order (empty when unsupported).
     */
    /**
     * Progressively looser needles for locating a recorded quote in the DOM.
     *
     * The recorded body is NORMALISED (blank runs collapsed, trailing spaces trimmed) while
     * the transcript holds the raw text; and a long quote is CLIPPED with a trailing `…`.
     * Either difference makes an exact match fail — and a failed match silently degrades to
     * "flash the turn", which is what a multi-line quote used to do. So try the whole thing
     * first, then its lines: a line that survived normalisation is very likely to be there.
     * @returns {Array<string>} candidates, longest and most specific first.
     */
    function needleCandidates(phrase) {
      var out = [];
      var push = function (value) {
        var text = String(value == null ? "" : value).trim();
        if (text === "" || text.length < 6 || out.indexOf(text) !== -1) return;
        out.push(text);
      };
      var body = String(phrase == null ? "" : phrase).trim();
      push(body);
      push(body.replace(/…+$/, "").trim());            // the clip marker is not in the DOM
      var lines = body.split("\n").map(function (line) { return line.trim(); })
        .filter(function (line) { return line.length >= 6; });
      // Longest line first: the most distinctive one is the best single-line anchor.
      lines.sort(function (a, b) { return b.length - a.length; });
      for (var i = 0; i < lines.length && i < 3; i++) push(lines[i]);
      // Finally a head fragment, for a line that was itself trimmed in the middle.
      var head = body.replace(/…+$/, "").trim().slice(0, 60);
      push(head);
      return out;
    }

    /**
     * Which match belongs to the turn we jumped to.
     *
     * A turn's text spans SEVERAL flow items (the user's message, the assistant's reply,
     * tool rows). Scoping the search to one element therefore missed the quoted sentence
     * whenever it lived in another item of the same turn — which is the normal case when
     * you quote the assistant. So the search runs over the whole transcript and each match
     * is attributed to its turn through the DOM; this picks the one we want.
     * @returns {number} index into `turns`, or -1 when none belongs to `turn`.
     */
    function pickIndexForTurn(turns, turn) {
      for (var i = 0; i < turns.length; i++) if (turns[i] === turn) return i;
      return -1;
    }

    /**
     * What the last jump actually found. Reported to the user when a jump cannot land on
     * the quoted sentence, so the reason is visible instead of being guessed at — the
     * alternative was three rounds of "no highlight" with no evidence at all.
     */
    var jumpDiag = "";
    /** Removes the wrapped highlight when the flash is over. */
    var jumpCleanup = null;
    /** Re-applies the wrapper while React may still be re-rendering over it. */
    var jumpKeeper = null;
    /** Survives until the next jump; the settings page prints it. */
    var lastJumpDiag = "";
    /** 「上次启动」诊断串：与 lastJumpDiag 同构 —— 只有一行，留在「调试」折叠里。 */
    var lastStartDiag = "";
    function describeJump() { return jumpDiag; }

    /**
     * Paint one range by WRAPPING it in a styled span.
     *
     * The CSS Custom Highlight API can be present and still paint nothing — it depends on
     * a `::highlight()` rule whose property support is limited, and on the API being
     * available at all. Wrapping needs neither, so a jump is either visibly highlighted or
     * demonstrably failed. React owns the surrounding text, so the wrapper is removed on a
     * timer and the text node is restored verbatim.
     * @returns {{ element: Element, restore: Function }|null} null when the range cannot be
     *   wrapped. The ELEMENT is returned because `surroundContents` splits or replaces the
     *   original text node — scrolling that node afterwards is a silent no-op, which is how
     *   a jump ended up highlighting without moving the viewport at all.
     */
    function wrapRange(range) {
      if (typeof document === "undefined") return null;
      var span = document.createElement("span");
      span.setAttribute("data-ha-jump", "1");
      span.style.backgroundColor = "#ffe08a";
      span.style.color = "#1c1c1c";
      span.style.borderRadius = "2px";
      try {
        range.surroundContents(span);
      } catch (e) {
        // The phrase crosses element boundaries; extract and reinsert instead.
        try {
          span.appendChild(range.extractContents());
          range.insertNode(span);
        } catch (e2) {
          return null;
        }
      }
      var text = span.textContent || "";
      return {
        element: span,
        restore: function () {
          var parent = span.parentNode;
          if (parent === null) return;
          try {
            parent.replaceChild(document.createTextNode(text), span);
            if (typeof parent.normalize === "function") parent.normalize();
          } catch (e) { /* the node was re-rendered away */ }
        }
      };
    }

    /**
     * Wrap every segment of one match.
     *
     * Each segment lies inside a single text node, so `surroundContents` never has to
     * restructure the tree — the transcript is React-owned and moving its nodes is what
     * breaks it. A multi-line quote simply produces several wrappers, and a partial failure
     * rolls the rest back so a half-highlight never survives.
     * @returns {{ element: Element, restore: Function }|null}
     */
    function wrapMatch(match) {
      if (match === null || !match.ranges || match.ranges.length === 0) return null;
      var parts = [];
      for (var i = 0; i < match.ranges.length; i++) {
        var one = wrapRange(match.ranges[i]);
        if (one === null) {
          for (var k = parts.length - 1; k >= 0; k--) parts[k].restore();
          return null;
        }
        parts.push(one);
      }
      return {
        element: parts[0].element,
        restore: function () {
          for (var i = parts.length - 1; i >= 0; i--) parts[i].restore();
        }
      };
    }

    /** Watch the highlight for this long after a jump, then clear it. */
    var JUMP_HIGHLIGHT_MS = 2600;
    var jumpHighlightTimer = null;
    /**
     * Every place `query` occurs, as Ranges. No browser API required — finding text is
     * plain DOM walking. Keeping this separate from painting is what lets the jump use a
     * mechanism that cannot silently do nothing.
     * @returns {Array<Range>}
     */
    /**
     * All matches of `query`, each possibly spanning SEVERAL text nodes.
     *
     * A quoted sentence is not obliged to live in one text node: a multi-line quote, or one
     * crossing an inline element (bold, code), is split by the renderer. Searching node by
     * node finds nothing at all — which is why a multi-line quote used to fall back to
     * flashing the turn. So the text is flattened, searched as one string, and each hit is
     * mapped back to per-node segments.
     * @returns {Array<{ranges: Array<Range>}>} matches in document order.
     */
    function collectMatches(query, scope) {
      var needle = normalizeForMatch(query);
      if (needle === "") return [];
      var root = scope || conversationRoot();
      if (root === null || typeof root.querySelectorAll !== "function") return [];
      if (typeof document === "undefined" || typeof document.createTreeWalker !== "function") return [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      // Flatten the text WITH an offset map, collapsing every whitespace run to one space.
      // The transcript and the recorded quote do not agree on whitespace: a markdown table
      // is rendered as cells, so the DOM has NO separator where a selection (and therefore
      // the stored body) has tabs and newlines. Matching raw text can never succeed there;
      // matching normalised text can, and the map turns positions back into real ranges.
      var flat = "";
      var map = [];
      var node = walker.nextNode();
      while (node !== null) {
        var parent = node.parentElement;
        var text = node.nodeValue || "";
        if (parent && !parent.closest("#dsh-ha-find") && text !== "") {
          for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            // Whitespace is skipped on BOTH sides: a markdown table renders as cells with
            // no separator at all, while the selection that produced the stored body has
            // tabs and newlines. Only a whitespace-free comparison can line them up.
            if (/\s/.test(ch)) continue;
            flat += ch;
            map.push({ node: node, offset: i });
          }
        }
        node = walker.nextNode();
      }
      var hay = flat.toLowerCase();
      var matches = [];
      var from = hay.indexOf(needle);
      var guard = 0;
      while (from !== -1 && matches.length < 200 && guard < 2000) {
        guard += 1;
        var to = from + needle.length;
        // Merge every run that lives in the SAME text node into one range. Runs are split
        // wherever the source had whitespace (the comparison skips it), and wrapping run A
        // SPLITS its text node — which invalidates a stored range for run B in that same
        // node, so B would be wrapped from offset 0 and duplicate the text. One range per
        // text node avoids that entirely, and covers the spaces in between as a bonus.
        var segments = [];
        var current = null;
        for (var k = from; k < to && k < map.length; k++) {
          var point = map[k];
          if (current !== null && current.node === point.node) {
            current.end = point.offset;
            continue;
          }
          current = { node: point.node, start: point.offset, end: point.offset };
          segments.push(current);
        }
        var ranges = [];
        for (var g = 0; g < segments.length; g++) {
          try {
            var range = document.createRange();
            range.setStart(segments[g].node, segments[g].start);
            range.setEnd(segments[g].node, segments[g].end + 1);
            ranges.push(range);
          } catch (e) { /* a detached node resolves nothing */ }
        }
        if (ranges.length > 0) matches.push({ ranges: ranges });
        from = hay.indexOf(needle, from + Math.max(1, needle.length));
      }
      return matches;
    }
    /**
     * The form both sides are compared in: whitespace runs collapsed to one space.
     *
     * This is what makes a quote of rendered content findable at all — a markdown table, an
     * inline element or a wrapped line all differ from the stored body only in whitespace.
     */
    function normalizeForMatch(text) {
      return String(text == null ? "" : text).replace(/\s+/g, "").toLowerCase();
    }
    /** Flat view of every match — the find bar highlights them all at once. */
    function collectRanges(query, scope) {
      var matches = collectMatches(query, scope);
      var out = [];
      for (var i = 0; i < matches.length; i++) {
        for (var k = 0; k < matches[i].ranges.length; k++) out.push(matches[i].ranges[k]);
      }
      return out;
    }
    function highlightMatches(query, scope) {
      if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) return null;
      var needle = String(query == null ? "" : query).trim().toLowerCase();
      if (needle === "") { CSS.highlights.delete("dsh-ha-find"); return []; }
      var ranges = collectRanges(query, scope);
      var highlight = new Highlight();
      for (var i = 0; i < ranges.length; i++) highlight.add(ranges[i]);
      CSS.highlights.set("dsh-ha-find", highlight);
      return ranges;
    }
    /** Mark one range as the current hit and bring it into view. */
    function focusRange(ranges, index) {
      if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) return false;
      if (!ranges || ranges.length === 0) { CSS.highlights.delete("dsh-ha-find-current"); return false; }
      var range = ranges[((index % ranges.length) + ranges.length) % ranges.length];
      var current = new Highlight(range);
      CSS.highlights.set("dsh-ha-find-current", current);
      try {
        var el = range.startContainer.parentElement;
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
      } catch (e) { return false; }
      return true;
    }
    /**
     * Jump to a quote's source, the same way from every entry point.
     *
     * The behaviour used to depend on which entry the user took: the chip path landed on
     * the quoted sentence and highlighted it, while the context-menu path only scrolled to
     * the turn — so "no highlight" was reported for the path that was actually used.
     * @returns {boolean} whether the turn could be located.
     */
    function jumpToQuote(turn, phrase, anchor, translate) {
      try {
        return jumpToQuoteInner(turn, phrase, anchor, translate);
      } catch (e) {
        // A throw here used to vanish: no jump, no notice, nothing to diagnose.
        var message = e && e.message ? e.message : String(e);
        lastJumpDiag = "THREW: " + message + " | " + jumpDiag;
        if (typeof translate === "function") showNotice(translate("quote.jumpFailed") + " (" + message + ")", { clientX: 24, clientY: 80 });
        return false;
      }
    }
    function jumpToQuoteInner(turn, phrase, anchor, translate) {
      // Precise landing first — it scrolls to the sentence itself. Scrolling to the turn
      // first and then to the sentence would be two jumps, and `data-turn-tail` marks the
      // turn's END, which is not where the quoted sentence lives.
      if (typeof phrase === "string" && phrase !== "" && highlightQuoteInTurn(turn, phrase)) return true;
      if (!scrollToTurn(turn)) return false;
      // No known phrase (a text-only anchor): a visible pulse still confirms the landing.
      flashTurn(turn, anchor);
      // Recorded, not toasted: notices replace one another, so a toast would be gone before
      // it could be read. The settings page prints this line until the next jump.
      var say = typeof translate === "function" ? translate : function (key) { return key; };
      lastJumpDiag = jumpDiag === "" ? say("quote.jumpNoPhrase") : jumpDiag;
      return true;
    }

    /**
     * Highlight one phrase inside one turn, scroll it into view and flash it.
     *
     * Jumping to the turn boundary is not the same as landing on the quoted sentence: a
     * turn holds a whole message, often far taller than the viewport. Locating the text
     * itself is what makes the jump feel exact.
     * @returns {boolean} whether the phrase was found and highlighted.
     */
    function highlightQuoteInTurn(turn, phrase) {
      if (typeof document === "undefined") return false;
      var needle = String(phrase == null ? "" : phrase).trim();
      if (needle === "") { jumpDiag = "phrase=0c"; return false; }
      // Search the whole transcript: the sentence may sit in any flow item of the turn.
      // `collectRanges` needs no browser API, so a jump cannot fail for that reason.
      var tries = needleCandidates(needle);
      var matches = [];
      var usedNeedle = needle;
      for (var t = 0; t < tries.length; t++) {
        matches = collectMatches(tries[t]);
        if (matches.length > 0) { usedNeedle = tries[t]; break; }
      }
      var api = typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;
      var segmentCount = 0;
      for (var c = 0; c < matches.length; c++) segmentCount += matches[c].ranges.length;
      jumpDiag = "api=" + (api ? "yes" : "NO") + " matches=" + matches.length + " segments=" + segmentCount
        + " phrase=" + needle.length + "c used=" + usedNeedle.length + "c turn=" + turn;
      if (matches.length === 0) return false;
      var turns = [];
      for (var i = 0; i < matches.length; i++) {
        var owner = null;
        try {
          var el = matches[i].ranges[0].startContainer.parentElement;
          owner = el && typeof el.closest === "function" ? el.closest("[data-chat-turn]") : null;
        } catch (e) { owner = null; }
        var value = owner === null || typeof owner.getAttribute !== "function" ? NaN : Number(owner.getAttribute("data-chat-turn"));
        turns.push(Number.isSafeInteger(value) ? value : -1);
      }
      jumpDiag += " owner=[" + turns.join(",") + "]";
      var hit = pickIndexForTurn(turns, turn);
      jumpDiag += " hit=" + hit;
      if (hit < 0) return false;
      // Wrap the phrase: visible without any API, and removable verbatim.
      if (jumpCleanup !== null) { jumpCleanup(); jumpCleanup = null; }
      var wrapped = wrapMatch(matches[hit]);
      jumpDiag += " wrapped=" + (wrapped === null ? "NO" : "yes");
      if (wrapped === null) return false;
      jumpCleanup = wrapped.restore;
      // The transcript is React-rendered: a re-render replaces the text node and takes the
      // wrapper with it, which looks exactly like "it jumped but never highlighted". Keep
      // re-applying it for the life of the flash and count how often that was necessary —
      // the count is the evidence for whether this is what happens.
      var reapplied = 0;
      if (jumpKeeper !== null) { clearInterval(jumpKeeper); jumpKeeper = null; }
      var keeperWrapped = wrapped;
      var keeperRestore = wrapped.restore;
      jumpKeeper = setInterval(function () {
        // A tick from an older jump must not touch this one: it would wrap text that is
        // already wrapped, nesting the highlight and duplicating text on restore.
        if (jumpCleanup !== keeperRestore) { clearInterval(jumpKeeper); jumpKeeper = null; return; }
        if (keeperWrapped.element.parentNode !== null) return;
        var retries = needleCandidates(needle);
        var again = [];
        for (var rt = 0; rt < retries.length; rt++) {
          again = collectMatches(retries[rt]);
          if (again.length > 0) break;
        }
        var fresh = [];
        for (var k = 0; k < again.length; k++) {
          var own = null;
          try {
            var parentEl = again[k].ranges[0].startContainer.parentElement;
            own = parentEl && typeof parentEl.closest === "function" ? parentEl.closest("[data-chat-turn]") : null;
          } catch (e) { own = null; }
          var ownTurn = own === null || typeof own.getAttribute !== "function" ? NaN : Number(own.getAttribute("data-chat-turn"));
          fresh.push(Number.isSafeInteger(ownTurn) ? ownTurn : -1);
        }
        var again_hit = pickIndexForTurn(fresh, turn);
        if (again_hit < 0) { clearInterval(jumpKeeper); jumpKeeper = null; return; }
        var rewrapped = wrapMatch(again[again_hit]);
        if (rewrapped === null) { clearInterval(jumpKeeper); jumpKeeper = null; return; }
        keeperWrapped = rewrapped;
        jumpCleanup = rewrapped.restore;
        reapplied += 1;
        jumpDiag += " reapplied=" + reapplied;
      }, 400);
      // Scroll the WRAPPER: the original text node was split by `surroundContents`, so
      // scrolling it is a silent no-op and the viewport never moves.
      try {
        if (wrapped.element && typeof wrapped.element.scrollIntoView === "function") {
          wrapped.element.scrollIntoView({ block: "center" });
        } else {
          jumpDiag += " scrollTarget=NO";
        }
      } catch (e) { jumpDiag += " scrollThrew"; }
      if (jumpHighlightTimer !== null) clearTimeout(jumpHighlightTimer);
      jumpHighlightTimer = setTimeout(function () {
        jumpHighlightTimer = null;
        if (jumpKeeper !== null) { clearInterval(jumpKeeper); jumpKeeper = null; }
        if (jumpCleanup !== null) { jumpCleanup(); jumpCleanup = null; }
      }, JUMP_HIGHLIGHT_MS);
      return true;
    }
    function clearFindHighlights() {
      if (typeof CSS === "undefined" || !CSS.highlights) return;
      CSS.highlights.delete("dsh-ha-find");
      CSS.highlights.delete("dsh-ha-find-current");
    }

    function installDialogSizes() {
      if (typeof document === "undefined" || !document.head || typeof document.head.appendChild !== "function") {
        return function () {};
      }
      var el = document.createElement("style");
      el.setAttribute("data-history-actions", DIALOG_STYLE_ID);
      el.textContent = DIALOG_CSS;
      document.head.appendChild(el);
      return function () {
        if (typeof el.remove === "function") el.remove();
      };
    }

    // One transient notice shared by both document-level listeners.
    var noticeEl = null;
    // ── 7. 浮层：提示 / 右键菜单 / 查找条（命令式 DOM，不经 React 状态）─────────
    var noticeTimer = null;
    function closeNotice() {
      if (noticeTimer !== null) { clearTimeout(noticeTimer); noticeTimer = null; }
      if (noticeEl !== null) { noticeEl.remove(); noticeEl = null; }
    }
    /**
     * Decide whether a notice may be delivered as a NATIVE notification.
     *
     * The app window's Electron session grants every non-media permission (read from
     * lib/main.js: `if (permission !== "media") { callback(true); return; }`), so the renderer
     * may raise a real macOS notification — the one at the top right that also lands in
     * Notification Center. There is no menu-bar icon to attach it to: DSH's tray is
     * Windows-only and lives in the Electron main process, out of reach of any plugin.
     *
     * Pure, because the failure that matters here is silent: a notice that neither appears
     * natively nor falls back to the bubble is a lost message.
     * @returns {{native: boolean, inPage: boolean}}
     */
    function notifyPlan(input) {
      const enabled = !input || input.enabled !== false;
      const supported = Boolean(input && input.supported);
      const permission = input && typeof input.permission === "string" ? input.permission : "denied";
      const native = enabled && supported && (permission === "granted" || permission === "default");
      return { native: native, inPage: !native };
    }

    /**
     * May this notice be delivered, given the scope settings?
     *
     * Scope only (which sessions may notify me), not type: the type switch would need every
     * call site to carry its copy key, and doing that mechanically broke the syntax twice — so
     * it gets its own careful pass rather than riding along with this one.
     * Pure; returns a reason so a suppressed notice can be explained rather than just vanish.
     * @returns {{allowed: boolean, reason: string}}
     */
    function noticeAllowed(input) {
      var settings = input && input.settings ? input.settings : {};
      var sessionId = input && typeof input.sessionId === "string" ? input.sessionId : "";
      var muted = settings.noticeMutedSessions;
      if (sessionId !== "" && Array.isArray(muted)) {
        for (var i = 0; i < muted.length; i++) {
          if (sameSessionId(muted[i], sessionId)) return { allowed: false, reason: "muted" };
        }
      }
      var only = typeof settings.noticeOnlySession === "string" ? settings.noticeOnlySession : "";
      if (only !== "") {
        if (sessionId === "") return { allowed: false, reason: "only-session-unknown" };
        if (!sameSessionId(only, sessionId)) return { allowed: false, reason: "not-the-chosen-session" };
      }
      return { allowed: true, reason: "ok" };
    }

    /** Raise a native notification; false means "fall back to the in-page bubble". */
    function raiseNotice(text) {
      // 通道关掉 = 不弹系统通知。气泡那一半仍由 showNotice 画：那是"我们自己要说的话"。
      if (!featureEnabled("featureNotice")) return false;
      var plan;
      try {
        plan = notifyPlan({
          enabled: readSettings().focusNativeNotice !== false,
          supported: typeof window === "object" && window !== null && typeof window.Notification === "function",
          permission: typeof window === "object" && window !== null && window.Notification && typeof window.Notification.permission === "string" ? window.Notification.permission : "denied"
        });
      } catch (e) { plan = { native: false, inPage: true }; }
      if (!plan.native) return false;
      try {
        new window.Notification("DeepSeek Harness", { body: String(text == null ? "" : text) });
        return true;
      } catch (e) {
        // e.g. a permission prompt that cannot complete synchronously — the bubble covers it.
        return false;
      }
    }

    /**
     * The visible session's id, or undefined — read through the apply-scope seam.
     *
     * `showNotice` lives in the FACTORY scope while the real `activeSessionId()` lives inside
     * `apply`, so calling it by name here is a `ReferenceError` — and the surrounding catch
     * turned that into "the scope filter never ran at all": a muted session still got notified
     * and still got a bubble. It now goes through the same seam the factory-scope components
     * use. No reader, or a throwing one, means "unknown session" — never "silence".
     */
    function noticeScopeSessionId() {
      try {
        return typeof testHooks.activeSessionId === "function" ? testHooks.activeSessionId() : undefined;
      } catch (e) {
        return undefined;
      }
    }

    /**
     * Show a notice.
     *
     * Two channels exist. The in-page bubble is the guaranteed one; the system notification
     * rides along (macOS can deny or silence it, and "the constructor did not throw" is not
     * evidence the user saw anything).
     *
     * ⚠️ **专注锁那一类优先走系统通道**（用户 2026-10-13 的决定）：`opts.systemOnly === true`
     * 时，只有系统通道**确实可用（permission === "granted"）且确实发出去**才不画气泡；否则**回退
     * 画气泡**（用户 2026-10-13 修订：系统通知发不出去时必须回退）。调用点在
     * `verify/verify_task10_notice_channel.mjs` 里逐个断言过；其余用途仍走「气泡 + 系统通知」双通道。
     *
     * @param {string} text
     * @param {{clientX?:number, clientY?:number}} ev **保留但不再用于定位**（气泡固定在顶部正中，
     *   由 CSS 居中）：调用点仍在传真事件对象或 `{clientX, clientY}` 桩，删参数/改调用点是更大的
     *   改动面；这里只把它从定位里摘掉。
     * @param {{systemOnly?:boolean}} [opts] 专注锁那一类传 `{ systemOnly: true }`
     * @returns {{channel:"system"|"bubble"|"system+bubble"|"suppressed", native:boolean}}
     *   `native` 是 raiseNotice 的**返回值**（真的构造了 Notification 才是 true），套件靠它断言
     *   「系统通道确实被走了一次」，而不是「没抛错」；`channel` 如实反映**实际**通道。
     */
    function showNotice(text, ev, opts) {
      if (typeof document === "undefined") return { channel: "suppressed", native: false };
      var systemOnly = !!(opts && opts.systemOnly === true);
      // ── 「通知与气泡」总开关（2026-10-15）─────────────────────────────────────
      // ⚠️ 它是"用户可关的通道"，不是"可以关掉的报警器"。设计稿 §4.3 的例外必须在这里
      // 落地：否则关掉通知 = 把插件自己的错误通道一起关掉（写设置失败 / 启动贡献失败 /
      // 专注锁系统通道发不出去时的回退），与"失败必须可见"直接冲突。
      //   · opts.always === true      —— 明确标注"这是系统自身错误"的调用点
      //   · opts.systemOnly === true  —— 专注锁那一类（拦截必须可见）
      if (!featureEnabled("featureNotice") && !(opts && opts.always === true) && systemOnly !== true) {
        return { channel: "suppressed", native: false };
      }
      // Scope filter FIRST, applied to BOTH channels: a muted session must not draw a bubble
      // and must not be sent a notification either. It may never move below a draw or a send.
      try {
        if (!noticeAllowed({ settings: readSettings(), sessionId: noticeScopeSessionId() }).allowed) {
          return { channel: "suppressed", native: false };
        }
      } catch (e) { /* a broken filter must not swallow the message: fall through and show it */ }
      // Can the system channel actually deliver? Anything other than an explicit "granted"
      // — a missing Notification API, or the still-prompting "default" — is treated as "not
      // reliable", so a systemOnly notice then falls back to the bubble instead of vanishing.
      var systemUsable = false;
      try {
        systemUsable = typeof window === "object" && window !== null
          && typeof window.Notification === "function"
          && window.Notification.permission === "granted";
      } catch (e) { systemUsable = false; }
      var native = raiseNotice(text);
      // 专注锁：系统通道**确实可用且确实发出去了**才不画气泡；否则回退气泡（用户 2026-10-13
      // 修订：「系统通知发不出去时必须回退画气泡」—— 失败必须可见，绝不静默）。
      if (systemOnly && systemUsable && native === true) return { channel: "system", native: true };
      closeNotice();
      noticeEl = document.createElement("div");
      noticeEl.setAttribute("data-history-actions-notice", "");
      // 顶部正中（用户 2026-10-13）：**只用 CSS 居中** —— `left:50%` + `translateX(-50%)`。
      // 以前按点击坐标定位（`ev.clientX`/`ev.clientY`），两个毛病：① 气泡跟着点击位置跑，同一个
      // 提示出现在屏幕各处；② 位置要靠 `window.innerWidth` 算像素，resize 后再算就错位。
      // 改成 CSS 后**布局全交给浏览器**：居中与缩放都不用我们再算像素。
      // ⚠️ 定位**绝不**能用 `window.innerWidth`（取值来自一次布局，resize 后即过期）。
      // 任务 15（用户 2026-10-13）：限宽收回成**紧凑卡片** —— `max-width:min(420px, calc(100vw - 32px))`。
      // 以前是 `max-width:calc(100vw - 32px)` + `width:fit-content`：只要文案够长，气泡就摊到接近满屏
      // （用户："样式又没了"）。`min()` 让它在**窄窗口**仍按视口留 32px 边距（响应式那一半保留），
      // 但正常窗口下**封顶 420px**、超长文案**分多行**，不再横向摊开。
      // 配色（同一次任务）：底色换成与标题栏拉开层级的中性灰面（`--dsw-alias-bg-module-platform`：
      // 浅色 #f9fafb / 深色 #353638，而页面底色是 #fff / #151517）；描边是**恰好 1px** 的彩色边，
      // 颜色由 `--dsw-alias-link` 与 white 混合派生 ⇒ 两套主题下都比原蓝**浅一档**（浅色 #5e8bea、
      // 深色 #8eb7ff），又不会淡到看不见。文字色仍是 label 类 token，对比度不降（18.1:1 / 11.6:1）。
      noticeEl.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483000;width:fit-content;max-width:min(420px, calc(100vw - 32px));background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-link) 85%, white);border-radius:8px;box-shadow:var(--dsw-elevation-panel);padding:8px 10px;font-size:12px;line-height:18px;";
      noticeEl.textContent = text;
      document.body.appendChild(noticeEl);
      noticeTimer = setTimeout(closeNotice, 6000);
      // `channel` reports what ACTUALLY happened: a systemOnly notice that fell back drew only
      // the bubble; the default path always attempts both and says so.
      return { channel: (systemOnly && native !== true) ? "bubble" : "system+bubble", native: native };
    }

    // Walk up from a DOM node to the nearest ancestor carrying `attribute`
    // (optionally equal to `value`). Both document-level listeners share it.
    function closestByAttribute(node, attribute, value) {
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.hasAttribute && node.hasAttribute(attribute)) {
          if (value === undefined || node.getAttribute(attribute) === value) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    // A session-reference chip inside a SENT message is a plain `<span>`: the
    // primitive that renders it (`projectUserText` in ui-primitives) only wires
    // `open` for file and skill chips, so `data-ref-chip="session"` never gets a
    // click handler. The chip keeps its label in `title`, and the referenced id
    // is recovered from the turn's session-reference context node.
    /**
     * Refuse a sidebar click that the focus lock forbids.
     *
     * Capture phase, and deliberately narrow: only a row that is BLOCKED is touched. The
     * locked target, every other control, and every read-only affordance pass through
     * untouched — "do not hurt the usable area" is the whole reason this is a row check and
     * not a blanket "block navigation".
     */
    function installFocusClicks(options) {
      if (typeof document === "undefined" || typeof document.addEventListener !== "function") return function () {};
      function onFocusClick(ev) {
        var state = null;
        try { state = options.readState(); } catch (e) { return; }
        if (state === null || state.locked !== true) return;
        var node = ev.target;
        // DSH exposes three separate "switch to a session" entry points (measured in the
        // shipped client): the sidebar rows, the right sidebar's session list, and the
        // conversation header. Covering only the first left a way out.
        var row = null;
        try {
          row = node && typeof node.closest === "function"
            ? node.closest("[data-row-key], [data-sidebar-right-session], [data-conversation-session]")
            : null;
        } catch (e) { row = null; }
        if (row === null || typeof row.getAttribute !== "function") return;
        var key = row.getAttribute("data-row-key");
        if (key === null) {
          var right = row.getAttribute("data-sidebar-right-session");
          if (right !== null && right !== "") key = "session:" + right;
        }
        if (key === null) {
          var head = row.getAttribute("data-conversation-session");
          if (head !== null && head !== "") key = "session:" + head;
        }
        // A WORKSPACE lock judges a row by the workspace it belongs to, not by its own session
        // id — that is what "only this workspace stays usable" means. focusVerdict already
        // understands `workspace:` keys (the suite covers it), so only the key needs rewriting.
        if (state !== null && state.kind === "workspace" && typeof row.closest === "function") {
          var wsRow = null;
          try { wsRow = row.closest('[data-row-key^="workspace:"]'); } catch (e) { wsRow = null; }
          if (wsRow !== null && typeof wsRow.getAttribute === "function") {
            var wsKey = wsRow.getAttribute("data-row-key");
            if (typeof wsKey === "string" && wsKey.indexOf("workspace:") === 0) key = wsKey;
          }
        }
        var target = focusRowTarget(key);
        if (target === null) return;
        var here = null;
        try { here = options.current(); } catch (e) { return; }
        var verdict = focusVerdict(state, here, target, Date.now());
        if (!verdict.blocked) return;
        ev.preventDefault();
        ev.stopPropagation();
        options.notify(verdict.reason);
      }
      document.addEventListener("click", onFocusClick, true);
      return function () { document.removeEventListener("click", onFocusClick, true); };
    }

    function installReferenceClicks(options) {
      if (typeof document === "undefined") return function () {};
      var resolveSessionId = options.resolveSessionId;
      var openSession = options.openSession;
      var activeSessionId = options.activeSessionId;
      var copy = options.copy;
      var styleEl = null;
      if (document.head && typeof document.head.appendChild === "function") {
        styleEl = document.createElement("style");
        styleEl.textContent = '[data-ref-chip="session"]{cursor:pointer}';
        document.head.appendChild(styleEl);
      }
      function onClick(ev) {
        // 「引用」总开关：关掉后，引用芯片与"跳到出处"这一类不再响应。
        // 取舍（写明）：这一条同时关掉了旧锚点芯片的"跳到那一轮"；引用功能整体关闭时，
        // 它服务的正是被关掉的那批记录，所以按功能族一起关是刻意的。
        if (!featureEnabled("featureQuote")) return;
        // A turn chip renders as a FILE chip (it is not a known session), so intercept it
        // here — capture phase — before the file opener is invoked with a bogus name.
        var anyChip = closestByAttribute(ev.target, "data-ref-chip", undefined);
        if (anyChip !== null) {
          var chipText = String((anyChip.textContent || "")).trim();
          var chipTurn = parseTurnChip(chipText);
          if (chipTurn !== null) {
            ev.preventDefault();
            ev.stopPropagation();
            var record = (typeof options.quoteForTurn === "function" ? options.quoteForTurn(chipTurn) : null);
            if (!jumpToQuote(chipTurn, record === null ? "" : record.quote, record === null ? null : record.anchor, options.t)) {
              showNotice(copy.notFound, ev);
            }
            return;
          }
        }
        var chip = closestByAttribute(ev.target, "data-ref-chip", "session");
        if (chip === null) return;
        var raw = chip.getAttribute("title") || "";
        var sessionId = decodeSessionReferenceUri(raw);
        var turnNode = closestByAttribute(chip, "data-chat-turn", undefined);
        var rawTurn = turnNode === null ? null : turnNode.getAttribute("data-chat-turn");
        var turn = rawTurn === null || rawTurn === "" ? undefined : Number(rawTurn);
        if (sessionId === undefined) {
          // `turn` may be unknown: `data-chat-turn` only exists on nodes bound
          // to turn/step boundary coordinates, so the resolver scans the whole
          // loaded window as well.
          var label = raw.charAt(0) === "@" ? raw.slice(1) : raw;
          sessionId = resolveSessionId(turn === undefined || !Number.isSafeInteger(turn) ? undefined : turn, label);
        }
        if (typeof sessionId === "string" && sessionId !== "") {
          ev.preventDefault();
          ev.stopPropagation();
          openSession(sessionId);
          return;
        }
        // Never fail silently: a dead chip must say why.
        var reason = activeSessionId() === undefined ? copy.noSession : copy.notFound;
        var details = { turn: turn, title: raw, activeSessionId: activeSessionId(), reason: reason };
        if (typeof options.diagnostics === "function") {
          try {
            var counts = options.diagnostics();
            details.nodes = counts.nodes;
            details.references = counts.references;
          } catch (e) { /* diagnostics never break the handler */ }
        }
        try { console.warn("[dsh-deepworker] session-reference chip unresolved", details); } catch (e) {}
        showNotice(reason, ev);
      }
      document.addEventListener("click", onClick, true);
      return function () {
        document.removeEventListener("click", onClick, true);
    // ── 8. apply：把一切接到宿主上（每个贡献都经 guard 隔离）────────────────────
        closeNotice();
        if (styleEl !== null && typeof styleEl.remove === "function") styleEl.remove();
      };
    }

    function apply(ctx) {
      // One-time copy from the pre-rename storage namespace (0.1.0 used
      // dsh.xh-deepworker.*; 0.1.1 uses dsh.deepworker.*). A new key always wins,
      // and the old keys are kept as a rollback. A migration must never block boot.
      try {
        if (typeof localStorage !== "undefined") {
          var legacyPairs = [
            ["dsh.xh-deepworker.settings", "dsh.deepworker.settings"],
            ["dsh.xh-deepworker.terminalButtons.v1", "dsh.deepworker.terminalButtons.v1"],
            ["dsh.xh-deepworker.workspaces.v1", "dsh.deepworker.workspaces.v1"],
            ["dsh.xh-deepworker.notes", "dsh.deepworker.notes"],
            ["dsh.xh-deepworker.quotes", "dsh.deepworker.quotes"],
            ["dsh.xh-deepworker.focusLocal", "dsh.deepworker.focusLocal"]
          ];
          for (var legacyIndex = 0; legacyIndex < legacyPairs.length; legacyIndex++) {
            if (localStorage.getItem(legacyPairs[legacyIndex][1]) !== null) continue;
            var legacyValue = localStorage.getItem(legacyPairs[legacyIndex][0]);
            if (legacyValue !== null) localStorage.setItem(legacyPairs[legacyIndex][1], legacyValue);
          }
        }
      } catch (legacyError) { /* never block activation */ }
      // A plugin must never stop the app from booting. DSH reports "1 entry did not
      // activate" for ANY throw inside apply, so one bad slot registration would take
      // the whole Desktop app down. Contributions go through this proxy instead:
      // each is isolated, and whatever fails is recorded and shown to the user.
      var applyFailures = [];
      function safe(label, fn) {
        try {
          return fn();
        } catch (e) {
          var message = label + ": " + String((e && e.message) || e);
          if (applyFailures.indexOf(message) === -1) applyFailures.push(message);
          try { console.error("[dsh-deepworker] " + message); } catch (e2) { /* no console */ }
          return undefined;
        }
      }
      /**
       * 已注册贡献的台账：`featureKey → 计数`。
       *
       * 这是"引入 / 移除开关真的接线了"的**可核对**证据：某一档未引入时它的计数必须是 0
       * （`ctx.slots.inject` / `ctx.effect` / `ctx.shortcuts.register` 一次都没被调用），
       * 引入后 ≥1。`__test.hooks.featureRegistrations()` 把它交出去 —— 套件在**真 apply
       * 路径**上数，不是 grep 源码。
       */
      var featureRegistrations = {};
      function noteContribution(featureKey) {
        if (typeof featureKey !== "string" || featureKey === "") return;
        featureRegistrations[featureKey] = (featureRegistrations[featureKey] || 0) + 1;
      }
      var guard = {
        effect: function (fn, label) {
          return safe("effect " + String(label), function () { return ctx.effect(fn, label); });
        },
        /**
         * 只在 `featureKey` **已引入**时才装的副作用（监听器 / 定时器 / 全局样式）。
         *
         * ⚠️ 这就是设计稿里"引入 / 移除"与旧的"关掉但保留入口"的**唯一**区别：
         * `false` ⇒ `ctx.effect` 一次都不调用 ⇒ 监听器**根本没装**（不是装了就放过）。
         * 代价写明：apply 时求值 ⇒ 改完必须点「重新加载界面」才生效。
         */
        effectIf: function (featureKey, fn, label) {
          if (!featureEnabled(featureKey)) return undefined;
          noteContribution(featureKey);
          return guard.effect(fn, label);
        },
        slots: {
          inject: function (name, factory) {
            return safe("slot " + name, function () { return ctx.slots.inject(name, factory); });
          },
          /**
           * 只在 `featureKey` **已引入**时才注入的槽位。
           *
           * `false` ⇒ `ctx.slots.inject` 一次都不调用 ⇒ 宿主里**没有我们的条目** ——
           * 不是"渲染成灰的"，是**不存在**（入口整个消失，这正是设计稿要的语义）。
           */
          injectIf: function (featureKey, name, factory) {
            if (!featureEnabled(featureKey)) return undefined;
            noteContribution(featureKey);
            return guard.slots.inject(name, factory);
          },
          register: function (config, component) {
            return ctx.slots.register(config, component);
          }
        }
      };

      guard.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-deepworker: dictionaries");
      var t = ctx.locale.bind(NS);


      try {
        console.info("[dsh-deepworker] client " + BUILD + " loaded");
      } catch (e) {
        /* a console that rejects logging never breaks the plugin */
      }

      // The mounted turn components track the visible session, but the workspace
      // model's main reference is the authoritative "what is on screen" value.
      function activeSessionId() {
        try {
          var main = ctx.uiWorkspace && ctx.uiWorkspace.mainReference;
          if (main && typeof main.sessionId === "string" && main.sessionId !== "") return main.sessionId;
        } catch (e) {
          /* fall through to the mounted-component registry */
        }
        return typeof activeComposer.sessionId === "string" && activeComposer.sessionId !== "" ? activeComposer.sessionId : undefined;
      }
      // Hand the apply-scope reader to the FACTORY-scope `showNotice`: its notice-scope filter
      // calls this, and a bare `activeSessionId()` over there is a ReferenceError (the catch
      // used to swallow it, so the filter silently never ran — muted sessions still got notified).
      testHooks.activeSessionId = activeSessionId;
      /**
       * 当前会话的工作目录（cwd），读不到返回 ""。
       * 归属账优先（与专注锁同一权威）；未分组会话退回 session snapshot 的 cwd。
       */
      testHooks.imageUrl = function (sessionId, attachment) {
        try {
          if (!ctx.uiConversation || typeof ctx.uiConversation.imageUrl !== "function") return "";
          return ctx.uiConversation.imageUrl(sessionId, attachment);
        } catch (e) { return ""; }
      };
      testHooks.peekImageUrl = function (sessionId, attachment) {
        try {
          if (!ctx.uiConversation || typeof ctx.uiConversation.peekImageUrl !== "function") return "";
          return ctx.uiConversation.peekImageUrl(sessionId, attachment) || "";
        } catch (e) { return ""; }
      };
      testHooks.peekImageUrl = function (sessionId, attachment) {
        try {
          if (!ctx.uiConversation || typeof ctx.uiConversation.peekImageUrl !== "function") return "";
          return ctx.uiConversation.peekImageUrl(sessionId, attachment) || "";
        } catch (e) { return ""; }
      };
      testHooks.currentCwd = function () {
        try {
          var id = activeSessionId();
          if (typeof id !== "string" || id === "") return "";
          var path = "";
          try { path = focusWrapWorkspacePathOf(id); } catch (e) { path = ""; }
          if (typeof path === "string" && path !== "") return path;
          try {
            var binding = ctx.sessions && typeof ctx.sessions.binding === "function" ? ctx.sessions.binding(id) : null;
            var state = binding && binding.session && typeof binding.session.getSnapshot === "function" ? binding.session.getSnapshot() : null;
            var cwd = state && typeof state.cwd === "string" ? state.cwd : "";
            return cwd;
          } catch (e2) { return ""; }
        } catch (e3) { return ""; }
      };

      var termConfigFileHash = "";
      /** 从 workspaceFiles.read 的返回值里取文本（形状在不同版本里可能是 string / {content} / lines）。 */
      function termConfigFileText(value) {
        if (typeof value === "string") return value;
        if (value === null || typeof value !== "object") return "";
        var names = ["content", "text", "data", "body", "value", "lines"];
        for (var i = 0; i < names.length; i++) {
          var candidate = value[names[i]];
          if (typeof candidate === "string" && candidate !== "") return candidate;
          if (Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === "string") return candidate.join("\n");
        }
        return "";
      }
      function termConfigHash(text) {
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = (hash * 16777619) >>> 0; }
        return hash.toString(16);
      }
      /**
       * Read the workspace's agent-editable button config **once** (no timer).
       * The page decides when: on mount and on the explicit "立即读取" button.
       */
      function readTerminalConfigFile() {
        return new Promise(function (resolve) {
          try {
            var id = activeSessionId();
            var cwd = typeof testHooks.currentCwd === "function" ? testHooks.currentCwd() : "";
            if (typeof id !== "string" || id === "" || typeof cwd !== "string" || cwd === "") { resolve({ status: "no-cwd", count: 0, errors: [] }); return; }
            var api = ctx.remote && ctx.remote.workspaceFiles;
            if (!api || typeof api.read !== "function") { resolve({ status: "no-api", count: 0, errors: [] }); return; }
            api.read(id, TERM_CONFIG_FILE, { offset: 1, limit: 2000 }).then(function (result) {
              if (!result || result.ok !== true) { termConfigFileHash = ""; resolve({ status: "missing", count: 0, errors: [] }); return; }
              var text = termConfigFileText(result.value);
              if (text.trim() === "") { termConfigFileHash = ""; resolve({ status: "missing", count: 0, errors: [] }); return; }
              var hash = termConfigHash(text);
              if (hash === termConfigFileHash) { resolve({ status: "unchanged", count: wsReadAll().workspaces.length, errors: [] }); return; }
              var parsed = parseTerminalConfigFile(text);
              if (!parsed.ok) { termConfigFileHash = hash; resolve({ status: "invalid", count: 0, errors: parsed.errors }); return; }
              var written = wsWriteAll(parsed.store);
              if (!written.ok) { resolve({ status: "write-failed", count: 0, errors: [{ path: "file", field: "storage", message: String(written.error || "") }] }); return; }
              termConfigFileHash = hash;
              resolve({ status: "applied", count: parsed.store.workspaces.length, errors: [] });
            }, function () { termConfigFileHash = ""; resolve({ status: "missing", count: 0, errors: [] }); });
          } catch (e) {
            resolve({ status: "failed", count: 0, errors: [{ path: "file", field: "read", message: String((e && e.message) || e) }] });
          }
        });
      }
      testHooks.readTerminalConfigFile = readTerminalConfigFile;
      // 头部组件在**同一条 factory 作用域**里，本可以直接调；但按本仓既有的纪律，
      // 跨"注册边界"的能力一律走 testHooks 接缝（作用域越界是本机最贵的缺陷形状）。
      testHooks.runTerminalButton = null;
      /**
       * apply 时读到的"引入"快照 —— 设置页用它判断"这一档改了但还没生效"，从而在那一行
       * 下面显示一句「改动需点顶部重新加载」的文字提示（2026-10-17 起**不再**是内联按钮：
       * 全页只留顶部那一颗重载）。注册发生在 apply 里，所以这张快照就是**活着的**
       * 那一版功能集合；存储后来变了也不影响它。
       */
      var introducedAtApply = {};
      for (var iIntro = 0; iIntro < FEATURE_KEYS.length; iIntro++) introducedAtApply[FEATURE_KEYS[iIntro]] = featureEnabled(FEATURE_KEYS[iIntro]);
      testHooks.introducedAtApply = function () {
        var out = {};
        for (var i = 0; i < FEATURE_KEYS.length; i++) out[FEATURE_KEYS[i]] = introducedAtApply[FEATURE_KEYS[i]];
        return out;
      };
      /** 注册台账的只读副本（"开关真接线了"的证据来源）。 */
      testHooks.featureRegistrations = function () {
        var out = {};
        for (var k in featureRegistrations) {
          if (Object.prototype.hasOwnProperty.call(featureRegistrations, k)) out[k] = featureRegistrations[k];
        }
        return out;
      };

      /**
       * Ask the agent to lock or unlock.
       *
       * The client cannot write the lock file, so its only channel is the composer: put a
       * fixed request in the draft and let the user press Enter. That also keeps the cooldown
       * honest — the agent runs the same CLI, so the cooldown binds it too.
       */
      function requestFocus(action, kind) {
        var text = focusRequestText(action, kind, 30);
        var actions = activeComposer && activeComposer.actions;
        if (!actions || insertQuoteIntoDraft(actions, text + "\n") === "failed") {
          showNotice(t("quote.noComposer"), { clientX: 24, clientY: 80, systemOnly: true });
          return;
        }
        showNotice(t("focus.requested") + " " + text, { clientX: 24, clientY: 80, systemOnly: true });
      }

      /**
       * Bind the current session so a jump can find WHAT was quoted in a turn.
       * Declared here, immediately after `activeSessionId()`: the two menu/click effects
       * below take it as an option, and a factory-scope caller cannot see apply's scope.
       */
      var quoteForTurn = function (turn) { return findQuoteRecord(activeSessionId(), turn); };

      /** The newest focus-lock marker in this session's transcript, or null. */
      /**
       * The lock state as the CLIENT can actually see it.
       *
       * The transcript route is dead: DSH renders tool output as collapsed cards, so the
       * marker text never reaches the DOM (measured: `标记在body=false`, body only 21k chars).
       * What works is the workspace-file remote — `workspaceFiles.read(sessionId, path)`
       * returns the file's CONTENT, and the CLI writes the same lock JSON there. No DOM, no
       * transcript, no rendering involved.
       *
       * Async, so it feeds a cache; the click interceptor must decide synchronously.
       */
      var focusFileCache = null;
      var FOCUS_FILE = ".dsh-focus-lock.json";
      function refreshFocusFile() {
        try {
          var id = activeSessionId();
          var api = ctx.remote && ctx.remote.workspaceFiles;
          if (typeof id !== "string" || id === "" || !api || typeof api.read !== "function") return;
          // range is REQUIRED: "workspaceFiles/read expected 3 business argument(s) ... got 2".
          api.read(id, FOCUS_FILE, { offset: 1, limit: 100 }).then(function (result) {
            // A failed read means "no lock file" at least as often as it means "transient
            // error", and the design rule is that a way out must always exist. Keeping the
            // previous cache here meant UNLOCKING did nothing in the UI: the file was gone,
            // the read failed, and the stale "locked" state blocked navigation forever.
            if (!result || result.ok !== true) { focusFileCache = { locked: false }; paintLockedSessions(); return; }
            var value = result.value;
            var text = "";
            if (typeof value === "string") text = value;
            else if (value !== null && typeof value === "object") {
              var names = ["content", "text", "data", "body", "value", "lines"];
              for (var i = 0; i < names.length; i++) {
                var candidate = value[names[i]];
                if (typeof candidate === "string" && candidate !== "") { text = candidate; break; }
                if (Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === "string") { text = candidate.join("\n"); break; }
              }
            }
            if (typeof text !== "string" || text === "") return;
            focusFileCache = parseFocusLockFile(text);
            paintLockedSessions();
          }).catch(function () { /* keep the previous cache */ });
        } catch (e) { /* keep the previous cache */ }
      }

      /**
       * Mark the sessions the lock has closed, so "I can only use this one" is VISIBLE.
       *
       * The user's words: "锁住其他会话，只能在当前会话使用" — the blocked ones must look blocked,
       * not merely fail to respond when clicked. Idempotent and reversible: it runs on the same
       * 2s poll, so a React re-render does not leave stale marks behind, and unlocking clears
       * every mark on the next tick.
       */
      /**
       * A CLIENT-ONLY lock, persisted in localStorage.
       *
       * The user asked for "click → set the duration → locked directly, without turning it into
       * a message that pollutes the conversation". Measured: `workspaceFiles` exposes only
       * read-side methods (changes/inspect/list/locateFile/read/readBytes/relativePath/stat), so
       * a client plugin cannot write host state at all. localStorage is the one place it can
       * persist — which keeps the UI lock instant and message-free. The trade-off is explicit:
       * the HOST-side refusal is not armed by this path (only the UI is).
       */
      var FOCUS_LOCAL_KEY = "dsh.deepworker.focusLocal";
      function readLocalLock() {
        try {
          var raw = localStorage.getItem(FOCUS_LOCAL_KEY);
          if (typeof raw !== "string" || raw === "") return null;
          return parseFocusLockFile(raw);
        } catch (e) { return null; }
      }
      function writeLocalLock(state) {
        try {
          if (state === null) { localStorage.removeItem(FOCUS_LOCAL_KEY); return true; }
          localStorage.setItem(FOCUS_LOCAL_KEY, JSON.stringify(state));
          return true;
        } catch (e) { return false; }
      }
      /** The state the UI should obey: the host-written file wins, then the local lock. */
      function effectiveFocusState() {
        if (focusFileCache !== null && focusFileCache.locked === true) return focusFileCache;
        var local = readLocalLock();
        if (local !== null && local.locked === true && local.untilMs > Date.now()) return local;
        return focusFileCache !== null ? focusFileCache : (local || null);
      }
      /** Lock THIS session for N minutes, with no message. */
      function lockFocusLocally(minutes, scope) {
        var id = activeSessionId();
        if (typeof id !== "string" || id === "") return false;
        var kind = "session";
        var target = id;
        if (scope === "workspace") {
          // 会话 → 工作区的映射**只认归属账**（`sessionIds`）。旧的 DOM 爬法（找 workspace:
          // 祖先行）在真机上永远失败 —— 侧栏是平铺渲染，会话行根本没有工作区祖先
          // （AGENTS.md「侧栏是【平铺】渲染」）。找不到就退回会话锁，并由调用方**说出来**
          // （focus.scopeFallback），绝不静默降级。
          var wsp = "";
          try { wsp = focusWrapWorkspacePathOf(id); } catch (e) { wsp = ""; }
          if (typeof wsp === "string" && wsp !== "") { kind = "workspace"; target = wsp; }
        }
        var wrote = writeLocalLock({
          enabled: true, kind: kind, targetId: target,
          lockedAtMs: Date.now(), untilMs: Date.now() + Math.max(1, minutes) * 60000,
          cooldownMs: 0, unlocks: []
        });
        // 重新武装拦截。一次「解除专注」会把包装全部还原（armed 随之复位），而 arm 只在
        // apply 时被调用过一次 —— 不在这里补一次，「关掉再打开」之后就**拦不住**别的会话，
        // 且不报错、不提示（真机 bug，2026-10-15 修）。arm 幂等，且整体 try/catch：
        // 包装装不上只影响拦截，绝不影响加锁本身。
        if (wrote === true) {
          try { focusWrapArm(ctx); } catch (e) { /* ignore */ }
        }
        return wrote;
      }
      var focusExpiryTimer = null;
      /**
       * Say "the focus lock has ended" AT THE MOMENT IT ENDS.
       *
       * A notification can only be raised when it is created, so a live timer is the only way to
       * announce an expiry. It dies with the window — the measured constraint: once the app is
       * gone, no client code runs. Hence the same arming is repeated from stored state on start.
       */
      function armFocusExpiry(state) {
        try {
          if (focusExpiryTimer !== null) { clearTimeout(focusExpiryTimer); focusExpiryTimer = null; }
          if (state === null || state.locked !== true) return;
          var left = state.untilMs - Date.now();
          if (!(left > 0)) return;
          if (left > 2147483000) return;
          focusExpiryTimer = setTimeout(function () {
            focusExpiryTimer = null;
            try { writeLocalLock(null); } catch (e) { /* ignore */ }
            try { focusWrapUnwrapAll(); } catch (e2) { /* ignore */ }
            paintLockedSessions();
            showNotice(t("focus.expired"), { clientX: 24, clientY: 80, systemOnly: true });
          }, left);
        } catch (e) { /* a timer must never break the app */ }
      }

      function unlockFocusLocally() {
        var state = readLocalLock();
        if (state === null) return true;
        return writeLocalLock({
          enabled: false, kind: state.kind, targetId: state.targetId,
          lockedAtMs: Date.now(), untilMs: Date.now(), cooldownMs: 0,
          unlocks: (Array.isArray(state.unlocks) ? state.unlocks : []).concat([{ atMs: Date.now(), wentTo: "local-ui" }]).slice(-50)
        });
      }

      /**
       * 现在生效的锁：**已过期的不算**（读一处，三处用：侧栏计时、头部标签、掩层）。
       *
       * ⚠️ `ctx.uiWorkspace` 是 cordis 的可追踪 Proxy ⇒ 一切读取都包 try/catch，读不懂当没锁。
       */
      function focusLockTarget() {
        try {
          var eff = effectiveFocusState();
          if (eff === null || typeof eff !== 'object') return null;
          if (eff.locked !== true) return null;
          if (!(eff.untilMs > Date.now())) return null;
          return eff;
        } catch (e) { return null; }
      }

      /**
       * 锁的目标工作区（`kind === "workspace"` 时），读不到返回 null。
       *
       * 锁的 `targetId` 口径 = 工作区的**规范 path**（docs/session-lock-surface.md §6.1；
       * 宿主 decide() 就是当路径比的）⇒ 这里只做**恰好相等**的比较，**绝不用前缀**
       * （父子目录可以是两个不同工作区，前缀匹配 = 锁错）。
       * 用途：① 掩层要知道哪个工作区该保持正常；② 侧栏计时要知道写哪个工作区名。
       */
      function focusLockWorkspaceItem(lock) {
        try {
          if (lock === null || lock.kind !== 'workspace') return null;
          var items = focusWrapWorkspaceItems();
          for (var i = 0; i < items.length; i++) {
            if (items[i] && typeof items[i].path === 'string' && items[i].path === lock.targetId) return items[i];
          }
          return null;
        } catch (e) { return null; }
      }

      /**
       * **当前会话**是不是落在「锁的放行侧」？
       *
       * 这是头部标签／倒计时的判据，也是「未分组会话在 workspace 锁下必须放行」这条规则的
       * 单一实现（docs/session-lock-surface.md §6.3：子代理会话从不 attach，一律拦会锁住
       * 用户看自己的子代理轨迹 ⇒ 它们必须算「不在这里」，既不放行也不上灰）。
       *
       *   会话锁      ⇒ targetId 就是会话 id，恰好相等才算
       *   工作区锁    ⇒ 取当前会话的**归属账** path，与锁的 targetId 恰好相等才算
       *                 （未分组 ⇒ 返回 "" ⇒ 这里判 false ⇒ 照旧放行）
       */
      function focusLockHoldsHere() {
        try {
          var lock = focusLockTarget();
          if (lock === null) return false;
          var active = activeSessionId();
          if (typeof active !== 'string' || active === '') return false;
          if (lock.kind !== 'workspace') return sameSessionId(active, lock.targetId);
          var mine = focusWrapWorkspacePathOf(active);
          if (typeof mine !== 'string' || mine === '') return false;
          return mine === lock.targetId;
        } catch (e) { return false; }
      }

      /**
       * 掩层：给**非目标**的行上灰（用户：「非专注工作区没有掩层区分」）。
       *
       * 只返回「该暗」的那部分 —— 目标工作区 / 目标会话 / **未分组会话**一律不进来。
       * 判据顺序刻意是「先工作区、后会话」：
       *   workspace 锁 ⇒ 先在**工作区行**上按 path 恰好相等筛，再在会话行上按**归属账**筛；
       *   会话锁     ⇒ 只上会话行（工作区行不上灰，因为锁的粒度就是会话）。
       */
      var FOCUS_DIM_ATTR = "data-ha-focus-dim";
      function focusDimMarks(items, lock, activeId) {
        var marks = [];
        var workspace = lock.kind === "workspace";
        // 目标工作区的 path：优先用能读到的 items 条目；读不到就退回锁自带的 targetId
        // （口径本来就是规范 path）。两者都拿不到才放弃。
        var targetWs = focusLockWorkspaceItem(lock);
        var targetPath = "";
        if (workspace) {
          if (targetWs !== null && typeof targetWs.path === "string" && targetWs.path !== "") targetPath = targetWs.path;
          else if (typeof lock.targetId === "string" && lock.targetId !== "") targetPath = lock.targetId;
          if (targetPath === "") return marks;              // 目标都读不到 ⇒ 什么都不暗（宁可漏暗，不可错暗）
        }
        var owned = {};
        if (workspace && targetWs !== null && Array.isArray(targetWs.sessionIds)) {
          for (var k = 0; k < targetWs.sessionIds.length; k++) {
            try { owned[focusWrapSessionId(targetWs.sessionIds[k])] = true; } catch (e) { /* ignore */ }
          }
        }
        for (var i = 0; i < items.length; i++) {
          var row = items[i];
          if (row === null || typeof row.getAttribute !== "function") continue;
          var key = "";
          try { key = row.getAttribute("data-row-key") || ""; } catch (e) { key = ""; }
          if (key.indexOf("workspace:") === 0) {
            if (!workspace) continue;                       // 会话锁不动工作区行
            var wid = key.slice("workspace:".length);
            if (wid === "") continue;                       // 未分组桶：放行
            var path = "";
            try {
              var foundId = null;
              for (var w = 0; w < focusWrapWorkspaceItems().length; w++) {
                var it = focusWrapWorkspaceItems()[w];
                if (it && it.workspaceId === wid) { foundId = it; break; }
              }
              path = foundId !== null && typeof foundId.path === "string" ? foundId.path : "";
            } catch (e) { path = ""; }
            if (path === "" || path === targetPath) continue;   // 读不到 / 就是目标 ⇒ 不上灰
            marks.push({ row: row, attr: FOCUS_DIM_ATTR, value: "workspace", opacity: "0.4", blur: true });
            continue;
          }
          if (key.indexOf("session:") !== 0) continue;
          var sid = key.slice("session:".length);
          if (workspace) {
            var mine = "";
            try { mine = focusWrapWorkspacePathOf(sid); } catch (e) { mine = ""; }
            // 未分组（含子代理）⇒ 放行，不上灰。
            if (mine === "" || mine === targetPath) continue;
            marks.push({ row: row, attr: FOCUS_DIM_ATTR, value: "session", opacity: "0.45", blur: false });
          } else {
            try { if (sameSessionId(sid, activeId)) continue; } catch (e) { continue; }
            marks.push({ row: row, attr: FOCUS_DIM_ATTR, value: "session", opacity: "0.45", blur: false });
          }
        }
        return marks;
      }

      function paintLockedSessions() {
        try {
          if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
          var lock = featureEnabled("featureFocusLock") ? focusLockTarget() : null;
          // 工作区锁 + 会话锁都要掩层；会话锁还需要「当前会话」来判断哪一行是目标。
          var active = lock !== null ? activeSessionId() : "";
          var marks = lock === null ? [] : focusDimMarks(document.querySelectorAll("[data-row-key]"), lock, active);
          var want = [];
          for (var m = 0; m < marks.length; m++) want.push(marks[m].row);
          // 清掉上一 tick 的掩层：**每 tick 全量重算**，解锁/过期后不可能有残留。
          var painted = [];
          try {
            var marked = document.querySelectorAll("[" + FOCUS_DIM_ATTR + "]");
            for (var d = 0; d < marked.length; d++) painted.push(marked[d]);
          } catch (e) { painted = []; }
          for (var p = 0; p < painted.length; p++) {
            var stale = painted[p];
            if (want.indexOf(stale) !== -1) continue;
            try {
              stale.removeAttribute(FOCUS_DIM_ATTR);
              stale.style.opacity = "";
              stale.style.filter = "";
              stale.title = "";
              stale.removeAttribute("data-ha-focus-locked");
            } catch (e) { /* 单行清不掉不影响其它行 */ }
          }
          for (var k = 0; k < marks.length; k++) {
            var mk = marks[k];
            try {
              mk.row.setAttribute(mk.attr, mk.value);
              mk.row.setAttribute("data-ha-focus-locked", "1");   // 与旧标记兼容（老断言/老读数）
              mk.row.style.opacity = mk.opacity;
              mk.row.style.filter = "grayscale(0.9)";
              mk.row.title = t("focus.rowLocked");
            } catch (e) { /* 单行画不上不影响其它行 */ }
          }
        } catch (e) { /* painting must never break the app */ }
      }

      function readFocusStateFromTranscript() {
        var root = conversationRoot();
        if (root !== null && typeof root.textContent === "string") {
          var fromRoot = parseFocusLockState(root.textContent);
          if (fromRoot !== null) return fromRoot;
        }
        // Fall back to the whole document. The conversation container's attribute name
        // (`data-conversation-scroll`) was MY GUESS; if it is wrong the lock reads nothing and
        // silently never fires. One lastIndexOf over the body cannot be defeated by a rename.
        try {
          if (typeof document !== "undefined" && document.body && typeof document.body.textContent === "string") {
            return parseFocusLockState(document.body.textContent);
          }
        } catch (e) { /* fall through */ }
        return null;
      }

      guard.effectIf("featureFocusLock", function () {
        // Poll instead of subscribing: `changes` is a stream and would need teardown care, and
        // 2s is far below the time it takes a human to click another session.
        // Defensive at the activation boundary: some environments (the test harness, minimal
        // hosts) have no timers at all. Polling is an optimisation, never a requirement — the
        // click interceptor and 刷新状态 both refresh on demand.
        // 「专注锁」关掉 ⇒ 不要那个 2 秒一次的轮询（它只服务专注锁，还能省掉每次一次
        // document.body.textContent 解析）。初始刷新保留：设置页要靠它读到状态。
        refreshFocusFile();
        if (typeof setInterval !== "function") return function () {};
        var timer = setInterval(refreshFocusFile, 2000);
        // 侧栏计时的秒级刷新在**组件自己**的 useEffect 里（每个挂载点一个 ticker，
        // 卸载即清）⇒ 这里只剩文件轮询，不再需要第二个计时器。
        return function () { if (typeof clearInterval === "function") clearInterval(timer); };
      }, "dsh-deepworker: focus state file");

      guard.effectIf("featureFocusLock", function () {
        return installFocusClicks({
          readState: function () {
            // Local/UI lock first (instant, message-free), then the host-written file, then the
            // transcript as a last-ditch fallback.
            var eff = effectiveFocusState();
            if (eff !== null) return eff;
            return readFocusStateFromTranscript();
          },
          current: function () { return { sessionId: activeSessionId() }; },
          notify: function (reason) { showNotice(reason, { clientX: 24, clientY: 80, systemOnly: true }); }
        });
      }, "dsh-deepworker: focus lock clicks");

      // The context menu owns both quote and quick-wiki. Quote entries are individually
      // gated by `quoteOn`; the quick-wiki entry must remain available when quote is off.
      guard.slots.inject("conversation.input.right", function () {
        return ctx.slots.register({
          name: "conversation.input.right",
          id: "history-actions-phrases",
          order: 30,
          locale: NS,
          label: function () { return t("phrase.button"); }
        }, PhraseAction);
      });
      guard.effect(function () {
        return installContextMenu(t, { activeSessionId: activeSessionId, quoteForTurn: quoteForTurn, beginRunningEdit: beginRunningEdit, quickExplain: quickExplainSelection });
      }, "dsh-deepworker: context menu");

      guard.effect(installDialogSizes, "dsh-deepworker: dialog sizes");
      guard.effectIf("featureFind", installFindStyles, "dsh-deepworker: find highlights");

      guard.effectIf("featureQuote", function () {
        return installReferenceClicks({
          quoteForTurn: quoteForTurn,
          t: t,
          resolveSessionId: function (turn, label) { return referencedSessionIdOf(activeSessionId(), turn, label); },
          openSession: function (targetSessionId) { ctx.uiWorkspace.openSession(targetSessionId); },
          activeSessionId: activeSessionId,
          diagnostics: function () { return referenceDiagnostics(activeSessionId()); },
          copy: {
            noSession: t("ref.noSession"),
            notFound: t("ref.notFound")
          }
        });
      }, "dsh-deepworker: session-reference clicks");

      function doFork(sessionId, atSeq) {
        return ctx.sessions.fork({ sessionId: sessionId, atSeq: atSeq }).then(function (childId) {
          ctx.uiWorkspace.openSession(childId);
          return childId;
        });
      }
      /**
       * Stop the turn that is currently running in this session.
       *
       * `session.cancel` is the Host's own "stop the active turn" call (the same one the
       * app's Esc Esc uses); it preserves pending inbox work. Without this, retry/resend
       * handed a fresh prompt to a session that was still working, so the original kept
       * running and the new message just JOINED ITS QUEUE — which is exactly what a user
       * reported seeing.
       * @returns {Promise<{ok: boolean, error?: string}>}
       */
      function cancelActiveTurn(sessionId) {
        if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve({ ok: false, error: "no session" });
        if (!ctx.remote || !ctx.remote.session || typeof ctx.remote.session.cancel !== "function") {
          // Say "unsupported" instead of throwing: the caller surfaces it either way, but a
          // thrown TypeError would read like a plugin bug rather than a missing Host call.
          return Promise.resolve({ ok: false, error: "session.cancel unavailable" });
        }
        return Promise.resolve()
          .then(function () { return ctx.remote.session.cancel({ sessionId: sessionId }); })
          .then(function (result) {
            if (result && result.ok === false) {
              return { ok: false, error: (result.error && result.error.message) || "cancel rejected" };
            }
            return { ok: true };
          }, function (e) {
            return { ok: false, error: String((e && e.message) || e) };
          });
      }

    function quickExplainSelection(selected) {
      var text = typeof selected === "string" ? selected.trim() : "";
      if (text === "") {
        showNotice(t("quote.empty"), { clientX: 24, clientY: 80 }, { always: true });
        return;
      }
      if (text.length > 6000) text = text.slice(0, 6000) + "\n…";
      try {
        var old = document.querySelector("[data-dw-quick-explain]");
        if (old && old.parentNode) old.parentNode.removeChild(old);
      } catch (e) { /* replace best effort */ }
      var pop = document.createElement("div");
      pop.setAttribute("data-dw-quick-explain", "");
      pop.style.cssText = "position:fixed;z-index:2147483000;width:min(360px,calc(100vw - 24px));max-height:min(420px,calc(100vh - 24px));overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 30px #0003;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;";
      var title = document.createElement("div");
      title.textContent = t("quickAsk.title");
      title.style.cssText = "font-size:13px;line-height:20px;font-weight:600;";
      var close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.title = t("term.wsCancel");
      close.style.cssText = "border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:18px;line-height:18px;cursor:pointer;padding:0 2px;";
      head.appendChild(title); head.appendChild(close);
      var preview = document.createElement("div");
      preview.textContent = text.length > 180 ? text.slice(0, 180) + "…" : text;
      preview.style.cssText = "color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:54px;overflow:auto;margin-bottom:8px;";
      var body = document.createElement("div");
      body.textContent = t("quickAsk.loading");
      body.style.cssText = "white-space:pre-wrap;color:var(--dsw-alias-label-primary);";
      var footer = document.createElement("div");
      footer.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:10px;";
      var save = document.createElement("button");
      save.type = "button";
      save.textContent = t("quickAsk.saveNote");
      save.disabled = true;
      save.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;";
      var create = document.createElement("button");
      create.type = "button";
      create.textContent = t("quickAsk.newSession");
      create.disabled = true;
      create.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;";
      footer.appendChild(save); footer.appendChild(create);
      pop.appendChild(head); pop.appendChild(preview); pop.appendChild(body); pop.appendChild(footer);
      document.body.appendChild(pop);
      function place() {
        try {
          var sel = window.getSelection();
          var rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
          if (rect) {
            var left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left));
            var top = rect.bottom + 8;
            if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - pop.offsetHeight - 8);
            pop.style.left = left + "px";
            pop.style.top = top + "px";
          } else {
            pop.style.left = "50%"; pop.style.top = "20%"; pop.style.transform = "translateX(-50%)";
          }
        } catch (e) { /* position optional */ }
      }
      place();
      function closePop() { if (pop.parentNode) pop.parentNode.removeChild(pop); }
      close.addEventListener("click", closePop);
      var answer = "";
      var controller = typeof window !== "undefined" && typeof window.AbortController === "function" ? new window.AbortController() : null;
      var timer = controller === null ? 0 : setTimeout(function () { controller.abort(); }, 60000);
      fetch("/dsh-deepworker/quick-explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller === null ? undefined : controller.signal,
        body: JSON.stringify({ text: text, question: "请解释这段内容。" })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (result) {
          if (!result.ok || !result.body || result.body.ok !== true) {
            throw new Error((result.body && result.body.error) || "request failed");
          }
          answer = String(result.body.answer || "").trim();
          if (answer === "") throw new Error(t("quickAsk.noAnswer"));
          body.textContent = answer;
          save.disabled = false; create.disabled = false;
          place();
        })
        .catch(function (e) {
          body.textContent = t("quickAsk.failed") + String((e && e.message) || e);
          place();
        }).then(function () { if (timer !== 0) clearTimeout(timer); });
      save.addEventListener("click", function () {
        if (answer === "") return;
        try {
          var note = "Q：" + text + "\n\nA：" + answer;
          var next = appendNote(readNotes(), note, ["随手百科"]);
          var written = writeNotes(next.list);
          if (!written || written.ok !== true) throw new Error((written && written.error) || "write failed");
          showNotice(t("quickAsk.saved"), { clientX: 24, clientY: 80 }, { always: true });
        } catch (e) {
          showNotice(t("notes.writeFailed") + " " + String((e && e.message) || e), { clientX: 24, clientY: 80 }, { always: true });
        }
      });
      create.addEventListener("click", function () {
        if (answer === "") return;
        create.disabled = true;
        var content = t("quickAsk.sessionInstruction") + "\n\n选中内容：\n" + text
          + "\n\n简短解释：\n" + answer + "\n\n我的指令：\n";
        // Let the workspace own new-session creation and draft preparation. `sessions.create()`
        // alone produces a session that is not attached to the main view; startSession runs the
        // same UI path as the New Session command and can seed the composer without a model call.
        try {
          if (!ctx.uiWorkspace || typeof ctx.uiWorkspace.startSession !== "function") {
            throw new Error("startSession unavailable");
          }
          ctx.uiWorkspace.startSession(undefined, { prompt: content, clearPreviousDraft: true });
          closePop();
        } catch (e) {
          create.disabled = false;
          showNotice(t("quickAsk.newSessionFailed") + String((e && e.message) || e), { clientX: 24, clientY: 80 }, { always: true });
        }
      });
    }

    var PHRASES_KEY = "dsh.deepworker.phrases";

    function readPhrases() {
      try {
        var raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PHRASES_KEY);
        var parsed = raw === null ? null : JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(function (item) {
          return item && typeof item === "object" && typeof item.text === "string" && item.text !== "";
        }).slice(0, 20);
      } catch (e) { return []; }
    }
    function writePhrases(list) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(PHRASES_KEY, JSON.stringify(list.slice(0, 20)));
      } catch (e) { /* storage failure is visible through the missing entry */ }
    }

    function PhraseAction(props) {
      var t = typeof props.t === "function" ? props.t : function (key) { return key; };
      var state = (0, react.useState)(false);
      var open = state[0];
      var setOpen = state[1];
      var manageState = (0, react.useState)(false);
      var manage = manageState[0];
      var setManage = manageState[1];
      var itemsState = (0, react.useState)(readPhrases);
      var items = itemsState[0];
      var setItems = itemsState[1];
      function savePhrases(next) { setItems(next); writePhrases(next); }
      function addPhrase() {
        savePhrases(items.concat([{ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: "", text: "" }]));
      }
      function patchPhrase(id, key, value) {
        savePhrases(items.map(function (item) { return item.id === id ? Object.assign({}, item, { [key]: value }) : item; }));
      }
      function removePhrase(id) { savePhrases(items.filter(function (item) { return item.id !== id; })); }
      function insertPhrase(text) {
        var ok = typeof testHooks.insertPhrase === "function" ? testHooks.insertPhrase(text) : false;
        if (!ok) {
          if (typeof testHooks.showNotice === "function") testHooks.showNotice(t("phrase.insertFailed"), { clientX: 24, clientY: 80 }, { always: true });
          return;
        }
        setOpen(false);
      }
      var inputStyle = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-primary)", background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", padding: "4px 6px" };
      return (0, react_jsx_runtime.jsxs)("div", {
        style: { position: "relative", display: "inline-flex" },
        children: [
          (0, react_jsx_runtime.jsx)("button", {
            type: "button",
            title: t("phrase.manage"),
            onClick: function () { setOpen(!open); },
            style: { border: 0, background: "transparent", color: "var(--dsw-alias-label-secondary)", font: "inherit", fontSize: "12px", lineHeight: "18px", padding: "4px 6px", borderRadius: "6px", cursor: "pointer" },
            children: t("phrase.button")
          }),
          open ? (0, react_jsx_runtime.jsxs)("div", {
            style: { position: "absolute", zIndex: 30, right: 0, bottom: "calc(100% + 8px)", width: "340px", maxHeight: "360px", overflow: "auto", padding: "8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", boxShadow: "var(--dsw-elevation-panel)" },
            children: [
              manage ? null : (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", flexDirection: "column", gap: "4px" },
                children: [
                  items.length === 0 ? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: "18px", padding: "4px" }, children: t("phrase.empty") }) : items.map(function (item) {
                    return (0, react_jsx_runtime.jsx)("button", {
                      type: "button",
                      onClick: function () { insertPhrase(item.text); },
                      style: { textAlign: "left", border: 0, borderRadius: "6px", background: "transparent", color: "var(--dsw-alias-label-primary)", font: "inherit", fontSize: "12px", lineHeight: "18px", padding: "5px 6px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
                      title: item.text,
                      children: item.label || item.text
                    }, item.id);
                  })
                ]
              }),
              manage ? (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", flexDirection: "column", gap: "6px" },
                children: [
                  items.length === 0 ? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: "18px" }, children: t("phrase.empty") }) : items.map(function (item) {
                    return (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", flexDirection: "column", gap: "3px", borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "5px" },
                      children: [
                        (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "4px" }, children: [
                          (0, react_jsx_runtime.jsx)("input", { value: item.label, placeholder: t("phrase.label"), onChange: function (e) { patchPhrase(item.id, "label", e.target.value); }, style: inputStyle }),
                          (0, react_jsx_runtime.jsx)("button", { type: "button", title: t("phrase.delete"), onClick: function () { removePhrase(item.id); }, style: { border: 0, background: "transparent", color: "var(--dsw-alias-label-tertiary)", cursor: "pointer", fontSize: "14px" }, children: "×" })
                        ] }),
                        (0, react_jsx_runtime.jsx)("textarea", { value: item.text, placeholder: t("phrase.text"), rows: 2, onChange: function (e) { patchPhrase(item.id, "text", e.target.value); }, style: Object.assign({}, inputStyle, { resize: "vertical", minHeight: "42px" }) })
                      ]
                    }, item.id);
                  }),
                  (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", gap: "6px", marginTop: "4px" }, children: [
                    (0, react_jsx_runtime.jsx)("button", { type: "button", onClick: addPhrase, style: { border: 0, background: "transparent", color: "var(--dsw-alias-label-primary)", cursor: "pointer", font: "inherit", fontSize: "12px" }, children: t("phrase.add") }),
                    (0, react_jsx_runtime.jsx)("button", { type: "button", onClick: function () { setManage(false); }, style: { border: 0, background: "transparent", color: "var(--dsw-alias-label-primary)", cursor: "pointer", font: "inherit", fontSize: "12px" }, children: t("phrase.done") })
                  ] })
                ]
              }) : (0, react_jsx_runtime.jsx)("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", marginTop: "6px", paddingTop: "5px" }, children: (0, react_jsx_runtime.jsx)("button", { type: "button", onClick: function () { setManage(true); }, style: { border: 0, background: "transparent", color: "var(--dsw-alias-label-secondary)", cursor: "pointer", font: "inherit", fontSize: "12px" }, children: t("phrase.manage") }) })
            ]
          }, "phrase-menu") : null
        ]
      });
    }

    function beginRunningEdit(sessionId, turnNumber) {
      var text = "";
      try { text = userTextOf(sessionId, turnNumber) || ""; } catch (e) { text = ""; }
      var content = [];
      try { content = userContentOf(sessionId, turnNumber) || []; } catch (e) { content = []; }
      var imageBlocks = [];
      for (var ci = 0; ci < content.length; ci++) {
        var block = content[ci];
        if (block && block.type === "image" && block.attachment !== undefined) imageBlocks.push(block);
      }
      if (text.trim() === "" && imageBlocks.length === 0) {
        showNotice(t("resend.empty"), { clientX: 24, clientY: 80 });
        return;
      }
      cancelActiveTurn(sessionId).then(function (result) {
        if (!result || result.ok !== true) {
          showNotice(t("resend.cancelFailed") + " " + ((result && result.error) || ""), { clientX: 24, clientY: 80 });
          return;
        }
        var actions = activeComposer && activeComposer.sessionId === sessionId ? activeComposer.actions : null;
        if (!actions || typeof actions.setDraft !== "function") {
          showNotice(t("resend.runningEditNoComposer"), { clientX: 24, clientY: 80 });
          return;
        }
        try { actions.setDraft(text); } catch (e) {
          showNotice(t("resend.runningEditNoComposer"), { clientX: 24, clientY: 80 });
          return;
        }
        showNotice(t("resend.runningEditReady"), { clientX: 24, clientY: 80 });
        if (imageBlocks.length === 0) return;
        // Reuse the composer's own file-drop pipeline: resolve each durable attachment to
        // a URL, fetch the bytes, and dispatch one synthetic File drop. These become normal
        // draft attachments, so the user can remove or replace them with the composer UI.
        setTimeout(function () {
          try {
            if (!ctx.uiConversation || typeof ctx.uiConversation.imageUrl !== "function"
              || typeof DataTransfer !== "function" || typeof DragEvent !== "function") {
              showNotice(t("resend.runningEditAttachments"), { clientX: 24, clientY: 110 });
              return;
            }
            var loads = [];
            for (var ii = 0; ii < imageBlocks.length; ii++) {
              (function (img, index) {
                var urlPromise = null;
                try { urlPromise = ctx.uiConversation.imageUrl(sessionId, img.attachment); } catch (e) { urlPromise = null; }
                if (!urlPromise) return;
                loads.push(Promise.resolve(urlPromise).then(function (url) {
                  if (!url) throw new Error("image URL unavailable");
                  return window.fetch(url);
                }).then(function (r) { return r.blob(); }).then(function (blob) {
                  var name = img.attachment && typeof img.attachment.name === "string" && img.attachment.name !== ""
                    ? img.attachment.name : ("image-" + (index + 1) + ".png");
                  return new window.File([blob], name, { type: blob.type || (img.attachment && img.attachment.mime) || "image/png" });
                }));
              })(imageBlocks[ii], ii);
            }
            Promise.all(loads).then(function (files) {
              if (files.length === 0) return;
              var dt = new window.DataTransfer();
              for (var fi = 0; fi < files.length; fi++) dt.items.add(files[fi]);
              var ev = new window.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
              document.dispatchEvent(ev);
            }).catch(function () {
              showNotice(t("resend.runningEditAttachments"), { clientX: 24, clientY: 110 });
            });
          } catch (e) {
            showNotice(t("resend.runningEditAttachments"), { clientX: 24, clientY: 110 });
          }
        }, 180);
      }, function (e) {
        showNotice(t("resend.cancelFailed") + " " + String((e && e.message) || e), { clientX: 24, clientY: 80 });
      });
    }

      /**
       * Find the seq of the last PENDING inbox splice that sits before `beforeSeq`.
       *
       * Measured, not theorised: dissecting the child logs of earlier forks showed them born with
       * `agent/inbox/spliced inserted=1` at seq 9/11 — the fork seed carries the parent's pending
       * queue, so the child opens its own turn and consumes it. That is the "the old message ran
       * again" the user reported. Cutting the boundary before those splices is what stops it.
       *
       * Defensive by design: any failure here just returns null and the caller keeps the previous
       * boundary, so a read problem can never break the resend.
       * @returns {Promise<number|null>}
       */
      function findPendingSpliceBefore(sessionId, beforeSeq, remoteOverride) {
          // The diagnostic switch is read ONCE, here and in doResend() below. The trace sites use
          // the ordinary `if (resendTraceOn) { ... }` guard form.
          //
          // Those five sites were once written as `resendTraceOn &&` joined to the notice call in
          // ONE expression statement, to avoid an `if (...)`. The reason was NOT style: the
          // heuristic cross-plugin scope walker
          // (`dsh-combo-sim/verify/verify_scope_refs.mjs`) refused to bind the parameters of
          // anonymous functions — for `function (result) {` it ate the `(` as if it were the
          // function's NAME and latched its parameter window onto the next `(` in the file, which
          // happened to be the trace call's own. So `result` was "declared" only by accident, and
          // inserting an `if (...)` here closed that window early and added a 53rd false positive —
          // `result`, this callback's own parameter.
          //
          // That walker defect is FIXED (2026-10-15): parameters bind in the function scope they
          // introduce, hoisting is resolved in a second pass, and the live bundle's recorded
          // baseline is 0 candidates. The walker now carries a regression fixture that inserts
          // exactly this `if (...)` shape into a /tmp copy and requires the candidate count not to
          // move. ⇒ The constraint is gone; keep the readable `if` form.
          var resendTraceOn = resendTraceEnabled();
          // MEASURED on a real machine (probe v5/v6): session.page REQUIRES both seq bounds.
          //   { throughSeq, beforeSeq }   ⇒ ✅ 283 records
          //   + maxMessages / turnWindow  ⇒ ❌ gateway/bad-request
          //   only one of the two         ⇒ ❌
          // The old call sent maxMessages:1 + turnWindow and NO beforeSeq ⇒ it failed every time,
          // this function returned null, and the caller kept an unadjusted cut.
        try {
          // 探针实测：会话级 remote(props.__remote) 成功；插件级 ctx.remote 可能取不到 ⇒ 优先会话级
          var R = remoteOverride && remoteOverride.session && typeof remoteOverride.session.page === "function"
                ? remoteOverride
                : (ctx.remote && ctx.remote.session && typeof ctx.remote.session.page === "function" ? ctx.remote : null);
          if (!R) return Promise.resolve(null);
          if (typeof beforeSeq !== "number" || beforeSeq <= 0) return Promise.resolve(null);
          return Promise.resolve(R.session.page({
            address: { kind: "session", sessionId: sessionId },
            throughSeq: beforeSeq,
              beforeSeq: beforeSeq,   // 探针实测：两个 seq 都给才成功
                                  })).then(function (result) {
            if (resendTraceOn) {
              showNotice(t("resend.tracePage", {
                ok: String(result && result.ok),
                err: String((result && result.error && (result.error.code || result.error.message)) || "-"),
                n: String(result && result.value && Array.isArray(result.value.events) ? result.value.events.length : (result && result.value && Array.isArray(result.value.items) ? result.value.items.length : -1))
              }), { clientX: 24, clientY: 170 });
            }
            try {
              var ttl = "[ha] ok=" + String(result && result.ok) +
                        " err=" + String((result && result.error && (result.error.code || result.error.message)) || "-") +
                        " cutBound=" + String(beforeSeq) + "(start-1=" + String(beforeSeq - 1) + ")";
              if (result && result.ok === true) {
                try {
                  var ev0 = Array.isArray(result.value.records) ? result.value.records : (Array.isArray(result.value.events) ? result.value.events : []);
                  var pe0 = -1, lo0 = [];
                  for (var i0 = 0; i0 < ev0.length; i0 += 1) {
                    var x0 = ev0[i0] && ev0[i0].event ? ev0[i0].event : ev0[i0];
                    if (!x0 || typeof x0.seq !== "number") continue;
                    if (x0.type === "turn/end" && x0.seq <= beforeSeq && x0.seq > pe0) pe0 = x0.seq;
                    if (x0.type === "agent/inbox/spliced") {
                      var in0 = (x0.data || {}).inserted;
                      if (Array.isArray(in0) && in0.length > 0) lo0.push(x0.seq);
                    }
                  }
                  var gap0 = [];
                  for (var g0 = 0; g0 < lo0.length; g0 += 1) { if (lo0[g0] > pe0 && lo0[g0] <= beforeSeq) gap0.push(lo0[g0]); }
                  ttl += " prevEnd=" + pe0 + " loaded=" + JSON.stringify(lo0.slice(-6)) + " gap=" + JSON.stringify(gap0);
                  if (gap0.length) ttl += " CUT=" + (Math.min.apply(null, gap0) - 1);
                } catch (e0x) {}
                var vv = result.value || {};
                var aa = Array.isArray(vv.records) ? vv.records : (Array.isArray(vv.events) ? vv.events : null);
                ttl += " cont=" + (Array.isArray(vv.records) ? "records" : (Array.isArray(vv.events) ? "events" : "?")) + " n=" + (aa ? aa.length : -1);
              }
              // Diagnostic only, and OFF by default: this rename used to overwrite the user's
              // own session title with `[ha] ok=… err=… …` on every edit-and-resend.
              if (resendTraceEnabled() && ctx.remote && ctx.remote.session && typeof ctx.remote.session.rename === "function") {
                ctx.remote.session.rename({ sessionId: sessionId, title: ttl.slice(0, 200) });
              }
            } catch (eT) {}
            if (!result || result.ok !== true) return null;
            var value = result.value;
            // MEASURED (probe v5/v6): session.page answers { records: [ { type:"event",
            // event:{ type, seq, time, data } } ] } — records first, and each record WRAPS the
            // real event. The three old branches never matched, so this returned null every time.
            var events = null;
            if (value && Array.isArray(value.records)) events = value.records;
            else if (value && Array.isArray(value.events)) events = value.events;
            else if (value && Array.isArray(value.items)) events = value.items;
            else if (Array.isArray(value)) events = value;
            if (events !== null) {
              var unwrapped = [];
              for (var uw = 0; uw < events.length; uw += 1) {
                var rw = events[uw];
                unwrapped.push(rw && typeof rw === "object" && rw.event && typeof rw.event === "object" ? rw.event : rw);
              }
              if (unwrapped.length > 0) events = unwrapped;
            }
            if (events === null) return null;
            // atSeq 的左边界：最后一条 turn/end。实测（1021 轮）装载 splice 恰好落在
            // 「上一轮 end+1 .. 本轮 start-1」这段间隙里；把这些排除掉，子会话就不会
            // 再把排队消息 materialize 一次（那正是"编辑前的原文又出现"）。
            var prevEnd = -1;
            for (var pe2 = 0; pe2 < events.length; pe2 += 1) { var ev2 = events[pe2]; if (ev2 && ev2.type === "turn/end" && typeof ev2.seq === "number" && ev2.seq <= beforeSeq && ev2.seq > prevEnd) prevEnd = ev2.seq; }
            var found = null;
            for (var i = 0; i < events.length; i++) {
              var ev = events[i];
              if (ev === null || typeof ev !== "object") continue;
              if (ev.type !== "agent/inbox/spliced") continue;
              var d = ev.data || {};
              var ins = d.inserted;
              if (!Array.isArray(ins) || ins.length === 0) continue;
              // MEASURED: the loaded splice that carries the not-yet-sent queue often sits AT
              // beforeSeq, so `>=` skipped it. Step 1 of two; step 2 scopes the search to the
              // gap after the previous turn/end.
              if (typeof ev.seq !== "number" || ev.seq > beforeSeq) continue;
              if (ev.seq <= prevEnd) continue;
              if (found === null || ev.seq < found) found = ev.seq;
            }
            return found;
          }, function () { return null; });
        } catch (e) {
          if (resendTraceOn) {
            showNotice(t("resend.tracePage", { ok: "throw", err: String((e && e.message) || e), n: "-" }), { clientX: 24, clientY: 170 });
          }
          return Promise.resolve(null);
        }
      }

      function wireContentOf(payload, sessionId) {
        var input = Array.isArray(payload) ? payload : [{ type: "text", text: String(payload === undefined || payload === null ? "" : payload) }];
        var allowedMedia = ["image/png", "image/jpeg", "image/webp", "image/gif"];
        function normalizeMedia(value, dataUrl) {
          var mt = typeof value === "string" ? value : "";
          if (allowedMedia.indexOf(mt) === -1 && typeof dataUrl === "string" && dataUrl.indexOf("data:") === 0) {
            var semi = dataUrl.indexOf(";");
            if (semi > 5) mt = dataUrl.slice(5, semi);
          }
          return allowedMedia.indexOf(mt) === -1 ? "image/png" : mt;
        }
        function canonicalBase64(value) {
          var data = String(value === undefined || value === null ? "" : value);
          var comma = data.indexOf(",");
          if (comma >= 0) data = data.slice(comma + 1);
          data = data.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
          while (data.length % 4 !== 0) data += "=";
          if (data === "") throw new Error("empty image data");
          var binary = window.atob(data);
          return window.btoa(binary);
        }
        function imageFromAttachment(attachment) {
          return new Promise(function (resolve, reject) {
            try {
              if (!ctx.uiConversation || typeof ctx.uiConversation.imageUrl !== "function") {
                reject(new Error("image URL service unavailable"));
                return;
              }
              Promise.resolve(ctx.uiConversation.imageUrl(sessionId, attachment)).then(function (url) {
              if (!url) { reject(new Error("image URL unavailable")); return; }
              return window.fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
                var reader = new window.FileReader();
                reader.onload = function () {
                  var result = String(reader.result || "");
                  var comma = result.indexOf(",");
                  if (comma < 0) { reject(new Error("image encoding failed")); return; }
                  resolve({
                    type: "image",
                    mediaType: normalizeMedia(attachment.mediaType || blob.type, result),
                    data: canonicalBase64(result),
                    name: attachment.name || "image"
                  });
                };
                reader.onerror = function () { reject(new Error("image encoding failed")); };
                reader.readAsDataURL(blob);
              });
              }).catch(reject);
            } catch (e) { reject(e); }
          });
        }
        var jobs = [];
        for (var i = 0; i < input.length; i++) {
          (function (block) {
            if (!block || typeof block !== "object") { jobs.push(Promise.reject(new Error("unsupported content block"))); return; }
            if (block.type === "text") { jobs.push(Promise.resolve({ type: "text", text: String(block.text || "") })); return; }
            if (block.type === "image") {
              if (typeof block.data === "string") {
                jobs.push(Promise.resolve({ type: "image", mediaType: normalizeMedia(block.mediaType || block.mime, "data:" + (block.mediaType || block.mime || "") + ";base64,"), data: canonicalBase64(block.data), ...(block.name ? { name: block.name } : {}) }));
              } else if (block.attachment) {
                jobs.push(imageFromAttachment(block.attachment));
              } else {
                jobs.push(Promise.reject(new Error("image block has neither data nor attachment")));
              }
              return;
            }
            if (block.type === "file") {
              if (typeof block.receiptId === "string") { jobs.push(Promise.resolve({ type: "file", receiptId: block.receiptId })); return; }
              jobs.push(Promise.reject(new Error("file block needs receiptId")));
              return;
            }
            jobs.push(Promise.reject(new Error("unsupported content type: " + String(block.type))));
          })(input[i]);
        }
        return Promise.all(jobs);
      }

      function withTimeout(promise, ms, message) {
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () { reject(new Error(message)); }, ms);
          Promise.resolve(promise).then(function (value) {
            clearTimeout(timer); resolve(value);
          }, function (error) {
            clearTimeout(timer); reject(error);
          });
        });
      }

      function doResend(sessionId, boundary, payload, info) {
        var infoObj = info && typeof info === "object" ? info : {};
        // Same once-per-call read as findPendingSpliceBefore (see the note there: the trace
        // sites use the ordinary `if (resendTraceOn) { ... }` guard form).
        var resendTraceOn = resendTraceEnabled();
        // Report what actually happened: the user saw "the original was sent again", and this
        // trace is the only reading that can settle whether the fork point or the child's own
        // continuation is responsible. Guessing has already cost several rounds.
        if (resendTraceOn) {
          showNotice(t("resend.trace", {
            at: String(boundary), from: String(sessionId).slice(0, 20),
            start: String(typeof infoObj.start === "number" ? infoObj.start : "?"),
            end: String(typeof infoObj.end === "number" ? infoObj.end : "?"),
            prev: String(typeof infoObj.prev === "number" ? infoObj.prev : "?")
          }), { clientX: 24, clientY: 80 });
        }
        // Move the cut before any pending inbox splice: those are what the child would inherit
        // and then run on its own (observed in the fork children's logs).
        // 页面的 beforeSeq/throughSeq 是【排他】的：boundary = 本轮 start − 1 时，恰好落在该 seq 上的
        // 装载 splice 拿不到（实证 trace: loaded=[3,44,46] 而 67 那条漏了 ⇒ gap=[]）。
        // 传 boundary + 1 把边界那条也纳进来。
        if (resendTraceEnabled()) showNotice(t("resend.preparing"), { clientX: 24, clientY: 80 }, { always: true });
        return withTimeout(wireContentOf(payload, sessionId), 15000, t("resend.prepareTimeout")).then(function (content) {
        if (resendTraceEnabled()) showNotice(t("resend.prepared"), { clientX: 24, clientY: 80 }, { always: true });
        return findPendingSpliceBefore(sessionId, boundary + 1, infoObj && infoObj.remote).then(function (spliceSeq) {
          var cut = boundary;
          if (typeof spliceSeq === "number" && spliceSeq > 0) {
            cut = spliceSeq - 1;
            if (resendTraceOn) {
              showNotice(t("resend.traceSplice", { splice: String(spliceSeq), cut: String(cut) }), { clientX: 24, clientY: 140 });
            }
          }
          return ctx.sessions.fork({ sessionId: sessionId, atSeq: cut }).then(function (childId) {
          if (resendTraceOn) {
            showNotice(t("resend.traceChild", { child: String(childId).slice(0, 24), at: String(boundary) }), { clientX: 24, clientY: 110 });
          }
          function failChild(error) {
            try {
              if (ctx.uiWorkspace && typeof ctx.uiWorkspace.openSession === "function") ctx.uiWorkspace.openSession(sessionId);
            } catch (e) { /* return to parent is best effort */ }
            try {
              if (ctx.uiWorkspace && typeof ctx.uiWorkspace.archiveSession === "function") {
                ctx.uiWorkspace.archiveSession(childId);
              }
            } catch (e) { /* cleanup is best effort */ }
            throw error;
          }
          ctx.uiWorkspace.openSession(childId);
          if (resendTraceOn) showNotice(t("resend.sendingBranch"), { clientX: 24, clientY: 80 }, { always: true });
          return ctx.remote.session.prompt({
            requestId: newRequestId(),
            sessionId: childId,
            // "steer" interrupts the current turn and runs immediately; "queue" only appends
            // AFTER it. The host source is explicit:
            //   placement = running ? (mode === "steer" ? "steering" : "queued") : "transcript"
            // A resend means "stop this and run the edited text NOW", so queue is wrong — it is
            // exactly why the edited message sat in the pending list of the user's session.
            mode: "steer",
            content: content
          }).then(function (result) {
            if (result && result.ok === false) {
              try {
                var shape = content.map(function (part) {
                  return part && part.type === "image"
                    ? "image:" + String(part.mediaType || "?") + ":" + String(part.data ? part.data.length : 0)
                    : (part && part.type === "text" ? "text:" + String(part.text || "").length : String(part && part.type || "?"));
                }).join(" | ");
                showNotice(t("resend.wireParts", { parts: shape }), { clientX: 24, clientY: 80 }, { always: true });
              } catch (e) { /* diagnostic only */ }
              return failChild(new Error((result.error && result.error.message) || "prompt rejected"));
            }
            if (resendTraceOn) showNotice(t("resend.sentBranch"), { clientX: 24, clientY: 80 }, { always: true });
            return childId;
          }, failChild);
        });
        });
        });
      }

      function listPresets() {
        return ctx.remote.agentPresets.list().then(function (result) {
          if (!result || result.ok === false) {
            throw new Error((result && result.error && result.error.message) || "preset list failed");
          }
          var presets = (result.value && result.value.presets) || [];
          return presets
            .filter(function (p) { return p && p.broken === undefined && typeof p.id === "string"; })
            .map(function (p) {
              return {
                id: p.id,
                name: typeof p.name === "string" && p.name !== "" ? p.name : p.id,
                description: typeof p.description === "string" ? p.description : "",
                isDefault: p.isDefault === true
              };
            });
        });
      }
      // A preset is locked once a session has any turn, so a mode-carrying branch
      // must be a NEW blank session; the source conversation rides along as a
      // canonical session-reference mention captured at agent/pre-step.
      // A workspace is fixed at creation (its path becomes the session cwd), so
      // this is the only place the choice can be applied.
      function createWithMode(sourceSessionId, presetId, workspaceId, text) {
        var created = workspaceId ? ctx.sessions.create({ workspaceId: workspaceId }) : ctx.sessions.create();
        return created.then(function (newId) {
          rememberModeLink(newId, sourceSessionId);
          return ctx.remote.agentPresets.select(newId, presetId).then(function (selected) {
            if (selected && selected.ok === false) {
              var reason = selected.error && selected.error.details && typeof selected.error.details.reason === "string"
                ? selected.error.details.reason
                : (selected.error && selected.error.message) || "preset select failed";
              throw new Error(reason);
            }
            var body = typeof text === "string" && text.trim() !== "" ? text.trim() : "";
            var label = sessionTitleOf(sourceSessionId) || "之前的对话";
            var content = formatMention(sourceSessionId, label) + "\n\n" + (body !== "" ? body : "请基于上面引用的对话继续。");
            return ctx.remote.session.prompt({
              requestId: newRequestId(),
              sessionId: newId,
              mode: "queue",
              content: [{ type: "text", text: content }]
            }).then(function (result) {
              if (result && result.ok === false) {
                throw new Error((result.error && result.error.message) || "prompt rejected");
              }
              ctx.uiWorkspace.openSession(newId);
              return newId;
            });
          });
        });
      }

      // A `@label` session chip in a sent message keeps only its label: the Chat
      // UI rewrote the mention and appends the structured ids as a separate
      // session-reference context message. That context node still lives in the
      // Chat store (hidden, not rendered), so the referenced id is read there.
      function sessionReferencesOf(targetSessionId, turnNumber) {
        var found = [];
        var snapshot;
        try {
          snapshot = chatSnapshotOf(targetSessionId);
        } catch (e) {
          return found;
        }
        if (!snapshot || !snapshot.nodes) return found;
        var seen = [];
        var collect = function (node) {
          if (!node || seen.indexOf(node) !== -1) return;
          seen.push(node);
          var source = node.data ? node.data.source : undefined;
          if (!source || source.kind !== "session-reference" || !Array.isArray(source.references)) return;
          for (var i = 0; i < source.references.length; i++) {
            var reference = source.references[i];
            if (reference && typeof reference.sessionId === "string" && reference.sessionId !== "") found.push(reference);
          }
        };
        // `data-chat-turn` only exists on nodes bound to turn/step boundary
        // coordinates, so a user message usually carries none — hence the window pass.
        try {
          if (turnNumber !== undefined && snapshot.locations && typeof snapshot.locations.getTurn === "function") {
            var keys = snapshot.locations.getTurn(turnNumber) || [];
            for (var k = 0; k < keys.length; k++) collect(snapshot.nodes.get(keys[k]));
          }
        } catch (e) {
          /* fall through to the whole window */
        }
        try {
          if (typeof snapshot.nodes.values === "function") {
            var all = snapshot.nodes.values() || [];
            for (var w = 0; w < all.length; w++) collect(all[w]);
          }
        } catch (e) {
          /* keep whatever the turn pass found */
        }
        return found;
      }
      function pickReference(found, label) {
        if (found.length === 0) return undefined;
        if (typeof label === "string" && label !== "") {
          var matched = [];
          for (var i = 0; i < found.length; i++) {
            if (found[i].label === label && matched.indexOf(found[i].sessionId) === -1) matched.push(found[i].sessionId);
          }
          if (matched.length === 1) return matched[0];
          if (matched.length > 1) return undefined; // ambiguous label: never guess
        }
        var ids = [];
        for (var j = 0; j < found.length; j++) {
          if (ids.indexOf(found[j].sessionId) === -1) ids.push(found[j].sessionId);
        }
        return ids.length === 1 ? ids[0] : undefined;
      }
      // Cheap counts for the failure diagnostic: tells "the store has no such
      // node" apart from "the node is there but nothing matched".
      function referenceDiagnostics(targetSessionId) {
        try {
          var snapshot = chatSnapshotOf(targetSessionId);
          if (!snapshot || !snapshot.nodes || typeof snapshot.nodes.values !== "function") return { nodes: -1, references: -1 };
          var all = snapshot.nodes.values() || [];
          var refs = 0;
          for (var i = 0; i < all.length; i++) {
            var source = all[i] && all[i].data ? all[i].data.source : undefined;
            if (source && source.kind === "session-reference" && Array.isArray(source.references)) refs += source.references.length;
          }
          return { nodes: all.length, references: refs };
        } catch (e) {
          return { nodes: -2, references: -2 };
        }
      }
      function referencedSessionIdOf(targetSessionId, turnNumber, label) {
        try {
          var scoped = pickReference(sessionReferencesOf(targetSessionId, turnNumber), label);
          if (scoped !== undefined) return scoped;
          if (turnNumber !== undefined) {
            var windowWide = pickReference(sessionReferencesOf(targetSessionId, undefined), label);
            if (windowWide !== undefined) return windowWide;
          }
        } catch (e) {
          /* fall through to the link table */
        }
        // Last resort: a link this plugin recorded when it created the branch.
        var links = readModeLinks();
        return typeof links[targetSessionId] === "string" && links[targetSessionId] !== "" ? links[targetSessionId] : undefined;
      }

    /**
     * Files a turn's own tool calls mutated, read from the Chat node store.
     * `write`, `edit` and mutating `str_replace_editor` commands are the same set the
     * deliverables card folds into its changed-files list.
     * @returns {string[]} distinct paths, in first-seen order
     */
    function mutatedPathsOf(targetSessionId, turnNumber) {
      var calls = [];
      try {
        var snapshot = chatSnapshotOf(targetSessionId);
        var keys = snapshot && snapshot.locations ? (snapshot.locations.getTurn(turnNumber) || []) : [];
        for (var i = 0; i < keys.length; i++) {
          var node = snapshot.nodes.get(keys[i]);
          var data = node && node.data ? node.data : undefined;
          if (!data) continue;
          if (typeof data.name === "string" && typeof data.argsRaw === "string") {
            calls.push({ name: data.name, argsRaw: data.argsRaw });
          }
          if (Array.isArray(data.content)) {
            for (var b = 0; b < data.content.length; b++) {
              var block = data.content[b];
              if (block && block.kind === "tool-call" && typeof block.name === "string") {
                calls.push({ name: block.name, argsRaw: typeof block.argsRaw === "string" ? block.argsRaw : "" });
              }
            }
          }
        }
      } catch (e) {
        return [];
      }
      var paths = [];
      for (var c = 0; c < calls.length; c++) {
        var name = calls[c].name;
        if (name !== "write" && name !== "edit" && name !== "str_replace_editor") continue;
        var args;
        try {
          args = JSON.parse(calls[c].argsRaw);
        } catch (e) {
          args = null;
        }
        if (!args || typeof args !== "object") continue;
        if (name === "str_replace_editor") {
          var command = typeof args.command === "string" ? args.command : "";
          if (command !== "create" && command !== "str_replace" && command !== "insert") continue;
        }
        var path = typeof args.path === "string" ? args.path
          : typeof args.file_path === "string" ? args.file_path
          : typeof args.notebook_path === "string" ? args.notebook_path : "";
        if (path !== "" && paths.indexOf(path) === -1) paths.push(path);
      }
      return paths;
    }

      // Recent conversations, offered as the reference source so the dialog shows
      // exactly which conversation it will carry over (and lets it be changed).
      // A deterministic digest of the conversation: no model call, no cost, no
      // remote. It reads the same Chat store the quote path uses, so it works on
      // whatever window is loaded. `dsh-compaction` could write a model summary,
      // but it does so by SHADOWING history — far too destructive for a note.
      /** Collapse whitespace and clip a preview to `limit`. */
      function clip(text, limit) {
        var value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
        return value.length > limit ? value.slice(0, limit) + "…" : value;
      }
      /**
       * A deterministic digest of the conversation.
       * Prefers the official `turnOutline` previews (the same prompt/response text
       * the turn rail shows) and falls back to reading the Chat node store.
       */
      function conversationDigest(targetSessionId, outline, opts) {
        var options = opts && typeof opts === "object" ? opts : {};
        var responseLimit = typeof options.responseLimit === "number" && options.responseLimit > 0 ? options.responseLimit : 160;
        var keywords = String(options.keyword == null ? "" : options.keyword)
          .split(/[,\s、]+/)
          .map(function (k) { return k.trim().toLowerCase(); })
          .filter(function (k) { return k !== ""; });
        var matches = function (step) {
          if (keywords.length === 0) return true;
          var hay = (step.prompt + " " + step.response).toLowerCase();
          for (var i = 0; i < keywords.length; i++) {
            if (hay.indexOf(keywords[i]) !== -1) return true;
          }
          return false;
        };
        var entries = Array.isArray(outline) ? outline : [];
        var steps = [];
        var files = [];
        var turns = 0;
        if (entries.length > 0) {
          for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];
            if (!entry || typeof entry.turn !== "number") continue;
            turns++;
            var step = { prompt: clip(entry.prompt, 100), response: clip(entry.response, responseLimit) };
            if (!matches(step)) continue;
            steps.push(step);
            var touchedByEntry = mutatedPathsOf(targetSessionId, entry.turn);
            for (var q = 0; q < touchedByEntry.length; q++) {
              if (files.indexOf(touchedByEntry[q]) === -1) files.push(touchedByEntry[q]);
            }
          }
          if (typeof options.maxTurns === "number" && options.maxTurns > 0 && steps.length > options.maxTurns) {
            steps = steps.slice(steps.length - options.maxTurns);
          }
          return { turns: turns, steps: steps, asks: [], files: files, source: "outline" };
        }
        var snapshot = chatSnapshotOf(targetSessionId);
        var turnOrder = snapshot && snapshot.timeline && Array.isArray(snapshot.timeline.turnOrder)
          ? snapshot.timeline.turnOrder
          : [];
        var asks = [];
        for (var i = 0; i < turnOrder.length; i++) {
          var turn = turnOrder[i];
          var ask = "";
          try {
            ask = userTextOf(targetSessionId, turn) || "";
          } catch (err) {
            ask = "";
          }
          asks.push(clip(ask, 140));
          var touched = mutatedPathsOf(targetSessionId, turn);
          for (var p = 0; p < touched.length; p++) {
            if (files.indexOf(touched[p]) === -1) files.push(touched[p]);
          }
        }
        return { turns: turnOrder.length, steps: [], asks: asks, files: files, source: "store" };
      }
      testHooks.conversationDigest = conversationDigest;
      testHooks.paintLockedSessions = paintLockedSessions;
      testHooks.readFocus = function () {
  refreshFocusFile();
  // The local lock is the one this plugin actually writes; the host file is a mirror that
  // is usually absent. Reading only the cache made the settings row say "未锁定" forever.
  var eff = effectiveFocusState();
  return eff === null || typeof eff !== "object" ? null : eff;
};
      testHooks.describeFocusState = describeFocusState;
      testHooks.showNotice = showNotice;
      /** Is the lock aimed at THIS session? (header button label) */
      /** Milliseconds left on the UI lock, or 0. The header button's countdown reads this. */
      /** The header slot renders the REGISTERED label, not the component's children, so the
       *  label must carry the state itself. An end time (not a ticking number) is right here:
       *  the slot does not re-render every second, so a fixed clock time stays accurate. */
      function focusHeaderLabel() {
        try {
          // 判据与 `focusLockHoldsHere()` 同源：会话锁看会话 id，**工作区锁看归属账 path**
          // （未分组会话 ⇒ false ⇒ 头部照旧显示「专注」，与它被放行一致）。
          // 旧写法只认 `focusLockedHere()`（= 锁扣在本会话上）⇒ 工作区锁下倒计时消失。
          if (!focusLockHoldsHere()) return t("focus.headerLockShort");
          var lock = focusLockTarget();
          var left = lock !== null ? Math.max(0, lock.untilMs - Date.now()) : 0;
          var end = new Date(Date.now() + left);
          var p = function (n) { return (n < 10 ? "0" : "") + n; };
          return t("focus.headerUnlockShort") + "·" + p(end.getHours()) + ":" + p(end.getMinutes());
        } catch (e) { return t("focus.headerLockShort"); }
      }

      testHooks.focusHeaderLabel = focusHeaderLabel;
      testHooks.focusRemaining = function () {
        try {
          var eff = effectiveFocusState();
          if (eff === null || eff.locked !== true) return 0;
          var left = eff.untilMs - Date.now();
          return left > 0 ? left : 0;
        } catch (e) { return 0; }
      };
      testHooks.focusOpenDialog = function () { return true; };
      /**
       * 当前会话有没有工作区归属（只读，绝不抛）。
       *
       * 用途只有一个：决定「工作区粒度」这个选项要不要出现在专注对话框里。归属账查不到
       * （未分组 / 子代理会话）就返回 false ⇒ 不显示该按钮，避免给出一个名不副实的锁。
       */
      testHooks.focusHasWorkspace = function () {
        try {
          var p = focusWrapWorkspacePathOf(activeSessionId());
          return typeof p === "string" && p !== "";
        } catch (e) { return false; }
      };

      /** Lock THIS session for N minutes — localStorage only, no message. */
      testHooks.focusLockFor = function (minutes, scope) {
        if (!lockFocusLocally(minutes, scope)) { showNotice(t("notice.noSession"), { clientX: 24, clientY: 80, systemOnly: true }); return; }
        var used = readLocalLock();
        var isWs = used !== null && used.kind === "workspace";
        // If a workspace lock was asked for but a session lock was stored, SAY SO — a silent
        // fallback is exactly the kind of "it did nothing" this project keeps hitting. The
        // usual cause is a session that is not in any workspace's ownership account (a
        // subagent session never attaches), which must stay openable.
        var fellBack = scope === "workspace" && !isWs;
        paintLockedSessions();
        armFocusExpiry(readLocalLock());
        var end = new Date(Date.now() + minutes * 60000);
        var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
        showNotice(t(isWs ? "focus.lockedWorkspace" : "focus.lockedLocal", { n: minutes }) + " · " + t("focus.until") + " " + p2(end.getHours()) + ":" + p2(end.getMinutes()) + " · " + t("focus.howToUnlock") + (fellBack ? " · ⚠️ " + t("focus.scopeFallback") : ""), { clientX: 24, clientY: 80, systemOnly: true });
      };
      /**
       * 锁的**粒度清单** —— 唯一的权威枚举。
       *
       * `parseFocusLockFile` 只会产出这两个 `kind`（见它的实现），而"把锁全解开"必须
       * **逐档**覆盖：漏掉一档 = 「功能关了、人还被锁在里面」—— 本次改版最坏的一种失败。
       * 所以这里是一张**显式清单**，而不是"把那个对象清掉就行"（后者在清单漂了之后不报错）。
       */
      var FOCUS_LOCK_KINDS = ["session", "workspace"];

      /**
       * 解除**所有**专注锁：会话级 + 工作区级，并撤销 `ctx.uiWorkspace` 上的 5 个拦截器。
       *
       * ⚠️ 为什么必须有它（而不是直接用 `unlockFocusLocally` / `focusUnlockLocal`）：
       *   · `installFocusClicks`（捕获阶段的行点击拦截）在**注册时**受 `featureFocusLock`
       *     门控，注册之后**不再看那个开关** —— 它的判据是 `effectiveFocusState()`。
       *     所以"把功能关掉"**不会**让已经生效的锁停止拦截：锁状态本身必须被真的清掉，
       *     否则就是「功能关了、人还被锁在里面」。
       *   · 拦截器（包装）包在**宿主对象** `ctx.uiWorkspace` 上，功能关掉之后它还留在那儿
       *     ⇒ 必须撤销。撤销走 `focusWrapUnwrapAll`（回读用**自有属性描述符**，绝不用身份
       *     比较 —— `ctx.uiWorkspace` 是 cordis 可追踪 Proxy，身份比较恒假，本机踩过）。
       *   · 锁有**两种**粒度（`FOCUS_LOCK_KINDS`）⇒ 必须逐档覆盖，清单外的粒度**不假装**
       *     清掉了，而是如实记一笔失败。
       *
       * 顺序（设计稿 §5.1）：①撤销包装 → ②逐档清锁 → ③停到期计时器 → ④重画掩层。
       * ⚠️ `ok !== true` ⇒ **调用方绝不许继续关功能**（宁可关不掉，也不能把人锁死）。
       * 失败时**自己说话**（`always: true`）⇒ 调用方即使忽略了返回值也不会静默。
       *
       * @returns {{ok: boolean, wrapped: boolean, released: Array<string>, failed: Array<string>}}
       */
      function focusReleaseAllLocks() {
        var ok = true;                       // 「5 个包装已全部还原」
        try { ok = focusWrapUnwrapAll() !== false; } catch (e) { ok = false; }
        var released = [];
        var failed = [];
        // 撤销失败也进 failed ⇒ 调用方 / 回执 / 自检读到的都不只是一个 bool，而是"哪一步没成"。
        if (ok !== true) failed.push("unwrap");
        var state = null;
        try { state = readLocalLock(); } catch (e) { state = null; failed.push("read"); }
        if (state !== null && state.locked === true) {
          var kind = typeof state.kind === "string" ? state.kind : "";
          // 逐档点名：清单里没有的粒度**不假装清掉**，如实记失败（调用方据此拒绝关闭功能）。
          if (FOCUS_LOCK_KINDS.indexOf(kind) === -1) {
            failed.push("unknown-kind:" + (kind === "" ? "(empty)" : kind));
          } else if (writeLocalLock(null) !== true) {
            failed.push(kind);
          } else {
            released.push(kind);
          }
        }
        // 复核：**读回来**才算清掉了（不信 writeLocalLock 的返回值；它也会吞异常）。
        try {
          var after = readLocalLock();
          if (after !== null && after.locked === true) failed.push("residual:" + String(after.kind));
        } catch (e) { failed.push("verify"); }
        try { armFocusExpiry(null); } catch (e) { failed.push("expiry-timer"); }
        try { paintLockedSessions(); } catch (e) { failed.push("repaint"); }
        if (failed.length > 0 || ok !== true) {
          // 失败必须可见：把"没能解锁"这件事当场说出来（气泡不受「通知与气泡」开关影响）。
          try {
            showNotice(t("settings.masterUnlockFailed", { detail: (failed.length > 0 ? failed.join(" · ") : "unwrap") }), { clientX: 24, clientY: 80 }, { always: true });
          } catch (e) { /* best effort */ }
        }
        return { ok: ok === true && failed.length === 0, wrapped: ok === true, released: released, failed: failed };
      }

      /** `released` 里那些粒度的人话名字（回执要指名道姓说清解开了哪一档）。 */
      function lockScopeWords(released) {
        var words = [];
        for (var i = 0; i < released.length; i++) {
          if (released[i] === "session") words.push(t("settings.scopeSession"));
          else if (released[i] === "workspace") words.push(t("settings.scopeWorkspace"));
          else words.push(String(released[i]));
        }
        return words.join(" · ");
      }

      /**
       * `testHooks.*` 的公共子程序：说话（气泡 + 系统通道，`always: true`）。
       * 绝不让"说话失败"影响"设置已写入"这个事实，也绝不因说话而抛。
       */
      function sayIt(text) {
        try { showNotice(text, { clientX: 24, clientY: 80 }, { always: true }); } catch (e) { /* best effort */ }
        return text;
      }

      /**
       * **「移除」事务** —— 本次改版的核心，两个入口共用：
       *   · 「一键全关」    → keys = FEATURE_KEYS（7 档）
       *   · 单独关「专注锁」→ keys = ["featureFocusLock"]
       *
       * ⚠️ **顺序是硬要求，且对外可验证**：
       *     ① 先解锁（仅当要移除的那一档里含 `featureFocusLock`）
       *     ② 再写设置
       *     ③ 再说话（成功回执）+ `notifySettingsChanged`（「需重载」那行提示靠它长出来）
       *   顺序证据落在 localStorage 的调用序上：清锁走 `removeItem(FOCUS_LOCAL_KEY)`，
       *   写设置走 `setItem(SETTINGS_KEY)` —— 套件记录调用序即可复核"先解锁"。
       *   反过来（先写设置再补解锁）就会出现"功能已经关了、这一刻人还被锁在里面"的真实窗口。
       *
       * ⚠️ 解锁失败 ⇒ **一个设置都不改**，停下来把失败说出来（`focusReleaseAllLocks` 已经说了）。
       *
       * @param {Array<string>} keys 要写成 `false` 的功能键（顺序无所谓，按 FEATURE_KEYS 归一）
       * @returns {{ok:boolean, stage:string, changed:number, released:Array<string>, failed:Array<string>, message:string}}
       */
      function featureOffTransaction(keys) {
        var list = [];
        for (var i = 0; i < FEATURE_KEYS.length; i++) {
          if (Array.isArray(keys) ? keys.indexOf(FEATURE_KEYS[i]) !== -1 : keys === FEATURE_KEYS[i]) list.push(FEATURE_KEYS[i]);
        }
        if (list.length === 0) return { ok: false, stage: "noop", changed: 0, released: [], failed: [], message: "" };
        var all = list.length === FEATURE_KEYS.length;
        var needsUnlock = list.indexOf("featureFocusLock") !== -1;
        var rel = { ok: true, wrapped: true, released: [], failed: [] };
        // ① 先解锁。⚠️ 只有真要移除「专注锁」时才动锁 —— 关别的档不该顺手把用户的锁解开。
        if (needsUnlock) {
          rel = focusReleaseAllLocks();
          if (rel.ok !== true) {
            return { ok: false, stage: "unlock", changed: 0, released: rel.released, failed: rel.failed, message: t("settings.masterUnlockFailed", { detail: (rel.failed.length > 0 ? rel.failed.join(" · ") : "unwrap") }) };
          }
        }
        // ② 再写设置。
        var next = readSettings();
        for (var j = 0; j < list.length; j++) next[list[j]] = false;
        var written = writeSettings(next);
        if (!written || written.ok !== true) {
          var wf = sayIt(t("notes.writeFailed") + " " + ((written && written.error) || ""));
          return { ok: false, stage: "write", changed: 0, released: rel.released, failed: ["write"], message: wf };
        }
        // ③ 再说话（成功回执）：说清"先解除了什么"，没有生效锁时**不谎称**解除过。
        var scopes = lockScopeWords(rel.released);
        var msg = all
          ? (rel.released.length > 0
            ? t("settings.masterOffDone", { scopes: scopes, total: FEATURE_KEYS.length })
            : t("settings.masterOffNoLock", { total: FEATURE_KEYS.length }))
          : (rel.released.length > 0 ? t("settings.focusOffDone", { scopes: scopes }) : t("settings.focusOffNoLock"));
        sayIt(msg);
        try { notifySettingsChanged(); } catch (e) { /* 通知失败不影响"已写入"这个事实 */ }
        return { ok: true, stage: "settings", changed: list.length, released: rel.released, failed: [], message: msg };
      }

      testHooks.featureMasterOff = function () { return featureOffTransaction(FEATURE_KEYS.slice()); };
      /** 「一键全开」：不需要解锁（只有"关"才有锁的副作用），所以顺序无关紧要。 */
      testHooks.featureMasterOn = function () {
        var next = readSettings();
        for (var i = 0; i < FEATURE_KEYS.length; i++) next[FEATURE_KEYS[i]] = true;
        var written = writeSettings(next);
        if (!written || written.ok !== true) {
          var wf = sayIt(t("notes.writeFailed") + " " + ((written && written.error) || ""));
          return { ok: false, stage: "write", changed: 0, released: [], failed: ["write"], message: wf };
        }
        var msg = sayIt(t("settings.masterOnDone", { total: FEATURE_KEYS.length }));
        try { notifySettingsChanged(); } catch (e) { /* ignore */ }
        return { ok: true, stage: "settings", changed: FEATURE_KEYS.length, released: [], failed: [], message: msg };
      };

      /**
       *「专注锁」总开关关掉时的一键收尾（设置页经 testHooks 接缝调用）。
       *
       * 为什么必须有它，而不是复用 focusUnlockLocal：那条路会把 notice 说成 focus.wrapEscaped
       * （"已脱离专注"），与用户实际做的事（关掉一个功能）不符。设计稿 §5.1 要求按
       * ①撤销 → ②清锁 → ③停轮询 → ④清掩层 → ⑤说话 的顺序，且**先撤销、成功才说话** ——
       * 否则撤销失败时用户看到的是"已撤销"，那是说谎。
       *
       * @returns {{ok: boolean, unlocked: boolean, message: string}}
       */
      testHooks.featureFocusLockOff = function () {
        // 2026-10-16 第 4 轮：整段换成**共用的「移除」事务**（先解锁 → 再写设置 → 再说话）。
        // 语义变了：以前是"先写设置、再补解锁，解锁失败也照样关"，现在**解锁失败就不关**。
        // 所以 `ok` / `unlocked` 的含义随之变成"包装已全部撤销" / "本地锁已清干净"，而
        // `stage === "unlock"` 明确表示"停在解锁这一步、设置一个字都没改"。
        var r = featureOffTransaction(["featureFocusLock"]);
        return { ok: r.ok === true, unlocked: r.failed.length === 0 && r.stage !== "unlock", stage: r.stage, released: r.released, failed: r.failed, changed: r.changed, message: r.message };
      };

      testHooks.focusUnlockLocal = function () {
        unlockFocusLocally();
        armFocusExpiry(null);
        focusWrapEscape("focusUnlockLocal");
        paintLockedSessions();
        showNotice(t("focus.unlockedLocal"), { clientX: 24, clientY: 80, systemOnly: true });
      };
      testHooks.focusLockedHere = function () {
        try {
          // Must consult the EFFECTIVE state (local lock first, then the file), not just the
          // file cache: the header kept saying "专注" after locking because this seam was written
          // before the local lock existed and only ever looked at focusFileCache — which is null
          // whenever there is no host-written mirror, i.e. always in the current design.
          // 语义（2026-10-13 修订）：**工作区锁下，属于被锁工作区的会话也算「锁在这里」**
          // ⇒ 头部才有倒计时与「解除专注·HH:MM」。未分组会话仍算「不在这里」（被放行）。
          return focusLockHoldsHere();
        } catch (e) { return false; }
      };
      /** 读数接缝：掩层该暗哪些行（纯函数，不碰 DOM —— 套件用假行即可断言判定）。 */
      testHooks.focusDimMarks = function (items, lock) { return focusDimMarks(items, lock, activeSessionId()); };
      testHooks.focusLockTarget = focusLockTarget;
      testHooks.focusLockWorkspaceItem = focusLockWorkspaceItem;
      /**
       * One click: send the lock/unlock request straight to this session.
       *
       * `session.prompt` is client-callable, so the button needs neither the composer nor the
       * user pressing Enter. If the send fails, say so — a click that does nothing is the one
       * outcome a button must never produce.
       */
      testHooks.focusToggleRequest = function () {
        var id = activeSessionId();
        if (typeof id !== "string" || id === "") { showNotice(t("notice.noSession"), { clientX: 24, clientY: 80, systemOnly: true }); return; }
        var locked = testHooks.focusLockedHere();
        var text = locked ? t("focus.requestUnlock") : t("focus.requestLock");
        try {
          ctx.remote.session.prompt({ requestId: newRequestId(), sessionId: id, mode: "queue", content: [{ type: "text", text: text }] })
            .then(function (result) {
              if (result && result.ok === false) throw new Error((result.error && result.error.message) || "prompt rejected");
              showNotice(locked ? t("focus.sentUnlock") : t("focus.sentLock"), { clientX: 24, clientY: 80, systemOnly: true });
            })
            .catch(function (e) { showNotice(t("focus.sendFailed") + " " + String((e && e.message) || e), { clientX: 24, clientY: 80, systemOnly: true }); });
        } catch (e) { showNotice(t("focus.sendFailed") + " " + String((e && e.message) || e), { clientX: 24, clientY: 80, systemOnly: true }); }
      };
      /** Mail me the client's own view of the lock (the UI lock silently did nothing 3x). */
      testHooks.focusReport = function () {
        var rootLen = -1, bodyLen = -1, inRoot = false, inBody = false, rows = -1;
        try {
          var root = conversationRoot();
          if (root !== null && typeof root.textContent === "string") { rootLen = root.textContent.length; inRoot = root.textContent.indexOf(FOCUS_MARKER) !== -1; }
        } catch (e) { /* report -1 */ }
        try {
          if (typeof document !== "undefined" && document.body && typeof document.body.textContent === "string") { bodyLen = document.body.textContent.length; inBody = document.body.textContent.indexOf(FOCUS_MARKER) !== -1; }
          rows = document.querySelectorAll("[data-row-key]").length;
        } catch (e) { /* report -1 */ }
        var state = null;
        try { state = readFocusStateFromTranscript(); } catch (e) { state = null; }
        var mine = "";
        try { mine = String(activeSessionId() || ""); } catch (e) { mine = "?"; }
        // Probe the NEW channel step by step, so one click answers "which link is broken".
        var wfPresent = false;
        var rawShape = "(未调用)";
        var fileState = "(未读取)";
        try {
          var wf = ctx.remote && ctx.remote.workspaceFiles;
          wfPresent = !!(wf && typeof wf.read === "function");
          if (wfPresent && typeof mine === "string" && mine !== "") {
            try {
              var probe = wf.read(mine, FOCUS_FILE, { offset: 1, limit: 100 });
              if (probe && typeof probe.then === "function") {
                rawShape = "(异步，见缓存)";
                probe.then(function (r) {
                  var code = r && r.error && (r.error.code || r.error.message);
                  var isMissing = String(code || "").indexOf("not-found") !== -1;
                  var s2 = r && r.ok === true
                    ? ("ok keys=" + ((r.value && typeof r.value === "object") ? Object.keys(r.value).join(",") : typeof r.value))
                    : (isMissing ? "无文件（正常：锁存在浏览器本地）" : ("fail:" + String(code || r)));
                  var eff2 = null;
                  try { eff2 = effectiveFocusState(); } catch (e3) { eff2 = null; }
                  var ui = eff2 !== null && eff2.locked === true ? ("已锁→" + String(eff2.targetId).slice(0, 22)) : "未锁";
                  showNotice("【专注锁】文件通道：" + s2 + " · 界面锁状态：" + ui, { clientX: 24, clientY: 80, systemOnly: true });
                }).catch(function (e) {
                  showNotice("【专注锁文件通道】read 抛错: " + String((e && e.message) || e), { clientX: 24, clientY: 80, systemOnly: true });
                });
              } else {
                rawShape = "sync:" + JSON.stringify(probe && probe.ok) ;
              }
            } catch (e) { rawShape = "抛出:" + String((e && e.message) || e); }
          }
          fileState = focusFileCache === null ? "(缓存空)" : (focusFileCache.locked ? ("锁定→" + focusFileCache.targetId) : "未锁定");
        } catch (e) { rawShape = "探针异常:" + String((e && e.message) || e); }

        var diagLock = "(无)";
        var diagHere = "?";
        var diagLabel = "?";
        var diagHeader = "(读不到)";
        var diagLocal = "(空)";
        try {
          var eff = effectiveFocusState();
          if (eff !== null && eff.locked === true) {
            diagLock = eff.kind + "→" + String(eff.targetId).slice(0, 26) + " 剩 " + Math.max(0, Math.round((eff.untilMs - Date.now()) / 1000)) + "s";
          } else { diagLock = "(未锁)"; }
          diagHere = String(typeof testHooks.focusLockedHere === "function" ? testHooks.focusLockedHere() : "noSeam");
          diagLabel = String(typeof focusHeaderLabel === "function" ? focusHeaderLabel() : "noFn");
          var raw = null;
          try { raw = localStorage.getItem("dsh.deepworker.focusLocal"); } catch (e2) { raw = null; }
          diagLocal = raw === null ? "(空)" : String(raw).slice(0, 70);
          // What the header actually renders: find the shortest element whose text mentions 专注.
          var all = document.querySelectorAll("button, [role=button], span, div");
          var best = null;
          for (var bi = 0; bi < all.length; bi++) {
            var el = all[bi];
            var tx = (el.textContent || "").trim();
            if (tx.length > 0 && tx.length < 40 && tx.indexOf("专注") !== -1) {
              if (best === null || tx.length < best.length) best = tx;
            }
          }
          if (best !== null) diagHeader = best;
        } catch (e) { diagLock = "探针异常:" + String((e && e.message) || e); }

        var text = "【专注锁自检】 build=" + BUILD + " | me=" + (mine === "" ? "(空)" : mine)
          + " | 锁=" + diagLock + " | 本会话=" + diagHere + " | 标签=" + diagLabel
          + " | 头部文本=" + diagHeader + " | 本地锁=" + diagLocal
          + " | marker=" + (state === null ? "读不到" : (state.locked === true ? ("锁定->" + state.targetId) : "未锁定"))
          + " | 命中=" + (state !== null && state.locked === true && sameSessionId(mine, state.targetId) ? "是" : "否")
          + " | 标记在会话根=" + inRoot + "(len " + rootLen + ")"
          + " | 标记在body=" + inBody + "(len " + bodyLen + ")"
          + " | 会话行数=" + rows
          + " | workspaceFiles=" + wfPresent
          + " | 文件通道=" + fileState
          + " | read=" + rawShape;
        // 拦截引擎的**纯 ASCII**读数（机器可判读；中文断言不可靠）。
        var wrapReadout = "-";
        try { wrapReadout = focusWrapReadout(); } catch (e) { wrapReadout = "(readout-error)"; }
        text = text + " | " + wrapReadout;
        if (typeof mine !== "string" || mine === "") { showNotice(text, { clientX: 24, clientY: 80, systemOnly: true }); return; }
        try {
          ctx.remote.session.prompt({ requestId: newRequestId(), sessionId: mine, mode: "queue", content: [{ type: "text", text: text }] })
            .catch(function () { showNotice(text, { clientX: 24, clientY: 80, systemOnly: true }); });
        } catch (e) { showNotice(text, { clientX: 24, clientY: 80, systemOnly: true }); }
      };
      /**
       * 「通知哪些会话」这一族按钮的**动作回执** —— 它们必须**不受「通知与气泡」总开关影响**。
       *
       * 2026-10-16 修复（上一轮报告的未修缺陷）：这三颗按钮原先调这个回执函数不带
       * `always: true`，而 `showNotice` 被 `featureNotice` 门控 ⇒ 关掉「通知与气泡」之后点
       * 它们会**写设置但一句话都不说**（违反本机铁律"失败必须可见"）。
       *
       * ⚠️ 语义边界（**别把门控整个拆掉**）：
       *   · `featureNotice` 门控的是**通知通道** —— "把提醒发到系统通知中心 / 画气泡"这类把消息
       *     **发给用户**的行为；关掉它的语义就是"别再主动弹东西给我"。
       *   · 而"我点了这颗按钮、设置已经改了 / 没改成"是**插件自己的动作回执**，与
       *     `notes.writeFailed`、`settings.applyFailures`、专注锁拦截提示同类 ⇒ 属于
       *     `opts.always` 那个例外。关掉通知不该把"我刚才那一下到底生效没有"的答案一起关掉。
       *   ⇒ 修法是给这几处**加 `always: true`**，**不是**删掉 `featureNotice` 门控
       *     （删掉门控会破坏既有断言与用户要的语义：通知通道仍然可关）。
       *   `scopeIdOrComplain` 那句 `notice.noSession` 也属于这一族（它是"点了按钮但没做成"的
       *   **原因**回执，不是"通知某个会话"）⇒ 一起修。同理，另外两处 `notice.noSession`
       *   （加锁 / 一键请求）本来就带 `systemOnly: true`，早已豁免，未动。
       */
      function scopeIdOrComplain() {
        var id = activeSessionId();
        if (typeof id === "string" && id !== "") return id;
        showNotice(t("notice.noSession"), { clientX: 24, clientY: 80 }, { always: true });
        return null;
      }
      testHooks.noticeOnlyCurrent = function () {
        var id = scopeIdOrComplain();
        if (id === null) return;
        var next = readSettings();
        next.noticeOnlySession = id;
        writeSettings(next);
        showNotice(t("notice.onlySet") + " " + id, { clientX: 24, clientY: 80 }, { always: true });
      };
      testHooks.noticeMuteCurrent = function () {
        var id = scopeIdOrComplain();
        if (id === null) return;
        var next = readSettings();
        var list = Array.isArray(next.noticeMutedSessions) ? next.noticeMutedSessions.slice() : [];
        var at = -1;
        for (var i = 0; i < list.length; i++) { if (sameSessionId(list[i], id)) { at = i; break; } }
        if (at === -1) { list.push(id); showNotice(t("notice.muted") + " " + id, { clientX: 24, clientY: 80 }, { always: true }); }
        else { list.splice(at, 1); showNotice(t("notice.unmuted") + " " + id, { clientX: 24, clientY: 80 }, { always: true }); }
        next.noticeMutedSessions = list.slice(-50);
        writeSettings(next);
      };
      testHooks.noticeClearScope = function () {
        var next = readSettings();
        next.noticeOnlySession = "";
        next.noticeMutedSessions = [];
        writeSettings(next);
        showNotice(t("notice.cleared"), { clientX: 24, clientY: 80 }, { always: true });
      };
      testHooks.requestFocus = requestFocus;
      testHooks.cancelActiveTurn = cancelActiveTurn;

      testHooks.mutatedPathsOf = mutatedPathsOf;
      testHooks.sessionTitleOf = sessionTitleOf;
      testHooks.saveDigestNote = saveDigestNote;
      testHooks.summarizeWithModel = summarizeWithModel;

      function listSessions() {
        try {
          var list = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : undefined;
          if (!list || !Array.isArray(list.ids) || !list.byId) return [];
          var rows = [];
          for (var i = 0; i < list.ids.length && rows.length < 50; i++) {
            var summary = list.byId[list.ids[i]];
            if (!summary) continue;
            // ClientSessions summaries carry `id` (see api-session-controller) —
            // reading `sessionId` here silently emptied the whole picker.
            // `sessionId` stays accepted as a defensive fallback.
            var sessionId = typeof summary.id === "string" && summary.id !== "" ? summary.id
              : (typeof summary.sessionId === "string" ? summary.sessionId : "");
            if (sessionId === "") continue;
            // DSH's own rule for the sidebar is "among blank sessions, only the
            // current one"; a blank session has nothing to reference anyway, and
            // listing them produced rows whose only label was a raw session id.
            if (summary.blank === true) continue;
            var title = typeof summary.title === "string" ? summary.title : "";
            // An untitled session carries its canonical id as the title; shorten it
            // and let the timestamp beside it carry the identifying weight.
            if (title === "" || title === sessionId || title.indexOf("session-") === 0) title = sessionId.slice(0, 18);
            rows.push({
              id: sessionId,
              title: title,
              path: typeof summary.cwd === "string" ? summary.cwd : "",
              at: typeof summary.updatedAt === "number" ? summary.updatedAt : 0
            });
          }
          return rows;
        } catch (e) {
          return [];
        }
      }

      // The source conversation's title, used as the reference label: the chip
      // then reads as the real conversation name and matches one record exactly.
      function sessionTitleOf(targetSessionId) {
        try {
          var list = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : undefined;
          var summary = list && list.byId ? list.byId[targetSessionId] : undefined;
          var title = summary && typeof summary.title === "string" ? summary.title.trim() : "";
          return title === "" ? undefined : title.slice(0, 40);
        } catch (e) {
          return undefined;
        }
      }

      // Registered workspaces come from the Client workspace model; a session
      // belongs to the workspace whose path equals its cwd, so only a NEW
      // session can be placed and an existing one cannot be moved.
      function listWorkspaces() {
        try {
          var model = ctx.uiWorkspace && ctx.uiWorkspace.workspaces;
          var snapshot = model && model.list && typeof model.list.getSnapshot === "function" ? model.list.getSnapshot() : undefined;
          var items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
          return items.map(function (w) {
            return {
              id: w.workspaceId,
              title: typeof w.title === "string" && w.title !== "" ? w.title : w.workspaceId,
              path: typeof w.path === "string" ? w.path : "",
              sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds : []
            };
          });
        } catch (e) {
          return [];
        }
      }
      // Register a directory as a workspace (Add workspace), then hand it back
      // as a picker row. The directory picker is owned by uiWorkspace.
      function pickWorkspace() {
        return ctx.uiWorkspace.pickDirectory().then(function (path) {
          if (typeof path !== "string" || path.trim() === "") {
            throw new Error("no directory selected");
          }
          return ctx.remote.workspace.create({ path: path }).then(function (result) {
            if (!result || result.ok === false) {
              throw new Error((result && result.error && result.error.message) || "workspace create failed");
            }
            var w = result.value && result.value.workspace;
            if (!w || typeof w.workspaceId !== "string") {
              throw new Error("workspace create returned no workspace");
            }
            return {
              id: w.workspaceId,
              title: typeof w.title === "string" && w.title !== "" ? w.title : w.workspaceId,
              path: typeof w.path === "string" ? w.path : path,
              sessionIds: []
            };
          });
        });
      }

      // The turnTail slot hands over a Turn record (`{turn, start, end, ...}`),
      // never a bare number, and the original prompt text lives in the Chat
      // target's own node store — read both here so the component stays dumb.
      function chatSnapshotOf(targetSessionId) {
        try {
          var binding = ctx.uiConversation && typeof ctx.uiConversation.binding === "function"
            ? ctx.uiConversation.binding(targetSessionId)
            : undefined;
          var target = binding && typeof binding.target === "function" ? binding.target("chat") : undefined;
          return target && typeof target.getSnapshot === "function" ? target.getSnapshot() : undefined;
        } catch (e) {
          return undefined;
        }
      }
      function userTextOf(targetSessionId, turnNumber) {
        try {
          var snapshot = chatSnapshotOf(targetSessionId);
          if (!snapshot || !snapshot.locations || !snapshot.nodes) return "";
          var keys = typeof snapshot.locations.getTurn === "function" ? (snapshot.locations.getTurn(turnNumber) || []) : [];
          for (var i = 0; i < keys.length; i++) {
            var node = snapshot.nodes.get(keys[i]);
            if (!node || node.kind !== "user" || !node.data || !Array.isArray(node.data.content)) continue;
            var parts = [];
            for (var j = 0; j < node.data.content.length; j++) {
              var block = node.data.content[j];
              if (block && block.type === "text" && typeof block.text === "string") parts.push(block.text);
            }
            if (parts.length > 0) return parts.join("\n");
          }
          return "";
        } catch (e) {
          return "";
        }
      }

      function userContentOf(targetSessionId, turnNumber) {
        try {
          var snapshot = chatSnapshotOf(targetSessionId);
          if (!snapshot || !snapshot.locations || !snapshot.nodes) return [];
          var keys = typeof snapshot.locations.getTurn === "function" ? (snapshot.locations.getTurn(turnNumber) || []) : [];
          for (var i = 0; i < keys.length; i++) {
            var node = snapshot.nodes.get(keys[i]);
            if (!node || node.kind !== "user" || !node.data || !Array.isArray(node.data.content)) continue;
            return node.data.content.slice();
          }
          return [];
        } catch (e) {
          return [];
        }
      }

      function assistantTextOf(targetSessionId, turnNumber) {
        try {
          var snapshot = chatSnapshotOf(targetSessionId);
          if (!snapshot || !snapshot.locations || !snapshot.nodes) return "";
          var keys = typeof snapshot.locations.getTurn === "function" ? (snapshot.locations.getTurn(turnNumber) || []) : [];
          var text = "";
          for (var i = 0; i < keys.length; i++) {
            var node = snapshot.nodes.get(keys[i]);
            if (!node || node.kind !== "assistant-step" || !node.data || !Array.isArray(node.data.blocks)) continue;
            var parts = [];
            for (var j = 0; j < node.data.blocks.length; j++) {
              var block = node.data.blocks[j];
              if (block && block.kind === "text" && typeof block.text === "string" && block.text.trim() !== "") parts.push(block.text);
            }
            // The final assistant step is the visible answer; earlier steps are tool-loop text.
            if (parts.length > 0) text = parts.join("\n");
          }
          return text;
        } catch (e) {
          return "";
        }
      }
      // Notes are a central page of their own, exactly like the Plugins page: the
      // `main` keyed slot renders whichever `panelInfo.activePanelId` names, so
      // `layout.selectPanel(<our key>)` swaps the conversation out for this page.
      var NOTES_PANEL = "history-actions-notes";
      function NotesPage(props) {
        var t = props.t;
        var notes = (0, react.useState)(function () { return readNotes(); });
        var setNotes = notes[1];
        var text = (0, react.useState)("");
        var setText = text[1];
        var search = (0, react.useState)("");
        var setSearch = search[1];
        var importOpen = (0, react.useState)(false);
        var setImportOpen = importOpen[1];
        var importText = (0, react.useState)("");
        var setImportText = importText[1];
        var clipOpen = (0, react.useState)(false);
        var setClipOpen = clipOpen[1];
        var clipText = (0, react.useState)("");
        var setClipText = clipText[1];
        var tagFilter = (0, react.useState)("");
        var setTagFilter = tagFilter[1];
        var tagEditing = (0, react.useState)("");
        var setTagEditing = tagEditing[1];
        var tagDraft = (0, react.useState)("");
        var setTagDraft = tagDraft[1];
        var editingId = (0, react.useState)("");
        var setEditingId = editingId[1];
        var editDraft = (0, react.useState)("");
        var setEditDraft = editDraft[1];
        var searchRef = (0, react.useRef)(null);
        // Ctrl/⌘+F focuses this page's own search box while the page is mounted.
        (0, react.useEffect)(function () {
          if (pendingNotesSearch && searchRef.current && typeof searchRef.current.focus === "function") {
            pendingNotesSearch = false;
            searchRef.current.focus();
          }
          // 笔记关掉时，那个跨函数的搜索请求绝不能留着（设计稿 §5.3：陈旧 flag 会被下一次
          // 打开带出来）。`pendingNotesSearch` 是模块级变量，这里是它唯一的消费点。
          if (!featureEnabled("featureNotes")) pendingNotesSearch = false;
          if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
          function onKey(ev) {
            if (!(ev.metaKey || ev.ctrlKey)) return;
            if (ev.key !== "f" && ev.key !== "F") return;
            ev.preventDefault();
            var node = searchRef.current;
            if (node && typeof node.focus === "function") node.focus();
          }
          document.addEventListener("keydown", onKey, true);
          return function () { document.removeEventListener("keydown", onKey, true); };
        }, []);
        /**
         * Persist AND mirror: the list the panel shows must be the list storage holds.
         * On failure the user hears about it instead of reading "saved" over nothing.
         */
        function persistNotes(next) {
          var result = writeNotes(next);
          setNotes(result.list);
          if (!result.ok) {
            showNotice(t("notes.writeFailed") + " " + (result.error || ""), { clientX: 24, clientY: 24 }, { always: true });
          } else if (result.dropped > 0) {
            showNotice(t("notes.dropped", { count: result.dropped }), { clientX: 24, clientY: 24 });
          }
          return result;
        }
        function add() {
          var value = text[0].trim();
          if (value === "") return;
          var next = readNotes();
          next.push({
            id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: value,
            at: Date.now()
          });
          persistNotes(next);
          setText("");
        }
        /** Append one note from text and report what was actually stored. */
        function addText(value) {
          var v = String(value == null ? "" : value).trim();
          if (v === "") {
            showNotice(t("notes.clipboardEmpty"), { clientX: 24, clientY: 24 }, { always: true });
            return false;
          }
          var next = readNotes();
          next.push({
            id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: v,
            at: Date.now()
          });
          var stored = persistNotes(next);
          if (stored.ok) {
            showNotice(t("notes.clipboardSaved") + " · " + t("notes.stored", { count: stored.list.length }), { clientX: 24, clientY: 24 }, { always: true });
          }
          return stored.ok;
        }
        /**
         * One click: read the clipboard. When the browser refuses (permission, or a
         * platform without the async clipboard), open a paste box instead of doing
         * nothing — the user still gets the note they asked for.
         */
        function fromClipboard() {
          var nav = typeof navigator === "undefined" ? null : navigator;
          var fallback = function () { setClipOpen(true); setClipText(""); };
          if (nav && nav.clipboard && typeof nav.clipboard.readText === "function") {
            nav.clipboard.readText().then(function (value) {
              if (String(value == null ? "" : value).trim() === "") {
                showNotice(t("notes.clipboardEmpty"), { clientX: 24, clientY: 24 }, { always: true });
                return;
              }
              addText(value);
            }, fallback);
            return;
          }
          fallback();
        }
        function saveClipboardText() {
          if (addText(clipText[0])) {
            setClipText("");
            setClipOpen(false);
          }
        }
        function remove(id) {
          var next = readNotes().filter(function (entry) { return entry.id !== id; });
          writeNotes(next);
          setNotes(next);
        }
        function copy(entry) {
          var done = function () { showNotice(t("notes.copied"), { clientX: 24, clientY: 24 }); };
          var failed = function (e) {
            showNotice(t("notes.copyFailed") + " " + String((e && e.message) || e || ""), { clientX: 24, clientY: 24 });
          };
          try {
            if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
              // `.then(done, done)` reported success for a rejected write — the same mistake
              // `exportAll` right below has always avoided.
              navigator.clipboard.writeText(entry.text).then(done, failed);
              return;
            }
          } catch (e) {
            failed(e);
            return;
          }
          failed("clipboard unavailable");
        }
        function back() {
          if (typeof props.selectPanel === "function") props.selectPanel(null);
        }
        // "Summarize this conversation into a note": a factual digest, appended
        // through the same merge path as an import (so duplicates are skipped).
        // Portability: notes live in this browser only, so the page can hand them
        // out (and take them back) as JSON — that is what survives a new machine.
        function exportAll() {
          var payload = JSON.stringify(readNotes());
          var ok = function () { showNotice(t("notes.exported"), { clientX: 24, clientY: 24 }); };
          var no = function () { showNotice(t("notes.exportFailed"), { clientX: 24, clientY: 24 }); };
          try {
            if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
              navigator.clipboard.writeText(payload).then(ok, no);
              return;
            }
          } catch (e) {
            /* fall through */
          }
          no();
        }
        function doImport() {
          var raw = importText[0].trim();
          if (raw === "") return;
          var merged = mergeNotes(readNotes(), raw);
          var stored = persistNotes(merged.list);
          setImportText("");
          setImportOpen(false);
          // Report what is ACTUALLY stored, not what the merge produced: the cap applies on
          // write, so "imported 400" over 300 stored rows was a plain lie.
          showNotice(
            t("notes.imported") + " · " + t("notes.stored", { count: stored.list.length })
              + (stored.dropped > 0 ? " · " + t("notes.dropped", { count: stored.dropped }) : ""),
            { clientX: 24, clientY: 24 }
          );
        }
        function setTags(id, tags) {
          var next = readNotes().map(function (entry) {
            if (entry.id !== id) return entry;
            return { id: entry.id, text: entry.text, at: entry.at, tags: normalizeTags(tags) };
          });
          persistNotes(next);
        }
        function startEdit(entry) {
          setEditingId(entry.id);
          setEditDraft(entry.text);
        }
        function saveEdit(id) {
          var value = editDraft[0].trim();
          if (value === "") {
            // Silently returning here looked exactly like a broken Save button.
            showNotice(t("notes.emptyEdit"), { clientX: 24, clientY: 24 });
            return;
          }
          var next = readNotes().map(function (entry) {
            if (entry.id !== id) return entry;
            // `editedAt` used to be written here and read nowhere — dead state in every row.
            return { id: entry.id, text: value, at: entry.at, tags: normalizeTags(entry.tags) };
          });
          var stored = persistNotes(next);
          setEditingId("");
          setEditDraft("");
          if (stored.ok) showNotice(t("notes.edited"), { clientX: 24, clientY: 24 });
        }
        function commitTagDraft(id) {
          var entry = null;
          for (var i = 0; i < notes[0].length; i++) if (notes[0][i].id === id) entry = notes[0][i];
          if (entry !== null) setTags(id, normalizeTags(entry.tags).concat(normalizeTags(tagDraft[0])));
          setTagDraft("");
          setTagEditing("");
        }
        function dropTag(id, tag) {
          var entry = null;
          for (var i = 0; i < notes[0].length; i++) if (notes[0][i].id === id) entry = notes[0][i];
          if (entry === null) return;
          setTags(id, normalizeTags(entry.tags).filter(function (value) { return value !== tag; }));
        }
        var tags = allTags(notes[0]);
        var activeTag = activeTagOf(notes[0], tagFilter[0]);
        var query = search[0].trim().toLowerCase();
        var rows = filterNotes(notes[0], query, activeTag);
        return (0, react_jsx_runtime.jsxs)("div", {
          style: { boxSizing: "border-box", height: "100%", display: "flex", flexDirection: "column", gap: "16px", padding: "0 32px 32px", overflow: "auto", color: "var(--dsw-alias-label-primary)" },
          children: [
            // ── 「笔记」关掉时，页面自己明说（"关闭必须可见"）────────────────────────
            !featureEnabled("featureNotes") ? (0, react_jsx_runtime.jsx)("div", {
              style: { marginTop: "14px", padding: "10px 12px", borderRadius: "8px", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-state-error-primary)", fontSize: "13px", lineHeight: "20px", flex: "0 0 auto" },
              children: t("feature.notesOffBanner")
            }) : null,
            (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", paddingTop: "28px", flex: "0 0 auto" },
              children: [
                (0, react_jsx_runtime.jsxs)("div", {
                  children: [
                    (0, react_jsx_runtime.jsx)("h1", {
                      style: { margin: 0, fontSize: "20px", fontWeight: 500, lineHeight: "28px" },
                      children: t("notes.title")
                    }),
                    (0, react_jsx_runtime.jsx)("p", {
                      style: { margin: "4px 0 0", fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" },
                      children: t("notes.pageHint")
                    })
                  ]
                }),
                (0, react_jsx_runtime.jsx)(primitives.Button, {
                  variant: "outline",
                  onClick: back,
                  children: t("notes.back")
                })
              ]
            }),
            (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", flexDirection: "column", gap: "8px", flex: "0 0 auto", width: "100%", maxWidth: "880px" },
              children: [
                (0, react_jsx_runtime.jsx)("textarea", {
                  value: text[0],
                  placeholder: t("notes.placeholder"),
                  onChange: function (e) { setText(e.target.value); },
                  style: notesPageInputStyle
                }),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" },
                  children: [
                    (0, react_jsx_runtime.jsx)(primitives.Button, {
                      variant: "outline",
                      onClick: fromClipboard,
                      children: t("notes.fromClipboard")
                    }),
                    (0, react_jsx_runtime.jsx)(primitives.Button, {
                      variant: "primary",
                      disabled: text[0].trim() === "",
                      onClick: add,
                      children: t("notes.add")
                    })
                  ]
                })
              ]
            }),
            (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", alignItems: "center", gap: "8px", width: "100%", maxWidth: "880px", flex: "0 0 auto" },
              children: [
                (0, react_jsx_runtime.jsx)("input", {
                  ref: searchRef,
                  value: search[0],
                  placeholder: t("notes.search"),
                  onChange: function (e) { setSearch(e.target.value); },
                  style: notesSearchStyle
                }),
                search[0] === "" ? null : (0, react_jsx_runtime.jsx)("button", {
                  type: "button",
                  onClick: function () { setSearch(""); },
                  style: notesMiniButtonStyle,
                  children: t("notes.clear")
                }),
                (0, react_jsx_runtime.jsx)("button", {
                  type: "button",
                  onClick: exportAll,
                  style: notesMiniButtonStyle,
                  children: t("notes.export")
                }),
                (0, react_jsx_runtime.jsx)("button", {
                  type: "button",
                  onClick: function () { setImportOpen(!importOpen[0]); },
                  style: notesMiniButtonStyle,
                  children: t("notes.import")
                }),

              ]
            }),
            importOpen[0] ? (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "880px", flex: "0 0 auto" },
              children: [
                (0, react_jsx_runtime.jsx)("div", {
                  style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
                  children: t("notes.importHint")
                }),
                (0, react_jsx_runtime.jsx)("textarea", {
                  value: importText[0],
                  onChange: function (e) { setImportText(e.target.value); },
                  style: notesImportStyle
                }),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
                  children: [
                    (0, react_jsx_runtime.jsx)(primitives.Button, {
                      variant: "outline",
                      onClick: function () { setImportOpen(false); },
                      children: t("notes.importCancel")
                    }),
                    (0, react_jsx_runtime.jsx)(primitives.Button, {
                      variant: "primary",
                      disabled: importText[0].trim() === "",
                      onClick: doImport,
                      children: t("notes.importConfirm")
                    })
                  ]
                })
              ]
            }) : null,
            clipOpen[0] ? (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "880px", flex: "0 0 auto" },
              children: [
                (0, react_jsx_runtime.jsx)("div", {
                  style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-warn-primary)" },
                  children: t("notes.clipboardFailed")
                }),
                (0, react_jsx_runtime.jsx)("textarea", {
                  value: clipText[0],
                  onChange: function (e) { setClipText(e.target.value); },
                  placeholder: t("notes.clipboardHint"),
                  style: notesImportStyle
                }),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
                  children: [
                    (0, react_jsx_runtime.jsx)(primitives.Button, {
                      variant: "outline",
                      onClick: function () { setClipOpen(false); setClipText(""); },
                      children: t("notes.clipboardCancel")
                    }),
                    (0, react_jsx_runtime.jsx)(primitives.Button, {
                      variant: "primary",
                      disabled: clipText[0].trim() === "",
                      onClick: saveClipboardText,
                      children: t("notes.clipboardSave")
                    })
                  ]
                })
              ]
            }) : null,
            (0, react_jsx_runtime.jsx)("div", {
              style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", flex: "0 0 auto" },
              children: t("notes.count", { shown: rows.length, total: notes[0].length }) + (activeTag === "" ? "" : " · " + t("notes.tagFiltered") + " #" + activeTag)
            }),
            tags.length === 0 ? null : (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", flex: "0 0 auto" },
              children: [
                (0, react_jsx_runtime.jsx)("span", {
                  style: noteTagChipStyle(activeTag === ""),
                  onClick: function () { setTagFilter(""); },
                  children: t("notes.tagAll")
                }, "all"),
                tags.map(function (row) {
                  return (0, react_jsx_runtime.jsxs)("span", {
                    style: noteTagChipStyle(activeTag === row.tag),
                    onClick: function () { setTagFilter(activeTag === row.tag ? "" : row.tag); },
                    children: ["#" + row.tag + " " + row.count]
                  }, row.tag);
                })
              ]
            }),
            rows.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
              style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "20px" },
              children: query === "" && activeTag === "" ? t("notes.empty") : t("notes.noMatch")
            }) : (0, react_jsx_runtime.jsx)("div", {
              style: { display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "880px" },
              children: rows.map(function (entry) {
                return (0, react_jsx_runtime.jsxs)("div", {
                  style: notesRowStyle,
                  children: [
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { flex: "1 1 auto", minWidth: 0, wordBreak: "break-word", fontSize: "14px", lineHeight: "22px", color: "var(--dsw-alias-label-primary)" },
                      children: [
                        editingId[0] === entry.id ? (0, react_jsx_runtime.jsx)("textarea", {
                          value: editDraft[0],
                          rows: 6,
                          onChange: function (e) { setEditDraft(e.target.value); },
                          onKeyDown: function (e) {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(entry.id);
                            if (e.key === "Escape") { setEditingId(""); setEditDraft(""); }
                          },
                          style: {
                            width: "100%",
                            boxSizing: "border-box",
                            background: "var(--dsw-alias-bg-layer-1)",
                            color: "var(--dsw-alias-label-primary)",
                            border: "0.5px solid var(--dsw-alias-border-l4)",
                            borderRadius: "var(--dsw-radius-lg)",
                            padding: "8px 10px",
                            font: "inherit",
                            fontSize: "14px",
                            lineHeight: "22px",
                            minHeight: "96px",
                            resize: "vertical"
                          }
                        }, "editbody") : (0, react_jsx_runtime.jsx)(MarkdownBody, { text: entry.text }, "body"),
                        editingId[0] === entry.id ? (0, react_jsx_runtime.jsxs)("div", {
                          style: { display: "flex", gap: "6px", marginTop: "6px", alignItems: "center" },
                          children: [
                            (0, react_jsx_runtime.jsx)("button", {
                              type: "button",
                              style: notesMiniButtonStyle,
                              onClick: function () { saveEdit(entry.id); },
                              children: t("notes.editSave")
                            }, "save"),
                            (0, react_jsx_runtime.jsx)("button", {
                              type: "button",
                              style: notesMiniButtonStyle,
                              onClick: function () { setEditingId(""); setEditDraft(""); },
                              children: t("notes.editCancel")
                            }, "cancel"),
                            (0, react_jsx_runtime.jsx)("span", {
                              style: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)" },
                              children: t("notes.editHint")
                            }, "hint")
                          ]
                        }) : null,
                        (0, react_jsx_runtime.jsxs)("div", {
                          style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px", alignItems: "center" },
                          children: [
                            normalizeTags(entry.tags).map(function (tag) {
                              return (0, react_jsx_runtime.jsxs)("span", {
                                style: noteTagChipStyle(activeTag === tag),
                                onClick: function () { setTagFilter(activeTag === tag ? "" : tag); },
                                children: [
                                  "#" + tag,
                                  (0, react_jsx_runtime.jsx)("span", {
                                    style: { marginLeft: "3px", color: "var(--dsw-alias-label-tertiary)" },
                                    onClick: function (ev) { ev.stopPropagation(); dropTag(entry.id, tag); },
                                    children: "×"
                                  }, "x")
                                ]
                              }, tag);
                            }),
                            tagEditing[0] === entry.id ? (0, react_jsx_runtime.jsxs)("span", {
                              style: { display: "inline-flex", alignItems: "center", gap: "4px" },
                              children: [
                                (0, react_jsx_runtime.jsx)("input", {
                                  value: tagDraft[0],
                                  autoFocus: true,
                                  placeholder: t("notes.tagPlaceholder"),
                                  onChange: function (e) { setTagDraft(e.target.value); },
                                  onKeyDown: function (e) {
                                    if (e.key === "Enter") commitTagDraft(entry.id);
                                    if (e.key === "Escape") { setTagDraft(""); setTagEditing(""); }
                                  },
                                  style: Object.assign({}, notesSearchStyle, { width: "130px", fontSize: "11px", padding: "2px 6px" })
                                }, "taginput"),
                                (0, react_jsx_runtime.jsx)("button", {
                                  type: "button",
                                  style: notesMiniButtonStyle,
                                  onClick: function () { commitTagDraft(entry.id); },
                                  children: t("notes.tagConfirm")
                                }, "ok"),
                                (0, react_jsx_runtime.jsx)("button", {
                                  type: "button",
                                  style: notesMiniButtonStyle,
                                  onClick: function () { setTagDraft(""); setTagEditing(""); },
                                  children: t("notes.tagCancel")
                                }, "cancel")
                              ]
                            }) : (0, react_jsx_runtime.jsxs)("span", {
                              style: { display: "inline-flex", alignItems: "center", gap: "8px" },
                              children: [
                                (0, react_jsx_runtime.jsx)("span", {
                                  style: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)", cursor: "pointer", padding: "1px 4px" },
                                  onClick: function () { startEdit(entry); },
                                  children: "✎ " + t("notes.edit")
                                }, "editbtn"),
                                (0, react_jsx_runtime.jsx)("span", {
                                  style: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)", cursor: "pointer", padding: "1px 4px" },
                                  onClick: function () { setTagDraft(""); setTagEditing(entry.id); },
                                  children: "＋" + t("notes.tagAdd")
                                }, "addtag")
                              ]
                            })
                          ]
                        })
                      ]
                    }),
                    (0, react_jsx_runtime.jsx)("button", {
                      type: "button",
                      onClick: function () { copy(entry); },
                      style: notesMiniButtonStyle,
                      children: t("notes.copy")
                    }),
                    (0, react_jsx_runtime.jsx)("button", {
                      type: "button",
                      onClick: function () { remove(entry.id); },
                      style: notesMiniButtonStyle,
                      children: t("notes.delete")
                    })
                  ]
                }, entry.id);
              })
            }),
            (0, react_jsx_runtime.jsx)("div", {
              style: { marginTop: "auto", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)" },
              children: buildStatus()
            })
          ]
        });
      }

      // Sidebar-foot entry point: opening the page is a panel selection, not a modal.
      function NotesAction(props) {
        var t = props.t;
        var wide = props.wide === true;
        // 「笔记」总开关：侧栏按钮保留，关掉时变灰并在点击时明说。
        var notesOn = featureEnabled("featureNotes");
        return (0, react_jsx_runtime.jsx)("button", {
          type: "button",
          title: notesOn ? t("notes.title") : t("feature.disabled", { name: t("feature.nameNotes") }),
          onClick: function () {
            if (!featureEnabled("featureNotes")) {
              showNotice(t("feature.disabled", { name: t("feature.nameNotes") }), { clientX: 24, clientY: 80 });
              return;
            }
            props.openNotes();
          },
          style: notesOn
            ? (wide ? notesButtonStyle : Object.assign({}, notesButtonStyle, { justifyContent: "center" }))
            : (wide ? Object.assign({}, notesButtonStyle, { opacity: 0.45 }) : Object.assign({}, notesButtonStyle, { justifyContent: "center", opacity: 0.45 })),
          children: [
            (0, react_jsx_runtime.jsx)(primitives.IconListPenOutlineRegular, {}),
            wide ? (0, react_jsx_runtime.jsx)("span", { children: t("notes.title") }) : null
          ]
        });
      }

      guard.slots.injectIf("featureTurnActions", "conversation.chat.turnTail", function () {
        return ctx.slots.register({
          name: "conversation.chat.turnTail",
          id: "history-actions",
          order: 5,
          locale: NS,
          inject: function (sessionId) {
            return {
              sessionId: sessionId,
              forkBefore: function (boundary) { return doFork(sessionId, boundary); },
              forkAt: function (atSeq) { return doFork(sessionId, atSeq); },
              resend: function (boundary, text, info) { return doResend(sessionId, boundary, text, info); },
              cancelTurn: function () { return cancelActiveTurn(sessionId); },
              listPresets: function () { return listPresets(); },
              listSessions: function () { return listSessions(); },
              listWorkspaces: function () { return listWorkspaces(); },
              pickWorkspace: function () { return pickWorkspace(); },
              userText: function (turnNumber) { return userTextOf(sessionId, turnNumber); },
              userContent: function (turnNumber) { return userContentOf(sessionId, turnNumber); },
              assistantText: function (turnNumber) { return assistantTextOf(sessionId, turnNumber); },
              archiveSession: function (targetSessionId) { return ctx.uiWorkspace.archiveSession(targetSessionId); },
              createWithMode: function (sourceId, presetId, workspaceId, text) {
                return createWithMode(typeof sourceId === "string" && sourceId !== "" ? sourceId : sessionId, presetId, workspaceId, text);
              }
            };
          }
        }, HistoryTurnActions);
      });

      // The central page itself: a fresh `main` key beside `conversation`/`plugins`.
      guard.slots.injectIf("featureNotes", "main", function () {
        return ctx.slots.register({
          name: "main",
          key: NOTES_PANEL,
          locale: NS,
          inject: function () {
            return {
              selectPanel: function (panelId) { ctx.layout.selectPanel(panelId); }
            };
          }
        }, NotesPage);
      });

      // Editable application commands: they appear in DSH's own shortcut panel
      // (`shortcuts.open`, default ⌘/) where the user can rebind them, and the
      // override is persisted by DSH itself. `registerFixed` would make them
      // read-only, which is the opposite of what we want here.
      function installShortcuts() {
        if (!ctx.shortcuts || typeof ctx.shortcuts.register !== "function") return function () {};
        var disposers = [];
        // `defaults` must be an OBJECT — the service reads `defaults['desktop:macos']`
        // while walking the profiles, so an absent `defaults` throws. The documented
        // rule is that an omitted PROFILE is unbound, so `{}` means "every profile
        // unbound": no combination is claimed, no overlap with another plugin's
        // default (that is what the settings status caught), and the command is
        // still listed in ⌘/ for the user to assign.
        /**
         * Default key bindings for "find in this conversation".
         *
         * `mod+f` is free in DSH (no package binds it), but a browser uses it for its own
         * find — hence `primary+alt` on the web targets, the convention DSH itself uses for
         * shortcuts a browser would otherwise swallow.
         */
        var FIND_KEY_DEFAULTS = {
          "desktop:macos": { code: "KeyF", modifiers: ["primary"] },
          "desktop:windows": { code: "KeyF", modifiers: ["primary"] },
          "desktop:linux": { code: "KeyF", modifiers: ["primary"] },
          "web:macos": { code: "KeyF", modifiers: ["primary", "alt"] },
          "web:windows": { code: "KeyF", modifiers: ["primary", "alt"] }
        };
        /** 真正注册一条命令（基础设施：`deepworker.reload` 走这条，任何开关都挡不掉）。 */
        var declare = function (id, label, aliases, run, defaults) {
          var command = {
            id: id,
            label: label,
            aliases: aliases,
            defaults: defaults || {},
            regions: ["page", "editable"],
            modals: [],
            resolve: function () { return { status: "handled", run: run }; }
          };
          try {
            disposers.push(ctx.shortcuts.register(command));
            shortcutStatus[id] = "ok";
          } catch (e) {
            // Never silent: the settings page prints this.
            shortcutStatus[id] = "failed: " + String((e && e.message) || e);
          }
        };
        /**
         * 只在 `featureKey` **已引入**时才注册的命令 = 设计稿的"引入 / 移除"。
         *
         * ⚠️ 与旧的"注册了但 `resolve()` 返回 unhandled"是**两件事**：那时按键会落到
         * `showNotice` 上（入口还在、只是点不动、还占着 ⌘/ 面板里的一行），现在命令根本
         * 不存在 —— 入口**消失**。代价：apply 时求值 ⇒ 改完要 Cmd+Q 重开。
         */
        var declareIf = function (featureKey, id, label, aliases, run, defaults) {
          if (!featureEnabled(featureKey)) return;
          noteContribution(featureKey);
          declare(id, label, aliases, run, defaults);
        };
        declareIf(
          "featureNotes",
          "deepworker.notes.open",
          function () { return t("notes.title"); },
          ["notes", "笔记"],
          function () { ctx.layout.selectPanel(NOTES_PANEL); },
          undefined
        );
        declareIf(
          "featureFind",
          "deepworker.find",
          function () { return t("find.button"); },
          ["find in conversation", "会话内查找", "查找"],
          function () { openFindBar(t); },
          FIND_KEY_DEFAULTS
        );
        declareIf(
          "featureDigest",
          "deepworker.digest",
          function () { return t("digest.button"); },
          ["summarize conversation", "总结对话"],
          function () {
            var result = saveDigestNote(t);
            showNotice((result.ok ? t("digest.saved") + " · " + t("digest.savedTotal") : t("digest.nothing")) + (result.ok ? " " + result.total + " " + t("notes.unit") : "") + (result.ok ? "" : "（" + (result.error || "") + "）"), { clientX: 24, clientY: 24 });
          },
          undefined
        );
        declareIf(
          "featureNotes",
          "deepworker.notes.search",
          function () { return t("notes.searchTitle"); },
          ["search notes", "搜索笔记"],
          function () {
            pendingNotesSearch = true;
            ctx.layout.selectPanel(NOTES_PANEL);
          },
          undefined
        );
        return function () {
          for (var i = 0; i < disposers.length; i++) {
            try {
              disposers[i]();
            } catch (e) {
              /* disposal is best effort */
            }
          }
        };
      }

      guard.effect(installShortcuts, "dsh-deepworker: shortcut commands");

      // Right side of the session header. `...header.actions` renders beside the
      // title; `...header.utilities` is the right-aligned group, and entries order
      // ascending, so a higher order sits further right.
      /**
       * Trigger only. The dialog is rendered by the mounted turn component through the
       * request bridge — the same path the workspace row's "new referencing chat" uses,
       * which is proven to open a `primitives.Modal` in this app.
       */
      /** Opens the in-conversation find bar. A session-level action, so it sits with the
       *  other header actions rather than behind a shortcut the user has to discover. */
      /**
       * 会话头部的**终端按钮**：一个条目，内部渲染一组按钮。
       *
       * 为什么是"一个条目内部一组按钮"而不是每个按钮一个槽位条目：`conversation.session
       * .header.utilities` 是**已声明**的槽，第三方能注册；但未声明的槽注册会抛错，而
       * "每个按钮一条注册"会在按钮增删时反复注册/注销，任何一次抛错都会变成
       * "1 entry did not activate"（App 起不来）。一个条目 + 内部 map 是结构上更小的面。
       *
       * props 由槽位框架给：`t`（locale seat）与 `sessionId` / `useSessions`（scope="session"
       * 的 standard binding）。⚠️ 拿不到 `useSessions` 时不猜：cwd 是"在哪儿跑命令"的身份，
       * 猜错 = 在别的工作区跑了一条命令，所以宁可什么都不做、只说话。
       */
      function TerminalButtonsAction(props) {
        var t = typeof props.t === "function" ? props.t : function (key) { return key; };
        var sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
        // 槽位的 standard binding 给的是 `useSessions` 这个 hook（一个选择器函数）。
        var useSessions = typeof props.useSessions === "function" ? props.useSessions : null;
        var cwd = "";
        if (useSessions !== null && sessionId !== "") {
          try {
            cwd = useSessions(function (s) { return s && s.byId && s.byId[sessionId] ? s.byId[sessionId].cwd : ""; }) || "";
          } catch (e) { cwd = ""; }
        }
        // 头部的按钮必须跟着配置变：配置在 localStorage 里，而槽位条目**不会**因为 storage
        // 变了就重绘 ⇒ 用一次 tick 在挂载后重读（与 FocusAction 的计时同一个理由）。
        var tick = (0, react.useState)(0);
        var bump = tick[1];
        var termStatusState = (0, react.useState)({});
        var termStatus = termStatusState[0];
        var setTermStatus = termStatusState[1];
        (0, react.useEffect)(function () {
          bump(1);
          if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
          var onConfig = function () { bump(function (n) { return n + 1; }); };
          try { window.addEventListener("dsh-deepworker:terminal-config", onConfig); } catch (e) { return undefined; }
          return function () { try { window.removeEventListener("dsh-deepworker:terminal-config", onConfig); } catch (e2) { /* ignore */ } };
        }, []);
        var enabled = featureEnabled("featureTerminal");
        // 2026-10-17 第 2 段：按钮按**当前会话的 cwd** 解析到一条工作区配置。
        // ⚠️ 不在列表里 ⇒ **整组不渲染**（连竖线一起消失）。这是有意的选择：
        //    头部是一条很紧的横条，给"没配置的工作区"挂一排灰按钮会让每个普通会话都多出一组
        //    看不出用途的控件。而"这个工作区还没配置"这件事**不会**变成静默失败 ——
        //    设置 → DeepWorker → 命令按钮 的页首**一直写着**当前 cwd 在不在列表里，
        //    旁边就是「把当前工作区加入列表」。
        var entry = termWorkspaceEntry(cwd);
        if (entry === null) return null;
        var buttons = wsHeaderActions(entry);
        /**
         * 一个按钮的点击：把整条前置序列 + 目标命令交给 apply 作用域的执行器。
         * 执行的每一步都会写进「调试」里那一行（lastStartDiag），失败一律说话。
         */
        function click(action) {
          if (!enabled) {
            showNotice(t("term.notIntroduced"), { clientX: 24, clientY: 80 }, { always: true });
            return;
          }
          if (typeof cwd !== "string" || cwd === "") {
            showNotice(t("term.noCwd"), { clientX: 24, clientY: 80 }, { always: true });
            return;
          }
          if (typeof testHooks.runTerminalButton !== "function") {
            // 接线断了 = 缺陷，必须说话（绝不静默 return）。
            showNotice(t("term.noRemote"), { clientX: 24, clientY: 80 }, { always: true });
            return;
          }
          var prior = termStatus[action.id];
          if (prior && prior.state === "running") {
            showNotice(t("term.alreadyRunning", { label: termActionLabel(action, t) }), { clientX: 24, clientY: 80 }, { always: true });
            return;
          }
          var started = Date.now();
          setTermStatus(function (prev) {
            var next = Object.assign({}, prev);
            next[action.id] = { state: "running", code: null, started: started };
            return next;
          });
          var pending = null;
          try {
            pending = testHooks.runTerminalButton({
              t: t,
              sessionId: sessionId,
              path: entry.path,
              actionId: action.id,
              label: termActionLabel(action, t)
            });
          } catch (e) {
            pending = Promise.reject(e);
          }
          Promise.resolve(pending).then(function (outcome) {
            var state = outcome && typeof outcome.state === "string" ? outcome.state : "failed";
            setTermStatus(function (prev) {
              var next = Object.assign({}, prev);
              next[action.id] = {
                state: state,
                code: outcome && typeof outcome.code === "number" ? outcome.code : null,
                started: started,
                duration: Date.now() - started
              };
              return next;
            });
          }, function () {
            setTermStatus(function (prev) {
              var next = Object.assign({}, prev);
              next[action.id] = { state: "failed", code: null, started: started, duration: Date.now() - started };
              return next;
            });
          });
        }
        var children = [];
        for (var b = 0; b < buttons.length; b++) {
          (function (action) {
            var label = termActionLabel(action, t);
            var hasCommand = typeof action.command === "string" && action.command !== "";
            children.push((0, react_jsx_runtime.jsx)("button", {
              type: "button",
              title: hasCommand ? action.command : t("term.emptyCommand", { label: label }),
              onClick: function () {
                if (!hasCommand) {
                  showNotice(t("term.emptyCommand", { label: label }), { clientX: 24, clientY: 80 }, { always: true });
                  return;
                }
                click(action);
              },
              style: hasCommand && enabled
                ? headerActionStyle
                : Object.assign({}, headerActionStyle, { opacity: 0.45, cursor: "default" }),
              children: [
                (0, react_jsx_runtime.jsx)("span", { children: label }, "label"),
                (0, react_jsx_runtime.jsx)("span", {
                  "data-dw-term-state": termStatus[action.id] ? termStatus[action.id].state : "idle",
                  "aria-label": termStatus[action.id] ? termStatus[action.id].state : "idle",
                  title: termStatus[action.id] && termStatus[action.id].state === "running"
                    ? t("term.stateRunning")
                    : (termStatus[action.id] && termStatus[action.id].state === "done"
                      ? t("term.stateDone")
                      : (termStatus[action.id] && termStatus[action.id].state === "error" ? t("term.stateFailed") : "")),
                  style: {
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    marginLeft: "5px",
                    borderRadius: "50%",
                    flex: "none",
                    background: termStatus[action.id] && termStatus[action.id].state === "running"
                      ? "var(--dsw-alias-state-business-primary)"
                      : (termStatus[action.id] && termStatus[action.id].state === "done"
                        ? "var(--dsw-alias-state-success-primary)"
                        : (termStatus[action.id] && termStatus[action.id].state === "error"
                          ? "var(--dsw-alias-state-error-primary)"
                          : "var(--dsw-alias-label-tertiary)"))
                  }
                }, "state")
              ]
            }, "term-" + action.id));
          })(buttons[b]);
        }
        if (children.length === 0) return null;
        // ── 竖线：让这一组在视觉上自成一组 ────────────────────────────────────────
        // 用户原话："加个竖线好，因为跟专注放一起也会引起误会"。
        // ⚠️ 只能渲染在**自己的条目**里（槽位不允许往别人的条目塞东西），所以竖线画在我们
        //    这组的**右侧**（右边邻居是专注锁 / 摘要那一串）。组消失时它跟着消失 ——
        //    它就在同一个返回节点里，没有独立的注册/生命周期。
        // ⚠️ 只用**已核实存在**的主题变量：`--dsw-alias-border-l3`（本文件已在别处使用）。
        //    本机有动态守卫（verify_primitives_props.mjs）会从 app.asar 现读合法变量集合，
        //    写一个不存在的变量会直接红。**不新增自定义 class**（控件 CSS 随 shell 发布，
        //    自定义 class 拿不到规则）。
        var separator = (0, react_jsx_runtime.jsx)("span", {
          "aria-hidden": "true",
          "data-dw-terminal-separator": "",
          style: {
            display: "inline-block",
            width: "1px",
            height: "16px",
            marginLeft: "6px",
            marginRight: "2px",
            background: "var(--dsw-alias-border-l3)",
            flex: "0 0 auto"
          }
        }, "term-separator");
        return (0, react_jsx_runtime.jsxs)("div", {
          style: { display: "flex", alignItems: "center", gap: "2px" },
          children: children.concat([separator])
        });
      }

      function FindAction(props) {
        var t = typeof props.t === "function" ? props.t : function (key) { return key; };
        // 「会话内查找」总开关：按钮**保留**（设计稿 §2.2「保留按钮 + 关掉时点它就说话」）。
        // 关掉 = 视觉上就看得出来（变灰），点它则明说，绝不静默。
        var findOn = featureEnabled("featureFind");
        return (0, react_jsx_runtime.jsx)("button", {
          type: "button",
          title: findOn ? t("find.button") : t("feature.disabled", { name: t("feature.nameFind") }),
          onClick: function () {
            if (!featureEnabled("featureFind")) {
              showNotice(t("feature.disabled", { name: t("feature.nameFind") }), { clientX: 24, clientY: 80 });
              return;
            }
            openFindBar(t);
          },
          style: findOn ? headerActionStyle : Object.assign({}, headerActionStyle, { opacity: 0.45, cursor: "default" }),
          children: (0, react_jsx_runtime.jsx)("span", { children: t("find.buttonShort") })
        });
      }

      function DigestAction(props) {
        var t = typeof props.t === "function" ? props.t : function (key) { return key; };
        var Icon = primitives.IconListPenOutlineRegular;
        var icon = typeof Icon === "function" ? (0, react_jsx_runtime.jsx)(Icon, { size: 16 }, "icon") : null;
        // 「摘要」总开关：按钮保留，关掉时变灰并在点击时明说。
        var digestOn = featureEnabled("featureDigest");
        return (0, react_jsx_runtime.jsxs)("button", {
          type: "button",
          title: digestOn ? t("digest.button") : t("feature.disabled", { name: t("feature.nameDigest") }),
          onClick: function () {
            if (!featureEnabled("featureDigest")) {
              showNotice(t("feature.disabled", { name: t("feature.nameDigest") }), { clientX: 24, clientY: 80 });
              return;
            }
            var request = { kind: "digestOptions", sessionId: activeSessionId(), claimed: false };
            publishMenuRequest(request, t);
            setTimeout(function () {
              if (request.claimed !== true) showNotice(t("digest.noHost"), { clientX: 24, clientY: 80 });
            }, 400);
          },
          style: digestOn ? headerActionStyle : Object.assign({}, headerActionStyle, { opacity: 0.45, cursor: "default" }),
          children: [icon, (0, react_jsx_runtime.jsx)("span", { children: t("digest.buttonShort") }, "label")]
        });
      }

      /**
       * 「专注」 button in the SESSION HEADER.
       *
       * This is the right place for it, and not only for discoverability: a header button belongs
       * to one session, so it locks ITSELF — no id lookup, which is what made the settings-page
       * version fail eight times. It also sends the request directly (no composer, no Enter).
       */
      function FocusAction(props) {
        var t = typeof props.t === "function" ? props.t : function (key) { return key; };
        var locked = false;
        var remainingMs = 0;
        try {
          locked = typeof testHooks.focusLockedHere === "function" ? testHooks.focusLockedHere() : false;
          remainingMs = typeof testHooks.focusRemaining === "function" ? testHooks.focusRemaining() : 0;
        } catch (e) { locked = false; remainingMs = 0; }
        var left = Math.max(0, Math.floor(remainingMs / 1000));
        var hh = Math.floor(left / 3600);
        var mm = Math.floor((left % 3600) / 60);
        var ss = left % 60;
        var pad = function (n) { return (n < 10 ? "0" : "") + n; };
        var countdown = hh > 0 ? (hh + ":" + pad(mm) + ":" + pad(ss)) : (mm + ":" + pad(ss));
        // Why a tick: React does not re-render just because the lock state (a closure variable)
        // changed, so the old label stayed "专注" after locking — the user reported exactly that.
        // One second also drives the countdown.
        var tickState = (0, react.useState)(0);
        var setTick = tickState[1];
        (0, react.useEffect)(function () {
          var timer = setInterval(function () { setTick(function (n) { return n + 1; }); }, 1000);
          return function () { clearInterval(timer); };
        }, []);
        var openState = (0, react.useState)(false);
        var open = openState[0];
        var setOpen = openState[1];
        var minutesState = (0, react.useState)(30);
        var minutes = minutesState[0];
        var setMinutes = minutesState[1];
        var scopeState = (0, react.useState)("session");
        var scope = scopeState[0];
        var setScope = scopeState[1];
        // 这个会话有工作区归属吗？没有就不提供工作区选项（宁可少一个按钮，也不给一个
        // 名义上锁工作区、实际锁会话的按钮）。渲染期读 testHooks 是本文件的既有做法。
        var canLockWorkspace = false;
        try {
          canLockWorkspace = typeof testHooks.focusHasWorkspace === "function" && testHooks.focusHasWorkspace() === true;
        } catch (e) { canLockWorkspace = false; }
        // 「专注锁」总开关：按钮保留，关掉时点它就说话（它同时是"解除专注"的出路，所以
        // 绝不能让按钮消失 —— 铁律 D：永远留一条出路）。
        var focusOn = featureEnabled("featureFocusLock");
        var defaults = focusDefaultsFrom(readSettings());
        function confirmLock() {
          setOpen(false);
          if (typeof testHooks.focusLockFor === "function") testHooks.focusLockFor(minutes, scope);
        }
        var dialog = !open ? null : (0, react_jsx_runtime.jsx)(primitives.Modal, {
          open: true,
          title: t("focus.dialogTitle"),
          closeLabel: t("common.cancel"),
          onClose: function () { setOpen(false); },
          footer: (0, react_jsx_runtime.jsx)(primitives.Button, {
            variant: "primary",
            onClick: confirmLock,
            children: t("focus.dialogConfirm")
          }),
          children: (0, react_jsx_runtime.jsxs)("div", {
            children: [
              (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", marginBottom: "10px" }, children: t("focus.dialogHint") }),
              (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" },
                children: [
                  (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }, children: t("focus.scopeLabel") }),
                  (0, react_jsx_runtime.jsx)("button", {
                    type: "button",
                    "data-ha-focus-scope": "session",
                    style: { fontSize: "12px", padding: "4px 10px", cursor: "pointer", fontWeight: scope === "session" ? 700 : 400 },
                    onClick: function () { setScope("session"); },
                    children: t("focus.scopeSession")
                  }),
                  // 工作区粒度：只有「当前会话真的属于某个工作区」时才提供这个选项（归属账
                  // 里查得到）。查不到就不显示 —— 未分组会话没有工作区可锁，显示出来只会
                  // 让用户以为自己锁了工作区，实际锁的是会话。
                  (canLockWorkspace ? (0, react_jsx_runtime.jsx)("button", {
                    type: "button",
                    "data-ha-focus-scope": "workspace",
                    style: { fontSize: "12px", padding: "4px 10px", cursor: "pointer", fontWeight: scope === "workspace" ? 700 : 400 },
                    onClick: function () { setScope("workspace"); },
                    children: t("focus.scopeWorkspace")
                  }) : null)
                ]
              }),
              (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" },
                children: [
                  (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }, children: t("focus.customLabel") }),
                  (0, react_jsx_runtime.jsx)("input", {
                    type: "number",
                    min: 1,
                    max: 10080,
                    value: String(minutes),
                    "data-ha-focus-minutes": "",
                    onChange: function (ev) {
                      var v = parseInt(String(ev.target.value), 10);
                      // An empty box must not silently lock for NaN minutes: keep the last value.
                      if (Number.isFinite(v) && v >= 1 && v <= 10080) setMinutes(v);
                    },
                    style: { width: "90px", fontSize: "12px", padding: "4px 6px", boxSizing: "border-box" }
                  }),
                  (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px" }, children: t("focus.minutesUnit") })
                ]
              }),
              (0, react_jsx_runtime.jsx)("div", {
                style: { display: "flex", gap: "8px", flexWrap: "wrap" },
                children: [15, 30, 60, 120].map(function (m) {
                  return (0, react_jsx_runtime.jsx)("button", {
                    type: "button",
                    style: { fontSize: "12px", padding: "4px 10px", cursor: "pointer", fontWeight: minutes === m ? 700 : 400 },
                    onClick: function () { setMinutes(m); },
                    children: t("focus.minutes", { n: m })
                  }, "focus-min-" + m);
                })
              })
            ]
          })
        });
        return (0, react_jsx_runtime.jsxs)("span", {
          children: [dialog, (0, react_jsx_runtime.jsxs)("button", {
          type: "button",
          title: locked ? t("focus.headerUnlock") + " · " + t("focus.remaining") + " " + countdown : t("focus.headerLock"),
          onClick: function () {
            if (locked) { if (typeof testHooks.focusUnlockLocal === "function") testHooks.focusUnlockLocal(); return; }
            // 功能关掉时**不能**打开锁定对话框（那会锁上一个"不拦任何东西"的锁 —— 说得比
            // 做得多）。按钮本身保留，因为它是"解除专注"的出路（铁律 D）。
            if (!featureEnabled("featureFocusLock")) {
              showNotice(t("feature.disabled", { name: t("feature.nameFocusLock") }), { clientX: 24, clientY: 80 });
              return;
            }
            // 默认配置开启 ⇒ 不弹窗，直接按保存的范围/时长上锁。工作区不可判定时
            // focusLockFor 会按会话回退并说话，不在这里静默改范围。
            if (defaults.enabled) {
              if (typeof testHooks.focusLockFor === "function") testHooks.focusLockFor(defaults.minutes, defaults.scope);
              return;
            }
            setOpen(true);
          },
            "data-dw-focus-default": defaults.enabled ? "1" : "0",
            style: headerActionStyle,
            children: [
              // The lock emoji is deliberately gone from THIS button (user 2026-10-13): the header
              // is a tight strip of text buttons and the word itself ("专注" / "解除专注") already
              // says it. The 🔒 in the notification body (focus.wrapBlocked / focus.wrapWorkspace)
              // and on the settings page (focus.locked) stays untouched.
              // 任务 15（用户 2026-10-13）：计时的**抖动根因**在这里 —— 这个 label 每秒重渲染一次，
              // 数字宽度的变化把整行按钮挤来挤去。只改样式、不动文案：等宽数字（tabular-nums）钉住
              // 每位数字的宽度，`min-width: 5.4em`（13px 字号下 ≈70px，按最宽形态「解除专注 12:34」
              // 估的，宁可略宽）钉住整个 label 的宽度 ⇒ 两种形态下都不会每 tick 变宽变窄。
              // `padding: 4px 0` 保留 headerActionStyle 的按钮高度（4px 6px），只把横向 padding 收掉，
              // 免得 min-width 之外再多占 12px 破坏标题栏排布。
              (0, react_jsx_runtime.jsx)("span", {
                style: { display: "inline-block", minWidth: "5.4em", padding: "4px 0", fontVariantNumeric: "tabular-nums", fontFeatureSettings: "\"tnum\"" },
                children: locked ? (t("focus.headerUnlockShort") + " " + countdown) : t("focus.headerLockShort")
              }, "label")
            ]
          })]
        });
      }

      guard.slots.injectIf("featureFocusLock", "conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "history-actions-focus",
          // 任务 15（用户 2026-10-13）：「专注」**排到这一行最前面**。它的计时文字每秒变化，
          // 放在最右会把左边的「查找 / 存为笔记」挤动；放最前则只有它自己右侧的空间在变。
          // order 值怎么定的（该槽位是跨插件共享的**升序 list**，清单是**现读 app.asar** 核实的）：
          //   `open-in-app` = -10（shipped 里最小）· `schedule-catalog` = -5 ·
          //   `session-log-download` 未写 order ⇒ 默认 0（slots 的 `options.order ?? 0`）·
          //   本插件 find = 40 / digest = 50 · `dsh-rewind-header` = 90。
          //   ⇒ 取 -12：**确实小于 -10**，又不贴边、不用极端负值、与现有值不撞。
          order: -12,
          locale: NS,
          label: function () { return focusHeaderLabel(); }
        }, FocusAction);
      });
      guard.slots.injectIf("featureTerminal", "conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "history-actions-terminal",
          // ⚠️ order 由 **-8 改成 -20**（2026-10-16 用户真机反馈，截图确认）：
          //    原来 -8 渲染在【打开】(-10) **右边**，紧挨着官方那颗按钮，看着像同一组、
          //    容易误会（用户原话："放在【打开】前面，避免引起误会，看着像一起的"）。
          //    该槽位是跨插件共享的**升序 list**（清单现读 app.asar 核实）：
          //      `open-in-app` = -10 · `schedule-catalog` = -5 · 未写 order 的默认 0 ·
          //      本插件 find = 40 / digest = 50 · `dsh-rewind-header` = 90 ·
          //      本插件 focus = -12（**未动**，其它既有值一律不动）。
          //    ⇒ 取 -20：**严格小于 -10**，所以整组排到【打开】前面，与它拉开一整个组的位置。
          //    这条由 verify_terminal_buttons.mjs 的"order < -10"断言守（改回去立刻红）。
          order: -20,
          locale: NS,
          label: function () {
            try {
              var cfg = termReadConfig(typeof testHooks.currentCwd === "function" ? testHooks.currentCwd() : "");
              var first = cfg.actions.length > 0 ? termActionLabel(cfg.actions[0], t) : t("term.buttonStart");
              return first;
            } catch (e) {
              return t("term.settingsTitle");
            }
          }
        }, TerminalButtonsAction);
      });
      guard.slots.injectIf("featureFind", "conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "history-actions-find",
          order: 40,
          locale: NS,
          label: function () { return t("find.buttonShort"); }
        }, FindAction);
      });
      guard.slots.injectIf("featureDigest", "conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "history-actions-digest",
          order: 50,
          locale: NS,
          label: function () { return t("digest.buttonShort"); }
        }, DigestAction);
      });

      /**
       * 跑一条命令按钮：按**工作区**解析出命令序列，交给执行器。
       *
       * ⚠️ 身份解析：本函数在 `apply()` 里定义，但它的调用点在**槽位条目自己的事件处理器**
       * 里 —— 那时候的 `ctx` 是**根 ctx**，于是走 `direct` 回退路径。宿主拿第一个参数
       * （会话 id）反解 Agent，会话不活跃会**自动 resume**。所以：
       *   ① 会话 id 必须**显式当第一个参数**传给 `terminal.*`；
       *   ② 拿不到会话 id 时**什么都不做、只说话** —— 不能拿"当前活跃会话"去顶替，
       *      那会在别人的会话里跑命令。
       * 副作用（用户已知）：不活跃的会话会被载入内存。
       *
       * 2026-10-17 第 2 段：配置来源从"调用方塞进来的 cwd + config"改成**按 path 读工作区表**
       * （单一事实来源）。`request.config` 仍被接受 —— 只是"该 path 还不在表里"时的兼容回退。
       */
      testHooks.runTerminalButton = function (request) {
        var t = request && typeof request.t === "function" ? request.t : function (k) { return k; };
        try {
          var sessionId = request && typeof request.sessionId === "string" ? request.sessionId : "";
          var actionId = request && typeof request.actionId === "string" ? request.actionId : "";
          var label = request && typeof request.label === "string" ? request.label : "";
          var path = wsNormalizePath(request && typeof request.path === "string" ? request.path
            : (request && typeof request.cwd === "string" ? request.cwd : ""));
          var entry = path === "" ? null : termWorkspaceEntry(path);
          if (entry === null && request && request.config) {
            // 兼容老接缝的形状：调用方直接给一份 legacy 配置（没有对应的工作区记录时）
            entry = wsEntryFromLegacy(path, request.config);
          }
          var job = entry === null ? null : termJobForEntry(entry, actionId === "" ? "start" : actionId, t);
          // 没有可跑的命令时**只说话**：静默开一个跑 `; echo` 的终端是绝不能有的形状。
          if (job === null) {
            showNotice(t("term.emptyCommand", { label: label !== "" ? label : actionId }), { clientX: 24, clientY: 80 }, { always: true });
            return Promise.resolve(null);
          }
          if (job.fatal) {
            showNotice(t("term.commandFatal", { rule: job.fatal }), { clientX: 24, clientY: 80 }, { always: true });
            return Promise.resolve(null);
          }
          if (sessionId === "") {
            showNotice(t("term.noCwd"), { clientX: 24, clientY: 80 }, { always: true });
            return Promise.resolve(null);
          }
          var terminal = ctx.remote && ctx.remote.terminal ? ctx.remote.terminal : null;
          if (terminal === null || typeof terminal.create !== "function") {
            showNotice(t("term.noRemote"), { clientX: 24, clientY: 80 }, { always: true });
            return Promise.resolve(null);
          }
          if (label === "") label = job.label;
          showNotice(t("term.starting", { command: job.commands[job.commands.length - 1].command }), { clientX: 24, clientY: 80 }, { always: true });
          var controller = typeof AbortController === "function" ? new AbortController() : null;
          return termRunSequence({
            terminal: terminal,
            t: t,
            signal: controller === null ? undefined : controller.signal,
            uuid: termNewId,
            now: function () { return new Date().toISOString(); },
            cols: 120,
            rows: 30
          }, sessionId, job).then(function (outcome) {
            lastStartDiag = termDescribeOutcome(t, outcome);
            appendTermLog({
              at: new Date().toISOString(),
              label: label,
              workspace: path,
              action: actionId === "" ? "start" : actionId,
              state: outcome && outcome.state ? outcome.state : "",
              code: outcome && typeof outcome.code === "number" ? outcome.code : null,
              output: outcome && typeof outcome.output === "string" ? outcome.output : "",
              logPath: outcome && typeof outcome.logPath === "string" ? outcome.logPath : ""
            });
            try { console.info("[dsh-deepworker] terminal " + termDescribeOutcome(t, outcome)); } catch (e) { /* console is best effort */ }
            // 失败必须可见（含原始错误）：成功 / 仍在运行各有各的话。
            if (outcome && (outcome.state === "done" || outcome.state === "running")) {
              showNotice(String(outcome.detail || ""), { clientX: 24, clientY: 80 }, { always: true });
            } else {
              showNotice(t("term.diagPrefix") + String(outcome && outcome.detail ? outcome.detail : ""), { clientX: 24, clientY: 80 }, { always: true });
            }
            return outcome;
          });
        } catch (e) {
          var message = String((e && e.message) || e);
          lastStartDiag = "THREW: " + message;
          try { console.error("[dsh-deepworker] terminal button threw: " + message); } catch (e2) { /* best effort */ }
          showNotice(t("term.unexpected", { detail: message }), { clientX: 24, clientY: 80 }, { always: true });
          return Promise.resolve(null);
        }
      };

      /**
       * 批量：勾选多个工作区，**串行**跑各自的动作（默认启动，也可以停止）。
       *
       * ── 串行还是并行？（必须写清，之后不许含糊）───────────────────────────────
       * **串行**。三条理由：
       *   ① 每会话终端上限 8（`TERM_SESSION_MAX`）⇒ N 个工作区就是 N 个终端。串行时"第几个
       *      失败"与"已经开了几个"是确定的；并行会让 create 顺序与上限判定都变成竞态。
       *   ② 用户要的是"一键启动"，而启动顺序对"先起数据库再起网关"这类拓扑是**有语义的**
       *      （列表顺序 = 执行顺序，可复验）。并行把这个语义抹掉了。
       *   ③ 失败汇总必须能说清"哪几个成功、哪几个失败"；串行天然有序，汇总与执行一一对应。
       * 代价：总耗时 = 各工作区耗时之和（每个最多等它自己的 timeoutSec）。这是明确的取舍。
       *
       * ── 失败处理 ──────────────────────────────────────────────────────────────
       * 任何一个失败 ⇒ **继续跑其余的**（不停在半路），最后**必须汇总**并逐条说出失败项。
       *
       * ── 上限 ─────────────────────────────────────────────────────────────────
       * 选中数 > 8 ⇒ **提前报错、一个终端都不创建**（不是静默截断到 8）：静默截断会让用户
       * 以为"选了 10 个都起了"，那是最坏的一种失败。
       *
       * @param {{t:Function, action:string, paths:string[], sessionId:string, onProgress:Function=}} request
       * @returns {Promise<{action:string,total:number,ok:number,failed:number,skipped:number,items:object[],refused:string,message:string}>}
       */
      testHooks.runTerminalBatch = function (request) {
        var t = request && typeof request.t === "function" ? request.t : function (k) { return k; };
        var action = request && request.action === "stop" ? "stop" : "start";
        var paths = request && Array.isArray(request.paths) ? request.paths : [];
        var sessionId = request && typeof request.sessionId === "string" ? request.sessionId : "";
        var onProgress = request && typeof request.onProgress === "function" ? request.onProgress : null;
        var summary = { action: action, total: paths.length, ok: 0, failed: 0, skipped: 0, items: [], refused: "", message: "" };
        /** 说清"为什么一个都没跑" —— 拒绝永远是可见的，绝不静默 return。 */
        function refuse(message) {
          summary.refused = message;
          summary.message = message;
          showNotice(message, { clientX: 24, clientY: 80 }, { always: true });
          return Promise.resolve(summary);
        }
        if (paths.length === 0) return refuse(t("term.batchNoSelection"));
        if (sessionId === "") return refuse(t("term.noCwd"));
        var terminal = ctx.remote && ctx.remote.terminal ? ctx.remote.terminal : null;
        if (terminal === null || typeof terminal.create !== "function") return refuse(t("term.noRemote"));
        // ⚠️ 上限前置检查：**在任何 create 之前**。一条都不创建，用户看得见原因。
        if (paths.length > TERM_SESSION_MAX) {
          return refuse(t("term.batchTooMany", { n: paths.length, max: TERM_SESSION_MAX }));
        }
        var store = wsReadAll();
        var jobs = [];
        for (var i = 0; i < paths.length; i++) {
          var entry = wsFind(store, paths[i]);
          if (entry === null) {
            summary.skipped = summary.skipped + 1;
            summary.items.push({ path: String(paths[i]), label: String(paths[i]), state: "missing", ok: false, detail: t("term.batchMissing") });
            continue;
          }
          var job = termJobForEntry(entry, action, t);
          if (job === null) {
            summary.skipped = summary.skipped + 1;
            summary.items.push({ path: entry.path, label: entry.label, state: "empty", ok: false, detail: t("term.emptyCommand", { label: entry.label }) });
            continue;
          }
          if (job.fatal) {
            summary.skipped = summary.skipped + 1;
            summary.items.push({ path: entry.path, label: entry.label, state: "fatal", ok: false, detail: t("term.commandFatal", { rule: job.fatal }) });
            continue;
          }
          jobs.push({ entry: entry, job: job });
        }
        var done = 0;
        var chain = Promise.resolve();
        for (var q = 0; q < jobs.length; q++) {
          (function (item, index) {
            chain = chain.then(function () {
              if (onProgress !== null) {
                try { onProgress(index, jobs.length, item.entry); } catch (e) { /* progress is best effort */ }
              }
              var controller = typeof AbortController === "function" ? new AbortController() : null;
              return termRunSequence({
                terminal: terminal,
                t: t,
                signal: controller === null ? undefined : controller.signal,
                uuid: termNewId,
                now: function () { return new Date().toISOString(); },
                cols: 120,
                rows: 30
              }, sessionId, item.job).then(function (outcome) {
                done = done + 1;
                // ⚠️「done」≠「成功」：`termRunSequence` 把"命令跑完了"统一记成 state=done，
                //    退出码非 0 也是 done（文案走 term.doneFail）。批量的成功判据只有两种：
                //    **退出码 0**，或者"仍在运行"（常驻服务不可能是"完成"）。
                //    把 done 直接当成功 = 用户的启动失败被记账成成功（最坏的一种谎）。
                appendTermLog({
                  at: new Date().toISOString(),
                  label: item.entry.label,
                  workspace: item.entry.path,
                  action: action,
                  state: outcome && outcome.state ? outcome.state : "",
                  code: outcome && typeof outcome.code === "number" ? outcome.code : null,
                  output: outcome && typeof outcome.output === "string" ? outcome.output : "",
                  logPath: outcome && typeof outcome.logPath === "string" ? outcome.logPath : ""
                });
                var ok = outcome !== null && outcome !== undefined
                  && (outcome.state === "running" || (outcome.state === "done" && outcome.code === 0));
                summary.items.push({
                  path: item.entry.path,
                  label: item.entry.label,
                  state: outcome && outcome.state ? outcome.state : "error",
                  ok: ok,
                  detail: outcome && outcome.detail ? String(outcome.detail) : ""
                });
                if (ok) summary.ok = summary.ok + 1;
                else {
                  summary.failed = summary.failed + 1;
                  // 失败必须**立刻可见**（用户可能在等）。页面上的汇总在结束时会再写一次。
                  try {
                    showNotice(t("term.batchItemFailed", { label: item.entry.label, detail: outcome && outcome.detail ? String(outcome.detail) : "" }), { clientX: 24, clientY: 80 }, { always: true });
                  } catch (e) { /* notice is best effort */ }
                }
                if (onProgress !== null) {
                  try { onProgress(done, jobs.length, item.entry); } catch (e) { /* progress is best effort */ }
                }
                return null;
              }, function (error) {
                // termRunSequence 自己不会 reject，但**绝不能**因为一个意外 reject 把整批断掉
                done = done + 1;
                summary.failed = summary.failed + 1;
                appendTermLog({
                  at: new Date().toISOString(), label: item.entry.label, workspace: item.entry.path,
                  action: action, state: "error", code: null, output: "", logPath: ""
                });
                summary.items.push({ path: item.entry.path, label: item.entry.label, state: "error", ok: false, detail: String((error && error.message) || error) });
                return null;
              });
            });
          })(jobs[q], q);
        }
        return chain.then(function () {
          // ⚠️ 先落到一个**本地变量**再通知：`verify_notice_text` 的形状表锚在"实参怎么来"上，
          //    直接传 `summary.message` 既没有形状可认、读起来也不像"一句话"。
          var batchText = termBatchMessage(t, summary);
          summary.message = batchText;
          showNotice(batchText, { clientX: 24, clientY: 80 }, { always: true });
          return summary;
        });
      };

      /** 当前会话 id（批量执行的身份）。拿不到返回 "" —— 调用方必须只说话。 */
      testHooks.currentSessionId = function () {
        try {
          var main = ctx.uiWorkspace && ctx.uiWorkspace.mainReference;
          return main && typeof main.sessionId === "string" ? main.sessionId : "";
        } catch (e) {
          return "";
        }
      };

      /**
       * 目录选择器（可选能力）。
       * ⚠️ **不新增任何 `dsh.client.inject` 依赖**：remote 命名空间在没注入时直接不存在，
       * 所以这里只做**机会性**调用 —— 不可用就返回 null（UI 退回纯输入框 + 校验）。
       * 把可选能力做成"没有就换一种输入"，而不是"没有就崩"。
       */
      testHooks.pickDirectory = function () {
        try {
          // Host-owned picker (the uiWorkspace service). It is present even when the
          // optional remote.directoryPicker namespace was never injected — which is the
          // normal case here, and why the old seam always answered "no picker".
          if (ctx.uiWorkspace && typeof ctx.uiWorkspace.pickDirectory === "function") {
            var selected = ctx.uiWorkspace.pickDirectory();
            if (selected !== null && typeof selected === "object" && typeof selected.then === "function") {
              return selected.then(function (value) {
                if (typeof value === "string") return value;
                if (value && typeof value.path === "string") return value.path;
                if (value && value.value && typeof value.value.path === "string") return value.value.path;
                return "";                       // null / cancel: not "unavailable"
              }, function () { return ""; });
            }
          }
          var picker = ctx.remote && ctx.remote.directoryPicker ? ctx.remote.directoryPicker : null;
          if (picker === null || typeof picker.pick !== "function") return null;
          var result = picker.pick({ path: "" });
          if (result === null || typeof result !== "object" || typeof result.then !== "function") return null;
          return result.then(function (value) {
            if (typeof value === "string") return value;
            if (value && typeof value.path === "string") return value.path;
            if (value && value.value && typeof value.value.path === "string") return value.value.path;
            return "";
          }, function () { return ""; });
        } catch (e) {
          return null;
        }
      };

      testHooks.lastStartDiagOnce = function () { return lastStartDiag; };

      guard.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "history-actions",
          order: 25,
          locale: NS,
          label: t("settings.title")
        }, HistoryActionsSettings);
      });

      /**
       * Build the digest note text for the ACTIVE conversation, or null when there
       * is nothing to digest. Shared by the session-header action, the notes page
       * and the keyboard command, so all three produce the same text.
       */
      function digestNoteText(t, opts) {
        var options = opts && typeof opts === "object" ? opts : {};
        var target = activeSessionId();
        if (target === undefined) return null;
        var outline = latestOutline.sessionId === target ? latestOutline.entries : undefined;
        var built = conversationDigest(target, outline, options);
        if (built.steps.length === 0 && built.asks.length === 0 && built.files.length === 0) return null;
        var title = sessionTitleOf(target) || "";
        var lines = [t("digest.head", { title: title === "" ? target : title })];
        lines.push(t("digest.meta", { turns: built.turns, files: built.files.length }));
        var format = options.format === "md" || options.format === "plain" ? options.format : "outline";
        if (built.steps.length > 0) {
          for (var s2 = 0; s2 < built.steps.length; s2++) {
            var prompt = built.steps[s2].prompt === "" ? t("digest.noPrompt") : built.steps[s2].prompt;
            var response = built.steps[s2].response === "" ? t("digest.noResponse") : built.steps[s2].response;
            if (format === "md") {
              lines.push("- **" + prompt + "** → " + response);
            } else if (format === "plain") {
              lines.push(prompt + " → " + response);
            } else {
              lines.push(t("digest.turnLine", { index: s2 + 1, prompt: prompt, response: response }));
            }
          }
        } else if (built.asks.length > 0) {
          lines.push(t("digest.asks"));
          for (var i = 0; i < built.asks.length && i < 12; i++) {
            if (built.asks[i] !== "") lines.push((i + 1) + ". " + built.asks[i]);
          }
        }
        if (built.files.length > 0) lines.push(t("digest.files") + built.files.join("、"));
        return lines.join("\n");
      }

      /**
       * Save the digest as a NEW note.
       * @returns {{ ok: boolean, total: number }} `ok` is false when there was
       * nothing to digest; `total` is the note count afterwards (so the notice can
       * show that a repeat save really did add one).
       */
      function saveDigestNote(t, opts) {
        // 摘要关掉 ⇒ 在**创建临时会话之前**就拒绝（设计稿 §5.3：拦在发起后 = 留下孤儿会话）。
        if (!featureEnabled("featureDigest")) return { ok: false, total: readNotes().length, error: "feature-off" };
        var text = digestNoteText(t, opts);
        if (text === null) return { ok: false, total: readNotes().length };
        var result = appendNote(readNotes(), text, opts && opts.tags);
        var stored = writeNotes(result.list);
        if (!stored.ok) return { ok: false, total: readNotes().length, error: stored.error };
        return { ok: true, total: stored.list.length };
      }

      /** The last assistant text in a history page; reasoning parts are skipped. */
      function lastAssistantText(page) {
        var records = page && page.records ? page.records : [];
        var text = "";
        for (var i = 0; i < records.length; i++) {
          var rec = records[i];
          if (!rec || rec.type !== "event" || !rec.event || rec.event.type !== "assistant/message") continue;
          var message = rec.event.data && rec.event.data.message;
          var parts = message && message.content ? message.content : [];
          var chunk = [];
          for (var j = 0; j < parts.length; j++) {
            if (parts[j] && parts[j].type === "text" && typeof parts[j].text === "string") chunk.push(parts[j].text);
          }
          if (chunk.length > 0) text = chunk.join("\n").trim();
        }
        return text;
      }
      /**
       * Poll the throwaway session until its final assistant TEXT is readable.
       *
       * Watching `running` alone is not enough: a just-created session reports
       * `running: false` until the queued prompt actually starts, so an early read
       * finds an empty history. The text itself is the gate, and the durable
       * `assistant/message` is written as one event, so a non-empty read is complete.
       */
      /**
       * The session's current seq, which is what `throughSeq` actually needs.
       *
       * `paginate` computes `end = throughSeq + 1`, so the sentinel `-1` yields
       * `end = 0` — an always-empty page. The usable value is the cursor itself
       * (`end = cursor + 1` covers every event).
       *
       * Three routes, because the shapes differ per surface and only one of them is
       * guaranteed: the client list summary does NOT carry `projections`; a remote
       * result may be wrapped in an `{ ok, value }` envelope; `session.list` exposes
       * `items[].projections.asOfSeq`. Whatever each route returned is recorded and
       * attached to any failure, so the next report names the real shape.
       */
      function sessionCursor(sessionId) {
        var tried = [];
        function note(route, value) {
          tried.push(route + "=" + (value === null || value === undefined ? "none" : JSON.stringify(value).slice(0, 80)));
          return value;
        }
        function seqOf(bag) {
          if (!bag || typeof bag !== "object") return null;
          if (bag.projections && typeof bag.projections.asOfSeq === "number") return bag.projections.asOfSeq;
          if (typeof bag.asOfSeq === "number") return bag.asOfSeq;
          return null;
        }
        // Route 1: the client-side list snapshot.
        var row = null;
        try {
          var snap = ctx.sessions.list.getSnapshot();
          row = snap && snap.byId ? snap.byId[sessionId] : null;
        } catch (e) { row = null; }
        var direct = seqOf(row);
        if (direct !== null) return Promise.resolve({ cursor: direct, tried: tried });

        // Route 2: session.projections — accept a bare object or an { ok, value } envelope.
        return Promise.resolve()
          .then(function () { return ctx.remote.session.projections({ sessionId: sessionId }); })
          .then(function (result) {
            if (result && result.ok === false) { note("projections", result.error && result.error.code); return null; }
            var found = seqOf(result) !== null ? seqOf(result) : seqOf(result && result.value);
            note("projections", found);
            return found;
          }, function (error) { note("projections", errorMessage(error)); return null; })
          // Route 3: session.list carries items[].projections.asOfSeq.
          .then(function (found) {
            if (found !== null) return found;
            return Promise.resolve()
              .then(function () { return ctx.remote.session.list({}); })
              .then(function (result) {
                if (result && result.ok === false) { note("list", result.error && result.error.code); return null; }
                var items = result && result.items ? result.items : [];
                for (var i = 0; i < items.length; i++) {
                  if (items[i] && items[i].sessionId === sessionId) {
                    var hit = seqOf(items[i]);
                    note("list", hit);
                    return hit;
                  }
                }
                note("list", items.length + " items, no match");
                return null;
              }, function (error) { note("list", errorMessage(error)); return null; });
          })
          .then(function (found) { return { cursor: found, tried: tried }; });
      }

      function pollChildSummary(sessionId, timeoutMs, onProgress) {
        var started = Date.now();
        var failures = 0;
        var lastError = "";
        var seen = { pages: 0, records: 0, types: "", running: null };
        function report() {
          if (typeof onProgress !== "function") return;
          try {
            onProgress(Math.round((Date.now() - started) / 1000) + "s · " + seen.pages + " 次读取 · " + seen.records + " 条记录 · running=" + String(seen.running) + (lastError !== "" ? " · 错误: " + lastError + " · types=" + (seen.types || "none") : ""));
          } catch (e) { /* progress is best effort */ }
        }
        function readPage() {
          return sessionCursor(sessionId).then(function (found) {
            var cursor = found ? found.cursor : null;
            if (cursor === null) {
              throw new Error("cannot resolve the session cursor — tried: " + ((found && found.tried) || []).join(" | "));
            }
            return ctx.remote.session.page({
              address: { kind: "session", sessionId: sessionId },
              // This is an ordinary session address, not a subagent one. The README only
              // documents "unknown mode" for subagent addresses, so state the real mode:
              // sessions created through sessions.create are continuable.
              mode: "continuable",
              // The cursor itself, never -1: `paginate` does `end = throughSeq + 1`,
              // so -1 would slice an empty page and a larger number is past the cursor.
              throughSeq: cursor,
            turnWindow: { minMessages: 1, minTurns: 1 },
              maxMessages: 200
            });
          }).then(function (page) {
            // Remote results come back as { ok, value } envelopes — reading `page.records`
            // directly is why every read looked like an empty history. A failure arrives
            // as { ok: false }, not as a rejection, so normalise it HERE where the
            // retry/backoff below can actually see it.
            if (page && page.ok === false) {
              throw new Error((page.error && (page.error.message || page.error.code)) || "history page rejected");
            }
            return page && page.value !== undefined && page.value !== null ? page.value : page;
          });
        }
        function snapshotRow() {
          try {
            var snap = ctx.sessions.list.getSnapshot();
            return snap && snap.byId ? snap.byId[sessionId] : null;
          } catch (e) {
            return null;
          }
        }
        return new Promise(function (resolve, reject) {
          function tick() {
            Promise.resolve().then(readPage).then(function (page) {
              var records = page && page.records ? page.records : [];
              var rawShape = page === null || page === undefined ? String(page) : JSON.stringify(Object.keys(page)) + ":ok=" + String(page.ok) + ",records=" + String(records.length) + ",hasMore=" + String(page.hasMore);
              var text = lastAssistantText(page);
              var row = snapshotRow();
              seen.pages += 1;
              seen.records = records.length;
              seen.running = row ? row.running === true : null;
              var types = [];
              for (var i = 0; i < records.length; i++) {
                var ev = records[i] && records[i].event;
                if (ev && ev.type && types.indexOf(ev.type) === -1) types.push(ev.type);
              }
              seen.types = types.join(",");
              failures = 0;
              report();
              var settled = !(row && row.running === true);
              // A freshly created session reports running:false until its queued prompt
              // actually starts, so "finished + no records" is NOT evidence of a broken
              // read — it is the normal state while the model is still thinking. Only a
              // sustained absence of records counts, and the diagnostic carries the raw
              // response so a real problem is identifiable without another round trip.
              if (settled && records.length === 0 && Date.now() - started > EMPTY_PAGE_GRACE_MS) {
                reject(new Error(t("digest.modelFailed") + " · no records after " + Math.round((Date.now() - started) / 1000) + "s (throughSeq=cursor, mode=continuable, running=" + String(seen.running) + ", types=" + (seen.types || "none") + ", raw=" + rawShape + ")"));
                return;
              }
              if (text !== "" && settled) { resolve(text); return; }
              if (Date.now() - started > timeoutMs) {
                if (text !== "") { resolve(text); return; }
                reject(new Error(t("digest.modelFailed") + " (" + seen.pages + " reads, " + seen.records + " records, running=" + String(seen.running) + ", types=" + (seen.types || "none") + (lastError !== "" ? ", error=" + lastError : "") + ")"));
                return;
              }
              setTimeout(tick, 800);
            }, function (error) {
              // A read failure must never be swallowed: report it, and give up fast when
              // it keeps failing instead of burning the whole timeout in silence.
              failures += 1;
              lastError = errorMessage(error) || "history read failed";
              report();
              if (failures >= 3) {
                reject(new Error("history read: " + lastError + " (" + seen.pages + " reads)"));
                return;
              }
              if (Date.now() - started > timeoutMs) {
                reject(new Error("history read: " + lastError));
                return;
              }
              setTimeout(tick, 800);
            });
          }
          tick();
        });
      }
      /**
       * The workspace a session belongs to, if any.
       *
       * DSH's archive refuses a session that is "neither live nor in session
       * persistence" from the registry's point of view, and a session created without
       * a workspace lands under the ungrouped bucket where that happens. Creating the
       * throwaway inside the current conversation's workspace is what makes archiving
       * work — and the leftovers in the sidebar were exactly that mistake.
       */
      function currentWorkspaceFor(sessionId) {
        try {
          var items = ctx.uiWorkspace.workspaces.list.getSnapshot().items || [];
          var i;
          for (i = 0; i < items.length; i++) {
            var w = items[i];
            if (w && Array.isArray(w.sessionIds) && w.sessionIds.indexOf(sessionId) !== -1) return w.workspaceId;
          }
          var snap = ctx.sessions.list.getSnapshot();
          var row = snap && snap.byId ? snap.byId[sessionId] : null;
          var cwd = row && typeof row.cwd === "string" ? row.cwd : "";
          if (cwd !== "") {
            for (i = 0; i < items.length; i++) {
              if (items[i] && items[i].path === cwd) return items[i].workspaceId;
            }
          }
        } catch (e) { /* best effort: no workspace is the old behaviour */ }
        return null;
      }
      function cleanupChild(sessionId) {
        if (typeof sessionId !== "string" || sessionId === "") {
          return Promise.resolve({ archived: false, reason: "no session" });
        }
        return Promise.resolve()
          // stopActivity: a just-finished throwaway may still count as running work,
          // which the archive refuses by default.
          .then(function () { return ctx.uiWorkspace.archiveSession(sessionId, { stopActivity: true }); })
          .then(function (result) {
            if (result && result.ok === false) {
              return { archived: false, reason: (result.error && (result.error.message || result.error.code)) || "refused" };
            }
            return { archived: true, reason: "" };
          }, function (error) {
            return { archived: false, reason: errorMessage(error) || "archive failed" };
          });
      }
      /**
       * Model-backed summary.
       *
       * A plugin cannot call a model directly (client->host remotes are compiled by
       * Typert), so this drives a throwaway session: it carries the source conversation
       * as a session reference and gets one instruction. Only the final text becomes the
       * note; the throwaway is archived either way. Every call here is one the plugin
       * already uses elsewhere; the unknown mode is documented as permitting history reads.
       */
      function summarizeWithModel(t, sourceSessionId, requirement, timeoutMs, onProgress) {
        // 「让模型总结」会新建一个临时会话 ⇒ 门必须在发起前。返回 rejected promise 而不是抛：
        // 调用方（对话框/命令）都有 onProgress/错误通道，会把它说给用户听。
        if (!featureEnabled("featureDigest")) return Promise.reject(new Error("feature-off"));
        var waitMs = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 240000;
        var child = null;
        var workspaceId = currentWorkspaceFor(sourceSessionId);
        var label = sessionTitleOf(sourceSessionId) || "之前的对话";
        var instruction = [
          "你只做摘要：不要调用任何工具，不要读写文件，不要执行命令。",
          "要求：" + (requirement !== "" ? requirement : "用简洁的要点总结这段对话。"),
          "只输出摘要正文，不要前言、不要解释、不要用代码块围栏。"
        ].join("\n");
        return Promise.resolve()
          .then(function () { return ctx.sessions.create(workspaceId ? { workspaceId: workspaceId } : undefined); })
          .then(function (newId) {
            child = newId;
            return ctx.remote.session.prompt({
              requestId: newRequestId(),
              sessionId: child,
              mode: "queue",
              content: [{ type: "text", text: formatMention(sourceSessionId, label) + "\n\n" + instruction }]
            });
          })
          .then(function (result) {
            if (result && result.ok === false) throw new Error((result.error && result.error.message) || "prompt rejected");
            return pollChildSummary(child, waitMs, onProgress);
          })
          .then(function (text) {
            return cleanupChild(child).then(function (status) {
              if (status && status.archived === false) {
                showNotice(t("digest.cleanupFailed") + ": " + status.reason, { clientX: 24, clientY: 80 });
              }
              return text;
            });
          }, function (error) {
            return cleanupChild(child).then(function (status) {
              var reason = errorMessage(error) || t("digest.modelFailed");
              if (status && status.archived === false) reason += " · " + t("digest.cleanupFailed") + ": " + status.reason;
              throw new Error(reason);
            });
          });
      }

      // Settings → DeepWorker: the switches that actually change client behaviour.
      // ── 设置页（2026-10-15 改版）──────────────────────────────────────────────
      // 分区（常用 / 高级 / 调试）+ 顶部固定条。三条纪律落在这里：
      //   ① 构建标记与「重新加载界面」必须在**第一屏**（本机迭代协议强制"先看构建标记"，
      //      而重载是桌面 App 唯一手段，不该要求滚动）。
      //   ② 失败必须显眼：命令注册失败 / 启动贡献失败给**顶部红色横幅**，不再混在灰字里。
      //   ③ 常见动作（锁定/解锁、通知范围）留在常用区；诊断读数默认收起。
      // 所有功能开关的判定统一走 featureEnabled()（!== false），关掉的那一档自己变灰并写出
      // "已关闭"，顶部再给一行"已关闭 N 项"的全局读数 —— "关闭必须可见"。
      // ── 设置页（2026-10-17 五 tab 改版：第 5 个 tab 是「终端」）────────────────────
      // 五个 tab，控件用官方 `SegmentedControl`（自带 role=tablist/tab、aria-selected、
      // aria-controls、←/→/Home/End 走查、tabIndex 单选入列）：
      //   基础     = 重载入口 + 构建标记 · 功能引入/移除（本页视觉主体，**7 档**）·
      //              未引入汇总 · 通知 · 底部折叠「调试」
      //              ⚠️ 2026-10-16：「调试」**只有一个**。内层那个 `focus.debug` 折叠（中文
      //              同名）已合并进来 —— 内容（刷新状态 / 把自检发给我 / 编辑重发诊断跟踪 /
      //              核心探针 / 构建状态）全部住在外层这一个折叠里。
      //   专注锁   = 锁定本会话 / 立即解锁 · 锁定状态 · 粒度说明
      //   笔记     = 笔记 · 摘要（**含它自己的开关**，2026-10-17 从「基础」搬来）·
      //              存储位置（讲笔记存哪、怎么导出）
      //   会话操作 = 轮次操作（含「编辑重发/重试时默认归档原对话」）· 引用回复 ·
      //              会话内查找 · 重试时「已改动文件」提示
      //   终端     = 终端按钮的全部配置（2026-10-17 从「会话操作」整块搬来；用户原话
      //              "启动按钮没有单独的tab页吗"）
      //
      // ⚠️ 2026-10-16 二次分组（tab 的 value / i18n 键跟着改：content ⇒ notes）：
      //   · 「引用回复」原本被放进「会话内容」tab —— 用户在真机截图里指出它在界面上就是
      //     消息动作栏里的一颗按钮（与「重试本轮 / 在此分支 / 编辑重发 / 选模式新建」并排）
      //     ⇒ 搬进**会话操作**（`FEATURE_META.featureQuote.tab` = "actions"）。
      //   · 「编辑重发/重试时默认归档原对话」原本挂在「引用」小标题底下 —— 它跟引用毫无
      //     关系，管的是编辑重发/重试的行为 ⇒ 搬进**轮次操作**小节。
      //   · 「存储位置」原本在「基础」⇒ 搬进**笔记**（它讲的是笔记存哪、怎么导出）。
      //   三处都**只搬位置**：每个开关的存储键（`quoteProvenance` / `archiveOriginal` /
      //   `retryNote` / `feature*`）一律不变，行为一字不动。
      // ⚠️ 2026-10-16 **第 4 轮**（用户否掉了"把 7 个开关搬进各自 tab"的方案，明确要求
      //   7 个「引入 / 移除」开关**继续全部住在「基础」tab**）：其它 tab 只放各自的**设置**。
      //   用户认可的结构性理由就是这一条 —— **「基础」页是恢复页、永不整块禁用**
      //   （`RECOVERY_TAB`），所以"把任何一档开回来"的入口、每行的「需重载」提示、以及顶部
      //   主「重新加载界面」**同页**：一份面板不可能既"整页点不动"又把出路留在里面。
      // ⚠️ 2026-10-17 **例外（用户明确要求）**：「摘要」那一档的**开关**搬进「笔记」页
      //   （原话："摘要是笔记用的功能，开关可以挪进来"）。于是「基础」页只剩 7 档 ——
      //   但恢复路径没有变弱，反而多了一条：
      //     · 总开关（一键全开）永远管**全部 8 档**，它仍在「基础」页顶部；
      //     · 「笔记」页被排除在"整页灰"之外（`NO_PANEL_GREY_TABS`）⇒ 摘要的开关**永远
      //       点得到**，不会出现"这一档关掉之后只能靠全开救回来"的情形。
      //   记账只有一处：`SWITCH_HOME`（档位 → 开关住在哪个 tab）。
      //   ⇒ `FEATURE_META[*].tab` **不表示开关住在哪**：它表示"这一档**自己的设置**住在哪个
      //     tab 的哪个小节"（`featureSection` 用它；verify_render.mjs 有一条源码级对账断言）。
      //   ⇒ 本卡片**顶部**新增一颗「全部功能（一键全开 / 全关）」总开关；**关之前必须先解除
      //     所有专注锁**（会话级 + 工作区级 + 撤销宿主对象上的拦截器），顺序是硬要求：
      //     **先解锁 → 再写设置 → 再提示重载**（见 `focusReleaseAllLocks` / `featureOffTransaction`）。
      //
      // ⚠️ 两个**不同**的开关语义，别混：
      //   ① 「基础 → 功能引入 / 移除」（以及「笔记 → 摘要」那一颗）= **注册级**：
      //      `false` ⇒ 那个功能根本不注册
      //      （`guard.injectIf` / `guard.effectIf` / `declareIf` 一个都不调用，入口整个消失）
      //      ⇒ **点「重新加载界面」后才生效**（apply 时求值）。
      //   ② 各功能 tab 里的设置 = 即时生效（写进存储、`featureEnabled` 每次读）。
      //
      // 三条纪律照旧：① 构建标记与重载入口在第一屏；② 失败必须显眼（顶部红条）；
      // ③ 写设置必须说话（writeSettings 的返回值被如实检查）。
      // 面板一律 `hidden` **保活**（不条件卸载）：组件自带的 `aria-controls` 指向
      // `${id}-${value}-panel`，所以面板 id 必须由同一个 SETTINGS_TAB_ID 拼出来 ——
      // 两侧各写一遍字符串迟早会漂。
      var SETTINGS_TAB_ID = "deepworker-settings-tabs";
      /**
       * tab 顺序 = 显示顺序。`labelKey` 必须是**字面量**键名（`t("settings.tab." + value)`
       * 那种拼接会让 `verify_hygiene` 的"键被真实引用"检查看不见它 ⇒ 误报 unused）。
       */
      var SETTINGS_TABS = [
        { value: "basic", labelKey: "settings.tab.basic" },
        { value: "focus", labelKey: "settings.tab.focus" },
        { value: "notes", labelKey: "settings.tab.notes" },
        { value: "actions", labelKey: "settings.tab.actions" },
        // 2026-10-17：给终端按钮单独一个 tab（用户原话："启动按钮没有单独的tab页吗"）。
        // 顺序在「会话操作」之后；value = `terminal`，面板 id / aria-controls 由同一个 value 拼。
        { value: "terminal", labelKey: "settings.tab.terminal" }
      ];
      /** `${id}-${value}`：SegmentedControl 里那个 tab 按钮的 id。 */
      function settingsTabId(value) { return SETTINGS_TAB_ID + "-" + value; }
      /** `${id}-${value}-panel`：组件 `aria-controls` 的**精确**目标。 */
      function settingsPanelId(value) { return SETTINGS_TAB_ID + "-" + value + "-panel"; }
      /**
       * Manual version check. Deliberately does not run on mount: a local-first plugin
       * must not contact npm until the user asks. On failure it still gives a way out.
       */
      function UpdatePanel(props) {
        var t = typeof props.t === "function" ? props.t : function (key) { return key; };
        var state = (0, react.useState)({ status: "idle", latest: "", detail: "" });
        var status = state[0];
        var setStatus = state[1];
        var copiedState = (0, react.useState)(false);
        var copied = copiedState[0];
        var setCopied = copiedState[1];
        var checking = status.status === "checking";
        var latest = status.latest || "";
        var command = "install_bundle  target = dsh-deepworker@" + (latest || "<version>");
        function check() {
          if (checking) return;
          setCopied(false);
          setStatus({ status: "checking", latest: "", detail: "" });
          fetchLatestVersion().then(function (next) {
            if (compareVersions(next, VERSION) > 0) setStatus({ status: "available", latest: next, detail: "" });
            else setStatus({ status: "latest", latest: next, detail: "" });
          }, function (error) {
            var detail = String((error && error.message) || error || "");
            setStatus({ status: "failed", latest: "", detail: detail || t("update.network") });
          });
        }
        function openUrl(url) {
          try {
            if (typeof window !== "undefined" && typeof window.open === "function") {
              window.open(url, "_blank", "noopener,noreferrer");
            }
          } catch (e) { /* ignore; the href remains available for right-click/copy */ }
        }
        function copyCommand() {
          try {
            if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
              navigator.clipboard.writeText(command).then(function () { setCopied(true); }, function () { setCopied(false); });
            }
          } catch (e) { setCopied(false); }
        }
        var statusLine;
        if (status.status === "checking") statusLine = t("update.checking");
        else if (status.status === "latest") statusLine = t("update.latest") + " · v" + latest;
        else if (status.status === "available") statusLine = t("update.available", { version: latest });
        else if (status.status === "failed") statusLine = t("update.failed", { detail: status.detail });
        else statusLine = t("update.idle");
        var linkStyle = { color: "var(--dsw-alias-link)", textDecoration: "none", fontSize: "12px" };
        return (0, react_jsx_runtime.jsxs)("div", {
          "data-dw-update": "",
          style: { borderTop: "1px solid var(--dsw-alias-border-l2)", marginTop: "16px", paddingTop: "10px" },
          children: [
            (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "15px", fontWeight: 600 }, children: t("update.title") }),
            (0, react_jsx_runtime.jsx)("div", {
              style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", marginTop: "2px", wordBreak: "break-word" },
              children: t("update.current") + " v" + VERSION + " · " + statusLine
            }, "update-status"),
            (0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" },
              children: [
                (0, react_jsx_runtime.jsx)(primitives.Button, {
                  variant: "outline",
                  size: "sm",
                  disabled: checking,
                  onClick: check,
                  children: checking ? t("update.checking") : t("update.check")
                }, "update-check"),
                (0, react_jsx_runtime.jsx)("a", {
                  href: UPDATE_PAGE_URL,
                  target: "_blank",
                  rel: "noreferrer",
                  style: linkStyle,
                  onClick: function (event) { event.preventDefault(); openUrl(UPDATE_PAGE_URL); },
                  children: t("update.manual")
                }, "update-manual"),
                (0, react_jsx_runtime.jsx)("a", {
                  href: REPO_URL,
                  target: "_blank",
                  rel: "noreferrer",
                  style: linkStyle,
                  onClick: function (event) { event.preventDefault(); openUrl(REPO_URL); },
                  children: t("update.repo")
                }, "update-repo")
              ]
            }),
            status.status === "available" ? (0, react_jsx_runtime.jsxs)("div", {
              style: { marginTop: "8px", padding: "8px", borderRadius: "6px", background: "var(--dsw-alias-bg-module-platform)", fontSize: "12px", lineHeight: "18px" },
              children: [
                (0, react_jsx_runtime.jsx)("code", { style: { userSelect: "text", wordBreak: "break-all" }, children: command }),
                (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "16px" }, children: (0, react_jsx_runtime.jsx)(primitives.Button, {
                  variant: "outline",
                  size: "sm",
                  onClick: copyCommand,
                  children: copied ? t("update.copied") : t("update.copy")
                }, "update-copy") })
              ]
            }, "update-command") : null,
            (0, react_jsx_runtime.jsx)("div", {
              style: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)", marginTop: "6px" },
              children: t("update.hint")
            }, "update-hint")
          ]
        });
      }

      function HistoryActionsSettings(props) {
        /**
         * 「命令按钮」设置编辑器（2026-10-17 第 2/3 段：多工作区 + 批量）。
         *
         * 为什么整块重写（而不是在旧编辑器上加一层）：旧模型是"一个 cwd 一份配置"，
         * 用户原话："现在你做的这个版本是针对一个工作区的配置，但完整的应该是支持添加/移除
         * 多个工作区，某个工作区可独立配置这些功能，自定义启动/停止等命令"。
         * 存储模型换了（`workspaces.v1`，见 3b-ii），UI 必须跟着换 —— 旧的 `termWriteConfig`
         * 保留成**兼容层**（老套件按那个契约在验执行器），但新 UI 只走 `ws*` 一族。
         *
         * 三块，自上而下：
         *   ① 当前会话工作区的状态行（在不在列表里 + 一键加入）—— "头部按钮为什么不见"
         *      的**唯一**答案就在这里，所以它常驻页首，绝不静默消失。
         *   ② 批量条：勾选多个工作区，**串行**启动 / 停止，失败逐条可见。
         *   ③ 工作区列表 + 选中项编辑器（启动 / 停止 / 额外按钮 / 前置序列 / 超时 / 启动前先停止）。
         *
         * ⚠️ Electron **不实现 `window.prompt`** ⇒ 所有文本输入都用自己的 `primitives.Input`。
         * ⚠️ 编辑是**本地 draft**，点「保存」才落盘 —— 边打字边写 localStorage 会让每一次击键
         *    都可能碰到配额/被禁（那种失败会刷屏，而且用户没法"取消"）。
         * ⚠️ React 19：`key` 只走 `jsx(type, props, key)` 的**第三参**。
         */
        function CommandButtonsSettings(props) {
          var t = typeof props.t === "function" ? props.t : function (key) { return key; };
          var busy = props.busy === true;
          var cwd = typeof props.cwd === "string" ? props.cwd : "";
          /** Local helper: must read the CURRENT busy prop, not a parent closure. */
          function cmdButton(label, onClick, key, disabled, style) {
            return (0, react_jsx_runtime.jsx)(primitives.Button, {
              variant: "outline",
              size: "sm",
              disabled: busy || disabled === true,
              onClick: onClick,
              style: style,
              children: label
            }, key);
          }
          // 整张工作区表：一次读盘；每次写完**重读**（存储是同步的 ⇒ 立刻能读回真实值）。
          var storeState = (0, react.useState)(function () { return wsReadAll(); });
          var store = storeState[0];
          var setStore = storeState[1];
          // 「一进这一页就打开**当前会话的工作区**的配置」（没有就打开第一条）。
          // 为什么不用 useEffect 补一次：那会先渲染一帧空白页再跳变；懒初始化一次到位。
          // 打不开（列表为空 / 拿不到 cwd）⇒ 空字符串 + null，页面照常显示列表与添加框。
          var selState = (0, react.useState)(function () {
            var snapshot = wsReadAll();
            var hit = wsFind(snapshot, wsNormalizePath(cwd));
            if (hit !== null) return hit.path;
            return snapshot.workspaces.length > 0 ? snapshot.workspaces[0].path : "";
          });
          var selectedPath = selState[0];
          var setSelectedPath = selState[1];
          var draftState = (0, react.useState)(function () {
            var snapshot = wsReadAll();
            var hit = wsFind(snapshot, wsNormalizePath(cwd));
            if (hit === null && snapshot.workspaces.length > 0) hit = snapshot.workspaces[0];
            return hit === null ? null : wsClone(hit);
          });
          var draft = draftState[0];
          var setDraft = draftState[1];
          var noteState = (0, react.useState)("");
          var note = noteState[0];
          var setNote = noteState[1];
          var checkedState = (0, react.useState)({});
          var checked = checkedState[0];
          var setChecked = checkedState[1];
          var batchState = (0, react.useState)("");
          var batchNote = batchState[0];
          var setBatchNote = batchState[1];
          var fileState = (0, react.useState)({ status: "idle", count: 0, errors: [] });
          var file = fileState[0];
          var setFile = fileState[1];
          var fileOpenState = (0, react.useState)(false);
          var fileOpen = fileOpenState[0];
          var setFileOpen = fileOpenState[1];
          var logsState = (0, react.useState)(function () { return readTermLogs(); });
          var logs = logsState[0];
          var setLogs = logsState[1];
          var logsOpenState = (0, react.useState)(false);
          var logsOpen = logsOpenState[0];
          var setLogsOpen = logsOpenState[1];
          // 没有工作区时直接把添加框露出来，避免"空页 + 还要找按钮"。
          var newOpenState = (0, react.useState)(false);
          var newOpen = newOpenState[0];
          var setNewOpen = newOpenState[1];
          var extraPreState = (0, react.useState)(null);
          var extraPreIndex = extraPreState[0];
          var setExtraPreIndex = extraPreState[1];
          var seqPickState = (0, react.useState)("");
          var seqPick = seqPickState[0];
          var setSeqPick = seqPickState[1];
          var extraSeqPickState = (0, react.useState)("");
          var extraSeqPick = extraSeqPickState[0];
          var setExtraSeqPick = extraSeqPickState[1];
          // Guards against the mask receiving the tail of the click that opened the modal.
          var newOpenedAt = (0, react.useRef)(0);

          var workspaces = store !== null && Array.isArray(store.workspaces) ? store.workspaces : [];
          var normalizedCwd = wsNormalizePath(cwd);
          var current = normalizedCwd === "" ? null : wsFind(store, normalizedCwd);
          var checkedPaths = [];
          for (var ck = 0; ck < workspaces.length; ck++) {
            if (checked[workspaces[ck].path] === true) checkedPaths.push(workspaces[ck].path);
          }

          /**
           * **唯一写路径**：写盘 → 用读回的**真实值**重画。
           * 写失败 ⇒ 说话并**不动**界面（显示一个存储里没有的状态就是"说得比做得多"）。
           */
          function commit(next) {
            var result = wsWriteAll(next);
            if (!result.ok) {
              var message = t("term.saveFailed", { detail: String(result.error || "") });
              setNote(message);
              showNotice(message, { clientX: 24, clientY: 80 }, { always: true });
              return false;
            }
            setStore(wsReadAll());
            return true;
          }
          /** Read the workspace's JSON config once (no timer). */
          (0, react.useEffect)(function () {
            if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
            var onLog = function () { setLogs(readTermLogs()); };
            window.addEventListener("dsh-deepworker:term-log", onLog);
            return function () { try { window.removeEventListener("dsh-deepworker:term-log", onLog); } catch (e) { /* ignore */ } };
          }, []);
          function copyLogOutput(text) {
            try {
              if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                navigator.clipboard.writeText(String(text || "")).then(function () {
                  showNotice(t("term.logsCopied"), { clientX: 24, clientY: 80 });
                }, function () {
                  showNotice(t("term.logsCopyFailed"), { clientX: 24, clientY: 80 }, { always: true });
                });
                return;
              }
            } catch (e) { /* fall through */ }
            showNotice(t("term.logsCopyFailed"), { clientX: 24, clientY: 80 }, { always: true });
          }
          function readFile() {
            setFile({ status: "reading", count: 0, errors: [] });
            var pending = null;
            try { pending = typeof testHooks.readTerminalConfigFile === "function" ? testHooks.readTerminalConfigFile() : null; } catch (e) { pending = null; }
            if (pending === null || typeof pending.then !== "function") { setFile({ status: "no-api", count: 0, errors: [] }); return; }
            pending.then(function (result) {
              var next = result !== null && typeof result === "object" ? result : { status: "failed", count: 0, errors: [] };
              if (!Array.isArray(next.errors)) next.errors = [];
              setFile(next);
              if (next.status === "applied") { setStore(wsReadAll()); setNote(t("term.fileApplied", { n: next.count })); }
            }, function (e) {
              setFile({ status: "failed", count: 0, errors: [{ path: "file", field: "read", message: String((e && e.message) || e) }] });
            });
          }
          /** Start a brand-new workspace in the modal, with an empty draft. */
          function openNew() {
            setExtraPreIndex(null);
            setSeqPick("");
            setExtraSeqPick("");
            setDraft({ path: "", label: "", start: { label: "", command: "" }, stop: { label: "", command: "" }, extras: [], preStart: [], timeoutSec: TERM_TIMEOUT_DEFAULT, stopBeforeStart: false, header: null });
            setSelectedPath("");
            setNote("");
            newOpenedAt.current = Date.now();
            // Open on the next tick. Mounting the modal during the same click that
            // triggered it can let the mask receive the tail of that click, which reads
            // as an instant close ("闪退"). The extra tick makes the trigger click finish.
            setTimeout(function () { setNewOpen(true); }, 0);
          }
          function closeNew() {
            setExtraPreIndex(null);
            setSeqPick("");
            setExtraSeqPick("");
            setNewOpen(false);
            setDraft(null);
            setSelectedPath("");
            setNote("");
          }
          /** Validate the modal draft and create it. Never writes a half-valid entry. */
          function draftCommandTooLong(value) {
            if (value === null || typeof value !== "object") return false;
            if (termCommandChars(value.start && value.start.command) > TERM_FIELD_MAX) return true;
            if (termCommandChars(value.stop && value.stop.command) > TERM_FIELD_MAX) return true;
            var items = Array.isArray(value.extras) ? value.extras : [];
            for (var i = 0; i < items.length; i++) if (termCommandChars(items[i] && items[i].command) > TERM_FIELD_MAX) return true;
            return false;
          }
          function draftFatalReason(value) {
            if (value === null || typeof value !== "object") return null;
            var a = termFatalReason(value.start && value.start.command);
            if (a) return a;
            var b = termFatalReason(value.stop && value.stop.command);
            if (b) return b;
            var items = Array.isArray(value.extras) ? value.extras : [];
            for (var i = 0; i < items.length; i++) { var r = termFatalReason(items[i] && items[i].command); if (r) return r; }
            return null;
          }
          function saveNew() {
            if (draft === null) return;
            if (draftCommandTooLong(draft)) { setNote(t("term.commandTooLong", { max: TERM_FIELD_MAX })); return; }
            var fatalNew = draftFatalReason(draft);
            if (fatalNew !== null) { setNote(t("term.commandFatal", { rule: fatalNew })); return; }
            var path = wsNormalizePath(draft.path);
            if (path === "") { setNote(t("term.wsBadPath")); return; }
            if (wsFind(wsReadAll(), path) !== null) { setNote(t("term.wsExists")); return; }
            var entry = wsNormalizeEntry(draft, path);
            if (entry === null) { setNote(t("term.wsBadPath")); return; }
            if (!commit(wsUpsert(store, entry))) return;
            setNewOpen(false);
            setDraft(wsClone(entry));
            setSelectedPath(entry.path);
            setNote(t("term.wsAdded", { label: entry.label }));
          }
          function openEditor(path) {
            setExtraPreIndex(null);
            setSeqPick("");
            setExtraSeqPick("");
            var entry = wsFind(wsReadAll(), path);
            if (entry === null) { setSelectedPath(""); setDraft(null); return; }
            setSelectedPath(entry.path);
            setDraft(wsClone(entry));
            setNote("");
          }
          function patch(fields) {
            if (draft === null) return;
            var merged = Object.assign({}, draft, fields);
            var normalized = wsNormalizeEntry(merged, draft.path);
            // A brand-new workspace starts with an empty path, so normalizeEntry cannot
            // build an identity yet. Keep the raw draft until the path is filled in;
            // saveNew validates it before anything is written.
            if (normalized === null) {
              setDraft(merged);
              setNote("");
              return;
            }
            // wsNormalizeEntry drops a row whose label AND command are both empty. That is
            // right for storage, but wrong while editing: "加一个按钮" appends exactly such
            // an empty row, and it used to vanish on the very same tick (the click looked
            // like a no-op). Preserve the edited extras verbatim; save still drops blanks.
            if (Array.isArray(merged.extras)) {
              normalized.extras = merged.extras.slice(0, 32).map(function (item) {
                return {
                  label: termNormalizeLabel(item && item.label, ""),
                  command: termNormalizeCommand(item && item.command),
                  pre: item && Array.isArray(item.pre) ? item.pre.slice() : []
                };
              });
            }
            setDraft(normalized);
            setNote("");
          }
          function patchAction(which, field, value) {
            if (draft === null) return;
            var copy = { label: draft[which].label, command: draft[which].command };
            copy[field] = value;
            var fields = {};
            fields[which] = copy;
            patch(fields);
          }
          function patchExtra(index, field, value) {
            if (draft === null) return;
            var extras = [];
            for (var i = 0; i < draft.extras.length; i++) {
              var item = { label: draft.extras[i].label, command: draft.extras[i].command };
              if (i === index) item[field] = value;
              extras.push(item);
            }
            var fields = { extras: extras };
            if (field === "label" && Array.isArray(draft.header)) {
              var oldLabel = draft.extras[index] === undefined ? "" : draft.extras[index].label;
              var nextHeader = [];
              for (var h = 0; h < draft.header.length; h++) {
                if (draft.header[h] !== oldLabel) { nextHeader.push(draft.header[h]); continue; }
                if (value !== "") nextHeader.push(value);
              }
              fields.header = nextHeader;
            }
            patch(fields);
          }
          function headerAllRefs() { return draft === null ? [] : wsActionRefs(draft); }
          function headerSelectedRefs() { return draft === null ? [] : (Array.isArray(draft.header) ? draft.header.slice() : wsActionRefs(draft)); }
          function toggleHeaderRef(ref, on) {
            if (draft === null) return;
            var next = headerSelectedRefs();
            var at = next.indexOf(ref);
            if (on && at < 0) next.push(ref);
            else if (!on && at >= 0) next.splice(at, 1);
            else return;
            patch({ header: next });
          }
          function moveHeaderRef(ref, delta) {
            if (draft === null) return;
            var next = headerSelectedRefs();
            var at = next.indexOf(ref);
            var target = at + delta;
            if (at < 0 || target < 0 || target >= next.length) return;
            var swap = next[target];
            next[target] = next[at];
            next[at] = swap;
            patch({ header: next });
          }
          function addExtra() {
            if (draft === null) return;
            patch({ extras: draft.extras.concat([{ label: "", command: "", pre: [] }]) });
          }
          function patchExtraPreList(index, pre) {
            if (draft === null) return;
            var extras = draft.extras.map(function (item, i) {
              return { label: item.label, command: item.command, pre: i === index ? pre.slice() : (Array.isArray(item.pre) ? item.pre.slice() : []) };
            });
            patch({ extras: extras });
          }
          function addExtraPre(index, ref) {
            if (draft === null || typeof ref !== "string" || ref === "") return;
            var item = draft.extras[index];
            if (item === undefined) return;
            var pre = Array.isArray(item.pre) ? item.pre.slice() : [];
            if (pre.indexOf(ref) >= 0) return;
            pre.push(ref);
            patchExtraPreList(index, pre);
          }
          function moveExtraPre(index, seqIndex, delta) {
            if (draft === null) return;
            var item = draft.extras[index];
            if (item === undefined) return;
            var pre = Array.isArray(item.pre) ? item.pre.slice() : [];
            var target = seqIndex + delta;
            if (target < 0 || target >= pre.length) return;
            var swap = pre[target];
            pre[target] = pre[seqIndex];
            pre[seqIndex] = swap;
            patchExtraPreList(index, pre);
          }
          function removeExtraPre(index, seqIndex) {
            if (draft === null) return;
            var item = draft.extras[index];
            if (item === undefined) return;
            var pre = Array.isArray(item.pre) ? item.pre.slice() : [];
            pre.splice(seqIndex, 1);
            patchExtraPreList(index, pre);
          }
          /**
           * 删一个额外按钮 ⇒ 指向它的前置引用**一起删**。
           * 否则序列里会留一条解析不出来的引用，表面上还在、实际永远不会跑（静默失效）。
           */
          function removeExtra(index) {
            if (draft === null) return;
            if (extraPreIndex === index) setExtraPreIndex(null);
            else if (extraPreIndex !== null && extraPreIndex > index) setExtraPreIndex(extraPreIndex - 1);
            var removedLabel = draft.extras[index] === undefined ? "" : draft.extras[index].label;
            var extras = [];
            for (var i = 0; i < draft.extras.length; i++) if (i !== index) extras.push(draft.extras[i]);
            var preStart = [];
            for (var q = 0; q < draft.preStart.length; q++) {
              if (removedLabel !== "" && draft.preStart[q] === removedLabel) continue;
              preStart.push(draft.preStart[q]);
            }
            var fields = { extras: extras, preStart: preStart };
            if (Array.isArray(draft.header) && removedLabel !== "") fields.header = draft.header.filter(function (x) { return x !== removedLabel; });
            patch(fields);
          }
          function moveSeq(index, delta) {
            if (draft === null) return;
            var target = index + delta;
            if (target < 0 || target >= draft.preStart.length) return;
            var next = draft.preStart.slice();
            var swap = next[target];
            next[target] = next[index];
            next[index] = swap;
            patch({ preStart: next });
          }
          function removeSeq(index) {
            if (draft === null) return;
            var next = [];
            for (var i = 0; i < draft.preStart.length; i++) if (i !== index) next.push(draft.preStart[i]);
            patch({ preStart: next });
          }
          function addSeq(ref) {
            if (draft === null || typeof ref !== "string" || ref === "") return;
            if (draft.preStart.indexOf(ref) >= 0) return;
            patch({ preStart: draft.preStart.concat([ref]) });
          }
          function saveDraft() {
            if (draft === null) return;
            if (draftCommandTooLong(draft)) { setNote(t("term.commandTooLong", { max: TERM_FIELD_MAX })); return; }
            var fatalDraft = draftFatalReason(draft);
            if (fatalDraft !== null) { setNote(t("term.commandFatal", { rule: fatalDraft })); return; }
            if (!commit(wsUpsert(store, draft))) return;
            setNote(t("term.wsSaved"));
            showNotice(t("term.wsSaved"), { clientX: 24, clientY: 80 });
            // 保存后把选中的那条按**读回的真值**重新装进 draft（归一化可能丢过东西）
            var back = wsFind(wsReadAll(), draft.path);
            setDraft(back === null ? null : wsClone(back));
          }
          function resetDraft() {
            if (draft === null) return;
            var fresh = wsNormalizeEntry({ path: draft.path, label: draft.label }, draft.path);
            setDraft(fresh);
            setNote(t("term.resetDone"));
          }
          function addWorkspaceAt(rawPath) {
            var path = wsNormalizePath(rawPath);
            if (path === "") { setNote(t("term.wsBadPath")); return; }
            if (wsFind(wsReadAll(), path) !== null) { setNote(t("term.wsExists")); return; }
            var entry = wsNormalizeEntry({ path: path, label: wsBasename(path) }, path);
            if (entry === null) { setNote(t("term.wsBadPath")); return; }
            if (!commit(wsUpsert(store, entry))) return;
            setNote(t("term.wsAdded", { label: entry.label }));
            openEditor(path);
          }
          function removeWorkspace(path) {
            var entry = wsFind(store, path);
            var label = entry === null ? path : entry.label;
            if (!commit(wsRemove(store, path))) return;
            if (selectedPath === path) { setSelectedPath(""); setDraft(null); }
            var nextChecked = Object.assign({}, checked);
            delete nextChecked[path];
            setChecked(nextChecked);
            setNote(t("term.wsRemoved", { label: label }));
            showNotice(t("term.wsRemoved", { label: label }), { clientX: 24, clientY: 80 });
          }
          function toggleChecked(path, on) {
            var next = Object.assign({}, checked);
            if (on === true) next[path] = true;
            else delete next[path];
            setChecked(next);
          }
          /**
           * 批量：勾选的工作区按**列表顺序**（不是勾选顺序）串行执行。
           * 顺序必须可预测、可复验 —— 勾选的先后顺序是 UI 事件的副产物，不该决定启动顺序。
           */
          function runBatch(action) {
            var paths = [];
            for (var i = 0; i < workspaces.length; i++) {
              if (checked[workspaces[i].path] === true) paths.push(workspaces[i].path);
            }
            if (paths.length === 0) { setBatchNote(t("term.batchDisabled")); return; }
            if (typeof testHooks.runTerminalBatch !== "function") { setBatchNote(t("term.noRemote")); return; }
            setBatchNote(t("term.batchRunning", { done: 0, total: paths.length }));
            try {
              testHooks.runTerminalBatch({
                t: t,
                action: action,
                paths: paths,
                sessionId: typeof testHooks.currentSessionId === "function" ? testHooks.currentSessionId() : "",
                onProgress: function (done, total, entry) {
                  setBatchNote(t("term.batchRunning", { done: done, total: total }) + " · " + entry.label);
                }
              }).then(function (summary) {
                setBatchNote(summary && typeof summary.message === "string" ? summary.message : "");
              }, function (error) {
                setBatchNote(t("term.unexpected", { detail: String((error && error.message) || error) }));
              });
            } catch (e) {
              setBatchNote(t("term.unexpected", { detail: String((e && e.message) || e) }));
            }
          }
          /**
           * 目录选择器是**可选能力**：不可用就退回纯输入框（并说明），绝不让"没有它"变成死路。
           * 也不新增 `dsh.client.inject` 依赖 —— 没注入时那个 remote 命名空间根本不存在。
           */
          function pickDirectory() {
            var pending = null;
            try { pending = typeof testHooks.pickDirectory === "function" ? testHooks.pickDirectory() : null; } catch (e) { pending = null; }
            if (pending === null || typeof pending.then !== "function") { setNote(t("term.wsPickUnavailable")); return; }
            pending.then(function (value) {
              if (typeof value === "string" && wsNormalizePath(value) !== "") patch({ path: wsNormalizePath(value) });
              else if (typeof value === "string") setNote("");        // user cancelled
              else setNote(t("term.wsPickUnavailable"));
            }, function () { setNote(t("term.wsPickUnavailable")); });
          }

          // ── ① 当前会话的工作区（头部按钮"为什么不见了"的唯一答案）─────────────────
          var statusRows = [
            (0, react_jsx_runtime.jsx)("div", {
              style: { marginTop: "4px" },
              children: [
                grey(t("term.cwdLabel") + "：" + (cwd === "" ? "—" : cwd), "2px"),
                grey(current === null
                  ? (normalizedCwd === "" ? t("term.noCwd") : t("term.wsCurrentNot"))
                  : t("term.wsCurrentIn"), "2px")
              ]
            }, "ws-status-line")
          ];
          if (current === null && normalizedCwd !== "") {
            statusRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: { marginTop: "8px" },
              children: [cmdButton(t("term.wsAddCurrent"), function () { addWorkspaceAt(normalizedCwd); }, "ws-add-current")]
            }, "ws-add-current-wrap"));
          }

          function fileStatusText() {
            var status = file === null || file === undefined ? "idle" : file.status;
            if (status === "reading") return t("term.fileReading");
            if (status === "applied") return t("term.fileApplied", { n: file.count || 0 });
            if (status === "unchanged") return t("term.fileUnchanged");
            if (status === "missing") return t("term.fileMissing");
            if (status === "invalid") return t("term.fileInvalid");
            if (status === "no-cwd") return t("term.fileNoCwd");
            if (status === "no-api") return t("term.fileNoApi");
            if (status === "write-failed" || status === "failed") return t("term.fileFailed");
            return "";
          }
          var fileErrors = file !== null && file !== undefined && Array.isArray(file.errors) ? file.errors : [];
          var fileCard = (0, react_jsx_runtime.jsxs)("div", {
            "data-dw-term-file": "",
            style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", marginTop: "8px", padding: "10px", background: "var(--dsw-alias-bg-layer-1)" },
            children: [
              sectionHeading(t("term.fileTitle")),
              grey(t("term.fileHint"), "2px"),
              grey(t("term.filePath") + "：" + TERM_CONFIG_FILE, "2px"),
              grey(t("term.fileReplaced"), "2px"),
              (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" },
                children: [
                  cmdButton(t("term.fileRead"), readFile, "term-file-read"),
                  (0, react_jsx_runtime.jsx)("span", {
                    "data-dw-term-file-status": file === null || file === undefined ? "idle" : file.status,
                    style: { fontSize: "12px", lineHeight: "18px", color: fileErrors.length > 0 ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)", userSelect: "text" },
                    children: fileStatusText()
                  }, "term-file-status")
                ]
              }, "term-file-actions"),
              fileErrors.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
                style: { marginTop: "8px", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary)", userSelect: "text", wordBreak: "break-word" },
                children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 400 }, children: t("term.fileErrors") }),
                  fileErrors.slice(0, 5).map(function (err, index) {
                    return (0, react_jsx_runtime.jsx)("div", { children: (err.path ? err.path + " · " : "") + (err.field ? err.field + ": " : "") + err.message }, "term-file-err-" + index);
                  })
                ]
              }, "term-file-errors") : null
            ]
          }, "term-file-card");

          // ── ② 批量条 ───────────────────────────────────────────────────────────
          var batchBar = (0, react_jsx_runtime.jsxs)("div", {
            style: GROUP_BLOCK,
            children: [
              (0, react_jsx_runtime.jsx)("div", {
                style: TYPE_SECTION,
                children: t("term.batchTitle")
              }, "batch-title"),
              (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px", alignItems: "center" },
                children: [
                  (0, react_jsx_runtime.jsx)(primitives.Button, {
                    variant: "primary",
                    size: "sm",
                    disabled: busy || checkedPaths.length === 0,
                    onClick: function () { runBatch("start"); },
                    children: t("term.batchStart", { n: checkedPaths.length })
                  }, "batch-start"),
                  (0, react_jsx_runtime.jsx)(primitives.Button, {
                    variant: "outline",
                    size: "sm",
                    disabled: busy || checkedPaths.length === 0,
                    onClick: function () { runBatch("stop"); },
                    children: t("term.batchStop", { n: checkedPaths.length })
                  }, "batch-stop")
                ]
              }, "batch-buttons"),
              // 禁用时**必须**说清原因（禁用而不说话 = 静默失败）
              checkedPaths.length === 0 ? grey(t("term.batchDisabled"), "6px") : null,
              checkedPaths.length > TERM_SESSION_MAX
                ? grey(t("term.batchTooMany", { n: checkedPaths.length, max: TERM_SESSION_MAX }), "6px")
                : null,
              batchNote === "" ? null : (0, react_jsx_runtime.jsx)("div", {
                "data-dw-batch-note": "",
                style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", marginTop: "8px", userSelect: "text" },
                children: batchNote
              }, "batch-note")
            ]
          }, "ws-batch");

          // ── ③ 工作区列表 ───────────────────────────────────────────────────────
          var tableRows = [];
          if (workspaces.length === 0) {
            tableRows.push((0, react_jsx_runtime.jsx)("tr", {
              children: (0, react_jsx_runtime.jsx)("td", {
                colSpan: 4,
                style: { padding: "10px 6px", color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" },
                children: t("term.wsNone")
              })
            }, "ws-empty"));
          } else {
            for (var wi = 0; wi < workspaces.length; wi++) {
              (function (entry) {
                var isSelected = selectedPath === entry.path;
                var cellStyle = { padding: "14px 10px", borderTop: "0.5px solid var(--dsw-alias-border-l2)", verticalAlign: "top" };
                var muted = { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: "18px", overflow: "hidden", wordBreak: "break-all", whiteSpace: "normal" };
                var extraText = entry.extras.map(function (item) { return item.label || "?"; }).join("、");
                tableRows.push((0, react_jsx_runtime.jsxs)("tr", {
                  "data-dw-workspace-row": "",
                  "data-dw-workspace-path": entry.path,
                  style: { background: isSelected ? "var(--dsw-alias-bg-module-platform)" : "transparent" },
                  children: [
                    (0, react_jsx_runtime.jsx)("td", { style: cellStyle, children: (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", alignItems: "flex-start", gap: "8px", minWidth: 0 },
                      children: [
                        (0, react_jsx_runtime.jsx)(primitives.Checkbox, {
                          checked: checked[entry.path] === true,
                          onChange: function (next) { toggleChecked(entry.path, next === true); },
                          label: "",
                          title: entry.path,
                          disabled: busy
                        }, "cb-" + entry.path),
                        (0, react_jsx_runtime.jsxs)("div", {
                          style: { minWidth: 0, flex: "1 1 auto" },
                          children: [
                            (0, react_jsx_runtime.jsx)("div", {
                              title: entry.label,
                              style: { fontSize: "12px", fontWeight: 400, lineHeight: "18px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                              children: entry.label
                            }, "name-" + entry.path),
                            (0, react_jsx_runtime.jsx)("div", {
                              title: entry.path,
                              style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                              children: entry.path
                            }, "path-" + entry.path),
                            entry.extras.length === 0 ? null : (0, react_jsx_runtime.jsx)("div", {
                              title: extraText,
                              style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                              children: t("term.wsColExtra") + "：" + extraText
                            }, "extra-" + entry.path)
                          ]
                        })
                      ]
                    }) }, "name-cell-" + entry.path),
                    (0, react_jsx_runtime.jsx)("td", { style: cellStyle, children: (0, react_jsx_runtime.jsx)("div", { style: muted, title: entry.start.command, children: entry.start.command === "" ? t("term.wsNoStart") : entry.start.command }, "start-" + entry.path) }, "start-cell-" + entry.path),
                    (0, react_jsx_runtime.jsx)("td", { style: cellStyle, children: (0, react_jsx_runtime.jsx)("div", { style: muted, title: entry.stop.command, children: entry.stop.command === "" ? t("term.wsNoStop") : entry.stop.command }, "stop-" + entry.path) }, "stop-cell-" + entry.path),
                    (0, react_jsx_runtime.jsxs)("td", { style: Object.assign({}, cellStyle, { whiteSpace: "nowrap", position: "sticky", right: 0, zIndex: 1, background: isSelected ? "var(--dsw-alias-bg-module-platform)" : "var(--dsw-alias-bg-base)", boxShadow: "-1px 0 0 var(--dsw-alias-border-l2)" }), children: [
                      cmdButton(t("term.wsEdit"), function () { openEditor(entry.path); }, "edit-" + entry.path),
                      cmdButton(t("term.wsRemove"), function () { removeWorkspace(entry.path); }, "rm-" + entry.path)
                    ] }, "actions-cell-" + entry.path)
                  ]
                }, "ws-row-" + entry.path));
              })(workspaces[wi]);
            }
          }
          var workspaceTable = (0, react_jsx_runtime.jsx)("div", {
            style: { overflowX: "auto" },
            children: (0, react_jsx_runtime.jsxs)("table", {
              style: { width: "100%", minWidth: "960px", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "12px" },
              children: [
                (0, react_jsx_runtime.jsx)("thead", { children: (0, react_jsx_runtime.jsxs)("tr", {
                  style: { color: "var(--dsw-alias-label-secondary)", fontWeight: 600, fontSize: "12px", lineHeight: "18px", textAlign: "left" },
                  children: [
                    (0, react_jsx_runtime.jsx)("th", { style: { padding: "9px 10px", width: "36%" }, children: t("term.wsColWorkspace") }, "th-workspace"),
                    (0, react_jsx_runtime.jsx)("th", { style: { padding: "9px 10px", width: "26%" }, children: t("term.wsColStart") }, "th-start"),
                    (0, react_jsx_runtime.jsx)("th", { style: { padding: "9px 10px", width: "26%" }, children: t("term.wsColStop") }, "th-stop"),
                    (0, react_jsx_runtime.jsx)("th", { style: { padding: "9px 10px", width: "12%", position: "sticky", right: 0, zIndex: 2, background: "var(--dsw-alias-bg-base)", boxShadow: "-1px 0 0 var(--dsw-alias-border-l2)" }, children: t("term.wsColActions") }, "th-actions")
                  ]
                }) }, "ws-thead"),
                (0, react_jsx_runtime.jsx)("tbody", { children: tableRows }, "ws-tbody")
              ]
            }, "ws-table")
          }, "ws-table-wrap");

          // ── ④ 选中项的编辑器 ────────────────────────────────────────────────────
          var editorPanel = null;
          if (draft !== null) {
            var editorRows = [];
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: { marginTop: 0, paddingTop: 0 },
              children: [
                sectionHeading(t("term.editorTitle", { label: draft.label })),
                grey(t("term.editorHint"), "2px"),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { marginTop: "8px" },
                  children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: draft.label,
                    placeholder: t("term.wsLabelPlaceholder"),
                    "aria-label": t("term.wsLabelLabel"),
                    onChange: function (e) { patch({ label: e && e.target ? e.target.value : "" }); }
                  })
                }, "editor-label")
              ]
            }, "editor-head"));
            /**
             * start / stop 一组输入框（label + command）。`which` 只能是 "start" / "stop"。
             */
            function actionEditor(which) {
              var labelKey = which === "start" ? "term.startLabelLabel" : "term.stopLabelLabel";
              var commandKey = which === "start" ? "term.startCommandLabel" : "term.stopCommandLabel";
              return (0, react_jsx_runtime.jsxs)("div", {
                style: { marginTop: "12px" },
                children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400 }, children: t(which === "start" ? "term.buttonStart" : "term.buttonStop") }, "cap"),
                  (0, react_jsx_runtime.jsxs)("div", {
                    style: { display: "flex", gap: "8px", marginTop: "4px", alignItems: "flex-start", flexWrap: "wrap" },
                    children: [
                      (0, react_jsx_runtime.jsx)("div", {
                        style: { flex: "0 1 12em", minWidth: "8em" },
                        children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                          value: draft[which].label,
                          placeholder: t(labelKey),
                          "aria-label": t(labelKey),
                          onChange: function (e) { patchAction(which, "label", e && e.target ? e.target.value : ""); }
                        })
                      }, "label-" + which),
                      (0, react_jsx_runtime.jsx)("div", {
                        style: { flex: "1 1 20em", minWidth: "12em" },
                        children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                          value: draft[which].command,
                          placeholder: t(commandKey),
                          "aria-label": t(commandKey),
                          maxLength: TERM_FIELD_MAX,
                          onChange: function (e) { patchAction(which, "command", e && e.target ? e.target.value : ""); }
                        })
                      }, "command-" + which)
                    ]
                  }, "row-" + which)
                ]
              }, "editor-" + which);
            }
            editorRows.push(actionEditor("start"));
            editorRows.push(actionEditor("stop"));
            // 「点启动时先跑停止」：显式布尔（需求书里的 stopBeforeStart）。
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: GROUP_BLOCK,
              children: [
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px" },
                  children: [
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { minWidth: 0 },
                      children: [
                        (0, react_jsx_runtime.jsx)("div", { style: TYPE_LABEL, children: t("term.stopBeforeStart") }),
                        (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-secondary)", marginTop: "4px", fontSize: "12px", lineHeight: "18px" }, children: t("term.stopBeforeStartHint") })
                      ]
                    }),
                    (0, react_jsx_runtime.jsx)(primitives.Switch, {
                      checked: draft.stopBeforeStart === true,
                      onChange: function () { patch({ stopBeforeStart: draft.stopBeforeStart !== true }); },
                      disabled: busy,
                      label: t("term.stopBeforeStart")
                    })
                  ]
                }, "stop-before-row")
              ]
            }, "editor-stop-before"));
            // 额外按钮
            var extraRows = [];
            for (var ei = 0; ei < draft.extras.length; ei++) {
              (function (extra, index) {
                extraRows.push((0, react_jsx_runtime.jsxs)("div", {
                  style: { marginTop: "8px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto", gap: "8px", alignItems: "center" },
                  children: [
                    (0, react_jsx_runtime.jsx)("div", {
                      style: { minWidth: 0 },
                      children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                        value: extra.label,
                        placeholder: t("term.labelPlaceholder"),
                        "aria-label": t("term.labelPlaceholder"),
                        onChange: function (e) { patchExtra(index, "label", e && e.target ? e.target.value : ""); }
                      })
                    }, "extra-label-" + index),
                    (0, react_jsx_runtime.jsx)("div", {
                      style: { minWidth: 0 },
                      children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                        value: extra.command,
                        placeholder: t("term.commandPlaceholder"),
                        "aria-label": t("term.commandPlaceholder"),
                        maxLength: TERM_FIELD_MAX,
                        onChange: function (e) { patchExtra(index, "command", e && e.target ? e.target.value : ""); }
                      })
                    }, "extra-command-" + index),
                    (0, react_jsx_runtime.jsx)("div", {
                      style: { display: "flex", gap: "8px", justifySelf: "end" },
                      children: [
                        cmdButton(t("term.extraPreTitle") + (Array.isArray(extra.pre) && extra.pre.length > 0 ? " (" + extra.pre.length + ")" : ""), function () { setExtraPreIndex(index); setExtraSeqPick(""); }, "extra-pre-" + index, undefined, { width: "auto", flex: "0 0 auto" }),
                        cmdButton(t("term.extraRemove"), function () { removeExtra(index); }, "extra-rm-" + index, undefined, { width: "auto", flex: "0 0 auto" })
                      ]
                    }, "extra-actions-" + index)
                  ]
                }, "extra-" + index));
              })(draft.extras[ei], ei);
            }
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: GROUP_BLOCK,
              children: [
                sectionHeading(t("term.extraTitle")),
                grey(t("term.extraHint"), "2px"),
                extraRows.length === 0 ? grey(t("term.extraEmpty"), "2px") : (0, react_jsx_runtime.jsx)("div", { children: extraRows }, "extras"),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { marginTop: "8px" },
                  children: cmdButton(t("term.extraAdd"), addExtra, "extra-add")
                }, "extra-add-wrap")
              ]
            }, "editor-extras"));
            // 顶部按钮：显示/隐藏 + 顺序。header=null 表示“全部、原顺序”，[] 表示一个都不显示。
            var headerAll = headerAllRefs();
            var headerPicked = headerSelectedRefs();
            var headerOrder = headerPicked.slice();
            for (var ho = 0; ho < headerAll.length; ho++) if (headerOrder.indexOf(headerAll[ho]) < 0) headerOrder.push(headerAll[ho]);
            var headerRows = [];
            for (var hr = 0; hr < headerOrder.length; hr++) {
              (function (ref, rowIndex) {
                var resolved = wsResolveAction(draft, ref);
                if (resolved === null) return;
                var picked = headerPicked.indexOf(ref) >= 0;
                var pickedIndex = headerPicked.indexOf(ref);
                var label = termActionLabel({ id: resolved.id, label: resolved.label }, t);
                headerRows.push((0, react_jsx_runtime.jsxs)("div", {
                  "data-dw-header-row": "",
                  "data-dw-header-ref": ref,
                  style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" },
                  children: [
                    (0, react_jsx_runtime.jsx)(primitives.Checkbox, {
                      checked: picked,
                      onChange: function (next) { toggleHeaderRef(ref, next === true); },
                      label: "",
                      title: ref,
                      disabled: busy
                    }, "header-cb-" + rowIndex),
                    (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: resolved.command, children: label }, "header-label-" + rowIndex),
                    picked ? cmdButton(t("term.sequenceUp"), function () { moveHeaderRef(ref, -1); }, "header-up-" + rowIndex, pickedIndex <= 0) : null,
                    picked ? cmdButton(t("term.sequenceDown"), function () { moveHeaderRef(ref, 1); }, "header-down-" + rowIndex, pickedIndex < 0 || pickedIndex >= headerPicked.length - 1) : null
                  ]
                }, "header-row-" + rowIndex));
              })(headerOrder[hr], hr);
            }
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: GROUP_BLOCK,
              children: [
                sectionHeading(t("term.headerTitle")),
                grey(t("term.headerHint"), "2px"),
                headerRows.length === 0 ? grey(t("term.headerNone"), "2px") : (0, react_jsx_runtime.jsx)("div", { children: headerRows }, "header-list"),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { marginTop: "8px" },
                  children: cmdButton(t("term.headerReset"), function () { patch({ header: null }); }, "header-reset")
                })
              ]
            }, "editor-header"));
            if (extraPreIndex !== null && draft.extras[extraPreIndex] !== undefined) {
              var targetExtra = draft.extras[extraPreIndex];
              var extraDefined = [];
              if (draft.stop.command !== "") extraDefined.push({ ref: "stop", label: termActionLabel({ id: "stop", label: draft.stop.label }, t), command: draft.stop.command });
              for (var xi = 0; xi < draft.extras.length; xi++) {
                if (xi === extraPreIndex) continue;
                var xe = draft.extras[xi];
                if (xe.label !== "" && xe.command !== "") extraDefined.push({ ref: xe.label, label: xe.label, command: xe.command });
              }
              var extraSeq = Array.isArray(targetExtra.pre) ? targetExtra.pre : [];
              var extraSeqRows = [];
              for (var xq = 0; xq < extraSeq.length; xq++) {
                (function (ref, index) {
                  var resolved = wsResolveAction(draft, ref);
                  if (resolved === null) return;
                  extraSeqRows.push((0, react_jsx_runtime.jsxs)("div", {
                    style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" },
                    children: [
                      (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", minWidth: "3em" }, children: String(index + 1) + "." }, "xn"),
                      (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", flex: "1 1 auto" }, children: termActionLabel({ id: resolved.id, label: resolved.label }, t) }, "xwho"),
                      extraSeq.length > 1 ? cmdButton(t("term.sequenceUp"), function () { moveExtraPre(extraPreIndex, index, -1); }, "xseq-up-" + index, index === 0) : null,
                      extraSeq.length > 1 ? cmdButton(t("term.sequenceDown"), function () { moveExtraPre(extraPreIndex, index, 1); }, "xseq-down-" + index, index === extraSeq.length - 1) : null,
                      cmdButton(t("term.sequenceRemove"), function () { removeExtraPre(extraPreIndex, index); }, "xseq-rm-" + index)
                    ]
                  }, "xseq-" + index));
                })(extraSeq[xq], xq);
              }
              var extraAddable = [];
              for (var xd = 0; xd < extraDefined.length; xd++) {
                if (extraSeq.indexOf(extraDefined[xd].ref) >= 0) continue;
                extraAddable.push(extraDefined[xd]);
              }
              editorRows.push((0, react_jsx_runtime.jsxs)("div", {
                style: GROUP_BLOCK,
                children: [
                  sectionHeading(t("term.extraPreFor", { label: targetExtra.label === "" ? "?" : targetExtra.label })),
                  grey(t("term.extraPreHint"), "2px"),
                  extraSeqRows.length === 0 ? grey(t("term.extraPreEmpty"), "2px") : (0, react_jsx_runtime.jsx)("div", { children: extraSeqRows }, "xseq-list"),
                  extraAddable.length === 0
                    ? grey(extraSeqRows.length === 0 ? t("term.sequenceNoActions") : t("term.sequenceNoMore"), "6px")
                    : (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "8px" }, children: [
                      (0, react_jsx_runtime.jsxs)("select", {
                        value: extraSeqPick,
                        onChange: function (e) { setExtraSeqPick(e && e.target ? e.target.value : ""); },
                        style: { fontSize: "12px", padding: "4px 6px", borderRadius: "6px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l2)", maxWidth: "16em" },
                        children: [
                          (0, react_jsx_runtime.jsx)("option", { value: "", children: t("term.sequencePickPlaceholder") }, "xph"),
                          extraAddable.map(function (item) {
                            return (0, react_jsx_runtime.jsx)("option", { value: item.ref, children: item.label }, "xopt-" + item.ref);
                          })
                        ]
                      }, "xseq-pick"),
                      cmdButton(t("term.sequenceAdd"), function () {
                        if (extraSeqPick === "") return;
                        addExtraPre(extraPreIndex, extraSeqPick);
                        setExtraSeqPick("");
                      }, "xseq-add-one", extraSeqPick === ""),
                      cmdButton(t("term.sequenceAddAll"), function () {
                        var next = extraSeq.slice();
                        for (var xa = 0; xa < extraAddable.length; xa++) if (next.indexOf(extraAddable[xa].ref) < 0) next.push(extraAddable[xa].ref);
                        patchExtraPreList(extraPreIndex, next);
                        setExtraSeqPick("");
                      }, "xseq-add-all")
                    ] }, "xseq-add"),
                  (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "8px" }, children: cmdButton(t("term.extraPreClose"), function () { setExtraPreIndex(null); }, "extra-pre-close") }, "xseq-close")
                ]
              }, "editor-extra-pre"));
            }
            // 前置序列（"先跑哪些已有命令"，可排序）
            var defined = [];
            defined.push({ ref: "stop", label: termActionLabel({ id: "stop", label: draft.stop.label }, t), command: draft.stop.command });
            for (var di = 0; di < draft.extras.length; di++) {
              if (draft.extras[di].label !== "" && draft.extras[di].command !== "") {
                defined.push({ ref: draft.extras[di].label, label: draft.extras[di].label, command: draft.extras[di].command });
              }
            }
            var seqRows = [];
            for (var qi = 0; qi < draft.preStart.length; qi++) {
              (function (ref, index) {
                var resolved = wsResolveAction(draft, ref);
                if (resolved === null) return;
                seqRows.push((0, react_jsx_runtime.jsxs)("div", {
                  style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" },
                  children: [
                    (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", minWidth: "3em" }, children: String(index + 1) + "." }, "n"),
                    (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", flex: "1 1 auto" }, children: termActionLabel({ id: resolved.id, label: resolved.label }, t) }, "who"),
                    draft.preStart.length > 1 ? cmdButton(t("term.sequenceUp"), function () { moveSeq(index, -1); }, "seq-up-" + index, index === 0) : null,
                    draft.preStart.length > 1 ? cmdButton(t("term.sequenceDown"), function () { moveSeq(index, 1); }, "seq-down-" + index, index === draft.preStart.length - 1) : null,
                    cmdButton(t("term.sequenceRemove"), function () { removeSeq(index); }, "seq-rm-" + index)
                  ]
                }, "seq-" + index));
              })(draft.preStart[qi], qi);
            }
            var addable = [];
            for (var ai = 0; ai < defined.length; ai++) {
              if (defined[ai].command === "") continue;
              if (draft.preStart.indexOf(defined[ai].ref) >= 0) continue;
              addable.push(defined[ai]);
            }
            var previewParts = [];
            for (var pi = 0; pi < draft.preStart.length; pi++) {
              var presolved = wsResolveAction(draft, draft.preStart[pi]);
              if (presolved !== null) previewParts.push(termActionLabel({ id: presolved.id, label: presolved.label }, t));
            }
            var preview = previewParts.length > 0
              ? t("term.preview", { start: termActionLabel({ id: "start", label: draft.start.label }, t), list: previewParts.join(" → ") + " → " + t("term.seqStart") })
              : "";
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: GROUP_BLOCK,
              children: [
                sectionHeading(t("term.startBeforeLabel")),
                grey(t("term.startBeforeHint"), "2px"),
                seqRows.length === 0 ? grey(t("term.startBeforeEmpty"), "2px") : (0, react_jsx_runtime.jsx)("div", { children: seqRows }, "seq-list"),
                addable.length === 0
                  ? grey(seqRows.length === 0 ? t("term.sequenceNoActions") : t("term.sequenceNoMore"), "6px")
                  : (0, react_jsx_runtime.jsxs)("div", {
                    style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "8px" },
                    children: [
                      (0, react_jsx_runtime.jsxs)("select", {
                        value: seqPick,
                        onChange: function (e) { setSeqPick(e && e.target ? e.target.value : ""); },
                        style: { fontSize: "12px", padding: "4px 6px", borderRadius: "6px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l2)", maxWidth: "16em" },
                        children: [
                          (0, react_jsx_runtime.jsx)("option", { value: "", children: t("term.sequencePickPlaceholder") }, "ph"),
                          addable.map(function (item) {
                            return (0, react_jsx_runtime.jsx)("option", { value: item.ref, children: item.label }, "opt-" + item.ref);
                          })
                        ]
                      }, "seq-pick"),
                      cmdButton(t("term.sequenceAdd"), function () {
                        if (seqPick === "") return;
                        addSeq(seqPick);
                        setSeqPick("");
                      }, "seq-add-one", seqPick === ""),
                      cmdButton(t("term.sequenceAddAll"), function () {
                        var next = draft.preStart.slice();
                        for (var ai2 = 0; ai2 < addable.length; ai2++) if (next.indexOf(addable[ai2].ref) < 0) next.push(addable[ai2].ref);
                        patch({ preStart: next });
                        setSeqPick("");
                      }, "seq-add-all")
                    ]
                  }, "seq-add"),
                preview === "" ? null : grey(preview, "6px")
              ]
            }, "editor-seq"));
            // 把输出写入工作区日志文件（A；默认关）
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: GROUP_BLOCK,
              children: [
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px" },
                  children: [
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { minWidth: 0 },
                      children: [
                        (0, react_jsx_runtime.jsx)("div", { style: TYPE_LABEL, children: t("term.logToFile") }),
                        (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-secondary)", marginTop: "4px", fontSize: "12px", lineHeight: "18px" }, children: t("term.logToFileHint") })
                      ]
                    }),
                    (0, react_jsx_runtime.jsx)(primitives.Switch, {
                      checked: draft.logToFile === true,
                      onChange: function () { patch({ logToFile: draft.logToFile !== true }); },
                      disabled: busy,
                      label: t("term.logToFile")
                    })
                  ]
                })
              ]
            }, "editor-log-file"));
            // 超时
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: GROUP_BLOCK,
              children: [
                sectionHeading(t("term.timeoutLabel")),
                grey(t("term.timeoutHint"), "2px"),
                (0, react_jsx_runtime.jsx)("div", {
                  style: { marginTop: "4px", maxWidth: "10em" },
                  children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: String(draft.timeoutSec),
                    inputMode: "numeric",
                    "aria-label": t("term.timeoutLabel"),
                    onChange: function (e) {
                      var raw = e && e.target ? e.target.value : "";
                      var parsed = Number(raw);
                      if (raw === "" || !isFinite(parsed)) return;
                      patch({ timeoutSec: Math.min(TERM_TIMEOUT_MAX, Math.max(TERM_TIMEOUT_MIN, Math.round(parsed))) });
                    }
                  })
                }, "timeout-input")
              ]
            }, "editor-timeout"));
            editorRows.push((0, react_jsx_runtime.jsxs)("div", {
              style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", alignItems: "center", justifyContent: "flex-end" },
              children: [
                cmdButton(t("term.save"), saveDraft, "ws-save"),
                cmdButton(t("term.reset"), resetDraft, "ws-reset")
              ]
            }, "editor-actions"));
            editorPanel = (0, react_jsx_runtime.jsx)("div", {
              "data-dw-editor": "",
              style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "12px", background: "var(--dsw-alias-bg-layer-1)" },
              children: editorRows
            }, "ws-editor");
          }

          var editorEmpty = (0, react_jsx_runtime.jsx)("div", {
            style: { border: "1px dashed var(--dsw-alias-border-l3)", borderRadius: "8px", padding: "16px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: "18px" },
            children: t("term.editorEmpty")
          }, "term-editor-empty");
          var toolbar = (0, react_jsx_runtime.jsxs)("div", {
            style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
            children: [
              cmdButton(t("term.fileToggle"), function () { setFileOpen(!fileOpen); }, "term-file-toggle"),
              cmdButton(t("term.wsAddTitle"), function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); openNew(); }, "term-add-toggle"),
              file.status === "applied" ? (0, react_jsx_runtime.jsx)("span", {
                style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" },
                children: t("term.fileApplied", { n: file.count || 0 })
              }, "term-file-chip") : null
            ]
          }, "term-toolbar");
          var listBlock = (0, react_jsx_runtime.jsxs)("div", {
            style: GROUP_BLOCK,
            children: [
              (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" },
                children: [
                  (0, react_jsx_runtime.jsx)("div", {
                    style: TYPE_SECTION,
                    children: t("term.wsListTitle", { n: workspaces.length })
                  }, "ws-list-title"),
                  toolbar
                ]
              }, "ws-list-head"),
              grey(t("term.wsHint"), "2px"),
              fileOpen ? fileCard : null,
              workspaceTable,
              grey(t("term.wsRemoveHint"), "4px")
            ]
          }, "ws-list-block");

          var logsPanel = (0, react_jsx_runtime.jsxs)("div", {
            style: GROUP_BLOCK,
            children: [
              (0, react_jsx_runtime.jsxs)("div", {
                style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" },
                children: [
                  (0, react_jsx_runtime.jsx)("div", { style: TYPE_SECTION, children: t("term.logsTitle", { n: logs.length }) }),
                  (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px" }, children: [
                    cmdButton(logsOpen ? t("term.logsHide") : t("term.logsShow"), function () { setLogsOpen(!logsOpen); }, "logs-toggle"),
                    cmdButton(t("term.logsClear"), function () { clearTermLogs(); setLogs([]); }, "logs-clear", logs.length === 0)
                  ] })
                ]
              }),
              logsOpen ? (logs.length === 0
                ? grey(t("term.logsEmpty"), "4px")
                : (0, react_jsx_runtime.jsx)("div", {
                  style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" },
                  children: logs.slice(0, 10).map(function (item, index) {
                    return (0, react_jsx_runtime.jsxs)("div", {
                      style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "8px", background: "var(--dsw-alias-bg-layer-1)" },
                      children: [
                        (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }, children: [
                          (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400 }, children: item.label || item.workspace || item.action }),
                          (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" }, children: item.state + (item.code === null ? "" : " · " + item.code) })
                        ] }),
                        (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: "4px", wordBreak: "break-all" }, children: item.at + " · " + item.workspace }),
                        item.logPath === "" ? null : (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: "4px", wordBreak: "break-all" }, children: t("term.logsPath") + ": " + item.logPath }),
                        (0, react_jsx_runtime.jsx)("pre", {
                          style: { margin: "8px 0 0", padding: "6px", maxHeight: "140px", overflow: "auto", fontSize: "12px", lineHeight: "18px", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--dsw-alias-bg-module-platform)", borderRadius: "6px" },
                          children: item.output === "" ? "(no output)" : item.output
                        }),
                        (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "8px" }, children: cmdButton(t("term.logsCopy"), function () { copyLogOutput(item.output); }, "log-copy-" + index) })
                      ]
                    }, "term-log-" + index);
                  })
                }, "term-log-list"))
                : null
            ]
          }, "term-logs");
          var newModal = (0, react_jsx_runtime.jsx)(primitives.Modal, {
            className: "dsh-ha-form-dialog dsh-ha-wide-dialog",
            open: newOpen && draft !== null,
            title: t("term.wsAddTitle"),
            closeLabel: t("term.wsCancel"),
            onClose: function () {
              // Ignore a close event landing in the first 300ms: that is the opening
              // click's tail hitting the mask, not the user asking to dismiss the dialog.
              if (Date.now() - newOpenedAt.current < 300) return;
              closeNew();
            },
            footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
              children: [
                (0, react_jsx_runtime.jsx)(primitives.Button, { variant: "outline", onClick: closeNew, children: t("term.wsCancel") }),
                (0, react_jsx_runtime.jsx)(primitives.Button, { variant: "primary", disabled: busy, onClick: saveNew, children: t("term.wsCreate") })
              ]
            }),
            children: draft === null ? null : (0, react_jsx_runtime.jsxs)("div", {
              style: { maxHeight: "60vh", overflowY: "auto" },
              children: [
                (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", lineHeight: "18px" }, children: t("term.wsHint") }),
                (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400, marginTop: "12px" }, children: t("term.wsColPath") }),
                (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }, children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minWidth: 0 }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: draft.path,
                    placeholder: t("term.wsPathPlaceholder"),
                    "aria-label": t("term.wsPathPlaceholder"),
                    onChange: function (e) { patch({ path: e && e.target ? e.target.value : "" }); }
                  }) }),
                  cmdButton(t("term.wsPick"), pickDirectory, "new-pick")
                ] }),
                (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400, marginTop: "12px" }, children: t("term.wsColName") }),
                (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "4px" }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                  value: draft.label,
                  placeholder: t("term.wsLabelPlaceholder"),
                  "aria-label": t("term.wsLabelLabel"),
                  onChange: function (e) { patch({ label: e && e.target ? e.target.value : "" }); }
                }) }),

                (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400, marginTop: "12px" }, children: t("term.buttonStart") }),
                (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", marginTop: "4px", alignItems: "flex-start", flexWrap: "wrap" }, children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { flex: "0 1 12em", minWidth: "8em" }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: draft.start.label, placeholder: t("term.startLabelLabel"), "aria-label": t("term.startLabelLabel"),
                    onChange: function (e) { patchAction("start", "label", e && e.target ? e.target.value : ""); }
                  }) }),
                  (0, react_jsx_runtime.jsx)("div", { style: { flex: "1 1 20em", minWidth: "12em" }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: draft.start.command, placeholder: t("term.startCommandLabel"), "aria-label": t("term.startCommandLabel"),
                    maxLength: TERM_FIELD_MAX,
                    onChange: function (e) { patchAction("start", "command", e && e.target ? e.target.value : ""); }
                  }) })
                ] }),
                (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400, marginTop: "12px" }, children: t("term.buttonStop") }),
                (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", marginTop: "4px", alignItems: "flex-start", flexWrap: "wrap" }, children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { flex: "0 1 12em", minWidth: "8em" }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: draft.stop.label, placeholder: t("term.stopLabelLabel"), "aria-label": t("term.stopLabelLabel"),
                    onChange: function (e) { patchAction("stop", "label", e && e.target ? e.target.value : ""); }
                  }) }),
                  (0, react_jsx_runtime.jsx)("div", { style: { flex: "1 1 20em", minWidth: "12em" }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                    value: draft.stop.command, placeholder: t("term.stopCommandLabel"), "aria-label": t("term.stopCommandLabel"),
                    maxLength: TERM_FIELD_MAX,
                    onChange: function (e) { patchAction("stop", "command", e && e.target ? e.target.value : ""); }
                  }) })
                ] }),

                (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "12px" }, children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400 }, children: t("term.extraTitle") }),
                  cmdButton(t("term.extraAdd"), addExtra, "new-extra-add")
                ] }),
                draft.extras.length === 0 ? (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: "4px" }, children: t("term.extraEmpty") }) : null,
                draft.extras.map(function (extra, index) {
                  return (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "4px", alignItems: "center", marginTop: "4px" }, children: [
                    (0, react_jsx_runtime.jsx)("div", { style: { flex: 1, minWidth: 0 }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                      value: extra.label, placeholder: t("term.labelPlaceholder"), "aria-label": t("term.labelPlaceholder"),
                      onChange: function (e) { patchExtra(index, "label", e && e.target ? e.target.value : ""); }
                    }) }),
                    (0, react_jsx_runtime.jsx)("div", { style: { flex: 2, minWidth: 0 }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                      value: extra.command, placeholder: t("term.commandPlaceholder"), "aria-label": t("term.commandPlaceholder"),
                      maxLength: TERM_FIELD_MAX,
                      onChange: function (e) { patchExtra(index, "command", e && e.target ? e.target.value : ""); }
                    }) }),
                    cmdButton(t("term.extraRemove"), function () { removeExtra(index); }, "new-extra-rm-" + index)
                  ] }, "new-extra-" + index);
                }),

                (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "12px" }, children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400 }, children: t("term.stopBeforeStart") }),
                  (0, react_jsx_runtime.jsx)(primitives.Switch, {
                    checked: draft.stopBeforeStart === true,
                    onChange: function () { patch({ stopBeforeStart: draft.stopBeforeStart !== true }); },
                    disabled: busy,
                    label: t("term.stopBeforeStart")
                  })
                ] }),
                (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "12px" }, children: [
                  (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400 }, children: t("term.logToFile") }),
                  (0, react_jsx_runtime.jsx)(primitives.Switch, {
                    checked: draft.logToFile === true,
                    onChange: function () { patch({ logToFile: draft.logToFile !== true }); },
                    disabled: busy,
                    label: t("term.logToFile")
                  })
                ] }),
                (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: 400, marginTop: "12px" }, children: t("term.timeoutLabel") }),
                (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "4px" }, children: (0, react_jsx_runtime.jsx)(primitives.Input, {
                  value: String(draft.timeoutSec),
                  "aria-label": t("term.timeoutLabel"),
                  onChange: function (e) {
                    var next = Number(e && e.target ? e.target.value : "");
                    patch({ timeoutSec: isFinite(next) ? next : TERM_TIMEOUT_DEFAULT });
                  }
                }) }),
                note === "" ? null : (0, react_jsx_runtime.jsx)("div", {
                  style: { marginTop: "8px", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", userSelect: "text" },
                  children: note
                }, "new-note")
              ]
            })
          }, "term-new-modal");

          return (0, react_jsx_runtime.jsx)("div", {
            children: [
              grey(t("term.settingsHint"), "2px"),
              (0, react_jsx_runtime.jsx)("div", { children: statusRows }, "ws-status"),
              batchBar,
              listBlock,
              draft === null ? editorEmpty : editorPanel,
              newModal,
              logsPanel
            ]
          }, "cmd-settings");
        }

        var t = props.t;
        var focus = (0, react.useState)(null);
        var setFocus = focus[1];
        // 当前 tab：会话级 state 即可（设计稿：不必持久化）。
        var tabState = (0, react.useState)("basic");
        var activeTab = tabState[0];
        var setTab = tabState[1];
        // 「写入在飞」：本地存储是同步的，但纪律②要求"在飞时禁用"有一个**真实的结构位点** ——
        // 所有写路径都经过 withBusy()，控件读同一个 `busy`。
        var busyState = (0, react.useState)(false);
        var busy = busyState[0];
        var setBusy = busyState[1];
        // The command-buttons editor is declared INSIDE this component. A plain
        // <CommandButtonsSettings/> would therefore be a NEW component type on every
        // parent render (the focus refresh re-renders this page every 5s), so React
        // would unmount it and reset all local state: checked boxes cleared, the
        // new-workspace dialog closed, the draft lost. Pin the first function object.
        var stableCommandButtons = (0, react.useRef)(null);
        if (stableCommandButtons.current === null) stableCommandButtons.current = CommandButtonsSettings;
        var readFocus = function () { return typeof testHooks.readFocus === "function" ? testHooks.readFocus() : null; };
        var refreshFocus = function () {
          try { setFocus(typeof readFocus === "function" ? readFocus() : null); } catch (e) { setFocus(null); }
        };
        var state = (0, react.useState)(function () { return readSettings(); });
        var setState = state[1];
        var focusDefault = focusDefaultsFrom(state[0]);
        /**
         * 引入状态在 **apply 时**的快照：与当前存储不一致的档位，改了也**还没生效**
         * （注册发生在 apply 里）⇒ 那一行下面必须长出那句「改动需点顶部重新加载」的文字提示
         * （2026-10-17 起从按钮改成纯文字：用户要求全页只保留顶部那一颗重载按钮）。
         * 拿不到快照（老宿主 / 桩）时退化成"永远不需要重载"，绝不误报。
         */
        /**
         * 可引入 / 移除的功能清单。顺序与文案来自工厂作用域的 FEATURE_KEYS / FEATURE_META
         * （**一处定义**：apply 时的快照、注册门与这里用的是同一份，不许各存一份）。
         */
        var FEATURES = FEATURE_KEYS.map(function (key) {
          var meta = FEATURE_META[key];
          return { key: key, name: meta.name, desc: meta.desc, tab: meta.tab };
        });
        // 未引入的档位要在每次渲染时按**当前**存储重算：本组件不在任何槽位重绘路径上
        // （§0 的机制），所以只要它自己重渲染就必须读最新值，不能缓存。
        var offNow = [];
        for (var fi = 0; fi < FEATURES.length; fi++) {
          try {
            if (readSettings()[FEATURES[fi].key] === false) offNow.push(t(FEATURES[fi].name));
          } catch (e) { /* 读不到就不算"未引入" —— 与 featureEnabled 的失败语义一致 */ }
        }
        var failedCount = 0;
        try {
          for (var fk in shortcutStatus) {
            if (Object.prototype.hasOwnProperty.call(shortcutStatus, fk) && String(shortcutStatus[fk]).indexOf("failed") === 0) failedCount = failedCount + 1;
          }
        } catch (e) { failedCount = 0; }
        var hasFailures = applyFailures.length > 0 || failedCount > 0;
        /**
         * 一档功能是不是**已引入**。
         *
         * 与 `featureEnabled()` 同一条规则（默认开、只有显式 `false` 才是"不引入"、
         * 读失败一律当已引入）：设置页自己也要在渲染前知道答案，而 `featureEnabled()`
         * 读的是**存储**、`state[0]` 读的是**本次渲染的快照** —— 写完之后要立刻反映，
         * 所以这里用 `state[0]`（与下面 `row()` 的 checked 表达式同一个来源）。
         * @param {string} key
         * @returns {boolean}
         */
        function featureOn(key) {
          try { return state[0][key] !== false; } catch (e) { return true; }
        }
        /** 一个功能档位在 FEATURES 里的那条记录（找不到返回 null）。 */
        function featureItem(key) {
          for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].key === key) return FEATURES[i];
          return null;
        }
        /** 某个 tab 归属的全部功能（按 FEATURE_KEYS 的顺序）。 */
        function featuresOfTab(value) {
          return FEATURES.filter(function (item) { return item.tab === value; });
        }
        /** 某个 tab 里**未引入**的功能。 */
        function offFeaturesOfTab(value) {
          return featuresOfTab(value).filter(function (item) { return !featureOn(item.key); });
        }
        /** 7 档里**已引入**的档数（读 `state[0]` = 本次渲染的快照，写完立刻反映）。 */
        function onCount() {
          var n = 0;
          for (var i = 0; i < FEATURES.length; i++) if (featureOn(FEATURES[i].key)) n = n + 1;
          return n;
        }
        /** 这个 tab 是不是"整体不可用"：它归属的所有功能都未引入 ⇒ 面板里没有可用的东西。 */
        function tabAllOff(value) {
          var mine = featuresOfTab(value);
          return mine.length > 0 && offFeaturesOfTab(value).length === mine.length;
        }
        /**
         * **恢复页**：唯一装着"把功能开回来"的全部手段的面板。
         *
         * 它同时长着三样东西，而这三样都是出路：
         *   · 7 个「引入 / 移除」开关 —— 把任何一档开回来的**唯一**入口；
         *   · 每个改动行下面的那句「改动需点顶部重新加载」文字提示；
         *   · 顶部那颗主「重新加载界面」（桌面 App 没有 Cmd+R，这是唯一的重载手段；
         *     2026-10-17 起也是**全页唯一**的一颗 —— 内联按钮已按用户要求删掉）。
         *
         * 2026-10-16 真机锁死事故：`tabAllOff` 的判据是"这一页里还有没有可用的东西"，而
         * 「基础」页**只归属 featureNotice 一档** ⇒ 只要"通知与气泡"未引入，
         * `tabAllOff("basic")` 就为真 ⇒ 整页套上 `OFF_STYLE` 的 `pointerEvents: "none"`
         * ⇒ 上面三样**全部点不动** ⇒ 用户被锁死，**没有任何恢复路径**（连"把功能开回来"
         * 的开关都点不到）。这与本插件自己那条"必须留一条出路"（`deepworker.reload` 永远
         * 注册）直接矛盾。
         *
         * ⇒ 这一页**永不**整块禁用。判据换成"这一页是不是唯一出路"，用常量点名；名字或
         *   控件搬家都会被 verify_render 的恢复路径断言抓到（它断的是**控件住在这个面板里**，
         *   不是常量值本身）。"关闭必须可见"这条不靠整页变灰实现：汇总行照写
         *   「未引入 N 项：…」、每一档照写「未引入：…」+ 那句「需重载」提示。
         */
        var RECOVERY_TAB = "basic";
        /**
         * **永不整块禁用**的面板（值 = 它为什么必须留有出路）。
         *
         * `tabAllOff` 问的是"这一页里还有没有可用的东西"；被套上 `OFF_STYLE`
         * （`pointerEvents: "none"`）之后，页面里**控件**就全点不动了。所以凡是"页面里装着
         * 某个开关、而那个开关本身是它唯一/主要恢复入口"的面板，都不能整块冻住：
         *   · basic    = 恢复页：总开关 + 7 档开关 + 顶部主重载同页（2026-10-16 锁死事故的修复）；
         *   · notes    = 装着「摘要」那一档的开关（2026-10-17 从「基础」搬来）——
         *                它自己就是这一档的恢复入口，冻住它就等于只剩"一键全开"能救；
         *   · terminal = 只有一个小节，未引入时**小节级**灰态已经足够；整页再灰一次只会把
         *                同一句指路显示两遍（用户明确要的是"按小节灰即可"）。
         */
        var NO_PANEL_GREY_TABS = [RECOVERY_TAB, "notes", "terminal"];
        /**
         * 哪些档位的**开关**不住在「基础」页（值 = 它现在住在哪个 tab）。
         *
         * 2026-10-17 用户要求把「摘要」的开关搬进「笔记」页。这是**唯一**一处记账：
         * 基础页按它过滤掉被搬走的档位，笔记页按它把对应那一行取回来渲染 ——
         * 两处各写一份清单迟早会漂（一边留下副本 = "搬家"退化成"复制"）。
         * ⚠️ 它**不**影响 `FEATURE_META[*].tab`：那是"这一档自己的设置住在哪"，两件事不同。
         */
        var SWITCH_HOME = { featureDigest: "notes" };
        /**
         * "未引入"到底等于什么。设计稿 §4.1：不能只有开关，必须写清代价。
         * @returns {string} 永远是给用户看的一句话，不是空串。
         */
        function offHintOf(item) {
          try {
            if (item.key === "featureFocusLock") return t("feature.hintFocusLockOff");
            if (item.key === "featureNotice") return t("feature.hintNoticeOff");
            if (item.key === "featureFind") return t("feature.hintFindOff");
            if (item.key === "featureQuote") return t("feature.hintQuoteOff");
            if (item.key === "featureDigest") return t("feature.hintDigestOff");
            if (item.key === "featureNotes") return t("feature.hintNotesOff");
            if (item.key === "featureTurnActions") return t("feature.hintTurnActionsOff");
            if (item.key === "featureTerminal") return t("feature.hintTerminalOff");
          } catch (e) { /* fall through to the generic line */ }
          return t("feature.hintGenericOff");
        }
        /** 跑一个写设置的动作，期间 `busy=true`（失败也要复位 —— 卡在 in-flight 是死锁）。 */
        function withBusy(action) {
          setBusy(true);
          try { return action(); } finally { setBusy(false); }
        }
        /**
         * 官方设置行配方（逐字取自 `dsh-client-ui-settings-general/lib/client.js:668`）：
         *   .row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;
         *        align-items:center;gap:24px;padding:16px 0;display:flex}
         * 本包没有 CSS module（shell 只发布了 primitives 自己的样式），所以用行内样式复刻。
         */
        var TYPE_SECTION = { fontSize: "13px", lineHeight: "20px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" };
        var TYPE_LABEL = { fontSize: "12px", lineHeight: "18px", fontWeight: 400, color: "var(--dsw-alias-label-primary)" };
        var TYPE_BODY = { fontSize: "12px", lineHeight: "18px" };
        var SECTION_BLOCK = { borderTop: "1px solid var(--dsw-alias-border-l2)", marginTop: "24px", paddingTop: "12px" };
        var SUBSECTION = { marginTop: "16px" };
        var GROUP_BLOCK = { borderTop: "1px solid var(--dsw-alias-border-l2)", marginTop: "20px", paddingTop: "12px" };
        var CARD_FIRST = { marginTop: "0" };
        var ROW_STYLE = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px", padding: "8px 0" };
        var ROW_TITLE_STYLE = TYPE_LABEL;
        var ROW_DESC_STYLE = { color: "var(--dsw-alias-label-secondary)", marginTop: "4px", fontSize: TYPE_BODY.fontSize, lineHeight: TYPE_BODY.lineHeight };
        /** 未引入的小节 / 面板的"不可用"外观：仍然**可见**（不隐藏），但明显灰掉且点不动。 */
        var OFF_STYLE = { opacity: 0.55, pointerEvents: "none" };
        /**
         * 一条设置行：左边「标题 + 灰字说明」，右边官方受控 `Switch`。
         *
         * ⚠️ `Switch` 的 `label` **只进 `aria-label`**（它不渲染任何文字），所以可见文字
         * 必须由这个兄弟节点提供 —— 否则页面上就是一排没有名字的开关。
         * @param {string} key 设置键，同时决定 checked 的默认方向。
         * @param {string} label 可见文字，同时作为 Switch 的无障碍名。
         * @param {string=|Function=} description 可选的灰字说明；传**函数**时按当前状态现算
         *   （总开关那一行要靠它写"现在只引入了 N/7 档"：DSH 没有三态开关原语，混合态只能用
         *   灰字说明表达，见 toggleAll）。
         * @param {{checked?:boolean, onToggle?:Function}=} over 可选覆盖。只有总开关那一行用：
         *   它的 checked 是**派生**的（7 档全开才算开），动作也不是 toggle(key) 而是 toggleAll。
         *   ⚠️ 给了 `over` 却漏了 `onToggle` 时**什么都不做**，绝不退化回 `toggle(key)` ——
         *   那会往存储里写进一个不存在的设置键（"说得比做得多"）。
         */
        function row(key, label, description, over) {
          var isOn = key === "featureFocusLock" || key === "featureNotice" || key === "featureNotes"
            || key === "featureFind" || key === "featureQuote" || key === "featureDigest"
            || key === "featureTurnActions"
            ? state[0][key] !== false
            : (key === "focusNativeNotice" ? state[0][key] !== false : state[0][key] === true);
          var hasOver = over !== undefined && over !== null;
          if (hasOver && over.checked !== undefined) isOn = over.checked === true;
          var heading = hasOver && over.heading === true;
          var titleStyle = heading ? TYPE_SECTION : ROW_TITLE_STYLE;
          var desc = typeof description === "function" ? description() : description;
          return (0, react_jsx_runtime.jsxs)("div", {
            style: ROW_STYLE,
            children: [
              (0, react_jsx_runtime.jsxs)("div", {
                style: { minWidth: 0 },
                children: [
                  (0, react_jsx_runtime.jsx)("div", {
                    style: isOn ? titleStyle : Object.assign({}, titleStyle, { color: "var(--dsw-alias-label-tertiary)" }),
                    children: label
                  }),
                  desc === undefined || desc === null ? null : (0, react_jsx_runtime.jsx)("div", { style: ROW_DESC_STYLE, children: desc })
                ]
              }),
              (0, react_jsx_runtime.jsx)(primitives.Switch, {
                checked: isOn,
                onChange: function () {
                  if (hasOver) { if (typeof over.onToggle === "function") over.onToggle(); return; }
                  toggle(key);
                },
                disabled: busy,
                label: label
              })
            ]
          }, key);
        }
        /**
         * 「未引入」的**指路**行（设计稿：灰掉 + 指路，入口**不隐藏**）。
         * 一句话说清"它没被注册"和"去哪里打开"。
         * @param {Array<{name: string}>} items 未引入的档位
         * @param {string} key React key（同一个面板里可能不止一条）
         */
        function notIntroducedBanner(items, key) {
          return (0, react_jsx_runtime.jsxs)("div", {
            role: "note",
            style: { margin: "8px 0", padding: "8px 10px", borderRadius: "var(--dsw-radius-md)", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", fontSize: TYPE_BODY.fontSize, lineHeight: TYPE_BODY.lineHeight },
            children: [
              "⚠ " + t("settings.tabIntroOff"),
              items.length === 0 ? null : " · " + items.map(function (item) { return t(item.name); }).join("、")
            ]
          }, key);
        }
        /** 一个功能档位 = Switch 行 +（未引入时）灰字说明 +（改过引入状态时）一句「需重载」提示。 */
        function featureRow(item, over) {
          var isOn = featureOn(item.key);
          return (0, react_jsx_runtime.jsxs)("div", {
            style: { padding: "0" },
            children: [
              row(item.key, t(item.name), t(item.desc), over),
              isOn ? null : (0, react_jsx_runtime.jsx)("div", {
                style: { margin: "0 0 8px 0", fontSize: TYPE_BODY.fontSize, lineHeight: TYPE_BODY.lineHeight, color: "var(--dsw-alias-label-tertiary)" },
                children: t("feature.offPrefix") + offHintOf(item)
              }),
            ]
          }, "feature-row-" + item.key);
        }
        /**
         * 一个**功能小节**：它归属的那一档未引入时，整个小节灰掉 + 指路（**不隐藏**）。
         *
         * 为什么是按小节而不是按 tab：一个 tab 可能装好几档（笔记 = 笔记 / 摘要），
         * 把整页废掉会连带藏掉还开着的功能。整页废掉只在**该 tab 的每一档都未引入**时才做
         * （见 `tabAllOff`）—— 那时页面里确实没有可用的东西了。
         */
        function featureSection(featureKey, children) {
          var on = featureOn(featureKey);
          var item = featureItem(featureKey);
          return (0, react_jsx_runtime.jsxs)("div", {
            "aria-disabled": on ? undefined : "true",
            style: on ? undefined : OFF_STYLE,
            children: [
              on ? null : notIntroducedBanner(item === null ? [] : [item], "off-" + featureKey),
              children
            ]
          }, "feature-section-" + featureKey);
        }
        /**
         * 折叠区（原生 `<details>`，默认收起 ⇒ 三角语义正确）。
         * ⚠️ `open` **必须**接到 `openByDefault` 上：把它丢掉会让这个形参变成死参数，
         *    折叠区的默认态就再也测不动了（把 true 传成 false 也不会红）。
         * `badge` 只为历史调用保留，两处调用都传 null。
         */
        function settingsSection(summaryText, hint, badge, openByDefault, children) {
          return (0, react_jsx_runtime.jsxs)("details", {
            open: openByDefault === true,
            style: { marginTop: "8px" },
            children: [
              (0, react_jsx_runtime.jsx)("summary", { style: Object.assign({}, TYPE_LABEL, { fontWeight: 400, cursor: "pointer", padding: "4px 0" }), children: summaryText }),
              hint === null ? null : (0, react_jsx_runtime.jsx)("div", { style: { fontSize: TYPE_BODY.fontSize, lineHeight: TYPE_BODY.lineHeight, color: "var(--dsw-alias-label-tertiary)", margin: "4px 0 6px" }, children: hint }),
              badge === null ? null : (0, react_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary)", margin: "4px 0" }, children: badge }),
              (0, react_jsx_runtime.jsx)("div", { children: children })
            ]
          }, "section-" + summaryText);
        }
        function focusStateLine() {
          return describeFocusState(focus[0], t, Date.now());
        }
        function debugRow(label, value) {
          return (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "4px", wordBreak: "break-word", userSelect: "text" }, children: label + " " + value }, null);
        }
        /** 一个 tab 的面板。`hidden` 保活（**不条件卸载**），id 与 aria-labelledby 严格对齐组件拼出的值。 */
        function settingsPanel(value, children) {
          // ⚠️ 恢复页永不整块禁用（2026-10-16 锁死事故的修复点）：见 RECOVERY_TAB 的注释。
          //    `tabAllOff` 问的是"这一页里还有没有可用的东西"，而恢复页要问的是
          //    "这一页被禁用之后还有没有出路" —— 两个问题不是一回事，所以必须分开判。
          var allOff = tabAllOff(value) && NO_PANEL_GREY_TABS.indexOf(value) === -1;
          return (0, react_jsx_runtime.jsx)("div", {
            role: "tabpanel",
            id: settingsPanelId(value),
            "aria-labelledby": settingsTabId(value),
            hidden: activeTab !== value,
            "aria-disabled": allOff ? "true" : undefined,
            style: { marginTop: "16px" },
            children: allOff
              ? (0, react_jsx_runtime.jsxs)("div", {
                style: OFF_STYLE,
                children: [notIntroducedBanner(offFeaturesOfTab(value), "panel-off-" + value), children]
              })
              : children
          }, "panel-" + value);
        }
        /** 小节标题（面板内部的视觉分组）。 */
        function sectionHeading(text) {
          return (0, react_jsx_runtime.jsx)("div", { style: Object.assign({}, TYPE_SECTION, { margin: "0 0 6px" }), children: text }, "h-" + text);
        }
        /** 灰字说明段。 */
        function grey(text, marginTop) {
          return (0, react_jsx_runtime.jsx)("div", {
            style: { fontSize: TYPE_BODY.fontSize, lineHeight: TYPE_BODY.lineHeight, color: "var(--dsw-alias-label-secondary)", marginTop: marginTop === undefined ? "4px" : marginTop },
            children: text
          }, "grey-" + text);
        }
        /**
         * 设置页的**次要动作**按钮。
         *
         * 一律走官方 Button（`variant="outline" size="sm"` = 28px 高 / 12px 字 /
         * 8px 圆角 / 官方描边），**不许**再手写 `<button>` —— 手写那一版的字号、内边距、圆角
         * 与 App 其它按钮都不一致（用户原话："里面的按钮好丑"）。
         *
         * ⚠️ `Button` 的真实签名（app.asar 现读，`dsh-client-ui-primitives/lib/index.js:3207-3227`）：
         *    `forwardRef(function Button({ variant = "ghost", size = "md", icon, className,
         *      children, ...rest }, ref)`
         *    ⇒ `onClick` / `disabled` / `title` 都由 `...rest` 透传给原生 `<button>`；
         *      `children` 就是可见文字；`variant` ∈ primary | ghost | outline | toolbar。
         * ⚠️ React 19：`key` 只能走 `jsx(type, props, key)` 的**第三参**，绝不塞进 props。
         * @param {string} label 可见文字（= children）
         * @param {Function} onClick 点击处理
         * @param {string} key React key（第三参）
         */
        function smallButton(label, onClick, key) {
          return (0, react_jsx_runtime.jsx)(primitives.Button, {
            variant: "outline",
            size: "sm",
            disabled: busy,
            onClick: onClick,
            children: label
          }, key);
        }
        /**
         * 写一个开关并让别处跟着重画。只在**写入成功**后通知：写失败却通知，界面会显示一个
         * 存储里没有的状态（"说得比做得多"，本机已把这类列为缺陷形状）。
         */
        /** Write a non-boolean setting (scope/minutes) and repaint only on success. */
        function patchSetting(key, value) {
          withBusy(function () {
            var next = readSettings();
            next[key] = value;
            var written = writeSettings(next);
            setState(next);
            if (!written.ok) {
              showNotice(t("notes.writeFailed") + " " + (written.error || ""), { clientX: 24, clientY: 24 }, { always: true });
              return;
            }
            notifySettingsChanged();
          });
        }
        function toggle(key) {
          withBusy(function () {
            var next = readSettings();
            var turningOff = next[key] === true;
            // ⚠️⚠️ **顺序硬要求**：关掉「专注锁」之前**必须先解锁**（会话级 + 工作区级 +
            //    撤销宿主对象上的拦截器）。理由是结构性的：`installFocusClicks` 在**注册时**
            //    受 `featureFocusLock` 门控，注册之后**不再看那个开关** —— 它的判据是锁状态
            //    本身。所以"先把设置写了、再补解锁"之间有一个真实窗口：那一刻功能已经关了、
            //    人还被锁在里面（本机 2026-10-16 改版前的形状）。现在整段交给
            //    `testHooks.featureFocusLockOff` ⇒ **先解锁 → 再写设置 → 再说话**。
            //    解锁失败 ⇒ 它一个设置都不改，只把失败说出来（宁可关不掉，也不能把人锁死）。
            if (turningOff && key === "featureFocusLock") {
              var rel = null;
              try { rel = typeof testHooks.featureFocusLockOff === "function" ? testHooks.featureFocusLockOff() : null; } catch (e) { rel = null; }
              // 无论成败都以**存储里的真实值**重画：解锁失败时设置没动，界面必须照旧
              // （显示一个存储里没有的状态就是"说得比做得多"）。
              setState(readSettings());
              if (rel !== null && rel.ok === true) { notifySettingsChanged(); return; }
              if (rel === null) {
                showNotice(t("settings.masterHookMissing"), { clientX: 24, clientY: 24 }, { always: true });
              }
              return;
            }
            next[key] = !turningOff;
            var written = writeSettings(next);
            setState(next);
            if (!written.ok) {
              showNotice(t("notes.writeFailed") + " " + (written.error || ""), { clientX: 24, clientY: 24 }, { always: true });
              return;
            }
            notifySettingsChanged();
          });
        }
        /**
         * 「全部功能（一键全开 / 全关）」的动作。
         *
         * 显示规则（**已定**）：**只有 7 档全开才算"开"**。混合态显示为"关"，并在灰字说明里
         * 写「现在只引入了 N/7 档」—— 不做三态组件（DSH 没有三态原语，硬造一个会成为这一页
         * 最不可预测的控件）。于是混合态点一下 = **全开**，与"显示为关"完全一致，不会出现
         * 点了没反应。
         *
         * ⚠️ 关的那一半**必须先解锁所有锁**（见 `featureOffTransaction`）；解锁失败时
         *    `featureMasterOff` 一个设置都不改，界面照旧。
         */
        function toggleAll() {
          withBusy(function () {
            var wanted = onCount() !== FEATURES.length;   // 有任何一档没开 ⇒ 这一下是"全开"
            var result = null;
            try {
              if (wanted) result = typeof testHooks.featureMasterOn === "function" ? testHooks.featureMasterOn() : null;
              else result = typeof testHooks.featureMasterOff === "function" ? testHooks.featureMasterOff() : null;
            } catch (e) { result = null; }
            setState(readSettings());
            if (result === null) {
              showNotice(t("settings.masterHookMissing"), { clientX: 24, clientY: 24 }, { always: true });
              return;
            }
            if (result.ok === true) notifySettingsChanged();
          });
        }
        // 订阅"设置被改动"。本组件不在任何槽位重绘路径上（§0：槽位条目不会因为
        // localStorage 变了就重绘），所以别处改了设置时靠这个把它自己叫醒。
        var bump = (0, react.useState)(0);
        var setBump = bump[1];
        (0, react.useEffect)(function () {
          return onSettingsChanged(function () { setBump(function (n) { return n + 1; }); });
        }, []);
        // 进页读一次，并且每 5 秒刷新：锁可能在设置页开着时到期，状态行不能停在旧值。
        (0, react.useEffect)(function () {
          // The countdown/status only matters while the focus tab is visible. Polling on
          // every tab made the whole settings page re-render every 5 s for nothing.
          if (activeTab !== "focus") return undefined;
          refreshFocus();
          if (typeof setInterval !== "function") return undefined;
          var timer = setInterval(refreshFocus, 5000);
          return function () { if (typeof clearInterval === "function") clearInterval(timer); };
        }, [activeTab]);
        /**
         * 「摘要」那一档的 FEATURES 记录 —— 它的**开关**住在「笔记」页（`SWITCH_HOME`）。
         * 取不到（理论上不会）时渲染成 null，绝不让一个 undefined 变成一片空白。
         */
        var digestItem = featureItem("featureDigest");
        var commandIds = (function () {
          try {
            return Object.keys(shortcutStatus).sort();
          } catch (e) {
            return [];
          }
        })();

        return (0, react_jsx_runtime.jsxs)("div", {
          style: { color: "var(--dsw-alias-label-primary)" },
          children: [
            // ── ① tab 条 ──────────────────────────────────────────────────────────
            (0, react_jsx_runtime.jsx)(primitives.SegmentedControl, {
              id: SETTINGS_TAB_ID,
              value: activeTab,
              options: SETTINGS_TABS.map(function (item) {
                return { value: item.value, label: t(item.labelKey) };
              }),
              onChange: function (next) { setTab(next); },
              label: t("settings.tabsLabel")
            }, "tabs"),
            // ── ② 基础（内容最多的一页；「功能引入 / 移除」是它的视觉主体）────────────
            settingsPanel("basic", (0, react_jsx_runtime.jsxs)("div", {
              children: [
                // 顶部固定条：重载说明 + 构建标记 + 失败角标（永远可见、不折叠）。
                // 动作在前、读数在后；**不写** justifyContent ⇒ 默认 flex-start ⇒ 两者读起来
                // 是**一组**。桌面 App 没有 Cmd+R，插件更新只能 Cmd+Q 完全退出再开。
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { position: "sticky", top: 0, zIndex: 1, background: "var(--dsw-alias-bg-layer-1)", padding: "6px 0 8px", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
                  children: [
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" },
                      title: t("settings.reloadHint"),
                      children: [
                        (0, react_jsx_runtime.jsx)("span", {
                          style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" },
                          children: t("settings.reloadHint")
                        }, "reload-hint"),
                        (0, react_jsx_runtime.jsx)("div", {
                          style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
                          title: t("settings.versionTitle") + " · " + buildStatus(),
                          children: BUILD
                        })
                      ]
                    }),
                    hasFailures ? (0, react_jsx_runtime.jsx)("div", {
                      style: { marginTop: "8px", padding: "6px 8px", borderRadius: "6px", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-state-error-primary)", fontSize: "12px", lineHeight: "18px" },
                      children: "⚠ " + t("settings.failureBanner", { commands: failedCount, contributions: applyFailures.length })
                    }) : null
                  ]
                }),
                // ② 功能引入 / 移除 —— 本页的视觉主体：卡片 + 15px 标题 + 每行灰字说明。
                (0, react_jsx_runtime.jsxs)("div", {
                  style: { marginTop: "12px" },
                  children: [
                    (0, react_jsx_runtime.jsx)("div", {
                      style: Object.assign({}, TYPE_SECTION, { padding: "0 0 2px" }),
                      title: t("settings.featureAllOnHint"),
                      children: t("feature.section")
                    }),
                    // 2026-10-17：用户问「为什么会话操作里已经有的开关，基础页要再挂一遍？」
                    //   ⇒ 实测没有重复，是**文案没讲清**两种开关的区别。这句话就放在卡片标题
                    //   正下方（总开关之前）：先读它，再读那一排开关。
                    //   `data-dw-feature-scope-note` 是给套件的机械钩子（断言按元素判据，
                    //   不靠"页面上出现过这串字"——那种断言会被别处的同名字符串满足）。
                    (0, react_jsx_runtime.jsx)("div", {
                      "data-dw-feature-scope-note": "",
                      style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", padding: "2px 0 8px" },
                      children: t("settings.featureScopeNote")
                    }, "feature-scope-note"),
                    // ── 总开关：**卡片顶部**、与其它行同构的一行（左标题 + 灰字说明，右 Switch）。
                    //    ⚠️ 它**永远可点**：它不在任何 featureSection / 灰态子树里，而且它住的
                    //    「基础」页正是永不整块禁用的恢复页（RECOVERY_TAB）⇒ 锁死在结构上不可能
                    //    再发生：把任何一档开回来的入口就在这一页顶部。
                    //    开 = 全部档开；关 = 全部档关（**关之前先解锁所有锁**）。
                    //    ⚠️ 档数一律用 FEATURES.length，绝不写死数字 —— 加档当天写死的
                    //    "7 档" 就会变成一句谎话（2026-10-16 加第 8 档即如此）。
                    row("__all__", t("settings.masterSwitch"), function () {
                      var on = onCount();
                      if (on === FEATURES.length) return t("settings.masterDescOn", { total: FEATURES.length });
                      if (on === 0) return t("settings.masterDescOff", { total: FEATURES.length });
                      return t("settings.masterDescPartial", { on: on, total: FEATURES.length });
                    }, { checked: onCount() === FEATURES.length, onToggle: toggleAll }),
                    // 「全部功能都已引入」是**配置读数**、不是系统健康状况 ⇒ 中性灰（label-tertiary）。
                    // 红色只留给"确实有未引入项"的情形，颜色才携带信息。
                    (0, react_jsx_runtime.jsx)("div", {
                      style: {
                        fontSize: "12px",
                        lineHeight: "18px",
                        color: offNow.length === 0 ? "var(--dsw-alias-label-tertiary)" : "var(--dsw-alias-state-error-primary)",
                        margin: "4px 0"
                      },
                      children: offNow.length === 0 ? t("settings.featureAllOn") : t("settings.featureSummary", { n: offNow.length, list: offNow.join("、") })
                    }),
                    // ⚠️ 2026-10-17：「摘要」的开关搬进「笔记」页（见 SWITCH_HOME）⇒ 这里
                    //    只列**开关住在本页**的档位。档数**不写死**：永远 = FEATURES 减去
                    //    被搬走的那些（写死"7 档"会在下次搬家当天变成一句谎话）。
                    (0, react_jsx_runtime.jsx)("div", { children: FEATURES.filter(function (f) { return SWITCH_HOME[f.key] === undefined; }).map(function (f) { return featureRow(f); }) })
                  ]
                }),
                // ③ 通知
                (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [
                    sectionHeading(t("notice.title")),
                    row("focusNativeNotice", t("settings.nativeNotice"), t("notice.hint")),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" },
                      children: [
                        smallButton(t("notice.onlyThis"), function () { if (typeof testHooks.noticeOnlyCurrent === "function") testHooks.noticeOnlyCurrent(); }, "notice-only-this"),
                        smallButton(t("notice.muteThis"), function () { if (typeof testHooks.noticeMuteCurrent === "function") testHooks.noticeMuteCurrent(); }, "notice-mute-this"),
                        smallButton(t("notice.clear"), function () { if (typeof testHooks.noticeClearScope === "function") testHooks.noticeClearScope(); }, "notice-clear")
                      ]
                    })
                  ]
                }),
                // ④ 调试（默认收起）
                //    ⚠️ 「存储位置」原来是这一页的小节 ④ —— 2026-10-16 二次分组把它搬进
                //    「笔记」tab（它讲的是笔记存哪、怎么导出）。基础页现在只剩三块：
                //    功能引入/移除 · 通知 · 调试。
                settingsSection(t("settings.section.debug"), t("settings.debugHint"), null, false, (0, react_jsx_runtime.jsxs)("div", {
                  style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
                  children: [
                    (0, react_jsx_runtime.jsx)("div", { children: t("settings.shortcutStatus") }),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { marginTop: "4px", userSelect: "text" },
                      children: commandIds.length === 0
                        ? t("settings.shortcutNone")
                        : commandIds.map(function (id) {
                          var value = shortcutStatus[id];
                          var shown = value === undefined ? "not-registered" : String(value);
                          var short = id.indexOf("deepworker.") === 0 ? id.slice("deepworker.".length) : id;
                          var bad = shown.indexOf("failed") === 0;
                          return (0, react_jsx_runtime.jsx)("div", {
                            style: bad ? { color: "var(--dsw-alias-state-error-primary)" } : null,
                            children: short + "=" + shown
                          }, "cmd-" + id);
                        })
                    }),
                    applyFailures.length > 0 ? (0, react_jsx_runtime.jsx)("div", {
                      style: { marginTop: "8px", color: "var(--dsw-alias-state-error-primary)" },
                      children: t("settings.applyFailures") + " " + applyFailures.join(" · ")
                    }) : null,
                    lastJumpDiag === "" ? null : (0, react_jsx_runtime.jsx)("div", {
                      style: { marginTop: "8px", color: "var(--dsw-alias-label-tertiary)", userSelect: "text", wordBreak: "break-word" },
                      children: t("settings.lastJump") + " " + lastJumpDiag
                    }),
                    // 「上次启动」：与上面那条**同构**（一行文字，同一个折叠里）。
                    //   用户明确要求借现有的调试，不另造日志系统 / 不另开面板。
                    //   ⚠️ 这里**内联**而不是调一个 helper：helper 若定义在 apply 中段，
                    //   它同样看不到 grey（同一次事故的形状）；内联则只用到 t 与
                    //   testHooks，两者都是 render 时已绑定的。
                    (function () {
                      var value = "";
                      try {
                        value = typeof testHooks.lastStartDiagOnce === "function" ? testHooks.lastStartDiagOnce() : "";
                      } catch (e) { value = ""; }
                      if (value === "" || value === undefined || value === null) return null;
                      return (0, react_jsx_runtime.jsx)("div", {
                        style: { marginTop: "8px", color: "var(--dsw-alias-label-tertiary)", userSelect: "text", wordBreak: "break-word" },
                        children: value
                      }, "term-last-start");
                    })(),
                    (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }, children: [
                      smallButton(t("focus.refresh"), refreshFocus, "focus-refresh"),
                      smallButton(t("focus.report"), function () { if (typeof testHooks.focusReport === "function") testHooks.focusReport(); }, "focus-report")
                    ] }),
                    // 编辑重发的诊断跟踪：默认关，且会**改写会话标题** ⇒ 留在「调试」折叠里。
                    // 2026-10-16 合并（第 2 条批评"怎么有两个调试"）：这里原来还有**第二层**折叠
                    // `details`，它的 summary 用的是 `focus.debug` —— 中文也是「调试」，与外层
                    // `settings.section.debug` **同名**。用户看到两个「调试」以为有区别。
                    // ⇒ 内层那层折叠（连同它的 `summary`）删掉，内容原样搬到外层折叠里；
                    //    整页**只有一个**「调试」，`focus.debug` 这个键也一并从 zh/en 删掉。
                    row("debugResendTrace", t("settings.debugResendTrace")),
                    debugRow(t("settings.coreProbe"), "core=" + CORE_MODE),
                    (0, react_jsx_runtime.jsx)("div", { style: { marginTop: "8px", color: "var(--dsw-alias-label-tertiary)", userSelect: "text", wordBreak: "break-word" }, children: buildStatus() })
                  ]
                })),
                (0, react_jsx_runtime.jsx)(UpdatePanel, { t: t }, "update-panel")
              ]
            })),
            // ── ③ 专注锁 ──────────────────────────────────────────────────────────
            settingsPanel("focus", (0, react_jsx_runtime.jsxs)("div", {
              children: [
                (0, react_jsx_runtime.jsxs)("div", { style: CARD_FIRST, children: [
                  sectionHeading(t("focus.title") + (featureOn("featureFocusLock") ? "" : " · " + t("feature.offSuffix"))),
                  grey(focusStateLine(), "2px"),
                  (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }, children: [
                    smallButton(t("focus.lockSession"), function () {
                      // 直接、无消息 —— 和标题栏那个按钮同一条路径。锁着时它是出路，
                      // 锁没开时它是"现在就锁上 30 分钟"；两种都直接生效。
                      if (typeof testHooks.focusLockFor === "function") testHooks.focusLockFor(30);
                      refreshFocus();
                    }, "focus-lock-session"),
                    smallButton(t("focus.unlockSession"), function () {
                      // ⚠️ 文案与行为必须一致：标签是「立即解锁」，动作就是本地立即解锁
                      // （focusUnlockLocal ⇒ 撤掉包装 + 清本地锁），**不发任何消息**。
                      if (typeof testHooks.focusUnlockLocal === "function") testHooks.focusUnlockLocal();
                      refreshFocus();
                    }, "focus-unlock")
                  ] })
                ] }),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [
                    sectionHeading(t("focus.defaultsTitle")),
                    grey(t("focus.defaultsHint"), "2px"),
                    row("focusDefaultEnabled", t("focus.defaultsEnable"), t("focus.defaultsEnableHint")),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" },
                      children: [
                        (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }, children: t("focus.defaultsScope") }),
                        (0, react_jsx_runtime.jsxs)("label", {
                          style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" },
                          children: [
                            (0, react_jsx_runtime.jsx)("input", {
                              type: "radio",
                              name: "dw-focus-default-scope",
                              value: "session",
                              checked: focusDefault.scope === "session",
                              onChange: function () { patchSetting("focusDefaultScope", "session"); }
                            }, "focus-default-session"),
                            t("focus.defaultsSession")
                          ]
                        }),
                        (0, react_jsx_runtime.jsxs)("label", {
                          style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" },
                          children: [
                            (0, react_jsx_runtime.jsx)("input", {
                              type: "radio",
                              name: "dw-focus-default-scope",
                              value: "workspace",
                              checked: focusDefault.scope === "workspace",
                              onChange: function () { patchSetting("focusDefaultScope", "workspace"); }
                            }, "focus-default-workspace"),
                            t("focus.defaultsWorkspace")
                          ]
                        })
                      ]
                    }, "focus-default-scope"),
                    (0, react_jsx_runtime.jsxs)("div", {
                      style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" },
                      children: [
                        (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" }, children: t("focus.defaultsMinutes") }),
                        (0, react_jsx_runtime.jsx)("input", {
                          type: "number",
                          min: 1,
                          max: 10080,
                          value: String(focusDefault.minutes),
                          "data-dw-focus-default-minutes": "",
                          onChange: function (ev) {
                            var v = parseInt(String(ev.target.value), 10);
                            if (Number.isFinite(v) && v >= 1 && v <= 10080) patchSetting("focusDefaultMinutes", v);
                          },
                          style: { width: "90px", fontSize: "12px", padding: "4px 6px", boxSizing: "border-box" }
                        }),
                        (0, react_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" }, children: t("focus.defaultsMinutesHint") })
                      ]
                    }, "focus-default-minutes")
                  ]
                }, "focus-defaults"),
                (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [
                    sectionHeading(t("focus.scopeLabel")),
                    grey(t("settings.unlockLocalHint"), "2px"),
                    grey(t("focus.scopeSession") + " · " + t("focus.scopeWorkspace"), "4px"),
                    grey(t("settings.unlockLocalShort"), "4px")
                  ]
                })
              ]
            })),
            // ── ④ 笔记（value 从 `content` 改成 `notes`；i18n 键 `settings.tab.notes`）────
            //    ⚠️ 2026-10-16 二次分组：「引用回复」从这里搬走（它属于会话操作）；这里补上
            //    原来住在「基础」的「存储位置」小节 —— 它讲的正是笔记存哪、怎么导出。
            settingsPanel("notes", (0, react_jsx_runtime.jsxs)("div", {
              children: [
                featureSection("featureNotes", (0, react_jsx_runtime.jsxs)("div", {
                  style: CARD_FIRST,
                  children: [sectionHeading(t("notes.title")), grey(t("notes.pageHint"), "2px")]
                })),
                // ── 摘要（2026-10-17：**开关**从「基础」搬到这里）───────────────────
                //    用户原话："摘要是笔记用的功能，开关可以挪进来"。
                //    ⚠️ 这一块**故意不用 `featureSection` 包**：那一层在未引入时会套
                //    `OFF_STYLE`（`pointerEvents: "none"`）⇒ 开关自己就点不动了，而「基础」
                //    页已经不再有它 ⇒ 只剩"一键全开"能救 —— 单一开关的恢复路径被收窄，
                //    正是 2026-10-16 那次锁死事故的形状。灰态语义改由 `featureRow` 自己承担
                //    （它自带"未引入：…"那一行灰字），与「基础」页那 7 行**完全同构**。
                (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [
                    digestItem === null ? null : featureRow(digestItem, { heading: true }),
                    grey(t("digest.optHint"), "2px")
                  ]
                }, "digest-section"),
                // 存储位置（小字）—— 从「基础」搬来（逐字搬，只改了它所在的 panel）。
                (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [
                    sectionHeading(t("settings.section.storage")),
                    grey(t("settings.storage"), "2px")
                  ]
                })
              ]
            })),
            // ── ⑤ 会话操作 ────────────────────────────────────────────────────────
            //    ⚠️ 2026-10-16 二次分组：页面顺序 = 轮次操作（含「编辑重发/重试时默认归档原
            //    对话」）→ 引用回复 → 会话内查找。
            //    · 归档原对话从「引用」小节底下搬进**轮次操作**小节（它管的是编辑重发/重试的
            //      行为，与引用无关）。搬进 featureSection("featureTurnActions") 里面 ⇒
            //      「轮次操作」这一档未引入时它跟着一起灰掉，与它原来的灰态语义一致。
            //    · 引用回复从「笔记」tab 搬来，只带 `quoteProvenance`（出处行）。
            settingsPanel("actions", (0, react_jsx_runtime.jsxs)("div", {
              children: [
                featureSection("featureTurnActions", (0, react_jsx_runtime.jsxs)("div", {
                  style: CARD_FIRST,
                  children: [
                    sectionHeading(t("feature.nameTurnActions")),
                    grey(t("settings.turnActionsHint"), "2px"),
                    row("archiveOriginal", t("settings.archiveOriginal")),
                    row("retryNote", t("settings.retryNote"), t("retry.note"))
                  ]
                })),
                featureSection("featureQuote", (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [
                    sectionHeading(t("feature.nameQuote")),
                    row("quoteProvenance", t("settings.quoteProvenance"))
                  ]
                })),
                featureSection("featureFind", (0, react_jsx_runtime.jsxs)("div", {
                  style: SECTION_BLOCK,
                  children: [sectionHeading(t("feature.nameFind")), grey(t("settings.shortcutsHint"), "2px")]
                })),
                // 2026-10-17：终端按钮的小节**已搬出本页** —— 它有了自己的 tab（5th）。
              ]
            })),
            // ── ⑥ 终端（2026-10-17 新增第 5 个 tab）──────────────────────────────
            //    用户原话："启动按钮没有单独的tab页吗" ⇒ 把「会话操作」里那一整块配置搬来，
            //    内容一字未改（仍由 `featureSection("featureTerminal")` 门控：未引入时
            //    仍然**可见**、只是灰掉 + 指路，不隐藏）。
            //    ⚠️ 这一页只有这一档 ⇒ 未引入时**按小节灰**就够；它被列进
            //    `NO_PANEL_GREY_TABS`，所以不会再叠一层整页灰（否则同一句指路显示两遍）。
            settingsPanel("terminal", (0, react_jsx_runtime.jsxs)("div", {
              children: [
                featureSection("featureTerminal", (0, react_jsx_runtime.jsxs)("div", {
                  children: [
                    (0, react_jsx_runtime.jsx)(stableCommandButtons.current, {
                      t: t,
                      cwd: (function () {
                        try { return typeof testHooks.currentCwd === "function" ? testHooks.currentCwd() : ""; } catch (e) { return ""; }
                      })(),
                      busy: busy
                    })
                  ]
                }))
              ]
            }))
          ]
        });
      }

      // Beside Settings at the sidebar foot: selecting the panel swaps the centre.
      // Never let a partial activation be invisible.
      if (applyFailures.length > 0) {
        setTimeout(function () {
          try {
            showNotice(t("settings.applyFailures.toast") + applyFailures.join(" · "), { clientX: 24, clientY: 80 }, { always: true });
          } catch (e) { /* a notice is best effort */ }
        }, 1200);
      }

      guard.slots.injectIf("featureNotes", "sidebar.footer.action", function () {
        var dispose = ctx.slots.register({
          name: "sidebar.footer.action",
          id: "history-actions-notes",
          order: 5,
          locale: NS,
          label: function () { return t("notes.title"); },
          inject: function () {
            return { openNotes: function () { ctx.layout.selectPanel(NOTES_PANEL); } };
          }
        }, NotesAction);
        return function () {
          try {
            // Never leave the centre pointing at a panel that no longer exists.
            if (ctx.layout.panelInfo.getSnapshot().activePanelId === NOTES_PANEL) ctx.layout.selectPanel(null);
          } catch (e) {
            /* the layout may already be gone during teardown */
          }
          dispose();
        };
      });
      // ── 会话切换的【服务级单点拦截】（从 dsh-probe-lock 移植；真机已验证）──────────
      // 出处：dsh-probe-lock/lib/client.js（BUILD 2026-10-12T15:58Z，用户实测「所有切换
      // 会话的入口全部点不开，当前会话照常打开」✅）。这里只做两件事：复用主插件**自己**
      // 的锁状态读取（effectiveFocusState / parseFocusLockFile / sameSessionId —— 不 import
      // 探针），以及把探针里已经踩平的那个包装内核照搬过来。
      //
      // 为什么是这五个方法：侧栏行、搜索结果、子代理目录、任务面板、workflow 成员、fork、
      // 「新建会话」四处 —— 全部汇聚到 openSession / openWorkspace / startSession → replaceMain；
      // clearMain 直接改 mainReference、**不经过** replaceMain，所以它是必须单独包的第五个出口。
      // （依据：docs/session-lock-surface.md 三、四节，静态源码带行号。）
      //
      // ⚠️ 这是**非官方 API 打补丁**：Cordis Service 没有覆盖语义，DSH 升级后方法名一变即失效。
      // 失效的表现是「包不上」——读数会如实写 wrapFailed=<名>，绝不假装拦住了。
      //
      // 四条铁律（违反任意一条 = 槽条目崩溃 = App 起不来；探针真机踩过）：
      //   A. 顶层不执行任何逻辑（这里只在 apply 里、且整体 try/catch 内跑）。
      //   B. 包装后的函数绝不抛出：decide 抛错一律放行（宁可漏拦，不可错拦）。
      //   C. 拦下必须可见：showNotice + 计数。
      //   D. 永远留一条出路：锁着时永远有一个可点的「解除专注」（标题栏 + 设置页 + 这里
      //      的即时解除），且解除会同时撤掉包装与锁 —— 文件通道异常时也能立刻脱身。
      var FOCUS_WRAP_NAMES = ["openSession", "openWorkspace", "startSession", "replaceMain", "clearMain"];
      var FOCUS_WRAP_ID_KEYS = ["sessionId", "childSessionId", "id", "targetId", "key", "rowKey"];
      var FOCUS_WRAP_CHILD_KEYS = ["session", "binding", "address", "target", "value"];

      var focusWrap = {
        armed: false,
        ws: null,
        orig: {},
        depth: 0,
        calls: {},
        blocks: {},
        blockedLast: "",
        unjudgeable: {},
        escaped: false,
        event: "(none)",
        failedWrap: [],
        // 有多少个方法是**只能靠自有属性描述符**确认包装已生效的（= ctx.uiWorkspace 是
        // cordis 的可追踪 Proxy）。见 focusWrapReadBack 的说明；它进自检读数。
        proxyReadback: 0
      };

      /** Resume-scoped helper: the exact same normalization `sameSessionId` uses. */
      function focusWrapSessionId(v) {
        try {
          return typeof v === "string" ? v.replace(/^session-/, "") : "";
        } catch (e) { return ""; }
      }

      /**
       * 一个会话 id 的候选值是否可信。
       *
       * 长度下限 16：DSH 的会话 id 是 uuid。短串（"ws-1"、"abc"）与锁定目标撞车的代价是
       * **拦错会话**，比漏拦严重得多 —— 这就是「宁可漏拦，不可错拦」。
       */
      function focusWrapUsableId(v) {
        return typeof v === "string" && v.length >= 16;
      }

      /**
       * 归属账：`ctx.uiWorkspace.workspaces.list.getSnapshot().items`。
       *
       * 每项 = `{ workspaceId, path, title, sessionIds[], createdAt, updatedAt }`
       * （宿主投影 dsh-api-workspace-controller/lib/index.js:17-26）。`sessionIds` 是宿主维护的
       * **权威归属账**。⚠️ `ctx.uiWorkspace` 是 cordis 的可追踪 Proxy ⇒ 读它的方法必须包
       * try/catch；读不懂一律返回空数组（调用方据此**放行**）。
       */
      function focusWrapWorkspaceItems() {
        try {
          var model = ctx && ctx.uiWorkspace ? ctx.uiWorkspace.workspaces : null;
          var snap = model && model.list && typeof model.list.getSnapshot === "function" ? model.list.getSnapshot() : undefined;
          var items = snap && Array.isArray(snap.items) ? snap.items : null;
          return items === null ? [] : items;
        } catch (e) {
          return [];
        }
      }

      /**
       * 会话 → 它所属工作区的**规范 `path`**（锁的 `targetId` 口径就是 path）。
       *
       * 三条规则（docs/session-lock-surface.md §6.1-6.3，源码都已核实）：
       *   ① 判据是归属账 `sessionIds`，**不是 cwd 前缀**（宿主是 `cwd === path` 恰好相等，
       *      父子目录可以是两个工作区 ⇒ 任何 startsWith 都会锁错）
       *   ② 未分组会话（不在任何 `sessionIds` 里）⇒ 返回 "" ⇒ 调用方**放行**
       *      （子代理会话从不 attach，一律拦会锁住用户看自己的子代理轨迹）
       *   ③ 读不懂 ⇒ 返回 "" ⇒ 放行（宁可漏拦，不可错拦）
       */
      function focusWrapWorkspacePathOf(sessionId) {
        try {
          var want = focusWrapSessionId(sessionId);
          if (want === "") return "";
          var items = focusWrapWorkspaceItems();
          for (var i = 0; i < items.length; i++) {
            var w = items[i];
            var ids = w && Array.isArray(w.sessionIds) ? w.sessionIds : null;
            if (ids === null) continue;
            for (var k = 0; k < ids.length; k++) {
              if (focusWrapSessionId(ids[k]) === want) return typeof w.path === "string" ? w.path : "";
            }
          }
          return "";
        } catch (e) {
          return "";
        }
      }

      /**
       * 工作区身份（第一条可读到的 id/path）→ 它的**规范 `path`**。
       *
       * 锁的 `targetId` 口径 = 工作区的规范 `path`（宿主 `decide()` 就是当路径比的）。
       * `openWorkspace` / `startSession` 的第一实参是 `workspaceId`；为了兼容旧锁里可能写成
       * `workspace:<key>` 的目标，两种拼写都试一次：先按 `workspaceId` 找，再按 `path` 找。
       * 找不到 ⇒ 返回 "" ⇒ 调用方**放行**。
       */
      function focusWrapWorkspacePathFor(v) {
        try {
          var id = focusWrapSessionId(v);          // 只做「去掉 session- 前缀」的归一，不校验长度
          if (id === "") return "";
          var items = focusWrapWorkspaceItems();
          var i;
          for (i = 0; i < items.length; i++) {
            if (items[i] && items[i].workspaceId === id && typeof items[i].path === "string") return items[i].path;
          }
          for (i = 0; i < items.length; i++) {
            if (items[i] && items[i].path === id && typeof items[i].path === "string") return items[i].path;
          }
          return "";
        } catch (e) {
          return "";
        }
      }

      /**
       * 从一次调用的实参里取「目标工作区身份」。
       *
       * **必须按方法名分流**（宿主实现，dsh-client-ui-workspace/lib/client.js:821-866）：
       *   openWorkspace(wid) / startSession(wid) ⇒ 第一实参**就是 workspaceId**
       *   startSession(undefined)               ⇒ 目标 = **当前会话所属工作区**
       *   openSession(t) / replaceMain(t)       ⇒ 先取会话 id，再走归属账
       *   clearMain()                           ⇒ 没有工作区目标（由调用方保持「放行 + 标 unjudgeable」）
       */
      function focusWrapWorkspaceIdOf(name, target) {
        try {
          if (name === "openWorkspace" || name === "startSession") {
            var t = target;
            if (t !== null && typeof t === "object") {
              for (var i = 0; i < FOCUS_WRAP_ID_KEYS.length; i++) {
                var tv = null;
                try { tv = t[FOCUS_WRAP_ID_KEYS[i]]; } catch (e) { tv = null; }
                if (typeof tv === "string" && tv !== "") { t = tv; break; }
              }
            }
            if (typeof t === "string" && t !== "") return t;
            // startSession(undefined) ⇒ 当前会话所属的工作区
            return focusWrapWorkspacePathOf(activeSessionId());
          }
          var sid = "";
          try { sid = focusWrapTargetId(target, 0, null); } catch (e) { sid = ""; }
          if (sid === "") return "";
          return focusWrapWorkspacePathOf(sid);
        } catch (e) {
          return "";
        }
      }

      /**
       * 从各种「目标」形态里取会话 id，取不到返回 ""（调用方据此**放行**）。
       *
       * 已核实的形态（有界递归，深度 ≤4；环即放弃）：
       *   "session-<uuid>" / "<uuid>"                     （openSession 的实参）
       *   "session:<uuid>"                                （侧栏 data-row-key）
       *   { sessionId } / { childSessionId } / { id } …   （UI 行对象）
       *   { parentSessionId, childSessionId }             （sessions.resolveTarget 读 .childSessionId）
       *   ClientSessionReference { sessionId, binding }   （restoreSelection 直接交给 replaceMain）
       *   { workspaceId }                                 ⇒ 明确不是会话 ⇒ 返回 ""
       *
       * 刻意**不**接受任意层级里的任意字符串 —— 猜错了就是拦错会话。
       */
      function focusWrapTargetId(target, depth, seen) {
        try {
          if (typeof target === "string") {
            var s = target;
            if (s.indexOf("session:") === 0) s = s.slice(8);
            return focusWrapUsableId(s) ? s : "";
          }
          if (target === null || typeof target !== "object") return "";
          var d = typeof depth === "number" ? depth : 0;
          if (d > 4) return "";
          var set = seen || [];
          for (var k = 0; k < set.length; k++) { if (set[k] === target) return ""; }
          set = set.concat([target]);
          for (var i = 0; i < FOCUS_WRAP_ID_KEYS.length; i++) {
            var v = null;
            try { v = target[FOCUS_WRAP_ID_KEYS[i]]; } catch (e) { v = null; }
            if (focusWrapUsableId(v)) return v.indexOf("session:") === 0 ? v.slice(8) : v;
          }
          // workspaceId 在场 ⇒ 这个目标是工作区，不是会话 ⇒ 放行。
          if (typeof target.workspaceId === "string") return "";
          for (var c = 0; c < FOCUS_WRAP_CHILD_KEYS.length; c++) {
            var cv = null;
            try { cv = target[FOCUS_WRAP_CHILD_KEYS[c]]; } catch (e) { cv = null; }
            if (cv === null || typeof cv !== "object") continue;
            var got = focusWrapTargetId(cv, d + 1, set);
            if (got !== "") return got;
          }
          return "";
        } catch (e) {
          return "";
        }
      }

      /**
       * 读当前生效的锁；读不到 / 读不懂一律 null（调用方据此**放行**）。
       *
       * 两道来源，都走主插件**自己**的读法（不 import 探针、不碰探针的 key）：
       *   ① localStorage 的 dsh.deepworker.focusLocal（即时、无消息）
       *   ② 宿主写的 .dsh-focus-lock.json（异步缓存）
       * 它们就是 effectiveFocusState 的两条腿；这里只是把返回值归一成
       * { kind, targetId, untilMs } 并做防御性检查。
       */
      function focusWrapReadLock() {
        try {
          var eff = effectiveFocusState();
          if (eff === null || typeof eff !== "object" || eff.locked !== true) return null;
          if (typeof eff.kind !== "string" || (eff.kind !== "session" && eff.kind !== "workspace")) return null;
          if (typeof eff.targetId !== "string" || eff.targetId === "") return null;
          if (typeof eff.untilMs !== "number" || !isFinite(eff.untilMs)) return null;
          if (eff.untilMs <= Date.now()) return null;          // 过期 ⇒ 时间就是出路 ⇒ 放行
          return { kind: eff.kind, targetId: eff.targetId, untilMs: eff.untilMs };
        } catch (e) {
          return null;
        }
      }

      /**
       * 锁是否真的扣在「当前会话」上。
       *
       * 为什么需要这一道：宿主写的文件锁是**异步缓存**，缓存过期时会指着一个用户早就
       * 离开的会话 —— 那时若还照拦，就会出现「什么都打不开」，而错拦比漏拦严重得多。
       * 所以只有「用户确实在锁定的那个会话里」才拦；已经不在锁定会话里 ⇒ 一律放行。
       * （代价：刷新后若恢复到了别的会话，锁就不再拦 —— 这是「永远留一条出路」的代价，
       *   明确写下。）
       */
      function focusWrapHoldsHere(lock) {
        try {
          if (lock === null || lock.kind !== "session") return false;
          var here = focusWrapSessionId(activeSessionId());
          var want = focusWrapSessionId(lock.targetId);
          return here !== "" && want !== "" && here === want;
        } catch (e) {
          return false;
        }
      }

      /**
       * 判定一次调用该不该放行。
       * @returns {{allow:boolean, reason:string, target?:string, lock?:object}}
       *   任何一步读不懂 ⇒ allow:true（**宁可漏拦，不可错拦**）。
       */
      function focusWrapDecide(name, target) {
        // 「专注锁」总开关：关掉 ⇒ 一个也不拦（即时，因为这里是每次被包装调用都要跑的判定点）。
        if (!featureEnabled("featureFocusLock")) return { allow: true, reason: "feature-off" };
        var lock = null;
        try { lock = focusWrapReadLock(); } catch (e) { lock = null; }
        if (lock === null) return { allow: true, reason: "unlocked" };
        if (lock.kind === "workspace") {
          // 工作区粒度：判据是**归属账** `workspaces[].sessionIds`（docs/session-lock-surface.md
          // §6.1 的权威做法），不是 cwd 前缀，也不走 DOM（侧栏是平铺渲染，DOM 里拿不到映射）。
          // 锁的 targetId 口径 = 工作区的**规范 path**（宿主 decide() 就是当路径比的）。
          var wsId = "";
          try { wsId = focusWrapWorkspaceIdOf(name, target); } catch (e) { wsId = ""; }
          // 取不到 / 未分组（子代理会话从不 attach）⇒ 放行：宁可漏拦，不可错拦。
          if (wsId === "") return { allow: true, reason: "unknown-workspace", lock: lock };
          var wsPath = "";
          try { wsPath = focusWrapWorkspacePathFor(wsId); } catch (e) { wsPath = ""; }
          // 映射不出来 ⇒ 放行。两边口径都是规范 path，所以这里可以**恰好相等**地比。
          if (wsPath === "") return { allow: true, reason: "unknown-workspace", lock: lock };
          if (wsPath === lock.targetId) return { allow: true, reason: "target-workspace", target: wsPath, lock: lock };
          return { allow: false, reason: "blocked-workspace", target: wsPath, lock: lock };
        }
        if (!focusWrapHoldsHere(lock)) return { allow: true, reason: "not-in-locked-session", lock: lock };
        var id = "";
        try { id = focusWrapTargetId(target, 0, null); } catch (e) { id = ""; }
        if (id === "") return { allow: true, reason: "unknown-target", lock: lock };
        if (sameSessionId(id, lock.targetId)) return { allow: true, reason: "target", target: id, lock: lock };
        return { allow: false, reason: "blocked", target: id, lock: lock };
      }

      /** 把一次调用压成一句可读的说明（只读 id/字符串，绝不 JSON.stringify —— 可能循环）。 */
      function focusWrapArgWord(a) {
        try {
          if (a === undefined) return "(none)";
          if (a === null) return "null";
          if (typeof a === "string") return a;
          if (typeof a === "number" || typeof a === "boolean") return "(" + String(a) + ")";
          if (typeof a === "object") {
            if (typeof a.sessionId === "string") return a.sessionId;
            if (typeof a.id === "string") return a.id;
            if (typeof a.workspaceId === "string") return a.workspaceId;
            return "(" + ((a.constructor && a.constructor.name) || "object") + ")";
          }
          return "(" + typeof a + ")";
        } catch (e) {
          return "(unreadable)";
        }
      }

      /** 计数 + 最近一次事件的**纯 ASCII** 记号：调用路径绝不因它出错。 */
      function focusWrapNote(name, kind, word) {
        try {
          if (!Object.prototype.hasOwnProperty.call(focusWrap.calls, name)) focusWrap.calls[name] = 0;
          focusWrap.calls[name] = focusWrap.calls[name] + 1;
          if (kind === "blocked") {
            if (!Object.prototype.hasOwnProperty.call(focusWrap.blocks, name)) focusWrap.blocks[name] = 0;
            focusWrap.blocks[name] = focusWrap.blocks[name] + 1;
            focusWrap.blockedLast = name + ":" + String(word);
          } else if (kind === "unjudgeable") {
            focusWrap.unjudgeable[name] = true;
            focusWrap.event = "unjudgeable:" + name;
          } else {
            focusWrap.event = name + ":" + String(word);
          }
        } catch (e) { /* 计数失败绝不影响调用 */ }
      }

      /**
       * 回读一次赋值到底有没有粘住。
       *
       * ⚠️ **不能只比 `obj[name] === fn`** —— 真机就是这么错的（2026-10-12 自检读数：
       * 五个方法全是 `readback-mismatch`，`wrapped=0/5`）。原因不在包装逻辑，而在这一句：
       * `ctx.uiWorkspace` 交给插件的**不是** Service 实例，而是 cordis 4 的**可追踪 Proxy**
       * （`@deepseek-ai/cordis/lib/index.js`：`getTraceable` :84-90 —— 任何带
       * `symbols.tracker` 的值都被包（Service 构造器 :1781 一定会打这个戳）；
       * `createTraceable` 的 `get` :126-144（函数属性那一支 :140-142）—— 对**函数属性**
       * 每次读取都**新建一层 Proxy**（`createShadowMethod` :117-122），所以身份比较**永远**不相等）。
       * 而它的 `set`（:145-152，最后那句 `Reflect.set(target, prop, value, shadow)`）⇒ 赋值**确实
       * 落在**被代理的 Service 实例上、真实点击也确实走包装（探针真机点出计数 +1 即此）。
       *
       * 修法：Proxy 没有 `getOwnPropertyDescriptor` 陷阱 ⇒ 描述符就是**代理目标**的真实自有
       * 属性 ⇒ 用它做身份回读。对普通对象同样成立；而"赋值被静默丢掉"（只读属性 / 无 setter
       * 的访问器 / 冻结对象）时，描述符里**不是**我们那个函数 ⇒ 那道防线一点没丢。
       *
       * @returns "direct"（值身份就对上了）| "descriptor"（只能靠描述符确认）| ""（没粘住）
       */
      function focusWrapReadBack(obj, name, fn) {
        try {
          var got = null;
          try { got = obj[name]; } catch (e) { got = null; }
          if (got === fn) return "direct";
          var desc = null;
          try { desc = Object.getOwnPropertyDescriptor(obj, name); } catch (e) { desc = null; }
          if (desc !== null && desc !== undefined && desc.value === fn) return "descriptor";
          return "";
        } catch (e) {
          return "";
        }
      }

      /**
       * 包装一个方法。
       *
       * **内部调用不能被当成入口**：openSession → this.replaceMain(...)、
       * startSession → this.openWorkspace(...)、openWorkspace → this.replaceMain(...)
       * 都是跨方法内部调用；而包装是实例属性遮蔽 ⇒ 它们也会走进包装 ⇒ 一次用户动作
       * 被判定 N 次、计数 N 次、提示弹 N 次。
       *
       * 判据必须是**一个全局（跨方法名）的重入计数器** depth > 0。探针试过、都错的做法
       * （有实测证据，别再退回去）：
       *   1. 按方法名的布尔守卫 —— async 在 await 里让出，守卫已被清掉。
       *   2. this === ws 判「内部」—— 入口本来就是实例调的 ⇒ 计数永远是 0。
       *   3. 改调原型上的原方法 —— 没用：原型方法一进去，this.replaceMain 仍解析到实例上的包装。
       *   4. 按方法名的深度计数 —— 抓不到跨方法调用（外层跑的是别的名字）。
       *
       * 计数要在**整个调用生命周期**里保持（含 await 期间）：返回值是 thenable 时，等它
       * settle 再减。代价（明确写下）：并发的两次独立入口调用、且彼此嵌套时，内层会被当成
       * 内部调用而**漏拦** —— 这正是「宁可漏拦，不可错拦」，窗口极小。
       */
      function focusWrapMake(methodName, orig) {
        var wrapper = function () {
          var args = arguments;
          if (focusWrap.depth > 0) return orig.apply(focusWrap.ws, args);   // 内部调用：不判定、不计数、不提示
          var d = null;
          try { d = focusWrapDecide(methodName, args && args.length > 0 ? args[0] : undefined); }
          catch (e) { d = { allow: true, reason: "decide-threw" }; }
          if (!d) d = { allow: true, reason: "decide-null" };
          if (d.allow !== true) {
            var word = d.target ? String(d.target) : focusWrapArgWord(args && args.length > 0 ? args[0] : undefined);
            try { focusWrapNote(methodName, "blocked", word); } catch (e) { /* ignore */ }
            // 拦下 ⇒ 不调原方法，返回 undefined，并且**说话**（绝不静默）。
            try { focusWrapSayBlocked(methodName, word, d); } catch (e) { /* 提示失败不能影响拦截 */ }
            return undefined;
          }
          try {
            // 如实暴露：锁着、但目标读不出来（典型是 clearMain / startSession 无目标）⇒ 放行并记账。
            if (d.lock !== undefined && d.lock !== null && d.reason === "unknown-target") {
              focusWrapNote(methodName, "unjudgeable", focusWrapArgWord(args && args.length > 0 ? args[0] : undefined));
            } else {
              focusWrapNote(methodName, "call", focusWrapArgWord(args && args.length > 0 ? args[0] : undefined));
            }
          } catch (e) { /* ignore */ }
          focusWrap.depth = focusWrap.depth + 1;
          var out;
          try {
            out = orig.apply(focusWrap.ws, args);
          } catch (e) {
            try { focusWrap.depth = Math.max(0, focusWrap.depth - 1); } catch (e2) { /* ignore */ }
            throw e;                                        // 同步抛错：原样抛，但守卫必须归零
          }
          if (out === null || (typeof out !== "object" && typeof out !== "function") || typeof out.then !== "function") {
            try { focusWrap.depth = Math.max(0, focusWrap.depth - 1); } catch (e) { /* ignore */ }
            return out;
          }
          // 等 thenable settle 再减（不然 await 之后那次内部调用会漏进来）。
          // 刻意**不改写**返回对象：只挂监听，返回值原样透传。
          // released 守卫让 depth **只减一次**：真 thenable 走异步 settle，
          // 而「then 属性存在但不是可调用 / 其 then 自己抛错」这类假 thenable 走同步兜底。
          var released = false;
          var release = function () {
            if (released) return;
            released = true;
            try { focusWrap.depth = Math.max(0, focusWrap.depth - 1); } catch (e) { /* ignore */ }
          };
          try {
            out.then(function (v) { release(); return v; }, function (e) { release(); throw e; });
          } catch (e) {
            release();
          }
          return out;
        };
        return wrapper;
      }

      /** 可见提示：工作区粒度要明说「暂不可用」，并永远指向那条出路。 */
      function focusWrapSayBlocked(methodName, word, d) {
        try {
          if (typeof showNotice !== "function" || typeof t !== "function") return;
          var tail = " · " + t("focus.wrapUnlock");
          var lock = d && d.lock ? d.lock : null;
          if (lock !== null && lock.kind === "workspace") {
            showNotice(t("focus.wrapWorkspace") + tail, { clientX: 24, clientY: 80, systemOnly: true });
            return;
          }
          var left = lock !== null ? Math.max(0, Math.round((lock.untilMs - Date.now()) / 1000)) : 0;
          showNotice(t("focus.wrapBlocked", { n: left }) + tail, { clientX: 24, clientY: 80, systemOnly: true });
        } catch (e) { /* 提示失败不能影响拦截 */ }
      }

      /**
       * 逃生口：撤掉包装 + 撤掉本地锁 + 置 escaped。
       *
       * 为什么 escaped 必须独立存在：宿主写的文件锁在 localStorage 里读得到、但**写不掉**
       * （没有宿主 RPC）⇒ 只清 localStorage 的话，「解除」之后文件锁仍会让 decide 判定为
       * 锁定 ⇒ 用户被**永久**关在外面。escaped 让包装在本次窗口内彻底失效，是最低条件。
       */
      function focusWrapEscape(reason) {
        var unlocked = true;
        try { focusWrap.escaped = true; } catch (e) { /* ignore */ }
        try { focusWrapUnwrapAll(); } catch (e) { /* ignore */ }
        try {
          if (typeof unlockFocusLocally === "function") unlocked = unlockFocusLocally() !== false;
        } catch (e) { unlocked = false; }
        // 和 testHooks.focusUnlockLocal 同一套收尾：取消到期计时器 + 重画侧栏（幂等）。
        try { armFocusExpiry(null); } catch (e) { /* ignore */ }
        try { paintLockedSessions(); } catch (e) { /* 重画失败不影响解除 */ }
        try {
          if (typeof showNotice === "function" && typeof t === "function") {
            showNotice(unlocked ? t("focus.wrapEscaped") : t("focus.wrapEscapeFailed"), { clientX: 24, clientY: 80, systemOnly: true });
          }
        } catch (e) { /* ignore */ }
        return unlocked;
      }

      /** 把包装全部还原成原方法。回读确认（无 setter 的访问器会静默吞掉赋值）。 */
      function focusWrapUnwrapAll() {
        var ok = true;
        try {
          if (!focusWrap.armed || focusWrap.ws === null) return true;
          for (var i = 0; i < FOCUS_WRAP_NAMES.length; i++) {
            var name = FOCUS_WRAP_NAMES[i];
            var base = focusWrap.orig[name];
            if (typeof base !== "function") continue;
            try {
              focusWrap.ws[name] = base;
              // 同一个理由：还原之后也要经受得住 cordis 可追踪 Proxy 的身份比较。
              if (focusWrapReadBack(focusWrap.ws, name, base) === "") throw new Error("readback-mismatch");
              if (focusWrap.readback) focusWrap.readback[name] = "unwrapped";
            } catch (e) {
              ok = false;
              try { focusWrap.failedWrap.push("unwrapFailed:" + name); } catch (e2) { /* ignore */ }
            }
          }
        } catch (e) { ok = false; }
        // 复位 armed：包装已全部还原 ⇒「已武装」不再成立。不复位的话，下一次 arm 会在
        // `if (focusWrap.armed) return true;` 处直接返回 ⇒「解除后重新加锁」不再包装那五个
        // 方法，而且不报错、不提示 —— 就是「关掉再打开就静默死亡」（2026-10-15 修）。
        // 只有 arm 才是「包装在用」的权威：还原 = 没武装。
        try { focusWrap.armed = false; } catch (e) { ok = false; }
        return ok;
      }

      /**
       * 把五个方法包上去。整体 try/catch —— 包不上只影响拦截，绝不影响插件加载。
       * 每次 apply 只包一次；ctx.uiWorkspace 拿不到就轮询重试（最多 10s），
       * 重试耗尽也不抛，只在读数里写 wrapMissing。
       */
      function focusWrapArm(ctx) {
        try {
          // 「专注锁」关掉 ⇒ 绝不把宿主方法包起来（包装的是宿主对象；关掉就不该动它）。
          if (!featureEnabled("featureFocusLock")) return false;
          if (focusWrap.armed) return true;
          var ws = ctx ? ctx.uiWorkspace : undefined;
          if (ws === undefined || ws === null || typeof ws !== "object") return false;
          focusWrap.ws = ws;
          focusWrap.orig = {};
          focusWrap.readback = {};
          focusWrap.failedWrap = [];
          focusWrap.proxyReadback = 0;
          focusWrap.armed = true;
          // arm = 「拦截现在活着」⇒ 上一次 escape 的失效标记必须一起清掉。否则重新加锁后
          // 读数会写 lock=NONE(escaped) 而包装其实正在拦 —— 仪表当场说谎（2026-10-15）。
          focusWrap.escaped = false;

          for (var i = 0; i < FOCUS_WRAP_NAMES.length; i++) {
            var name = FOCUS_WRAP_NAMES[i];
            var orig = null;
            try { orig = ws[name]; } catch (e) { orig = null; }
            if (typeof orig !== "function") {
              focusWrap.readback[name] = "missing";
              continue;
            }
            focusWrap.orig[name] = orig;
            try {
              var w = focusWrapMake(name, orig);
              ws[name] = w;
              // 回读：无 setter 的访问器 / 只读自有属性 / 冻结对象会**静默**丢掉赋值
              // （非严格模式不抛），只看「没抛错」就会把包不上的方法报成 wrapped。
              // 但身份比较必须容忍 cordis 的可追踪 Proxy —— 见 focusWrapReadBack。
              var via = focusWrapReadBack(ws, name, w);
              if (via === "") throw new Error("readback-mismatch");
              if (via === "descriptor") {
                focusWrap.proxyReadback = (typeof focusWrap.proxyReadback === "number" ? focusWrap.proxyReadback : 0) + 1;
              }
              focusWrap.readback[name] = "wrapped";
            } catch (e) {
              focusWrap.readback[name] = "wrapFailed";
              try { focusWrap.failedWrap.push(name + ":" + String((e && e.message) || e)); } catch (e2) { /* ignore */ }
              try { console.warn("[dsh-deepworker] focus-lock wrap failed for " + name + ": " + String((e && e.message) || e)); } catch (e2) { /* no console */ }
            }
          }

          // 只读调试接缝：DevTools 里可以复核读数（不参与任何业务逻辑）。
          try {
            if (typeof window === "object" && window !== null) {
              window.__historyActionsLock = {
                build: BUILD,
                readout: function () { return focusWrapReadout(); },
                escape: focusWrapEscape,
                unwrap: focusWrapUnwrapAll,
                decide: focusWrapDecide,
                targetId: focusWrapTargetId
              };
            }
          } catch (e) { /* ignore */ }
          return true;
        } catch (e) {
          try { focusWrap.failedWrap.push("arm:" + String((e && e.message) || e)); } catch (e2) { /* ignore */ }
          return false;
        }
      }

      /**
       * **纯 ASCII** 的自检读数，方便机器判读（中文断言在角标里不可靠，真发生过）。
       *
       * 形如：`lock=WRAPPED|PARTIAL|NONE · blocked=openSession×2,... · unwrapped=-`
       * 约定：`unwrapped=` 里列**没有**被包上的方法（`-` = 全都包上了）；
       *      `unjudgeable=` 里列「锁着但判不出目标 ⇒ 已放行」的方法。
       */
      function focusWrapReadout() {
        try {
          var wrapped = 0;
          var present = 0;
          var unwrappedNames = [];
          for (var i = 0; i < FOCUS_WRAP_NAMES.length; i++) {
            var n = FOCUS_WRAP_NAMES[i];
            var st = focusWrap.readback ? focusWrap.readback[n] : undefined;
            if (st === undefined || st === "missing") continue;
            present = present + 1;
            if (st === "wrapped") wrapped = wrapped + 1;
            else unwrappedNames.push(n);
          }
          var token = "NONE";
          if (wrapped > 0 && unwrappedNames.length === 0) token = "WRAPPED";
          else if (wrapped > 0) token = "PARTIAL";
          if (focusWrap.escaped) token = "NONE";
          // 机器判读区一律 ASCII：方法名是 ASCII，分隔符用 "x"（不用全角 ×）。
          var blockedNames = [];
          for (var k in focusWrap.blocks) {
            if (Object.prototype.hasOwnProperty.call(focusWrap.blocks, k)) blockedNames.push(k + "x" + focusWrap.blocks[k]);
          }
          var unjNames = [];
          for (var u in focusWrap.unjudgeable) {
            if (Object.prototype.hasOwnProperty.call(focusWrap.unjudgeable, u)) unjNames.push(u);
          }
          var line = "lock=" + token
            + (focusWrap.escaped ? "(escaped)" : "")
            + " · blocked=" + (blockedNames.length > 0 ? blockedNames.join(",") : "-")
            + " · unwrapped=" + (unwrappedNames.length > 0 ? unwrappedNames.join(",") : "-")
            + " · unjudgeable=" + (unjNames.length > 0 ? unjNames.join(",") : "-")
            + " · wrapped=" + wrapped + "/" + present
            // 证据字段：有多少个方法是靠**自有属性描述符**确认的（= ctx.uiWorkspace 是
            // cordis 的可追踪 Proxy，身份比较不可用）。真机应当是 proxyReadback=5/5；
            // 若某台机器是 0/5，说明它拿到的是裸对象（另一种形态，也是对的）。
            + " · proxyReadback=" + (typeof focusWrap.proxyReadback === "number" ? focusWrap.proxyReadback : 0) + "/" + wrapped
            + " · event=" + String(focusWrap.event)
            + (focusWrap.failedWrap.length > 0 ? " · failed=" + focusWrap.failedWrap.join("|") : "")
            + " · last=" + (focusWrap.blockedLast !== "" ? focusWrap.blockedLast : "-");
          return line;
        } catch (e) {
          return "lock=NONE · blocked=- · unwrapped=- · unjudgeable=- · readout-error";
        }
      }

      // 测试接缝：把三个只读/解除入口挂到已有的 testHooks 桥上（apply 作用域内赋值，
      // 组件与 exports.__test 都只能经这个桥访问 apply 作用域 —— 这是本插件两次启动崩溃的
      // 根因类别：factory 作用域按名字直呼 apply 里的函数 = ReferenceError）。
      testHooks.focusWrapReadout = function () { return focusWrapReadout(); };
      testHooks.focusWrapDecide = function (name, target) { return focusWrapDecide(name, target); };
      testHooks.focusWrapEscape = function (reason) { return focusWrapEscape(reason); };
      // 只读接缝：armed 是「包装在用」的权威状态，而读数（lock=…）看不见它 ——
      // 「解除后 armed 必须为假」只能靠这个接缝观测（2026-10-15）。
      testHooks.focusWrapArmed = function () { return focusWrap.armed === true; };

      try {
        // 「专注锁」未引入 ⇒ **一个拦截器都不装**，也没有那串 500ms 重试定时器。
        // 这是"不引入 = 不注册"的一处实例（旧语义是"装上了、判定点再放行"）。
        if (featureEnabled("featureFocusLock")) {
          noteContribution("featureFocusLock");
          var focusWrapTries = 0;
          if (!focusWrapArm(ctx)) {
            var focusWrapTick = function () {
              try {
                if (focusWrap.armed) return;
                focusWrapTries = focusWrapTries + 1;
                focusWrapArm(ctx);
                if (!focusWrap.armed && focusWrapTries < 20) setTimeout(focusWrapTick, 500);
              } catch (e) { /* 重试链里的任何异常都不许冒泡 */ }
            };
            setTimeout(focusWrapTick, 500);
          }
        }
      } catch (e) { /* apply 绝不抛：拦截装不上也只影响拦截 */ }

    }

    exports.apply = apply;
    exports.inject = inject;
    // Test seam only: lets a harness observe the document-menu -> turn-component
    // bridge without a DOM renderer. The framework reads only apply/inject.
    exports.__test = { menuListeners: menuListeners, activeComposer: activeComposer, rememberQuote: rememberQuote, findQuoteInText: findQuoteInText, scrollToTurn: scrollToTurn, insertQuoteIntoDraft: insertQuoteIntoDraft, readNotes: readNotes, writeNotes: writeNotes, NOTES_KEY: NOTES_KEY, mergeNotes: mergeNotes, appendNote: appendNote, shortcutStatus: shortcutStatus, readSettings: readSettings, writeSettings: writeSettings, SETTINGS_KEY: SETTINGS_KEY, hooks: testHooks, retryForkSeq: retryForkSeq, mutatedPathsOf: function (a, b) { return testHooks.mutatedPathsOf ? testHooks.mutatedPathsOf(a, b) : []; }, conversationDigest: function (a, b, c) { return testHooks.conversationDigest ? testHooks.conversationDigest(a, b, c) : null; }, cancelActiveTurn: function (a) { return testHooks.cancelActiveTurn ? testHooks.cancelActiveTurn(a) : Promise.resolve({ ok: false, error: 'seam missing' }); }, rememberQuote: rememberQuote, readQuotes: readQuotes, findQuoteInText: findQuoteInText, insertQuoteIntoDraft: insertQuoteIntoDraft, blockquote: blockquote, QUOTE_MAX_CHARS: QUOTE_MAX_CHARS, findQuoteRecord: findQuoteRecord, describeJump: describeJump, notifyPlan: notifyPlan, quoteJumpPlan: quoteJumpPlan, parseFocusLockFile: parseFocusLockFile, noticeAllowed: noticeAllowed, sameSessionId: sameSessionId, focusRowTarget: focusRowTarget, installFocusClicks: installFocusClicks, focusRequestText: focusRequestText, parseFocusLockState: parseFocusLockState, focusHolds: focusHolds, focusVerdict: focusVerdict, FOCUS_MARKER: FOCUS_MARKER, outlineAnchorFor: outlineAnchorFor, writeNotes: writeNotes, writeSettings: writeSettings, NOTES_MAX: NOTES_MAX, CORRUPT_BACKUP_PREFIX: CORRUPT_BACKUP_PREFIX, collectRanges: collectRanges, collectMatches: collectMatches, needleCandidates: needleCandidates, wrapRange: wrapRange, wrapMatch: wrapMatch, highlightQuoteInTurn: highlightQuoteInTurn, lastJumpDiagOnce: function () { return lastJumpDiag; }, lastStartDiagOnce: function () { return typeof testHooks.lastStartDiagOnce === "function" ? testHooks.lastStartDiagOnce() : ""; }, currentCwd: function () { return typeof testHooks.currentCwd === "function" ? testHooks.currentCwd() : ""; }, runTerminalButton: function (a, b) { return typeof testHooks.runTerminalButton === "function" ? testHooks.runTerminalButton(a, b) : Promise.resolve(null); }, wsReadAll: wsReadAll, readTermLogs: readTermLogs, appendTermLog: appendTermLog, clearTermLogs: clearTermLogs, TERM_LOG_KEY: TERM_LOG_KEY, termLoggedCommand: termLoggedCommand, parseTerminalConfigFile: parseTerminalConfigFile, TERM_CONFIG_FILE: TERM_CONFIG_FILE, readTerminalConfigFile: function () { return typeof testHooks.readTerminalConfigFile === "function" ? testHooks.readTerminalConfigFile() : Promise.resolve({ status: "no-api", count: 0, errors: [] }); }, wsWriteAll: wsWriteAll, wsNormalizePath: wsNormalizePath, wsNormalizeEntry: wsNormalizeEntry, wsNormalizeAll: wsNormalizeAll, wsFind: wsFind, wsUpsert: wsUpsert, wsRemove: wsRemove, wsEntryFromLegacy: wsEntryFromLegacy, wsToLegacyConfig: wsToLegacyConfig, wsClone: wsClone, wsBasename: wsBasename, WS_KEY: WS_KEY, termWorkspaceEntry: termWorkspaceEntry, termQuotePath: termQuotePath, termCommandWithCwd: termCommandWithCwd, termJobForEntry: termJobForEntry, termBatchMessage: termBatchMessage, TERM_SESSION_MAX: TERM_SESSION_MAX, runTerminalBatch: function (a) { return typeof testHooks.runTerminalBatch === "function" ? testHooks.runTerminalBatch(a) : Promise.resolve(null); }, termNewId: termNewId, termReadConfig: termReadConfig, termWriteConfig: termWriteConfig, TERM_KEY: TERM_KEY, termNormalizeConfig: termNormalizeConfig, termNormalizeCommand: termNormalizeCommand, termNormalizeLabel: termNormalizeLabel, termWrapCommand: termWrapCommand, termScanMarker: termScanMarker, termWaitForMarker: termWaitForMarker, termRunSequence: termRunSequence, termActionLabel: termActionLabel, termDefinedActions: termDefinedActions, termDefaults: termDefaults, termDescribeOutcome: termDescribeOutcome, TERM_TIMEOUT_DEFAULT: TERM_TIMEOUT_DEFAULT,  pickIndexForTurn: pickIndexForTurn, parseTurnAnchor: parseTurnAnchor, findAllTurnAnchors: findAllTurnAnchors, latestOutline: latestOutline, parseTurnChip: parseTurnChip, findInConversation: findInConversation, snippetAround: snippetAround, normalizeTags: normalizeTags, allTags: allTags, activeTagOf: activeTagOf, filterNotes: filterNotes, appendNote: appendNote, mergeNotes: mergeNotes, markdownBody: function (text) { return MarkdownBody({ text: text }); }, summarizeWithModel: function (a, b, c, d, e) { return testHooks.summarizeWithModel ? testHooks.summarizeWithModel(a, b, c, d, e) : Promise.reject(new Error('seam missing')); }, showNotice: function (a, b, c) { return testHooks.showNotice ? testHooks.showNotice(a, b, c) : undefined; }, focusWrapReadout: function () { return typeof testHooks.focusWrapReadout === "function" ? testHooks.focusWrapReadout() : undefined; }, focusWrapDecide: function (name, target) { return typeof testHooks.focusWrapDecide === "function" ? testHooks.focusWrapDecide(name, target) : undefined; }, focusWrapEscape: function (reason) { return typeof testHooks.focusWrapEscape === "function" ? testHooks.focusWrapEscape(reason) : undefined; }, focusDimMarks: function (items, lock) { return typeof testHooks.focusDimMarks === "function" ? testHooks.focusDimMarks(items, lock) : undefined; }, focusLockedHere: function () { return typeof testHooks.focusLockedHere === "function" ? testHooks.focusLockedHere() : undefined; }, focusRemaining: function () { return typeof testHooks.focusRemaining === "function" ? testHooks.focusRemaining() : 0; }, focusHeaderLabel: function () { return typeof testHooks.focusHeaderLabel === "function" ? testHooks.focusHeaderLabel() : undefined; }, paintLockedSessions: function () { return typeof testHooks.paintLockedSessions === "function" ? testHooks.paintLockedSessions() : undefined; } };
    exports.__test.buildStatus = buildStatus;
    exports.__test.termFatalReason = termFatalReason;
    exports.__test.wsHeaderRefs = wsHeaderRefs;
    exports.__test.wsHeaderActions = wsHeaderActions;
    exports.__test.focusDefaultsFrom = focusDefaultsFrom;
    exports.__test.VERSION = VERSION;
    exports.__test.versionParts = versionParts;
    exports.__test.compareVersions = compareVersions;
    exports.__test.UPDATE_REGISTRY_URL = UPDATE_REGISTRY_URL;
    exports.__test.UPDATE_PAGE_URL = UPDATE_PAGE_URL;
    exports.__test.REPO_URL = REPO_URL;
    exports.__test.focusWrapArmed = function () { return typeof testHooks.focusWrapArmed === "function" ? testHooks.focusWrapArmed() : undefined; };
    // 重新加锁走的**生产路径**（对话框与设置页都调 testHooks.focusLockFor ⇒ lockFocusLocally）。
    // 桥出来是为了让「解除 → 再锁」这条真机 bug 能被端到端断言，而不是只测一个内部函数。
    exports.__test.focusLockFor = function (minutes, scope) { return typeof testHooks.focusLockFor === "function" ? testHooks.focusLockFor(minutes, scope) : undefined; };
    return module.exports;
  }
});
