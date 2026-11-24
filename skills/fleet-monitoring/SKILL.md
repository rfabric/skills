---
name: fleet-monitoring
description: >-
  A current picture of fleet health and, for a failure in the field, the evidence around it - what the robot reported, whether it was connected, which deployment ran, and the episodes, interventions and evaluation runs near it. Use when asked which robots are offline, unhealthy or behind on deployments, to check a robot's CPU, memory, battery, connectivity or uptime, to read telemetry events, compare robots, build a telemetry dashboard, export telemetry, or find out why a robot failed. Not for working an open alert: that is `alerting`.
---

# Fleet monitoring and failure investigation

The user ends up with one of two things: a health report of the fleet (who is offline, unhealthy or behind on deployments), or a timeline of one failure with the evidence behind it. Entities:

- **Robot** (`rbt_...`): a robot enrolled in a Workspace. **Fleet** (`flt_...`): a group of robots.
- **Presence**: whether a robot is connected now. **Performance sample**: CPU, memory, load, disks and network of the robot's computer. **Sensor reading**: power source, battery, CPU temperature, location.
- **RobotConnectivitySession** (`rcs_...`): one connected interval of a robot.
- **TelemetryEvent** (`tel_...`): one discrete event a robot or the platform recorded, optionally tied to the Deployment (`dpl_...`) active at that moment.
- **Telemetry dashboard** (`tdsh_...`): a saved grid of widgets the rFabric app renders.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

Everything here reads, except step 9 (dashboard, event type). Four read operations use POST (`robots.presence-bulk`, `robots.presence-bulk-by-scope`, `robots.telemetry-snapshot-bulk-by-scope`, `telemetry.compare`): they change nothing, say so when the host asks for approval.

## At a glance

Health check: steps 1 to 5. Failure investigation: steps 6 to 8, using 3 and 4 for detail. Step 9 is optional.

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read the workspace picture | agent | `workspaces.telemetry-overview`, `workspaces.telemetry-fleet-rollups`, `robots.presence-bulk-by-scope` | none; aggregates refresh when older than 60 seconds |
| 2 | Find robots behind on deployments | agent | `deployment.compliance` | none |
| 3 | Look at one robot | agent | `robots.presence`, `robots.performance-latest`, `robots.sensor-latest`, `robots.telemetry-health-score`, `robots.performance-history`, `robots.connectivity-sessions`, `robots.telemetry-uptime`, `robots.downtime` | none |
| 4 | Read telemetry events | agent | `robots.telemetry-events`, `telemetry-events.get`, `fleets.telemetry-event-rates` | none |
| 5 | Watch live | agent | `workspaces.presence-stream`, `robots.telemetry-stream` | one call reads for `streamSeconds`: 1 to 50 seconds, default 15 |
| 6 | Fix the failure in time | agent | `telemetry-events.get`, `robots.telemetry-markers` | none |
| 7 | Establish what ran and what changed | agent | `deployment.robots-version-timeline`, `deployment.robots-version-chain`, `robots.lifecycle-history`, `robots.placement-at`, `audit-logs.entity-history`, `audit-logs.device-timeline` | none |
| 8 | Collect what happened around it | agent | `episodes.list`, `intervention-sessions.list`, `intervention-events.list`, `evaluation-runs.list`, `lineage.get` | none |
| 9 | Keep it: compare, dashboard, export | agent | `telemetry.compare`, `workspaces.create-telemetry-dashboards`, `telemetry.update-dashboards`, `robots.telemetry-events` | none |

## Before you start

- **Permissions**: access to the workspace is enough for presence, performance, telemetry and dashboards (any member role). The audit history in step 7 needs `auditLog:read`, carried by the roles `owner`, `admin` and `auditor`; without it skip those two calls and say the audit trail was not read.
- **Needs**: at least one enrolled robot running `rfabricd` (`robot-enrollment`). Fleets come from `fleet-inventory`. Deployments come from `deployment-rollout`.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Workspace | every call is scoped to one | `workspaces.list`; ask only when there is more than one |
| Robot or fleet | narrows the report | `robots.list` with `search` (name, model, serial number, tags), `fleets.list`; default the whole workspace |
| When the failure happened | every window in steps 6 to 8 is built around it | from the event (`timestampNs`) when the user starts from one; otherwise ask, with the time zone |
| How far back | history windows | default the last 24 hours |

## Steps

### 1. Read the workspace picture

1. `workspaces.telemetry-overview`. Report from it:
   - `statusCounts`: `online`, `offline`, `stale`, `maintenance`, `total`. A robot in lifecycle state `maintenance` counts only under `maintenance`; a robot that never reported counts as `offline`.
   - `healthSummary`: `averageScore` and `degradedCount` (robots scoring below 60).
   - `recentHighSeverityEvents`: the latest `error` and `critical` telemetry events.
   - `activeDeploymentHealth`: `activeCount` and `deploymentIds` of the deployments in status `active`.
   - `empty` true: the workspace has no robots. Stop and point to `robot-enrollment`.
2. `workspaces.telemetry-fleet-rollups`: one card per fleet with `presenceRatio` (share online, 0 to 1), `eventRatePerHour`, `worstHealthRobots` (name, `score`, `factors`) and `empty` (no members). An empty list means the workspace has no fleets, not that nothing is wrong.
3. `robots.presence-bulk-by-scope` with exactly one of `workspaceId` or `fleetId`: presence keyed by robot id. Join with `robots.list` for names. A robot missing from the result never reported presence.

Presence, in the user's terms:

| `status` | Meaning | Tell the user |
| --- | --- | --- |
| `online` | connected and reporting | nothing to do |
| `stale` | was online, not heard from for more than 90 seconds (`reason` `not_heard_from`) | likely a network drop or a hung agent; it turns `offline` or `online` on the next report |
| `offline` | the robot disconnected | since when (`disconnectedAt`) and why (`reason`, for example `abrupt_disconnect`) |
| absent, or `data` null | never connected | enrollment is not finished: `robot-enrollment` |

Every reading carries `freshness`: `live`, `stale` (older than 90 seconds) or `backfilled` (arrived late, after the fact), plus `dataAgeMs`. `clockSkewed` true means the robot's clock is off by more than a minute: its event times are unreliable, say so before building a timeline on them.

For the readings of many robots at once, `robots.telemetry-snapshot-bulk-by-scope` returns presence, performance and sensor per robot in one call.

Done when: the user has the counts, the list of robots that are `offline` or `stale` with since-when, and the worst health scores.

### 2. Find robots behind on deployments

`deployment.compliance` with `workspaceId`, and `fleetId` when the user asked about one fleet. One row per robot: `activeArtifactVersion`, `responsibleDeploymentId`, `effectiveStatus`, `drifted`, `driftReason`.

- Drift is computed only with `fleetId`: a robot is `drifted` when its version differs from the fleet's active deployment. Without `fleetId` no robot is marked drifted, so call it once per fleet.
- `driftReason`: `pinned` (the robot has a version pin, intended), `offline` (waiting for the robot to reconnect), `version_mismatch` (the one to act on).
- Page with `offset` and `limit` until a page comes back short.

Done when: the user has the robots with `version_mismatch`, and knows that fixing them is `deployment-rollout`.

### 3. Look at one robot

| Question | Operation | Read |
| --- | --- | --- |
| Is it connected | `robots.presence` | table in step 1 |
| How loaded is it now | `robots.performance-latest` | `cpuPercent`, `memUsedBytes` of `memTotalBytes`, `loadOne`, `disks`, `network`, `uptimeSecs` |
| Power and temperature | `robots.sensor-latest` | `powerSource`, `batteryPercent`, `cpuTemperatureC`, `location` |
| One health number | `robots.telemetry-health-score` | `score` 0 to 100 and `factors` with a label each |
| Load over time | `robots.performance-history` | samples, or buckets with average, maximum and p95 |
| Did it drop off | `robots.connectivity-sessions` | `connectedAt`, `disconnectedAt`, `closeReason`, `durationMs` (null while connected) |
| How much was it up | `robots.telemetry-uptime` | `uptimePercent`, `downtimeIntervals`, `maintenanceExclusions`, `coverage` |
| Time in maintenance | `robots.downtime` | `totalMs`, `maintenanceMs`, `recordCount` since `since` |

- The health score weighs presence 40 percent, CPU and memory headroom 30 percent, and `error` or `critical` events in the last hour 30 percent. Quote the factor labels: they say which part pulled the score down. Reading the score recomputes and stores it.
- Windows take `since` and `until` (ISO instants) or `sinceRelative` and `untilRelative` (a duration before now such as `30m`, `24h`, `7d`). An absolute bound wins over the relative one.
- `robots.performance-history`: `resolution` `raw` (default, last 30 minutes) or `1m`, `1h`, `1d` buckets (default last 6 hours). Each tier serves a limited window: read the limits from `telemetry.resolution-tiers` and pick the finest tier that covers the window.
- `robots.telemetry-uptime`: `coverage.enrollmentBoundary` true means the robot was activated inside the window, so the percentage covers less than the window. Say that with the number.
- Many short sessions with the same `closeReason` is flapping: report the count and the pattern, not each session.

Done when: each question the user asked has a number, a time and a freshness.

### 4. Read telemetry events

`robots.telemetry-events` with `workspaceId` and a window (default the last 24 hours), newest first. Narrow with `robotId`, `severity`, `eventType`, `deploymentId` or `customTypeSlug`.

- `eventType`: `system_health`, `inference`, `task_execution`, `alert`, `custom`. `severity`: `info`, `warning`, `error`, `critical`, or none.
- For a fleet use `fleets.telemetry-event-rates`: counts per hour, type, severity and origin, over at most the first 500 events of the window.
- `search` is a full-text match over the payload. It ignores the other filters and `cursor`, so use it alone.
- Page with `pagination.nextCursor` as `cursor` until it is null.
- `timestampNs` is the robot's clock in nanoseconds; `receivedAt` is when rFabric received the event. `origin` says who recorded it: `robot` or `platform`.
- `unregistered` true: a custom event whose type slug the workspace has not declared. `telemetry-event-types.list` shows the declared types with their `defaultSeverity` and `payloadSchema`.
- `telemetry-events.get` returns one event by id; there the payload is in `data` and the storing time in `createdAt`.

Summarize: counts by severity and type, then the `error` and `critical` events one line each (time, robot, what the payload says). Do not paste payloads.

Done when: the user knows what the robots reported in the window and which events deserve a look.

### 5. Watch live

Use a stream when the user is waiting for something to happen (a robot to come back after a reboot, a load test). One `call_operation` reads the stream for `streamSeconds` (1 to 50, default 15) and returns the events it saw; call again to keep watching.

- `workspaces.presence-stream`: first a `snapshot` with every robot's presence, then one `presence` event per change.
- `robots.telemetry-stream`: first a `snapshot` (presence, performance, sensor), then `presence`, `performance` and `sensor` events as the robot reports.

Tell the user how long each read lasts and how long you will keep watching, for example "Watching rbt_... for 50 seconds at a time, up to 5 minutes". No event in a read means nothing changed in that time.

### 6. Fix the failure in time

Start from what the user has:

| Starting point | Read | Gives |
| --- | --- | --- |
| A TelemetryEvent (`tel_...`) | `telemetry-events.get` | `robotId`, `timestampNs`, `deploymentId`, `data` (the payload) |
| A robot and a rough time | `robots.telemetry-markers` | the robot's events in the window |

Then `robots.telemetry-markers` for the robot with a window around the moment (start with one hour each side): `events` are the robot's telemetry events (newest first, at most 200) and `deployments` are the workspace's deployments started in the window (at most 50). Add `robots.performance-history` and `robots.connectivity-sessions` over the same window (step 3) to see load and disconnects around it.

State the anchor to the user before going on: robot, moment, and the window you will use.

### 7. Establish what ran and what changed

| Question | Operation | Read |
| --- | --- | --- |
| Which version ran at that moment | `deployment.robots-version-timeline` with `from` and `to` | the last `activation` or `rollback` entry before the moment: `deploymentId`, `artifactVersion`, `status`; `attempt` entries show delivery attempts and their phases |
| What would a rollback return to | `deployment.robots-version-chain` | deployments behind the running version, newest first |
| The deployment itself | `deployments.get` | artifact, status, who started it |
| Was it in service | `robots.lifecycle-history` | the state interval covering the moment (`enrolled`, `active`, `maintenance`, `retired`), actor and reason |
| Where was it | `robots.placement-at` with `at` | the site placement in effect |
| Who changed the robot | `audit-logs.entity-history` with `entityType` `robot` and `entityId` | `action`, `actorId`, `occurredAt`, `before`, `after`, newest first |
| Who changed a sensor or part | `devices.list` with `robotId`, then `audit-logs.device-timeline` with `deviceId` | the device's audit entries; `completeThrough` is the newest entry's time |

- An event's own `deploymentId` (step 6), when set, is the direct answer to "which deployment". Use the version timeline when it is null.
- An empty version timeline means nothing was deployed to the robot through rFabric. Say that; do not infer a version.
- Audit entries can hold configuration values in `before` and `after`. Report what changed and who changed it, not the values.

A change shortly before the failure (a deployment activation, a configuration edit, a device replacement, a move to another site) is the first suspect. Name it with its time difference to the failure.

### 8. Collect what happened around it

| Evidence | Operation | Filter |
| --- | --- | --- |
| Recordings | `episodes.list` | `robotId`, `capturedAtFrom`, `capturedAtTo`; add `hasIntervention` for the ones a human corrected |
| Human takeovers | `intervention-sessions.list` | `workspaceId`, `robotId`; keep the ones whose `requestedAt` falls in the window |
| Their outcomes | `intervention-events.list` | `robotId` or `deploymentId`; `outcome` is `success`, `partial`, `failure`, `terminate` or `rerecord` |
| Evaluations on the robot | `evaluation-runs.list` | `workspaceId`, `dimension` `{"robot_id": "<robot id>"}`, `sort` `startedAt:desc`; keep the runs whose `startedAt` is in the window |
| The chain behind the version | `lineage.get` | path `id` the deployment id, `direction` `up`, `mode` `summary` first |

- `lineage.get` walks from the Deployment up to the Artifact, Model, TrainingRun, DatasetVersion and Episodes behind it. `mode` `summary` gives counts per type; `graph` gives the nodes, up to `depth` 10. A deeper graph is refused with `lineage_too_large` (422): start a query job with `lineage.create-queries` (`rootId`, `workspaceId`, `direction`, `depth`) and poll `lineage.get-queries` until `status` is `completed` or `failed`.
- No episode in the window means the robot was not recording. Say it: the failure then has telemetry only.

Close the investigation with one timeline table (time, what, source id) and a short reading: what failed, what changed before it, what evidence exists, what is unknown.

### 9. Keep it: compare, dashboard, export

**Compare** robots or fleets: `telemetry.compare` with 1 to 10 `subjects` (`kind` `robot` or `fleet`, `id`) and a window. It returns one CPU trace per subject; a fleet trace is the average of its members (`fleet_aggregate`). `series` is required and is echoed back as the name of the series.

**Dashboard**: `workspaces.list-telemetry-dashboards` first, to reuse one. `workspaces.create-telemetry-dashboards` creates one owned by the user, private unless `shared` is true. Widgets sit on a grid (`x`, `y`, `w`, `h`). The app draws two widget types, both for one robot named in `configuration.robotId`:

```json
{
  "name": "Line 3 arms",
  "shared": true,
  "widgets": [
    { "id": "status", "type": "live_card", "x": 0, "y": 0, "w": 1, "h": 1, "configuration": { "robotId": "rbt_..." } },
    { "id": "cpu", "type": "chart", "x": 1, "y": 0, "w": 2, "h": 1, "configuration": { "robotId": "rbt_...", "series": "cpuPercent" } }
  ]
}
```

`series` is `cpuPercent` or `memUsedRatio`. `telemetry.update-dashboards` replaces the whole `widgets` list, so send every widget, not only the changed one. Read the result back with `telemetry.get-dashboards`.

Give the user the link: `https://app.rfabric.io/<organization slug>/<workspace slug>/telemetry/dashboards/<dashboard id>`, with `slug` from `organizations.get` and `workspaces.list`.

**Export** telemetry events: page `robots.telemetry-events` over the window (step 4) and write the events to a JSONL or CSV file in the working directory. Tell the user the path, the row count, the window and the filters.

**Custom event type**: `telemetry-event-types.create` declares a custom event type (`slug`, `displayName`, `defaultSeverity`, `payloadSchema`), so events of that type stop arriving as `unregistered`. List before declaring: `telemetry-event-types.list`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `data` null from `robots.presence`, `robots.performance-latest` or `robots.sensor-latest` | the robot never reported that kind of telemetry | check the others; when all are null the robot never connected: `robot-enrollment` |
| Presence `online` but performance `freshness` `stale` | connected, yet samples stopped | report both facts; the telemetry service on the robot may be stuck, the robot's owner checks `rfabricd` on it |
| `clockSkewed` true | the robot's clock differs from rFabric's by more than a minute | trust `receivedAt` and `createdAt` over robot timestamps and tell the user to fix time sync on the robot |
| 400 on a window parameter | a relative window in another form than `<n>s`, `m`, `h`, `d` or `w` | resend as `30m`, `24h`, `7d` or an ISO instant |
| 403 on a robot or workspace read | the user has no access to that workspace | name the workspace; `member-access` finds why it is out of reach and what can add it |
| `permission_denied` (403) on the audit calls | the user lacks `auditLog:read` | continue without the audit trail and say so |
| `NOT_FOUND` (404) | the id is from another workspace or was removed | find it again with the list operation |
| `invalid_id` (400) from `lineage.get` | the root id is not an rFabric id | pass the deployment, artifact or model id as returned by rFabric |
| 422 from `workspaces.create-telemetry-dashboards`, or a refused `telemetry.update-dashboards` | a widget names a robot outside the workspace | fix `configuration.robotId` |

## Done when

Health check:

- [ ] Counts from `workspaces.telemetry-overview` reported, with `refreshedAt`.
- [ ] Every robot that is `offline` or `stale` named, with since-when and reason, from `robots.presence-bulk-by-scope`.
- [ ] Robots with `version_mismatch` named per fleet, from `deployment.compliance`, or the user told that no fleet exists to compare against.
- [ ] The worst health scores explained by their factors.

Investigation:

- [ ] Robot, moment and window stated.
- [ ] The deployment and artifact version at that moment named, from the event's `deploymentId` or `deployment.robots-version-timeline`, or stated as none.
- [ ] Changes before the failure listed, from `robots.lifecycle-history` and, with permission, `audit-logs.entity-history`.
- [ ] Episodes, interventions and evaluation runs in the window listed with ids, or stated as none.
- [ ] What is still unknown said plainly.

## Next

- `robot-maintenance`: open a maintenance record for the robot and take it out of service.
- `intervention-session`: take over a robot that needs a human now.
- `deployment-rollout`: roll a bad version back or bring drifted robots up to date.
- `episode-search`: go through the recordings around the failure.
- `dataset-curation`: turn the failure's episodes into training or evaluation data.
- `audit-review`: a wider audit question than one robot.
- `fleet-inventory`: fleet reports, such as utilization per robot.

## The rfabric CLI

They need a signed-in CLI with the workspace set; `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| List robots | `rfabric robot ls` |
| Read one robot | `rfabric robot get <robot-id>` |
| Telemetry events of a robot | `rfabric telemetry-event ls -f robotId=<robot-id> --sort timestampNs:desc` |
| One telemetry event | `rfabric telemetry-event get <event-id>` |
| Any read under `/api` | `rfabric api get "/api/robots/<robot-id>/lifecycle-history"` |
