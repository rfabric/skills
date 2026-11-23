---
name: sim-asset-build
description: >-
  Simulation assets for a robot - objects and an assembled OpenUSD or MJCF scene, built by rFabric from a prompt or authored locally by the agent, validated, qualified for evaluation and published. Use when asked to build, generate, author, write or plan a simulation environment, scene, course or objects for a robot, to review or edit a build's plan, to review, reject, rebuild, qualify or publish its outputs, or to continue a build that failed or ran out of budget. Also adds the robot model a build needs. Not for registering a simulator or scenes that already exist as files: `simulator-setup`.
---

# Sim asset build

A **sim asset build** (SimAssetBuild, `smab_...`) turns a prompt, one published robot model per target format and the target formats (`mjcf` for MuJoCo, `openusd` for Isaac Sim) into simulation assets: one SimAsset version (`smav_...`) per object and one assembled scene per format. rFabric runs each step as a digest-pinned builder image on its compute and records every input, output, model call, fetched source and usage against the budget.

The user reviews twice: the **plan** before anything is built, and the **outputs** before they are qualified for evaluation and published.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## Build on rFabric or author locally

Two paths lead to the same published, qualified sim asset versions. Offer both before step 1 and let the user choose:

| Path | Choose when | Consequence |
| --- | --- | --- |
| **Author locally** ([author-locally.md](author-locally.md)) | the user wants the assets quickly; the scene is a few objects you can write directly (boxes, ramps, platforms, a mat, a table) | you write the MJCF or OpenUSD files on the user's machine, check they load, and upload them; no build budget and no rFabric compute before the upload. No build record: no prompt, plan or model-call history; dependencies are still pinned |
| **Build on rFabric** (the steps below) | the user wants generated objects from a prompt or reference images, library items imported at a pinned commit, a plan to review first, or the build's full record from prompt to outputs | the build runs digest-pinned builder images on rFabric compute and spends its budget; it takes longer |

Without a shell (`bash`) you can still author locally: write the files with your file tools; only the local load check (step 3 of [author-locally.md](author-locally.md)) needs the shell.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Find the robot model, start the build | agent | `sim-assets.list`, `sim-assets.list-versions`, `sim-asset-builds.reference-images`, `sim-asset-builds.create` | none |
| 2 | Wait for the plan | agent | `sim-asset-builds.get` | until `awaiting_plan_approval` |
| 3 | Review the plan, edit it, approve it | user decides, agent calls | `sim-asset-builds.list-plan`, `sim-asset-builds.contents`, `sim-asset-builds.replace-plan`, `sim-asset-builds.plan-approve` | the user's review |
| 4 | Wait for the outputs, check them | agent, then user looks at previews | `sim-asset-builds.get`, `sim-asset-builds.outputs`, `operations.list` | until `awaiting_review`, then until validation and previews settle |
| 5 | Qualify, reject or rebuild each output | user decides, agent calls | `sim-assets.versions-qualify`, `sim-asset-builds.outputs-reject`, `sim-asset-builds.revisions` | a rebuild returns to step 2 or 4 |
| 6 | Publish the accepted outputs | agent | `sim-assets.versions-publish` | none |

Other operations: `sim-asset-builds.list` lists builds, `sim-asset-builds.update` raises the budget, `sim-asset-builds.resume` continues after budget exhaustion, `sim-asset-builds.cancel` stops a build.

| Build `status` | Meaning for the user |
| --- | --- |
| `planning` | the plan is being written |
| `awaiting_plan_approval` | the plan waits for the user; nothing else runs |
| `building` | objects are being built, then the scene is assembled |
| `awaiting_review` | every step succeeded; the outputs wait for the user |
| `completed` | every output of the current revision is qualified at `interaction_eval` or rejected |
| `failed` | a step failed (Problems) |
| `budget_exhausted` | a budget counter reached its limit (Problems) |
| `cancelled` | stopped on request |

## Before you start

- **Permissions**:

| To | Permission | Built-in roles |
| --- | --- | --- |
| start, cancel, resume or revise a build, edit and approve its plan, raise its budget; add a robot model | `evaluationDefinition:author` | operator, admin, owner |
| qualify, reject or publish an output | `simAsset:publish` | operator, admin, owner |

  A 403 names the missing one in the API's own words: `definition.author` is `evaluationDefinition:author`, `simAsset.publish` is `simAsset:publish`.
- **Needs**:
  - a published `robot_description` sim asset version of the workspace in each target format. When the workspace has none, add one first: read [robot-models.md](robot-models.md);
  - compute that runs build steps: `compute-setup` (Problems, `no_capable_pool`);
  - a model the build may call: `model-vendor-credential` (Problems, `sim_asset_build_models_unavailable`).
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Prompt | what to build | the user's words; ask for sizes, counts and materials they care about |
| Target formats | which simulator the assets are for | `mjcf` for MuJoCo, `openusd` for Isaac Sim; the formats their robot model exists in |
| Robot | the build is laid out around it | list `robot_description` assets of the workspace; ask when more than one fits |
| Budget | hard limits on model tokens, images and compute hours | propose values and say they are hard limits; the user confirms |
| Reference images | optional, up to 8, to show what the scene should look like | PNG, JPEG or WebP files of at most 10 MiB each that the user names |

## Decisions

**The plan** (step 3)

| Option | Choose when | Consequence |
| --- | --- | --- |
| Approve as it is | the plan matches the prompt | the build steps start and use budget |
| Edit, then approve | single values are wrong: a size, a count, a position, an item's source | the edited plan is what gets built |
| Plan again with notes | the plan misses the intent | the build is cancelled, then the plan step reruns with the notes and uses budget; the new plan comes back for review |

**Each output** (step 5)

| Option | Choose when | Consequence |
| --- | --- | --- |
| Qualify at `interaction_eval` | geometry, mass, friction and scale were checked | gating evaluations and training launches stage only versions at this level |
| Reject and rebuild | the output is wrong and the notes say how | the output is deprecated and its step reruns with the notes; uses budget |
| Reject | the output is not needed | the output is deprecated; nothing reruns |

**Budget exhausted**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Raise the budget and resume | the remaining steps are worth more model calls and compute hours | the build continues from its first unfinished step |
| Stop | the cost outweighs the result | finished outputs stay; the build stays `budget_exhausted` |

## Steps

### 1. Start the build

Find the robot: `sim-assets.list` with `query` `{"workspaceId": "wks_...", "kind": "robot_description"}`, then `sim-assets.list-versions` of each asset. Pick the published version in each target format.

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

- `robotAssetVersionIds` has exactly one key per target format.
- `request.referenceImageHashes` is optional: up to 8 images. Upload each first with `sim-asset-builds.reference-images` (`workspaceId`, the image's `sha256`, `size` in bytes, `contentType`) and send its bytes with the `upload` grant it returns; `upload` `null` means the image is already stored.
- `builders` is optional: each builder the request omits is rFabric's platform builder image. Pass one only to try another builder image, pinned by digest (`repository@sha256:<64 hex>`).
- Every budget counter is a hard limit checked before each step and each model call.

Before the call, tell the user that the build spends model calls and compute up to the budget. Afterwards: the build id, the budget it runs under, and that the next thing they see is a plan to review; nothing is built before they approve it.

### 2. Wait for the plan

Call `sim-asset-builds.get` every 15 to 30 seconds until `status` is `awaiting_plan_approval`. The build's `steps` are its current revision's steps: each step's `status`, `classification` and `error`, the `sources` it fetched and the `modelCalls` it made. A failed step's attempt logs are `compute-attempts.logs` with its `attemptId`. A step is cut off after one hour.

Each revision (`revisions[]`) runs as one Operation (`operationId`). A `failed` build's reason, such as `plan_invalid` for a plan the API refused, is that Operation's `error`: `operations.get`.

### 3. Review and approve the plan

`sim-asset-builds.list-plan` returns `planSha256` and `plan` (`protocol: sim-asset-plan/1`). Show the user the plan against their prompt, as a short summary and one table of items:

- `layout`: `extentM` (floor, metres), the `route` waypoints, `clearances`, and each `placements[]` entry (`position` in metres, `rotation` in degrees, z up).
- `items[]`: `key`, `label`, `quantity`, `dimensions` (`assumed: true` means estimated: point these out), `source` (`generate`, or `library` with `repository`, `commit`, `path`).
- `parameters[]`: the scene parameters scenarios and trainers will randomize.
- `assumptions` and `sources`: what the planner guessed and what it read.
- `conceptImage`: the SHA-256 of the concept image. `sim-asset-builds.contents` with that hash returns a `downloadUrl`; give the user the link so they can look at it.

| The user wants | Do |
| --- | --- |
| The plan as it is | approve (below) |
| Single values changed | send the whole edited document as the body of `sim-asset-builds.replace-plan`: start from the `plan` you read, keep `robot.assetVersionId`, `conceptImage` and every `referenceCropHash` as they are; a `library` item's `commit` must be a commit SHA. It returns the stored plan with a new `planSha256`. Show the user what changed, then approve |
| Another plan | a build that waits for approval counts as running, so first `sim-asset-builds.cancel`, then `sim-asset-builds.revisions` with body `{"fromStepKey": "plan", "notes": "..."}`; say first that it uses budget. Back to step 2 |

Tell the user the plan waits for them, and for how long: a revision ends 7 days after it started, and a build still waiting for approval then fails with `operation_timeout`.

Approve with `sim-asset-builds.plan-approve` and body `{"planSha256": "<hex>"}`, the `planSha256` the user last saw. Say before the call that approval starts the build steps, which use budget. The build moves to `building` with one `import:<key>` (a library item fetched at a pinned commit) or `object:<key>` (a generated object) step per item, then one `assemble:<format>` step per target format.

### 4. Review the outputs

Poll `sim-asset-builds.get` until `awaiting_review`; report each step as it finishes. Then call `sim-asset-builds.outputs`. Each output has `itemKey` (`scene` for an assembled scene), `asset`, `version` and `sources`. Every output is a `draft` version.

Validation and previews finish after the build reaches `awaiting_review`: a version with no `fail` check, no previews `error` and `qualification` `null` is still settling unless its latest validation failed. Read that with `operations.list` and `query` `{"kind": "simAsset.validate", "resourceType": "simAssetVersion", "resourceId": "<version-id>", "sort": "createdAt:desc"}`:

- the newest Operation is `queued` or `running`, or `succeeded` with the previews still rendering: call `sim-asset-builds.outputs` again;
- it `failed` (its `error` `code`, for example `no_capable_pool` or `asset_validation_incomplete`): stop waiting, and once the cause is fixed rerun validation with `sim-assets.versions-validate`, or rebuild the version (step 5).

Stop and report a version that has not settled after 15 minutes. For each version check, and show the user as one table (output, validation, qualification, licence):

- `validationResults.checks`: no `fail`; read every `warn`.
- `previews.thumbnailUrl` and `previews.turntableUrl`: download them, look at them, and tell the user where the files are so they can look too.
- `qualification`: `perception_eval` from validation; `interaction_eval` only after a review.
- `dependencies`: a scene depends on the robot and the item versions of its format.
- `license` and the step's `sources` for imported items.

### 5. Qualify, reject, or rebuild

The user decides per output. **Qualify** each version they accept with `sim-assets.versions-qualify`, the version id as `pathParameters` `id`:

```json
{
  "level": "interaction_eval",
  "checklist": { "collisionGeometry": true, "massInertia": true, "friction": true, "scale": true },
  "notes": "Collision boxes match the visual mesh; mass from PVC density"
}
```

- Confirm a checklist item only after checking it; all four must be true. Tell the user what you checked for each and what you could not check.
- Qualify dependencies first: the robot and the item versions before the scene.
- A version imported or converted without licence metadata needs a `License: <license>` line in `notes`: ask the user for the licence.

Otherwise:

- **Reject without rebuilding** with `sim-asset-builds.outputs-reject`: `pathParameters` `{"id": "smab_...", "versionId": "smav_..."}` and body `{"notes": "..."}` saying why. The version becomes `deprecated` with the notes; this cannot be undone.
- **Reject and rebuild** with the same operation and body `{"notes": "...", "rebuild": true}`. It atomically deprecates the output and starts revision N+1 from the step that registered it, using the rejection notes. It needs both permissions; do not follow it with a separate `sim-asset-builds.revisions` call.
- **Start a revision without rejecting an output** with `sim-asset-builds.revisions` and body `{"fromStepKey": "...", "notes": "..."}`: `fromStepKey` is the step to rerun (the version's `buildStepKey`: `object:<key>`, `import:<key>` or `assemble:<format>`, or `plan` to plan again). That step and every dependent step rerun as a new revision; every other step is reused. Then go back to step 2 (from `plan`) or 4.

A rebuild uses budget: say so before the call. Only a `draft` output can be rejected.

Done when: `sim-asset-builds.get` shows `completed`. The build reaches it by itself once every output of the current revision is qualified at `interaction_eval` or rejected.

### 6. Publish the accepted outputs

A qualified output is still a `draft`: a scenario can pin it, and a training launch can stage it, only once it is `published`.

Before the call, tell the user: a published version is immutable and can no longer be rejected; retiring it later is a deprecation (`simulator-setup`).

`sim-assets.versions-publish` with each accepted version id, dependencies first: the item versions, then the scene.

Done when: `sim-asset-builds.outputs` shows every accepted version `published`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `no_capable_pool` (422) | no compute pool on the workspace's compute target (`compute.defaultTargetId` setting) runs `simAssetBuild.step` at `details.resourceClass` | a workspace admin adds a target with such a pool: `compute-setup` |
| `sim_asset_build_builders_unresolved` (422) | the build names no builder for the `keys` in `details` and rFabric has none for them | pass `builders` for those keys; a platform builder is rFabric's to grant: ask your rFabric contact |
| `sim_asset_build_models_unavailable` (422) | at create, the workspace can run no allowed model for the `roles` in `details` | with `clouds` in `details` (for example `openai`): an organization admin connects that model vendor account, `model-vendor-credential`; with none: the workspace's `simAssetBuild.models` setting allows no model for those roles |
| `sim_asset_build_robot_invalid` (422) | the robot version is not a published `robot_description` of the workspace in that format | pick another version, or add the model: [robot-models.md](robot-models.md) |
| `sim_asset_build_reference_image_missing` (422) | a hash in `referenceImageHashes` was not uploaded to the workspace (`sha256` in `details`) | upload it with `sim-asset-builds.reference-images`, then create again |
| `CONFLICT` (409) at create | the `slug` is taken by another build of the workspace | choose another slug |
| `sim_asset_build_not_awaiting_plan_approval` (409) | the build is not waiting for plan approval | read its status |
| `plan_changed` (409) | the plan changed since it was read | read the plan again, show the user the difference, approve its `planSha256` |
| `library_commit_invalid` (422) | a library item's `commit` is not a commit SHA (the `commit` in `details` holds the value refused) | pin it to a commit SHA |
| `build_revision_running` (409) | the current revision is still running; a build that waits for plan approval counts as running | wait until the build settles; to plan again while it waits for approval, cancel it first (step 3) |
| Status `failed` | a step of the current revision failed, or the revision passed its 7 days (`operation_timeout`) | read the Operation's `error`, the failed step's `error` and its attempt logs (step 2); once the cause is fixed, rerun from that step with `sim-asset-builds.revisions` and its `stepKey` as `fromStepKey` (`plan` after a timeout while waiting for approval) |
| `budget_exhausted` (409), or status `budget_exhausted` | a budget counter reached its limit | show `usage` against `budget`; on the user's decision raise it with `sim-asset-builds.update` and body `{"budget": {...}}` (every counter, none below usage), then `sim-asset-builds.resume` |
| `sim_asset_build_not_budget_exhausted` (409) on resume | only a `budget_exhausted` build resumes | read its status; rerun a failed or cancelled build from a step with `sim-asset-builds.revisions` |
| `sim_asset_build_not_cancellable` (409) | the build is already `completed`, `failed` or `cancelled` | nothing to cancel |
| `asset_qualification_insufficient` (422) | `details.requiredLevel` `interaction_eval`: dependencies are not qualified; `perception_eval`: the version itself is not at `perception_eval` | qualify `details.assetVersionIds` first; or wait while validation or previews settle (step 4), and rebuild the version from its `buildStepKey` after a `fail` check, `visual_preview` or a previews `error` |
| `CONFLICT` (409) on reject | the output is no longer a `draft` | a published version is retired by deprecation: `simulator-setup` |
| `asset_dependency_unpublished` (422) on publish | a dependency is still a `draft`, or was rejected (ids in `details`) | publish the dependencies first; a scene that depends on a rejected item needs a rebuild from its `assemble:<format>` step |
| `VALIDATION_ERROR` (422) | an argument is malformed | fix the argument named in `details` |

## Done when

- [ ] The plan the user approved is the build's current plan: its `planSha256` is the one `sim-asset-builds.plan-approve` named.
- [ ] `sim-asset-builds.get` shows `completed`, and every step of its current revision succeeded.
- [ ] Every output in `sim-asset-builds.outputs` has no `fail` validation check, and its previews were looked at.
- [ ] Every accepted output is qualified at `interaction_eval`, its dependencies before it, with notes on what was checked, and is `published`; every other output was rejected through `sim-asset-builds.outputs-reject` or rebuilt, with notes.
- [ ] The final report lists the build id, each output's version id, qualification and status, and usage against the budget.

## Next

- `simulator-setup`: make the simulator that loads these assets runnable in the workspace.
- `simulation-suite`: define scenarios on the scene and run a policy against them.
- `training-run`: stage the scene and the robot in a reinforcement learning launch.

## The rfabric CLI

They need a signed-in CLI with the workspace set (`rfabric config set workspace <workspace-id-or-slug>`); `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| Find the robot | `rfabric sim-asset ls --filter kind=robot_description`, then `rfabric sim-asset versions <asset-id>` |
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
| Publish a version | `rfabric sim-asset publish <version-id>` |
| Raise the budget | `rfabric api patch /api/sim-asset-builds/<build-id> --data '{"budget":{...}}'` |
| Continue after budget exhaustion | `rfabric sim-asset-build resume <build-id>` |
| Cancel | `rfabric sim-asset-build cancel <build-id>` |
| Rerun validation | `rfabric sim-asset validate <version-id> --wait` |
| Find a version's validation | `rfabric operation ls -f kind=simAsset.validate -f resourceType=simAssetVersion -f resourceId=<version-id> --sort createdAt:desc` |
| Read an Operation | `rfabric operation get <operation-id>` |
| Read a failed step's logs | `rfabric compute-attempt logs <attempt-id>` |
