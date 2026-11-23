---
name: sim-asset-build
description: Drive an rFabric sim asset build - turn a prompt and a published robot description version into simulation assets (objects and an assembled OpenUSD or MJCF scene) - through the tools of the `rfabric` MCP server. Use when asked to build, generate or plan a simulation environment, scene, course or objects for a robot on rFabric, to review or edit a build's plan, to review, reject, rebuild or qualify its outputs, or to continue a build that ran out of budget. Also use to add the robot model a build needs - import it from the asset catalog or a GitHub or Hugging Face repository, upload it from local files, convert it to MJCF or OpenUSD, or check an imported model's source for updates.
---

# rFabric sim asset builds

A **sim asset build** (`smab_...`) turns a prompt, one published `robot_description` sim asset version per target format and the target formats (`mjcf` for MuJoCo, `openusd` for Isaac Sim) into simulation assets. rFabric runs each step as a digest-pinned builder image on its compute and records every input and output:

1. `plan` writes the **plan**: the robot brief, the course layout, a concept image, an inventory of items with reference crops, assumptions and the sources it read. The build waits in `awaiting_plan_approval`.
2. You review, optionally edit, and approve the plan by its `planSha256`.
3. One step per inventory item: `import:<key>` (a library item fetched at a pinned commit) or `object:<key>` (a generated object). Each registers one draft sim asset version per target format.
4. One `assemble:<format>` step per target format composes the **scene** from the robot and the item versions.
5. rFabric validates every output, renders a thumbnail and a turntable, and grants a qualification level up to `perception_eval`. The build waits in `awaiting_review`.
6. You review the outputs: qualify each at `interaction_eval`, or revise the build from the step whose output is wrong, with notes.

Every action is recorded on the build: its revisions, each step's compute task, model calls, fetched sources and usage against the budget.

## Calling rFabric

The `rfabric` MCP server is connected; every call runs as the signed-in user in the organization they authorized. Each step below names an operation by its `operationId`:

1. `describe_operation` with the `operationId`, before every call: its method and path, whether it is `mutating`, the JSON Schemas of its path parameters, query, body and response, and its description.
2. `call_operation` with `operationId`, `pathParameters`, `query` and `body` shaped by those schemas.
3. `search_operations` finds an operation this skill does not name.

`call_operation` returns `{"status", "body"}`, `body` being the API's response: `{"data": ...}`, or `{"data": [...], "pagination": {...}}` for a list; read every page. A refusal is a tool error whose `body` is `{"error": {"code", "message", "correlationId", "details", "hint"}}`: act on `code`, `details` and `hint`, and quote `correlationId` when you report a problem.

**Changes.** A `mutating` operation changes the platform as the user: say what it will change before you call it. The rFabric agent asks the user to approve every mutating call.

**Bytes** never pass through the MCP server. Operations that move bytes return presigned URLs:

- **Upload**: send the file, or one part of it, to the URL with the method and headers the operation returned. The rFabric agent calls `rfabric_upload` with the file's `path`, the `url` and, for one part, its `offset` and `length`; it returns the part's `etag`. Other agents send the request themselves.
- **Download**: the rFabric agent calls `rfabric_download` with the `url` and a `path` in its working directory. Other agents GET the URL themselves.

An upload first declares the file's size in bytes and its lowercase hex SHA-256.

## Build operations

| Step | `operationId` |
| --- | --- |
| Upload a reference image | `sim-asset-builds.reference-images` |
| Start a build | `sim-asset-builds.create` |
| Follow it | `sim-asset-builds.get` |
| List builds | `sim-asset-builds.list` |
| Read the plan | `sim-asset-builds.list-plan` |
| Edit the plan | `sim-asset-builds.replace-plan` |
| Approve the plan | `sim-asset-builds.plan-approve` |
| List the outputs | `sim-asset-builds.outputs` |
| Reject an output, or reject and rebuild | `sim-asset-builds.outputs-reject` |
| Rebuild from a step | `sim-asset-builds.revisions` |
| Qualify a version | `sim-assets.versions-qualify` |
| Raise the budget | `sim-asset-builds.update` |
| Continue after budget exhaustion | `sim-asset-builds.resume` |
| Cancel | `sim-asset-builds.cancel` |

## Robot models

A build needs a published `robot_description` sim asset version per target format. When the workspace has none, import one, or upload it from local files. An imported version is a draft that records its `source` (`library`, `repository`, the `revision` asked for, the `commit` it resolved to, `path`) and holds the root document with every file it references; a conversion is a draft version with `provenance` `converted` and `conversion` (`sourceAssetVersionId`, `sourceContentHash`, `converter`).

| Step | `operationId` |
| --- | --- |
| Browse the asset catalog | `sim-assets.catalog` |
| Import a catalog entry | `sim-assets.catalog-import` |
| Resolve a repository URL | `sim-assets.sources-resolve` |
| Import from a repository | `sim-assets.imports` |
| Create a sim asset | `sim-assets.create` |
| Create a draft version | `sim-assets.create-versions` |
| Start or resume a content upload | `sim-assets.versions-upload` |
| Read the upload session | `sim-assets.versions-upload-sessions` |
| Sign more part URLs | `sim-assets.versions-upload-sessions-parts` |
| Complete the upload | `sim-assets.versions-upload-sessions-complete` |
| Convert to MJCF or OpenUSD | `sim-assets.versions-convert` |
| Check its source for an update | `sim-assets.versions-source-update` |
| Publish a version | `sim-assets.versions-publish` |

- **Catalog**: curated robots (MuJoCo Menagerie, work-r-labs/robots, robots_usd), each pinned to one commit. Importing an entry (`pathParameters` `key`, the entry's `key`) creates one version per format, each in that format's sibling `robot_description` asset; its description says how that asset is named and found.
- **Repository**: `https://github.com/<owner>/<name>[/tree/<revision>/<dir> | /blob/<revision>/<path>]` or `https://huggingface.co/[datasets/|spaces/]<repository id>[...]`; a revision containing `/` goes in `revision`. Resolve first: it returns the `commit` and the `files` under the URL's directory; a file with a non-null `format` is a root document. Import one with `source` `{"library", "repository", "revision", "path"}`, the first three as resolve returned them and `path` a root document, and either `asset` `{"name", "slug"}` for a new asset or `simAssetId` to add a version to an existing one.
- **Local files**: create the `robot_description` asset unless it exists, then a draft version with its `format` and, for a `.tar` or `.tar.gz` archive, `rootPath`, the root document inside it. Start the upload with the file's `sizeBytes` and `sha256`: it returns the upload session (`sessionId`, `status`, `parts` with presigned URLs). `status` `completed` means the content is already stored. Otherwise read the session for `partSizeBytes`, `partCount` and the `acknowledgedParts`; upload part n (from byte (n-1) x `partSizeBytes`, `partSizeBytes` long, the last part shorter) to its URL; sign the part URLs you lack with `fromPartNumber` and `toPartNumber`; then complete the session with every `{"partNumber", "etag"}`. A version accepts content once: create a new version to upload other bytes.
- **Convert**: `urdf` or `xacro` to `mjcf` or `openusd`, `mjcf` to `openusd`; the version needs content. The result lands in the source asset's format sibling; the operation's description says how it is named and found.
- **Wait**: an import or conversion returns `{asset, version, operation}`, a completed upload an `operationId`. Follow the Operation with `operations.get` until `succeeded`; a `failed` one carries an `error` whose `code` is `sim_asset_import_failed` or `sim_asset_conversion_failed` and whose message names the file. Validation and previews then run separately: read them as in step 4 of the workflow, then publish the version.
- **Updates**: `sim-assets.versions-source-update` compares the commit the version's `revision` names now (`latestCommit`) with its `commit`; it changes nothing. Import an update as the next version of the same asset: `sim-assets.imports` with the response's `simAssetId` and the version's `source` without `commit`.
- **Licence**: an imported or converted version without an SPDX licence needs a `License: <license>` line in the qualification notes.

| Code | Status | Do |
| --- | --- | --- |
| `sim_asset_source_invalid` | 422 | not a GitHub or Hugging Face URL in the forms above (`url` or `repository` in `details`) |
| `sim_asset_source_not_found` | 422 | the host does not serve the `repository` in `details` at its `revision` (or the directory): check the URL and revision; the repository must be public |
| `sim_asset_source_path_invalid` | 422 | the `path` in `details` is not a sim asset file at its `commit`: pick a root document from resolve's `files` |
| `sim_asset_conversion_unsupported` | 422 | no converter from the `sourceFormat` in `details` to its `format` |
| `sim_asset_version_content_missing` | 409 | the version has no content yet: wait for its import or upload, then convert |
| `sim_asset_version_not_imported` | 409 | the version has no `source`: only imported versions can be checked for updates |

## Workflow

### 1. Create

Find the robot: a published `robot_description` sim asset version of the workspace in each target format. `sim-assets.list` with `query` `{"workspaceId": "wks_...", "kind": "robot_description"}`, then `sim-assets.list-versions` of each asset. When there is none, add one (Robot models, above).

`sim-asset-builds.create` body:

```json
{
  "workspaceId": "wks_...",
  "name": "Microduck obstacle course",
  "slug": "microduck-obstacle-course",
  "request": {
    "prompt": "An obstacle course for Microduck with two ramps, a platform and a rubber mat",
    "targetFormats": ["mjcf"],
    "robotAssetVersionIds": { "mjcf": "smav_..." }
  },
  "budget": { "modelInputTokens": 400000, "modelOutputTokens": 80000, "modelImages": 20, "computeHours": 6 }
}
```

- `workspaceId` is the workspace's id (`workspaces.list` finds it by slug).
- `robotAssetVersionIds` has exactly one key per target format.
- `request.referenceImageHashes` is optional: up to 8 images, each first uploaded with `sim-asset-builds.reference-images` (`workspaceId`, the image's `sha256`, `size` in bytes, `contentType`) and its bytes sent with the `upload` grant it returns.
- `builders` is optional: each builder the request omits is rFabric's platform builder image. Pass one only to try another builder image, pinned by digest (`repository@sha256:<64 hex>`).
- Every budget counter is a hard limit checked before each step and each model call.

### 2. Wait for the plan

Call `sim-asset-builds.get` every 15-30 seconds until `status` is `awaiting_plan_approval`. The build's `steps` are its current revision's steps: each step's `status`, `classification` and `error`, the `sources` it fetched and the `modelCalls` it made. A failed step's attempt logs are `compute-attempts.logs` with its `attemptId`.

Statuses: `planning` -> `awaiting_plan_approval` -> `building` -> `awaiting_review`; or `failed`, `cancelled`, `budget_exhausted`.

Each revision (`revisions[]`) runs as one Operation (`operationId`). A `failed` build's reason, such as `plan_invalid` for a plan the API refused, is that Operation's `error`: `operations.get`.

### 3. Review and approve the plan

`sim-asset-builds.list-plan` returns `planSha256` and `plan` (`protocol: sim-asset-plan/1`). Check against the prompt:

- `layout`: `extentM` (floor, metres), the `route` waypoints, `clearances`, and each `placements[]` entry (`position` in metres, `rotation` in degrees, z up).
- `items[]`: `key`, `label`, `quantity`, `dimensions` (`assumed: true` means estimated), `source` (`generate`, or `library` with `repository`, `commit`, `path`).
- `parameters[]`: the scene parameters scenarios and trainers will randomize.
- `assumptions` and `sources`: what the planner guessed and what it read.

To change the plan, send the whole edited document as the body of `sim-asset-builds.replace-plan` (start from the `plan` you read, keep `robot.assetVersionId`, `conceptImage` and every `referenceCropHash` as they are; a `library` item's `commit` must be a commit SHA). It returns the stored plan with a new `planSha256`.

Approve with `sim-asset-builds.plan-approve` and body `{"planSha256": "<hex>"}`, the `planSha256` you last read. `plan_changed` (409) means the plan changed since you read it: read it again. Approval moves the build to `building` with one `import:<key>` / `object:<key>` step per item, then one `assemble:<format>` step per target format.

### 4. Review the outputs

Poll `sim-asset-builds.get` until `awaiting_review`, then call `sim-asset-builds.outputs`. Each output has `itemKey` (`scene` for an assembled scene), `asset`, `version` and `sources`.

Validation and previews finish after the build reaches `awaiting_review`: a version with no `fail` check, no previews `error` and `qualification` `null` is still settling unless its latest validation failed. Read that with `operations.list` and `query` `{"kind": "simAsset.validate", "resourceType": "simAssetVersion", "resourceId": "<version-id>", "sort": "createdAt:desc"}`:

- the newest Operation is `queued` or `running`, or `succeeded` with the previews still rendering: call `sim-asset-builds.outputs` again;
- it `failed` (its `error` `code`, e.g. `no_capable_pool` or `asset_validation_incomplete`): stop waiting, and once the cause is fixed rerun validation with `sim-assets.versions-validate`, or rebuild the version (step 5).

Stop and report a version that has not settled after 15 minutes. For each version check:

- `validationResults.checks`: no `fail`; read every `warn`.
- `previews.thumbnailUrl` and `previews.turntableUrl`: download them and look at them.
- `qualification`: `perception_eval` from validation; `interaction_eval` only after a review.
- `dependencies`: a scene depends on the robot and the item versions of its format.
- `license` and the step's `sources` for imported items.

### 5. Qualify, reject, or rebuild

**Qualify** each version you reviewed with `sim-assets.versions-qualify`, the version id as `pathParameters` `id`:

```json
{
  "level": "interaction_eval",
  "checklist": { "collisionGeometry": true, "massInertia": true, "friction": true, "scale": true },
  "notes": "Collision boxes match the visual mesh; mass from PVC density"
}
```

- Confirm a checklist item only after checking it; all four must be true.
- Qualify dependencies first: the robot and the item versions before the scene. `asset_qualification_insufficient` (422) with `details.requiredLevel` `interaction_eval` lists in `details.assetVersionIds` the versions to qualify first; with `perception_eval` it names the version itself, which is not at `perception_eval`: wait while its validation or previews are still settling (step 4), and rebuild it (below) after a `fail` check, `visual_preview` or a previews `error`.
- A version imported or converted without licence metadata needs a `License: <license>` line in `notes`.
- Needs the `simAsset.publish` permission. Gating evaluations and training launches stage only versions qualified at `interaction_eval`.

Otherwise:

- **Reject without rebuilding** with `sim-asset-builds.outputs-reject`: `pathParameters` `{"id": "smab_...", "versionId": "smav_..."}` and body `{"notes": "..."}` saying why. The version becomes `deprecated` with your notes; this requires `simAsset.publish`.
- **Reject and rebuild** with the same operation and body `{"notes": "...", "rebuild": true}`. It atomically deprecates the output and starts revision N+1 from the step that registered it, using the rejection notes. It requires both `simAsset.publish` and `definition.author`; do not follow it with a separate `sim-asset-builds.revisions` call.
- **Start a revision without rejecting an output** with `sim-asset-builds.revisions` and body `{"fromStepKey": "...", "notes": "..."}`: `fromStepKey` is the step to rerun (the version's `buildStepKey`: `object:<key>`, `import:<key>` or `assemble:<format>`, or `plan` to plan again). That step and every dependent step rerun as a new revision; every other step is reused. Then go back to step 2 (from `plan`) or 4.

## Errors

| Code | Status | Do |
| --- | --- | --- |
| `no_capable_pool` | 422 | no compute pool on the workspace's compute target (`compute.defaultTargetId` setting) runs `simAssetBuild.step` at `details.resourceClass`: ask a workspace admin for a target with such a pool |
| `sim_asset_build_builders_unresolved` | 422 | rFabric has no platform builder image for the `keys` in `details`: pass `builders` for those keys, or ask a platform operator to release the sim asset builders |
| `sim_asset_build_models_unavailable` | 422 | at create, the workspace can run no allowed model for the `roles` in `details`: with `clouds` in `details` (e.g. `openai`), ask an organization admin to connect that vendor's models API key under Integrations; with none, the workspace's `simAssetBuild.models` setting allows no model for those roles |
| `sim_asset_build_robot_invalid` | 422 | the robot version is not a published `robot_description` of the workspace in that format |
| `sim_asset_build_not_awaiting_plan_approval` | 409 | the build is not waiting for plan approval: read its status |
| `plan_changed` | 409 | read the plan again and approve its `planSha256` |
| `library_commit_invalid` | 422 | pin the library item's `commit` to a commit SHA (the `commit` in `details` holds the value refused) |
| `build_revision_running` | 409 | the current revision is still running: wait until the build settles |
| `budget_exhausted` | 409 | raise the budget with `sim-asset-builds.update` and body `{"budget": {...}}`, every counter, none below usage, then `sim-asset-builds.resume` |
| `asset_qualification_insufficient` | 422 | `details.requiredLevel` `interaction_eval`: qualify `details.assetVersionIds` first; `perception_eval`: the version is not at `perception_eval` - wait while its validation or previews settle, rebuild it from its `buildStepKey` after a `fail` check, `visual_preview` or a previews `error` |
| `VALIDATION_ERROR` | 422 | fix the argument named in `details` |

## Definition of Done

- [ ] The plan you approved is the build's current plan: its `planSha256` is the one `sim-asset-builds.plan-approve` named, and it matches the prompt or your edits.
- [ ] The build is `awaiting_review` and every step of its current revision succeeded.
- [ ] Every output in `sim-asset-builds.outputs` has no `fail` validation check, and you looked at its previews.
- [ ] Every output you accepted is qualified at `interaction_eval`, its dependencies before it, with notes on what you checked; every output you did not accept was rejected through `sim-asset-builds.outputs-reject` or rebuilt through `sim-asset-builds.revisions`, with notes.
- [ ] You reported the build id and each output's version id and qualification.

## With a shell: the rfabric CLI

An agent with a shell can run the same steps with the `rfabric` CLI, signed in and with its workspace set (`rfabric config set workspace <workspace-id-or-slug>`); add `--output json` to read what the API returned. The rFabric agent has no shell and uses the MCP tools only.

| Step | CLI |
| --- | --- |
| Start a build, with reference images | `rfabric sim-asset-build create ... [--reference-image <file>]` |
| Follow it | `rfabric sim-asset-build get <build-id>` |
| List builds | `rfabric sim-asset-build ls [--status <status>]` |
| Read the plan | `rfabric sim-asset-build plan <build-id>` |
| Edit the plan | `rfabric sim-asset-build plan <build-id> --file plan.json` |
| Approve the plan | `rfabric sim-asset-build approve-plan <build-id> --plan-sha256 <hex>` |
| List the outputs | `rfabric sim-asset-build outputs <build-id>` |
| Reject an output, or reject and rebuild | `rfabric api post /api/sim-asset-builds/<build-id>/outputs/<version-id>/reject --data '{"notes":"...","rebuild":true}'`; omit `rebuild` for rejection only |
| Rebuild from a step | `rfabric sim-asset-build revise <build-id> --from <step-key> --notes "..."` |
| Qualify a version | `rfabric sim-asset qualify <version-id> --level interaction_eval --checklist ...` |
| Raise the budget | `rfabric api patch /api/sim-asset-builds/<build-id> --data '{"budget":{...}}'` |
| Continue after budget exhaustion | `rfabric sim-asset-build resume <build-id>` |
| Cancel | `rfabric sim-asset-build cancel <build-id>` |
| Find the robot | `rfabric sim-asset ls --filter kind=robot_description`, then `rfabric sim-asset versions <asset-id>` |
| Browse the asset catalog | `rfabric sim-asset catalog ls [--search go2] [--maker <maker>] [--robot-type <type>] [--format mjcf]` |
| Import a catalog entry | `rfabric sim-asset catalog import <key> [--format <f>]... [--robot <id>] --wait` |
| Resolve a repository URL | `rfabric sim-asset resolve <url> [--revision <revision>]` |
| Import from a repository | `rfabric sim-asset import <url> [--revision <revision>] [--path <path>] (--asset <asset-id> \| --name <n> --slug <s>) --wait`; it resolves for you, `--path` is needed when the URL names no file |
| Upload local files | `rfabric sim-asset create-version <asset-id> --format <f> [--root-path <path>]`, then `rfabric sim-asset upload <version-id> <file>` |
| Convert to MJCF or OpenUSD | `rfabric sim-asset convert <version-id> --format mjcf\|openusd --wait` |
| Check its source for an update | `rfabric sim-asset source-update <version-id>`; it prints the `rfabric sim-asset import` command of the update |
| Publish a version | `rfabric sim-asset publish <version-id>` |
| Rerun validation | `rfabric sim-asset validate <version-id> --wait` |
| Find a version's validation | `rfabric operation ls -f kind=simAsset.validate -f resourceType=simAssetVersion -f resourceId=<version-id> --sort createdAt:desc` |
| Read an Operation | `rfabric operation get <operation-id>` |
| Read a failed step's logs | `rfabric compute-attempt logs <attempt-id>` |
