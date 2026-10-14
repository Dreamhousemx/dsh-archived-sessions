# 更新日志

版本号与 `package.json` 的 `version` 一致，每个版本对应一个 git tag（`git tag -l`）。每个小节可以直接当作 GitHub Release 的正文。

## v1.0.1 — 2026-10-12

修复「在设置页删除已归档会话后，该会话又在工作区/侧边栏里冒出来」这一缺陷。

### 修复

- **删除不再取消归档**。旧实现把「先取消归档」当成状态一致化的一步，但 `workspaceRegistry.unarchiveSession` 的语义是**把会话放回它记录的工作区位置**（DSH 源码注释原话：*the accounting slot was never touched, so the session returns to its recorded position*），而侧边栏只按 `archivedSessionIds` 决定隐藏与否——于是删一次就等于恢复一次。现在删除只做「分离工作区记账 + 日志移入回收站」，归档标记保留。
- 归档标记保留后，页面按「宿主的归档列表里仍有它、但日志目录已经不在了」把这种**已删除行**隐藏起来：deleted 行既不能再删，也不该再显示成一条可恢复的会话。为此 `GET /list` 的每一行新增布尔字段 `logsMissing`（`directory` 为空且宿主未打开该会话时为 `true`），客户端据此跳过该行；客户端同时把「没有日志目录且未运行」当作同一结论，所以**只刷新页面**（宿主半边还没重新加载）也能让此前删不掉的那一行消失。
- 页脚那行提示（「恢复后会话会回到它原来的工作区位置；删除会保留归档标记……」）整行删掉：它把内部实现（归档标记）写进了用户界面，既啰嗦又容易让人以为删除是个半成品。删除契约由页面简介那行说明，`messages.hint` 与对应 CSS 一并移除。
- **删除成功后主动拉一次会话目录**（客户端 `sessions.refresh()`）。第 2 项只搬文件，而 DSH 的会话列表只在显式拉取时更新：侧边栏仍会照旧画它早先学到的那一行，而归档标记只在「默认」过滤视图下负责隐藏——开着「显示已归档会话」时，或者行已从工作区分组分离出去时，它就会以「未分组」的样子重新露出来（用户实测截图即为此）。删除后拉一次目录，宿主列表里已无该会话，这一行当场消失；拉取不可用时安静跳过，不把已成功的删除报成失败。

### 新增

- **侧边栏会话行菜单新增两项**（`sidebar.workspaces.session.menu.item`，同时支持行尾 `...` 与右键）：
  - 「打开文件夹」：在系统文件管理器里定位该会话的工作目录。走 DSH 自己的 `remote.session.openWorkspacePath`（与 `open-in-app` 等插件同一实现），并先问 `canOpenWorkspacePath`；没有 `cwd` 或平台不支持时置灰并给出原因。
  - 「删除任务」：与设置页同一个宿主路由与同一份行动作实现，**两步点击**——首点只把该行文案变成「确认删除」（菜单重新打开后自动解除待确认），再点才真正执行，删完同样拉一次会话目录；宿主仍持有该会话（运行中）时置灰。
- 宿主新增 **`POST /archived-sessions/api/describe`**：返回单个会话的 `cwd` / `archived` / `live` / `logsMissing`，供行菜单决定两个入口的可用性。菜单**只在打开时才请求**，关着的行不花宿主调用。
- 行菜单的右键由插件自己接管：在 `document` 上装一个委托监听，只认 `data-row-key="session:<id>"` 的行（DSH 渲染行时的稳定属性），其他行、左键、以及已被别人 `preventDefault` 的右键一律不碰；菜单通过 `react-dom/client` 挂到 `document.body` 上的插件自有容器，避免被侧边栏裁切。
- 侧边栏新增**「批量操作」面板**（`sidebar.panellist` 轨道按钮 + `main` 面板体，同一个 id 配对注册）：列出 shell 当前全部会话，逐行勾选后一次性归档 / 恢复 / 删除。
  - 删除与行菜单同一条红线：**两步确认**（首点把按钮改名为「确认删除 N 个会话」），逐个**串行**执行（每次调用都在改同一份工作区记账，并发写会和持久化快照抢锁），结束后报告成功/失败数量与首个失败原因，并拉一次会话目录。
  - 单个会话失败不会中断整批：批量是便利，不是事务。
  - 「归档所选」没有插件宿主路由，调用 shell 自带的 `workspaces.archiveSession`（DSH 本体把归档视为工作区变更）。
  - **重入守卫用的是 ref 而不是 `busy` 状态**：第二次点击会赶在 React 重渲染出禁用按钮之前到达，只有同步标志能拦住它——否则重复点击会对同一批会话各执行一次（测试实测为 4 次而不是 2 次）。
  - **改选会解除待确认**：确认按钮的文案带着数量，不能让它熬过它所针对的那次选择；否则「确认删除 2 个会话」可能对 5 行执行。
- 宿主半边**尚未重新加载时不再整行变灰**：`/describe` 问不到（刚升级还没重启 DSH，返回 404）时，`cwd` 回退到 shell 自己的会话目录，且「问不到是否运行中」不会被当成运行中——否则升级后侧边栏每个会话的「删除任务」都会是灰的。

### 验证

- `node tools/test-host.cjs` → **27/27**（新增：删除绝不调用 `unarchiveSession` 且归档标记存活；被删除的会话在 `list` 里仍带 `logsMissing: true` 且 `directory: null`；`describe` 返回单个会话的 `cwd`/归档/运行中/日志缺失事实。变异校验：把旧的 `unarchiveSession` 调用注回去会有 3 项失败）
- `node tools/test-client.cjs` → **95/95**（新增：宿主报 `logsMissing` 的行、以及「没有日志目录且未运行」的行，即使还在客户端归档快照里也不渲染；点击删除走二次确认、确认后调用一次 `sessions.refresh()`、删除后的行离开页面；`refreshSessionCatalog` 走的是 `sessions` 服务的 `refresh()`，服务缺席时返回 `false` 不抛错。行菜单部分：注册契约、只在打开时 `describe`、只提供「打开文件夹 / 删除任务」、删除两步走完才调宿主并拉目录、**`/describe` 404 时仍按客户端 `cwd` 提供「打开文件夹」且不误置灰删除**、右键委托监听只认会话行。批量面板部分：轨道按钮与面板体同 id 配对注册、初始 0 选中、全选后计数跟随、批量删除两步确认、串行各调一次宿主、归档走 shell 服务、改选解除待确认、**重复点击不会把同一批跑两遍**。变异校验：去掉两个跳过判断有 2 项失败，去掉目录刷新有 1 项失败，去掉删除的确认门有 2 项失败，去掉 `describe` 的 `cwd`/`live` 回退有 2 项失败，去掉重入守卫会把 2 次执行变成 4 次）
- `node tools/verify-live.cjs` → 只读探活（需重启 DSH 后 `describe` 才在线：宿主半边按 URL 缓存模块）
- `node tools/test-setup.cjs` → **11/11**（`repair` 的读写与拒绝路径：补回被摘掉的登记、补在末尾、已登记时一字节不写、依赖/声明/`node_modules` 三者任一缺失时明确报错、跟随联接、保留无关字段与缩进格式、`bundleState` 对「装了但没登记」的判定。变异校验：让 `repair` 不写盘 → 7/11；去掉 `dsh.bundle.patch` 守卫 → 10/11；改成覆盖而非追加 → 10/11）

## v1.0.2 — 2026-10-14

修复「装了本插件后，整个 DeepSeek Harness 桌面版一启动就报错、进不去」这一整机级故障。

### 修复

- **`repair` 子命令 + `repair.cmd`（新增）**：把被 DSH 自己摘掉的 `dsh.profile.bundles` 登记补回来。故障成因在 DSH 本体：`@deepseek-ai/dsh-plugin-manager` 每次成功 pnpm 操作后都用 `reconcile`（`lib/index.js:238-266`）重写 `dsh.profile.bundles`，对每个已登记的包名要求 `bundleManifest`（同文件 `226-229`）仍能解析到声明了 `dsh.bundle.patch` 的包，**解析不到就静默删名**；而紧随其后的补登记循环（`247-256`）只处理 `dependencies` 里**新增**的名字（`if (beforeDeps.has(name)) continue`），被删掉的老名字永不自动恢复。触发窗口是 pnpm 的 `-N` 卸载：它先解开 profile `node_modules` 里的联接再重新链上，`reconcile` 恰在「联接暂时不存在」的瞬间读盘。于是**装任何别的插件都可能连带把本插件的登记摘掉**——依赖仍在、联接仍在，但 profile 不再挂载，loader 卡在 `loading`，`web boot: 1 entry did not activate`，DSH 直接弹「请关闭应用并重新安装」。`repair` 与 `reconcile` 的判据严格对齐（依赖存在 + `node_modules` 可读 + 包自己声明了 `dsh.bundle.patch`，三者缺一即报错而非写一个挂不起来的名字），幂等，不跑 pnpm；写完 HMR 自动重载，通常无需重启。
- 崩溃日志的判读方式与升级/装插件后的自检步骤写进 README：**任何时候用 DSH 插件管理器装/卸过插件，跑一次 `status.cmd`，`bundles` 不是 `listed` 就 `repair.cmd`**。

### 验证

- `node tools/test-setup.cjs` → **11/11**（新增，见上一节末条）。`test-host.cjs` 27/27、`test-client.cjs` 95/95 不受影响；`verify-live.cjs` 在本机修复后 **ALL LIVE CHECKS PASSED**（`channel` 回到 `bundle (official)`、`server: plugin route mounted`、客户端 bundle 已注册）。

## v1.0.0 — 2026-10-05

首个公开发布版本。

### 功能

- 在 **设置 → 已归档会话** 新增独立一页，集中列出全部已归档会话（DSH 自带的能力只在侧边栏按工作区零散展示）。
- 搜索框：按会话标题、会话 ID、工作区标题或路径过滤；工作区下拉框可只看某一个工作区。
- 每行显示标题、工作区标题 + 路径、会话 ID、最后更新时间与 `运行中` 标记。
- **恢复**：把会话取出归档状态、回到它原来的工作区位置。
- **删除**：内联二次确认后删除。正在运行的会话只能恢复、不能删除（按钮置灰并给出原因），重启 DSH 后即可删除。
- 排版完全对齐原生设置页：`max-width:760px` 栏目、18/13/14/12px 字号阶梯、只用 `--dsw-*` 设计 token、滚动交给设置外壳自己（页面不自建高度或内层滚动区）；按钮与输入框优先复用平台内置的 `@deepseek-ai/dsh-client-ui-primitives`，取不到时降级为同款式的原生元素。

### 实现要点

- 宿主半边 `lib/index.js` 注册 `GET/POST /archived-sessions/api/{ping,list,restore,delete}`，自带信任围栏（只接受回环或 `trustedHosts` 的 Host、非 cross-site、`Origin` 与 `Host` 同名）。
- **删除会话是 DSH 本体没有的能力**（`0.2.0-rc.2` 的 22 个 session remote 里没有任何删除接口，持久化层只追加），因此由宿主自己实现为「安全下架 + 移入回收站」：先取消归档 → 从工作区记账里 `detachSession` → 把会话目录与投影缓存移到 `<DSH_HOME>\sessions-trash\<时间戳>__<session id>\`。**没有任何数据被真正抹掉**；被宿主持有的会话（运行中）拒绝删除（HTTP 409）。
- 浏览器半边 `lib/client.js` 注册 `settings.section` 插槽，沿用原生 `archived-sessions` 这个 id，因此继承 DSH 自带的归档图标；只依赖两个平台内置模块（`react`、`dsh-client-ui-primitives`），不需要 `dsh.client.external`。
- 安装路线：官方 bundle 包（`dsh.bundle.patch` + `cordis.patch.yml`，包名登记进 `dsh.profile.bundles`），另有本地 profile patch 路线作为备用；两条路线互斥。

### 安装

```bat
git clone git@github.com:Dreamhousemx/dsh-archived-sessions.git
cd dsh-archived-sessions
bundle-install.cmd
```

等价的官方命令：`dsh plugin --profile desktop add "link:<本仓库所在的绝对路径>"`。详见 [README](README.md#安装)。

### 验证

- `node tools/test-host.cjs` → **20/20**（宿主半边隔离单测，临时 `DSH_HOME`）
- `node tools/test-client.cjs` → **45/45**（浏览器半边离线单测，自带最小 React 桩）
- `node tools/verify-live.cjs` → 只读探活，需要一个正在运行的实例

### 要求

DeepSeek Harness 桌面版（针对 `0.2.0-rc.2` 的插件契约开发）、Windows；不需要单独安装 Node.js。许可证 MIT。
