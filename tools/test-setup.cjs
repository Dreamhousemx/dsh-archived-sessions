#!/usr/bin/env node
/**
 * Isolated harness for `lib/setup.cjs`.
 *
 * `repair` rewrites the profile manifest, so every case runs against a
 * throwaway profile directory — never the user's real profile. The helper is
 * loaded as a module (the file exports internals when required) and driven
 * directly, so no child process, no network and no pnpm run is involved.
 *
 * Usage: node tools/test-setup.cjs
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PACKAGE_NAME = 'dsh-archived-sessions'
const results = []

/** Record one assertion; an async body that throws is reported, not rejected. */
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

/** A throwaway profile directory, removed by the caller. */
function makeProfile({ withDependency = true, withListing = false, declarePatch = true, linkTarget = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-archived-setup-'))
  const manifest = { name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }
  if (withDependency) manifest.dependencies[PACKAGE_NAME] = `link:${path.join(os.tmpdir(), 'dsh-archived-sessions')}`
  if (withListing) manifest.dsh.profile.bundles.push(PACKAGE_NAME)
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')

  const packageDir = path.join(dir, 'node_modules', PACKAGE_NAME)
  fs.mkdirSync(packageDir, { recursive: true })
  const declared = { name: PACKAGE_NAME, version: '1.0.1' }
  if (declarePatch) declared.dsh = { bundle: { patch: './cordis.patch.yml' } }
  fs.writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify(declared, undefined, 2)}\n`, 'utf8')

  if (linkTarget !== null) {
    fs.rmSync(packageDir, { recursive: true, force: true })
    fs.symlinkSync(linkTarget, packageDir, 'junction')
  }
  return { dir, packageDir }
}

function readBundles(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dsh.profile.bundles
}

async function main() {
  const { repairBundle } = require('../lib/setup.cjs')

  await check('repair restores a listing lost to reconcile', () => {
    const { dir } = makeProfile({ withDependency: true, withListing: false })
    const result = repairBundle(dir)
    assert.equal(result.changed, true)
    assert.ok(readBundles(dir).includes(PACKAGE_NAME), 'the name must be listed after repair')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair appends rather than replacing the existing listing', () => {
    const { dir } = makeProfile()
    repairBundle(dir)
    const bundles = readBundles(dir)
    assert.equal(bundles[0], '@deepseek-ai/dsh-base', 'earlier bundles keep their position')
    assert.equal(bundles[bundles.length - 1], PACKAGE_NAME, 'the repaired name goes last')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair is idempotent — a listed bundle is left alone', () => {
    const { dir } = makeProfile({ withListing: true })
    const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    const result = repairBundle(dir)
    assert.equal(result.changed, false)
    assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before, 'the manifest must not be rewritten')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair refuses a package with no dependency in the manifest', () => {
    const { dir } = makeProfile({ withDependency: false })
    assert.throws(() => repairBundle(dir), /not a dependency/u)
    assert.equal(readBundles(dir).includes(PACKAGE_NAME), false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair refuses a package that declares no dsh.bundle.patch', () => {
    const { dir } = makeProfile({ declarePatch: false })
    assert.throws(() => repairBundle(dir), /declares no dsh\.bundle\.patch/u)
    assert.equal(readBundles(dir).includes(PACKAGE_NAME), false, 'an undeclared package must never be listed')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair refuses when node_modules entry is missing', () => {
    const { dir, packageDir } = makeProfile()
    fs.rmSync(packageDir, { recursive: true, force: true })
    assert.throws(() => repairBundle(dir), /is missing/u)
    assert.equal(readBundles(dir).includes(PACKAGE_NAME), false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair follows a junction to read the declared metadata', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-archived-target-'))
    fs.writeFileSync(
      path.join(target, 'package.json'),
      `${JSON.stringify({ name: PACKAGE_NAME, version: '1.0.1', dsh: { bundle: { patch: './cordis.patch.yml' } } }, undefined, 2)}\n`,
      'utf8',
    )
    const { dir } = makeProfile({ linkTarget: target })
    const result = repairBundle(dir)
    assert.equal(result.changed, true)
    assert.equal(result.installTarget, target, 'the reported link target is the junction destination')
    assert.ok(readBundles(dir).includes(PACKAGE_NAME))
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  })

  await check('repair preserves unrelated manifest fields', () => {
    const { dir } = makeProfile()
    const manifestPath = path.join(dir, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.dsh.profile.defaults = { theme: 'dark' }
    manifest.custom = { keep: true }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
    repairBundle(dir)
    const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    assert.deepEqual(after.dsh.profile.defaults, { theme: 'dark' })
    assert.deepEqual(after.custom, { keep: true })
    assert.equal(after.dependencies[PACKAGE_NAME], manifest.dependencies[PACKAGE_NAME])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('repair writes the manifest in the profile\'s own formatting', () => {
    const { dir } = makeProfile()
    repairBundle(dir)
    const text = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    assert.ok(text.endsWith('\n'), 'the manifest keeps its trailing newline')
    assert.ok(text.includes('\n  "dependencies"'), 'two-space indentation is preserved')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('bundleState reports the unlisted-but-installed state that needs repair', () => {
    const { bundleState } = require('../lib/setup.cjs')
    const { dir } = makeProfile({ withDependency: true, withListing: false })
    const state = bundleState(dir)
    assert.equal(state.installed, true)
    assert.equal(state.listed, false)
    assert.equal(state.active, false, 'installed and unlisted is exactly the broken state')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  await check('bundleState agrees the profile is active after repair', () => {
    const { bundleState } = require('../lib/setup.cjs')
    const { dir } = makeProfile({ withDependency: true, withListing: false })
    repairBundle(dir)
    assert.equal(bundleState(dir).active, true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const failed = results.filter((entry) => !entry.ok)
  for (const entry of results) {
    if (entry.ok) console.log(`ok   ${entry.label}`)
    else console.log(`FAIL ${entry.label}\n     ${entry.message}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
