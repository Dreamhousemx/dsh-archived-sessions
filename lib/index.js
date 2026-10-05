/**
 * Archived Sessions — host half.
 *
 * Mounts a small fenced JSON API under `/archived-sessions/api` that the
 * Settings page (lib/client.js) uses for the two operations DSH does not
 * expose anywhere else:
 *
 *   GET|POST /archived-sessions/api/list     archived sessions + workspace mapping
 *   POST     /archived-sessions/api/restore  unarchive one session
 *   POST     /archived-sessions/api/delete   delete one session (log dir -> trash)
 *
 * Why a plugin route instead of an existing RPC:
 *   - DSH 0.2.0-rc.2 has no session-delete API at all. `@deepseek-ai/dsh-session-persistence`
 *     states it explicitly ("No deletion or retention API"), its only members are
 *     create/open/stat/list/flush, and the whole session Remote namespace (22 methods)
 *     has no delete/remove/purge. So deletion is composed here from the two durable
 *     writes DSH does expose (drop the archive flag, detach the workspace account slot)
 *     plus an out-of-band move of the append-only log directory into a trash folder.
 *   - Archiving itself is a Workspace Registry concern, so restore reuses
 *     `workspaceRegistry.unarchiveSession`, which is exactly what the shipped
 *     `workspace.unarchiveSession` Remote resolves to.
 *
 * Deletion is deliberately recoverable: the session's log directory (and its
 * projection-cache record, when present) is RENAMED into `<DSH_HOME>/sessions-trash/`,
 * never erased. The client surface can therefore offer a real undo path later, and
 * the user can always move a folder back by hand.
 *
 * @module dsh-archived-sessions
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Cordis entry name (also the browser module id in lib/client.js). */
export const name = 'archived-sessions'

/**
 * Services this plugin needs before it mounts. `sessions` is intentionally NOT
 * listed: it is read opportunistically through `ctx.get('sessions')` (the same
 * pattern `@deepseek-ai/dsh-workspace` uses) so the page still works if that
 * service is absent.
 */
export const inject = ['webServer', 'workspaceRegistry']

/** Route prefix. Kept distinct from /api, /plugins and /sidebar. */
const ROUTE_PREFIX = '/archived-sessions/api'

/** Session ids are opaque but always filesystem-safe; reject anything else. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/** Request bodies are tiny JSON documents. */
const MAX_BODY_BYTES = 64 * 1024

// #region paths

/** The DSH home directory (holds `sessions/` and `storages/`). */
function dshHome() {
	const fromEnvironment = process.env.DSH_HOME
	if (typeof fromEnvironment === 'string' && fromEnvironment.trim() !== '') {
		return resolve(fromEnvironment)
	}
	return join(homedir(), '.dsh')
}

/** Root of the append-only session logs: `<DSH_HOME>/sessions/<project key>/<session id>/`. */
function sessionsRoot() {
	return join(dshHome(), 'sessions')
}

/** Trash root for deleted session logs. Out of `sessions/` so persistence never scans it. */
function trashRoot() {
	return join(dshHome(), 'sessions-trash')
}

/** Directory holding the per-session projection-cache records. */
function projectionCacheRoot() {
	return join(dshHome(), 'storages', 'session_projcache', 'sessions')
}

/**
 * The session's last projected title, read from its projection-cache record
 * (`{ version, record: { rows: { title: { ver, seq, val } } } }`). A session
 * header carries no title in DSH 0.2.0-rc.2 — the title projection does — so
 * this is the host-side source for the page and for the delete/move bookkeeping.
 * @param sessionId - the session to look up.
 * @returns the title, or null when unknown.
 */
async function readProjectedTitle(sessionId) {
	try {
		const text = await readFile(join(projectionCacheRoot(), `${sessionId}.json`), 'utf8')
		const value = JSON.parse(text)?.record?.rows?.title?.val
		return typeof value === 'string' && value.trim() !== '' ? value : null
	} catch {
		return null
	}
}

/**
 * Locate one session's log directory by scanning the project-key level. The
 * project key encodes the session's cwd (`~XXXX` escapes), so scanning is the
 * only way to find it without duplicating that encoding here.
 * @param sessionId - the session to find.
 * @returns the absolute directory, or null when it is already gone.
 */
async function locateSessionDirectory(sessionId) {
	let entries
	try {
		entries = await readdir(sessionsRoot(), { withFileTypes: true })
	} catch {
		return null
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		const candidate = join(sessionsRoot(), entry.name, sessionId)
		try {
			if ((await stat(candidate)).isDirectory()) return candidate
		} catch {
			// Not this project key.
		}
	}
	return null
}

// #endregion

// #region request helpers

/** Read one header value out of the raw Node request. */
function headerOf(headers, key) {
	const value = headers[key]
	if (Array.isArray(value)) return value[0]
	return value
}

/** Whether a hostname names this machine's loopback interface. */
function isLoopbackHostname(hostname) {
	return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

/** The web runtime's additional trusted hostnames, when that service is present. */
function trustedHostnames(ctx) {
	try {
		const runtime = ctx.get('webRuntime')
		const list = runtime?.trustedHosts
		return Array.isArray(list) ? list : []
	} catch {
		return []
	}
}

/**
 * Browser-trust fence, behaviorally equivalent to the one the /api gateway and
 * the shipped sidebar plugin apply: the Host authority must be ours (loopback
 * or an explicitly trusted hostname), `sec-fetch-site` must not be cross-site,
 * and a browser-attached Origin must name that same hostname.
 */
function createFence(ctx) {
	return function isTrustedRequest(request) {
		if (headerOf(request.headers, 'sec-fetch-site') === 'cross-site') return false
		const host = headerOf(request.headers, 'host')
		if (typeof host !== 'string' || host === '') return false
		let hostUrl
		try {
			hostUrl = new URL(`http://${host}`)
		} catch {
			return false
		}
		if (!isLoopbackHostname(hostUrl.hostname) && !trustedHostnames(ctx).includes(hostUrl.hostname)) return false
		const origin = headerOf(request.headers, 'origin')
		if (origin === undefined) return true
		if (origin === 'null') return false
		try {
			return new URL(origin).hostname === hostUrl.hostname
		} catch {
			return false
		}
	}
}

/** Collect and parse a small JSON request body. */
async function readJsonBody(request) {
	const chunks = []
	let size = 0
	for await (const chunk of request) {
		const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
		size += buffer.length
		if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
		chunks.push(buffer)
	}
	if (chunks.length === 0) return {}
	const text = Buffer.concat(chunks).toString('utf8').trim()
	if (text === '') return {}
	return JSON.parse(text)
}

/** Write one JSON response. */
function sendJson(response, status, payload) {
	const body = JSON.stringify(payload)
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': String(Buffer.byteLength(body)),
	})
	response.end(body)
}

/** A business failure that maps to its own HTTP status. */
class RouteError extends Error {
	constructor(status, message) {
		super(message)
		this.status = status
	}
}

/** Validate a session id coming in over the wire. */
function requireSessionId(value) {
	if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
		throw new RouteError(400, 'sessionId 缺失或格式非法')
	}
	return value
}

// #endregion

// #region operations

/** Whether the registry currently lists this id as archived. */
function isArchived(registry, sessionId) {
	return registry.archivedSessionIds.includes(sessionId)
}

/** The live host session for an id, when one exists. */
function liveSession(ctx, sessionId) {
	try {
		return ctx.get('sessions')?.get(sessionId)
	} catch {
		return undefined
	}
}

/**
 * Every workspace that still accounts for this session, with the raw account
 * array (the public `sessionIds` getter filters by header/cwd validity, which
 * would hide an account slot whose log is being removed).
 */
function accountingWorkspaces(registry, sessionId) {
	const owners = []
	for (const record of registry.list()) {
		const raw = record?.record?.sessionIds
		const ids = Array.isArray(raw) ? raw : record.sessionIds
		if (Array.isArray(ids) && ids.includes(sessionId)) owners.push(record)
	}
	return owners
}

/**
 * Archived sessions with enough context for the settings page: title-less
 * header facts plus the owning workspace. Titles are not part of a session
 * header in DSH 0.2.0-rc.2 (they live in the session projection cache), so the
 * page reads them from the client snapshot and falls back to the id here.
 */
async function listArchivedSessions(ctx) {
	const registry = ctx.workspaceRegistry
	const ownersBySession = new Map()
	for (const record of registry.list()) {
		const raw = record?.record?.sessionIds
		const ids = Array.isArray(raw) ? raw : record.sessionIds
		if (!Array.isArray(ids)) continue
		for (const sessionId of ids) {
			if (!ownersBySession.has(sessionId)) ownersBySession.set(sessionId, record)
		}
	}
	const sessions = []
	for (const sessionId of registry.archivedSessionIds) {
		const owner = ownersBySession.get(sessionId)
		let cwd
		try {
			cwd = (await registry.readSessionHeader(sessionId))?.cwd
		} catch {
			cwd = undefined
		}
		sessions.push({
			sessionId,
			archived: true,
			title: await readProjectedTitle(sessionId),
			cwd: cwd ?? owner?.path ?? null,
			workspaceId: owner?.id ?? null,
			workspaceTitle: owner?.title ?? null,
			workspacePath: owner?.path ?? null,
			live: liveSession(ctx, sessionId) !== undefined,
			directory: await locateSessionDirectory(sessionId),
		})
	}
	return { sessions, sessionsRoot: sessionsRoot(), trashRoot: trashRoot(), home: dshHome() }
}

/** Unarchive one session; the durable write publishes to every client automatically. */
async function restoreSession(ctx, sessionId) {
	const registry = ctx.workspaceRegistry
	const wasArchived = isArchived(registry, sessionId)
	await registry.unarchiveSession(sessionId)
	return { sessionId, wasArchived }
}

/**
 * Delete one session.
 *
 * Order matters: the archive flag and every workspace account slot are dropped
 * first (through the registry, so both durable writes go through the domain
 * write chain and publish to clients), and only then is the log directory moved
 * aside. A failure after the durable writes therefore leaves a clean workspace
 * without a stray log, and a failure before them touches nothing.
 */
async function deleteSession(ctx, sessionId) {
	const registry = ctx.workspaceRegistry
	if (liveSession(ctx, sessionId) !== undefined) {
		throw new RouteError(409, '该会话仍被宿主打开（正在运行或保留中），日志句柄可能还开着，删除有损坏日志的风险。请先关闭该会话，或重启 DeepSeek Harness 后再删除。')
	}
	const wasArchived = isArchived(registry, sessionId)
	if (wasArchived) await registry.unarchiveSession(sessionId)
	const detachedFrom = []
	for (const record of accountingWorkspaces(registry, sessionId)) {
		await record.detachSession(sessionId)
		detachedFrom.push(record.id ?? record.path ?? 'unknown')
	}
	const directory = await locateSessionDirectory(sessionId)
	const cacheFile = join(projectionCacheRoot(), `${sessionId}.json`)
	const hasCache = existsSync(cacheFile)
	const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
	const target = join(trashRoot(), `${stamp}__${sessionId}`)
	const moved = []
	if (directory !== null || hasCache) await mkdir(target, { recursive: true })
	if (directory !== null) {
		const destination = join(target, sessionId)
		await rename(directory, destination)
		moved.push(destination)
	}
	if (hasCache) {
		const destination = join(target, `${sessionId}.projcache.json`)
		await rename(cacheFile, destination)
		moved.push(destination)
	}
	if (moved.length > 0) {
		ctx.logger?.info?.(`archived-sessions: session '${sessionId}' deleted; logs moved to '${target}'`)
	}
	return { sessionId, wasArchived, detachedFrom, trashedTo: moved.length > 0 ? target : null, moved }
}

/**
 * Report how the client-modules registry sees this plugin's browser bundle.
 *
 * The browser fetches bundles through `/plugins` combo URLs; the requested
 * revision is a hash of the artifact's file metadata, so the URL is unknowable
 * offline and is read from the live graph instead. The single-package combo
 * (`/plugins/??<pkg>/client.js&rev=<rev>`) is the address that actually serves
 * this package: the package-local chunk route accepts only `client.<name>.js`
 * file names, which a hand-written `lib/client.js` does not match.
 * @param ctx - the plugin context.
 * @returns the registration facts, or why they are unavailable.
 */
function clientBundleReport(ctx) {
	const packageName = 'dsh-archived-sessions'
	try {
		const registry = ctx.get('clientModules')
		if (registry === undefined || typeof registry.graph !== 'function') {
			return { registered: false, packageName, reason: 'clientModules service is unavailable' }
		}
		const entries = registry.graph()?.entries ?? []
		const entry = entries.find((row) => row?.id === packageName)
		const clientPath = typeof registry.clientPath === 'function' ? registry.clientPath(packageName) : undefined
		if (entry === undefined) {
			return { registered: false, packageName, clientPath: clientPath ?? null, graphEntries: entries.length }
		}
		return {
			registered: true,
			packageName,
			rev: entry.rev ?? null,
			clientPath: clientPath ?? null,
			url: entry.rev === undefined ? null : `/plugins/??${packageName}/client.js&rev=${entry.rev}`,
		}
	} catch (error) {
		return { registered: false, packageName, reason: error instanceof Error ? error.message : String(error) }
	}
}

// #endregion

// #region route

/** Build the request handler for the whole prefix. */
function createHandler(ctx, fence) {
	return async function handle(request, response) {
		try {
			if (!fence(request)) {
				sendJson(response, 403, { ok: false, error: 'forbidden' })
				return
			}
			const url = new URL(request.url ?? '/', 'http://dsh.internal')
			const path = url.pathname.replace(/\/+$/u, '') || '/'
			const method = (request.method ?? 'GET').toUpperCase()

			if (path === `${ROUTE_PREFIX}/ping`) {
				sendJson(response, 200, {
					ok: true,
					value: {
						name,
						prefix: ROUTE_PREFIX,
						home: dshHome(),
						sessionsRoot: sessionsRoot(),
						trashRoot: trashRoot(),
						client: clientBundleReport(ctx),
					},
				})
				return
			}

			if (path === `${ROUTE_PREFIX}/list` && (method === 'GET' || method === 'POST')) {
				sendJson(response, 200, { ok: true, value: await listArchivedSessions(ctx) })
				return
			}

			if (path !== `${ROUTE_PREFIX}/restore` && path !== `${ROUTE_PREFIX}/delete`) {
				sendJson(response, 404, { ok: false, error: 'not found' })
				return
			}
			if (method !== 'POST') {
				sendJson(response, 405, { ok: false, error: 'method not allowed' })
				return
			}
			const body = await readJsonBody(request)

			if (path === `${ROUTE_PREFIX}/restore`) {
				const sessionId = requireSessionId(body?.sessionId)
				sendJson(response, 200, { ok: true, value: await restoreSession(ctx, sessionId) })
				return
			}

			if (path === `${ROUTE_PREFIX}/delete`) {
				const sessionId = requireSessionId(body?.sessionId)
				sendJson(response, 200, { ok: true, value: await deleteSession(ctx, sessionId) })
				return
			}

			sendJson(response, 404, { ok: false, error: 'not found' })
		} catch (error) {
			const status = error instanceof RouteError ? error.status : 500
			const message = error instanceof Error ? error.message : String(error)
			if (status >= 500) ctx.logger?.warn?.(`archived-sessions: request failed: ${message}`)
			sendJson(response, status, { ok: false, error: message })
		}
	}
}

/** Mount the API routes; the disposer unmounts them with the plugin fiber. */
export function apply(ctx) {
	const fence = createFence(ctx)
	ctx.effect(
		() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: createHandler(ctx, fence) }),
		'archived-sessions: settings API routes',
	)
}
// #endregion
