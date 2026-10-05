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
}

/**
 * Load `lib/client.js` exactly like client-modules does.
 * `withPrimitives: false` simulates a DSH build whose atom package is missing,
 * which must degrade to plain elements instead of blanking the panel.
 */
function loadBundle(withPrimitives = true) {
	const source = fs.readFileSync(CLIENT, 'utf8')
	const captured = { load: null }
	const windowStub = { __ModuleLoader__: { load: (mod) => { captured.load = mod } } }
	const styles = []
	const documentStub = {
		getElementById: (id) => styles.find((style) => style.id === id) || null,
		createElement: (tag) => ({ tag }),
		head: { appendChild: (element) => styles.push(element) },
	}
	const requireStub = (name) => {
		if (name === 'react') return ReactStub
		if (name === '@deepseek-ai/dsh-client-ui-primitives') {
			if (withPrimitives) return PrimitivesStub
			throw new Error('Cannot find module')
		}
		throw new Error(`unexpected require("${name}") — declare it in dsh.client.external`)
	}
	const run = new Function('window', 'require', 'document', 'fetch', source)
	run(windowStub, requireStub, documentStub, async () => { throw new Error('unexpected fetch') })
	if (captured.load === null) throw new Error('the bundle never called window.__ModuleLoader__.load')
	return { id: captured.load.id, exports: captured.load.factory(requireStub), styles }
}

// #endregion

function report() {
	console.log('')
	console.log(`${checks - failures}/${checks} checks passed`)
	process.exitCode = failures === 0 ? 0 : 1
}

async function main() {
	const loaded = loadBundle()

	check('bundle registers under the package name', loaded.id === 'dsh-archived-sessions', loaded.id)
	check('bundle exports apply + inject', typeof loaded.exports.apply === 'function' && Array.isArray(loaded.exports.inject))
	check('inject declares slots and workspaces', JSON.stringify(loaded.exports.inject) === JSON.stringify(['slots', 'workspaces']), JSON.stringify(loaded.exports.inject))

	// 2. apply(ctx) ---------------------------------------------------------
	let registered = null
	const injections = []
	const slots = {
		inject: (key, callback) => {
			injections.push(key)
			callback()
			return () => {}
		},
		register: (options, component) => {
			registered = { options, component }
			return () => {}
		},
	}
	const ctx = { get: () => undefined, slots }
	loaded.exports.apply(ctx)

	check('apply injects into settings.section', injections.length === 1 && injections[0] === 'settings.section', JSON.stringify(injections))
	check('apply registers exactly one section', registered !== null)
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
	check('hint line is rendered', liveText.includes(props.messages.hint))

	// idle session: delete becomes available
	const idle = await renderWith([Object.assign({}, liveRow, { live: false })])
	const idleRemove = buttons(idle).find((button) => allText(button) === props.messages.remove)
	check('idle session can be deleted', Boolean(idleRemove) && idleRemove.props.disabled === false, JSON.stringify(idleRemove?.props))
	check('idle session shows no warning note', collect(idle, (item) => item.props['data-kind'] === 'warn').length === 0)

	// the workspace snapshot alone still lists a session the host route omits
	const snapshotOnly = await renderWith([])
	const titleNode = collect(snapshotOnly, (item) => item.props.className === 'as-title')[0]
	check('snapshot alone keeps the session listed', allText(snapshotOnly).includes('session-aaa'), allText(snapshotOnly))
	check('snapshot-only row falls back to the session id as its title', Boolean(titleNode) && allText(titleNode) === 'session-aaa', allText(titleNode))

	// nothing archived anywhere
	const empty = await renderWith([], undefined, emptySnapshot)
	check('empty state is rendered', allText(empty).includes(props.messages.empty), allText(empty))

	// missing injected hook must not crash the page
	const withoutHook = await renderWith([liveRow], { useWorkspaces: undefined })
	check('missing useWorkspaces hook does not crash', allText(withoutHook).includes(props.messages.heading), allText(withoutHook).slice(0, 80))
	check('missing hook still renders the page body', allText(withoutHook).includes(props.messages.hint), allText(withoutHook))

	// 4. a DSH build without the atom package degrades gracefully ------------
	const fallback = loadBundle(false)
	let fallbackRegistered = null
	fallback.exports.apply({
		get: () => undefined,
		slots: {
			inject: (key, callback) => { callback(); return () => {} },
			register: (options, component) => { fallbackRegistered = { options, component }; return () => {} },
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

	report()
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
