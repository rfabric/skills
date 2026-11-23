---
name: dataset-import
description: >-
  Datasets in a connected cloud bucket imported as Datasets with Episodes and SensorStreams, by copy or by link. Use when the user wants to import datasets from S3, Google Cloud Storage or another connected bucket, asks what an import created or why a folder failed or was skipped, wants to rerun an import, handle a quarantined dataset, generate video renditions, or import on a schedule or as new data lands. Not for local files: that is `dataset-upload`. Not for ROS 2 bags or MCAP files: that is `recording-conversion`.
---

# Import datasets from a connected bucket

The user ends up with one Dataset (`ds_...`) per dataset root found in their bucket, each with Episodes (`ep_...`) and SensorStreams (`ss_...`, one sensor track of an episode), browsable in the app.

- **StorageConnection** (`sc_...`): rFabric's verified access to one bucket, optionally one folder of it.
- **DatasetImport** (`dsi_...`): one source (a connection and a prefix) and how to import it. It can run many times.
- **DatasetImportRun** (`dsir_...`): one dataset root the import found, with its status and its Dataset.
- **ImportQuarantine** (`iq_...`): a root that failed validation and waits for a decision.
- **DerivedAsset** (`da_...`): a processed output of a stream, such as an adaptive video rendition.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Pick the storage connection | agent | `storage-connections.list`, `storage-connections.get` | none |
| 2 | Browse the bucket and probe for dataset roots | agent | `storage-connections.list-objects`, `storage-connections.lerobot-probes` | none |
| 3 | Decide copy or link, and media processing | user, in the conversation | none | the user's answer |
| 4 | Create the import and start it | agent | `dataset-imports.create`, `dataset-imports.start` | none |
| 5 | Follow the run and its roots | agent | `operations.get`, `dataset-imports.get`, `dataset-imports.list-runs` | the run; copy mode grows with the bytes copied (a run may take up to 24 hours) |
| 6 | Read what was created and report | agent | `datasets.get`, `datasets.processing-status`, `episodes.list`, `sensor-streams.list`, `derived-assets.list` | renditions, when media processing is on |

## Before you start

- **Permissions**: `dataset:create` to create, start, rerun and cancel imports and to reprocess; `dataset:read` to read them (built-in roles `member`, `operator`, `admin`, `owner`). `importQuarantine:resolve` to discard a quarantined root (`operator`, `admin`, `owner`). The bucket notification setup needs an organization admin.
- **Needs**: a StorageConnection with `status` `verified` that the workspace can use: `storage-connection` creates and verifies it.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Workspace | where the Datasets land | `workspaces.list`; ask only with more than one |
| Folder | which part of the bucket to import | browse with the user in step 2; default: the folder they name |
| Copy or link | Decisions | no default: the user chooses |
| Media processing | Decisions | default: off |
| Project (optional) | puts the Datasets in a Project (`prj_...`) | none |

## Decisions

**Copy or link** (`materializationMode`). Fixed when the import is created; a root that is already a Dataset in the workspace is not imported again from the same connection, so this choice stays with the dataset.

| Option | Choose when | Consequence |
| --- | --- | --- |
| `copy` (recommended) | rFabric should keep working whatever happens to the bucket | every object is copied into workspace storage and checked; takes time and adds to the workspace's stored bytes; the Dataset no longer depends on the bucket; the source is not modified |
| `link` | the data must stay in the user's bucket (residency, size) | nothing is copied and no workspace storage is used; rFabric reads the bucket each time an episode is played, exported or trained on; when the connection is revoked, fails verification or turns `degraded`, those reads are refused until it is healthy again; objects changed or deleted in the bucket break the Dataset |

**Media processing** (`processingMode`). Can be added later per Dataset (Video renditions, below).

| Option | Choose when | Consequence |
| --- | --- | --- |
| `dataset` (recommended) | the user wants the data browsable soon | the Dataset is browsable as soon as it is registered; video plays from the source files |
| `dataset_with_media_processing` | many people will watch the video in the app | after registration rFabric builds adaptive renditions, a thumbnail and preview stills for each video stream; this uses compute and workspace storage, and video shows as processing until they are ready |

## Steps

### 1. Pick the storage connection

`storage-connections.list` with `workspaceId` and `status` `verified`. Show `name`, `provider`, `bucket`, `prefix` and `healthStatus`; with several, ask which. None: stop and continue with `storage-connection`.

### 2. Browse and probe

1. `storage-connections.list-objects` with `prefix` lists one level: `folders` and `files`. Pass `nextContinuationToken` back as `continuationToken` for more. Walk down with the user until the folders that hold datasets are in view.
2. `storage-connections.lerobot-probes` with `workspaceId` and up to 50 `prefixes`, each a folder key ending in `/`. It only reads the bucket; say so, because the host shows it as a change.

| Probe `status` | Meaning | Do |
| --- | --- | --- |
| `valid` | a LeRobot v3 root, not yet imported here; `repoId`, `totalEpisodes`, `totalBytes` | offer it |
| `candidate` | a LeRobot v3 root that is still being written; `reason` names what is missing | wait for the writer, or import later |
| `imported` | already imported into this workspace: `datasetId`, `datasetImportId` | do not import again; rerun that import instead |
| `none` | no LeRobot v3 root at this prefix | go one level down, or see below |

A folder that holds a file named metadata.yaml next to `.db3` or `.mcap` files, or a single `.mcap` file, is a recording: `recording-conversion`.

3. Tell the user what you found, before any change:

```text
Found in s3://acme-robot-data/datasets/
| Folder | Episodes | Size | State |
| --- | --- | --- | --- |
| pick-place-2026-03/ | 120 | 9.4 GB | ready to import |
| stacking-2026-02/ | 80 | 6.1 GB | already imported (ds_01J...) |
| tmp/ | - | - | no dataset found |
```

### 3. Decide

Present both Decisions tables with the sizes from step 2 and wait for the user's answer. Decide yourself only the name (the folder name).

### 4. Create the import and start it

`dataset-imports.create`:

```json
{
  "workspaceId": "wks_...",
  "name": "pick-place-2026-03",
  "storageConnectionId": "sc_...",
  "sourcePrefix": "datasets/pick-place-2026-03/",
  "materializationMode": "copy",
  "processingMode": "dataset"
}
```

- One root: `sourcePrefix` is that root. Several roots under one folder: `sourcePrefix` is the folder, and `excludePatterns` (or `includePatterns`) are globs matched against each root key, for example `datasets/tmp/*`. Up to 20 patterns each.
- `namingPolicy` decides the Dataset names; the default takes the repository id from the dataset's `meta/info.json`.
- Creating changes nothing in the bucket and imports nothing yet.

Then `dataset-imports.start`. It returns the Operation (`op_...`) of this run. Say what starts: in copy mode, how many bytes will be copied.

### 5. Follow the run

1. Poll `operations.get` every 10 seconds until `succeeded`, `failed` or `cancelled`. `progress` counts settled roots of discovered roots.
2. `dataset-imports.get` for the totals: `discoveredDatasetCount`, `importedDatasetCount`, `failedDatasetCount`, `hydratedBytes`.
3. `dataset-imports.list-runs` for each root. Report when a root changes status, not on every poll.

| Run `status` | Meaning |
| --- | --- |
| `discovered`, `pending` | found, waiting |
| `validating` | layout and integrity checks |
| `materializing`, `hydrating` | registering Episodes and SensorStreams; copying bytes in copy mode |
| `ready` | done; `datasetId` is the Dataset |
| `incomplete` | the root is still being written; it is tried again on the next run |
| `failed` | `failureReason` says why; a structurally invalid root is also quarantined |
| `skipped` | no dataset layout found (`rootClassification` `unrecognized`) |

A run with `rootClassification` `foreign` is a recording. Its `conversionStatus` (`pending`, `converting`, `converted`, `failed`) follows a conversion job: continue in `recording-conversion`.

The import ends `completed` (no failed root), `partial` (some failed) or `failed`. The Operation's `result` has `datasetIds`; its `failures` group the failed roots by reason. After 15 minutes stop polling: give the import id and the Operation id, and say that the run continues and that rFabric notifies the user in the app when it settles.

### 6. Read what was created and report

For each `ready` run:

1. `datasets.get`: `name`, `format`, `episodeCount`, `totalDuration`.
2. `datasets.processing-status`: steps `validate`, `register`, `derive` (`derive` is `skipped` without media processing). `processingStatus` `ready` with `browsableAt` set means the user can open it.
3. `episodes.list` with `datasetId`, and `sensor-streams.list` with one `episodeId`, to name the modalities (`rgb_video`, `proprioception`, `imu`, ...).
4. `derived-assets.list` with `sourceDatasetId`: `assetType` and `status` (`generating`, `ready`, `failed` with `error`). Numeric streams have one `timeseries` asset each; renditions appear here with media processing.

Final report: one row per root with Dataset id, Episodes, size, mode and status; what failed and why; the link `https://app.rfabric.io/open/<dataset id>`.

## Video renditions

For a Dataset imported without media processing, or with broken playback:

- `datasets.generate-derived-assets` with `assetTypes` `["hls_stream"]` queues renditions for every video stream of the Dataset. It returns `derivedAssetIds`; follow them with `derived-assets.list` until `ready`.
- `datasets.playback-health` (optional `windowHours`) counts playback starts, stalls, errors and missing renditions, and lists `affectedStreams`. `datasets.playback-health-reprocess` with up to 100 of those `streamIds` rebuilds their renditions.

## Rerun

| Situation | Operation | Notes |
| --- | --- | --- |
| New roots arrived, or `incomplete` roots are finished | `dataset-imports.start` | scans again; roots already imported and unchanged are left alone |
| One root `failed` or `skipped`, after its cause is fixed | `dataset-imports.runs-rerun` | resets the run to `discovered` and imports that root only |
| A foreign root waits for conversion (`conversionStatus` `pending`) | `dataset-imports.runs-rerun` | routes it to a conversion as the user: `recording-conversion` |
| One processing step of a Dataset failed | `datasets.reprocess` with `stepKey` `validate`, `register` or `derive` | `validate` and `register` rerun the root; `derive` rebuilds the derived assets |
| Change name, patterns, naming, schedule or media processing | `dataset-imports.update` | refused while the import is `scanning` or `importing` |

## Quarantined roots

A native root whose layout is invalid fails its run and opens an ImportQuarantine.

1. `import-quarantines.list` with `query` `workspaceId` and `status` `open`; match `datasetImportRunId`. `import-quarantines.get` shows `sourceLocation` and `validationResult`: each entry of `checks` has a `level` (`structural`, `contract`, `content`), an `outcome` (`pass`, `fail`, `warn`), a `message` and a `subject`.
2. Tell the user every `fail` in their terms (which file, what is wrong) and give the options:

| Option | Choose when | Do |
| --- | --- | --- |
| Fix and rerun (recommended) | the files can be corrected in the bucket | the user corrects them; then `dataset-imports.runs-rerun` for the run. When the run is `ready`, discard the quarantine: that closes it |
| Discard | the root is not wanted | `import-quarantines.discard` with `retentionOption` |

- `retentionOption` is a required label recorded with the decision, for example `retain-30d`. The call ends the quarantine as `discarded`; it cannot be reopened, and it removes no data.
- `import-quarantines.revalidate` and `import-quarantines.salvage` apply only to a quarantine with a `conversionJobId` (a recording): `recording-conversion`.
- `import-quarantines.transitions` shows who did what.

## Keep importing

| Option | Choose when | How |
| --- | --- | --- |
| On demand | data arrives rarely | `dataset-imports.start` when the user asks |
| Schedule | data arrives regularly; any provider | `dataset-imports.update` with `scanSchedule`, a 5-field cron such as `0 * * * *` (hourly). rFabric checks due schedules about every 15 minutes; `lastScheduledScanAt` shows the last scheduled run. Set it to null to stop |
| Bucket notifications | new data should be imported as it lands; `s3` and `gcs` connections | read [notifications.md](notifications.md): it needs an organization admin and one script run in the user's cloud account |
| Producer signal | the writer knows when a root is finished | `dataset-imports.datasets-notify` with `rootKey` (the root's prefix). It answers `queued` and `message` and imports that root at once, or right after the run that is open |

Bucket notifications reach an import only after it was started once. Neither notifications nor producer signals reach an import that is `cancelled` or `failed`: start a `failed` import again first.

## Cancel

`dataset-imports.delete` cancels the import (cancelling its Operation with `operations.cancel` does the same). Say first: it is final. The import can never be started again; the root in progress finishes, no other root starts; Datasets already imported and bytes already copied stay.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 on create, `reason` `connection_not_verified` in `details` | the connection is not verified | `storage-connection` to verify it |
| 422 on create, `is revoked and cannot back new imports` | the connection was revoked | pick or create another connection |
| 409 on create, `reason` `dataset_already_imported` in `details` | this root is already a Dataset: `datasetId`, `datasetImportId`, `datasetImportRunId` | show that Dataset; to refresh it, start that import; for renditions see Video renditions |
| 422, `not a valid 5-field cron expression` | bad `scanSchedule` | fix the cron |
| 409 on start, `is already scanning` or `importing` | a run is in progress | follow it (step 5) |
| 409 on start or rerun, `is cancelled` | the import was cancelled | create a new import |
| 409 on `dataset-imports.datasets-notify`, `cannot accept notifications` | the import is `failed` or `cancelled` | start a `failed` import again, then send the signal; a cancelled one needs a new import |
| 409 on rerun, `only failed or skipped roots can be re-run` | the run is not `failed` or `skipped` | nothing to rerun; read its status |
| 409 on rerun, `reason` `recording_inventory_required` | a foreign root has no inventory yet | `dataset-imports.start` to scan it again |
| 409 on probe, `Verify the storage connection before probing datasets` | connection not verified | `storage-connection` |
| 403 on browse, code `storage_permission_denied` | the bucket credentials deny the operation named in `details` | `storage-connection`: fix the grant |
| 409 on browse or playback, `reason` `connection_revoked`, `connection_not_verified` or `connection_degraded` | the bucket cannot be read now; link-mode Datasets are affected | `storage-connections.health` lists `affectedDatasets`; repair the connection with `storage-connection` |
| 422 on start, code `quota_exceeded`; the import turns `failed` | the workspace's monthly compute quota is used up (`details` give the usage and the quota) | tell the user the numbers; they raise the workspace compute quota (`compute-setup`), or wait for the next month; then start the import again |
| Operation `failed`, code `operation_timeout` | the run did not finish within 24 hours | read the runs: `ready` roots are imported; start the import again for the rest, or split a very large folder into several imports |
| Operation `failed`, code `dataset_import_failed` | every root failed | read each run's `failureReason` |
| Run stays `incomplete` | files are still missing in the root (`lastError`) | finish writing the root, then start the import again |
| Run `foreign`, `conversionStatus` `pending`, `reason` `missing_conversion_policy` under `conversionDiagnostic` in `meta` | no mapping template for this recording format | `recording-conversion` |
| 409 on `datasets.reprocess` | the step is already running, or the Dataset was not created by an import | wait, or nothing to do |
| 400 `reprocess_stream_not_in_dataset` | a stream id is not part of the Dataset (`streamIds` in `details`) | send only streams of that Dataset |

## Done when

- [ ] `dataset-imports.get`: `status` `completed`, or `partial` with every failed root explained to the user.
- [ ] `dataset-imports.list-runs`: every wanted root is `ready` with a `datasetId`.
- [ ] `datasets.processing-status` of each Dataset: `processingStatus` `ready` and `browsableAt` set.
- [ ] `episodes.list` count per Dataset matches the `totalEpisodes` the probe reported.
- [ ] With media processing: `derived-assets.list` shows no `failed` asset.
- [ ] No `open` quarantine is left for these roots without a decision by the user.
- [ ] The user knows the mode (copy or link) of each Dataset and what it implies.

## Next

- `episode-search`: find and inspect the imported Episodes.
- `enrichment`: descriptions, tags, embeddings and findings for the Episodes.
- `dataset-curation` and `dataset-version`: select Episodes and freeze them for training.
- `data-governance`: retention and residency for the imported data.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Browse and probe | `rfabric storage-connection list-objects <connection-id> --prefix <prefix>`, `rfabric storage-connection lerobot-probes <connection-id> --prefix <prefix>` |
| Create | `rfabric dataset-import create --storage-connection <connection-id> --field name=<name> --field sourcePrefix=<prefix> --field materializationMode=copy` |
| Start and follow | `rfabric dataset-import start <import-id> --wait` |
| Runs | `rfabric dataset-import runs ls <import-id>`, `rfabric dataset-import runs get <import-id> <run-id>`, `rfabric dataset-import runs rerun <import-id> <run-id>` |
| Producer signal | `rfabric dataset-import datasets-notify <import-id> --root-key <root>` |
| Quarantine | `rfabric import-quarantine ls`, `rfabric import-quarantine discard <quarantine-id> --retention-option <option>` |
| Notification setup | `rfabric storage-connection notification-setup <connection-id>` |
