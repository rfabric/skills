---
name: episode-search
description: >-
  The episodes that answer a question, one episode read in full, or the lineage of a dataset, version, model or artifact. Use when asked to find, filter, count or search episodes, find similar episodes or moments, save or share an episode view, open or inspect an episode (streams, markers, files, video download, clips), find a dataset, model or robot by name or tag, or trace what trained a model and where data went. Not for changing which episodes a dataset holds: that is `dataset-curation`.
---

# Find and inspect episodes

The user ends up with the Episodes (`ep_...`, one recorded run of a robot) that answer their question, with counts and the matching moments; or with one Episode read in full: its SensorStreams (`ss_...`, one sensor track each), markers, files and DerivedAssets (`da_...`, processed outputs such as playback renditions); or with the lineage of a Dataset (`ds_...`), DatasetVersion (`dsv_...`), Model (`mdl_...`) or Artifact (`art_...`). A search is kept as a ListSavedView (`lsv_...`), a lineage question as a SavedLineageQuery (`slq_...`), a moment as a Clip (`clp_...`) or a marker.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Frame the question and its scope | agent | `workspaces.list`, `datasets.list`, `episodes.facets`, `enrichment.facets` | none |
| 2 | Filter and count | agent | `episodes.list`, `episodes.facets`, `episodes.search` | none |
| 3 | Rank by meaning or likeness | agent | `embeddings.spaces`, `embeddings.search`, `episodes.similar`, `embeddings.query` | none |
| 4 | Save or share the search | agent | `list-saved-views.create`, `episodes.report-bundle` | none |
| 5 | Read one episode | agent; the user watches it in the rFabric app | `episodes.detail`, `episodes.playback-resources`, `episodes.markers`, `episodes.files`, `derived-assets.list`, `sensor-streams.video-url` | none |
| 6 | Clip and mark | agent | `episodes.create-clips`, `episodes.list-clips`, `episodes.events` | a clip renders in the background: follow its Operation |
| 7 | Trace lineage | agent | `lineage.get`, `lineage.create-queries`, `saved-lineage-queries.create` | a graph deeper than 10 levels runs as a lineage query job |

Steps 2 to 7 are independent: enter at the one the request names.

## Before you start

- **Permissions**: reading episodes needs access to the workspace. Beyond that:

  | To | Permission | Built-in roles that carry it |
  | --- | --- | --- |
  | read what enrichment wrote, rank by embeddings (step 3) | `enrichment:read` | `member`, `operator`, `auditor`, `admin`, `owner` |
  | get a video download link, read native stream data | `dataset:read` | `member`, `operator`, `admin`, `owner` |
  | export a stream's numeric channels | `export:create` | `operator`, `admin`, `owner` |
  | see media that awaits redaction | `enrichment:rawAccess` | `admin`, `owner` |

- **Needs**: a browsable Dataset with episodes (`dataset-upload`, `dataset-import` or `recording-conversion`). Search by meaning, by detected objects, by description or by transcript needs those enrichment methods to have run (`enrichment`).
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | The question, in their words | it decides filter, text or similarity | none: ask |
  | Workspace | every search is scoped to one | `workspaces.list`; ask only with more than one |
  | Dataset scope | narrows counts and cost | default: the whole workspace |
  | An example episode or moment | only for "more like this" | the episode id and, for a moment, the time in the video |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| Keep a saved view personal (recommended) | the search is the user's working set | only they see it: `visibility` `personal` |
| Share it with the workspace | teammates should open the same set | every member of the workspace sees it in the app's episode explorer: `visibility` `workspace` |

## Steps

### 1. Frame the question and its scope

1. `workspaces.list`, then `datasets.list` with `workspaceId` when the user names a dataset.
2. `episodes.facets` with `workspaceId` (and `datasetId`) returns `total`, `duration` in seconds and the buckets a filter can use: `type`, `review`, `robot`, `dataset`, `task`, `operator`, `tag`, `has`, `stream`, and `distribution` of duration and quality score. Read it before you write a query, so you filter on values that exist.
3. `enrichment.facets` with `workspaceId` lists what enrichment wrote: each bucket has a `count` and the exact `predicate` that selects it.

Tell the user the size of the scope in one line, for example "13 episodes, 12 minutes, 2 streams each".

### 2. Filter and count

Pick the tool from the question:

| The question is about | Use | Returns |
| --- | --- | --- |
| facts of episodes (robot, task, duration, review, tags, labels, metrics, detections) | `episodes.list` with `workspaceId` and `q` | episodes, exact |
| how a filtered set splits up | `episodes.facets` with the same filters | bucket counts, `total`, `duration` |
| words that occur in names, notes, labels, descriptions, transcripts | `episodes.search` with `workspaceId` and `q` | passages: `matchedField`, `snippet`, `tMs` |
| another kind of record (a dataset, a model, a robot) by name, tag or attribute | that kind's list operation with `workspaceId` and `search`, `tag` or `attribute`: `datasets.list`, `models.list`, `robots.list` | the records themselves |

- `q` is the episode query grammar: read [query-grammar.md](query-grammar.md) in this skill's directory before you write one. A `q` needs `workspaceId`.
- `episodes.list` also takes plain filters (`datasetId`, `robotId`, `type`, `review`, `durationMin`, `hasCamera`, `tag`, `attribute` and more) and `sort`. `count: true` returns only the number.
- `episodes.search` pages with `limit` and `offset`. `tMs` is the moment of a transcript or finding hit, in milliseconds from the start of the episode.
- On a list operation, `search` matches the name ignoring case, `tag` one tag, and `attribute` is `<key>=<value>`. `attribute-schemas.list` with `workspaceId` and `entityType` shows which custom attributes the workspace defines, so you filter on names that exist.

Report the count first, then up to ten episodes as a table (name, dataset, duration, the field that matched), then offer the next step. For more than a page, say how many there are instead of listing them.

### 3. Rank by meaning or likeness

Use when no field holds the answer ("the gripper slips off the handle") or the user gives an example.

1. `embeddings.spaces` with `workspaceId`: each space has `name`, `granularities` (`episode`, `clip`, `frame`), `textEncoder` (null means no text queries), `recordCount` and `lastIndexedAt`. Choose the space; never assume one.
2. Query:

   | Anchor | Operation | Body |
   | --- | --- | --- |
   | a description in words | `embeddings.search` | `workspaceId`, `text`, `space` |
   | an episode | `episodes.similar` | `workspaceId`, `space`; path `id` |
   | a moment or a range of an episode | `episodes.similar` | add `frameMs`, or `rangeMs` as `[start, end]`, and `sensorStreamId` for one camera |
   | any of these, or a raw vector | `embeddings.query` | `workspaceId`, `space` `{name, version}`, `anchor` |

   Narrow the candidates with `filters` (`query` in the grammar of step 2, `datasetId`, `robotId`, `excludeEpisodeId`) and set `granularity` and `limit`.
3. Read `state` before the results:

   | `state` | Meaning | Do |
   | --- | --- | --- |
   | `ok` | ranked `results` with `similarityScore` | show them |
   | `anchor_unenriched` | the example has no vector in this space | offer to enrich it: `gapFill` names the method and scope |
   | `space_empty` | nothing in the workspace has vectors in this space | offer `enrichment` with the method in `gapFill` |
   | `index_unavailable` | the index or the text encoder is not reachable | retry later; fall back to step 2 |

Tell the user that this ranking is approximate and covers only enriched episodes: give `recordCount` against the scope's `total`, and `lastIndexedAt`. `anchorResolution` says what was actually compared (`mode`, `frameMsUsed`, `aggregation`). These operations are `mutating` in the catalog but only read.

### 4. Save or share the search

| Keep | Operation | Fields |
| --- | --- | --- |
| an episode query with its sort and columns, as a view in the app's episode explorer | `list-saved-views.create` | `workspaceId`, `name`, `resourceType` `explore`, `configuration` `{q, sort, filters, columns}`, `visibility` |
| a fixed set of episodes to hand over | `episodes.report-bundle` | `episodeIds` (up to 100); returns each episode's `name`, `duration`, `thumbnailUrl` and `metadata`. Link each one as `https://app.rfabric.io/open/<episodeId>` |

- `list-saved-views.list` with `workspaceId` and `resourceType` finds existing views; `list-saved-views.update` changes one.
- A saved view stores the query, not the episodes: its result changes as data arrives. Say so when the user wants a frozen set, and point to `dataset-curation` and `dataset-version`.

### 5. Read one episode

| To learn | Operation | What to read |
| --- | --- | --- |
| what the episode is | `episodes.detail` | `episode`, `dataset`, `streams`, `qualityScores`, `annotations`, `interventions`, `lineage` |
| what can be played | `episodes.playback-resources` | per stream: `rendition` and its `renditionStatus` (`ready`, `pending`, `failed`, `expired`), `source`, `channels`, `timeseries`; `clockSkewWarning`; `exposure` |
| what happened when | `episodes.markers` | `markers` from `annotation`, `intervention`, `evaluation` and `custom` sources; `failedSources` lists sources that did not load |
| where the raw files are | `episodes.files` | `storageConnectionId`, `prefix`, each stream's `objectUri` |
| processed outputs | `derived-assets.list` with `sourceEpisodeId` | `assetType`, `status` (`generating`, `ready`, `failed`, `expired`, `deleted`), `error` |
| one stream in detail | `sensor-streams.get` | `modality`, `channels`, `motionStats`, `status`, `filesize`, `error` |
| what enrichment wrote | `enrichment.coverage` with `episodeId`, then `enrichment.descriptions`, `enrichment.tags`, `enrichment.findings` | see `enrichment` |
| its 3D view | `episodes.spatial-model`, `episodes.point-clouds` | the simulation model, the joint mapping, point-cloud frames |
| which player layout opens | `player-layouts.resolve` with `workspaceId`, `datasetId` | the dataset's default PlayerLayout (`pll_...`), else the robot model's, else null |

- **Watching** is the user's: give `https://app.rfabric.io/open/<episodeId>` and the times worth seeing. You read data; you do not see video.
- **Redaction**: `blocked` true in `exposure` means a required redaction has not run and the media is withheld. With `enrichment:rawAccess` the same read returns the raw media and is recorded in the audit log: say that before you call `episodes.playback-resources` for such a user.
- **Download a video**: `sensor-streams.video-url` returns `url`, `method` and `expiresAt` (valid one hour). Tell the user the stream's `filesize` first, then fetch it as `rfabric-basics` describes for bytes. Only video streams have one.
- **Numbers**: `sensor-streams.timeseries-export` with `channels` (keys, comma-separated), `startNs`, `endNs` and `format` (`csv` or `parquet`) returns full-resolution samples; the export is recorded in the audit log. A stream whose `nativeStream` is set also serves exact-clock samples through `sensor-streams.native-window` and signed files through `sensor-streams.native-artifacts`.
- **Playback health**: when the user reports video that stalls or does not load, `datasets.playback-health` gives `totals`, `rates` and `affectedStreams` for the dataset. `datasets.playback-health-reprocess` with those `streamIds` rebuilds their renditions; it changes nothing else. Players report these outcomes themselves: do not call `episodes.playback-events`.

Done when the user has the facts they asked for and the link to watch.

### 6. Clip and mark

- **Clip**: `episodes.create-clips` with `startNs` and `endNs` (nanoseconds from the start of the episode), `layout` `single` with a video `streamId`, or `grid` for all cameras. It returns the Clip with `status` `pending` and an `operationId`. Follow `operations.get`, then `episodes.list-clips`: `ready` carries a `url` signed at read time, `failed` carries `error`. A clip is a copy for sharing; the episode is unchanged.
- **Marker**: `episodes.events` adds a custom marker with `type`, `label` and either `tNs` or `startNs` and `endNs`. It then appears in `episodes.markers` with `source` `custom`, for everyone who opens the episode.

### 7. Trace lineage

`lineage.get` walks from any entity id: path `id`, query `direction` (`up` to what it came from, `down` to what used it).

1. Start with `mode` `summary`: exact counts per entity type, cheap at any size. Report them: "this model traces to 1 checkpoint, 2 training runs, 3 datasets, 1240 episodes".
2. For the entities themselves use `mode` `graph` and `types` to keep only what was asked (`episode`, `dataset`, `datasetVersion`, `trainingRun`, `checkpoint`, `model`, `artifact`, `deployment`, `robot`). `truncated` true means the graph was cut: say so, never present it as complete.
3. `depth` defaults to 10. Graph mode deeper than that is refused with `lineage_too_large`: start `lineage.create-queries` (`rootId`, `workspaceId`, `direction`, `depth` up to 20, `mode`, `types`) and poll `lineage.get-queries` until `status` is `completed` or `failed`; `progress` shows how far it is.

| Question | Call |
| --- | --- |
| Which episodes trained this model? | `lineage.get` on the model, `direction` `up`, `types` `episode` |
| Where did this episode or dataset end up? | `lineage.get` on it, `direction` `down`, `types` `model`, `deployment`, `robot` |
| What is this dataset derived from, and what derives from it? | `datasets.ancestry` |
| What recipe froze this dataset version? | `dataset-versions.lineage` |
| Which models build on this base model? | `models.descendants` |
| Which model is in this artifact? | `artifacts.lineage` |

A node with `tombstone` is a deleted entity kept in the graph. A node with `promotionBoundary` hides what lies in a workspace the user cannot read: report the boundary, not a gap.

To keep a question: `saved-lineage-queries.create` (`workspaceId`, `name`, `rootId`, `direction`, `depth`, `mode`, `types`, `shared`). `saved-lineage-queries.run` answers it again with today's data; `saved-lineage-queries.export` with `format` `report` returns a Markdown report to hand to an auditor. Each run and each export is recorded.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `BAD_REQUEST` (400) whose `details` has `code` `query_field_unknown`, `query_value_invalid` or `query_syntax_invalid` | the query text does not parse | fix at the `position` in `details`; see [query-grammar.md](query-grammar.md) |
| `BAD_REQUEST` (400) "q requires workspaceId" | a query without its workspace | add `workspaceId` |
| zero results on an enrichment predicate | the method may not have run on these episodes | `enrichment.coverage`; offer `enrichment` |
| `VALIDATION_ERROR` (422) with message `space_not_text_capable` | the space has no text encoder | choose a space whose `textEncoder` is set, or anchor on an episode |
| `VALIDATION_ERROR` (422) "Granularity not declared for this space" | the space has no vectors at that granularity | use one of `details.declaredGranularities` |
| `VALIDATION_ERROR` (422) with message `clip_range_outside_episode`, `clip_stream_required_for_single_layout` or `clip_stream_not_playable` | the range exceeds the episode, or the stream is missing or not video | use a range inside the episode's `duration` and a video stream from `episodes.playback-resources` |
| 409 on `sensor-streams.video-url` | the stream's dataset is not published yet | wait for the dataset to finish processing |
| 400 on `sensor-streams.video-url` | the stream is not a video stream | export numbers with `sensor-streams.timeseries-export` instead |
| `renditionStatus` `failed` or `expired` | no playback rendition; the source may still play | `datasets.playback-health`, then `datasets.playback-health-reprocess` |
| `invalid_id` (400) on `lineage.get` | the id is not a lineage-bearing entity id | pass the full prefixed id |
| `lineage_too_large` (422) | graph mode beyond depth 10 | `lineage.create-queries`, or `mode` `summary` |
| lineage query `status` `failed` | the traversal did not finish; no partial result | read `error`; narrow `types` or `depth` and start again |

## Done when

- [ ] The user has the count and the episodes for their question, from `episodes.list` or a ranked result whose `state` is `ok`, and knows whether the answer is exact or ranked.
- [ ] For a ranked answer, you reported how much of the scope is enriched (`embeddings.spaces` `recordCount`).
- [ ] A saved view exists when asked: it appears in `list-saved-views.list` with the agreed `visibility`.
- [ ] A clip the user asked for is `ready` in `episodes.list-clips`.
- [ ] A lineage answer states `direction`, the counts per type, and whether `truncated` was false.

## Next

- `enrichment`: add descriptions, detections, embeddings or transcripts so search has more to match.
- `annotation-project`: have people label the episodes this search found (its scope takes the same query).
- `dataset-curation`: turn the query into a curated dataset.
- `dataset-export`: export the episodes for an external trainer.

## The rfabric CLI

They need a signed-in CLI with the workspace set (`rfabric config set workspace <workspace-id-or-slug>`); `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| Filter episodes | `rfabric data search --query '<query>'` |
| List embedding spaces | `rfabric embeddings spaces` |
| Text-to-episode search | `rfabric embeddings search '<text>' --space <name> [--filter-query '<query>']` |
| Similar to an episode or moment | `rfabric embeddings query <episode-id> --space <name> [--frame-ms <ms> \| --range-ms <start>,<end>]` |
| Inspect an episode | `rfabric data inspect <episode-id>` |
| Open it in the app | `rfabric episode open <episode-id> [--at m:ss]` |
| Extract and list clips | `rfabric episode clip create <episode-id> --start-ns <ns> --end-ns <ns> [--stream <stream-id>] [--layout single\|grid]`, `rfabric episode clip list <episode-id>` |
| Add a custom marker | `rfabric episode events add <episode-id> <type> --label <label> --t-ns <ns>` |
| Trace lineage | `rfabric lineage <entity-id> --direction up\|down [--summary] [--types episode,model] [--async --wait]` |
| Re-run or export a saved lineage query | `rfabric saved-lineage-query run <id>`, `rfabric saved-lineage-query export <id> --format report --dest report.md` |
