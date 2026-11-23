---
name: member-access
description: >-
  Each member holding exactly the intended access, with proof - who has which role and reaches which workspace, why a member can or cannot do something, deny rules, teams and custom roles, memberships that expire, offboarding with a leaving report, forced sign-out, access reviews, second factor and password length. Use when the user asks who has access, "why can't X do Y", to restrict or remove someone's access, make access expire, offboard a member, sign someone out everywhere, or review access. Not for workspaces and settings: that is `workspace-setup`.
---

# Member access

The user ends up knowing what each person can do and why, with the changes they asked for applied and verified.

- **Member** (`mbr_...`): one person's membership of the Organization: a role, an optional workspace restriction and an optional expiry. The person is a user (`usr_...`).
- **Role**: a named set of permissions, built in or custom to the organization. A permission is `resource:action`, for example `dataset:upload`.
- **Team** (`team_...`): a group that adds its role and its workspaces to every member of it.
- **Deny rule** (`dnr_...`): removes one permission from a user or from everyone holding a role, whatever else grants it.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | See who has access now | agent | `introspect.whoami`, `membership.members`, `membership.list-teams` | none |
| 2 | Explain what one member can do | agent | `security.inspector`, `security.roles-built-in`, `security.list-deny-rules` | none |
| 3 | Change it | agent, user decides how | `security.create-deny-rules`, `membership.create-teams-members`, `membership.members-expiry` or `membership.members-offboard` | the change reaches the person with their next access token, at most 15 minutes later |
| 4 | Verify and report | agent | the reads of steps 1 and 2 | none |

Other jobs, each its own section: teams and custom roles, access that expires, offboard a member, sessions and forced sign-out, access review. To see who signs in with a second factor and have members add one, or to set the minimum password length, read `sign-in-policy.md` in this skill's directory.

## Before you start

- **Permissions**: changes are an `owner`'s or `admin`'s job: check `orgRole` in `introspect.whoami` before you offer one. Any member can read the member and team lists.
- **Needs**: an organization with its members (`workspace-setup`).
- **Organization**: work only in the organization of this connection (`org` in `introspect.whoami`). Where an operation takes `organizationId`, pass exactly that id, and take every user id, role name and team id from this organization's own lists.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Who | the person or role to act on | name or email; resolve it in `membership.members` |
| What should change | picks the row of Decisions | propose the smallest change that does it |
| End date | access that expires | none by default |

## Decisions

A member's own `role` and `workspaceIds` are set when they join. From then on access changes in these ways:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Deny rule on the person (recommended to narrow) | one person must lose one permission | overrides their role and teams until the rule is deleted |
| Deny rule on a role | everyone with that role must lose one permission | applies to every holder, through their own role or a team |
| Team membership | the organization has a team whose role and workspaces fit | adds the team's permissions; the team's workspaces join the member's list (see Teams) |
| Expiry | access should end on a date | the member is offboarded automatically on that date |
| Offboard | the person leaves | ends at once, cannot be reversed |

## Steps

### 1. See who has access now

1. `introspect.whoami`: the organization id (`org`), the user's own id (`sub`) and role (`orgRole`).
2. `membership.members`: every member with `id` (the membership), `userId`, `email`, `role`, `workspaceIds`, `expiresAt`, `twoFactorEnabled` and `teams`.
3. `membership.list-teams`: each team's `role`, `workspaceIds` and `members`.

Two ids name a member and they are not interchangeable: `id` (`mbr_...`) for expiry, `userId` (`usr_...`) for everything else.

Which workspaces a member reaches:

| Member | Reaches |
| --- | --- |
| role `admin` | every workspace |
| own `workspaceIds` and those of all their teams are empty | every workspace |
| anyone else | the workspaces in their own `workspaceIds` plus those of their teams |

Give the user one table: name, email, role, workspaces reached, teams, expiry, second factor on or off.

### 2. Explain what one member can do

Built-in roles, widest first. `security.roles-built-in` returns the exact permissions of each; quote from it when the user asks what a role includes.

| Role | In short |
| --- | --- |
| `owner` | everything, including deleting the organization |
| `admin` | administers the organization; cannot delete it |
| `operator` | runs robots: teleoperate, intervene, update fleets, curate datasets |
| `member` | reads most things; uploads datasets, labels, launches training and evaluation jobs |
| `auditor` | reads the audit log, compliance and security |
| `trainer`, `grader`, `annotator`, `reviewer` | one task each: coaching markup on interventions, evaluation grading, annotation labeling, annotation review |

`security.list-roles-custom` with `query` `organizationId` lists the organization's own roles with their `permissions`.

`security.inspector` with `query` `userId`, `organizationId` and optionally `workspaceId` evaluates the member's own role and the deny rules:

| Field | Meaning |
| --- | --- |
| `role`, `workspaceIds` | the membership itself |
| `permissions` | what the role grants after deny rules |
| `allGrants` | every permission with `granted`; a refused one has `absentReason`: the role does not grant it, or a deny rule removes it (with the rule's reason) |
| `workspaceAccess` false | the workspace asked about is not in the member's own `workspaceIds` |
| `breakGlassActive` | an emergency elevation is in force |

The inspector does not add what teams grant. For a member with teams, add each team's role (its permissions from `security.roles-built-in` or `security.list-roles-custom`) and workspaces yourself.

**"Why can't X do Y".** Find the permission Y needs: the refusal the person saw names it ("Missing grant `resource:action`"), or the operation's description does. Then:

| Finding | Cause | Smallest fix |
| --- | --- | --- |
| `absentReason` starts "Deny rule" | a deny rule removes it | `security.list-deny-rules`; delete the rule if it is no longer intended |
| the role does not grant it, and no team of theirs does | the role is too narrow | add them to a team whose role grants it |
| the workspace is outside what they reach (step 1) | restricted to other workspaces | add them to a team whose `workspaceIds` include it |
| granted, and the workspace is reached | access is in place | the change may be newer than their token: it applies within 15 minutes; otherwise the refusal has another cause, read its message |

When no team fits, report that the member's role does not include the permission. This skill has no step that changes a member's own role or workspace list.

### 3. Change it

Say before each call who is affected and from when. Every change below reaches a person with their next access token, at most 15 minutes later.

**Deny rule.** `security.create-deny-rules`:

```json
{
  "organizationId": "org_...",
  "subjectType": "user",
  "subjectId": "usr_...",
  "resource": "dataset",
  "action": "upload",
  "reason": "Contract covers labeling only"
}
```

- `subjectType` `role` takes a role name as `subjectId` and applies to every holder: name them from step 1 first.
- `resource` and `action` must exist: take them from `security.roles-built-in`.
- Give a `reason`: it is what the inspector shows and what the next administrator reads.
- `security.list-deny-rules` with `query` `organizationId` lists the rules in force. `security.delete-deny-rules` with `pathParameters` `ruleId` lifts one; `deleted` false means no rule in force had that id.

**Team, expiry, offboard**: the sections below.

### 4. Verify and report

Read again: `security.inspector` for a deny rule (the permission shows `granted` false with the rule's reason), `membership.list-teams` for a team change, `membership.members` for expiry and offboarding. Report per person: what they could do before, what they can do now, and from when.

## Teams and custom roles

These steps apply when `membership.list-teams` returns teams.

| Goal | Operation |
| --- | --- |
| Give a member a team's access | `membership.create-teams-members` with `pathParameters` `teamId`, `userId` |
| Take it away | `membership.delete-teams-members` with the same `pathParameters` |
| Change what a team grants | `membership.update-teams` with `pathParameters` `teamId` and body `role` and/or `workspaceIds` |
| Remove a team and the access it gave to all | `membership.delete-teams` with `pathParameters` `teamId` |

- A team adds: the permissions of its `role` come on top of the member's own.
- A team's `workspaceIds` join the member's list; a team with none adds none. A member who reached every workspace (no list of their own) is limited to the team's workspaces from then on, unless their role is `admin`. Check step 1's table for the person before adding them, and say so.
- Changing or deleting a team changes every member of it. Name them before the call.

A custom role takes effect through a team: set it as the team's `role`.

| Goal | Operation |
| --- | --- |
| Create a role | `security.create-roles-custom` with `organizationId`, `roleName`, `permissions` |
| Replace its permissions | `security.update-roles-custom`: the whole map is replaced, not merged |
| Delete it | `security.delete-roles-custom` with `query` `organizationId` |

`permissions` maps a resource to its actions:

```json
{ "dataset": ["read", "upload", "curate"], "robot": ["read"] }
```

- Every resource and action must exist. Start from the closest built-in role in `security.roles-built-in` and remove.
- Show the user the full map before creating or replacing a role.
- Before replacing or deleting, find who holds it: the teams in `membership.list-teams` whose `role` is this name, and `security.roles-custom-usage` for members holding it as their own role. Deleting a role a team still names takes those permissions from the team's members.

## Access that expires

`membership.members-expiry` with `pathParameters` `memberId` (the member's `id`, `mbr_...`) and body `{"expiresAt": "<ISO date-time>"}`; `null` clears it.

Tell the user: on that date rFabric offboards the member by itself, within minutes, exactly as in the next section: sessions ended, membership removed, not reversible. Clearing or moving the date before it passes is the only undo.

## Offboard a member

Offboarding removes a person from the organization in one action.

| What happens | Detail |
| --- | --- |
| At once | all their browser sessions end and all their CLI and agent sign-ins are revoked, also the ones they use for other organizations: they sign in again there |
| Removed | the membership and every team membership in this organization |
| Kept | what they created, and their name on it |
| Undo | none |

1. **Check.** Never offboard the user themself or the last `owner`: read `membership.members` first.
2. **Confirm with the user**: the person by name and email, and the table above.
3. **Offboard.** `membership.members-offboard` with `pathParameters` `userId`.
4. **Read the result.** `status` is `complete` or `partial`. `leavingReport` lists what the person created that keeps working without them:

| In `leavingReport` | What to do |
| --- | --- |
| `serviceCredentials` | keys used by CI and services: rotate or revoke each, or hand it to an owner (`ci-integration`) |
| `robotCredentials` | credentials of robots they enrolled: keep while the robot stays in service |

5. **If `partial`**: `errors` names the step that failed, and access may not be fully ended. rFabric retries a partial run every 5 minutes, up to 5 attempts; `membership.offboarding-runs` shows each run's `status` and `attempts`, and `membership.offboarding-runs-retry` with `pathParameters` `runId` retries one now.
6. **If urgent** (a dispute, a lost laptop): also call `security.invalidate` with their `userId`. Tokens already issued stop working at once instead of within 15 minutes.

## Sessions and forced sign-out

| Goal | Operation | Effect |
| --- | --- | --- |
| The user's own sessions and sign-ins | `sessions.list` | `sessions` are browsers; `deviceAuthorizations` are CLI and agent sign-ins, this conversation's connection among them |
| End one of the user's own browser sessions | `sessions.delete` with `pathParameters` `sessionId` | that browser signs in again |
| Revoke one of the user's own CLI or agent sign-ins | `sessions.devices` with `pathParameters` `authorizationId` | that client signs in again; the user's other CLI and agent sign-ins also ask for a new sign-in once their access token expires |
| End all sessions of a member | `sessions.revoke-all` with body `{"userId": "usr_..."}` | every browser session ends, every CLI and agent sign-in is revoked; tokens already issued work up to 15 minutes more |
| Cut a person, service or robot off at once | `security.invalidate` with `userId`, or `actorId` and `actorType` (`user`, `service`, `robot`), and a `reason` | every token stops working immediately; they authenticate again |
| Check a forced invalidation | `security.revocation` with `pathParameters` `actorType`, `actorId` | `invalidated` true and `invalidatedAt`, for 15 minutes after the call |

- On the user themself, `sessions.revoke-all`, `sessions.devices` on this connection and `security.invalidate` end your own access mid-task. Say so and do it last.
- `security.invalidate` on a `service` stops the CI jobs and integrations using that credential; on a `robot` it makes the robot authenticate again. Name what is affected before the call, and use it only on ids from this organization.
- `security.audit` with `query` `organizationId` lists identity events (role and team changes, expiry, offboarding, forced invalidation), newest first, with `actorId`, `subject` and `createdAt`: the record of what was done.

## Access review

A review asks, for every member, "is this access still needed". The person responsible decides it in the rFabric app, where each decision is recorded under their name. Prepare it, hand over, then verify.

1. **Prepare.** Give the user step 1's table and mark what looks wrong: an `owner` or `admin` who does not need it, every workspace for someone who works in one, no second factor (`sign-in-policy.md`), no expiry on a contractor. Read the organization's `slug` with `organizations.get` for the link.
2. **Hand over.**

```text
Your turn - rFabric app
Why: each decision is recorded under your name as review evidence.
Who: an owner or admin of the organization.

1. Open https://app.rfabric.io/<organization slug>/settings/compliance
2. In "Access reviews" choose "New review". Enter a Name, pick the day it is Due, choose "Start review".
   The review lists every member under "To decide".
3. For each person choose "Certify" (keep) or "Flag" (remove).
   "Flag" asks you to confirm: flagging starts offboarding, and the person loses access at once. It cannot be undone.
4. When "To decide" is empty, choose "Complete and export". The review closes and its evidence file downloads.

Creates: one access review with a decision per member, and its evidence file on your computer.
Bring back: who you flagged.
Then I: confirm they are gone and list the credentials they left behind.
```

3. **Verify.** `membership.members` no longer lists the flagged people; `membership.offboarding-runs` shows a run for each (`targetUserId`) with `status` `complete`. Treat a `partial` run as in "Offboard a member".

## Problems

Membership and session operations answer errors as `{"error": "<code>", "message": "..."}`; role and deny rule operations put the reason as text in `error`.

| Signal | What it means | Do |
| --- | --- | --- |
| 401 `authentication_required` | the connection is not a person with an active organization | check `introspect.whoami` |
| 403 `permission_denied` | the user is not an `owner` or `admin`; or the person named is not a member of this organization; or, on `sessions.delete`, the session is not one of the user's own | check `orgRole`, the `userId` in `membership.members`, the ids in `sessions.list` |
| 400 "Unknown resource" or "Unknown action" | a permission name in a role does not exist | take names from `security.roles-built-in` |
| 400 "Invalid deny rule target" | the `resource` and `action` pair does not exist | take the pair from `security.roles-built-in` |
| 400 "Custom role not found" | no custom role of that name in this organization | `security.list-roles-custom` |
| 400 "Role is assigned to ... members" | members hold the role as their own | `security.roles-custom-usage`; delete only after the user decides what those members keep |
| 404 `member_not_found` | a `usr_...` id was sent where the membership `id` is needed | use `id` (`mbr_...`) for expiry |
| 404 `team_not_found`, `authorization_not_found` | wrong id, or it is not this organization's or this user's | list again and take the id from there |
| 404 `run_not_found` | wrong id, or the run is not `partial` | `membership.offboarding-runs` |
| `status` `partial` after offboarding | one step failed; access may not be fully ended | `security.invalidate` now, then retry the run and report `errors` |
| `security.inspector` returns only `error` | the person is not a member of this organization | find them by email in `membership.members` |
| "Access reviews" shows no "New review" | the person signed in is not an `owner` or `admin` | an owner or admin does the step |

## Done when

- [ ] The user has the table of members with role, workspaces reached, teams, expiry and second factor, from `membership.members` and `membership.list-teams`.
- [ ] A question about one person was answered from `security.inspector` plus their teams, with the reason.
- [ ] After a deny rule: `security.list-deny-rules` shows it and `security.inspector` shows the permission refused with its reason.
- [ ] After a team change: `membership.list-teams` shows the intended `role`, `workspaceIds` and members.
- [ ] After an expiry: `membership.members` shows `expiresAt`, and the user was told what happens on that date.
- [ ] After offboarding: the person is absent from `membership.members`, the run in `membership.offboarding-runs` is `complete`, and the user has the list of credentials the person left.
- [ ] After a forced invalidation: `security.revocation` showed `invalidated` true.
- [ ] After an access review: the user said who they flagged, and the membership reads match.
- [ ] The user was told what each change means for the people affected, and from when.

## Next

- `ci-integration`: rotate or reassign the service credentials a leaver created.
- `audit-review`: the full record of who did what.
- `workspace-setup`: workspaces, and settings locked for everyone.
- `workspace-status`: back to what needs attention.

## The rfabric CLI

`--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| Who the user is | `rfabric auth whoami` |
| Members, teams | `rfabric auth members list`, `rfabric auth teams list` |
| Roles | `rfabric role list`, `rfabric role usage <name>` |
| Create, replace a role | `rfabric role create <name> --permission <resource>:<action>[,<action>...]`, `rfabric role update <name> --permission <resource>:<action>[,<action>...]` |
| Offboard | `rfabric auth members offboard <user-id>` |
| Sessions | `rfabric auth sessions list`, `rfabric auth sessions revoke-all [--user <user-id>]`, `rfabric auth sessions revoke-device <authorization-id>` |
| Force sign-out | `rfabric security invalidate --user-id <user-id> --reason "<why>"` |
| Identity audit | `rfabric security audit [--limit <n>]` |
