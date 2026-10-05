#!/usr/bin/env node
/**
 * Installer / reverter / status reporter for the `dsh-archived-sessions` plugin.
 *
 * Five subcommands, all idempotent:
 *
 *   install         Local channel: link the package into the profile's
 *                   `plugins\` directory and add a loader row to the profile
 *                   patch (`cordis.patch.yml`).
 *   revert          Remove that loader row and the link, restoring the backup.
 *   bundle-install  Official channel: `dsh plugin --profile <name> add
 *                   link:<package dir>` — the packaged bundle route used by
 *                   every published DSH plugin (dependency + `dsh.profile.bundles`).
 *   bundle-remove   Official channel teardown: `dsh plugin --profile <name> remove`.
 *   status          Report which channel is active, the link and live-server state.
 *
 * The two channels must never be active at the same time: both contribute a
 * loader row for the same entry id, and the host refuses to mount the route
 * twice (`webserver: duplicate prefix route "/archived-sessions/api"`).
 *
 * Why `install` exists (a link + loader row instead of `pnpm add`):
 *   DSH resolves a loader row whose `name` starts with `.` relative to the
 *   profile directory (`@deepseek-ai/cordis-plugin-loader`), and
 *   `@deepseek-ai/dsh-client-modules` accepts such path-like rows as client
 *   bundles as long as the nearest `package.json` declares
 *   `dsh.client.platform === "web"` and an `exports["./client"]` entry — which
 *   this package does. So no package manager, no network and no rebuild is
 *   needed, and the profile's `package.json` / lock file stay untouched.
 *
 * Usage:
 *   node lib/setup.cjs install        [--profile <dir>] [--source <dir>] [--url <origin>]
 *   node lib/setup.cjs revert         [--profile <dir>] [--url <origin>]
 *   node lib/setup.cjs bundle-install [--profile <dir>] [--source <dir>] [--name <profile>]
 *                                     [--cli <dsh.cmd>] [--strict-release-age] [--url <origin>]
 *   node lib/setup.cjs bundle-remove  [--profile <dir>] [--name <profile>] [--cli <dsh.cmd>]
 *   node lib/setup.cjs status         [--profile <dir>] [--source <dir>] [--url <origin>]
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ENTRY_ID = 'archived-sessions'
const PACKAGE_NAME = 'dsh-archived-sessions'
const LINK_NAME = 'archived-sessions'
const LOADER_NAME = `./plugins/${LINK_NAME}/lib/index.js`
const BACKUP_SUFFIX = '.dsh-archived-sessions.bak'
const DEFAULT_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:19387'

/** Parse `--key value` / `--flag` arguments. */
function parseArguments(argv) {
  const options = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      options._.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      options[key] = true
      continue
    }
    options[key] = next
    index += 1
  }
  return options
}

/** Default profile directory: `<DSH_HOME>/profiles/<DSH_PROFILE>`. */
function defaultProfileDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'desktop'
  return path.join(home, 'profiles', profile)
}

/** The package directory that contains this script (`<pkg>/lib/setup.cjs`). */
function defaultSourceDir() {
  return path.resolve(__dirname, '..')
}

/** The loader row block appended to the profile patch. */
function loaderBlock() {
  return [`- insert:`, `    - id: ${ENTRY_ID}`, `      name: '${LOADER_NAME}'`].join('\n')
}

/** Whether the patch already carries our loader row. */
function hasLoaderRow(text) {
  return text.includes(`./plugins/${LINK_NAME}/lib/index.js`)
}

/** True when `target` is a link (junction or symlink) rather than a real directory. */
function isLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
}

/** Read the profile manifest, tolerating a missing or malformed file. */
function readProfileManifest(profileDir) {
  const manifestPath = path.join(profileDir, 'package.json')
  if (!fs.existsSync(manifestPath)) return { manifestPath, manifest: null, error: 'package.json not found' }
  try {
    return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), error: null }
  } catch (error) {
    return { manifestPath, manifest: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Facts about the official package-manager channel.
 *
 * `dsh plugin --profile <name> add link:<dir>` records a dependency and, when
 * the pnpm run succeeds, appends the package name to `dsh.profile.bundles`
 * (`reconcile`); the bundle then contributes its own `cordis.patch.yml` loader
 * row. Both halves are required before the profile can mount the plugin.
 */
function bundleState(profileDir) {
  const { manifestPath, manifest, error } = readProfileManifest(profileDir)
  const dependency = manifest?.dependencies?.[PACKAGE_NAME] ?? null
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const listed = bundles.includes(PACKAGE_NAME)
  const installPath = path.join(profileDir, 'node_modules', PACKAGE_NAME)
  const installTarget = isLink(installPath) ? fs.readlinkSync(installPath) : null
  return {
    manifestPath,
    manifestError: error,
    dependency,
    listed,
    installPath,
    installTarget,
    installed: dependency !== null || fs.existsSync(installPath),
    active: dependency !== null && listed,
  }
}

/** The `dsh` launcher, which forwards `plugin <args>` verbatim to the bundled pnpm. */
function findCli(explicit) {
  const candidates = []
  if (typeof explicit === 'string') candidates.push(explicit)
  if (process.env.DSH_CLI) candidates.push(process.env.DSH_CLI)
  if (process.env.DSH_DIR) candidates.push(path.join(process.env.DSH_DIR, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return path.resolve(candidate)
  }
  const probe = process.platform === 'win32' ? ['where', ['dsh']] : ['which', ['dsh']]
  const located = spawnSync(probe[0], probe[1], { encoding: 'utf8' })
  const first = (located.stdout || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
  if (first && fs.existsSync(first)) return first
  throw new Error("the 'dsh' CLI was not found — pass --cli <path to dsh.cmd> or set DSH_CLI")
}

/** Create the profile → package link, replacing an existing link of the same name. */
function ensureLink(linkPath, sourceDir) {
  const resolvedSource = path.resolve(sourceDir)
  if (isLink(linkPath)) {
    const current = path.resolve(fs.readlinkSync(linkPath))
    if (current === resolvedSource) return { created: false, replaced: false, linkPath }
    fs.rmdirSync(linkPath)
  } else if (fs.existsSync(linkPath)) {
    throw new Error(`refusing to touch '${linkPath}': it exists and is not a link`)
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  fs.symlinkSync(resolvedSource, linkPath, 'junction')
  return { created: true, replaced: false, linkPath }
}

/** Remove the link without ever deleting the package it points at. */
function removeLink(linkPath) {
  if (!isLink(linkPath)) return false
  try {
    fs.unlinkSync(linkPath)
  } catch {
    fs.rmdirSync(linkPath)
  }
  return true
}

/** Add (or refresh) the loader row in the profile patch, backing the file up first. */
function patchProfile(profileDir) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const backupPath = `${patchPath}${BACKUP_SUFFIX}`
  const existed = fs.existsSync(patchPath)
  const original = existed ? fs.readFileSync(patchPath, 'utf8') : '[]\n'
  if (!existed) {
    // Never invent a profile: the patch file is the profile's own root overlay.
    throw new Error(`profile patch not found: '${patchPath}' (is the profile path correct?)`)
  }
  if (hasLoaderRow(original)) return { patchPath, changed: false }
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, original, 'utf8')
  const separator = original.endsWith('\n') ? '' : '\n'
  const updated = `${original}${separator}\n# ${PACKAGE_NAME}: Settings → 已归档会话\n${loaderBlock()}\n`
  fs.writeFileSync(patchPath, updated, 'utf8')
  return { patchPath, changed: true, backupPath }
}

/** Remove the loader row block, preferring the pristine backup when present. */
function unpatchProfile(profileDir) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const backupPath = `${patchPath}${BACKUP_SUFFIX}`
  if (!fs.existsSync(patchPath)) return { patchPath, changed: false }
  if (fs.existsSync(backupPath)) {
    const current = fs.readFileSync(patchPath, 'utf8')
    if (hasLoaderRow(current)) {
      fs.writeFileSync(patchPath, fs.readFileSync(backupPath, 'utf8'), 'utf8')
      fs.rmSync(backupPath, { force: true })
      return { patchPath, changed: true, restored: true }
    }
    fs.rmSync(backupPath, { force: true })
    return { patchPath, changed: false }
  }
  const original = fs.readFileSync(patchPath, 'utf8')
  const lines = original.split('\n')
  const kept = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === '- insert:' && lines.slice(index + 1, index + 3).some((line) => line.includes(LOADER_NAME))) {
      index += 2
      while (index + 1 < lines.length && /^\s+(#|$)/u.test(lines[index + 1])) index += 1
      continue
    }
    kept.push(lines[index])
  }
  const updated = kept.join('\n')
  if (updated === original) return { patchPath, changed: false }
  fs.writeFileSync(patchPath, updated, 'utf8')
  return { patchPath, changed: true, restored: false }
}

/** Probe the plugin's own host route on a running DSH. */
async function probe(origin) {
  try {
    const response = await fetch(`${origin.replace(/\/+$/u, '')}/archived-sessions/api/ping`)
    const text = await response.text()
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
    return { reachable: true, status: response.status, mounted: payload?.ok === true, payload }
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Print the browser-bundle facts the ping payload carries (host half only). */
function reportClient(health) {
  if (!health.mounted) return
  const client = health.payload?.value?.client
  if (client === undefined) {
    console.log('client  : unknown — the running host module predates the client report (restart DSH to refresh it)')
    return
  }
  if (client.registered === true) {
    console.log(`client  : registered with client-modules (rev ${client.rev})`)
    console.log(`url     : ${client.url}`)
  } else {
    console.log(`client  : NOT registered (${client.reason ?? `the module graph holds ${client.graphEntries} entries`})`)
  }
}

/** `install` subcommand. */
async function runInstall(options) {
  const profileDir = path.resolve(options.profile || defaultProfileDir())
  const sourceDir = path.resolve(options.source || defaultSourceDir())
  const linkPath = path.join(profileDir, 'plugins', LINK_NAME)
  if (!fs.existsSync(path.join(sourceDir, 'lib', 'index.js'))) {
    throw new Error(`plugin sources missing under '${sourceDir}'`)
  }
  const bundle = bundleState(profileDir)
  if (bundle.dependency !== null) {
    throw new Error(
      `the official bundle channel is already configured ('${PACKAGE_NAME}': ${bundle.dependency}) — ` +
        'run bundle-remove.cmd first; installing the profile patch as well would mount the host route twice',
    )
  }
  const link = ensureLink(linkPath, sourceDir)
  const patch = patchProfile(profileDir)
  console.log(`profile : ${profileDir}`)
  console.log(`source  : ${sourceDir}`)
  console.log(`link    : ${link.linkPath}${link.created ? '  (created)' : '  (already linked)'}`)
  console.log(`patch   : ${patch.patchPath}${patch.changed ? '  (loader row added)' : '  (loader row already present)'}`)
  if (patch.backupPath && patch.changed) console.log(`backup  : ${patch.backupPath}`)
  await reportMount(options)
}

/** `revert` subcommand. */
async function runRevert(options) {
  const profileDir = path.resolve(options.profile || defaultProfileDir())
  const linkPath = path.join(profileDir, 'plugins', LINK_NAME)
  const patch = unpatchProfile(profileDir)
  const linkRemoved = removeLink(linkPath)
  console.log(`patch   : ${patch.patchPath}${patch.changed ? (patch.restored ? '  (restored from backup)' : '  (loader row removed)') : '  (loader row absent)'}`)
  console.log(`link    : ${linkPath}${linkRemoved ? '  (removed)' : '  (absent)'}`)
  console.log('note    : DSH reloads the profile patch automatically; restart it only if the page persists.')
}

/** Probe the running DSH and print the mount / client-half state. */
async function reportMount(options) {
  const health = await probe(options.url || DEFAULT_URL)
  if (!health.reachable) {
    console.log('server  : not reachable — start DeepSeek Harness to load the plugin')
    return health
  }
  if (health.mounted) console.log(`server  : plugin route mounted (${health.status}) — open 设置 → 已归档会话`)
  else console.log(`server  : reachable but route answered ${health.status}; the profile reload may still be in flight`)
  reportClient(health)
  if (health.mounted) console.log('note    : the browser half loads on a page refresh (F5); no restart is needed for it.')
  return health
}

/** Run `dsh plugin --profile <name> …`, quoting the command line for cmd.exe. */
function runPluginCommand(cli, args, cwd) {
  const quoted = [cli, ...args]
    .map((part) => (/[\s"]/u.test(part) ? `"${part.replace(/"/gu, '\\"')}"` : part))
    .join(' ')
  console.log(`command : ${quoted}`)
  return spawnSync(quoted, { shell: true, stdio: 'inherit', cwd })
}

/** `bundle-install` subcommand: the official packaged-bundle channel. */
async function runBundleInstall(options) {
  const profileDir = path.resolve(options.profile || defaultProfileDir())
  const sourceDir = path.resolve(options.source || defaultSourceDir())
  const profileName = (typeof options.name === 'string' ? options.name : process.env.DSH_PROFILE) || path.basename(profileDir)
  if (!fs.existsSync(path.join(sourceDir, 'lib', 'index.js'))) {
    throw new Error(`plugin sources missing under '${sourceDir}'`)
  }
  const cli = findCli(options.cli)
  const relax = options['strict-release-age'] !== true
  const spec = `link:${sourceDir}`
  const args = ['plugin', '--profile', profileName, 'add']
  if (relax) args.push('--config.minimumReleaseAge=0')
  args.push(spec)
  const before = bundleState(profileDir)
  console.log(`profile : ${profileDir}`)
  console.log(`source  : ${sourceDir}`)
  console.log(`cli     : ${cli}`)
  if (before.active) console.log(`bundle  : already installed (${before.dependency}) — the manifest will not change`)
  else if (before.dependency !== null) console.log(`bundle  : dependency '${before.dependency}' exists but is not listed in dsh.profile.bundles`)
  if (relax) {
    console.log('note    : pnpm\'s minimumReleaseAge policy is relaxed for this one run, because the')
    console.log('          profile already pins a dependency published inside that window; pass')
    console.log('          --strict-release-age to keep the policy (a young dependency then fails).')
  }
  const run = runPluginCommand(cli, args, profileDir)
  if (run.error) throw run.error
  if ((run.status ?? 1) !== 0) {
    throw new Error(
      `the dsh CLI exited with ${run.status} — the profile can be left half-updated (pnpm rewrites ` +
        `pnpm-lock.yaml before it fails); inspect ${path.join(profileDir, '.plugin-manager', 'logs')} and see README (rollback)`,
    )
  }
  reportBundle(profileDir)
  await reportMount(options)
}

/** `bundle-remove` subcommand: uninstall through the official channel. */
async function runBundleRemove(options) {
  const profileDir = path.resolve(options.profile || defaultProfileDir())
  const profileName = (typeof options.name === 'string' ? options.name : process.env.DSH_PROFILE) || path.basename(profileDir)
  const cli = findCli(options.cli)
  const before = bundleState(profileDir)
  console.log(`profile : ${profileDir}`)
  console.log(`cli     : ${cli}`)
  if (!before.installed) {
    console.log('bundle  : not installed (no dependency and no node_modules entry) — nothing to do')
    return
  }
  if (before.dependency === null) {
    console.log(`bundle  : no dependency in package.json — remove the leftover '${before.installPath}' by hand`)
  } else {
    const relax = options['strict-release-age'] !== true
    const args = ['plugin', '--profile', profileName, 'remove']
    if (relax) args.push('--config.minimumReleaseAge=0')
    args.push(PACKAGE_NAME)
    const run = runPluginCommand(cli, args, profileDir)
    if (run.error) throw run.error
    if ((run.status ?? 1) !== 0) throw new Error(`the dsh CLI exited with ${run.status}; see README (rollback)`)
  }
  const after = bundleState(profileDir)
  if (after.dependency === null && isLink(after.installPath)) {
    if (removeLink(after.installPath)) console.log(`cleanup : removed the leftover link ${after.installPath}`)
  }
  reportBundle(profileDir)
  await reportMount(options)
}

/** Print the package-manager-channel facts for `profileDir`. */
function reportBundle(profileDir) {
  const bundle = bundleState(profileDir)
  if (bundle.manifestError) {
    console.log(`bundle  : manifest unreadable (${bundle.manifestError})`)
    return bundle
  }
  console.log(`bundle  : ${bundle.dependency === null ? 'no dependency in package.json' : bundle.dependency}`)
  console.log(`bundles : ${bundle.listed ? 'listed in dsh.profile.bundles' : 'NOT listed in dsh.profile.bundles'}`)
  const install = bundle.installTarget !== null
    ? `  -> ${bundle.installTarget}`
    : fs.existsSync(bundle.installPath)
      ? '  (present but not a link!)'
      : '  (absent!)'
  console.log(`link    : ${bundle.installPath}${install}`)
  return bundle
}

/** `status` subcommand. */
async function runStatus(options) {
  const profileDir = path.resolve(options.profile || defaultProfileDir())
  const sourceDir = path.resolve(options.source || defaultSourceDir())
  const linkPath = path.join(profileDir, 'plugins', LINK_NAME)
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const patchText = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : ''
  const loaderRow = hasLoaderRow(patchText)
  const bundle = bundleState(profileDir)
  let channel = bundle.active ? 'bundle (official)' : loaderRow ? 'profile patch (local)' : 'none'
  if (bundle.dependency !== null && loaderRow) channel = 'BOTH — remove one, the host route would mount twice'
  console.log(`profile : ${profileDir}`)
  console.log(`source  : ${sourceDir}${fs.existsSync(sourceDir) ? '' : '  (missing!)'}`)
  console.log(`channel : ${channel}`)
  console.log(`patch   : ${loaderRow ? 'loader row present' : 'loader row absent'}  (${patchPath})`)
  reportBundle(profileDir)
  if (isLink(linkPath)) console.log(`junction: -> ${fs.readlinkSync(linkPath)}  (local channel only)`)
  const health = await probe(options.url || DEFAULT_URL)
  if (!health.reachable) console.log(`server  : not reachable at ${options.url || DEFAULT_URL}`)
  else console.log(`server  : ${health.mounted ? 'plugin route mounted' : 'plugin route NOT mounted'} (HTTP ${health.status})`)
  reportClient(health)
}

const options = parseArguments(process.argv.slice(2))
const command = options._[0] || 'status'
const commands = {
  install: runInstall,
  revert: runRevert,
  'bundle-install': runBundleInstall,
  'bundle-remove': runBundleRemove,
  status: runStatus,
}
const run = Object.hasOwn(commands, command) ? commands[command] : null
if (run === null) {
  console.error(`unknown command '${command}' — expected ${Object.keys(commands).join(' | ')}`)
  process.exit(2)
}
Promise.resolve(run(options)).catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
