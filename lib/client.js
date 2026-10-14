/**
 * Archived Sessions — browser half.
 *
 * Contributes one `settings.section` page (已归档会话 / Archived Sessions) that
 * lists every archived session, searches it by title, session id or workspace,
 * restores it (archive flag off) and deletes it (archive flag kept, log directory moved
 * to `<DSH_HOME>/sessions-trash/`, never erased).
 *
 * This file is a hand-written client bundle: DSH's browser loader
 * (`@deepseek-ai/dsh-client-modules`) executes `window.__ModuleLoader__.load({ id, factory })`
 * and calls `factory(require)` at materialization time, so every side effect —
 * including CSS injection — must live inside the factory. The module exports
 * exactly `apply` and `inject`, matching the shape shipped plugins use.
 */
window.__ModuleLoader__.load({
	id: "dsh-archived-sessions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		// ReactDOM is the tree the shell itself mounts with. It is only needed for
		// the right-click menu (the plugin owns that overlay, since the sidebar owns
		// the rows); without it the `...` menu still works and only right-click is
		// skipped, so the failure is contained instead of blanking the plugin.
		const ReactDOM = (() => {
			try {
				return require("react-dom/client") || null;
			} catch {
				try {
					return require("react-dom") || null;
				} catch {
					return null;
				}
			}
		})();

		// The shipped UI atoms (`@deepseek-ai/dsh-client-ui-primitives`) are a
		// platform seed module, so a bundle may require them without declaring
		// `dsh.client.external`. They are looked up defensively: a DSH build that
		// no longer ships an atom falls back to a plain element instead of
		// blanking the settings panel.
		const atoms = (() => {
			try {
				return require("@deepseek-ai/dsh-client-ui-primitives") || {};
			} catch {
				return {};
			}
		})();
		const AtomButton = typeof atoms.Button === "function" ? atoms.Button : null;
		const AtomInput = typeof atoms.Input === "function" ? atoms.Input : null;
		const AtomMenu = typeof atoms.Menu === "function" ? atoms.Menu : null;
		const AtomMenuItemButton = typeof atoms.MenuItemButton === "function" ? atoms.MenuItemButton : null;

		const ROUTE = "/archived-sessions/api";
		const STYLE_ID = "dsh-archived-sessions-style";
		const SECTION_ID = "archived-sessions";
		const MENU_ID = "archived-sessions.reveal-folder";
const PANEL_ID = "archived-sessions.batch";
		const ROW_SELECTOR = '[data-row-key^="session:"]';

		// Nested service access is validated against this list by the Cordis client
		// runtime; an access that is not declared throws instead of returning
		// undefined, and a throw from a render path blanks the settings panel.
		//
		// `sessions` is declared because the row menu reads the shell's session list
		// for a row's `cwd`; `remote` because revealing a folder is a Remote call.
		// Both are still read defensively (`ctx.get` inside try/catch) so a shell
		// that does not expose them degrades instead of failing.
		const inject = ["slots", "workspaces", "sessions", "remote"];

		// #region messages

		const MESSAGES = {
			zh: {
				nav: "已归档会话",
				heading: "已归档会话",
				intro: "查看、搜索、恢复或删除已归档的会话。删除会把会话日志移入回收站目录，不会立即销毁。",
				searchPlaceholder: "搜索标题、会话 ID 或工作区…",
				allWorkspaces: "全部工作区",
				ungrouped: "未归属工作区",
				count: (n) => `共 ${n} 个已归档会话`,
				countFiltered: (shown, total) => `显示 ${shown} / ${total} 个已归档会话`,
				empty: "当前没有已归档的会话。",
				emptyFiltered: "没有匹配的会话。",
				restore: "恢复",
				restoring: "恢复中…",
				remove: "删除",
				removing: "删除中…",
				confirmRemove: "确认删除",
				cancel: "取消",
				restored: "已恢复会话",
				removed: (target) => (target ? `已删除会话，日志已移至 ${target}` : "已删除会话（未找到日志目录）"),
				restoreFailed: "恢复失败：",
				removeFailed: "删除失败：",
				workspaceLabel: "工作区",
				live: "运行中",
				liveHint: "该会话仍被宿主打开（正在运行或保留中），日志句柄可能还开着，此时删除有损坏日志的风险。重启 DeepSeek Harness 后即可删除。",
				liveNotice: "标记为「运行中」的会话仍被宿主打开，此时只能恢复；重启 DeepSeek Harness 后即可删除。",
				reveal: "打开文件夹",
				revealHint: "在文件管理器中打开该会话的工作目录",
				revealUnavailable: "该会话没有可打开的工作目录",
				revealFailed: "打开文件夹失败：",
				revealUnsupported: "当前 DSH 版本不支持在文件管理器中打开路径。",
				removeSession: "删除任务",
				removeSessionHint: "删除该会话（日志移入回收站，不会立即销毁）",
				panel: "批量操作",
				panelHeading: "批量操作",
				panelIntro: "勾选多个会话后一次性归档、恢复或删除。删除会把日志移入回收站目录，不会立即销毁。",
				panelLoading: "正在读取会话列表…",
				panelEmpty: "没有可操作的会话。",
				panelSelectAll: "全选",
				panelSelectNone: "清空选择",
				panelSelected: (n) => `已选择 ${n} 个会话`,
				panelRunArchive: "归档所选",
				panelRunRestore: "恢复所选",
				panelRunRemove: "删除所选",
				panelWorking: (done, total) => `正在执行 ${done} / ${total}…`,
				panelDone: (ok, failed) => (failed === 0 ? `已完成 ${ok} 个会话` : `完成 ${ok} 个，失败 ${failed} 个`),
				panelPartial: (sessionId) => `会话 ${sessionId} 失败：`,
				panelNothingSelected: "先勾选至少一个会话。",
				panelConfirmRemove: (n) => `确认删除 ${n} 个会话`,
				panelArchiveFailed: "归档失败：",
				panelRefreshFailed: "会话列表刷新失败，页面显示的条目可能已过期：",
				archivedTag: "已归档",
			},
			en: {
				nav: "Archived Sessions",
				heading: "Archived Sessions",
				intro: "Browse, search, restore or delete archived sessions. Deleting moves the session log into a trash directory instead of erasing it.",
				searchPlaceholder: "Search title, session id or workspace…",
				allWorkspaces: "All workspaces",
				ungrouped: "No workspace",
				count: (n) => `${n} archived session${n === 1 ? "" : "s"}`,
				countFiltered: (shown, total) => `Showing ${shown} of ${total} archived sessions`,
				empty: "No archived sessions.",
				emptyFiltered: "No matching sessions.",
				restore: "Restore",
				restoring: "Restoring…",
				remove: "Delete",
				removing: "Deleting…",
				confirmRemove: "Confirm delete",
				cancel: "Cancel",
				restored: "Restored session",
				removed: (target) => (target ? `Session deleted; log moved to ${target}` : "Session deleted (no log directory found)"),
				restoreFailed: "Restore failed: ",
				removeFailed: "Delete failed: ",
				workspaceLabel: "Workspace",
				live: "running",
				liveHint: "The host still holds this session open (running or retained) and may still be appending to its log, so deleting it now could corrupt the log. Restart DeepSeek Harness to delete it.",
				liveNotice: "Sessions marked running are still held open by the host: you can restore them now, and delete them after restarting DeepSeek Harness.",
				reveal: "Open folder",
				revealHint: "Reveal this session's working directory in the file manager",
				revealUnavailable: "This session has no working directory to open",
				revealFailed: "Could not open the folder: ",
				revealUnsupported: "This DSH build cannot reveal paths in the file manager.",
				removeSession: "Delete task",
				removeSessionHint: "Delete this session (its log moves to the trash folder; nothing is erased)",
				panel: "Batch actions",
				panelHeading: "Batch actions",
				panelIntro: "Pick several sessions and archive, restore or delete them in one go. Deleting moves each log into the trash folder instead of erasing it.",
				panelLoading: "Reading the session list…",
				panelEmpty: "No sessions to act on.",
				panelSelectAll: "Select all",
				panelSelectNone: "Clear selection",
				panelSelected: (n) => `${n} session${n === 1 ? "" : "s"} selected`,
				panelRunArchive: "Archive selected",
				panelRunRestore: "Restore selected",
				panelRunRemove: "Delete selected",
				panelWorking: (done, total) => `Working… ${done} of ${total}`,
				panelDone: (ok, failed) => (failed === 0 ? `Done: ${ok} session${ok === 1 ? "" : "s"}` : `${ok} done, ${failed} failed`),
				panelPartial: (sessionId) => `Session ${sessionId} failed: `,
				panelNothingSelected: "Select at least one session first.",
				panelConfirmRemove: (n) => `Confirm deleting ${n} session${n === 1 ? "" : "s"}`,
				panelArchiveFailed: "Archive failed: ",
				panelRefreshFailed: "Could not refresh the session list; the rows shown may be stale: ",
				archivedTag: "archived",
			},
		};

		/** Pick the message table from the shell locale, defaulting to Chinese. */
		function messagesFor(ctx) {
			try {
				const locale = ctx.get("locale");
				const raw = typeof locale?.language === "string"
					? locale.language
					: typeof locale?.current === "string"
						? locale.current
						: locale?.current?.language;
				if (typeof raw === "string" && raw !== "" && !raw.toLowerCase().startsWith("zh")) {
					return MESSAGES.en;
				}
			} catch {
				// Fall through to the default table.
			}
			return MESSAGES.zh;
		}

		// #endregion

		// #region styles

		// Metrics mirrored from the shipped settings pages: the section column
		// (`ui-settings-plugins` PluginsSettingsSection.module.css — 760px cap,
		// 12px gaps, 18px heading, 13px secondary copy) and the card list
		// (`.cards` — 10px gaps). The panel itself owns the scroll container
		// (`.options` is `flex:1;min-height:0;overflow-y:auto` with 24px side and
		// bottom padding), so this page never sets a height or its own overflow:
		// doing that is what produced the nested scrollbar and the stretched page.
		const CSS = [
			`[data-dsh-archived-sessions]{box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}`,
			`[data-dsh-archived-sessions] .as-heading{margin:0;font-size:18px;font-weight:600}`,
			`[data-dsh-archived-sessions] .as-intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}`,
			`[data-dsh-archived-sessions] .as-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}`,
			`[data-dsh-archived-sessions] .as-search{flex:1 1 240px;min-width:180px}`,
			`[data-dsh-archived-sessions] input.as-search,[data-dsh-archived-sessions] select.as-select{box-sizing:border-box;height:32px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;outline:none}`,
			`[data-dsh-archived-sessions] input.as-search::placeholder{color:var(--dsw-alias-label-dimmed)}`,
			`[data-dsh-archived-sessions] input.as-search:focus,[data-dsh-archived-sessions] select.as-select:focus{border-color:var(--dsw-alias-state-business-primary)}`,
			`[data-dsh-archived-sessions] select.as-select{appearance:none;max-width:240px;cursor:pointer;padding-right:32px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%2381858C' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:right 12px center;background-repeat:no-repeat;background-size:12px 12px}`,
			`[data-dsh-archived-sessions] .as-summary{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}`,
			`[data-dsh-archived-sessions] .as-list{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}`,
			`[data-dsh-archived-sessions] .as-group{margin:12px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;overflow-wrap:anywhere}`,
			`[data-dsh-archived-sessions] .as-list > .as-group:first-child{margin-top:0}`,
			`[data-dsh-archived-sessions] .as-row{box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4));border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2))}`,
			`[data-dsh-archived-sessions] .as-main{flex:1 1 auto;min-width:0}`,
			`[data-dsh-archived-sessions] .as-title{font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
			`[data-dsh-archived-sessions] .as-meta{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
			`[data-dsh-archived-sessions] .as-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}`,
			`[data-dsh-archived-sessions] button.as-action{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}`,
			`[data-dsh-archived-sessions] button.as-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
			`[data-dsh-archived-sessions] button.as-action:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}`,
			`[data-dsh-archived-sessions] button.as-action:disabled{cursor:not-allowed;opacity:.4}`,
			`[data-dsh-archived-sessions] button.as-action:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}`,
			`[data-dsh-archived-sessions] button.as-danger{color:var(--dsw-alias-state-error-primary)}`,
			`[data-dsh-archived-sessions] button.as-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}`,
			`[data-dsh-archived-sessions] .as-empty{margin:0;padding:12px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center}`,
			`[data-dsh-archived-sessions] .as-note{margin:0;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);font-size:12px;line-height:18px;overflow-wrap:anywhere}`,
			`[data-dsh-archived-sessions] .as-note[data-kind=ok]{color:var(--dsw-alias-state-success-primary)}`,
			`[data-dsh-archived-sessions] .as-note[data-kind=error]{color:var(--dsw-alias-state-error-primary)}`,
			`[data-dsh-archived-sessions] .as-note[data-kind=warn]{color:var(--dsw-alias-state-warn-label)}`,
			// Row menus: the fallback path (no shipped atoms) and the inline notice
			// a menu shows after an action. Every rule is scoped under the plugin's
			// own root attribute (the same contract the settings page follows), so
			// nothing here can leak into the sidebar's own rows.
			`[data-dsh-archived-sessions] .as-row-menu{position:relative;z-index:60}`,
			`[data-dsh-archived-sessions] .as-menu-anchor{display:block;width:0;height:0}`,
			`[data-dsh-archived-sessions] .as-menu-fallback{min-width:180px;padding:4px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}`,
			`[data-dsh-archived-sessions] button.as-menu-item{display:flex;align-items:center;width:100%;padding:6px 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}`,
			`[data-dsh-archived-sessions] button.as-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
			`[data-dsh-archived-sessions] button.as-menu-item:disabled{cursor:not-allowed;opacity:.4}`,
			`[data-dsh-archived-sessions] button.as-menu-item[data-action=danger]{color:var(--dsw-alias-state-error-primary)}`,
			`[data-dsh-archived-sessions] button.as-menu-item[data-separator]{margin-top:4px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:8px}`,
			`[data-dsh-archived-sessions] .as-menu-note{padding:6px 10px;font-size:12px;line-height:18px;overflow-wrap:anywhere}`,
			`[data-dsh-archived-sessions] .as-menu-note[data-kind=ok]{color:var(--dsw-alias-state-success-primary)}`,
			`[data-dsh-archived-sessions] .as-menu-note[data-kind=error]{color:var(--dsw-alias-state-error-primary)}`,
			`[data-dsh-archived-sessions] .as-menu-note[data-kind=warn]{color:var(--dsw-alias-state-warn-label)}`,
			// The batch panel. Same column metrics as the settings page (the panel
			// body does not own a scroll container either — the shell's `main`
			// region does), so a rail panel and a settings page read alike.
			`[data-dsh-archived-sessions].as-panel{max-width:760px;padding:24px}`,
			`[data-dsh-archived-sessions] input.as-check{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}`,
			`[data-dsh-archived-sessions] input.as-check:disabled{cursor:not-allowed;opacity:.4}`,
		].join("")

		/** Inject the page stylesheet once, from inside the factory. */
		function installStyles() {
			if (typeof document === "undefined") return
			if (document.getElementById(STYLE_ID)) return
			const style = document.createElement("style")
			style.id = STYLE_ID
			style.textContent = CSS
			document.head.appendChild(style)
		}

		// #endregion

		// #region host api

		/**
		 * Thin client over the plugin's host routes. `restore` prefers the shipped
		 * client service so the shell's own store updates immediately, and falls
		 * back to the plugin route when that service is unavailable. `remove`
		 * refreshes the shell's session catalog once the host log is gone.
		 */
		function createApi(ctx) {
			const callHost = async (action, payload) => {
				const response = await fetch(`${ROUTE}/${action}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload ?? {}),
				})
				let data = null
				try {
					data = await response.json()
				} catch {
					data = null
				}
				if (data === null || data.ok !== true) {
					const reason = data && typeof data.error === "string" ? data.error : `HTTP ${response.status}`
					throw new Error(reason)
				}
				return data.value
			}
			const restoreViaService = async (sessionId) => {
				for (const keyName of ["workspaces", "uiWorkspace"]) {
					let service
					try {
						service = ctx.get(keyName)
					} catch {
						service = undefined
					}
					if (service && typeof service.unarchiveSession === "function") {
						await service.unarchiveSession(sessionId)
						return { via: keyName }
					}
				}
				return undefined
			}
			/**
			 * Re-read the shell's session list. Deleting a session is a host-side
			 * file move: the shell's session store only changes on an explicit pull,
			 * so the deleted row would keep drawing — inside its workspace group, or
			 * under "未分组/Ungrouped" once the accounting slot is gone. The host list
			 * no longer contains the moved log, so one pull removes the row.
			 */
			const refreshSessionCatalog = async () => {
				for (const keyName of ["sessions", "uiSessions"]) {
					let service
					try {
						service = ctx.get(keyName)
					} catch {
						service = undefined
					}
					if (service && typeof service.refresh === "function") {
						await service.refresh()
						return true
					}
				}
				return false
			}
			return {
				list: async () => callHost("list", {}),
				describe: async (sessionId) => callHost("describe", { sessionId }),
				restore: async (sessionId) => (await restoreViaService(sessionId)) ?? (await callHost("restore", { sessionId })),
				remove: async (sessionId) => callHost("delete", { sessionId }),
				refreshSessionCatalog,
			}
		}

		// #endregion

		// #region row actions

		/**
		 * The remote namespace DSH itself uses to reveal a path, read defensively:
		 * this is a platform service, not something the plugin declares.
		 *
		 * The dotted name has to go through `ctx.get`. Reaching the sub-namespace
		 * by property access (`ctx.get("remote")?.session`) resolves the generated
		 * `remote.session` member against this fiber's `inject`, which only lists
		 * `remote`, so it throws `cannot get property "remote.session" without
		 * inject`. That error escapes `apply`, the fiber ends up FAILED, and the
		 * client boot audit reports the plugin and shows the fatal dialog.
		 *
		 * Listing `remote.session` in `inject` is not the fix either: when the
		 * service is absent the fiber then parks at `pending` forever, which fails
		 * the same audit. `ctx.get` is the documented read-without-inject path, and
		 * the caller still guards the returned methods.
		 */
		function sessionRemote(ctx) {
			for (const keyName of ["remote.session", "uiRemote.session"]) {
				let session
				try {
					session = ctx.get(keyName)
				} catch {
					session = undefined
				}
				if (session && typeof session.openWorkspacePath === "function") return session
			}
			return undefined
		}

		/**
		 * The row actions offered on a session (the `...` menu and the right-click
		 * menu both use this one implementation).
		 *
		 * Actions are data, not components: availability is decided from the session
		 * row so both entry points grey out the same things, and each `run` resolves
		 * to a notice the caller shows. `cwd` comes from the shell's own list entry
		 * when it is there and falls back to the plugin host route otherwise — the
		 * shipped `open-in-app` plugin reads the path the same way.
		 *
		 * @param ctx - the plugin context.
		 * @param api - the plugin host API (see `createApi`).
		 * @param messages - the locale table.
		 * @returns helpers that resolve one session's context and run its actions.
		 */
		function createRowActions(ctx, api, messages) {
			const remote = sessionRemote(ctx)

			/** The shell's list entry for a session id, when the catalog still has one. */
			const listEntry = (sessionId) => {
				try {
					const snapshot = ctx.get("sessions")?.list?.getSnapshot?.()
					const entry = snapshot?.byId?.[sessionId]
					return entry && typeof entry === "object" ? entry : undefined
				} catch {
					return undefined
				}
			}

			/**
			 * Resolve what a session row can do. The host route is authoritative and
			 * always asked when the client snapshot has no `cwd`, because a row drawn
			 * from a stale snapshot would otherwise silently lose the folder action.
			 */
			const describe = async (sessionId) => {
				const entry = listEntry(sessionId)
				let host
				try {
					host = await api.describe(sessionId)
				} catch {
					host = null
				}
				const cwd = (typeof entry?.cwd === "string" && entry.cwd !== "" ? entry.cwd : null)
					?? (typeof host?.cwd === "string" && host.cwd !== "" ? host.cwd : null)
				return {
					sessionId,
					cwd,
					archived: host?.archived === true,
					live: host?.live === true,
					logsMissing: host?.logsMissing === true,
				}
			}

			/**
			 * Reveal the session's working directory, returning a notice.
			 *
			 * Success says nothing: the file manager opening is the feedback, and
			 * echoing the path back only printed a long line the menu has to
			 * scroll. Failures still speak, because they have no other signal.
			 */
			const reveal = async (row) => {
				if (row.cwd === null) return { kind: "warn", text: messages.revealUnavailable }
				if (remote === undefined) return { kind: "warn", text: messages.revealUnsupported }
				try {
					if (typeof remote.canOpenWorkspacePath === "function") {
						const allowed = await remote.canOpenWorkspacePath()
						if (allowed === false) return { kind: "warn", text: messages.revealUnsupported }
					}
					await remote.openWorkspacePath({ path: row.cwd, action: "reveal" })
					return null
				} catch (error) {
					return { kind: "error", text: `${messages.revealFailed}${messageOf(error)}` }
				}
			}

			/**
			 * Delete the session: the host moves its log aside, then the shell's
			 * catalog is re-pulled so the row disappears. A failed pull is not
			 * reported as a failed delete — the delete already happened.
			 *
			 * `confirmed` gates the destructive call. The menu asks first (the
			 * settings page uses an inline two-step button, and a menu that
			 * deletes on the first click would be a worse deal than the page),
			 * and the caller re-invokes with `confirmed: true` on the second.
			 */
			const remove = async (row, options) => {
				if (options?.confirmed !== true) {
					return { kind: "confirm", text: messages.confirmRemove, removed: false, needsConfirm: true }
				}
				try {
					const value = await api.remove(row.sessionId)
					try {
						await api.refreshSessionCatalog?.()
					} catch {
						// The delete is durable either way.
					}
					return {
						kind: "ok",
						text: messages.removed(value?.trashedTo || null),
						removed: true,
					}
				} catch (error) {
					return { kind: "error", text: `${messages.removeFailed}${messageOf(error)}`, removed: false }
				}
			}

			/**
			 * The menu rows, in display order. `enabled` gates the destructive entry
			 * on the same liveness rule the settings page uses, so the two surfaces
			 * can never disagree.
			 */
			const itemsFor = (row, options) => {
				const confirmed = options?.confirmed === true
				return [
				{
					id: "reveal",
					label: messages.reveal,
					icon: typeof atoms.IconFolderOpenOutlineRegular === "function" ? atoms.IconFolderOpenOutlineRegular : null,
					disabled: row.cwd === null || remote === undefined,
					title: row.cwd === null ? messages.revealUnavailable : messages.revealHint,
					danger: false,
					separatorBefore: false,
					run: () => reveal(row),
				},
				{
					id: "remove",
					// A destructive entry states what the second click does, so the
					// menu never deletes on a click that was not clearly meant as one.
					label: confirmed ? messages.confirmRemove : messages.removeSession,
					icon: typeof atoms.IconTrashOutlineRegular === "function" ? atoms.IconTrashOutlineRegular : null,
					disabled: row.live,
					title: row.live ? messages.liveHint : messages.removeSessionHint,
					danger: true,
					separatorBefore: true,
					run: () => remove(row, { confirmed }),
				},
				]
			}

			return { describe, itemsFor, reveal, remove }
		}

		// #endregion

		// #region batch panel

		/**
		 * Archive one session. Unlike restore and delete there is no plugin host
		 * route for archiving — archiving is a shell-side workspace mutation — so
		 * this asks the shipped `workspaces` service, the same one the sidebar's
		 * own archive action ends up calling.
		 *
		 * @param ctx - the plugin context.
		 * @param sessionId - the session to archive.
		 * @returns true when some service accepted the call.
		 */
		async function archiveViaService(ctx, sessionId) {
			for (const keyName of ["workspaces", "uiWorkspace"]) {
				let service
				try {
					service = ctx.get(keyName)
				} catch {
					service = undefined
				}
				if (service && typeof service.archiveSession === "function") {
					await service.archiveSession(sessionId)
					return true
				}
			}
			throw new Error("archiveSession is unavailable")
		}

		/**
		 * Run one action over many sessions, one at a time. Sequential on purpose:
		 * every call mutates the same workspace registry on the host, and a burst
		 * of parallel writes would race the durable snapshot. A failure is recorded
		 * per session and does not abort the rest — a batch is a convenience, not a
		 * transaction.
		 *
		 * @param ids - the selected session ids, in the order shown.
		 * @param run - async (sessionId) => void for a single session.
		 * @param onProgress - called after each session with (done, total).
		 * @returns the ids that failed, with their error messages.
		 */
		async function runSequential(ids, run, onProgress) {
			const failures = []
			let done = 0
			for (const sessionId of ids) {
				try {
					await run(sessionId)
				} catch (error) {
					failures.push({ sessionId, message: messageOf(error) })
				}
				done += 1
				if (typeof onProgress === "function") onProgress(done, ids.length)
			}
			return failures
		}

		/**
		 * The batch-operations panel: a checkbox list of every session the sidebar
		 * knows about, plus archive / restore / delete over the selection.
		 *
		 * It deliberately does not re-implement any single-session behaviour: the
		 * per-row facts come from the same `describe`/`remove` helpers the row menu
		 * uses, so the two surfaces cannot disagree about what is deletable.
		 */
		function BatchPanel(props) {
			const messages = props.messages || MESSAGES.zh
			const api = props.api
			const actions = props.actions
			const useWorkspaces = typeof props.useWorkspaces === "function" ? props.useWorkspaces : null
			const snapshot = useWorkspaces ? useWorkspaces((state) => state || {}) : {}
			const archivedIds = Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : []

			const [entries, setEntries] = React.useState([])
			const [query, setQuery] = React.useState("")
			const [selected, setSelected] = React.useState(() => new Set())
			const [busy, setBusy] = React.useState(null)
			const [progress, setProgress] = React.useState(null)
			const [notice, setNotice] = React.useState(null)
			const aliveRef = React.useRef(true)
			// A ref, not the `busy` state: a second click lands before React has
			// re-rendered the disabled buttons, so only a synchronous flag can stop
			// two loops from acting on the same selection twice.
			const runningRef = React.useRef(false)

			React.useEffect(() => () => {
				aliveRef.current = false
			}, [])

			/**
			 * Read the shell's session catalog. `sessions.list` is the client-side
			 * store the sidebar draws from, so this panel lists exactly what the
			 * sidebar lists — including sessions with no workspace group.
			 */
			const reload = React.useCallback(async () => {
				let listed = []
				try {
					const store = props.sessionsService?.list?.getSnapshot?.()
					const byId = store?.byId && typeof store.byId === "object" ? store.byId : {}
					listed = Object.keys(byId).map((sessionId) => {
						const entry = byId[sessionId] || {}
						return {
							sessionId,
							title: typeof entry.title === "string" && entry.title !== "" ? entry.title : null,
							cwd: typeof entry.cwd === "string" && entry.cwd !== "" ? entry.cwd : null,
							// Liveness lives on the catalog entry itself (the sidebar's
							// own rows read `summary.running` too); the workspace snapshot
							// carries no such list.
							running: entry.running === true,
							updatedAt: entry.updatedAt ?? null,
						}
					})
				} catch {
					listed = []
				}
				if (listed.length === 0) {
					try {
						const hostRows = await api.list()
						listed = (Array.isArray(hostRows) ? hostRows : []).map((row) => ({
							sessionId: row.sessionId,
							title: row.title ?? null,
							cwd: row.cwd ?? null,
							running: row.live === true,
							updatedAt: null,
						}))
					} catch (error) {
						if (aliveRef.current) setNotice({ kind: "error", text: `${messages.restoreFailed}${messageOf(error)}` })
						return
					}
				}
				if (!aliveRef.current) return
				setEntries(listed)
			}, [api, messages, props.sessionsService])

			React.useEffect(() => {
				void reload()
			}, [reload])

			const archivedSet = React.useMemo(() => new Set(archivedIds), [archivedIds])

			const rows = React.useMemo(() => entries.map((entry) => ({
				...entry,
				archived: archivedSet.has(entry.sessionId),
				// A session the host no longer has a log for is gone; a stale
				// catalog row must not become a checkbox the user can select.
				gone: entry.logsMissing === true,
			})), [entries, archivedSet])

			const needle = query.trim().toLowerCase()
			const filtered = needle === ""
				? rows
				: rows.filter((row) => {
					const haystack = [row.title, row.sessionId, row.cwd].filter(Boolean).join(" ").toLowerCase()
					return haystack.includes(needle)
				})

			const selectedIds = React.useMemo(() => filtered.filter((row) => selected.has(row.sessionId)).map((row) => row.sessionId), [filtered, selected])

			/**
			 * Change the selection and disarm a pending delete. The confirmation
			 * label states a count, so it must not survive the selection it was
			 * armed for — otherwise "确认删除 2 个会话" could run over five rows.
			 */
			const setSelection = (next) => {
				setProgress((previous) => (previous !== null && previous.done < 0 ? null : previous))
				setNotice((previous) => (previous !== null && previous.kind === "warn" ? null : previous))
				setSelected(next)
			}

			const toggle = (sessionId, next) => {
				setSelected((previous) => {
					const copy = new Set(previous)
					if (next) copy.add(sessionId)
					else copy.delete(sessionId)
					return copy
				})
				setProgress((previous) => (previous !== null && previous.done < 0 ? null : previous))
				setNotice((previous) => (previous !== null && previous.kind === "warn" ? null : previous))
			}

			const selectAll = () => setSelection(new Set(filtered.filter((row) => !row.gone).map((row) => row.sessionId)))
			const selectNone = () => setSelection(new Set())

			const runBatch = (kind) => async () => {
				const ids = selectedIds
				if (ids.length === 0) {
					setNotice({ kind: "warn", text: messages.panelNothingSelected })
					return
				}
				if (runningRef.current) return
				if (kind === "remove" && progress === null) {
					// Two-step delete, same contract as the row menu: the label states
					// what the second click does.
					setNotice({ kind: "warn", text: messages.panelConfirmRemove(ids.length) })
					setProgress({ done: -1, total: ids.length, kind })
					return
				}
				runningRef.current = true
				setBusy(kind)
				setProgress({ done: 0, total: ids.length, kind })
				setNotice(null)
				const confirmed = kind === "remove"
				let failures
				try {
					failures = await runSequential(ids, async (sessionId) => {
						if (kind === "archive") return await archiveViaService(props.ctx, sessionId)
						if (kind === "restore") return await api.restore(sessionId)
						return await actions.remove({ sessionId }, { confirmed: true })
					}, (done, total) => {
						if (aliveRef.current) setProgress({ done, total, kind })
					})
				} finally {
					runningRef.current = false
				}
				let refreshFailed = null
				try {
					await api.refreshSessionCatalog?.()
				} catch (error) {
					refreshFailed = messageOf(error)
				}
				await reload()
				if (!aliveRef.current) return
				setBusy(null)
				setProgress(null)
				setSelected(new Set())
				const ok = ids.length - failures.length
				const parts = [messages.panelDone(ok, failures.length)]
				if (failures.length > 0) {
					parts.push(`${messages.panelPartial(failures[0].sessionId)}${failures[0].message}`)
				}
				if (refreshFailed !== null) parts.push(`${messages.panelRefreshFailed}${refreshFailed}`)
				setNotice({
					kind: failures.length === 0 && refreshFailed === null ? "ok" : "warn",
					text: parts.join(" "),
				})
			}

			const disabled = busy !== null
			const children = [
				h("h2", { key: "heading", className: "as-heading" }, messages.panelHeading),
				h("p", { key: "intro", className: "as-intro" }, messages.panelIntro),
			]
			if (notice !== null) {
				children.push(h("p", { key: "notice", className: "as-note", "data-kind": notice.kind }, notice.text))
			}
			children.push(h("div", { key: "toolbar", className: "as-toolbar" }, [
				h(SearchField, {
					key: "search",
					className: "as-search",
					value: query,
					placeholder: messages.searchPlaceholder,
					onChange: (event) => setQuery(event.target.value),
				}),
				h(ActionButton, { key: "all", onClick: selectAll, disabled }, messages.panelSelectAll),
				h(ActionButton, { key: "none", onClick: selectNone, disabled }, messages.panelSelectNone),
			]))
			children.push(h("p", { key: "summary", className: "as-summary" },
				progress !== null && progress.done >= 0
					? messages.panelWorking(progress.done, progress.total)
					: messages.panelSelected(selectedIds.length)))
			children.push(h("div", { key: "run", className: "as-toolbar" }, [
				h(ActionButton, { key: "archive", onClick: runBatch("archive"), disabled }, messages.panelRunArchive),
				h(ActionButton, { key: "restore", onClick: runBatch("restore"), disabled }, messages.panelRunRestore),
				h(ActionButton, {
					key: "remove",
					onClick: runBatch("remove"),
					disabled,
					className: "as-danger",
				}, progress !== null && progress.kind === "remove" && progress.done < 0
					? messages.panelConfirmRemove(selectedIds.length)
					: messages.panelRunRemove),
			]))
			if (filtered.length === 0) {
				children.push(h("p", { key: "empty", className: "as-empty" },
					entries.length === 0 ? messages.panelEmpty : messages.emptyFiltered))
			} else {
				children.push(h("ul", { key: "list", className: "as-list" },
					filtered.map((row) => h("li", { key: row.sessionId, className: "as-row" }, [
						h("input", {
							key: "check",
							type: "checkbox",
							className: "as-check",
							checked: selected.has(row.sessionId),
							disabled: disabled || row.gone,
							onChange: (event) => toggle(row.sessionId, event.target.checked),
							"aria-label": row.title || row.sessionId,
						}),
						h("div", { key: "main", className: "as-main" }, [
							h("div", { key: "title", className: "as-title" }, row.title || row.sessionId),
							h("div", { key: "meta", className: "as-meta" },
								[row.archived ? messages.archivedTag : null, row.running ? messages.live : null, row.cwd]
									.filter(Boolean).join(" · ") || row.sessionId),
						]),
					])),
				))
			}
			return h("div", { className: "as-panel", "data-dsh-archived-sessions": "" }, children)
		}

		/** The sidebar button for the batch panel. */
		function BatchPanelIcon() {
			const Icon = atoms.IconFolderOpenOutlineRegular
			if (typeof Icon === "function") return h(Icon, {})
			return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true" })
		}

		// #endregion

		// #region component

		/** Human-readable error text for the notice bar. */
		function messageOf(error) {
			if (error instanceof Error && error.message) return error.message
			return String(error)
		}

		/** Normalize a workspace path for display. */
		function displayPath(path) {
			return typeof path === "string" && path !== "" ? path : ""
		}

		/**
		 * Action button: the shipped atom when it is available, otherwise a plain
		 * `button` carrying the same class contract (`as-action`, plus `as-danger`
		 * for the destructive action).
		 */
		function ActionButton(props) {
			const danger = props.danger === true;
			const classes = [danger ? "as-danger" : "", props.className || ""].filter(Boolean).join(" ")
			const rest = { ...props }
			delete rest.danger
			delete rest.className
			if (AtomButton) return h(AtomButton, { ...rest, size: "sm", variant: "outline", className: classes })
			return h("button", { ...rest, type: "button", className: `as-action ${classes}`.trim() })
		}

		/** Search field: the shipped atom when available, otherwise a plain input. */
		function SearchField(props) {
			if (AtomInput) return h(AtomInput, { ...props, className: "as-search" })
			return h("input", { ...props, type: "search", className: "as-search" })
		}

		/** The settings page itself. */
		function ArchivedSessionsSection(props) {
			const messages = props.messages || MESSAGES.zh
			const api = props.api
			const useWorkspaces = typeof props.useWorkspaces === "function" ? props.useWorkspaces : null

			const snapshot = useWorkspaces ? useWorkspaces((state) => state || {}) : {}
			const workspaceItems = Array.isArray(snapshot.items) ? snapshot.items : []
			const archivedIds = Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : []

			const [hostSessions, setHostSessions] = React.useState([])
			const [query, setQuery] = React.useState("")
			const [workspaceFilter, setWorkspaceFilter] = React.useState("all")
			const [busyId, setBusyId] = React.useState("")
			const [confirmId, setConfirmId] = React.useState("")
			const [hiddenIds, setHiddenIds] = React.useState([])
			const [notice, setNotice] = React.useState(null)
			const aliveRef = React.useRef(true)

			const reload = React.useCallback(async () => {
				try {
					const value = await api.list()
					if (!aliveRef.current) return
					setHostSessions(Array.isArray(value?.sessions) ? value.sessions : [])
				} catch {
					// The workspace snapshot remains the primary source; the host rows
					// only contribute titles and registry detail.
				}
			}, [api])

			React.useEffect(() => {
				aliveRef.current = true
				void reload()
				return () => {
					aliveRef.current = false
				}
			}, [reload])

			const rows = React.useMemo(() => {
				const hostById = new Map()
				for (const row of hostSessions) {
					if (row && typeof row.sessionId === "string") hostById.set(row.sessionId, row)
				}
				const workspaceBySession = new Map()
				for (const workspace of workspaceItems) {
					for (const sessionId of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
						if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace)
					}
				}
				const seen = new Set()
				// A deleted session keeps its archive flag — that flag is what keeps it
				// out of the workspace — so the snapshot still lists it. Only the host
				// row knows its log is gone: drop it instead of drawing a dead entry
				// whose restore and delete would both be meaningless. The `directory`
				// test is the same verdict for a host that predates `logsMissing`.
				const isDeleted = (row) =>
					row?.logsMissing === true || (row?.directory === null && row?.live === false)
				const ids = []
				for (const sessionId of archivedIds) {
					if (typeof sessionId !== "string" || seen.has(sessionId) || hiddenIds.indexOf(sessionId) !== -1) continue
					if (isDeleted(hostById.get(sessionId))) continue
					seen.add(sessionId)
					ids.push(sessionId)
				}
				for (const row of hostSessions) {
					const sessionId = row?.sessionId
					if (typeof sessionId !== "string" || seen.has(sessionId) || hiddenIds.indexOf(sessionId) !== -1) continue
					if (isDeleted(row)) continue
					seen.add(sessionId)
					ids.push(sessionId)
				}
				return ids.map((sessionId) => {
					const workspace = workspaceBySession.get(sessionId) || null
					const host = hostById.get(sessionId) || null
					const workspacePath = displayPath(workspace?.path) || displayPath(host?.workspacePath)
					const workspaceTitle = workspace?.title || host?.workspaceTitle || workspacePath || null
					return {
						sessionId,
						title: host?.title || sessionId,
						workspaceId: workspace?.workspaceId || host?.workspaceId || null,
						workspaceTitle,
						workspacePath,
						live: Boolean(host?.live),
					}
				})
			}, [archivedIds, hostSessions, hiddenIds, workspaceItems])

			const needle = query.trim().toLowerCase()
			const filtered = rows.filter((row) => {
				if (workspaceFilter !== "all" && row.workspaceId !== workspaceFilter) return false
				if (needle === "") return true
				return [row.title, row.sessionId, row.workspaceTitle, row.workspacePath]
					.filter((value) => typeof value === "string")
					.some((value) => value.toLowerCase().includes(needle))
			})

			const groupOrder = []
			const grouped = new Map()
			for (const row of filtered) {
				const key = row.workspaceId || "__none__"
				if (!grouped.has(key)) {
					grouped.set(key, { key, label: row.workspaceTitle || messages.ungrouped, path: row.workspacePath, rows: [] })
					groupOrder.push(key)
				}
				grouped.get(key).rows.push(row)
			}

			const workspaceOptions = workspaceItems
				.filter((workspace) => rows.some((row) => row.workspaceId === workspace.workspaceId))
				.map((workspace) => ({ value: workspace.workspaceId, label: workspace.title || displayPath(workspace.path) || workspace.workspaceId }))

			const restore = async (row) => {
				setBusyId(row.sessionId)
				setNotice(null)
				try {
					await api.restore(row.sessionId)
					setNotice({ kind: "ok", text: `${messages.restored} ${row.title}` })
					await reload()
				} catch (error) {
					setNotice({ kind: "error", text: `${messages.restoreFailed}${messageOf(error)}` })
				} finally {
					setBusyId("")
				}
			}

			const remove = async (row) => {
				setBusyId(row.sessionId)
				setConfirmId("")
				setNotice(null)
				try {
					const value = await api.remove(row.sessionId)
					setHiddenIds((previous) => previous.concat([row.sessionId]))
					setNotice({ kind: "ok", text: `${messages.removed(value?.trashedTo || null)}` })
					try {
						// The host moved the log out of the session store's sight; pull
						// the catalog so the shell drops the row as well.
						await api.refreshSessionCatalog?.()
					} catch {
						// The delete is durable either way: a failed pull only leaves the
						// row until the shell's next list refresh.
					}
					await reload()
				} catch (error) {
					setNotice({ kind: "error", text: `${messages.removeFailed}${messageOf(error)}` })
				} finally {
					setBusyId("")
				}
			}

			const children = [
				h("h2", { key: "heading", className: "as-heading" }, messages.heading),
				h("p", { key: "intro", className: "as-intro" }, messages.intro),
				h("div", { key: "toolbar", className: "as-toolbar" }, [
					h(SearchField, {
						key: "search",
						value: query,
						placeholder: messages.searchPlaceholder,
						"aria-label": messages.searchPlaceholder,
						onChange: (event) => setQuery(event.target.value),
					}),
					h("select", {
						key: "workspace",
						className: "as-select",
						value: workspaceFilter,
						"aria-label": messages.workspaceLabel,
						onChange: (event) => setWorkspaceFilter(event.target.value),
					}, [
						h("option", { key: "all", value: "all" }, messages.allWorkspaces),
						...workspaceOptions.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
					]),
				]),
				h("div", { key: "summary", className: "as-summary" },
					needle === "" && workspaceFilter === "all"
						? messages.count(rows.length)
						: messages.countFiltered(filtered.length, rows.length)),
			]

			if (rows.some((row) => row.live)) {
				children.push(h("div", { key: "live", className: "as-note", "data-kind": "warn" }, messages.liveNotice))
			}

			if (notice) children.push(h("div", { key: "notice", className: "as-note", "data-kind": notice.kind }, notice.text))

			if (rows.length === 0 && !notice) {
				children.push(h("p", { key: "empty", className: "as-empty" }, messages.empty))
			} else if (filtered.length === 0) {
				children.push(h("p", { key: "empty-filtered", className: "as-empty" }, messages.emptyFiltered))
			} else {
				const list = []
				for (const key of groupOrder) {
					const group = grouped.get(key)
					if (workspaceFilter === "all") {
						list.push(h("div", { key: `g-${key}`, className: "as-group" },
							group.path ? `${group.label}  ·  ${group.path}` : group.label))
					}
					for (const row of group.rows) {
						const busy = busyId === row.sessionId
						list.push(h("div", { key: row.sessionId, className: "as-row", "data-session-id": row.sessionId }, [
							h("div", { key: "main", className: "as-main" }, [
								h("div", { key: "title", className: "as-title" }, row.title),
								h("div", { key: "meta", className: "as-meta" },
									[row.sessionId, !group.path ? row.workspaceTitle : null, row.live ? messages.live : null]
										.filter(Boolean).join("  ·  ")),
							]),
							h("div", { key: "actions", className: "as-actions" },
								confirmId === row.sessionId
									? [
										h(ActionButton, {
											key: "confirm",
											danger: true,
											disabled: busy,
											onClick: () => void remove(row),
										}, messages.confirmRemove),
										h(ActionButton, { key: "cancel", disabled: busy, onClick: () => setConfirmId("") }, messages.cancel),
									]
									: [
										h(ActionButton, {
											key: "restore",
											disabled: busy,
											title: messages.restore,
											onClick: () => void restore(row),
										}, busy ? messages.restoring : messages.restore),
										h(ActionButton, {
											key: "remove",
											danger: true,
											disabled: busy || row.live,
											title: row.live ? messages.liveHint : messages.remove,
											onClick: () => setConfirmId(row.sessionId),
										}, busy ? messages.removing : messages.remove),
									]),
						]))
					}
				}
				children.push(h("div", { key: "list", className: "as-list" }, list))
			}

			return h("div", { "data-dsh-archived-sessions": "" }, children)
		}

		// #endregion

		// #region row menu

		/**
		 * One row of the session menus (the `...` menu and the right-click menu).
		 *
		 * Uses the shipped `MenuItemButton` when it is available — it carries the
		 * separator, the danger colour and the shared keyboard walk — and falls back
		 * to a plain button carrying the same semantic attributes otherwise.
		 */
		function RowMenuItem(props) {
			const { label, icon, disabled, title, danger, separatorBefore, onSelect } = props;
			if (AtomMenuItemButton) {
				return h(AtomMenuItemButton, {
					icon: icon || undefined,
					disabled,
					danger,
					separatorBefore,
					onSelect,
					title,
				}, label)
			}
			return h("button", {
				type: "button",
				role: "menuitem",
				disabled,
				title,
				"data-action": danger ? "danger" : "",
				"data-separator": separatorBefore ? "" : undefined,
				className: "as-menu-item",
				onClick: onSelect,
			}, label)
		}

		/**
		 * The `...` menu entry contributed to every session row.
		 *
		 * The slot only offers one menu, so this renders the whole `...` list: both
		 * of this plugin's actions, each disabled unless the session actually
		 * supports it. The menu's own open/close state comes from the slot's
		 * `useMenuOpenState` hook so the trigger button keeps working.
		 */
		function RowMenuItems(props) {
			const actions = props.actions
			const messages = props.messages
			const [open, setOpen] = props.useMenuOpenState ? props.useMenuOpenState() : [false, () => {}]
			const [row, setRow] = React.useState(null)
			const [notice, setNotice] = React.useState(null)
			const [confirming, setConfirming] = React.useState(false)

			React.useEffect(() => {
				if (!open) return
				let alive = true
				void (async () => {
					const described = await actions.describe(props.sessionId)
					if (alive) setRow(described)
				})()
				return () => { alive = false }
			}, [open, props.sessionId, actions])

			// A closed menu forgets its pending confirmation: reopening it must
			// never present an armed delete button.
			React.useEffect(() => {
				if (!open) setConfirming(false)
			}, [open])

			const run = (item) => async () => {
				setNotice(null)
				const result = await item.run()
				if (result) setNotice(result)
				if (result?.needsConfirm === true) setConfirming(true)
				if (result?.removed === true) setOpen(false)
			}

			const items = row === null
				? []
				: actions.itemsFor(row, { confirmed: confirming })

			const children = []
			if (notice !== null) {
				children.push(h("div", {
					key: "notice",
					className: "as-menu-note",
					"data-kind": notice.kind,
					role: "status",
				}, notice.text))
			}
			for (const item of items) {
				children.push(h(RowMenuItem, {
					key: item.id,
					label: item.label,
					icon: item.icon,
					disabled: item.disabled,
					title: item.title,
					danger: item.danger,
					separatorBefore: item.separatorBefore,
					onSelect: () => void run(item)(),
				}))
			}
			return children
		}

		/**
		 * Right-click support for session rows.
		 *
		 * DSH renders the sidebar row itself and binds only click/hover/drag to it,
		 * so there is no slot to hook a context menu; the one stable handle is the
		 * row's `data-row-key="session:<id>"` attribute, which is also what the
		 * shell's own row bookkeeping reads. This installs one delegated listener on
		 * the document instead of one per row, so it keeps working for rows that are
		 * recycled, filtered or scrolled — and it only takes over right-clicks that
		 * land on a real session row, leaving every other context menu alone.
		 *
		 * @param ctx - the plugin context.
		 * @param openMenuAt - called with the session id and the pointer position.
		 * @returns a disposer removing the listener.
		 */
		function installRowContextMenu(ctx, openMenuAt) {
			if (typeof document === "undefined") return () => {}
			const handler = (event) => {
				if (event.defaultPrevented || event.button !== 2) return
				const target = event.target
				if (target === null || typeof target.closest !== "function") return
				const row = target.closest(ROW_SELECTOR)
				if (row === null) return
				const key = row?.dataset?.rowKey
				if (typeof key !== "string" || !key.startsWith("session:")) return
				const sessionId = key.slice("session:".length)
				if (sessionId === "") return
				event.preventDefault()
				openMenuAt(sessionId, { x: event.clientX, y: event.clientY })
			}
			document.addEventListener("contextmenu", handler)
			return () => document.removeEventListener("contextmenu", handler)
		}

		/**
		 * The right-click menu itself, mounted once from `apply` rather than from a
		 * row: the sidebar owns the rows, so only the plugin can own the menu they
		 * open. It renders through the document body (`portal`) so the sidebar's
		 * clipping and stacking cannot cut it off, and is anchored to the pointer
		 * rect because there is no trigger element to measure.
		 */
		function RowContextMenu(props) {
			const actions = props.actions
			const messages = props.messages
			const anchorPoint = props.anchorPoint
			const onClose = props.onClose
			const [row, setRow] = React.useState(null)
			const [notice, setNotice] = React.useState(null)
			const [confirming, setConfirming] = React.useState(false)
			const open = anchorPoint !== null

			React.useEffect(() => {
				if (!open || props.sessionId === null) return
				let alive = true
				setRow(null)
				setConfirming(false)
				void (async () => {
					const described = await actions.describe(props.sessionId)
					if (alive) setRow(described)
				})()
				return () => { alive = false }
			}, [open, props.sessionId, actions])

			if (!open) return null

			const run = (item) => async () => {
				setNotice(null)
				const result = await item.run()
				if (result) setNotice(result)
				if (result?.needsConfirm === true) setConfirming(true)
				// A successful delete removes the row the menu belongs to, so the
				// menu closes; a refusal keeps it open next to its message.
				if (result?.removed === true) onClose()
			}

			const items = row === null ? [] : actions.itemsFor(row, { confirmed: confirming })
			const children = []
			if (notice !== null) {
				children.push(h("div", {
					key: "notice",
					className: "as-menu-note",
					"data-kind": notice.kind,
					role: "status",
				}, notice.text))
			}
			for (const item of items) {
				children.push(h(RowMenuItem, {
					key: item.id,
					label: item.label,
					icon: item.icon,
					disabled: item.disabled,
					title: item.title,
					danger: item.danger,
					separatorBefore: item.separatorBefore,
					onSelect: () => void run(item)(),
				}))
			}

			// The pointer supplies the anchor rect directly: a DOMRect-shaped object
			// at the cursor, so the menu opens just below-right of it and clamps
			// itself to the viewport the same way the shipped menus do.
			const pointerRect = () => ({
				left: anchorPoint.x,
				top: anchorPoint.y,
				right: anchorPoint.x,
				bottom: anchorPoint.y,
				width: 0,
				height: 0,
			})

			if (AtomMenu) {
				return h(AtomMenu, {
					open: true,
					onClose,
					portal: true,
					autoFocus: true,
					getAnchorRect: pointerRect,
					anchor: h("span", { className: "as-menu-anchor" }),
				}, children)
			}
			return h("div", {
				className: "as-menu-fallback",
				role: "menu",
				style: { position: "fixed", left: `${anchorPoint.x}px`, top: `${anchorPoint.y}px` },
			}, children)
		}

		// #endregion

		/** Mount the settings page and the session-row menus. */
		function apply(ctx) {
			installStyles()
			const api = createApi(ctx)
			const messages = messagesFor(ctx)
			const actions = createRowActions(ctx, api, messages)
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: SECTION_ID,
				order: 4200,
				label: () => messages.nav,
				inject: () => ({ api, messages }),
			}, ArchivedSessionsSection))

			// The `...` menu of every session row. The slot hands the row's session
			// id and the shared open/close state; the actions are described lazily so
			// opening a menu costs one host call, not one per rendered row.
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: MENU_ID,
				order: 500,
				inject: (props) => ({ actions, messages, sessionId: props?.sessionId ?? null }),
			}, RowMenuItems))

			// Right-click on a session row opens the same two actions. The row belongs
			// to the sidebar, so this listens at the document and resolves the session
			// id from the row's own `data-row-key` attribute.
			const mountRowMenu = () => {
				if (ReactDOM === null || typeof ReactDOM.createRoot !== "function") return () => {}
				if (typeof document === "undefined" || document.body === null) return () => {}
				const host = document.createElement("div")
				host.id = "dsh-archived-sessions-row-menu"
				host.className = "as-row-menu"
				// The plugin's own root attribute keeps the overlay inside the same
				// style scope as the settings page (and marks it as this plugin's DOM).
				host.setAttribute("data-dsh-archived-sessions", "")
				document.body.appendChild(host)
				const root = ReactDOM.createRoot(host)
				const renderContextMenu = (sessionId, point) => {
					root.render(h(RowContextMenu, {
						sessionId,
						anchorPoint: point,
						actions,
						messages,
						onClose: () => renderContextMenu(null, null),
					}))
				}
				renderContextMenu(null, null)
				const disposeListener = installRowContextMenu(ctx, renderContextMenu)
				return () => {
					disposeListener()
					root.unmount()
					host.remove()
				}
			}
			ctx.effect(mountRowMenu, "archived-sessions: session row context menu")

			// The batch-operations panel. Registered as a sidebar panel (a rail
			// button) whose body renders in the `main` slot under the same key,
			// which is the contract the shipped schedule plugin uses.
			const batchInject = () => ({
				api,
				messages,
				actions,
				ctx,
				useWorkspaces: ctx.get("workspaces")?.useWorkspaces,
				sessionsService: ctx.get("sessions") ?? null,
			})
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				inject: batchInject,
			}, BatchPanel))
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 30,
				label: () => messages.panel,
			}, BatchPanelIcon))
		}

		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	},
})
