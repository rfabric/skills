---
name: dataset-version
description: >-
  An immutable, training-ready DatasetVersion frozen from a dataset, a curated dataset or a candidate composition, and its upkeep. Use when the user wants to freeze, version, snapshot or finalize a dataset, pin data for training or evaluation, approve or reject a version proposal, check whether a version is ready, compare two versions, read a manifest or dataset card, verify checksums, mark a golden set, deprecate or archive a version, or record a correction on a finalized dataset. Not for choosing the episodes: that is `dataset-curation`.
---

# Dataset versions

The user ends up with a DatasetVersion (`dsv_...`): a frozen list of episodes with their splits, a manifest and a dataset card, identified by `name` and `semver`, that training runs and evaluations pin by id. It is cut from a Dataset (`ds_...`, imported or curated) or from a candidate composition (`ccom_...`, a selection made in `dataset-curation`). Freezing also starts an ExportJob (`exj_...`) that writes the version's files; the version is ready to train on when that job is done.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check that the source is ready | agent | `datasets.get`, `datasets.processing-status`, `datasets.sim-asset-mismatches`, `dataset-versions.list` | none |
| 2 | Agree source, name, semver, splits | user | none | the user's answer |
| 3 | Freeze (cannot be undone) | agent | `datasets.versions`, or `dataset-versions.proposals` and `dataset-versions.proposals-approve` | the call returns the version; a held proposal waits for its approval |
| 4 | Wait until the version is ready | agent | `dataset-versions.get`, `export-jobs.get` | until `exportStatus` is `completed` |
| 5 | Verify and describe | agent | `dataset-versions.manifest`, `dataset-versions.verify`, `dataset-versions.card` | none |
| 6 | Report the id to pin | agent | `dataset-versions.get` | none |

Managing existing versions (list, compare, golden, deprecate, archive, correct) is the section after the steps.

## Before you start

- **Permissions**: `dataset:finalize` for every change here (freeze, finalize, propose, approve, reject, deprecate, archive, golden); built-in roles `admin` and `owner`. Reads need access to the workspace; following the export job needs `export:read` (`operator`, `admin`, `owner`). Finalizing a dataset needs a person: a service identity is refused.
- **Needs**: a versionable Dataset (`dataset-upload`, `dataset-import`, `recording-conversion`), or a curated dataset or `ready` candidate composition from `dataset-curation`. Labels and enrichment the trainer should see must be finished first (`annotation-project`, `enrichment`): the freeze captures accepted annotations, enrichment output, quality scores and interventions as they are at that moment.
- **Ask the user**

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | Which source to freeze | Decides the operation (Decisions) | Datasets and curated datasets: `datasets.list` with `versionable: true`. A candidate composition: its `ccom_...` id from the `dataset-curation` report (compositions are read by id only) |
  | Version `name` | Identity, with `semver`; the pair is unique in the workspace and cannot be reused | Default: the dataset's name |
  | `semver` | `MAJOR.MINOR.PATCH` | Default `1.0.0`; for a name that exists, the next number the user chooses |
  | Splits and seed (imported dataset only) | Which episodes train and which validate | Default: one split `train` with every episode. Offered: `train` 0.9, `val` 0.1, seed 42 |
  | Whether the freeze waits for an explicit approval (composition only) | `requireApproval` | Default: no |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| Freeze a whole imported dataset (recommended for a first version) | Every episode of one dataset should train | `datasets.versions`; splits are drawn at random by `seed`; a dataset that is not finalized yet is finalized in the same call |
| Freeze a curated dataset | The user built a selection with a recipe (`dataset-curation`) | `datasets.versions` with only `name` and `semver`: members, splits and seed come from the recipe; the recipe stops matching new episodes; every member dataset is finalized |
| Freeze a candidate composition | The selection came from a ruleset or composition operations (`dataset-curation`) | `dataset-versions.proposals`; splits are the ones `composition.split` assigned, none when it was not run; source datasets are not finalized for you (step 3); the freeze can be held until someone with `dataset:finalize` approves it |
| Finalize only | The user wants the dataset locked now, without a version | `datasets.finalize`; no DatasetVersion exists afterwards |

## Steps

### 1. Check that the source is ready

For a Dataset:

1. `datasets.get`. Versionable means all of: `browsability` is `browsable`, `finalizationStatus` is not `failed`, `episodeCount` is above 0, and `processingStatus` is `ready`. `curationRulesetId` set means it is a curated dataset.
2. When `processingStatus` is not `ready`: `datasets.processing-status` lists the steps `validate`, `register` and `derive` with `status` and `errorMessage`. A `completed` `register` step is enough to freeze; a failed `derive` step (previews) does not block. Anything else: finish the import first (`dataset-import`).
3. `datasets.sim-asset-mismatches`: one entry per robot whose published robot description differs from the one stored with the dataset. It is a warning, never a block: show each `message` and let the user decide whether to fix the robot model first (`sim-asset-build`).
4. `dataset-versions.list` with `workspaceId` and `search` set to the name: which `semverLabel` values are taken.
5. A version that draws on several source datasets (a curated dataset or a composition over more than one) is merged into one LeRobot dataset. Every source must have `format` `lerobot_v3` and agree on fps, robot type and features; compare `format` with `datasets.get`, the rest is checked by the freeze itself (Problems). Sources in another format: freeze one version per dataset.
6. Optional: `dataset-missions.list` and `dataset-tasks.list` with `datasetId` show which Mission and Task definitions the data demonstrates; `dataset-missions.create` (`datasetId`, `missionId`) and `dataset-tasks.create` (`datasetId`, `taskId`) add a link, with ids from `missions.list` and `tasks.list`.

For a candidate composition: `curation.candidate-compositions` shows `status` `ready` and the `selectedCount` the user expects.

Done when the source passes, or the user knows exactly what blocks it.

### 2. Agree source, name, semver, splits

Present the Decisions table with what step 1 found, ask for the inputs in one go with the defaults, and wait. Say in the same message what step 3 cannot take back, so the user answers knowing it.

### 3. Freeze

Say before the call, every time:

- **A freeze cannot be undone.** The version's episodes, splits and manifest never change, and a version cannot be deleted; it can only be deprecated or archived later. Its `name` and `semver` pair is used up for good.
- **It finalizes the source dataset**, permanently: afterwards only the dataset's `tags`, `meta` and `labels` can change and it cannot be deleted. This stays even when the freeze fails after that point.
- For a curated dataset: its recipe stops matching new episodes.

**Dataset or curated dataset**: `datasets.versions` with the dataset id.

```json
{
  "name": "pick-place",
  "semver": "1.0.0",
  "splits": [{ "name": "train", "fraction": 0.9 }, { "name": "val", "fraction": 0.1 }],
  "seed": 42
}
```

- Split fractions sum to 1, names are unique, at most 10. Trainers read the split named `train`; a version without split labels trains on every episode.
- For a curated dataset send only `name` and `semver`.
- The response is the DatasetVersion: `id`, `semverLabel`, `manifestChecksum`, `datasetIds`, `splits`, `exportJobId`, and `exportStatus` `queued`.

**Candidate composition**:

1. Finalize each source dataset that is not `finalized` yet: `datasets.finalize`, then poll `operations.get` until `succeeded`. A training run refuses a version whose datasets are not all finalized.
2. `dataset-versions.proposals` with `compositionId`, `name`, `semver`. Without `requireApproval` the version is frozen in this call and the proposal returns `approved` with `datasetVersionId`.
3. With `requireApproval: true` the proposal stays `pending` and nothing is frozen yet. Report the proposal id (`dvpr_...`); it is also the composition's `finalizationProposalId`. Whoever approves calls `dataset-versions.proposals-approve` with that id, which freezes the version; `dataset-versions.proposals-reject` with a `reason` frees the composition for a corrected proposal.
4. `enforceSemver: true` refuses a PATCH number above 0 for a composition that selects episodes: use it when the user's rule is that a patch changes metadata only.

Done when you hold a `dsv_...` id, or a `pending` proposal the user knows who must approve.

### 4. Wait until the version is ready

Poll `dataset-versions.get` every 30 seconds: `exportStatus` goes `queued` -> `running` -> `completed`, or ends `failed` or `cancelled`. `export-jobs.get` with the version's `exportJobId` shows `progress` and, on failure, `errorMessage` and `diagnostics`.

Tell the user: "The version exists and is fixed. rFabric is now writing its files; training can start when that completes." A version built from several datasets is merged and copied, so it takes longer than one that points at a single dataset's files.

A `failed` or `cancelled` export cannot be run again and the version never becomes ready. Fix the cause, freeze again under the next `semver`, and deprecate the broken version with the new one as `successorVersionId`.

Done when `exportStatus` is `completed`.

### 5. Verify and describe

- `dataset-versions.manifest` with `section`: `identity` (default), `recipe`, `splits`, `statistics`, `provenanceComposition`, `lineage`, `membership`, `integrity`. `page` starts at 0; read `membership` up to `pagination.totalPages` before you count (a page past the end returns the first page again). Check `splits` and the member count against what the user asked for.
- `dataset-versions.verify` with body `{}` (or one `episodeId`): a POST that changes nothing. `valid: true` means every member's streams still match the checksums recorded at freeze. Issues: `checksum_mismatch` (a stream changed or is gone, with `streamId`), `tombstoned` (the version can no longer be rebuilt).
- `dataset-versions.card`: the generated card (`sections`: identity, statistics, lineage, recipeSummary, integrity). Summarize it for the user in a few lines.

Done when `valid` is `true` and the card matches what the user meant to freeze.

### 6. Report the id to pin

Final report: version id, `name`@`semverLabel`, episodes per split, `manifestChecksum` (a training run records it as `consumedManifestChecksum`), `exportStatus`, and the source dataset ids that are now finalized.

## Manage versions

| Goal | Operation | What the user must know |
| --- | --- | --- |
| List versions | `dataset-versions.list` | `workspaceId` is required; filter `lifecycleState`, `isGolden`; sort `frozenAt`, `name`, `createdAt` |
| Compare two versions | `dataset-versions.diff` | `leftId` is the base. Each episode is `added`, `removed` or `retained` with a `reasonCategory`; `page` starts at 0, `pageSize` defaults to 100, and `total` in `pagination` counts all three kinds |
| Compare two datasets | `datasets.diff` | `compareWith` is the other dataset; id lists are capped at 1000, counts are exact |
| Where a version came from | `dataset-versions.lineage`, `datasets.ancestry` | The composition, its recipe and ruleset; the dataset family tree |
| Mark a golden set | `dataset-versions.designate-golden` | A reference set for evaluation. Permanent: a golden version can no longer be deprecated or archived, and nothing removes the mark |
| Deprecate | `dataset-versions.deprecate` | `active` -> `deprecated`; name the replacement in `successorVersionId`. Nothing is deleted, and a training run that names the version still starts: tell its users |
| Archive | `dataset-versions.archive` | `active` or `deprecated` -> `archived`, the last state. Cannot be undone |
| Finalize a dataset without a version | `datasets.finalize` | Returns an Operation: poll `operations.get`. Permanent. Optional `summary` is stored with the transition |
| Read a dataset's lifecycle history | `datasets.transitions` | Who moved it between states, and when |
| Correct a fact on a finalized dataset | `datasets.create-corrections`, `datasets.list-corrections` | Append-only: `correction` (the right facts), `reason`, optional `path` of the field. The dataset itself stays unchanged |
| Correct a version | a new freeze | A version never changes: freeze the fixed selection under the next `semver`, then deprecate the old one with the new one as `successorVersionId` |

Before deprecating, archiving or marking golden, read the version with `dataset-versions.get` and tell the user that none of the three can be reversed. `training-runs.list` with `datasetVersionId` shows which training runs used the version.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 422 `VALIDATION_ERROR`, `code` in `details` `dataset_not_versionable` | Not ready to freeze; `details` carries `processingStatus`, `browsability`, `finalizationStatus` and the errors, or for a curated dataset the `datasetIds` that block | Step 1 for the dataset named |
| 422, `code` in `details` `dataset_empty` | No episodes to freeze | Import data, or widen the recipe (`dataset-curation`) |
| 422, `code` in `details` `dataset_version_splits_from_recipe` | `splits` or `seed` sent for a curated dataset | Send only `name` and `semver`; change splits in the recipe |
| 422, `code` in `details` `dataset_curated` | `datasets.finalize` on a curated dataset | Freeze a version of it instead |
| 422, `reason` in `details` `dataset_version_sources_incompatible` | The source datasets differ in the `field` named (`format`, `fps`, `robot_type`, `features`); `datasets` lists each value | Freeze the compatible datasets in separate versions |
| 422, `reason` in `details` `dataset_version_too_large` | Merging the sources needs `requiredDiskGiB` of disk; at most `maxDiskGiB` is available | Freeze fewer sources per version |
| 409 `CONFLICT`, "Version ... already exists" | The `name` and `semver` pair is taken | Choose the next `semver` with the user |
| 409 `CONFLICT`, "finalization is already in flight", "is finalizing", "changed while freezing" | Another finalize or freeze is running | Wait, read the dataset, try once more |
| 409 `CONFLICT`, `reason` in `details` `approvals_pending` | The organization requires several approvers to finalize. This user's approval is recorded (`partialApprovals`); nothing changed yet | Tell the user that further approvers must run the same step; repeat the call after they have |
| 403 `FORBIDDEN`, `reason` in `details` `gate_policy`, or "requires a human actor" | The organization's finalize policy refuses this actor (for example the person who created the dataset) | Another eligible person runs the freeze |
| 422, "Semver policy violation" | `enforceSemver` with a PATCH bump that adds episodes | Use a MINOR or MAJOR number |
| 409 `CONFLICT`, "Proposal ... is approved" or "is rejected" | The proposal is already settled | Read the composition; propose again if it was rejected |
| Operation of `datasets.finalize` `failed` | Its `error` message says why: already finalized, policy refusal, not a person | Read `datasets.get`; act on the message |
| `exportStatus` `failed` or `cancelled` | The version's files were not written; this version stays unusable for training | Step 4: read the job's `errorMessage`, fix the cause, freeze again under the next `semver`, deprecate this version |
| Training launch: 409 with `reason` `dataset_version_not_ready` | `exportStatus` is not `completed` yet | Step 4 |
| Training launch: 422 "not backed by a finalized dataset" | A member dataset of the version is not finalized | `datasets.finalize` for each of the version's `datasetIds` |
| 409 `IMMUTABLE_RECORD` on a dataset update or delete | The dataset is finalized | Record a correction instead |
| 409 `CONFLICT`, "Cannot transition from ..." | The version is already past that state | Read `lifecycleState`; archived is final |
| 403 `FORBIDDEN`, "Golden sets require ..." | Deprecate or archive of a golden version | Not possible; freeze a successor and tell users which one to use |
| `dataset-versions.verify` reports `checksum_mismatch` | A source stream changed or was removed after the freeze | Report the episodes; freeze a new version without them and deprecate this one |

## Done when

- [ ] `dataset-versions.get` shows the version with `exportStatus` `completed` and `lifecycleState` `active`.
- [ ] The manifest's `splits` and member count match what the user asked for.
- [ ] `dataset-versions.verify` returned `valid: true`.
- [ ] The user was told, before the freeze, that it is permanent and which datasets it finalizes.
- [ ] You reported the version id, `name`@`semverLabel` and `manifestChecksum`.

## Next

- `training-run`: launch training with the version id.
- `evaluation-job`: evaluate by replay on the version's episodes.
- `dataset-export`: download the version's episodes as a bundle for an external trainer or a partner.

## The rfabric CLI

They need a signed-in `rfabric` CLI; `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| List versionable datasets | `rfabric data ls --versionable` |
| Check robot model mismatches | `rfabric dataset sim-asset-mismatches <dataset-id>` |
| Freeze a dataset | `rfabric data version create <dataset-id> --name <name> --semver 1.0.0 --split train=0.9 --split val=0.1 --seed 42` |
| Propose a composition | `rfabric dataset-version propose <candidate-composition-id> --name <name> --semver 1.0.0 [--require-approval] [--enforce-semver]` |
| Approve or reject a proposal | `rfabric dataset-version approve-proposal <proposal-id>`, `rfabric dataset-version reject-proposal <proposal-id> --reason "..."` |
| List and read versions | `rfabric dataset-version ls -f workspaceId=<workspace-id>`, `rfabric dataset-version get <version-id>` |
| Finalize only | `rfabric dataset finalize <dataset-id>` |
| Record and list corrections | `rfabric dataset corrections create <dataset-id> --reason "..." --correction '{...}'`, `rfabric dataset corrections ls <dataset-id>` |
