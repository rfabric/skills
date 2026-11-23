---
name: policy-automation
description: >-
  A promotion gate - an enabled Policy that refuses to copy a Model or Artifact to another workspace until it has an approval or a passing evaluation, simulated first so the user sees which promotions it would stop. Use when asked to gate, protect or require approval or evaluation for promotions between workspaces, to write, simulate, enable, change, export, disable or retire a policy, or to find out why a promotion was refused or a policy did not apply. Not for making the promotion itself: that is `model-release` or `artifact-build`.
---

# Gate promotions with a policy

The user ends up with a Policy that is enabled and was simulated on real promotions before it went live. From then on rFabric refuses, on its own, every matching promotion whose proof is missing. Entities:

- **Policy** (`pol_...`): a versioned rule. A selector picks the promotions it applies to; its requirements say what must hold.
- **Promotion**: copying a Model (`mdl_...`) or an Artifact (`art_...`) from one Workspace to another. The kind `PromotionGatePolicy` is evaluated at the moment someone promotes.
- **PolicyDecision** (`pd_...`): the record of one evaluation: which policies matched and which requirements applied.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read the kind and the policies that exist | agent | `policy-kinds.get`, `policies.list` | none |
| 2 | Draft the policy | agent, user confirms | none | the user's answer |
| 3 | Simulate the draft on the promotions the user names | agent | `policy-simulations.synthetic`, `models.get`, `artifacts.get`, `evaluation-jobs.list` | none |
| 4 | Show what it would do; user decides | user | none | the user's go |
| 5 | Apply disabled, then enable; retire the previous version | agent | `policies.apply`, `policies.enable`, `policies.versions`, `policies.delete` | none |
| 6 | See it decide | agent | `policy-decisions.list`, `audit-logs.entity-history` | the next promotion |

## Before you start

- **Permissions**: policy, simulation and decision operations need a signed-in member with access to the workspace; no further permission. Reading a refused promotion in the audit log (step 6) needs `auditLog:read` (roles `owner`, `admin`, `auditor`). A policy with `isSystemManaged` `true` is the platform's: only rFabric changes it.
- **Needs**:
  - Two Workspaces: the one promotions leave (source) and the one they enter (`workspace-setup`).
  - Something to test with: an `approved` Model (`model-release`) or a `ready` Artifact (`artifact-build`) in the source Workspace.
  - For an evaluation requirement: a published EvaluationProtocol in the source Workspace (`evaluation-definitions`); its `slug` goes into the policy.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which promotions to gate: Models, Artifacts or both; out of which Workspace; into which | becomes the selector and the scope | `workspaces.list`; default: Models and Artifacts leaving the current Workspace, to any target |
| What proof is required | becomes the requirements (Decisions) | no default: ask |
| Promotions that should be stopped, and ones that should pass | test cases for the simulation | propose 3 to 5 from `models.list` and `artifacts.list` of the source Workspace |

## Decisions

What a promotion must prove. Every requirement of every matching policy must hold.

| Option | Choose when | Consequence |
| --- | --- | --- |
| `evaluationVerdict` (recommended) | a published protocol decides release quality | refused until an evaluation job with that protocol concluded `pass` on the entity, or on the Model or Checkpoint it was built from. A test run does not count. Optional `minProtocolVersion` rejects verdicts of older protocol versions |
| `approval` | a person's sign-off is the bar for Artifacts | an Artifact is refused until its Model was approved. A Model must be approved before any promotion, so for Models this adds nothing |
| Both | sign-off and measured quality are both required | both must hold |

Where it applies:

| Scope | Gates |
| --- | --- |
| One Workspace (recommended) | promotions that leave that Workspace, and promotions that enter it from another Organization |
| The Organization | the same for every Workspace of the Organization |

## Steps

### 1. Read the kind and the policies that exist

1. `policy-kinds.get` with `id` `PromotionGatePolicy`: `apiVersion`, `subject` (`promotion`) and `specSchema`. `specSchema.schema` is the JSON Schema of the policy's `spec`: author against it, do not guess fields. The kind resolves by `union`: every matching policy contributes its requirements.
2. `policies.list` with `kind` `PromotionGatePolicy`. Without a `workspaceId` filter it returns the policies of every Workspace the user can reach plus the organization-wide ones, which is what can also apply to the user's promotions (`includeRetired: true` adds retired versions). Show the enabled ones: a gate that exists is changed (step 5), not doubled.

A policy is identified by kind, `name` and scope; the same three give a new version instead of a second policy.

### 2. Draft the policy

The draft is the body of `policies.apply`:

```json
{
  "apiVersion": "rfabric.io/v1",
  "kind": "PromotionGatePolicy",
  "scope": { "organizationId": "org_...", "workspaceId": "wks_...", "fleetId": null },
  "name": "release-gate",
  "description": "Models and Artifacts leave bench only with a passing release check",
  "enabled": false,
  "priority": 0,
  "labels": { "owner": "ml-platform" },
  "spec": {
    "target": { "subject": "promotion", "selector": { "field": "promotion.entityType", "op": "in", "value": ["model", "artifact"] } },
    "triggers": [{ "kind": "onDemand" }],
    "requirements": [{ "kind": "evaluationVerdict", "protocolSlug": "release-check", "minProtocolVersion": 2 }]
  }
}
```

- `apiVersion`: the kind's `apiVersion`.
- `scope`: all three keys are required; `null` for a level that does not apply. `workspaceId` is the source Workspace. Organization only: `organizationId` set, `workspaceId` `null`.
- `enabled`: send `false`. Omitted, it is `true`, and the gate refuses promotions the moment it is stored.
- `spec` `triggers`: exactly `{"kind": "onDemand"}`. A gate with another trigger is never consulted.
- `spec` `target` `selector`: one test `{"field", "op", "value"}` or a tree of `{"allOf": [...]}`, `{"anyOf": [...]}`, `{"not": ...}`. `op`: `eq`, `neq`, `in`, `notIn`, `exists`, `regex`, `gt`, `gte`, `lt`, `lte`, `contains`. `exists` takes no `value`.

| `field` | Holds |
| --- | --- |
| `promotion.entityType` | `model` or `artifact`. Keep a test on it in every selector: this skill gates Models and Artifacts |
| `promotion.sourceWorkspaceId`, `promotion.targetWorkspaceId` | the two Workspaces; test the target to gate only promotions into production |
| `promotion.crossOrg` | `true` when the target is in another Organization |
| `promotion.disclosureLevel` | `summary`, `lineage_graph` or `full` |
| `"model.name"`, `"artifact.name"` | the name of the promoted entity, for a gate on one product line |

- `spec` `requirements`: one or more of `{"kind": "approval"}` and `{"kind": "evaluationVerdict", "protocolSlug": "<slug>", "minProtocolVersion": <n>}`. Read the `slug` and `version` with `evaluation-protocols.list` (`workspaceId`, `status` `published`).

Show the user the draft as one sentence plus a table (which promotions, from where, to where, what proof), not as JSON, and confirm it.

### 3. Simulate the draft

A simulation evaluates as a dry run: the decision comes back with `dryRun` `true`, and no promotion is made or refused. The operation is a POST, so the host asks for approval: say in the sentence before each call that it is a dry run.

One call of `policy-simulations.synthetic` per promotion the user named. Build `attributes` from the real entity (`models.get` or `artifacts.get`):

```json
{
  "subjectKind": "promotion",
  "attributes": {
    "promotion": { "entityType": "model", "entityId": "mdl_...", "sourceWorkspaceId": "wks_...", "targetWorkspaceId": "wks_...", "crossOrg": false, "disclosureLevel": "full" },
    "model": { "id": "mdl_...", "name": "pick-policy", "status": "approved" }
  },
  "scope": { "organizationId": "org_...", "workspaceId": "wks_...", "fleetId": null },
  "trigger": { "kind": "onDemand" },
  "draftPolicy": { "apiVersion": "rfabric.io/v1", "kind": "PromotionGatePolicy", "...": "the draft of step 2" }
}
```

- `scope`: the source Workspace, as a real promotion is evaluated. The simulation matches the draft by selector and trigger only: check yourself that the draft's `scope` is that Workspace or its Organization.
- Read the decision whose `kind` is `PromotionGatePolicy`. `matchedPolicyIds` empty: no gate applies to this promotion. With a match it holds an id for the draft (not a stored policy) next to the ids of stored gates that also apply; `actions` lists the requirements that would have to hold.
- To see what the draft adds, run the same call without `draftPolicy` and with `kinds` `["PromotionGatePolicy"]`, and compare.

The simulation says which requirements apply, not whether the entity meets them. Check that with reads, so the user sees the outcome and not only the rule:

| Requirement | Read | Met when |
| --- | --- | --- |
| `approval` | `models.get` (for an Artifact: the Model of its `modelId`) | `approvedBy` is set |
| `evaluationVerdict` | `evaluation-jobs.list` with `protocolId` (every published version of the `protocolSlug`, from `evaluation-protocols.list`), `conclusion` `pass` and `testRun` `false` | a job is listed whose `subjectId` is the entity, or the Model or Checkpoint it was built from, with a protocol version at or above `minProtocolVersion` |

Simulate every promotion the user named: the ones that must be stopped and the ones that must pass. A draft is not checked against the kind's schema here; that happens in step 5.

Done when: every test promotion gave the expected result, or the user changed the draft and you simulated again.

### 4. Show what it would do

One table, then wait for the user's go:

```text
Simulation of "release-gate" (draft, nothing was refused or promoted)

| Promotion | Gate applies | Requires | Proof found | Once enabled |
| --- | --- | --- | --- | --- |
| Model pick-policy v7, bench -> production | yes | pass on release-check v2+ | job evj_01J... passed on v2 | allowed |
| Artifact pick-policy-arm64 1.4.0, bench -> production | yes | pass on release-check v2+ | none | refused |
| Model pick-policy v7, bench -> sandbox | yes | pass on release-check v2+ | job evj_01J... passed on v2 | allowed |

Once enabled: every promotion of a Model or Artifact out of workspace "bench" is refused until a release-check evaluation passed on it. It affects everyone who promotes from "bench", from the moment it is enabled until it is disabled.
Enable it?
```

State what enabling means in their terms: which promotions, who is affected, what a refused person must do (run the evaluation, get the approval), and that it keeps deciding until disabled.

### 5. Apply disabled, then enable

1. `policies.apply` with the draft and `enabled` `false`. It validates the `spec` against the kind, then stores the policy. `noOp` `false` and status 201: a version was written (`policy` has its `id` and `version`). `noOp` `true`: the latest version already has this `spec`; nothing was written.
2. On a `VALIDATION_ERROR` nothing was stored: fix the draft (Problems) and repeat step 3 with the fixed draft.
3. `policies.enable` with `pathParameters` `id` and body `{"enabled": true}`. From this call the gate decides on its own.

**A change is a new version.** Policies are immutable: apply the changed draft (same kind, `name` and scope) and a version with the next number and a new `id` is stored. The previous version stays stored and enabled until you retire it, so after enabling the new one:

1. `policies.versions` with the new `id`: every version, newest first.
2. `policies.delete` on each older version that is not retired. Retiring sets `retiredAt`, cannot be undone, and keeps the row for the record.

Between enabling the new version and retiring the old one both apply, so a promotion must meet the requirements of both. When the new version is looser, that keeps the old bar until the old version is retired: retire it right after enabling.

`policies.apply` compares only `spec` with the latest version. To change only `description`, `priority` or `labels`, or to bring back a policy whose latest version is retired, use `policies.create` with the full body: it always writes a version.

### 6. See it decide

The gate is consulted when someone promotes (`model-release`, `artifact-build`). Nothing happens before that: say so, and offer to check after the next promotion from the Workspace.

| Outcome | The promoter sees | Read it back |
| --- | --- | --- |
| Allowed | the promotion record; its `sealedSummary` holds `gatingPolicyIds` (this policy) and the proof that admitted it: `approvals`, `evaluationVerdicts` | `policy-decisions.list` with `matchedPolicyId` and `dryRun: false`, newest first: `subjectRef` is the promoted entity, `actions` the requirements |
| Refused | 403 `FORBIDDEN`, "Promotion blocked by policy '<name>' (<id>)" and the missing proof | `audit-logs.entity-history` with `entityType` `model` or `artifact` and `entityId` the source: an entry whose `action` is `"model.promotion.rejected"` or `"artifact.promotion.rejected"`, with the message as `reason` in `after` |

Each evaluation writes one decision, matched or not: always filter `policy-decisions.list` by `matchedPolicyId` or `subjectRef`. `policy-decisions.get` shows one decision in full.

Done when: the policy is enabled and either a decision or a rejected promotion names it, or the user knows it decides at the next promotion and how to check.

## Export, disable, retire

| Goal | Operation | Effect |
| --- | --- | --- |
| Keep the policy as a file, or copy it to another scope | `policies.export` | `data` is a body for `policies.apply`. Before applying it elsewhere set `scope` and `enabled` `false`: an exported enabled policy applies as enabled |
| Stop it for now | `policies.enable` with `{"enabled": false}` | promotions are no longer checked against it; reversible |
| Remove it | `policies.delete` on every version that is not retired | retired for good; its decisions stay readable |

Before disabling or retiring say: "Promotions out of <workspace> are no longer held back by this gate."

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `VALIDATION_ERROR` 422 on `policies.apply` | the `spec` does not fit the kind's schema: an unknown key, no `requirements`, a requirement of another `kind` | compare with `specSchema.schema` from `policy-kinds.get` |
| `FORBIDDEN` 403 "system-managed policy" | the policy belongs to the platform | leave it; write your own policy beside it |
| A promotion went through that the gate should have stopped | the policy is disabled or retired, its `scope` is not the source Workspace or its Organization, its trigger is not `onDemand`, or the selector did not match | `policies.get` (`enabled`, `retiredAt`, `scope`, `spec`); simulate that promotion with its real attributes (step 3) |
| Promotion refused, "required approval is missing" | the Model behind the promoted entity has no approval | approve the Model (`model-release`), then promote again |
| Promotion refused, "no passing evaluation verdict against protocol" | no finished evaluation job with that protocol concluded `pass` on the entity or what it was built from; a test run or an older protocol version does not count | run the evaluation (`evaluation-job`; a simulation protocol through `simulation-suite`), then promote again |
| A promotion is refused that should pass | the selector is wider than intended, or an older version of the policy is still enabled | simulate it; apply a narrower version, or retire the old one (step 5) |
| Promotion refused with 403 and no policy named | no access to one of the Workspaces, or no promotion agreement with the other Organization | `model-release` or `artifact-build` |

## Done when

- [ ] The user saw the simulation table of step 4 and said go before `policies.enable`.
- [ ] `policies.get`: `enabled` `true`, `retiredAt` `null`, the `version` you applied.
- [ ] `policies.versions`: no older version is still enabled and not retired.
- [ ] A decision in `policy-decisions.list` or a rejected promotion in the audit log names the policy, or you told the user that it decides at the next promotion.
- [ ] You reported the policy id, version, scope, selector, requirements and how to disable it.

## Next

- `model-release`: approve a Model and promote it to another Workspace.
- `artifact-build`: promote an Artifact to another Workspace.
- `evaluation-job`, `simulation-suite`: produce the passing verdict a gate asks for.
- `evaluation-definitions`: publish the protocol a gate names.
- `audit-review`: who changed a policy, and which promotions were refused.
