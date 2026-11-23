---
name: deployment-rollout
description: >-
  An Artifact running on the intended robots, rolled out in stages with a failure budget and a way back. Use when asked to deploy, ship, roll out or update a model or artifact on a robot, site or fleet, do a canary, preview a rollout, approve, start, advance, pause or cancel a deployment, see why it will not start, decide what to do after robots failed in a stage, roll back, or check which version each robot runs. Not for building the Artifact: that is `artifact-build`.
---

# Deployment rollout

The user ends up with a **Deployment** (`dpl_...`) in status `active`: one `ready` Artifact (`art_...`, the packaged model) delivered to a fleet, a site, one robot or a set of robots. Each robot has a **DeploymentTarget** (`dpt_...`) that reports its own delivery. Robots run `rfabricd`, which downloads the Artifact, verifies its SHA-256, switches to it atomically and keeps the previous version for rollback. An **Environment** (`env_...`) is an ordered tier of the organization (for example staging before production) that a fleet belongs to.

Deployment statuses: `pending` -> `approved` -> `rolling_out` -> `active`; ends otherwise in `failed`, `cancelled`, or `rolling_back` -> `rolled_back`.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

A call that changes what robots run is marked **Changes robots**, with **Which** robots and how to **Undo** it. Before such a call, tell the user in one message: the robots by name, the Artifact they switch to, and the undo. Dry run, create and approve change no robot.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Pick the Artifact and the target | agent | `fleets.deployable-artifacts`, `artifacts.list`, `artifacts.get` | - |
| 2 | Dry run: robots per stage, start gates, way back | agent | `deployments.dry-run` | - |
| 3 | Create the Deployment | agent | `deployments.create` | - |
| 4 | Approve | another person, in the rFabric app | `deployments.approve`, `deployments.get` | their decision |
| 5 | Start: stage 0 robots switch | agent | `deployments.start` | robots download and switch |
| 6 | Follow robots and the stage | agent | `deployments.stage-status-stream`, `deployment-targets.list`, `deployments.get` | until every robot of the stage settled |
| 7 | Advance, stage by stage | user decides, agent calls | `deployments.advance` | each stage |
| 8 | Confirm what every robot runs | agent | `deployment.compliance`, `deployments.history` | - |

When robots fail on the way: section "When robots fail".

## Before you start

- **Permissions** (`introspect.whoami`): `deployment:approve` to approve and `deployment:rollback` to roll back, both as a signed-in person (a service credential is refused). The built-in roles `owner` and `admin` carry them; `operator` and `member` do not. The other steps need access to the workspace.
- **Needs**:
  - enrolled robots that report in: `robot-enrollment`, `fleet-inventory`;
  - a `ready` Artifact whose Model is `approved` or `deployed`: `artifact-build`, `model-release`;
  - by default a passing evaluation under a `deployment_acceptance` protocol of the workspace, on the Artifact or its Model (start gate `evaluation_pass`, step 2): `simulation-suite` or `evaluation-job`.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Target: fleet, site, robot, or a list of robots | decides which robots change | `fleets.list`, `sites.list`, `robots.list` |
| Stages | how many robots change before a person looks | propose: canary 10 percent, then 100 |
| Failure budget, and what a breach does | how many failed robots stop the rollout | propose: stop at the first failed robot and roll back automatically |
| Who approves | the creator cannot approve their own deployment | a second person with `deployment:approve` |

## Decisions

How many robots change at once:

| Option | Choose when | Consequence |
| --- | --- | --- |
| `canary` or `percentage` with stages (recommended) | more than a few robots | only stage 0 robots change at start; every further stage needs `deployments.advance` |
| `immediate` | one robot, a test bench, or a fix that cannot wait | every robot in the target changes at start |

What happens when failed robots exceed the budget, in any stage:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Roll back automatically (recommended): `autoRollbackOnBudgetBreach` true | the target has a previous deployment | without a person deciding, every robot that already took the new Artifact returns to the previous one, the robots of earlier, successful stages included. The deployment ends `rolled_back` |
| Pause | the user wants to look first, or there is no previous deployment | nothing further is sent; robots that switched keep the new Artifact, so the target runs two versions until the user retries, rolls back or accepts it |

## Steps

### 1. Pick the Artifact and the target

- Fleet target: `fleets.deployable-artifacts` (path: the fleet id) lists what a rollout to that fleet accepts, newest first: the `artifact`, its `model`, the `evaluationPass` precheck, `fleetDeployments` (where it runs or rolls out) and `current` (the fleet's current Artifact).
- Other targets: `artifacts.list` with `status` `ready`, then `artifacts.get`.
- `targetType` and `targetId`: `fleet` with a fleet id, `site` with a site id, `robot` with a robot id, or `robot_set` with `robotIds` and a `targetId` that names the set (reuse the same name later: the next deployment to that name records this one as its predecessor).

### 2. Dry run

`deployments.dry-run` takes the body of `deployments.create` and creates nothing. Example body:

```json
{
  "workspaceId": "wks_...",
  "artifactId": "art_...",
  "targetType": "fleet",
  "targetId": "flt_...",
  "rolloutPolicy": {
    "strategy": "canary",
    "stages": [{ "name": "canary", "percentage": 10 }, { "percentage": 100 }],
    "rollbackTriggers": { "maxFailedTargets": 0, "autoRollbackOnBudgetBreach": true }
  }
}
```

- `stages[].percentage` is cumulative, strictly increasing, and the last is 100. `immediate` takes no stages. Robots are assigned to stages in robot id order; to choose the canary robots yourself, deploy to them first as a `robot_set`.
- `maxFailedTargets` is the number of failed robots tolerated over the whole deployment, not per stage: one more is a breach. `maxFailedTargetPercent` is the same as a share of all targets; the smaller of the two applies. Without `rollbackTriggers` there is no budget, and nothing stops by itself.
- `excludeRobotIds` leaves robots out.

Show the user the report as a short table:

| Field | Tell the user |
| --- | --- |
| `stages[].robots` | which robots change in which stage, by `robotName`; `awaitingReconnect` true: offline now, switches when it reconnects |
| `unresolvables` | robots that cannot take this Artifact, with the `reason` (an `rfabricd` version below the Artifact's minimum, or no matching release variant). Create refuses unless they are in `excludeRobotIds` |
| `pinned` | robots held on their version by a pin; the rollout skips them. `robots.unpin` includes them again |
| `gatePrechecks` | the four start gates in the order start checks them, each `pass`, `block` or `not_applicable`, with what it `checked` and the `reason` |
| `requireApproval` | true: someone else must approve before start (step 4) |
| `previousArtifact` | the name and version a rollback returns robots to. Null: this target has no previous deployment, so nothing can be rolled back; the way back is a new Deployment of the earlier Artifact |
| `budgetBreachAction` | `rollback` or `pause`: what a breach will do (Decisions). `rollback` needs a previous deployment; without one a breach pauses |
| `estimatedTransferBytes` | the download size over all robots |

Start gates and how to clear a `block`:

| Gate | Blocks when | Clear it |
| --- | --- | --- |
| `blackout` | a blackout window of the workspace or organization is open | wait until the time in `checked` |
| `evaluation_pass` | a protocol type listed in the workspace setting `deployment.requiredEvaluationProtocols` (default: `deployment_acceptance`) has no passing report on the Artifact or its Model | run a protocol of that type: `simulation-suite` or `evaluation-job` |
| `environment_progression` | setting `deployment.environmentProgression` is on and the Artifact is not `active` on a fleet of every earlier Environment | roll it out there first |
| `model_age` | the Model is older than setting `deployment.maxModelAgeDays` | deploy a newer model, or an admin changes the setting |

Read a setting with `workspaces-settings.get-effective`. Changing one loosens a safeguard for the whole workspace: that is the user's decision, never a way around a block (`workspace-setup` changes settings).

Done when: the user accepted the robots per stage, the budget and the way back.

### 3. Create the Deployment

`deployments.create` with the body the user accepted. Robots are resolved now and fixed: robots that join the fleet later are not part of it. The result is `pending`, or `approved` when the workspace setting `deployment.requireApproval` is false. `previousDeploymentId` is the target's current `active` deployment. No robot changes.

Until start, `deployments.update` changes the `rolloutPolicy` and `deployments.delete` removes the deployment.

### 4. Approve

The person who created a deployment cannot approve it. When the user did not create it and holds `deployment:approve`, call `deployments.approve` for them. Otherwise it is someone else's turn; hand the user this block to pass on:

```text
Your turn - a second person, rFabric app
Why: a rollout needs a decision by someone other than the person who created it.
Who: a member with approve on deployment (owner or admin), not <the creator>.

1. Open https://app.rfabric.io/<organization slug>/<workspace slug>/deployments/<deployment id>
2. Check what it deploys (Artifact <name> <version>) and where (<target name>).
3. Choose Approve.

Changes: the deployment becomes approved. No robot changes until it is started.
Bring back: tell me when it is approved.
Then I: check the status and tell you which robots change at start.
```

The slugs come from `organizations.get` and `workspaces.list`. Verify with `deployments.get`: `status` `approved`, `approvedBy`.

A passing `deployment_acceptance` evaluation of the Artifact or its Model also approves the pending deployments of that Artifact, when the person who launched the evaluation held `deployment:approve`.

### 5. Start

**Changes robots**

- **Which**: the robots of stage 0 (`stages[0].robots` of the dry run; with `immediate`, every robot). Each downloads the Artifact, verifies it and switches to it. An offline robot switches when it reconnects.
- **By itself afterwards**: a budget breach acts without a person (`budgetBreachAction`). Say which it will be.
- **Undo**: "Roll back", for every robot or for one: back to `previousArtifact`. With none, the undo is a new Deployment of the earlier Artifact.

`deployments.start`. It checks the four gates again and refuses with 409 at the first block (the message is the gate's reason; the refusal is recorded in `gateOutcomes`). On success the status is `rolling_out`.

### 6. Follow robots and the stage

- `deployments.stage-status-stream` (pass `streamSeconds`): events `snapshot`, `stage_status` on each change, `terminal` at the end, each with `status`, `rolloutState` and `targetCounts` per target status.
- `deployment-targets.list` with `deploymentId`: per robot `status`, `effectiveStatus`, `appliedAt`, and its stage in `meta.stageIndex`.
- `deployments.get`: `rolloutState` (`currentStage`, `pausedAt`, `lastError`), `budgetBreachAction`, `autoRollbackExecutedAt`.

| Target status | Meaning for the user |
| --- | --- |
| `pending` | not sent yet (a later stage), or sent and not picked up |
| `awaiting_reconnect` (in `effectiveStatus`) | the robot is offline; it switches when it reconnects. It does not hold up the stage and does not count as failed |
| `downloading`, `applying` | the robot is fetching, then verifying and switching |
| `active` | the robot runs the new Artifact |
| `failed` | the robot did not take the Artifact and stays on the version it ran before; the robot's message is in `meta.lastError` |
| `rolled_back` | the robot returned to the previous version, or was never sent the new one when the rollback started |
| `waiting_for_window`, `deferred`, `attention_needed`, `expired` | reported by the robot; show the status with the target's `meta` (a deferral lists its unmet conditions) |

Report per stage, by robot name: `active`, failed, offline. Stop following after 15 minutes without a change and say how to resume: offline robots can take days.

A stage is settled when each of its robots is `active`, `failed` or offline. On any `failed` robot, or when the status leaves `rolling_out`, go to "When robots fail" before anything else.

### 7. Advance

**Changes robots**

- **Which**: the robots of the next stage: the targets whose `meta.stageIndex` is `currentStage` + 1, by the names of the dry run.
- **By itself afterwards**: failures here count against the same budget. With `budgetBreachAction` `rollback`, a breach in this stage also returns the robots of the earlier stages that already run the new Artifact.
- **Undo**: "Roll back".

Show the settled stage's result and wait for the user's decision before each `deployments.advance`. It is refused with 409 while the current stage has robots in flight, while paused, over the failure budget, or at the final stage.

The deployment becomes `active` when every robot is `active` (offline robots that have not picked it up do not block it); the Model then moves from `approved` to `deployed`.

### 8. Confirm

- `deployment.compliance` with `workspaceId` and `fleetId`: per robot `activeArtifactVersion`, `responsibleDeploymentId`, `effectiveStatus`, and `drifted` with `driftReason` (`pinned`, `offline`, `version_mismatch`, `failed`, `rolled_back`, `expired`) against the fleet's active deployment.
- `deployment.compliance-summary` with `workspaceId` (and `fleetId`) in `query`: `versionDistribution`, `driftCountByReason`, `pinnedCount`, `awaitingReconnectCount`, `totalRobots`.
- `deployments.history`: the gates passed, who approved, advanced and paused, and each robot's last status.
- One robot: `deployment.robots-version-timeline` (every activation, rollback and delivery attempt) and `deployment.robots-version-chain` (the deployments behind what it runs, newest first: what a rollback returns to).

## When robots fail

Read `deployments.get` and the `failed` targets (`deployment-targets.list` with `status` `failed`), then tell the user at once: which robots failed and why (`meta.lastError`), which robots run the new Artifact, which run the previous one, and the options.

| What `deployments.get` shows | What happened | Options for the user |
| --- | --- | --- |
| `rolling_out`, `pausedAt` null, some robots `failed` | failures within the budget (or no budget); nothing stopped | fix the cause and retry those robots; advance when the stage settled; or roll back |
| `rolling_back` or `rolled_back`, `autoRollbackExecutedAt` set | the budget was breached and rFabric rolled back: every robot that had the new Artifact returns to the previous one, earlier stages included; robots not yet sent it stay untouched. `rolling_back` lasts until each of them reported, offline ones after they reconnect | nothing to decide. The deployment is over: fix the cause, then a new Deployment |
| `rolling_out`, `pausedAt` set, `lastError` "failure budget exceeded: ..." | the budget was breached and the rollout paused: nothing further is sent, robots already switching finish, robots that switched keep the new Artifact | 1. fix the cause, retry the failed robots, then resume. 2. roll back every robot. 3. roll back single robots |
| `failed` | every reachable robot settled and at least one failed. Robots that are `active` keep the new Artifact; the failed ones run the previous version. Retry, resume and advance are refused | 1. roll back every robot. 2. keep it, fix the cause, and create a new Deployment for the failed robots (`robot_set`) |

A paused rollout in its last stage turns `failed` as soon as its other robots settled: decide on retry before that, or use the options of `failed`.

## Control a running rollout

| Goal | Call | Effect on robots, and undo |
| --- | --- | --- |
| Hold | `deployments.pause` with `reason` | no further robot is sent the Artifact and advance is refused. Robots already sent it finish. Undo: resume |
| Continue | `deployments.resume` | **Changes robots**. Which: robots of the current stage and earlier that have not taken the Artifact; it is sent to them again. Undo: "Roll back" |
| Retry one robot | `deployments.targets-retry` (path `id`, `targetId`) | **Changes robots**. Which: that robot; `failed` -> `pending`, sent the Artifact again (while paused: at resume). Only while the deployment is `rolling_out`. Undo: roll back that robot |
| Stop without undoing | `deployments.cancel` with `reason` | final: status `cancelled`, no advance and no rollback of the whole deployment afterwards. Robots already `active`, `downloading` or `applying` keep the new Artifact: the response lists them in `stillActiveTargets`. To return them, roll back each one. To stop and undo, roll back instead of cancelling |

## Roll back

A rollback returns robots to the Artifact of `previousDeploymentId`. Read it first (`deployments.get`, then that deployment's `artifactId` with `artifacts.get`) and tell the user the name and version robots go back to. With no previous deployment there is nothing to roll back to (409, `reason` `no_predecessor` in `details`): deploy the earlier Artifact as a new Deployment instead.

| Scope | Call | Effect |
| --- | --- | --- |
| Every robot | `deployments.rollback` with `reason` | **Changes robots**. Which: every robot of this deployment that is `downloading`, `applying` or `active` switches back to the previous version; robots still `pending` are closed without a change; `failed` robots already run it. Status `rolling_back`, then `rolled_back` once every robot reported. Allowed from any status except `cancelled` and `rolled_back`. Undo: a new Deployment of the newer Artifact |
| One robot | `deployments.targets-rollback` (path `id`, `targetId`) with `reason` | **Changes robots**. Which: that robot only; the rest of the rollout continues. Its target turns `rolled_back` when the robot reports. Undo: a new Deployment to that robot |

Both need `deployment:rollback` and a signed-in person. Follow as in step 6. A `rolled_back` deployment is final. A Model whose rollout was rolled back stays `approved` or `deployed`: when it must not ship again, deprecate it with `model-release`.

## Environments

An Environment is a tier a rollout advances through: a fleet receives an Artifact only after it runs in every earlier tier, when the workspace enforces that.

- Read the tiers: `environments.list` with `organizationId`; the lowest `ordinal` is the earliest. A fleet's tier is its `environmentId` (`fleets.list`).
- Read whether the order is enforced: workspace setting `deployment.environmentProgression` (`workspaces-settings.get-effective`). When true, the start gate `environment_progression` lets a fleet rollout start only when the Artifact is `active` on a fleet of every earlier Environment. Robot, site and robot set deployments are not checked.
- Plan from it: roll out to a fleet of the earliest Environment first, then tier by tier.
- Creating or reordering Environments, and turning the setting on: `workspace-setup`. Putting a fleet in an Environment: `fleet-inventory`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 on dry run or create, `reason` `artifact_not_ready`, `artifact_revoked`, `artifact_unverified` or `artifact_not_promotion_eligible` | the Artifact cannot be deployed in its state | choose a `ready` one, or `artifact-build` |
| 409 `artifact_model_not_approved` | the Artifact's Model is not `approved` or `deployed` | `model-release` |
| 409, `reason` `deployment_overlap` | robots are in another unfinished deployment of the same payload class; `blockingDeploymentIds` and `conflicts` name them | finish, cancel or roll back that deployment, or exclude those robots |
| 409, `reason` `unresolvable_robots` | some robots cannot take the Artifact; `unresolvables` lists each with a reason | fix the cause, or pass them in `excludeRobotIds` and tell the user who is left out |
| Unresolvable: "rfabricd version ... below minimum" or "unknown" | the robot's `rfabricd` is older than the Artifact needs, or never reported its version | at the robot: `sudo apt-get upgrade` or `sudo dnf upgrade`, then dry run again |
| 422, `reason` `zero_robots`, `fleet_not_found`, `site_not_found`, `robot_not_found`, `workspace_mismatch`, `empty_robot_set` | the target resolves to no robot, does not exist, or is in another workspace | correct the target |
| 422 on the `rolloutPolicy` | stages missing, not increasing, or not ending at 100 | fix the stages |
| 409 on approve, `reason` `approver_is_creator` | the creator tried to approve | step 4: another person |
| 403 on approve or rollback | no permission, not a person, or a rule of the organization (`reason` `gate_policy`; the message says which: a person is required, or the approver must differ from the creator) | a person who qualifies does it |
| 409 on approve or rollback, `reason` `approvals_pending` | the organization requires several people for this action; this one was counted (`partialApprovals`) and nothing changed yet | the remaining people repeat the call; the last one takes effect |
| 409 on start | a start gate blocks; the message is the gate's reason | the gate table in step 2 |
| 409 on advance | stage not settled, paused, over budget, or final stage | wait, or "When robots fail" |
| 409 on retry, `reason` `terminal_deployment` or `not_failed` | the deployment has ended, or the robot is not `failed` | for an ended deployment: a new Deployment to those robots |
| A robot stays `awaiting_reconnect` | it is offline | it picks the rollout up when it reconnects; to find out why it is offline: `robot-enrollment` |

## Done when

- [ ] `deployments.get` shows `status` `active` (or `rolled_back` when that was the goal), and the user saw each stage's result before it advanced.
- [ ] `deployment-targets.list` shows every robot `active`, or the user knows by name which are offline, failed, excluded or pinned, and which Artifact each of those runs.
- [ ] `deployment.compliance` for the target shows no robot `drifted` that the user does not know about.
- [ ] The user knows which Artifact a rollback would return to, or that there is none.

## Next

- `fleet-monitoring`: watch the robots on the new Artifact.
- `evaluation-job`: evaluate the Artifact on a real robot, by hand.
- `model-release`: deprecate the superseded or rolled-back version.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| What a fleet can deploy | `rfabric fleet deployable-artifacts <fleet-id>` |
| Dry run, create | `rfabric deployment dry-run --data @<file>`, `rfabric deployment create --data @<file>` |
| Approve, start, advance | `rfabric deployment approve <deployment-id>`, `rfabric deployment start <deployment-id> --wait`, `rfabric deployment advance <deployment-id> --wait` |
| Pause, resume, cancel | `rfabric deployment pause <deployment-id> --reason "<text>"`, `rfabric deployment resume <deployment-id>`, `rfabric deployment cancel <deployment-id>` |
| Roll back | `rfabric deployment rollback <deployment-id> --reason "<text>" --wait` |
| Read | `rfabric deployment get <deployment-id>`, `rfabric deployment-target ls` |
