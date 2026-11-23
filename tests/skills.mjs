// Helpers for the skills tests: reading skills, finding the operationIds they
// name, and asking the rFabric MCP server about them. Node built-ins only.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const root = new URL('..', import.meta.url).pathname
export const skillsDir = join(root, 'skills')

/** The operationId shape: lowercase kebab-case words joined by dots, e.g. `sim-asset-builds.create`. */
export const OPERATION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/

export function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

/** Every skill: its directory name, the path of its SKILL.md and that file's text. */
export function listSkills() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(skillsDir, entry.name, 'SKILL.md')
      return { directory: entry.name, path, text: readFileSync(path, 'utf8') }
    })
}

/** The YAML front matter of a SKILL.md as top-level `key: value` pairs; block scalars (`>`, `|`) are joined. */
export function frontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (match === null) return null
  const fields = {}
  let blockKey = null
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (field !== null) {
      const [, key, raw] = field
      blockKey = raw === '>' || raw === '|' || raw === '>-' || raw === '|-' ? key : null
      fields[key] = blockKey === null ? unquote(raw.trim()) : ''
    } else if (blockKey !== null && /^\s+\S/.test(line)) {
      fields[blockKey] = `${fields[blockKey]} ${line.trim()}`.trim()
    }
  }
  return fields
}

function unquote(value) {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) return value.slice(1, -1)
  return value
}

/** Names that have the operationId shape but are no operation (tests/not-operation-ids.txt). */
export function notOperationIds() {
  return readFileSync(join(root, 'tests', 'not-operation-ids.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

/** The operationIds a skill names: every inline code span with the operationId shape, outside fenced code blocks. */
export function operationIds(text, exempt = new Set(notOperationIds())) {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
  const ids = new Set()
  for (const [, span] of prose.matchAll(/`([^`\n]+)`/g)) {
    if (OPERATION_ID.test(span) && !exempt.has(span)) ids.add(span)
  }
  return [...ids].sort()
}

/** A client of the MCP server at RFABRIC_MCP_URL with bearer RFABRIC_MCP_TOKEN; throws when either is unset. */
export async function mcpClient() {
  const url = process.env.RFABRIC_MCP_URL
  const token = process.env.RFABRIC_MCP_TOKEN
  if (!url || !token) {
    throw new Error('RFABRIC_MCP_URL and RFABRIC_MCP_TOKEN must be set: the MCP URL of a stack and an access token for it (see README.md, Tests)')
  }
  let sessionId = null
  let nextId = 1

  async function rpc(method, params) {
    const id = nextId++
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    if (!response.ok) throw new Error(`${method}: ${url} answered ${response.status} ${await response.text()}`)
    sessionId = response.headers.get('mcp-session-id') ?? sessionId
    const body = await response.text()
    const message = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      ? body
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => JSON.parse(line.slice(5)))
          .find((candidate) => candidate.id === id)
      : JSON.parse(body)
    if (message === undefined) throw new Error(`${method}: no response in the event stream`)
    if (message.error) throw new Error(`${method}: ${message.error.message}`)
    return message.result
  }

  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rfabric-skills-tests', version: '0' } })

  return {
    /** The operation as describe_operation returns it, or null when the catalog has no such operationId. */
    async describeOperation(operationId) {
      const result = await rpc('tools/call', { name: 'describe_operation', arguments: { operationId } })
      const payload = JSON.parse(result.content[0].text)
      if (!result.isError) return payload
      if (payload?.error?.code === 'operation_not_found') return null
      throw new Error(`describe_operation ${operationId}: ${result.content[0].text}`)
    },
  }
}
