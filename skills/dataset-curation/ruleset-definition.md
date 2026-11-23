# Curation ruleset definition

Read this when you write or change the `definition` of a CurationRuleset (`curation-rulesets.create`, `curation.rulesets-version`) or the `definition` inside `parameters` of `composition.subset`. The API stores the object as given and checks it only when it is previewed or applied, so a mistake here shows up late.

## What apply does with it

`curation.rulesets-apply` runs every episode of the source datasets through these stages, in this order. An episode that fails a stage is `auto_rejected` with the reason shown.

| # | Stage | Key | Reason recorded on a rejected episode |
| --- | --- | --- | --- |
| 1 | Query | `query` | `failed query` |
| 2 | Score conditions | `scoreConditions` | `unscored for <scorer>@<scorerVersion>`, `score <x> below minimum <y>`, `score <x> above maximum <y>` |
| 3 | Duplicate recordings | `dedup` | `duplicate-of:<episodeId>` |
| 4 | Sampling | `sampling` | `excluded by sampling strategy` |

Everything left is `auto_selected`. The composite score used in stages 2 and 4 is the mean of all the episode's quality scores; an episode with no score counts as 0 in sampling and fails every score condition.

## Keys

Use only these keys; a key the API does not know is refused.

| Key | Shape | Meaning |
| --- | --- | --- |
| `query` | string, episode query grammar | Which episodes are considered. Absent or `""`: all of them |
| `scoreConditions` | list of `{ "scorer", "scorerVersion", "criterionId"?, "minScore"?, "maxScore"? }` | With `criterionId`: that criterion's score must be inside the bounds. Without it: the composite must be. `scorer` and `scorerVersion` are required and name the scorer in the reason |
| `dedup` | `{ "kind": "exact", "keepPolicy": ... }` | Episodes whose stream checksums are identical are one recording; one is kept. `keepPolicy`: `richest_metadata`, `earliest` or `highest_score` |
| `sampling` | one of the strategies below | How many of the remaining episodes are taken. Absent: all |

Sampling strategies, each an object with `kind`:

| `kind` | Other fields | Takes |
| --- | --- | --- |
| `take_all` | none | Every remaining episode |
| `top_k` | `k` | The `k` with the highest composite |
| `top_fraction` | `fraction` from 0 to 1 | That share, highest composite first |
| `seeded_random` | `fraction` from 0 to 1 | That share at random, repeatable for the same seed |
| `random_k` | `k` | `k` at random, repeatable for the same seed |
| `balanced` | `stratumField` (`operator` or `task`), `capFraction` | From each group of the field, the best `capFraction` share, at least one |

The seed is the `seed` given to apply, else the ruleset's `seed`, else 42.

## Example

Episodes of at least 5 seconds whose stream integrity score is 0.9 or more, duplicates removed, the best 2,000 kept:

```json
{
  "workspaceId": "wks_...",
  "name": "pick-place-production",
  "sourceDatasetIds": ["ds_..."],
  "seed": 42,
  "definition": {
    "query": "duration:>=5s",
    "scoreConditions": [
      { "scorer": "rule", "scorerVersion": "1", "criterionId": "stream_integrity", "minScore": 0.9 }
    ],
    "dedup": { "kind": "exact", "keepPolicy": "highest_score" },
    "sampling": { "kind": "top_k", "k": 2000 }
  },
  "criteria": {
    "query": "duration:>=5s",
    "scoreConditions": [
      { "scorer": "rule", "scorerVersion": "1", "criterionId": "stream_integrity", "minScore": 0.9 }
    ],
    "dedup": { "kind": "exact", "keepPolicy": "highest_score" },
    "sampling": { "kind": "top_k", "k": 2000 }
  }
}
```

Check the query against the sources with `episodes.list` (`q`, `count: true`) before you create the ruleset; the grammar is described in `episode-search`.
