#!/usr/bin/env node
/**
 * Isolated harness for the host half (`lib/index.js`).
 *
 * Runs the real plugin module against a fake Cordis context and a throwaway
 * `DSH_HOME`, so every route — list, restore, delete, the trust fence and the
 * error paths — is exercised without touching the user's real session store.
 *
 * Usage: node tools/test-host.cjs
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SESSION_ID = 'session-test-0001'
const WORKSPACE_PATH = path.join(os.tmpdir(), 'dsh-fake-workspace')
const results = []

/**
 * Record one assertion.
 *
 * `run` may be async: the entry is pushed first and then patched once the promise
 * settles, so an assertion failure inside an async body is reported instead of
 * escaping as an unhandled rejection (which used to abort the whole run).
 */
async function check(label, run) {
  const entry = { label, ok: true, message: undefined }
  results.push(entry)
  try {
    await run()
  } catch (error) {
    entry.ok = false
    entry.message = error instanceof Error ? error.message : String(error)
  }
  return entry
}

/** Minimal Node-request stand-in. */
function makeRequest({ method = 'GET', url = '/', headers = {}, body = undefined }) {
  const buffer = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (buffer) yield buffer
    },
  }
}

/** Minimal Node-response stand-in that records what the handler wrote. */
function makeResponse() {
  const record = { status: 0, headers: null, body: '' }
  return {
    record,
    set statusCode(value) {
      record.status = value
    },
    get statusCode() {
      return record.status
    },
    writeHead(status, headers) {
      record.status = status
      record.headers = headers
    },
    end(body) {
      if (body !== undefined) record.body = String(body)
    },
  }
}

/** Drive one route call. */
async function call(handler, options) {
  const response = makeResponse()
  await handler(makeRequest(options), response)
  let json = null
  try {
    json = JSON.parse(response.record.body)
  } catch {
    json = null
  }
  return { status: response.record.status, json, raw: response.record.body }
}

/** A fake WorkspaceRecord exposing exactly what the plugin touches. */
function makeRecord(state, id, workspacePath) {
  return {
    id,
    path: workspacePath,
    title: 'Test WS',
    record: { sessionIds: state.sessionIds.slice() },
    async detachSession(sessionId) {
      state.detached.push(sessionId)
      state.sessionIds = state.sessionIds.filter((candidate) => candidate !== sessionId)
      this.record.sessionIds = state.sessionIds.slice()
    },
  }
}

async function main() {
  // --- throwaway DSH home -------------------------------------------------
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-archived-test-'))
  process.env.DSH_HOME = home
  const projectKey = '--fake-project--'
  const sessionDir = path.join(home, 'sessions', projectKey, SESSION_ID)
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'fake-log')
  const cacheDir = path.join(home, 'storages', 'session_projcache', 'sessions')
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(
    path.join(cacheDir, `${SESSION_ID}.json`),
    JSON.stringify({ version: 1, record: { rows: { title: { ver: 1, seq: 3, val: '单元测试会话' } } } }),
  )

  // --- fake Cordis context ------------------------------------------------
  const state = { archived: [SESSION_ID], sessionIds: [SESSION_ID, 'session-other-0002'], detached: [], unarchived: [], live: new Map() }
  const registry = {
    get archivedSessionIds() {
      return state.archived.slice()
    },
    async unarchiveSession(sessionId) {
      state.unarchived.push(sessionId)
      state.archived = state.archived.filter((candidate) => candidate !== sessionId)
    },
    list() {
      return [makeRecord(state, 'ws-1', WORKSPACE_PATH)]
    },
    async readSessionHeader(sessionId) {
      if (sessionId !== SESSION_ID) throw new Error(`cannot validate session '${sessionId}'`)
      return { id: sessionId, version: 4, createdAt: 1, cwd: WORKSPACE_PATH }
    },
  }
  const graphRev = 'abc123abc123'
  const clientModules = {
    graph() {
      return { rev: 'graph-rev', entries: [{ id: 'dsh-archived-sessions', rev: graphRev }], batches: [] }
    },
    clientPath(packageName) {
      return packageName === 'dsh-archived-sessions' ? '/fake/plugins/archived-sessions/lib/client.js' : undefined
    },
  }
  let registeredClientModules = undefined
  let route = null
  const ctx = {
    workspaceRegistry: registry,
    logger: { info: () => {}, warn: () => {} },
    get(name) {
      if (name === 'sessions') return { get: (id) => state.live.get(id) }
      if (name === 'webRuntime') return { trustedHosts: ['trusted.example'] }
      if (name === 'clientModules') return registeredClientModules
      return undefined
    },
    effect(run) {
      run()
      return () => {}
    },
    webServer: {
      register(definition) {
        route = definition
        return () => {}
      },
    },
  }

  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href
  const plugin = await import(moduleUrl)
  plugin.apply(ctx)
  assert.ok(route, 'the plugin must register one route')
  const handler = (options) => call(route.handler, options)

  const trusted = { host: '127.0.0.1:19387', 'sec-fetch-site': 'same-origin' }

  // --- ping ---------------------------------------------------------------
  const ping = await handler({ url: '/archived-sessions/api/ping', headers: trusted })
  await check('ping returns the resolved paths', () => {
    assert.equal(ping.status, 200)
    assert.equal(ping.json.ok, true)
    assert.equal(ping.json.value.home, home)
    assert.ok(ping.json.value.sessionsRoot.endsWith(path.join('sessions')))
    assert.ok(ping.json.value.trashRoot.endsWith('sessions-trash'))
  })
  await check('ping reports an unavailable bundle when clientModules is absent', () => {
    assert.equal(ping.json.value.client.registered, false)
    assert.match(ping.json.value.client.reason, /clientModules service is unavailable/)
  })

  // --- client bundle report ----------------------------------------------
  registeredClientModules = { graph: () => ({ entries: [] }), clientPath: () => undefined }
  const pingNoEntry = await handler({ url: '/archived-sessions/api/ping', headers: trusted })
  await check('ping reports an unregistered bundle when the graph has no entry', () => {
    assert.equal(pingNoEntry.json.value.client.registered, false)
    assert.equal(pingNoEntry.json.value.client.graphEntries, 0)
  })
  registeredClientModules = clientModules
  const pingWithModules = await handler({ url: '/archived-sessions/api/ping', headers: trusted })
  await check('ping reports the combo bundle URL read from the live graph', () => {
    const client = pingWithModules.json.value.client
    assert.equal(client.registered, true)
    assert.equal(client.packageName, 'dsh-archived-sessions')
    assert.equal(client.rev, graphRev)
    assert.equal(client.clientPath, '/fake/plugins/archived-sessions/lib/client.js')
    assert.equal(client.url, `/plugins/??dsh-archived-sessions/client.js&rev=${graphRev}`)
  })

  // --- list ---------------------------------------------------------------
  const list = await handler({ url: '/archived-sessions/api/list', headers: trusted })
  await check('list merges archive flag, workspace, title and directory', () => {
    assert.equal(list.status, 200)
    assert.equal(list.json.value.sessions.length, 1)
    const row = list.json.value.sessions[0]
    assert.equal(row.sessionId, SESSION_ID)
    assert.equal(row.archived, true)
    assert.equal(row.title, '单元测试会话')
    assert.equal(row.workspaceId, 'ws-1')
    assert.equal(row.workspaceTitle, 'Test WS')
    assert.equal(row.workspacePath, WORKSPACE_PATH)
    assert.equal(row.directory, sessionDir)
    assert.equal(row.live, false)
    assert.equal(row.logsMissing, false)
  })

  // --- fence --------------------------------------------------------------
  await check('cross-site requests are refused', async () => {
    const refused = await handler({ url: '/archived-sessions/api/list', headers: { ...trusted, 'sec-fetch-site': 'cross-site' } })
    assert.equal(refused.status, 403)
  })
  const foreignHost = await handler({ url: '/archived-sessions/api/list', headers: { host: 'evil.example', 'sec-fetch-site': 'same-origin' } })
  await check('foreign hosts are refused', () => assert.equal(foreignHost.status, 403))
  const trustedHost = await handler({ url: '/archived-sessions/api/list', headers: { host: 'trusted.example', 'sec-fetch-site': 'same-origin' } })
  await check('webRuntime.trustedHosts are honoured', () => assert.equal(trustedHost.status, 200))
  const nullOrigin = await handler({ url: '/archived-sessions/api/list', headers: { ...trusted, origin: 'null' } })
  await check('a null Origin is refused', () => assert.equal(nullOrigin.status, 403))
  const mismatchedOrigin = await handler({ url: '/archived-sessions/api/list', headers: { ...trusted, origin: 'http://evil.example' } })
  await check('a mismatched Origin is refused', () => assert.equal(mismatchedOrigin.status, 403))
  const matchingOrigin = await handler({ url: '/archived-sessions/api/list', headers: { ...trusted, origin: 'http://127.0.0.1:19387' } })
  await check('a matching Origin is accepted', () => assert.equal(matchingOrigin.status, 200))

  // --- validation ---------------------------------------------------------
  const badId = await handler({ method: 'POST', url: '/archived-sessions/api/delete', headers: trusted, body: { sessionId: '../etc/passwd' } })
  await check('unsafe session ids are rejected with 400', () => assert.equal(badId.status, 400))
  const unknown = await handler({ url: '/archived-sessions/api/nope', headers: trusted })
  await check('unknown paths answer 404', () => assert.equal(unknown.status, 404))
  const wrongMethod = await handler({ url: '/archived-sessions/api/delete', headers: trusted })
  await check('non-POST mutation attempts answer 405', () => assert.equal(wrongMethod.status, 405))

  // --- restore ------------------------------------------------------------
  const restore = await handler({ method: 'POST', url: '/archived-sessions/api/restore', headers: trusted, body: { sessionId: SESSION_ID } })
  await check('restore unarchives the session', () => {
    assert.equal(restore.status, 200)
    assert.equal(restore.json.value.wasArchived, true)
    assert.deepEqual(state.archived, [])
  })
  await check('restore does not delete anything', () => assert.ok(fs.existsSync(sessionDir)))

  // --- describe (the row menu's data source) ------------------------------
  const described = await handler({ method: 'POST', url: '/archived-sessions/api/describe', headers: trusted, body: { sessionId: SESSION_ID } })
  await check('describe reports the cwd, owner and liveness for the row menu', () => {
    assert.equal(described.status, 200)
    const row = described.json.value
    assert.equal(row.sessionId, SESSION_ID)
    assert.equal(row.cwd, WORKSPACE_PATH)
    assert.equal(row.workspaceId, 'ws-1')
    assert.equal(row.workspacePath, WORKSPACE_PATH)
    // The restore test above already cleared the archive flag, so this is the
    // unarchived branch of the same call — the menu needs it for both cases.
    assert.equal(row.archived, false)
    assert.equal(row.live, false)
    assert.equal(row.directory, sessionDir)
    assert.equal(row.logsMissing, false)
  })
  await check('describe falls back to the projected title', () => {
    assert.equal(described.json.value.title, '单元测试会话')
  })
  await check('describe reports liveness while the session runs', async () => {
    state.live.set(SESSION_ID, { id: SESSION_ID })
    const running = await handler({ method: 'POST', url: '/archived-sessions/api/describe', headers: trusted, body: { sessionId: SESSION_ID } })
    state.live.clear()
    assert.equal(running.json.value.live, true)
    assert.equal(running.json.value.logsMissing, false, 'a running session is never "logs missing"')
  })
  await check('describe validates the session id', async () => {
    const bad = await handler({ method: 'POST', url: '/archived-sessions/api/describe', headers: trusted, body: { sessionId: 'a/b' } })
    assert.equal(bad.status, 400)
  })
  await check('describe keeps working for a session with no readable header', async () => {
    const unknown = await handler({ method: 'POST', url: '/archived-sessions/api/describe', headers: trusted, body: { sessionId: 'session-unknown-0009' } })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.json.value.cwd, null)
    assert.equal(unknown.json.value.archived, false)
  })

  // --- delete while live --------------------------------------------------
  state.live.set(SESSION_ID, { id: SESSION_ID })
  const liveDelete = await handler({ method: 'POST', url: '/archived-sessions/api/delete', headers: trusted, body: { sessionId: SESSION_ID } })
  await check('deleting a running session answers 409', () => {
    assert.equal(liveDelete.status, 409)
    assert.ok(fs.existsSync(sessionDir))
  })
  state.live.clear()

  // --- delete -------------------------------------------------------------
  state.archived = [SESSION_ID]
  const remove = await handler({ method: 'POST', url: '/archived-sessions/api/delete', headers: trusted, body: { sessionId: SESSION_ID } })
  await check('delete detaches the workspace account slot and moves the log to trash', () => {
    assert.equal(remove.status, 200)
    assert.equal(remove.json.value.wasArchived, true)
    assert.deepEqual(remove.json.value.detachedFrom, ['ws-1'])
    assert.deepEqual(state.detached, [SESSION_ID])
    assert.deepEqual(state.sessionIds, ['session-other-0002'])
    assert.equal(fs.existsSync(sessionDir), false)
    assert.equal(fs.existsSync(path.join(cacheDir, `${SESSION_ID}.json`)), false)
    const trashed = remove.json.value.trashedTo
    assert.ok(trashed && fs.existsSync(trashed))
    assert.ok(fs.existsSync(path.join(trashed, SESSION_ID, 'session.v4.jsonl.zstd')))
    assert.ok(fs.existsSync(path.join(trashed, `${SESSION_ID}.projcache.json`)))
  })
  await check('delete NEVER unarchives — otherwise the session is restored into its workspace', () => {
    // `unarchiveSession` means "the session returns to its recorded position" and the
    // archive set is what keeps it out of the sidebar, so this call must not happen here.
    assert.deepEqual(state.unarchived, [SESSION_ID], 'only the earlier restore may have called unarchiveSession')
    assert.deepEqual(state.archived, [SESSION_ID], 'the archive flag must survive the delete')
  })
  await check('a deleted session is listed as archived with its log missing', async () => {
    const after = await handler({ url: '/archived-sessions/api/list', headers: trusted })
    const row = after.json.value.sessions.find((item) => item.sessionId === SESSION_ID)
    assert.ok(row, 'the id is still archived, so the page must still see it')
    assert.equal(row.logsMissing, true)
    assert.equal(row.directory, null)
    assert.equal(row.archived, true)
  })

  // --- delete an unarchived session ---------------------------------------
  const orphansDir = path.join(home, 'sessions', projectKey, 'session-loose-0003')
  fs.mkdirSync(orphansDir, { recursive: true })
  fs.writeFileSync(path.join(orphansDir, 'session.v4.jsonl.zstd'), 'orphan-log')
  const loose = await handler({ method: 'POST', url: '/archived-sessions/api/delete', headers: trusted, body: { sessionId: 'session-loose-0003' } })
  await check('an unarchived session can still be deleted', () => {
    assert.equal(loose.status, 200)
    assert.equal(loose.json.value.wasArchived, false)
    assert.equal(fs.existsSync(orphansDir), false)
  })

  // --- deletion when the log is already gone ------------------------------
  state.archived = [SESSION_ID, 'session-ghost-0004']
  const ghost = await handler({ method: 'POST', url: '/archived-sessions/api/delete', headers: trusted, body: { sessionId: 'session-ghost-0004' } })
  await check('a session without a log directory still deletes cleanly', () => {
    assert.equal(ghost.status, 200)
    assert.equal(ghost.json.value.trashedTo, null)
    assert.deepEqual(state.archived, [SESSION_ID, 'session-ghost-0004'], 'an idempotent re-delete must not drop the flag either')
  })

  // --- report -------------------------------------------------------------
  fs.rmSync(home, { recursive: true, force: true })
  const failed = results.filter((entry) => !entry.ok)
  for (const entry of results) console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.label}${entry.ok ? '' : ` — ${entry.message}`}`)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
