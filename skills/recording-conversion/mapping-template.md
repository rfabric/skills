# Author a mapping template and convert again

Read this when a conversion left channels the user needs as opaque, ended `preserved`, or when the user wants other timestamps, units or frames than the standard mapping gives. A MappingTemplate (`mtpl_...`) says, per source channel, which stream it becomes, with which fields, clock, units and frame.

Two rules decide everything else:

- **A template replaces the standard mapping.** With a template bound, every channel the template does not assign is kept opaque, including standard types such as Imu or JointState. Assign every channel the user wants typed.
- **A template version never changes.** Each version is its own record with its own `mtpl_` id. An edit is a new version; a job keeps the exact version it was submitted with.

## At a glance

| # | Step | Who | Operations |
| --- | --- | --- | --- |
| 1 | Collect the channels and samples of a converted recording | agent | `conversion-jobs.get`, `mapping-reports.get` |
| 2 | Decide the mapping per channel | user, in the conversation | none |
| 3 | Custom message types: get their definitions | user, in their ROS workspace | none |
| 4 | Create the template | agent | `mapping-templates.list`, `mapping-templates.create` |
| 5 | Check it against the samples | agent | `mapping-templates.introspection`, `mapping-templates.preview` |
| 6 | Fix: a new version | agent | `mapping-templates.versions` |
| 7 | Convert again with the template | agent | `conversion-jobs.create` |

Permissions: `dataset:curate` to create a template or version (built-in roles `operator`, `admin`, `owner`); `dataset:read` to read and preview; `upload:operate` to convert.

## Steps

### 1. Collect the channels

From a job of this recording that ran (any outcome but a failed verification):

- `conversion-jobs.get`: `previewChannels`, one entry per decoded channel: `sourceChannel` (the topic), `sourceSchemaId`, `fields` (`path`, `dataType`) and up to 20 `samples` (`values` plus the receipt, log, header and publish timestamps that exist). It is null until an attempt inspected the source.
- `mapping-reports.get`: `channels` under `sourceInventory` lists every channel, decoded or not, with `schemaIdentity`, `encoding` and `sampleCount`; `channelMapping` and `warnings` say which are opaque and why (`no_standard_mapping`, `channel_not_decodable`).

A channel that was not decoded has no samples. It can be assigned once its message definition is supplied (step 3). A channel without any schema identity cannot be assigned.

### 2. Decide the mapping per channel

Show the user each channel with its fields and two sample values, propose a mapping, and let them confirm. The modality is theirs to choose: it states what the data means.

| Part of an assignment | Meaning | Default to propose |
| --- | --- | --- |
| `sourceChannel`, `sourceSchemaId` | the channel, as in `previewChannels` (or `name` and `schemaIdentity` in the report) | as read |
| `targetStream` | the stream's name: letters, digits, `_`, `-`; unique in the template | the topic with `/` replaced by `_` |
| `modality` | one of the converter's `supportedModalities` | none: ask. `custom_timeseries` for numeric data without a better fit |
| `fields` | `sourceField` (a dotted path, for example position.x inside pose), `targetField`, `dataType` | every sampled field under its own name |
| `timestamp` | the stream's clock: `source` `receipt`, `log`, `header`, `publish`, or `field` (with `field` and `unit` `ns`, `us`, `ms` or `s`), plus `clockDomain` | `log` when the samples carry `logTimestampNs`, else `receipt`; `clockDomain` `recorder` |
| `units` | per stream and target field, the unit of the values, or null | null unless the user knows it |
| `frameConventions` | per stream: a constant `frameId` (and `parentFrameId`), or the fields that carry them | none |

Units and frames are labels. They do not convert values or coordinates; never guess one.

### 3. Custom message types: get the definitions

Needed only for a channel reported `channel_not_decodable` or decoded wrongly because the recording carries no usable definition of its type. With a shell where the user's ROS 2 workspace is set up, collect the definitions and write the file yourself after the user approves; without one, hand the block over.

```text
Your turn - a terminal with your ROS 2 workspace (where the message package is built)
Why: rFabric decodes a custom message type only from its definition. It runs no code and fetches nothing, so the definition must be complete.
Who: anyone who has the message package's source or an installation of it.

For each custom type, for example acme_msgs/msg/ArmStatus:
1. Collect its .msg file and the .msg file of every type it uses that is not a primitive (float64, string, ...),
   standard types included, and the types those use. An installed package keeps them here:
   cat "$(ros2 pkg prefix std_msgs)/share/std_msgs/msg/Header.msg"
2. Put them in one text file in the folder this session runs in: the main type first, each further type
   after a separator line and a "MSG: <package>/<Type>" line:

   std_msgs/Header header
   acme_msgs/Joint[] joints
   ================================================================================
   MSG: std_msgs/Header
   builtin_interfaces/Time stamp
   string frame_id
   ================================================================================
   MSG: builtin_interfaces/Time
   int32 sec
   uint32 nanosec
   ================================================================================
   MSG: acme_msgs/Joint
   string name
   float64 effort

   For a Protobuf type instead, build one descriptor file with all imports and encode it as one line of text:
   protoc --include_imports --descriptor_set_out=types.desc <your .proto files>
   base64 -w0 types.desc > types.b64        (macOS: base64 -i types.desc -o types.b64)

It creates: one text file on your machine. Nothing is sent until I add it to the template.

Bring back: the file name and the exact type name (acme_msgs/msg/ArmStatus).
Then I: read the file, add the definition to the template and check it.
```

Each definition is one entry of `suppliedSchemas`: `schemaId` (any label, unique in the template), `name` (the type name exactly as the channel declares it), `encoding` `ros2msg` or `protobuf`, `definition` (the file's text). Up to 32 entries; one definition at most 256 KiB, all together at most 1 MiB.

### 4. Create the template

`mapping-templates.list` with `workspaceId` and `sourceFormat` first: reuse or extend an existing template rather than adding a second one for the same recordings.

`mapping-templates.create`:

```json
{
  "workspaceId": "wks_...",
  "name": "arm-bench",
  "version": "1",
  "sourceFormat": "ros2_bag",
  "converterName": "rfabric-recording-converter",
  "converterVersion": "1.0.0",
  "assignments": [
    {
      "sourceChannel": "/arm/status",
      "sourceSchemaId": "<sourceSchemaId of the channel>",
      "targetStream": "arm_status",
      "modality": "custom_timeseries",
      "fields": [
        { "sourceField": "position", "targetField": "position", "dataType": "number" },
        { "sourceField": "effort", "targetField": "effort", "dataType": "number" }
      ],
      "timestamp": { "source": "log", "clockDomain": "recorder" }
    }
  ],
  "units": { "arm_status": { "position": "rad", "effort": null } },
  "frameConventions": {},
  "suppliedSchemas": []
}
```

- `sourceFormat`, `converterName` and `converterVersion` must equal the job's; a template for `ros2_bag` does not serve `mcap`.
- Each channel and each `targetStream` appears in one assignment only. `units` and `frameConventions` may name only assigned streams and fields.
- Tell the user: recordings of this format that a dataset import finds are converted with the newest template of the workspace, so this template also applies to them.

### 5. Check it against the samples

1. `mapping-templates.introspection`: `supportedModalities`, `assignmentCount` and the `suppliedSchemas` as stored.
2. `mapping-templates.preview` with `sampleSourceInventory` `{"channels": [...]}`: the job's `previewChannels`, at most 32 channels with 20 samples each and 1 MiB in total.

The preview returns `valid`, the resulting `streams` with mapped sample values, `transformations`, and `diagnostics`:

| `code` | Meaning |
| --- | --- |
| `missing_channel` | an assignment names a channel that is not in the samples |
| `unassigned_channel` | a sampled channel has no assignment and would be kept opaque |
| `missing_field`, `missing_schema_field` | a `sourceField` is not in the samples or the schema |
| `type_mismatch` | a value does not have the declared `dataType` |
| `missing_timestamp`, `invalid_timestamp` | the chosen timestamp source is absent or not usable |
| `invalid_frame` | a frame field is absent or not a frame name |

Show the user the mapped samples next to the source values. The preview checks only these samples: it does not read the recording and proves nothing about sample counts. The conversion and its mapping report do.

### 6. Fix: a new version

`mapping-templates.versions` with the template's id and the whole configuration again (`version`, `sourceFormat`, `assignments`, `units`, `frameConventions`, `suppliedSchemas`, `converterName`, `converterVersion`), with a new `version` label. It returns a new record: use its `id` and `version` from here on. Preview again.

### 7. Convert again with the template

`conversion-jobs.create` as in step 4 of `SKILL.md`, with:

- `sourceLocation` copied from the earlier job: `kind`, `mode`, `storageConnectionId` or `uploadGroupId`, `rootKey`, `metadata`, and for each member `relativePath`, `role`, `sizeBytes`, `sha256`. Nothing is uploaded again.
- `parentConversionJobId`: the earlier job.
- `mappingTemplateId` and `mappingTemplateVersion`: the record from step 4 or 6.

The result is a new job and a new Dataset linked to the earlier one; the earlier Dataset stays as it is. Tell the user both exist, so they can keep one. Then continue at step 5 of `SKILL.md` and compare the two mapping reports: the channels that were opaque should now be typed.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 on create, duplicate | a template with this `name` and `version` exists in the workspace | add a version to it (step 6) or choose another name |
| 409 on versions, `A new template version must have a distinct version label` | the `version` equals the parent's | use a new label |
| 422, `The selected converter version is unavailable in this workspace` | wrong `converterName` or `converterVersion` | `format-registry.list-converters` |
| 422, `Assignment modality is not supported by the selected converter` (`sourceChannel`, `modality` in `details`) | the modality is not in `supportedModalities` | choose a supported one |
| 422, `Each channel/schema and target stream requires a distinct assignment` | a channel or stream name is used twice | one assignment each |
| 422, `Units must name assigned target streams and fields` | `units` names a stream or field that is not assigned | match the assignments |
| 422, `Schema references an unavailable type; supply all dependencies inline` | a custom type's dependency is missing from `definition` | the user adds that type to the file (step 3) |
| 422, `Supplied schema does not define its named root type` | `name` is not the type that `definition` starts with | correct `name` |
| 422, `Preview request must be bounded JSON of at most 1048576 bytes` | too many or too large samples | fewer channels or samples per call |
| Warning `assignment_unmatched` in the new mapping report | the template assigns a channel this recording does not contain | harmless for this recording; check the topic name and `sourceSchemaId` |
| Job `preserved` again | no assignment matched a decodable channel | compare `sourceChannel` and `sourceSchemaId` with `previewChannels`; supply missing definitions |

## Done when

- [ ] `mapping-templates.preview` returns `valid` true with no `unassigned_channel` for a channel the user wants typed.
- [ ] The new job is `completed`; its mapping report shows the wanted channels with a `targetStream`, and `passed` true in `conservationResults`.
- [ ] The user knows the template's name, id and version, and which Dataset to keep.
