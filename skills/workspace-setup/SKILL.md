---
name: workspace-setup
description: >-
  An organization and workspace ready for robots, data and compute - workspaces, projects, environments in promotion order, regions, and settings that cascade from organization to workspace to fleet, enforced where the user wants them locked. Use when the user asks to create or rename a workspace, start from a workspace template, add a project, define dev, staging and production, add a region, change or lock a setting, see why a setting has its value, or archive, restore or delete a workspace. Not for who has access: that is `member-access`.
---

# Workspace setup

The user ends up with the structure every other workflow builds on, and with settings whose value and source they understand.

- **Organization** (`org_...`): the tenant; owns workspaces, environments, regions and organization-wide settings.
- **Workspace** (`wks_...`): the isolation boundary; robots, data, models and runs live in exactly one.
- **Project** (`prj_...`): a grouping inside a workspace. It does not separate access.
- **Environment** (`env_...`): a deployment tier of the organization, with a place in the promotion order.
- **Region** (`rgn_...`): a data residency zone the organization defines.
- **Setting**: one key from the catalog of setting definitions (`sdef_...`), with a value at the organization, a workspace or a Fleet (`flt_...`).
- **Workspace template** (`wtpl_...`, versions `wtv_...`): a reusable workspace shape.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | See what exists | agent | `introspect.whoami`, `organizations.get`, `workspaces.list` | none |
| 2 | Create the organization and first workspace (first sign-in only) | user, rFabric app | none | none |
| 3 | Create a workspace | agent | `workspaces.create`, or `workspace-templates.list`, `workspace-templates.list-versions`, `workspace-templates.instantiate` | none |
| 4 | Add projects | agent | `projects.list`, `projects.create` | none |
| 5 | Define environments in promotion order | agent | `environments.list`, `environments.create`, `environments.reorder` | none |
| 6 | Define regions | agent | `regions.list`, `regions.create` | none |
| 7 | Set and enforce settings | agent | `setting-definitions.list`, `workspaces-settings.list-effective`, `workspaces-settings.effective-compare`, `workspaces-settings.bulk-update` | robots that are offline apply a change when they reconnect |
| 8 | Verify | agent | the list and effective-settings reads above | none |

Steps 3 to 7 are independent: do only the ones the user asked for.

## Before you start

- **Permissions**: an organization `owner` or `admin` (`orgRole` in `introspect.whoami`). Setting writes require one of these roles with access to the workspace; compute settings also require `compute:administer`. Archive and deletion are an `owner`'s or `admin`'s call: check the role before you offer them. A 403 names what is missing.
- **Needs**: an organization. A user with none creates it in step 2.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Workspace name | shown everywhere; the slug is derived from it | propose a slug: lowercase letters, digits and dashes |
| Environment names, earliest first | sets the promotion order | common: dev, staging, production |
| Region name and cloud region | residency zone | only when the user has residency needs |
| Setting, value, scope, locked or not | step 7 | read the catalog and current value first, then ask only for the value |

## Decisions

How to split work:

| Option | Choose when | Consequence |
| --- | --- | --- |
| One workspace, several projects (recommended) | one team shares robots and data | everyone with workspace access sees every project |
| Several workspaces | teams, customers or sites must not see each other's data | data, robots and runs do not cross workspaces; settings are managed per workspace; who reaches which workspace is read and narrowed in `member-access` |

How to start a workspace:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Blank (recommended for a first one) | no template fits | empty; configure with steps 4 to 7 |
| From a template version | the organization has a standard shape | projects, fleets, settings, required custom fields and role presets are created together |

Where a setting lives:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Organization (recommended for a default) | the value should hold for all | every workspace and fleet inherits it unless it sets its own |
| Workspace or fleet | one team or one group of robots differs | overrides the level above, unless that level enforces |
| Enforced, at the organization or a workspace | the value must hold everywhere below | nobody can change it at a level below, admins included; conflicting values below are removed (step 7, Enforce) |

## Steps

### 1. See what exists

`introspect.whoami` gives the organization (`org`) and role. `organizations.get` gives its name and slug. `workspaces.list` gives the workspaces with `status` and `sourceTemplateVersionId`. Read before proposing: an existing workspace or project with the same purpose is the answer more often than a second one.

### 2. Create the organization and first workspace

Only for a user who has no organization yet. The app creates the organization, its billing account and first workspace together and makes the user its `owner`; `organizations.create` does not make anyone a member, so do not use it for this.

```text
Your turn - rFabric app
Why: your organization is created with you as its owner, which only you can do while signed in.

1. Open https://app.rfabric.io and sign in. A new account lands on "Create your organization".
2. Organization name: your company or team.
3. URL slug: lowercase letters, numbers and dashes. It appears in every link.
4. First workspace: where your team starts; more can be added later.
5. Choose "Continue".

Creates: one organization, one billing account, one workspace.
Bring back: tell me when you see the workspace.
Then I: read the organization and workspace and continue.
```

Verify with `workspaces.list`. Done when one workspace is `active`.

### 3. Create a workspace

**Blank**: `workspaces.create` with `organizationId`, `name`, `slug` and optionally `description`. `isSandbox` is fixed at creation and cannot be changed later.

**From a template**:

1. `workspace-templates.list` with `query` `organizationId`. A template with `isStarter` true is offered to every organization.
2. `workspace-templates.list-versions` with the template id: every version, newest first, with its `spec` (`settings`, `projects`, `fleets`, `requiredCustomFields`, `rolePresets`). Show the user what the version creates.
3. `workspace-templates.instantiate` with `templateVersionId`, `organizationId`, `workspaceName`, `workspaceSlug`. It is all or nothing: one setting the organization does not allow rolls the whole workspace back. Role presets become custom roles of the organization (`member-access`).

Rename with `workspaces.update`; a changed `slug` keeps old links working through `previousSlugs`.

Done when: `workspaces.list` shows the workspace `active`.

### 4. Add projects

`projects.create` with `workspaceId` and `name`. Projects group missions, datasets, experiments and models. `projects.delete` hides a project and `projects.restore` brings it back.

### 5. Define environments in promotion order

1. `environments.list` with `query` `organizationId`.
2. `environments.create` for each tier with `organizationId`, `name` and `ordinal`: 0 is the earliest tier, higher is closer to production.
3. To change the order, `environments.reorder` with `organizationId` and `orderedIds`, every environment id from earliest to latest.

The order takes effect once the workspace setting `deployment.environmentProgression` is on: a fleet rollout then starts only when the Artifact is active on a fleet of every earlier Environment (`deployment-rollout`). Tell the user this when they order the tiers.

Done when: `environments.list` sorted by `ordinal` reads in the order the user gave.

### 6. Define regions

`regions.create` with `organizationId`, `name`, and optionally `cloudRegion` and `complianceFrameworks`. A Region only names a zone. Pinning a workspace to it, limiting where data may go and reporting on it belong to `data-governance`.

### 7. Set and enforce settings

The same operations exist per level: `organizations-settings.*` with the organization id, `workspaces-settings.*` with the workspace id, `fleets-settings.*` with the fleet id. Pass the id as `pathParameters` `id`, and the setting key as `key` where one setting is addressed.

**Find the setting.** `setting-definitions.list` narrowed by `query` (search text), `category` or `scopeLevels`. A definition gives the `key`, `valueSchema`, `defaultValue`, the `scopeLevels` it may be set at, whether it is `enforceable`, and its `documentation`.

**Read the current value.** `workspaces-settings.list-effective` returns every setting as it applies to the workspace:

| Field | Meaning |
| --- | --- |
| `value` | what applies here |
| `sourceScopeType`, `sourceScopeId` | the level that supplied it; both null means the catalog default |
| `isDefault` | nobody set it |
| `enforced` | the value is locked: no level below the source level can change it |

For one key, `workspaces-settings.effective-compare` shows the value stored at each level of the chain and which one `wins`. Use it to answer "why is this value what it is" and to find the level to change.

**Write.** `workspaces-settings.bulk-update` (or the organization or fleet twin) with one body for all changes; either all apply or none:

```json
{
  "set": [
    { "key": "deployment.requireApproval", "value": true, "rationale": "Release policy" }
  ],
  "clear": ["quality.minEpisodeDurationSec"]
}
```

- `set` writes a value at this level. `clear` removes this level's value so it inherits again.
- The value must match the definition's `valueSchema`; take the shape from there.
- `rationale` is stored in the setting's history. Ask for one sentence.
- Each result has `outcome`: `applied` or `cleared`.

**Enforce.** Add `"enforced": true` to a `set` entry. The definition must be `enforceable`; a fleet cannot enforce.

| Enforced at | Locks the setting for | Who can still change it |
| --- | --- | --- |
| the organization | every workspace and fleet of the organization | an `owner` or `admin`, at the organization |
| a workspace | every fleet of that workspace | an `owner` or `admin`, at that workspace or the organization |

What the lock means, to tell the user before the call:

- Below the enforcing level, nobody can set or clear the setting, admins included: the write is refused with `ancestor_locked`. One exception: a definition with a `tighteningDirection` still accepts a stricter value below.
- Conflicting values that workspaces or fleets hold today are removed, and they take the enforced value at once. Robots receive it like any other change.
- Lifting the lock (`set` the key again at the enforcing level without `enforced`, or `clear` it) does not bring the removed values back. Each is restored from its own history (Undo and review).

1. Send the `set` entry without `confirmSupersede`. When levels below hold a conflicting value, the answer is 409 `CONFLICT`; in `details`, `reason` is `supersede_preview_required` and `affected` lists each value that would be removed, with its `scopeType`, `scopeId` and `value`.
2. Show `affected` to the user as a table: which workspace or fleet loses which value.
3. On their yes, send the same entry again with `"confirmSupersede": true`.

**Robots.** After a change rFabric notifies the robots of the affected fleets; a robot that is offline applies it when it reconnects. `workspaces-settings.robots-config-freshness` lists the robots that have not applied the current configuration (`lagging`); a robot not listed has it.

**Undo and review.** `workspaces-settings.history` shows who changed one key, when and why. `workspaces-settings.restore` with `pathParameters` `key` and `historyId` writes back the value from before that entry. `workspaces-settings.changes-recent` lists the changes at this level over the last 7 days (`query` `days` for more). `workspaces-settings.export-code` returns every explicit value with the effective settings, for review or to reproduce elsewhere.

**Quotas** are settings of category `quotas`. `workspaces-settings.quotas-status` shows consumption against each limit, and whether new work is blocked. A limit of 0 means unlimited.

**Custom settings.** `setting-definitions.create` adds an organization's own setting; its `key` must start with `custom.`. A definition cannot be changed or removed afterwards: agree the key and schema with the user first.

Done when: `workspaces-settings.list-effective` shows the value, its source level and `enforced` as the user intended.

## Workspace templates

| Goal | Operations |
| --- | --- |
| Capture a shape for reuse | `workspace-templates.create` with `organizationId`, `name`, `slug`, `spec` |
| Change a template | `workspace-templates.create-versions` with the full `spec`; earlier versions and the workspaces made from them stay as they are |
| See how a workspace drifted from its template | `governance.workspaces-template-drift` |
| Bring it back in line | `governance.workspaces-template-reapplication`, `governance.workspaces-template-proposals`, `governance.template-proposals-review` |

- To start a `spec` from a real workspace, read `workspaces-settings.export-code` and copy the explicit values into the `settings` of the `spec`.
- Drift, reapplication and proposals take `pathParameters` `{"workspaceId": "wks_..."}`; reapplication takes the body `{}`.
- Drift returns one entry per setting whose effective value differs from the template: `settingKey`, `templateValue`, `currentValue`. An empty list means the workspace matches.
- Reapplication creates one proposal per drifted setting, each `pending`. Nothing changes yet.
- Review each with `pathParameters` `{"proposalId": "trap_..."}` and body `{"decision": "accepted"}` or `{"decision": "rejected"}`. An accepted proposal writes the template's value to the workspace. Show the user the three values and let them decide each one.

## Archive, restore, delete

All four take `pathParameters` `{"workspaceId": "wks_..."}`. They are an `owner`'s or `admin`'s decision.

| Goal | Operation | Body | Result |
| --- | --- | --- | --- |
| Freeze a workspace | `governance.workspaces-archive` | `{}` | `status` `archived` |
| Bring it back | `governance.workspaces-restore` | `{}` | `status` `active` |
| Delete | `governance.workspaces-request-deletion` | `{"confirmationName": "<exact workspace name>"}` | `status` `scheduled_deletion`, `scheduledDeletionAt` 7 days ahead |
| Change your mind | `governance.workspaces-cancel-deletion` | `{}` | `status` `active` |

What each means, to tell the user before the call:

| | Archive | Delete |
| --- | --- | --- |
| Takes effect | at once | read-only at once; deletion date is `scheduledDeletionAt`, 7 days after the request |
| What stops | every change in the workspace is refused, for every member | the same, from the moment of the request |
| What is lost | nothing: everything stays readable | from `scheduledDeletionAt` on, treat everything in the workspace as gone for good: robots, datasets and episodes, models, runs, settings |
| Undo | restore, any time | cancel before `scheduledDeletionAt` |

Prefer archive when the user wants the workspace out of the way but may need its data.

Before a deletion request:

1. Say what is in the workspace: `workspaces.overview` tiles, and `robots.list` and `datasets.list` with `query` `{"workspaceId": "wks_...", "count": true}`.
2. Say the table's Delete column in plain words, with the date. Data that must survive is exported first (`dataset-export`).
3. Ask the user to type the workspace name. Send what they typed as `confirmationName`; never fill it in for them.
4. After the call, read `scheduledDeletionAt` from the response and tell the user the date and that "cancel the deletion" undoes it until then.

Use these operations rather than `workspaces.delete`: they keep the confirmation, the waiting period and the audit record.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 `CONFLICT`, reason `ancestor_locked` in `details` | a level above enforces this setting | `details` names the level (`enforcingScopeType`, `enforcingScopeId`), its value and rationale; change it there, or ask an `owner` or `admin` to. A setting with a `tighteningDirection` still accepts a stricter value below |
| 409 `CONFLICT`, reason `supersede_preview_required` in `details` | enforcing would remove values below | show `affected`, then repeat with `confirmSupersede` true |
| 422 `VALIDATION_ERROR`, "cannot be set at ... scope" | the definition does not allow this level | `details.scopeLevels` lists the levels; set it there |
| 422 `VALIDATION_ERROR`, "failed schema validation" | the value does not match `valueSchema` | read the definition and fix the value |
| 422 `VALIDATION_ERROR`, "is not enforceable" or "Fleet scope cannot enforce" | this setting, or this level, cannot lock | set it without `enforced`, or one level up |
| 404 `NOT_FOUND` naming a setting definition | wrong key | find the key with `setting-definitions.list` |
| 403 `FORBIDDEN`, "is archived and read-only" or "is scheduled for deletion" | the workspace is frozen | restore it or cancel the deletion first |
| 403 on create, update or delete | the organization is not the user's, or their role is not `owner` or `admin` | check `orgRole` in `introspect.whoami`; an `owner` or `admin` does this step |
| 409 `CONFLICT`, "Unique constraint violated" on `workspaces.create` or `workspace-templates.instantiate` | the slug is taken in the organization | choose another slug |
| 422 `VALIDATION_ERROR`, field `isSandbox` | sandbox status cannot change after creation | create a new workspace |
| 422 `VALIDATION_ERROR`, field `confirmationName` | the typed name is not the workspace's exact name | ask the user to type it again |
| 409 `CONFLICT`, "blocked by an active legal hold" | a legal hold covers the workspace | `details.legalHoldId`; release it in `data-governance` first |
| 409 `CONFLICT`, "blocked by an active subscription" | the organization's billing account has an active subscription; nothing was changed | offer archive instead; the subscription (`details.subscriptionId`) is handled in `billing-usage` |
| 422 "Workspace is not scheduled for deletion" | nothing to cancel | read the workspace's `status` |

## Done when

- [ ] `workspaces.list` shows each workspace the user asked for, `active`.
- [ ] `projects.list` shows the projects in the right workspace.
- [ ] `environments.list` shows the tiers in the intended order of `ordinal`.
- [ ] `regions.list` shows the regions.
- [ ] `workspaces-settings.list-effective` (or the organization or fleet twin) shows each changed setting with the intended `value`, source level and `enforced`.
- [ ] For an archive or deletion request, `workspaces.get` shows `archived` or `scheduled_deletion`, and the user was told what stops, what is lost and the date.
- [ ] The user was told what changed for other people: a locked setting and who can still change it, removed values, a frozen workspace.

## Next

- `member-access`: who reaches which workspace, with which role.
- `storage-connection`: connect the buckets data comes from.
- `compute-setup`: choose where training and simulation run.
- `robot-enrollment`: bring the first robot online.
- `data-governance`: residency pins, retention and legal holds on top of the regions defined here.

## The rfabric CLI

`--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| List workspaces | `rfabric workspace ls` |
| Create a workspace | `rfabric workspace create --data '{"organizationId":"<org-id>","name":"<name>","slug":"<slug>"}'` |
| From a template | `rfabric workspace-template list-versions <template-id>`, then `rfabric workspace-template instantiate --template-version <version-id> --organization-id <org-id> --name "<name>" --slug <slug>` |
| Create a project | `rfabric project create --data '{"workspaceId":"<workspace-id>","name":"<name>"}'` |
| Create an environment | `rfabric environment create --data '{"organizationId":"<org-id>","name":"<name>","ordinal":0}'` |
| Reorder environments | `rfabric environment reorder --organization-id <org-id> --ids <env-id>,<env-id>,<env-id>` |
| Create a region | `rfabric region create --data '{"organizationId":"<org-id>","name":"<name>"}'` |
| Find a setting | `rfabric setting-definition ls` |
| Effective settings | `rfabric settings effective --scope-type workspace --scope-id <workspace-id>` |
| Set, clear, enforce | `rfabric settings set <key>=<json-value> [--clear <key>] [--enforce] [--rationale "<why>"] --scope-type <organization\|workspace\|fleet> --scope-id <id>` |
| History of one setting | `rfabric settings history <key> --scope-type workspace --scope-id <workspace-id>` |
| Template drift | `rfabric governance workspace template-drift <workspace-id>` |
| Propose and review | `rfabric governance workspace template-reapplication <workspace-id>`, `rfabric governance workspace template-proposals <workspace-id> --status pending`, `rfabric governance template-proposal review <proposal-id> --decision accepted` |
| Archive, restore | `rfabric governance workspace archive <workspace-id>`, `rfabric governance workspace restore <workspace-id>` |
| Delete, cancel | `rfabric governance workspace request-deletion <workspace-id> --confirm-name "<workspace name>"`, `rfabric governance workspace cancel-deletion <workspace-id>` |
