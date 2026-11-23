// Helpers for the skills tests: reading skills, finding the operationIds they
// name, and asking the rFabric MCP server about them. Node built-ins only.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const root = new URL('..', import.meta.url).pathname
export const skillsDir = join(root, 'skills')

/** The operationId shape: lowercase kebab-case words joined by dots, e.g. `sim-asset-builds.create`. */
export const OPERATION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/

export function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

/** A file a skill names, in an inline code span or as a relative link: a Markdown file beside its SKILL.md, e.g. `aws.md`. */
export const SUPPORTING_FILE = /^[a-z0-9][a-z0-9/-]*\.md$/

/**
 * Every skill: its directory name, the path and text of its SKILL.md, and `files`, every Markdown file of the
 * skill (SKILL.md and its supporting files) as `{ name, path, text }`, `name` relative to the skill directory.
 */
export function listSkills() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(skillsDir, entry.name)
      const path = join(directory, 'SKILL.md')
      const files = markdownFiles(directory).map((file) => ({ name: relative(directory, file), path: file, text: readFileSync(file, 'utf8') }))
      return { directory: entry.name, path, text: readFileSync(path, 'utf8'), files }
    })
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

/** Inline code spans of a Markdown text, outside fenced code blocks. */
export function inlineSpans(text) {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
  return [...prose.matchAll(/`([^`\n]+)`/g)].map(([, span]) => span)
}

/** The supporting files a skill names (code span or relative link) that do not exist beside its SKILL.md, as `<file naming it>: <name>`. */
export function missingSupportingFiles(skill) {
  const directory = join(skillsDir, skill.directory)
  return skill.files.flatMap((file) => {
    const linked = [...file.text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)].map(([, target]) => target)
    return [...new Set([...inlineSpans(file.text), ...linked])]
      .filter((name) => SUPPORTING_FILE.test(name) && !existsSync(join(directory, name)))
      .map((name) => `${file.name}: ${name}`)
  })
}

/**
 * The front matter of a SKILL.md, `{ name, description }`, or null when it is not exactly this form:
 *
 *   ---
 *   name: <lowercase kebab-case>
 *   description: >-
 *     <the description on one line, indented two spaces>
 *   ---
 *
 * One form, so the tests need no YAML parser: a folded block scalar takes any text, while a plain
 * `description: ...` holding ": " is invalid YAML and a host would not load the skill.
 */
export function frontMatter(text) {
  const match = /^---\r?\nname: ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\r?\ndescription: >-\r?\n {2}(\S[^\r\n]*)\r?\n---\r?\n/.exec(text)
  return match === null ? null : { name: match[1], description: match[2].trim() }
}

/** Names that have the operationId shape but are no operation (tests/not-operation-ids.txt). */
export function notOperationIds() {
  return readFileSync(join(root, 'tests', 'not-operation-ids.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

/**
 * Every place the skills name an operation, `{ operationId, skill, file }`, one entry per operationId and Markdown
 * file (`file` is its path): each inline code span with the operationId shape, outside fenced code blocks. A span
 * naming one of the skill's supporting files (`aws.md`) is no operation. The entries come from the skills alone,
 * so an operationId no catalog has any more is still found.
 */
export function operationReferences(skills = listSkills(), exempt = new Set(notOperationIds())) {
  return skills.flatMap((skill) =>
    skill.files.flatMap((file) =>
      [...new Set(inlineSpans(file.text))]
        .filter((span) => OPERATION_ID.test(span) && !exempt.has(span) && !SUPPORTING_FILE.test(span))
        .map((operationId) => ({ operationId, skill: skill.directory, file: file.path })),
    ),
  )
}

/** The operationIds a skill names, sorted. */
export function operationIds(skill, exempt = new Set(notOperationIds())) {
  return [...new Set(operationReferences([skill], exempt).map((reference) => reference.operationId))].sort()
}

/** The skill names in the tables under a `## <heading>` of a Markdown text: the inline code spans shaped like a skill name. */
export function skillsListedUnder(text, heading) {
  const section = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## )`, 'm').exec(`${text}\n## `)
  if (section === null) return null
  const rows = section[1].split('\n').filter((line) => line.startsWith('|'))
  return rows.flatMap((row) => inlineSpans(row)).filter((span) => /^[a-z][a-z0-9-]*$/.test(span))
}

/** The operationIds of the file RFABRIC_OPERATION_IDS names (one per line), or null when the variable is unset. */
export function listedOperationIds() {
  const file = process.env.RFABRIC_OPERATION_IDS
  if (!file) return null
  const ids = new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  )
  if (ids.size === 0) throw new Error(`RFABRIC_OPERATION_IDS: ${file} lists no operationId`)
  return ids
}

/**
 * The operation catalog the skills are checked against, `{ hasOperation(operationId) }`:
 * RFABRIC_OPERATION_IDS names a file with one operationId per line (a catalog listed without a deployment);
 * otherwise it is the MCP server at RFABRIC_MCP_URL with bearer RFABRIC_MCP_TOKEN. Throws when neither is set.
 */
export async function catalog() {
  const ids = listedOperationIds()
  return ids === null ? mcpClient() : { hasOperation: async (operationId) => ids.has(operationId) }
}

/** A client of the MCP server at RFABRIC_MCP_URL with bearer RFABRIC_MCP_TOKEN; throws when either is unset. */
async function mcpClient() {
  const url = process.env.RFABRIC_MCP_URL
  const token = process.env.RFABRIC_MCP_TOKEN
  if (!url || !token) {
    throw new Error(
      'no operation catalog: set RFABRIC_MCP_URL and RFABRIC_MCP_TOKEN (the MCP URL of a deployment and an access token for it), or RFABRIC_OPERATION_IDS (a file with one operationId per line); see README.md, Tests',
    )
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

  /** The operation as describe_operation returns it, or null when the catalog has no such operationId. */
  async function describeOperation(operationId) {
    const result = await rpc('tools/call', { name: 'describe_operation', arguments: { operationId } })
    const payload = JSON.parse(result.content[0].text)
    if (!result.isError) return payload
    if (payload?.error?.code === 'operation_not_found') return null
    throw new Error(`describe_operation ${operationId}: ${result.content[0].text}`)
  }

  // One search_operations call per resource (the operationId up to its first dot): the skills name far more
  // operations than the API's rate limit allows describe_operation calls.
  const SEARCH_LIMIT = 100
  const resources = new Map()
  function resourceOperations(resource) {
    if (!resources.has(resource)) {
      resources.set(
        resource,
        rpc('tools/call', { name: 'search_operations', arguments: { resource, limit: SEARCH_LIMIT } }).then((result) => {
          if (result.isError) throw new Error(`search_operations ${resource}: ${result.content[0].text}`)
          const { total, operations } = JSON.parse(result.content[0].text)
          return { complete: total <= operations.length, ids: new Set(operations.map((operation) => operation.operationId)) }
        }),
      )
    }
    return resources.get(resource)
  }

  return {
    /** Whether the catalog has the operationId. */
    async hasOperation(operationId) {
      const { complete, ids } = await resourceOperations(operationId.slice(0, operationId.indexOf('.')))
      if (ids.has(operationId)) return true
      return complete ? false : (await describeOperation(operationId)) !== null
    },
  }
}
