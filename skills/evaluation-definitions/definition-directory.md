# Evaluation definitions as files: the definition directory

Read this when the user keeps, or wants to keep, evaluation definitions as files in a Git repository: "eval as code", `rfabric eval init`, `rfabric eval apply`, a directory such as `eval/`, or a definition refused with `definition_repository_managed`.

A definition directory is a folder of the user's repository holding one definition per file. rFabric takes the whole directory in one call, compares each file with the latest published version of its slug, and publishes what changed. `SKILL.md` beside this file covers the fields of each definition, the expressions and the design decisions; this file covers the files and the three actions (preview, test run, apply) for every kind. What is specific to simulation (the file shapes of a suite, of a scenario's `simulation` block and of an asset descriptor, evaluation cells, launching an applied suite) is in `simulation-suite`.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Get the files: scaffold, or export what is published | scaffold: agent with a shell; otherwise user, in a terminal. Export: agent | `definition-directories.export` | none |
| 2 | Edit the files | agent or user, in the repository | none | none |
| 3 | Preview | agent | `definition-directories.create` (`action` `preview`) | none |
| 4 | Test-run the changed suites | agent | `definition-directories.create` (`action` `testRun`) | the test-run jobs |
| 5 | Apply | agent, or the user's pipeline | `definition-directories.create` (`action` `apply`) | the Operation; asset uploads and their validation |

## Before you start

- **Permissions**: preview and test run need `simSuite:launch` (`owner`, `admin`, `operator`). Apply needs `evaluationDefinition:author` and `evaluationDefinition:publish` (`owner`, `admin`), plus `simAsset:publish` when it publishes a sim asset version. Export needs read access to the workspace.
- **Needs**: the repository checked out where you can read its files. For a test run: a suite in the directory (`simulation-suite`) and a subject, usually an Artifact (`artifact-build`).
- **Ask the user**: the directory's path inside the repository (default `eval`), and whether a pipeline will apply it (`ci-integration`).

## The files

| Folder | `kind` | Holds |
| --- | --- | --- |
| `metrics/` | `metric` | EvaluationMetric |
| `criteria/` | `criteria` | EvaluationCriteria |
| `scenarios/` | `scenario` | EvaluationScenario |
| `protocols/` | `protocol` | EvaluationProtocol |
| `suites/` | `suite` | a simulation suite (`simulation-suite`) |
| `assets/` | `scene`, `object`, `robot_description` | a sim asset descriptor and the content it points at |

- One definition per `.json`, `.yaml` or `.yml` file. Each starts with `formatVersion` `2` (an integer), `kind` and `slug`. No workspace id.
- The other fields are those of the kind's create operation, with every id replaced by a reference: `criteriaRef`, `scenarioRef`, `metricRefs` (slugs), `targetRef` (a task slug).
- A reference is `slug` or `slug@latest-published` (the version this apply publishes, else the newest published one), or `slug@<version>` (exactly that version). An rFabric id in a reference is refused.
- JSON Schemas for editors: `https://api.rfabric.io/api/definition-directories/schemas/<kind>.json`, with `<kind>` one of `metric`, `criteria`, `scenario`, `protocol`, `suite`, `asset`.
- Launch template files (`launch-templates/`, kind `launch_template`) are training, not evaluation: they live in their own directory and are applied separately (`training-run`). A request manages one family: a launch template file in this directory is a `kind_not_requested` problem.

## Steps

### 1. Get the files

**New directory.** The CLI writes the starter files of a standard protocol. With a shell, run the command of the block yourself after the user approves; without one, hand the block over:

```text
Your turn - your terminal, in the root of the repository
Why: the starter files are written by the rfabric CLI on your machine, from the standard protocol of your workspace.
Who: anyone signed in to the rfabric CLI (rfabric auth login).

1. Write the definition files of a standard protocol (its protocol, its scenario and a skeleton criteria):
   rfabric eval init --template capability
   (templates are named by protocol type: smoke, regression, capability, robustness, ood, safety, recovery, human_relative, comparison, deployment_acceptance)

Creates: files only, under eval/. Nothing is written when any of them exists, and nothing changes in rFabric. Undo: delete the files.
Bring back: tell me when the files are there.
Then I: read them, adapt them with you, and preview the directory.
```

Without the CLI, write the files yourself from the tables above and the body shapes in `SKILL.md`. A complete simulation starter (scene, scenario, suite, pipeline file) is in `simulation-suite`.

**Existing definitions.** `definition-directories.export` with `query` `workspaceId` and `kind`, repeated once per evaluation kind to export (`metric`, `criteria`, `scenario`, `protocol`, `suite`, `scene`, `object`, `robot_description`; the CLI asks for all eight), and optionally `protocol` (a slug, for one protocol with what it references and the suites over it), returns `files`, each a `path` and its `content`: write them into the directory. For each entry of `assetContents`, get the content of `simAssetVersionId` with `sim-assets.versions-fetch-url`, download it to `path` and check it against `contentHash`. A preview of an unchanged export reports every entry `unchanged`.

### 2. Edit the files

Change the definitions in the files, following "The files" above and the field rules of `SKILL.md` (step 3 for the fields, step 4 to test expressions). Show the user each change as a diff of the file. Nothing reaches rFabric until a preview or an apply.

### 3. Preview

`definition-directories.create` with `action` `preview` writes nothing. Body:

- `workspaceId`.
- `kinds`: the file kinds the request manages, every evaluation kind as the CLI sends them: `["metric", "criteria", "scenario", "protocol", "suite", "scene", "object", "robot_description"]`. Removed definitions, `deprecateRemoved` and the managed-slug check read only these kinds. The same `kinds` go into the test run and the apply.
- `path`: the directory's path inside the repository (`""` for the root).
- `files`: every definition file as `{"path", "content"}`, `path` relative to the directory, `content` the file's text.
- `assetContents`: one entry per asset descriptor: its `path`, and the lowercase hex SHA-256 (`contentHash`) and byte size (`contentSize`) of the content it points at. `[]` when there is no asset. A single file or archive is hashed as stored. A folder must be packed the way the CLI packs it: with folder content, the preview, the test run and the apply go through the CLI commands at the end of this file. With a shell, run them yourself after the user approves; without one, hand them over as a "Your turn" block.
- `ci`: see "Who manages a slug" below.

The result tells the user what an apply would do:

| Field | Tell the user |
| --- | --- |
| `problems` | each `path`, `field`, `line`, `code` and `message`: what blocks an apply |
| `entries` | per file: `action` `create`, `version` or `unchanged`, and for a new version each changed `field` with `before` and `after` |
| `removed` | published definitions of this directory that no file holds any more |
| `cells`, `suites` | coverage cells an apply would create, suites it would re-pin |
| `unchecked` | checks that need asset content not uploaded yet; they run during apply |

Done when `problems` is empty and the user has seen the `entries` table.

### 4. Test-run before publishing

`action` `testRun` with a `testRun` object (`subjectType`, `subjectId`, optional `baseline`, `suites` or `tags`, `changedOnly`, `poolId`) creates draft versions of what changed and launches one test-run EvaluationJob per selected suite. It publishes nothing. Say before the call that it uses compute.

It returns an Operation; follow it with `operations.get`. Its `result` lists `evaluationJobIds`: follow each job as `simulation-suite` describes and read its report as `evaluation-job` describes. The reports are marked `testRun` and are never evidence. It runs suites only: a directory without a suite has nothing to test-run (`test_run_selection_empty`); test a single protocol draft as `SKILL.md` step 6 describes.

### 5. Apply

Before the call tell the user what the preview showed, and that it **cannot be undone**: every changed definition is published as a new immutable version, in one transaction. Changed scenarios and protocols re-pin the suites that reference them. `deprecateRemoved` `true` also deprecates the definitions listed in `removed`; without it they stay published.

`action` `apply` returns an Operation. Poll `operations.get`:

- `queued` with `uploads` in its `result`: the workspace lacks that asset content. Upload each one to its `simAssetVersionId` as `sim-asset-build` describes for local files. The operation continues when every upload is complete and validated.
- `succeeded`: `result` has every entry with its `id` and `version`.
- `failed` with `error` `code` `definition_directory_invalid`: `result` has the `problems`; nothing was applied.

Send `idempotencyKey` (8 to 200 characters) so a repeat of the same request returns the same Operation.

Done when the Operation is `succeeded` and a second preview reports every entry `unchanged`. Then: launch an applied suite with `simulation-suite`; launch an applied real-robot or replay protocol with `evaluation-job`.

## Who manages a slug

- An apply that carries `ci` records it, with `path`, on every version it publishes. From then on the slug is managed by that repository and path: the registry operations and any apply from elsewhere are refused with `definition_repository_managed` (409), whose `details` name the `repository`, `directoryPath` and `commit`.
- An apply without `ci` publishes the same definitions unmanaged: they stay editable through the registry operations. It is refused for a slug that is already managed.
- The CLI sends `ci` by itself: in a pipeline the build's identity; in a local checkout the `origin` remote as a web URL without `.git` as `repository`, the HEAD commit as `commit`, `local` as `buildId`, and `refs/heads/<branch>` as `ref`. To act on a managed directory through the operations, send a `ci` with the same `repository`, and the directory's `path`.
- Recommend one owner: either the base-branch pipeline applies (`ci-integration`), or people apply by hand. Mixing the two leads to refusals.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `format_version_unsupported` | `formatVersion` is not `2` | set it to the integer 2 |
| `kind_directory_mismatch` | the file's `kind` does not belong in its folder, or an asset has another kind | move the file or fix `kind` |
| `slug_duplicate` | two files declare the same kind and slug | keep one |
| `reference_unresolved` | a reference names nothing published or present, a missing `slug@<version>`, or a dependency cycle | fix the reference, or add the file |
| `id_not_allowed` | a reference holds an rFabric id | use the slug |
| `content_missing` | `assetContents` lacks, repeats or misnames a descriptor, or the asset content is not uploaded yet | send exactly one entry per descriptor; during apply, upload the listed content |
| `asset_validation_failed` | uploaded asset content failed validation; the message says why | fix the content (`sim-asset-build`) |
| `test_run_selection_empty` | no suite matches `suites`, `tags` or `changedOnly` | widen the selection |
| `kind_not_requested` | a file's `kind` is not in the request's `kinds`: a launch template file in the evaluation directory, or a kind left out of `kinds` | move launch template files to their own directory (`training-run`); send every evaluation kind |
| `VALIDATION_ERROR` 422 on `kinds`, or on `kind` of the export | missing, repeated, or `launch_template` beside evaluation kinds | send the evaluation kinds only, each once |
| `definition_repository_managed` 409 | another repository or path manages the slug, or the request has no `ci` | apply from the owning directory with its `ci` |
| `idempotency_conflict` 409 | the key was used with another request | use a fresh key |
| `VALIDATION_ERROR` 422 on preview with `idempotencyKey` | a preview writes nothing and takes no key | drop the key |
| `FORBIDDEN` 403 | a permission of the action is missing | name it (Before you start) |

## Done when

- [ ] A preview after the apply reports every entry `unchanged`.
- [ ] The apply Operation is `succeeded` (`operations.get`) and the user saw which definitions got which version.
- [ ] `evaluation-protocols.list` with the protocol's `slug` and `status` `published` shows the version, with `directoryPath` set.

## The rfabric CLI

The commands run in the repository; `--dir` defaults to `eval`. The CLI reads the files, packs and hashes asset folders, uploads missing content and waits. `rfabric eval` manages the evaluation kinds only: it refuses launch template files with "apply it with rfabric training apply".

| Step | CLI |
| --- | --- |
| Scaffold | `rfabric eval init [dir] [--template <type>] [--ci <provider>] [--adapter <simulator>]` |
| Export | `rfabric eval export [--dir <dir>] [--protocol <slug>]` |
| Preview | `rfabric eval apply --preview [--dir <dir>]` |
| Test-run | `rfabric eval test-run --dir <dir> --candidate <subject-id> [--changed] [--suite <slug>] [--baseline <subject-id>]` |
| Apply | `rfabric eval apply [--dir <dir>] [--deprecate-removed]` |
