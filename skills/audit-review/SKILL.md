---
name: audit-review
description: >-
  A dated answer, with evidence, to who did what on rFabric, and a checked security state of the organization. Use when asked who changed, deleted, exported or accessed something, for an entity's or robot's history, sign-in and credential events, the security posture, stale credentials, security incidents, a forensic timeline, an audit export for an auditor or a SIEM, tamper anchors, a break-glass review, or an actor's API requests. Not for narrowing or ending someone's access: that is `member-access`. Not for working an open alert: that is `alerting`.
---

# Audit and security review

The user ends up with a clear answer (who, what, when, from where), the entries that prove it, the time range they cover, and what the records cannot show. Entities:

- **AuditLog** (`al_...`): one append-only entry per action on the platform: actor, action, entity, before and after.
- **Identity audit event** (`iae_...`): one entry per sign-in, token, membership, credential or break-glass event of the identity service.
- **Security incident**: a record in a Workspace that tracks an investigation through `open`, `investigating`, `contained`, `resolved`.
- **Break-glass grant** (`bgg_...`): time-boxed elevated permissions a member activated in an emergency; it needs a review afterwards.
- **Tamper anchor**: a stored digest of the newest audit entries at a point in time.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Fix the question, scope and time range | agent, user answers | `introspect.whoami`, `workspaces.list` | the user's answers |
| 2 | Read the audit log | agent | `audit-logs.list`, `audit-logs.entity-history`, `audit-logs.device-timeline`, `security.robot-enrollment`, `security.forensics-timeline` | none |
| 3 | Add identity events | agent | `security.audit` | none |
| 4 | Add an actor's API requests | agent | `workspaces.usage`, `workspaces.request-logs` | none |
| 5 | Check the security state | agent | `security.posture`, `credentials.inventory`, `security.credential-policies`, `security.break-glass-grants`, `security.list-incidents` | none |
| 6 | Record the follow-up | agent, user decides | `security.create-incidents`, `security.incidents-status`, `security.break-glass-review`, `security.create-tamper-anchors` | none |
| 7 | Export the evidence | agent | `audit-logs.export`, `security.posture-export`, `security.siem-stream` | none |
| 8 | Report the answer | agent | none | none |

A question rarely needs every step. Step 1 always; then the steps the question names; step 8 always.

## Before you start

- **Permissions**:

| To | The user needs | Built-in roles |
| --- | --- | --- |
| Read the audit log, incidents, timelines, anchors, the SIEM stream | `auditLog:read` | owner, admin, auditor |
| Export the audit log | `auditLog:read` and `auditLog:export` | owner, admin, auditor |
| Read `credentials.inventory` | `credential:read` | owner, admin |
| List break-glass grants, read an actor's request logs | the owner or admin role | owner, admin |

  `introspect.whoami` shows what the user holds. An auditor can read and export but not see client credentials: say so instead of reporting an empty inventory.
- **Needs**: nothing to set up: rFabric records these entries itself.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| The question in one sentence | decides which reads to make | no default: a vague "audit everything" becomes the posture check of step 5 |
| Time range | every answer is only true for its range | ask; state the range you used in every answer |
| The actor or the entity | narrows the query | find the id yourself: members with `membership.members`, an entity by its list operation |
| Format and receiver of an export | CSV for a spreadsheet, NDJSON for a tool | NDJSON |

## Steps

### 1. Fix the question, scope and time range

`introspect.whoami` gives the organization (`org`) and the user's permissions. Most operations here take `organizationId`; narrow to one Workspace with `workspaceId` when the question is about one.

Pick the read from the question:

| Question | Operation | Limit to state |
| --- | --- | --- |
| Who did X, what did actor Y do, what changed in a period | `audit-logs.list` | none: page to the end |
| What happened to this entity | `audit-logs.entity-history` | newest 250 entries; 500 with `limit` |
| What happened to this device | `audit-logs.device-timeline` | newest 250, 500 with `limit`; `completeThrough` is the newest entry's time |
| Is this robot's enrollment chain intact | `security.robot-enrollment` | every entry of the robot, oldest first |
| What happened, in order, during an incident | `security.forensics-timeline` | oldest first; 1000 entries, 5000 with `limit` |
| Who signed in, failed to, changed roles or credentials | `security.audit` | page with `offset` |
| What did this actor call on the API | `workspaces.request-logs` | at most 500 entries per call |
| What may this member do, and why | `security.inspector` | none |

### 2. Read the audit log

`audit-logs.list` filters by `organizationId`, `workspaceId`, `actorId`, `actorType`, `action`, `actionClass`, `entityType`, `entityId`, `source`, and the window `from` / `to` on `occurredAt`. It returns newest first. Page with `pagination.nextCursor` passed back as `cursor` until it is null; do not conclude from the first page.

Narrow by `actionClass` before you narrow by `action` (action names are free text, classes are fixed):

| `actionClass` | Holds |
| --- | --- |
| `lifecycle` | status transitions: finalize, promote, approve, deploy, rollback, revoke |
| `permission` | role, permission and membership changes |
| `credential` | credentials created, rotated, revoked; provisioning tokens |
| `settings` | settings, residency and retention policy changes |
| `export` | data exports and external shares |
| `sensitive-access` | media playback and download, recording access, bulk dataset export |
| `retention` | retention runs, legal holds placed and released |
| `erasure` | erasure cases and their certificates |
| `security` | failed authentication patterns, revoked-credential attempts, enrollment events |
| `audit-access` | queries and exports of the audit log itself |
| `custom` | events recorded by a service for an external system |

Read an entry like this:

- `actorId` and `actorType` (`user`, `service`, `robot`): who. Turn a `usr_...` id into a name with `identity.account-display`; a `service` actor is a client credential or rFabric itself.
- `action`, `entityType`, `entityId`: what, on what. `before` and `after` hold the change.
- `occurredAt`, `ipAddress`, `origin`, `source`, `requestId`: when and from where.
- `clockSuspect` true: the entry came from a robot that was offline and its clock gave an implausible time. Report the time as uncertain.
- `correctedRecordId`: this entry corrects that earlier one; the earlier entry stays in the log.
- `exerciseLabel`: the entry belongs to a drill, not a real event.

Tell the user once: every query of the audit log is itself recorded in it under `audit-access`, with the user as actor. Reading here leaves a trace by design.

For one entity use `audit-logs.entity-history` (`entityType` such as `robot`, plus `entityId`). For an investigation use `security.forensics-timeline`: the same entries oldest first, optionally for one `workspaceId` and one `entityId`. It has no time filter: when the incident window is narrow, use `audit-logs.list` with `from` and `to` and reverse the order yourself.

Done when: you read every page for the filters, and you can name the entries (`al_...`) that carry the answer.

### 3. Add identity events

Sign-ins, failed sign-ins, token exchanges, password resets, MFA changes, membership and team changes, client and robot credential lifecycle, forced sign-outs and break-glass activity live in the identity service. Only membership and role changes are copied into the audit log, so a question about access needs both sources.

`security.audit` with `query` `{"organizationId": "org_...", "limit": 100, "offset": 0}` returns `events`, newest first: `eventType`, `actorId`, `actorType`, `subject`, `payload`, `createdAt`. It has no filter: page with `offset` and filter by `eventType` yourself. Most events are routine token refreshes; skip them. Stop paging when `createdAt` is older than the user's range.

Event types worth reporting:

```text
auth.login-failed                   auth.repeated-login-failures
auth.brute-force-detected           auth.credential-stuffing-detected
auth.refresh-replay-detected        auth.robot-revoked-cert-presented
auth.forced-invalidation            auth.session-terminated
auth.role-assigned                  auth.role-changed
auth.membership-created             auth.membership-removed
auth.mfa-enrolled                   auth.mfa-disabled
auth.client-credential-created      auth.client-credential-rotated
auth.client-credential-revoked      auth.robot-credential-revoked
auth.break-glass-activated          auth.break-glass-reviewed
auth.impersonation-started          auth.impersonation-ended
```

The identity service answers without the `data` wrapper: read `events`, `grants`, `clientCredentials` directly on the body.

### 4. Add an actor's API requests

- `workspaces.usage` (`pathParameters` `workspaceId`): per actor, `requestCount`, `errorCount`, `rateLimitCount`, `deprecatedEndpointCount` in a window. Use it to find which actor to look at.
- `workspaces.request-logs` (same path, `query` `actorId`): each request's `method`, `route`, `statusCode`, `latencyMs`, `correlationId`, `createdAt`, `rateLimited`. Owner or admin only.

Pass `since` and `until` on both operations, and name that window in the answer. Tie a request to an audit entry by actor and time: look in `audit-logs.list` for the same `actorId` with `from` and `to` set tightly around the request's `createdAt`.

### 5. Check the security state

Run these and report them as one table (finding, count, evidence, suggested action). A security state is true for one moment: head the table with the time of the check (`exportedAt` of the posture) and name the window of each check that has one.

| Check | Operation | A finding is |
| --- | --- | --- |
| Posture | `security.posture` | `mfaCoverage.enabled` below `mfaCoverage.total`; a `credentials` entry with `stale` true or `expiresAt` passed; any `recentAnomalies`; any `activeBreakGlass` |
| Security events | `audit-logs.list` with `actionClass` `security` and `from` seven days ago | every entry: failed authentication patterns, revoked-credential attempts, enrollment events |
| Client and robot credentials | `credentials.inventory` | a client credential with `stale` true, with `enabled` true and no `expiresAt`, or with wider `permissions` than its job needs; a robot credential with `enabled` true and a `lastUsedAt` older than the policy allows |
| Policy to judge against | `security.credential-policies` | `maxDormancyDays` and `rotationDays`: the thresholds for "unused too long" and "rotate" |
| Break-glass | `security.break-glass-grants` with `reviewed` `false` | every grant listed: it needs a review (step 6) |
| Incidents | `security.list-incidents` with `status` `open`, then `investigating` | every incident listed, with its age |

This skill reports findings. The fix belongs to its owner:

| Finding | Owner |
| --- | --- |
| A member's access; members without a second factor | `member-access` |
| An actor that must be signed out everywhere, now | `member-access` (forced sign-out) |
| A stale or over-broad client credential | `ci-integration` (rotate or revoke) |
| A robot's credential | `robot-enrollment` |

Offer the fix with what it stops (sessions, pipelines, a robot's connection); the user decides.

### 6. Record the follow-up

**Incident.** When a finding needs investigation, propose opening an incident. `security.create-incidents` body: `organizationId`, `workspaceId`, `title`, optional `severity` (free text, `medium` when omitted), `context` (put the audit entry ids and the time range here), and `exerciseLabel` only for a drill. It starts `open`. Move it with `security.incidents-status` and body `{"status": "investigating"}`:

| `status` | Say to the user |
| --- | --- |
| `open` | recorded, nobody has started |
| `investigating` | someone is establishing what happened |
| `contained` | the cause can do no more harm; cleanup remains |
| `resolved` | closed; `closedAt` is set. Any other status reopens it and clears `closedAt` |

Any status can follow any other. Each move is written to the audit log with before and after. The status is the user's call: propose it, do not move it on your own judgement.

**Break-glass review.** For each grant with `reviewedAt` null, show the user `userId`, `reason`, `elevatedPermissions`, `activatedAt`, `expiresAt`, then what that user did in the window: `audit-logs.list` with `actorId`, `from` `activatedAt`, `to` `expiresAt`. The user writes the conclusion; you record it with `security.break-glass-review` (`pathParameters` `grantId`, body `{"reviewNotes": "..."}`). A reviewed grant stops granting access at once, also when it has not expired: say so before the call when the emergency is still running. A review cannot be edited afterwards.

**Tamper anchor.** `security.create-tamper-anchors` (body `organizationId`, optional `workspaceId`) stores a SHA-256 digest over the newest 1000 audit entries of that scope. Offer it before an audit period closes or when an incident is opened. `security.list-tamper-anchors` returns the latest 200 with `anchoredAt`, `digest`, `digestAlgorithm`. Tell the user what an anchor is: a fixed fingerprint of the log at that time that they can keep outside rFabric. It covers the 1000 newest entries at `anchoredAt`, not the whole history.

### 7. Export the evidence

| Evidence | Operation | Format |
| --- | --- | --- |
| Audit entries | `audit-logs.export` | `format` `csv` (id, organizationId, workspaceId, occurredAt, actorId, actorType, action, actionClass, entityType, entityId, source, requestId) or `ndjson` (one `{schemaVersion, emittedAt, event}` per line, `event` the full entry) |
| Security posture | `security.posture-export` | `format` `json` or `csv` (one row per posture item) |
| Entries in the SIEM envelope format | `security.siem-stream` | one envelope per audit entry, newest first |

- `audit-logs.export` takes the same filters as `audit-logs.list` and returns one page (up to 2000 entries with `limit`). The next page's cursor is the response header `x-next-cursor`, empty on the last page. When you cannot read headers, export in windows instead: set `from` and `to` so each window holds fewer entries than `limit`, and check each count with `audit-logs.list`.
- CSV has no `before` and `after`. For a change history use `ndjson`.
- The export is recorded in the audit log, with the user as actor.
- `security.siem-stream`: page with `pagination.nextCursor` as `cursor` until null (`limit` up to 2000). Each item has `auditLogId`, `emittedAt`, `schemaVersion` and the `envelope`. Write one envelope per line to a file the user loads into their SIEM.

Write an export to a file in the working directory and give the user its path, entry count, filters and time range. Do not paste a long export into the conversation.

### 8. Report the answer

Use this shape, so an auditor can check it:

```text
Answer: <one sentence: who did what, when>.

Evidence
| When (UTC) | Who | Action | On | Entry |
| --- | --- | --- | --- | --- |

Scope: organization <name>, workspace <name or all>, <from> to <to>.
Read: <n> audit entries (all pages), <n> identity events.
Not covered: <what these sources cannot show, or a limit that was reached>.
Next: <open an incident, review a grant, export, or nothing>.
```

"Nothing found" is an answer only with its scope: say which filters and range returned no entries.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `403` `permission_denied` naming `auditLog` | the user lacks `auditLog:read` (or `auditLog:export`) | name the permission; `member-access` finds why it is missing and what can add it |
| `403` `permission_denied` on `security.break-glass-grants` | the user is not an owner or admin of that organization | an owner or admin runs this part |
| `403` `FORBIDDEN` on `workspaces.request-logs` | owner or admin role needed | use `workspaces.usage` for the totals, or ask an admin |
| `404` "Grant not found" on review | wrong `grantId` | list the grants again |
| An expected action is absent | it is an identity event, outside the range, or in another Workspace | check `security.audit`, widen the range, drop `workspaceId` |

## Done when

- [ ] The answer names actor, action, entity and time, and each claim cites an entry id (`al_...` or `iae_...`).
- [ ] The scope and time range are stated, every page was read, and any limit reached is named.
- [ ] For a security review: every check of step 5 is reported, including the ones with no finding.
- [ ] Each change you made is confirmed by a read: the incident in `security.list-incidents`, the grant with `reviewedAt` in `security.break-glass-grants`, the anchor in `security.list-tamper-anchors`.
- [ ] An export exists as a file, with its entry count, filters and range.

## Next

- `member-access`: narrow or end the access a finding points to; offboard a departing member; force a sign-out; have members without a second factor add one.
- `ci-integration`: replace a stale or over-broad client credential.
- `robot-enrollment`: provision a robot again when its credential or certificate ends.
- `data-governance`: place a legal hold on the data an incident touches; residency and erasure evidence.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Query the audit log | `rfabric audit-log query --organization-id <org> [--actor-id <id>] [--action-class <class>] [--entity-type <t> --entity-id <id>] [--from <RFC3339>] [--to <RFC3339>] [--limit <n>]` |
| Entity history | `rfabric audit-log entity-history --entity-type <type> --entity-id <id>` |
| Device timeline | `rfabric audit-log device-timeline --device-id <id>` |
| Export | `rfabric audit-log export --format csv --dest audit.csv [--filter '<json>'] [--cursor <cursor>]` |
| Any other read | `rfabric api get '/api/security/posture?organizationId=<org>'` |
