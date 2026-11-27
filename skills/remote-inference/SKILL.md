---
name: remote-inference
description: >-
  A robot driven by a model running on rFabric compute: an Artifact served as an inference source in the robot's session, watched, re-prioritised, taken over by an operator and ended. Use when the user wants to run, serve or try a model or policy on a real robot from the cloud, run two models on one robot, declare the robot's embodiment and motion limits, or see which source drives an arm. Not for installing a model on the robot: `deployment-rollout`. Not for a person driving: `intervention-session`.
---

# Remote inference

The user ends up with a robot driven by a model that runs on rFabric compute, with someone able to take over at any moment, and a session record of who drove each arm and how well.

- **InteractiveMediaSession** (`ims_...`): the robot's room: its cameras and state, the control roster, the recording. One `starting` or `live` session per robot; interventions and inference sources share it.
- **Participant** (`imsp_...`): a member of the session: the robot, an operator (a person in an intervention) or an inference source.
- **Inference source**: an Artifact's (`art_...`) `inference_server` image, run on a compute pool as a room participant that commands some action groups of the robot.
- **Embodiment**: on the Robot (`rbt_...`), what it offers a model: control rate, state components, action groups (one per arm), cameras. Each session freezes a copy.

The robot picks one source per action group on every control tick: the highest `priority`, or the `freshest` observation. It limits every command to the group's `maxRate`, so a change of source never jumps. An operator always outranks a model. When no source has an action for a group, the arm holds, then stops after the group's `holdS`.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the robot | agent | `robots.get`, `robots.presence`, `interactive-media-sessions.list` | none |
| 2 | Prepare the robot, once per robot | user, on the robot | none | the user's work |
| 3 | Declare the robot's embodiment | agent, values from the user | `robots.update` | none |
| 4 | Pick the Artifact | agent | `artifacts.list`, `artifacts.get` | none |
| 5 | Start the session with its sources | agent | `interactive-media-sessions.create` | none |
| 6 | Wait for live and ready | agent | `interactive-media-sessions.get` | the robot joins (up to 5 minutes), each source warms up |
| 7 | Watch | agent; the user in the rFabric app | `interactive-media-sessions.get` | the user's run |
| 8 | Change the sources | agent | `interactive-media-sessions.create-participants`, `interactive-media-sessions.update-participants`, `interactive-media-sessions.delete-participants` | the new source is `ready` |
| 9 | Take over and release | a person, operator console | `intervention-session` | the person's work |
| 10 | End and review | agent | `interactive-media-sessions.end`, `interactive-media-sessions.recording-url` | none |

## Before you start

- **Permissions** (as a refusal names them): `interactiveMediaSession:start` and `robot:intervene` to start and end a session; `interactiveMediaSession:manageSources` (with `robot:intervene` to add) for sources; `interactiveMediaSession:view` to read. `owner`, `admin` and `operator` carry all of them; `member` and `reviewer` only read.
- **Needs**: the Robot enrolled, online and not in maintenance mode (`robot-enrollment`, `robot-maintenance`), running the `rfabricd` build with live video and a follower (step 2); a `ready` Artifact whose `inference_server` layer names an image repository (`artifact-build`). The image is the candidate a simulation suite runs: `rfabric-candidate serve` around the user's `Policy`; the same image serves the robot.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which robot | a session is for one robot | `robots.list` with `search` |
| Which Artifact, for which arms | the source and its `groups` | `artifacts.list` with `status` `ready`; default every action group |
| `maxRate` per arm | how fast the robot lets any source move each joint | no default: the user's value in the arm's units per second; start low |
| Is someone at the robot, with an emergency stop | a model moves hardware near people | no default: ask before starting |

## Decisions

Where the model runs (`pool` of each source):

| Option | Choose when | Consequence |
| --- | --- | --- |
| `inference-cpu` (recommended first) | a small policy, or a first try | 4 vCPU, 8 GiB per source |
| `inference-gpu` | the model needs a GPU to keep up with the control rate | 4 vCPU, 14 GiB and one NVIDIA L4 per source |

Each source holds its machine until it leaves the session, for 24 hours at most.

How sources share the robot:

| Option | Choose when | Consequence |
| --- | --- | --- |
| One source on every group (recommended) | one model drives the robot | nothing to rank |
| Sources on different groups | one model per arm, or arms and base apart | each group has its own source |
| Two sources on one group, `selection` rule `priority` | a fallback model | the higher `priority` drives while it has actions; the other takes over on the next tick when it stops |
| Two sources on one group, `selection` rule `freshest` | lower and steadier delay | the source with the newer observation drives; a switch needs `switchMarginTicks` (default 2) ticks of advantage |
| A source with `standby` true | compare a model without letting it drive | admitted and measured, never selected |

An evaluation's source (`evaluation-job`) joins `standby` and stays `standby` for the whole run: the robot drives it only inside its timed rollout, and the source leaves when the run ends. Do not change its `standby` yourself.

## Steps

### 1. Check the robot

1. `robots.get`: `lifecycleState` not `maintenance` or `retired`; read `embodiment` (null: step 3 declares it).
2. `robots.presence`: `online`.
3. `interactive-media-sessions.list` with `robotId`: a session in `starting` or `live` is the robot's open session. There is at most one: add sources to it (step 8) instead of starting another. Its `participants` say who is in it.

### 2. Prepare the robot (once per robot)

Skip when an intervention on this robot already went live with its stop check passed. Otherwise hand the user step 2 of `intervention-session`: the rfabricd build with live video, cameras, the control bridge and the follower service. Add to that block:

```text
- The follower must declare that it holds position: lerobot-teleoperator-rfabricd and rfabric-yam-bridge do.
- Name each camera (track_name) as the model names its camera inputs.
- Set the follower's home pose (--teleop.home_pose for LeRobot; --home, --left-home, --right-home for
  rfabric-yam-bridge): an operator's Home drives the arms there.
```

The robot checks the rest itself when a session with a model starts: the follower answers within 5 seconds, holds position, and acknowledges a stop.

### 3. Declare the robot's embodiment

`robots.update` with `embodiment`. It must describe the follower exactly: rfabricd compares a fingerprint of the two and refuses the session when they differ (`embodiment_fingerprint_mismatch`).

| Follower | Action groups (`target` `joints`, `mode` `position`) | State components | Fingerprint |
| --- | --- | --- | --- |
| LeRobot SO-101, bimanual | `left`, `right`: `shoulder_pan`, `shoulder_lift`, `elbow_flex`, `wrist_flex`, `wrist_roll`, `gripper` | `left_position`, `right_position` (`quantity` `joint_position`, same joints) | 4199509803 |
| LeRobot SO-101, one arm | `arm`, the same joints | `arm_position` | 3280823783 |
| YAM with gripper, one arm | `arm`: `joint1` to `joint6`, `gripper` | `arm_position` (`joint_position`), then `arm_velocity` (`joint_velocity`) | 2947396534 |
| YAM with grippers, bimanual | `left`, `right`, as one arm | per arm, position then velocity | 622219696 |

Groups and components follow the follower's arm order. Units are the follower's: degrees for SO-101 (gripper 0 to 100), radians for YAM (gripper 0 to 1).

```json
{
  "controlRateHz": 30,
  "state": { "components": [
    { "name": "arm_position", "quantity": "joint_position", "joints": ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"] }
  ] },
  "actions": { "chunkSize": 50, "groups": [
    { "name": "arm", "target": "joints", "mode": "position", "joints": ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"], "maxRate": 30 }
  ] },
  "cameras": [{ "name": "wrist", "width": 640, "height": 480, "fps": 30 }]
}
```

The numbers above show the shape only; take each from the user or the model:

- `controlRateHz` and `actions.chunkSize`: the model's control rate and the rows it returns per inference. A different control rate refuses the source.
- `maxRate` on every position or pose group: required for a model. One number for every joint, or one per joint. Optional `maxAcceleration`, per second squared.
- `low` and `high` per joint: optional; values outside are clipped (`clip` false drops them instead).
- `holdS` (default 0.5) and `onStale` (`hold`): how long an arm holds without an action before it stops.
- `cameras`: names, size and rate as the model consumes them. The robot publishes at that size.
- Do not send `size`, `names` or `width`: rFabric derives them (`embodiment_derived_field`).

Tell the user: this embodiment also applies to every intervention on the robot, and its `maxRate` caps the operator's joint targets and Home.

### 4. Pick the Artifact

`artifacts.get`: `status` `ready` and an `inference_server` layer with `repository`. The session compares the Artifact's model embodiment with the robot's when the source is added and refuses a blocking difference (Problems).

### 5. Start the session with its sources

Say first: once a source is ready the robot moves under the model, with no person driving; someone at the robot should have the emergency stop. Name the pool cost (Decisions). Then `interactive-media-sessions.create`:

```json
{
  "workspaceId": "wks_...",
  "robotId": "rbt_...",
  "participants": [
    { "artifactId": "art_...", "groups": ["arm"], "pool": "inference-cpu", "priority": 0 }
  ]
}
```

- Optional: `selection` per group (`{"arm": {"rule": "freshest", "switchMarginTicks": 2}}`), `recordingPolicy` (`full` default, `partial`, `none`), `maxObservationAgeTicks` (default `chunkSize`: older observations are not offered), `maxCameraSkewTicks` (default 2).
- A source: `priority` 0 to 999 (operators are 1000), `standby`, `sourceSettings` `refillS` (seconds of queued actions below which the model is asked again; null: back to back).
- It returns the session `starting`, with `embodimentFingerprint` (compare with the table in step 3) and each source's `embodimentDifferences` (`path`, the model's value, the robot's): tell the user the differences that remain.

### 6. Wait for live and ready

Poll `interactive-media-sessions.get` every 5 seconds and report changes:

| What | Meaning |
| --- | --- |
| session `starting` | the robot was invited and has not joined; the invite lasts 5 minutes |
| session `live` | the robot joined the room |
| source `joining` | its machine starts, pulls the image and warms the model up |
| source `ready` | warm: from now it can drive its groups |
| session `failed` | `failureReason` says why: Problems |

### 7. Watch

`interactive-media-sessions.get` every 15 to 30 seconds while the user runs the robot; report changes, not polls.

- `participants[]`: `status` per source; `left` while the session is live means the source stopped (its task ended: `compute-tasks.get` with `computeTaskId`). Its groups go to the next source, or hold then stop.
- `transportStats.sources[]` per source: `selectedTicks` and `switches` (who drove), `delayTicksP95` (ticks between observation and arrival), `inferenceMsP95`, `transportDelayMsP95`, `limited` (commands cut to `maxRate`), `starvationTicks`, `stops`, `dropped` with `droppedReasons`.
- `degradedReasons`: `relayed_path` (the robot's connection is relayed, slower) or `camera_reduced` (the robot sends smaller or slower video).

The live view, with the source driving each arm: `https://app.rfabric.io/<org-slug>/<workspace-slug>/robots/<robotId>/sessions/<interactiveMediaSessionId>` (slugs from `organizations.get` and `workspaces.list`).

### 8. Change the sources

Each change sends the robot the new roster at once. The robot checks a roster with a model as at start: a refusal fails the live session.

- Add: `interactive-media-sessions.create-participants` with the body of one source (step 5). Say first that it may drive once `ready`.
- Re-rank or bench: `interactive-media-sessions.update-participants` with `priority` and/or `standby`. Say which source drives each group afterwards.
- Remove: `interactive-media-sessions.delete-participants`. Its machine stops. Say first which source takes its groups, or that they hold, then stop. The session stays open until step 10.

### 9. Take over and release

A person takes control through an intervention on this robot (`intervention-session`): claiming and starting it puts them in this session as an operator. In the operator console their first command to an arm takes that arm from the model; the other arms stay with the model. On the session page above, "Take over" and "Release" act per action group. Ending the intervention hands every arm back to the model, which resumes at `maxRate` from where the arm is: tell the user before they end it.

### 10. End and review

Say first: the model stops driving now and the arms hold their present position. Then `interactive-media-sessions.end` with `{}`: the session is `completed`, every source's machine stops, interventions in it end, and the robot leaves the room. Ending an ended session changes nothing.

- `transportStats` and `participants` keep the session's totals: report per source `selectedTicks`, `switches`, `limited`, `stops`.
- Recording: `recordingStatus` (`recorded`, `partial`, `unrecorded` with `recordingFailureReason`); `interactive-media-sessions.recording-url` returns a download link valid 15 minutes.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 `interactive_media_session_active`, `details.interactiveMediaSessionId` | the robot already has an open session | add the source to it (step 8), or end it first |
| 422 `robot_embodiment_missing` | the robot has no embodiment | step 3 |
| 422 `embodiment_invalid`, `details` `issues` | it lacks a control rate, state components, action groups or `chunkSize` | step 3 |
| 422 `embodiment_motion_limit_missing`, `details` `groups` | position or pose groups without `maxRate` | add it, step 3 |
| 422 `action_group_unknown` | a source names a group the embodiment does not have | use the embodiment's group names |
| 422 `inference_server_missing` | the Artifact has no inference server image | `artifact-build` |
| 422 `embodiment_incompatible`, `details.embodimentDifferences` | the model needs another control rate, state or action size, or a camera the robot lacks | another Artifact, or correct the embodiment if it is wrong |
| 409 on a source change | the session ended, or the participant is not a present inference source | read the session |
| 409 `interactive_media_roster_exhausted`, `details.interactiveMediaSessionId` | the session has given out every roster index (0 to 254; sources and operators that left keep theirs); nothing was added | end the session and start a new one with the sources you need |
| session `failed`, `failureReason` `roster_update_failed` | a roster change (a source or operator added or removed, a priority or standby change) did not reach the robot: the publish failed, the robot refused it, or it went unanswered for 60 seconds; the session was ended so the robot cannot keep driving on an old roster | `robots.presence` and the robot's network; start a new session |
| session `failed`, `failureReason` `invite_expired` or `invite_undeliverable` | the robot never joined | `robots.presence`; the robot's log (`intervention-session`, Problems) |
| `failureReason` `follower_unavailable` | no follower answered within 5 seconds, or the control bridge is off | step 2 |
| `failureReason` `follower_position_hold_missing` | the follower does not hold position on a stop | use a follower that does (step 2) |
| `failureReason` `stop_path_unverified` | the follower did not acknowledge a stop | check the follower service, then start again |
| `failureReason` `embodiment_fingerprint_mismatch` | the embodiment does not match the follower | step 3, the table |
| `failureReason` `embodiment_unsupported` or `invalid_payload` | a group the follower cannot command, or an embodiment the robot cannot use | step 3 |
| `failureReason` `embodiment_motion_limit_missing` | as the 422 above | step 3 |
| `failureReason` `capability_unsupported` | the robot runs `rfabricd-core` | `robot-enrollment`, Decisions |
| `failureReason` `session_busy`, `join_failed`, `robot_disconnected` | the robot is in another room, could not join, or left | check the robot and its network; start again |
| source `left`, session still `live` | its task ended (failed, cancelled, or 24 hours) | `compute-tasks.get`; its attempt's log with `compute-attempts.logs`; add it again |
| high `delayTicksP95` or `starvationTicks` | the model or the network cannot keep up | `inference-gpu`, a second source with `freshest`, or `relayed_path` to fix |
| high `limited` | sources ask for moves faster than `maxRate` | tell the user; raising `maxRate` is their safety decision |
| 403 naming a permission | it is missing | `member-access` |

## Done when

- [ ] `interactive-media-sessions.get` shows the session `completed` (or `live` with every source `ready` when the user keeps it running), and no other open session of the robot (`interactive-media-sessions.list`).
- [ ] The user knows per source how long it drove, its delay and its limited and stop counts.
- [ ] You reported the session id, its `recordingStatus`, and anything the robot refused.

## Next

- `deployment-rollout`: run the Artifact on a fleet this way, with `inferencePlacement` `remote`.
- `evaluation-job`: evaluate the Artifact on the robot (`real_robot`), served the same way.
- `intervention-session`: a person drives or corrects the robot.
- `simulation-suite`: test the same image in simulation first.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Embodiment | `rfabric robot update <robot-id> --embodiment <file.json or file.yaml>`, `rfabric robot get <robot-id>` |
| Start | `rfabric interactive-media-session start --robot <robot-id> --source <artifact-id>,groups=<a\|b>,pool=inference-cpu[,priority=N][,standby=true][,refill-s=S] [--selection <group>=freshest:2] [--recording-policy full]` |
| Read | `rfabric interactive-media-session ls -f robotId=<robot-id>`, `rfabric interactive-media-session get <ims-id>` |
| Sources | `rfabric interactive-media-session source add <ims-id> --artifact <artifact-id> --groups <a,b> --pool inference-cpu`, `source update <ims-id> <imsp-id> --priority N --standby=false`, `source remove <ims-id> <imsp-id>` |
| End, recording | `rfabric interactive-media-session end <ims-id>`, `rfabric interactive-media-session recording-url <ims-id> --output value --query url` |
