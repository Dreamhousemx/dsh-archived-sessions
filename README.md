# dsh-archived-sessions

在 DeepSeek Harness 的 **设置 → 已归档会话** 里增加一个页面：按工作区搜索、**恢复**、**删除**已归档会话。

> 背景：DSH 0.2.0-rc.2 自带的「已归档会话」只在侧边栏里按工作区零散展示，没有集中的检索/管理页面，而且**全库没有任何删除会话的能力**（UI 与宿主 API 都没有，持久化层只追加）。本插件补齐这两点。

## 要求

- DeepSeek Harness 桌面版（本插件针对 `0.2.0-rc.2` 的插件契约开发：`dsh.bundle.patch` / `dsh.client` bundle、`settings.section` 插槽、`workspaceRegistry`）。
- Windows（安装脚本是 `.cmd`；脚本内部执行的都是跨平台可用的等价命令，手动执行同样可行）。
- 不需要单独装 Node.js：脚本会依次找 PATH 上的 `node`、DSH 自带运行时 `<DSH_HOME>\dsh-runtimes\...\node.exe`、`%DSH_DIR%` 下的运行时；都找不到时设 `DSH_DIR`（DSH 安装目录）或 `DSH_CLI`（`dsh.cmd` 的绝对路径）即可。
- `status.cmd` / `verify-live.cjs` 默认连 `http://127.0.0.1:19387`；覆盖方式分别是 `DSH_WEB_URL`（或 `--url <origin>`）与 `DSH_BASE_URL`。profile 默认是 `desktop`（`DSH_PROFILE`），DSH 家目录默认是 `%USERPROFILE%\.dsh`（`DSH_HOME`）；`--profile` 传的是 **profile 目录**，`--name` 传的是 **profile 名**。

---

## 功能

- 设置里的独立一页「已归档会话 / Archived Sessions」，列出**全部已归档会话**。
- 搜索框：按会话标题、会话 ID、工作区标题或路径过滤。
- 工作区下拉框：只看某一个工作区的已归档会话。
- 每行显示：标题、工作区标题 + 路径、会话 ID、最后更新时间、`运行中` 标记。
- 每行操作：
  - **恢复**：把会话从归档状态取出，回到它原来的工作区位置（调用 DSH 自己的 `unarchiveSession`）。
  - **删除**：内联二次确认后删除（见下方「删除策略」）。
  - 正在运行的会话：**只能恢复，不能删除**（按钮置灰，页面顶部有提示条）；重启 DSH 后即可删除。
  - 删除过的会话会从本页与侧边栏一起消失（它保留归档标记，页面按「日志已不在」识别并跳过这种行，删除后还会主动拉一次宿主会话目录，让侧边栏里那一行立刻消失——包括「未分组」里那种）。
- 侧边栏的会话行菜单（`...` 与右键）里增加两项：
  - **打开文件夹**：在系统文件管理器里定位该会话的工作目录（与 DSH 其他「打开文件夹」动作同一实现）。
  - **删除任务**：与设置页同一套删除流程；第一次点击只是把该行变成 **确认删除**，再点一次才真正执行，删完同样会拉一次会话目录让侧边栏那一行当场消失。
  - 行不可用时两项分别置灰：没有 `cwd`（或平台不支持打开目录）时「打开文件夹」置灰；会话正在运行时「删除任务」置灰（与设置页同一条规则）。
  - 宿主半边尚未重新加载（刚升级、还没重启 DSH，`/describe` 返回 404）时不会整行变灰：`cwd` 回退到 shell 自己的会话目录，而「问不到是否运行中」不会被当成运行中。
- 侧边栏新增「批量操作」面板（轨道上的一个按钮）：列出 shell 当前全部会话，逐行勾选后一次性 **归档 / 恢复 / 删除** 所选。
  - 删除与行菜单同一条红线：**两步确认**（首点把按钮改名为「确认删除 N 个会话」），逐个串行执行，结束后报告成功/失败数量与首个失败原因。
  - 串行而非并发，是因为每次调用都在改同一份工作区记账，并发写会和持久化快照抢锁。
  - 「归档所选」没有插件宿主路由，调用的是 shell 自带的 `workspaces.archiveSession`（DSH 本体把归档视为工作区变更，不对外暴露删除式接口）。
- 排版对齐 DSH 原生设置页：`max-width:760px` 栏目、18px 标题 / 13px 说明 / 14px 行标题 / 12px 次要信息的字号阶梯、只使用 `--dsw-*` 设计 token；容器与滚动条交给设置面板本身，页面不自建高度或内层滚动区。按钮与搜索框优先复用平台内置控件（`@deepseek-ai/dsh-client-ui-primitives`），取不到时降级为同款式的原生元素。

## 安装

两条路线，**只能选一条**：两条同时生效时宿主会把同一个路由挂两次，报 `webserver: duplicate prefix route "/archived-sessions/api"`（`status.cmd` 会把这种情况直接标成 `BOTH`）。

### 方式 A：官方包路线（推荐，DSH 升级后仍然有效）

```
bundle-install.cmd            :: 默认 profile：desktop
```

它执行的就是 DSH 给所有插件用的官方安装动作（把下面的路径换成**本仓库所在的绝对路径**，脚本会自动取自己所在的目录；DSH 的 `parseInstallSpec` 只接受绝对路径）：

```
dsh plugin --profile desktop add "link:<本仓库所在的绝对路径>"
```

即用桌面版自带的 pnpm 把本包 `add` 进 profile，再由 DSH 自己把包名登记进 `dsh.profile.bundles`（`reconcile`）。装完 profile 会多出两处：

- `package.json` → `dependencies["dsh-archived-sessions"] = "link:<本仓库所在的绝对路径>"`
- `package.json` → `dsh.profile.bundles` 末尾追加 `dsh-archived-sessions`

loader 记录来自**本包自带的** `cordis.patch.yml`（`dsh.bundle.patch`），所以完全不用动 profile 的 `cordis.patch.yml`，也不需要目录联接。

`link:` 保持「源码即安装」的实时语义（profile 的 `node_modules\dsh-archived-sessions` 是指向本目录的联接）；若换成 `file:`，pnpm 会复制一份、受 `files` 过滤、改源码后必须重装。

> **关于 pnpm 的供应链策略**：`bundle-install.cmd` / `bundle-remove.cmd` 默认会附加 `--config.minimumReleaseAge=0`。pnpm 11 要求依赖发布满 24 小时，如果 profile 里固定了发布不满 24 小时的版本，不加这个开关 `add` / `remove` 都会以 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 失败（`pnpm-workspace.yaml` 里的 `minimumReleaseAgeExclude` 拦不住「锁文件校验」这一步）。想保留严格策略就加 `--strict-release-age`，等那些版本满 24 小时后再装。

### 方式 B：本地 patch 路线（不联网、不装包、不改 profile 的 package.json）

```
install.cmd          :: 默认 profile：%USERPROFILE%\.dsh\profiles\desktop
```

安装脚本只做两件可回滚的事：

1. 建一个目录联接：`<profile>\plugins\archived-sessions` → 本仓库目录。
2. 往 `<profile>\cordis.patch.yml` 追加一行 loader 记录（原文件先备份为 `cordis.patch.yml.dsh-archived-sessions.bak`）：

```yaml
# dsh-archived-sessions: Settings → 已归档会话
- insert:
    - id: archived-sessions
      name: './plugins/archived-sessions/lib/index.js'
```

DSH 会自动重载 profile patch，**宿主半边立即生效、无需重启**。

手动等价操作：建联接 + 追加上面这段即可；`--profile` / `--source` / `--url` 参数见 `node lib/setup.cjs status`（脚本本身会打印实际路径）。

### 生效范围

| 半边 | 何时生效 |
| --- | --- |
| 宿主（HTTP 路由） | 保存 patch 后由 profile 监听器立即挂载；**改 `lib/*.js` 的代码要重启 DSH 才会重新导入**（loader 按 URL 缓存模块） |
| 浏览器（设置页） | 刷新页面（F5）即加载；客户端 bundle 的版本号来自文件 `stat`，改完刷新即可 |

方式 A 下引发挂载的是 profile `package.json` 的 `dsh.profile.bundles` 变化，HMR 监听它并自动重载，所以同样无需重启；只有「同名依赖已存在（重装/升级）」时 DSH 才会要求重启。

### 随 DSH 升级 / 自身升级

- **DSH 本体升级**：profile 的 `package.json` / `pnpm-lock.yaml` / `node_modules` / `cordis.patch.yml` 都会被保留（DSH 不做 profile 迁移），插件照旧生效。升级完跑一次 `status.cmd`，若 `channel` 变成 `none`，重跑 `bundle-install.cmd`（幂等）并按输出提示刷新或重启。**另外：任何时候用 DSH 的插件管理器装/卸了别的插件，也跑一次 `status.cmd`——若显示 `bundles : NOT listed in dsh.profile.bundles` 就跑 `repair.cmd`**（成因见下面「装了、却"整机启动失败"」一节）。
- **插件自身升级**：`link:` 安装方式下改源码即可；宿主半边重新导入需要重启一次 DSH，浏览器半边刷新页面即可。若改了 `package.json` 或 `cordis.patch.yml`，再跑一次 `bundle-install.cmd` 让 pnpm 重新解析（并让 HMR 重挂）。

## 使用

1. 刷新页面（F5）。
2. 打开 **设置 → 已归档会话**。
3. 搜索 / 选工作区 → 点 `恢复` 或 `删除`。

## 验证

```
status.cmd                       :: 安装渠道、联接/依赖、loader 记录、宿主路由、客户端 bundle 注册情况
repair.cmd                       :: 修复「依赖在、但 dsh.profile.bundles 里的登记被我 DSH 自己弄丢了」（见下文）
node tools\verify-live.cjs       :: 只读探活：ping / list / 客户端 bundle 是否真的能取到
node tools\test-host.cjs         :: 宿主半边隔离单测：27 项，临时 DSH_HOME，不碰真实数据
node tools\test-client.cjs       :: 浏览器半边离线单测：95 项，自带最小 React，真实调用组件并检查元素树
node tools\test-setup.cjs        :: 安装器隔离单测：11 项，临时 profile 目录，只验证 repair 的读写与拒绝
```

`test-setup.cjs` 覆盖：`repair` 能把被 `reconcile` 丢掉的登记补回来、补在末尾而不打乱既有顺序、已被登记时**一个字节都不写**（幂等）、依赖不存在 / 包自己没声明 `dsh.bundle.patch` / `node_modules` 里没有该目录时明确拒绝、跟随联接读到真实元数据、保留 manifest 里无关字段与原有缩进换行格式、以及 `bundleState` 对「装了但没登记」这个恰好需要 repair 的状态判定准确。

`test-host.cjs` 覆盖：ping（含客户端 bundle 上报的三种状态）、list 的字段合并、信任围栏（跨站 / 陌生 Host / trustedHosts / `Origin: null` / Origin 不匹配 / 匹配）、非法会话 ID 400、未知路径 404、错误方法 405、恢复、运行中删除 409、删除（分离工作区记账 + 日志与投影缓存移入回收站）、**删除绝不取消归档（否则会话会被"恢复"回工作区）**、**被删除的会话在 list 里仍带 `logsMissing: true`**、未归档会话删除、日志目录缺失时的删除、**`describe` 返回单个会话的 `cwd` / 归档 / 运行中 / 日志缺失事实（行菜单据此决定按钮是否置灰）**。

`test-host.cjs` 与 `test-client.cjs` 完全离线自包含（不依赖 DSH 在运行，`test-client.cjs` 自带最小 React 桩）；`verify-live.cjs` 需要一个正在运行的实例。

`test-client.cjs` 覆盖：bundle 的导出契约（`apply` / `inject`）、`settings.section` 注册（id / order / label / props 工厂 / 样式只注入一次）、**排版契约**（根节点不自建滚动容器、不写死高度、采用原生 `max-width:760px` 与 13/14/12px 字号阶梯、复用 `--dsw-radius-*` / `--dsw-alias-border-l4` 等 token、所有规则都限定在本页根节点下）、以及真实渲染结果——标题与计数、按工作区的分组与路径、`运行中` 提示条、删除按钮在运行中置灰且带原因、空闲会话可删除、**点击删除后确实走二次确认、并且在删除成功后调用 `sessions.refresh()` 拉一次会话目录**（`refreshSessionCatalog` 不可用时安静跳过）、**宿主报 `logsMissing` 的已删除行不渲染**、无数据时的空态、注入 hook 缺失时不崩页、**平台原子库缺失时降级为原生 `<button>` / `<input>` 仍可用**。

侧边栏行菜单部分另有覆盖：`sidebar.workspaces.session.menu.item` 注册（id / order / 与设置页互不串用的 props 工厂）、**菜单打开时才向宿主 `describe`（关着不花宿主调用）**、只提供「打开文件夹 / 删除任务」两项、**删除是两步（首点只改文案为「确认删除」，再点才调用宿主删除并拉一次会话目录）**、**宿主半边尚未重新加载（`/describe` 返回 404）时仍按客户端自己的 `cwd` 提供「打开文件夹」，且不会把「问不到是否运行中」当成运行中而误置灰**、以及右键：在 `document` 上装一个委托监听、只接管 `data-row-key="session:<id>"` 的行，其他行、左键、已被别人 `preventDefault` 的右键都不碰。

批量操作面板部分：`sidebar.panellist` 轨道按钮与 `main` 面板体**用同一个 id 配对注册**、轨道按钮只画图标不写字、面板列出的是 shell 自己的会话目录、初始「已选择 0 个会话」、每个会话一个复选框、全选后计数跟随、**批量删除同样是两步（首点只把动作改名为「确认删除 N 个会话」）**、确认后**逐个串行执行一次宿主调用并拉一次目录**、结束后报告「已完成 N 个会话」；**改选会解除待确认、重复点击也不会把同一批跑两遍**（重入守卫用 ref 而不是 `busy` 状态，因为第二次点击赶在 React 重渲染出禁用按钮之前到达）；「归档所选」没有插件宿主路由，走的是 shell 自带的 `workspaces.archiveSession`。

## 卸载 / 回滚

方式 A（官方包路线）：

```
bundle-remove.cmd
```

它执行 `dsh plugin --profile desktop remove dsh-archived-sessions`：摘掉依赖、把包名从 `dsh.profile.bundles` 移除，并顺手清掉 `node_modules` 里遗留的联接。之后刷新页面即可。

方式 B（本地 patch 路线）：

```
revert.cmd
```

恢复 `cordis.patch.yml`（优先用备份），并删除 `plugins\archived-sessions` 这个联接（只删联接，不动源目录），随后刷新页面即可。

### 迁移 / 灾难回滚

- **从方式 B 迁到方式 A**：先 `revert.cmd`，再 `bundle-install.cmd`。顺序不能反，反了就是上面那个「同一个路由挂两次」的报错。
- 迁移前 profile 的备份在 `<profile>\.plugin-manager\pre-bundle-migration\`：`cordis.patch.yml`（1650 B，含方式 B 的 loader 记录）、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- `dsh plugin` 是「纯 pnpm 转发」：**pnpm 失败时不会回滚 `pnpm-lock.yaml`**（内存快照回滚只存在于应用内的 `install_bundle` 服务）。所以安装失败后先把备份的 `pnpm-lock.yaml` 复制回去再用 `bundle-install.cmd` 重试。
- 刚 `bundle-remove` 就立刻 `bundle-install`，Windows 上可能因联接尚未释放而报 symlink 失败（pnpm `forceSymlink`）；等几秒重试，或重启 DSH 后再装。

### 装了、却“整机启动失败”（`web boot: 1 entry did not activate — dsh-archived-sessions: loading`）

**症状**：桌面版一启动就弹错误框「部分插件或配置可能损坏，请关闭应用并重新安装」，崩溃日志（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log`）里写着 `Error: web boot: 1 entry did not activate` 并指名 `dsh-archived-sessions: loading`；`status.cmd` 则显示 `bundles : NOT listed in dsh.profile.bundles`，而依赖和联接都好好的。

**成因（DSH 本体的缺陷，不是插件坏了）**：`@deepseek-ai/dsh-plugin-manager` 在**每一次**成功的 pnpm 操作后都会用 `reconcile`（`lib/index.js:238-266`）重写 `dsh.profile.bundles`。它对每个已登记的包名调用 `bundleManifest(name, dir, anchor)`（同文件 `226-229`）确认「还能解析到一个声明了 `dsh.bundle.patch` 的包吗」，**解析不到就静默把名字从列表里删掉**：

```js
const bundles = previous.filter((name) => {
  if (!beforeDeps.has(name) && !dependencies.includes(name)) return true;
  return dependencies.includes(name) && bundleManifest(name, dir, anchor) !== void 0;
});
```

而紧随其后的补登记循环（同文件 `247-256`）只处理 `dependencies` 里**新增**的名字（`if (beforeDeps.has(name)) continue`）——所以被删掉的老名字永远不会自动回来。触发窗口是 pnpm 自己的 `-N` 卸载：它先解开 profile `node_modules` 里的联接、再重新链上，而 `reconcile` 正好在那个「联接暂时不存在」的瞬间读盘。于是：**装别的插件（哪怕完全无关，例如 `dsh-mcp-connector`，日志里那次是 `Packages: +7 -28`）→ 本插件的联接恰好不在 → 登记被永久摘除**。依赖仍在、`node_modules` 联接仍在，但 profile 再也不会挂载它，loader 里那一项就卡在 `loading`，整个 web boot 因此失败。

**修复**：

```
repair.cmd            :: 只补回被 reconcile 丢掉的那一半登记，不跑 pnpm
```

它做的事与 `reconcile` 的判据完全对齐：只有当**依赖存在**、**`node_modules` 里那个包能被读到**、**且它自己声明了 `dsh.bundle.patch`** 时，才把包名补回 `dsh.profile.bundles` 末尾；任一条件不满足都会明确报错而不是写一个挂不起来的名字。幂等——已登记时不写一个字节。写完 profile 的 `package.json` 变化会被 HMR 监听到并自动重载，**通常不用重启**（`status.cmd` 里的 `channel` 会变成 `bundle (official)`、`server` 变成 `plugin route mounted`）。

> 建议：以后用 DSH 的插件管理器装/卸任何插件之后，跑一次 `status.cmd`；若 `channel` 不是预期的渠道，`repair.cmd` 一下即可。这一点已在上面「随 DSH 升级 / 自身升级」一节里提过——现在有了专门的命令。

## 删除策略（重要）

删除**不是**从任何注册表里抹掉记录——DSH 没有这个能力。本插件的删除是一次「安全下架 + 移入回收站」：

1. 从工作区记录里分离会话（`WorkspaceRecord.detachSession`），这样它不再挂在任何工作区分组下。
2. 把日志目录 `<DSH_HOME>\sessions\<project key>\<session id>\` 与投影缓存 `<DSH_HOME>\storages\session_projcache\sessions\<id>.json` 一起移动到
   `<DSH_HOME>\sessions-trash\<ISO 时间戳>__<session id>\`。
3. **归档标记保留**（不调用 `unarchiveSession`）。这正是 v1.0.1 修掉的那个 bug：`unarchiveSession` 的语义是「把会话放回它记录的工作区位置」，而侧边栏只按 `archivedSessionIds` 决定隐藏与否——所以删除时取消归档，等于删一次就恢复一次。归档标记留着，会话才不会回到工作区。
4. 页面（与侧边栏）靠「日志已经不在」把这种已删除行藏起来：`GET /list` 对每行给出 `logsMissing`（`directory` 为空且会话未被宿主打开时为 `true`），占位行不渲染；客户端同时把「没有日志目录且未运行」视为同一结论，因此宿主半边还没重新加载（只按了 F5）时也能马上生效。
5. **删除后主动拉一次会话目录**（`sessions.refresh()`，即 DSH 客户端「重新读取会话列表」的那个调用）。第 2 步只是搬文件，DSH 的会话列表只在显式拉取时才会变，所以侧边栏可能还留着一行它早先学到的记录——而**归档标记只负责「默认视图里不显示」**：如果侧边栏开着「显示已归档会话」，或者行已经从工作区分组里分离出去，它就会以「未分组」的样子露出来。拉一次目录，宿主列表里已经不含它，这一行才会当场消失。

侧边栏行菜单里的「删除任务」走的是同一条路径（同一个宿主 `POST /delete`），区别只在入口：菜单里是一次「先确认再删」的两步点击。两个入口共用同一份 `createRowActions`，所以置灰规则（运行中不可删、无 `cwd` 不可打开文件夹）不会出现两套说法。

代价是宿主状态里会留一个指向已删日志的归档 id（DSH 本体没有「彻底忘掉一个会话」的接口，持久化层只追加）；它在页面与侧边栏都不可见，重启后也不会复活。要真正清空，自己删 `sessions-trash` 即可——响应里的 `trashedTo` 就是落地目录。

**运行中/被保留的会话会被拒绝删除（HTTP 409）**：宿主仍持有它的会话对象，日志句柄可能还开着，直接改目录名在 Windows 上会和写入竞态，可能损坏日志。**恢复**任何时候都允许；要删除这样的会话，重启一次 DeepSeek Harness（重启后没有会话被宿主打开）或先关闭它即可。同理，如果一个被归档的会话正是你此刻正在使用的会话，它的删除按钮会是灰的——设计如此。

## 组成

```
package.json          dsh.bundle.patch + dsh.client（platform: web, exports["./client"]）声明；包名被 dsh.profile.bundles 引用即挂载
cordis.patch.yml      bundle 自带的 loader 记录（官方包路线靠它挂载；本地路线用 profile 的 patch）
lib/index.js          宿主半边：注册 GET/POST /archived-sessions/api/{ping,list,restore,delete,describe}
lib/client.js         浏览器半边：导出的 ESM bundle，注册设置页、会话行菜单（`...` 与右键）与「批量操作」侧边栏面板
lib/setup.cjs         install / revert / bundle-install / bundle-remove / repair / status 的全部逻辑（.cmd 只负责找 node 与 dsh 并调用它）
install.cmd revert.cmd status.cmd          本地 patch 路线 + 状态报告
bundle-install.cmd bundle-remove.cmd       官方包路线（调用 dsh plugin … add/remove）
repair.cmd                                 补回被 DSH 的 reconcile 摘掉的 dsh.profile.bundles 登记
tools/test-host.cjs   宿主半边隔离单测
tools/test-client.cjs 浏览器半边离线单测（最小 React 桩）
tools/test-setup.cjs  安装器隔离单测（临时 profile 目录）
tools/verify-live.cjs 对运行中的实例做只读验证
CHANGELOG.md          版本变更记录（每个版本对应一个 git tag）
```

宿主半边只依赖两个服务：`webServer`（注册 `kind: 'prefix'` 路由）与 `workspaceRegistry`（归档状态、工作区归属、`unarchiveSession`、`detachSession`）；`sessions` 用 `ctx.get('sessions')` 机会式读取，用来判断会话是否仍被宿主持有（即“运行中”）。路由自带信任围栏：只接受回环或 `webRuntime.trustedHosts` 里的 Host、`sec-fetch-site` 非 cross-site、并且 `Origin` 与 Host 同名。

浏览器半边只 `require("react")`（平台内置模块）与 `@deepseek-ai/dsh-client-ui-primitives`（同样是平台内置模块，属于 seed 模块表，**不需要**写进 `dsh.client.external`；取不到时自动降级），通过自己的宿主路由取数，不依赖任何未声明的外部包。

### 排版对齐原生的具体取值（照抄自内置设置页）

| 项 | 取值 | 来源 |
| --- | --- | --- |
| 栏目 | `max-width:760px`，`display:flex;flex-direction:column;gap:12px`，**不写 height / padding / overflow** | `ui-settings-plugins` `PluginsSettingsSection.module.css` |
| 滚动 | 完全交给设置面板的 `.options`（`flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto`） | `ui-settings-general` `SettingsPanel` |
| 标题 | `<h2>` `margin:0;font-size:18px;font-weight:600` | 同上（面板**不**给 section 渲染标题，自己写不重复） |
| 说明 / 计数 | 13px/20px，`--dsw-alias-label-tertiary` | 同上 |
| 行卡片 | `border:.5px solid var(--dsw-alias-settings-card-stroke)`、`background:var(--dsw-alias-settings-card-fill)`、`border-radius:var(--dsw-radius-xl)`、`padding:12px 14px` | `ui-settings-models` 行卡片 |
| 行标题 / 次要行 | 14px/20px 与 12px/18px | `ui-settings-general` `.row/.title/.description` |
| 按钮 | primitives `Button`，`size:"sm"`（28px / 12px / 18px / `--dsw-radius-sm`），危险动作用 `--dsw-alias-state-error-primary` | primitives `Button.module.css` |
| 输入 / 下拉 | 高 32px、`.5px solid var(--dsw-alias-border-l4)`、`--dsw-radius-md`、focus 用 `--dsw-alias-state-business-primary`；`<select>` 补 `appearance:none` + 12×12 chevron | `ui-settings-models` 输入配方 |
| 空态 | `1px dashed var(--dsw-alias-border-l3)` + `--dsw-radius-lg` | 同上 |

两条踩坑记录（都写进了离线单测做回归）：

- `--dsw-alias-label-error` 在整套主题里**从未定义**（用了等于不生效），危险色必须用 `--dsw-alias-state-error-primary`；警告色同理用 `--dsw-alias-state-warn-label`。
- primitives `Input` 把调用方的 `className` 放在**外层 `span`** 上（内层 `<input>` 只带它自己的 class），所以搜索框的宽度/弹性要写给外层 `.as-search`，而内层视觉值由 primitives 自己的 CSS 提供。

## 已知边界

- 页面只列**已归档**的会话（这是需求本身）；未归档会话不在此页出现。
- 删除过的会话会在宿主里留下一个归档标记（DSH 本体没有「彻底忘掉一个会话」的接口），但它在本页与侧边栏都不可见（页面按 `logsMissing` 跳过），重启也不会自己回到工作区。想连标记一起清掉只能改 `<DSH_HOME>\storages\workspace.json` 的 `archivedSessionIds`。
- 标题来自 `storages/session_projcache`；缓存缺失时回退到会话 ID。
- 修改 `lib/index.js` 后需重启 DSH 才会加载新宿主代码（客户端半边只需刷新）。
- 本地 patch 路线与官方包路线互斥（同一个 entry id 会被挂载两次）；`status.cmd` 的 `channel` 一行会指出当前生效的是哪条。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)；当前版本 `1.0.1`（tag `v1.0.1`）。

## 许可证

[MIT](LICENSE)
