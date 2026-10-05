'use strict'

/**
 * Verify the plugin against the RUNNING DeepSeek Harness instance.
 *
 * Read-only: it never mutates sessions, workspaces or the profile. It answers
 * three questions with real evidence:
 *   1. is the host half mounted and serving its own route?
 *   2. does the live `/list` route see the archived sessions the host registry
 *      holds?
 *   3. is the browser half registered with client-modules, and is its bundle
 *      actually served to the page?
 *
 * The bundle address cannot be derived offline. Its revision is a hash of the
 * file's `stat` metadata (so it changes on every edit) and its shape is the
 * `/plugins` COMBO form — `/plugins/??<pkg>/client.js&rev=<rev>` — because the
 * package-local chunk route only accepts `client.<name>.js` file names, which a
 * hand-written `lib/client.js` never matches. The host half therefore reports
 * the live address in its ping payload, and this script fetches exactly that.
 *
 * Usage: node tools/verify-live.cjs        (override with DSH_BASE_URL=...)
 */

const fs = require('fs')
const path = require('path')

const BASE = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:19387'

/** Fetch one URL and return its status, content type and body. */
async function request(url) {
	const response = await fetch(url, { headers: { accept: '*/*' } })
	const body = await response.text()
	return { status: response.status, contentType: response.headers.get('content-type'), body }
}

async function main() {
	let failures = 0
	const check = (label, ok, detail) => {
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `  — ${detail}`}`)
		if (!ok) failures += 1
	}

	// 1. host half -----------------------------------------------------------
	const ping = await request(`${BASE}/archived-sessions/api/ping`)
	let pingValue
	try {
		pingValue = JSON.parse(ping.body).value
	} catch {
		pingValue = undefined
	}
	check('host route answers ping with 200', ping.status === 200, `status ${ping.status}`)
	check('ping payload reports the plugin', pingValue?.name === 'archived-sessions', ping.body.slice(0, 120))
	if (pingValue !== undefined) {
		console.log(`      home    : ${pingValue.home}`)
		console.log(`      sessions: ${pingValue.sessionsRoot}`)
		console.log(`      trash   : ${pingValue.trashRoot}`)
	}

	// 2. live list -----------------------------------------------------------
	const list = await request(`${BASE}/archived-sessions/api/list`)
	let listValue
	try {
		listValue = JSON.parse(list.body).value
	} catch {
		listValue = undefined
	}
	check('list route answers with 200', list.status === 200, `status ${list.status}`)
	const items = Array.isArray(listValue?.sessions) ? listValue.sessions : []
	// Every row is enumerated from the host's archived set; `archived` is only
	// explicit false if the host says so (older host modules omit the field).
	const isArchived = (item) => item.archived !== false
	console.log(`      archived: ${items.filter(isArchived).length} of ${items.length} listed session(s)`)
	for (const item of items.slice(0, 8)) {
		const title = item.title ?? '(no title)'
		console.log(`      ${isArchived(item) ? 'A' : ' '} ${item.sessionId}  ${title}${item.live === true ? '  [running]' : ''}`)
	}

	// 3. browser half --------------------------------------------------------
	const bundleUrl = pingValue?.client?.url
	if (typeof bundleUrl !== 'string' || bundleUrl.length === 0) {
		console.log('SKIP  client bundle — ping carries no "client" report, so the running host half predates it')
		console.log('      (restart DeepSeek Harness to load the current host code, then re-run this script)')
	} else {
		const url = `${BASE}${bundleUrl.startsWith('/') ? '' : '/'}${bundleUrl}`
		const bundle = await request(url)
		console.log(`      bundle  : ${url}`)
		check('client bundle is served', bundle.status === 200, `status ${bundle.status} content-type ${bundle.contentType ?? '-'}`)
		check('bundle registers with the module loader', bundle.body.includes('__ModuleLoader__.load'), bundle.body.includes('__ModuleLoader__.load') ? undefined : `first bytes: ${bundle.body.slice(0, 60)}`)
		check('bundle registers the settings section', bundle.body.includes('settings.section'), bundle.body.includes('settings.section') ? undefined : 'missing "settings.section"')
		check('bundle carries the native-metrics styling', bundle.body.includes('max-width:760px') && !bundle.body.includes('height:100%'), bundle.body.includes('max-width:760px') ? 'a stale revision is still being served' : 'missing "max-width:760px"')
		const local = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
		check('served bundle matches lib/client.js on disk', bundle.body.includes(local.trim()), 'the served bytes differ from the file — press F5 in the app and re-run')
	}

	console.log('')
	console.log(failures === 0 ? 'ALL LIVE CHECKS PASSED' : `${failures} LIVE CHECK(S) FAILED`)
	process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
