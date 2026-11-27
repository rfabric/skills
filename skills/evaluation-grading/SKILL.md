---
name: evaluation-grading
description: >-
  Evaluation runs executed and judged by a person - each by-hand rollout set up, run at the robot and recorded, and each run in the review queue given a verdict against its criteria. Use when asked to run an evaluation by hand at the robot (manual execution), confirm setup, record a rollout, mark a run not executed, grade or review evaluation runs, work the review queue, claim or release a run, adjudicate a disagreement, or read grader agreement. Not for launching an evaluation or reading its report (`evaluation-job`).
---

# Evaluation grading and by-hand runs

The user ends up with evaluation runs that carry a person's record: what happened at the robot, and a verdict the report can count.

| Entity | Id | What it is |
| --- | --- | --- |
| EvaluationRun | `evr_...` | one rollout of an EvaluationJob (`evj_...`); `awaiting_execution` means a person must run it, `awaiting_review` means a person must grade it |
| EvaluationEvidence | `evd_...` | a recording or file of a run |
| EvaluationVerdict | `evv_...` | one person's structured judgment of one run, kept for good |

Three rules above all others here:

- **The person who watched decides.** The outcome, the measurements and the verdict come from the person who saw the rollout or its evidence. You prepare, ask, read back and record. Never fill in an outcome, a stage or a safety call the user did not give.
- **Records carry the signed-in user's name.** A setup confirmation, an execution record and a verdict are stored as made by the user you work for. Record them only for the user who was there.
- **Records are final.** None of them can be edited. Read each one back and get a yes before the call.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

Run rollouts by hand (steps 1 to 4), grade runs from their evidence (steps 5 to 8), lead a grading team (step 9).

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | List the runs that wait for a person at the robot | agent | `evaluation-runs.list`, `evaluation-jobs.get`, `evaluation-protocols.get` | none |
| 2 | Set up the scene; record the confirmation | user, at the robot; agent records | `evaluation-runs.setup-confirmation` | the user |
| 3 | Run the policy once and watch | user, at the robot | none | one rollout, at most the protocol's `timeoutS` |
| 4 | Record the execution, and the verdict of the person who watched | agent | `evaluation-runs.execution` or `evaluation-runs.not-executed`; `evaluation-runs.grade` | none |
| 5 | Read the review queue and claim a run | agent | `evaluation-runs.queue-stats`, `evaluation-runs.list`, `evaluation-runs.claim` | none |
| 6 | Read what to judge | agent | `evaluation-runs.grading-context`, `evaluation-criteria.get` | none |
| 7 | Watch the evidence | user | `evaluation-runs.evidence-download-url` | the user |
| 8 | Record the verdict | agent | `evaluation-runs.grade` | none |
| 9 | Check agreement and the queue | agent | `evaluation-jobs.grading-summary`, `evaluation-runs.queue-stats` | none |

## Before you start

- **Permissions** (read them from `introspect.whoami`):

  | Action | Permission | Built-in roles |
  | --- | --- | --- |
  | Confirm setup, record an execution, mark not executed | `evaluationJob:launch` | `owner`, `admin`, `operator`, `member` |
  | Claim, release, grade | `evaluationReview:grade` | `owner`, `admin`, `operator`, `member`, `grader` |
  | Adjudicate a disagreement | `evaluationReview:adjudicate` | `owner`, `admin` |

  A `grader` works on runs only: job operations, the grading summary included, answer 403. Runs of a protocol whose `resultVisibility` is `restricted` are closed to everyone without `evaluationDefinition:publish`.
- **Needs**: an EvaluationJob with runs in `awaiting_execution` (launched by hand) or `awaiting_review` (a human-graded protocol, or a `real_robot` run served remotely): `evaluation-job`. At the robot, for by-hand runs: the robot, the policy to run, and the user in person.
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | Which job or protocol to work on | narrows the queue | default: the oldest waiting run of the workspace |
  | By-hand runs: are you the person at the robot? | records are stored under the signed-in user's name | yes: steps 1 to 4. No: hand over (below) |

When the user is not the person at the robot, that person does the work signed in as themselves. Hand the user this block to pass on, with one link per run from step 1:

```text
Your turn - the person at the robot, rFabric app
Why: each rollout is recorded and graded under the name of the person who ran and watched it.
Who: a member who may launch evaluation jobs (owner, admin, operator or member).

1. Open the next run: https://app.rfabric.io/open/<run id>
2. Do the steps under "Set up", then choose "Confirm setup".
3. Run the policy once on the robot, and watch it.
4. Fill in "Record execution" and choose "Record execution". For a human-graded protocol, grade this run right after: open https://app.rfabric.io/<organization slug>/<workspace slug>/evaluations/review/<run id>, answer, choose "Submit and next", then stop: the run it opens next is not one you watched.

Bring back: tell me when the runs are recorded.
Then I: check that no run awaits execution, and read the report.
```

## Steps

### 1. List the runs that wait at the robot

- `evaluation-runs.list` with `query` `{"jobId": "evj_...", "status": "awaiting_execution", "sort": "createdAt:asc"}`, or `workspaceId` in place of `jobId` for every job. Read all pages; work in `seq` order.
- Per run read `seq`, `setupInstructions` (the steps before the rollout) and `environmentInstance`: its `sampledVariables` and `axes` are the condition drawn for this run, `tier` its difficulty tier.
- From `evaluation-jobs.get`: the subject to run (`subjectType`, `subjectId`, `subjectVersion`). From `evaluation-protocols.get` with the job's `protocolId`: `gradingMode`, `rolloutPlan` (`timeoutS`), `metricRefs`, `criteriaId`.
- What the person must bring back depends on `gradingMode`:

  | `gradingMode` | The record needs | After the record |
  | --- | --- | --- |
  | `human` | the outcome; values for the metrics a person records; the verdict answers (step 3) | the run is `awaiting_review`; the person who watched grades it at once (step 4) |
  | `scripted` | the outcome and `state`: the facts the criteria expressions read | rFabric computes the verdict from `state`; the stated outcome is kept as a claim only |
  | `hybrid` | either of the above | with `state`: scored; without: `awaiting_review` |
  | `simulator_oracle`, `learned_evaluator` | - | cannot be executed by hand (409) |

- Metrics a person records: `evaluation-metrics.get` for each entry of `metricRefs`; keep those whose `source` has `type` `human`, with `name`, `unit` and `valueConstraints`.
- Facts for `state`: `evaluation-criteria.get`; the `state.<path>` names in `goalPredicates`, `failurePredicates`, `safetyConstraints` and the stage conditions are the questions to ask. Its `stages` and `failureCategories` are the verdict's vocabulary.

Tell the user how many runs wait, the per-run time limit, and what you will ask after each rollout.

### 2. Your turn: set up the scene

One block per run, filled in from that run:

```text
Your turn - at the robot, run 7 of 20 (evr_...)
Why: each run starts from the condition drawn for it, so the runs can be compared.
Who: you, in person at the robot.

Condition for this run: orientation = +45, placement = L
1. Place the object at the orientation and position shown above.
2. Move the arm to its home pose.
3. Check that nobody is inside the robot's reach and the emergency stop is at hand.

Bring back: "set up", and anything you had to do differently.
Then I: record your setup confirmation under your name, with the time. It cannot be changed afterwards.
```

The numbered lines are the `text` of the run's `setupInstructions`, in order, followed by the safety check; the condition line is its `sampledVariables` and `axes`. A run without setup instructions needs only the condition and the safety check, and no confirmation call.

Then `evaluation-runs.setup-confirmation` with body `{"notes": "..."}` (what differed, or empty). A run with setup instructions refuses an execution record until this is done. The first confirmation is the one kept. Done when `evaluation-runs.get` shows `setupConfirmation` with `confirmedBy` and `confirmedAt`.

### 3. Your turn: run the policy once

```text
Your turn - at the robot, run 7 of 20 (evr_...)
Why: rFabric does not start the policy on a by-hand run. You run it and watch; I record what you saw.
Who: you, in person at the robot.

1. Start one rollout of checkpoint ckpt_... (training step 40000) with the software you use to run a policy on this robot.
2. Watch it until the task ends. Stop it yourself after 600 seconds, or at once if it becomes unsafe.
3. Stop the policy.

Bring back:
- outcome: success, failure, aborted (you stopped it) or timeout
- starting hand: left or right
- start and end time, and a note if anything was unusual
- how far it got: the last completed stage (grasp, place), or "none"
- safe: yes or no
- if it failed: what went wrong (manipulation, perception, control or planning) and how severe (low, medium, high, critical)
Then I: read the record back to you and save it once you confirm. It cannot be corrected afterwards.
```

- Fill in the subject from the job and the limit from `timeoutS`.
- "Bring back": one line per metric a person records and per `state` fact (step 1). The last three lines are the verdict answers: include them for a `human` protocol, and for a `hybrid` one recorded without `state`; take stages and categories from the criteria.
- The weights of a Checkpoint: `checkpoints.download-url` returns download URLs. For a LeRobot policy the command that runs it on a robot is `lerobot-rollout` (https://huggingface.co/docs/lerobot/inference), with the ports and cameras used when the data was recorded.
- The user sets the pace. Do not poll while they work.

### 4. Record the execution

`evaluation-runs.execution`:

```json
{
  "outcome": "failure",
  "measurements": [
    { "metricId": "evm_...", "metricVersion": 1, "scopeType": "run", "value": { "raw": "left", "normalized": null } }
  ],
  "notes": "dropped the object on the second attempt",
  "startedAt": "2025-06-01T10:02:00Z",
  "endedAt": "2025-06-01T10:04:30Z"
}
```

- `outcome` is `success`, `failure`, `aborted` or `timeout`. `aborted` and `timeout` end the run without a result.
- `state` is an object with the facts from step 1, for example `{"object_placed": false}`. A `scripted` protocol refuses `success` or `failure` without it. With the author permission you can check what the criteria conclude from it first: `evaluation-expressions.test` (`evaluation-definitions`).
- `measurements`: `scopeType` is the metric's `scope`; `normalized` is the value as a number (1 or 0 for yes or no), else `null`. A `scripted` protocol refuses them: report `state` instead.
- `notes` is free text kept on the run: what was unusual, and where the person's own recording of the rollout is, if they made one.
- The run moves on at once: `completed` or `failed` (scored), `aborted` or `timeout`, or `awaiting_review`. Report which, with its `outcome`; for a scored run add what rFabric measured (`evaluation-runs.metric-results`) and the failures it found (`evaluation-runs.failures`).

**Grade it now, with the person who watched.** A by-hand run that turned `awaiting_review` has no recording in rFabric to judge from: only someone who watched the rollout can grade it. With the user who watched, right after the record: `evaluation-runs.claim`, read the verdict back, `evaluation-runs.grade` (body as in step 8, from the answers of step 3). When `requiredVerdicts` of the run is above 1, that many people must have watched; each grades signed in as themselves.

**The rollout did not happen** (robot down, object missing): `evaluation-runs.not-executed` with `{"reason": "..."}`. The run closes `skipped` with `terminalState` `not_executed`, and the report counts it apart from failures. It cannot be reopened: use it only when the user gives up on that run.

Done when no run of the job is `awaiting_execution` (`evaluation-jobs.progress`, `runsByStatus`), and every by-hand run the user watched is graded. Then `evaluation-job` reads the report.

### 5. Read the review queue and claim a run

For runs that have evidence to judge from (replay or simulation runs of a human-graded protocol), and `real_robot` runs served remotely: every one of those waits here. Beside its evidence, such a run's room recording is on the robot's session (`interactive-media-sessions.recording-url`); not under a blind protocol, since the session names the Artifact.

- `evaluation-runs.queue-stats` with `workspaceId`: `queueDepth` (runs waiting), `claimedDepth`, `agingCount` (waiting longer than `agingThresholdHours`).
- The queue, oldest first: `evaluation-runs.list` with `query` `{"workspaceId": "wks_...", "status": "awaiting_review", "sort": "createdAt:asc"}`. Narrow with `protocolId`, `scenarioId` or `jobId`. A row with `claimedBy` set is someone else's.
- `evaluation-runs.claim` reserves the run for the user so two people do not judge the same one unknowingly. `evaluation-runs.release` gives it back: release every claimed run the user does not finish.
- Tell the user how many runs wait and which one is next.

### 6. Read what to judge

`evaluation-runs.grading-context`:

| Field | Use |
| --- | --- |
| `definitionOfDone` | `criterionName`, `criterionDescription`, `scenarioDescription`, `safetyConstraintCount`: what success means |
| `evidence` | the files to look at: `id`, `type`, `format`, `sizeBytes`, `timeRange`. Empty: a by-hand run; the user grades it only if they watched it (step 4), else release it |
| `blind` | `true`: the subject, the job and other graders' verdicts are withheld (`subject`, `jobId`, `peerVerdicts` are `null`) |
| `requiredVerdicts`, `verdictsSoFar` | how many independent verdicts the run needs, and has |
| `needsAdjudication` | `true`: graders disagreed; the next verdict decides (step 8) |

- Stages and failure categories are not in the context. Read them from the criteria: `evaluation-protocols.get` with the run's `protocolId`, then `evaluation-criteria.get` with its `criteriaId`: `stages` (`stageKey`, `order`, `name`), `failureCategories`, `safetyConstraints`.
- Under a blind protocol do not look for the subject and do not tell the user which model it is, even when you know. Blinding is there to keep the judgment unbiased.
- The run's `environmentInstance` and `setupInstructions` say which condition it ran under.

### 7. Your turn: watch the evidence

```text
Your turn - watch run evr_... (video, 2 min 30 s)
Why: the verdict is your judgment against the criteria; I record it under your name.

Open: https://app.rfabric.io/open/evr_...
Judge against: Pick and place - the object ends in the tray, upright.
Stages, in order: grasp (Grasped object), place (Placed object)

Bring back:
- how far it got: the last completed stage, or "none"
- safe: yes or no
- if it failed: what went wrong (manipulation, perception, control or planning) and how severe (low, medium, high, critical)
- how sure you are (0 to 1), and a note
Then I: read the verdict back to you and record it once you confirm. It cannot be changed afterwards.
```

- To hand over a file in place of the link: `evaluation-runs.evidence-download-url` (`pathParameters` `id`, `evidenceId`) returns a `url` valid for 15 minutes (`expiresAt`); download it as `rfabric-basics` describes and say where it is. Give the size first for a large file. Each download is recorded in the audit log.
- The categories offered are the criteria's `failureCategories`; the stages are its `stages` in `order`. For a criteria without stages ask only: success or failure.

### 8. Record the verdict

`evaluation-runs.grade`:

```json
{
  "success": false,
  "safetyPass": true,
  "lastCompletedStage": "grasp",
  "confidence": 0.9,
  "notes": "dropped the object on the second attempt",
  "failures": [{ "category": "manipulation", "severity": "medium", "description": "grip slipped" }]
}
```

- `success` and `safetyPass` are always sent.
- Staged criteria, one of two forms, never both:
  - `lastCompletedStage`: a `stageKey`, or `null` for "completed no stage". rFabric derives every stage result from it. `success` `true` requires the final stage.
  - `stages`: one `{"stageKey", "status", "quality"}` per declared stage, `status` `completed`, `failed` or `skipped`, `quality` `neat` or `sloppy` on a completed stage only. `success` `true` requires every stage `completed`.
- Criteria without stages: send neither.
- `failures[].category` must be one the criteria declares.
- `metrics` carries values for metrics a person records, shaped like the measurements of step 4.

Then read the run in the response:

| Run `status` | Tell the user |
| --- | --- |
| `completed` or `failed` | the verdict is final, the run left the queue and counts in the job's report |
| `awaiting_review` | the verdict is recorded; the run needs more independent verdicts, or the graders disagreed and it waits for adjudication (read step 6 again) |

**Adjudication.** When `needsAdjudication` is `true` the next verdict is binding and ends the run. It is the same call, but needs `evaluationReview:adjudicate`, and the adjudicator must not be one of the run's graders. All verdicts stay on record: `evaluation-runs.verdicts`.

Done when `evaluation-runs.queue-stats` shows the queue the user worked on empty, or you reported how many runs remain and who can grade them.

### 9. Check agreement and the queue

For whoever leads the grading:

- `evaluation-jobs.grading-summary`: `graderCount`, `doubleGradedRuns`, `agreementRate`, `kappa` (agreement corrected for chance), `perGraderAgreement` and `adjudicatedRuns`. Low agreement means the criteria read differently to different people: tighten their wording (`evaluation-definitions`).
- `evaluation-runs.queue-stats`: `agingCount` is the number of runs that waited longer than their protocol's `agingThresholdHours`. List them oldest first (step 5) and name who can grade them.
- Who did what, when: `evaluation-runs.verdicts` (under a blind protocol a grader sees only their own verdict until the run is final) and `evaluation-runs.transitions`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `CONFLICT` 409, `reason` `setup_confirmation_required` in `details` | the run has setup instructions and no confirmation | step 2, then record again |
| `CONFLICT` 409 "not 'awaiting_execution'" or "executes in ... mode" | the run was already recorded, skipped or stopped, or compute executes it | read the run; a record cannot be repeated |
| `VALIDATION_ERROR` 422 "must carry the observed final state" | a `scripted` protocol needs `state` | ask for the facts (step 1), send `state` |
| `CONFLICT` 409 "does not admit human-recorded measurements" | the protocol's grading mode takes no values from a person | drop `measurements`, send `state` |
| `CONFLICT` 409 on claim: "already claimed by" | someone else has the run | take the next one |
| `CONFLICT` 409 on grade: "not 'awaiting_review'" | the run is not in the queue (already final, or not executed yet) | refresh the queue |
| `CONFLICT` 409 "has already submitted" | the user already judged this run in that role | take the next one; a verdict is not replaced |
| `CONFLICT` 409 on grade naming a stage, `lastCompletedStage` or a failure category | unknown stage key, both stage forms sent, stages sent for criteria without stages, `success` `true` without full completion, or a category the criteria does not declare | fix the body from the criteria's `stages` and `failureCategories` |
| `CONFLICT` 409 "cannot also adjudicate" | the user graded this run and may not break its tie | someone else with `evaluationReview:adjudicate` decides |
| `FORBIDDEN` 403 with `reason` `gate_policy`, or `CONFLICT` 409 with `reason` `approvals_pending`, in `details` | a rule of the organization on grading refused the call; no verdict was recorded | tell the user the message; an organization admin reviews the rule |
| `FORBIDDEN` 403 with `evaluationJobId` in `details` | the protocol's results are restricted | someone with `evaluationDefinition:publish` works these runs |
| 403 right after a permission was granted | a grant reaches a person with their next access token, at most 15 minutes later (`member-access`) | wait, then try once more |

## Done when

- [ ] By hand: `evaluation-jobs.progress` shows no run in `awaiting_execution`, every record was read back to the user before the call, and every run the user watched is graded.
- [ ] Grading: every run the user judged reads `completed` or `failed` in `evaluation-runs.get`, or you reported which runs still wait and for whom.
- [ ] No run is left claimed by the user unintentionally: `evaluation-runs.list` with `claimedBy` set to their user id and `status` `awaiting_review` is empty.
- [ ] The user knows how many runs remain in the queue (`evaluation-runs.queue-stats`).

## Next

- `evaluation-job`: read the job's report once its last run is final, compare, export; repeat a run that compute executed.
- `evaluation-definitions`: sharpen criteria, stages or the review policy when graders disagree.

## The rfabric CLI

Setup confirmation, the execution record and "not executed" have no dedicated command.

| Step | CLI |
| --- | --- |
| Review queue | `rfabric eval queue [--protocol <protocol-id>] [--scenario <scenario-id>]` |
| Claim, release | `rfabric eval claim <run-id>`, `rfabric eval release <run-id>` |
| Evidence, measurements, failures | `rfabric evaluation-run evidence <run-id>`, `rfabric evaluation-run evidence-download <run-id> <evidence-id> <file>`, `rfabric evaluation-run metric-results <run-id>`, `rfabric evaluation-run failures <run-id>` |
| Verdict | `rfabric eval grade <run-id> [--success] [--safe] [--last-completed-stage <stageKey or none>] [--confidence <0-1>] [--notes <text>] [--failure <category>:<severity>:<description>]` |
| Grading summary | `rfabric eval grading-summary <job-id>` |
