import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Every path is derived from this file's own URL, so the suite runs from any checkout
// directory. `fileURLToPath` is mandatory here (never `URL.pathname`): this repository
// is checked out under a non-ASCII path and `.pathname` would not decode it.
const pkgRoot = new URL('../', import.meta.url); // <pkg>/verify/ -> <pkg>/
// `HA_CLIENT_JS=<file>`: the mutation harness drives a /tmp copy, never the live file.
const clientPath = process.env.HA_CLIENT_JS || fileURLToPath(new URL('../lib/client.js', import.meta.url));
// Anchor CJS resolution at the package root: Node then looks in <pkg>/node_modules and
// walks up, which finds react whether the package is itself the clone root
// (<clone>/node_modules) or nested inside a checkout (<repo>/node_modules).
// NOTE: react is a real environment dependency of this suite; it is intentionally not
// vendored here, so a copy without react installed fails with MODULE_NOT_FOUND('react').
const req = createRequire(pkgRoot);
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');

const code = fs.readFileSync(clientPath, 'utf8');
// Switch 行的**期望条数**从 bundle 现算（模块级：下面两处断言都要用）。
//   4 行为开关 + 1「全部功能」总开关 + N 档功能总开关 + 1 调试重发跟踪
// N 就是 FEATURE_KEYS 的长度 —— 手抄的 "13" 在 2026-10-16 加第 8 档（终端按钮）当天就过期了。
const FEATURE_KEY_LIST = ((code.match(/var FEATURE_KEYS = \[([^\]]*)\]/) || [, ''])[1].match(/"[^"]+"/g) || []).map((x) => x.slice(1, -1));
const FEATURE_COUNT = FEATURE_KEY_LIST.length;
if (FEATURE_COUNT < 1) throw new Error('verify_render could not read FEATURE_KEYS out of the bundle');
const EXPECTED_SWITCHES = 5 + 1 + FEATURE_COUNT + 1;
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } } };
const primitivesStub = {
  Modal: (props) => props.open ? React.createElement('div', { 'data-modal': '1' }, props.title, props.children) : null,
  // ── 2026-10-16（第 1 条批评"里面的按钮好丑"）：设置页的次要动作改用官方 `Button` 之后，
  //    桩必须能**证明**"这颗按钮是官方原语渲染的"。所以给它打一个 `data-prim="Button"` 标记
  //    （属性名刻意避开含 `variant=` 的字面量 —— 下面那条头像按钮的 `/variant=/` 断言会被误伤）。
  //    真签名：`{ variant = "ghost", size = "md", icon, className, children, ...rest }`，
  //    `rest` 透传（onClick / disabled / title）。
  Button: (props) => React.createElement('button', {
    'data-prim': 'Button',
    'data-pv': props.variant === undefined ? 'ghost' : props.variant,
    'data-ps': props.size === undefined ? 'md' : props.size,
    disabled: props.disabled,
    title: props.title
  }, props.children),
  // ── 2026-10-16 终端按钮：「设置 → 会话操作」里的文本框用官方 `Input`。
  //    真签名：`forwardRef(function Input({ icon, className, ...rest }, ref))`
  //    ⇒ `...rest`（value / onChange / placeholder / aria-label）透传给原生 <input>。
  //    Electron 不实现 window.prompt，所以这里的输入框是**唯一的**文本入口 ——
  //    桩必须渲染出一个真的 <input>，否则"能编辑命令"这件事在 SSR 里根本验不到。
  Input: (props) => React.createElement('input', {
    'data-prim': 'Input',
    value: props.value,
    placeholder: props.placeholder,
    'aria-label': props['aria-label'],
    onChange: props.onChange
  }),
  // ── 2026-10-16 终端按钮：「设置 → 会话操作」里的文本框用官方 `Input`。
  //    真签名：`forwardRef(function Input({ icon, className, ...rest }, ref))`
  //    ⇒ `...rest`（value / onChange / placeholder / aria-label）透传给原生 <input>。
  //    Electron 不实现 window.prompt，所以这里的输入框是**唯一的**文本入口 ——
  //    桩必须渲染出一个真的 <input>，否则"能编辑命令"这件事在 SSR 里根本验不到。
  Input: (props) => React.createElement('input', {
    'data-prim': 'Input',
    value: props.value,
    placeholder: props.placeholder,
    'aria-label': props['aria-label'],
    onChange: props.onChange
  }),
  IconListPenOutlineRegular: () => React.createElement('svg', { 'data-icon': 'notes' }),
  // Same shape as the real primitive: it takes `text` and renders it.
  MarkdownText: (props) => React.createElement('div', { 'data-markdown': '1' }, props.text),
  // ── 2026-10-16 四 tab 改版新增的两个官方原语 ───────────────────────────────────
  // ⚠️ 这里的属性形状必须是**真的**（取自 app.asar 的
  //    @deepseek-ai/dsh-client-ui-primitives/lib/index.js）：
  //      Switch           → <button type="button" role="switch" aria-checked aria-label>
  //                         `label` **只进 aria-label**，本体不渲染任何文字
  //                         ⇒ 可见文字必须是它的兄弟节点（这条由一个断言守着）
  //      SegmentedControl → <div role="tablist" aria-label> 里一串
  //                         <button role="tab" id=`${id}-${v}` aria-controls=`${id}-${v}-panel`
  //                                 aria-selected tabIndex>
  //    面板那一侧的 id 由插件自己拼（`settingsPanelId`），所以下面那条
  //    "tab ↔ 面板对齐"的断言读的就是这两个真属性 —— 桩把属性写歪了，断言就白给。
  // ── 2026-10-17 第 2 段：多工作区列表的**多选**用官方 `Checkbox`（多选语义，与 Switch 的
  //    "一个开关"不同）。真签名：`Checkbox({ checked, onChange(checked), label, disabled, title,
  //    className })` ⇒ `<label class=… title=…><input type="checkbox" checked disabled
  //    onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>`。
  //    ⚠️ `label` 同时是**可见文字**与无障碍名（与 Switch 不同：Switch 的 label 只进 aria-label）。
  //    这里补一个 `data-prim="Checkbox"` 标记，好让"多选框必须是官方原语"这条能被结构层断言。
  Checkbox: (props) => React.createElement('label', { 'data-prim': 'Checkbox', title: props.title },
    React.createElement('input', {
      type: 'checkbox',
      checked: props.checked === true,
      disabled: props.disabled === true ? true : undefined,
      onChange: (event) => { if (typeof props.onChange === 'function') props.onChange(event.target.checked); }
    }),
    React.createElement('span', null, props.label)),
  Switch: (props) => React.createElement('button', {
    type: 'button', role: 'switch',
    'aria-checked': props.checked === true ? 'true' : 'false',
    'aria-label': props.label,
    disabled: props.disabled === true ? true : undefined,
    title: props.title
  }, React.createElement('span', { 'data-thumb': '1' })),
  SegmentedControl: (props) => React.createElement('div', { role: 'tablist', 'aria-label': props.label },
    props.options.map((option) => React.createElement('button', {
      type: 'button', role: 'tab', key: option.value,
      id: props.id + '-' + option.value,
      'aria-controls': props.id + '-' + option.value + '-panel',
      'aria-selected': option.value === props.value ? 'true' : 'false',
      tabIndex: option.value === props.value ? 0 : -1,
      disabled: props.disabled === true || option.disabled === true ? true : undefined,
      title: option.title
    }, option.label)))
};
const mockRequire = (id) => {
  if (id === 'react') return React;
  if (id === 'react/jsx-runtime') return req('react/jsx-runtime');
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
  throw new Error('unexpected require ' + id);
};
// Notes live in localStorage; seeding them here is how the markdown-body check gets a row.
let seededNotes = null;
// Browser globals the bundle legitimately uses. The timers are inert BY DESIGN: SSR
// never runs effects, and a real timer (the bundle now schedules the apply-failure
// toast with setTimeout(...,1200) inside apply()) would keep the process alive past
// the assertions and could throw after the success line. They exist only so that
// activation cannot die on `ReferenceError: setTimeout is not defined`.
const ssrTimers = {
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  queueMicrotask: (fn) => { try { fn(); } catch (e) { /* best effort */ } }
};
const sandbox = {
  window: windowObj, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console, ...ssrTimers,
  localStorage: {
    getItem: (key) => (key === 'dsh.deepworker.notes' ? seededNotes : null),
    setItem: () => {}, removeItem: () => {}
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

let component = null;
let notesComponent = null;
let pageComponent = null;
let settingsComponent = null;
let headerComponent = null;
const dbg = { injects: 0, registers: 0, effects: 0 };
const ctx = {
  effect: (fn) => { dbg.effects++; fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: (n, f) => { dbg.injects++; f(); }, register: (c, comp) => {
    dbg.registers++;
    if (c.name === 'conversation.chat.turnTail') component = comp;
    if (c.name === 'sidebar.footer.action') notesComponent = comp;
    if (c.name === 'main') pageComponent = comp;
    if (c.name === 'settings.section') settingsComponent = comp;
    if (c.name === 'conversation.session.header.utilities') headerComponent = comp;
  } },
  sessions: { create: async () => 'x', fork: async () => 'y' },
  // ── 2026-10-15: the settings debug block now prints the command table FROM `shortcutStatus`
  // (derived) instead of a hard-coded id list. With no `shortcuts` service at all the table is
  // legitimately empty — the assertion below then caught a HARNESS gap, not a plugin bug: real
  // activation always has the service. Stub it so the rendered page has the app's shape
  // (DSH's own `register` returns a disposer).
  shortcuts: { register: () => function () {} },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: { openSession: () => {}, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '', archiveSession: async () => {} },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
};
console.log('exports keys ->', Object.keys(exportsObj), 'apply type ->', typeof exportsObj.apply);
exportsObj.apply(ctx);
console.log('dbg ->', JSON.stringify(dbg));
if (component === null || (typeof component !== 'function' && typeof component !== 'object')) { console.error('FAIL: component not captured'); process.exit(1); }
console.log('captured component type ->', typeof component, component && component.$$typeof ? '(react.memo)' : '');
if (typeof notesComponent !== 'function') { console.error('FAIL: the sidebar-foot notes action was not registered'); process.exit(1); }
if (typeof pageComponent !== 'function') { console.error('FAIL: the notes main panel was not registered'); process.exit(1); }

const dict = { 'focus.title': '专注锁', 'focus.report': '把自检发给我', 'focus.lockSession': '锁定本会话', 'focus.unlockSession': '立即解锁', 'focus.refresh': '刷新状态', 'action.retry': '重试本轮', 'action.branch': '在此分支', 'action.resend': '编辑重发', 'action.quote': '引用回复', 'action.newMode': '选模式新建',
  'notes.title': '笔记', 'notes.placeholder': '随手记一条', 'notes.empty': '还没有笔记', 'notes.copied': '已复制',
  'notes.back': '返回对话', 'notes.pageHint': '随手记的命令和提醒',
  'notes.search': '搜索笔记…', 'notes.count': '{shown} / {total} 条', 'notes.noMatch': '没有匹配的笔记',
  'notes.export': '复制全部', 'notes.import': '导入', 'notes.importHint': '粘贴「复制全部」得到的 JSON',
  'settings.title': 'DeepWorker',
  'settings.quoteProvenance': '引用时写入出处行', 'settings.retryNote': '重试时附带已改动文件提示',
  'settings.debugResendTrace': '调试：编辑重发时输出诊断跟踪（默认关）',
  'settings.archiveOriginal': '默认归档原对话',
  // ⚠️ 「存储位置」那句**不在这里写死**：它是产品文案，写死在夹具里就会与 bundle 漂开 ——
  //    渲染出来的页面用夹具、而"指路是否正确"的断言读 bundle ⇒ 两条都绿，页面上那句话却可能
  //    是旧的（本机踩过"说的和做的不一样"）。所以那一项在字面量之后**从 bundle 现读**（见下）。
  'settings.shortcutsHint': '这两个命令不预设按键', 'settings.reloadHint': '插件代码更新请 Cmd+Q 完全退出再开；重载界面不会重建插件宿主。', 'digest.buttonShort': '存为笔记', 'digest.optTitle': '总结并存入笔记', 'digest.optHint': '这些是确定性选项', 'digest.optKeyword': '只收含这些词', 'digest.optLength': '回答长度', 'digest.optLengthShort': '短', 'digest.optLengthMid': '中', 'digest.optLengthLong': '长', 'digest.optFormat': '格式', 'digest.optFormatOutline': '编号大纲', 'digest.optFormatMd': 'Markdown 列表', 'digest.optFormatPlain': '纯文本', 'digest.optSave': '存为笔记', 'digest.optCancel': '取消', 'notes.unit': '条', 'digest.nothing': '没有可总结的内容', 'notes.imported': '已导入', 'notes.copied': '已复制到剪贴板', 'quote.jumpFailed': '那一轮不在已加载的窗口里', 'digest.saved': '已存为一条笔记（共 {total} 条）', 'digest.meta': '{turns} 轮 · 改动 {files} 个文件', 'digest.turnLine': '{index}. {prompt} → {response}', 'retry.note': '…{paths}…', 'quote.provenance': '↳ 引自本轮第 {turn} 轮', 'settings.shortcutStatus': '命令注册状态：',
  'digest.button': '总结当前对话存为笔记', 'digest.saved': '已把摘要存为一条笔记', 'digest.nothing': '还没有可总结的内容',
  'digest.head': '【会话摘要 · {title}】', 'digest.meta': '{turns} 轮 · 改动 {files} 个文件',
  'digest.asks': '诉求：', 'digest.files': '改动：',
  'notes.importConfirm': '确认导入', 'notes.importCancel': '取消',
  // the real t() interpolates; the stub must too or the count would read as a template
  'notes.count': '{shown} / {total} 条',
  'modal.newMode.workspaceEmpty': '(无工作区)', 'modal.newMode.workspaceNew': '＋ 新建工作区…', 'modal.newMode.workspacePicking': '正在选择目录…',
  'modal.newMode.workspaceLabel': '工作区', 'modal.newMode.modeLabel': '模式', 'modal.newMode.hint': 'hint', 'modal.newMode.submit': '创建并发送',
  'modal.newMode.loading': '正在加载模式…', 'modal.newMode.placeholder': 'ph', 'modal.resend.title': '编辑并重新发送', 'modal.resend.hint': 'h', 'modal.resend.submit': '发送',
  // ── 2026-10-15 设置页改版 + 功能开关：这些键必须在这里有**真实**中文，否则下面所有
  //    文本断言都会退化成"裸键名也匹配"（SSR 里 t() 找不到键就原样返回键名 —— 断言会
  //    看起来绿着，其实一个字都没验证）。新增界面文案必须同步进这里。
  'settings.versionTitle': '构建版本',
  'settings.section.debug': '调试',
  'settings.featureSummary': '未引入 {n} 项：{list}', 'settings.featureAllOn': '全部功能都已引入',
  'settings.debugHint': '诊断读数：出问题时先来这里。',
  'settings.failureBanner': '⚠ {commands} 个命令注册失败 · {contributions} 项贡献注册失败',
  'settings.shortcutNone': '（没有已注册的命令）', 'settings.coreProbe': '核心探针：',
  'settings.unlockLocalHint': '只影响这台电脑上的拦截：立即解锁并撤掉切换会话的拦截，不发送任何消息。',
  // ── 2026-10-16 四 tab 改版：tab 名 + 每档功能的灰字说明 + 会话操作的说明行 ──────
  // ── 2026-10-16 二次分组（用户看真机截图后指出两处错位）：`content` 这一档改名成
  //    `notes`（承载 笔记 · 摘要 · 存储位置），对应的 i18n 键也由 settings.tab.content
  //    改成 settings.tab.notes。旧键已从 zh / en 两个词典里一起删掉。
  'settings.tab.basic': '基础', 'settings.tab.focus': '专注锁',
  'settings.tab.notes': '笔记', 'settings.tab.actions': '会话操作',
  // 2026-10-17：终端按钮有了自己的 tab（用户原话"启动按钮没有单独的tab页吗"）。
  // 2026-10-17（第 1 段改名）：tab 名由「终端」改成「命令按钮」（en: Terminal → Commands）——
  //   这一页讲的是"头部那组命令按钮 + 每个工作区各自配的命令"；叫「终端」会让人以为它是
  //   侧栏那个终端面板。夹具跟着改；独立的改名守卫见 verify_tab_names.mjs。
  'settings.tab.terminal': '命令按钮',
  'settings.section.storage': '存储位置',
  'settings.tabsLabel': 'DeepWorker 设置分区',
  'feature.descFocusLock': '锁住其它会话，只留这一个可用。',
  'feature.descNotice': '把提醒发到系统通知中心。',
  'feature.descFind': '在已加载的窗口里查找并高亮命中。',
  'feature.descQuote': '把选中的文字作为带出处的引用写进输入框。',
  'feature.descDigest': '把当前对话压成一条笔记。',
  'feature.descNotes': '侧栏脚的笔记页。',
  'feature.descTurnActions': '重试 / 在此分支 / 编辑重发 / 选模式新建。',
  'settings.turnActionsHint': '这些操作各自挂在轮末的槽位上。',
  // 硬要求 ③ 的指路句。
  // ⚠️ 2026-10-17：内联重载**按钮**已按用户要求删掉（"保留最上面的重载按钮就行了"）⇒
  //    夹具里不再有 `settings.reloadInline`（键已从 bundle 的 zh/en 两份词典里一起删掉）。
  //    代码里只剩一句纯文字提示，它的文案从 bundle 现读（见下面 dictValueOf 那一段），
  //    手抄一份只会在改文案当天变成一句永远不会出现在页面上的字符串。
  'settings.tabIntroOff': '该功能未引入 —— 到「基础」里打开它',
  'settings.unlockLocalShort': '不动拦截之外的东西',
  'settings.featureAllOnHint': '「移除」= 这个功能根本不注册，所以要 Cmd+Q 完全退出再开才生效。',
  'feature.section': '功能引入 / 移除', 'feature.offSuffix': '未引入',
  'feature.disabled': '{name} 已关闭（设置 → DeepWorker 里可以打开）',
  // ⚠️ `feature.offPrefix` 与 8 条 `feature.hint*Off` **不在这里手抄** —— 它们在下面从 bundle
  //    现读。原因见那段注释（手抄副本会漂，漂了之后"前缀重复"这条断言就再也红不了）。
  'feature.nameFocusLock': '专注锁', 'feature.nameNotice': '通知与气泡', 'feature.nameFind': '会话内查找',
  'feature.nameQuote': '引用', 'feature.nameDigest': '摘要', 'feature.nameNotes': '笔记', 'feature.nameTurnActions': '轮次操作',
  // 2026-10-16 新增第 8 档：名字必须在夹具里有**真实中文**，否则下面的灰字提示断言会
  // 以 "未引入：undefined" 假红（而且看不出原因）。
  // 2026-10-17：`FEATURE_META.featureTerminal.name` 指向的是 `term.featureName`（不是
  // `feature.nameTerminal`）。两个键都必须在这里有真实中文 —— 前者被开关行用，后者是早期
  // 命名留下的（保留它不会假红，但缺了前者会让开关变成无名控件）。
  'term.featureName': '终端按钮', 'term.featureDesc': '会话头部的启动 / 停止按钮：新开终端跑你配的命令。',
  // 「终端编辑器在哪一页」的判据只认这一句 —— 它只出现在 TerminalButtonSettings 里，
  // 且在整页唯一（`term.settingsTitle`/`term.featureName` 都是"终端按钮"，会撞名）。
  'term.timeoutLabel': '判定「仍在运行」前等多少秒',
  // ⚠️ 2026-10-16 第 4 轮：`feature.focusOffUnlocked` / `feature.focusOffUnlockedFailed` /
  //    `feature.focusOffFailed` 三条**已从 bundle 里删掉**（它们描述的是"已经关了、但解锁没
  //    成功"这个状态 —— 改版后解锁失败就**不许关** ⇒ 那个状态不存在了）。夹具里跟着删，
  //    否则夹具会留着一份 bundle 里已经不存在的文案（"夹具比实现更新"同样是漂）。
  'feature.notesOffBanner': '笔记功能已关闭（设置 → DeepWorker → 功能开关 里可以打开）。',
  'settings.nativeNotice': '提醒用系统通知（屏幕右上角，可进通知中心）',
  'settings.lastJump': '上次跳转诊断（没高亮时才有）：',
  'find.button': '会话内查找', 'find.buttonShort': '查找',
  'focus.remaining': '剩余', 'focus.unknown': '状态是按需读取的',
  'notes.searchTitle': '搜索笔记', 'notes.writeFailed': '没能写入本地存储',
  'notice.title': '通知哪些会话', 'notice.hint': '①「只通知本会话」…',
  'notice.onlyThis': '只通知本会话', 'notice.muteThis': '静音/取消静音本会话', 'notice.clear': '清除范围设置',
  'focus.free': '未锁定', 'focus.locked': '🔒 专注中' };
// 存储位置的文案从 bundle 现读（夹具不许留它的副本，见上面那条注释）。
dict['settings.storage'] = /"settings\.storage":\s*"([^"]*)"/.exec(code)[1];
// ── 2026-10-16 锁死修复：`feature.offPrefix` 与 8 条 `feature.hint*Off` 也一律从 bundle 现读 ──
// 这里原来留着手抄的**旧**文案（'已关闭：…'），而 bundle 早已是 '未引入：…'。手抄副本会漂；
// 更糟的是漂了之后"前缀与正文重复同一个词"那条断言**永远红不了**（改 bundle 不动夹具 ⇒
// 假绿）。同一原则见上面 `settings.storage` 那条注释。
//
// ⚠️ 现读必须**分词典**：zh 与 en 各有一份，所以下面 en 的那份由 enValue() 单独取。
function dictValueOf(blockName, key) {
  const start = code.indexOf('    var ' + blockName + ' = {');
  if (start < 0) throw new Error('dictionary not found: ' + blockName);
  const end = code.indexOf('\n    };', start);
  const text = code.slice(start, end);
  const m = new RegExp('"' + key.replace(/\./g, '\\.') + '":\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);
  if (m === null) throw new Error('key "' + key + '" not found in the ' + blockName + ' dictionary');
  return m[1];
}
// ⚠️ 这个清单必须与 bundle 里的 `offHintOf()` 一一对应：漏一档 ⇒ dict[key] 是 undefined
// ⇒ 灰字断言以 "未引入：undefined" 假红。加档时改这里（不是改 dict 里手抄的文案）。
const OFF_HINT_KEYS = ['feature.hintGenericOff', 'feature.hintFocusLockOff', 'feature.hintNoticeOff', 'feature.hintFindOff', 'feature.hintQuoteOff', 'feature.hintDigestOff', 'feature.hintNotesOff', 'feature.hintTurnActionsOff', 'feature.hintTerminalOff'];
const OFF_PREFIX_KEY = 'feature.offPrefix';
for (const key of OFF_HINT_KEYS.concat([OFF_PREFIX_KEY])) dict[key] = dictValueOf('zh', key);
// ── 2026-10-16 第 4 轮：总开关那一行的 13 个新键**一律从 bundle 现读**（同上的理由：
//    手抄副本会漂，而"总开关在卡片顶部 / 混合态显示为关 / 回执说清解开了什么"这几条断言
//    全靠这些字符串）。少一个键 ⇒ dictValueOf 直接抛错，不会退化成裸键名匹配（假绿）。
const MASTER_KEYS = [
  'settings.masterSwitch', 'settings.masterDescOn', 'settings.masterDescPartial', 'settings.masterDescOff',
  'settings.masterOnDone', 'settings.masterOffDone', 'settings.masterOffNoLock',
  'settings.focusOffDone', 'settings.focusOffNoLock', 'settings.masterUnlockFailed', 'settings.masterHookMissing',
  'settings.scopeSession', 'settings.scopeWorkspace'
];
for (const key of MASTER_KEYS) dict[key] = dictValueOf('zh', key);
// ── 2026-10-17：全页只剩**一句**「改动需重载」的文字提示（内联按钮按用户要求删掉）──
//    文案照样从 bundle 现读：手抄的话，改文案当天这条断言就会去页面里找一个**不存在**的
//    字符串，而它自己不会红（它找的是"有"）—— 漂了也看不出来。
// ── 2026-10-17 第 1 段：「基础 → 功能引入 / 移除」卡片标题下那句"装/卸 ≠ 设置"的说明 ──
//    同样从 bundle 现读（手抄会漂，漂了之后"这句话在页面上"就变成在找一个不存在的字符串）。
const SCOPE_NOTE_KEY = 'settings.featureScopeNote';
dict[SCOPE_NOTE_KEY] = dictValueOf('zh', SCOPE_NOTE_KEY);
// ── 2026-10-17 第 2 段：命令按钮页的**常驻**标记（批量条标题 + 工作区说明）──────────────
//    它们取代了原来的 `term.timeoutLabel`（编辑器现在只在有选中工作区时才渲染，
//    而本套件的存储桩是空的 ⇒ 那一行不可能出现）。同样从 bundle 现读，不手抄。
//    只用**无占位符**的键（`term.wsHint`）：字典值带 `{n}` 的键（如工作区列表标题）在页面上
//    是被插值过的，拿原值去搜必然搜不到 —— 那是假红。
//    第 3 段加回 `term.batchTitle`（批量条的标题，也是常驻的）—— 它同样是**无占位符**的键。
for (const key of ['term.batchTitle', 'term.wsHint']) dict[key] = dictValueOf('zh', key);
const t = (k) => dict[k] ?? k;

// ── 「这个控件点得到吗」的机械判据（2026-10-16 锁死事故新增）──────────────────────────────
// 判据逐字照抄任务书：**控件自身及其所有祖先都不得带 `pointer-events: none`
// / `aria-disabled="true"`**（外加"自己不许有 disabled 属性"）。
//
// ⚠️ 为什么不能用"HTML 里出现了 aria-disabled 就是坏的"这种文本断言：页面上**合法**的灰态
//    很多（其它 tab 的小节整块灰、面板整块灰）。必须问的是"这个控件在不在灰态子树**里面**"
//    —— 那是个**包含关系**问题，只能按元素边界算。所以这里用一个极小的标签栈扫描器：
//    找出每个带 `pointer-events:none` / `aria-disabled="true"` 的元素，用**同名标签配平**
//    求它的闭区间，于是"某偏移落在某灰态区间内" = "它是那个灰态元素的后代"。
const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'path', 'circle', 'rect', 'use', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
/** 所有"不可用子树"的闭区间（开标签带 pointer-events:none 或 aria-disabled="true"）。 */
function disabledSpans(html) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const full = m[0];
    if (m[1] === '/') continue;                       // closing tag
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (!/pointer-events\s*:\s*none/i.test(attrs) && !/aria-disabled\s*=\s*"true"/i.test(attrs)) continue;
    if (m[4] === '/' || VOID_TAGS.has(tag)) { out.push({ tag, start: m.index, end: m.index + full.length, attrs }); continue; }
    const depthRe = new RegExp('<' + tag + '(?=[\\s/>])|</' + tag + '>', 'gi');
    depthRe.lastIndex = m.index + full.length;
    let depth = 1;
    let end = html.length;
    let mm;
    while ((mm = depthRe.exec(html)) !== null) {
      if (mm[0].charAt(1) === '/') { depth--; if (depth === 0) { end = mm.index + mm[0].length; break; } }
      else depth++;
    }
    out.push({ tag, start: m.index, end, attrs });
  }
  return out;
}
/** 落在 `at` 外面的灰态子树（= 这个控件的祖先链上的禁用层）。 */
const ancestorsDisabled = (spans, at) => spans.filter((s) => at > s.start && at < s.end);
/** 每颗可见文字正好是 `label` 的按钮：`{at, openTag}`。 */
function buttonsWithText(html, label) {
  const out = [];
  for (const m of html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)) {
    if (m[1].trim() === label) out.push({ at: m.index, openTag: m[0].slice(0, m[0].indexOf('>') + 1) });
  }
  return out;
}
/** 每个 `<button role="switch" …>` 的 `{at, openTag, label}`。 */
function switches(html) {
  const out = [];
  for (const m of html.matchAll(/<button\b[^>]*>/g)) {
    const openTag = m[0];
    if (!/role="switch"/.test(openTag)) continue;
    const label = /aria-label="([^"]*)"/.exec(openTag);
    out.push({ at: m.index, openTag, label: label === null ? '' : label[1] });
  }
  return out;
}
/** 页面上的纯文本块（按标签切开）—— 用来做"同一个词在一句话里出现两次"的类级扫描。 */
const textChunks = (html) => html.split(/<[^>]*>/).map((s) => s.trim()).filter((s) => s !== '');
/** 同一句话里"同一个词被分隔符重复"的探测器（`未引入 · 未引入：…` 这一族）。 */
function repeatedWordAcrossSeparator(text) {
  const hits = [];
  for (const m of text.matchAll(/([\u4e00-\u9fa5]{2,8})\s*[·：:]\s*\1/g)) hits.push(m[0]);
  return hits;
}
// Fixture data only: these paths are synthetic on purpose, so the suite never depends
// on the machine's real directories (and a path audit stays free of user paths).
const workspaces = [
  { id: 'ws-a', title: 'WORK', path: '/fixture/WORK', sessionIds: ['s1'] },
  { id: 'ws-b', title: 'project', path: '/fixture/project', sessionIds: [] },
  { id: 'ws-c', title: 'default-workspace', path: '/fixture/default-workspace', sessionIds: [] }
];
const props = {
  turn: { turn: 0, status: 'closed', start: { seq: 5 }, end: { seq: 10 } }, seq: 10, t, sessionId: 's1',
  useProjection: () => [{ turn: 0, seq: 5, prompt: 'hi' }],
  inputActions: { setDraft: () => {} },
  forkBefore: async () => {}, forkAt: async () => {}, resend: async () => {},
  listPresets: async () => [{ id: 'standard', name: 'standard', isDefault: true }],
  listSessions: () => [{ id: 's1', title: '当前对话', path: '/x' }],
  listWorkspaces: () => workspaces,
  pickWorkspace: async () => null,
  userText: () => 'ORIGINAL MESSAGE',
  archiveSession: async () => {},
  createWithMode: async () => 'x'
};

let html = '';
try {
  html = renderToStaticMarkup(React.createElement(component, props));
} catch (e) {
  console.error('FAIL: render threw ->', e && e.stack || e);
  process.exit(1);
}
const fail = (m) => { console.error('FAIL: ' + m); console.error(html.slice(0, 1200)); process.exit(1); };
const ti = (k, params) => {
  let out = dict[k] ?? k;
  if (params) for (const [key, value] of Object.entries(params)) out = out.split('{' + key + '}').join(String(value));
  return out;
};
// 2026-10-20：「编辑重发」已移到用户气泡下面。⇒ 这一排现在**每一轮**都是同一组 4 颗按钮、
// 同一顺序。这里断言顺序（不是只断言"都在"）：漏一颗、换一位、或把别的东西塞进来都会红。
// ⚠️ turn > 1 的行为级断言在 verify_turn_tail_row.mjs —— 本套件只渲染第一轮。
const EXPECTED_ROW = ['引用回复', '重试本轮', '在此分支', '选模式新建'];
const rowLabels = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
if (rowLabels.slice(0, EXPECTED_ROW.length).join('|') !== EXPECTED_ROW.join('|')) {
  fail('the action row must be exactly [' + EXPECTED_ROW.join(' / ') + '] in this order, got ' + JSON.stringify(rowLabels.slice(0, 6)));
}
// only the 4 buttons render while the dialog is closed
const buttons = (html.match(/<button/g) || []).length;
console.log('closed-state buttons ->', buttons, JSON.stringify(rowLabels.slice(0, 5)));
if (buttons !== 4) fail('expected 4 buttons in closed state, got ' + buttons);
if (html.includes('data-modal')) fail('dialog should not render while closed');
console.log('closed-state render OK (5 action buttons in fixed order, no dialog DOM)');

// ---- regression: the action row must not be dragged out of its container ----
const rowStyleMatch = html.match(/style="([^"]*height:22px[^"]*)"/);
if (!rowStyleMatch) fail('action row style not found in the closed-state markup');
const rowCss = rowStyleMatch[1];
console.log('action row style ->', rowCss);
if (/margin-(top|bottom):\s*-/.test(rowCss)) {
  fail('action row uses a negative margin: it is the first child of the turn-tail root, so this drags it over the row above');
}
if (!/max-height:22px/.test(rowCss) || !/min-height:22px/.test(rowCss)) fail('action row height is not pinned');
if (!/flex-wrap:nowrap/.test(rowCss) || !/overflow:hidden/.test(rowCss)) fail('action row can reflow and change the turn height');

// now render the dialog open by driving the component's own state via a wrapper
const { useState } = React;
let mount = null;
function Harness() {
  const [open] = useState(true);
  // force-open the dialog by rendering the component and asserting the trigger exists
  return React.createElement(component, props);
}
html = renderToStaticMarkup(React.createElement(Harness));
// The harness renders the same first turn: same 4 buttons, same order.
if ((html.match(/<button/g) || []).length !== 4) fail('the wrapped render must still show exactly 4 action buttons');
console.log('second render OK');

// dropdown rows/styles present in the module
const src = code;
for (const needle of ['dropdownStyle', 'selectTriggerStyle', 'workspaceOpen', 'setWorkspaceOpen', 'overflowY: "auto"', 'maxHeight: "220px"']) {
  if (!src.includes(needle)) fail('missing implementation marker: ' + needle);
}
console.log('\nRENDER CHECKS PASSED');

// ---- open-dialog render: force initial state so SSR shows the markup ----
const rowsLiteral = JSON.stringify(workspaces).replace(/"/g, '\\"');
let openCode = code
  .replace('var modeOpen = (0, react.useState)(false);', 'var modeOpen = (0, react.useState)(true);')
  .replace('var workspaceOpen = (0, react.useState)(false);', 'var workspaceOpen = (0, react.useState)(true);')
  .replace('var workspaces = (0, react.useState)([]);', 'var workspaces = (0, react.useState)(' + JSON.stringify(workspaces) + ');')
  .replace('var workspaceId = (0, react.useState)("");', 'var workspaceId = (0, react.useState)("ws-b");');
if (openCode === code) { console.error('FAIL: state patch did not apply'); process.exit(1); }

let openLoaded = null;
const openWindow = { __ModuleLoader__: { load: (r) => { openLoaded = r; } } };
const openSandbox = { window: openWindow, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console, ...ssrTimers };
openSandbox.globalThis = openSandbox;
vm.createContext(openSandbox);
vm.runInContext(openCode, openSandbox, { filename: 'client-open.js' });
const openExports = openLoaded.factory(mockRequire);
let openComponent = null;
const openCtx = Object.assign({}, ctx, { slots: { inject: (n, f) => { f(); }, register: (c, comp) => { if (c.name === 'conversation.chat.turnTail') openComponent = comp; } } });
openExports.apply(openCtx);

let openHtml = '';
try {
  openHtml = renderToStaticMarkup(React.createElement(openComponent, props));
} catch (e) {
  console.error('FAIL: open-dialog render threw ->', e && e.stack || e);
  process.exit(1);
}
const ofail = (m) => { console.error('FAIL: ' + m); console.error(openHtml.slice(0, 1800)); process.exit(1); };
if (!openHtml.includes('data-modal')) ofail('dialog did not render');
if (!openHtml.includes('WORK') || !openHtml.includes('/fixture/WORK')) ofail('workspace row missing');
if (!openHtml.includes('project') || !openHtml.includes('default-workspace')) ofail('workspace rows missing');
if (!openHtml.includes('▾')) ofail('dropdown chevron missing');
if (!openHtml.includes('＋ 新建工作区…') && !openHtml.includes('+ New workspace')) ofail('new-workspace button missing');
if (!/DeepWorker · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/.test(openHtml)) {
  console.error('FAIL: the dialog must show the build tag so a stale page is detectable');
  process.exit(1);
}
console.log('open-dialog render OK (dialog + workspace dropdown rows + new-workspace button + build tag)');
console.log('\nALL RENDER CHECKS PASSED');

// ---- regression: the Turn OBJECT must drive the boundary + the prefill ----
// 2026-10-17：「回退到此」删掉之后，这条原来只断言"第一轮没有回退按钮"的空检查也一起删了 ——
// 它靠"字符串不在页面里"成立，而那个字符串已经不存在，永远不会红。真正的守卫是上面那条
// **顺序**断言，以及下面 userText() → 编辑框预填的断言（boundary 由 prevSeq 驱动，走 resend）。
console.log('Turn object -> row labels are asserted in order above; prefill is asserted below');

// open the resend modal and assert the textarea is prefilled from userText()
let editCode = code.replace('var editing = (0, react.useState)(false);', 'var editing = (0, react.useState)(true);');
if (editCode === code) { console.error('FAIL: could not force the edit dialog open'); process.exit(1); }
let editLoaded = null;
const editWindow = { __ModuleLoader__: { load: (r) => { editLoaded = r; } } };
const editSandbox = { window: editWindow, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console, ...ssrTimers };
editSandbox.globalThis = editSandbox;
vm.createContext(editSandbox);
vm.runInContext(editCode, editSandbox, { filename: 'client-edit.js' });
const editExports = editLoaded.factory(mockRequire);
let editComponent = null;
editExports.apply(Object.assign({}, ctx, { slots: { inject: (n, f) => { f(); }, register: (c, comp) => { if (c.name === 'conversation.chat.turnTail') editComponent = comp; } } }));
let editHtml = '';
try { editHtml = renderToStaticMarkup(React.createElement(editComponent, props)); }
catch (e) { console.error('FAIL: edit-dialog render threw ->', e && e.stack || e); process.exit(1); }
if (!editHtml.includes('编辑并重新发送')) { console.error('FAIL: edit dialog title missing'); process.exit(1); }
// SSR cannot click, so the dialog is asserted structurally and the prefill
// wiring is asserted on the source (the data path is covered by verify_prompt).
{
  let notesHtml = '';
  try {
    notesHtml = renderToStaticMarkup(React.createElement(notesComponent, { t: (k) => dict[k] ?? k, wide: true }));
  } catch (e) {
    console.error('FAIL: notes action render threw ->', e && e.stack || e);
    process.exit(1);
  }
  if (!notesHtml.includes('笔记')) { console.error('FAIL: notes button label missing'); process.exit(1); }
  if (!notesHtml.includes('data-icon="notes"')) { console.error('FAIL: notes button icon missing'); process.exit(1); }
  console.log('sidebar-foot notes action renders OK');
}
{
  let pageHtml = '';
  try {
    pageHtml = renderToStaticMarkup(React.createElement(pageComponent, { t: ti, selectPanel: () => {} }));
  } catch (e) {
    console.error('FAIL: notes page render threw ->', e && e.stack || e);
    process.exit(1);
  }
  if (!pageHtml.includes('笔记')) { console.error('FAIL: notes page title missing'); process.exit(1); }
  if (!pageHtml.includes('返回对话')) { console.error('FAIL: notes page back control missing'); process.exit(1); }
  if (!pageHtml.includes('随手记的命令和提醒')) { console.error('FAIL: notes page hint missing'); process.exit(1); }
  if (!/DeepWorker · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/.test(pageHtml)) {
    console.error('FAIL: the notes page must show the build tag');
    process.exit(1);
  }
  if (!pageHtml.includes('搜索笔记…')) { console.error('FAIL: notes search box missing'); process.exit(1); }
  if (!pageHtml.includes('复制全部') || !pageHtml.includes('导入')) { console.error('FAIL: export/import controls missing'); process.exit(1); }
  if (pageHtml.includes('总结当前对话存为笔记')) {
    console.error('FAIL: the digest must live in the session header only, not on the notes page');
    process.exit(1);
  }
  // a placeholder named `count` is reserved and never substituted; guard the name
  // Notice texts are shown through showNotice; placeholders there proved unreliable,
  // so they must carry no placeholder at all.
  for (const key of ['digest.saved', 'digest.nothing', 'notes.imported', 'notes.copied', 'quote.jumpFailed']) {
    if (/\{[a-zA-Z]+\}/.test(dict[key] || '')) { console.error('FAIL: notice key ' + key + ' must not use a placeholder'); process.exit(1); }
  }
  const noticeCalls = code.match(/showNotice\([^;]{0,160}/g) || [];
  for (const call of noticeCalls) {
    if (/\{[a-zA-Z]+\}/.test(call)) fail('a notice still interpolates a placeholder: ' + call.slice(0, 120));
  }
  if (!pageHtml.includes('0 / 0 条')) { console.error('FAIL: the count line must interpolate: ' + pageHtml.slice(0, 400)); process.exit(1); }
  // The note body must render as markdown, not as literal `#` / `**`. The renderer is
  // ours (a third-party bundle cannot rely on the app's own markdown symbol being
  // reachable), so this asserts the actual output, not that some function was called.
  seededNotes = JSON.stringify([{ id: 'n1', tags: ['排障', '引用'], text: '# 标题\n\n**粗体** 和 `代码` 和 [链接](https://x.test)\n\n- 甲\n- 乙\n\n```\ncode block\n```' }]);
  let mdHtml = '';
  try {
    mdHtml = renderToStaticMarkup(React.createElement(pageComponent, { t: ti, selectPanel: () => {} }));
  } catch (error) {
    fail('notes page must render with a markdown note present: ' + error.message);
  }
  if (mdHtml.includes('# 标题')) fail('the heading marker must not survive into the output');
  if (!mdHtml.includes('标题')) fail('heading text must survive');
  if (!mdHtml.includes('<strong>粗体</strong>')) fail('**bold** must become <strong>');
  if (!/<code[^>]*>代码<\/code>/.test(mdHtml)) fail('inline code must become <code> (attributes allowed)');
  if (!mdHtml.includes('<a href="https://x.test"')) fail('links must become anchors');
  if (!/<li[^>]*>甲<\/li>/.test(mdHtml) || !/<li[^>]*>乙<\/li>/.test(mdHtml)) fail('list items must become <li> (attributes allowed)');
  if (!/<pre[^>]*>/.test(mdHtml)) fail('fenced code must become <pre>');
  if (mdHtml.includes('**粗体**')) fail('bold markers must not survive into the output');
  if (!mdHtml.includes('#排障')) fail('a note tag must render (row chip / filter bar)');
  if (!mdHtml.includes('全部')) fail('the tag filter bar must offer a clear-all chip');
  seededNotes = null;
  console.log('notes central page renders OK (search + export/import + count + markdown body)');

}
{
  if (typeof settingsComponent !== 'function') { console.error('FAIL: the settings section was not registered'); process.exit(1); }
  if (typeof headerComponent !== 'function') { console.error('FAIL: the session-header digest action was not registered'); process.exit(1); }
  let settingsHtml = '';
  try {
    settingsHtml = renderToStaticMarkup(React.createElement(settingsComponent, { t: ti }));
  } catch (e) {
    console.error('FAIL: settings render threw ->', e && e.stack || e);
    process.exit(1);
  }
  for (const label of ['引用时写入出处行', '重试时附带已改动文件提示', '默认归档原对话']) {
    if (!settingsHtml.includes(label)) { console.error('FAIL: settings switch missing: ' + label); process.exit(1); }
  }
  if (!settingsHtml.includes(dict['settings.storage'])) { console.error('FAIL: storage note missing from the rendered page (it must carry the bundle\'s zh settings.storage verbatim): ' + JSON.stringify(String(dict['settings.storage']).slice(0, 48))); process.exit(1); }
  // ── 每个复选框必须跟着**它自己的设置键**（2026-10-15）────────────────────────────
  // 这条断言是被一条**没被抓住的变异**逼出来的：把 row() 里的 checked 表达式换成读别的
  // 键，`row(...)` 调用点一字不动，此前没有任何断言会红。做法是渲染两次：第一次正常，
  // 第二次把两个键在**内存**里改成 false，要求"正好对应的复选框变未勾选、别的都不动"。
  // 结构断不出来，只能按渲染结果断。
  {
    const keyOf = { '引用时写入出处行': 'quoteProvenance', '重试时附带已改动文件提示': 'retryNote' };
    const sign = (html) => {
      const states = [];
      const labelPos = {};
      const readAt = (at) => {
        // 2026-10-16：控件从裸 `<input type="checkbox">` 换成官方 `primitives.Switch`
        // （渲染成 `<button role="switch" aria-checked="true|false">`）。读法跟着换，
        // 但断言的**语义**一字不变：每个开关必须跟着它自己的设置键。
        // ⚠️ 必须**往后**找：官方设置行配方是「左边文字、右边控件」（space-between），
        //    所以开关在标签之后；以前 input 在前，用 lastIndexOf 才对。
        const input = html.indexOf('role="switch"', at);
        if (input < 0) return null;
        const open = html.lastIndexOf('<button', input);
        if (open < 0) return null;
        return /aria-checked="true"/.test(html.slice(open, html.indexOf('>', open) + 1));
      };
      for (const [label] of Object.entries(keyOf)) {
        const at = html.indexOf(label);
        if (at < 0) return { error: 'missing label ' + label };
        const state = readAt(at);
        if (state === null) return { error: 'no switch before ' + label };
        labelPos[label] = state;
        states.push(state);
      }
      return { byLabel: labelPos, total: (html.match(/role="switch"/g) || []).length };
    };
    const before = sign(settingsHtml);
    if (before.error) { console.error('FAIL: ' + before.error); process.exit(1); }
    for (const label of Object.keys(keyOf)) {
      if (before.byLabel[label] !== true) {
        console.error('FAIL: ' + label + ' must render checked by default (its key defaults to true)');
        process.exit(1);
      }
    }
    // Flip BOTH keys off in memory, then require exactly those two to read unchecked.
    sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes'
      ? seededNotes
      : (key === 'dsh.deepworker.settings' ? JSON.stringify({ quoteProvenance: false, retryNote: false }) : null));
    let flippedHtml = '';
    try {
      flippedHtml = renderToStaticMarkup(React.createElement(settingsComponent, { t: ti }));
    } catch (e) {
      console.error('FAIL: settings re-render with stored settings threw ->', e && e.message || e);
      process.exit(1);
    }
    const after = sign(flippedHtml);
    if (after.error) { console.error('FAIL: on the stored-settings render: ' + after.error); process.exit(1); }
    for (const [label, key] of Object.entries(keyOf)) {
      if (after.byLabel[label] !== false) {
        console.error('FAIL: ' + label + ' must read UNCHECKED when storage says ' + key + '=false (checked must follow its own key)');
        process.exit(1);
      }
    }
    // And nothing else may follow those keys: the other switches stay on. This
    // "collateral damage" check is what catches a `checked` expression that reads a DIFFERENT
    // key: flipping quoteProvenance/retryNote then moves switches that have nothing to do with
    // them (measured: a mutation made every feature master follow retryNote).
    if (after.total !== before.total) {
      console.error('FAIL: the switch count changed between renders (' + before.total + ' -> ' + after.total + ')');
      process.exit(1);
    }
    const stateSeq = (html) => {
      const out = [];
      let i = -1;
      while ((i = html.indexOf('role="switch"', i + 1)) !== -1) {
        const open = html.lastIndexOf('<button', i);
        out.push(open >= 0 && /aria-checked="true"/.test(html.slice(open, html.indexOf('>', open) + 1)));
      }
      return out;
    };
    const seqBefore = stateSeq(settingsHtml);
    const seqAfter = stateSeq(flippedHtml);
    const moved = [];
    for (let i = 0; i < seqBefore.length; i++) if (seqBefore[i] !== seqAfter[i]) moved.push(i);
    if (moved.length !== 2) {
      console.error('FAIL: flipping exactly two settings must move exactly two switches, but ' + moved.length + ' moved (indexes ' + moved.join(',') + ') — a switch is following a key that is not its own');
      process.exit(1);
    }
    // Restore the sandbox so later blocks still see "nothing stored".
    sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes' ? seededNotes : null);
    console.log('settings switches -> checked state follows each key (proved by a second render with quoteProvenance/retryNote=false)');
  }
  // Class-level: no button in the settings page may render without text. Three focus-lock
  // buttons shipped blank because their label was passed as jsx's THIRD argument (the key),
  // so `children` was never set — the page showed three empty boxes.
  // 2026-10-15: 「请求解锁」→「立即解锁」. The label said "ask to unlock" while the handler is
  // a local, message-free unlock (`testHooks.focusUnlockLocal`, which unwraps + clears the
  // local lock and sends nothing) — the host-side guard is gone, so "ask the host" no longer
  // exists. Wording and behaviour must agree, and it must agree EVERYWHERE: three zh entries
  // name that button (the label plus two guidance lines), and renaming only one leaves the UI
  // telling the user to press a button that does not exist.
  // ⚠️ 断言必须看**去掉注释后的代码**：源码注释里就有「请求解锁」这个词（解释这次改名），
  // 直接对全文查会把注释当成违规（实测踩过）。
  {
    const noComments = code
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    if (/请求解锁/.test(noComments)) {
      console.error('FAIL: the misleading 「请求解锁」 wording is back as a STRING in the bundle (the action is a local unlock, not a request): ' + JSON.stringify((noComments.match(/.{0,60}请求解锁.{0,60}/) || [''])[0]));
      process.exit(1);
    }
    const zhKeys = ['focus.unlockSession', 'focus.howToUnlock', 'focus.wrapUnlock'];
    for (const key of zhKeys) {
      const m = new RegExp('"' + key.replace(/\./g, '\\.') + '":\\s*"([^"]*)"').exec(code);
      if (m === null) { console.error('FAIL: the zh dictionary lost ' + key); process.exit(1); }
    }
    const label = /"focus\.unlockSession":\s*"([^"]*)"/.exec(code)[1];
    if (label !== '立即解锁') {
      console.error('FAIL: the bundle labels the unlock button ' + JSON.stringify(label) + ' — the action is a LOCAL immediate unlock, so that is what it must say');
      process.exit(1);
    }
    console.log('label vs action -> bundle says "立即解锁" and no user-facing string says "请求解锁"');
  }
  for (const label of ['锁定本会话', '立即解锁', '刷新状态']) {
    if (!settingsHtml.includes(label)) { console.error('FAIL: focus-lock button missing its label: ' + label); process.exit(1); }
  }
  // ── 回归守卫（2026-10-16 新增，第 4 条批评）：「刷新状态」只是"重新读一次诊断读数" ⇒ 它是
  //    调试动作，必须住在「调试」区里，不许回到「常用」（和「锁定本会话 / 立即解锁」并排会让
  //    人以为它是第三种锁操作）。断的是**按钮**的位置，不是页面文本：`focus.unknown` 那句
  //    提示里也含「刷新状态」四个字，用 indexOf 找文本会误判。
  {
    let refreshButtonAt = -1;
    let refreshButtonCount = 0;
    for (const m of settingsHtml.matchAll(/<button[^>]*>([^<]*)<\/button>/g)) {
      if (m[1].trim() === '刷新状态') { refreshButtonCount++; if (refreshButtonAt < 0) refreshButtonAt = m.index; }
    }
    const debugTableAt = settingsHtml.indexOf('命令注册状态：');
    if (refreshButtonCount === 0) { console.error('FAIL: the 刷新状态 button must stay reachable (it belongs in the 调试 section)'); process.exit(1); }
    if (refreshButtonCount !== 1) { console.error('FAIL: exactly ONE 刷新状态 button may exist (the old duplicate block shipped a second); found ' + refreshButtonCount); process.exit(1); }
    if (debugTableAt < 0) { console.error('FAIL: the debug block (命令注册状态：) is missing, so the refresh button position cannot be judged'); process.exit(1); }
    if (!(debugTableAt < refreshButtonAt)) {
      console.error('FAIL: 刷新状态 is a diagnostic action; it must live in the 调试 section, NOT in 常用 (debug table=' + debugTableAt + ' refresh button=' + refreshButtonAt + ')');
      process.exit(1);
    }
    console.log('settings refresh -> 刷新状态 is a single button inside the 调试 section (not in 常用)');
  }
  // 2026-10-16：`Switch` 本体就是一个 `<button>`，里面只有一根 thumb `<span>` ⇒ 它天生
  // "没有可见文字"。所以这条检查必须**放过** role="switch" 的按钮，另用一条断言守住它的
  // 无障碍名（`aria-label` 是 Switch 唯一能携带名字的地方 —— 它不渲染 label 文字）。
  for (const m of settingsHtml.matchAll(/<button(?![^>]*role="switch")[^>]*>(.*?)<\/button>/g)) {
    if (m[1].replace(/<[^>]*>/g, '').trim() === '') {
      console.error('FAIL: a settings button renders without text: ' + m[0].slice(0, 120));
      process.exit(1);
    }
  }
  // ── 回归守卫（2026-10-16 新增，第 1 条批评"里面的按钮好丑"）─────────────────────────
  //    设置页的**每一个**按钮都必须由官方 `primitives.Button` 渲染，不许再出现手写的
  //    `<button type="button" style=…>`。两层一起断：
  //      ① 源码层：唯一的次要动作助手 `smallButton` 必须调 `primitives.Button`，且用
  //         官方 `outline / sm` 那一档（app.asar 的 Button.module.css：`.sm` = 28px / 12px /
  //         8px 圆角；`.outline` = 与设置页链接同一条中性描边）。
  //      ② 结构层：桩给官方 `Button` 打 `data-prim="Button"`，所以渲染出来的 HTML 里
  //         除官方 `Switch`（role="switch"）与 `SegmentedControl`（role="tab"）之外的
  //         **每一颗**按钮都必须带这个标记。
  //    ⚠️ 为什么要两层：套件里原来只有"按钮必须有可见文字"这类断言，把 `smallButton` 改回
  //       手写 `<button>` 之后**文字和数量都不变** ⇒ 那种断言是假绿的（实测过）。结构层还
  //       额外守住"以后又有人往设置页塞一颗手写按钮"这一类回归。
  {
    const srcAt = code.indexOf('function smallButton(');
    if (srcAt < 0) { console.error('FAIL: the smallButton helper is gone; the settings secondary actions have no single implementation left to audit'); process.exit(1); }
    const helper = code.slice(srcAt, srcAt + 700);
    if (!/primitives\.Button/.test(helper)) {
      console.error('FAIL: smallButton must render the official primitives.Button, not a hand-written <button>: ' + helper.replace(/\s+/g, ' ').slice(0, 220));
      process.exit(1);
    }
    if (/jsx\)\("button"/.test(helper)) {
      console.error('FAIL: smallButton still hand-rolls a <button> element: ' + helper.replace(/\s+/g, ' ').slice(0, 220));
      process.exit(1);
    }
    if (!/variant:\s*"outline"/.test(helper) || !/size:\s*"sm"/.test(helper)) {
      console.error('FAIL: smallButton must use the official secondary-action family variant="outline" size="sm" (the hand-written look was the complaint): ' + helper.replace(/\s+/g, ' ').slice(0, 220));
      process.exit(1);
    }
    const handRolled = [];
    for (const m of settingsHtml.matchAll(/<button([^>]*)>/g)) {
      const attrs = m[1];
      if (/role="switch"/.test(attrs) || /role="tab"/.test(attrs)) continue;   // 官方 Switch / SegmentedControl
      if (!/data-prim="Button"/.test(attrs)) handRolled.push(m[0].slice(0, 140));
    }
    if (handRolled.length > 0) {
      console.error('FAIL: a settings button is NOT rendered by the official Button primitive (hand-written <button>): ' + handRolled.join(' | '));
      process.exit(1);
    }
    console.log('settings buttons -> every non-switch / non-tab button comes from primitives.Button (0 hand-written); smallButton uses variant="outline" size="sm"');
  }
  // ── 回归守卫（2026-10-16 新增，第 3 条批评"存储位置说的导出在哪"）────────────────────
  //    存储位置那段必须**指路到「笔记」页**，并点名两个真实存在的按钮（名字逐字对得上）。
  //    旧文案"设备间迁移请用页面上的「复制全部 / 导入」"是实话 —— 但那两个按钮在**笔记页**，
  //    用户在设置页上找不到 ⇒ 一句"说的和做的不一样"的话（本机踩过这个坑）。
  //    选了方案 (b)：**不**在设置页复制一份入口。所以这段还断"设置页组件里没有第二份"，
  //    并证明那两颗按钮真的住在 `NotesPage` 里、接的是既有实现（`exportAll` / `setImportOpen`）。
  {
    const storageMatch = /"settings\.storage":\s*"([^"]*)"/.exec(code);
    if (storageMatch === null) { console.error('FAIL: the zh settings.storage note is missing'); process.exit(1); }
    const storageNote = storageMatch[1];
    if (/页面上的/.test(storageNote)) {
      console.error('FAIL: the storage note must not say 页面上的 again (the buttons live on the NOTES page, not on Settings): ' + storageNote);
      process.exit(1);
    }
    for (const token of ['笔记', '复制全部', '导入']) {
      if (storageNote.indexOf(token) === -1) {
        console.error('FAIL: the storage note must point at the 笔记 page and name the real buttons verbatim; missing ' + JSON.stringify(token) + ' in: ' + storageNote);
        process.exit(1);
      }
    }
    const exportLabel = /"notes\.export":\s*"([^"]*)"/.exec(code);
    const importLabel = /"notes\.import":\s*"([^"]*)"/.exec(code);
    if (exportLabel === null || importLabel === null) { console.error('FAIL: notes.export / notes.import are gone; the storage note points at buttons that no longer exist'); process.exit(1); }
    if (storageNote.indexOf(exportLabel[1]) === -1 || storageNote.indexOf(importLabel[1]) === -1) {
      console.error('FAIL: the storage note must quote the button labels verbatim (notes.export=' + JSON.stringify(exportLabel[1]) + ', notes.import=' + JSON.stringify(importLabel[1]) + '), otherwise it points at a button that does not exist: ' + storageNote);
      process.exit(1);
    }
    const notesPageAt = code.indexOf('function NotesPage(');
    const settingsAt = code.indexOf('function HistoryActionsSettings(');
    if (notesPageAt < 0 || settingsAt < 0 || settingsAt < notesPageAt) {
      console.error('FAIL: cannot bracket the NotesPage component body (notesPageAt=' + notesPageAt + ', settingsAt=' + settingsAt + ')');
      process.exit(1);
    }
    const notesPageSrc = code.slice(notesPageAt, settingsAt);
    if (notesPageSrc.indexOf('onClick: exportAll,') === -1) {
      console.error('FAIL: the 复制全部 button must call the EXISTING exportAll() — do not write a second export path');
      process.exit(1);
    }
    if (notesPageSrc.indexOf('children: t("notes.export")') === -1 || notesPageSrc.indexOf('children: t("notes.import")') === -1) {
      console.error('FAIL: the two buttons must render notes.export / notes.import as their visible text, inside NotesPage');
      process.exit(1);
    }
    if (notesPageSrc.indexOf('setImportOpen') === -1) {
      console.error('FAIL: the 导入 button must open the EXISTING import form (setImportOpen), not a second implementation');
      process.exit(1);
    }
    const settingsSrc = code.slice(settingsAt);
    if (settingsSrc.indexOf('notes.export') !== -1 || settingsSrc.indexOf('notes.import') !== -1) {
      console.error('FAIL: option (b) was chosen: the settings page must NOT grow a second copy of the export / import buttons — it points at the Notes page instead');
      process.exit(1);
    }
    console.log('settings storage -> points at the 笔记 page and names 复制全部 / 导入 verbatim; both buttons live in NotesPage and reuse exportAll / setImportOpen');
  }
  // ── 开关行必须是官方 `Switch`（不是裸 `<input type="checkbox">`），且每个都有无障碍名 ──
  {
    // ⚠️ 2026-10-17 第 2 段修定：这条原来是"设置页里一个 type=checkbox 都不许有"。
    //    多工作区列表的**多选**用官方 `Checkbox`（多选语义，Switch 表达不了），所以判据
    //    收窄成它真正想守的东西：**任何裸** `<input type="checkbox">`（没有官方 Checkbox
    //    的 label 外壳）仍然是缺陷。做法：每个 checkbox 往回找最近的 `<label`，那个标签里
    //    必须有 `data-prim="Checkbox"`（桩给官方原语打的标记，同 Button 的 data-prim）。
    const bareAt = [];
    for (const m of settingsHtml.matchAll(/type="checkbox"/g)) {
      const at = m.index;
      const labelAt = settingsHtml.lastIndexOf('<label', at);
      const tag = labelAt < 0 ? '' : settingsHtml.slice(labelAt, settingsHtml.indexOf('>', labelAt) + 1);
      if (!/data-prim="Checkbox"/.test(tag)) bareAt.push(at);
    }
    if (bareAt.length !== 0) {
      console.error('FAIL: the settings page must use the official Switch / Checkbox primitives, not a bare <input type="checkbox">: found ' + bareAt.length + ' bare checkbox(es) at ' + JSON.stringify(bareAt.slice(0, 4)));
      process.exit(1);
    }
    const switches = [...settingsHtml.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
    // 数量从**实现**现算，不手抄：2026-10-16 加了第 8 档功能（终端按钮）之后，
    // 手抄的 "13" 立刻过期，而这条断言的本意是"每一行都在"，不是"恰好 13 行"。
    //   4 行为开关 + 1 总开关 + N 档功能 + 1 调试重发跟踪（N = FEATURE_KEYS 的长度）
    if (FEATURE_COUNT < 1) {
      console.error('FAIL: could not read FEATURE_KEYS from the bundle');
      process.exit(1);
    }
    if (switches.length !== EXPECTED_SWITCHES) {
      console.error('FAIL: expected exactly ' + EXPECTED_SWITCHES + ' Switch rows (5 behaviour + 1 all-features master + ' + FEATURE_COUNT + ' feature masters + the debug resend-trace switch), got ' + switches.length);
      process.exit(1);
    }
    for (const tag of switches) {
      const label = /aria-label="([^"]*)"/.exec(tag);
      if (label === null || label[1].trim() === '') {
        console.error('FAIL: a Switch renders without an aria-label — it renders NO text of its own, so a nameless switch is an unlabelled control: ' + tag.slice(0, 120));
        process.exit(1);
      }
    }
    console.log('settings switches -> ' + EXPECTED_SWITCHES + ' official Switch rows (0 bare checkboxes), every one carries an aria-label');
  }
  // ── 五 tab 骨架（2026-10-16 四 tab 改版；2026-10-17 加了第 5 个 tab）。
  //    断的是**真属性**，不是文本：
  //    ① 恰好 5 个 `role="tab"`，名字与顺序 = 基础 / 专注锁 / 笔记 / 会话操作 / 命令按钮
  //       （第 5 个 tab 2026-10-17 由「终端」改名「命令按钮」—— 见 verify_tab_names.mjs）；
  //    ② 每个 tab 的 `aria-controls` 必须**严格等于** `${id}-${value}-panel`（组件自己就是这么
  //       拼的，所以面板那一侧必须用同一个 SETTINGS_TAB_ID 拼 —— 两侧各写一遍字符串必漂）；
  //    ③ 那个面板必须存在、`role="tabpanel"`、`aria-labelledby` 指回 tab 的 id；
  //    ④ 面板用 `hidden` **保活**：5 个面板永远都在 DOM 里，只有 default 那个不带 hidden。
  {
    const tabs = [...settingsHtml.matchAll(/<button([^>]*role="tab"[^>]*)>([^<]*)<\/button>/g)];
    if (tabs.length !== 5) {
      console.error('FAIL: the settings page must render exactly 5 tabs (基础 / 专注锁 / 笔记 / 会话操作 / 命令按钮), got ' + tabs.length + ': ' + settingsHtml.slice(0, 300));
      process.exit(1);
    }
    const wantNames = ['基础', '专注锁', '笔记', '会话操作', '命令按钮'];
    const gotNames = tabs.map((m) => m[2].trim());
    if (gotNames.join('|') !== wantNames.join('|')) {
      console.error('FAIL: the tab names / order must be exactly ' + wantNames.join(' / ') + ', got ' + gotNames.join(' / '));
      process.exit(1);
    }
    // ⚠️ tab 的 **value** 也必须跟着改名：`aria-controls` / 面板 id / `settingsPanel(value)`
    //    三处共用同一个 value。旧值 `content` 若残留（哪怕只在一处），下面那条
    //    `aria-controls === id + '-panel'` 仍会绿（两侧都旧）—— 所以额外钉死新值。
    //    2026-10-17 新增第 5 个 value `terminal`，同样钉死（顺序也钉：它必须在 actions 之后）。
    const wantValues = ['basic', 'focus', 'notes', 'actions', 'terminal'];
    for (let i = 0; i < tabs.length; i++) {
      if (!new RegExp('id="deepworker-settings-tabs-' + wantValues[i] + '"').test(tabs[i][1])) {
        console.error('FAIL: tab ' + i + ' (' + gotNames[i] + ') must carry the value ' + JSON.stringify(wantValues[i]) + ': ' + tabs[i][0]);
        process.exit(1);
      }
    }
    if (/deepworker-settings-tabs-content/.test(settingsHtml)) {
      console.error('FAIL: the old tab value content is still in the DOM — the tab was renamed to notes and every derived id must follow');
      process.exit(1);
    }
    let hiddenCount = 0;
    for (let i = 0; i < tabs.length; i++) {
      const attrs = tabs[i][1];
      const id = /id="([^"]*)"/.exec(attrs);
      const controls = /aria-controls="([^"]*)"/.exec(attrs);
      const selected = /aria-selected="true"/.test(attrs);
      if (id === null || controls === null) { console.error('FAIL: a tab is missing id / aria-controls: ' + tabs[i][0]); process.exit(1); }
      if (controls[1] !== id[1] + '-panel') {
        console.error('FAIL: the tab ' + JSON.stringify(gotNames[i]) + ' has id=' + id[1] + ' but aria-controls=' + controls[1] + '; the panel id must be exactly `${id}-${value}-panel`');
        process.exit(1);
      }
      const at = settingsHtml.indexOf('id="' + controls[1] + '"');
      if (at < 0) { console.error('FAIL: the tab ' + JSON.stringify(gotNames[i]) + ' points at ' + controls[1] + ' but no such panel is in the DOM (panels must stay mounted)'); process.exit(1); }
      const open = settingsHtml.lastIndexOf('<div', at);
      const tag = settingsHtml.slice(open, settingsHtml.indexOf('>', open) + 1);
      if (!/role="tabpanel"/.test(tag)) { console.error('FAIL: the element ' + controls[1] + ' is not role="tabpanel": ' + tag.slice(0, 120)); process.exit(1); }
      if (!new RegExp('aria-labelledby="' + id[1] + '"').test(tag)) { console.error('FAIL: the panel ' + controls[1] + ' must be labelled by its tab ' + id[1] + ': ' + tag.slice(0, 160)); process.exit(1); }
      const hidden = /\bhidden\b/.test(tag);
      if (hidden !== !selected) {
        console.error('FAIL: the panel ' + controls[1] + ' must be hidden exactly when its tab is not selected (selected=' + selected + ', hidden=' + hidden + ')');
        process.exit(1);
      }
      if (hidden) hiddenCount++;
    }
    if (hiddenCount !== 4) { console.error('FAIL: exactly 4 of the 5 panels must be hidden (the default tab 基础 is the visible one), got ' + hiddenCount); process.exit(1); }
    console.log('settings tabs -> 5 tabs 基础/专注锁/笔记/会话操作/命令按钮 (values basic/focus/notes/actions/terminal); every aria-controls matches `${id}-${value}-panel`, every panel is role="tabpanel" + aria-labelledby, 4 of 5 hidden (keep-alive)');
  }
  // ── 「基础」的排版：功能引入/移除是**视觉主体**（7 档全在它里面），通知 / 折叠调试在它下面。
  //    ⚠️ 2026-10-16 二次分组：「存储位置」**搬走了**（基础 → 笔记），所以这一页只剩三块。
  //    这条断言因此改成 功能引入/移除 -> 通知 -> 折叠调试，并**额外**要求存储位置不在这一页
  //    （否则"搬走"可以退化成"两边都留一份"）。搬家的正向定位见下面那条专门的分组断言。
  {
    const bodyAt = settingsHtml.indexOf('功能引入 / 移除');
    if (bodyAt < 0) { console.error('FAIL: the 基础 tab must carry the 功能引入 / 移除 section (the visual body of that page)'); process.exit(1); }
    const noticeAt = settingsHtml.indexOf('通知哪些会话');
    const debugAt = settingsHtml.indexOf('>调试</summary>');
    if (noticeAt < 0 || debugAt < 0) {
      console.error('FAIL: 基础 must also carry 通知 + the collapsed 调试 block; notice=' + noticeAt + ' debug=' + debugAt);
      process.exit(1);
    }
    if (!(bodyAt < noticeAt && noticeAt < debugAt)) {
      console.error('FAIL: the 基础 order must be 功能引入/移除 -> 通知 -> 调试; body=' + bodyAt + ' notice=' + noticeAt + ' debug=' + debugAt);
      process.exit(1);
    }
    const basicPanelStart = settingsHtml.indexOf('id="deepworker-settings-tabs-basic-panel"');
    const basicPanelEnd = settingsHtml.indexOf('id="deepworker-settings-tabs-focus-panel"');
    const storageInBasic = settingsHtml.indexOf('笔记存储位置', basicPanelStart);
    if (!(basicPanelStart >= 0 && basicPanelEnd > basicPanelStart)) {
      console.error('FAIL: cannot bracket the 基础 panel (basic=' + basicPanelStart + ' focus=' + basicPanelEnd + ')');
      process.exit(1);
    }
    if (storageInBasic >= 0 && storageInBasic < basicPanelEnd) {
      console.error('FAIL: 「存储位置」must NOT stay on 基础 any more — it moved to the 笔记 tab (a move that leaves a copy behind is not a move): basic panel [' + basicPanelStart + ',' + basicPanelEnd + '), storage at ' + storageInBasic);
      process.exit(1);
    }
    console.log('settings layout -> 基础 = 功能引入/移除 (body) -> 通知 -> 折叠调试; 存储位置 is no longer on this page');
  }
  // ── 三处搬家（2026-10-16 二次分组）按**面板边界 + 小节边界**逐条钉住 ────────────────────
  //    为什么不能只断"这串字在页面上出现过"：搬家的**前**与**后**它都出现过 ⇒ 那是空断言，
  //    把开关搬回原位（或搬一半、留两份）照样绿。所以每一条都断"它落在哪个面板、哪个小节"。
  //    四个面板用 `hidden` 保活、DOM 顺序 = tab 顺序，所以用面板 id 切片即可。
  {
    const PANEL = 'id="deepworker-settings-tabs-';
    const basicPanelAt = settingsHtml.indexOf(PANEL + 'basic-panel"');
    const focusPanelAt = settingsHtml.indexOf(PANEL + 'focus-panel"');
    const notesPanelAt = settingsHtml.indexOf(PANEL + 'notes-panel"');
    const actionsPanelAt = settingsHtml.indexOf(PANEL + 'actions-panel"');
    if (!(basicPanelAt >= 0 && focusPanelAt > basicPanelAt && notesPanelAt > focusPanelAt && actionsPanelAt > notesPanelAt)) {
      console.error('FAIL: the four panels must sit in the DOM in tab order (basic -> focus -> notes -> actions): basic=' + basicPanelAt + ' focus=' + focusPanelAt + ' notes=' + notesPanelAt + ' actions=' + actionsPanelAt);
      process.exit(1);
    }
    // ① 「引用回复」：属于**会话操作**，且住在那一页的「引用」小节里。
    const quoteHeadingAt = settingsHtml.indexOf('引用', actionsPanelAt);
    const quoteRowAt = settingsHtml.indexOf('引用时写入出处行', actionsPanelAt);
    if (quoteHeadingAt < 0 || quoteRowAt < 0 || quoteRowAt < quoteHeadingAt) {
      console.error('FAIL: 「引用回复」must live in the 会话操作 panel, inside its 「引用」 section: actions=' + actionsPanelAt + ' heading=' + quoteHeadingAt + ' row=' + quoteRowAt);
      process.exit(1);
    }
    if (settingsHtml.indexOf('引用时写入出处行', 0) < actionsPanelAt) {
      console.error('FAIL: 「引用回复」also renders BEFORE the 会话操作 panel — it must belong to 会话操作 only (not 笔记)');
      process.exit(1);
    }
    // ② 「编辑重发/重试时默认归档原对话」：属于**轮次操作 小节**（在「轮次操作」标题之后、
    //    「引用」标题之前）。这正是被指出的错位：它原来挂在「引用」小标题底下。
    const turnHeadingAt = settingsHtml.indexOf('轮次操作', actionsPanelAt);
    const archiveAt = settingsHtml.indexOf('默认归档原对话', actionsPanelAt);
    if (turnHeadingAt < 0 || archiveAt < 0 || !(turnHeadingAt < archiveAt && archiveAt < quoteHeadingAt)) {
      console.error('FAIL: 「编辑重发/重试时默认归档原对话」must sit INSIDE the 轮次操作 section (轮次操作 heading < this row < 引用 heading): turn=' + turnHeadingAt + ' archive=' + archiveAt + ' quote=' + quoteHeadingAt);
      process.exit(1);
    }
    // ③ 「存储位置」：属于**笔记**面板（在 notes 与 actions 之间），且全页**恰好一份**。
    const storageAt = settingsHtml.indexOf('笔记存储位置', 0);
    if (storageAt < 0) { console.error('FAIL: the storage note (笔记存储位置…) is missing from the page entirely'); process.exit(1); }
    if (!(storageAt > notesPanelAt && storageAt < actionsPanelAt)) {
      console.error('FAIL: 「存储位置」must live in the 笔记 panel: notes=' + notesPanelAt + ' actions=' + actionsPanelAt + ' storage=' + storageAt);
      process.exit(1);
    }
    const storageCount = settingsHtml.split('笔记存储位置').length - 1;
    if (storageCount !== 1) {
      console.error('FAIL: the storage note must appear exactly ONCE (it MOVED to 笔记, it was not copied): found ' + storageCount);
      process.exit(1);
    }
    // ④ 「会话内查找」：属于**会话操作**（它本来就在这儿；这条钉住"没人顺手把它挪走"）。
    const findHeadingAt = settingsHtml.indexOf('会话内查找', actionsPanelAt);
    if (findHeadingAt < 0 || findHeadingAt < quoteRowAt) {
      console.error('FAIL: 「会话内查找」must live in the 会话操作 panel, after the 引用 section: find=' + findHeadingAt + ' quote row=' + quoteRowAt);
      process.exit(1);
    }
    // ⑤ 命令按钮的配置：2026-10-17 有了自己的 tab（用户原话"启动按钮没有单独的tab页吗"）
    //    ⇒ 它必须在**命令按钮**那个面板里，且**不在**「会话操作」面板里（搬一半、留两份都要红）。
    //
    //    ⚠️ 2026-10-17 第 2 段（多工作区）：判据标记从 `term.timeoutLabel` 换成
    //    `term.batchTitle` + `term.wsHint`。原因是**真的变了**：编辑器现在只在"有选中的
    //    工作区"时渲染（没有工作区时页面显示的是空列表 + 添加框），而本套件的 localStorage
    //    桩是空的 ⇒ 超时那一行不可能出现。拿它当"编辑器在不在"的判据会变成假红。
    //    两个新标记都**常驻**在这一页，且都不出现在别的面板里。
    //    （"编辑器真的渲染出来了"由 verify_workspaces.mjs 用**有工作区的存储**单独验。）
    {
      const terminalPanelAt = settingsHtml.indexOf(PANEL + 'terminal-panel"');
      if (terminalPanelAt < 0) { console.error('FAIL: the 终端（命令按钮）tabpanel is missing from the render'); process.exit(1); }
      const actionsAt = settingsHtml.indexOf(PANEL + 'actions-panel"');
      const markers = [dict['term.batchTitle'], dict['term.wsHint']];
      for (const marker of markers) {
        const markerAts = [];
        for (let at = settingsHtml.indexOf(marker); at >= 0; at = settingsHtml.indexOf(marker, at + 1)) markerAts.push(at);
        if (markerAts.length === 0) {
          console.error('FAIL: the command-button config editor is missing entirely (no 「' + marker + '」 on the page)');
          process.exit(1);
        }
        const stray = markerAts.filter((at) => at < terminalPanelAt);
        if (stray.length > 0) {
          console.error('FAIL: the command-button editor must live in its own tab panel, but ' + stray.length + ' occurrence(s) of 「' + marker + '」 render BEFORE it (panel at ' + terminalPanelAt + ', first stray at ' + stray[0] + ')');
          process.exit(1);
        }
        // 「会话操作」面板里不许再有它（用面板切片，避免"顺序恰好"这种弱判据）。
        const actionsSlice = settingsHtml.slice(actionsAt, terminalPanelAt);
        if (actionsAt >= 0 && actionsSlice.indexOf(marker) !== -1) {
          console.error('FAIL: the 会话操作 panel still contains the command-button editor — it must be搬出去');
          process.exit(1);
        }
      }
    }
    console.log('settings regroup -> 引用回复 + 会话内查找 in 会话操作, 归档原对话 inside the 轮次操作 section (not under 引用), 存储位置 only in 笔记, 命令按钮配置 only in its own tab (moved out of 会话操作)');
  }
  // ── 搬家的**另一半**：`FEATURE_META[key].tab` 必须与 `featureSection(key, …)` 真正所在的
  //    面板一致；且"一个 tab 装多档 ⇒ 每档都要有自己的小节"这条约定必须成立。 ─────────────
  //    为什么必须机器对账：JSX 搬了、`FEATURE_META.tab` 没搬（或反过来）**不会崩**，但会错在
  //    两处 —— 面板级灰态（`tabAllOff` 用 meta.tab）与小节级灰态（`featureSection` 用 JSX
  //    位置）会对不上：一档明明还开着，它所在的面板却整块灰了。两边都是手写的，只能对账。
  {
    const metaAt = code.indexOf('var FEATURE_META = {');
    const metaEnd = metaAt < 0 ? -1 : code.indexOf('\n    };', metaAt);
    if (metaAt < 0 || metaEnd < 0) { console.error('FAIL: cannot locate the FEATURE_META literal in the bundle'); process.exit(1); }
    const metaSrc = code.slice(metaAt, metaEnd);
    const metaTab = {};
    for (const m of metaSrc.matchAll(/(\w+):\s*\{[^}]*tab:\s*"([^"]+)"/g)) metaTab[m[1]] = m[2];
    // 同样从实现现算：档数增长时这条断言的本意是"每一档都声明了 tab 且与 FEATURE_KEYS
    // 一一对应"，不是"恰好 7 档"。手抄 7 会在加档当天过期（2026-10-16 加第 8 档即如此）。
    const keyList = ((code.match(/var FEATURE_KEYS = \[([^\]]*)\]/) || [, ''])[1].match(/"([^"]+)"/g) || []).map((x) => x.slice(1, -1));
    if (Object.keys(metaTab).length !== keyList.length) {
      console.error('FAIL: FEATURE_META must declare one tab per FEATURE_KEY (' + keyList.length + '); parsed ' + Object.keys(metaTab).length + ': ' + JSON.stringify(metaTab));
      process.exit(1);
    }
    const missingMeta = keyList.filter((k) => metaTab[k] === undefined);
    if (missingMeta.length > 0) {
      console.error('FAIL: these FEATURE_KEYS have no FEATURE_META tab: ' + JSON.stringify(missingMeta));
      process.exit(1);
    }
    // 面板边界 = 每个 `settingsPanel("<value>",` 到下一个之间。注释里的同名文本不算调用点。
    const isLineComment = (idx) => code.slice(code.lastIndexOf('\n', idx) + 1, idx).indexOf('//') !== -1;
    const panels = [...code.matchAll(/settingsPanel\("([a-z]+)",/g)]
      .filter((m) => !isLineComment(m.index))
      .map((m) => ({ value: m[1], at: m.index }));
    if (panels.length !== 5) {
      console.error('FAIL: expected exactly 5 settingsPanel(value, …) calls, got ' + panels.length + ': ' + JSON.stringify(panels.map((p) => p.value)));
      process.exit(1);
    }
    // 面板的 **value 与顺序**也要钉住（只断个数的话，把 terminal 面板插到 basic 前也绿）。
    const wantPanelValues = ['basic', 'focus', 'notes', 'actions', 'terminal'];
    if (panels.map((p) => p.value).join('|') !== wantPanelValues.join('|')) {
      console.error('FAIL: the five settingsPanel values must be ' + wantPanelValues.join(' / ') + ' in that order (the tab order), got ' + panels.map((p) => p.value).join(' / '));
      process.exit(1);
    }
    const placed = {};
    for (let i = 0; i < panels.length; i++) {
      const from = panels[i].at;
      const to = i + 1 < panels.length ? panels[i + 1].at : code.length;
      const region = code.slice(from, to);
      for (const m of region.matchAll(/featureSection\("(\w+)",/g)) {
        if (placed[m[1]] !== undefined) {
          console.error('FAIL: ' + m[1] + ' is rendered by TWO featureSections (' + placed[m[1]] + ' and ' + panels[i].value + ') — one feature cannot be greyed by two different sections');
          process.exit(1);
        }
        placed[m[1]] = panels[i].value;
      }
    }
    // 「哪些档位的**开关**住在别的 tab」——从 bundle 的 `SWITCH_HOME` 现读。
    // ⚠️ 不许在夹具里手抄这份清单：手抄副本会和实现漂，而漂了之后"开关到底在哪一页"
    //    这条断言就再也红不了（它比的是一个早已过期的常量）。
    const switchHome = {};
    {
      const at = code.indexOf('var SWITCH_HOME = {');
      const end = at < 0 ? -1 : code.indexOf('};', at);
      if (at < 0 || end < 0) {
        console.error('FAIL: the bundle must declare `var SWITCH_HOME = { … }` — it is the ONE record of which feature switches live outside the 基础 page');
        process.exit(1);
      }
      for (const m of code.slice(at, end).matchAll(/(\w+):\s*"([a-z]+)"/g)) switchHome[m[1]] = m[2];
    }
    const keysOfTab = {};
    for (const key of Object.keys(metaTab)) keysOfTab[metaTab[key]] = (keysOfTab[metaTab[key]] || 0) + 1;
    for (const key of Object.keys(metaTab)) {
      if (placed[key] !== undefined && placed[key] !== metaTab[key]) {
        console.error('FAIL: ' + key + ' says tab="' + metaTab[key] + '" in FEATURE_META but its featureSection lives in the "' + placed[key] + '" panel — the whole-panel grey state and the per-section grey state would disagree');
        process.exit(1);
      }
      // 一个 tab 装**多档**时，每一档要么有自己的小节（按小节灰 + 指路），要么它的**开关**
      // 就住在这一页（`SWITCH_HOME`）—— 后者由渲染级的锁死守卫保证"点得到"。
      // ⚠️ 2026-10-17：「摘要」那一档刻意**不用** featureSection 包 —— 那一层在未引入时套
      //    `pointerEvents:none`，会把它自己的开关冻住 ⇒ 只剩"一键全开"能救。所以约定从
      //    "必须有小节"改成"必须有小节**或**开关就在这一页"，两条都能保证"灰态语义不丢"。
      if (keysOfTab[metaTab[key]] > 1 && placed[key] !== metaTab[key] && switchHome[key] !== metaTab[key]) {
        console.error('FAIL: the "' + metaTab[key] + '" tab carries ' + keysOfTab[metaTab[key]] + ' features, so ' + key + ' must be rendered by its OWN featureSection inside that panel (per-section grey + 指路), or its switch must live there (SWITCH_HOME); it is ' + (placed[key] === undefined ? 'not inside any featureSection and not in SWITCH_HOME' : 'inside the "' + placed[key] + '" panel'));
        process.exit(1);
      }
      // ⚠️ 这里**不**要求"每一档都有 featureSection 或 SWITCH_HOME"：多数档位从来就没有
      //    自己的小节（专注锁 / 通知 / 笔记的说明是普通 sectionHeading）。"每一档都有开关"
      //    由**渲染级**断言保证（下面的 8 颗 Switch + 逐档可点），比源码级更硬。
    }
    // SWITCH_HOME 不许指向一个不存在/拼错的 tab（否则"搬家"只是搬进虚空）。
    const PANEL_VALUES = panels.map((p) => p.value);
    for (const key of Object.keys(switchHome)) {
      if (PANEL_VALUES.indexOf(switchHome[key]) === -1) {
        console.error('FAIL: SWITCH_HOME.' + key + ' = "' + switchHome[key] + '" is not one of the settings panels ' + JSON.stringify(PANEL_VALUES));
        process.exit(1);
      }
      if (metaTab[key] === undefined) {
        console.error('FAIL: SWITCH_HOME names ' + key + ', which is not a FEATURE_KEY (' + JSON.stringify(Object.keys(metaTab)) + ')');
        process.exit(1);
      }
    }
    console.log('settings regroup -> FEATURE_META.tab agrees with the panel each featureSection lives in (' + Object.keys(metaTab).map((k) => k.replace('feature', '') + '=' + metaTab[k]).join(' ') + '); multi-feature tabs grey per section or keep the switch there (SWITCH_HOME=' + JSON.stringify(switchHome) + ')');
  }
  // ── 顶部固定条：构建标记与「重新加载界面」必须在**第一屏**、且在分区内容之前。
  //    这是本机迭代协议"先看构建标记" + 桌面 App 唯一重载手段（无 Cmd+R）的结构保证。
  //    2026-10-16 改版后：它们住在**默认 tab「基础」**的顶部（第一个面板），所以 DOM 顺序
  //    仍在全部内容之前 —— 这条断言就是钉住"默认进来就能看到"。
  {
    // 期望值从源码读，而不是在页面文本里找一个时间戳形状 —— 后者会把任何时间戳当构建标记。
    // ⚠️ 这不是放宽：断的是 lib/client.js 里 `var BUILD` 的**精确值**出现在页面上。
    const buildMatch = /var BUILD = "([^"]+)"/.exec(code);
    if (buildMatch === null) { console.error('FAIL: lib/client.js has no `var BUILD = "…"` marker to compare against'); process.exit(1); }
    const BUILD_VALUE = buildMatch[1];
    const buildAt = settingsHtml.indexOf(BUILD_VALUE);
    if (buildAt < 0) { console.error('FAIL: settings must show the build tag (' + BUILD_VALUE + ')'); process.exit(1); }
    // The top bar no longer has a reload button: it is a static Cmd+Q hint plus
    // the build marker. Assert both are above the section content, and that no
    // button claims to reload.
    const hintText = dict['settings.reloadHint'];
    const hintAt = settingsHtml.indexOf(hintText);
    if (hintAt < 0) { console.error('FAIL: the Cmd+Q reload hint is missing from the top bar'); process.exit(1); }
    const reloadButtons = [...settingsHtml.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].filter((m) => m[1].trim() === '如何重载插件');
    if (reloadButtons.length !== 0) { console.error('FAIL: a dead reload button is back in the settings page'); process.exit(1); }
    const featureAt = settingsHtml.indexOf('命令注册状态：');
    const focusAt = settingsHtml.indexOf('会话内查找');
    if (featureAt < 0) { console.error('FAIL: the debug command table (命令注册状态：) is missing, so "below the top bar" cannot be judged'); process.exit(1); }
    if (focusAt < 0) { console.error('FAIL: the feature list (会话内查找) is missing'); process.exit(1); }
    if (!(Math.max(buildAt, hintAt) < featureAt && Math.max(buildAt, hintAt) < focusAt)) {
      console.error('FAIL: the build tag + Cmd+Q hint must be ABOVE the section content; build=' + buildAt + ' hint=' + hintAt + ' sectionsEnd=' + featureAt + ' featureList=' + focusAt);
      process.exit(1);
    }
    console.log('settings layout -> top bar (build + Cmd+Q hint, same group) first, inside the default 基础 tab');
  }
  // ── 「调试」折叠区：**恰好一个**，且默认收起（它是诊断读数，不是主内容）──────────────
  // 2026-10-16 加固（第 2 段）：`settings.section.debug` 与 `focus.debug` 的中文**都是「调试」**，
  //    所以"随便找一个 summary 是「调试」且没有 open 的 `<details>`"会被**内层**那个满足 ——
  //    把外层 section 的默认态改成展开也不会红（变异 ⑩ 实测踩到）。
  //    ⇒ 当时改成枚举**每一个** summary 为「调试」的折叠区，逐个要求没有 `open`。
  // 2026-10-16 合并（第 2 条批评"怎么有两个调试，有啥区别"）：内层那层折叠已经并进外层，
  //    整页**只有一个**「调试」。所以断言再升级一档：**恰好一个**，且：
  //      ① 它默认收起；
  //      ② 它的折叠体里**真的**含有原来内层那几件东西（合并只能搬内容，不能连内容一起删 ——
  //         只断"都不许 open"会被"把内层删掉、顺便把 刷新状态 / 自检 / 诊断跟踪 也丢了"骗过）。
  {
    const folds = settingsHtml.split('<details').slice(1).map((chunk) => {
      const gt = chunk.indexOf('>');
      const openTag = '<details' + chunk.slice(0, gt + 1);
      const after = chunk.slice(gt + 1);
      const close = after.indexOf('</details>');
      const body = close < 0 ? after : after.slice(0, close);
      const summary = /<summary[^>]*>([^<]*)<\/summary>/.exec(body);
      return { openTag, summary: summary === null ? null : summary[1].trim(), body };
    });
    const debugFolds = folds.filter((f) => f.summary === '调试');
    if (debugFolds.length !== 1) {
      console.error('FAIL: the settings page must carry EXACTLY ONE 调试 <details> fold — the inner focus.debug fold was merged into the outer settings.section.debug one, because two folds both named 调试 read as two different things; found ' + debugFolds.length);
      process.exit(1);
    }
    const debugFold = debugFolds[0];
    if (/\bopen\b/.test(debugFold.openTag)) {
      console.error('FAIL: the 调试 section must be default-collapsed; found an open fold: ' + debugFold.openTag.slice(0, 120));
      process.exit(1);
    }
    for (const marker of ['命令注册状态：', '刷新状态', '把自检发给我', '编辑重发时输出诊断跟踪', '核心探针：']) {
      if (debugFold.body.indexOf(marker) === -1) {
        console.error('FAIL: the merged 调试 fold lost its content: ' + JSON.stringify(marker) + ' is not inside the single 调试 fold — a merge that drops the inner items is not a merge');
        process.exit(1);
      }
    }
    console.log('settings fold -> exactly one 调试 fold, default-collapsed, carrying both the outer readouts and the merged inner diagnostics');
  }
  // (count first: a missing switch is a count change AND a name change; the count reads clearer)
  // ⚠️ 2026-10-16 四 tab 改版：控件从裸 `<input type="checkbox">` 换成官方 `Switch`
  //    （`<button role="switch">`）。算式不变：
  //      13 = 4 behaviour (quoteProvenance / retryNote / archiveOriginal / focusNativeNotice)
  //         + 1 「全部功能」总开关（2026-10-16 第 4 轮新增）
  //         + 7 feature masters + 1 debug resend-trace。
  //    （上一条 switch 断言已经断过 13 + 0 裸 checkbox，这里重复一次是为了让"改版把开关
  //    丢掉一个"的报错落在同一个显眼位置。）
  // 同一条算式，但从实现现算档数（见上面 EXPECTED_SWITCHES 的注释）。
  if ((settingsHtml.match(/role="switch"/g) || []).length !== EXPECTED_SWITCHES) { console.error('FAIL: expected exactly ' + EXPECTED_SWITCHES + ' switches (4 behaviour + 1 all-features master + ' + FEATURE_COUNT + ' feature masters + the debug resend-trace switch), got ' + (settingsHtml.match(/role="switch"/g) || []).length, settingsHtml.slice(0, 400)); process.exit(1); }
  // ── 功能引入/移除：7 档全在，默认全部**已引入**，汇总读数说"全部功能都已引入"。 ──
  {
    const want = ['专注锁', '通知与气泡', '会话内查找', '引用', '摘要', '笔记', '轮次操作'];
    for (const name of want) {
      if (!settingsHtml.includes(name)) { console.error('FAIL: the feature switch list must name ' + name); process.exit(1); }
    }
    // 默认全引入 ⇒ 基础页读到「全部功能都已引入」，且页面里**一个「未引入」都不该有**。
    if (!settingsHtml.includes('全部功能都已引入')) {
      console.error('FAIL: with every feature introduced by default the summary must say 全部功能都已引入: ' + settingsHtml.slice(0, 600));
      process.exit(1);
    }
    // ⚠️ 2026-10-16 锁死修复时同步换锚点：旧锚点是 `未引入 · `（"前缀 + ' · ' + 正文"的旧
    //    拼接形状），而那个形状正是这次修掉的重复文案缺陷 —— 修掉之后旧锚点在**任何**渲染里
    //    都不再命中 ⇒ 这条断言会退化成**永远绿的空操作**（失配比没有更糟）。
    //    换成"整页不含 `未引入`"：形状无关，且比原来更强（默认态本来就不该出现这个词）。
    if (settingsHtml.includes('未引入')) {
      console.error('FAIL: no feature may read as not-introduced by default (defaults are all true): ' + settingsHtml.slice(0, 600));
      process.exit(1);
    }
    // ── 2026-10-17：「摘要」的开关**搬进「笔记」页**（用户原话："摘要是笔记用的功能，开关可以挪进来"）
    //    这条按**面板边界**断，不是"页面上有 摘要 两个字"：搬家前后它都在页面上出现过，
    //    所以只断存在性等于空断言（搬回基础、或两边各留一份，都会绿）。三个数一起断：
    //      ① 「基础」面板里的功能开关数 = FEATURE_COUNT - 1（8 -> 7），且**不含**摘要；
    //      ② 「笔记」面板里的功能开关数 = 1（0 -> 1），且**就是**摘要；
    //      ③ 整页功能开关总数不变（= FEATURE_COUNT）—— "搬家"不是"删掉"。
    const PANEL_TAG = 'id="deepworker-settings-tabs-';
    const slicePanel = (value) => {
      const at = settingsHtml.indexOf(PANEL_TAG + value + '-panel"');
      if (at < 0) { console.error('FAIL: the ' + value + ' tabpanel is missing from the render'); process.exit(1); }
      // 面板按 tab 顺序排，所以"下一个面板的 id"就是它的右边界（最后一个到 HTML 末尾）。
      const order = ['basic', 'focus', 'notes', 'actions', 'terminal'];
      const next = order[order.indexOf(value) + 1];
      const to = next === undefined ? settingsHtml.length : settingsHtml.indexOf(PANEL_TAG + next + '-panel"');
      if (to <= at) { console.error('FAIL: cannot bracket the ' + value + ' panel (at=' + at + ', next=' + to + ')'); process.exit(1); }
      return settingsHtml.slice(at, to);
    };
    // 功能开关的可见名**全部**从 FEATURE_META 现读（含终端那一档：它的名字键是
    // `term.featureName` 而不是 `feature.nameTerminal` —— 手抄清单会漏掉它，
    // 于是"基础页 7 颗"会以"got 6"假红）。
    const metaNameLabels = [];
    {
      const metaAt2 = code.indexOf('var FEATURE_META = {');
      const metaEnd2 = metaAt2 < 0 ? -1 : code.indexOf('\n    };', metaAt2);
      if (metaAt2 < 0 || metaEnd2 < 0) { console.error('FAIL: cannot locate FEATURE_META in the bundle'); process.exit(1); }
      for (const m of code.slice(metaAt2, metaEnd2).matchAll(/name:\s*"([\w.]+)"/g)) {
        if (dict[m[1]] === undefined) { console.error('FAIL: FEATURE_META name key ' + m[1] + ' has no entry in the render fixture'); process.exit(1); }
        metaNameLabels.push(dict[m[1]]);
      }
    }
    const featureSwitchLabels = (html) => switches(html)
      .map((x) => x.label)
      .filter((label) => metaNameLabels.indexOf(label) !== -1);
    const digestName = dict['feature.nameDigest'];
    const basicLabels = featureSwitchLabels(slicePanel('basic'));
    const notesLabels = featureSwitchLabels(slicePanel('notes'));
    if (basicLabels.length !== FEATURE_COUNT - 1) {
      console.error('FAIL: the 基础 panel must list ' + (FEATURE_COUNT - 1) + ' feature switches (摘要 moved to the 笔记 tab), got ' + basicLabels.length + ': ' + JSON.stringify(basicLabels));
      process.exit(1);
    }
    if (basicLabels.indexOf(digestName) !== -1) {
      console.error('FAIL: the ' + digestName + ' switch must NOT stay on the 基础 page any more — it moved to the 笔记 tab (a move that leaves a copy behind is not a move)');
      process.exit(1);
    }
    if (notesLabels.length !== 1 || notesLabels[0] !== digestName) {
      console.error('FAIL: the 笔记 panel must carry EXACTLY ONE feature switch and it must be ' + digestName + ', got ' + JSON.stringify(notesLabels));
      process.exit(1);
    }
    const allFeatureLabels = featureSwitchLabels(settingsHtml);
    if (allFeatureLabels.length !== FEATURE_COUNT) {
      console.error('FAIL: the page must still carry all ' + FEATURE_COUNT + ' feature switches in total (moving 摘要 is not deleting it), got ' + allFeatureLabels.length + ': ' + JSON.stringify(allFeatureLabels));
      process.exit(1);
    }
    console.log('settings features -> ' + (FEATURE_COUNT - 1) + ' feature switches on 基础 + exactly 1 on 笔记 (' + digestName + ') = ' + FEATURE_COUNT + ' in total; all introduced by default, summary says 全部功能都已引入');
  }
  // ── 总开关「全部功能（一键全开 / 全关）」（2026-10-16 第 4 轮）──────────────────────────
  //    断的是**结构**（位置 / aria-checked / 三句灰字分别出现在哪种状态），不是"页面上有这
  //    个字"。三档状态各渲染一次：
  //      全开   ⇒ checked + masterDescOn（"关掉它 = 7 档全部移除…"）
  //      混合态 ⇒ **显示为关** + masterDescPartial（"现在只引入了 4/7 档"）—— 不做三态组件
  //      全关   ⇒ 仍显示为关 + masterDescOff（"打开它 = 7 档全部引入"）
  //    位置：必须在**卡片标题之后、第一个功能开关之前**（"卡片顶部"）。
  {
    const masterLabel = dict['settings.masterSwitch'];
    const firstFeatureLabel = dict['feature.nameFocusLock'];
    const cardTitle = dict['feature.section'];
    const findMaster = (html) => switches(html).find((x) => x.label === masterLabel);
    const renderWith = (combo) => {
      const saved = sandbox.localStorage.getItem;
      sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes'
        ? seededNotes
        : (key === 'dsh.deepworker.settings' ? JSON.stringify(combo) : null));
      try { return renderToStaticMarkup(React.createElement(settingsComponent, { t: ti })); }
      finally { sandbox.localStorage.getItem = saved; }
    };
    // ① 默认（7 档全开）
    const master = findMaster(settingsHtml);
    if (master === undefined) {
      console.error('FAIL: the master 「' + masterLabel + '」 switch is missing from the 基础 page');
      process.exit(1);
    }
    if (!/aria-checked="true"/.test(master.openTag)) {
      console.error('FAIL: with all 7 features introduced the master switch must read as ON: ' + master.openTag);
      process.exit(1);
    }
    // 文案里带 {total}（档数从实现现算）⇒ 夹具里的 `{total}` 必须先按 FEATURE_COUNT 插值，
    // 否则比的是一句**永远不会出现在页面上**的模板（加档当天就会假红）。
    const sayTotal = (text) => text.split('{total}').join(String(FEATURE_COUNT));
    if (!settingsHtml.includes(sayTotal(dict['settings.masterDescOn']))) {
      console.error('FAIL: the all-on master description (「' + dict['settings.masterDescOn'] + '」) must be rendered with all ' + FEATURE_COUNT + ' introduced — the row must SAY what turning it off does');
      process.exit(1);
    }
    // ② 位置：标题之后、第一个功能开关之前 = **卡片顶部**
    const cardTitleAt = settingsHtml.indexOf(cardTitle);
    const firstFeature = switches(settingsHtml).find((x) => x.label === firstFeatureLabel);
    if (firstFeature === undefined) { console.error('FAIL: the ' + firstFeatureLabel + ' switch is missing'); process.exit(1); }
    if (!(cardTitleAt >= 0 && cardTitleAt < master.at && master.at < firstFeature.at)) {
      console.error('FAIL: the master switch must sit at the TOP of the 功能引入/移除 card, i.e. after the card title and ABOVE every feature switch; title=' + cardTitleAt + ' master=' + master.at + ' firstFeature=' + firstFeature.at);
      process.exit(1);
    }
    // ③ 混合态（3 档移除）：显示为关 + 「现在只引入了 4/7 档」
    const mixed = renderWith({ featureFind: false, featureQuote: false, featureDigest: false });
    const mixedMaster = findMaster(mixed);
    if (mixedMaster === undefined || !/aria-checked="false"/.test(mixedMaster.openTag)) {
      console.error('FAIL: in a MIXED state the master switch must read as OFF (a two-state control, not a tri-state one): ' + (mixedMaster && mixedMaster.openTag));
      process.exit(1);
    }
    // 档数从实现现算：这一段的 fixtures 关掉 3 档 ⇒ on = N-3、total = N。
    // 手抄的 4/7 在加档当天就过期（2026-10-16 加终端按钮即如此）。
    const ON_NOW = String(FEATURE_COUNT - 3);
    const TOTAL_NOW = String(FEATURE_COUNT);
    const partial = dict['settings.masterDescPartial'].split('{on}').join(ON_NOW).split('{total}').join(TOTAL_NOW);
    if (!mixed.includes(partial)) {
      console.error('FAIL: in a mixed state the master row must SAY how many are introduced (' + JSON.stringify(partial) + ') — "showing OFF" alone would hide that most features are still on');
      process.exit(1);
    }
    if (!mixed.includes('未引入 3 项：')) {
      console.error('FAIL: the compact summary line must stay (a mixed state must still list what is missing)');
      process.exit(1);
    }
    // ④ 全关：仍显示为关 + 「打开它 = 7 档全部引入」
    // ⚠️ ALL_OFF 必须覆盖**每一个** FEATURE_KEY —— 手抄的清单在加档当天就漏掉新档，
    //    于是"全关"其实不是全关，断言会以最误导的方式报红（2026-10-16 加终端按钮即如此）。
    const ALL_OFF = {};
    for (const key of FEATURE_KEY_LIST) ALL_OFF[key] = false;
    const allOff = renderWith(ALL_OFF);
    const allOffMaster = findMaster(allOff);
    if (allOffMaster === undefined || !/aria-checked="false"/.test(allOffMaster.openTag)) {
      console.error('FAIL: with all ' + FEATURE_COUNT + ' removed the master switch must read as OFF: ' + (allOffMaster && allOffMaster.openTag));
      process.exit(1);
    }
    if (!allOff.includes(sayTotal(dict['settings.masterDescOff']))) {
      console.error('FAIL: with all ' + FEATURE_COUNT + ' removed the master row must say 「' + dict['settings.masterDescOff'] + '」');
      process.exit(1);
    }
    console.log('settings master -> 「' + masterLabel + '」 sits at the top of the card (after the title, above all ' + FEATURE_COUNT + ' switches); ON only when all ' + FEATURE_COUNT + ' are introduced; mixed = OFF + 「只引入了 ' + ON_NOW + '/' + TOTAL_NOW + ' 档」; all-off = OFF + 「打开它 = ' + FEATURE_COUNT + ' 档全部引入」');
  }
  // ── 回归守卫（2026-10-16 新增，第 2 条批评）：全部开启是**配置读数**、不是系统健康状况 ⇒
  //    那行徽章不许是 state-error 红；红色只留给"确实有关闭项"。这条是"别改回红"的唯一守卫。
  //    只断"不是红"不够（一个恒灰的实现也能骗过它），所以下半段真的关掉一档、再渲染一次，
  //    要求徽章**变红**并列出那一项 ⇒ 证明那个三元真的在分流。
  {
    const readBadge = (html, text) => {
      const at = html.indexOf(text);
      if (at < 0) return null;
      const open = html.lastIndexOf('<div', at);
      return { tag: html.slice(open, html.indexOf('>', open) + 1) };
    };
    const on = readBadge(settingsHtml, '全部功能都已引入');
    if (on === null) { console.error('FAIL: the all-on summary badge must stay visible in the 基础 section'); process.exit(1); }
    if (/state-error/.test(on.tag)) {
      console.error('FAIL: the all-on badge must not be red — red means something is wrong, but every switch is on: ' + on.tag);
      process.exit(1);
    }
    if (!/(label-tertiary|state-success-primary)/.test(on.tag)) {
      console.error('FAIL: the all-on badge must read as a neutral readout (label-tertiary) or, if 绿=正常 is chosen, state-success-primary — not as an alarm: ' + on.tag);
      process.exit(1);
    }
    // 下半段：把 featureQuote 在**内存**存储里移除掉，徽章必须变成"未引入 1 项：引用"且为红。
    const savedGet = sandbox.localStorage.getItem;
    sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes'
      ? seededNotes
      : (key === 'dsh.deepworker.settings' ? JSON.stringify({ featureQuote: false }) : null));
    let offHtml = '';
    try {
      offHtml = renderToStaticMarkup(React.createElement(settingsComponent, { t: ti }));
    } catch (e) {
      console.error('FAIL: settings re-render with one feature OFF threw ->', e && e.message || e);
      process.exit(1);
    } finally {
      sandbox.localStorage.getItem = savedGet;
    }
    const off = readBadge(offHtml, '未引入 1 项：');
    if (off === null) { console.error('FAIL: with one feature not introduced the badge must switch to the "未引入 N 项：…" summary'); process.exit(1); }
    if (!/state-error-primary/.test(off.tag)) {
      console.error('FAIL: with a feature actually off the badge MUST be red — that is the only signal colour is allowed to carry here: ' + off.tag);
      process.exit(1);
    }
    if (/state-error/.test(on.tag)) { /* unreachable, kept for symmetry */ }
    console.log('settings badge -> all-on reads neutral (label-tertiary); one feature off turns it red (the ternary really branches)');
  }
  // ── 移除一档后：不重复「需重载」提示，只保留顶部一条总提醒 + 灰态 + 指路 ──
  {
    const savedGet2 = sandbox.localStorage.getItem;
    sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes'
      ? seededNotes
      : (key === 'dsh.deepworker.settings' ? JSON.stringify({ featureQuote: false }) : null));
    let removedHtml = '';
    try {
      removedHtml = renderToStaticMarkup(React.createElement(settingsComponent, { t: ti }));
    } catch (e) {
      console.error('FAIL: settings re-render with one feature REMOVED threw ->', e && e.message || e);
      process.exit(1);
    } finally {
      sandbox.localStorage.getItem = savedGet2;
    }
    if (removedHtml.includes('改动需 Cmd+Q 完全退出再开')) {
      console.error('FAIL: per-row reload notes must not come back; the top hint is enough');
      process.exit(1);
    }
    if (!/aria-disabled="true"/.test(removedHtml)) {
      console.error('FAIL: the not-introduced section/panel must be aria-disabled (greyed but NOT hidden)');
      process.exit(1);
    }
    for (const label of ['引用时写入出处行', '默认归档原对话']) {
      if (!removedHtml.includes(label)) {
        console.error('FAIL: a not-introduced section must stay RENDERED (greyed + pointed at 基础, not removed): missing ' + label);
        process.exit(1);
      }
    }
    console.log('settings removal -> one top Cmd+Q hint only; no per-row reload notes; aria-disabled grey section + 指路 line remain');
  }
  // ── 锁死守卫（2026-10-16 真机事故）：「基础」页在任何功能组合下都必须留着出路 ────────────
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 事故：把功能全部关掉之后，「基础」页**整页点不动**。机制逐字：
  //   · `OFF_STYLE` = `{ opacity: 0.55, pointerEvents: "none" }`（panel 与 section 共用一个常量）；
  //   · `settingsPanel` 在 `tabAllOff(value)` 为真时把整块 children 套进 OFF_STYLE；
  //   · `tabAllOff("basic")` 的分母是 `featuresOfTab("basic")`，而**只有 featureNotice 一档
  //     归属 basic** ⇒ 只要「通知与气泡」未引入，整页就被 `pointer-events: none`。
  //   而这一页恰恰是**唯一**装着恢复路径的地方：7 个引入/移除开关、每行的内联重载、
  //   顶部那颗主重载（桌面 App 没有 Cmd+R）。⇒ 用户被锁死，没有恢复路径。
  //
  // 判据（照任务书逐字）：这些控件**自身及其所有祖先**都不得带 `pointer-events: none` /
  // `aria-disabled="true"`；顶部主重载按钮**任何**组合下都不许 disabled。
  // ⚠️ 必须真跑渲染：SSR 不执行事件处理器，文本 grep 会被死代码满足（AGENTS.md 纪律 4）。
  {
    // 档位数**从实现现算**（FEATURE_KEYS），名字也从 FEATURE_META 现读 —— 手抄的 7 档清单
    // 在加档当天就漏掉新档（2026-10-16 加终端按钮即如此），而漏掉的那一档恰好不会被检。
    const KEY_LIST = FEATURE_KEY_LIST.slice();
    const NAMES = KEY_LIST.map((k) => {
      const m = new RegExp(k + ':\\s*\\{[^}]*name:\\s*"([^"]+)"').exec(code);
      if (m === null) { console.error('FAIL: cannot read the display-name key of ' + k + ' out of FEATURE_META'); process.exit(1); }
      const label = dict[m[1]];
      if (label === undefined) { console.error('FAIL: FEATURE_META.' + k + ' points at ' + m[1] + ', which has no entry in the render fixture (the switch would be nameless)'); process.exit(1); }
      return label;
    });
    const savedGet = sandbox.localStorage.getItem;
    const renderWith = (combo) => {
      sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes'
        ? seededNotes
        : (key === 'dsh.deepworker.settings' ? JSON.stringify(combo) : null));
      try { return renderToStaticMarkup(React.createElement(settingsComponent, { t: ti })); }
      finally { sandbox.localStorage.getItem = savedGet; }
    };
    /** 一个控件必须点得到：自己不许 disabled，祖先链上不许有灰态子树。 */
    const assertReachable = (html, spans, at, openTag, what, combo, label) => {
      const blocked = ancestorsDisabled(spans, at);
      if (blocked.length > 0) {
        console.error('FAIL: LOCKOUT — ' + what + ' (' + label + ') is INSIDE ' + blocked.length + ' disabled subtree(s) ' + JSON.stringify(blocked.map((s) => s.attrs.trim().slice(0, 60))) + ' with features ' + JSON.stringify(combo) + ' — the user can no longer click it, so there is no way back');
        process.exit(1);
      }
      if (/\bdisabled\b/.test(openTag) || /aria-disabled\s*=\s*"true"/i.test(openTag)) {
        console.error('FAIL: LOCKOUT — ' + what + ' (' + label + ') is disabled on its OWN element with features ' + JSON.stringify(combo) + ': ' + openTag);
        process.exit(1);
      }
    };
    // 全 2^N 种功能组合 —— "任何功能组合下"按字面实现，不留抽样空隙。
    let checkedSwitches = 0;
    let checkedMaster = 0;
    let worstBasic = null;
    const MASTER_LABEL = dict['settings.masterSwitch'];
    const COMBOS = 1 << KEY_LIST.length;
    for (let mask = 0; mask < COMBOS; mask++) {
      const combo = {};
      for (let b = 0; b < KEY_LIST.length; b++) combo[KEY_LIST[b]] = (mask & (1 << b)) === 0;   // bit set ⇒ NOT introduced
      const html = renderWith(combo);
      const spans = disabledSpans(html);
      // (a) 「基础」tabpanel 自己绝不许带灰态（`NO_PANEL_GREY_TABS` 那条规则的直接形状）。
      const panelAt = html.indexOf('id="deepworker-settings-tabs-basic-panel"');
      if (panelAt < 0) { console.error('FAIL: the 基础 tabpanel is missing from the render'); process.exit(1); }
      const panelOpen = html.slice(html.lastIndexOf('<', panelAt), html.indexOf('>', panelAt) + 1);
      if (/aria-disabled\s*=\s*"true"/i.test(panelOpen) || /pointer-events\s*:\s*none/i.test(panelOpen)) {
        console.error('FAIL: LOCKOUT — the 基础 tabpanel itself is greyed/disabled with features ' + JSON.stringify(combo) + ': ' + panelOpen);
        process.exit(1);
      }
      if (ancestorsDisabled(spans, panelAt).length > 0) {
        console.error('FAIL: LOCKOUT — the 基础 tabpanel sits inside a disabled subtree with features ' + JSON.stringify(combo));
        process.exit(1);
      }
      // (a2) 「笔记」与「终端」面板同样不许整块禁用 —— 笔记页装着「摘要」那一档的开关，
      //      冻住它 = 摘要在界面上再也点不回来（只剩"一键全开"）；终端页只有一档，整页灰
      //      只会把同一句指路显示两遍（用户要的是"按小节灰即可"）。
      for (const panelValue of ['notes', 'terminal']) {
        const at = html.indexOf('id="deepworker-settings-tabs-' + panelValue + '-panel"');
        if (at < 0) { console.error('FAIL: the ' + panelValue + ' tabpanel is missing from the render'); process.exit(1); }
        const open = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
        if (/aria-disabled\s*=\s*"true"/i.test(open) || /pointer-events\s*:\s*none/i.test(open)) {
          console.error('FAIL: LOCKOUT — the ' + panelValue + ' tabpanel must never be frozen as a whole (it holds a switch that is the only way back for its feature): ' + open);
          process.exit(1);
        }
        if (ancestorsDisabled(spans, at).length > 0) {
          console.error('FAIL: LOCKOUT — the ' + panelValue + ' tabpanel sits inside a disabled subtree with features ' + JSON.stringify(combo));
          process.exit(1);
        }
      }
      // (b) no dead reload button in any feature combination.
      if (buttonsWithText(html, '如何重载插件').length !== 0) {
        console.error('FAIL: a dead reload button appears with features ' + JSON.stringify(combo));
        process.exit(1);
      }
      // (c) 每一档的「引入 / 移除」开关 —— 把该档开回来的入口。它可能住在「基础」页，
      //     也可能住在它自己的 tab（`SWITCH_HOME`）。**不管住哪，任何组合下都必须点得到。**
      const sw = switches(html);
      const byLabel = new Map(sw.map((s) => [s.label, s]));
      for (const name of NAMES) {
        const s = byLabel.get(name);
        if (s === undefined) {
          console.error('FAIL: the feature master switch 「' + name + '」 is missing from the render with features ' + JSON.stringify(combo) + ' — a switch that is not rendered can never turn its feature back on');
          process.exit(1);
        }
        assertReachable(html, spans, s.at, s.openTag, 'the 「引入 / 移除」 switch', combo, name);
        checkedSwitches++;
      }
      // (c2) 「全部功能（一键全开 / 全关）」总开关 —— 它是"一键全开"的入口，必须覆盖**全部**
      //      档位（包括搬进「笔记」页的摘要）。它住在「基础」页卡片顶部、不在任何
      //      featureSection 里 ⇒ 在**任何**组合下都必须可交互。
      const mSw = byLabel.get(MASTER_LABEL);
      if (mSw === undefined) {
        console.error('FAIL: the 「' + MASTER_LABEL + '」 master switch is missing from the render with features ' + JSON.stringify(combo) + ' — it is the one-click way back');
        process.exit(1);
      }
      assertReachable(html, spans, mSw.at, mSw.openTag, 'the 「一键全开 / 全关」 master switch', combo, MASTER_LABEL);
      checkedMaster++;
      const offCount = KEY_LIST.filter((k) => combo[k] === false).length;
      if (offCount === KEY_LIST.length) worstBasic = html;
    }
    if (worstBasic === null) { console.error('FAIL: the all-off combination was never rendered'); process.exit(1); }
    // 「关闭必须可见」不靠整页变灰实现：全关时汇总行必须自己说出来（档数现算）。
    const allOffSummary = '未引入 ' + KEY_LIST.length + ' 项：';
    if (!worstBasic.includes(allOffSummary)) {
      console.error('FAIL: with all ' + KEY_LIST.length + ' features removed the summary line must say 「' + allOffSummary + '…」 (the lockout fix must not also delete the "off must be visible" signal)');
      process.exit(1);
    }
    // 全关时页面上仍然**一个不少**地渲染出每一档的名字 + 总开关名 + 主重载。
    for (const name of NAMES.concat([MASTER_LABEL])) {
      if (!worstBasic.includes(name)) {
        console.error('FAIL: with every feature removed the settings page must still render 「' + name + '」 — a switch that is not rendered can never turn its feature back on');
        process.exit(1);
      }
    }
    console.log('settings lockout -> ' + COMBOS + '/' + COMBOS + ' feature combinations: 基础/笔记/终端 panels never frozen; 「一键全开 / 全关」 master (' + checkedMaster + ' checks) + all ' + NAMES.length + ' single-feature switches (' + checkedSwitches + ') are interactive; none sits in a pointer-events:none / aria-disabled subtree');
    console.log('settings lockout -> with every feature removed the page still SAYS so (「' + allOffSummary + '…」) — visibility did not depend on freezing the page');
  }
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ── 灰态提示文案：`未引入` 必须**恰好出现一次**（类级：前缀与正文不许各带一次）────────────
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 事故逐字：灰态行渲染成 `未引入 · 未引入：回退 / 重试 / …都不注册。`
  //   —— 两层各自都以同一个词开头：`feature.offPrefix`（"未引入"）与那一档自己的
  //   `feature.hint*Off`（"未引入：…"），中间用 `" · "` 拼起来。
  // 修法（单一来源）：把分隔符并进前缀键（`未引入：`），8 条正文只留"为什么"。
  // 因此下面这一节按"缺陷是类不是实例"扫三层：
  //   ① 渲染层：每一档的灰态提示里那个词**恰好一次**；
  //   ② 源码层：**两个词典、全部 16 条**正文都不许含前缀词（哪一条被改回去都会红）；
  //   ③ 类级：整页每一个文本块都不许出现"同一个词被 `·`/`：` 重复"的形状。
  {
    const savedGet = sandbox.localStorage.getItem;
    const renderWith = (combo) => {
      sandbox.localStorage.getItem = (key) => (key === 'dsh.deepworker.notes'
        ? seededNotes
        : (key === 'dsh.deepworker.settings' ? JSON.stringify(combo) : null));
      try { return renderToStaticMarkup(React.createElement(settingsComponent, { t: ti })); }
      finally { sandbox.localStorage.getItem = savedGet; }
    };
    // ⚠️ ALL_OFF 必须覆盖**每一个** FEATURE_KEY —— 手抄的清单在加档当天就漏掉新档，
    //    于是"全关"其实不是全关，断言会以最误导的方式报红（2026-10-16 加终端按钮即如此）。
    const ALL_OFF = {};
    for (const key of FEATURE_KEY_LIST) ALL_OFF[key] = false;
    const allOffHtml = renderWith(ALL_OFF);
    // ① 每一档的灰态提示 = 前缀 + 正文，页面上恰好一次，且那个词在它里面恰好一次。
    //    映射从 bundle 现读（`offHintOf` 的 if 链）—— 夹具不许手抄一份，否则会跟着漂。
    const hintOf = {};
    for (const m of code.matchAll(/if \(item\.key === "(\w+)"\) return t\("([\w.]+)"\);/g)) hintOf[m[1]] = m[2];
    const mapped = Object.keys(hintOf);
    if (mapped.length !== FEATURE_COUNT) {
      console.error('FAIL: cannot read the ' + FEATURE_COUNT + ' feature→hint mappings out of offHintOf() (parsed ' + mapped.length + ': ' + JSON.stringify(hintOf) + '); this assertion would silently degrade into a text grep');
      process.exit(1);
    }
    const prefix = dict[OFF_PREFIX_KEY];
    const word = prefix.replace(/[：:\s]+$/, '');                     // 「未引入」/「not introduced」
    for (const key of mapped) {
      const expected = prefix + dict[hintOf[key]];
      const occurrences = allOffHtml.split(expected).length - 1;
      if (occurrences !== 1) {
        console.error('FAIL: the grey hint for ' + key + ' must render exactly once as ' + JSON.stringify(expected) + '; it appears ' + occurrences + ' time(s) in the all-features-removed render');
        process.exit(1);
      }
      const wordCount = expected.split(word).length - 1;
      if (wordCount !== 1) {
        console.error('FAIL: the grey hint for ' + key + ' repeats the word ' + JSON.stringify(word) + ' ' + wordCount + ' time(s) — verbatim: ' + JSON.stringify(expected) + ' (this is the `未引入 · 未引入：…` defect)');
        process.exit(1);
      }
    }
    // ② 源码层（类级）：两个词典、全部 16 条 `feature.hint*Off` 正文都不许含前缀词。
    for (const locale of ['zh', 'en']) {
      const localePrefix = dictValueOf(locale, OFF_PREFIX_KEY);
      const localeWord = localePrefix.replace(/[：:\s]+$/, '');
      for (const key of OFF_HINT_KEYS) {
        const body = dictValueOf(locale, key);
        if (localeWord !== '' && body.toLowerCase().includes(localeWord.toLowerCase())) {
          console.error('FAIL: ' + locale + '["' + key + '"] contains the off-prefix word ' + JSON.stringify(localeWord) + ' as well as being prefixed by it ⇒ the rendered line repeats it: ' + JSON.stringify(localePrefix + body));
          process.exit(1);
        }
      }
    }
    // ③ 类级：整页文本块里"同一个词被分隔符重复"的形状一个都不许有。
    for (const [what, html] of [['the default (all on) render', settingsHtml], ['the all-features-removed render', allOffHtml]]) {
      const hits = [];
      for (const chunk of textChunks(html)) for (const hit of repeatedWordAcrossSeparator(chunk)) hits.push({ chunk: chunk.slice(0, 90), hit });
      if (hits.length > 0) {
        console.error('FAIL: ' + what + ' repeats a word across a separator (the `未引入 · 未引入：…` shape) — this defect is a CLASS, not one instance: ' + JSON.stringify(hits.slice(0, 3)));
        process.exit(1);
      }
    }
    console.log('settings copy -> each of the 7 grey hints says 「未引入：…」 exactly once (word appears once per hint); both dictionaries\' 16 hint bodies are free of the prefix word; no text block on the page repeats a word across a separator');
  }
  // ⚠️ 2026-10-15 / 2026-10-16: 13 = 4 behaviour switches (quoteProvenance / retryNote /
  // archiveOriginal / focusNativeNotice — the native-notice one moved beside the notification scope,
  // where it belongs) + 1 「全部功能（一键全开 / 全关）」master (2026-10-16 第 4 轮)
  // + 7 FEATURE master switches + the edit-and-resend DIAGNOSTIC trace (which stays
  // in the collapsed debug section because it defaults to OFF and renames the title). It was 13
  // before while the bottom block shipped a SECOND copy of that trace switch (that block is gone,
  // 2026-10-16 打磨) — so the count is 13 again for a different reason. A count change here must be
  // a deliberate one.
  if (!settingsHtml.includes('命令注册状态：')) { console.error('FAIL: the shortcut registration status must be visible'); process.exit(1); }
  // ⚠️ 2026-10-15: this used to be a bare `/digest=(ok|failed:|not-registered)/`. That is NOT
  // sensitive to the command-id rename: the pattern is unanchored, so `deepworker.digest=ok`
  // (i.e. a stale `.replace("history-actions.", "")` that failed to strip the new prefix) would
  // still satisfy it. Assert the five SHORT display names positively and forbid the prefixed
  // form, so the settings line can only read `find=… digest=… notes.open=… notes.search=…`.
  // ⚠️ 2026-10-16 加固：这条窗口原来是"从某串**往后截到 HTML 末尾**"。那只有在调试区恰好是
  //    最后一节、且它后面永远不出现 `find=` 形状的文字时才成立 —— 一旦把 `settings.storage`
  //    或任何含 `find=` 的文案挪到它后面，窗口就会纳进无关文字而**误绿**。改成用标记对**包夹**：
  //    窗口必须止于调试区里下一个稳定标记。找不到界标 ⇒ 直接红（不许静默退回"到末尾"）。
  const statusStart = settingsHtml.indexOf('命令注册状态：');
  const statusEnds = ['把自检发给我', '核心探针：', '编辑重发时输出诊断跟踪', '上次跳转诊断']
    .map((m) => settingsHtml.indexOf(m, statusStart))
    .filter((i) => i > statusStart);
  if (statusStart < 0 || statusEnds.length === 0) {
    console.error('FAIL: could not bracket the shortcut-status window (the debug block lost its stable end marker): start=' + statusStart + ' ends=' + JSON.stringify(statusEnds));
    process.exit(1);
  }
  const statusLine = settingsHtml.slice(statusStart, Math.min.apply(null, statusEnds));
  for (const short of ['find=', 'digest=', 'notes.open=', 'notes.search=']) {
    if (statusLine.indexOf(short) === -1) {
      console.error('FAIL: shortcut status must name ' + short.slice(0, -1) + ': ' + statusLine.slice(0, 400));
      process.exit(1);
    }
  }
  if (!/=(ok|failed:|not-registered)/.test(statusLine)) { console.error('FAIL: shortcut status must report every command: ' + statusLine.slice(0, 400)); process.exit(1); }
  if (/\bdeepworker\.(find|digest|notes\.(open|search))=/.test(statusLine)) {
    console.error('FAIL: the status line must show short names, not package-prefixed command ids: ' + statusLine.slice(0, 400));
    process.exit(1);
  }
  console.log('settings section renders OK (5 tabs 基础/专注锁/笔记/会话操作/命令按钮 + 13 Switch rows + build tag in the 基础 top bar)');
}
{
  // the header action must look like its neighbours: borderless, icon + short label
  let actionHtml = '';
  try {
    actionHtml = renderToStaticMarkup(React.createElement(headerComponent, { t: ti }));
  } catch (e) {
    console.error('FAIL: header action render threw ->', e && e.stack || e);
    process.exit(1);
  }
  if (!actionHtml.includes('存为笔记')) { console.error('FAIL: the header action must use the short label'); process.exit(1); }
  if (!actionHtml.includes('data-icon="notes"')) { console.error('FAIL: the header action must carry the notes icon'); process.exit(1); }
  if (/variant=/.test(actionHtml) || /border:1px/.test(actionHtml)) { console.error('FAIL: the header action must not be a bordered button'); process.exit(1); }
  if (!actionHtml.includes('title="总结当前对话存为笔记"')) { console.error('FAIL: the short label needs the full meaning as a tooltip'); process.exit(1); }
  console.log('session-header digest action renders OK (icon + short label + tooltip)');
}
// no user-triggered handler may return without speaking: these were the silent ones
for (const handler of ['onRetryTurn', 'onResendSubmit', 'onResendOpen']) {
  const at = code.indexOf('function ' + handler + '(');
  if (at < 0) { console.error('FAIL: handler missing: ' + handler); process.exit(1); }
  const body = code.slice(at, at + 1400);
  if (!body.includes('showNotice')) { console.error('FAIL: ' + handler + ' can refuse silently'); process.exit(1); }
}
for (const marker of ['textOfContent(editContent) || currentPrompt()', 'userText(turnNumber)', 'onResendOpen', 'menuHandlerRef', 'menuListeners.push', 'function onRetryTurn', 'function sendEdited', 'request.kind === "retry"', 'request.kind === "newModeInWorkspace"', 'setWorkspaceId(request.workspaceId)', 'function applyQuote(', 'resend.running', 'resend.empty', 'showNotice(message, { clientX: 24, clientY: 80 })', 'rememberQuote({', 'modal.newMode.sourceLabel', 'createWithMode(sourceId[0] || sessionId', 'listSessions', 'sidebar.footer.action', 'function NotesAction', 'dsh-ha-notes-dialog', 'dsh-ha-form-dialog', 'installDialogSizes', 'key: NOTES_PANEL', 'ctx.layout.selectPanel', 'notes.back', 'notes.search', 'function exportAll', 'function doImport', 'function conversationDigest', 'conversationDigest(target, outline, options)', 'function HistoryActionsSettings', 'shortcutStatus[id]', 'function digestNoteText', 'function saveDigestNote(t, opts)', 'function appendNote', 'function digestChip', 'function onDigestSave', 'kind: "digestOptions"', 'request.claimed !== true', 'testHooks.saveDigestNote', 'testHooks.summarizeWithModel', 'function summarizeWithModel', 'function pollChildSummary', 'digest.modelProgress', 'digest.modelCanLeave', 'digest.errorLabel', 'digest.savedTotal', 'primitives.MarkdownText', 'parseTurnChip', 't("quote.provenance"', 'function buildStatus', 'md=builtin', 'function mdBlocks', 'function mdInline', '::highlight(dsh-ha-find)', 'background-color:#ffe08a', 'jumpToQuote', 'highlightQuoteInTurn', 'findQuoteRecord', 'JUMP_HIGHLIGHT_MS', 'function filterNotes', 'function activeTagOf', 'notes.editSave', 'startEdit', 'saveEdit', 'setDigestError', 'digestError[0] !==', 'function lastAssistantText', 'digest.modeModel', 'digest.modelFailed',
  'showNotice(t("retry.noText")', 'showNotice(t("retry.noBoundary")', 'showNotice(t("resend.empty")', 'digest.optKeyword', 'digest.optLengthLong', 'digest.optFormatMd', 'digest.optSave', 'digest.optKeyword', 'digest.optFormatOutline', 'digest.optLengthLong', 'conversation.session.header.utilities', 'readSettings().quoteProvenance', 'readSettings().retryNote', 'readSettings().archiveOriginal', 'document.addEventListener("keydown", onKey, true)', 'insertQuoteIntoDraft(inputActions, quote)', 'notes.placeholder', 'notes.copied']) {
  if (!code.includes(marker)) { console.error('FAIL: prefill wiring missing: ' + marker); process.exit(1); }
}
if (!editHtml.includes('type="checkbox"')) { console.error('FAIL: archive checkbox missing'); process.exit(1); }
console.log('edit dialog renders (title + textarea + archive checkbox) and prefill wiring is present');

console.log('\nTURN-OBJECT / PREFILL REGRESSION CHECKS PASSED');
