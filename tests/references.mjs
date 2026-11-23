// Prints where the skills name an operation: `node tests/references.mjs <operationId or resource>...`.
// A resource (`datasets`) stands for every operationId that starts with it. With RFABRIC_OPERATION_IDS set
// (README.md, Tests), a named operationId that file lacks is marked, and a query neither the skills nor the
// file know exits 1. Node built-ins only.
import { relative } from 'node:path'
import { listedOperationIds, operationReferences } from './skills.mjs'

const queries = process.argv.slice(2)
if (queries.length === 0) {
  console.error('usage: node tests/references.mjs <operationId or resource>...')
  process.exit(2)
}

const matches = (query) => (operationId) => operationId === query || operationId.startsWith(`${query}.`)
const references = operationReferences()
const listed = listedOperationIds()
let unknown = false

for (const query of queries) {
  // operationId -> skill -> files
  const found = new Map()
  for (const { operationId, skill, file } of references.filter((reference) => matches(query)(reference.operationId))) {
    if (!found.has(operationId)) found.set(operationId, new Map())
    const skills = found.get(operationId)
    skills.set(skill, [...(skills.get(skill) ?? []), relative(process.cwd(), file)])
  }
  if (found.size === 0) {
    const inCatalog = listed === null || [...listed].some(matches(query))
    if (!inCatalog) unknown = true
    console.log(`${query}: no skill names it${inCatalog ? '' : ', and the catalog has no such operationId or resource'}`)
    continue
  }
  for (const operationId of [...found.keys()].sort()) {
    const stale = listed !== null && !listed.has(operationId) ? ' - NOT in the catalog' : ''
    for (const [skill, files] of [...found.get(operationId)].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`${operationId}: ${skill} (${files.sort().join(', ')})${stale}`)
    }
  }
}

process.exit(unknown ? 1 : 0)
