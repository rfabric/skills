---
name: evaluation-job
description: >-
  A verdict (pass, fail or inconclusive) on a checkpoint, model or artifact from an EvaluationJob, with its report, exports and comparisons. Use when asked to evaluate or benchmark a model, preflight or launch an evaluation by hand on a real robot or as replay, estimate its cost, follow its progress, read or export the report (HTML, JSON, JUnit, CSV), find why runs failed, compare a candidate with a baseline, reproduce a run, schedule recurring evaluations, or cancel one. Not for simulation launches (`simulation-suite`) or grading runs (`evaluation-grading`).
---

# Evaluation job

The user ends up with a verdict on one subject, backed by a report they can read, export and compare.

| Entity | Id | What it is |
| --- | --- | --- |
| EvaluationJob | `evj_...` | one evaluation of one subject (a Checkpoint, Model or Artifact) under one published EvaluationProtocol version |
| EvaluationRun | `evr_...` | one rollout of the job, with its events, evidence and score |
| EvaluationReport | `evrp_...` | the gated scorecard, built when the job turns terminal |
| EvaluationComparison | `evcm_...` | candidate jobs against a baseline job on one metric |
| EvaluationSchedule | `evsc_...` | a job template launched at a fixed interval |

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Choose protocol and subject | agent, user confirms | `evaluation-protocols.list`, `checkpoints.list`, `models.list`, `artifacts.list`, `dataset-versions.list` | the user's choice |
| 2 | Preflight and estimate | agent | `evaluation-jobs.preflight`, `evaluation-jobs.cost-estimate` | none |
| 3 | Launch | agent | `evaluation-jobs.create` | none |
| 4 | Follow the runs | agent; a person at the robot for by-hand runs; graders for human-graded runs | `evaluation-jobs.progress`, `evaluation-runs.list` | until the job is terminal: for replay at most runs x the protocol's `timeoutS`; for by-hand and human-graded runs, the time people take |
| 5 | Read the verdict | agent | `evaluation-jobs.get`, `evaluation-jobs.report` | none |
| 6 | Diagnose failures | agent | `evaluation-jobs.failure-breakdown`, `evaluation-jobs.failure-clusters`, `evaluation-jobs.diagnostics`, `evaluation-jobs.operations`, `evaluation-runs.list`, `evaluation-runs.metric-results`, `evaluation-runs.failures` | none |
| 7 | Export and re-score | agent | `evaluation-jobs.report-export`, `evaluation-reports.junit`, `evaluation-reports.reevaluate` | none |
| 8 | Compare | agent | `evaluation-comparisons.create` | none |
| 9 | Reproduce a run | agent | `evaluation-jobs.reproduce` | a one-run job |

Recurring evaluations and cancelling are sections of their own, below.

## Before you start

- **Permissions** (read them from `introspect.whoami`):

  | Action | Permission | Built-in roles |
  | --- | --- | --- |
  | Launch, reproduce, re-evaluate, schedule, close stuck runs, retry a run | `evaluationJob:launch` | `owner`, `admin`, `operator`, `member` |
  | Cancel a job | `evaluationJob:cancel` | `owner`, `admin`, `operator` |
  | Read compute attempts of a run | `compute:read` | `owner`, `admin`, `operator`, `member`, `auditor` |
  | Read results of a protocol whose `resultVisibility` is `restricted` | `evaluationDefinition:publish` | `owner`, `admin` |
  | Change evidence retention | `evaluationRetention:configure` | `owner`, `admin` |

  The `grader` role cannot use any job operation.
- **Needs**:
  - a published protocol: `evaluation-definitions`;
  - a subject: a Checkpoint (`training-run`), a Model in `candidate`, `evaluated`, `approved` or `deployed` (`model-release`), or an Artifact that is `ready` (`artifact-build`);
  - on a real robot: a person at the robot who runs the policy by hand and reports each run (`evaluation-grading`);
  - as replay: a DatasetVersion holding the episodes (`dataset-version`) and a compute pool that can run it (`compute-setup`).
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | What to evaluate | the subject | list the candidates; default: the one they named or the newest |
  | Against which protocol | fixes what passes | list published protocols; when none fits: `evaluation-definitions` |
  | How many runs | cost and confidence | default: the protocol's `maxRuns` |

## Steps

### 1. Choose protocol and subject

- `evaluation-protocols.list` with `query` `{"workspaceId": "wks_...", "status": "published"}`. Read `executionMode`, `gradingMode`, `rolloutPlan` (`minRuns`, `maxRuns`, `timeoutS`, `stoppingRule`), `protocolType` and `acceptanceGates`. Tell the user the gates in plain words: they are what "pass" will mean.
- The protocol's `executionMode` decides how the job launches:

  | `executionMode` | Launch | Consequence |
  | --- | --- | --- |
  | `real_robot` | by hand: send `executionMode` `"manual"` in step 3 | every run waits in `awaiting_execution` until a person runs the policy on the robot and reports what happened (`evaluation-grading`); the report names who executed each run |
  | `manual` | by hand; nothing to add | the same |
  | `replay` | send `episodeSelection` | scores recorded episodes, no robot; runs on compute, which is billed |
  | `simulation` | not here (`simulation_requires_suite`) | launch and follow it in `simulation-suite`, then come back at step 5 for the verdict |
- A `gradingMode` of `human` means every run waits for a grader after it executes. Name who will grade before launching (`evaluation-grading`).
- Subject: `checkpoints.list`, `models.list` or `artifacts.list` with `workspaceId`. Replay episodes: `dataset-versions.list`.
- Replay: choose the episodes with `episodeSelection`: `{"mode": "version", "datasetVersionId": "dsv_..."}`, the same with `mode` `filter` and a `filter` (`labels`, `type`, `review`), or `{"mode": "explicit", "episodeIds": [...]}`.

### 2. Preflight and estimate

- `evaluation-jobs.preflight` takes the body of step 3, changes nothing and returns `ok` and `blockers`, each with `code` and `message`. Fix every blocker before launching (Problems). It does not check container images; the launch does.
- `evaluation-jobs.cost-estimate` with `protocolId` (and `requestedRuns`, `baselineRuns`) returns `robotTimeS`, `workerTimeS`, `storageBytesEstimate` and `perRunTimeoutS`. It is an upper bound: runs x the per-run timeout. The times are `null` when the protocol has no `timeoutS`: say that no bound is known.

Then state the plan: runs, where, the time bound in hours (replay), and who must act: the person at the robot by name, and the graders.

### 3. Launch

`evaluation-jobs.create`:

```json
{
  "workspaceId": "wks_...",
  "protocolId": "evp_...",
  "subjectType": "checkpoint",
  "subjectId": "ckpt_...",
  "executionMode": "manual",
  "requestedRuns": 20,
  "idempotencyKey": "bench-pick-ckpt-2025-06-01"
}
```

- `executionMode` takes one value, `manual`. Send it for a `real_robot` protocol; leave it out for a `replay` or `manual` protocol.
- `requestedRuns` must lie within the protocol's `minRuns` and `maxRuns`.
- `baselineRuns` (with `baselineKind` `teleop_baseline` or `human_baseline`) adds runs a person performs as the reference. Only a human-graded protocol accepts them; the report keeps them apart from the subject's runs.
- `seed` fixes the scenario assignment. For a protocol with a scenario, two jobs with the same `seed` and run count run the same cases and compare as pairs (step 8). Runs of a protocol without a scenario have no case and never pair.
- `idempotencyKey` (8 to 200 characters): the same key with the same request returns the same job instead of launching twice.

Before the call say what starts: runs that wait for a person at the robot, or compute that is billed. The job comes back `queued` with its runs created; give the user its `appUrl`.

A by-hand job does not move by itself: continue with `evaluation-grading` (run each rollout, report it, grade it), then come back at step 5.

Several subjects under one protocol: `evaluation-jobs.subject-set` with `subjects` launches one job per subject with the same seed, linked by `subjectSetId`. One failing subject rejects the whole set unless `partialLaunch` is `true`.

### 4. Follow the runs

Poll `evaluation-jobs.progress` (every 30 seconds is enough) and report changes: `runsByStatus`, `primaryMetricEstimate` (the running value with its interval and `n`) and `projectedCompletionAt`.

| Run `status` | Tell the user |
| --- | --- |
| `pending` | waiting for compute |
| `awaiting_execution` | waiting for a person to run it at the robot: `evaluation-grading` |
| `running` | executing |
| `awaiting_review` | executed; waiting for a person to grade it: `evaluation-grading` |
| `completed`, `failed` | finished with a result |
| `aborted`, `timeout` | ended without a result |
| `skipped` | not needed (the stopping rule had enough evidence) or marked not executed |

- A run's result is its `outcome`, not its `status`: `success` or `failure`, `timeout`, `aborted`, `system_error` or `invalid` (it broke for infrastructure reasons), `skipped` (not needed, or not executed); `null` until the run has a result.
- Job `status`: `queued` -> `running` -> `completed`, `failed` or `cancelled`.
- A protocol with `stoppingRule` `confidence` or `sequential` can finish before all runs execute. Say so when it happens: it is not a failure.
- A job that waits on people has no time limit. After 15 minutes without a change, stop polling, say who it waits for (`runsByStatus`), and that `evaluation-jobs.get` picks it up later.
- One run: `evaluation-runs.list` with `jobId`, then `evaluation-runs.get`. Its timeline: `evaluation-runs.events` (page with `offset`), or live with `evaluation-runs.timeline-stream`. Its files: `evaluation-runs.evidence`, and `evaluation-runs.evidence-download-url` for a download URL valid until its `expiresAt`. Compute attempts of a replay run: `evaluation-runs.attempts`, logs with `compute-attempts.logs`.
- Let the list select runs; never filter pages in your own code. `query` keys beside `jobId`: `outcome` and `failureCategory` (one value, or `{"in": [...]}` for several), `stoppedAtStage`, `safetyPass`, `dimension` (step 6), `replaced` `false` (one run per slot: leaves out runs a retry replaced), `sort` `durationS:desc`. The unsuccessful runs: `{"jobId": "evj_...", "outcome": {"in": ["failure", "timeout", "aborted"]}, "replaced": false}`.

### 5. Read the verdict

When the job is terminal its `reportId` is set. `evaluation-jobs.report` returns the report. Tell the user, in this order:

| Field | Meaning |
| --- | --- |
| `conclusionStatus`, `conclusion` | `pass`, `fail` or `inconclusive`, with the reason |
| `gateResults` | per acceptance gate: its `expression`, the `actual` value, its `conclusion`, whether it is `blocking` |
| `primaryResult` | the primary metric with its confidence interval |
| `runCounts`, `population` | how many runs succeeded and failed; how many were `planned`, `executed`, `skipped`, `excluded`, `notExecuted` |
| `gateChain` | six checks in order (`manifest_integrity`, `case_completeness`, `evidence_validity`, `critical_invariants`, `acceptance_gates`, `statistical_requirements`), each `passed`, `failed`, `inconclusive` or `not_evaluated`, with `reasonCodes` |
| `operationalClassification` | `complete_pass`, `behavioral_failure`, `inconclusive`, `infrastructure_failure` or `cancelled` |
| `baselinePrimaryResult`, `baselineRunCounts` | the human baseline runs, reported apart |

- `inconclusive` means the evidence does not decide: a gate's interval straddles its threshold, or the job was cancelled (`RUN_CANCELLED`). It is treated as not passed everywhere. The fix is more runs, not a retry of the same count.
- Runs that broke for infrastructure reasons (`outcome` `system_error` or `invalid`) are left out of every number. The runs a report version counted: `evaluation-runs.list` with its `reportId`.
- Under a `restricted` protocol a reader without `evaluationDefinition:publish` gets only the conclusion fields.
- Under a protocol whose `reviewPolicy` is `blind`, job and run reads can return the subject fields as `null`. Keep the job id and the subject from the launch, and find jobs and runs by `protocolId` or `jobId`, not by `subjectType` or `subjectId`.

Say what a pass changed, because it happens without another call:

- Model subject: a `candidate` model becomes `evaluated`. Approval is a separate decision: `model-release`.
- `deployment_acceptance` protocol: the pending Deployments of the evaluated Artifact (or of the Artifacts of the evaluated Model) are approved, when the person who launched the job held `deployment:approve` at launch. The rollout's start gate asks for this passing report: `deployment-rollout`. A report that does not pass approves nothing.
- A test-run report (`testRun` `true`) changes nothing and is never evidence.

### 6. Diagnose failures

| Question | Operation |
| --- | --- |
| Which kinds of failure, which safety violations? | `evaluation-jobs.failure-breakdown` |
| Under which conditions do failures concentrate? (also while running) | `evaluation-jobs.failure-clusters`: per failure `category` and run `condition` (its sampled scenario variables and randomization axis values, key to value), the `failureCount` and the `runIds`. A cluster's runs: `evaluation-runs.list` with `jobId`, `failureCategory` its `category` and `dimension` its `condition` |
| Success by scenario condition? | `evaluation-jobs.scenario-slices` |
| What did rFabric notice by itself? | `evaluation-jobs.diagnostics`: notes with `severity`, `message` and the runs behind them |
| Where in a staged task do runs drop out? | `evaluation-jobs.stage-success`; the runs that stopped at a stage: `evaluation-runs.list` with `jobId` and `stoppedAtStage` the stage key. Each run reads the stage it stopped at as `stoppedAtStage` (`null` when it completed every stage or is outside the funnel) |
| How is a metric distributed? | `evaluation-jobs.violin-data`; keep a chart definition with `evaluation-report-views.create` |
| Was it the model or the infrastructure? | `evaluation-jobs.operations`: `retries`, `systemErrors`, `stuckClosures`, `workerReclaims` |
| Which runs to look at? | `evaluation-runs.list` with `jobId` and the filters of step 4: `safetyPass` `false` for the unsafe runs, `outcome` `timeout` for the runs that ran out of time |
| What happened in this run? | `evaluation-runs.get` (`outcome`, `stoppedAtStage`, `runScore`, `stageResults`); what was measured: `evaluation-runs.metric-results` (per metric `metricSlug`, `stageKey`, `value`, `unit`, `passStatus`); why it failed: `evaluation-runs.failures` (`stageKey`, `category`, `subtype`, `severity`, `role`, `description`); its events and evidence, `evaluation-runs.manifest` (`complete`, `missingFields`), `evaluation-runs.verdicts` |
| Row per run for a spreadsheet? | `evaluation-jobs.export-results` (`format` `csv` or `json`) |

`groupBy` and `splitBy` of `evaluation-jobs.stage-success` and `evaluation-jobs.violin-data` take run dimensions: `policy_version`, `subject_version`, `embodiment`, `robot_id`, `terminal_state`, `held_out` (the held-out conditions joined by `+`, else `nominal`), `baseline_side` (`baseline` or `candidate`), `cell_id`, `scenario_id`, or a key of the run's condition (a sampled scenario variable, else a randomization axis). A group's runs: `evaluation-runs.list` with `jobId` and `dimension` its `groupKey`, for example `{"baseline_side": "candidate", "lighting": "low"}`.

Give the user the two or three conditions that explain most failures, with a run to look at for each, not the raw tables.

Runs that do not move:

- **Past their timeout**: rFabric closes a run that is past the protocol's `timeoutS` without a final report as `timeout`. To do it now for one job: `evaluation-jobs.create-stuck-sweep-item` (returns `examined`, `closed`); for every job of a workspace: `evaluation-jobs.create-stuck-sweep` with `workspaceId`. A closed run is final: a late result is refused.
- **Repeat a run that compute executed** (replay or simulation, never a by-hand run): `evaluation-runs.retry` replaces a finished run with a fresh one in the same slot, under the same condition. The old run stays readable and links to its replacement; a completed job reopens and its report is rebuilt.
  - A run that broke for infrastructure reasons (`outcome` `system_error`) needs no flag.
  - Any other run needs `{"force": true}`: say first that this discards a valid result from every number of the job.

### 7. Export and re-score

| Want | Operation |
| --- | --- |
| A document to share | `evaluation-jobs.report-export` with `format` `html` |
| The report as data | `evaluation-jobs.report-export` with `format` `json` |
| Test results for a CI system | `evaluation-reports.junit` with the job's `reportId` |
| Every report of the job | `evaluation-jobs.reports`, one by id with `evaluation-reports.get` |
| The same runs judged by another published version of the protocol | `evaluation-reports.reevaluate` with that version's `protocolId` |

The exports return the document itself, not a link: save it to a file for the user and say where. A re-evaluation repeats no run: it builds a report with the next `reportVersion` and leaves the original unchanged.

Evidence does not stay forever: `evaluation-retention.list-budgets` shows, in days, how long evidence of successful, safety-clean runs of `smoke` and `regression` protocols is kept (`effective`). Evidence of failed runs, safety violations and `deployment_acceptance` runs is kept. `evaluation-retention.replace-budgets` sets a longer budget; one below the organization floor is refused.

### 8. Compare

- **Candidate against baseline**: `evaluation-comparisons.create` with `workspaceId`, `baselineJobId`, `candidateJobIds` and optionally `primaryMetric` (default: the protocol's). All jobs must have run under the same protocol version (the same `protocolId`); test runs are refused.
- Read `conclusion`: `status` is `candidate_better`, `baseline_better`, `no_clear_difference` or `inconclusive`, and `winner` is a subject id. Per candidate: `baselineValue`, `candidateValue`, `absoluteDelta`, its `ci`, `statisticallySignificant`, `practicallySignificant` and `regressions`: each with `kind` (`metric_regression`, `safety_regression`), `reason` and `runIds`, the candidate runs behind it (runs with a new safety violation, or the counted runs that did not succeed on a pass/fail metric; empty for a numeric metric). Give the user those runs to look at. `design` says whether the comparison is `paired`, with `pairingReason`: paired when both jobs ran exactly the same cases, each once, every run matched to the baseline run of the same case (`caseKey`). A run without a case (`caseKey` `null`: its protocol has no scenario) makes the comparison unpaired.
- **The standing baseline** of a protocol is the job to compare against by default: `evaluation-protocols.list-standing-baseline` (set it in `evaluation-definitions`).
- **Across evaluations**: `evaluation-protocols.trends` (one subject over time, `query` `workspaceId`, `subjectType`, `subjectId`, `metric`) and `evaluation-protocols.leaderboard` (subjects ranked under one protocol version, `query` `workspaceId`, `metric`, `protocolVersion`).
- Past comparisons: `evaluation-comparisons.list`, `evaluation-comparisons.get`.

### 9. Reproduce a run

`evaluation-jobs.reproduce` (the job id in `pathParameters`, `{"runId": "evr_..."}` as body) launches a new one-run job with the same protocol version, subject and seed, and returns the `job` and the `reproductionTuple`. Use it for a suspicious or failed run. A by-hand run reproduces by hand, and a replay run replays its own episode. Under a blind protocol a caller without an elevated role reads the `reproductionTuple` with the subject fields (`subjectType`, `subjectId`, `subjectVersion`, `sourceJobId`) null. The seed reproduces the conditions, not the exact motion of a physical robot. A simulation run is refused (`simulation_requires_suite`): launch its suite again in `simulation-suite`, with what the report's `reproductionCommand` names.

## Recurring evaluations

`evaluation-schedules.create` with `name`, `protocolId`, the subject, `intervalS` (60 or more) and optionally `startAt`, `requestedRuns`, `enabled`.

- A schedule runs the protocol as defined, without the by-hand override: use it for `replay` protocols and for protocols whose own `executionMode` is `manual`.
- Before the call say what recurs: every interval a job starts and uses compute, or waits for a person at the robot, until the schedule is disabled.
- Each occurrence is an ordinary job. It pins the newest published version of the protocol at launch, and runs with the launch permissions its creator had when the schedule was created.
- Without `startAt` the first occurrence is one interval from now. A schedule that fell behind launches once, not once per missed interval.
- Read `evaluation-schedules.get`: `nextRunAt`, `lastLaunchedAt`, `lastJobId`, and in `meta` the `lastError` of an occurrence that could not launch: `message`, `blockers` (each a `code` of Problems; empty when no preflight refused it) and `at`. The jobs it launched: `evaluation-jobs.list` with `scheduleId`.
- Pause with `evaluation-schedules.update` (`enabled` `false`), change `intervalS` or `nextRunAt` the same way, remove with `evaluation-schedules.delete`. `evaluation-schedules.run-due` with `workspaceId` launches every due schedule now; it returns `launched` (`scheduleId`, `jobId`) and `failed` (`scheduleId`, `error`, `blockers`).
- Simulation protocols cannot be scheduled here (`simulation_requires_suite`).

## Cancel

`evaluation-jobs.cancel`. Tell the user first: runs in flight are aborted and keep what they captured, finished runs stay readable, the job cannot be resumed, and its report concludes `inconclusive`. Cancelling a cancelled job again changes nothing; a job that already completed or failed answers 409.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `VALIDATION_ERROR` 422 with `blockers` in `details` | the launch preflight failed | handle each blocker below; nothing was created |
| `protocol_not_found`, `protocol_not_published` | the protocol is not visible to the workspace, or is a draft or deprecated | pick a published version, or publish (`evaluation-definitions`) |
| `subject_type_mismatch`, `subject_not_found`, `subject_not_evaluable` | the id does not match `subjectType`, names nothing, or the subject's state does not allow evaluation | correct the id; for a Model or Artifact fix its state (`model-release`, `artifact-build`) |
| `requested_runs_out_of_bounds` | `requestedRuns` is outside `minRuns` to `maxRuns` | change the count, or publish another protocol version |
| `target_unresolved` | a `real_robot` protocol was launched without the by-hand override | send `executionMode` `"manual"` |
| `permission_denied` | the launch permission is missing; the message names it | an organization admin grants it |
| `replay_selection_missing`, `replay_selection_empty`, `replay_selection_invalid` | a replay protocol without episodes, a selection that matches none, or a selection on a protocol that is not replay | fix `episodeSelection` |
| `baseline_not_supported` | `baselineRuns` on a protocol that is not human-graded | drop them |
| `worker_pool_not_found`, `worker_pool_not_accessible`, `worker_pool_not_capable`, `no_matching_worker` | the compute pool the job names cannot run replay | `compute-setup` |
| `container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch`, or `UPSTREAM_ERROR` 502 | a pool cannot pull an image of the subject, or the registry did not answer | `compute-setup`; on 502 try again later |
| `simulation_requires_suite` 422 | the protocol runs in simulation | `simulation-suite` |
| `idempotency_conflict` 409 | the key was used with a different request | use a fresh key |
| `evaluation_job_not_terminal` 409 | report asked before the job ended; `details` has `jobId`, `status` | follow the job (step 4) |
| `FORBIDDEN` 403 with `evaluationJobId` in `details` | the protocol's results are restricted | someone with `evaluationDefinition:publish` reads them |
| 409 on `evaluation-runs.retry`, `reason` `retry_requires_force`, `already_retried` or `run_not_terminal` in `details` | a valid result needs `force`; the run was replaced before; the run has not ended | decide with the user (step 6) |
| `BAD_REQUEST` 400 "takes one value, without an operator" on `evaluation-runs.list` | `stoppedAtStage`, `safetyPass`, `reportId` or `replaced` was sent as `{"in": [...]}` or with another operator | send one value |
| `FORBIDDEN` 403 "Filtering by subject identity" on `evaluation-runs.list` | `subjectId`, `subjectType` or a `policy_version` / `subject_version` dimension without an elevated role | select by `jobId` or `protocolId` |
| Job stays `running`, runs in `awaiting_execution` or `awaiting_review` | it waits for people | `evaluation-grading`; tell the user who |

## Done when

- [ ] `evaluation-jobs.get` shows a terminal `status` and a `reportId`.
- [ ] The user has the conclusion, each gate's result and the primary metric with its interval, from `evaluation-jobs.report`.
- [ ] For a `fail` or `inconclusive`: the user has the main failure conditions (step 6) and a next step.
- [ ] Anything asked for exists: the exported file, the comparison (`evaluation-comparisons.get`), the schedule (`evaluation-schedules.get` with `enabled` and `nextRunAt`).
- [ ] The user knows what the verdict changed on the model or deployment, or that it changed nothing.

## Next

- `evaluation-grading`: run by-hand rollouts at the robot and report them; grade runs that wait for a person.
- `model-release`: approve a model that passed. A promotion gate (`policy-automation`) asks for the same passing verdict.
- `deployment-rollout`: roll out an artifact whose acceptance evaluation passed.
- `experiment`: after a failure, train a follow-up with one change and evaluate it against this job.
- `robot-recording`: record more data for the conditions that failed.
- `evaluation-definitions` and `simulation-suite`: turn a failure condition into a scenario so it is tested every time.
- `ci-integration`: gate a pipeline on the verdict.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Preflight | `rfabric eval run --protocol <id or slug> --subject-type <type> --subject <id> --preflight` |
| Cost estimate | `rfabric evaluation-job cost-estimate --protocol <protocol-id> [--runs <n>]` |
| Launch | `rfabric eval run --protocol <id or slug> --subject-type <type> --subject <id> [--execution manual] [--episodes-version <dsv-id>] [--runs <n>] [--wait]` |
| Retry a run | `rfabric evaluation-run retry <run-id> [--force]` |
| Follow | `rfabric eval follow <job-id>`, `rfabric evaluation-job progress <job-id>` |
| Report; exits non-zero unless `pass` | `rfabric eval report <job-id> [--format junit]`, `rfabric eval gate <job-id>` |
| Infrastructure view, stuck runs | `rfabric evaluation-job operations <job-id>`, `rfabric evaluation-job stuck-sweep <job-id>` |
| Evidence | `rfabric evaluation-run evidence <run-id>`, `rfabric evaluation-run evidence-download <run-id> <evidence-id> <file>` |
| Select runs | `rfabric evaluation-run ls -f jobId=<job-id> [--outcome <outcome>]... [--failure-category <category>]... [--stopped-at-stage <stage key>] [--safety-pass[=false]] [--dimension <name>=<value>]... [--report <report-id>] [--replaced[=false]] [--sort durationS:desc]` |
| One run's measurements, failures | `rfabric evaluation-run metric-results <run-id>`, `rfabric evaluation-run failures <run-id>` |
| Compare | `rfabric eval compare --baseline <job-id> --candidate <job-id> [--primary-metric <slug>]` |
| Re-evaluate | `rfabric eval reevaluate <job-id> --protocol-version <n>` |
| Reproduce | `rfabric evaluation-job reproduce <job-id> <run-id>` |
| Schedules | `rfabric evaluation-schedule ls`, `rfabric evaluation-schedule run-due`, `rfabric evaluation-job ls --schedule <schedule-id>` |
| Cancel | `rfabric evaluation-job cancel <job-id>` |
