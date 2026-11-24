---
name: simulation-suite
description: >-
  A policy tested in simulation on a defined, reproducible set of cases - published evaluation scenarios, a published SimSuite over evaluation cells, and an evaluation job for a candidate against an optional baseline. Use when asked to define or change a simulation scenario or suite, add a randomization axis, seeds or faults, declare coverage cells, preflight or launch a suite, follow or cancel that job, or clone or deprecate a suite or scenario. Not for reading the report - `evaluation-job`; not for the simulator itself - `simulator-setup`.
---

# Define and run a simulation suite

The user ends up with a published, launchable definition of what a policy is tested on, and a running or finished evaluation job for a candidate. The entities:

- **EvaluationScenario** (`evs_...`): one simulated mission: the adapter profile and sim asset versions it pins, the robot's observation and action contract, the mission, limits, faults, and the parameter axes (`variables`) it varies.
- **EvaluationCell** (`evcl_...`): one site profile x operation x robot profile the workspace claims to cover, with a `coverageStatus`.
- **SimSuite** (`ssut_...`): pinned scenarios over a matrix of cells under one protocol. It is what gets launched.
- **EvaluationProtocol** (`evp_...`): the acceptance rules. Its `rolloutPlan` `seeds` are crossed with every parameter combination; its `protocolType` decides whether the verdict gates a release.
- **EvaluationJob** (`evj_...`) and **EvaluationRun** (`evr_...`): one launch, and one run per case and side (candidate, baseline).

A **case** is one parameter combination of a scenario with one seed. Cases = combinations x seeds; runs = cases x sides.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Collect what the suite pins | agent | `sim-adapter-profiles.list`, `sim-assets.versions-list`, `evaluation-protocols.list`, `evaluation-cells.list`, `artifacts.list` | - |
| 2 | Declare the evaluation cells | agent | `evaluation-cells.create`, `evaluation-cells.update` | - |
| 3 | Write the scenario | agent | `evaluation-scenarios.create`, `evaluation-scenarios.update` | - |
| 4 | Publish the scenario | agent | `evaluation-scenarios.publish` | - |
| 5 | Create and publish the suite | agent | `sim-suites.create`, `sim-suites.publish` | - |
| 6 | Preflight the launch | agent | `sim-suites.preflight` | image check, up to 10 seconds per image |
| 7 | Launch | agent, user confirms the cost | `sim-suites.launch` | - |
| 8 | Follow the job | agent | `evaluation-jobs.progress`, `evaluation-jobs.get` | until `completed`, `failed` or `cancelled`; `projectedCompletionAt` estimates it |

Definitions kept as files in a Git repository follow another path: read `definition-directory.md` in this skill's directory instead of steps 2 to 5.

This skill launches and follows the job. The report (verdict, failures, exports, comparisons) is `evaluation-job`, from its step "Read the verdict".

## Before you start

- **Permissions** (read them with `introspect.whoami`):

| Action | Permission | Built-in roles |
| --- | --- | --- |
| Create or edit cells, scenarios, suites; new version; clone | `evaluationDefinition:author` | operator, admin, owner |
| Publish or deprecate a scenario or suite | `evaluationDefinition:publish` | admin, owner |
| Preflight and launch a suite | `simSuite:launch` | operator, admin, owner |
| Cancel the job | `evaluationJob:cancel` | operator, admin, owner |

  An operator can draft and launch; an admin or owner publishes. Say so in the plan when the user is an operator. A 403 names the missing permission in the API's own words, for example `definition.author` for `evaluationDefinition:author`.
- **Needs**:

| What | Provided by |
| --- | --- |
| A published adapter profile, and published sim asset versions for the world and robot | `simulator-setup`, `sim-asset-build` |
| A published protocol with `executionMode` `simulation` and seeds in `rolloutPlan` | `evaluation-definitions` |
| A candidate: for a simulator that runs in a container, an artifact (`art_...`) whose `inference_server` layer names a container image | `artifact-build` |
| A compute pool that runs simulation attempts; for a gating protocol, an approved qualification of that pool | `compute-setup` |

- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| What the robot must do, and what counts as done | the scenario's mission and end conditions | their words; criteria are in the protocol (`evaluation-definitions`) |
| Which conditions to vary, and over which values | `variables` | propose axes from the world version's declared scene parameters |
| Site, operation and robot the result speaks for | the cell | names they use for the site, the task and the robot model |
| Candidate, and whether to compare with a baseline | launch | `artifacts.list`; default: no baseline |
| Budget and deadline | launch | default: none; propose the plan's estimate plus a margin |

## Decisions

**Advisory or gating** (decided by the protocol, not by the suite)

| Option | Choose when | Consequence |
| --- | --- | --- |
| Advisory (any `protocolType` but `deployment_acceptance`) | exploring, regression signal, first runs | needs published definitions only |
| Gating (`protocolType` `deployment_acceptance`) | the verdict decides a release | every target cell must be `supported` or `physically_covered`, every staged sim asset version qualified at `interaction_eval`, and the pool must have an approved qualification |

**Expansion**

| Option | Choose when | Consequence |
| --- | --- | --- |
| `full` (recommended for few axes) | every combination matters | cases grow as the product of all axis values |
| `pairwise` | many axes | far fewer cases; every pair of values is still covered |

**Baseline**

| Option | Choose when | Consequence |
| --- | --- | --- |
| With a baseline | the question is "is the candidate at least as good as X" | every case runs twice, so runs and worker hours double; a protocol with `statistics` `nonInferiorityMargin` compares case by case |
| Without | the question is "does it pass" | one run per case |

## Steps

### 1. Collect what the suite pins

Read, do not ask:

- Profile: `sim-adapter-profiles.list` with `{"workspaceId": "wks_...", "status": "published"}`. Note its `id`, `capabilities` and the keys of its simulator `faultArgv` (the fault kinds it supports).
- Sim asset versions: `sim-assets.versions-list` with `{"workspaceId": "wks_...", "status": "published"}`. For the world note `parameters` (its scene parameters) and `validationResults` `inventory` (the body, joint, site, camera and keyframe names a scenario may use).
- Protocol: `evaluation-protocols.list` with `{"workspaceId": "wks_...", "status": "published"}`, then `evaluation-protocols.get`: `executionMode` must be `simulation`, `rolloutPlan` `seeds` non-empty. Tell the user the seeds and whether the protocol gates.
- Cells: `evaluation-cells.list`. Existing scenarios and suites: `evaluation-scenarios.list`, `sim-suites.list`.
- Candidate: `artifacts.list` with `status` `ready`.

Anything missing: name the skill that provides it (Before you start) and stop there.

Done when: you hold the profile id, the world and robot version ids, the protocol id and the candidate id.

### 2. Declare the evaluation cells

A cell says "we cover this robot doing this operation at this kind of site". `evaluation-cells.create` with `workspaceId`, `siteProfileKey`, `operation`, `robotProfileKey` and `coverageStatus`. The three keys are free text and unique together (a duplicate answers 409); a scenario lands on a cell only when its three keys are byte-identical.

| `coverageStatus` | A gating launch may target it |
| --- | --- |
| `supported`, `physically_covered` | yes |
| `advisory`, `excluded`, `missing` | no: `cell_not_supported` |

Start a cell at `advisory`. Raising it with `evaluation-cells.update` is a claim about coverage the user makes, not you: ask.

Done when: `evaluation-cells.list` shows each cell the suite will name.

### 3. Write the scenario

`evaluation-scenarios.create` creates a `draft`; `evaluation-scenarios.update` edits it. The body is large: read it with `describe_operation`. What carries a decision:

| Field | Meaning for the user |
| --- | --- |
| `variables` | the condition axes. For full coverage use `sampling` `grid` with authored `values`. `constraints` (expressions over `vars`) remove impossible combinations |
| `variables[]` `sceneParameter` | binds an axis to a scene parameter the world version declares: this is domain randomization of the scene (a ramp angle, a friction). Values must lie inside the declared range or choices |
| `simulation` `adapterProfileId` | the published profile: the workspace's own or a platform profile |
| `simulation` `siteProfileKey`, `operation`, `robotProfileKey` | the cell this scenario lands on (step 2) |
| `simulation` `assets` | `world`, `robot`, `inputs`: published sim asset version ids of the workspace |
| `simulation` `embodiment` | what the simulated robot offers the candidate: control rate, action groups, state components, cameras, sensors. Only parts the profile's `capabilities` list |
| `simulation` `initialState`, `mission` | start pose, instruction, observers (measurements reduced to one value) and end conditions |
| `simulation` `faults` | `[{ "kind", "atSimS", "durationS", "params" }]`; `kind` must be a key of the profile's simulator `faultArgv` |
| `simulation` `readiness` | the topics and transforms that must be present, and `warmupS`, before the mission starts |
| `simulation` `limits` | `missionSimS` (simulated seconds from mission start) and `wallS` (wall-clock cap). They size the cost estimate and the runtime cap of every attempt |
| `simulation` `requiredMetrics` | ground-truth paths every run must report; a run missing one is `invalid` |
| `simulation` `allowedContacts` | bodies the robot may touch; any other contact is recorded as disallowed |

Rules that save a failed publish:

- Use names (joints, bodies, sites, cameras, keyframes) exactly as the sim asset inventory of the world or robot version lists them. An SDF link is `<model>::<link>`.
- Do not send `size` or `names` beside `components` or `groups`: rFabric derives them (`embodiment_derived_field`).
- Two variables cannot bind the same scene parameter.
- Seeds are not in the scenario. They are the protocol's `rolloutPlan` `seeds`, and every combination runs once per seed. To test generalization, the protocol should use seeds the policy was not trained on; changing them is a new protocol version (`evaluation-definitions`).

Tell the user the case count before publishing: product of the `grid` axis sizes (minus excluded combinations) x number of seeds.

Done when: `evaluation-scenarios.get` shows the draft with the intended `variables` and `simulation` block.

### 4. Publish the scenario

Before the call, tell the user: publishing freezes this version; it cannot be edited or unpublished, a change is a new version.

`evaluation-scenarios.publish`. It checks the profile, the asset pins, the scene parameter bindings and, under a profile with `capabilities`, the formats, the embodiment, the mission and every name. A refusal lists each problem with its path in `details` (`issues` or `unsupported`): fix the draft and publish again.

Read the published scenario's `version` and `digest`: the suite pins both.

Done when: `status` is `published`.

### 5. Create and publish the suite

`sim-suites.create`:

```json
{
  "workspaceId": "wks_...", "slug": "warehouse-put-away", "name": "Warehouse put-away",
  "protocolId": "evp_...",
  "scenarioEntries": [{ "scenarioId": "evs_...", "version": 1, "sha256": "<the scenario's digest>", "required": true }],
  "matrix": ["evcl_..."],
  "expansion": "full", "minValidSamplesPerCell": 1, "baselineOrder": "alternate", "tags": ["quick"]
}
```

- `sha256` is the scenario's `digest`, copied from the published scenario.
- `required`: only cases of required entries decide whether the job is complete; a non-required entry is run and reported.
- `minValidSamplesPerCell`: the number of valid candidate runs each target cell must reach, else the verdict is inconclusive.
- `baselineOrder`: `alternate`, `candidate_first` or `baseline_first`.
- `poolId` is optional: the pool every launch uses unless the launch names another. Without one, rFabric picks a capable pool.
- The protocol version is pinned when the suite is created (`protocolVersion`).

Then `sim-suites.publish` (same irreversibility as step 4). Publish requires a published protocol with seeds, every entry a published simulated scenario whose digest matches, and every cell in the workspace.

Done when: the suite's `status` is `published`.

### 6. Preflight the launch

`sim-suites.preflight` takes the launch body and creates nothing: no job, no compute, no quota. The host may still ask the user to approve it; say that it only checks.

```json
{
  "subjectType": "artifact", "subjectId": "art_...",
  "baseline": { "subjectType": "artifact", "subjectId": "art_..." },
  "targetMatrix": ["evcl_..."],
  "resourceProfile": { "maxParallelGpu": 1, "maxParallelCpu": 4, "maxWorkerHours": 10 },
  "wallDeadlineS": 7200
}
```

Only `subjectType` and `subjectId` are required. `targetMatrix` narrows the launch to some cells of the suite; `resourceProfile` is a budget and needs all three values; `wallDeadlineS` (at least 60) ends the whole job.

Read the answer to the user:

| Field | Tell the user |
| --- | --- |
| `ok` | whether the launch would be admitted now |
| `blockers[]` | each `code` and `message`; `isBaseline` true means the baseline side. Fix every one (Problems) |
| `plan` | `cases`, `runs` (cases x sides), `estimatedWorkerHours`, `gpuHours` (reserved against the workspace's monthly quota), cases per cell, and `uncoveredCellIds`: suite cells no scenario lands on. Null when a blocker stopped the planning |
| `imageChecks[]` | per `role` (`candidate`, `baseline`, `simulator`): `status` `passed`, or `not_checked` with the `reason` (for example a self-hosted pool pulls with its own registry access) |
| `embodimentDifferences[]` | where a subject model's control rate, state or action size, action chunk or cameras differ from the scenario's. Informational: it never blocks, but a mismatch is the usual cause of a candidate that fails every case |

Done when: `ok` is true and the user has seen runs, worker hours and GPU hours.

### 7. Launch

Before the call, state the cost from the preflight plan: runs, estimated worker hours, GPU hours, and that it starts compute immediately. For a gating protocol add that the verdict will count as release evidence.

`sim-suites.launch` with the same body, plus an `idempotencyKey` (8 to 200 characters, your own value). Repeating the identical launch with the same key returns the same job; a different launch with that key answers `idempotency_conflict`.

It returns the EvaluationJob: `id`, `status`, `requestedRuns`, `baselineRuns`, `estimatedWorkerHours`, `operationId`, and `embodimentDifferences` again. Give the user `https://app.rfabric.io/open/<job id>`: the evaluation's page follows the job live, and a running run there plays its live video.

Done when: you hold the job id.

### 8. Follow the job

- `evaluation-jobs.progress`: `status`, `runsByStatus` (`pending`, `running`, `completed`, `failed`, `aborted`, `timeout`, ...), `primaryMetricEstimate` with its confidence interval while runs come in, and `projectedCompletionAt`.
- Report when the counts change, not on every poll. Give the projected completion when you start waiting.
- An infrastructure failure of a run is retried automatically, up to the protocol's `maxInfraRetries`. Product failures, timeouts and cancellations are not.
- Runs that ended without success: `evaluation-runs.list` with `{"jobId": "evj_...", "outcome": {"in": ["failure", "timeout", "aborted", "system_error", "invalid"]}}`. Per run, `evaluation-runs.failures` says why it failed, `evaluation-runs.attempts` lists its attempts and their `error`, `compute-attempts.logs` gives the simulator and candidate logs.
- `evaluation-jobs.get`: once `status` is `completed`, `failed` or `cancelled`, `reportId` is set. Hand over to `evaluation-job` at its step "Read the verdict"; do not summarize the result from progress numbers.
- **Cancel**: `evaluation-jobs.cancel`. Tell the user first: running cases stop, unstarted ones never run, and the report of a cancelled job always concludes `inconclusive`. A job already `completed` or `failed` answers 409.

Done when: the job is terminal and the user has the job id, its status and the link.

## Change, clone, retire

| Goal | Do | Tell the user |
| --- | --- | --- |
| Change a published scenario | `evaluation-scenarios.create-versions` -> edit -> publish | new `id`, `version` and `digest`. Suites keep running the old version until a new suite version pins the new one |
| Change a published suite (other scenarios, cells, protocol version, expansion) | `sim-suites.create-versions` -> `sim-suites.update` -> `sim-suites.publish` | launches by id keep using the version they name; earlier jobs and reports are unchanged |
| Add a randomization axis after a failure | new scenario version with the extra variable, then a new suite version pinning it | the case count multiplies by the new axis size |
| Copy into another workspace, or take a shared definition | `evaluation-scenarios.clone`, `sim-suites.clone` with body `{"workspaceId": "wks_..."}` | a `draft` with the same slug. A cloned suite still points at the source's protocol, scenarios and cells: re-point `protocolId`, `scenarioEntries` and `matrix` to definitions of the target workspace before publishing |
| Run a job again (reproduce a run, or more evidence) | `sim-suites.launch` on the same suite id with the same candidate, baseline and `targetMatrix`, and a new `idempotencyKey`. The job's report carries that launch as `reproductionCommand` | the same suite version, scenarios and seeds run again as a new job; it costs the same compute |
| Retire a suite | `sim-suites.deprecate` | cannot be undone. The suite no longer launches (`suite_not_published`); its jobs and reports stay |
| Retire a scenario | `evaluation-scenarios.deprecate`, after retiring or re-pinning every suite that pins it | cannot be undone. Every suite still pinning it stops launching (`scenario_digest_mismatch`) |
| Discard a draft | `sim-suites.delete`, `evaluation-scenarios.delete` | - |
| Remove a cell | `evaluation-cells.delete` | permanent; a suite naming it answers `cell_not_found` |

`sim-suites.list-versions` and `evaluation-scenarios.list-versions` show a definition's history, oldest first. Before retiring a scenario, find its suites: `sim-suites.list` with `status` `published`, and look for the scenario id in `scenarioEntries`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `adapter_profile_not_published` (422) | the scenario's profile is a draft, deprecated, or belongs to another workspace | publish it, or pin a published one (`simulator-setup`) |
| 422 `VALIDATION_ERROR` on scenario publish naming an asset version | a pinned sim asset version is not a published version of the workspace | publish it (`simulator-setup`) |
| `scene_parameter_unknown`, `scene_parameter_out_of_range` (422) | a variable binds a parameter the world does not declare, or exceeds its range; `details` has `variableKey` and `sceneParameter` | use a declared parameter and stay inside its range, or pin a world version that declares it |
| `asset_format_unsupported`, `embodiment_unsupported`, `transport_unsupported` (422) | the profile's simulator cannot load that format or offer that embodiment part; `details` `unsupported` lists path and value | change the scenario, or choose a profile whose `capabilities` list it |
| `embodiment_invalid`, `mission_invalid` (422) with issue `name_unknown` | a name is not in the sim asset inventory | use the inventory's exact name |
| same, with issue `inventory_missing` | a world or robot version (or a dependency) has no inventory | validate it again (`simulator-setup`), then publish |
| `protocol_not_published`, `protocol_seeds_missing`, `protocol_not_simulation` | the protocol is a draft, has no seeds, or does not run in simulation | fix the protocol (`evaluation-definitions`); a new protocol version needs a new suite version |
| `scenario_not_published`, `scenario_digest_mismatch` | an entry is not that published scenario version, or its `sha256` is not the scenario's digest | read `version` and `digest` again and update the suite draft; for a published suite, make a new version |
| `cell_not_found`, `cell_not_supported` | a cell is not in the workspace, or a gating launch targets a cell that is not `supported` or `physically_covered` | correct the matrix; changing a cell's status is the user's decision |
| `plan_empty` | no scenario's three keys match a cell in scope | align the scenario's keys with a cell of the matrix |
| `subject_not_runnable` | the candidate (or baseline) has no container image to run | use an artifact with an `inference_server` image (`artifact-build`) |
| `asset_qualification_insufficient` | a gating launch stages a sim asset version below `interaction_eval`; ids in `details` | qualify them (`sim-asset-build`), or use an advisory protocol |
| `no_capable_pool`, `pool_not_qualified`, `target_not_verified` | no pool fits the profile's resources; the pool has no approved qualification for gating; the pool's target is not verified | `compute-setup` |
| `budget_exceeded` | the estimate exceeds `maxWorkerHours`; `details` has both numbers | raise the budget, or narrow `targetMatrix` |
| `quota_exceeded` | the workspace's monthly compute quota would be exceeded | wait for the next month, or ask an admin to raise the quota |
| `container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch` | rFabric cannot read an image on the pool it would run on; the message names the role, image and pool | connect the registry or grant read access (`compute-setup`); push the image and use its digest; rebuild for the pool's platform |
| 502 `UPSTREAM_ERROR` on preflight or launch | the image's registry could not be reached | retry later; nothing was created |
| `idempotency_conflict` (409) | the key was used for a different launch | use a new key |
| `definition_repository_managed` (409) | the scenario or suite is published from files in a Git repository | change the files and apply them (`definition-directory.md`) |
| 409 on update | the definition is `published` or `deprecated` | make a new version |
| Runs end `invalid` with `FAULT_NOT_APPLIED` | the simulator could not inject a fault | remove the fault or fix its `params` |

## Done when

- [ ] `evaluation-scenarios.get` and `sim-suites.get` show `published` for what was defined.
- [ ] `sim-suites.preflight` answered `ok` true, and the user saw runs, worker hours and GPU hours before the launch.
- [ ] `evaluation-jobs.get` shows the job for this candidate; when the user asked to wait, its `status` is terminal and `reportId` is set.
- [ ] The user has the suite id and version, the job id, and the link to the job.

## Next

- `evaluation-job`: read the report, the verdict and the failures; compare with the baseline.
- `simulator-setup`, `sim-asset-build`: change the simulator or the scene the scenarios pin.
- `ci-integration`: run the suite on every pull request.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Cells | `rfabric evaluation-cell create --data @cell.json`, `rfabric evaluation-cell ls` |
| Scenario | `rfabric evaluation-scenario create --data @scenario.json`, `rfabric evaluation-scenario publish <scenario-id>` |
| Suite | `rfabric sim-suite create --data @suite.json`, `rfabric sim-suite publish <suite-id>` |
| New version, clone, retire, history | `versions <id>`, `clone <id> --workspace <workspace>`, `deprecate <id>`, `history <id>` on `rfabric evaluation-scenario` and `rfabric sim-suite` |
| Preflight | `rfabric sim run <suite> --candidate <id> [--baseline <id>] --preflight` |
| Launch and wait | `rfabric sim run <suite> --candidate <id> [--baseline <id>] [--cell <cell-id>]... [--pool <pool-id>] --wait [--junit report.xml] [--markdown report.md]`; `<suite>` is an id, a slug or `slug@version`. Budget: `--max-worker-hours`, `--max-parallel-gpu`, `--max-parallel-cpu` (all three together); deadline: `--wall-deadline <seconds>` |
| Follow, cancel | `rfabric evaluation-job progress <job-id>`, `rfabric evaluation-job cancel <job-id>` |
