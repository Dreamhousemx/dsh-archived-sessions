# DSH 侧边栏「任务行」项菜单 — 实现清单（只读调研）

> 调研范围：`D:\Workspace\DeepSeek Harness\.dsh-src\dsh\node_modules\@deepseek-ai\`（下称 `@src`，共 250+ 包）。
> 未修改任何文件。所有结论附 `文件路径:行号`。

---

## 0. 结论摘要（先读这一节）

**截图里那 8 项菜单在 `@src` 里不存在。** 现有实现只有 4 项，且其中 1 项与截图不符：

| 截图菜单项 | `@src` 现状 |
|---|---|
| 置顶 | ✅ 存在（`pin`，order 100） |
| 重命名 | ✅ 存在（`rename`，order 200） |
| 分享任务 | ❌ **未找到**（无任何 session 分享/导出为菜单项的实现） |
| 在独立窗口中打开 | ❌ **未找到**（无 session 级别的开新窗口能力） |
| 打开文件夹 | ❌ **未找到**（能力存在，但挂在文件/交付物上，不在这张菜单里） |
| 批量操作 | ❌ **未找到**（无任何多选 session 的 UI） |
| 归档 | ✅ 存在（`archive`，order 400） |
| 删除任务 | ❌ **未找到**（session **在设计上不可删除**） |

关键证据：

- 该菜单的 slot 是 `sidebar.workspaces.session.menu.item`，全仓库只有 **一个** 包往里注册，共 4 项：`pin`(100)、`rename`(200)、`fork`(300)、`archive`(400) — `@src\dsh-client-ui-workspace\lib\client.js:4331-4360`。
- 该包 README 的「已知限制」明确写死：**「没有 Session 删除：会话可以归档但绝不会被删除」** — `@src\dsh-client-ui-workspace\README.zh.md:214`。
- slot 的权威文档（生成式 catalog）也把「shipped rows」穷举为这 4 项 — `@src\dsh-cordis-client-runner\lib\client.js:5840`。

关于「任务」一词的歧义（重要）：
用户截图的「任务行」若指的是**定时任务行**，则其中「删除任务」确有实现，但那属于 `dsh-client-ui-schedule`（自动化/定时任务）包，与 session 侧边栏是两套表面。见 §5。

**推测（非结论）**：截图很可能来自一个经过定制/注入的构建，或来自尚未开源的版本。`@src` 副本对应的是一份更精简的菜单。

---

## 1. 菜单由谁渲染、如何注册、顺序与分隔线

### 1.1 渲染者

侧边栏 session 行由 `dsh-client-ui-workspace` 渲染，行内组件 `SessionNodeItem` 负责渲染 `...` 按钮与菜单：

- 行与菜单的组件：`@src\dsh-client-ui-workspace\lib\client.js:1571`（`SessionNodeItem`）
- `...` 按钮与 `Menu` 挂载：`@src\dsh-client-ui-workspace\lib\client.js:1645-1664`
- 菜单内容来自 slot 渲染：`@src\dsh-client-ui-workspace\lib\client.js:1661`
  ```
  children: renderSlot("sidebar.workspaces.session.menu.item", { sessionId: node.id, displayTitle: row.title }, { hookContext: menuOpenState })
  ```
- 菜单本体是 ui-primitives 的 `Menu`，`portal: true`、`closeOnPointerLeave: true`（`:1645-1651`）

### 1.2 注册机制：slot 列表（不是内部数组）

- slot 声明（`kind: "list"`, `scope: "root"`，并注入 `menuOpenState` hook 与 `shortcuts`）：`@src\dsh-client-ui-workspace\lib\client.js:4306-4313`
- 实际注册（`apply` 里以客户端插件身份注册自己）：`@src\dsh-client-ui-workspace\lib\client.js:4331-4360`

| id | order | 组件 | 行号 |
|---|---|---|---|
| `pin` | 100 | `PinSessionMenuItem` | `client.js:4332-4338` |
| `rename` | 200 | `RenameSessionMenuItem` | `client.js:4339-4345` |
| `fork` | 300 | `ForkSessionMenuItem` | `client.js:4346-4352` |
| `archive` | 400 | `ArchiveSessionMenuItem` | `client.js:4353-4359` |

- 同包还注册了 `sidebar.workspaces.session.row.action`（悬停按钮）2 项：`archive`(100)、`pin`(200) — `client.js:4361-4376`
- 「无内部数组」的依据：每个菜单项都是 slot 条目，条目的 `order` 决定位置，插件可用自己的 `order` 插入、或用更高 `priority` 复用内置 id 来遮蔽内置项 — `@src\dsh-client-ui-workspace\README.zh.md:98`

### 1.3 顺序、分隔线、危险项

- 顺序 = 各条目 `order` 升序（`client.js:4331-4360` 的 order 值）。
- 分隔线不是包级常量，而是**每个菜单项自己决定**的渲染属性 `separatorBefore`，随该行一起出现/消失 — `@src\dsh-client-ui-workspace\README.zh.md:100`
- 分隔线与危险色的实现：`MenuItemButton({ children, shortcut, icon, disabled, danger, separatorBefore, onSelect })` — `@src\dsh-client-ui-primitives\lib\index.js:3830`
  - `separatorBefore` → 渲染 `role="separator"` 的 `div`（`:3833-3835`）
  - `danger` → 按钮加 `danger` 样式类（`:3839`）——**这正是红色危险项的实现位**
- **注意**：现有 4 项**没有任何一项**使用 `separatorBefore` 或 `danger`（`:3638-3645`、`:3687-3695`、`:3601-3609`、`:3428-3436` 均未传这两个 prop）。截图里的分隔线与红字删除项目前**无对应代码**。

### 1.4 条目协议（扩展点）

条目只收到行身份，其余自理：`sessionId`、`displayTitle`，加上 slot hook `useMenuOpenState`（以及 `useShortcuts`）— 见 `@src\dsh-client-ui-workspace\README.zh.md:100`、`@src\dsh-cordis-client-runner\lib\client.js:5874`。
条目须渲染 `role="menuitem"` 按钮，并在动作后调用 `setMenuOpen(false)` 关闭菜单。

---

## 2. 逐项：中文标签 / file:line / 调用 / 宿主实现

### 2.1 置顶（Pin）— 存在

- 标签：`"menu.pinSession": "置顶会话"` — `@src\dsh-client-ui-workspace\lib\client.js:3921`
- 反向标签：`"menu.unpinSession": "取消置顶"` — `client.js:3922`
- 英文标签：`"menu.pinSession": "Pin session"` — `client.js:4036`
- 菜单组件（order 100，归档行不渲染）：`client.js:3633-3646`；`if (archived) return null;` 在 `:3637`
- 切换逻辑：`client.js:3642` → `(pinned ? unpinSession : pinSession)(sessionId)`
- 注入的客户端回调：`client.js:4185-4192`
- 客户端控制层：`@src\dsh-api-workspace-controller\lib\client.js:161`（`pinSession`）、`:173`（`unpinSession`）
- remote 名：`workspace.pinSession` / `workspace.unpinSession`
  - 声明：`@src\dsh-api-workspace-controller\lib\types\index.js:69-70`（`@Remote('pinSession')` / `@Remote('unpinSession')`）
- 宿主实现：
  - 控制器命令：`@src\dsh-api-workspace-controller\lib\types\commands.js:149`（`pinSession`）
  - 注册表落盘：`@src\dsh-workspace\lib\index.js`（pin 集合，见 `:561-564` 注释段）
- 互斥约束：归档与置顶互斥，Host 侧对已归档会话 pin 会拒绝 — `@src\dsh-api-workspace-controller\lib\types\commands.js:157-159`（`WorkspaceArchivedSessionPinError` → `gateway/bad-request`）

### 2.2 重命名（Rename）— 存在

- 标签：`"rename": "重命名"` — `@src\dsh-client-ui-workspace\lib\client.js:3910`
- 对话框标题：`"rename.session.title": "重命名会话"` — `client.js:3912`
- 菜单组件（order 200）：`client.js:3685-3696` → `requestSessionRename(sessionId, displayTitle)`（`:3692`）
- 对话框（注册在 `shell.overlay`）：`client.js:3706`（`SessionRenameDialog`）；注册处 `client.js:4377-4383`
- 快捷键：`session.rename`，桌面默认 Mod+Alt+G — `@src\dsh-client-ui-workspace\README.zh.md:60`
- remote 名：`session.rename` — 客户端封装 `@src\dsh-api-session-controller\lib\types\client\sessions\manager.js:484-489`
- 宿主实现：`@src\dsh-api-session-controller\lib\index.js`（`@Remote("rename")` 区域，与 `:2588` 的 `openWorkspacePath` 同族）

### 2.3 归档（Archive）— 存在

- 标签：`"menu.archiveSession": "归档会话"` — `client.js:3919`；反向 `"menu.unarchiveSession": "取消归档"` — `client.js:3920`
- 菜单组件（order 400）：`client.js:3424`（`ArchiveSessionMenuItem`）→ `client.js:3433` → `(archived ? unarchiveSession : archiveSession)(sessionId)`
- 「停止并归档」确认对话框：`client.js:3928-3929`（标题/描述文案）、`client.js:4384-4389`（`shell.overlay` 注册）
- 关键行为：静止会话直接归档；有在跑工作的会话 Host 先拒绝，侧栏弹「停止并归档」 — `@src\dsh-client-ui-workspace\README.zh.md:56`
- remote 名：`workspace.archiveSession` / `workspace.unarchiveSession`
  - 客户端：`@src\dsh-api-workspace-controller\lib\client.js:131`（`archiveSession`）、`:149`（`unarchiveSession`）
  - 签名：`@src\dsh-api-workspace-controller\lib\typert.host.js:618`（`archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>`）、`:625`（unarchive）
- 宿主实现：`@src\dsh-api-workspace-controller\lib\types\commands.js:118`（→ `ctx.workspaceRegistry.archiveSession(..., {stopActivity})`）、`:140`（unarchive）
- 落盘实现：`@src\dsh-workspace\lib\index.js:524`（`archiveSession(sessionId, options)`）
  - 无 `stopActivity` 时先问 `workspace/session-activity` waterfall，有活动则抛 `WorkspaceActiveSessionError`（`:529-530`）
  - 写入时**同一笔持久写入里丢掉 pin**（`pinnedSessionIds.filter(...)`）— `:536`
  - `stopActivity: true` 时归档写完后才请 `workspace/session-stop` 停工作（`:538`）
- **归档是纯标记**：`:551` 的 `unarchiveSession` 注释写明「记账槽位从未被触碰，所以会话回到其记录位置」——即归档不移动、不删除任何会话数据。

### 2.4 fork（分叉）— 存在，但截图 8 项里没有

- 标签 key：`menu.fork`（`client.js:3608`）
- 菜单组件（order 300）：`client.js:3599-3610` → `forkSession(sessionId)`（`:3606`）
- 客户端：`client.js:839`（`forkSession`）；注入 `client.js:4234-4235`
- remote：`session.fork` — `@src\dsh-api-session-controller\lib\types\client\sessions\manager.js:460-477`（`:462` 调用 `this.remote.session.fork({sessionId, atSeq?})`）
- 快捷键：`session.fork`，Mod+Alt+F — `client.js:172`

> 截图与实现的最大差异之一：实现里第 3 项是 **fork**，截图第 3 项是「分享任务」。

---

## 3. 截图独有四项的能力考察

### 3.1 「分享任务」— **未找到**

在 `@src` 全量 grep `分享任务|"分享|shareSession|shareLink|session\.share|exportSession`：

- session 分享/分享链接/上传：**无任何匹配**。仅有无关的 "sharing"（如 `dsh-session-telemetry-otel` 的 telemetry sharing 策略、注释里的 "sharing the type"）。
- **唯一相邻的导出能力**是**会话日志导出**，但它不与这张菜单相关：
  - 路由：`SESSION_LOG_EXPORT_PATH = "/api/session.export"` — `@src\dsh-session-log-export\lib\index.js:488`
  - 客户端：`@src\dsh-session-log-export\lib\client.js:12`（`SESSION_LOG_EXPORT_ROUTE`）
  - 形态：**浏览器下载 ZIP**（不是复制链接、不是上传）
    - 下载文件名：`dsh-session-${sessionId}.zip` — `client.js:23`
    - 下载手法：创建 `<a download>` 并 `click()` — `client.js:31-36`
    - 语义：下载**整棵 session 树**（含后代与附件）— `client.js:57-59` 注释「Download one Session tree; concurrent gestures for the same Session share one operation」
  - 入口：**会话头部按钮与 `/export` 斜杠命令**，`client.js:15` 注释「Browser download state shared by the Session Header button and `/export`」——**不是**侧栏行菜单项。

结论：「分享任务」在 `@src` 中没有实现，也**没有**任何 API 可被指向。不猜。

### 3.2 「在独立窗口中打开」— **未找到**

- 全量 grep `window.open(` 仅 6 处，全部与 session 无关：
  - `@src\dsh-client-ui-chat\lib\client.js:12437` — 打开**外部 URL 链接**（`window.open(url, "_blank", "noopener,noreferrer")`）
  - `@src\dsh-client-ui-settings-account\lib\client.js:4352` — 账号联系链接
  - `@src\dsh-client-ui-sidebar-browser\lib\client.js:262` — 浏览器面板的外部 URL
  - `@src\dsh-client-ui-sidebar-terminal\lib\client.js:834` — xterm 预留窗口
  - `@src\dsh-client-ui-sidebar-documentpreview\lib\client.pdf.js:26310` / `client.excel.js:112198` — 文档预览打开 viewer
- grep `openInNewWindow|newWindow|new-window`：命中的是 **pdf.js 内部的 `newWindow` 参数**（`client.pdf.js:1956`、`:25964`）与**无关同名标识符**，不是 DSH 的窗口 API。
- 「独立窗口」的中文标签：**无匹配**。
- `dsh-client-ui-open-in-app` / `dsh-host-open-in-app` **不是**开新窗口：它是**用指定桌面应用打开某个路径**（open / reveal）：
  - 路由常量：`OPEN_IN_APP_APPS_PATH = "/open-in-app/apps"`、`OPEN_IN_APP_ICON_PREFIX_PATH = "/open-in-app/icon"`、`OPEN_IN_APP_OPEN_PATH = "/open-in-app/open"` — `@src\dsh-host-open-in-app\lib\types\shared.js:10,14,18`
  - 宿主注册：`@src\dsh-host-open-in-app\lib\index.js:1126,1129,1132`；三路由在 `:1282`、`:1319`、`:1401`
  - 语义：`open-in-app` 是「application catalog」+「POST /open-in-app/open」按 path 用某个应用打开。
- `dsh-api-session-controller` 里没有任何窗口/多窗口 remote。

结论：无 session 级「独立窗口」机制；能否用于会话=**不存在该能力**。不猜。

### 3.3 「打开文件夹」— 能力存在，但**不在这张菜单**

真实能力 = 「在文件管理器中显示 / 用默认应用打开某个路径」，宿主链路完整：

- 客户端入口包裹：`@src\dsh-client-ui-open-in-app\lib\client.js:433-451`（`openPath`，`action: 'open' | 'reveal'`）
  - `:440` 当 `action === "reveal"` 时构造 reveal 请求
- 标签（这是「显示文件位置」，非「打开文件夹」）：
  - `"path.reveal": "显示文件位置"` — `client.js:709`
  - `"path.revealError": "无法显示文件位置，请重试"` — `client.js:711`
  - 英文：`"path.reveal": "Show file location"` — `client.js:728`
  - 默认项标签：`client.js:262,315,344`（`t("path.reveal")` / `t("path.default")`）
- remote 名：`session.openWorkspacePath`
  - 装饰器：`@src\dsh-api-session-controller\lib\index.js:2588`（`_openWorkspacePath_decorators = [Remote("openWorkspacePath")]`）
  - 签名：`@src\dsh-api-session-controller\lib\typert.host.js:1492` — `openWorkspacePath(request: SessionOpenWorkspacePathRequest, signal: AbortSignal): Promise<SessionOpenWorkspacePathValue>`
  - 请求体：`{ action?: 'reveal'; application?: string; path: string }` — `@src\dsh-api-session-controller\lib\typert.host.js:611`、`@src\dsh-api-remotes\lib\client.js:10868`
- 宿主实现：`@src\dsh-api-session-controller\lib\index.js:3031-3042`
  - `:3033` 先 `verifyDesktopPath(request.path)`（**路径必须是经 Host 校验的映射路径**）
  - `:3034` `action === "reveal"` → `this.revealPath(path, signal)`
  - `:3035` 有 `application` → `openFileApplication(...)`
  - `:3036` 否则 → `openPath(path, signal)`
  - 注入点：`:2867` `this.revealPath = internals.revealPath ?? revealNativePath`
- 原生实现（`explorer.exe`）：
  - 分发：`@src\dsh-native-command\lib\types\path-opener.js:241`（`revealNativePath`）
  - Windows 分支：`:250-259` → `runExplorer(['/select,', explorerTarget(windowsPath)], ...)` —— 即 **`explorer.exe /select,<file URI>`**
  - macOS：`:246-248` → `open -R <path>`；Linux：`:262-264` → `xdg-open <dirname>`（打开父目录）
  - 打开（非 reveal）：`:132-134` `openWindowsPath` → `explorerTarget(path)`；`:113-124` `runExplorer` 显式接受 Explorer 委派退出码 1
  - 可用性判定：`:182-190` `canOpenNativePath`；文件管理器名：`:226-233` `nativeFileManager`（darwin→`finder`、win32/WSL→`explorer`、linux→`directory`）
- 宿主桌面探测：`@src\dsh-api-session-controller\lib\index.js:3016-3022`（`workspaceDesktop()`，返回 `{name, available, fileManager}`）

**参数要点**（易踩坑，源码注释明确写出，`path-opener.js:80-101`）：
- Explorer 自己按逗号与等号切分命令行字段，所以路径里的 `,` `=` 必须转义（`%2C` / `%3D`），否则会打开**另一个**目标且不报错
- Explorer 会拒绝 file URI 里百分号编码的非 ASCII 字符（会退而打开「文档」目录），因此非 ASCII 转义要被还原
- `\\?\` / `\\?\UNC\` 会被 Node 解析成普通盘符/UNC URI；`\\.\` 设备路径不被此 opener 支持

**另一条「打开文件夹」路径**（workspace 层，非 session 行菜单）：
- `"folderError.title": "无法打开文件夹"` — `@src\dsh-client-ui-workspace\lib\client.js:3908`
- 说明这是**工作区目录**相关的打开失败提示，属于目录选择器/工作区流程。

结论：「打开文件夹」的**底层能力确实存在**（reveal/open 一个 Host 路径），但它挂在**文件/交付物控件与会话内路径控件**上，**没有**注册进 session 行菜单。若截图那一项是「打开该会话的工作目录」，需要新写一个菜单项并调用 `session.openWorkspacePath({path: <session.cwd>, action: 'open'|'reveal'})`——**当前无此菜单项**。

### 3.4 「批量操作」— **未找到**

- 全量 grep `批量操作|"批量|batchMode|selectionMode|multiSelect|multi-select`：**无 session 多选实现**。
- session 列表只有两种批量形态，**都不是多选**：
  1. **拖拽排序** — 行 `draggable`，`onDragStart` 写入 `text/plain` 的 session id，`onDragOver`/`onDrop` 处理上/下半区 — `@src\dsh-client-ui-workspace\lib\client.js:1602-1619`；被拖行条件 `const draggable = drag !== void 0 && !row.blank && !row.archived;` — `client.js:1578`
  2. **整组归档/筛选** — `viewOptions` 三选一（隐藏已归档 / 全部对话（显示已归档）/ 仅显示已归档）— `client.js:3888-3890`；`actions.setArchivedFilter(...)` — `client.js:2824`、`:3189`
- 行内**没有** selection state：`SessionNodeItem` 里只有 `selected`（= 当前打开的那个会话，用于高亮）— `client.js:1574`、`:1595`；这不是多选集合。
- 全仓库唯一带「批量选择」语义的地方是 `dsh-schedule` 的 **自动化任务页**（多任务列表 + 删除），与 session 侧边栏无关。

结论：无「批量操作」入口、无选择模型、无支持的批量动作。不猜。

---

## 4. 「删除任务」的宿主实现

### 4.1 会话侧：**不存在删除**

- 设计约束原文：**「没有 Session 删除：会话可以归档但绝不会被删除；已归档的行通过『已归档会话』视图筛选与搜索结果中的取消归档操作原位恢复，删除 Workspace 注册记录不会删除 Session。」** — `@src\dsh-client-ui-workspace\README.zh.md:214`
- slot catalog 也把 shipped rows 穷举为 pin/rename/fork/archive 四项，无 delete — `@src\dsh-cordis-client-runner\lib\client.js:5840`
- session controller 侧无 `session.delete` remote；全仓库 `session.delete|deleteSession|sessionDelete` 仅命中 **SQLite 搜索索引的淘汰**：
  - `_deleteSession(source, id)` — `@src\dsh-session-query-sqlite\lib\index.js:760`
    - `:763-764` `DELETE FROM persisted_docs WHERE session_id = ?` / `DELETE FROM persisted_sessions WHERE id = ?`
    - `:766-767` 同理删 `temp.live_docs` / `temp.live_sessions`
  - 调用处都是**重建索引**：`:771`（`_replacePersistedSession`）、`:788`（`_replaceLiveSession`）
  - **含义**：这是删**搜索索引行**，不是删会话数据；会话本体仍在 session persistence（JSONL）里。
- **没有「移动到回收站」逻辑**：无 trash/回收站相关符号，归档就是唯一接近的「移出视野」机制，且它是**纯标记**（`@src\dsh-workspace\lib\index.js:551-560` 注释：记账槽位从未被触碰）。

### 4.2 定时任务侧：**硬删除**（与截图「删除任务」字面一致）

如果截图指的是**定时任务**（`dsh-client-ui-schedule` 的「自动化任务」），则确有删除：

- 标签：`"delete.action": "删除任务"` — `@src\dsh-client-ui-schedule\lib\client.js:6637`
- 确认对话框文案：`client.js:6638-6643`
  - 标题：`"delete.title": "删除此任务？"`（`:6638`）
  - 描述：`"任务将停止触发，并连同其已保存的任务运行记录一并删除。原会话及其消息仍然保留；已排队的消息不会被撤回。"`（`:6639`）
  - 确认：`"delete.confirm": "确认删除"`（`:6640`）
- 提示：`"toast.deleted": "任务已删除"`（`:6644`）；失败 `"toast.deleteFailed": "无法删除任务"`（`:6645`）
- 客户端调用：`ctx.remote.schedule.delete({...})` — `client.js:5620`、`:6726`；toast 注册 `client.js:6742`（id `schedule.delete-toast`）
- 宿主实现：`@src\dsh-schedule\lib\index.js:2797-2815`（`async delete(request, signal)`）
  - `:2801-2806` 校验任务存在且 `sessionId` 匹配，否则返回 `{deleted: false, code: "schedule_not_found"}`
  - `:2807` `await tasks.delete(request.id)` —— **真删表行**
  - 另一个内部入口：`:2889` `await tasks.delete(id)`
- 硬删除语义（README 原文）：**「删除是硬删除：Host 连同已保存的任务运行记录一起移除存储的任务行，该任务因此停止后续投递、离开 `list` 与 `catalog`，其投递历史不再可读。删除保留原会话和已入队消息」** — `@src\dsh-client-ui-schedule\README.zh.md:42`

### 4.3 「会话侧有没有同类 API」

- **没有**。会话侧最接近的语义 API 是 `workspace.archiveSession`（隐藏，可逆）与 `workspace.unarchiveSession`（恢复）— `@src\dsh-api-workspace-controller\lib\types\commands.js:118`、`:140`。
- 对比：schedule 的 `delete` 是**不可逆硬删**（`tasks.delete`），session 的 `archive` 是**可逆标记**（只改 `archivedSessionIds`）。两者不是同类。

---

## 5. 可直接复用的结论（若将来要补这些菜单项）

| 想加的项 | 现成能力 | 还需做什么 |
|---|---|---|
| 打开文件夹 | ✅ `session.openWorkspacePath({path, action:'open'\|'reveal'})` — `@src\dsh-api-session-controller\lib\index.js:3031` | 新写一个 `sidebar.workspaces.session.menu.item` 条目，取会话 `cwd` 作 `path`；注意路径须过 `verifyDesktopPath`（`:3033`） |
| 在独立窗口中打开 | ⚠️ 有 `window.open`（仅用于外部 URL）— `@src\dsh-client-ui-chat\lib\client.js:12437` | 需自建；当前无 session 路由深链或窗口 API |
| 分享任务 | ⚠️ 有会话日志 ZIP 导出，但入口是会话头部/`/export` — `@src\dsh-session-log-export\lib\client.js:12,23,31-36` | 可把同一 `SessionLogDownloadController` 挂到菜单项；「复制链接/上传」无实现 |
| 批量操作 | ❌ 选择模型不存在（只有拖拽排序 `client.js:1602-1619`） | 需从零设计多选状态 + 批量动作 |
| 删除任务（会话） | ❌ 设计上禁止 — `README.zh.md:214` | 需先改 `@src\dsh-workspace` 的注册表语义并新增 remote |

危险项红字样式已具备：`MenuItemButton` 的 `danger` prop — `@src\dsh-client-ui-primitives\lib\index.js:3830,3839`。

---

## 6. 明确标注为「未找到」的清单

- 「分享任务」菜单项 / session 分享 API / 分享链接 / 上传：**未找到**
- 「在独立窗口中打开」菜单项 / session 窗口 API / 路由 hash 开窗：**未找到**
- 「打开文件夹」菜单项（在 session 行菜单内）：**未找到**（底层 reveal/open 能力存在）
- 「批量操作」菜单项 / 多选选择模型：**未找到**
- `session.delete` / 会话删除 remote / 会话回收站：**未找到**（设计上禁止，见 `README.zh.md:214`）
- 截图中的「分隔线」与「红色危险项」：现有 4 项均未使用 `separatorBefore` / `danger`，**未找到**对应代码
- 「置顶」以外的 7 项中，中文标签字面量唯一能全量匹配的是 `删除任务`，且它属于 `dsh-client-ui-schedule`（定时任务），**不是** session 行菜单
