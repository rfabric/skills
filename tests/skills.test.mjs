import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import {
  OPERATION_ID,
  catalog,
  frontMatter,
  listSkills,
  missingSupportingFiles,
  notOperationIds,
  operationIds,
  operationReferences,
  root,
  skillsListedUnder,
} from './skills.mjs'

// The skill every other skill builds on; its "Finding the skill" table routes to all of them.
const BASE_SKILL = 'rfabric-basics'

const skills = listSkills()
const directories = skills.map((skill) => skill.directory).sort()

test('the repository has skills', () => {
  assert.ok(skills.length > 0, 'skills/ holds no skill directory')
})

test('README.md lists every skill, and only skills that exist', () => {
  const listed = skillsListedUnder(readFileSync(join(root, 'README.md'), 'utf8'), 'Skills')
  assert.ok(listed !== null, 'README.md has no "## Skills" section')
  assert.deepEqual([...listed].sort(), directories)
})

test(`${BASE_SKILL} routes to every other skill, and only to skills that exist`, () => {
  const base = skills.find((skill) => skill.directory === BASE_SKILL)
  assert.ok(base !== undefined, `skills/${BASE_SKILL} does not exist`)
  const listed = skillsListedUnder(base.text, 'Finding the skill')
  assert.ok(listed !== null, `${base.path} has no "## Finding the skill" section`)
  assert.deepEqual(
    [...listed].sort(),
    directories.filter((directory) => directory !== BASE_SKILL),
  )
})

for (const skill of skills) {
  test(`${skill.directory}: front matter is name and a folded description, and name is the directory name`, () => {
    const fields = frontMatter(skill.text)
    assert.ok(fields !== null, `${skill.path}: front matter must be 'name: <name>', then 'description: >-' and the description on one line indented two spaces`)
    assert.equal(fields.name, skill.directory, `${skill.path}: name '${fields.name}' differs from its directory '${skill.directory}'`)
  })

  test(`${skill.directory}: names at least one operation`, () => {
    assert.ok(operationIds(skill).length > 0, `${skill.path} names no operationId; a skill drives operations by operationId`)
  })

  test(`${skill.directory}: every supporting file it names exists`, () => {
    assert.deepEqual(missingSupportingFiles(skill), [])
  })
}

test('every operationId a skill names exists in the operation catalog, and tests/not-operation-ids.txt lists none', async () => {
  const client = await catalog()
  const missing = []
  for (const skill of skills) {
    for (const operationId of operationIds(skill)) {
      if (!(await client.hasOperation(operationId))) missing.push(`skills/${skill.directory}: ${operationId}`)
    }
  }
  assert.deepEqual(missing, [], `operationIds missing from the operation catalog:\n${missing.join('\n')}`)

  const names = notOperationIds()
  for (const name of names) assert.match(name, OPERATION_ID, `${name} does not have the operationId shape; remove it from the list`)
  const operations = []
  for (const name of names) if (await client.hasOperation(name)) operations.push(name)
  assert.deepEqual(operations, [], `these are operationIds; remove them from tests/not-operation-ids.txt: ${operations.join(', ')}`)
})

test('tests/references.mjs lists where an operationId is named even when the catalog no longer has it', () => {
  const [reference] = operationReferences(skills)
  const directory = mkdtempSync(join(tmpdir(), 'rfabric-skills-'))
  try {
    // A catalog without the operationId: what a checkout holds once the operation is renamed or removed.
    const listed = join(directory, 'operation-ids.txt')
    writeFileSync(listed, 'some-other-resource.list\n')
    const run = spawnSync(process.execPath, [join(root, 'tests', 'references.mjs'), reference.operationId], {
      cwd: root,
      env: { ...process.env, RFABRIC_OPERATION_IDS: listed },
      encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr)
    const line = run.stdout.split('\n').find((candidate) => candidate.startsWith(`${reference.operationId}: ${reference.skill} (`))
    assert.ok(line !== undefined, `no line for ${reference.operationId} in ${reference.skill}:\n${run.stdout}`)
    assert.ok(line.includes(relative(root, reference.file)), line)
    assert.ok(line.endsWith('NOT in the catalog'), line)
  } finally {
    rmSync(directory, { recursive: true })
  }
})
