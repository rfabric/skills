---
name: robot-recording
description: >-
  Demonstrations recorded on an enrolled robot and landed in the workspace as a browsable Dataset. Use when the user wants to record episodes or demonstrations on a robot or bench, set up its recording profile or upload rules, turn auto-upload on, start, watch, stop or abort a recording session, find out why a recording did not upload, upload a recording still on the robot, or run a collection campaign. Not for uploading a folder from a workstation: that is `dataset-upload`. Not for a failed import: that is `dataset-import`.
---

# Record on a robot

The user ends up with recordings made on a robot that arrive in the workspace as a Dataset with episodes, without copying files by hand. The entities:

- **Recording profile**: the Robot's saved recording command, its environment, data root, format and timeouts.
- **Upload rule**: one setting that says how `rfabricd` uploads recordings (auto-upload, skip patterns, windows). It resolves robot override, then fleet, workspace, organization, default.
- **RecordingSession** (`rec_...`): one run of the recording profile on the robot, started from rFabric.
- **UploadGroup** (`ugrp_...`): all files of one recording, uploaded as a unit. A complete group starts a **DatasetImport** (`dsi_...`), which creates the **Dataset** (`ds_...`).
- **CollectionCampaign** (`ccmp_...`): an episode target over a time window, counted as episodes arrive.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the robot and the folders it watches | agent | `robots.get`, `robots.presence` | none |
| 2 | Make `rfabricd` watch the recording folder | user, a terminal on the robot (once per robot) | none | the user |
| 3 | Save the recording profile | agent | `robots.list-recording-profile`, `robots.replace-recording-profile` | none |
| 4 | Set the upload rules | agent | `robots.list-datasets-config`, `robots.replace-datasets-config` | until `configSyncStatus` is `applied` |
| 5 | Start a recording session | agent; a person operates the robot | `recording-sessions.create` | until `recording` |
| 6 | Watch, then stop or abort | agent | `recording-sessions.get`, `recording-sessions.stop`, `recording-sessions.abort` | the session's `timeoutSeconds` at most |
| 7 | Follow upload, import and Dataset | agent | `upload-groups.list`, `upload-groups.progress`, `dataset-imports.get`, `dataset-imports.list-runs`, `datasets.processing-status` | depends on recording size and the robot's uplink |

Other ways in: Record locally with automatic upload, Upload a recording still on the robot, Collection campaign.

## Before you start

- **Permissions**:
  - Recording profile and sessions: `recordingProfile:edit` and `recordingSession:create`, `stop`, `abort`. The built-in role `operator` carries them.
  - Changing an upload rule, on a robot or a fleet: the role `admin` or `owner`. An `operator` records, and uploads each recording by command (Upload a recording still on the robot).
  - Correcting an episode's campaign: `dataset:curate`.
- **Needs**: a Robot that is enrolled and `online` (`robot-enrollment`); a recorder on the robot that writes LeRobot v3 datasets (the only format `rfabricd` detects and uploads); for a campaign, optionally a Mission or Task (`fleet-inventory`).
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| The recorder command, as they run it on the robot | becomes `commandTemplate` | no default; ask for the full command line and which values change per recording |
| Folder the recorder writes into | `dataRoot`; `rfabricd` must watch it | a folder the robot already watches (step 1); otherwise `/var/lib/rfabric/data` on a service install |
| Values for this recording | session `parameters` (task prompt, episode count) | the profile's placeholders tell you which |

## Decisions

Who starts the recorder:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Recording session from rFabric (recommended) | recordings should be started, tracked and stopped without a shell on the robot | needs a recording profile; the session links to its Dataset |
| Local recording | the operator already runs the recorder at the bench | rFabric sees nothing until the upload; see Record locally |

Auto-upload (default off):

| Option | Choose when | Consequence |
| --- | --- | --- |
| On for this robot (recommended to start) | one bench, or a trial | every finalized recording leaves the robot without a further question; uses its uplink and workspace storage. Needs `admin` or `owner` |
| On for the fleet | all robots of the fleet record alike | `fleets-settings.replace` (`pathParameters` `id`, the fleet, and `key`; body `value`): applies to every robot in the fleet. Needs `admin` or `owner` |
| Off | the user picks what to upload, or nobody with `admin` or `owner` is at hand | each recording is uploaded by command; see Upload a recording still on the robot |

## Steps

### 1. Check the robot and the folders it watches

1. `robots.get`: `lifecycleState` should be `active`; `recordingProfile` shows whether a profile exists.
2. In the same response, `meta.effectiveConfigReport.settings` holds one entry with `key` `uploadDataRoot` per folder `rfabricd` watches; its `value` is the folder. No such entry: the robot watches nothing yet, so step 2 is needed.
3. `robots.presence`: `status` `online`. A session for an offline robot is held until it reconnects or times out, so say so before starting one.

### 2. Your turn: make rfabricd watch the recording folder

Skip this when step 1 shows the folder the recorder writes into. Before handing over, check that no recording session is running on the robot (`recording-sessions.list` with `robotId`): the restart in this block fails a running session.

```text
Your turn - a terminal on the robot (its own keyboard, or SSH), with sudo
Why: rfabricd uploads only recordings that appear in a folder it watches, and a recording session must write into such a folder.

1. Add this block to /etc/rfabric/rfabricd.toml (edit it with sudo):
   [[dataset_watch]]
   path = "/var/lib/rfabric/data"
   format = "lerobot_v3"
2. Restart rfabricd so it reads the config. It creates the folder when it starts:
   sudo systemctl try-restart rfabricd
3. Check it came back without errors (Ctrl+C leaves the log):
   sudo journalctl -u rfabricd -f

Changes on the robot: one block in the config file, and the folder. Undo: remove the block and restart again.
Bring back: tell me when it restarted, or paste the error from the log.
Then I: read the robot's watched folders, and save the recording profile against this one.
```

- Per-user install (Homebrew, binary only): the config is `~/.config/rfabric/rfabricd.toml`, the folder is any the user owns (LeRobot's default is `~/.cache/huggingface/lerobot`), no sudo is needed, and restarting means stopping `rfabricd run` with Ctrl+C and running it again.
- Service install: `rfabricd` and the recorder it starts run as the `rfabric` user. They can write only under `/var/lib/rfabric` and `/rfabric`, and cannot see home directories. A folder elsewhere will not work.
- `format` must be `lerobot_v3`; `rfabricd` refuses to start with a format it cannot detect.

Done when: `robots.get` lists the folder as an `uploadDataRoot` entry (step 1), and `robots.presence` is `online` again.

### 3. Save the recording profile

`robots.list-recording-profile` reads it (`data` null: none yet). `robots.replace-recording-profile` saves the whole profile:

```json
{
  "commandTemplate": ["/usr/local/bin/record-episodes", "--episodes", "{episodes}", "--task", "{task}", "--output", "/var/lib/rfabric/data/{date}_{time}_{recordingSessionId}"],
  "env": { "HOME": "/var/lib/rfabric" },
  "dataRoot": "/var/lib/rfabric/data",
  "datasetFormat": "lerobot_v3",
  "defaultTimeoutSeconds": 3600,
  "finalizationWindowSeconds": 120
}
```

| Field | What to know |
| --- | --- |
| `commandTemplate` | the command as a list, one argument per element; no shell, so no pipes, quotes or `&&`. Use the program's absolute path |
| `{name}` placeholders | each becomes a required parameter of every session. `{recordingSessionId}`, `{date}` (YYMMDD) and `{time}` (HHMMSS) are filled in on the robot: put them in the output path so every recording gets its own folder |
| `env` | the recorder's complete environment; nothing is inherited. Names are upper case. Everyone who can read the Robot can read it: no secrets |
| `dataRoot` | must equal a watched folder, with the same `datasetFormat` |
| `defaultTimeoutSeconds` | 30 to 86400. When it passes, the recorder is asked to finish as if stopped |
| `finalizationWindowSeconds` | 5 to 3600. How long the recorder gets to write its files after a stop before it is killed |

Build the template from the user's command: keep what is fixed, turn what changes per recording into placeholders, and show the result before saving. The example program name is a stand-in for the user's recorder. A LeRobot recorder needs `--dataset.push_to_hub=false`, so the local folder is the source.

Done when: the save returns the profile. A robot that has not reported its watched folders yet accepts any `dataRoot`, so rely on step 1, not on the save, to know the folder is watched.

### 4. Set the upload rules

`robots.list-datasets-config` returns `rules`, each with `key`, `value`, `sourceScopeType` (`robot`, `fleet`, `workspace`, `organization`, or null for the default), `enforced` and `isDefault`. Show the user the ones that matter:

| `key` | Default | Meaning |
| --- | --- | --- |
| `rfabricd.datasets.autoUpload` | false | upload every finalized recording automatically |
| `rfabricd.datasets.quietWindowSeconds` | 30 | seconds a recording must stay unchanged before it counts as finished |
| `rfabricd.datasets.targetProjectId` | null | Project (`prj_...`) the Datasets are filed into |
| `rfabricd.datasets.excludeGlobs` | none | path patterns that never upload automatically |
| `rfabricd.datasets.uploadWindows` | any time | local-time windows in which uploads run |
| `rfabricd.datasets.deleteVerifiedAfterDays` | null | days after a verified upload before the recording is deleted from the robot's disk; null never deletes |

Set one for this robot with `robots.replace-datasets-config`: `pathParameters` `robotId` and `key`, body `{"value": true}`. `robots.delete-datasets-config` removes the override, so the robot follows its fleet again. Both need the role `admin` or `owner`. Say before turning auto-upload on: from now on recordings leave the robot without a further question.

Done when: the rule reads back with `sourceScopeType` `robot`, and `robots.get` shows `configSyncStatus` `applied` (an offline robot applies it when it reconnects). When the user chose auto-upload off, nothing is written here.

### 5. Start a recording session

Say before the call: the robot starts the recorder now, so a person should be at the robot, ready to operate it.

`recording-sessions.create` with `robotId`, `parameters` (one string per placeholder, for example `{"episodes": "50", "task": "Hand the cube from left to right"}`) and optionally `timeoutSeconds`. The session snapshots the profile: later profile edits do not change it. A robot runs one session at a time.

### 6. Watch, then stop or abort

Poll `recording-sessions.get` every 10 seconds. Report status changes, with `progress.elapsedSeconds` and `progress.bytesWritten` while recording.

| `status` | Meaning |
| --- | --- |
| `requested` | accepted. `statusReason` `robot_offline`: held until the robot reconnects |
| `dispatched`, `starting` | sent to the robot; `rfabricd` is launching the recorder |
| `recording` | the recorder runs |
| `finalizing` | asked to finish; writing its files |
| `completed` | the recorder ended cleanly; the recording may upload |
| `failed` | see `failureReason`: `code`, `message`, `exitCode`, `stderrTail` |
| `aborted` | killed. The files stay on the robot and never upload automatically |

- **Stop** (`recording-sessions.stop`, optional `reason`): only while `recording`. The recorder finishes and the result is kept. Use it when the operator has enough episodes.
- **Abort** (`recording-sessions.abort`): from any state before the end. Use it for a bad setup. Say before the call that the recorder is killed and the recording will not upload by itself.
- The recorder may also end by itself (all episodes done): the session goes straight to `completed`.
- Discarding or re-recording a single episode happens in the recorder at the robot, not in rFabric.

### 7. Follow upload, import and Dataset

After `completed`, `rfabricd` waits for the quiet window, checks the recording is complete, and (with auto-upload on) uploads it as one UploadGroup. Only a whole group imports. With auto-upload off, start the upload yourself (Upload a recording still on the robot), then follow it here.

1. `upload-groups.list` with `workspaceId`, `robotId` and `since` (the session's `startedAt`). The session's group has `provenanceEnvelope.capture.recordingSessionId` equal to the session id.
2. `upload-groups.progress`: `aggregateBytesCompleted` of `aggregateBytesTotal`, `completedMemberCount` of `declaredMemberCount`. Report at each quarter, not each poll.
3. Group `status` `complete` sets `datasetImportId`. `dataset-imports.get` until `status` is `completed`; `dataset-imports.list-runs` names the `datasetId`, or the `failureReason`.
4. `datasets.processing-status`: `processingStatus` `ready` with `browsableAt` set means the Dataset can be opened. `recording-sessions.get` now carries the same `datasetId`.

| Group `status` | Meaning |
| --- | --- |
| `open` | files are still arriving |
| `complete` | all files arrived; the import starts |
| `partial`, `failed` | files are missing or the upload failed; nothing imports. See Problems |

Tell the user: uploaded recordings play from their source video; no streaming renditions are generated unless asked for (`dataset-import`). Give `https://app.rfabric.io/open/<datasetId>`.

## Record locally with automatic upload

The operator runs the recorder themselves; `rfabricd` notices the finished recording and uploads it.

1. Steps 1, 2 and 4 (auto-upload on). No recording profile is needed. With auto-upload off, each recording is uploaded by command instead (next section).
2. Your turn, at the robot: record into the watched folder with the usual recorder, and let it finish and close its files. `rfabricd` must be running. With the service install, the folder limits of step 2 apply: a bench where a person records under their own account is simplest with the per-user install.
3. Follow from step 7 with `since` set to when recording began. The Dataset is named after the recording's folder relative to the watched folder (for example `owner/name`).

## Upload a recording still on the robot

For auto-upload off, an aborted session the user wants after all, or a failed upload. An upload asked for by command runs whatever auto-upload and the skip patterns say; upload windows and rate caps still apply to it.

1. `robots.create-commands` with body `{"kind": "dataset.list", "data": {}}` makes the robot report its recordings. Then read `robots.telemetry-stream` for a few seconds (`streamSeconds`): the `dataset_inventory` event lists `datasets`, each with `datasetId`, `root` and a `state` whose `kind` is one of:

| `kind` | Meaning |
| --- | --- |
| `discovered` | seen, not yet checked |
| `incomplete` | files are missing; the state's `reason` says which |
| `finalized` | complete, waiting to upload |
| `uploading`, `uploaded` | in transfer; done |
| `upload_failed` | failed; the state's `message` says why |
| `excluded`, `skipped`, `down_prioritized` | held back by a skip pattern or an edge filter |

2. `robots.create-commands` with body `{"kind": "dataset.upload", "data": {"dataset_id": "<datasetId>"}}`. Add `"priority": "incident"` only when the user wants it to ignore upload windows and rate caps (the rule `rfabricd.datasets.incidentPriorityBypass` allows that by default).
3. The response carries `operationId`. Poll `operations.get`: `succeeded` has `result.datasetIds`; `failed` has the robot's or the import's `error`.

## Collection campaign

Every campaign operation that acts on one campaign takes it as `pathParameters` `id`; `collection-campaigns.list` takes `query` `workspaceId` and optionally `status`.

1. `collection-campaigns.create`: `workspaceId`, `name`, `episodeQuota` (above 0), `windowStart`, `windowEnd`, and optionally `missionId`, `taskId`, `instructions` and `participants` (`robotIds`, `fleetIds`, `operatorIds`). It starts as `draft`.
2. `collection-campaigns.open`: only an `open` campaign counts episodes.
3. Record (steps 5 to 7, or locally). Each imported episode is counted when it was captured inside the window on a participating robot: one that is listed, or a current member of a listed fleet; with no participants, any robot of the workspace. Tell the user the catch: an episode that fits two open campaigns is counted in neither. Keep campaigns from overlapping, or assign by hand with `collection-campaigns.episodes-association` (`pathParameters` `id` is the episode id; body `campaignId`, or null to clear; needs `dataset:curate`).
4. Progress: `collection-campaigns.get` returns `progress` (`associatedEpisodeCount`, `episodeQuota`, `quotaPercent`); `collection-campaigns.metrics` adds `perRobot`, `perOperator` and `qualityDistribution`; `collection-campaigns.episodes` lists the episodes.
5. End: reaching the quota sets `completed`; the window passing sets `closed`; `collection-campaigns.close` closes early (say that it stops counting and cannot be reopened). Each ending hands the episodes to curation: `collection-campaigns.metrics` shows `handoff` with its `status` and the `shortfall` against the quota.

## Problems

Refusals of the recording and campaign operations use the general codes `VALIDATION_ERROR` (422) and `CONFLICT` (409); the name in the first column is the error's `message`.

| Signal | What it means | Do |
| --- | --- | --- |
| Profile save 422, `data_root_mismatch` | `dataRoot` is not a watched folder | use one from `details.watchedRoots`, or step 2 |
| Profile save 422, `command_template_malformed` | a placeholder is broken | fix the element named by `argument` in `details`: a placeholder is `{name}`, a letter followed by letters, digits or underscores |
| Rule write 403 `FORBIDDEN` | the user's role is not `admin` or `owner` | an `admin` or `owner` makes the change; until then keep auto-upload off and upload by command |
| Rule write 409, `reason` `ancestor_locked` in `details` | the scope in `enforcingScopeType` enforces the value in `enforcingValue` | the rule cannot differ on this robot; ask whoever owns that setting (`workspace-setup`) |
| Start 422, `recording_profile_missing` | no profile on the robot | step 3 |
| Start 422, `parameter_missing` or `parameter_undeclared` | `parameters` do not match the placeholders | `parameter` in `details` names it; send exactly one value per placeholder |
| Start 409, `session_active` | the robot is already recording | `details.activeSessionId`: watch, stop or abort that one |
| Stop 409 | the session is not `recording` | abort it instead, or it has already ended |
| `failed`, `session_conflict` | the robot was already running another session | wait for that session, or stop it, then start again |
| `failed`, `rfabricd_restart` | `rfabricd` restarted while the session ran; what was recorded stays on the robot and does not upload by itself | start a new session; upload the partial recording by command if the user wants it |
| `failed`, `data_root_unwatched` or `dataset_format_mismatch` | the folder is not watched on the robot, or its format differs from the profile's | step 2, then save the profile again |
| `failed`, `process_exit` | the recorder crashed | show `exitCode` and `stderrTail`; fix the command or the hardware setup |
| `failed`, `spawn_failed` or `invalid_template` | the program was not found or the command is wrong | absolute path in `commandTemplate`; check `env` |
| `failed`, `timeout` | the session passed its deadline: the robot stayed offline, or the recorder failed when asked to finish at the timeout | check the robot is `online`; raise `timeoutSeconds` |
| `failed`, `finalization_timeout` | the recorder did not exit after being asked to finish, and was killed | raise `finalizationWindowSeconds`; check the recorder finishes on an interrupt signal |
| `completed`, but no UploadGroup appears | auto-upload is off, a skip pattern matches, an upload window is closed, or the recording is `incomplete` | read the rules (step 4) and the robot's inventory (Upload a recording still on the robot) |
| Group stays `open`, or ends `partial` or `failed` | the robot went offline or the upload failed | `robots.presence`; the robot resumes on reconnect and retries by itself; otherwise upload by command |
| Import `failed` or `partial` | the recording did not pass validation | `dataset-imports.list-runs` `failureReason`; continue in `dataset-import` |
| Campaign 422, `campaign_window_invalid` or `campaign_quota_invalid` | the window ends before it starts, or the quota is 0 | fix the dates or the quota |
| Campaign count does not move | status is not `open`, the capture time is outside the window, the robot is not a participant, or two campaigns match | read the campaign; assign by hand |

## Done when

- [ ] `recording-sessions.get`: `status` `completed`, and `datasetId` set.
- [ ] `upload-groups.list`: the recording's group is `complete` with a `datasetImportId`.
- [ ] `dataset-imports.get`: `status` `completed`.
- [ ] `datasets.processing-status`: `processingStatus` `ready`, `browsableAt` set; you reported the Dataset id and its link.
- [ ] With a campaign: `collection-campaigns.get` shows the count the user expects.

## Next

- `episode-search`: find and open the recorded episodes.
- `dataset-curation`: select the recorded episodes worth training on.
- `dataset-version`: freeze the Dataset for training.
- `dataset-import`: a failed import, or streaming renditions for playback.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Recording profile | `rfabric robot record profile get <robot-id>`, `rfabric robot record profile set <robot-id> --data @profile.json` |
| Upload rules | `rfabric robot dataset config get <robot-id>`, `rfabric robot dataset config set <robot-id> rfabricd.datasets.autoUpload true`, `rfabric robot dataset config reset <robot-id> <key>` |
| Start | `rfabric robot record start --robot <robot-id> --param episodes=50 --param task="..." [--timeout <seconds>]` |
| Watch | `rfabric robot record status <session-id>`, `rfabric robot record status --robot <robot-id>` |
| Stop, abort | `rfabric robot record stop <session-id> --reason "..."`, `rfabric robot record abort <session-id> --reason "..."` |
| Recordings on the robot | `rfabric robot dataset list <robot-id>`, `rfabric robot dataset upload <robot-id> <dataset-id> [--priority incident]` |
| Upload groups | `rfabric api get '/api/upload-groups?workspaceId=<workspace-id>&robotId=<robot-id>'` |
| Import | `rfabric dataset-import get <import-id>`, `rfabric dataset-import runs ls <import-id>` |
| Campaign | `rfabric collection-campaign create --name <name> --episode-quota <n> --window-start <RFC3339> --window-end <RFC3339> [--task <task-id>] [--robot <robot-id>]`, then `open`, `metrics`, `close` with `<campaign-id>` |
