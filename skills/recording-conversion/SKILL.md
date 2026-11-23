---
name: recording-conversion
description: >-
  ROS 2 bag or MCAP recordings converted into a Dataset whose Episodes carry typed SensorStreams at native rates, with a mapping report that accounts for every channel. Use when the user wants to import or convert a rosbag, a ROS 2 bag directory or an MCAP file from this machine or a connected bucket, asks why a conversion failed, was quarantined or left channels opaque, wants to map custom topics or message types, or retry, cancel or salvage a conversion. Not for LeRobot datasets: those are `dataset-upload` and `dataset-import`.
---

# Convert ROS 2 bag and MCAP recordings

The user ends up with a Dataset (`ds_...`, format `rfabric_native`) built from a recording: by default one Episode (`ep_...`) per recording, one SensorStream (`ss_...`) per topic and message type, each at its own rate.

- **ConversionJob** (`cj_...`): one conversion of one recording with one fixed configuration.
- **MappingReport** (`mrep_...`): what happened to every channel: typed, kept opaque or dropped, with sample counts.
- **MappingTemplate** (`mtpl_...`): an optional, versioned mapping of channels to streams, for types rFabric does not map by itself.
- **ImportQuarantine** (`iq_...`): a recording that failed validation and waits for a decision.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Inspect the recording, build its member inventory | agent | local files, or `storage-connections.list-objects`, `storage-connections.list-objects-content` | hashing local files |
| 2 | Local recording only: upload its files as one upload group | agent | `upload-sessions.create` and the rest of `dataset-upload` steps 2 to 4 | the upload |
| 3 | Find the converter | agent | `format-registry.list-converters` | none |
| 4 | Submit the conversion | agent | `conversion-jobs.create`, `operations.get` | source verification; a bucket copy is made now |
| 5 | Follow the job | agent | `conversion-jobs.get` | the conversion (one attempt may run up to 24 hours) |
| 6 | Read the mapping report, tell the user | agent | `mapping-reports.get`, `datasets.get`, `episodes.list`, `sensor-streams.list` | none |

## Before you start

- **Permissions**: `upload:operate` to submit, retry and cancel (built-in roles `operator`, `admin`, `owner`); `upload:read` to read jobs and mapping reports (also `member`). Mapping templates: `dataset:read` to read and preview, `dataset:curate` to create (`operator`, `admin`, `owner`). `importQuarantine:resolve` for quarantine decisions.
- **Needs**: a Workspace (`workspace-setup`). For a recording in a bucket: a verified StorageConnection (`storage-connection`). For a local recording: the files inside your working directory.
- **What converts**: a ROS 2 bag directory (a metadata.yaml file plus `.db3` or `.mcap` parts, split parts included) and a standalone `.mcap` file. Messages encoded as CDR (ROS 2), JSON or Protobuf can be decoded: standard ROS 2 types become typed streams by themselves, other types through a mapping template. Everything else is kept as opaque bytes with its timestamps. No ROS installation is needed.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Recording | what to convert | a local path, or a storage connection and folder |
| Workspace | where the Dataset lands | `workspaces.list`; ask only with more than one |
| Copy or link (bucket only) | Decisions | no default: the user chooses |
| Episodes | how the recording is cut | default: one recording, one Episode |
| Mapping | Decisions | default: standard mapping |
| Dataset name | the converted Dataset is named `Conversion ` plus the job id until renamed | default: the recording's file or folder name, set in step 6 |

## Decisions

**Copy or link**, for a recording in a bucket (`mode` of the source). A local upload is always `copy`.

| Option | Choose when | Consequence |
| --- | --- | --- |
| `copy` (recommended) | the originals should stay available whatever happens to the bucket | rFabric keeps its own copy of the original bytes under the workspace's retention; deleting the source later does not remove it; uses workspace storage for the whole recording |
| `link` | the originals must stay only in the user's bucket | rFabric keeps the object coordinates and identities only; the converted Dataset stays usable, but retry, rerun and download of originals fail once the objects change or access ends |

**Mapping**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Standard mapping (recommended) | the topics use standard ROS 2 message types | no template; types without a standard mapping are kept opaque and named in the report |
| Mapping template | custom message types, plain JSON or Protobuf channels, or other timestamps, units or frames | the template replaces the standard mapping for the whole recording: every channel it does not assign is kept opaque. Read `mapping-template.md` in this skill's directory |

Run the standard mapping first unless a template for these recordings exists: the first job shows every channel and decoded samples, which a template needs.

**Episodes** (`segmentationConfig`)

| `mode` | Result | Extra fields |
| --- | --- | --- |
| `one_file_one_episode` (default) | the whole recording is one Episode; split parts stay together | none |
| `split_by_time_gap` | a new Episode after each silence longer than the gap | `gapNs` |
| `split_by_duration` | Episodes of a fixed length | `durationNs` |
| `split_by_marker` | a new Episode at each message of one channel | `sourceChannel`, `sourceSchemaId` |
| `episode_manifest` | exactly the ranges the user names; samples outside are excluded and counted | `ranges` (`name`, `startNs`, `endNs`; inclusive, not overlapping) |

Nanosecond values are strings.

## Steps

### 1. Inspect the recording and build the inventory

The inventory is the list of the recording's files (`members`), each with a `role`.

**ROS 2 bag directory.** Read its metadata.yaml (locally, or `storage-connections.list-objects-content` with `key` `<folder>/metadata.yaml`). Under `rosbag2_bagfile_information`:

- `version`, `storage_identifier`, `relative_file_paths`: needed for the request (step 4).
- `topics_with_message_count`: each topic's name, message type and message count. Show them to the user.

| Member | `role` | Order |
| --- | --- | --- |
| metadata.yaml | `metadata` | first, exactly one |
| each file in `relative_file_paths` | `data` | next, in that order |
| any other file | `attachment` | last, sorted by path |

**Standalone MCAP.** Exactly one member, the `.mcap` file, `role` `data`, no metadata. Its topics cannot be listed before conversion: say so, and that the mapping report names every channel afterwards.

**Sizes.** Local: measure every file (the rFabric agent calls `rfabric_upload` with only `path`: `size`, `sha256`). Bucket: `storage-connections.list-objects` under the folder, level by level, gives each file's `size`; send no `sha256`.

Tell the user before any change: kind, number of parts, total size, the topics (bag), and which message types have a standard mapping. Those are Imu, JointState, Image, CompressedImage, PointCloud2, LaserScan, TFMessage, PoseStamped, PoseWithCovarianceStamped, Odometry, TwistStamped, NavSatFix, BatteryState, WrenchStamped, DiagnosticArray, Temperature, FluidPressure, Range and MagneticField. Every other type is kept opaque unless a template assigns it.

### 2. Local recording: upload the files

Follow `dataset-upload` steps 2 to 4 with these values: `datasetFormat` `ros2_bag` or `mcap`, `fileName` the member's relative path, one `clientGroupId` for the recording, `expectedMemberCount` the number of members (1 for a standalone MCAP), no `provenanceEnvelope`. The permission, the approvals and the resume rules of `dataset-upload` apply. For a file of several GB, raise `partSizeBytes` as described there, or use the CLI, which uploads and submits in one command (The rfabric CLI).

Done when `upload-groups.get` shows `status` `complete`. Its `datasetImportId` stays null: a recording starts no import, the conversion is submitted in step 4. Keep the `uploadGroupId`.

### 3. Find the converter

`format-registry.list-converters` with `workspaceId`, `direction` `import` and `formatKey` `ros2_bag` or `mcap`. Take `name` and `version` of the entry with `enabled` true (the platform converter is `rfabric-recording-converter`). Its `supportedModalities` are the modalities a template may use.

### 4. Submit the conversion

`conversion-jobs.create`, here for an uploaded bag:

```json
{
  "workspaceId": "wks_...",
  "sourceFormat": "ros2_bag",
  "converterName": "rfabric-recording-converter",
  "converterVersion": "1.0.0",
  "sourceLocation": {
    "kind": "ros2_bag",
    "mode": "copy",
    "uploadGroupId": "ugrp_...",
    "metadata": {
      "dialect": "9",
      "storageIdentifier": "mcap",
      "relativeFilePaths": ["run_0.mcap", "run_1.mcap"]
    },
    "members": [
      { "relativePath": "metadata.yaml", "role": "metadata", "sizeBytes": "2481", "sha256": "<hex>" },
      { "relativePath": "run_0.mcap", "role": "data", "sizeBytes": "1073741824", "sha256": "<hex>" },
      { "relativePath": "run_1.mcap", "role": "data", "sizeBytes": "734003200", "sha256": "<hex>" }
    ]
  },
  "segmentationConfig": { "mode": "one_file_one_episode" }
}
```

- `sourceFormat` equals `kind`: `ros2_bag` or `mcap`.
- `metadata` only for a bag: `dialect` is `version` as text, `storageIdentifier` is `storage_identifier`, `relativeFilePaths` is `relative_file_paths` in the same order. For `mcap` leave it out.
- Bucket source: `storageConnectionId` and `rootKey` (the folder's key without leading or trailing `/`; leave out for a recording at the connection's root) instead of `uploadGroupId`, and `mode` `copy` or `link`.
- `sizeBytes` is a string. `relativePath` is relative to the recording's folder.
- A template: `mappingTemplateId` and `mappingTemplateVersion`, always both.

An uploaded standalone MCAP has this `sourceLocation` (and `sourceFormat` `mcap`):

```json
{
  "kind": "mcap",
  "mode": "copy",
  "uploadGroupId": "ugrp_...",
  "members": [{ "relativePath": "run-42.mcap", "role": "data", "sizeBytes": "1073741824", "sha256": "<hex>" }]
}
```

The call returns an Operation (`op_...`) that verifies the source before a job exists: every member is read and checked against the inventory; `copy` from a bucket copies the bytes now. Poll `operations.get` until `succeeded`; `conversionJobId` is in its `result`. A failed verification is the Operation's `error` (`code`, `message`, and the member in `details`).

The same recording with the same configuration returns the job that already exists instead of converting twice, unless that job `failed` or was `cancelled`.

### 5. Follow the job

Poll `conversion-jobs.get` every 15 to 30 seconds. `progress` has a `phase` (`preflight`, `decoding`, `validating`) and whatever counts are known (bytes, members, streams, episodes); a total may be missing, so never state a percentage rFabric did not give. `throughputBytesPerHour`, when set, lets you estimate the time left. The conversion runs on rFabric's compute and continues when the session closes.

| `status` | Tell the user | Next |
| --- | --- | --- |
| `queued` | verified, waiting for a converter | wait |
| `running` | converting; which phase and counts | wait |
| `completed` | Episodes are validated and published: `producedDatasetId`, `mappingReportId` | step 6 |
| `preserved` | kept, not converted: the original bytes and inventory are stored, but no channel produced a typed stream | step 6, then a mapping template |
| `quarantined` | nothing was published: the recording is damaged, or the mapping or the episode cut does not fit it (`importQuarantineId`, `diagnostics`) | Quarantined recordings |
| `failed` | the attempt stopped before publishing (`errorMessage`, `diagnostics`); the source is kept | Retry or cancel |
| `cancelled` | stopped on request; unpublished output discarded, source kept | Retry or cancel |

After 15 minutes of `running` stop polling: give the job id, where it stands, and that the user can ask for its status any time.

### 6. Read the mapping report and tell the user

`mapping-reports.get` with the job's `mappingReportId` (or `mapping-reports.by-dataset` with the Dataset id):

| Part | What it says |
| --- | --- |
| `channelMapping` | per source channel: `targetStream`, `modality` and `fidelity` (`lossless`, `lossy`, `dropped`) for a typed stream; `opaqueLocation` and `limitations` for a channel kept opaque; `dropReason` for a dropped one; `excludedSampleCount` |
| `warnings` | `code`, `message`, `sourceChannel`: for example `no_standard_mapping`, `channel_not_decodable`, `time_reordered`, `timestamp_repeated`, `clock_disagreement` |
| `transformations` | every change of a field, unit, frame or timestamp, with its `fidelity` and `reason` |
| `episodeSummary` | per Episode: source range, `inputSampleCount`, `outputSampleCount`, `gaps`, `validationPassed` |
| `conservationResults` | `passed` and the `checks` (source count against target count per metric) |

Then `datasets.get` for the Dataset, `episodes.list` with `datasetId`, and `sensor-streams.list` with an `episodeId`. Rename the Dataset with `datasets.update` (`name`) to the name the user wants. Report every channel, not only the successes:

```text
Converted run-42 into dataset ds_01J... (1 episode).

| Topic | Type | Result |
| --- | --- | --- |
| /camera/front/image_raw | sensor_msgs/msg/Image | video stream; original frames kept, playback copy is lossy |
| /joint_states | sensor_msgs/msg/JointState | proprioception, lossless |
| /arm/status | acme_msgs/msg/ArmStatus | kept opaque: no standard mapping |

Warnings: 12 repeated timestamps on /imu/data (kept as recorded).
Every sample is accounted for (conservation passed).
Left for you: /arm/status is stored but not readable as data. Say "map /arm/status" to add a mapping and convert again.
```

## Fix the mapping and rerun

When channels the user needs are opaque, or the job is `preserved`: read `mapping-template.md` in this skill's directory. In short: author a MappingTemplate from the job's `previewChannels`, check it with `mapping-templates.preview`, then submit `conversion-jobs.create` again with the same `sourceLocation` as the first job, `parentConversionJobId` the first job, and the template's id and version. A new mapping creates a new Dataset linked to the first; the first is not changed.

## Retry or cancel

- **Retry**: `conversion-jobs.retry` (body `{}`) for a job that is `failed`, `cancelled`, `quarantined` or `preserved`. It converts the retained source again with the same configuration, as a new job; it returns an Operation as in step 4. Retry only after the cause is gone: a retry of an unchanged, corrupt recording ends the same way.
- **Cancel**: `conversion-jobs.cancel` (optional `reason`) for a `queued` or `running` job. Say first: unpublished output is discarded, the source is kept, and a cancelled job cannot continue (a retry starts again). A published Dataset is never removed by a cancel.
- `conversion-jobs.transitions` lists a job's status changes; `conversion-jobs.list` with `workspaceId` and `status` finds jobs.

## Quarantined recordings

A damaged recording, an assigned channel that cannot be read, or an episode cut that does not fit quarantines the job: nothing is published.

1. `conversion-jobs.get`: in `diagnostics`, `code` and `message` say what stopped it. For damaged bytes there is also `corruptRange` (`member`, `byteOffset`, `byteLength`, `messageStartNs`, `messageEndNs`) and, under `recoverable`, `intactRanges` (`name`, `startNs`, `endNs`). `import-quarantines.get` with the job's `importQuarantineId` has the failed checks in `validationResult`.
2. Tell the user what stopped it and what is known to be intact, then let them choose:

| Option | Choose when | Do |
| --- | --- | --- |
| Correct and convert again | `code` names the configuration, for example `segmentation_marker_missing`, `episode_range_outside_recording` or `assignment_encoding_unsupported` | `conversion-jobs.create` with the same `sourceLocation`, the corrected `segmentationConfig` or template version, and `parentConversionJobId` the quarantined job. When the new job is `completed`, discard the quarantine |
| Salvage intact ranges | part is damaged, the rest is wanted | below |
| Retry | the cause was outside the recording and is fixed | `import-quarantines.revalidate`: a new job with the same configuration; the quarantine stays `open`. When the new job is `completed`, discard the quarantine: that closes it |
| Discard | the recording is not wanted | `import-quarantines.discard` with `retentionOption` (a required label recorded with the decision, for example `retain-30d`); final, and it removes no data |

**Salvage**, three calls:

1. `conversion-jobs.create` with the quarantined job's source (its `sourceLocation`: `kind`, `mode`, source ids, `rootKey`, `metadata`, and per member `relativePath`, `role`, `sizeBytes`, `sha256`), the same converter and template, `parentConversionJobId` the quarantined job, and `segmentationConfig` `{"mode": "episode_manifest", "ranges": [...]}` with the ranges the user picked from `intactRanges`. Use them as given: a range that reaches into the damage fails by name.
2. Follow the new job to `completed` (step 5).
3. `import-quarantines.salvage` with `salvageReport` (`conversionJobId` the new job, `selectedRanges` the same ranges, `excludedRanges` the ranges left out, or an empty list) and `resolvedDatasetId` the new job's `producedDatasetId`. The quarantine becomes `salvaged`.

The salvaged Dataset reports its gaps and excluded ranges; say so in the final report.

## Recordings found by a dataset import

A `dataset-import` run with `rootClassification` `foreign` is a recording found in a bucket. rFabric converts it with the newest MappingTemplate of the workspace for that format; the job id is `conversionJobId` under the run's `meta`. When `conversionStatus` stays `pending`, read `reason` under `conversionDiagnostic` in the run's `meta`:

| `reason` | Do |
| --- | --- |
| `missing_conversion_policy` | no template for the format: convert the recording directly (steps 1 to 6, with the import's storage connection and the root as `rootKey`), or create a template (`mapping-template.md`) and rerun the root |
| `authorized_recording_submission_required` | the run was started by a schedule or notification: `dataset-imports.runs-rerun` converts it as the user |
| `recording_inventory_required`, `unknown_source_format` | `dataset-imports.start` scans the root again |

## Joints in 3D playback

`episodes.spatial-model` for one Episode returns the robot `model` and the `jointMapping` the player uses. A converted JointState stream has one channel per joint (key `position.{joint}`); a joint whose name equals a model joint is driven without any mapping. No `model`: the robot or Dataset has no published robot model (`sim-asset-build` covers robot models).

Joint names that differ need a JointMapping (`jmap_...`). Each entry repeats the model's joint definition, so the user sets it in the rFabric app: open the Episode in the player, and in the 3D panel fill the "Joint mapping" table and save. Verify with `joint-mappings.list` (`datasetId`). When the user supplies complete `entries`, use `joint-mappings.create`, or `joint-mappings.update` when one exists: a Dataset has one mapping, and a second create answers 409 with `jointMappingId` in `details`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 403, `Missing grant upload:operate` | the user's role cannot submit conversions | name the permission; `member-access` finds why it is missing and what can add it |
| 422, message `governance_format_denied` | the workspace setting `upload.allowedFormats` does not allow this format | an `owner` or `admin` changes the setting (`workspace-setup`) |
| 422, `An enabled import converter accessible to this workspace is required` | wrong converter name or version, or the converter is disabled | step 3 |
| 422, `ROS 2 directory requires metadata.yaml` or `Metadata data members must exactly match the ordered inventory` | the inventory does not follow the table in step 1 | rebuild it from metadata.yaml |
| 422, `Standalone MCAP requires exactly one data member and no directory metadata` | an MCAP source with several members | one job per `.mcap` file |
| 422, `Converter and source format must match the immutable template version` | the template was made for another format or converter | a template version for this format |
| 409, `The complete upload inventory must be verified before conversion` | the upload group is not `complete` | finish the upload (step 2) |
| 422, `Recording member does not match a completed managed upload` (`memberPath` in `details`) | a member's path or size differs from the uploaded file | correct the inventory |
| 409, `Reprocessing must use the captured parent recording` | the source differs from the parent job's | copy `sourceLocation` from the parent job; changed bytes are a new submission without a parent |
| Operation `failed`, `Recording member size changed`, `Recording checksum does not match original bytes` or `Missing recording member` | the files changed after the inventory was built, or one is missing | build the inventory again and submit again |
| Operation `failed`, `Consistent source reads are unavailable; upload a managed copy` | the bucket gives rFabric no way to tell that an object stayed unchanged between reads (`memberPath` in `details`) | upload the recording from this machine instead (step 2), after the user downloaded it |
| Operation `failed`, code `source_verification_failed` | the source could not be read | check the connection (`storage-connection`), then submit again |
| 409 on retry, `Only unsuccessful terminal attempts may be retried` | the job is running or completed | nothing to retry |
| 409 on cancel, `is already` a final status | the job already ended | read its status |
| Job `quarantined`, `code` `assignment_encoding_unsupported` in `diagnostics` | the template assigns a channel whose message encoding cannot be decoded | remove that assignment in a new template version and convert again (Quarantined recordings) |
| 409 on `conversion-jobs.original`, `reason` `source_unavailable`, `source_expired` or `source_identity_changed` | the original is gone or changed (linked source) or past its retention | restore access to the source, or submit a new copy |
| 409 on salvage, `Salvage requires a newly validated lineage-linked conversion result` | the job named is not a completed `episode_manifest` child of the quarantined job | run salvage step 1 and 2 first |

## Done when

- [ ] `conversion-jobs.get`: `status` `completed`, with `producedDatasetId` and `mappingReportId`.
- [ ] `mapping-reports.get`: `passed` is true in `conservationResults`, and every channel's outcome was reported to the user, including opaque and dropped ones.
- [ ] `datasets.get`: `processingStatus` `ready`; `episodes.list` returns the expected Episodes.
- [ ] No quarantine of this recording is left `open` without the user's decision.
- [ ] The user has the job id, the Dataset id and the link `https://app.rfabric.io/open/<dataset id>`.

## Next

- `episode-search`: inspect the converted Episodes and their streams.
- `enrichment` and `annotation-project`: add descriptions, tags and labels.
- `dataset-curation` and `dataset-version`: select Episodes and freeze them for training.
- `dataset-export`: download the Episodes as a checksummed bundle for an external trainer or a partner.

## The rfabric CLI

The CLI builds the inventory, uploads local files and submits in one command: prefer it for a recording of many files or many GB. With a shell, run it yourself after the user approves; without one, hand it over as a "Your turn" block.

| Step | CLI |
| --- | --- |
| Convert a local bag or MCAP | `rfabric conversion-job submit --workspace <workspace> --dir <bag-dir> --wait`, `rfabric conversion-job submit --workspace <workspace> --file <file.mcap> --wait` |
| Convert from a bucket | `rfabric conversion-job submit --workspace <workspace> --storage-connection <connection-id> --root-key <folder> --mode copy` |
| Segmentation, template | `--segmentation '{"mode":"split_by_time_gap","gapNs":"2000000000"}'`, `--mapping-template <template-id> --mapping-template-version <version>` |
| Follow, retry, cancel | `rfabric conversion-job watch <job-id>`, `rfabric conversion-job retry <job-id> --wait`, `rfabric conversion-job cancel <job-id> --reason <text>` |
| Mapping report | `rfabric conversion-job report <job-id>`, `rfabric mapping-report by-dataset <dataset-id>` |
| Template preview from a job | `rfabric mapping-template preview <template-id> --from-job <job-id>` |
| Quarantine | `rfabric import-quarantine revalidate <quarantine-id>`, `rfabric import-quarantine discard <quarantine-id> --retention-option <option>` |
| Original member | `rfabric conversion-job original <job-id> --member <path> --out <file>` |
