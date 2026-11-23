---
name: data-governance
description: >-
  Data that stays in its region, is kept only as long as policy says, is preserved under a legal hold, and is erased on request with a certificate. Use when asked about data residency, a region pin, retention periods or a retention run, a legal hold, an erasure or deletion request (GDPR, a customer, a robot), verified deletion, a cross-region transfer, the egress allowlist or audit, records of processing, auditor evidence, or offboarding a workspace. Not for who did what: that is `audit-review`. Not for exporting datasets: that is `dataset-export`.
---

# Data governance

The user ends up with rules that rFabric enforces (where data lives, how long it is kept, where events may be sent) and with proof: reports, attestations and certificates. Entities:

- **Region** (`rgn_...`): a residency zone the Organization defines, naming a `cloudRegion`.
- **Residency pin**: the Region an Organization or Workspace must keep its data in.
- **Retention policy**: per data class, how many days data is kept.
- **LegalHold** (`hld_...`): while `active`, protects the data in its scope from retention and erasure.
- **ErasureCase** (`erc_...`): one erasure request: opened, enumerated, executed, closed with a signed certificate.
- **CrossRegionOperation** (`cro_...`): one recorded and approved movement of data between two Regions.
- **EgressAllowlist** (`eal_...`): the domains the Organization's webhooks may deliver to.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

Each row is one job. Step 1 always; then the jobs the request names.

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read the current state | agent | `compliance.list-residency-pin`, `compliance.list-retention-policies`, `legal-holds.list`, `compliance.list-erasure-cases`, `governance.workspaces-residency-report` | none |
| 2 | Pin residency | agent, user decides | `regions.list`, `regions.create`, `compliance.create-residency-pin`, `compliance.attestation-residency` | none |
| 3 | Set retention, preview, run | agent, user confirms the preview | `compliance.retention-preview`, `compliance.create-retention-policies`, `compliance.retention-execute` | none |
| 4 | Place, prove, release a legal hold | agent, user decides | `compliance.legal-holds`, `compliance.legal-holds-evidence`, `compliance.legal-holds-release` | none |
| 5 | Erase on request | agent, user confirms the enumeration | `episodes.list`, `compliance.erasure-cases-open`, `compliance.erasure-cases-enumerate`, `compliance.erasure-cases-execute`, `compliance.get-erasure-cases`, `retention.verified-deletion` | none |
| 6 | Approve a cross-region transfer | agent, an owner approves | `cross-region-operations.create`, `compliance.cross-region-transfers-approve`, `compliance.cross-region-transfers-execute` | the approver |
| 7 | Control and audit egress | agent | `egress-allowlists.list`, `egress-allowlists.create`, `egress-allowlists.update`, `egress-audit.list` | none |
| 8 | Produce evidence | agent | `compliance.records-of-processing`, `compliance.privacy-export-control`, `compliance.attestation-residency`, `compliance.legal-holds-evidence` | none |
| 9 | Offboard a workspace | agent, user confirms | `compliance.offboarding-workspaces`, `compliance.offboarding-execute` | none |

Every operation here answers in one call; none starts background work.

## Before you start

- **Permissions** (`introspect.whoami` shows what the user holds):

| To | The user needs | Built-in roles |
| --- | --- | --- |
| Read pins, policies, previews, evidence, attestations | `compliance:read` | owner, auditor |
| Change pins and policies, run retention, hold, erase, approve transfers, offboard | `compliance:manage` | owner |
| Place or release a hold without `compliance` | `legalHold:place`, `legalHold:release` (`legal-holds.create`, `legal-holds.release`) | owner, admin |
| Verified deletion | `retention:verifiedDelete` | owner, admin |
| Egress allowlist | `webhook:update` | owner, admin, operator |
| Egress audit | `egressAudit:read` | owner, admin |

  The admin role does not carry `compliance`: most changes here need an owner. Say so before the user plans around it.
- **Needs**: an Organization and Workspace (`workspace-setup`). For erasure and retention: data to act on. For a pin: a Region (step 2 creates one).
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Scope: the whole Organization or one Workspace | most rules exist at both levels | `workspaces.list`; an Organization rule is enforced on all its Workspaces |
| The legal or policy reason, in one sentence | stored as `rationale` on holds, pins, policies and cases; auditors read it | no default: ask |
| For erasure: whose data (a robot, a Workspace, named entities) and from when to when | becomes the case `scope` | resolve names to ids yourself with the list operations |
| For retention: days per data class | the policy | read the current values first; propose a change, never a guess |

## Decisions

Which way to remove data. Recommend by the reason for removal.

| Option | Choose when | Consequence |
| --- | --- | --- |
| Erasure case (step 5) | a person, customer or regulator asks for erasure; a robot or site leaves; proof is needed | lists every copy in scope before anything is erased; certificate afterwards; held data is kept and listed as an exception |
| Retention run (step 3) | data older than the policy should go, as routine | deletes only copies past their retention period; no certificate; held data is skipped |
| Verified deletion (step 5) | a few named episodes or sensor streams must go now | one attestation per entity; also clears its name, review, tags and attributes; a tombstone stays so lineage still resolves |
| Workspace offboarding (step 9) | a whole Workspace ends | erases all data of the Workspace; refused while any legal hold of the Organization is active |

All four are irreversible. None deletes files in the user's own storage: rFabric reports those as `external-reported` and the user deletes them.

## Steps

### 1. Read the current state

| Question | Operation | Notes |
| --- | --- | --- |
| Where must data live | `compliance.list-residency-pin` (`scopeType`, `scopeId`) | `pinned` false and `sourceScopeType` `default`: no pin, the platform default `cloudRegion` applies; a Workspace inherits its Organization's pin |
| Where does data live | `governance.workspaces-residency-report` | pass `pathParameters` `{"workspaceId": "wks_..."}` and `query` `{"format": "json"}` (`csv`, `md` for a document to hand over); lists Regions with counts and every cross-region operation; an empty report is valid evidence |
| How long is data kept | `compliance.list-retention-policies` (`scopeType`, `scopeId`) | one entry per data class: `raw-capture`, `curated-dataset-version`, `operational-telemetry`, `teleop-recording`, `audit-log`; `indefinite` true means never expired |
| What is on hold | `legal-holds.list` with `status` `active` | `scope` says what each hold covers |
| Which erasures ran | `compliance.list-erasure-cases` | `status`, `exceptions`, `certificate` |
| Which transfers exist | `cross-region-operations.list` | `status` `pending` waits for approval |

Report the state as one table before proposing a change.

### 2. Pin residency

1. `regions.list` for the Organization. No fitting Region: `regions.create` with `organizationId`, `name`, `cloudRegion` (for example `eu-west-2`) and `complianceFrameworks`.
2. Before the change, tell the user: "After this, storage, processing and exports in <scope> that target another cloud region are refused. Uploads land in the pinned region. Data already stored elsewhere is not moved." An Organization pin is enforced on every Workspace: it affects others.
3. `compliance.create-residency-pin` with `scopeType` (`organization` or `workspace`), `scopeId`, `regionId`, `rationale`.
4. Verify: `compliance.list-residency-pin` returns `pinned` true with that `regionId`.

A Workspace pin may only tighten: a Region in another cloud region than the Organization pin is refused. To change a pin, pin again with another Region.

Proof for an auditor: `compliance.attestation-residency` (`organizationId`, optional `workspaceId`, `periodFrom`, `periodTo`) returns, per data class, the Region and count, the completed cross-region transfers of the period (or a `zeroTransfersStatement`) and a `signature` (SHA-256 of the document). It is recorded in the audit log. Save it to a file for the user.

Done when: the pin reads back, and the residency report shows no data in a Region the pin excludes (or you told the user which data remains there).

### 3. Set retention, preview, run

Preview first, always:

1. `compliance.retention-preview` with the proposed policy. It changes nothing. It returns per data class `expiringCount`: the stored copies that would already be past retention.

```json
{
  "scopeType": "workspace",
  "scopeId": "wks_...",
  "policies": {
    "raw-capture": { "durationDays": 180 },
    "teleop-recording": { "durationDays": 30 }
  }
}
```

2. Show the counts and say: "Shortening retention makes <n> copies expired at once. rFabric stops serving the original of an expired recording immediately; the bytes are deleted by the next retention run."
3. `compliance.create-retention-policies` with the same body plus `rationale`. It replaces the whole override of the scope: a class you leave out falls back to the platform default, not to its previous value, so send every class the user wants to differ.
4. Verify with `compliance.list-retention-policies`.

Limits: `audit-log` cannot go below 365 days; a Workspace may only keep data for the same or a shorter time than its Organization.

Run retention:

1. Preview: `compliance.retention-execute` with `{"workspaceId": "wks_...", "dryRun": true}` lists the expired copies in `processedRefs` and deletes nothing.
2. Show the user the count per `entityType` and the oldest and newest items. Say: "This run deletes these <n> recording sources, episodes and sensor streams. It cannot be undone. Records, lineage and audit history stay."
3. On their yes to that list: the same call without `dryRun`. Each copy comes back with `disposition` `deleted`, or `held` when a legal hold covers it. `paused` true with `lastError`: a deletion is still pending; run it again later.

### 4. Place, prove, release a legal hold

Place: `compliance.legal-holds` (or `legal-holds.create` for an admin without `compliance`) with `organizationId`, `rationale` and `scope`:

```json
{
  "organizationId": "org_...",
  "rationale": "Litigation notice 2026-014: preserve the March recordings of workspace bench",
  "scope": {
    "workspaceIds": ["wks_..."],
    "timeWindow": { "from": "2026-03-01T00:00:00Z", "to": "2026-04-01T00:00:00Z" }
  }
}
```

What each `scope` key covers (the same keys scope an erasure case in step 5, except `fleetIds`). A stored copy is a recording source (an upload or a conversion input), an Episode or a sensor stream:

| Key | Covers |
| --- | --- |
| `workspaceIds` | every stored copy of those Workspaces |
| `siteIds` | every stored copy of the Workspace a named site belongs to |
| `robotIds`, `fleetIds` | what those robots uploaded themselves: their uploads and the conversions made from them. Their Episodes are named with `entityRefs` |
| `entityRefs` (`[{ "entityType", "entityId" }]`) | the named entities (`entityType` such as `episode`, `sensorStream`, `uploadSession`) and copies linked to them in lineage |
| `timeWindow` (`from`, `to`) | with other keys: only their copies stored in the window. Alone: everything stored in it |

- Effect, to tell the user: while the hold is `active`, retention runs and erasure cases skip the covered data, and no Workspace of the Organization can be offboarded. Nothing is copied or moved.
- A hold cannot be edited. Wrong scope: release it and place another.

Prove: `compliance.legal-holds-evidence` (`pathParameters` `id`) lists every stored copy the hold covers, each with `disposition` `held`. Run it right after placing and compare it with what the user wants preserved: an empty `copies` means the scope matched nothing, a missing copy means the scope is too narrow. The export is recorded in the audit log.

Release: `compliance.legal-holds-release` with body `{"rationale": "..."}`. Say first: "The data becomes subject to retention and erasure again: the next retention run may delete it." Verify with `legal-holds.get`: `status` `released`, `releasedAt` set.

### 5. Erase on request

Example: a customer asks to erase everything robot `rbt_...` recorded.

1. Collect what must go. `episodes.list` with `robotId` (every page) gives the robot's Episodes; keep the count for point 4.
2. Open: `compliance.erasure-cases-open`. The case is `draft`; nothing is erased.

```json
{
  "organizationId": "org_...",
  "workspaceId": "wks_...",
  "rationale": "Erasure request of customer Acme, ticket 4711: all data of robot arm-07",
  "scope": {
    "robotIds": ["rbt_..."],
    "entityRefs": [{ "entityType": "episode", "entityId": "ep_..." }]
  }
}
```

   - `scope` keys: the table in step 4. For a robot send both `robotIds` (its uploads) and its Episodes as `entityRefs`; with `robotIds` set, the enumeration also follows each Episode to what was derived from it.
   - Set `workspaceId`, or `workspaceIds` in `scope`. With neither, the case covers every Workspace of the Organization.
   - A scope cannot be changed. Wrong scope: leave the draft (it erases nothing) and open another case.
3. Enumerate: `compliance.erasure-cases-enumerate`. The case becomes `enumerated` and `enumeration` lists every copy: `entityType`, `entityId`, `dataClass`, `kind`, `workspaceId`. It deletes nothing and can be rerun to refresh.
4. Preview for the user, as one table: counts per `entityType` and Workspace, dataset versions and models named one by one, and the copies an active hold covers (`legal-holds.list`). Check it before you show it: every Episode of point 1 is listed, and nothing is listed that the request does not name. If not, stop and open a case with a corrected scope. Say what execution does:

| In the enumeration | On execution |
| --- | --- |
| Upload or conversion source (`uploadSession`, `operation`) | the stored files are deleted; a source in the user's own storage is not deleted, only reported as `external-reported` |
| Episode, sensor stream | marked expired and dropped from lists; the record stays |
| Dataset version | tombstoned: excluded from use, the record stays |
| Model | kept, flagged for assessment: it was trained on erased data, a person decides its fate |
| Other derived entities (such as a training run or a checkpoint) | listed in the certificate, the entity stays: decide with the user what happens to each |
| Copy under an active legal hold | kept, listed in `exceptions` with `disposition` `held` |

5. Before the call say: "This erases the <n> copies listed above. It cannot be undone." Execute on an explicit yes to that list: `compliance.erasure-cases-execute`. The case ends `completed`, or `completed-with-exceptions` when a hold kept something, with a `certificate`: `generatedAt`, `copyRefs` with each `disposition`, `humanReadableSummary` and `signature` (SHA-256 of its content).
6. Verify: `compliance.get-erasure-cases` shows the final `status`; `episodes.list` with `robotId` returns none. Hand over the certificate as a file.

Copies with `disposition` `external-reported` are in the user's own storage and were not deleted. List them to the user by `entityType` and `entityId`, and say that removing them there is theirs to do; report that part as not verified by rFabric.

Variants:

- **A few named entities, now**: `retention.verified-deletion` with `workspaceId` and `entityRefs`. There is no preview operation: show the user the exact list, say that it cannot be undone, and call on their yes. It returns one attestation per entity (`attestationId`, `erasedFields`, `executedAt`, `executedBy`) in `attestations`, and in `held` the refs it skipped because a hold covers them.
- **Decommissioned robots**: `compliance.robot-dispositions` with `organizationId`, `robotIds`, `rationale` and `disposition` records what happens to their data: `retain` (normal retention applies) or `accelerate`, which also opens a draft erasure case per robot scoped by `robotIds` alone (`erasureCaseId`). Enumerate that case and check it as in point 4 before anything is executed.
- **Check afterwards**: `integrity-reports.workspaces-run`, then `integrity-reports.get` until `status` is `completed`: `violations` lists references that now point at nothing.

### 6. Approve a cross-region transfer

A transfer is a record with an approval trail. It moves no data itself.

1. Check the Workspace allows transfers: `workspaces-settings.get-effective` with `pathParameters` `{"id": "wks_...", "key": "governance.crossRegionTransferPermitted"}` must return `value` true. It is off by default (`workspace-setup` covers settings).
2. `cross-region-operations.create` with `workspaceId`, `sourceRegionId`, `targetRegionId`, `operationType` (`export`, `processing_relocation`, `replication`) and `dataClasses`. It starts `pending`. A target outside the residency pin or the allowed Regions is refused here.
3. An owner approves: `compliance.cross-region-transfers-approve`. When the user is not an owner, stop and say who must approve and which id (`cro_...`).
4. After the movement it stands for has happened: `compliance.cross-region-transfers-execute` sets it `completed`. Completed transfers appear in residency attestations, so do not mark one completed early.

### 7. Control and audit egress

- **Allowlist**: `egress-allowlists.list` for the Organization. With an `active` allowlist that has domains, a webhook subscription can only be created or pointed at a URL whose host is a listed domain or a subdomain of one. Without one, any URL is accepted.
- Keep one allowlist per Organization: change it with `egress-allowlists.update` (`domains`, `status` `active` or `disabled`); create one with `egress-allowlists.create` only when none exists.
- Before the change: existing subscriptions are not rechecked. List them with `webhook-subscriptions.list`, compare their hosts with the new domains, and tell the user which ones fall outside.
- **Audit**: `egress-audit.list` (`organizationId`, optional `workspaceId`, `from`, `to`, `eventType`) returns the newest 500 deliveries: `eventType`, `endpointUrl`, `payloadProfile`, `status`, `deliveredAt`, `deliveryRegion`. Narrow the window to see older ones. Report by endpoint: what left, to where, from which region.

### 8. Produce evidence

| Evidence | Operation | Content |
| --- | --- | --- |
| Records of processing (GDPR article 30) | `compliance.records-of-processing` (`pathParameters` `organizationId`) | per Workspace: storage cloud region, retention policies, export-control designation; the subprocessors |
| Residency | step 2 | attestation and report |
| Legal hold coverage | step 4 | evidence export |
| Erasure | step 5 | certificate |

`compliance.privacy-export-control` marks a Workspace export-controlled (`designated` true or false). The designation shows in the records of processing.

Each of these is recorded in the audit log with the user as actor. Save documents to files and give the paths.

### 9. Offboard a workspace

1. Keep what must be kept: export it first (`dataset-export`). Offboarding hands over no data.
2. Check holds: `legal-holds.list` with `status` `active`. Any active hold of the Organization blocks offboarding.
3. Preview: open and enumerate an erasure case with `scope` `{"workspaceIds": ["wks_..."]}` (step 5, points 2 to 4). Show the counts and say: "Offboarding erases all of this. It cannot be undone." This case stays as a draft record; do not execute it.
4. `compliance.offboarding-workspaces` (`pathParameters` `workspaceId`) opens the case (`obc_...`), `status` `export-complete`. Nothing is deleted. Keep the id from the response for the next call and for your report.
5. On an explicit yes, naming the Workspace: `compliance.offboarding-execute` (`pathParameters` `id`). It erases the Workspace's data through an erasure case of its own and returns `status` `completed`, `erasureCaseId` and a `certificate`.
6. The Workspace itself still exists, empty. Archive or delete it with `workspace-setup`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `403` `permission_denied` naming `compliance` | the user is not an owner (or, for reads, an auditor) | name the permission; an owner runs it |
| `422` `VALIDATION_ERROR`, `details.governingRule` `tighten-only` | a Workspace pin or policy is looser than its Organization's | choose a Region in the same cloud region, or a shorter period; or change the Organization rule |
| `422` with `details.floorDays` | `audit-log` retention below 365 days | keep 365 or more |
| `403` `FORBIDDEN` with `pin` in `details` | the target is outside the residency pin | pick a Region inside the pin; changing the pin is the owner's decision |
| `403` `FORBIDDEN` with `details.allowedRegionIds` | the target Region is not in the Workspace's allowed Regions | pick an allowed Region |
| `403` "Cross-region transfer blocked by default policy" on create, or "Transfer no longer permitted" on approve | cross-region transfers are switched off for the Workspace | step 6, point 1 |
| `422` "Transfer must be approved before execution" | the transfer is not `approved` | approve first |
| `422` "Erasure case must be enumerated before execution" | the case is `draft` | enumerate, preview, then execute |
| `409` `CONFLICT` "Overlapping erasure case" | another case that is executing or completed already covers one of these copies | read that case; enumerate again so the copy drops out |
| `409` `CONFLICT` "erasure is pending" | deletion of an original is still in progress | execute the same case again later; a case left `executing` can be executed again |
| `409` `CONFLICT` "lineage enumeration is incomplete" | too much derived data to enumerate in one case | split the scope (fewer robots, a shorter `timeWindow`) |
| `409` `CONFLICT` "Offboarding blocked by active legal hold"; case `blocked-by-hold` | a hold is active in the Organization | release the hold if the user may, then open a new offboarding case: a blocked one cannot be resumed |
| `422` "not on the organization egress allowlist" on a webhook | the URL's host is outside the allowlist | add the domain (step 7) or use an allowed endpoint |

## Done when

- [ ] The state before and after is reported in one table, each value from a read operation.
- [ ] A pin reads back from `compliance.list-residency-pin`; a policy from `compliance.list-retention-policies`.
- [ ] Before every deletion the user saw the preview (dry run or enumeration) and said yes to that list.
- [ ] An erasure case is `completed` or `completed-with-exceptions` in `compliance.get-erasure-cases`; exceptions and `external-reported` copies are named to the user.
- [ ] A hold shows `active` or `released` in `legal-holds.get`, with its evidence export when asked.
- [ ] Every document (report, attestation, certificate, records of processing) is saved as a file and its path given.

## Next

- `audit-review`: show who placed, released, executed or exported what, from the audit log.
- `dataset-export`: export data before a retention run, erasure or offboarding.
- `workspace-setup`: change governance settings; archive or delete an offboarded Workspace.
- `storage-connection`: the user's own buckets, where `external-reported` sources live.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Residency report | `rfabric governance workspace residency-report <workspace-id> --format md` |
| Regions | `rfabric region ls` |
| Cross-region operations | `rfabric cross-region-operation ls` |
| Any other operation | `rfabric api get '/api/compliance/residency-pin?scopeType=workspace&scopeId=<workspace-id>'`, `rfabric api post /api/compliance/retention-preview --data @policy.json` |
