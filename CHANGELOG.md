# 更新日志

版本号与 `package.json` 的 `version` 一致，每个版本对应一个 git tag（`git tag -l`）。每个小节可以直接当作 GitHub Release 的正文。

## v1.0.7 — 2026-10-14

### 修复

- **设置页不再闪出一批「未归属工作区」的裸会话 ID**。已归档列表的一行是否有意义，取决于宿主能不能找到它的日志目录——`logsMissing` 才是判据。首次渲染时主机列表还没回来（`hostSessions` 为空），于是**每一行都判不出来**，`isDeleted` 全部返回 false，9 个早已删除的会话就被画成了行：标题退化成 `session-b623054d-…` 这样的原始 ID，工作区为空，于是聚成一个「未归属工作区」分组。等 `/list` 一到，它们又被全部丢弃——这就是那一闪。现在**在拿到宿主结论之前不画任何行**，并显示「正在读取已归档会话…」而不是「当前没有已归档的会话」（后者在此时是错的）。
- **批量操作面板不再列出整个侧边栏的会话**。旧实现读的是 shell 的会话目录（`sessions.list`），那是侧边栏画的全部内容——实测能列出 **34 行**，其中包含完全无关的工作区、`default-workspace` 里的会话，以及 `95d9cb13-…` 这种没有标题的行。面板现在**以宿主的已归档列表为行来源**，会话目录只用来给这些 id 补标题、cwd 和运行状态（实测从 34 行降到 9 行，且都是已归档会话）。
- **日志已删除的会话不再可以勾选**。`reload` 此前从不写入 `logsMissing`，所以 `gone` 恒为 false，一个日志早已进回收站的会话照样能给勾上，然后「恢复」恢复不出东西、「删除」也删不掉东西。现在宿主行携带该标记，这类行的复选框**置灰**（实测 9 行中 8 个灰掉，只有仍存活的 1 个可选）。
- **批量操作面板的列表可以滚动了**。面板本身不拥有滚动容器，父级 `main` 区域在内容超长时是**裁掉**而不是滚动（实测面板高 2832px、可视 902px，`overflowY` 为 `hidden`），折叠线以下的行根本点不到。现在列表自带 `max-height:calc(100vh - 320px)` + `overflow-y:auto`，工具条固定在上方（实测 `scrollHeight 674 > clientHeight 582`，可滚动）。

### 验证

- `node tools/test-client.cjs` → **110/110**：新增 5 项检查——首帧不画任何行且显示「正在读取」、宿主列表到达后行才出现、面板不画存在于目录但未归档的会话、日志已删除的会话复选框被禁用（全选只选中 2 个而不是 3 个）、以及原有的面板行为全部保留。
- 真实浏览器驱动验证（headless Chrome + CDP，`dsh --profile web`）：批量面板从 **34 行降到 9 行**（全部为已归档会话）；9 个复选框中 **8 个禁用**（日志已在回收站）；列表 `scrollHeight 674 > clientHeight 582` 且 `overflow-y:auto`，可滚动；设置页在打开「已归档会话」的连续四次采样中**均未出现「未归属工作区」**。
- `node tools/test-setup.cjs` → 11/11、`node tools/test-host.cjs` → 27/27。

## v1.0.8 — 2026-10-14

### 修复

- **已删除的会话彻底不再出现在列表里**。上一版让宿主把「日志已进回收站」的已归档 id 标为 `logsMissing` 交给前端过滤，这一版改为**宿主直接不返回它们**——`listArchivedSessions` 在 `logsMissing` 时 `continue`。原因是这类行在**两个**入口都必须消失：设置页与批量面板，而前端过滤只在设置页生效。
- **`isDeleted` 对「宿主没返回这一行」的判定反了**。这是上一版引入的回归：宿主曾把幽灵行带着 `logsMissing: true` 发出来，前端据此丢弃；宿主改为**完全不发**之后，`hostById.get(sessionId)` 变成 `undefined`，而 `undefined?.logsMissing === true` 与 `undefined?.directory === null` **都为 false**，于是幽灵行反而被判为「未删除」而画了出来。判据补上第三种情形：**已归档 id 在宿主列表里根本没有对应行 = 已删除**（宿主已经判断过并丢弃了它，不是「未知」）。实测设置页的裸 ID 从 18 个降到 2 个，且剩下这 2 个是同一个**真实**已归档会话（无投影缓存，标题按设计回退成 ID）。

### 验证

- `node tools/test-client.cjs` → **111/111**。原「snapshot alone keeps the session listed」「snapshot-only row falls back to the session id as its title」两条**断言的是缺陷行为本身**（快照里的 id 即使宿主不认也要画出来、标题退化成裸 ID），已改为反向断言：宿主省略的已归档 id **不列出行、不画行、不产生标题节点**；另新增「宿主行携带 `logsMissing` 时不列出」的检查。
- `node tools/test-host.cjs` → **27/27**。原「a deleted session is listed as archived with its log missing」断言 `row.logsMissing === true`，改为「a deleted session leaves the archived list entirely」断言 `row === undefined`。
- 真实浏览器驱动验证（headless Chrome + CDP，`dsh --profile web`，端口 19605）：设置页「已归档会话」的连续三次采样**全部 clean**，不再出现「未归属工作区」；页面文本里的裸会话 ID 计数 **18 → 2**；宿主 `/list` 返回 **1** 条（该端口还有的幽灵行全部消失）。
- `node tools/test-setup.cjs` → 11/11。

## v1.0.6 — 2026-10-14

### 修复

- **点「删除任务」不再多出一行「确认删除」**。第一次点击删除时，插件既把该行的标签改成「确认删除」，又同时把这次返回当成一条结果渲染成菜单顶部的提示行——于是「确认删除」在菜单里出现两遍，其中一行夹在「归档会话」和「打开文件夹」之间。现在**把「已武装」和「有结果」分开处理**：`needsConfirm` 只负责改标签（它本身就是确认提示），只有真正产生了结果（已删除／失败／不可用）才渲染提示行。
  - 判据是「提示行是否与标签说同一件事」：旧代码里唯一会返回 `kind:"confirm"` 的就是删除的第一次点击，所以过滤 `needsConfirm` 不会吞掉任何别的反馈。

### 验证

- `node tools/test-client.cjs` → **105/105**：新增 2 项回归检查——点击「删除任务」后菜单文本里「确认删除」**恰好出现 1 次**（2 次即回归），且菜单内不出现任何 `.as-menu-note` 提示行。
- 在隔离复现环境里用真实浏览器驱动验证（headless Chrome + CDP，`dsh --profile web`）：点开某会话行的 `...` 菜单后点击真正的 `button[role=menuitem]`「删除任务」，菜单文本由 `…归档会话 / 打开文件夹 / 删除任务` 变为 `…归档会话 / 打开文件夹 / 确认删除`，`确认删除` 计数为 **1**、`.as-menu-note` 数量为 **0**。
- `node tools/test-setup.cjs` → 11/11、`node tools/test-host.cjs` → 27/27。

## v1.0.5 — 2026-10-14

### 变更

- **右键菜单改为直接打开侧边栏自己的那一个**。此前右键会弹出插件自绘的菜单，里面只有本插件提供的「打开文件夹」「删除任务」两项，而点击行尾 `...` 弹出的是 DSH 自己的菜单（置顶/重命名/分叉/归档 + 本插件两项）——同一个行上的两个入口给出两套内容，用户在右键里找不到置顶、重命名、分叉、归档。现在右键不再自绘菜单，而是**按一下该行自己的 `...` 触发按钮**，于是两个入口打开的必然是同一个菜单：内容永久一致，且以后 DSH 给行菜单加项时右键会自动跟上。
  - 之所以不是「把 DSH 的四项抄进自绘菜单」：槽项由槽的所有者渲染，DSH 对渲染做了归属校验（`SlotOwnershipError`/`StaleAuthorizationError`），插件无法取用别的插件注册进 `sidebar.workspaces.session.menu.item` 的组件；而抄一遍文案与快捷键意味着永久跟着 DSH 改。
  - 触发按钮的定位依赖侧边栏行的结构：行的 `rowActions` 簇（`class` 含 `rowActions`，CSS Module 保留了可读后缀）里的第一个 `button`。这是 DSH 未公开的 DOM 约定，因此 `findRowMenuTrigger` 做了两级回退（`rowActions` 簇 → 行尾 `span` 内的第一个 `button`），两级都找不到时**不做任何事**（不 `preventDefault`），把右键还给浏览器——空白行本来就没有这个按钮。
  - 菜单现在锚定在该行的 `...` 按钮处，而不是鼠标位置：这是复用 DSH 自己菜单的必然代价。
- 删掉随之无用的自绘菜单代码：`RowContextMenu` 组件、`mountRowMenu` 的 `ReactDOM.createRoot` 挂载、`AtomMenu` 依赖，以及 `.as-row-menu`/`.as-menu-anchor`/`.as-menu-fallback` 三条样式。`RowMenuItem`/`RowMenuItems`（`...` 菜单里那两项）保留不变。

### 验证

- `node tools/test-client.cjs` → **103/103**：右键相关的 5 项改为断言新契约——点中会话行时 `preventDefault` 且**恰好按了一次该行的触发按钮**；没有触发按钮的行（空白行）被完全放过；非会话行、非右键、已被处理的右键既不 `preventDefault` 也不按按钮。
- 在隔离复现环境里用真实浏览器驱动验证（headless Chrome + CDP，profile 副本 + `dsh --profile web`）：对会话行派发真实的 `contextmenu` MouseEvent 后，页面上出现的菜单项为 `取消置顶 / 重命名 / 分叉会话 / 归档会话 / 打开文件夹 / 删除任务`——六个入口齐备，与本插件通过 `sidebar.workspaces.session.menu.item` 注册的两项合并无误。
- `node tools/test-setup.cjs` → 11/11、`node tools/test-host.cjs` → 27/27。

## v1.0.4 — 2026-10-14

### 修复

- **「打开文件夹」成功后不再回显路径**。旧实现在调用成功时返回一条成功提示 `打开文件夹：D:\…`，菜单里因此多出一行又长又会折行的文字，把菜单撑开；而「文件管理器已经跳过去了」本身就是反馈，不需要再用文字重复一遍路径。现在成功时安静返回（`null`，不渲染任何提示），失败与「不可用」仍然照旧说明原因——那些情况没有别的信号，安静就等于没反应。

### 验证

- `node tools/test-client.cjs` → **100/100**：新增 2 项检查——断言成功点击「打开文件夹」确实调用了 `openWorkspacePath({path, action:"reveal"})`，且菜单文本里**完全不出现** `打开文件夹：`。
- `node tools/test-setup.cjs` → 11/11、`node tools/test-host.cjs` → 27/27；隔离复现环境冷启动无 `did not activate`。

## v1.0.3 — 2026-10-14

修复 v1.0.2 误判的那个整机级故障：真正的成因不是 `dsh.profile.bundles` 登记被摘，而是浏览器半边在激活时抛了异常。

### 修复

- **「打开文件夹」解析 `remote.session` 的方式改对了**（`lib/client.js` 的 `sessionRemote`）。旧实现先 `ctx.get("remote")` 拿到命名空间，再用属性访问取 `.session`；cordis 把 `remote.session` 作为**生成的成员**下发，属性访问要求该**点号名**出现在 fiber 自己的 `inject` 里，而本插件只声明了 `"remote"`，于是抛 `cannot get property "remote.session" without inject`。这个异常从 `createRowActions` 一路逃出 `apply`，fiber 落到 `FAILED`；DSH 随后重新激活它，客户端启动审计恰好在这次重试窗口里采样到 `LOADING`，于是整页抛 `web boot: 1 entry did not activate\ndsh-archived-sessions: loading`，主进程把它记为 `web-boot` 致命错误并弹框、应用进不去——**与 profile 登记无关，只要插件被挂载就必然复现**，这正是 v1.0.2 归因错误的地方（`repair` 补登记对它无效，因为它本来就没丢登记）。
  现在读点号名走 `ctx.get("remote.session")`：cordis 的 `ctx.get` 本就按「不带 inject 要求」读服务（源码注释原话 *Read a service from the store without the inject requirement*），实测返回带 `openWorkspacePath` 的服务对象。**没有**把 `"remote.session"` 加进 `inject`——服务缺席时那会让 fiber 永久停在 `pending`，同样过不了启动审计。顺带把「打开文件夹」从「解析不到、直接置灰」恢复成可用。
- 逐处复核了同一条链路上其余的服务读取：`restoreViaService`、`refreshSessionCatalog`、`archiveViaService`、行菜单的 `listEntry` 本来就是「只 `ctx.get`、拿到对象后才判方法」的写法，只有 `sessionRemote` 在 `get` 之后多做了一次属性访问，无需再改。

### 验证

- 在隔离 profile（`DSH_HOME` 指向复制的 profile 副本 + `dsh --profile web`）里复现了原故障：headless Chrome 的控制台抓到与桌面端崩溃日志逐字相同的 `Error: web boot: 1 entry did not activate\ndsh-archived-sessions: loading`（`assets/index-5SrrfWpU.js:126`）。修好后同一环境**不再出现该错误**，其余插件照常激活。
- `node tools/test-client.cjs` → **98/98**：新增 3 项回归检查——用一个在 `remote` 上定义「读 `session` 就抛 `cannot get property "remote.session" without inject`」的访问器来复刻 cordis 的真实形态，断言 `apply` 不抛、行菜单仍注册、「打开文件夹」仍可用；两处服务桩由 `remote` 改为 `remote.session`（按真实服务拓扑，`remote` 只是命名空间）。
- `node tools/test-setup.cjs` → 11/11、`node tools/test-host.cjs` → 27/27。

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
