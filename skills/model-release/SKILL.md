---
name: model-release
description: >-
  An approved Model that may ship - a checkpoint promoted, or weights imported, into the model registry, evaluated, documented and approved with a recorded reason. Use when asked to promote or register a checkpoint as a model, import a model from Hugging Face or a bucket, see why a model cannot be approved, approve, reject, hold, deprecate or archive a model version, edit a model card, or promote (copy) a model to another workspace. Not for packaging it for robots: that is `artifact-build`. Not for gating promotions: that is `policy-automation`.
---

# Model release

The user ends up with a **Model** (`mdl_...`, one version of a model name in a workspace) in status `approved`: the recorded decision, with evidence, that this version may ship. It starts from a **Checkpoint** (`ckpt_...`, weights saved by a training run) that you promote, or from weights you import. Two sets of rules guard the approval: the organization's rule on who may approve, and the workspace's **ModelApprovalPolicy** (`mapo_...`) records on what the version must show. A **ModelFamily** (`mfam_...`) groups the variants of one model per embodiment.

Statuses: `candidate` -> `evaluated` -> `approved` -> `deployed`; retirement: `deprecated`, `archived`. Approval never deploys: `deployed` is set when a rollout of one of the model's Artifacts becomes `active`.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Find the checkpoint, or inspect the import source | agent | `checkpoints.list`, `checkpoints.get`, `models.import-inspect` | - |
| 2 | Promote the checkpoint, or import the weights | agent | `checkpoints.promote`, `models.import` | import only: the weight copy, an Operation |
| 3 | Get evaluation evidence on the model | agent, through `evaluation-job` | `models.get`, `models.evaluations` | the evaluation job |
| 4 | Complete the model card | user writes, agent stores | `models.list-card`, `models.update-card` | the user's text |
| 5 | Read what blocks approval | agent | `introspect.whoami`, `security.list-gate-policies`, `model-approval-policies.list`, `models.get` | - |
| 6 | Approve | user decides, agent calls | `models.impact`, `models.approve` | other approvers, when the organization requires several |
| 7 | Confirm | agent | `models.versions`, `models.transitions` | - |

## Before you start

- **Permissions**: `introspect.whoami` returns `permissions` as resource -> actions. The built-in roles `owner` and `admin` carry all of the below. `operator` carries only `training:checkpoint`; `operator` and `member` read models.

| Action | Needs |
| --- | --- |
| Promote a checkpoint | `training:promote` |
| Mark a checkpoint as an evaluation subject | `training:checkpoint` |
| Import a model | `model:import`, and access to the workspace |
| Edit the card | `model:cardEdit` |
| Approve | `model:approve`, as a signed-in person (a service credential is refused) |
| Deprecate, archive, hold | `model:deprecate`, `model:archive`, `model:legalHold` |
| Export the card | read access to the workspace |
| Change who may approve (organization rule) | an organization admin |

- **Needs**: a Checkpoint (`training-run`, `external-training-run`) or weights to import; a published evaluation protocol (`evaluation-definitions`) and a way to run it (`evaluation-job`, `simulation-suite`). A Hugging Face repository that is gated or private needs a Hugging Face credential: `model-vendor-credential`. A bucket source needs a storage connection: `storage-connection`.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Model name | versions share a name; approving one supersedes the older approved versions of that name | `models.names` lists the names in use; reuse one to add a version |
| Version label | must be greater than the latest version of the name | omit it on promote: the API assigns the next label |
| Approval reason | stored with the decision, required | the user's own words; never write it for them |
| Card texts | intended use, safety notes, operating envelope: the author's statements an approver reads | the user's own words; show them the evaluation results to write from, never draft these yourself |

## Decisions

Where the weights come from:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Promote a checkpoint (recommended) | the weights come from a training run recorded on rFabric | the model keeps lineage to the run, its datasets and the checkpoint's content hash; `candidate` at once |
| Import from Hugging Face | a base model, or weights published there | pinned to one commit; files are copied and hashed in the background |
| Import from a storage connection | the weights sit in a connected bucket folder | copied into rFabric storage; the bucket is not changed |
| Import local files | the weights are on the user's machine | the files are uploaded first, then imported |

## Steps

### 1. Find the starting point

- Checkpoint: `checkpoints.list` (filter by the training run), then `checkpoints.get`. `promotedModelId` set means it is already a model: read that model instead of promoting again. `checkpoints.diff` compares the recorded metrics of two checkpoints.
- Import: `models.import-inspect` with `workspaceId` and `source` (`huggingface` with `repository` and optional `revision`; `storageConnection` with `storageConnectionId` and `path`; `upload` with `uploadGroupId`). It changes nothing. Tell the user `totalBytes`, `weightFiles`, `license`, `architecture`, and `duplicateOfModelId` when set (a model of the workspace already holds identical weights).
- To evaluate a checkpoint before it is a model, `checkpoints.designate-evaluation-subject` (empty body) lets evaluations target it. A pass there does not move any Model.

### 2. Promote or import

**Promote**: `checkpoints.promote` with `name`; `version`, `architecture`, `tags` are optional. Without `architecture` the model takes the one of the run's launch template. The result is a Model in `candidate`. Repeating the call for the same checkpoint, name and version returns the same model.

**Import**: `models.import` with `workspaceId`, `source`, `name`, `version`, `isBaseModel` and `robotModels` (the robot models the policy drives; empty for a base model). For Hugging Face pass `repository`, `revision` and the `commit` that inspect resolved. The response is a `candidate` Model whose `operationId` names the copy: follow it with `operations.get`. Tell the user the size first. Until the copy succeeds (`weightVerifiedAt` set) the model cannot be evaluated, approved or packaged.

Local files: upload them as one upload group with `upload-sessions.create` per file (`purpose` `model`, `datasetFormat` null, the same `clientGroupId` for every file; byte mechanics as in `dataset-upload`). `upload-sessions.get` returns the `uploadGroupId`: import with `source` `upload` and that id. `rfabric model import --upload <dir>` does both in one command (The rfabric CLI): prefer it for many files. With a shell, run it yourself after the user approves; without one, hand it over as a "Your turn" block.

Done when: `models.get` shows `status` `candidate`, and for an import `weightVerifiedAt` is set.

### 3. Get evaluation evidence

Approval needs the model in `evaluated`. Only rFabric sets that, from an evaluation report.

- Run the protocol with the model as subject: `evaluation-job`. Only a passing report whose subject is the **model** moves it to `evaluated`. A report on its Artifact (simulation suites take an Artifact) or on its Checkpoint does not: the model then needs an evaluation of its own.
- A later report of the same job that does not pass clears the evidence and returns an `evaluated` model to `candidate`.
- `models.evaluations` shows the results per protocol beside a comparison version (`against`, else the deployed or next older version); `models.compare` sets several versions side by side. Show the user the primary result against the version robots run now.
- For the approver, say how the evidence was produced: in `evaluation-jobs.report`, the `runs` of `provenance` give per run the `executionSource` (`manual`: a person ran it by hand, named in `executedBy`).

Evidence is what a report recorded, never what a person typed. Do not send `evaluationResults` in any call. A model without a passing report of its own is not ready for approval: say so and run the evaluation.

Done when: `models.get` shows `status` `evaluated` and `evaluationResults.reportId`.

### 4. Complete the model card

`models.list-card` returns the sections, `completenessScore` (0 to 100) and `limitations`. The score is 40 without evaluation results or 60 with them, plus up to 40 for the three authored sections.

| Sections | Written by | Keys |
| --- | --- | --- |
| Auto-assembled (`autoAssembled` true) | rFabric, from its records | `identity`, `provenance`, `embodiment`, `evidence`, `limitations` |
| Authored | the user | `intendedUse`, `safetyNotes`, `operatingEnvelope` |

`models.update-card` stores one authored section per call: `section` (one of the three keys) and `content` (an object holding the user's text). Each call replaces that section and records a revision under the user's name.

- Ask the user for each text and store it as given. Read it back before the call.
- Never send a `section` with an auto-assembled key: those sections are what rFabric recorded, and an approver relies on them.
- `models.card-export` returns the card as one document for sharing outside rFabric.

Done when: `models.list-card` shows the three authored sections with the user's text.

### 5. Read what blocks approval

`models.approve` refuses for one of five reasons. Read each before you call it, and tell the user in their terms what is open and who can clear it.

| Check, in the order approve applies it | Read it with | Tell the user when it blocks |
| --- | --- | --- |
| The user may approve | `introspect.whoami` | "You do not hold the approve permission on models. An owner or admin approves, or an organization admin grants it to you." |
| The organization's rule on who approves | `security.list-gate-policies` with `organizationId`: `policies`, take the entry with the `gateType` below and `enabled` true. No entry: no rule | `separationOfDuties` true and the user is the model's `promotedBy`: "Your organization requires that someone other than the person who promoted or imported this model approves it. You did, so another approver must." `requiredApprovals` above 1: "Your organization requires N different people to approve. Yours counts as one; the model is approved when the last one approves." |
| The weights are in rFabric | `models.get` | `operationId` set and `weightVerifiedAt` null: "The import is still copying the weights." Follow the Operation |
| Evidence | `models.get` | `status` is not `evaluated`: "This version has no passing evaluation of its own yet." Step 3 |
| The workspace's approval policies | `model-approval-policies.list` with `workspaceId` and `enabled` true; a policy applies when its `selectors` match the model (`familyId`, one of `tags`, `namePrefix`) | `minimumCardCompleteness` above the card's `completenessScore`: "The card scores X, this workspace requires Y: these sections are missing." Step 4. `minimumLineageCompleteness`: "This workspace requires the model's sources (training run, datasets) to be traceable to Y percent." Name the policy and who can change it (an owner or admin) |

```text
gateType of the organization's rule on model approval: model.approve
```

- `workspaces.pending-gates` lists human work the workspace waits for. An entry of `kind` `evaluation_review` is an evaluation run awaiting a grader. When it belongs to this model's evaluation job, the model cannot become `evaluated` until it is graded: `evaluation-grading`.
- `models.names` shows, per model name, `awaitingApproval`: the version waiting for a decision.

Done when: the user knows every open check, or that none is open.

### 6. Approve

Before the call, tell the user what approval does:

- Earlier `approved` or `deployed` versions of the same name become `deprecated` (`supersededByModelId` points here). They keep running on robots until a rollout replaces them: show `models.impact` of the superseded version (`robotCount`, `fleetCount`, `deployments`).
- The model's lineage is sealed, and the version becomes immutable except for tags, `meta`, authored card sections and `regressionWatchFlag`. An approved model cannot be deleted, only deprecated, then archived.
- Nothing is deployed.

Then `models.approve` with `approvalRationale` (the user's reason, in their words). Call it only when step 5 found nothing open.

When the organization requires several approvers, the call answers 409 with `reason` `approvals_pending` in `details`: this approval was counted, others are still needed, and `partialApprovals` lists who approved. Hand the user this block to pass on:

```text
Your turn - another approver, rFabric app
Why: your organization requires <N> different people to approve a model. <M> have approved.
Who: a member with approve on model (owner or admin) who has not approved it yet.

1. Open https://app.rfabric.io/<organization slug>/<workspace slug>/models/<model id>
2. Read the evaluation results and the card.
3. Choose Approve and give a reason.

Changes: the approval that completes the count approves the model and deprecates the earlier approved versions of <name>.
Bring back: tell me when they approved.
Then I: check the status and report what was superseded.
```

The slugs come from `organizations.get` and `workspaces.list`. Verify with `models.get`.

To turn a candidate down instead: `models.archive` with a `reason`. It is final for that version label: the label cannot be reused.

### 7. Confirm

`models.versions` lists every version of the name with its status; `models.transitions` shows who approved, when, the reason and the superseded versions. Report the model id, version, status, and which versions were deprecated.

## After approval

| Goal | Call | What the user must know |
| --- | --- | --- |
| Retire a shipped version | `models.deprecate` with `reason` (required), optional `replacementModelId`, `emergency`, `incidentRef` | from `approved` or `deployed` only. Read `models.impact` first. Robots keep running it: replace or roll back with `deployment-rollout` |
| Find the version to go back to | `models.rollback-target` | `modelId` of the newest lower version that is `approved`, `deployed` or `deprecated`, or a `reason` why there is none |
| Archive | `models.archive` with optional `reason` | from `candidate`, `evaluated` or `deprecated`; an approved or deployed version must be deprecated first |
| Legal hold | `models.hold` with `rationale`; lift with `models.hold-release` with `rationale` | while held, the version cannot be archived or deleted |
| Check weights obtained elsewhere | `models.verify-weight-hash` with `providedHash` (`sha256:` plus 64 hex) | `verified` true or false; changes nothing. `weightManifest` on the model lists each file's `sha256` to compare with a local `sha256sum` |
| Trace where it came from | `lineage.get` with `direction` `up` (sources) or `down` (what uses it) | `models.descendants` lists versions derived from a base model |
| Record a correction | `models.create-corrections` with `correction`, `reason`; read with `models.list-corrections` | append-only note beside a frozen version; the version itself does not change |
| Group variants per embodiment | `model-families.create`, `model-families.assign-model`; a model release of the family: `model-families.releases` with `bindings` (`modelId`, `variantEmbodiment`), then `model-families.releases-evaluate-readiness` | the release is `ready` when every bound model is `approved` or `deployed`; `readinessDetails.missingApprovedModelIds` names the ones that are not. Call readiness again after approving |
| Promote to another workspace of the organization (a copy) | `promotions.models-promote` with `targetWorkspaceId`, optional `disclosureLevel` (`summary`, `lineage_graph`, `full`; default `full`) | the source must be `approved`; the user needs access to both workspaces. The copy keeps name, version, status and evidence. A promotion gate of the source workspace or its organization can refuse it until its proof exists: `policy-automation` |

## Change the approval rules

Only when the user asks to change what approval requires. A change affects every later approval, so state the rule in plain words and who it affects before the call.

- Who may approve, for the whole organization (an organization admin's change): `security.replace-gate-policies` with path `gateType` (block in step 5) and body `organizationId` (the user's own, from `introspect.whoami`), `separationOfDuties`, `requiredApprovals`, `humanOnly`, `enabled`. Omitted fields fall back to their defaults, so send all of them.
- What a version must show, for one workspace: `model-approval-policies.create` with `workspaceId`, `name`, `selectors`, `minimumCardCompleteness`, `minimumLineageCompleteness`, `enabled`; change one with `model-approval-policies.update`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 on `checkpoints.promote` | that name and version exist from another checkpoint | choose another version, or omit `version` |
| 422 `VALIDATION_ERROR` naming the version | the label is not greater than the latest of the name (`details` hold `latestVersion`), or it was retired before | use a greater label |
| 409 `model_version_exists` | the import's name and version exist (`details` hold `modelId`) | read that model, or import under a new version |
| 422 `huggingface_credential_required` | the repository is gated or private and no credential reaches it | `model-vendor-credential`, then inspect again |
| 404 `import_source_not_found`, 422 `import_source_has_no_weights`, 422 `upload_group_not_model` | the repository, revision or folder does not exist; it holds no weight file; the upload group is not a model upload | fix the source, inspect again |
| 502 `huggingface_unreachable` | Hugging Face did not answer | retry later with the same body |
| The import Operation is `failed` | its `error` `code`: `source_object_missing`, `credential_rejected`, `source_digest_mismatch`, `upload_group_failed`, `model_import_incomplete` | fix the cause the message names, then import again under a new version; archive the failed candidate |
| 409 `model_weights_not_ready` | the import is still copying (`details` hold `operationId`) | follow that Operation, then repeat |
| 403 on approve | the user lacks `model:approve`, is not a person, or the organization's rule refuses them (`reason` `gate_policy` in `details`; the message says which: the approver must differ from the person who promoted the model) | another eligible person approves (block in step 6); do not look for another route |
| 409, `reason` `missing_evidence` | the model has no passing evaluation of its own | step 3 |
| 409, `reason` `policy_blocked` | a workspace approval policy is not met. `details`: `cardCompletenessShortfall` (points the card is short), `lineageCompletenessShortfall` (points the lineage is short), `missingProtocols` (protocols the policy names) | tell the user which requirement, by how much, and the policy's name (`model-approval-policies.list`). Card: step 4. The rest: an owner or admin of the workspace decides about the policy |
| 409, `reason` `approvals_pending` | this approval was counted; more approvers are needed | step 6 |
| 503 on approve | the organization's rule could not be read; nothing changed | retry after a minute |
| 409 on `models.archive` or `models.delete` | the version is under legal hold, or its status does not allow it | release the hold if the user owns that decision; deprecate before archiving |
| 409 on `promotions.models-promote` | the source is not `approved` (a `deployed` one is refused too) | copy it before a rollout makes it `deployed`; afterwards, promote or import the weights again in the other workspace |
| 403 on `promotions.models-promote` | no access to one workspace, no promotion agreement, or "Promotion blocked by policy" with the gate's name and the missing proof | the message names what is missing; for a gate, supply the proof it names (an approval, or a passing evaluation: `evaluation-job`); `policy-automation` reads and changes the gate |

## Done when

- [ ] `models.get` shows `status` `approved`, `approvedBy` and `approvalRationale` as the user gave it.
- [ ] `models.transitions` shows the approval and the versions it superseded; the user was told which versions are now `deprecated` and that robots still run them.
- [ ] `models.list-card` shows the three authored sections in the user's words, and the score the workspace policy asks for.
- [ ] For an import: the Operation `succeeded` and `weightVerifiedAt` is set.

## Next

- `artifact-build`: package the approved model with its inference image so simulation and robots can run it.
- `deployment-rollout`: roll the Artifact out to robots in stages.
- `evaluation-job`: more evidence, or a comparison against the deployed version.
- `policy-automation`: gate promotions of Models and Artifacts out of a workspace.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Promote a checkpoint | `rfabric checkpoint promote <checkpoint-id> --name <name> [--version <label>]` |
| Inspect an import source | `rfabric model import inspect --from-hf <owner/name> [--revision <rev>]` |
| Import | `rfabric model import --from-hf <owner/name> --name <name> --version <label> --robot-model <model> --wait`; `--storage-connection <id> --path <folder>`; `--upload <dir>` for local files; `--base-model` for a base model |
| Names, versions, evidence | `rfabric model names`, `rfabric model versions <model-id>`, `rfabric model evaluations <model-id> [--against <model-id>]` |
| Approve | `rfabric model approve <model-id> --reason "<text>"` |
| Deprecate, archive | `rfabric model deprecate <model-id> --reason "<text>"`, `rfabric model archive <model-id>` |
| Impact, rollback target, lineage | `rfabric model impact <model-id>`, `rfabric model rollback-target <model-id>`, `rfabric model lineage <model-id>` |
