---
name: workspace-status
description: >-
  A one-screen answer to where the user stands on rFabric - what waits for them, whether their work finished, what is running or failed, their unread notifications, the workspace's state, and the next step. Use when the user asks "what needs me", "did my import finish", "what is running", "what failed", "what is broken", "any notifications", "what changed", "where am I", "find <name or id>", for a standup or handover summary, or at the start of a session. Not for one robot's live health: that is `fleet-monitoring`.
---

# Workspace status

The user ends up with one screen, most important first: what waits for them, the work that finished, failed or still runs, the state of the Workspace, and one next step. Nothing is changed.

- **Workspace** (`wks_...`): where robots, data, models and runs live, inside an Organization (`org_...`). Every reading below is per workspace.
- **Operation** (`op_...`): one piece of background work (an import, an upload, a training run) with a status, progress and failures.
- **Notification** (`ntf_...`): a message addressed to one user: work they started has settled, or something was assigned to them.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Identify the user and the workspace | agent | `introspect.whoami`, `workspaces.list` | none |
| 2 | Find what waits for the user | agent | `workspaces.pending-gates`, `notifications.list` | none |
| 3 | Find finished, running and failed work | agent | `operations.list`, `operations.get` | none |
| 4 | Read the workspace state | agent | `workspaces.overview` | none |
| 5 | Report on one screen | agent | none | none |

Every step is a read. Run steps 2 to 4 together once the workspace is known.

## Before you start

- **Permissions**: access to the workspace is enough. An `admin`, and any member without a workspace restriction, reaches every workspace of the organization; others reach the workspaces assigned to them or to their teams.
- **Needs**: a workspace. A user without one is sent to `workspace-setup`.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which workspace | every reading is per workspace | `workspaces.list`; with one, use it; with several, ask, unless the question names it |

## Steps

The question decides how much to read. Answer it in the first line, then add only the blocks that have content.

| The user asks | Read | First line of the answer |
| --- | --- | --- |
| "what needs me", "what is waiting" | steps 1, 2, 3 | how many items wait for them, oldest first |
| "did my import finish", "is it done" | step 1, then "One piece of work" in step 3 | yes, no or failed, with the counts |
| "what is running", "what failed" | steps 1, 3 | what needs a fix, then what runs |
| "what is broken" | steps 1, 3, 4 | critical alerts, then what needs a fix |
| "any notifications" | steps 1, 2 | unread count, newest first |
| "where am I", session start, standup, handover | steps 1 to 5 | the full screen of step 5 |
| "what changed", "find ...", "how do I start" | step 1, then "Other questions" | the answer itself |

### 1. Identify the user and the workspace

1. `introspect.whoami`: `sub` is the user id, `org` the active Organization, `orgRole` their role. In `inspection`, `workspaceIds` lists the workspaces they are restricted to (empty means every workspace).
2. `workspaces.list`: the workspaces they reach, each with `status`: `active`, `archived` or `scheduled_deletion`.

- When the user wants every workspace, repeat steps 2 to 4 per workspace and report one block each.
- `archived` and `scheduled_deletion` workspaces are read-only. Say so before the user asks for a change there; `workspace-setup` restores them.
- Every call runs in the organization the user authorized for this connection. Report on that organization only.

Done when: the user id, the organization, the role and one workspace id are known.

### 2. Find what waits for the user

**Reviews and requests.** `workspaces.pending-gates` with `pathParameters` `workspaceId` returns two lists, each holding the 50 oldest items of every kind:

| List | Holds | Say |
| --- | --- | --- |
| `waitingOnYou` | items assigned to this user (`assigneeId` is their id) and items nobody has taken (`assigneeId` null) | "assigned to you" or "open, anyone who may review can take it" |
| `waitingOnHumans` | items assigned to someone else | who holds it, and for how long |

Each item has `kind`, `entityId`, `entityName` when there is one, `ageSeconds` and `blocks` (what stays stuck until it is decided).

| `kind` | What waits | Continue with |
| --- | --- | --- |
| `annotation_review` | a submitted annotation batch awaits review | `annotation-project` |
| `evaluation_review` | an evaluation run awaits a human grade | `evaluation-grading` |
| `intervention_request` | a robot asked for an operator; `entityName` is the robot | `intervention-session` |
| `intervention_proposal` | a proposed intervention awaits a decision | `intervention-session` |

**Notifications.** `notifications.list` with `query` `{"workspaceId": "wks_...", "unread": true, "sort": "createdAt:desc"}` returns this user's own unread notifications; `total` in `pagination` is the unread count.

| `kind` | Sent to | Read | Continue with |
| --- | --- | --- | --- |
| `operation` | the person who started an import or an enrichment run, when it settles | `title` says imported, imported with failures, finished or failed; `body` has the counts; `metadata.operationId` is the Operation | step 3, with that id |
| `maintenance` | the person a maintenance record was assigned to | `title`, `metadata.maintenanceRecordId`, `metadata.robotId` | `robot-maintenance` |

- `severity` is `info`, `warning`, `error` or `critical`. Lead with `critical` and `error`.
- For any other kind, report `title` and `body` as written; when `alertId` is set, continue with `alerting`.
- Of all background work, imports and enrichment runs notify. For any other work (an upload, a conversion, a training run, an export) the Operation in step 3 is the answer.

Done when: the user has the count and the oldest item of each list and their unread notifications, or knows that nothing waits.

### 3. Find finished, running and failed work

All four use `operations.list` with `query` `workspaceId`:

| Goal | Add to `query` | Returns |
| --- | --- | --- |
| Totals | `"count": true, "groupBy": "status"` | the number of Operations per `status` |
| Running | `"status": "running", "sort": "createdAt:desc"`; repeat with `queued` when the totals show any | work in progress |
| Needing a fix | `"needsFix": "true", "sort": "createdAt:desc"` | settled Operations with failed items that no later Operation has repaired |
| The user's own | `"requestedBy": "<user id>", "sort": "createdAt:desc"` | what they started, newest first |

What a `status` means for the user:

| `status` | Meaning |
| --- | --- |
| `queued` | accepted, waiting to start |
| `running` | in progress; `progress` is `current` of `total` `unit` |
| `succeeded` | finished; it can still carry failed items: read `failures` and `needsFix` |
| `failed` | stopped without a result; `error` says why |
| `cancelled` | stopped on request |

For each Operation give `subject` (what it works on, by name), `kind`, the status in those words and, when `failures` is not empty, its first entries: `reason` and `count`, largest first. An Operation whose `fixedByOperationId` is set was repaired by that later Operation: do not report it as a problem.

**One piece of work** ("did my import finish"):

1. `operations.list` with `requestedBy` (the user id), `sort` `createdAt:desc` and either `search` (the name the user gave; it matches `subject`) or `kind`. Add `workspaceId` when the user named a workspace; without it the list covers every workspace they reach.

```text
import                 datasetImport.run
upload                 uploadSession.complete
recording from a robot robotDataset.upload
conversion             conversion.submit, conversion.run
enrichment             enrichment.run
training run           training.run
evaluation job         evaluation.job
export                 export.run
```

2. No match: drop `requestedBy` (someone else, a robot or a policy may have started it), then ask for the name.
3. Answer in one line: finished (with `finishedAt` as an age), still running (with `progress`) or failed (with the reason). Then the counts from `result` and the entries of `failures`. A finished import with failures is not "done": say how many failed and why.
4. Still running and the user wants to wait: poll `operations.get` with `pathParameters` `id` until the status settles (base skill, Background work).

Done when: the user knows what runs, what still needs a fix and why, and the outcome of the work they asked about.

### 4. Read the workspace state

`workspaces.overview` with `pathParameters` `workspaceId`. Read `status` (`state`, `drivers`) and `tiles`.

| `state` | Meaning |
| --- | --- |
| `healthy` | no critical alert is firing and no review waits |
| `needs_review` | annotation submissions or evaluation runs wait for a human review |
| `degraded` | at least one critical alert is firing |

`state` names one condition, and `needs_review` takes precedence over `degraded`. So read `drivers` every time:

| Driver `kind` | `count` is | Continue with |
| --- | --- | --- |
| `critical_alerts` | critical alerts firing now | `alerting` |
| `waiting_on_humans` | annotation submissions and evaluation runs awaiting review | step 2 |

Each tile has `metrics` (`name`, `value`, and `of` for a share):

| Tile `kind` | Metric | Continue with |
| --- | --- | --- |
| `data_inflow` | `datasets` | `dataset-upload`, `dataset-import` |
| `curation_backlog` | `pending_review` | `annotation-project` |
| `training_activity` | `active_runs` | `training-run` |
| `evaluation_verdicts` | `awaiting_review` | `evaluation-grading` |
| `release_status` | `active_deployments` | `deployment-rollout` |
| `fleet_health` | `online` of all robots, `needs_intervention` | `fleet-monitoring` |
| `active_alerts` | `open_critical` | `alerting` |

- A tile with `unavailable` true has no reading: report it as unknown, never as zero.
- A tile that is absent has nothing to report.
- `status` and every tile carry `freshUntil`. Read again before you quote a number after that moment.

Done when: you can state the workspace's state in one sentence, critical alerts included.

### 5. Report on one screen

Most important first. Leave out a block that is empty, except "Waits for you": say "nothing" there. Give times as ages ("2 days"), names before ids, and the open link for the kinds the base skill lists.

```text
Workspace bench (Acme Robotics). You: Ana Ruiz, admin.

Waits for you (2)
| What | Age | Blocks |
| Evaluation run evr_01J... (open) | 2 days | Model release gate |
| Annotation batch ann_01J... (open) | 5 hours | Dataset finalization |
Waits for others (1): intervention request on robot arm-03, 20 minutes, held by Ben Ito.

Unread (2): import "warehouse-a" imported with failures, 2 hours ago. Maintenance assigned: "Replace gripper" on arm-03.
Needs a fix (1): import "warehouse-a" - 1 of 12 datasets failed: missing episode index.
Running (1): training run "pick-v7" - 4,200 of 10,000 steps.
State: needs_review, and 1 critical alert is firing.

Next: grade the oldest evaluation run - say "grade evr_01J...".
```

Pick the next step in this order: a critical alert, an item assigned to the user, an open item in `waitingOnYou`, an Operation that needs a fix, a notification with `severity` `error` or `warning`. Name the skill that carries it.

## Other questions

**What changed.** `workspaces.overview-activity` with `pathParameters` `workspaceId` returns up to 50 events, newest first: `cause` (the action), `impact` (the entity), `area` (the entity type) and `at`. `query` `window` is `24h`, `7d` (default), `30d` or `90d`; `area` narrows to one entity type. For more than 50, or one person's actions, `workspaces.activity` is the paged feed, filtered by `entityType` or `actorId`.

**Where work stops.** `workspaces.overview-funnel` returns `stages`, each with a `count`: datasets (`capture`, `imported`), accepted annotations (`annotated`), finalized datasets (`training_ready`), completed training runs (`trained`), completed evaluation runs (`evaluated`), active deployments (`deployed`). Give the counts in that order; the first stage at zero is where work stops.

**How big.** `organizations.overview` with the `org` id counts the workspaces, fleets, robots, sites and environments the user reaches.

**How to start** (a new workspace, or every tile reads zero). `workspaces.onboarding` with `pathParameters` `workspaceId` and `query` `organizationId` returns journeys, each with `steps` carrying `title`, `status` (`pending`, `in_progress`, `complete`, `blocked`) and, when a step stalls, `stallGuidance`. Report the first step that is not `complete` of each journey below, and quote `stallGuidance` as rFabric wrote it.

| Journey `id` | Continue with |
| --- | --- |
| `first_robot` | `robot-enrollment` |
| `first_dataset` | `dataset-upload`, `dataset-import` |
| `first_deployment` | `model-release`, `artifact-build`, `deployment-rollout` |

**Find one thing.**

| The user gives | Do |
| --- | --- |
| an id | the `get` operation of that kind |
| a kind and a name ("the dataset warehouse-a") | that kind's list operation with `query` `workspaceId` and `search` |
| a name, tag or state without a kind | `search.list` with `query` `workspaceId` and `q` |
| "in any workspace" | `search.org` with `query` `organizationId` and `q`: one partition per workspace the user reaches |

`q` is a list of terms separated by spaces; every term must match. Results carry `entityType`, `entityId`, `name` and `state`.

| Term | Matches |
| --- | --- |
| plain words | name, case-insensitive |
| `type:dataset`, `type:robot` | one entity type |
| `state:<state>` | the entity's state |
| `tag:<tag>` | a tag |
| `created>2026-01-31`, `created<2026-03-01` | created after or before an ISO date |
| `<attribute>=<value>`, also `>`, `<`, `>=`, `<=` | a custom attribute |

For Episodes by content, use `episode-search`.

**Clear notifications.** `notifications.read` with `pathParameters` `id` marks one notification read. It is a change: do it only when the user asks, one call per notification, and say how many you marked.

**Stop work.** `operations.cancel` with `pathParameters` `id` stops a `queued` or `running` Operation whose `cancellable` is true. It may be someone else's work: name the Operation, who started it (`requestedBy`) and what is lost, and let the user confirm.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `inspection` holds only an `error` in `introspect.whoami` | the user is not a member of the organization this connection is authorized for | stop and tell the user; an admin of that organization restores their membership |
| 403 `permission_denied` or `FORBIDDEN` naming a workspace | the workspace is outside the user's assignment | name the workspaces they reach; `member-access` finds why it is out of reach and what can add it |
| 404 `NOT_FOUND` on a workspace | wrong id | list again with `workspaces.list` |
| 429 `RATE_LIMIT_EXCEEDED` | too many calls in the window | wait until `reset` in `details` (seconds since epoch); `limits.list` shows the limit and window |
| a tile has `unavailable` true | that source gave no reading | report it as unknown and continue |
| 400 `BAD_REQUEST` on `search.list`, "Malformed structured term" | a `type:`, `tag:`, `state:` or `created` term has no value | fix the term at `position` in `details` |
| 400 "Unknown filter field(s)" on a list | the filter is not one the operation documents | use only the `query` fields in its description |
| 409 `operation_terminal` on cancel | the Operation already succeeded or failed | read it with `operations.get` |
| 409 `operation_not_cancellable` on cancel | this kind of Operation runs to its end | wait for it; report its progress |

## Done when

- [ ] The question was answered in the first line, from a read made in this conversation.
- [ ] The user was told who they are, their role and the workspace, from `introspect.whoami` and `workspaces.list`.
- [ ] `workspaces.pending-gates` was read and the items in `waitingOnYou` reported, or "nothing waits for you" said.
- [ ] Unread notifications were reported from `notifications.list`, or their absence said.
- [ ] Running Operations and Operations with `needsFix` were reported from `operations.list`, each failure with its reason.
- [ ] For a full report: the state and its drivers from `workspaces.overview`.
- [ ] The report names one next step and the skill that carries it.
- [ ] Nothing was changed, or each change (a notification marked read, an Operation cancelled) was asked for by the user.

## Next

- `workspace-setup`: no workspace yet, or the workspace is archived.
- `member-access`: why a workspace is out of the user's reach, and what can add it.
- `alerting`: critical alerts are firing.
- `fleet-monitoring`: robots need attention.
- The skill named beside each waiting item, notification, tile or journey above.

## The rfabric CLI

`--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| Who the user is | `rfabric auth whoami` |
| Workspaces | `rfabric workspace ls` |
| Notifications | `rfabric notification ls -f workspaceId=<workspace-id> -f unread=true` |
| Operations per status | `rfabric operation count-by status -f workspaceId=<workspace-id>` |
| Running Operations | `rfabric operation ls -f workspaceId=<workspace-id> -f status=running --sort createdAt:desc` |
| One Operation | `rfabric operation get <operation-id>` |
| Follow an Operation | `rfabric operation follow <operation-id>` |
| Cancel an Operation | `rfabric operation cancel <operation-id>` |
| Recent activity | `rfabric workspace activity <workspace-id> [--entity-type <type>] [--actor <user-id>]` |
| Search a workspace | `rfabric search "<expression>" --workspace <workspace-id-or-slug>` |
| Search the organization | `rfabric search org "<expression>"` |
| Rate limits | `rfabric limits ls` |
