# AGENTS.md

给在本仓库工作的 AI / 协作者看的说明书。先读这一页，再动代码。

---

## 1. 这是什么

**闪灵** —— Windows 桌面常驻的「灵感速记 + 任务追踪」工具。

一句话定位：**在电脑前，把一闪而过的念头 3 秒存下，再决定它是灵感还是行动。**

- 平台：**仅 Windows**（M0 不考虑 Mac）
- 数据：本地单文件，无账号、无云同步
- 用户：自己用，不追求通用化

---

## 2. 非协商的产品约束

改动代码前先确认没有违反这几条。违反了就算功能"能跑"也是错的。

1. **捕获链路 ≤ 3 秒，且不允许任何网络请求。**
   全局快捷键 → 窗口出现 → 输入 → Enter 落盘 → 窗口消失、焦点归还，全程不超过 3 秒。
   捕获路径上不许出现：AI 调用、分类选择、加载态、登录校验。

2. **AI 只允许出现在"整理"阶段。**
   用户主动点「拆成待办 / 建议标签」时才允许请求模型。永远不要"顺手"在保存时调 AI。

3. **灵感与任务可以无损互转。**
   升格（灵感→任务）保留原文与溯源；降级（任务→灵感）不能丢内容。

4. **不做清单是硬约束，不是建议。**
   日历、甘特图、看板、多人协作、云同步、打卡成就、双链知识图谱、富文本编辑器 —— 一律不做。

5. **数据是用户的。**
   默认全本地；导出 JSON / Markdown 必须始终可用；启用 AI 时必须明确告知哪段文字会离开本机。

---

## 3. 技术栈与选型原因

| 层 | 选型 |
|---|---|
| 外壳 | Electron 45（Windows 10 1903 上没有 Rust / MSVC 构建链，Tauri 装环境成本过高） |
| UI | React 19 + TypeScript + Vite 8 |
| 样式 | Tailwind CSS 4（`@theme` 里定义设计令牌，见 `src/styles.css`） |
| 存储 | 单文件 JSON（`app.getPath('userData')/data.json`），原子写：先写 `.tmp` 再 rename |
| AI | OpenAI 兼容网关，见第 7 节 |

**没有用 SQLite**：M0 数据量小，避免原生模块与重建问题。数据量上来后再迁移，`electron/store.js` 是唯一需要改的地方。

---

## 4. 目录结构

```
electron/
  main.js      主进程：窗口、托盘、全局快捷键、IPC、生命周期
  preload.js   contextBridge，把能力暴露为 window.shining
  store.js     数据层：读写 data.json、业务方法、变更广播

src/
  main.tsx     入口（createRoot）
  App.tsx      按 hash 路由：#/capture 或 #/main
  views/CaptureView.tsx  闪念窗（独立无边框窗口）
  views/MainView.tsx     主窗（灵感 / 任务 / 留痕 / 已完成 / 搜索 / 详情面板）
  views/DetailPanel.tsx  记录详情（编辑 / 任务属性 / 图片 / 整理动作）
  views/SplitPanel.tsx   拆待办面板
  views/LogsView.tsx     留痕（按周折叠、按天记录、生成周报）
  views/SettingsView.tsx 设置（AI 服务、模型选择、数据目录）
  components/ui.tsx     共用图标、页头、优先级、按键与图片缩略图
  types.ts     数据类型 + window.shining 的全局类型声明
  lib/time.ts  时间格式化
  styles.css   设计令牌（@theme）、滚动条、拖拽区、动画
  platform/CONTRACT.md  平台契约，换壳必读

assets/        icon.png / tray.png（由 scripts/gen-icons.ps1 生成）
scripts/       gen-icons.ps1
PRD.md         产品定义（v0.3）
```

> **Windows 文件名大小写陷阱**
> 本仓库在大小写不敏感的文件系统上。**不要创建只差大小写的文件**：
> 曾经 `src/main.tsx`（入口）被 `src/Main.tsx`（主界面组件）覆盖，导致构建产物只剩 1.6 KB、页面空白。
> 页面组件统一放 `src/views/`，用 `*View.tsx` 命名；入口永远是 `src/main.tsx`。

---

## 5. 架构铁律

**`src/` 下的任何 UI 代码都不允许 `import electron` 或调用 Tauri API。**

所有原生能力只能通过 `window.shining` 访问：

```ts
snapshot(): Promise<Snapshot>
createIdea(content): Promise<Idea>
updateIdea(id, patch): Promise<Idea | null>
deleteIdea(id): Promise<void>
createTask(content, ideaId?): Promise<Task>
updateTask(id, patch): Promise<Task | null>
deleteTask(id): Promise<void>
hideCapture(): Promise<void>
openMain(): Promise<void>
updateSettings(patch): Promise<Settings>
windowControl('min' | 'max' | 'close'): void
onChanged(cb): () => void
onCaptureReset(cb): () => void
```

新增原生能力时：先在 `preload.js` 加方法 → 在 `src/types.ts` 补类型 → 再在 UI 用。不要绕过这层。

**为什么**：保证将来可以把 Electron 换成 Tauri 而 UI 一行不改（两者在 Windows 上都用 WebView2，同一 Chromium 内核，渲染效果一致）。换壳时只需重写 `electron/` 两个文件。

---

## 6. 数据模型与状态机

```ts
Task { id, content, next_action?, status: 'todo'|'done'|'shelved',
       tags: string[], idea_id?, created_at, done_at?,
       due_at?, remind?, notified_at?, priority?: 'low'|'medium'|'high'|'urgent'|null,
       images?: string[] }

Idea { id, content, status: 'inbox'|'archived'|'promoted'|'dropped',
       tags: string[], created_at, updated_at, task_id?, images?: string[] }

Log  { id, content, created_at, images?: string[] }   // 留痕：只增不删（可手动删），记录当天做过什么
```

- 图片存在 `userData/attachments/`，数据里只存文件名；渲染端用 `shining-media://files/<name>` 读取
  （自定义协议注册在主进程，dev 的 http 页面也能加载，别用 `file://`）。
- 捕获窗支持直接粘贴截图，草稿里的图片可逐张移除；详情面板显示缩略图，点击用系统默认程序打开。
- 读取剪贴板图片必须同时看 `clipboardData.items` 和 `.files`：截图工具复制的位图常常只在 items 里，
  只读 files 会「贴了没反应」。统一用 `src/lib/clipboard.ts` 的 `imageFilesFromClipboard`。
- 图片以 base64 字符串过 contextBridge（`fileToBase64`），不要直接传 ArrayBuffer。

- `created_at` 是**首次记录时间**，任何编辑都不改它；UI 统一按 `YYYY-MM-DD HH:mm` 展示（精确到分钟）。
- 截止与提醒**默认都为空**，不设置就没有任何负担：
  - `due_at`：ISO 时间；`remind`：是否到点弹通知；`notified_at`：已通知标记。
  - 只有 `due_at` 存在时 `remind` 才生效；清空 `due_at` 会强制 `remind=false`。
  - 修改 `due_at` 或重新勾选 `remind` 会重置 `notified_at`，重新武装提醒。
- 提醒调度在主进程：每 15 秒扫一次，命中未完成且到点未通知的任务，合并成**一条**系统通知，点击打开主窗，随后写 `notified_at` 防重复。
- **任务排序**：优先级 `极 > 高 > 中 > 低 > 未设`；同级按 `due_at` 升序，无截止时间排在该级末尾，再按 `created_at` 倒序。
- **状态只有三个**：`todo` / `done` / `shelved`。历史数据里的 `doing` 会在加载时并入 `todo`，不要再引入"进行中"。

- `tags` 由正文里的 `#标签` 自动提取，不需要单独的标签表。
- **UI 叫「灵感」，代码里状态值仍然是 `inbox`**，不要改这个存储值（会造成历史数据丢失）。
- 删除任务时，若它由灵感升格而来，那条灵感会退回 `inbox`。
- 所有写操作必须走 `store.commit()`，它会持久化 + 广播 `data:changed`，UI 靠这个事件刷新。

---

## 7. LLM 接入（已实测，改动前先读）

在「设置 → AI 服务」填写 OpenAI 兼容服务地址，获取并选择模型。程序不预置任何真实服务地址或模型 ID。
用于保留本机既有默认值的可选文件 `userData/llm.local.json` 只含 `baseUrl` 与 `model`，界面保存的设置优先。文件中不能放 Key。

**必须遵守：**

1. 请求体固定带 `chat_template_kwargs: { "thinking": false }`。
   - 开着思考：1.7–3.2 s，思考 token 占 78%
   - 关掉思考：0.48–0.66 s
   - 注意：`enable_thinking`、`reasoning_effort`、`reasoning_max_tokens` 都**无效**，别试。
2. **不要用 `response_format: { type: "json_object" }`** —— 实测会把多条待办压成一条。
   正确做法：提示词要求"只输出 JSON 数组"，解析前剥掉 ``` 围栏，失败重试一次再走规则兜底。
3. 丢弃返回里的 `message.reasoning` 字段，不展示、不落库。
4. `max_tokens` 给 800–1200 即可。
5. 超时 6 秒 → 降级到本地规则拆分（按标点/连接词切句），并给一个"重试 AI"按钮。
6. 429 / 5xx 指数退避重试 2 次；4xx 不重试，按错误体提示。
7. Key 只从环境变量或系统凭据读取，**绝不写进源码、日志、data.json**。
   实现：`ESWIN_API_KEY` 优先；否则读 `userData/secret.bin`（`safeStorage` 异步 API + DPAPI 加密）。
   一次性写入用 `scripts/seed-key.js`，不要在代码里硬编码。
8. 未配置服务时不发请求；服务不可达时拆分走本地规则，排期和周报不写入结果。捕获不依赖网关。

**版本控制边界**：真实网关地址、部署信息、API Key、用户记录/附件、截图和导出不进 Git。文档只用保留域（例如 `https://gateway.example/v1`）和占位模型 ID。提交前核对暂存区，不强行添加忽略项。

代码位置：`electron/llm.js`（调用 + 提示词 + 解析 + 规则拆分），IPC 入口 `ai:split` / `ai:status` / `ai:set-key`。
UI 入口：`src/views/SplitPanel.tsx`，只从灵感详情面板进入，**不在捕获链路里**。

拆解按项目分组返回 JSON 数组（`[{ project, tasks }]`）。只把原文里明确出现的名称加到该组任务标题，格式 `【项目名】动作`，预览和落盘使用同一标题，既有任务不改名。本地规则只识别显式的 `项目：名称` 标题。

### 时间解析（自动排期）

- 任务创建后**异步**调用 `parseSchedules(texts[])`，一次请求批量解析，绝不阻塞捕获。
- 提示词注入当前时间 + 本周一/本周日/下周一的具体日期（否则"下周五"会算错一周）。
- 只在出现明确时间表达时给 `due_at`；"尽快/重要/有空"一律返回 `null`，不许编造。
- 时段缺省：上午 10:00、中午 12:00、下午 15:00、傍晚 18:00、晚上 20:00；只有日期用 09:00。
- 截止在 7 天内则 `remind = true`。
- 同一次请求还会输出 `priority`：`urgent`（今天必须完成/后果严重）、`high`（重要且有明确截止）、`medium`（普通待办）、`low`（杂事）；判断不了给 `null`。
- 失败、超时、无 Key → 什么都不做，任务保持"无截止时间"。
- **不覆盖用户手动设置的截止时间**；`force: true` 只用于详情面板的「识别时间」按钮（用户可以主动重算）。
- 开关：`settings.autoSchedule`（默认 true）。关掉后只有手动按钮有效。

已验证：`/models` 200、基础对话 200、function calling 200、错误模型 400、错误 Key 401。

---

## 8. UI 规范

设计令牌在 `src/styles.css` 的 `@theme` 里，别在组件里写死颜色。

| 令牌 | 值 | 用途 |
|---|---|---|
| `primary` | `#1b6253` | 主操作、选中态（深青绿） |
| `primary-soft` | `#dfefe7` | 主色浅底、徽标 |
| `spark` | `#a44117` | 高优先级（暖橙文字，配 `spark-soft`） |
| `idea` | `#38bdf8` | 灵感类型标记（亮浅蓝） |
| `bg` | `#f6f7f3` | 主背景（纸白） |
| `rail` | `#edf1eb` | 侧栏（浅灰绿） |
| `surface` | `#ffffff` | 内容面 / 弹层 |
| `ink` | `#172b25` | 主文字 |
| `sub` / `muted` | `#41534b` / `#576960` | 次级 / 弱化（均 ≥ 4.5:1） |
| `line` | `#dce4de` | 分割线、描边 |
| `danger` | `#af2936` | 删除、危险操作、极优先级 |

方向是「一张随手就能写的工作纸」：保留四角星和浅色青绿，主色加深以提高文字及按钮对比度。改色前先跑 `ui-ux-pro-max --design-system`。

- 字体：系统字体 `Segoe UI Variable Text` → `Microsoft YaHei UI`，正文 14px，行高 22–24px；元信息 12px 起。不加载外部字体。
- 圆角：通用控件约 8px，内容分组约 12–14px。
- 动效：只有按压反馈、详情短滑入、展开与状态反馈；不做逐条列表延迟或装饰动画，遵循 `prefers-reduced-motion`。
- 布局：设置双栏随工作区宽度切单栏；详情只在工作区够宽时与列表并排，窄窗详情单独占满工作区。侧栏收起状态仍记忆。
- **不要做红点、逾期红色警告、连续打卡、完成率**。这个产品靠"轻推"，不靠制造焦虑。

**可访问性硬规则（来自 ui-ux-pro-max「Accessibility」优先级）**

1. 所有可交互元素必须有 `:focus-visible` 焦点环（全局样式已提供，不要 `outline-none` 掉）。
2. **不允许"只有 hover 才出现"的操作入口**：行内操作需在 `hover`、`focus-within`、选中态三种情况下都可见；
   同时详情面板必须提供同一组操作的常驻入口。
3. 不用颜色单独承载信息：已完成 = 勾选图标 + 删除线，优先级 = 文字（低/中/高/极）+ 底色。
   优先级配色固定为：低 = 灰、中 = 白、高 = 橙、极 = 红；灵感标记用亮浅蓝，不要挪用优先级色。
4. 图标按钮必须有 `aria-label`；列表行用 `role="button"` + `tabIndex` + Enter/Space 触发。
5. 文字对比度：正文、弱化文字均 ≥ 4.5:1；占位符也算。

- 捕获窗：720×132 透明无边框，卡片内边距 14px，输入 17px，Enter 保存、Shift+Enter 换行、Esc 关闭、草稿保留。
  输入前缀决定落点：`/t` 存为任务、`/r` 记入留痕、无前缀存为灵感。输入框自身不画焦点框，
  由卡片 `focus-within` 边框承担焦点反馈（全局焦点环放在 `@layer base`，否则工具类盖不掉）。
- 主窗：无边框 + 自定义标题栏，`-webkit-app-region: drag` 只在标题栏，按钮加 `no-drag`。

**两个全局快捷键**

| 用途 | 默认键 | 设置字段 |
|---|---|---|
| 记下灵感（闪念窗） | `Ctrl+Shift+Space` | `settings.hotkey` |
| 打开 / 关闭主窗 | `Ctrl+Shift+X` | `settings.mainHotkey` |

默认键注册失败时尝试 `Ctrl+Alt+Shift+Space` / `Ctrl+Alt+Shift+X`。侧栏与托盘显示实际注册的键；两组失败时保留托盘入口，不显示一个不可用的组合。注册结果只进运行时快照，不写入 `data.json`。
主窗快捷键只在窗口已经聚焦时隐藏它，否则打开、恢复或前置窗口。点击托盘和重新双击启动器始终打开主窗。

---

## 9. 常用命令

```bash
npm install          # 首次（国内建议先设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
npm run dev          # Vite + Electron 热更新
npm run build        # 构建 renderer 到 dist/
npm run package:win  # Windows x64 便携 ZIP + SHA-256，输出到 release/
npm start            # 构建后直接跑
npm run shot         # 无头截图到 shots/（自检 UI 用，跑完自动退出）
npm run test:store   # 数据层 + 规则拆分的冒烟测试
pwsh scripts/gen-icons.ps1   # 重新生成图标

# 一次性写入网关 Key（加密到 userData/secret.bin）
$env:ESWIN_API_KEY="<key>"; .\node_modules\electron\dist\electron.exe scripts\seed-key.js
```

数据文件位置：`%APPDATA%\闪灵\data.json`（默认在 userData；可在设置里迁到别的目录）。
图片附件：`%APPDATA%\闪灵\attachments\`（数据里只存文件名）。
Key 文件：`%APPDATA%\闪灵\secret.bin`（DPAPI 加密，不可明文读取）。
启动配置：`%APPDATA%\闪灵\config.json`（存 `dataDir` 等引导项，**永远不跟着数据目录走**）。

---

## 10. 当前状态

- ✅ 全局快捷键、闪念窗、落盘、主窗三视图、搜索、升格/沉淀/删除/完成、托盘
- ✅ 一键拆待办（LLM + 规则兜底，勾选确认后建任务）
- ✅ 任务截止时间 + 到点系统通知（默认不设，逾期不标红）
- ✅ 自然语言自动排期（"明天下午开会" → 11-18 15:00）
- ✅ 四档优先级（低/中/高/极）+ AI 自动定级 + 按优先级分组排序
- ✅ 留痕（按周折叠、按天记录）+ AI 生成周报
- ✅ 设置页：Base URL / API Key / 拉取模型列表 / 数据目录迁移
- ⬜ 导出 JSON / Markdown
- ⬜ 启动提醒、旧灵感浮现
- ⬜ 标签与项目筛选
- ✅ Windows x64 便携 ZIP（`npm run package:win`，嵌入闪灵图标，只从白名单打包，不读取本机数据）
- ⬜ Windows 安装器与应用签名

做下一步之前先看 `PRD.md` 的 MVP 范围，不要提前实现 M2 的东西。
