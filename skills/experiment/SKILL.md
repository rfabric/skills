---
name: experiment
description: >-
  Training work organized and compared - an Experiment that groups TrainingRuns around one hypothesis, follow-up runs that change one parameter, a ranked comparison, and a recorded conclusion. Use when asked to create an experiment (or one from a template), launch a follow-up or ablation run, compare or diff runs, rank runs by a metric, build a leaderboard, group runs, record a parameter sweep, see which parameters matter, review the workspace's training portfolio, or conclude or archive an experiment. Not for the first launch of a trainer - that is `training-run`.
---

# Organize and compare training work

The user ends up with an Experiment (`exp_...`): the TrainingRuns (`run_...`) that test one hypothesis, a comparison that says which run is better and why, and a recorded conclusion. Other entities: ExperimentTemplate (`extpl_...`, a starting point with required tags and a hypothesis outline), ComparisonGroup (`cmpg_...`, a named set of runs inside one Experiment), LaunchTemplate (`ltpl_...`, the recipe runs are launched from).

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Create the Experiment | agent | `experiments.list`, `experiments.create` or `experiments.from-template` | none |
| 2 | Launch a follow-up run with one change | agent | `training-runs.get`, `launch-templates.get`, `training-orchestration.launch-templates-launch`, `training-runs.diff` | the run itself: follow it with `training-run` |
| 3 | Group runs (optional) | agent | `experiments.comparison-groups`, `training-orchestration.training-runs-assign-group` | none |
| 4 | Compare | agent | `experiments.leaderboard`, `experiments.compare`, `training-runs.diff`, `experiments.parallel-coordinates` | none |
| 5 | Conclude | user decides, agent records | `experiments.conclude` | the user's decision |
| 6 | Archive | agent | `experiments.archive` | none |

Each step stands alone: a user who only wants a comparison starts at step 4.

## Before you start

- **Permissions**: reading and every comparison need `training:read`. Creating, concluding, archiving, grouping, defining a sweep and launching need `training:launch` and write access to the workspace. The built-in roles member, operator, admin and owner carry both.
- **Needs**: a LaunchTemplate and at least one run to follow up on or compare: `training-run`. Runs trained outside rFabric join an Experiment through `external-training-run`.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| The hypothesis, in one sentence | it says what a comparison must show | propose one from their request |
| The metric that decides, and whether higher or lower is better | ranking has no direction of its own | list the series names of one run with `training-runs.chart-metrics` and propose the main one |
| The one thing a follow-up changes | one change keeps the comparison readable | from their request |
| Winner and decision (step 5) | the conclusion is theirs | propose both from the comparison |

## Decisions

How runs are ranked (step 4):

| Option | Choose when | Consequence |
| --- | --- | --- |
| `experiments.leaderboard`, `mode` `best` | higher is better and the peak counts (best success rate, best reward) | each run's highest value, highest first |
| `experiments.leaderboard`, `mode` `final` | higher is better and the value at the end of training counts | each run's last reported value, highest first |
| Your own ranking from `experiments.compare` | lower is better (a loss) | you sort the runs ascending by `finalMetrics` |

## Steps

### 1. Create the Experiment

Look first: `experiments.list` with query `workspaceId` and `q` (full text over name, description and hypothesis). Archived Experiments appear only with `includeArchived` true.

- **Plain**: `experiments.create` with `workspaceId`, `name`, `hypothesis`, and optionally `description`, `tags`, `projectId`, `missionIds`, `taskIds`. Runs created in the Experiment copy its Mission and Task links.
- **From a template**: pick one from `experiment-templates.list` (query `workspaceId`), then `experiments.from-template` with `workspaceId`, `templateId`, `name` and optionally `hypothesis`, `description`, `tags`. The Experiment gets your tags plus the template's default tags and its promotion criteria; without `hypothesis` it gets the template's hypothesis outline. Every tag in the template's `requiredTags` must be among the result.
- **A template for the team**: `experiment-templates.create` with `workspaceId`, `name`, `requiredTags`, `defaultTags`, `hypothesisStructure`, `defaultPromotionCriteria`.

**Done when** `experiments.get` returns the Experiment with `status` `active`.

### 2. Launch a follow-up run with one change

A follow-up is a launch from the same LaunchTemplate, in the same Experiment, on the same data, with one parameter changed.

1. Read the parent: `training-runs.get` gives `launchTemplateId`, `experimentId`, `config`, `computeConfig`, `datasetVersionIds`, `simAssetVersionIds`, `baseModelId`, `codeVersion` and, for a run a pipeline launched, `ci`.
2. Read the template: `launch-templates.get` gives `defaultConfig`, `defaultComputeConfig`, `guardrails` and `requiredTags`. The parent's overrides are the keys whose value in `config` (or `computeConfig`) differs from the template's defaults. A parent that ran a pipeline's trainer image has `computeConfig.image` among them.
3. Launch with `training-orchestration.launch-templates-launch`: the parent's `experimentId`, `datasetVersionIds`, `simAssetVersionIds` and `baseModelId`, the parent's overrides plus the one change in `configOverrides`, and `tags` holding the template's `requiredTags`. When the parent's overrides hold `image`, also send the parent's `codeVersion` as `codeVersion`; without it the follow-up records no code version. When an evaluation motivated the change, add the tag `evaluationJob=<evaluation job id>`. Preview the cost and tell the user before the call, as in `training-run`.
4. Prove the isolation: `training-runs.diff` with `leftRunId` the parent and `rightRunId` the follow-up must return exactly one entry in `changedParameters` (`key`, `left`, `right`), empty `datasetVersionDelta` and `simAssetVersionDelta`, and the same `left` and `right` in `image` and `codeVersion`. More than one difference: say which, and ask whether to keep the run. `ci` differs when only one of the two was launched by a pipeline; that is no difference in what was trained.

- The changed parameter must be in the template's `allowedOverrideKeys`. Otherwise the launch is refused, and opening the key is a template edit by an admin (`training-run`).
- A parent without `launchTemplateId` was not launched from a template: its follow-up is recorded through `external-training-run`.
- Find the follow-ups of an evaluation later: `training-runs.list` with query `experimentId` and `tag` `evaluationJob=<evaluation job id>`.

### 3. Group runs

Use a ComparisonGroup to compare set against set: baseline against variant, or the seeds of one configuration.

1. `experiments.comparison-groups` with `pathParameters` `id` the Experiment and body `name`, optional `description` and `color`.
2. `training-orchestration.training-runs-assign-group` with `pathParameters` `id` the run and body `comparisonGroupId`. A run is in one group at a time: assigning replaces the previous group. The group must belong to the run's own Experiment.
3. Read back: `comparison-groups.list` with query `experimentId`; the runs of a group are `training-runs.list` with query `comparisonGroupId`.

### 4. Compare

Read the runs first: `training-runs.list` with query `experimentId`, every page. Compare `completed` runs; a run still training ranks on its value so far, so name it as unfinished.

| Question | Operation | What it returns |
| --- | --- | --- |
| Which run is best on one metric | `experiments.leaderboard`, query `metric` (the exact series name), `mode` (`best` unless set), `limit` (100 unless set, at most 500) | rows with `rank`, `runId`, `name`, `status`, `metricValue`, `datasetVersionIds`, `config`; highest value first, runs without the metric last |
| How the curves relate | `experiments.compare`, body `runIds` (1 to 100) and optional `series` | `series`: per metric name the points of all runs (`runId`, `step`, `observedAt`, `value`); `runs`: per run `finalMetrics`, `bestMetrics`, `config`, `datasetVersionIds`, `codeVersion`, `baseModelId` |
| What differs between two runs | `training-runs.diff`, body `leftRunId`, `rightRunId` | `changedParameters`, `datasetVersionDelta`, `simAssetVersionDelta` (`added` and `removed`, relative to the left run), and `left` and `right` of `codeVersion`, `baseModelId`, `image` (the trainer image, by digest) and `ci` (the build that launched the run, null when none did) |
| How parameters relate to outcomes across many runs | `experiments.parallel-coordinates`, body `runIds` (1 to 500, any Experiment) | `axes` (every parameter, then every metric series) and one row per run with its value on each axis, the last reported value for a metric, `null` where a run has none |

- The leaderboard ranks highest value first in both modes, and `bestMetrics` is each series' highest value: use them for metrics where higher is better. For a metric where lower is better, rank the runs yourself, ascending, by the series' value in `finalMetrics` of `experiments.compare`; for the lowest point of a curve read the series points.
- A `metricValue` of `null` on every row means the metric name matches no series: copy the name from `training-runs.chart-metrics`.
- Give the user a table, not raw rows: run name, the changed parameter and its value, the metric, the difference to the baseline. Say how many runs were compared and which were left out and why. Two runs that differ in more than the tested parameter (check with `training-runs.diff`) do not prove the hypothesis: say so.
- For people: the app shows two runs side by side at `https://app.rfabric.io/<organization slug>/<workspace slug>/training/runs/compare?runs=<run id>,<run id>`.

Where the workspace stands as a whole: `training-orchestration.portfolio` with `pathParameters` `workspaceId` returns `activeRuns`, `failedRuns`, `staleRuns`, `gpuHours`, `idleExperiments` (active Experiments untouched for over 30 days), `promotionThroughput`, `totalRuns`, `totalExperiments`. Idle Experiments are candidates for steps 5 and 6.

### 5. Conclude

The conclusion belongs to the user. Show the comparison, propose the winner and the decision in one sentence each, and wait for their answer.

`experiments.conclude` with `pathParameters` `id` and body:

```json
{
  "outcomeSummary": "Chunk size 20 lowered final validation loss from 0.041 to 0.033 on the same data.",
  "decision": "Adopt chunk size 20 as the template default; promote the checkpoint of the winning run.",
  "winningRunId": "run_...",
  "links": [{ "label": "Evaluation report", "url": "https://app.rfabric.io/open/evj_..." }]
}
```

- `outcomeSummary` and `decision` are required. `winningRunId` must be a run of this Experiment; `winningModelId` names the Model promoted from it, when there is one.
- The Experiment becomes `completed`. Concluding again overwrites the earlier conclusion: say so before a second call.

### 6. Archive

Before archiving, list the runs still going: `training-runs.list` with query `experimentId` and `status` (`queued`, `provisioning`, `running`, `checkpointing`). Archiving does not stop them and they keep consuming compute: ask whether to cancel them first (`training-run`).

`experiments.archive` sets `status` `archived`. The response carries `warning` beside `data`: the count of runs still active, also stored as `archiveWarning`. Runs, Checkpoints and Models are kept; the Experiment leaves the default list. Bring it back with `experiments.update` and `status` `active`.

## Sweep: record a parameter search

rFabric stores a sweep's definition and analyses its member runs. It does not generate or launch the members: each one is a run you create.

1. **Define**: `experiments.sweeps` with `pathParameters` `id` the Experiment and body `name`, `strategy` (`grid`, `random` or `list`), `parameterSpace` (each swept parameter mapped to the values searched, for example `{"lr": [0.0001, 0.0003], "chunkSize": [10, 20]}`) and optional `sharedInputs`. Give the user the returned id (`swpd_...`): member runs carry it as `sweepDefinitionId`, and every later step needs it.
2. **Create the members**: a run joins a sweep only when it is created, through `sweepDefinitionId` in the body of `training-runs.create`; a launch from a LaunchTemplate cannot join. Take `config`, `computeConfig`, `datasetVersionIds` and `simAssetVersionIds` from one reference run (`training-runs.get`), set this member's values, and create one run per point of the space.
3. **Follow**: `training-runs.list` with query `sweepDefinitionId`. Stop a member that is clearly losing with `training-runs.cancel`, after telling the user.
4. **Rank the parameters**: `experiments.parameter-importance` with query `sweepDefinitionId` and `outcomeMetric` (a series name) returns `rankings` (`parameter`, `importance`), most influential first: how much the mean of each run's last metric value moves across the parameter's values. `tooSmall` true means fewer than 3 members are `completed`. Then compare the members as in step 4.

Before creating members, tell the user what it costs:

- A run created with an `image` in `computeConfig` starts on rFabric compute at once, without a LaunchTemplate: no pool pin, no override limits, no GPU-hour budget, a runtime cap of 24 hours unless `computeConfig` sets `maxRuntimeS`, and placement on the workspace's default compute target. Set `maxRuntimeS` on every member.
- The worst case is members x cap x GPUs per member. Say the number of members and that product, and wait for a yes.
- A member without an `image` is trained elsewhere and reported through `external-training-run`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `VALIDATION_ERROR` (422) with `requiredTags` in `details`, on `experiments.from-template` | a tag the template requires is missing | add the listed tags to `tags` |
| `VALIDATION_ERROR` (422) with `violations` in `details`, on the launch | the follow-up overrides a key the template does not open, or lacks required tags | use an allowed key, add the tags, or have an admin open the key in the template |
| `VALIDATION_ERROR` (422), message names the winning run | `winningRunId` is not a run of this Experiment | pick a run from `training-runs.list` with this `experimentId` |
| `VALIDATION_ERROR` (422), message names the comparison group | the group belongs to another Experiment | create the group in the run's Experiment |
| `VALIDATION_ERROR` (422), "One or more training runs were not found" | a run id in `runIds` or in a diff does not exist | re-read the ids with `training-runs.list` |
| every `metricValue` is `null` | the metric name matches no series | take the exact name from `training-runs.chart-metrics` |
| `tooSmall` true | fewer than 3 `completed` runs carry the sweep id | wait for more members, or check they were created with `sweepDefinitionId` |
| `IDEMPOTENCY_KEY_IN_FLIGHT` or `IDEMPOTENCY_KEY_REUSED` (409) on conclude | the same key is still running, or was used with another body | wait and read the Experiment, or send the changed body with another key |
| `warning` not `null` after archive | runs of the archived Experiment are still active | tell the user the count; cancel them or let them finish |
| 403 | `training:launch` or `training:read` is missing | an organization admin grants it |

## Done when

- [ ] `experiments.get` shows the Experiment with the hypothesis the user agreed to.
- [ ] For a follow-up: `training-runs.diff` against its parent shows exactly one changed parameter.
- [ ] The comparison names the metric, the mode, the direction, the runs compared and the runs left out.
- [ ] For a conclusion: `experiments.get` shows `status` `completed` and `conclusion` with the summary, the decision and the winner the user confirmed.
- [ ] For an archive: `status` `archived`, and the user knows about every run still active.

## Next

- `model-release`: promote the winning run's Checkpoint to a Model.
- `evaluation-job`: evaluate the winner before it ships.
- `training-run`: change a template default the Experiment settled, or launch the next run.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| List, create | `rfabric experiment ls [--search <text>] [--tag <tag>]`, `rfabric experiment create --field name=<name> --field hypothesis=<text>` |
| From a template | `rfabric experiment-template ls`, `rfabric experiment from-template --template <template-id> --name <name> [--hypothesis <text>] [--tag <tag>]` |
| Follow-up run | `rfabric training run <template slug or id> --experiment <experiment-id> --config-overrides '{"chunkSize":20}' --tag evaluationJob=<job-id>` (a parent on a pipeline's image: add `--image <image> --code-version <commit>`) |
| Find follow-ups | `rfabric training-run ls -f experimentId=<experiment-id> -f tag=evaluationJob=<job-id>` |
| Diff two runs | `rfabric training-run diff --left <run-id> --right <run-id>` |
| Leaderboard | `rfabric experiment leaderboard <experiment-id> --metric <series> --mode final [--limit 500]` |
| Compare curves | `rfabric experiment compare <experiment-id> --run <run-id> --run <run-id>` |
| Group runs | `rfabric api post /api/experiments/<experiment-id>/comparison-groups --data '{"name":"baseline"}'`, `rfabric api post /api/training-orchestration/training-runs/<run-id>/assign-group --data '{"comparisonGroupId":"cmpg_..."}'` |
| Parallel coordinates | `rfabric api post /api/experiments/parallel-coordinates --data '{"runIds":["run_...","run_..."]}'` |
| Portfolio | `rfabric training-orchestration portfolio <workspace-id>` |
| Conclude | `rfabric experiment conclude <experiment-id> --outcome-summary "..." --decision "..." [--winning-run <run-id>] [--winning-model <model-id>]` |
| Archive | `rfabric experiment archive <experiment-id>` |
| Define a sweep | `rfabric api post /api/experiments/<experiment-id>/sweeps --data @sweep.json` |
