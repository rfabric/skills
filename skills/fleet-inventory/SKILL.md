---
name: fleet-inventory
description: >-
  An accurate robot inventory and shared work vocabulary in rFabric - sites, fleets and memberships, devices on each robot, missions and task trees, robot capabilities, saved fleet views and previewed bulk changes. Use when the user wants to organize, group, tag, move or audit robots, create a site or fleet, record a device swap, define missions and tasks, declare what a robot can do, change many robots at once, or run a fleet report. Not for bringing a robot online: that is `robot-enrollment`. Not for live health: that is `fleet-monitoring`.
---

# Organize the fleet inventory

The user ends up with an inventory that answers "what robots do we have, where are they, and what can they do", and a vocabulary of missions and tasks that datasets, training runs, evaluations and campaigns refer to. Everything here is a record. The one change a robot acts on is its fleet: it takes the settings of the fleet it joined last.

| Entity | Id | What it is |
| --- | --- | --- |
| Site | `site_...` | a physical location: address, coordinates, timezone |
| Fleet | `flt_...` | a named group of robots; the scope of fleet settings and of rollouts |
| FleetMembership | `flm_...` | one robot in one fleet from `joinedAt` until `leftAt`; history is kept |
| Device | `dvc_...` | a sensor, actuator or computer on a robot |
| Mission | `msn_...` | a named job, made of ordered tasks |
| Task | `tsk_...` | one unit of work; tasks nest into a tree |
| MissionTask | `mtk_...` | one task at one position in one mission |
| RobotMissionCapability, RobotTaskCapability | `rmc_...`, `rtc_...` | a statement that a robot can do a mission or a task, with a proficiency |
| FleetSavedView | `fsv_...` | a saved robot selection (a scope expression) with its columns |
| FleetBulkOperation | `fbo_...` | one change applied to every robot of a selection, previewed first |
| CalibrationRecord | `cal_...` | camera intrinsics, extrinsics or mounting for a dataset or one episode |

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

Step 1 always. Then only the steps the request needs, in this order (a later step uses ids from earlier ones).

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Take stock | agent | `robots.list`, `sites.list`, `fleets.list`, `fleet-memberships.list` | none |
| 2 | Sites and fleets | agent | `sites.create`, `fleets.create`, `fleets.update`, `robots.placement` | none |
| 3 | Memberships: join, move, leave | agent | `fleet-memberships.create`, `fleet-memberships.end-active` | none |
| 4 | Devices and swaps | agent | `devices.list`, `devices.create`, `devices.replace` | none |
| 5 | Missions and the task tree | agent | `tasks.create`, `tasks.reorder`, `missions.create`, `mission-tasks.create`, `mission-tasks.reorder` | none |
| 6 | Capabilities | agent | `robot-task-capabilities.create`, `robot-mission-capabilities.create` | none |
| 7 | Saved fleet views | agent | `robots.resolve`, `fleet-saved-views.create` | none |
| 8 | Bulk change with preview | agent, user confirms the preview | `fleet-bulk-operations.preview`, `fleet-bulk-operations.execute` | the user's go-ahead; the change is applied within the call |
| 9 | Reports and calibration records | agent | `fleet-reports.run`, `calibration-records.create`, `calibration-records.resolve` | none |

## Before you start

- **Permissions**: access to the Workspace. These operations name no further permission; a `403` says what is missing.
- **Needs**: a Workspace (`workspace-setup`). Robots exist as records (`robot-enrollment` step 1); they do not have to be online. Fleets that roll out artifacts need an Environment (`env_...`, the deployment tier): `environments.list` shows them, `workspace-setup` creates them.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| The grouping they want | a Fleet is a group for settings and rollouts, a Site a place, a tag a free label | Decisions, below; propose a structure from step 1 |
| Names of new sites, fleets, missions, tasks | `name`, and `slug` for missions and tasks | derive `slug` from the name: lowercase, hyphens |
| Which robots a change covers | the selection of a view or a bulk change | resolve it and show the list before any change (step 7) |

## Decisions

How to group robots:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Fleet (recommended for robots that are run alike) | they share settings, upload rules and software rollouts | a robot takes the settings of the fleet it joined last; a rollout targets a fleet |
| Site | they share a place | location and timezone only; no settings |
| Tag | an ad hoc label (a bench, a customer, a hardware batch) | free text on the Robot; selectable in views and bulk changes; changes nothing else |

## Steps

### 1. Take stock

Read every page before you conclude:

1. `robots.list` with `workspaceId`: name, `type`, `lifecycleState`, `tags`.
2. `sites.list` and `fleets.list` with `workspaceId`. A Fleet carries `siteId`, `environmentId` and `stewardId` (the member responsible for it).
3. `fleet-memberships.list` with `fleetId` or `robotId`: a membership with `leftAt` null is current.

Show the user one table: fleet, site, environment, robots in it, and the robots in no fleet. Propose changes from it; do not start creating.

### 2. Sites and fleets

- `sites.create`: `workspaceId`, `name`, and `address`, `coordinates` (`lat`, `lng`), `timezone` (an IANA name such as `Europe/Warsaw`) when known.
- `fleets.create`: `workspaceId`, `name`, and `siteId`, `environmentId`, `stewardId`, `description` when known. `fleets.update` changes them later.
- `robots.placement` with `siteId` records where one robot physically is. `robots.placement-history` lists every placement; the current one has `effectiveTo` null.

Tell the user: a fleet's Environment is its deployment tier (staging before production, for example). A robot that is a current member of a fleet whose Environment is named production is protected against decommissioning.

### 3. Memberships: join, move, leave

| Change | Call |
| --- | --- |
| Join | `fleet-memberships.create` with `fleetId`, `robotId` |
| Leave | `fleet-memberships.end-active` with `fleetId`, `robotId`: sets `leftAt`, keeps the history |
| Move | leave, then join; for many robots use `membershipMove` in step 8, which moves all of them or none |

Before a join or a move, say what follows the robot: it takes the settings of the fleet it joined last, and gets an artifact from that fleet's next rollout, not from one already running. `robots.list-datasets-config` with `fleetId` previews the upload rules the robot would have in the new fleet.

Prefer leave over `fleet-memberships.delete`: leaving keeps the record that the robot was in the fleet, and when.

### 4. Devices and swaps

- `devices.list` with `robotId`: what is on the robot. `lifecycleState` is `active` or `retired`.
- `devices.create`: `name`, `type` (`camera`, `lidar`, `radar`, `imu`, `gripper`, `force_torque`, `audio`, `compute`, `custom`), `robotId`, and `model`, `serialNumber`, `firmwareVersion` when known.
- A failed or upgraded part: `devices.replace` on the old device. It creates the replacement on the same robot (pass the new `serialNumber`, `model`, `firmwareVersion`; the rest is inherited), retires the old device and links them through `replacedByDeviceId`. Do not delete and recreate: that loses the swap history, and recordings point at the device that produced them.

### 5. Missions and the task tree

Missions and tasks are definitions of work, not executions: nothing runs when you create them.

1. Tasks first. `tasks.create`: `workspaceId`, `name`, `slug`, and `parentTaskId` for a child. `tasks.list` with `parentTaskId` reads one level.
2. Order siblings with `tasks.reorder`: `workspaceId`, `parentTaskId` (null for the top level) and `orderedIds`, every sibling id in the wanted order.
3. `missions.create`: `workspaceId`, `name`, `slug`.
4. Compose: `mission-tasks.create` with `missionId`, `taskId` per task, then `mission-tasks.reorder` with `missionId` and `orderedIds`, the MissionTask ids (`mtk_...`, not task ids) in order.

Show the resulting tree as an indented list. Agree on names before creating: datasets, training runs, evaluation scenarios and collection campaigns refer to these ids, so renaming is cheap (`tasks.update`) but splitting a task later is not. `missions.delete` and `tasks.delete` are soft: `missions.restore` and `tasks.restore` bring one back.

### 6. Capabilities

`robot-task-capabilities.create` (`robotId`, `taskId`, `proficiency`) and `robot-mission-capabilities.create` (`robotId`, `missionId`, `proficiency`).

| `proficiency` | Use for |
| --- | --- |
| `experimental` | being tried |
| `validated` | shown to work |
| `certified` | approved for this work |

The order is `experimental` < `validated` < `certified`. A capability is the user's statement; rFabric does not derive it from evaluations. Ask for the level, do not guess it. Change it with `robot-task-capabilities.update` or `robot-mission-capabilities.update`.

### 7. Saved fleet views

A scope expression selects robots. Every key is optional; keys combine with AND:

```json
{
  "fleetIds": ["flt_..."],
  "siteIds": ["site_..."],
  "tagAny": ["bench"],
  "tagAll": ["so-101", "calibrated"],
  "types": ["arm"],
  "capability": { "taskId": "tsk_...", "minProficiency": "validated" },
  "robotIds": ["rbt_..."]
}
```

1. `robots.resolve` with `workspaceId` and `scope`: returns the matching `robots` with `pagination`; page through with `page` and `limit` (at most 100). It reads only, although it is a POST. Without `filters` it returns `active` robots only; pass `filters.lifecycleStates` to include `enrolled`, `maintenance` or `retired`.
2. Show the list and its total. When it is what the user meant, `fleet-saved-views.create` with `workspaceId`, `name`, `scopeExpression` and `columns`.

Tags come from the Robot: `robots.update` with `tags` replaces the whole list, so send the existing tags plus the new one, or add a tag to many robots with step 8.

### 8. Bulk change with preview

One change for every robot of a selection. Bulk changes select `active` robots only, and the selection is fixed at the preview: a robot that matches later is not included.

| `kind` | `changePayload` | Effect per robot |
| --- | --- | --- |
| `tagAdd`, `tagRemove` | `{"tags": ["..."]}` | adds or removes the tags |
| `membershipAssign` | `{"fleetId": "flt_..."}` | joins the fleet |
| `membershipEnd` | `{"fleetId": "flt_..."}` | leaves the fleet |
| `membershipMove` | `{"fromFleetId": "flt_...", "toFleetId": "flt_..."}` | leaves the first fleet and joins the second; all robots or none |
| `lifecycleTransition` | `{"targetState": "retired", "reason": "..."}` | retires the robot: it leaves service for good. Its credentials stay valid; to lock a robot out use Decommission in `robot-enrollment` |

1. `fleet-bulk-operations.preview` with `workspaceId`, `kind`, `selectionExpression` (a scope expression) and `changePayload`. It changes no robot. It returns the `operation` (`fbo_...`, status `preview`) and `items`, one per robot, with `changePreview` (for tags: `tagsBefore`, `tagsAfter`; for a retirement: `lifecycleStateBefore`, `lifecycleStateAfter`).
2. Show the user the count and the before and after per robot, and say what cannot be undone (a retirement). Wait for their go-ahead: the preview is the decision.
3. `fleet-bulk-operations.execute` on the operation id. It applies the change before it answers and returns the operation as `completed`.
4. Verify by reading the robots back (`robots.list`, `fleet-memberships.list`): the response carries no per-robot outcome. `fleet-bulk-operations.retry-failed` applies the change again to every robot that did not succeed.

A `lifecycleTransition` to `maintenance` is refused: a robot enters maintenance through a maintenance record (`robot-maintenance`).

### 9. Reports and calibration records

`fleet-reports.run` with `workspaceId` and `reportKind` reads only, although it is a POST. `format` `csv` returns text instead of JSON.

| `reportKind` | Returns | Extra input |
| --- | --- | --- |
| `composition` | robots by type, lifecycle state and fleet, and a census of devices | `fleetId` narrows it |
| `utilization` | per robot: `activeMs`, `maintenanceMs`, and `offlineMs`, the rest of the window (time in neither state, not connectivity: connection uptime is in `fleet-monitoring`) | `windowStart`, `windowEnd`; default the last 24 hours |
| `lifecycleAge` | enrollment cohorts by month, mean time since enrollment, retired count | none |

Calibration records attach camera calibration to data. `calibration-records.create` takes:

- `workspaceId`, `recordType` (`intrinsics`, `extrinsics`, `mounting`), `scopeType` (`dataset`, `episode`);
- `datasetId`, and `episodeId` for one episode;
- `cameraKey`, and `payload` with the values as the user's calibration tool wrote them.

`calibration-records.resolve` with query `datasetId`, `episodeId` and optionally `cameraKey` returns the records that apply to an episode: an episode record wins over the dataset record of the same type and camera.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `409` on a create | the record exists already: the robot is a current member of that fleet, or the `slug` is taken in the workspace | list first and reuse it |
| `fleet-memberships.end-active` `404` | the robot has no current membership in that fleet | read `fleet-memberships.list` with `robotId` |
| `devices.replace` `409` | the device is already retired, or sits on no robot | read the device; attach it with `devices.update` and `robotId` first |
| `tasks.reorder` or `mission-tasks.reorder` `422` | `orderedIds` is not exactly the set of siblings | read the level again and send every id once |
| `robots.resolve` or a preview `422`, unknown robot ids | the scope names robots outside the workspace | the ids are in `details.robotIds`; remove them |
| A selection is smaller than expected | keys combine with AND, and only `active` robots match by default | drop a key, or pass `filters.lifecycleStates` to `robots.resolve`. A bulk change always takes `active` robots only: change the others one by one (`robots.update` for tags) |
| `fleet-bulk-operations.preview` `409` | a bulk move into `maintenance` | use `robot-maintenance` |
| `fleet-bulk-operations.execute` `409` | the operation is not in `preview` | it already ran: verify the robots, then `fleet-bulk-operations.retry-failed` if some are unchanged |
| `fleet-bulk-operations.execute` `409` on a `membershipMove`, message names a robot already in the fleet | that robot is already a current member of the target fleet, so no robot moved | take it out of the selection, preview again |

## Done when

- [ ] Every robot the user named is where they wanted: `fleet-memberships.list` shows the membership with `leftAt` null, `robots.placement-history` the current Site.
- [ ] `devices.list` per robot matches the hardware the user described; swapped devices are `retired` with `replacedByDeviceId` set.
- [ ] The task tree and each mission read back in the agreed order (`tasks.list`, `mission-tasks.list`).
- [ ] Capabilities read back with the agreed `proficiency` (`robot-task-capabilities.list`, `robot-mission-capabilities.list`).
- [ ] Each saved view resolves to the robots the user expects (`robots.resolve` with its `scopeExpression`).
- [ ] After a bulk change, the robots read back changed, and you reported how many.

## Next

- `robot-enrollment`: bring a registered robot online, or replace or decommission one.
- `robot-recording`: collection campaigns that count episodes per mission or task.
- `deployment-rollout`: roll an artifact out to a fleet.
- `fleet-monitoring`: live health of the fleets you organized.
- `evaluation-definitions`: scenarios that refer to these missions and tasks.

## The rfabric CLI

`--field key=value` repeats; `--data` takes a JSON literal or `@file`.

| Step | CLI |
| --- | --- |
| Take stock | `rfabric robot ls`, `rfabric site ls`, `rfabric fleet ls`, `rfabric fleet-membership ls` |
| Site, fleet | `rfabric site create --field name=<name>`, `rfabric fleet create --field name=<name> --field siteId=<site-id>` |
| Join, leave | `rfabric fleet-membership create --field fleetId=<fleet-id> --field robotId=<robot-id>`, `rfabric fleet-membership end-active --fleet <fleet-id> --robot <robot-id>` |
| Devices | `rfabric device ls`, `rfabric device create --data @device.json` |
| Tasks, missions | `rfabric task create --field name=<name> --field slug=<slug>`, `rfabric mission create --field name=<name> --field slug=<slug>`, `rfabric mission-task create --field missionId=<mission-id> --field taskId=<task-id>` |
| Capabilities | `rfabric robot-task-capability create --field robotId=<robot-id> --field taskId=<task-id> --field proficiency=validated` |
| Calibration | `rfabric calibration-record create --data @calibration.json` |
| Saved view, bulk change, report | `rfabric api post /api/fleet-saved-views --data @view.json`, `rfabric api post /api/fleet-bulk-operations/preview --data @change.json`, `rfabric api post /api/fleet-reports/run --data @report.json` |
