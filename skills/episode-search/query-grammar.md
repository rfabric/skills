# Episode query grammar

The text of `q` on `episodes.list`, `episodes.facets`, `episodes.search` and `datasets.stats`, and of the `query` filter of the similarity operations. The same text is the scope `query` of an enrichment run and of an annotation project, and the `q` in the `configuration` of a saved view. rFabric parses it; pass the text through unchanged.

## Predicates

| Kind | Forms | Notes |
| --- | --- | --- |
| Reference | `robot:<v>`, `fleet:<v>`, `task:<v>`, `dataset:<v>` | exact id, or exact name ignoring case; quote a name with spaces: `task:"door open"` |
| Reference | `operator:<v>`, `environment:<v>`, `collectionCampaign:<id>`, `createdFrom:<v>`, `cluster:<clusterKey>` | `operator:` is the dataset's teleoperator name, exact, ignoring case |
| Enum | `type:<v>`, `review:<v>` | `type`: `demonstration`, `test`, `calibration`, `correction`, `intervention`; `review`: `accepted`, `rejected` |
| Boolean | `success:<boolean>`, `annotation.reviewed:<boolean>` | |
| Number | `duration:<cmp>`, `frames:<cmp>`, `qualityScore:<cmp>` | `<cmp>` is `>n`, `>=n`, `<n`, `<=n`, `n` or the inclusive range `a..b`; `duration:>20s` |
| Time | `capturedAt:<from>..<to>` | absolute ISO dates or datetimes only |
| Presence | `has:intervention`, `has:camera`, `has:camera(<name>)`, `has:audio`, `has:transcript`, `missing:imu`, `missing:camera`, `missing:camera(<name>)` | |
| Episode labels | `tag:<v>` | the episode's own `labels`; never enrichment tags |
| Human labels | `label:<fieldKey>`, `label:<fieldKey>=<value>` | accepted, live, episode-level annotations |
| Enrichment tag | `<key>:<value>`, `allFrames:<key>=<value>`, `presentSeconds:<key>=<value><cmp>` | the tag key a method writes is the field, for example `object.detected:mug` |
| Enrichment record | `segment:<type>`, `metric:<key>:<cmp>`, `finding:<severity>`, `findingChannel:<channel>`, `speakers:<cmp>`, `description:<field>=<value>`, `description:<field>:<cmp>`, `checklist:<question>=<value>` | `metric:` reads whole-episode metrics only |
| Enrichment coverage | `enrichedBy:<method>[@<version>]`, `missingEnrichment:<method>` | |
| Free text | bare words, `"quoted phrase"` | matches names, labels, notes, annotations, intervention reasons, descriptions, checklist text, transcripts, finding explanations |

## Combining

- Whitespace or `AND` joins; `OR` alternates; `NOT` or a leading `-` excludes; parentheses group. Precedence: `NOT` and `-`, then `AND`, then `OR`.
- `AND`, `OR`, `NOT` and field keys are case-sensitive.
- `-` must touch what it excludes: `-tag:resolved`.
- An excluded predicate keeps episodes that have no value for it.
- Append `@<enricher>` or `@<enricher>@<version>` to an enrichment predicate to read one method's records only: `metric:force:>3@acme-gripper@1.0`. Without it the predicate matches every method and version that wrote the key.
- A facet bucket of `enrichment.facets` carries its `predicate`: use it verbatim instead of building one.

## Examples

```text
task:"door open" AND qualityScore:<0.4 AND has:intervention
success:false duration:>20s operator:"Kim Lee" capturedAt:2026-06-01..2026-06-07
"cable snag" label:failure_mode=slip NOT tag:resolved
object.detected:mug allFrames:object.detected=mug -activity.task:pick
description:sceneType=kitchen description:gripScore:>0.5
slipped has:transcript
```

## Refusals

A query that does not parse is a `400` with `code` `BAD_REQUEST`. Its `details` carry the grammar `code`, the `position` and `near` of the fault, and the `field`.

| `code` in `details` | Meaning | Do |
| --- | --- | --- |
| `query_syntax_invalid` | unbalanced quotes or parentheses, a dangling operator | fix at `position` |
| `query_field_unknown` | the field is neither built in nor a tag key (a tag key has at least two dot-separated parts) | pick a field from the table; find tag keys with `enrichment.facets` |
| `query_value_invalid` | a value outside its enum or a malformed comparison | fix the value of the named `field` |
| `query_predicate_type_mismatch` | a comparison on a field of another type | use the form in the table |
| `query_too_long` | more than 8192 characters | shorten, or filter by `datasetId` instead of listing ids |

A tag key that no method has written is valid and matches nothing: zero results can mean "not enriched", not "absent". Check coverage with `enrichment.coverage` before concluding.
