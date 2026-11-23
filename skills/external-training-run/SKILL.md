---
name: external-training-run
description: >-
  A training run that ran outside rFabric, recorded as a TrainingRun with its status, metrics, logs and verified checkpoint bytes, ready to evaluate or promote. Use when asked to record, track, report or import a run trained locally, on a cluster or by a vendor, to import finished runs from an experiment tracker, to register or upload a checkpoint, to find out why a checkpoint is not verified, or to export a run's reproducibility record. Not for training on rFabric compute - that is `training-run`.
---

# Record a run trained outside rFabric

The user ends up with a TrainingRun (`run_...`) that rFabric did not execute but knows in full: what it trained on, how it went, and its Checkpoint (`ckpt_...`) with bytes rFabric stores and has verified. A run whose compute config names no image is never started by rFabric: the trainer, or you on its behalf, reports to it. The run belongs to an Experiment (`exp_...`); each checkpoint file travels through one UploadSession (`ups_...`).

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Create the TrainingRun | agent | `experiments.list`, `training-runs.create` | none |
| 2 | Report status, metrics and logs | agent, or the user's trainer | `training-runs.status`, `training-runs.create-metrics`, `training-runs.create-logs` | the training itself |
| 3 | Close the run | agent | `training-runs.status` | none |
| 4 | Register the Checkpoint | agent | `checkpoints.create` | none |
| 5 | Upload its bytes | agent, from the machine that holds the files | `checkpoints.upload`, `checkpoints.upload-sessions`, `checkpoints.upload-sessions-parts`, `checkpoints.upload-sessions-complete` | per file: assembly and a SHA-256 check |
| 6 | Confirm verification | agent | `checkpoints.get`, `checkpoints.download-url` | rFabric digests every file again; report after 10 minutes |
| 7 | Export the record | agent | `training-runs.reproducibility-export`, `training-runs.export` | none |

Order matters in one place: metrics and logs are refused once the run is closed, so step 3 comes after the last metric. Checkpoints can be registered from the first in-flight report on, also after the run is closed.

## Before you start

- **Permissions**:

| To | Permission | Built-in roles |
| --- | --- | --- |
| create or import a run | `training:launch` | member, operator, admin, owner |
| report status, metrics, logs; upload checkpoint bytes | `training:report` | member, operator, admin, owner |
| register a Checkpoint | `training:checkpoint` | operator, admin, owner |
| read and export | `training:read` | member, operator, admin, owner |

- **Needs**: an Experiment (`experiment`, or `experiments.create` with `workspaceId` and `name`); the DatasetVersions (`dsv_...`) the run trained on, when that data is in rFabric (`dataset-version`); the checkpoint files on a disk you or the user can read.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Where it trains and who reports | decides whether you report or their trainer does | default: you report from what they give you |
| Parameters of the run | `config`, the heart of the record | their training command or config file |
| Data it trains on | binds the run to frozen data | `dataset-versions.list`; none when the data is not in rFabric |
| Code version, seed, base weights | reproducibility; frozen at the first report | their git commit and whether the tree was clean; the seed; a Model id or an external reference with its hash |
| Checkpoint directory and its step | what to register and upload | the trainer's output directory |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| Create the run and report (recommended) | the run is about to start, is running, or its timings, logs and checkpoints matter | a status history with real start and end times, progress, stale detection |
| Import finished rows ("Import finished runs" below) | many finished runs come from a tracker and their metrics are enough | one call; each run lands `completed` or `failed` with the import time as start and end, without logs; metrics cannot be added afterwards |

| Option | Choose when | Consequence |
| --- | --- | --- |
| Upload the checkpoint bytes (recommended) | the checkpoint will be evaluated, promoted, downloaded or fine-tuned from | rFabric stores and verifies the bytes; they are write-once |
| Reference outside storage (`storageRef` at registration) | the bytes must stay where they are | the Checkpoint is `external` for good: never verified, never uploadable, not downloadable through rFabric |

## Steps

### 1. Create the TrainingRun

`training-runs.create`:

```json
{
  "experimentId": "exp_...",
  "name": "act-workstation-01",
  "datasetVersionIds": ["dsv_..."],
  "config": { "steps": 20000, "batchSize": 8, "lr": 0.0001 },
  "computeConfig": { "gpuCount": 1 },
  "codeVersion": "<git commit>",
  "codeVersionDirty": false,
  "randomSeed": 42,
  "environment": { "python": "3.12", "torch": "2.6" },
  "notes": "trained on the lab workstation",
  "tags": ["external"]
}
```

- Keep `image` out of `computeConfig`. With an image rFabric starts the run on its own compute and it costs money: that is `training-run`.
- `config` is required; every top-level key is a parameter of the run. `computeConfig` without an image is a description: `gpuCount` there lets the workspace's training portfolio count the run's GPU hours.
- `datasetVersionIds`: versions of this workspace whose `exportStatus` is `completed`, each once. Leave it out for data rFabric does not hold.
- Base weights: `baseModelId` (a Model, `mdl_...`) or `externalBaseRef` (`identifier`, `weightHash`), not both.
- The run starts `queued`. At its first in-flight report `config`, the data, `codeVersion`, `randomSeed`, the base and `environment` freeze; afterwards only `name`, `notes`, `tags` and `attributes` change (`training-runs.update`). Read the record back to the user before step 2.

### 2. Report status, metrics and logs

**Status**: `training-runs.status`.

| Field | Rule |
| --- | --- |
| `status` | `provisioning`, `running`, `checkpointing`, `completed` or `failed`. Allowed moves: `queued` to `provisioning` or `running`; `provisioning` to `running`; `running` and `checkpointing` to each other; either of those two to `completed`. `failed` from any open status. A run cannot go from `queued` straight to `completed`. |
| `reportId` | a fresh UUID per report. The same id with the same body is replayed without effect; with another body it is refused. |
| `eventTime` | when it happened, ISO 8601. The first in-flight report's time becomes `startedAt`, the closing report's `completedAt`: report true times and the duration is right even when you report late. |
| `progress` | `currentStep`, and optionally `totalSteps`, `currentEpoch`, `totalEpochs`, `etaSeconds` |
| `metrics`, `environment` | stored only by a report that changes the status. An `environment` that differs from the one declared at creation is recorded on the run as `environmentDrift`. |

The response is `status` and `cancelRequested`. Repeat the current status with fresh `progress` while training runs: a run silent for the workspace's stale interval (15 minutes by default) gets `staleFlag` true, and a workspace may fail silent runs automatically (after 1 hour by default).

A run that already finished is reported the same way, late: `running` with its real start as `eventTime`, its metrics and logs, then the closing report with its real end.

**Metrics**: `training-runs.create-metrics` with a unique `batchId` and `points` (1 to 1000), each `series`, `step`, `timestamp`, `value`, optional `worker` (`rank`, `node`). The result counts `accepted` and `duplicates`; the same `batchId` with the same points is safe to resend.

**Logs**: `training-runs.create-logs` with a unique `batchId` and `lines`, each `timestamp`, `level`, `source`, `text`, optional `worker`; at most 1 MiB per batch. `sensitive` true marks the batch for the shorter retention. Do not send lines that contain secrets.

- Retention, unless the workspace changed it: metric points 365 days, log lines 90 days, sensitive log lines 30 days. A run whose Checkpoint was promoted to a Model keeps all of it.
- A distributed trainer that puts `worker` on its points and reports a series named `throughput` can be diagnosed with `training-runs.worker-summary`: mean throughput per worker, `stragglers` (below 80% of the mean), `desync` (latest steps more than 10 apart).
- Read back what arrived: `training-runs.get`, `training-runs.list-metrics`, `training-runs.list-logs`, `training-runs.transitions`.
- A trainer that reports by itself runs the CLI commands at the end, in a terminal where the user is signed in.

### 3. Close the run

Send every remaining metric and log batch first. Then one last `training-runs.status`: `completed` with the final `metrics` summary and `progress`, or `failed` with `errorMessage`. Say before the call that it is final: a closed run accepts no status, metric or log.

### 4. Register the Checkpoint

`checkpoints.create` with `trainingRunId`, `step`, and optionally `epoch`, `formatLabel` (for example `safetensors`) and `metrics`. Without `storageRef` the Checkpoint starts with `storageState` `unverified` and waits for its bytes.

- `metrics` with `val_loss` or `loss` decide the run's `bestCheckpoint`: the lowest `val_loss`, else the lowest `loss`.
- The run must have reported an in-flight status, and must not be `cancelled`.

### 5. Upload its bytes

1. **Manifest**: for every file of the checkpoint directory its `relativePath` (letters, digits, `.`, `_`, `-` and `/`; no `.` or `..` segment; each once), `sizeBytes` and lowercase hex `sha256`. At most 10,000 files. Tell the user the file count and the total size. With many files, prefer `rfabric checkpoint upload` (The rfabric CLI).
2. **Start**: `checkpoints.upload` with body `{"files": [...]}`. It returns `uploadGroupId` and one entry in `sessions` per file: `relativePath`, `sessionId`, `status`, `parts` (`partNumber`, `url`). A session that is already `completed` holds bytes the workspace stores: send nothing for it.
3. **Send each `inProgress` file**: `checkpoints.upload-sessions` gives `partSizeBytes`, `partCount` and `acknowledgedParts` (part number to `etag` of the parts already recorded: skip them and reuse those `etag` values). Part n is the bytes from (n-1) x `partSizeBytes`, `partSizeBytes` long, the last part shorter. PUT it to its `url` as the base skill describes and keep the `etag`. The start response signs at most the first 100 parts; sign more with `checkpoints.upload-sessions-parts` (`fromPartNumber`, `toPartNumber`). On a large file, record progress as you go with `checkpoints.upload-sessions-parts-acknowledge` (`parts`, each `{"partNumber", "etag"}`): an interrupted upload then continues after the last recorded part.
4. **Finish each file**: `checkpoints.upload-sessions-complete` with every `{"partNumber", "etag"}`. It answers 202: rFabric assembles the file and checks its size and SHA-256 in the background. Poll `checkpoints.upload-sessions` until `status` is `completed`. `aborted` with an `abortReason` means the assembled bytes did not match what the manifest declared: the Checkpoint is back to `unverified`; start again at 2.

- Interrupted: call `checkpoints.upload` again with the identical manifest. It returns the same sessions and the upload continues.
- To give up: `checkpoints.upload-sessions-abort` on each open session. The next `checkpoints.upload` starts the upload over.
- The parts, acknowledge, complete and abort calls answer without the `data` wrapper.

### 6. Confirm verification

When the last session is `completed`, rFabric digests every stored file again. Poll `checkpoints.get` until `storageState` leaves `uploading`; after 10 minutes stop and report where it stands, with the Checkpoint id:

| `storageState` | Meaning | Do |
| --- | --- | --- |
| `verified` | the bytes are stored and match; `contentHash`, `size`, `verifiedAt` and `storageRef` are set | prove it with `checkpoints.download-url`: it lists every file with its `sha256` |
| `verification_failed` | `verificationFailures` lists each file with a `reason`: `digest_mismatch`, `member_missing`, `member_undeclared` or `verification_error`; the stored bytes were removed | fix the files or the manifest, then step 5 again |
| `unverified` | a session was aborted or expired | step 5 again |
| `uploading`, still, after the wait | a file is not complete, or the check has not finished | `checkpoints.upload` again with the identical manifest: it returns every session with its `status`; finish the open ones, then poll again |

A verified Checkpoint cannot be uploaded again. To replace its bytes, register another Checkpoint.

### 7. Export the record

- `training-runs.reproducibility-export` returns `document` (`config`, `datasetVersionIds`, `simAssetVersionIds`, `codeVersion`, `baseModelId`, `randomSeed`, `environment`, `metrics`, `provenanceMix`, `consumedManifestChecksum`, `runId`, `exportedAt`, `schemaVersion`) and `signature`, a base64 HMAC-SHA256 over the document's JSON. Hand both over together and unchanged: any edit to the document breaks the signature.
- `training-runs.export` returns the run's stored fields and every metric point in one answer. It can be large; save it to a file instead of printing it.

## Import finished runs

`training-runs.import` with `workspaceId` and `rows`, each:

```json
{
  "sourceId": "tracker-run-8841",
  "experimentName": "ACT chunk size",
  "name": "chunk-20",
  "status": "completed",
  "config": { "chunkSize": 20, "steps": 20000 },
  "metrics": [{ "series": "val_loss", "step": 20000, "value": 0.033, "observedAt": "2026-03-02T10:15:00Z" }]
}
```

- `status` is `completed` or `failed`. The Experiment is found by its exact name in the workspace, and created when there is none: tell the user which ones the import will create.
- Make every `sourceId` unique to its tracker and project, for example `<tracker>/<project>/<run id>`. A row whose `sourceId` was imported before is skipped without a word, so repeating an import is safe. The result is `imported` (runs created) and `errors` (`sourceId`, `error`), one per failed row; the other rows still import.
- Verify with `training-runs.list` (query `experimentId`). Checkpoints of an imported run follow steps 4 to 6.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `CONFLICT` (409), "Transition ... is not allowed" | the report does not follow the allowed moves | read the run's `status`; report `running` before `completed` |
| `CONFLICT` (409), "is terminal" | the run is closed, or someone cancelled it in rFabric | a cancelled run stays cancelled: tell the user to stop their trainer, rFabric cannot stop a process it does not run |
| `CONFLICT` (409), `reason` `idempotency_conflict` in `details` | a `reportId` or `batchId` was reused with other content | send it under a fresh id |
| `CONFLICT` (409), `reason` `run_terminal` in `details` | metrics or logs sent to a closed run | nothing to do; next time send them before step 3 |
| `VALIDATION_ERROR` (422) with `offendingIndexes` in `details` | metric points with a value that is not a finite number | drop or fix those points and resend under another `batchId` |
| `CONFLICT` (409), `reason` `dataset_version_not_ready` in `details` | a DatasetVersion's files are still being written | wait for `exportStatus` `completed` |
| `CONFLICT` (409) on `checkpoints.create` | the run has not started, or was cancelled | report `running` first |
| `VALIDATION_ERROR` (422), `code` `external_storage` in `details` | the Checkpoint was registered with `storageRef` | register another Checkpoint without it, and upload to that one |
| `already_verified` (409) | the bytes are verified and write-once | nothing to upload; register another Checkpoint to replace them |
| `manifest_mismatch` (409) | an upload is in progress with a different manifest | resume with the original manifest, or abort its sessions and start again |
| `checkpoint_not_downloadable` (409) | rFabric holds no verified bytes for this Checkpoint | finish steps 5 and 6 |
| `staleFlag` true on the run | no report for the stale interval | report the current status with `progress`; the flag clears |
| 403 on `checkpoints.create` | the user lacks `training:checkpoint` (a member does) | an organization admin grants it, or an operator registers the Checkpoint |

## Done when

- [ ] `training-runs.get` shows the run `completed` or `failed` with `startedAt`, `completedAt` and the summary `metrics`.
- [ ] `training-runs.list-metrics` returns the series the trainer produced.
- [ ] `checkpoints.get` shows `storageState` `verified` and a `contentHash`.
- [ ] `checkpoints.download-url` lists every uploaded file.
- [ ] The final report names the run, the Checkpoint, its `contentHash`, and where the exported record was saved if the user asked for one.

## Next

- `model-release`: promote the verified Checkpoint to a Model.
- `evaluation-job`: evaluate the Checkpoint or the Model.
- `experiment`: compare this run with the others of its Experiment.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Create the run | `rfabric training-run create --data @run.json [--dataset-version <id>] [--tag <tag>] [--notes "..."]` |
| Report status | `rfabric training-run report-status <run-id> --status running [--event-time <RFC 3339>]`, `--status completed --metrics @summary.json`, `--status failed --error-message "..."` |
| Report metrics, logs | `rfabric training-run metrics report <run-id> --data @metrics.json`, `rfabric training-run logs <run-id> --data @logs.json` |
| Read metrics, logs | `rfabric training-run metrics fetch <run-id> [--series <name>]`, `rfabric training-run logs <run-id> [--query <text>]` |
| Register a Checkpoint for upload | `rfabric checkpoint create --data '{"trainingRunId":"run_...","step":20000,"formatLabel":"safetensors"}'` |
| Upload and wait for verification | `rfabric checkpoint upload <checkpoint-id> <dir> [--verify-timeout 30m]` |
| Download | `rfabric checkpoint download <checkpoint-id> <dir>` |
| Reproducibility record | `rfabric training-run reproducibility-export <run-id>` |
| Full export | `rfabric api get /api/training-runs/<run-id>/export` |
| Import finished runs | `rfabric training-orchestration import-tracker --rows @rows.json` |

`rfabric checkpoint upload` hashes every file, uploads, resumes after an interruption and waits for `verified`: one command replaces steps 5 and 6. Prefer it for a checkpoint of many files: the user approves one command instead of several calls per file. With a shell, run it yourself after the user approves; without one, hand it over as a "Your turn" block.
