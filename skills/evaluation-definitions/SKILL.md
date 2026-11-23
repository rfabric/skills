---
name: evaluation-definitions
description: >-
  Published, immutable evaluation definitions (metrics, criteria, a scenario and a protocol) that fix what an evaluation measures and what passes. Use when asked to create, clone, edit, version, publish or deprecate an evaluation metric, criteria, scenario or protocol, write or test a grading expression (CEL), set run counts or acceptance gates, keep definitions as files in a repository (preview, apply, export), test-run a draft, share a definition with the organization, or set a standing baseline. Not for simulation scenarios and suites (`simulation-suite`) or launching an evaluation (`evaluation-job`).
---

# Evaluation definitions

The user ends up with a published EvaluationProtocol version that an evaluation can run, with everything it pins:

| Entity | Id | What it is |
| --- | --- | --- |
| EvaluationMetric | `evm_...` | one measured quantity (a column of the scorecard) |
| EvaluationCriteria | `evc_...` | what counts as success, failure and a safety violation for one run; optional ordered stages |
| EvaluationScenario | `evs_...` | the conditions runs are sampled over, and the setup steps a person does before a run. A scenario that runs in simulation is written in `simulation-suite` |
| EvaluationProtocol | `evp_...` | the runnable composition: one criteria version, an optional scenario version, metric versions, how runs execute and are graded, how many runs, and the acceptance gates |

Every definition is a version of a `slug` with `status` `draft` (editable), `published` (frozen) or `deprecated` (retired). An id names one version.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Find a starting point | agent | `evaluation-protocols.list`, `evaluation-metrics.list`, `evaluation-criteria.list`, `evaluation-scenarios.list` | none |
| 2 | Agree the design | user, in this conversation | none | the user's answers |
| 3 | Create the drafts | agent | `evaluation-protocols.clone`, or `evaluation-metrics.create`, `evaluation-criteria.create`, `evaluation-scenarios.create`, `evaluation-protocols.create` | none |
| 4 | Test the expressions | agent | `evaluation-expressions.test` | none |
| 5 | Size the run count | agent | `evaluation-library.sample-size-guidance` | none |
| 6 | Test-run the protocol draft | agent | `evaluation-protocols.test-run` | the test-run job reaching a terminal status |
| 7 | Publish | agent | `evaluation-metrics.publish`, `evaluation-criteria.publish`, `evaluation-scenarios.publish`, `evaluation-protocols.publish` | none |
| 8 | Maintain, share, set a baseline | agent | see steps 8 to 10 | none |

Definitions kept as files in the user's repository follow another path: read [definition-directory.md](definition-directory.md) in this skill's directory.

## Before you start

- **Permissions** (read them from `introspect.whoami`):

  | Action | Permission | Built-in roles |
  | --- | --- | --- |
  | Create, edit, clone, new version, delete a draft, test expressions, set a standing baseline | `evaluationDefinition:author` | `owner`, `admin`, `operator` |
  | Publish, deprecate | `evaluationDefinition:publish` | `owner`, `admin` |
  | Share with the organization | `evaluationDefinition:promoteToOrg` | `owner`, `admin` |
  | Test-run a draft | `evaluationJob:launch` | `owner`, `admin`, `operator`, `member` |

  An `operator` can prepare every draft but cannot publish. Say so in the plan and name who publishes. A workspace can also restrict who publishes a `safety` criteria or a `safety` protocol to the roles in its setting `evaluation.safetyPublishRoles`.
- **Needs**: a Workspace (`workspace-setup`). For a test run: a subject to evaluate, a Checkpoint (`training-run`), Model (`model-release`) or Artifact (`artifact-build`). For a protocol that runs in simulation: its scenario, cells and suite (`simulation-suite`).
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | The task, and what a successful run looks like | becomes the criteria | their words; propose predicates and stages back |
  | What must hold for the evaluation to pass | becomes the acceptance gates | default: success rate of the primary metric at or above a value they name |
  | Where runs execute and who grades | fixes `executionMode` and `gradingMode` | Decisions, below |
  | How sure they need to be | fixes the run count | step 5 |

## Decisions

**Route**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Registry: drafts created through operations (recommended to start) | a few definitions, edited in conversation or in the app | each definition is published on its own, in dependency order |
| Definition directory: files in the user's repository | the team reviews changes in pull requests, or a pipeline publishes | the whole directory is applied at once; once a pipeline applies it, those slugs change only through the files (`definition_repository_managed`) |

**What the protocol fixes** (frozen at publish; a change means another version)

| Field | Options | Consequence |
| --- | --- | --- |
| `executionMode` | `real_robot`, `manual`, `replay`, `simulation` | `real_robot` and `manual`: a person runs each rollout on a physical robot and records it (`evaluation-job` launches both by hand, `evaluation-grading` records the runs); `replay` scores recorded episodes of a dataset version on compute; `simulation` launches only through a suite (`simulation-suite`) and needs `seeds` in `rolloutPlan` |
| `gradingMode` | `scripted`, `human`, `simulator_oracle`, `hybrid` | `scripted` grades from the recorded state with the criteria expressions (for a by-hand run: from the facts the person reports); `simulator_oracle` grades in simulation; `human` parks every run until a person grades it (`evaluation-grading`); `hybrid` accepts both |
| `protocolType` | one of ten, `smoke` to `deployment_acceptance` | `deployment_acceptance` is the gating type: a rollout's start gate asks for its passing report by default, and that report can approve a pending deployment (`deployment-rollout`); `smoke` and `regression` evidence expires under the retention budget |
| `resultVisibility` | `workspace` (default), `restricted` | `restricted`: only holders of `evaluationDefinition:publish` read runs, evidence and scores; everyone else sees the conclusion only |
| `reviewPolicy` | `blind`, `redundancy`, `redundancySamplePct`, `disagreementTolerance`, `agingThresholdHours` | human grading only: hide the subject from graders, ask several graders per run, send disagreements to an adjudicator |

## Steps

### 1. Find a starting point

List each kind with `query` `{"workspaceId": "wks_..."}`. The lists return the workspace's own definitions and the standard library together:

- Standard library rows have `isSystemManaged` `true` and `workspaceId` `null`. Protocols: one `standard-<type>` per `protocolType`, and robot starters tagged in `meta` (`robotTypes`, `starterTemplate`). Metrics such as `task_success` and `progress_score` are there too: pin them, do not redefine them.
- Library rows are read-only (edit, new version, deprecate: `FORBIDDEN` 403). Clone to change one.
- A row whose `ci` is not `null` is managed from a repository: change it through its files ([definition-directory.md](definition-directory.md)).

Tell the user what exists and what you propose to start from.

### 2. Agree the design

Put the choices of Decisions and the open inputs of "Ask the user" to the user in one message, each with the default you would take from the starting point. Then state the plan: which definitions you will create or clone, who publishes, and whether a test run comes before publish.

### 3. Create the drafts

**Clone** `evaluation-protocols.clone` with body `{"workspaceId": "wks_..."}` returns a draft protocol in the workspace. It also copies the protocol's criteria, scenario and metrics into the workspace, with the same slug, version and status, and points the draft at the copies. To change a copied criteria, scenario or metric: create a draft version of the copy (step 8), edit it, then set the protocol draft's `criteriaId` and `criteriaVersion` (or `scenarioId` and `scenarioVersion`, or `metricRefs`) to it with `evaluation-protocols.update`.

**Create** in dependency order: metrics, criteria, scenario, protocol. Every create needs `workspaceId`. A protocol body:

```json
{
  "workspaceId": "wks_...",
  "slug": "bench-pick",
  "name": "Bench pick and place",
  "protocolType": "capability",
  "targetType": "task",
  "criteriaId": "evc_...",
  "criteriaVersion": 1,
  "scenarioId": "evs_...",
  "scenarioVersion": 1,
  "metricRefs": [{ "metricId": "evm_...", "metricVersion": 1 }],
  "primaryMetric": "task_success",
  "executionMode": "real_robot",
  "gradingMode": "human",
  "rolloutPlan": { "minRuns": 45, "maxRuns": 45, "stoppingRule": "fixed", "seedPolicy": "fixed", "timeoutS": 600 },
  "statistics": { "ciMethod": "wilson", "confidenceLevel": 0.95, "paired": false },
  "acceptanceGates": [
    { "id": "success_rate", "name": "Task success rate", "metric": "task_success", "aggregate": "rate", "op": "gte", "value": 0.7, "blocking": true, "severity": "fail" }
  ]
}
```

Rules that are easy to miss:

- `primaryMetric`, `secondaryMetrics` and each gate's `metric` are slugs of metrics listed in `metricRefs`.
- A `rate` or `mean` gate passes only when its whole confidence interval clears the threshold. Too few runs give `inconclusive`, never `pass`. A single-run check uses `op` `eq`.
- `stoppingRule` `confidence` or `sequential` needs `targetCiHalfWidth`; `fixed` runs every run.
- `tierRuns` names tiers of the pinned scenario and never exceeds `maxRuns`.
- A scenario variable with `sampling` `grid` walks every combination and repeats: make `maxRuns` a multiple of the number of combinations.
- Criteria `stages`: unique `stageKey` and `order`; the `progressWeight` values sum to 1.0. Use `successCondition` `"true"` for a stage a person judges.
- `criteriaClass` is `performance` or `safety` and cannot change after publish.
- Scenario `setupInstructions` are the steps a person confirms before each by-hand run. Write them so an operator can follow them at the bench.
- A `scripted` protocol run by hand is graded from the facts the person reports after the rollout: keep every `state` path the criteria read answerable by someone who watched (placed or not, a count, a time).
- A `simulation` protocol needs `rolloutPlan` `seeds`: every scenario case runs once per seed (`simulation-suite`).
- `timeoutS` is the budget of one run. The cost estimate and the closing of stuck runs depend on it.

Edit a draft with the kind's update operation (`evaluation-protocols.update` and its siblings); remove one with its delete operation.

### 4. Test the expressions

Criteria predicates, stage conditions, scenario constraints and metric expressions are CEL. Each position reads only its own root:

| `kind` | Reads | Used by |
| --- | --- | --- |
| `runState` (default) | `state` | goal, failure and safety predicates, stage conditions, the metric expression |
| `scenario` | `vars` | scenario `constraints` and `heldOutConditions` |
| `graphEdge` | `state`, `task` | mission graph edges |
| `recoveryRule` | `task` | recovery rules |

`evaluation-expressions.test` runs up to 100 expressions against a sample context, through the evaluator that scores real runs:

```json
{
  "kind": "runState",
  "context": { "state": { "object_placed": true, "contact_events": [{ "force_n": 12.5 }] } },
  "expressions": [
    { "key": "placed", "expression": "state.object_placed == true" },
    { "key": "gentle", "expression": "size(state.contact_events.filter(e, e.force_n > 30.0)) <= 1" }
  ]
}
```

- Each result has `valid`, `errorStage` (`parse`, `roots` or `evaluate`), `error`, `value` and `verdict`. Show the user one line per expression.
- `state` has no fixed shape: it is what a run records (the facts a person reports for a by-hand run, what the replay or the simulator writes otherwise). Ask the user for a real example, or test against a recorded run: send `runId` and no `context` (`runState` only).
- A predicate that reads a path the run did not record counts as not satisfied. Guard optional fields with `has(...)`. A metric follows its `missingValuePolicy`.
- Wrap counts in `double()` before dividing. Limits: 4096 characters, comprehensions nested 4 deep.
- The same checks run when a definition is saved: a syntax error or an unknown root is refused with 422 and the position.

### 5. Size the run count

`evaluation-library.sample-size-guidance` with `confidenceLevel` and `minDetectableEffect` (optional `baselineRate`, `ciMethod`, `tierKeys`) returns `suggestedRuns` and `tierRuns`. Give the user the number with what it buys ("about N runs to detect a 10 point change at 95 percent"), then set `minRuns` and `maxRuns`. More runs cost a person's time at the robot, or compute: `evaluation-job` shows the estimate before a launch.

### 6. Test-run the protocol draft

`evaluation-protocols.test-run` runs a `draft` once, for real, before it is frozen. Say before the call what it will use (a person at the bench, or compute).

| Protocol runs | Body besides `subjectType` and `subjectId` | What runs |
| --- | --- | --- |
| on a real robot, by hand | `executionMode` `"manual"` | one run that waits for a person at the robot: `evaluation-grading` |
| as replay | `episodeSelection` | one run on the first selected episode |
| in simulation | `simSuiteId`, `cellId` | every case of that suite in that cell; needs `simSuite:launch`; follow it as `simulation-suite` describes |

It returns an EvaluationJob with `testRun` `true`. Follow it and read its report as `evaluation-job` describes. Tell the user: a test-run report is marked `testRun` and is never evidence. It does not advance a model, satisfy a gate, or enter comparisons and baselines. `evaluation-jobs.list` shows test runs only with `testRun` `true` in `query`.

### 7. Publish

Publish in dependency order: every metric, the criteria, the scenario, then the protocol. Before each call tell the user: **cannot be undone**, the version is frozen and any later change is another version.

The protocol publish checks every reference at once and lists all offenders in one refusal (`CONFLICT` 409): an unpublished criteria or scenario, a missing or deprecated metric, a gate or primary metric that is not pinned, an inconsistent run plan.

Done when: `evaluation-protocols.get` shows `status` `published` with `publishedBy` and `publishedAt`, and the same for everything it pins. Close with a table of kind, slug, version, id and status, the gates in plain words, and how the protocol launches (Next, below).

### 8. Change, retire, audit

- **Change a published definition**: the kind's new-version operation (`evaluation-metrics.create-versions`, `evaluation-criteria.create-versions`, `evaluation-scenarios.create-versions`, `evaluation-protocols.create-versions`) returns a draft with the next version. Edit, test, publish. Evaluations already run keep the version they pinned; a schedule picks the newest published version at each launch.
- **Retire**: the kind's deprecate operation (`evaluation-metrics.deprecate`, `evaluation-criteria.deprecate`, `evaluation-scenarios.deprecate`, `evaluation-protocols.deprecate`). Tell the user it cannot be undone: nothing can reference the version afterwards, while existing pins and past reports keep working. Check who depends on it first: `evaluation-library.governance-criteria-usage-chain` (protocols and reports under a criteria version) and `evaluation-library.governance-protocol-usage-chain` (reports under a protocol version).
- **History**: `evaluation-protocols.list-versions` and its siblings (`evaluation-metrics.list-versions`, `evaluation-criteria.list-versions`, `evaluation-scenarios.list-versions`) list every version, oldest first. `evaluation-library.governance-publishers` adds who published each and when.
- **Copy one definition** into a workspace as a draft: `evaluation-metrics.clone`, `evaluation-criteria.clone`, `evaluation-scenarios.clone`.

### 9. Share with the organization

`evaluation-library.governance-promote-to-org` (`pathParameters` `kind`: `metric`, `criteria`, `scenario` or `protocol`, and the version `id`; body `{}`) copies one workspace version into the organization library. Tell the user it becomes visible to every workspace of the organization. The copy is read-only (`workspaceId` `null`, `organizationId` set, `promotedFromId` the source); the source is unchanged. Give the user the id of the copy: another workspace clones it by that id. `evaluation-criteria.list` with `workspaceId` and `organizationId` also lists promoted criteria.

### 10. Set the standing baseline

A standing baseline is the one EvaluationJob a protocol version's later evaluations are compared against in a workspace.

- `evaluation-protocols.replace-standing-baseline` with body `{"workspaceId": "wks_...", "baselineJobId": "evj_..."}`. The job must belong to the same workspace and protocol version and must not be a test run. It replaces the previous designation: say which job it replaces.
- `evaluation-protocols.list-standing-baseline` with `query` `workspaceId` returns `baselineJobId`, `baselineReportId`, `designatedAt` and `ageHours`, or `data` `null` when none is set.
- A new protocol version starts without a baseline. A pipeline that runs suites with an automatic baseline replaces the designation after each passing run on the base branch (`ci-integration`).

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `FORBIDDEN` 403 whose message says the actor lacks an evaluation permission | the user may not author, or may not publish | name the permission (Before you start); an organization admin grants it, or an `owner` or `admin` publishes the drafts you prepared |
| `FORBIDDEN` 403 "system-managed" or "organization shared-library" | the row belongs to the standard or organization library | clone it into the workspace and edit the clone |
| `FORBIDDEN` 403 naming `evaluation.safetyPublishRoles` | the workspace limits who publishes safety definitions | someone with a listed role publishes |
| `definition_repository_managed` 409 | the slug is published from a repository; `details` has `repository`, `directoryPath`, `commit` | change the file there ([definition-directory.md](definition-directory.md)) |
| `CONFLICT` 409 on update: "immutable" | the version is `published` or `deprecated` | create a new version, edit that |
| `CONFLICT` 409 on publish | already published, deprecated, or a publish check failed; the message lists every problem | fix each listed reference or rule, publish again |
| `VALIDATION_ERROR` 422 on save | an expression does not parse or reads an unknown root, or a field is wrong; `details` names it | fix it; test expressions first (step 4) |
| `VALIDATION_ERROR` 422 "status changes only through the publish/deprecate actions" | an update tried to set `status` | use publish or deprecate |
| `protocol_not_draft` 422 | a test run named a published protocol | create a draft version, or launch the published one (`evaluation-job`) |
| `test_run_needs_cell` 422 | a simulation test run without `cellId` | pass `simSuiteId` and `cellId` (`simulation-suite`) |
| 422 with `blockers` in `details` on a test run | the launch preflight failed | each blocker has `code` and `message`; see `evaluation-job` |
| `run_state_unavailable` 422 | the run named by `runId` kept no recorded state | use a sample `context` |
| `run_test_needs_run_state`, `run_test_with_context` 422 | `runId` sent with a `kind` other than `runState`, or with a `context` | send `runId` alone with `runState` |
| 409 on promote | already promoted, or not a workspace version | nothing to do, or promote the workspace copy |

## Done when

- [ ] `evaluation-protocols.get` shows the protocol `published`, and its criteria, scenario and every metric in `metricRefs` read `published` too.
- [ ] Every expression returned `valid` `true` in `evaluation-expressions.test` against a context the user confirmed.
- [ ] The user saw the gates in plain words and the run count before publish.
- [ ] When a test run was made: its job is terminal and the user saw its report, marked as a test run.
- [ ] When asked for: `evaluation-protocols.list-standing-baseline` returns the job the user chose, and the promoted copy's id was reported.

## Next

- `evaluation-job`: evaluate a checkpoint, model or artifact under the protocol, on a real robot by hand or as replay.
- `simulation-suite`: write the simulation scenario, put it with a `simulation` protocol into a suite, and launch it.
- `evaluation-grading`: execute by-hand runs at the robot, and grade the runs of a human-graded protocol.
- `ci-integration`: apply a definition directory and gate merges from a pipeline.

## The rfabric CLI

`<kind>` is `evaluation-metric`, `evaluation-criteria`, `evaluation-scenario` or `evaluation-protocol`.

| Step | CLI |
| --- | --- |
| List the standard protocol templates | `rfabric evaluation-protocol templates` |
| Clone | `rfabric <kind> clone <id> [--workspace <workspace>]` |
| New draft version | `rfabric <kind> versions <id>` |
| Version history | `rfabric <kind> history <id>` |
| Test expressions | `rfabric eval test '<expression>' [--kind <kind>] --context '<json>'`, or `--run <run-id>` |
| Test-run a protocol draft | `rfabric eval test-run --protocol <id or slug> --subject-type <type> --subject <id> [--execution manual]` |
| Publish | `rfabric <kind> publish <id>` |
| Deprecate | `rfabric <kind> deprecate <id>` |
