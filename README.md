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

- **DSH 本体升级**：profile 的 `package.json` / `pnpm-lock.yaml` / `node_modules` / `cordis.patch.yml` 都会被保留（DSH 不做 profile 迁移），插件照旧生效。升级完跑一次 `status.cmd`，若 `channel` 变成 `none`，重跑 `bundle-install.cmd`（幂等）并按输出提示刷新或重启。
- **插件自身升级**：`link:` 安装方式下改源码即可；宿主半边重新导入需要重启一次 DSH，浏览器半边刷新页面即可。若改了 `package.json` 或 `cordis.patch.yml`，再跑一次 `bundle-install.cmd` 让 pnpm 重新解析（并让 HMR 重挂）。

## 使用

1. 刷新页面（F5）。
2. 打开 **设置 → 已归档会话**。
3. 搜索 / 选工作区 → 点 `恢复` 或 `删除`。

## 验证

```
status.cmd                       :: 安装渠道、联接/依赖、loader 记录、宿主路由、客户端 bundle 注册情况
node tools\verify-live.cjs       :: 只读探活：ping / list / 客户端 bundle 是否真的能取到
node tools\test-host.cjs         :: 宿主半边隔离单测：20 项，临时 DSH_HOME，不碰真实数据
node tools\test-client.cjs       :: 浏览器半边离线单测：45 项，自带最小 React，真实调用组件并检查元素树
```

`test-host.cjs` 覆盖：ping（含客户端 bundle 上报的三种状态）、list 的字段合并、信任围栏（跨站 / 陌生 Host / trustedHosts / `Origin: null` / Origin 不匹配 / 匹配）、非法会话 ID 400、未知路径 404、错误方法 405、恢复、运行中删除 409、删除（分离工作区记账 + 日志与投影缓存移入回收站）、未归档会话删除、日志目录缺失时的删除。

`test-host.cjs` 与 `test-client.cjs` 完全离线自包含（不依赖 DSH 在运行，`test-client.cjs` 自带最小 React 桩）；`verify-live.cjs` 需要一个正在运行的实例。

`test-client.cjs` 覆盖：bundle 的导出契约（`apply` / `inject`）、`settings.section` 注册（id / order / label / props 工厂 / 样式只注入一次）、**排版契约**（根节点不自建滚动容器、不写死高度、采用原生 `max-width:760px` 与 13/14/12px 字号阶梯、复用 `--dsw-radius-*` / `--dsw-alias-border-l4` 等 token、所有规则都限定在本页根节点下）、以及真实渲染结果——标题与计数、按工作区的分组与路径、`运行中` 提示条、删除按钮在运行中置灰且带原因、空闲会话可删除、无数据时的空态、注入 hook 缺失时不崩页、**平台原子库缺失时降级为原生 `<button>` / `<input>` 仍可用**。

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

## 删除策略（重要）

删除**不是**从任何注册表里抹掉记录——DSH 没有这个能力。本插件的删除是一次「安全下架 + 移入回收站」：

1. 若会话仍在归档集合里，先取消归档（保持状态一致）。
2. 从工作区记录里分离会话（`WorkspaceRecord.detachSession`），这样侧边栏不再出现它。
3. 把日志目录 `<DSH_HOME>\sessions\<project key>\<session id>\` 与投影缓存 `<DSH_HOME>\storages\session_projcache\sessions\<id>.json` 一起移动到
   `<DSH_HOME>\sessions-trash\<ISO 时间戳>__<session id>\`。

**没有任何数据被真正抹掉**，想彻底清空自己删 `sessions-trash` 即可。响应里的 `trashedTo` 就是落地目录。

**运行中/被保留的会话会被拒绝删除（HTTP 409）**：宿主仍持有它的会话对象，日志句柄可能还开着，直接改目录名在 Windows 上会和写入竞态，可能损坏日志。**恢复**任何时候都允许；要删除这样的会话，重启一次 DeepSeek Harness（重启后没有会话被宿主打开）或先关闭它即可。同理，如果一个被归档的会话正是你此刻正在使用的会话，它的删除按钮会是灰的——设计如此。

## 组成

```
package.json          dsh.bundle.patch + dsh.client（platform: web, exports["./client"]）声明；包名被 dsh.profile.bundles 引用即挂载
cordis.patch.yml      bundle 自带的 loader 记录（官方包路线靠它挂载；本地路线用 profile 的 patch）
lib/index.js          宿主半边：注册 GET/POST /archived-sessions/api/{ping,list,restore,delete}
lib/client.js         浏览器半边：导出的 ESM bundle，注册一个 settings.section
lib/setup.cjs         install / revert / bundle-install / bundle-remove / status 的全部逻辑（.cmd 只负责找 node 与 dsh 并调用它）
install.cmd revert.cmd status.cmd          本地 patch 路线 + 状态报告
bundle-install.cmd bundle-remove.cmd       官方包路线（调用 dsh plugin … add/remove）
tools/test-host.cjs   宿主半边隔离单测
tools/test-client.cjs 浏览器半边离线单测（最小 React 桩）
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
- 标题来自 `storages/session_projcache`；缓存缺失时回退到会话 ID。
- 修改 `lib/index.js` 后需重启 DSH 才会加载新宿主代码（客户端半边只需刷新）。
- 本地 patch 路线与官方包路线互斥（同一个 entry id 会被挂载两次）；`status.cmd` 的 `channel` 一行会指出当前生效的是哪条。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)；当前版本 `1.0.0`（tag `v1.0.0`）。

## 许可证

[MIT](LICENSE)
