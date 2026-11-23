---
name: enrichment
description: >-
  Episodes carrying machine-made descriptions, tags, embeddings, segments, metrics, findings or transcripts, with coverage reported. Use when asked to enrich, describe, tag, embed, transcribe, segment or analyze episodes, turn an enrichment method on for new data, choose where a method runs, follow, resume or cancel an enrichment run, read coverage, gaps or findings, work an enrichment review queue, or register an enrichment method of the user's own. Not for human labels: that is `annotation-project`.
---

# Enrich episodes

The user ends up with enrichment records on their Episodes (`ep_...`) and a coverage figure per method. An **enrichment method** is an EnricherRegistration (`enr_...`): either a platform method rFabric provides (`managed` `platform`) or a workspace method the user registered (`managed` `tenant`). Whether a method runs for a scope is an EnrichmentPassEntry (`enpe_...`); where a platform method runs for a workspace is an EnricherPlacement (`enpl_...`). A run is one Operation (`op_...`) that fans out to one EnrichmentJob (`enj_...`) per dataset and method.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read the methods, the switches and the coverage | agent | `enrichment.list-enrichers`, `enrichment.pass`, `enrichment.coverage` | none |
| 2 | Choose methods and where they run | user decides, agent applies | `enrichment.replace-pass-entries`, `enricher-placements.create` | none |
| 3 | Preview the run | agent | `enrichment.runs-preview` | none |
| 4 | Launch | agent | `enrichment.runs` | none |
| 5 | Follow the run | agent | `operations.get`, `enrichment.list-jobs` | until the Operation settles; one batch can take up to the method's `maxRuntimeS` |
| 6 | Read what it wrote | agent | `enrichment.coverage`, `enrichment.gaps`, `enrichment.descriptions`, `enrichment.findings` | none |
| 7 | Work the review queues | user decides each item, agent records | `enrichment.description-reviews`, `enrichment.description-reviews-decide` | the user's review time |
| 8 | Recover: resume, fill gaps, cancel | agent | `enrichment.jobs-resume`, `operations.cancel` | as step 5 |

To register a method the user builds themselves, read [workspace-method.md](workspace-method.md) in this skill's directory, then come back to step 3.

## Before you start

- **Permissions**:

  | To | Permission | Built-in roles that carry it |
  | --- | --- | --- |
  | read methods, coverage and records | `enrichment:read` | `member`, `operator`, `auditor`, `admin`, `owner` |
  | preview, launch, resume, cancel | `enrichment:run` | `member`, `admin`, `owner` |
  | switch methods on or off (pass entries), edit checklists, vocabularies, geofences | `enrichment:configure` | `admin`, `owner` |
  | place a method on a pool, register a workspace method | `enrichment:register` | `admin`, `owner` |
  | decide review items | `curation:review` | `member`, `admin`, `owner` |
  | switch off or un-require a required redaction method | `enrichment:requireOverride` | `admin`, `owner` |

- **Needs**: a Dataset whose processing has finished (`dataset-upload`, `dataset-import`, `recording-conversion`). To run a method on the user's own compute: an active compute pool that admits enrichment batches (`compute-setup`).
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | What they want to learn from the episodes | it selects the methods | the table under Decisions |
  | Which episodes | the scope of the run | datasets by name (`datasets.list`), a query, or episode ids; default: the dataset they named |
  | Once, or for all data that arrives later | a run versus a pass entry | default: once |

## Decisions

**Which methods.** The live list is `enrichment.list-enrichers`; its `about` says how each method works and what it cannot do.

| The user wants | Method (`enricher`) | Writes |
| --- | --- | --- |
| to search by a description in words, or find similar episodes | `platform-visual-embeddings` (frames), `platform-temporal-embeddings` (4 s clips, motion), `platform-multimodal-embeddings` | `embedding` |
| a 2D map of a dataset with clusters | `platform-dataset-map` (adds the visual embeddings it needs) | `clusterAssignment`, `projection` |
| a description per episode: summary, scene, lighting, objects, notable events, a success guess, checklist answers | `platform-episode-description` | `description` |
| which objects are visible, when and where | `platform-open-vocabulary-detection` | `tag` |
| which task is performed | `platform-activity-recognition` | `tag` |
| the phases of each episode | `platform-changepoint-segmentation` | `segment` |
| path length, time to completion, idle time, smoothness, gripper cycles, contacts | `platform-trajectory-metrics` (adds the segmentation it needs) | `metric` |
| sensor problems: time offsets, dropped samples | `platform-sensor-health` | `finding`, `metric` |
| unusual moments in numeric channels | `platform-timeseries-anomaly` | `finding` |
| vibration trends per robot | `platform-vibration-trends` | `metric` |
| speech as text, sound events, who speaks when | `platform-audio-transcription`, `platform-sound-events`, `platform-voice-activity` | `transcript`, `tag`, `speechSegment` |
| video, transcripts or GPS redacted before others read them | `platform-visual-redaction`, `platform-transcript-redaction`, `platform-geospatial-redaction` | `rendition`, `transcript` |
| something none of these measure | a workspace method: [workspace-method.md](workspace-method.md) | what its manifest declares |

**How it runs.**

| Option | Choose when | Consequence |
| --- | --- | --- |
| One run, methods named (recommended first) | trying a method, or a one-off question | nothing changes for later data |
| Enable the method for a dataset or the workspace | every episode that arrives should carry it | each later import runs it automatically and uses compute each time |
| Mark it required | downstream work must not proceed without it (redaction) | a required redaction method withholds media until it has run; un-requiring it later needs `enrichment:requireOverride` |

**Where a platform method runs.**

| Option | Choose when | Consequence |
| --- | --- | --- |
| rFabric's Platform compute (recommended) | no constraint on where data is processed | nothing to set up; `computePoolId` reads null |
| A pool of the user's own | the data must be processed in their cloud account or on their machines, or they want the compute on their own bill | needs a capable pool (`compute-setup`) and `enrichment:register`; applies to every version of that method in the workspace |

## Steps

### 1. Read the methods, the switches and the coverage

1. `enrichment.list-enrichers` with `workspaceId`: per method `enricher`, `version`, `group`, `costClass` (`light`, `standard`, `heavy`, `gpu`), `outputKinds`, `modalities`, `dependsOn`, `parametersSchema`, `status`.
2. `enrichment.pass` with `scopeType` (`workspace` or `dataset`) and `scopeId`: per method `enabled`, `required`, `parameters`, `unavailable`, and `resolvedFrom` (`dataset`, `workspace`, `organization` or `default`), which says whose decision it is.
3. `enrichment.coverage` with `workspaceId` and optionally `datasetId`: per method and version `covered`, `total`, `ratio`, `lastRecordAt`. A method without a row has never written there.

Tell the user in one table: method, on or off and at which level, coverage.

### 2. Choose methods and where they run

Skip this step for a one-off run on rFabric's compute.

- **Switch**: `enrichment.replace-pass-entries` with `scopeType` (`organization`, `workspace`, `dataset`), `scopeId`, `enricher`, `enabled`, and optionally `required`, `enricherVersion` (a pin; omit for the latest), `ordinal`, `parameters`. The narrowest entry wins: dataset, then workspace, then organization, then the method's own default. `enrichment.delete-pass-entries` removes an entry so the scope inherits again; `enrichment.list-pass-entries` shows what is set directly at a scope.
- **Placement**: `compute-pools.list` to find a pool whose `status` is `active`, whose `taskTypes` contain `"enrichment.batch"` and whose `capabilities` fit the method's `resourceClass` and `maxRuntimeS`; the organization's or workspace's own pools and pools with `offered` true qualify. Then `enricher-placements.create` with `workspaceId`, `enricher`, `computePoolId`. A workspace has one placement per method: change it with `enricher-placements.update`, return to Platform compute with `enricher-placements.delete`. The method's image, settings and machine size stay those of the method.

Say before the call what will run automatically from now on, and on whose compute.

### 3. Preview the run

`enrichment.runs-preview` takes the launch request and plans it without writing:

```json
{
  "workspaceId": "wks_...",
  "scope": { "datasetIds": ["ds_..."], "query": "has:camera" },
  "enrichers": ["platform-episode-description"],
  "missingOnly": true,
  "parameters": { "platform-episode-description": {} }
}
```

- `scope` is one of: `datasetIds` (1 to 100) with an optional `query`; `query` alone (`""` is the whole workspace); `episodeIds` alone (1 to 10,000). The query grammar is in `episode-search`.
- Omit `enrichers` to run every method enabled for the scope. Named methods narrow the run; required methods run either way.
- `missingOnly` true runs each method only on episodes that lack its output at its current version.
- `parameters` are settings for this run only, per method, checked against its `parametersSchema`; they never change a pass entry.

Report from the response, before launching:

| Read | Tell the user |
| --- | --- |
| `episodes`, `durationS` | size of the scope |
| `methods[]`: `episodes`, `covered`, `inputEpisodes`, `episodeRuns`, `includedBy`, `skipReason` | per method: how many episodes it will process, how many are already covered, which methods were added because another needs them, and which will not run and why |
| `compute`: `batches`, `gpuSeconds`, `cpuSeconds`, `wallSeconds`, `pools` | the compute estimate and where it runs |
| `checks[]` with `status` `pass`, `warn`, `fail` | `input` (episodes lacking the stream a method reads), `quota` (the estimate against the monthly allowance), `overlap` (a run already working on the same thing, with its `operationIds`) |

| `skipReason` | Meaning | Do |
| --- | --- | --- |
| `nothing_missing` | every episode is covered | nothing; drop `missingOnly` only to recompute |
| `no_input` | no episode in scope has the stream the method reads (no audio, no video) | choose another method or scope |
| `not_placed` | the method has no pool, or a platform method has no image | step 2 for a platform method; update the registration for a workspace method |
| `unavailable` | this deployment cannot run the method | choose another method |

### 4. Launch

Say what will run, on how many episodes, with the compute estimate from step 3; enrichment compute is metered per episode. Then `enrichment.runs` with the same body. It returns the run's Operation (`kind: "enrichment.run"`) at once.

- A run where nothing is missing returns already `succeeded`, with no jobs.
- Records are append-only: a run never overwrites earlier output, and a new method version writes a parallel set.
- Findings reach beyond the episode: each one also becomes a quality score, and for an episode a robot recorded a point on that robot's trend; a `warning` or `critical` finding raises a maintenance signal on the robot. Say so before running a sensor method on production data.

For one method over one dataset with a pinned version, `enrichment.create-jobs` (`scope`, `enricher`, `enricherVersion`) launches a single job instead.

### 5. Follow the run

Poll `operations.get` with the Operation id. `progress` counts episode runs (one method over one episode). `progressDetails` carries `jobs` (`total`, `pending`, `running`, `completed`, `failed`, `cancelled`), `skipped` (with the reasons of step 3) and `included`.

| Operation `status` | Meaning |
| --- | --- |
| `succeeded` | the run settled; `result` counts completed, failed and not-applicable episode runs and the records written. Some episodes may still have failed: read `failures` |
| `failed` | every episode run failed |
| `cancelled` | every job was cancelled |

`enrichment.list-jobs` with `workspaceId` and `operationId` lists the jobs: `status` (`pending`, `running`, `completed`, `failed`, `cancelled`), `total`, `completed`, `failed`, `recordCounts`, and `failureRoster` with an `episodeId` and `reason` per failed episode. A reason that starts with `not-applicable` (an episode without audio for a transcription method) is not a failure. The user also gets a notification when the run settles.

To pick up a run started earlier: `operations.list` with `workspaceId` and `kind` `"enrichment.run"` (add `needsFix` `true` for settled runs whose failed episodes have not been run again), or `enrichment.list-jobs` with `workspaceId` and `status`.

### 6. Read what it wrote

| To read | Operation |
| --- | --- |
| how much is covered now | `enrichment.coverage` |
| exactly which episodes a method has not covered | `enrichment.gaps` with `enricher`: `missingEpisodeIds`, `missingCount`, `truncated` |
| descriptions and checklist answers | `enrichment.descriptions` |
| tags per frame, and per episode | `enrichment.tags`, `enrichment.tag-aggregates` |
| findings, with severity and channels | `enrichment.findings` |
| segments and metrics | `enrichment.segments`, `enrichment.metrics` (`scope` `episode` or `segment`); `enrichment.metric-registry` defines each metric |
| transcripts and speakers | `enrichment.transcripts`, `enrichment.speech-segments` |
| any record kind, by time window | `enrichment.records` |
| what can now be filtered on | `enrichment.facets`: each bucket has a `count` and the `predicate` to search with (`episode-search`) |

Report coverage before and after, the record counts, and two or three example records, not the whole list.

### 7. Work the review queues

Enrichment hands uncertain results to a person. The decisions are the user's: show each item with the episode link (`https://app.rfabric.io/open/<episodeId>`) and record what they decide.

| Queue | Read | Decide |
| --- | --- | --- |
| description fields below the confidence threshold | `enrichment.description-reviews` with `status` `pending`: `field`, `machineValue`, `machineConfidence` | `enrichment.description-reviews-decide` with `decision` `confirm`, or `correct` and `correctedValue` |
| fields where two description methods disagree | `enrichment.description-disagreements` | correct through the queue above |
| probable failures scored by a failure classifier | `enrichment.list-classifiers`, then `enrichment.classifiers-review-queue`: `episodeId`, `score` | `enrichment.classifiers-decisions` with `episodeId`, `decision` (`failure` or `success`), `reason` |

A correction replaces the machine value wherever it is read; both values are kept with who decided. `enrichment.enricher-agreement` then shows how often each method version agreed with people.

### 8. Recover: resume, fill gaps, cancel

| Situation | Do |
| --- | --- |
| a job is `failed`, or `completed` with whole batches failed | `enrichment.jobs-resume` with the job id: it retries the episodes whose batch did not succeed, as a new run Operation |
| single episodes failed, or new episodes arrived | `enrichment.runs` with `missingOnly` true |
| stop a whole run | `operations.cancel` with the Operation id |
| stop one method on one dataset | `enrichment.jobs-cancel` with the job id |

Cancelling keeps the records already written. A cancelled job cannot be resumed: run again with `missingOnly`. Before resuming, read `failureRoster`: a reason that repeats for every episode (`method_not_hosted`, `inference_unavailable`, `stream_not_readable:<sensorStreamId>`) will fail again until its cause is fixed.

## More enrichment operations

Each belongs to the same workflow; describe it before use.

| Purpose | Operations |
| --- | --- |
| Checklists the description method answers | `enrichment.list-checklists`, `enrichment.create-checklists`, `enrichment.checklists-revisions` (a revision is a new version; old answers keep theirs) |
| Segment types the segmentation method may assign | `enrichment.list-segment-vocabularies`, `enrichment.create-segment-vocabularies` |
| Zones where GPS positions are truncated or fuzzed | `enrichment.list-geofences`, `enrichment.create-geofences`, `enrichment.delete-geofences` |
| Failure classifier: train from interventions and review decisions, then score | `enrichment.create-classifiers`, `enrichment.classifiers-score` |
| What a set of failed evaluation runs has in common | `enrichment.create-signatures`, `enrichment.list-signatures`, `enrichment.signatures-episodes` |
| Drift between time windows of a workspace, fleet, site or dataset | `enrichment.create-drift-monitors`, `enrichment.list-drift-monitors`, `enrichment.drift-monitors-run`, `enrichment.drift-monitors-snapshots`, `enrichment.drift-findings`. A shift a monitor finds raises an alert: read and resolve it in `alerting` |
| Per-task share of episodes, per-robot trends | `enrichment.activities`, `enrichment.trends` |
| Whether an episode's media awaits redaction | `enrichment.exposure`; `enrichment.exposure-raw-access` records an audited raw read (needs `enrichment:rawAccess`) |
| Dimensions methods contribute to filters | `enrichment.facet-dimensions` |

`enrichment.platform-enrichers` and `enrichment.platform-enrichers-deactivate` belong to rFabric's platform operators; a workspace user cannot call them.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `VALIDATION_ERROR` (422), message `no_runnable_enrichers` | no selected method can run; `details` has `skipped` with the reasons | fix per the `skipReason` table |
| `VALIDATION_ERROR` (422), message `unknown_enricher` | a name in `enrichers` is not a method of this workspace (`details` lists them) | take names from `enrichment.list-enrichers` |
| `VALIDATION_ERROR` (422), message `dataset_not_ready` | a dataset in scope is still processing (`details` lists them) | wait for its import to finish, then launch |
| `invalid_enricher_parameters` (400) | `parameters` do not match the method's `parametersSchema`, or name a method the run does not include | fix the path named in `details` |
| `VALIDATION_ERROR` (422) on a pass entry, `details` has `requiredBy` | a wider scope requires the method; it cannot be relaxed here | change the entry at the scope in `requiredBy`, with `enrichment:requireOverride` for a redaction method |
| `pool_not_capable` (422) | the pool does not admit enrichment batches or is too small; `details` names the `resourceClass` and `maxRuntimeS` checked | pick a larger pool or add the task type (`compute-setup`) |
| `enricher_not_platform` (422) on a placement | placements apply to platform methods only | move a workspace method with `enrichment.update-enrichers` |
| `enricher_placement_exists` (409) | the workspace already places this method | `enricher-placements.update` on the existing one |
| `enricher_not_placed` (422) on a job create or resume | the method has no pool or no image | set them, then retry |
| `no_capable_pool` (422) on launch | the pool is inactive or too small for one batch, or no image resolves | activate or resize the pool; set the method's image |
| `CONFLICT` (409), message `job_running` or `run_open` | the job or its run has not settled | wait for step 5 to finish |
| `CONFLICT` (409), message `nothing_to_resume` | every batch succeeded | use `missingOnly` for single failed episodes |
| `CONFLICT` (409), message `job_settled` | cancel on a finished job | nothing to cancel |
| Operation `failed` with `enrichment_failed` | every episode run failed | read `failureRoster` in `enrichment.list-jobs`; fix the cause, then resume |
| every episode fails with `inference_unavailable` | the machine has no GPU the method needs | place the method on a GPU pool, or back on Platform compute |

## Done when

- [ ] The run's Operation is `succeeded` in `operations.get`, and you reported its completed, failed and not-applicable counts.
- [ ] `enrichment.coverage` shows the expected `covered` for each method, or `enrichment.gaps` names what is left and why.
- [ ] Each method the user wanted on for later data shows `enabled` true in `enrichment.pass` with the intended `resolvedFrom`.
- [ ] Each placement the user chose appears in `enricher-placements.list`.
- [ ] Review items the user decided are no longer `pending` in `enrichment.description-reviews`.

## Next

- `episode-search`: search by what enrichment wrote (text, similarity, tags, metrics).
- `annotation-project`: have people confirm or extend the machine output.
- `dataset-curation`: select or exclude episodes by tags, findings and scores.
- `alerting`: read and resolve the alert a drift monitor raised.

## The rfabric CLI

They need a signed-in CLI with the workspace set (`rfabric config set workspace <workspace-id-or-slug>`); `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| List methods | `rfabric enrichment enrichers list [--managed platform\|tenant]`, `rfabric enrichment enrichers get <registration-id>` |
| Show and set the switches | `rfabric enrichment pass show [--dataset <dataset-id>]`, `rfabric enrichment pass set <enricher> --enabled [--required]`, `rfabric enrichment pass clear <enricher>` |
| Place a platform method | `rfabric enricher-placement set <enricher> --pool <pool-id>`, `rfabric enricher-placement clear <enricher>` |
| Preview, then launch | `rfabric enrichment run --dataset <dataset-id> --enricher <enricher> [--missing-only] --preview`, then the same without `--preview` |
| Follow | `rfabric operation follow <operation-id>`, `rfabric enrichment jobs list --operation <operation-id>` |
| Coverage and gaps | `rfabric enrichment coverage [--dataset <dataset-id>]`, `rfabric enrichment gaps list <enricher>` |
| Read records | `rfabric enrichment descriptions`, `rfabric enrichment tags --key <key>`, `rfabric enrichment findings`, `rfabric enrichment facets` |
| Resume or cancel a job | `rfabric enrichment jobs resume <job-id>`, `rfabric enrichment jobs cancel <job-id>` |
| Cancel a run | `rfabric operation cancel <operation-id>` |
