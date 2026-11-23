---
name: dataset-curation
description: >-
  A selection of episodes worth training on, as a curated Dataset or a candidate composition ready to freeze. Use when the user wants to curate, filter, select, score, rank, deduplicate, sample, split, merge, mix, rebalance or compose episodes or datasets, write or change a curation ruleset or recipe, run quality scoring, or spot check and override what a ruleset selected. Not for freezing the selection into a DatasetVersion: that is `dataset-version`. Not for exploring episodes by query: that is `episode-search`.
---

# Dataset curation

The user ends up with a selection of episodes to train on, in one of two forms: a curated Dataset (`ds_...`, a Dataset whose members a stored recipe selects from other datasets and dataset versions) or a candidate composition (`ccom_...`, the episode set a ruleset or a composition operation selected, one decision and reason per episode). On the way: QualityScore (`qs_...`, a score from 0 to 1 per episode and criterion) and CurationRuleset (`cur_...`, the selection rules, immutable once applied). Nothing here copies or changes an episode; the selection becomes training input only when `dataset-version` freezes it.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read the source datasets | agent | `datasets.list`, `datasets.get`, `episodes.list` | none |
| 2 | Score the episodes | agent | `scoring-jobs.create`, `scoring-jobs.get`, `curation.episodes-score-record` | scoring runs inside the call |
| 3 | Choose the route | user | none | the user's choice |
| 4 | Recipe route: preview, then create the curated dataset | agent | `datasets.curate-preview`, `datasets.curate`, `datasets.recipe` | none, members are filled in the call |
| 5 | Ruleset route: author, preview, compare | agent | `curation-rulesets.create`, `curation.rulesets-preview`, `curation.rulesets-dry-run` | none |
| 6 | Ruleset route: apply | agent | `curation.rulesets-apply`, `curation.candidate-compositions` | none |
| 7 | Ruleset route: spot check and override | user decides, agent records | `curation.candidate-compositions-validate-sample`, `curation.candidate-compositions-override` | the user's answers |
| 8 | Ruleset route: compose | agent | `composition.subset`, `composition.merge`, `composition.mix`, `composition.rebalance`, `composition.split`, `composition.replay` | none |
| 9 | Hand over to freezing | agent | `datasets.get` or `curation.candidate-compositions` | none |

## Before you start

- **Permissions**

  | Work | Permission | Built-in roles |
  | --- | --- | --- |
  | Preview a recipe | `dataset:read` | `member`, `operator`, `admin`, `owner` |
  | Create a curated dataset, save its recipe | `dataset:curate` | `operator`, `admin`, `owner` |
  | Score episodes | `curation:score` | `admin`, `owner` |
  | Apply a ruleset, create a ruleset version, every composition operation | `curation:apply` | `admin`, `owner` |
  | Override one episode | `curation:override` | `admin`, `owner` |
  | Read the dataset map | `enrichment:read` | `member`, `operator`, `auditor`, `admin`, `owner` |

- **Needs**: at least one Dataset with episodes whose `processingStatus` is `ready` (`dataset-upload`, `dataset-import` or `recording-conversion`). Queries use the episode query grammar (`episode-search`). Labels and tags to filter on come from `enrichment` and `annotation-project`.
- **Ask the user**

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | What "good" means for this training | It decides the query, the score thresholds and the sampling | No default. Offer what step 1 and 2 show: duration, quality score spread, labels |
  | Target size and splits | `size`, `splits` | Default: no size cap; `train` 0.9 and `val` 0.1; seed 42 |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| Recipe route (recommended) | The selection is queries, sampling, a mix of sources and splits | One curated Dataset the user sees on the Datasets page; the recipe stays editable and can keep matching new episodes; a live preview before every change |
| Ruleset route | The user needs score conditions per criterion, removal of duplicate recordings with a keep rule, per-episode overrides with a recorded reason, or to merge, mix or rebalance several selections | A candidate composition, read through the API; an applied ruleset cannot be edited, a change is a new version |

## Steps

### 1. Read the source datasets

1. `datasets.list` with `workspaceId`; `curated: false` keeps imported datasets. For each candidate, `datasets.get`: `episodeCount`, `totalDuration` (seconds), `processingStatus`, `format`.
2. Size the filters before proposing them: `episodes.list` with `datasetId`, `count: true` and one filter at a time (`qualityScoreMin`, `qualityScoreMax`, `durationMin`, `type`, `review`, `q`).
3. Optional, when the dataset has embeddings from `enrichment`: `datasets.map` returns `clusters` (`clusterKey`, `label`, `episodeCount`) and `staleEpisodeCount` (episodes not on the map yet). `datasets.map-selections` with `clusterKeys` or a `polygon` turns a cluster into `episodeIds` with `provenance`; it stores nothing. A curated dataset has no map.

Tell the user: one table of the sources (name, episodes, hours, share already scored). Done when the user has confirmed which datasets feed the selection.

### 2. Score the episodes

Skip when `curation.episodes-score-record` of a few episodes already shows the criteria the user cares about.

- `scoring-jobs.create` with `workspaceId`, `scope` (`datasetId` or `episodeIds`), `scorer` `"rule"` and `scorerVersion` `"1"`. The built-in rule scorer runs these criteria unless `enabledCriteria` narrows them: `duration_bounds`, `frame_completeness`, `sensor_set_completeness`, `sensor_dropout`, `stream_integrity`, `temporal_alignment`, `motion_smoothness`, `actuation_limits`, `stillness_fraction`, `end_state_check`. `criterionParameters` overrides one criterion's thresholds by criterion id.
- The call scores every episode before it answers, so a large dataset takes a while: say so first. On a timeout, repeat with the same `idempotencyKey`.
- Read the result on the job: `total`, `completed`, `failed`, `failureRoster` (episode and reason). `status` `failed` means no episode succeeded. `scoring-jobs.resume` retries the failed batches; `scoring-jobs.get` reads the job again.
- `scoring-jobs.run-rule-scoring` does the same for one dataset without a job record. Prefer the job: it can be resumed.
- A scorer other than `rule` must be an active worker registration of the workspace; otherwise the create answers 404.
- `curation.episodes-score-record` explains one episode: `composite`, each dimension's `score` and `explanation`, and `absentDimensions`. `quality-scores.list` with `episodeId` lists the raw scores. `quality-scores.create` records a score from the user's own tool (`episodeId`, `scoringModel`, `score` from 0 to 1).

Tell the user: how many episodes were scored, how many failed and why, and the spread (`episodes.list` counts per score band). Done when `completed` equals `total` or the user accepts the failures.

### 3. Choose the route

Show the Decisions table with what step 1 and 2 found, recommend one, and wait. Then follow step 4 (recipe) or steps 5 to 8 (ruleset).

### 4. Recipe route: preview, then create the curated dataset

A recipe holds `sources` (1 to 20, in priority order), `size`, `mix`, `duplicates`, `splits`, `stratifyBy`, `seed` and `keepMatching`. Every key is required; `size` and each source's `share` may be null.

```json
{
  "workspaceId": "wks_...",
  "name": "pick-place-clean",
  "recipe": {
    "sources": [
      { "kind": "dataset", "id": "ds_...", "query": "", "take": { "kind": "top_k", "k": 500 }, "share": null },
      { "kind": "datasetVersion", "id": "dsv_...", "query": "", "take": { "kind": "take_all" }, "share": null }
    ],
    "size": null,
    "mix": "as_they_come",
    "duplicates": "first_source",
    "splits": [{ "name": "train", "fraction": 0.9 }, { "name": "val", "fraction": 0.1 }],
    "stratifyBy": ["source"],
    "seed": 42,
    "keepMatching": false
  }
}
```

| Field | What it decides |
| --- | --- |
| `query` | Episode query grammar over the source; `""` matches every episode |
| `take` | `take_all`; `top_k` (the `k` best by quality score); `seeded_random` (a `fraction` above 0); `random_k` (`k` at random, by `seed`) |
| `mix` | `as_they_come` (each source contributes what it took); `equal`; `custom` (each source's `share`, summing to 1; `share` is set exactly when `mix` is `custom`) |
| `size` | Cap on the total; null for no cap |
| `duplicates` | `first_source` drops a recording that an earlier source already contributed; `both` keeps it. The same episode is never taken twice |
| `splits`, `stratifyBy` | Up to 10 named splits, unique names, fractions summing to 1; stratify by `source`, `robot` or both. Trainers read the split named `train` |
| `keepMatching` | `true`: episodes that settle later and match the queries join by themselves; members and their splits never move. Freezing a version sets it to `false` |

1. `datasets.curate-preview` with `workspaceId` and `recipe` (a POST that writes nothing). Show per source `totalCount` -> `matchedCount` -> `takenCount` -> `episodeCount`, then `duplicateCount`, the `splits` counts, total `duration` (seconds) and the `checks`: `checksumEpisodeCount` (members whose streams all carry checksums; the rest cannot be detected as duplicates) and `missingStreams` (streams that some members lack).
2. Change the recipe with the user and preview again until the numbers are what they want.
3. `datasets.curate` with the body above. It creates the curated Dataset and fills it in the same call. Read it back with `datasets.get`: `episodeCount` equals the preview's.
4. Later changes: `datasets.recipe` with the dataset id and the whole recipe. Preview first. Say before the call: any change other than `keepMatching` rebuilds the members from the recipe.

Done when the curated dataset exists and the user accepted its preview.

### 5. Ruleset route: author, preview, compare

Read `ruleset-definition.md` in this skill's directory before writing a definition: the API accepts it as a free-form object and checks it only at preview and apply.

1. `curation-rulesets.create` with `workspaceId`, `name`, `sourceDatasetIds`, `definition` and the same object as `criteria` (required by the API; apply reads `definition`), and optionally `seed`.
2. `curation.rulesets-preview`: `total` episodes in the sources and `estimated` selected by the query and the sampling. It ignores score conditions and duplicate removal, so the real count can be lower.
3. To change an existing ruleset, `curation.rulesets-version` with the new `definition` (the parent stays as it is), then `curation.rulesets-dry-run` with the old one as `baselineRulesetId`, the new one as `candidateRulesetId` and the `sourceDatasetIds`. It returns `gainedCount`, `lostCount`, `retainedCount` and the episode lists, and applies neither ruleset.
4. `curation.rulesets-clone` copies a ruleset under a new `name` as an unapplied version 1 (`curation:clone`). `curation-rulesets.delete` removes a draft the user dropped.

Tell the user the estimate, or the gained and lost counts with a few example episodes as links. Done when the user approved the numbers.

### 6. Ruleset route: apply

Say before the call: applying is one-time for this ruleset. It stamps `appliedAt` and the ruleset can never be applied or edited again; a change needs a new version.

`curation.rulesets-apply` with the ruleset id (optional `seed`). It returns the candidate composition: `selectedCount`, `excludedCount`, `status` `ready`. Each episode's decision is `auto_selected` or `auto_rejected`, with the reason. Give the user the composition id (`ccom_...`) to keep: a composition is read by id only (`curation.candidate-compositions`), and freezing needs that id.

Done when the counts are reported and they match what the user expected from step 5.

### 7. Ruleset route: spot check and override

- **Spot check the automation**: `curation.candidate-compositions-validate-sample` with `population` (`auto_selected` or `auto_rejected`), `strataFields` `[]`, `sampleSize` and `seed` returns `sampleEpisodeIds`. Give the user each episode as a link with its score record (`curation.episodes-score-record`), and ask whether the decision is right. Sample both populations: a wrong rejection costs data, a wrong selection costs quality.
- **Override one episode**: `curation.candidate-compositions-override` with `episodeId`, `decision` (`override_include` or `override_exclude`) and the user's `reason`. The user decides; never decide for them. Pass the row's `version` as `expectedVersion` on a second override of the same episode.
- When the sample shows the rules are wrong rather than single episodes, go back to step 5 with a new version instead of overriding many episodes.

Done when the user has looked at a sample of both populations, or declined to, and every override is recorded.

### 8. Ruleset route: compose

Each operation below creates a separate `ready` candidate composition and leaves its sources untouched, so a result the user dislikes costs nothing: build, show the counts, and build again with other parameters. Only `composition.split` changes a composition in place. Before each call say which sources go in, their sizes, and the parameters; after it report `selectedCount` and the operation's recorded parameters.

Every body takes `workspaceId`, `curationRulesetId` (the ruleset the result is filed under: the one that produced the source) and sources of `kind` `dataset` or `candidateComposition`. The response `data` holds `operation` (`cop_...`) and `composition`.

| Goal | Operation | Parameters that decide |
| --- | --- | --- |
| Narrow one source by rules | `composition.subset` | `definition` inside `parameters` (a ruleset definition), `seed` |
| Union several sources | `composition.merge` | the order of `sources`: a recording whose stream checksums match an earlier member is dropped |
| Fixed shares per source | `composition.mix` | a `tag` per source; inside `parameters`, `ratios` per tag and `seed`; the operation records `achievedRatios` and `undersizedSources` |
| Even out one attribute | `composition.rebalance` | inside `parameters`: `dimension` (an episode meta key), `targetDistribution` and `seed`; the recipe records `residualImbalance` and `impossible` |
| Train, validation, test | `composition.split` | `splits` (`name` with `fraction` or `count`), `stratifyBy`, `groupKey`, `seed`; a second split replaces the first |
| Rebuild from a record | `composition.operations-recipe`, then `composition.replay` | the recipe as returned; only `merge` and `subset` recipes replay |

Done when one composition holds the selection and its `status` is `ready`.

### 9. Hand over to freezing

Report the result as a table: what it is (curated dataset or candidate composition), its id, episodes, splits, and for the ruleset route the ruleset id and version. Then name the next step and what it will do, so the user can decide when:

| Result | Next step | What the user should know now |
| --- | --- | --- |
| Curated dataset | `dataset-version` freezes it by its dataset id | the freeze cannot be undone; it finalizes every member dataset and stops the recipe from matching new episodes. Until then the recipe stays editable |
| Candidate composition | `dataset-version` freezes it by its composition id | the freeze cannot be undone; the source datasets must be finalized first; splits are the ones `composition.split` assigned |
| Either, for use outside rFabric | `dataset-export` | a curated dataset exports by its dataset id; a candidate composition exports as the episodes of the version frozen from it |

A selection that draws on several datasets can be frozen only when every source dataset has `format` `lerobot_v3`: check it here, before the user counts on the version.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 400 `BAD_REQUEST`, `code` in `details` starting with `query_` | A source's `query` does not parse; `sourceIndex`, `position` and `near` in `details` locate it | Fix the query (`episode-search`), preview again |
| 422 `VALIDATION_ERROR`, `code` in `details` `curation_recipe_source_not_found` | The source at `sourceIndex` is not a dataset or version of this workspace | Pick a source from `datasets.list` or `dataset-versions.list` |
| 422, `code` in `details` `curation_recipe_cycle` | A source is the curated dataset itself, or draws from it | Remove that source |
| 422, `code` in `details` `dataset_not_curated` | `datasets.recipe` on an imported dataset | Create a curated dataset with `datasets.curate` instead |
| 409 `CONFLICT` on `datasets.recipe`, "is being changed or frozen" | Another save or a freeze holds the dataset | Wait and send the same recipe again |
| 409 `CONFLICT` on `curation.rulesets-apply`, "immutable: already applied" | The ruleset was applied before | `curation.rulesets-version`, then apply the new version |
| 422 `VALIDATION_ERROR` on preview or apply with `issues` in `details` | The definition has an unknown key or a wrong type; each issue's `path` names it | Fix it per `ruleset-definition.md`. A ruleset cannot be edited: create it again and delete the old one |
| Apply selected far fewer than the preview estimated | Score conditions reject every unscored episode; duplicate recordings were dropped | Score the sources (step 2), create a new version with the same definition, apply that |
| 409 `CONFLICT` on override with `currentVersion` in `details` | Someone overrode the episode since you read it | Show the user the newer decision; retry with that `expectedVersion` only if they still want the change |
| 422 "Episode not in candidate composition" | The episode is not one the ruleset saw | Check the episode's dataset is a source |
| 422 "Cross-workspace source" or "not found" on a composition operation | A source is not a composition or dataset of this workspace | Use a `ready` composition or a dataset of the same workspace |
| 422 "Replay for operation ... requires an existing composition context" | The recipe is not a merge or subset | Run that operation directly with the recipe's parameters |
| 404 on `datasets.map` | No map: the dataset has no map from `enrichment` yet, or it is curated | Run the map enrichment with `enrichment`, or skip the map |
| 403 naming a `curation` or `dataset` permission | The user's role lacks it (table above) | Name the permission; `member-access` finds why it is missing and what can add it |

## Done when

- [ ] The user approved the numbers of a preview (recipe) or of a preview, dry run or apply result (ruleset) before each change.
- [ ] Recipe route: `datasets.get` shows the curated dataset with the previewed `episodeCount`.
- [ ] Ruleset route: `curation.candidate-compositions` shows `status` `ready` and the `selectedCount` you reported.
- [ ] Every override carries the user's own reason.
- [ ] You reported the dataset or composition id, the ruleset id, the episode count and the splits.

## Next

- `dataset-version`: freeze the curated dataset or the candidate composition into an immutable DatasetVersion that training runs pin.
- `annotation-project`: label the selected episodes before freezing.
- `dataset-export`: download the selected episodes as a bundle for an external trainer (a curated dataset directly; a candidate composition after it is frozen).

## The rfabric CLI

They need a signed-in `rfabric` CLI; `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| Preview a recipe | `rfabric dataset curate --recipe recipe.json --preview` |
| Create the curated dataset | `rfabric dataset curate --recipe recipe.json --name <name>` |
| Save a changed recipe | `rfabric dataset recipe set <dataset-id> --recipe recipe.json` |
| List rulesets | `rfabric curation-ruleset ls` |
| Compose | `rfabric composition merge --data '<json>'` (also `subset`, `mix`, `rebalance`, `replay`) |
| Split a composition | `rfabric composition split <candidate-composition-id> --data '<json>'` |
| Read an operation's recipe | `rfabric composition operation-recipe <composition-operation-id>` |
