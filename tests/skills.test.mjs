import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPERATION_ID, frontMatter, listSkills, mcpClient, notOperationIds, operationIds } from './skills.mjs'

const skills = listSkills()

test('the repository has skills', () => {
  assert.ok(skills.length > 0, 'skills/ holds no skill directory')
})

for (const skill of skills) {
  test(`${skill.directory}: front matter has name and description, and name is the directory name`, () => {
    const fields = frontMatter(skill.text)
    assert.ok(fields !== null, `${skill.path} has no front matter`)
    assert.ok(fields.name, `${skill.path}: front matter has no name`)
    assert.ok(fields.description, `${skill.path}: front matter has no description`)
    assert.equal(fields.name, skill.directory, `${skill.path}: name '${fields.name}' differs from its directory '${skill.directory}'`)
  })

  test(`${skill.directory}: names at least one operation`, () => {
    assert.ok(operationIds(skill.text).length > 0, `${skill.path} names no operationId; a skill drives operations by operationId`)
  })
}

test('every operationId a skill names exists in the MCP catalog', async () => {
  const client = await mcpClient()
  const missing = []
  for (const skill of skills) {
    for (const operationId of operationIds(skill.text)) {
      if ((await client.describeOperation(operationId)) === null) missing.push(`skills/${skill.directory}/SKILL.md: ${operationId}`)
    }
  }
  assert.deepEqual(missing, [], `operationIds missing from the MCP catalog:\n${missing.join('\n')}`)
})

test('tests/not-operation-ids.txt lists only names that are no operation', async () => {
  const client = await mcpClient()
  const names = notOperationIds()
  for (const name of names) assert.match(name, OPERATION_ID, `${name} does not have the operationId shape; remove it from the list`)
  const operations = []
  for (const name of names) if ((await client.describeOperation(name)) !== null) operations.push(name)
  assert.deepEqual(operations, [], `these are operationIds; remove them from tests/not-operation-ids.txt: ${operations.join(', ')}`)
})
