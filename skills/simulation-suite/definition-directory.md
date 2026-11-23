# Suites, scenarios and sim assets as files

Read this when the user keeps scenarios, suites and sim assets as files in a Git repository (a definition directory, normally `eval/`), or wants changes reviewed in pull requests.

The directory itself belongs to `evaluation-definitions`: its definition directory file carries the layout, the three actions of `definition-directories.create` (`preview`, `testRun`, `apply`), who manages a slug afterwards, the export and the CLI. This file adds what a simulated scenario, a suite and a sim asset look like as files, and where to continue here. It replaces steps 2 to 5 of `SKILL.md`: one apply publishes everything the files describe. Preflight, launch and follow (steps 6 to 8) are unchanged.

## The files

One definition per `.json`, `.yaml` or `.yml` file, with `formatVersion: 2`, `kind` and `slug`, and no workspace id.

| Folder | `kind` |
| --- | --- |
| `scenarios/` | `scenario` |
| `suites/` | `suite` |
| `assets/` | `scene`, `object` or `robot_description` |

The fields are those of the API bodies in `SKILL.md`, except that a file references by name, never by id:

| In a file | Refers to |
| --- | --- |
| scenario `simulation` `adapterProfileRef` | an adapter profile slug (a platform profile slug works directly) |
| scenario `simulation` `assets` | asset slugs: `world`, `robot` (or `null`), `inputs` |
| suite `protocolRef`, `scenarioEntries[]` `scenarioRef` | protocol and scenario slugs |
| suite `matrix` | cells as `{ "siteProfileKey", "operation", "robotProfileKey" }` |
| suite `poolRef` | a compute pool's name |
| asset `content` | a path relative to the descriptor: one file, a `.tar` or `.tar.gz` archive, or a folder; `rootPath` names the root document inside an archive or folder |

A reference is `slug` (the version this apply publishes, else the highest published one), or `slug@<version>` to pin one published version. A suite entry carries no `version` or `sha256`: the apply pins them.

A suite file:

```json
{
  "$schema": "https://api.rfabric.io/api/definition-directories/schemas/suite.json",
  "formatVersion": 2,
  "kind": "suite",
  "slug": "warehouse-put-away",
  "name": "Warehouse put-away",
  "protocolRef": "put-away",
  "scenarioEntries": [{ "scenarioRef": "put-away", "required": true }],
  "matrix": [{ "siteProfileKey": "warehouse", "operation": "put_away", "robotProfileKey": "carrier" }],
  "expansion": "full",
  "minValidSamplesPerCell": 1,
  "baselineOrder": "alternate",
  "tags": ["quick"]
}
```

## What an apply does for a suite

Preview first, then apply, as `evaluation-definitions` describes. Specific to suites:

| Effect | Tell the user |
| --- | --- |
| Missing cells of a suite's `matrix` are created | they start `advisory`; files never raise a `coverageStatus`. A gating launch needs the user to raise it (`SKILL.md` step 2) |
| A changed scenario or protocol re-pins every suite that references it | those suites get a new published version; earlier jobs and reports are unchanged |
| Asset content the workspace does not hold is asked for | while the Operation is `queued`, its `result` `uploads` lists each descriptor `path` with the `simAssetVersionId` to upload to: upload as `sim-asset-build` describes for local files (its robot models file). The Operation continues once every upload is complete and its validation has settled |
| The Operation `succeeded` | `result` `suites` holds each suite's `slug`, `id` and `version`: those ids are what `SKILL.md` step 6 preflights and step 7 launches |
| A test run (`action` `testRun`) | costs compute like a launch; `result` `evaluationJobIds` are the jobs to follow as in `SKILL.md` step 8. Their reports are marked as test runs and never count as evidence |

Done when: the Operation is `succeeded` and `sim-suites.get` shows each suite `published`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| A problem entry in a preview, or Operation `failed` with `definition_directory_invalid` | a file is malformed, a reference does not resolve, or a publish rule fails; each entry has `path`, `field`, `code`, `message` | fix that file; for a scenario or suite the codes are the publish refusals in `SKILL.md` Problems |
| A new cell is `advisory` and a gating launch answers `cell_not_supported` | files create cells but never raise their `coverageStatus` | the user raises it with `evaluation-cells.update` (`SKILL.md` step 2) |
| Operation stays `queued` | it waits for the uploads in `result` `uploads`, or for their validation | finish the uploads; a version whose validation failed fails the apply with its checks |
| `definition_repository_managed` (409) on `sim-suites.update`, `evaluation-scenarios.update` or a publish | the definition is published from a repository | change the file and apply the directory (`evaluation-definitions`) |

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Start from a working example | `rfabric eval init <dir> --ci github --adapter mujoco` (`--adapter` also `gazebo`, `isaac-sim`) |
| Preview, apply | `rfabric eval apply --dir eval --preview`, `rfabric eval apply --dir eval` |
| Test-run the changed suites | `rfabric eval test-run --dir eval --candidate <artifact-id> --changed` |
| Run the suites the directory published | `rfabric sim run --dir eval --candidate <artifact-id> [--suite <slug>] [--tag <tag>] [--junit-dir reports]` |
