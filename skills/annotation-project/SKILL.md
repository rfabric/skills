---
name: annotation-project
description: >-
  Reviewed human labels on a set of episodes, signed off and exported. Use when asked to set up labeling or annotation work, define a label schema or guidelines, choose which episodes get labeled, start, pause or finish an annotation project, see labeling progress, work or unblock the labeling queue, review, accept or return labels, check agreement, gold accuracy or annotator performance, sign off, or export annotations. Not for machine-made tags and descriptions: that is `enrichment`.
---

# Run an annotation project

The user ends up with accepted labels on their Episodes (`ep_...`), pinned by a sign-off and exported. An AnnotationProject (`anp_...`) holds a versioned label schema (the fields people fill in), guidelines, workflow settings and a scope (which episodes). Activating it fills a queue: one queue item (`qi_...`) per episode and annotator slot. Each label is an Annotation (`ann_...`) with a status of `draft`, `submitted`, `accepted` or `returned`; the annotations one person submits for one queue item are one submission. A sign-off records a LabelSnapshot (`lsnp_...`) that pins the accepted annotations.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Design: fields, workflow, people | user decides, agent proposes | `annotation-projects.templates`, `annotation-projects.labeling-time`, `annotation-projects.annotator-load` | none |
| 2 | Create the draft and set its scope | agent | `annotation-projects.create`, `annotation-projects.scope-preview`, `annotation-projects.update` | none |
| 3 | Publish the guidelines | user writes or approves, agent publishes | `annotation-projects.create-guidelines` | none |
| 4 | Activate | agent | `annotation-projects.transition` | none |
| 5 | Label | annotators, in the rFabric app | `annotation-projects.get`, `annotation-projects.queue-stats` | the people's labeling time |
| 6 | Review | reviewers, in the rFabric app or through you | `annotation-projects.review-batch`, `annotation-projects.review-batch-accept`, `annotation-projects.review-batch-return` | the reviewers' time |
| 7 | Watch quality | agent | `annotation-projects.metrics`, `annotation-projects.performance`, `annotation-projects.gold` | none |
| 8 | Sign off | user decides, agent calls | `annotation-projects.sign-off` | none |
| 9 | Export and hand over | agent | `annotation-projects.export`, `annotation-projects.snapshots` | none |

## Before you start

- **Permissions**:

  | To | Permission | Built-in roles that carry it |
  | --- | --- | --- |
  | create, change, start, pause a project | `annotation:create` | `operator`, `admin`, `owner` |
  | label | `annotation:label` | `annotator`, `member`, `operator`, `admin`, `owner` |
  | review: accept or return | `annotationReview:review` | `reviewer`, `member`, `operator`, `admin`, `owner` |
  | sign off | `annotationReview:signOff` | `admin`, `owner` |
  | see other people's performance | `annotationPerformance:compare` | `admin`, `owner` |
  | import labels from a vendor, withdraw labels in bulk | `annotationImport:import`, `annotationImport:bulkDelete` | `admin`, `owner` |

  People who will label or review must already hold the permission: `member-access` shows who does, and why someone does not.
- **Needs**: Datasets with episodes in the workspace (`dataset-upload`, `dataset-import`, `recording-conversion`). Optional: enrichment output to scope by, such as detected objects or findings (`enrichment`).
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | What a label must say | it becomes the label schema | propose a built-in template from step 1 |
  | Which episodes | the scope | datasets by name and an optional query; default: every episode of the named datasets |
  | Who labels and who reviews | pool, overlap, review policy | `membership.members` with `workspaceId` shows each member's `workspacePermissions`; default: anyone holding `annotation:label` may claim |
  | The guideline text | annotators label by it | none: the user writes or approves it |

A label schema is not an attribute schema. `attribute-schemas.list` and `attribute-schemas.create` define typed custom attributes on entities of a workspace (metadata that search filters on); they do not define what people label.

## Decisions

| Decision | Option | Choose when | Consequence |
| --- | --- | --- | --- |
| Scope `mode` | `static` (recommended) | a fixed set must be finished | the queue is filled once at activation; an estimated completion exists |
| | `continuous` | every new matching episode should be labeled | episodes keep joining and are never removed; the project has no natural end |
| Review `reviewPolicy.mode` | `full` (recommended for training labels) | every label must be checked | every submission waits for a reviewer |
| | `sampled` with `samplePct` | reviewers are scarce | only the sample, plus low-confidence or gold-miss labels if chosen, waits; the rest is accepted on submission |
| | `none` | the annotators are the experts | labels are accepted on submission; nothing checks them |
| Overlap `overlap` | none (recommended to start) | one opinion per episode is enough | no agreement figure |
| | `fixed` (2 to 5 people per episode) or `percentage` (a second person on that share) | you need agreement, or the task is ambiguous | labeling time multiplies; disagreement beyond `disagreementThreshold` sends the episode to adjudication |
| Assignment `assignmentMode` | `claim` (recommended) | people pull work when free | a claim expires after `claimExpiryMinutes` and returns to the queue |
| | `auto_assign` | work must be spread evenly | needs an `annotatorPool` at least as large as the slots per episode |
| Blind labeling `contextBlinding` | off (recommended) | earlier labels help | annotators see prior work on the episode |
| | on | you measure independent judgment | annotators see no prior labels, markers or scores |

## Steps

### 1. Design: fields, workflow, people

1. `annotation-projects.templates` with `workspaceId` returns `builtIn` and `workspace` templates, each with `slug`, `fields` and `workflowSettings`. Built in: `outcome-and-failure` (outcome, failure mode, task phases), `task-phases`, `objects-in-frames`.
2. A field has `key` (lowercase with underscores, permanent), `label`, `granularity` (`episode`, `temporal_segment`, `frame`), `type` and `constraints`:

   | `type` | Value an annotator gives |
   | --- | --- |
   | `verdict` | `success`, `failure`, `partial` or `unusable` |
   | `single_choice`, `multi_choice` | one or several of `allowedValues` |
   | `boolean`, `rating`, `text` | true or false; a number within `min` and `max`; free text |
   | `temporal_segment` | a list of `{startNs, endNs, classLabel}`, `classLabel` from `allowedValues` |
   | `bbox_2d`, `keypoints`, `mask_polygon`, `cuboid_3d` | geometry with a `classLabel`, drawn on a frame |

   `constraints` also take `required`, `mutuallyExclusiveWith` and `visibleWhen` (show a field only when another has a value).
3. Size the work: `annotation-projects.labeling-time` gives `medianLabelingSeconds` of the workspace's finished projects (null without a sample); multiply by episodes and by people per episode. `annotation-projects.annotator-load` shows each person's open items.

Show the user the fields as a table and the decisions above, with your recommendation, and wait.

### 2. Create the draft and set its scope

`annotation-projects.create` with `status` `draft`:

```json
{
  "workspaceId": "wks_...",
  "name": "Kitchen failures",
  "templateSlug": "outcome-and-failure",
  "fields": [
    { "key": "outcome", "label": "Outcome", "granularity": "episode", "type": "verdict", "constraints": { "required": true } },
    { "key": "failure_mode", "label": "Failure mode", "granularity": "episode", "type": "single_choice",
      "constraints": { "allowedValues": ["slip", "collision", "missed_grasp", "timeout", "other"], "visibleWhen": { "field": "outcome", "equals": "failure" } } }
  ],
  "workflowSettings": { "assignmentMode": "claim", "reviewPolicy": { "mode": "full" } },
  "scope": { "datasetIds": ["ds_..."], "query": "", "mode": "static" },
  "status": "draft"
}
```

- `fields` is always required: with a template, copy its `fields` and `workflowSettings` into the body and pass its `slug` as `templateSlug`.
- `scope.datasetIds` takes 1 to 100 datasets; `query` narrows them with the episode query grammar (`episode-search`); `""` selects every episode.
- `annotation-projects.scope-preview` with a scope as body returns `episodeCount` and a `sample` of episodes, without changing the project. Try scopes until the count is right, then save the chosen one with `annotation-projects.update`. The scope can change only while the project is a draft.

Tell the user the episode count and two or three sample episodes before going on. Done when `annotation-projects.get` shows `status` `draft` and `scopeSnapshot` with the agreed `episodeCount`.

### 3. Publish the guidelines

`annotation-projects.create-guidelines` with `content` (Markdown) saves the next guideline version; every label records the guideline version it was made under. Link example episodes as `rfabric://episode/<episodeId>` or, for a moment, `rfabric://episode/<episodeId>#t=<seconds>`: annotators can jump to them. Publish the text the user wrote or approved, not your own wording of the rules. A later change is a new version; `annotation-projects.get-guidelines` reads one.

### 4. Activate

Say first: activation fills the queue from the scope and lets people start; the scope is fixed from then on. Then `annotation-projects.transition` with `status` `active`.

| Status | Meaning | Moves to |
| --- | --- | --- |
| `draft` | being set up; nothing queued | `active`, `archived` |
| `active` | people can label and review | `paused`, `completed`, `archived` |
| `paused` | no new items are handed out | `active`, `archived` |
| `completed` | labeling is closed | `active` (`annotation-projects.reopen`), `archived` |
| `archived` | final; cannot be re-opened | none |

Done when `annotation-projects.get` shows `status` `active` and a `summary.episodeCount` equal to the preview.

### 5. Label

Labeling needs eyes on the video, so it is the annotators' work in the rFabric app. Give each person the project link `https://app.rfabric.io/open/<annotationProjectId>`; they open it and choose **Start labeling**. You follow and unblock:

| To see | Operation | Read |
| --- | --- | --- |
| where the project stands | `annotation-projects.get` | in `summary`: `progress` (episodes `unassigned`, `inProgress`, `submitted`, `adjudication`, `returned`, `skipped`, `accepted`), `throughputPerDay`, `estimatedCompletionAt`, `labelingNow` |
| the queue by item status | `annotation-projects.queue-stats` | `total`, `reclaimed`, a count per status |
| items people gave up on | `annotation-projects.queue-escalations` | `skipReason` per item; decide with the user whether the guidelines need a fix. A skipped item does not return to the queue |
| progress per dataset | `annotation-projects.dataset-progress` | `labeledEpisodeCount` of `episodeCount` |

- **Prioritize**: `annotation-projects.queue-pin` with `queueItemIds` moves items to the front of the queue.
- **Change the schema mid-flight**: `annotation-projects.schema-activate` with the full new `fields` creates the next schema version. Labels already made keep their version, so old and new labels can differ: tell the user before you do it.
- **Pause or stop**: `annotation-projects.transition` to `paused`; `annotation-projects.cancel` archives for good, with a `disposition` of `discard_drafts` or `finish_and_close` and a `reason`.

When the user labels through you and tells you the values, these act for the signed-in user only:

| Action | Operation |
| --- | --- |
| take the next item (this claims it in the user's name) | `annotation-projects.queue-next` |
| see what is already known about the episode | `annotations.episodes-prior-context` with `annotationProjectId` (empty under blind labeling) |
| save unfinished work | `annotation-projects.replace-episodes-draft`; read it with `annotation-projects.list-episodes-draft` |
| see what the user already submitted for the episode | `annotation-projects.episodes-submission` |
| submit every label of the episode at once | `annotation-projects.episodes-submit` with `annotations` `[{target, payload}]`, for example `target` `{"targetType": "episode", "targetId": "ep_..."}` and `payload` `{"outcome": "failure", "failure_mode": "slip"}` |
| give the item up | `annotation-projects.queue-skip` with a `reason` |

Never invent a label: you cannot see the video. `isRedo` true with `redoFeedback` on a queue item means a reviewer returned it; submitting again replaces the earlier attempt.

### 6. Review

Reviewers open the same project link and choose **Submitted** in the progress line, which opens the oldest submission awaiting review. Or they decide through you:

1. `annotation-projects.review-batch` lists submissions awaiting review, oldest first (at most 500): `annotationId`, `episodeId`, `annotatorId`, `submittedAt` and the `annotations` with their `payload`.
2. Show each with its episode link and let the reviewer decide.
3. `annotation-projects.review-batch-accept` with `annotationIds`, or `annotation-projects.review-batch-return` with `items` `[{annotationId, feedback}]`. One id decides the whole submission. A returned item goes back to the queue with the feedback.
4. Read every result: `status` `applied`, or `skipped` with a `reason`. A batch does not fail as a whole.

With overlap, an episode is reviewable only after every slot is submitted. Where annotators disagree, the episode is in `adjudication` and lists each person's submission: accepting one supersedes the others. `annotations.get` reads one label and `annotations.history` every version of it, oldest first.

### 7. Watch quality

| Question | Operation | Read |
| --- | --- | --- |
| Do people agree? | `annotation-projects.metrics` | `agreementSummary` per episode and field; `fields` with the answer counts; `agreement` in the project's `summary` |
| How is each person doing? | `annotation-projects.performance` | `itemsPerHour`, `agreementRate`, `goldAccuracy`, `returnRate`, `skipRate`, `alerts` |
| Are thresholds breached? | `annotation-projects.alerts-evaluate` | `metric`, `threshold`, `observedValue` for the `alertThresholds` in the workflow settings |

- **Gold**: `annotation-projects.gold` with a `queueItemId` and a `sealedAnswer` (a payload with the correct values) marks that item as a known answer; later submissions on it are scored into `goldAccuracy`. Take the answer from the user. Queue item ids appear on `annotation-projects.review-batch` entries and on annotations (`annotations.list` with `annotationProjectId`).

Report quality to the project owner only; individual performance is personal data that needs `annotationPerformance:compare`.

### 8. Sign off

1. `annotation-projects.get`: `summary.readyToSignOff` must be true. It is when the project is `active`, every episode is accepted, and every entry of `summary.signOffConditions` has `met` true (`review_policy`: all required reviews done; `agreement`: above its `threshold`). An episode that was skipped is not accepted: with one left, the project cannot be signed off. Tell the user, and offer to close it without a sign-off (item 4); the export still holds every accepted label.
2. Tell the user what a sign-off is: a permanent record that pins exactly the labels accepted now, with the schema and guideline versions. It cannot be edited; later changes need a new sign-off.
3. `annotation-projects.sign-off` with body `{}` returns the LabelSnapshot with `pinnedAnnotationIds` and `conditionsSnapshot`.
4. Close labeling with `annotation-projects.transition` to `completed` when no more work is planned.

### 9. Export and hand over

- `annotation-projects.export` returns the accepted, current labels as text: `format` `jsonl` (default, one record per line), `coco`, `segments` or `keypoints`; `includeHistory` true adds superseded versions. The export is recorded in the audit log. Save it where the user asks and report the number of records.
- `annotation-projects.snapshots` lists the sign-offs, newest first; `annotation-projects.snapshots-resolve-episodes` returns what one sign-off pinned for an episode, flagged `tombstoned` if withdrawn since.
- Accepted labels flow on without an export: episode queries match them as `label:<fieldKey>=<value>`, `annotations.signals-query` lists them per episode, and freezing a dataset version writes them into its annotations file (`dataset-version`).
- Labels from an outside vendor: `annotation-projects.import` with `lines` in the `jsonl` export format; run it with `dryRun` true first and report each line's `outcome` (`matched`, `unmatched_target`, `constraint_violation`, `duplicate`). `annotation-projects.tombstone` withdraws labels by `importBatchId` or ids; it cannot be undone.
- Reuse: `annotation-projects.clone` makes a new draft with the same schema and settings; `annotation-projects.save-template` saves them as a workspace template.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `VALIDATION_ERROR` (422), `code` `annotation_project_settings_invalid` in `details` | the workflow settings contradict each other; `issues` names each `path` | fix them: fixed overlap is 1 to 5; `auto_assign` needs a large enough `annotatorPool`; `sampled` needs `samplePct`; reviewing low-confidence labels needs `confidenceCapture` |
| `VALIDATION_ERROR` (422), `code` `annotation_project_scope_required` in `details` | activating without a scope | set the scope (step 2) |
| `VALIDATION_ERROR` (422), `code` `annotation_project_scope_empty` in `details` | the scope selects no episode | widen the query; preview again |
| `VALIDATION_ERROR` (422), `code` `annotation_project_template_unknown` in `details` | no template with that `templateSlug` | take a `slug` from `annotation-projects.templates` |
| 400 on create or update | the scope `query` does not parse | fix the query (`episode-search`) |
| 409 on `annotation-projects.update` | the scope was changed on a project that is no longer a draft | clone the project and scope the clone |
| 409 on `annotation-projects.transition`, `allowedTransitions` in `details` | that status change is not allowed from here | use one of `allowedTransitions` |
| `annotation_project_not_active` (409) on `annotation-projects.queue-next` | the project is a draft, paused or completed | activate or resume it |
| `annotation_project_pool_excluded` (403) | the person is not in `annotatorPool` | add them with `annotation-projects.update` |
| `annotation-projects.queue-next` returns null | nothing is left for this person | check `progress` in the project's `summary`; others may hold the rest |
| `VALIDATION_ERROR` (422), message `annotation_constraint_violation` | a label breaks the schema; `violations` in `details` name each `field` | correct the value: a hidden field must be absent, a required one present, values within `allowedValues` |
| 409 on `annotation-projects.episodes-submit` | the held queue item cannot take a submission in its status | read the item again with `annotation-projects.queue-next` |
| 403 "Reviewer role required" | no `annotationReview:review` | name the permission; `member-access` finds why it is missing and what can add it |
| result `skipped` with reason "Another person is still labeling this episode" | overlap: a slot is still open | wait until every slot is submitted |
| 409 on `annotation-projects.sign-off` | not ready; `details` has `signOffConditions`, `progress`, `signedOff` | finish the open episodes or reviews; `signedOff` true means nothing changed since the last sign-off; `skipped` above 0 in `progress` means a sign-off is not possible (step 8) |
| a guideline is refused with `brokenLinks` in `details` | an episode link names an episode that does not exist | fix the ids |

## Done when

- [ ] `annotation-projects.get` shows every episode `accepted` in its `summary`, or the user chose to close the project with skipped episodes and no sign-off.
- [ ] `annotation-projects.review-batch` is empty.
- [ ] When signed off: `summary.signedOff` is true and `annotation-projects.snapshots` lists the sign-off with the expected number of `pinnedAnnotationIds`.
- [ ] The export the user asked for is saved, and you reported its format and record count.
- [ ] You reported agreement and, where gold was used, gold accuracy.

## Next

- `dataset-curation`: select episodes by the accepted labels.
- `dataset-version`: freeze a version that carries the labels to training.
- `episode-search`: find the next batch worth labeling.

## The rfabric CLI

They need a signed-in CLI with the workspace set (`rfabric config set workspace <workspace-id-or-slug>`); `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| List templates | `rfabric annotation-project templates` |
| Create | `rfabric annotation-project create --data @project.json` |
| Read with its summary | `rfabric annotation-project get <annotation-project-id>` |
| Activate, pause, complete | `rfabric annotation-project transition <annotation-project-id> <status>` |
| Progress and quality | `rfabric annotation-project queue-stats <annotation-project-id>`, `rfabric annotation-project metrics <annotation-project-id>`, `rfabric annotation-project dataset-progress <dataset-id>` |
| Sign off and list sign-offs | `rfabric annotation-project sign-off <annotation-project-id>`, `rfabric annotation-project snapshots <annotation-project-id>` |
| Export | `rfabric annotation-project export <annotation-project-id> --format coco > labels.json` |
| Import vendor labels | `rfabric annotation-project import <annotation-project-id> --file labels.jsonl --dry-run` |
| Clone, cancel, re-open | `rfabric annotation-project clone <annotation-project-id> --name <name>`, `rfabric annotation-project cancel <annotation-project-id> --disposition finish_and_close --reason <reason>`, `rfabric annotation-project reopen <annotation-project-id>` |
