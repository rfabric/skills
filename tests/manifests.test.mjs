import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { readJson, root } from './skills.mjs'

const PLUGIN = 'rfabric'
const SERVER = 'rfabric'
const MCP_URL = 'https://api.rfabric.io/mcp'
const SEMVER = /^\d+\.\d+\.\d+$/

test('.mcp.json registers exactly the rfabric server at the production MCP URL over http', () => {
  const { mcpServers } = readJson('.mcp.json')
  assert.deepEqual(Object.keys(mcpServers), [SERVER])
  assert.deepEqual(mcpServers[SERVER], { type: 'http', url: MCP_URL }, 'no headers, token or client secret: the host signs in with OAuth')
})

test('Claude Code plugin manifest names the plugin rfabric', () => {
  const manifest = readJson('.claude-plugin/plugin.json')
  assert.equal(manifest.name, PLUGIN)
  assert.match(manifest.version, SEMVER)
  // Claude Code loads skills/ and .mcp.json from the plugin root by default; a second declaration would load them twice.
  assert.equal(manifest.skills, undefined)
  assert.equal(manifest.mcpServers, undefined)
})

test('Claude Code marketplace lists the plugin rfabric from the repository root', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json')
  assert.equal(marketplace.name, PLUGIN)
  assert.ok(marketplace.owner?.name, 'marketplace owner.name is required')
  assert.equal(marketplace.plugins.length, 1)
  const [entry] = marketplace.plugins
  assert.equal(entry.name, PLUGIN)
  assert.equal(entry.source, './')
  // Codex reads this marketplace too and requires these on every entry.
  assert.ok(entry.category, 'category is required by Codex')
  assert.ok(entry.policy?.installation && entry.policy?.authentication, 'policy.installation and policy.authentication are required by Codex')
})

test('Codex plugin manifest names the plugin rfabric and ships skills/ and .mcp.json', () => {
  const manifest = readJson('.codex-plugin/plugin.json')
  assert.equal(manifest.name, PLUGIN)
  assert.match(manifest.version, SEMVER)
  assert.ok(manifest.description, 'description is required by Codex')
  assert.ok(manifest.author?.name, 'author.name is required by Codex')
  assert.equal(manifest.skills, './skills/')
  assert.equal(manifest.mcpServers, './.mcp.json')
  const { interface: listing } = manifest
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'composerIcon', 'logo']) {
    assert.ok(listing?.[field], `interface.${field} is required by Codex`)
  }
  assert.ok(Array.isArray(listing.capabilities), 'interface.capabilities is required by Codex')
  for (const icon of [listing.composerIcon, listing.logo]) assert.ok(existsSync(join(root, icon)), `${icon} does not exist`)
})

test('both plugin manifests carry the same version', () => {
  assert.equal(readJson('.claude-plugin/plugin.json').version, readJson('.codex-plugin/plugin.json').version)
})
