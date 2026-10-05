/**
 * Archived Sessions — browser half.
 *
 * Contributes one `settings.section` page (已归档会话 / Archived Sessions) that
 * lists every archived session, searches it by title, session id or workspace,
 * restores it (archive flag off) and deletes it (log directory moved to
 * `<DSH_HOME>/sessions-trash/`, never erased).
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

		const ROUTE = "/archived-sessions/api";
		const STYLE_ID = "dsh-archived-sessions-style";
		const SECTION_ID = "archived-sessions";

		// Nested service access is validated against this list by the Cordis client
		// runtime; an access that is not declared throws instead of returning
		// undefined, and a throw from a render path blanks the settings panel.
		const inject = ["slots", "workspaces"];

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
				hint: "恢复后会话会回到它原来的工作区位置；删除会同时移除会话的归档标记与工作区记录。",
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
				hint: "Restoring returns the session to its recorded workspace position; deleting also drops its archive flag and workspace entry.",
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
			`[data-dsh-archived-sessions] .as-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}`,
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
		 * back to the plugin route when that service is unavailable.
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
			return {
				list: async () => callHost("list", {}),
				restore: async (sessionId) => (await restoreViaService(sessionId)) ?? (await callHost("restore", { sessionId })),
				remove: async (sessionId) => callHost("delete", { sessionId }),
			}
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
				const ids = []
				for (const sessionId of archivedIds) {
					if (typeof sessionId !== "string" || seen.has(sessionId) || hiddenIds.indexOf(sessionId) !== -1) continue
					seen.add(sessionId)
					ids.push(sessionId)
				}
				for (const row of hostSessions) {
					const sessionId = row?.sessionId
					if (typeof sessionId !== "string" || seen.has(sessionId) || hiddenIds.indexOf(sessionId) !== -1) continue
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

			children.push(h("p", { key: "hint", className: "as-hint" }, messages.hint))

			return h("div", { "data-dsh-archived-sessions": "" }, children)
		}

		// #endregion

		/** Mount the settings page. */
		function apply(ctx) {
			installStyles()
			const api = createApi(ctx)
			const messages = messagesFor(ctx)
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: SECTION_ID,
				order: 4200,
				label: () => messages.nav,
				inject: () => ({ api, messages }),
			}, ArchivedSessionsSection))
		}

		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	},
})
