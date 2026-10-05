# 更新日志

版本号与 `package.json` 的 `version` 一致，每个版本对应一个 git tag（`git tag -l`）。每个小节可以直接当作 GitHub Release 的正文。

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
