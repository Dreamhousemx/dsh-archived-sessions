'use strict'

/**
 * Offline test for the BROWSER half (`lib/client.js`).
 *
 * The page cannot be rendered for real here: no React installation exists in
 * this checkout, and the live bundle is only reachable through the shell's
 * authenticated index. This harness therefore plays the two roles the shell
 * plays — the module loader and a minimal React — and then:
 *
 *   1. loads the bundle the same way `@deepseek-ai/dsh-client-modules` does
 *      (`window.__ModuleLoader__.load({ id, factory })`) and checks the
 *      exported `apply` / `inject` contract;
 *   2. runs `apply(ctx)` against a fake Cordis client context and checks the
 *      `settings.section` registration (id, order, label, props factory, and
 *      that the stylesheet is installed exactly once);
 *   3. CALLS the registered component for real, with the props the slot
 *      provides, and asserts on the returned element tree: rows, workspace
 *      grouping, the running-session warning, and the delete gating.
 *
 * Run: node tools/test-client.cjs
 */

const fs = require('fs')
const path = require('path')

const CLIENT = path.join(__dirname, '..', 'lib', 'client.js')

let checks = 0
let failures = 0
const check = (label, ok, detail) => {
	checks += 1
	if (!ok) failures += 1
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : `  — ${detail}`}`)
}

/** Microtask flush so the component's async `api.list()` can settle. */
const tick = () => new Promise((resolve) => setImmediate(resolve))

// #region element-tree helpers

function walk(node, visit) {
	if (node === null || node === undefined || typeof node === 'boolean') return
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit)
		return
	}
	if (typeof node === 'string' || typeof node === 'number') {
		visit({ text: String(node) })
		return
	}
	// React renders a component by calling it; do the same so the tree this
	// harness asserts on contains the native elements a user would see
	// (the helpers `ActionButton` / `SearchField` and the atom stubs).
	if (typeof node.type === 'function') {
		walk(node.type(node.props), visit)
		return
	}
	visit(node)
	if (node.props && 'children' in node.props) walk(node.props.children, visit)
}

/** Every element matching `pred`, in document order. */
function collect(node, pred) {
	const out = []
	walk(node, (item) => {
		if (!('text' in item) && pred(item)) out.push(item)
	})
	return out
}

/** All rendered text, joined — for "contains" assertions. */
function allText(node) {
	const out = []
	walk(node, (item) => {
		if ('text' in item) out.push(item.text)
	})
	return out.join(' · ')
}

const byType = (node, type) => collect(node, (item) => item.type === type)
const buttons = (node) => byType(node, 'button')
/** The first button whose rendered text contains `text`, or null. */
const findByText = (node, text) => buttons(node).find((button) => allText(button).includes(text)) || null

// #endregion

// #region module loader + React stubs

/**
 * Minimal React. Hooks keep positional state in the array the *current*
 * harness hands over, so a second render call sees what the first one set —
 * enough to observe the component's async row load.
 */
const runtime = { state: [], cursor: 0 }

const ReactStub = {
	createElement(type, props, ...children) {
		const merged = Object.assign({}, props || {})
		if (children.length === 1) merged.children = children[0]
		else if (children.length > 1) merged.children = children
		return { type, props: merged }
	},
	useState(initial) {
		const index = runtime.cursor++
		if (runtime.state[index] === undefined) runtime.state[index] = { value: typeof initial === 'function' ? initial() : initial }
		const slot = runtime.state[index]
		return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
	},
	useRef(initial) {
		const index = runtime.cursor++
		if (runtime.state[index] === undefined) runtime.state[index] = { current: initial }
		return runtime.state[index]
	},
	useMemo(factory) {
		runtime.cursor += 1
		return factory()
	},
	useCallback(fn) {
		runtime.cursor += 1
		return fn
	},
	useEffect(fn) {
		const index = runtime.cursor++
		if (runtime.state[index] === undefined) {
			runtime.state[index] = { ran: true }
			fn()
		}
	},
}

/** Render one component with persistent hook state. */
function createHarness(Component, initialProps) {
	const state = []
	return {
		render(props) {
			runtime.state = state
			runtime.cursor = 0
			return Component(Object.assign({}, initialProps, props))
		},
	}
}

/**
 * Stand-in for `@deepseek-ai/dsh-client-ui-primitives`, mirroring the two
 * shapes the real atoms have: `Button` renders a native `<button type="button">`
 * and forwards `className`/`disabled`/`title`/`onClick`; `Input` puts
 * `className` on a wrapper and spreads the rest onto the inner `<input>`.
 * `Menu` / `MenuItemButton` mirror the row-menu atoms: `Menu` renders its
 * children (the harness walks them) and `MenuItemButton` renders a button
 * carrying `disabled` / `danger` / `separatorBefore` as props.
 */
const PrimitivesStub = {
	Button(props) {
		const { variant = 'ghost', size = 'md', icon, className, children, ...rest } = props
		return {
			type: 'button',
			props: Object.assign({}, rest, {
				type: 'button',
				className: ['primitives-button', size, variant, className].filter(Boolean).join(' '),
				children,
			}),
		}
	},
	Input(props) {
		const { icon, className, children, ...rest } = props
		return {
			type: 'span',
			props: {
				className: ['primitives-input', className].filter(Boolean).join(' '),
				children: { type: 'input', props: Object.assign({}, rest, { children }) },
			},
		}
	},
	Menu(props) {
		const { anchor, children } = props
		return { type: 'div', props: { className: 'primitives-menu', 'data-menu': '', children } }
	},
	MenuItemButton(props) {
		const { icon, disabled, danger, separatorBefore, onSelect, title, children } = props
		return {
			type: 'button',
			props: {
				type: 'button',
				disabled,
				title,
				role: 'menuitem',
				'data-danger': danger === true ? '' : undefined,
				'data-separator': separatorBefore === true ? '' : undefined,
				onClick: onSelect,
				children,
			},
		}
	},
	IconFolderOpenOutlineRegular() { return { type: 'svg', props: { 'data-icon': 'folder' } } },
	IconTrashOutlineRegular() { return { type: 'svg', props: { 'data-icon': 'trash' } } },
}

/**
 * Load `lib/client.js` exactly like client-modules does.
 * `withPrimitives: false` simulates a DSH build whose atom package is missing,
 * which must degrade to plain elements instead of blanking the panel.
 */
function loadBundle(withPrimitives = true, withReactDom = true, fetchStub) {
	const source = fs.readFileSync(CLIENT, 'utf8')
	const captured = { load: null }
	const windowStub = { __ModuleLoader__: { load: (mod) => { captured.load = mod } } }
	const styles = []
	const documentStub = {
		getElementById: (id) => styles.find((style) => style.id === id) || null,
		createElement: (tag) => ({ tag, setAttribute(k, v) { this[k] = v }, remove() { this.removed = true } }),
		head: { appendChild: (element) => styles.push(element) },
		body: { appendChild: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
	}
	const requireStub = (name) => {
		if (name === 'react') return ReactStub
		if (name === 'react-dom/client') return withReactDom ? ReactDomStub : undefined
		if (name === '@deepseek-ai/dsh-client-ui-primitives') {
			if (withPrimitives) return PrimitivesStub
			throw new Error('Cannot find module')
		}
		throw new Error(`unexpected require("${name}") — declare it in dsh.client.external`)
	}
	const run = new Function('window', 'require', 'document', 'fetch', source)
	run(windowStub, requireStub, documentStub, fetchStub || (async () => { throw new Error('unexpected fetch') }))
	if (captured.load === null) throw new Error('the bundle never called window.__ModuleLoader__.load')
	return { id: captured.load.id, exports: captured.load.factory(requireStub), styles }
}

// #endregion

/**
 * Stand-in for `react-dom/client`. The plugin only uses it to own the
 * right-click overlay's mount point; the harness records the rendered element
 * so tests can call the `onClose` handler a real menu would call.
 */
const ReactDomStub = {
	createRoot(container) {
		return {
			render(element) { container.rendered = element },
			unmount() { container.unmounted = true },
		}
	},
}

function report() {
	console.log('')
	console.log(`${checks - failures}/${checks} checks passed`)
	process.exitCode = failures === 0 ? 0 : 1
}

async function main() {
	const loaded = loadBundle()

	check('bundle registers under the package name', loaded.id === 'dsh-archived-sessions', loaded.id)
	check('bundle exports apply + inject', typeof loaded.exports.apply === 'function' && Array.isArray(loaded.exports.inject))
	check('inject declares slots, workspaces, sessions and remote',
		JSON.stringify(loaded.exports.inject) === JSON.stringify(['slots', 'workspaces', 'sessions', 'remote']),
		JSON.stringify(loaded.exports.inject))

	// 2. apply(ctx) ---------------------------------------------------------
	let registered = null
	const injections = []
	const effects = []
	const mounted = []
	const slots = {
		inject: (key, callback) => {
			injections.push(key)
			callback()
			return () => {}
		},
		register: (options, component) => {
			mounted.push({ options, component })
			if (options.name === 'settings.section') registered = { options, component }
			return () => {}
		},
	}
	const ctx = {
		get: () => undefined,
		slots,
		effect: (callback) => { effects.push(callback()); return () => {} },
	}
	loaded.exports.apply(ctx)

	check('apply injects into settings.section', registered !== null && injections[0] === 'settings.section', JSON.stringify(injections))
	check('apply injects into sidebar.workspaces.session.menu.item', injections[1] === 'sidebar.workspaces.session.menu.item', JSON.stringify(injections))
	check('apply registers a second slot (session row menu)', mounted.length === 4, String(mounted.length))
	if (registered === null) return report()
	check('section id is archived-sessions', registered.options.id === 'archived-sessions', registered.options.id)
	check('section order is 4200', registered.options.order === 4200, String(registered.options.order))
	check('label defaults to Chinese', registered.options.label() === '已归档会话', registered.options.label())
	check('stylesheet installed once', loaded.styles.length === 1 && loaded.styles[0].textContent.includes('--dsw-alias-'), String(loaded.styles.length))
	loaded.exports.apply(ctx)
	check('re-apply does not duplicate the stylesheet', loaded.styles.length === 1, String(loaded.styles.length))

	// 2b. the styling that the "排版" complaint was about -------------------
	const css = loaded.styles[0].textContent
	check('page does not create a nested scroll container', !/height:100%/.test(css) && !/overflow:auto/.test(css), css.slice(0, 140))
	check('page adopts the native section metrics', /max-width:760px/.test(css) && /\.as-heading\{[^}]*font-size:18px/.test(css), css.slice(0, 140))
	check('page reuses the native radius/border tokens', /var\(--dsw-radius-md\)/.test(css) && /\.5px solid var\(--dsw-alias-border-l4\)/.test(css), css.slice(0, 140))
	check('page uses the native type scale for rows', /\.as-title\{[^}]*font-size:14px/.test(css) && /\.as-meta\{[^}]*font-size:12px/.test(css), css.slice(0, 140))
	check('page uses only defined danger/warn tokens', /--dsw-alias-state-error-primary/.test(css) && !/--dsw-alias-label-error/.test(css) && /--dsw-alias-state-warn-label/.test(css), css.slice(0, 140))
	check('every rule stays scoped to the page root', css.split('}').filter((part) => part.includes('{')).every((rule) => rule.includes('[data-dsh-archived-sessions]')), css.slice(0, 140))

	const props = registered.options.inject()
	check('props factory exposes api + messages', typeof props.api?.list === 'function' && typeof props.messages?.heading === 'string')

	// 3. render the component for real --------------------------------------
	const workspace = {
		workspaceId: 'ws-1',
		title: 'DeepSeek Harness',
		path: 'D:\\Workspace\\DeepSeek Harness',
		sessionIds: ['session-aaa'],
	}
	const archivedSnapshot = { items: [workspace], archivedSessionIds: ['session-aaa'] }
	const emptySnapshot = { items: [], archivedSessionIds: [] }
	let currentSnapshot = archivedSnapshot
	const useWorkspaces = (selector) => selector(currentSnapshot)
	const api = {
		list: async () => ({ sessions: hostRows }),
		restore: async () => ({ via: 'workspaces' }),
		remove: async (sessionId) => ({ sessionId, trashedTo: 'C:\\Users\\me\\.dsh\\sessions-trash\\stamp__session-aaa' }),
	}
	let hostRows = []

	async function renderWith(rows, extraProps, snapshotForRender) {
		hostRows = rows
		currentSnapshot = snapshotForRender || archivedSnapshot
		const harness = createHarness(registered.component, Object.assign({ messages: props.messages, api, useWorkspaces }, extraProps))
		harness.render()
		await tick()
		return harness.render()
	}

	const liveRow = {
		sessionId: 'session-aaa',
		title: '单元测试会话',
		workspaceId: 'ws-1',
		workspaceTitle: 'DeepSeek Harness',
		workspacePath: 'D:\\Workspace\\DeepSeek Harness',
		live: true,
	}

	// The first frame must not judge an archived id it has no facts for. Every id
	// in the snapshot looks dead until the host answers, so drawing one before
	// then flashed a row titled by its raw session id under 未归属工作区 and then
	// dropped it. The page waits instead: no rows, and "reading…" rather than
	// "nothing archived".
	{
		hostRows = [liveRow]
		currentSnapshot = archivedSnapshot
		const earlyHarness = createHarness(registered.component, { messages: props.messages, api, useWorkspaces })
		const earlyText = allText(earlyHarness.render())
		check('first frame draws no rows before the host list arrives', !/session-aaa/.test(earlyText) && !/单元测试会话/.test(earlyText), earlyText.slice(0, 160))
		check('first frame does not claim the archive is empty', !/当前没有已归档的会话/.test(earlyText) && earlyText.includes(props.messages.loading), earlyText.slice(0, 160))
		await tick()
		const settledText = allText(earlyHarness.render())
		check('the row appears once the host list lands', /单元测试会话/.test(settledText), settledText.slice(0, 160))
	}

	const live = await renderWith([liveRow])
	const liveText = allText(live)

	check('root carries the page attribute', live.props['data-dsh-archived-sessions'] === '')
	check('heading is rendered', liveText.includes('已归档会话'), liveText.slice(0, 80))
	check('search box is rendered', byType(live, 'input').length === 1 && byType(live, 'input')[0].props.placeholder === props.messages.searchPlaceholder, JSON.stringify(byType(live, 'input').map((node) => node.props)))
	check('shipped atom provides the search field', collect(live, (item) => /as-search/.test(String(item.props.className || ''))).length === 1)
	check('workspace selector offers every workspace', byType(live, 'select').length === 1 && allText(byType(live, 'select')[0]).includes('全部工作区'))
	check('summary counts the archived sessions', liveText.includes('共 1 个已归档会话'), liveText)
	check('workspace group header shows title and path', liveText.includes('DeepSeek Harness  ·  D:\\Workspace\\DeepSeek Harness'), liveText)
	check('row uses the host title', liveText.includes('单元测试会话'), liveText)
	check('row meta marks the session as running', liveText.includes('运行中'), liveText)
	check('row is keyed by session id', collect(live, (item) => item.props['data-session-id'] === 'session-aaa').length === 1)

	const warn = collect(live, (item) => item.props['data-kind'] === 'warn')
	check('running sessions raise a warning note', warn.length === 1 && allText(warn[0]) === props.messages.liveNotice, allText(warn[0]))

	const liveButtons = buttons(live)
	const restoreButton = liveButtons.find((button) => allText(button) === props.messages.restore)
	const removeButton = liveButtons.find((button) => allText(button) === props.messages.remove)
	check('restore stays enabled while the session runs', Boolean(restoreButton) && restoreButton.props.disabled === false, JSON.stringify(restoreButton?.props))
	check('delete is blocked while the session runs', Boolean(removeButton) && removeButton.props.disabled === true, JSON.stringify(removeButton?.props))
	check('blocked delete explains itself', Boolean(removeButton) && removeButton.props.title === props.messages.liveHint)
	check('actions use the shipped atom', Boolean(restoreButton) && Boolean(removeButton)
		&& /primitives-button/.test(String(restoreButton.props.className)) && /primitives-button/.test(String(removeButton.props.className))
		&& /as-danger/.test(String(removeButton.props.className)), JSON.stringify([restoreButton?.props.className, removeButton?.props.className]))
	check('footer hint line is gone (the intro carries the delete contract)', props.messages.hint === undefined && liveText.includes('保留归档标记') === false)

	// idle session: delete becomes available
	const idle = await renderWith([Object.assign({}, liveRow, { live: false })])
	const idleRemove = buttons(idle).find((button) => allText(button) === props.messages.remove)
	check('idle session can be deleted', Boolean(idleRemove) && idleRemove.props.disabled === false, JSON.stringify(idleRemove?.props))
	check('idle session shows no warning note', collect(idle, (item) => item.props['data-kind'] === 'warn').length === 0)

	// 3b. deleting also refreshes the shell's session catalog -----------------
	// The host only moves the log file, so nothing tells the shell its row is
	// gone: the row would keep drawing inside its workspace group, or under
	// "未分组/Ungrouped" once the accounting slot is detached. One catalog pull
	// after a successful delete is what removes it.
	let catalogRefreshes = 0
	const deleteApi = Object.assign({}, api, {
		refreshSessionCatalog: async () => { catalogRefreshes += 1; return true },
	})
	hostRows = [Object.assign({}, liveRow, { live: false })]
	currentSnapshot = archivedSnapshot
	const deleteHarness = createHarness(registered.component, { messages: props.messages, api: deleteApi, useWorkspaces })
	let deleteTree = deleteHarness.render()
	await tick()
	deleteTree = deleteHarness.render()
	const askDelete = buttons(deleteTree).find((button) => allText(button) === props.messages.remove)
	check('idle row offers the delete action', Boolean(askDelete) && askDelete.props.disabled === false, JSON.stringify(askDelete?.props))
	askDelete.props.onClick()
	const confirmTree = deleteHarness.render()
	const confirmButton = buttons(confirmTree).find((button) => allText(button) === props.messages.confirmRemove)
	check('delete asks for confirmation first', Boolean(confirmButton), allText(confirmTree).slice(0, 120))
	confirmButton.props.onClick()
	await tick()
	const deletedTree = deleteHarness.render()
	check('delete refreshes the shell session catalog', catalogRefreshes === 1, String(catalogRefreshes))
	check('deleted row leaves the page', !allText(deletedTree).includes('单元测试会话'), allText(deletedTree).slice(0, 120))
	check('deleted row announces the trash path', allText(deletedTree).includes('sessions-trash'), allText(deletedTree).slice(0, 160))
	hostRows = []

	// A session the host left out of its list is deleted, not unknown. The host
	// drops a ghost (an archived id whose log and projection cache both went to
	// the trash) rather than reporting it, so the client snapshot can no longer
	// resurrect it as a row titled by its raw session id under 未归属工作区.
	const snapshotOnly = await renderWith([])
	check('an archived id the host omits is not listed',
		allText(snapshotOnly).includes(props.messages.empty) && !allText(snapshotOnly).includes('session-aaa'), allText(snapshotOnly))
	check('an archived id the host omits renders no row', collect(snapshotOnly, (item) => item.props['data-session-id'] === 'session-aaa').length === 0)
	check('an archived id the host omits never falls back to its raw id as a title',
		collect(snapshotOnly, (item) => item.props.className === 'as-title').length === 0)

	// a session the host reports as deleted (its log is gone) must not be listed:
	// the archive flag keeps it in the client snapshot, the host row is the only
	// thing that says there is nothing left to restore or delete
	const deleted = await renderWith([Object.assign({}, liveRow, { live: false, logsMissing: true })])
	check('deleted session is not listed even though the snapshot still archives it',
		allText(deleted).includes(props.messages.empty) && !allText(deleted).includes('单元测试会话'), allText(deleted))
	check('deleted session renders no row', collect(deleted, (item) => item.props['data-session-id'] === 'session-aaa').length === 0)

	// the same verdict for a host that predates the logsMissing flag: no log
	// directory and not running is a deleted session
	const legacy = await renderWith([Object.assign({}, liveRow, { live: false, directory: null })])
	check('deleted session is inferred from a missing log directory too',
		collect(legacy, (item) => item.props['data-session-id'] === 'session-aaa').length === 0)

	// nothing archived anywhere
	const empty = await renderWith([], undefined, emptySnapshot)
	check('empty state is rendered', allText(empty).includes(props.messages.empty), allText(empty))

	// missing injected hook must not crash the page
	const withoutHook = await renderWith([liveRow], { useWorkspaces: undefined })
	check('missing useWorkspaces hook does not crash', allText(withoutHook).includes(props.messages.heading), allText(withoutHook).slice(0, 80))
	check('missing hook still renders the page body', allText(withoutHook).includes(props.messages.intro) && allText(withoutHook).includes(liveRow.title), allText(withoutHook))

	// 4. a DSH build without the atom package degrades gracefully ------------
	const fallback = loadBundle(false, false)
	let fallbackRegistered = null
	fallback.exports.apply({
		get: () => undefined,
		effect: () => () => {},
		slots: {
			inject: (key, callback) => { callback(); return () => {} },
			register: (options, component) => {
				if (options.name === 'settings.section') fallbackRegistered = { options, component }
				return () => {}
			},
		},
	})
	const fallbackProps = fallbackRegistered.options.inject()
	const fallbackHarness = createHarness(fallbackRegistered.component, { messages: fallbackProps.messages, api, useWorkspaces })
	fallbackHarness.render()
	await tick()
	const fallbackTree = fallbackHarness.render()
	const fallbackButtons = buttons(fallbackTree)
	check('fallback renders exactly the two row actions', fallbackButtons.length === 2, JSON.stringify(fallbackButtons.map((button) => allText(button))))
	check('fallback keeps the action class contract', fallbackButtons.every((button) => /as-action/.test(String(button.props.className))), JSON.stringify(fallbackButtons.map((button) => button.props.className)))
	check('fallback keeps the destructive styling', fallbackButtons.some((button) => /as-danger/.test(String(button.props.className))))
	check('fallback renders a real search input', byType(fallbackTree, 'input').length === 1 && byType(fallbackTree, 'input')[0].props.type === 'search')
	check('fallback still lists the rows', allText(fallbackTree).includes('单元测试会话'), allText(fallbackTree))

	// 5. the catalog refresh reaches the shipped client service ---------------
	// `sessions.refresh()` is the shell's own "re-pull the session list" call;
	// the plugin must use it instead of inventing a second source of truth.
	let serviceRefreshes = 0
	const serviceCtx = {
		get: (name) => (name === 'sessions' ? { refresh: async () => { serviceRefreshes += 1 } } : undefined),
		slots,
		effect: () => () => {},
	}
	loaded.exports.apply(serviceCtx)
	const serviceProps = registered.options.inject()
	const refreshed = await serviceProps.api.refreshSessionCatalog()
	check('catalog refresh pulls the shipped sessions service', refreshed === true && serviceRefreshes === 1, `${refreshed}/${serviceRefreshes}`)
	check('catalog refresh without the service is a quiet no-op', (await props.api.refreshSessionCatalog()) === false)

	// 6. the session-row menu (`...` + right-click) ---------------------------
	// The slot contract the shell actually uses: props `{ sessionId, displayTitle }`
	// plus `useMenuOpenState` injected as a prop, and the shell's own list service
	// for a row's `cwd`.
	const menuSlot = mounted.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
	check('row menu registers under the row-menu slot id', menuSlot !== undefined && menuSlot.options.id === 'archived-sessions.reveal-folder', menuSlot?.options.id)
	check('row menu keeps an order after the shipped items', menuSlot.options.order === 500, String(menuSlot.options.order))

	let describeCalls = 0
	const menuState = [true, () => {}]
	void describeCalls
	let opened = null
	let rowHostDeletes = 0
	let rowDescribeCalls = 0
	let rowCatalogRefreshes = 0
	// The shell's own session list, as the row menu sees it: `list.getSnapshot`
	// answers `cwd`, and `refresh` is the "re-pull the catalog" call the plugin
	// makes after a delete.
	const rowService = {
		list: { getSnapshot: () => ({ byId: { 'session-aaa': { cwd: 'D:\\Workspace\\DeepSeek Harness' } } }) },
		refresh: async () => { rowCatalogRefreshes += 1 },
	}
	const rowFetch = async (url, init) => {
		const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {}
		// The host envelope is `{ ok, value }`; `callHost` throws on anything else.
		if (url === '/archived-sessions/api/delete') {
			rowHostDeletes += 1
			return { ok: true, status: 200, json: async () => ({ ok: true, value: { trashedTo: `C:\\trash\\stamp__${body.sessionId}` } }) }
		}
		if (url === '/archived-sessions/api/describe') {
			rowDescribeCalls += 1
			return { ok: true, status: 200, json: async () => ({ ok: true, value: { sessionId: body.sessionId, cwd: null, archived: false, live: false, logsMissing: false } }) }
		}
		throw new Error(`unexpected route ${url}`)
	}
	const rowBundle = loadBundle(true, true, rowFetch)
	const rowMounted = []
	rowBundle.exports.apply({
		get: (name) => {
			if (name === 'sessions') return rowService
			if (name === 'remote.session') return { openWorkspacePath: async (arg) => { opened = arg } }
			return undefined
		},
		effect: (callback) => { callback(); return () => {} },
		slots: {
			inject: (key, callback) => { callback(); return () => {} },
			register: (options, component) => { rowMounted.push({ options, component }); return () => {} },
		},
	})
	const rowMenuSlot = rowMounted.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
	check('row menu registers on its own bundle too', rowMenuSlot !== undefined, String(rowMounted.length))
	const rowProps = rowMenuSlot.options.inject({ sessionId: 'session-aaa' })
	check('row menu inject exposes actions and the row id', typeof rowProps.actions?.describe === 'function' && rowProps.sessionId === 'session-aaa', Object.keys(rowProps).join(','))
	check('row menu inject carries no settings-page api', rowProps.api === undefined, String(rowProps.api))
	// The host describe route is what the menu calls through `actions`; the fetch
	// stub above answers it, so no transport patch is needed here.
	const menuHarness = createHarness(rowMenuSlot.component, Object.assign({}, rowProps, { useMenuOpenState: () => menuState }))
	menuHarness.render()
	await tick()
	await tick()
	const menuTree = menuHarness.render()
	const menuLabels = allText(menuTree)
	check('row menu asks the host to describe the session', rowDescribeCalls === 1, String(rowDescribeCalls))
	check('row menu offers 打开文件夹 and 删除任务', /打开文件夹/.test(menuLabels) && /删除任务/.test(menuLabels), menuLabels.slice(0, 120))
	check('row menu does not offer the settings-page restore action', !/恢复/.test(menuLabels), menuLabels.slice(0, 120))

	// A closed menu must not spend a host call per rendered row.
	rowDescribeCalls = 0
	const closedHarness = createHarness(rowMenuSlot.component, Object.assign({}, rowProps, { useMenuOpenState: () => [false, () => {}] }))
	closedHarness.render()
	await tick()
	check('closed row menu costs no host call', rowDescribeCalls === 0, String(rowDescribeCalls))

	// A host half that has not been reloaded yet answers 404 for `/describe`
	// (module caching is keyed by URL, so this is the normal state right after
	// an upgrade and before a restart). The row must not go dead: the shell's own
	// list snapshot still carries `cwd`, and an unavailable liveness answer must
	// not be read as "running" — otherwise every row would show a greyed delete.
	const staleBundle = loadBundle(true, true, async (url) => {
		if (url === '/archived-sessions/api/describe') {
			return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
		}
		throw new Error(`unexpected route ${url}`)
	})
	const staleMounted = []
	staleBundle.exports.apply({
		get: (name) => {
			if (name === 'sessions') return rowService
			if (name === 'remote.session') return { openWorkspacePath: async () => {} }
			return undefined
		},
		effect: (callback) => { callback(); return () => {} },
		slots: { inject: (key, callback) => { callback(); return () => {} }, register: (options, component) => { staleMounted.push({ options, component }); return () => {} } },
	})
	const staleSlot = staleMounted.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
	const staleProps = staleSlot.options.inject({ sessionId: 'session-aaa' })
	const staleHarness = createHarness(staleSlot.component, Object.assign({}, staleProps, { useMenuOpenState: () => [true, () => {}] }))
	staleHarness.render()
	await tick()
	await tick()
	const staleTree = staleHarness.render()
	const staleText = allText(staleTree)
	const staleReveal = findByText(staleTree, '打开文件夹')
	check('stale host still offers 打开文件夹 from the client snapshot', staleReveal !== null && staleReveal.props.disabled !== true, staleText.slice(0, 120))
	const staleDelete = findByText(staleTree, '删除任务')
	check('an unanswered liveness probe does not grey out delete', staleDelete !== null && staleDelete.props.disabled !== true, staleText.slice(0, 120))

	// Deleting from the row menu is a two-step action: the first click only arms
	// the entry (relabelled 确认删除), the second one runs the host route, and
	// only then does the catalog get re-pulled. The menu calls the actions object
	// the bundle built, so the host transport underneath it is what gets stubbed.
	const realRowProps = rowMenuSlot.options.inject({ sessionId: 'session-aaa' })
	const menuDeleteHarness = createHarness(rowMenuSlot.component, Object.assign({}, realRowProps, { useMenuOpenState: () => [true, () => {}] }))
	menuDeleteHarness.render()
	await tick()
	await tick()
	const deleteItem = findByText(menuDeleteHarness.render(), '删除任务')
	check('row menu renders a 删除任务 control', deleteItem !== null, String(deleteItem))
	await deleteItem.props.onClick()
	await tick()
	check('row-menu delete only arms on the first click', rowHostDeletes === 0, String(rowHostDeletes))
	await tick()
	const armedItem = findByText(menuDeleteHarness.render(), '确认删除')
	check('first click relabels the entry to 确认删除', armedItem !== null, allText(menuDeleteHarness.render()).slice(0, 120))
	// Arming is not a result. The item's own label already carries the prompt,
	// so a notice repeating it printed 确认删除 a second time as its own line
	// between 归档会话 and 打开文件夹. Exactly one occurrence is correct.
	const armedText = allText(menuDeleteHarness.render())
	const armedCount = armedText.split('确认删除').length - 1
	check('arming shows 确认删除 once, not also as a notice line', armedCount === 1, `${armedCount}x in ${armedText.slice(0, 160)}`)
	const armedNotes = collect(menuDeleteHarness.render(), (n) => n.props && n.props.className === 'as-menu-note')
	check('arming adds no as-menu-note line to the menu', armedNotes.length === 0, String(armedNotes.length))
	await armedItem.props.onClick()
	await tick()
	await tick()
	await tick()
	check('second click runs the delete and re-pulls the catalog', rowHostDeletes === 1 && rowCatalogRefreshes === 1, `${rowHostDeletes}/${rowCatalogRefreshes}`)

	// The reveal-folder lookup must read the dotted service name through `ctx.get`.
	// Cordis serves `remote.session` through an accessor that requires the dotted
	// name in the fiber's own `inject`, so reading it as `ctx.get('remote').session`
	// throws. That throw escaped `apply`, left the fiber FAILED, and the client
	// boot audit aborted the whole page with "web boot: 1 entry did not activate
	// \ndsh-archived-sessions: loading". This context models that runtime shape.
	const dottedBundle = loadBundle(true, true, rowFetch)
	const dottedMounted = []
	let dottedThrew = null
	try {
		dottedBundle.exports.apply({
			get: (name) => {
				if (name === 'sessions') return rowService
				if (name === 'remote.session') return { openWorkspacePath: async () => {} }
				if (name === 'remote') {
					return { get session() { throw new Error('cannot get property "remote.session" without inject') } }
				}
				return undefined
			},
			effect: (callback) => { callback(); return () => {} },
			slots: { inject: (key, callback) => { callback(); return () => {} }, register: (options, component) => { dottedMounted.push({ options, component }); return () => {} } },
		})
	} catch (error) { dottedThrew = error }
	check('apply survives a throwing remote.session accessor', dottedThrew === null, String(dottedThrew))
	const dottedSlot = dottedMounted.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
	check('the dotted accessor context still mounts the row menu', dottedSlot !== undefined, String(dottedMounted.length))
	const dottedProps = dottedSlot.options.inject({ sessionId: 'session-aaa' })
	const dottedHarness = createHarness(dottedSlot.component, Object.assign({}, dottedProps, { useMenuOpenState: () => [true, () => {}] }))
	dottedHarness.render()
	await tick()
	await tick()
	const dottedReveal = findByText(dottedHarness.render(), '打开文件夹')
	check('dotted lookup keeps 打开文件夹 usable', dottedReveal !== null && dottedReveal.props.disabled !== true, allText(dottedHarness.render()).slice(0, 120))

	// A successful reveal is silent: opening the file manager is the feedback, and
	// a notice echoing the path only printed a long line inside the menu. The
	// failure paths still have to speak, since they have no other signal.
	let revealOpened = null
	const quietBundle = loadBundle(true, true, rowFetch)
	const quietMounted = []
	quietBundle.exports.apply({
		get: (name) => {
			if (name === 'sessions') return rowService
			if (name === 'remote.session') return { openWorkspacePath: async (arg) => { revealOpened = arg } }
			return undefined
		},
		effect: (callback) => { callback(); return () => {} },
		slots: { inject: (key, callback) => { callback(); return () => {} }, register: (options, component) => { quietMounted.push({ options, component }); return () => {} } },
	})
	const quietSlot = quietMounted.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
	const quietProps = quietSlot.options.inject({ sessionId: 'session-aaa' })
	const quietHarness = createHarness(quietSlot.component, Object.assign({}, quietProps, { useMenuOpenState: () => [true, () => {}] }))
	quietHarness.render()
	await tick()
	await tick()
	const quietReveal = findByText(quietHarness.render(), '打开文件夹')
	await quietReveal.props.onClick()
	await tick()
	await tick()
	await tick()
	const quietText = allText(quietHarness.render())
	check('a successful reveal calls openWorkspacePath', revealOpened !== null && typeof revealOpened.path === 'string', JSON.stringify(revealOpened))
	check('a successful reveal shows no notice at all', !/打开文件夹：/.test(quietText) && !/打开文件夹:/.test(quietText), quietText.slice(0, 160))

	// 7. the batch-operations panel -------------------------------------------
	// A rail panel is two registrations sharing one id: the `main` body (keyed by
	// the id the rail selects) and the `sidebar.panellist` button. The panel body
	// operates on the *archive*, so the host `/list` route decides which rows
	// exist; the shell catalog only enriches those ids with a title, a cwd and
	// liveness. Both are stubbed here so the test pins that division of labour.
	let batchDeletes = 0
	let batchRestores = 0
	let batchArchives = 0
	let batchCatalogRefreshes = 0
	const batchSessions = {
		list: {
			getSnapshot: () => ({
				byId: {
					'session-one': { title: '第一个会话', cwd: 'D:\\Work\\one', updatedAt: 2 },
					'session-two': { title: '第二个会话', cwd: 'D:\\Work\\two', updatedAt: 1, running: true },
					// Deliberately in the catalog but NOT archived: the panel must not
					// draw it. Listing the catalog is what used to fill this panel with
					// every session in the sidebar.
					'session-live': { title: '不该出现的会话', cwd: 'D:\\Work\\live' },
				},
			}),
		},
		refresh: async () => { batchCatalogRefreshes += 1 },
	}
	const batchFetch = async (url, init) => {
		const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {}
		if (url === '/archived-sessions/api/delete') {
			batchDeletes += 1
			return { ok: true, status: 200, json: async () => ({ ok: true, value: { trashedTo: `C:\\trash\\stamp__${body.sessionId}` } }) }
		}
		if (url === '/archived-sessions/api/restore') {
			batchRestores += 1
			return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }
		}
		if (url === '/archived-sessions/api/list') {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					ok: true,
					value: {
						sessions: [
							{ sessionId: 'session-one', archived: true, title: null, cwd: null, live: false, directory: 'C:\\s\\one', logsMissing: false },
							{ sessionId: 'session-two', archived: true, title: null, cwd: null, live: true, directory: 'C:\\s\\two', logsMissing: false },
							// A ghost: archived flag set, log already in the trash. It must be
							// listed but not selectable.
							{ sessionId: 'session-ghost', archived: true, title: null, cwd: null, live: false, directory: null, logsMissing: true },
						],
					},
				}),
			}
		}
		if (url === '/archived-sessions/api/describe') {
			return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }
		}
		throw new Error(`unexpected route ${url}`)
	}
	const batchWorkspaces = {
		useWorkspaces: (selector) => selector({ items: [], archivedSessionIds: [], liveSessionIds: [] }),
		archiveSession: async () => { batchArchives += 1 },
	}
	const batchBundle = loadBundle(true, true, batchFetch)
	const batchMounted = []
	const batchCtx = {
		get: (name) => {
			if (name === 'sessions') return batchSessions
			if (name === 'workspaces') return batchWorkspaces
			return undefined
		},
		effect: (callback) => { callback(); return () => {} },
		slots: {
			inject: (key, callback) => { callback(); return () => {} },
			register: (options, component) => { batchMounted.push({ options, component }); return () => {} },
		},
	}
	batchBundle.exports.apply(batchCtx)
	const panelButton = batchMounted.find((entry) => entry.options.name === 'sidebar.panellist')
	const panelBody = batchMounted.find((entry) => entry.options.name === 'main')
	check('batch panel registers a sidebar rail entry', panelButton !== undefined && panelButton.options.id === 'archived-sessions.batch', panelButton?.options.id)
	check('batch panel rail entry carries the locale label', typeof panelButton.options.label === 'function' && panelButton.options.label() === '批量操作', typeof panelButton.options.label)
	check('batch panel body registers in main under the same key', panelBody !== undefined && panelBody.options.key === 'archived-sessions.batch', String(panelBody?.options.key))
	check('batch panel rail renders an icon without text', panelButton.component({}) !== null && allText(panelButton.component({})) === '', allText(panelButton.component({})).slice(0, 40))
	const panelProps = panelBody.options.inject()
	const panelHarness = createHarness(panelBody.component, panelProps)
	panelHarness.render()
	await tick()
	await tick()
	const panelTree = panelHarness.render()
	const panelText = allText(panelTree)
	check('batch panel lists the archived sessions the host reports', /第一个会话/.test(panelText) && /第二个会话/.test(panelText), panelText.slice(0, 140))
	check('batch panel never draws a catalog session that is not archived', !/不该出现的会话/.test(panelText), panelText.slice(0, 200))
	check('batch panel starts with nothing selected', /已选择 0 个会话/.test(panelText), panelText.slice(0, 140))
	// Liveness must come from the catalog entry (`summary.running`), which is what
	// the sidebar's own rows read — the workspace snapshot has no such list, and
	// grading off a nonexistent one would tag nothing and let a running session be
	// selected for a delete the host answers with 409.
	check('batch panel tags a running session from its catalog entry', /运行中/.test(panelText), panelText.slice(0, 160))
	// Three rows come back (two live, one ghost), so three checkboxes are drawn —
	// the ghost's is disabled. A dead session must never become selectable.
	const boxes = collect(panelTree, (item) => item.type === 'input' && item.props?.type === 'checkbox')
	check('batch panel renders one checkbox per archived session', boxes.length === 3, String(boxes.length))
	const ghostBox = boxes[2]
	check('a session whose log is gone gets a disabled checkbox', ghostBox?.props?.disabled === true, JSON.stringify(ghostBox?.props?.disabled))
	const selectAllButton = findByText(panelTree, '全选')
	check('batch panel offers a select-all control', selectAllButton !== null, String(selectAllButton))
	await selectAllButton.props.onClick()
	await tick()
	const selectedTree = panelHarness.render()
	check('select all marks every selectable row and skips the ghost', /已选择 2 个会话/.test(allText(selectedTree)), allText(selectedTree).slice(0, 140))
	// Deleting in bulk is gated the same way the row menu is: the first click on
	// the destructive action only asks, the second one runs it.
	const bulkDelete = findByText(selectedTree, '删除所选')
	check('batch panel renders the destructive action', bulkDelete !== null, String(bulkDelete))
	await bulkDelete.props.onClick()
	await tick()
	check('batch delete does not run on the first click', batchDeletes === 0, String(batchDeletes))
	const armedTree = panelHarness.render()
	const armText = allText(armedTree)
	check('batch delete labels the confirmation', /确认删除 2 个会话/.test(armText), armText.slice(0, 160))
	const armButton = findByText(armedTree, '确认删除 2 个会话')
	await armButton.props.onClick()
	await tick()
	await tick()
	await tick()
	check('batch delete runs once per selected session', batchDeletes === 2, String(batchDeletes))
	check('batch run re-pulls the session catalog', batchCatalogRefreshes >= 1, String(batchCatalogRefreshes))
	const doneText = allText(panelHarness.render())
	check('batch panel reports the outcome', /已完成 2 个会话/.test(doneText), doneText.slice(0, 160))
	// A pending delete confirmation states a count, so changing the selection
	// must disarm it — the label can never describe a different set than the one
	// the next click would run over.
	const disarmTree = panelHarness.render()
	await findByText(disarmTree, '全选').props.onClick()
	await tick()
	await findByText(panelHarness.render(), '删除所选').props.onClick()
	await tick()
	check('batch delete arms on the first click', /确认删除 2 个会话/.test(allText(panelHarness.render())), allText(panelHarness.render()).slice(0, 140))
	await findByText(panelHarness.render(), '清空选择').props.onClick()
	await tick()
	const disarmedText = allText(panelHarness.render())
	check('changing the selection disarms a pending delete', /删除所选/.test(disarmedText) && !/确认删除/.test(disarmedText), disarmedText.slice(0, 160))
	// Two clicks landing before React re-renders the disabled buttons must not
	// start a second loop over the same selection. The guard has to be
	// synchronous (a ref), or the duplicate click deletes every row twice.
	const beforeReentry = batchDeletes
	await findByText(panelHarness.render(), '全选').props.onClick()
	await tick()
	await findByText(panelHarness.render(), '删除所选').props.onClick()
	await tick()
	const armedTwice = findByText(panelHarness.render(), '确认删除 2 个会话')
	const firstClick = armedTwice.props.onClick()
	const secondClick = armedTwice.props.onClick()
	await Promise.all([firstClick, secondClick])
	await tick()
	await tick()
	await tick()
	check('a duplicate confirm click does not run the batch twice', batchDeletes - beforeReentry === 2, `${batchDeletes - beforeReentry} (expected 2)`)
	// Restore and archive share the same runner; archive has no plugin host
	// route, so it must go through the shipped workspaces service.
	const again = panelHarness.render()
	await findByText(again, '全选').props.onClick()
	await tick()
	await findByText(panelHarness.render(), '恢复所选').props.onClick()
	await tick()
	await tick()
	await tick()
	check('batch restore calls the host once per session', batchRestores === 2, String(batchRestores))
	await findByText(panelHarness.render(), '全选').props.onClick()
	await tick()
	await findByText(panelHarness.render(), '归档所选').props.onClick()
	await tick()
	await tick()
	await tick()
	check('batch archive goes through the shipped workspaces service', batchArchives === 2, String(batchArchives))

	// 8. right-click wiring --------------------------------------------------
	// The row's own attribute is the only handle the plugin gets; the delegated
	// listener must claim session rows and ignore everything else.
	const handlers = []
	const rightClickDocument = {
		addEventListener: (type, handler) => handlers.push({ type, handler }),
		removeEventListener: () => {},
		createElement: (tag) => ({ tag, setAttribute() {}, remove() {} }),
		body: { appendChild: () => {} },
		getElementById: () => null,
		head: { appendChild: () => {} },
	}
	const rightClickBundle = loadBundle()
	const seen = []
	const rightClickWindow = { __ModuleLoader__: { load: () => {} } }
	void rightClickWindow
	const rightSource = fs.readFileSync(CLIENT, 'utf8')
	const rightCaptured = { load: null }
	const rightRun = new Function('window', 'require', 'document', 'fetch', rightSource)
	rightRun({ __ModuleLoader__: { load: (mod) => { rightCaptured.load = mod } } }, (name) => {
		if (name === 'react') return ReactStub
		if (name === 'react-dom/client') return ReactDomStub
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return PrimitivesStub
		throw new Error(name)
	}, rightClickDocument, async () => { throw new Error('unexpected fetch') })
	rightCaptured.load.factory((name) => {
		if (name === 'react') return ReactStub
		if (name === 'react-dom/client') return ReactDomStub
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return PrimitivesStub
		throw new Error(name)
	}).apply({
		get: () => undefined,
		effect: (callback) => { callback(); return () => {} },
		slots: { inject: (key, callback) => { callback(); return () => {} }, register: () => () => {} },
	})
	const contextHandler = handlers.find((entry) => entry.type === 'contextmenu')
	check('right-click installs a delegated contextmenu listener', contextHandler !== undefined, JSON.stringify(handlers.map((h) => h.type)))

	// The shell owns the row menu, so a right-click must press the row's own
	// `...` trigger rather than render a second, narrower menu.
	const makeTrigger = () => {
		const state = { clicks: 0 }
		const button = { tagName: 'BUTTON', click: () => { state.clicks += 1 } }
		return { state, button }
	}
	const rowElement = (key, { trigger = null, cluster = null } = {}) => ({
		dataset: { rowKey: key },
		querySelector: (selector) => {
			if (typeof selector === 'string' && selector.includes('rowActions')) return cluster
			if (typeof selector === 'string' && selector.includes('button') && cluster === null) return trigger
			return null
		},
		closest: () => null,
	})
	const rowWithTrigger = (key) => {
		const { state, button } = makeTrigger()
		const cluster = {
			querySelector: (selector) => (typeof selector === 'string' && selector.includes('button') ? button : null),
			firstElementChild: button,
		}
		return { state, element: { dataset: { rowKey: key }, querySelector: (sel) => (typeof sel === 'string' && sel.includes('rowActions') ? cluster : null) } }
	}
	let prevented = 0
	const rowA = rowWithTrigger('session:session-aaa')
	contextHandler.handler({ button: 2, defaultPrevented: false, target: { closest: () => rowA.element }, preventDefault: () => { prevented += 1 } })
	check('right-click on a session row is claimed', prevented === 1, String(prevented))
	check('right-click opens the shell row menu through its trigger', rowA.state.clicks === 1, String(rowA.state.clicks))

	// A row with no trigger (a blank row) is left entirely alone.
	let blankPrevented = 0
	contextHandler.handler({ button: 2, defaultPrevented: false, target: { closest: () => rowElement('session:session-blank') }, preventDefault: () => { blankPrevented += 1 } })
	check('right-click on a row without a trigger is ignored', blankPrevented === 0, String(blankPrevented))

	let untouched = 0
	const rowB = rowWithTrigger('session:session-bbb')
	contextHandler.handler({ button: 2, defaultPrevented: false, target: { closest: () => rowElement('workspace:ws-1') }, preventDefault: () => { untouched += 1 } })
	contextHandler.handler({ button: 0, defaultPrevented: false, target: { closest: () => rowB.element }, preventDefault: () => { untouched += 1 } })
	contextHandler.handler({ button: 2, defaultPrevented: true, target: { closest: () => rowB.element }, preventDefault: () => { untouched += 1 } })
	check('right-click leaves non-session rows and other menus alone', untouched === 0, String(untouched))
	check('ignored right-clicks press no trigger', rowB.state.clicks === 0, String(rowB.state.clicks))
	void seen

	report()
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
