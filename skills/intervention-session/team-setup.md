# Operator team setup

Read this when the user sets up who answers intervention requests, or when requests sit in the queue with `routingStatus` `unassigned`. It builds on `SKILL.md` in this directory.

The user ends up with requests routed to the right operators, with time limits, and operators who say when they are available.

| Entity | Id | What it is |
| --- | --- | --- |
| Operator pool | `ivop_...` | a named group of operators and the skill tags they must have |
| SLA config | `ivsl_...` | time limits: until a request is claimed, until it is resolved, until an idle claim is released |
| Routing rule | `ivrr_...` | sends new requests that match its criteria to a pool, under an SLA config |
| Availability | `ivoa_...` | one operator's status, concurrency limit and skill tags |

## At a glance

| # | Step | Who | Operations |
| --- | --- | --- | --- |
| 1 | Read what exists | agent | `intervention-operations.list-operator-pools`, `intervention-operations.list-sla-configs`, `intervention-operations.list-routing-rules`, `intervention-operations.list-staffing-availability` |
| 2 | Create the pool | agent | `intervention-operations.create-operator-pools` |
| 3 | Create the SLA config | agent | `intervention-operations.create-sla-configs` |
| 4 | Create the routing rule | agent | `intervention-operations.create-routing-rules` |
| 5 | Operators set their availability | each operator, in their own session | `intervention-operations.replace-staffing-availability` |
| 6 | Assign and keep the queue healthy | agent | `intervention-operations.staffing-sessions-auto-assign`, `intervention-operations.sweep` |

## Before you start

- **Permissions**: creating pools, SLA configs and routing rules needs access to the workspace. Setting availability, auto-assignment and the sweep need `interventionSession:control` and a signed-in person. Listing availability needs `interventionSession:view`.
- **Confirm before each create**: pools, SLA configs and routing rules cannot be edited or deleted afterwards. Show the user the values and get their agreement first. A wrong routing rule is outranked by a new one with a higher `priorityOrder`.
- **Ask the user**: who is in the team (`membership.members` gives the user ids), which requests they take (by type, priority, robot or skill), and the time limits in seconds. No limit has a recommended value here: they are the team's own targets.

## Steps

### 1. Read what exists

Call the four list operations with `query` `workspaceId`. Show the user the current rules in evaluation order before adding one.

### 2. Create the pool

`intervention-operations.create-operator-pools` with `workspaceId`, `name`, `memberUserIds`, and optional `description`, `requiredSkillTags`, `enabled`.

- With `memberUserIds` empty, auto-assignment considers every available operator of the workspace.
- `requiredSkillTags`: an operator qualifies only when their availability carries every tag.

### 3. Create the SLA config

`intervention-operations.create-sla-configs` with `workspaceId`, `name` and the limits in seconds:

| Field | Limit |
| --- | --- |
| `claimTimeoutSeconds` | a `requested` session should be claimed within this time of the request |
| `resolutionTimeoutSeconds` | a `claimed` session should be resolved within this time of the request |
| `claimAutoReleaseSeconds` | sets `claimAutoReleaseAt` on a routed session; a session still `claimed` after that time loses its claim |

`priorityLevel` (`critical`, `high`, `normal`, `low`) scopes the config to one priority.

Tell the user: the limits are applied each time the sweep of step 6 runs, not at the moment a limit passes.

### 4. Create the routing rule

`intervention-operations.create-routing-rules`:

```json
{
  "workspaceId": "wks_...",
  "name": "Critical corrections to the night shift",
  "priorityOrder": 100,
  "matchCriteria": { "types": ["correction"], "priorityLevels": ["critical", "high"] },
  "operatorPoolId": "ivop_...",
  "slaConfigId": "ivsl_..."
}
```

- `matchCriteria` keys: `types`, `priorityLevels`, `robotIds` (the request's value must be in the list) and `skillTags` (the request must carry every tag). An empty object matches every request.
- Rules are evaluated when a session is requested: highest `priorityOrder` first, then the oldest rule. The first enabled match wins.
- The result is on the session: `operatorPoolId`, `routingStatus` `routed`, and `claimAutoReleaseAt` from the SLA config. A rule without a pool, or no matching rule, leaves the session `unassigned`.
- Routing ranks and assigns. It does not stop another operator with the permissions from claiming the session.

Verify with the next request: read its `routingStatus` and `operatorPoolId`. A test request is a real entry in the operators' queue: make one only when the user agrees, and cancel it afterwards.

### 5. Operators set their availability

`intervention-operations.replace-staffing-availability` sets the caller's own availability, so each operator does it in their own session (their agent, or the queue page of the rFabric app).

- `status`: `available`, `busy`, `away`, `offline`. Only `available` operators are auto-assigned.
- `maxConcurrentSessions`: 1 to 10; 1 when omitted. `skillTags`: empty when omitted. `availableUntil`: optional end of the shift.
- It replaces the whole record: send every field each time.

`intervention-operations.list-staffing-availability` shows the team: who is `available`, with which tags, and `lastHeartbeatAt`.

### 6. Assign and keep the queue healthy

- **Auto-assign one session**: say first that an operator gets a robot they did not ask for and must open the console. Then `intervention-operations.staffing-sessions-auto-assign` with `pathParameters` `id`. For a `requested` session it claims for the first operator who is `available`, in the session's pool, carries the pool's and the session's skill tags, and holds fewer `claimed` and `live` sessions than their limit. The response has `assigned` and the `session`; `assigned` false means the session is not `requested` or nobody qualifies. Tell the assigned operator. Their availability becomes `busy`; they set it back when free.
- **Apply the time limits now**: say first that every operator whose claim is past its release time loses that session (a `live` session is never released). Then `intervention-operations.sweep` with `workspaceId`. It flags sessions past their SLA (`slaBreachedAt` set, `routingStatus` `escalated`), releases claims past `claimAutoReleaseAt` (`claimed` back to `requested`), expires pending proposals past their time and escalates expired ones. It returns the counts `slaBreaches`, `autoReleased`, `expiredProposals`, `escalatedProposals`. Run it before you report on the queue, and report how many claims it released.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| new sessions are `unassigned` | no enabled rule matches, or the matching rule has no pool | compare the session's `type`, `priorityLevel`, `skillTags` and `robotId` with each rule's `matchCriteria` |
| `assigned` false on auto-assign | nobody is `available` with the tags and free capacity, or the session is not `requested` | read `intervention-operations.list-staffing-availability`; an operator sets `available`, or claims by hand |
| 403 naming `interventionSession:control` | the user lacks the permission | name the permission; `member-access` finds why it is missing and what can add it |

## Done when

- [ ] `intervention-operations.list-routing-rules` shows the rule with its pool and SLA config, in the intended order.
- [ ] A request made after the rule carries `routingStatus` `routed` and the pool's id, or the user chose to wait for the next real request.
- [ ] `intervention-operations.list-staffing-availability` shows at least one operator `available` for the pool.
