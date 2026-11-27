---
name: training-run
description: >-
  A policy trained on rFabric compute - a TrainingRun with metrics and checkpoints, launched from a LaunchTemplate that pins your trainer image. Use when asked to train, fine-tune or launch training (imitation learning on a dataset version, reinforcement learning in simulation), build a trainer image, create a training configuration (launch template) or keep it as a file, preview a launch's cost, follow a run, download a checkpoint, or cancel, retry, resume or diagnose a run. Not for runs trained elsewhere (`external-training-run`), comparing runs (`experiment`) or training from CI (`ci-integration`).
---

# Train a policy on rFabric compute

The user ends up with a completed TrainingRun (`run_...`): one training job with its metrics, logs and Checkpoints (`ckpt_...`, saved weights that can become a Model). rFabric runs the user's own trainer image on a ComputePool (`cpol_...`, machines of one size). A LaunchTemplate (`ltpl_...`, the app calls it Configuration, named by a `slug` unique in its workspace) is the reusable recipe: image, command, parameters, compute size and limits. Every run belongs to an Experiment (`exp_...`, runs pursuing one hypothesis) and, for imitation learning, reads one or more DatasetVersions (`dsv_...`, frozen data).

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Pick the pool | agent | `compute-pools.list`, `compute-targets.get` | none |
| 2 | Build and push the trainer image | agent with a shell; otherwise user, in a terminal with Docker | `launch-templates.list` | the image build and push |
| 3 | Create the LaunchTemplate | agent | `launch-templates.list`, `launch-templates.create` | none |
| 4 | Preview the launch | agent | `training-orchestration.launch-templates-launch-preview`, `workspaces.compute-quota-usage` | none |
| 5 | Launch | agent | `experiments.list`, `training-orchestration.launch-templates-launch` | none |
| 6 | Follow the run | agent | `training-runs.get`, `training-runs.chart-metrics`, `compute-attempts.list`, `compute-attempts.logs` | until `completed`, `failed` or `cancelled`; at most the runtime cap (24 hours unless the template sets one) |
| 7 | Take the checkpoint | agent | `checkpoints.list`, `checkpoints.download-url` | none |

Steps 1 to 3 happen once per trainer. A user who already has a LaunchTemplate starts at step 4. A pipeline that builds the trainer image and launches it is `ci-integration`.

## Before you start

- **Permissions**:

| To | Permission | Built-in roles |
| --- | --- | --- |
| preview and launch | `training:launch` | member, operator, admin, owner |
| read runs, metrics, checkpoints | `training:read` | member, operator, admin, owner |
| create or edit a LaunchTemplate | `training:configure` | admin, owner |
| cancel, retry | `training:cancel`, `training:retry` | operator, admin, owner |
| read pools, attempt logs, quota | `compute:read` | member, operator, admin, owner |

  A member or operator launches from an existing LaunchTemplate; creating or editing one needs an admin or owner. Say so in the plan. A 403 names the missing permission as a training action, for example "run.launch" for `training:launch`.
- **Needs**:
  - a pool that runs training: `compute-setup`. A pool in the user's own cloud account starts rFabric's handler image only after rFabric granted that account access to it (there, step 4);
  - for a trainer that uses the trainer library `rfabric-trainer`: a GitHub token that reads its repository `rfabric/rfabric-trainer`, for the image build. rFabric grants that access; ask your rFabric contact before you start;
  - imitation learning: a DatasetVersion whose `exportStatus` is `completed` (`dataset-versions.get`): `dataset-version`;
  - reinforcement learning with staged scenes or robots: published SimAssetVersions (`smav_...`) qualified at `interaction_eval`: `sim-asset-build`;
  - an Experiment: `experiment`, or create one in step 5.
- **Ask the user** (after reading what exists):

| Input | Why | How to find it or default |
| --- | --- | --- |
| Trainer code and its command | the trainer image holds the code, the run starts the command in it | their repository; default command `["python", "/opt/trainer/train.py"]` |
| Registry repository for the image | the pool pulls the image from it | one the chosen pool can pull from: the table in `trainer-image.md` |
| Parameters and their default values | `defaultConfig` of the template | the trainer's own flags |
| Which parameters and compute settings a launch may change | `allowedOverrideKeys` | default: the parameters only |
| Runtime cap and GPU-hour limit | a hard stop on cost | recommend both; without a cap a run may hold a machine for 24 hours |
| Which DatasetVersions | the data of an imitation learning run | `dataset-versions.list` in the workspace |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| Imitation learning on DatasetVersions | the policy learns from recorded episodes | template `datasetFormat` names the format the trainer reads (for example `lerobot_v3`); every launch names at least one DatasetVersion in that format |
| Reinforcement learning in simulation | the trainer generates its own experience | template `datasetFormat` is `null`; a launch with any DatasetVersion is refused; scenes and robots are staged through `simAssetVersionIds` |

The compute a launch uses is the user's call when the preview offers more than one option (step 4): show each option's estimate and let them pick.

## Steps

### 1. Pick the pool

`compute-pools.list` with query `status` `active`; read every page. Keep the pools whose `taskTypes` contains the string "training.run". None: go to `compute-setup`.

- Show the user each candidate's `name`, whether it is rFabric's (`scope` `platform`) or their own, its machine size in `capabilities` (`vcpu`, `memoryMiB`, `gpuClass`, `gpuCount`, `diskGiB`, `maxNodes`, `maxRuntimeS`) and its price per machine hour in `pricing` (`onDemandHourMicros` and `spotHourMicros`, micro-units of `currency`: divide by 1,000,000).
- The pool's target must be `verified`: `compute-targets.get` with the pool's `computeTargetId`. Its `placement` decides where the trainer image may live (step 2).
- One node of the run must fit one machine: `vcpu`, `memoryMiB`, `diskGiB` and `gpuCount` at most the pool's; `nodes` at most `maxNodes`; the runtime cap at most `maxRuntimeS`. A `gpuClass` in the template must equal the pool's byte for byte, or be left out.
- `diskGiB` must hold the run's inputs twice (the DatasetVersions, staged sim assets, resume checkpoint and base model: once in the machine's content cache, once in the trainer's inputs), what the trainer writes (its checkpoint, cache and outputs), and one more copy of the outputs.

### 2. Build and push the trainer image

Skip when `launch-templates.list` (query `workspaceId`) already shows a template with the wanted image.

1. Read `trainer-image.md` in this skill's directory. A trainer image is any container image that contains the training command; it is not built from an rFabric image. Check the user's trainer against the calls the file lists, choose the registry from its table, and say before the build when the pool requires a publicly readable image.
2. Fill its block in with the user's repository. With a shell, run its commands yourself after the user approves: Docker pulls and pushes with the user's registry logins. Without one, hand it over as a "Your turn" block.

Done when: you hold `<registry>/<repository>@sha256:<64 hex>`. Nothing has pulled the image yet: on rFabric's pools and connected pools the preview (step 4) reads it through the container registry; on self-hosted and local Docker pools the first run proves it, so keep that run small.

### 3. Create the LaunchTemplate

`launch-templates.create`:

```json
{
  "workspaceId": "wks_...",
  "name": "ACT pick and place",
  "slug": "act-pick-and-place",
  "computePoolId": "cpol_...",
  "datasetFormat": "lerobot_v3",
  "architecture": "act",
  "defaultConfig": { "command": ["python", "/opt/trainer/train.py"], "steps": 20000, "batchSize": 8 },
  "defaultComputeConfig": {
    "image": "<repository>@sha256:<64 hex>",
    "vcpu": 4, "memoryMiB": 16384, "gpuCount": 1, "diskGiB": 50, "nodes": 1,
    "checkpointEveryS": 600
  },
  "codeVersion": "<commit the image was built from>",
  "guardrails": { "allowedOverrideKeys": ["steps", "batchSize"], "maxRuntimeS": 14400, "maxGpuHours": 4 },
  "requiredTags": []
}
```

- `slug` (required, 1 to 128 characters): unique in the workspace; the CLI, pipelines and template files name the template by it. A taken slug is refused with `launch_template_slug_taken` (409).
- `codeVersion` (optional): the commit the image was built from, so every run on this image records it. Accepted only with `defaultComputeConfig.image`; an update that changes the image without stating `codeVersion` clears it.
- `defaultConfig`: `command` (required, a non-empty array of strings), optional `env` (string values). Every other top-level key is a parameter of the run.
- Name the step count `steps` when the trainer has one: estimates are computed from it (step 4).
- `defaultComputeConfig` is per node. Left out: `vcpu` 4, `memoryMiB` 16384, `gpuCount` 0, `diskGiB` 50, `nodes` 1, `checkpointEveryS` 600. `nodes` above 1 runs one trainer container per node with the rendezvous variables of PyTorch distributed training; every node pulls the trainer image itself, and the nodes share the worker's network.
- `guardrails`: `allowedOverrideKeys` is one list for parameters and compute settings alike (add `image` to let a launch run another trainer image, as a pipeline does); `maxRuntimeS` caps a run (24 hours without it); `maxGpuHours` is the GPU-hour budget of one run; `maxGpuCount` caps `gpuCount`; `maxInfraRetries` (3 without it) is how often a lost machine is replaced.
- `requiredTags`: tags every launch must carry. `architecture`: the model architecture this code trains and can continue; Models promoted from the runs inherit it.
- Reinforcement learning: `"datasetFormat": null`, and `simAssetVersionIds` for what every launch stages unless it names its own list.
- Leave out `computePoolId` and `computeTargetId` to place runs on the workspace's default compute target.
- Change it later with `launch-templates.update`; launched runs keep the config they started with. A template with a non-null `ci` is managed from a repository: `launch-templates.update` and `launch-templates.delete` refuse it with `definition_repository_managed` (409), and the change goes into its file. `launch-templates.delete` refuses a template an improvement program uses with `launch_template_in_use` (409, `details.improvementProgramIds`).
- Keep templates as files instead: a repository can hold its launch templates, applied by its pipeline or by hand, so a template changes through review like the trainer code. Read `launch-template-files.md` in this skill's directory when the user wants that, runs `rfabric training apply` or `rfabric training export`, or a template is refused with `definition_repository_managed`.

### 4. Preview the launch

`training-orchestration.launch-templates-launch-preview` takes the launch body of step 5 (`experimentId` optional) and creates nothing. A body refused for its inputs (guardrails, data, assets, base model, target) fails here with the launch's own error; pool placement, the GPU-hour budget and the quota are enforced only by the launch.

| Field | Tell the user |
| --- | --- |
| `computeOptions[]` | per option: `gpuClass`, `gpuCount`, `vcpu`, `memoryMiB`, `estimateDurationMinutes`, `estimateGpuHours`, `estimateCostUsd`; `isSelected` marks what this body would use; `exceedsMaxRuntime` true means the run would be cut off before it finishes |
| `estimateBasisRuns` | how many completed runs of this template the estimates rest on |
| `maxRuntimeS` | the hard stop of this run |
| `checks[]` | `validationSplit` `failed`: no episode in a `val` or `validation` split; `dataMatchesModel` `failed`: cameras, joint count or rate differ from the data the base model was trained on; `gpuBudget` `failed`: `gpuHoursNeeded` above `gpuHoursLeft` this month; `trainerImage` (only when the launch runs an image): rFabric reads the image through the container registry and compares its platform with the pool's machines. `failed`: `code` (`container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch`) and `reason` say why; `not_checked`: self-hosted and local Docker pools, where the host's own `docker login` decides. `unknown`: nothing to compare with (no estimate yet, or a base model that records no training data), or the image check could not complete |

- Estimates are `null` until a run of the template has completed with its steps reported, and whenever the launch has no numeric `steps` parameter. Say so, and give the worst case instead: GPU hours = `maxRuntimeS` / 3600 x `gpuCount` x `nodes`; cost = `maxRuntimeS` / 3600 x the pool's price per machine hour x `nodes`. Admission counts that whole worst case against the monthly quota and `maxGpuHours` when there is no estimate.
- A `failed` check does not block the preview. Report it and let the user decide; a `failed` `trainerImage` check means the launch will be refused (Problems).
- Reinforcement learning: no DatasetVersion, so only `gpuBudget` is checked; the estimate still needs `steps`.
- More than one option appears only when `allowedOverrideKeys` holds `gpuClass` or `gpuCount`. Select one with `computeOverrides` and preview again.
- `workspaces.compute-quota-usage` shows the month so far (`gpuSeconds`) against `gpuHoursPerMonth`; `hardStop` true means a launch over the quota is refused.

### 5. Launch

Find the Experiment with `experiments.list` (query `workspaceId`), or create one with `experiments.create` (`workspaceId`, `name`, `hypothesis`). Before the call, tell the user the pool, the estimated duration, GPU hours and cost from the preview (or the worst case) and the cap: a launch spends compute.

`training-orchestration.launch-templates-launch`, `pathParameters` `id` the template:

| Field | Imitation learning | Reinforcement learning |
| --- | --- | --- |
| `experimentId` | required | required |
| `datasetVersionIds` | one or more, all in the template's `datasetFormat` | leave out |
| `simAssetVersionIds` | leave out | leave out to stage the template's list; any list, also `[]`, replaces it |
| `configOverrides` | parameters, for example `{"steps": 5000}` | for a first run a short one, for example fewer iterations and environments |
| `computeOverrides` | compute settings, for example `{"gpuCount": 1}`; `image` runs another trainer image (`<repository>@sha256:<64 hex>`, the template must allow the `image` override) | the same |
| `codeVersion` | with an `image` override only: the commit that image was built from; left out, the run records none. Without an `image` override the run records the template's `codeVersion` | the same |
| `baseModelId` | a Model (`mdl_...`) to fine-tune from | the same |
| `tags` | must include every `requiredTags` entry | the same |
| `name` | optional; left out, the run gets the name the preview suggests | the same |

The run comes back `queued` with `estimateDurationMinutes`, `estimateCostUsd`, `operationId`, `computeTaskId` and `appUrl` (its page in the app). After a timeout repeat the call with the same `idempotencyKey`. A run launched by a pipeline also carries `ci`, the build that launched it (`ci-integration`).

A run's Mission and Task links are copied from its Experiment; read them with `training-run-missions.list` and `training-run-tasks.list` (query `trainingRunId`), add one with `training-run-missions.create` or `training-run-tasks.create`.

### 6. Follow the run

Poll `training-runs.get` every 30 seconds.

| `status` | Meaning for the user |
| --- | --- |
| `queued` | admitted; waiting for a machine of the pool |
| `provisioning` | a machine took the run: image pull, data and asset download |
| `running` | the trainer is training; `progress` holds `currentStep`, `totalSteps`, `currentEpoch` |
| `completed` | the trainer exited cleanly |
| `failed` | see "Read a failure" |
| `cancelled` | stopped on request |

- Metrics: `training-runs.chart-metrics` with query `tier` `overview` (500 points per series) and optionally `series`. Say whether the main metric moves in the right direction, with numbers.
- Trainer output: the run's attempts are `compute-attempts.list` with query `computeTaskId`; the highest `attemptNumber` is the current one; `compute-attempts.logs` (query `tail`, up to 5000) returns its last lines. More than one attempt means a machine was lost and the trainer resumed from its latest checkpoint: no action.
- `gpuHours` on the run is what it has consumed so far; `staleFlag` true means it has been silent longer than the workspace's stale interval (15 minutes by default). A multi-node run reports metrics from its first node only.
- Stop following after 15 minutes, or once the run is `running` with a first metric: report the status, the step, the estimate and that "check run `<id>`" picks it up.

### 7. Take the checkpoint

`checkpoints.list` with query `trainingRunId` (`sort` `step:desc`). `bestCheckpoint` on the run is the Checkpoint with the lowest `val_loss`, or the lowest `loss` when none reports `val_loss`.

To get the files: `checkpoints.download-url` returns `files[]` (`relativePath`, `sizeBytes`, `sha256`, `url`) valid until `expiresAt`. A Checkpoint stored by an rFabric run is one tar archive. Tell the user the size, download, and compare the SHA-256.

## Cancel

`training-runs.cancel` with body `{"reason": "..."}`. Say first that it cannot be undone and that the compute used so far stays consumed. The run is `cancelled` at once; a waiting run never starts, a running trainer is told to stop and saves a last checkpoint when it can. A cancelled run can be retried.

## Retry or resume

`training-runs.retry` works on a `failed` or `cancelled` run and creates another `queued` run with the same image, config, data, assets and template, linked through `retryOfTrainingRunId`. It is a launch: quota and budget are checked again, and it spends compute again. Say so before the call.

- Resume: body `{"resumeFromCheckpointId": "ckpt_..."}`, a Checkpoint of the run or of a run it was retried from. Without it the retry starts at step 0.
- `training-runs.retry-chain` returns `ancestors` (oldest first) and `descendants`: use it to find the original run and the latest attempt.
- Retry repeats the same inputs. Use it after a cause outside the trainer was fixed (quota, data access, a cancel by mistake), or with a resume after the runtime cap. A trainer bug needs a rebuilt image (step 2), the template updated, and a launch. To change one parameter and compare: `experiment`.

## Read a failure

1. `training-runs.get`: `errorMessage`.
2. `compute-tasks.get` with the run's `computeTaskId`: `classification`, `attemptCount`, `infraFailureCount`, `canonicalAttemptId`.
3. `compute-attempts.get` with that attempt: `error` (`code`, `message`); then `compute-attempts.logs`.

| `classification` | What it means | Do |
| --- | --- | --- |
| `product_failure`, code `training_failed` | the trainer exited with an error; not retried | read the log tail; exit code -9 is out of memory: raise `memoryMiB`, lower the batch size, or use a GPU pool |
| `product_failure`, code `final_checkpoint_rejected` | the trainer exited cleanly but its last checkpoint was refused | read the log for the refusal; fix what the trainer writes |
| `product_failure`, code `dataset_files_unavailable` | the files of a DatasetVersion could not be listed | check the dataset's storage: `storage-connection` |
| `timeout` | the run hit `maxRuntimeS`; not retried | retry with `resumeFromCheckpointId`, or raise the cap in the template and launch |
| `infra_error`, `preempted` | machines kept failing until the retry budget ran out | retry with `resumeFromCheckpointId`; repeated: `compute-setup` |
| `invalid` | an input the worker could not use, or failures on several machines in a row. Code `container_registry_not_connected`, `image_access_denied` or `image_not_found`: before every run, also when the image is already on the machine, rFabric checks that the container registry can still read the exact image, and a container registry revoked or narrowed since the launch stops the run. Code `command_not_executable`: the trainer image cannot start the template's `command`. Code `image_user_not_found`: the trainer image's `USER` names a user or group the image does not define | read `error` and the task's `findings`; restore the container registry (`compute-setup`, Container registry access) or fix the command or the image, then retry |

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `image_not_pinned` (422) | the image is given by tag | use `<repository>@sha256:<64 hex>` |
| `VALIDATION_ERROR` (422) with `violations` in `details` | a guardrail: `allowedOverrideKeys` (a key the template does not open, `image` included), `maxGpuCount`, `requiredTags` (tags missing) | drop the override or add the tags; opening a key is a template edit by an admin |
| `VALIDATION_ERROR` (422), `details` `field` `codeVersion` | `codeVersion` without an image: on a launch without an `image` override, on a template without `defaultComputeConfig.image` | state `codeVersion` only with the image it describes |
| `launch_template_slug_taken` (409) | another template of the workspace holds the slug; `details.launchTemplateId` names it | pick another slug, or update that template |
| `definition_repository_managed` (409) on update or delete | the template is managed from a repository; `details` name the `repository`, `directoryPath` and `commit` | change its file there (`launch-template-files.md`) |
| `launch_template_in_use` (409) on delete | an improvement program launches from it; `details.improvementProgramIds` | `improvement-program`: point the program at another template first |
| `container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch` (422) at the launch | on rFabric's pools and connected pools the trainer image check refused the launch: no connected container registry of the workspace or its organization serves the image's AWS account or Google Cloud project; the registry refuses the read; the image does not exist; or it is built for another platform than the pool's machines. The message names the image, the pool and the cause. Nothing was started | `trainer-image.md`, Where to push it; `compute-setup`, Container registry access; build for the platform the message names |
| `UPSTREAM_ERROR` (502) at the launch | the image check could not complete | launch again: it is retryable; repeated: check the registry is reachable |
| `VALIDATION_ERROR` (422), `reason` `target_unavailable` in `details` | the template's compute target is `disabled` or `failed` | `compute-setup` |
| `launch_template_dataset_required`, `launch_template_reads_no_dataset` (422) | DatasetVersions missing, or given to a template that reads none | match the launch to the template's `datasetFormat` |
| `dataset_format_mismatch` (422) | a DatasetVersion holds datasets in another format; `details` lists them | pick a version in the template's format |
| `CONFLICT` (409), `reason` `dataset_version_not_ready` in `details` | the version's files are still being written | wait for `exportStatus` `completed` |
| `asset_qualification_insufficient` (422) | a staged SimAssetVersion or a dependency is below `interaction_eval`; `details` lists the ids | qualify them: `sim-asset-build` |
| `base_model_weights_unavailable` (422) | the base Model has no stored weights a machine can download | start from a Model whose Checkpoint bytes rFabric stores |
| `no_capable_pool` (422) | no reachable active pool runs training at the size in `details` | shrink the compute config to a pool's `capabilities`, pin a pool, or `compute-setup` |
| `target_not_verified` (422) | the target is not `verified` | `compute-setup` |
| `budget_exceeded` (422) | the estimate, or the whole cap when there is none, is above the template's `maxGpuHours` | lower `steps`, set a tighter `maxRuntimeS`, or raise `maxGpuHours` |
| `quota_exceeded` (422) | month so far plus this run is above the workspace's monthly quota (`details`) | reduce the run, wait for the next month, or ask an organization admin to raise the quota |
| `checkpoint_not_resumable` (422) | the Checkpoint has no stored location and SHA-256 | pick a Checkpoint stored by an rFabric run |
| `checkpoint_not_downloadable` (409) | rFabric holds no bytes for this Checkpoint | pick a Checkpoint with `storageState` `verified`, or one stored by an rFabric run |
| `CONFLICT` (409) on cancel or retry | the run is already finished (cancel), or is not `failed` or `cancelled` (retry) | read the run's `status` |
| `queued` for 15 minutes | no machine has taken the run | report it; check the pool and its target in `compute-setup` |
| attempts fail before `running` with a pull error in the log | the machine cannot pull the trainer image. On a self-hosted or local Docker pool: the host's own `docker login` does not cover that registry | the user runs `docker login <registry>` on that host as the user the worker runs as (`trainer-image.md`, Where to push it); retry the run |

## Done when

- [ ] `launch-templates.get` shows the image by digest, the command, the pool and the limits the user agreed to.
- [ ] The user heard the estimate or the worst case before the launch.
- [ ] `training-runs.get` shows `completed`, or the user knows the current status and how to pick the run up.
- [ ] `training-runs.chart-metrics` returned the main metric and the user saw its first and last value.
- [ ] `checkpoints.list` shows at least one Checkpoint; the final report names the run, the best Checkpoint and the GPU hours used.

## Next

- `experiment`: a follow-up run with one change, and the comparison.
- `model-release`: promote the Checkpoint to a Model.
- `evaluation-job`: evaluate the Checkpoint or the Model on a real robot or as replay; in simulation the launch is `simulation-suite`.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Pools | `rfabric compute-pool ls -f status=active` |
| Create the template | `rfabric launch-template create --slug <slug> --data @template.json [--code-version <commit>]` |
| Preview | `rfabric training run <template slug or id> --preview --experiment <experiment-id> [--dataset-version <id>]` |
| Launch | `rfabric training run <template slug or id> --experiment <experiment-id> [--dataset-version <id>] [--config-overrides '{"steps":5000}'] [--compute-overrides '{"gpuCount":1}'] [--image <repository>@sha256:<digest> --code-version <commit>] [--base-model <id>] [--tag <tag>] [--idempotency-key <key>] [--wait]`; it prints the run and `App: <the run's page>`, and `--idempotency-key` keys only the launch |
| Launch template files | `rfabric training export`, `rfabric training apply [--preview]` (`launch-template-files.md`) |
| Follow | `rfabric training-run wait <run-id>`, `rfabric training-run get <run-id>`; a wait exits 0 completed, 40 cancelled, 50 failed, 60 when `--wait-timeout` ran out (the run goes on) |
| Metrics | `rfabric training-run chart-metrics <run-id> --tier overview [--series <name>]` |
| Trainer output | `rfabric compute-attempt ls -f computeTaskId=<task-id>`, `rfabric compute-attempt logs <attempt-id> --tail 200` |
| Checkpoints | `rfabric checkpoint ls -f trainingRunId=<run-id>`, `rfabric checkpoint download <checkpoint-id> <dir>` |
| Cancel | `rfabric training-run cancel <run-id> --reason "..."` |
| Retry, resume | `rfabric training-run retry <run-id> [--resume-from <checkpoint-id>]` |
