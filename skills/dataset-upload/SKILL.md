---
name: dataset-upload
description: >-
  A dataset directory on this machine (for example LeRobot v3) uploaded into a workspace and imported as a Dataset with playable Episodes. Use when the user wants to upload, push or send a local dataset folder to rFabric, resume an upload that was interrupted, find out why an upload is stuck or produced no dataset, or find and abort stalled upload sessions. Not for data that already sits in a cloud bucket: that is `dataset-import`. Not for ROS 2 bags or MCAP files: that is `recording-conversion`.
---

# Upload a dataset directory

The user ends up with a Dataset (`ds_...`) in their workspace, built from a directory on this machine. Upload moves the bytes; an import then creates the dataset:

- **UploadSession** (`ups_...`): the upload of one file, sent in parts and verified against its SHA-256.
- **UploadGroup** (`ugrp_...`): all files of one directory. It completes when every declared file completed.
- **DatasetImport** (`dsi_...`): started by the completed group. It validates the files and creates the Dataset, its Episodes (`ep_...`) and SensorStreams (`ss_...`).

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the permission, inventory the directory, state file count and total size | agent | `introspect.whoami`, local files | reading every file once to measure it |
| 2 | Open one upload session per file, all in one upload group | agent | `upload-sessions.create` | none |
| 3 | Send the parts, acknowledge them, complete the file | agent | `upload-sessions.parts`, `upload-sessions.parts-acknowledge`, `upload-sessions.complete`, `upload-sessions.get` | per file: rFabric assembles it and reads it once to verify (up to 10 minutes plus 1 second per 16 MiB) |
| 4 | Follow the upload group to its dataset import | agent | `upload-groups.get`, `upload-groups.progress` | none: the import starts when the last file completes |
| 5 | Follow the import to the Dataset | agent | `dataset-imports.get`, `operations.get`, `dataset-imports.list-runs`, `datasets.processing-status` | the import run (15 minutes, then report and stop polling) |
| 6 | Report | agent | `datasets.get` | none |

## Before you start

- **Permissions**: `upload:operate` to open, send, complete and abort. Built-in roles `operator`, `admin` and `owner` carry it; `member` does not. `upload:read` to read sessions and groups and `dataset:read` to follow the import: also `member`. Check with `introspect.whoami` before you measure any file.
- **Needs**:
  - A Workspace: `workspace-setup`.
  - The directory inside your working directory. The rFabric agent reads files only inside the directory it was started in.
  - A dataset root. LeRobot v3: `meta/info.json` whose `codebase_version` starts with `v3.`, `meta/tasks.parquet`, `meta/episodes/`, `data/` and, for cameras, `videos/`. Read `meta/info.json` before you start; a directory without it will upload and then fail validation.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Directory | what to upload | the path the user names; it must be the dataset root, not its parent |
| Workspace | where the Dataset lands | `workspaces.list`; ask only with more than one |
| Dataset name | the name the Dataset gets | default: the directory name |
| Format | `datasetFormat` decides whether an import starts | `lerobot_v3` for a LeRobot v3 root; `rfabric_native` only when the user says it is an rFabric native dataset. Other formats are stored and not imported |
| Robot (optional) | attributes the recording to a Robot (`rbt_...`) of the workspace | none; `fleet-inventory` finds robots |
| Project (optional) | puts the Dataset in a Project (`prj_...`) | none |

## Decisions

**How to upload.** Present it as soon as the file count is known (step 1), before you measure anything. Recommend the option with fewer approvals and less waiting for the user: the upload operations for a handful of files, the CLI beyond that.

| Option | Choose when | Consequence |
| --- | --- | --- |
| The upload operations (steps 2 to 4) | few files, or no `rfabric` CLI on this machine | files go one after another and the session must stay open; every part is one transfer; in the rFabric agent the user approves at least 3 calls per file (open, acknowledge, complete) |
| `rfabric data upload` (recommended for many files or many GB) | the workspace has a Robot to attribute the data to | one command sends several files and parts at once: one approval instead of at least 3 per file; needs the `dataset:upload` permission (also `member`) and a Robot; the Dataset is named `upload-` plus 8 characters until renamed. With a shell, run it yourself after the user approves; without one, hand it over as a "Your turn" block. See "The rfabric CLI" below; you follow the import afterwards |

**A stalled or interrupted upload** (see "Stalled sessions" below). The user owns it because aborting discards bytes and may end someone else's upload.

| Option | Choose when | Consequence |
| --- | --- | --- |
| Resume (recommended) | the files are still on this machine, unchanged | only missing parts are sent; the group and its import continue |
| Start over as a new group | a file changed, or the group has ended | files that already completed are not sent again (rFabric reuses stored bytes); the old group never imports |
| Abort the session | nobody will finish it | cannot be undone: uploaded parts are discarded and its upload group ends without a dataset |
| Leave it | unsure whose upload it is | the session ends `expired` by itself 7 days after it was opened (`expiresAt`) |

## Steps

### 1. Check, inventory and tell the user

1. `introspect.whoami`: without `upload:operate` stop here (Problems). Nothing is measured or sent.
2. List every regular file under the root, recursively. Skip directories and symbolic links. The relative path with `/` separators is the file's `fileName` (for example `data/chunk-000/file-000.parquet`).
3. Say how many files you found. With more than a handful, present the "How to upload" decision now and wait. Then say that you read each file once to measure it; nothing is sent yet.
4. Measure each file: its size in bytes and lowercase hex SHA-256. The rFabric agent calls `rfabric_upload` with only `path`; it returns `size` and `sha256`.
5. Stop and report before any upload when a file is empty (0 bytes cannot be uploaded) or a relative path is longer than 512 characters or contains `\`, `:`, `%` or a `.` or `..` segment.
6. Tell the user before the first change: number of files, total size, the largest file, the workspace, the dataset name, how many approvals to expect, and that the Dataset appears only after the last file is verified and the import has run.

```text
Goal: upload ./pick-place-2026-03 (LeRobot v3) to workspace "bench" as dataset "pick-place-2026-03".

Found: 42 files, 9.4 GB in total (largest: videos/.../file-000.mp4, 1.2 GB).

Plan
1. Upload the 42 files, one after another - me (I report each file; you approve 3 calls per file, about 130 in total)
2. rFabric verifies every file against its checksum - automatic
3. rFabric imports the files into a Dataset - automatic, I follow it

Changes: one upload group, one dataset import and one Dataset in workspace "bench". Nothing on this machine is modified.
Keep this session open until the upload finishes. If it is interrupted, say "resume the upload": nothing already verified is sent again.
```

### 2. Open the upload sessions

Mint one `clientGroupId` for the directory (letters, digits, `_`, `-`; for example `agent-` plus 16 random hex characters) and tell it to the user at once: it is the handle for resuming.

`upload-sessions.create`, once per file:

```json
{
  "workspaceId": "wks_...",
  "fileName": "data/chunk-000/file-000.parquet",
  "byteSize": 52428800,
  "sha256Hex": "<64 lowercase hex characters>",
  "datasetFormat": "lerobot_v3",
  "clientGroupId": "agent-3f9c2a71d0e4b658",
  "expectedMemberCount": 42,
  "partSizeBytes": 16777216,
  "initialPartCount": 4,
  "provenanceEnvelope": { "capture": { "sourceMarkers": { "datasetId": "pick-place-2026-03" } } }
}
```

- Send the same `clientGroupId`, `expectedMemberCount`, `datasetFormat`, `robotId` and `provenanceEnvelope` with every file. The first call creates the upload group, the others join it.
- `expectedMemberCount` is the number of files. The group completes, and the import starts, when that many files completed.
- The Dataset is named after `datasetId` under `capture.sourceMarkers` in `provenanceEnvelope`; without it the name is `upload-` plus the first 8 characters of `clientGroupId`. A project goes in the envelope's `projectId`.
- `partSizeBytes`: 16777216 (16 MiB), at least 5 MiB. The file has `ceil(byteSize / partSizeBytes)` parts, at most 10000. Each part is one transfer, so for files of several hundred MB a larger part size (for example 64 MiB) means fewer calls; a failed part is then sent again whole.
- `initialPartCount`: how many part URLs to return now (more than the file has is cut down to its part count). Ask for all of them unless the file has more than about 20 parts: every later signing call is one more change to approve.
- The response is the object itself, without `data`: `sessionId`, `status` and `parts` (`partNumber`, `url`). The same holds for the parts, acknowledge and complete calls.
- `status` `completed` with no parts: the workspace already stores these exact bytes. Send nothing, do not complete; count the file as done ("already stored").

Work file by file: open, send, complete, then the next file. A session without progress for 30 minutes is reported as stalled, so do not open sessions long before you send their bytes.

### 3. Send the parts, acknowledge, complete

For each file whose session is `inProgress`:

1. **Send** part n: the bytes from offset `(n - 1) x partSizeBytes`, `partSizeBytes` long (the last part is the remainder), as the body of an HTTP PUT to the part's `url`, with no authorization header. Keep the `ETag` response header. The rFabric agent calls `rfabric_upload` with `path`, `url`, `offset` and `length`; it returns the `etag`.
2. **More URLs**: `upload-sessions.parts` with `fromPartNumber` and `toPartNumber` (at most 1000 per call). A part URL expires after about an hour; sign it again the same way.
3. **Acknowledge**: `upload-sessions.parts-acknowledge` with `parts` (`partNumber`, `etag`). Required: complete refuses a part that was not acknowledged. Acknowledge once after the file's last part; for a file of many parts also every 10 parts or so, because acknowledged parts are what a resume skips and what counts as progress.
4. **Complete**: `upload-sessions.complete` with every part of the file, each once. It answers at once with an `operationId`; the session stays `inProgress` while rFabric assembles the file and checks its size and SHA-256.
5. **Wait**: poll `upload-sessions.get` every 2 to 5 seconds until `status` is `completed`. Stop after 10 minutes plus 1 second per 16 MiB of the file and report.

| Session `status` | Meaning | Do |
| --- | --- | --- |
| `inProgress` | parts still missing, or verification running after complete | continue or wait |
| `completed` | stored and verified | next file |
| `aborted` | failed verification or was aborted; `abortReason` says which | Problems |
| `expired` | not finished 7 days after it was opened | Problems |

After each file, one progress line: `Uploaded 7 of 42: videos/.../file-000.mp4 (812 MB). 3.1 of 9.4 GB done.`

### 4. Follow the upload group

1. `upload-sessions.get` of any file gives `uploadGroupId`.
2. `upload-groups.get` until `status` is `complete`. Its `datasetImportId` is the import that the completion started.
3. `upload-groups.progress` (`pathParameters` `id`, `query` `workspaceId`) lists every member with `status`, `acknowledgedPartCount` and `partCount`, plus `completedMemberCount` and `declaredMemberCount`. Use it when the group does not complete.

| Group `status` | Meaning |
| --- | --- |
| `open` | waiting for files; a file whose session ended without completing can be uploaded again |
| `complete` | every declared file is verified; the import has started |
| `partial`, `failed` | a member was aborted, or expired and was not replaced; the group takes no more files and never imports |

A `complete` group with `datasetImportId` null was uploaded in a format that is not imported: only `lerobot_v3` and `rfabric_native` are. The bytes are stored; ROS 2 bags and MCAP files go through `recording-conversion`.

### 5. Follow the import to the Dataset

1. `dataset-imports.get`: `status` and, in `meta`, `operationId` of the running import.
2. Poll `operations.get` with that id every 10 seconds until `succeeded`, `failed` or `cancelled`. `progress` counts dataset roots. `result` of a succeeded Operation has `datasetIds`.
3. `dataset-imports.list-runs`: one DatasetImportRun (`dsir_...`) per dataset root found. `status` `ready` carries the `datasetId`; `failed` carries `failureReason`; warnings such as repeated timestamps are under `warnings` in `meta`.
4. `datasets.processing-status` for the Dataset: steps `validate`, `register`, `derive`. An uploaded dataset skips `derive` (`skipped`): it is browsable as soon as it is registered and plays from its source video files. `processingStatus` `ready` with `browsableAt` set means the user can open it.

| Import `status` | Tell the user |
| --- | --- |
| `pending`, `validating`, `scanning`, `importing` | running; which phase |
| `completed` | every dataset root imported |
| `partial` | some roots imported, some failed: list the failed runs |
| `failed`, `cancelled` | no dataset; the reason is the Operation's `error` and the runs' `failureReason` |

After 15 minutes stop polling: give the import id and the Operation id, and say that the import continues and that rFabric notifies the user in the app when it settles.

A failed step, a quarantined root or a rerun is handled in `dataset-import` (sections on reruns and quarantine); the import of an upload group works the same way.

### 6. Report

`datasets.get` for `name` and `episodeCount`; compare with `total_episodes` in `meta/info.json`. Close with the final report: upload group, dataset import and Dataset with ids and status, files sent and files already stored, total size, and the link `https://app.rfabric.io/open/<dataset id>`.

## Resume an interrupted upload

Nothing verified is sent again. A new agent session cannot reuse part URLs from an earlier one: sign them again.

1. **Find the group**: the `clientGroupId` from the earlier progress lines. Without it, `upload-groups.list` with `workspaceId` and `status` `open`, then match `clientGroupId` or the name under `provenanceEnvelope`, and confirm with the user.
2. **Read it**: `upload-groups.progress` for the group (`clientGroupId`, `expectedMemberCount`, `datasetFormat`, `robotId`, `provenanceEnvelope`) and its members (`sessionId`, `fileName`, `status`). Tell the user how many files are done and how many remain.
3. **Per local file**:

| Member | Do |
| --- | --- |
| `completed` | skip |
| `inProgress` | `upload-sessions.get`. Measure the local file again: `byteSize` and `sha256Hex` must match. `acknowledgedParts` (part number to etag) are done; sign the others with `upload-sessions.parts`, send, acknowledge, then complete with all etags, old and new |
| none yet | `upload-sessions.create` as in step 2, with the group's `clientGroupId`, `expectedMemberCount`, `datasetFormat`, `robotId` and `provenanceEnvelope` |
| `aborted` after a failed verification, or `expired`, group still `open` | `upload-sessions.create` for the same `fileName` in the same group: the new session takes the path's place |

4. Continue at step 4.

When a local file changed since its session was opened, or the group is `partial` or `failed`, start over with a new `clientGroupId` (steps 1 to 5). Files that completed before come back `completed` at once.

## Stalled sessions: find and abort

1. `workspaces-uploads.health`: `stalledSessionCount`, `sessionSuccessRate`, `processingBacklogCount` and `uploadToBrowsableLatencyP90Ms` for the workspace.
2. `workspaces-uploads.stalled-sessions`: each with its `session`, `stalledSince` and `canResume`. `workspaces-uploads.list-sessions` with `status` `inProgress` lists every open session (`limit` up to 500, `offset`).
3. Show the user a table: file, size, parts acknowledged of `partCount`, stalled since, robot (`robotId`) and upload group. A session with a `robotId` may be a robot's own upload that will resume when the robot is back online: `fleet-monitoring` shows whether it is.
4. Let the user decide per session (Decisions). Before aborting say: it cannot be undone, the uploaded parts are discarded, and the session's upload group ends `failed` or `partial` and will never import.
5. `workspaces-uploads.sessions-abort` with `workspaceId` and `sessionId` (`upload:operate`). `upload-sessions.abort` does the same for a session of your own upload. A `completed` session cannot be aborted.
6. Verify with `workspaces-uploads.get-sessions`: `status` `aborted`. Who did what is in `workspaces-uploads.audit` (`upload:audit`: roles `admin`, `owner`, `auditor`).

## Problems

Refusals carry a general `code` (`FORBIDDEN`, `VALIDATION_ERROR`, `CONFLICT`); the `message` tells them apart.

| Signal | What it means | Do |
| --- | --- | --- |
| 403, message `Missing grant upload:operate` | the user's role cannot upload through the upload operations | name the permission; `member-access` finds why it is missing and what can add it; or upload with `rfabric data upload`, which needs `dataset:upload` (The rfabric CLI) |
| 422, message `governance_format_denied` | the workspace setting `upload.allowedFormats` does not allow this format (`format` and `scope` in `details`) | an `owner` or `admin` changes the setting (`workspace-setup`), or choose another workspace |
| 422, message `governance_region_unconfigured` | the workspace is pinned to a storage region that cannot take uploads (`region` in `details`) | nothing was uploaded; upload to a workspace without that pin, or change the pin in `data-governance` |
| 422, message `envelope_invalid` or `envelope_reference_invalid` | `provenanceEnvelope` is malformed or names a robot, project or campaign outside the workspace (`member` in `details`) | fix that member |
| 422, message `envelope_conflict` | this file's `provenanceEnvelope` differs from the group's | send the envelope of the first file |
| 409, `Upload group already contains this relative path` | a session for this path is in progress or completed | resume it (Resume) |
| 409, `Upload group already contains its declared inventory` | more files than `expectedMemberCount` | count again; start over with a new `clientGroupId` |
| 409, `Upload group` followed by `is complete`, `is partial`, `is failed` or `is sealed` | the group no longer takes files | start over with a new `clientGroupId` |
| 409, `Upload group purpose, attribution and format must match every member` | `robotId` or `datasetFormat` differs from the first file | send the same values |
| 409 on parts, acknowledge or complete, `only in-progress sessions accept new operations` | the session already ended | `upload-sessions.get`, act on its `status` |
| 422 on complete, `part_not_acknowledged` or `etag_mismatch` in the message | a part was not acknowledged, or its etag differs | acknowledge the missing parts; send a mismatched part again |
| 422 on complete, `Expected` a number of parts, or `missing or duplicating part` | the list does not name every part of the file once | send parts 1 to `partCount`, each once |
| HTTP 403 from a part URL | the URL expired (about an hour) | `upload-sessions.parts` for that range |
| `Not a transfer URL issued by rFabric in this session` | the URL comes from an earlier agent session | `upload-sessions.parts` again |
| Session `aborted`, `abortReason` starts with `integrity_`; its Operation failed with code `upload_integrity_mismatch` | the stored bytes differ from the declared size or SHA-256: the file changed during upload or a part was corrupted | measure the file again; open a new session for the same `fileName` in the same group and send it again |
| Session `aborted`, `abortReason` starts with `upload_complete_failed` | rFabric could not assemble the file | open a new session for the same `fileName` in the same group |
| Session `expired`, `abortReason` `session_idle_expired` | the file was not finished within 7 days | group still `open`: open a new session for the same `fileName` (Resume); group `partial` or `failed`: start over with a new `clientGroupId` |
| Operation `failed` with code `dataset_import_failed`, or a run `failed` | the files arrived but are not a valid dataset | tell the user the run's `failureReason`; fix the directory and upload again, or continue in `dataset-import` |

## Done when

- [ ] `upload-groups.progress`: `completedMemberCount` equals `declaredMemberCount` and the number of local files.
- [ ] `upload-groups.get`: `status` `complete` and a `datasetImportId`.
- [ ] `dataset-imports.get`: `status` `completed`; its Operation `succeeded` with the Dataset in `datasetIds`.
- [ ] `datasets.processing-status`: `processingStatus` `ready` and `browsableAt` set.
- [ ] `datasets.get`: `episodeCount` equals the dataset's `total_episodes`.
- [ ] The user has the ids of the upload group, the import and the Dataset, and the link to open it.

## Next

- `episode-search`: find and inspect the uploaded Episodes.
- `dataset-import`: adaptive video renditions, reruns and quarantined roots.
- `enrichment`: descriptions, tags, embeddings and findings for the Episodes.
- `dataset-curation` and `dataset-version`: select Episodes and freeze them for training.

## The rfabric CLI

`rfabric data upload` uploads a directory with the same sessions, several files and parts in parallel. It is the recommended path for many files or many GB: the user approves one command instead of at least 3 calls per file. With a shell, run the command of the block yourself after the user approves: say the size first and report when it is done. This includes the rFabric agent started with `rfabric agent --with-shell`: its approved command runs as the user, with the user's signed-in CLI. Without a shell, hand the block over:

```text
Your turn - your terminal, in the folder that contains pick-place-2026-03
Why: the CLI sends several files at once and asks for no approval per file.
Who: you, with the rfabric CLI installed and signed in (rfabric auth login) and the dataset:upload permission.

1. RFABRIC_WORKSPACE=<workspace id> rfabric data upload ./pick-place-2026-03 --robot <robot id> --format lerobot_v3 --wait
2. If it stops with exit code 3 (network interrupted), run the same command with --resume added.

It creates: one upload group, its dataset import and one Dataset in workspace "bench", attributed to robot <robot name>. Nothing on this machine is modified.
To stop it: Ctrl+C. Nothing is imported until every file is verified; unfinished sessions end by themselves 7 days after they were opened.

Bring back: the uploadGroupId and datasetIds it prints, or the exact error text.
Then I: check the upload group and the import, rename the Dataset to "pick-place-2026-03", and report.
```

Fill in the workspace id, the Robot (`robots.list`; ask which when there are several) and the names. Afterwards verify with `upload-groups.get` (or `upload-groups.list` with `workspaceId` when no id came back), continue at step 4, and rename with `datasets.update` (`name`).

| Step | CLI |
| --- | --- |
| Upload and follow the import | `rfabric data upload <dir> --robot <robot-id> --format lerobot_v3 --wait` |
| Resume after an interruption (exit code 3) | `rfabric data upload <dir> --robot <robot-id> --resume` |
| List, read, abort sessions | `rfabric upload session list --status inProgress`, `rfabric upload session get <id>`, `rfabric upload session abort <id>` |
| Follow the import | `rfabric dataset-import get <import-id>`, `rfabric dataset-import runs ls <import-id>`, `rfabric operation wait <operation-id>` |
