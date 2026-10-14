# 会话行菜单：新增「打开文件夹 / 批量操作 / 删除会话」方案

调研基线（全部为只读核实，路径下称 `@src`）：
`D:\Workspace\DeepSeek Harness\.dsh-src\dsh\node_modules\@deepseek-ai\`
运行中的 GUI 由桌面应用内置 DSH 提供（`D:\Dev Tools\DeepSeek Harness\resources\app.asar\dsh`），
插件宿主半边改动需**重启桌面应用**，客户端半边 F5 刷新即可。

---

## 0. 结论速览

| 选项 | 可行性 | 现成能力 | 需新写 | 主要风险 |
|---|---|---|---|---|
| 打开文件夹 | ✅ 小 | 宿主 `remote.session.openWorkspacePath({path, action:'reveal'})` 已就绪；会话 cwd 客户端拿得到 | 一个菜单项 + 取路径 + toast | 冷会话可能拿不到 cwd，需宿主回退 |
| 删除会话 | ✅ 中 | 插件宿主已有 `POST /archived-sessions/api/delete`（分离记账 + 日志移入 sessions-trash） | 菜单项 + 二次确认 + 删除后刷新会话目录 | 会话仍被宿主持有（运行中/保留）时 409 |
| 批量操作 | ⚠️ 中偏大 | 插件已有 `/list` `/restore` `/delete` 三个宿主动作 | **必须自建面板**（DSH 内置会话列表没有多选插槽） | 需决定面板形态与批量语义 |

关键约束（决定了「批量操作」的形态）：
DSH 内置侧边栏会话列表**不提供**多选/批量注入点，插件能注入的只有「单行菜单项」。
要做批量，只能让插件**自己开一个侧边栏面板**（`sidebar.panellist` + `main` 面板），
在面板里做多选与批量动作 —— 这与官方 `dsh-client-ui-schedule` 插件（定时任务面板）的做法完全一致。

---

## 1. 已核实接口（含 file:line）

### 1.1 会话行菜单插槽（三项功能的挂载点）

- 渲染点：`@src\dsh-client-ui-workspace\lib\client.js:1645-1664`
  每行 `...` 按钮里 `renderSlot("sidebar.workspaces.session.menu.item", { sessionId, displayTitle })`。
- 内置项注册：同文件 `client.js:4331-4360`
  （pin order 100 / rename 200 / fork 300 / archive 400）。
- 官方插件接入范例：`@src\dsh-cordis-client-runner\lib\client.js:5883`。
- 菜单项 props：`{ sessionId, displayTitle, useMenuOpenState, useShortcuts }`。
- 菜单原子组件：`@src\dsh-client-ui-primitives\lib\index.js`
  `MenuItemButton({ children, shortcut, icon, disabled, danger, separatorBefore, onSelect })`（index.js:3830）、`Menu`、`Checkbox`、`HoverCard` —— 均已导出（index.js:12381 的 export 列表），我们插件客户端已能 `require("@deepseek-ai/dsh-client-ui-primitives")`。
- 可用图标（已核实存在）：`IconFolderOpenOutlineRegular` / `IconFolderOpenRegular`、`IconTrashOutlineRegular`、`IconArchiveOutlineRegular`、`IconArchiveOffOutlineRegular`。
  （**没有** `IconFolderOutlineRegular`。）

### 1.2 打开文件夹

- 客户端封装：`@src\dsh-client-ui-open-in-app\lib\client.js:439-452`
  `openPath(path, action, application)` → `remote.session.openWorkspacePath({ path, action: 'reveal' })`。
- 可用性探测：同文件 `client.js:468-475`（`remote.session.canOpenWorkspacePath()`）。
- 宿主实现：`@src\dsh-api-session-controller\lib\index.js:3031-3043`；
  `verifyDesktopPath`（同文件 3062-3071）要求路径是**已注册的宿主路径**（工作区内的路径都算，会话 cwd 必然满足）。
- Windows 落地行为：`@src\dsh-native-command\lib\types\path-opener.js:250-259`（`explorer.exe /select,<file URI>`，即"在资源管理器中定位"）。
- 官方文案参考：`@src\dsh-client-ui-open-in-app\lib\client.js:709`（`"path.reveal": "显示文件位置"`）。
- 取会话 cwd（客户端）：`ctx.get('sessions').list.getSnapshot().byId[sessionId].cwd`
  —— 列表条目为 `{ ...summary, blank, updatedAt, title? }`（`@src\dsh-api-session-controller\lib\types\client\sessions\manager.js:670-717`），`cwd` 由 summary 合并进条目（manager.js:736，比较逻辑见 692/742）。
- 回退：冷会话（磁盘上才有 header 的）可能没有 cwd → 走我们插件宿主新增路由读取会话 header 拿 cwd。

### 1.3 删除会话

- DSH 本体**不提供**删除会话能力，且文档明确设计如此：
  `@src\dsh-client-ui-workspace\README.zh.md:214` ——「会话可以归档但绝不会被删除」；全库无 delete-session API。
- 我们插件已自有该能力：宿主 `POST /archived-sessions/api/delete` →
  `detachSession` 分离工作区记账槽 + 把 `sessions\<proj>\<id>` 与 `storages\session_projcache\sessions\<id>.json` 一起 `rename` 到 `<DSH_HOME>\sessions-trash\<ISO>__<id>\`。
- 限制：会话仍被宿主打开（运行中/保留）时返回 409（`lib\index.js` 的 live 判定）→ 菜单项应置灰或给出明确提示。
- 删除后让侧边栏立刻消失：调用客户端会话目录刷新（插件已实现 `refreshSessionCatalog`，`lib\client.js` 内），因为宿主侧边栏只在显式 `refreshList()` 时才移除缺失会话。

### 1.4 批量操作

- DSH 内置列表**无多选**：`@src\dsh-client-ui-workspace\lib\client.js:1574`、`1593-1595` 只有单选高亮；全库 grep `batch|multiSelect|批量` 在会话侧无命中。
- 自建面板的两个注册点（官方 `dsh-client-ui-schedule` 为完整范例）：
  1. 侧边栏面板条目：`sidebar.panellist` 注册 `{ name, id, order, label }` + 图标组件
     —— `@src\dsh-client-ui-sidebar\lib\client.js:190`（渲染）、`452-486`（`syncPanels` → `ctx.layout.selectPanel(id)`）、`503`（插槽声明）。
  2. 面板本体：注册到 `main` 插槽，`{ name: 'main', key: <面板 id>, component, locale }`
     —— 范例 `@src\dsh-client-ui-schedule\lib\client.js:6793-6810`。

---

## 2. 实施拆分（建议顺序）

### 阶段 1 —— 打开文件夹（最小、可当天完成）

1. 客户端注册菜单项 `sidebar.workspaces.session.menu.item`，id `archived-sessions.reveal-folder`，order 500，图标 `IconFolderOpenOutlineRegular`。
2. 取路径：先 `ctx.get('sessions')?.list?.getSnapshot()?.byId[sessionId]?.cwd`；取不到再调宿主新路由（建议 `POST /archived-sessions/api/describe { sessionId }` → `{ cwd }`，复用现有 header 读取逻辑）。
3. 点击：`remote.session.canOpenWorkspacePath()` 为真才启用 → `remote.session.openWorkspacePath({ path, action: 'reveal' })`；失败弹 toast。
4. inject 需要 `slots`（已有）、`sessions`（当前需确认声明）、`remote`。
5. 测试（`tools/test-client.cjs`）：断言菜单项注册参数正确；断言点击后调用参数为 `{ path: <cwd>, action: 'reveal' }`；断言无 cwd 时该项 disabled。

### 阶段 2 —— 删除会话（中等）

1. 同一个菜单里加危险项「删除会话」（`danger: true` + `separatorBefore: true`），图标 `IconTrashOutlineRegular`。
2. 点击 → 二次确认（说明「日志会移入 sessions-trash，可手动取回」）→ `POST /delete`。
3. 成功后：调用 `refreshSessionCatalog()`（已有）+ 结果提示（已有消息通道）+ 若在归档页则刷新列表。
4. 409/运行中：菜单项置灰并给出「该会话仍被宿主打开」的 tooltip；或点击后提示重启。
5. **待决策**：是否也允许删除**未归档**的普通会话（当前仅归档页有删除入口）。若允许，需说明语义差异（同样搬日志进回收站）。

### 阶段 3 —— 批量操作（较大，UI 为主）

1. 新建侧边栏面板：`sidebar.panellist` 注册 `{ name:'dsh-archived-sessions', id, order, label:'会话管理' }` + 图标；`main` 面板承载页面。
2. 面板内容：宿主 `/list`（归档会话，含 `logsMissing`/`live`/`directory`）+ 客户端快照合并；提供筛选（全部/已归档/日志缺失）与多选（全选/反选/按工作区分组）。
3. 批量动作：
   - 批量恢复：逐个调 `/restore`；
   - 批量删除：逐个调 `/delete`，**串行 + 进度条 + 失败汇总**（跳过 live 会话并报告）；
   - （可选）批量打开文件夹。
4. 交互注意：面板内复用现有 `api`（`createApi`），错误逐条展示；操作完成后统一 `refreshSessionCatalog()`。
5. 测试：面板渲染、选择模型（全选/半选）、批量调用的串行顺序与失败统计。

---

## 3. 已确认的四点决策（用户 m01013）

1. **「删除会话」对未归档的普通会话也开放** → 需扩展宿主删除逻辑，不再只认归档会话；
   对未归档会话的语义：分离工作区记账槽 + 日志移入 `sessions-trash`（与归档会话一致），
   并在 UI 上明确提示「日志会移入回收站、可手动取回」。
2. **「打开文件夹」打开会话的 cwd**（不回落工作区目录）。
3. **「批量操作」做成插件自有的侧边栏面板**。
4. **右键点击会话行也要弹出菜单**（不只 `...` 按钮）。

### 3.1 右键菜单的落地方式（已核实，m01013 决策 4）

DSH **没有**把右键暴露成插件插槽：全库 `onContextMenu` / `"contextmenu"` 在侧边栏会话行处
零命中（仅存在于终端、文档预览、复制菜单等无关位置），会话行 `div` 只绑了
`onClick` / `onPointerEnter` / `onPointerLeave` / 拖拽（`@src\dsh-client-ui-workspace\lib\client.js:1590-1619`），
`...` 菜单的开合状态是行组件内部的 `useState`（`client.js:1579-1580`），外部无法触达。

但行上有稳定的 DOM 锚点：

- `client.js:1590-1593`：会话行 `div` 带 `data-row-key="session:<uuid>"`、`role="treeitem"`；
- `client.js:1804-1805`：内置实现本身就用 `querySelectorAll("[data-row-key]")` + `element.dataset.rowKey` 枚举行。

因此做法是插件在 `document` 上注册**委托式** `contextmenu` 监听：

```
const row = event.target.closest('[data-row-key^="session:"]')
const sessionId = row?.dataset.rowKey.slice("session:".length)
```

命中则 `preventDefault()`，并用**插件自己的 Menu**（不是内置那个）在指针位置打开，
菜单项与 `...` 里的三项一致。菜单用 `Menu` 的 `getAnchorRect` 直接锚到指针：

- `Menu` 支持 `getAnchorRect`（portal 模式）：文档见 `@src\dsh-client-ui-primitives\lib\index.js:3905-3910`
  ——「supply the anchor rect directly … instead of measuring the Menu's own wrapper span」；
- 期望形状是 **`DOMRect` 风格**：实现读 `r.left / r.right / r.top / r.bottom`（`index.js:3993-4001`），
  故右键时返回 `{ left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY }`，
  菜单会出现在光标右下 4px 并自动贴边收敛（`MARGIN = 12`，`index.js:3985-4004`）；
- `portal: true` 让菜单挂到 `document.body`，不被侧边栏裁剪。

注意点：
- 委托监听必须 `ctx.effect(...)` 注册并在卸载时移除（避免重复挂载/泄漏）；
- 只在能解析出 `sessionId` 时接管，其余右键仍走浏览器默认菜单；
- 内置 `...` 菜单仍是「打开」入口，右键是同一套动作的第二入口，两者共用同一份动作实现。

---

## 5. 修订后的实施顺序（依据 m01013）

### 阶段 1 —— 打开文件夹（会话行菜单 + 右键，最小）

1. 抽出**共享动作层**（打开文件夹 / 删除会话 两个动作 + 各自的可用性判断与提示），
   供「会话行 `...` 菜单项」「右键菜单」两处调用。
2. `...` 菜单注入：`sidebar.workspaces.session.menu.item`，id `archived-sessions.reveal-folder`，order 500，图标 `IconFolderOpenOutlineRegular`。
3. 路径：`ctx.get('sessions')?.list?.getSnapshot()?.byId[sessionId]?.cwd`；缺失时回退宿主新路由
   （`POST /archived-sessions/api/describe { sessionId }` → `{ cwd }`，复用现有 header 读取）。
4. 点击：`remote.session.canOpenWorkspacePath()` 通过后 `remote.session.openWorkspacePath({ path, action: 'reveal' })`。
5. 右键：按 3.1 注册委托监听，菜单里放同一动作。
6. 测试：菜单项注册参数、点击参数 `{ path, action:'reveal' }`、无 cwd 时 disabled、
   以及右键委托能正确解析 `data-row-key` 并只对会话行生效。

### 阶段 2 —— 删除会话（含未归档会话，中等）

1. 宿主：放宽 `deleteSession` 的归档前提，支持未归档会话（同步更新 README/CHANGELOG 语义）。
2. 菜单项（`...` 与右键共用）：「删除会话」，`danger: true` + `separatorBefore: true`，图标 `IconTrashOutlineRegular`。
3. 二次确认（说明日志进 `sessions-trash` 可手动取回）→ `POST /delete` → `refreshSessionCatalog()` + 结果提示。
4. 运行中/被宿主保留（409）：菜单项置灰 + tooltip，点击后给出明确失败原因。
5. 测试：未归档会话可删、409 路径、删除后目录刷新被调用。

### 阶段 3 —— 批量操作面板（较大）

1. `sidebar.panellist` 注册 `{ name:'dsh-archived-sessions', id, order, label:'会话管理' }` + 图标；
   `main` 注册面板本体（范例 `@src\dsh-client-ui-schedule\lib\client.js:6793-6810`）。
2. 面板：宿主 `/list` + 客户端快照合并；筛选（全部/已归档/日志缺失）；多选（全选/反选/分组）。
3. 批量动作：批量恢复、批量删除（**串行 + 进度 + 失败汇总**，跳过 live 并报告）、可选的批量打开文件夹。
4. 完成后统一 `refreshSessionCatalog()`。
5. 测试：面板渲染、选择模型、批量串行顺序与失败统计。

---

## 4. 三项功能的挂载点一句话总结

- 打开文件夹、删除会话 → 挂在**会话行 `...` 菜单**（`sidebar.workspaces.session.menu.item`），单行语义，改动小。
- 批量操作 → **插件自有侧边栏面板**（`sidebar.panellist` + `main`），因为内置列表没有多选插槽。
