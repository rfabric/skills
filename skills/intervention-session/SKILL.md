---
name: intervention-session
description: >-
  A person in remote control of a robot, or supervising one, in a recorded intervention session that ends with an outcome, plus the operator team and analytics behind it. Use when the user wants to teleoperate, take over, drive, recover or watch a robot remotely, hand control to another operator, decide a proposed action, release a stuck session, review a session's timeline or correction segments, set up operator pools, routing or availability, or see intervention rates. Not for repairing the robot: that is `robot-maintenance`. Not for recording datasets: `robot-recording`.
---

# Intervention sessions

The user ends up with a robot recovered or driven by a person, and a session that records who held it, what happened and how it ended.

- **InterventionSession** (`ivs_...`): one request for a person to take over or watch one Robot (`rbt_...`), from request to outcome.
- **Participant** (`ivsp_...`): a person in a session, as `primary` (holds control) or `observer`.
- **InterventionEvent** (`iev_...`): the durable record written when a session ends.
- **Correction segment** (`ivsg_...`): a span of operator control kept as training data.
- **Proposal** (`ivpr_...`): an action one participant proposes and another approves or rejects.

You prepare and follow the session. The person drives, in the operator console of the rFabric app. You never send motion, and you do not join the video.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the robot is ready | agent | `robots.get`, `robots.presence`, `robots.maintenance-exclusion-state`, `intervention-sessions.list` | none |
| 2 | Prepare the robot, once per robot | user, on the robot | none | the user's work |
| 3 | Request the session | agent | `intervention-sessions.create` | none |
| 4 | Claim it for the operator | agent | `intervention-sessions.claim` | none |
| 5 | Check readiness and start | agent | `intervention-sessions.preflight`, `intervention-sessions.context`, `intervention-sessions.start` | the robot joins: `live`, within the 5-minute invite |
| 6 | Drive | user, operator console in the rFabric app | none | the person's work |
| 7 | Follow, hand off, decide proposals | agent | `intervention-sessions.get`, `intervention-operations.sessions-participants`, `intervention-sessions.handoff`, `intervention-sessions.handoff-decision`, `intervention-operations.sessions-proposals`, `intervention-operations.proposals-decision` | status changes |
| 8 | End with an outcome | user in the console, or agent | `intervention-sessions.end` | none |
| 9 | Review: timeline, recording status, corrections | agent | `intervention-sessions.transitions`, `intervention-operations.sessions-correction-segments`, `intervention-operations.segments`, `intervention-events.get` | none |

Operator pools, routing rules, SLA configs, availability and auto-assignment: read `team-setup.md` in this skill's directory when the user sets up or tunes the operator team, or a request sits unrouted.

## Before you start

- **Permissions** (as a refusal names them): `interventionSession:control` to request, claim, start, hand off, end, cancel and force release; `robot:intervene` in addition to claim; `interventionSession:view` to read and observe. The built-in role `operator` carries all three, as do `admin` and `owner`; `member` only views. Control calls need a signed-in person: a service identity is refused. The organization's gate policy for robot intervention can add rules to claiming, for example that the requester may not claim their own request.
- **Needs**: the Robot enrolled and online (`robot-enrollment`), `active` and not in maintenance mode (`robot-maintenance`), and prepared for remote control (step 2).
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which robot | a session is for one robot | `robots.list` with `search`; ask only when several match |
| Who drives | that person must claim and open the console | default the user; another operator claims in their own session |
| Why | `reason` on the request and in the closing record | the user's words |
| Is someone at the robot, with an emergency stop | remote control moves hardware near people | no default: ask before starting |

## Who controls the robot

These calls change who controls the robot. Before each one, in every step below, tell the user its line from this table; then make the call.

| Call | After it | Tell the user |
| --- | --- | --- |
| `intervention-sessions.claim` | the caller holds the session (`claimedOperatorId`): only they get a join token. The robot shows as teleoperated and the console refuses other operators. | "You now hold this robot. Nobody else can drive it until you end, hand off or are released." |
| `intervention-sessions.start` | the robot is invited, joins, streams its cameras and accepts the holder's commands | "From now the robot can move under remote control. Someone at the robot should have the emergency stop." |
| `intervention-sessions.handoff` | nothing yet: both people are `handoff_pending` until the target decides | "You keep control until the other operator accepts." |
| `intervention-sessions.handoff-decision` with `accept: true` | the caller becomes the holder and `primary`; the previous operator becomes an `observer` and their console stops driving | "Control moves to you. The previous operator should stop the robot first." |
| `intervention-sessions.force-release` | a `claimed` session returns to `requested` with no holder; anyone allowed can claim it. It does not work on a `live` session. | "The operator loses the session before it went live." |
| `intervention-operations.staffing-sessions-auto-assign` | the session is claimed for the first available qualifying operator, who did not ask for it | "An operator is assigned and must open the console." |
| `intervention-operations.sweep` | every claim past its release time returns to `requested` with no holder; `live` sessions are untouched | "Operators whose claim is past its release time lose that session." |
| `intervention-sessions.end` | the session is `completed`; the robot leaves, stops streaming and stops taking commands. An arm holds its present position: it does not return home or power down. | "Remote control ends now for whoever is driving." |
| `intervention-sessions.cancel` | a session that never went live is withdrawn; nobody had control | "The request is withdrawn. Nothing moves." |
| "Teleoperate" in the operator console | the console requests, claims and starts in one go: the user holds the robot, and it can move once it joins | the lines for claim and start, inside the "Your turn" block of step 6 |

If the robot loses its connection mid-session, the session becomes `failed` and the follower holds position once commands stop arriving. Remote control is not a safety system: the emergency stop at the robot is.

## Steps

**Shortest path.** When the user drives now and the request needs no context (`reason`, `priorityLevel`, `deploymentId`, `skillTags`, a `type` other than `teleoperation`), do steps 1 and 2, then hand over with step 6: in the console **Teleoperate** requests, claims and starts the session by itself once the robot is ready, so nothing holds the robot before the person is seated. Follow from step 7. Do steps 3 to 5 yourself when the request needs that context or another operator takes it from the queue; then claim and start only once the operator says they are at the console.

Responses: `intervention-sessions.list` returns `{"data", "pagination"}`; the other session calls return the session itself as `body`, without a `data` wrapper.

### 1. Check the robot is ready

1. `robots.get`: `lifecycleState` must not be `maintenance` or `retired`. For `maintenance`, `robots.maintenance-exclusion-state` names the record that holds the robot: that is `robot-maintenance`.
2. `robots.presence`: must be `online`.
3. `intervention-sessions.list` with `robotId` and `activeOnly: true`: a session in `claimed` or `live` means someone holds the robot (`claimedOperatorId`). If it is the user, resume it (step 6). If it is someone else, see handoff and force release in step 7.

Tell the user the four conditions and which one fails: enrolled, not in maintenance mode, online, free.

### 2. Prepare the robot (once per robot)

Skip when an earlier session on this robot reached `live` and its stop check passed (`preflightResults` has `stopPathVerified` true). Before handing over, check that nothing runs on the robot (`intervention-sessions.list` with `robotId` and `activeOnly: true`, and `robot-recording` for a recording session): the restart in this block ends it.

```text
Your turn - a terminal on the robot (its own keyboard, or SSH), with sudo. Linux, installed from the rFabric package.
Who: whoever administers the robot's computer.
Why: the robot needs the rfabricd build that carries live video, and a follower process that turns the
operator's input into motor commands. Without the follower the operator sees video and nothing moves.

1. Check the build:
     rfabricd version --output json
   "variant" must be "media". If it is "core", or the command is not found, stop and tell me:
   the robot runs the minimal build (rfabricd-core), which has no live video and cannot join a session.
2. Cameras, in /etc/rfabric/rfabricd.toml (edit with sudo): one block per camera the operator should see
   (with none, one default camera is published):
     [[media_bridge.cameras]]
     track_name = "head"
     device = "/dev/video0"
   Add  rotation = 180  for a camera mounted upside down (0 and 180 only).
3. Control bridge, in the same file: under [lerobot_bridge] set
     enabled = true
     socket_path = "/run/rfabric/control.sock"
4. Follower. Copy the template the package ships, /etc/rfabric/arms.env.example, to /etc/rfabric/arms.env
   (mode 0600, owned by rfabric:rfabric) and edit it for your arms: robot type, serial ports, calibration id.
   It documents a bimanual and a single-arm SO-101 on stock LeRobot. Install the follower into the
   Python environment the file names (the rfabric user must be able to read it), with the command it gives:
     uv pip install --python /opt/rfabric/arms/.venv/bin/python 'lerobot[feetech]' lerobot-teleoperator-rfabricd
5. Apply: restart rfabricd so it reads the config, then start the follower now and at every boot:
     sudo systemctl try-restart rfabricd
     sudo systemctl enable --now rfabric-arms
6. Check both run without errors (Ctrl+C leaves the log):
     sudo journalctl -u rfabricd -u rfabric-arms -f
7. Put a hardware emergency stop within reach of a person at the robot, and clear the workspace.

Creates on the robot: the two config sections, /etc/rfabric/arms.env and the running rfabric-arms service.
Undo: sudo systemctl disable --now rfabric-arms, set enabled = false under [lerobot_bridge], and restart rfabricd as in action 5.
Bring back: tell me when it is done, and the camera names you set.
Then I: confirm the robot is online again. The first session proves the follower: its stop check must pass
before the console lets you move.
```

Another follower, such as `rfabric-yam-bridge` for i2rt YAM arms, goes into the same `/etc/rfabric/arms.env` in place of the LeRobot command.

### 3. Request the session

`intervention-sessions.create` with `workspaceId`, `robotId`, `type`, and when known `reason`, `priorityLevel`, `deploymentId`, `skillTags`.

- `type`: `teleoperation` to drive, `correction` to fix a running policy's mistake, `override`, `assistance`, `demonstration`. Analytics count `teleoperation` and `correction` as takeovers.
- `priorityLevel` (`critical`, `high`, `normal`, `low`) and `skillTags` feed routing. `routingStatus` on the response says where it went: `routed` (to `operatorPoolId`), `unassigned` (no rule matched: anyone allowed can claim it), `pending`, `escalated`.
- A robot runs one live session at a time. A request made while another is live waits; its `meta.queuedBehindSessionId` names the session it is queued behind.

The session starts as `requested`.

| `status` | Meaning for the user |
| --- | --- |
| `requested` | waiting for an operator |
| `claimed` | an operator holds it; the robot has not joined |
| `live` | the robot joined: video streams, the holder can drive, the recording runs |
| `completed` | ended with an outcome; final |
| `failed` | the robot left the session; final |
| `cancelled` | withdrawn before it went live; final |

### 4. Claim it for the operator

Say first (Who controls the robot): the user becomes the holder and nobody else can drive this robot. Then `intervention-sessions.claim` with an empty body. You call as the user, so claim only when the user is the one who will drive. Another operator claims in their own session (their agent, or the queue at `https://app.rfabric.io/<org-slug>/<workspace-slug>/operate/live`; slugs from `organizations.get` and `workspaces.list`).

To leave a claimed session before it is live: say that the request is withdrawn, then `intervention-sessions.cancel` with `reason`.

### 5. Check readiness and start

1. `intervention-sessions.preflight` with an empty body. It stores `preflightResults` on the session (`overall`: `pass`, `warn` or `fail`, and `checks`) and changes nothing else.

| `check` | Passes when | If it fails |
| --- | --- | --- |
| `robot_online` | the robot's presence is `online` | bring the robot online |
| `media_capable` | the robot's rfabricd build carries live video | the robot runs `rfabricd-core`, which cannot join a session: stop and say so (`robot-enrollment`, Decisions) |
| `session_claimed` | the session is `claimed` or `live` with a holder | claim first (step 4) |
| `stop_path` | the follower acknowledged a stop sent to the robot | `skip` before the session is live: the console runs it once the follower answers |

2. `intervention-sessions.context`: the limits for this robot. Tell the user before they drive: `deadmanRequired` (hold a key to drive), `speedCapPercent`, `lockoutThresholdMs` and `lockoutReenableThresholdMs` (control locks when the round trip is slower than the first and returns below the second), `requireVerifiedStopPath` (no motion until the stop check passed).
3. Confirm with the user that they are at the console and that someone at the robot has the emergency stop. Say first: from now the robot can move under remote control. Then `intervention-sessions.start` with an empty body. It runs the checks again and refuses on a failed one (422, the report is `preflight` in `details`), then invites the robot. Do not send `skipPreflight`.
4. The status stays `claimed` until the robot joins. Poll `intervention-sessions.get` every 5 seconds for `live`, and tell the user you wait for the robot to join. The invite is valid for 5 minutes: if the session is still `claimed` after that, cancel it and see Problems.

From `live` the session is recorded.

### 6. Drive

```text
Your turn - rFabric app in your browser, operator console
Why: you drive. I cannot send motion or see the video; I follow the session and keep the record.

1. Open https://app.rfabric.io/open/<robotId> and choose "Teleoperate". From that click you hold this robot:
   nobody else can drive it, and once it joins it can move under your control. Have someone at the robot
   with the emergency stop. (The button reads "Open console" when you already hold a session on this robot.)
2. Wait for the video. The console checks that the robot stops on command; when the workspace requires it, you cannot move before it passes.
3. When the workspace requires a deadman (`teleop.deadmanRequired`, on by default), hold Space to drive and release to stop; otherwise the keys and gamepad drive directly. Esc is the emergency stop: motion then stays off until you re-arm it.
   The keyboard icon lists the keys this robot accepts; a connected gamepad works too.
4. When you are finished choose "End session" and pick how it went: Success, Partial, Failed or Re-record.

Limits for this session: speed capped at <speedCapPercent> %, control locks above <lockoutThresholdMs> ms round trip.
Bring back: tell me when you ended it, or the exact message on screen if something blocks you.
Then I: confirm the session is completed and report how it ended and whether it was recorded.
```

Fill the limits from step 5; on the shortest path leave that line out. When you already claimed and started the session (steps 4 and 5), the button reads "Open console": replace action 1 with "choose Open console" and drop the sentence about the click. The console gets its own join token from `intervention-sessions.connect-token`: a credential for the robot's control channel, valid 5 minutes and issued only to the holder. Do not call that operation yourself, since the token would land in this conversation.

### 7. Follow, hand off, decide proposals

- **Follow**: `intervention-sessions.get` every 15 to 30 seconds while `live`; report status changes, not polls. `intervention-operations.sessions-participants` lists who is in the session with `role`, `status` and `handoffStatus`.
- **Observe**: `intervention-sessions.observe` adds the user as an `observer` without control. Call it once: each call adds a participant record. An observer follows the session's state, timeline and proposals; the live video is in the holder's console.
- **Hand off** to another operator: say first that the user keeps control until the other operator accepts. The holder calls `intervention-sessions.handoff` with `targetUserId` (`membership.members` finds it). The target accepts in their own session with `intervention-sessions.handoff-decision` and `accept: true`, then opens the console as in step 6: before that call their agent says that control moves to them and the previous operator's console stops driving. Ask the current operator to stop the robot before the target accepts. `accept: false` leaves control where it was.
- **Force release** a holder who does not respond, before the session is live: say first that this operator loses the session and anyone allowed can claim it. Then `intervention-sessions.force-release` with `operatorId`, the session's current `claimedOperatorId`. A `live` session cannot be released: end it.
- **Proposals**: a participant proposes an action with `intervention-operations.sessions-proposals` (`description`, optional `parameters` and `preview`, `expiresInSeconds` from 30 to 3600, 120 when omitted). Keep the returned `ivpr_...` id: there is no list. Another participant decides with `intervention-operations.proposals-decision` (`approve`, optional `reason`). rFabric records the decision and does not execute anything: the operator acts on an approved proposal. Statuses: `pending`, `approved`, `rejected`, `expired`, `escalated`.
- **Notes on the timeline**: `intervention-sessions.timeline` with `kind` and `detail` records what the operator reports, for example an incident.

### 8. End with an outcome

The operator ends in the console. End it yourself with `intervention-sessions.end` when the user asks, or when the console is gone and the session still holds the robot. Say first: remote control ends now for whoever is driving; an arm holds its present position.

- `outcome`: `success`, `partial`, `failure`, `rerecord` (the take must be recorded again), or `terminate` (stopped without a result).
- Optional `reason`, `episodeId` (the Episode captured during the session) and `duration` in seconds; without `duration` the time since the session went live is used.
- It ends any session that is not final, writes the InterventionEvent (`interventionEventId` on the session) and tells the robot to leave. Calling it on a final session changes nothing.

Done when `intervention-sessions.get` shows `completed` with the `outcome`.

### 9. Review: timeline, recording, corrections

- **Timeline**: `timeline` on the session lists what happened with `at`, `kind` and the actor (`requested`, `claimed`, `start_invited`, `robot_joined`, `e_stop`, `re_arm`, `ended`, `cancelled`). `intervention-sessions.transitions` lists each status change with who caused it.
- **Recording**: `recordingStatus` is `pending`, `recording`, `recorded`, `partial` (cut short) or `unrecorded` (`recordingFailureReason` says why). Report it with the session.
- **Correction segments**: `intervention-operations.sessions-correction-segments` records a span of operator control (`startedAt`, `endedAt`, `frameCount`) on the session's robot and episode. `intervention-operations.segments` lists them, newest first, with `query` `workspaceId` and optional `sessionId`, `robotId`, `since`, `until`, `page`, `limit` (up to 200); each carries its `controlStreamRef` and `episodeId`.
- **Closing record**: `intervention-events.get` with the session's `interventionEventId`; `intervention-events.list` filters by `robotId`, `deploymentId`, `type`, `outcome`. An intervention that happened without a session (a person corrected the robot by hand) is logged with `intervention-events.create`.

## Analytics

All four take `workspaceId` and `since`, optional `until`, and the filters `robotId`, `fleetId`, `modelVersionId`, `taskId`, `deploymentId`, `operatorId`. They count sessions by request time.

| Question | Operation | Reading |
| --- | --- | --- |
| Which robots, fleets, models or tasks need the most help | `intervention-analytics.summary` with `groupBy` (`robot`, `fleet`, `modelVersion`, `task`, `deployment`) | per group: `sessionCount`, `interventionRate`, `timeToClaim` and `timeToResolution`, `outcomeMix` |
| Did a model version make autonomy better or worse | `intervention-analytics.model-delta` | per model version, deployment and task: `interventionRate`, `baselineRate`, `delta` |
| How loaded are the operators | `intervention-analytics.workload` | per operator: `sessionCount`, `controlHours`, `outcomeMix`, `rerecordRate` |
| How much intervention becomes training data | `intervention-analytics.funnel` | `takeovers`, `correctionEpisodesCaptured`, `curatedDatasetInclusions`, `conversionRate` |

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `CONFLICT` (409) on claim | the session is already claimed or final | read it: `claimedOperatorId` says who holds it |
| `FORBIDDEN` (403) on claim, `details` has `reason` `gate_policy` | the organization's gate policy refuses this person, for example the requester claiming their own request | another operator claims; an organization admin owns the policy |
| `CONFLICT` (409) on claim, `details` has `reason` `approvals_pending` | the approval was recorded and more approvers are required | report `partialApprovals`; the next approver claims |
| 403 naming `robot:intervene` or `interventionSession:control` | the user lacks the permission | name the permission; `member-access` finds why it is missing and what can add it |
| `VALIDATION_ERROR` (422) on start, `preflight` in `details` | a readiness check failed | read each failed `check` and its `reason`; fix per the table in step 5 |
| `stop_path` is `fail` or `warn` with a `reason` | `timeout` or "follower did not acknowledge stop": the follower is not answering. "no follower bridge active": the bridge is off or the session is not live. | on the robot check `rfabric-arms` and the `[lerobot_bridge]` section (step 2); the console retries the check |
| still `claimed` 5 minutes after start | the robot did not join: it runs `rfabricd-core`, a camera failed, or it is offline | `robots.presence`; on the robot `sudo journalctl -u rfabricd -f` and ask for what it prints; cancel the session and request a new one |
| `failed`, `meta` has `failureReason` `robot_disconnected` | the robot left mid-session; the follower holds position | check the robot and its network, then request a new session |
| console says "Another operator holds this session." | the user is not `claimedOperatorId` | hand off or force release (step 7) |
| console says "Out of service", "Robot is not online" or "Another operator is driving" | the robot is in maintenance mode, offline, or held | `robot-maintenance`, step 1, or step 7 |
| 404 on `intervention-sessions.handoff` | the caller is not an active participant | only the current holder hands off |
| 409 on `intervention-sessions.force-release` | the session is not `claimed` by that operator, or it is `live` | use the current `claimedOperatorId`; end a live session |
| 409 on cancel | the session is `live` or final | end a live session instead |
| 409 on a proposal decision | already decided or expired | propose again |

## Done when

- [ ] `intervention-sessions.get` shows the session `completed` with an `outcome`, or `cancelled` with its `cancelReason`, and no session of the robot is left `claimed` or `live` (`intervention-sessions.list` with `activeOnly: true`).
- [ ] The user knows who held the robot and for how long (`liveAt` to `endedAt`).
- [ ] You reported the session id, the `interventionEventId` and the `recordingStatus`.

## Next

- `dataset-curation`: turn correction episodes into training data.
- `robot-maintenance`: open a record when the intervention found a hardware fault.
- `fleet-monitoring`: watch the robot after it returns to autonomy.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Request | `rfabric intervention-session request --robot-id <robot-id> [--type correction] [--priority-level high] [--reason "..."]` |
| Claim, start | `rfabric intervention-session claim <session-id>`, `rfabric intervention-session start <session-id>` |
| Readiness | `rfabric intervention-session preflight <session-id>` |
| Follow | `rfabric intervention-session get <session-id>`, `rfabric intervention-session transitions <session-id>` |
| End, cancel | `rfabric intervention-session end <session-id> --outcome success [--reason "..."]`, `rfabric intervention-session cancel <session-id> --reason "..."` |
| Correction segments | `rfabric intervention-segments query [--session-id <session-id>]` |
| Analytics | `rfabric intervention-analytics summary\|model-delta\|workload\|funnel --since <RFC3339>` |
