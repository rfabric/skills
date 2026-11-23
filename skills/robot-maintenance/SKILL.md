---
name: robot-maintenance
description: >-
  A robot serviced with a complete maintenance record (opened, triaged, assigned, worked, resolved or cancelled, with notes, parts and downtime) and taken into maintenance mode and back out through its exit checks. Use when a robot is broken or needs repair or service, must enter or exit maintenance mode, or the user asks for downtime, recurring faults, maintenance cost, bulk maintenance, or whether a robot answers commands. Not for finding out why a robot failed: that is `fleet-monitoring`. Not for driving the robot: that is `intervention-session`.
---

# Robot maintenance

The user ends up with a robot that is serviced and active again, and a record that says what was wrong, who fixed it, with which parts and how long the robot was down.

- **MaintenanceRecord** (`mr_...`): the log of one piece of service on one Robot (`rbt_...`), with its notes (`mrn_...`), parts (`mrp_...`) and `timeline`.
- **Maintenance mode** (a MaintenanceModeInterval, `mmi_...`): the period a robot is held out of operation under one record.
- **Exit check**: one condition the robot must pass before it leaves maintenance mode.
- **Robot command** (`rcmd_...`): a command sent to the robot and the outcome it reported.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read the robot's state and history | agent | `robots.get`, `robots.maintenance-exclusion-state`, `robots.maintenance-history` | none |
| 2 | Open the record, optionally entering maintenance mode | agent | `maintenance-records.create`, `robots.maintenance-enter` | none |
| 3 | Triage and assign | agent | `maintenance-records.triage`, `maintenance-records.assign` | none |
| 4 | Diagnose | agent | `robots.presence`, `robots.create-commands`, `robots.get-commands` | the command's outcome, at most until its `expiresAt` |
| 5 | Repair and log the work | user, at the robot; agent logs | `maintenance-records.start`, `maintenance-records.create-notes`, `maintenance-records.create-parts`, `maintenance-records.update`, `maintenance-records.escalate` | the repair itself |
| 6 | Resolve or cancel | agent | `maintenance-records.resolve`, `maintenance-records.cancel` | none |
| 7 | Exit maintenance mode | agent | `robots.maintenance-exit-checks`, `robots.maintenance-exit` | until every check is `pass` |
| 8 | Report downtime | agent | `maintenance-records.downtime`, `robots.downtime` | none |

Analytics and bulk maintenance are separate sections after the steps.

## Before you start

- **Permissions**: `maintenanceRecord:transition` for triage, start, resolve, escalate and cancel; `maintenanceRecord:assign` to assign, also when a record is created with an assignee. The built-in roles `operator`, `admin` and `owner` carry both; `member` only reads records. Creating and editing records, notes, parts, entering and exiting maintenance mode, commands and bulk maintenance need access to the workspace and no further permission.
- **Needs**: the Robot enrolled (`robot-enrollment`). To pass the built-in exit checks it must be online and have a deployment assigned (`deployment-rollout`). The evidence of a fault found in `fleet-monitoring` or during an `intervention-session` goes into the record's `description`.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which robot | a record belongs to one robot | `robots.list` with `search`; ask only when several match |
| What is wrong | the record's `title` and `description` | the user's words |
| Enter maintenance mode now | decides whether the robot keeps working (Decisions) | no default: ask |
| Who repairs it | `assignedToUserId` | `membership.members`; default the user themself (`introspect.whoami`) |
| `priority` | orders the work | `medium` when not given |

## Decisions

**Maintenance mode when the record opens**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Enter maintenance mode now (recommended for a fault) | the robot is unsafe, unreliable or will be opened up | the robot is held out of operation and downtime starts counting; it returns only through its exit checks |
| Record only | the robot can keep working, for example while a part is on order | nothing changes for the robot; the record counts no downtime |

**Exit while a check does not pass**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Fix the check, then exit (recommended) | the cause can be fixed | the robot is `active` again with every check passed |
| Exit with `overrideReason` | the check cannot pass for a reason the user accepts, for example a robot that has no deployment yet | the robot returns to `active` without passing; the reason is stored as the lifecycle reason and in the audit log |

`skipHealthCheck: true` also skips the checks but stores no reason. Prefer `overrideReason`.

## What maintenance mode changes

A robot in maintenance mode is held out of operation until it exits:

- The robot's `lifecycleState` is `maintenance` and its `lifecycleActions` list `exitMaintenance`. Activating, retiring and decommissioning it are refused (409) until it exits.
- `robots.resolve`, which selects robots by scope, returns `active` robots unless asked otherwise, so it leaves the robot out.
- The rFabric app shows it as "Out of service" (its words for maintenance mode: "Take out of service now" enters it, "Return to service" exits it); the operator console does not start a session on it.
- Before you put a deployment, an evaluation run, a recording or an intervention session on a robot, read `robots.maintenance-exclusion-state` (`inMaintenance`, the holding `maintenanceRecordId`, `modeIntervalStartedAt`) and do not schedule the work while `inMaintenance` is true. Several robots: `robots.maintenance-exclusion-state-bulk`, a read that is sent as a POST, so the host may ask for approval.
- Entering maintenance mode does not stop what already runs on the robot. End a live intervention session or a recording first, and tell the user about a rollout in flight.

## Steps

### 1. Read the robot's state and history

1. `robots.get`: `lifecycleState` and `lifecycleActions`. `enterMaintenance` listed means the robot can enter maintenance mode now (it is `active`); `exitMaintenance` means it is already in it.
2. `robots.maintenance-exclusion-state`: when `inMaintenance` is true, read the record in `maintenanceRecordId` and continue that record instead of opening a second one.
3. `robots.maintenance-history` with `status` or `since`: earlier records of this robot. Tell the user when the same fault was resolved before (same `failureCategory` or title).

Done when you can say: in maintenance mode or not, under which record, and what was done to this robot before.

### 2. Open the record

`maintenance-records.create` with `workspaceId`, `robotId`, `type`, `title`, and when known `priority`, `description`, `failureCategory`, `assignedToUserId`.

- `type`: `reactive` for a fault, `proactive` for service before a fault, `scheduled` for planned service.
- `enterMaintenanceMode: true` enters maintenance mode in the same call. Say before the call: the robot goes out of service, no new work is put on it, and what already runs on it keeps running.

**Maintenance mode for an existing record**: say the same before the call. Then `robots.maintenance-enter` with `pathParameters` `id` (the robot) and body `{"maintenanceRecordId": "mr_..."}`. The record must belong to that robot and be neither `resolved` nor `cancelled`.

The record starts as `open`. Its `allowedTransitions` list the transitions its status allows now; read them instead of guessing.

| Status | Meaning for the user | Leaves by |
| --- | --- | --- |
| `open` | reported, nobody looked yet | `triage`, `start`, `escalate`, `cancel` |
| `triaged` | assessed, work not started | `start`, `escalate`, `cancel` |
| `in_progress` | someone is repairing | `resolve`, `escalate`, `cancel` |
| `escalated` | handed up with a reason | `start`, `resolve`, `cancel` |
| `resolved` | fixed; final | nothing |
| `cancelled` | opened by mistake or not needed; final | nothing |

Done when the record exists and, if the user chose it, `robots.maintenance-exclusion-state` shows `inMaintenance` true with this record.

### 3. Triage and assign

- `maintenance-records.triage` with an optional `diagnosis`: the first assessment.
- `maintenance-records.assign` with `assigneeUserId`: sets who is responsible without changing status or priority. The assignee gets a notification in the rFabric app.
- Facts that change later (`priority`, `title`, `description`, `failureCategory`, `tags`) go through `maintenance-records.update`.

Each transition takes only its own fields; a field of another transition is refused (422, the `field` in `details` names it).

### 4. Diagnose

1. `robots.presence`: `online`, `offline` or `stale`, and when the robot was last seen.
2. Check that the robot answers commands: `robots.create-commands` with `pathParameters` `robotId` and the body below. It asks the robot to report the recordings it holds and changes nothing on it.

```json
{ "kind": "dataset.list", "data": {} }
```

3. The call returns at once with a command record (`rcmd_...`): accepted for dispatch, not yet executed. Poll `robots.get-commands` (`robotId`, `commandId`) every few seconds until `status` is final.

| Command `status` | Meaning |
| --- | --- |
| `queued` | the robot is offline; rFabric sends the command when it reconnects |
| `dispatched` | sent, no answer yet |
| `acknowledged`, `running` | the robot has it |
| `succeeded` | the robot answered; `result` holds the answer |
| `failed` | the robot refused or failed; `error` says why |
| `expired` | no outcome before `expiresAt` (`error` code `command_expired`): the robot software did not answer |
| `cancelled` | withdrawn before the robot took it |

`robots.list-commands` shows the robot's recent commands, filtered by `status` or `kind`: failed or expired ones are evidence.

Record what you learned with `maintenance-records.create-notes`, or as `diagnosis` on the next transition.

### 5. Repair and log the work

`maintenance-records.start` moves the record to `in_progress`.

```text
Your turn - at the robot
Who: the assignee, or anyone trained to service this robot.
Why: the repair itself happens on the hardware; I keep the record.

1. Make the robot safe before you touch it (power, emergency stop, clear workspace).
2. Do the repair.
3. Tell me: what you found, what you did, each part you replaced (name, part number, serial removed and installed, cost), and the minutes you worked.

Bring back: those facts, in any form.
Then I: add them to record mr_... and check the robot's exit checks.
```

- **Notes**: `maintenance-records.create-notes` with `body`. Notes are append-only: correct one by adding a note with `correctionOfNoteId`. Read them with `maintenance-records.list-notes`.
- **Parts**: `maintenance-records.create-parts` per part: `name`, and when known `partNumber`, `serialOut` (removed), `serialIn` (installed), `quantity`, `costCents`, `removedDeviceId`, `installedDeviceId`. Read them with `maintenance-records.list-parts`.
- **Cost**: cost analytics reads `partsCostCents` and `laborMinutes` on the record. After adding parts, set `partsCostCents` to their total with `maintenance-records.update`.
- **Escalate** when the assignee cannot finish: `maintenance-records.escalate` with `assigneeUserId`, `priority` and `escalationReason`, all three required. It reassigns, sets the priority and notifies the new assignee; the previous assignee, priority and the reason stay in the `timeline`. Continue with `maintenance-records.start` once the new assignee takes it.

### 6. Resolve or cancel

- **Resolve**: `maintenance-records.resolve` with `resolution` (required unless the workspace setting `maintenance.requiredFieldsOnResolve` is false), and `failureCategory`, `laborMinutes`, `diagnosis` when known. Only from `in_progress` or `escalated`. Use the same `failureCategory` wording for the same fault, since recurrence analytics groups by it.
- **Cancel**: `maintenance-records.cancel` with `cancelReason`, for a record opened by mistake. While the robot is in maintenance mode the cancel is refused unless `exitMaintenanceMode: true`. That flag exits maintenance mode in the same call without running the exit checks, so say this before the call.

Both are final. Resolving does not exit maintenance mode: tell the user the robot is still in maintenance mode until step 7.

### 7. Exit maintenance mode

1. `robots.maintenance-exit-checks`: `checks` (each with `checkId`, `name`, `reading`, `limit`, `status`) and `allPassed`.

| Check | Passes when | If it does not |
| --- | --- | --- |
| `minBatteryPercent`, `maxCpuPercent` | the robot's latest reading is within the workspace threshold (setting `maintenance.exitHealthCheckThresholds`; by default battery at least 20 percent, CPU at most 95 percent) | charge the robot or find the load. `not_run` means no reading: the robot must be online and reporting. A robot that never reports a battery level stays `not_run`: that is the override decision |
| `reachability` | the robot's presence is not `offline` | bring the robot online (`robots.presence`) |
| `deploymentAssignment` | the robot has at least one deployment assigned | `deployment-rollout`, or the override decision |

2. Show the user the checks as a table: name, reading, limit, status.
3. Say before the call that the robot returns to service and takes work again. Then `robots.maintenance-exit` with an empty body when `allPassed` is true. It closes the maintenance mode interval and its downtime and moves the robot to `active`. With the override decision, send `overrideReason`.

Done when `robots.maintenance-exclusion-state` shows `inMaintenance` false and `robots.get` shows `lifecycleState` `active`.

### 8. Report downtime

- `maintenance-records.downtime`: `totalMs` for this record, an open interval counted up to now.
- `robots.downtime` with `workspaceId`, `since` and optional `until`: `totalMs`, `maintenanceMs`, `otherMs`, `recordCount` for the robot.

Downtime accrues only while the robot is in maintenance mode: a record that never entered it reports 0. Give durations in hours and minutes.

## Recurrence and cost

| Question | Operation | Reading |
| --- | --- | --- |
| What keeps failing | `maintenance.analytics-recurrence` with `workspaceId`, `since`, `groupBy` (`robot`, `robotModel`, `failureCategory`) | per `key`: `count`, `downtimeMs`, `mtbfDirection` (`stable` from 2 records, else `insufficient_data`). Records without a category group as `uncategorized`. |
| What maintenance costs | `maintenance.analytics-cost` with `workspaceId`, `since` | `knownLaborCents` (a fixed 100 cents per labor minute), `knownPartsCents` (from `partsCostCents`), `totalKnownCents`, and `unknownCostRecordCount`: records with neither value |

Both count records by `detectedAt` between `since` and `until` (default now). A high `unknownCostRecordCount` means the cost is understated: say so, and offer to complete those records.

## Bulk maintenance

`maintenance.bulk` applies one action to many robots of a workspace in one call and returns the result at once.

| `kind` | Per robot |
| --- | --- |
| `create_records` | opens a `reactive` record from `recordTemplate` (`title`, `priority`); with `enterMode: true` also enters maintenance mode |
| `enter_mode` | opens a `proactive` record and enters maintenance mode |
| `exit_mode` | exits maintenance mode after the exit checks; no override |

```json
{
  "workspaceId": "wks_...",
  "kind": "create_records",
  "robotIds": ["rbt_...", "rbt_..."],
  "recordTemplate": { "title": "Replace recalled camera cable", "priority": "high" },
  "enterMode": true
}
```

- Before the call, name the robots and say how many enter maintenance mode: each of them goes out of service.
- Read `items`: one per robot with `outcome` (`success`, `failure`, `skipped`), `reason` and `maintenanceRecordId`. A failed robot does not stop the others; the operation's `status` is `failed` only when every item failed. Report the failures by robot with their reason.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `CONFLICT` (409) on a transition | the record's status does not allow it, or it is final | read `allowedTransitions` on the record and use one of them |
| `CONFLICT` (409) on cancel, `details` has `code` `maintenance_mode_interlock` | the robot is still in maintenance mode | exit it first (step 7), or cancel with `exitMaintenanceMode: true` after telling the user it skips the exit checks |
| `VALIDATION_ERROR` (422) on a transition, `details` names a `field` | a field of another transition, or a required one is blank (`resolution`, `cancelReason`, `assigneeUserId`, `priority`, `escalationReason`) | send only that transition's fields, with the required ones |
| `NOT_FOUND` (404) on `maintenance-records.create` | the robot is not in that workspace | use the robot's own `workspaceId` |
| 409 or 403 on `robots.maintenance-enter` | 409: the record is final, the robot is already in maintenance mode, or its lifecycle state does not allow it (for example `enrolled`); 403: the robot is retired | read `lifecycleActions` and the exclusion state; continue the record that holds the robot |
| 409 on `robots.maintenance-exit` | with `checks` in `details`: those checks are not `pass`; without: the robot is not in maintenance mode | fix the checks (step 7) or take the override decision to the user; otherwise there is nothing to exit |
| command ends `expired` | the robot did not report an outcome | `robots.presence`; on the robot follow its log with `sudo journalctl -u rfabricd -f` (service install) and ask for what it prints |
| 403 naming `maintenanceRecord:transition` or `maintenanceRecord:assign` | the user lacks the permission | name the permission; `member-access` finds why it is missing and what can add it |

## Done when

- [ ] `maintenance-records.get` shows the record `resolved` with its `resolution`, or `cancelled` with its `cancelReason`.
- [ ] `maintenance-records.list-notes` and `maintenance-records.list-parts` hold what the user reported, and `partsCostCents` on the record equals the parts total.
- [ ] `robots.maintenance-exclusion-state` shows `inMaintenance` false, or the user chose to keep the robot in maintenance mode and knows it.
- [ ] You reported the record id, the robot's state, the downtime from `maintenance-records.downtime`, and any exit check that was overridden with its reason.

## Next

- `fleet-monitoring`: watch the robot after it exits maintenance mode.
- `deployment-rollout`: assign or re-apply a deployment after a hardware change.
- `intervention-session`: drive the robot remotely to verify the repair.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Open a record | `rfabric maintenance-record create --field robotId=<robot-id> --field type=reactive --field title="..." [--enter-maintenance-mode]` |
| Triage, start | `rfabric maintenance-record triage\|start <record-id> [--diagnosis "..."]` |
| Assign | `rfabric maintenance-record assign <record-id> --assignee-user-id <user-id>` |
| Escalate | `rfabric maintenance-record escalate <record-id> --assignee-user-id <user-id> --priority high --escalation-reason "..."` |
| Resolve | `rfabric maintenance-record resolve <record-id> --resolution "..." [--failure-category <c>] [--labor-minutes <n>]` |
| Cancel | `rfabric maintenance-record cancel <record-id> --cancel-reason "..." [--exit-maintenance-mode]` |
| Exit checks, then exit | `rfabric robot maintenance-exit-checks <robot-id>`, `rfabric robot maintenance-exit <robot-id> [--override-reason "..."]` |
| Send a command and wait | `rfabric robot command dispatch <robot-id> --kind dataset.list --wait` |
| Read commands | `rfabric robot command ls <robot-id>`, `rfabric robot command get <robot-id> <command-id>` |
