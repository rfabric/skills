---
name: alerting
description: >-
  Open alerts triaged and closed - each one read, acknowledged, annotated and resolved, and a summary of how alerts were handled. Use when asked which alerts are firing, what an alert means, to look into, acknowledge, annotate, mark as false positive or resolve an alert, or to review alert volume and response times. Not for fleet health without an alert: that is `fleet-monitoring`.
---

# Responding to alerts

The user ends up with every open alert understood and moved on: acknowledged by a named person, annotated with what was found, and resolved once the cause is gone. Entities:

- **Alert** (`alr_...`): something rFabric detected that needs a person, with its evidence and a timeline of what was done. It goes `firing` -> `acknowledged` -> `resolved`.
- **AlertRule** (`alrr_...`): the rule that raised the alert; it gives the alert its severity.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Find the open alerts | agent | `alerts.list` | none |
| 2 | Read one alert | agent | `alerts.get`, `alert-rules.get` | none |
| 3 | Acknowledge | agent, user decides | `alerts.ack` | none |
| 4 | Record what was found | agent, user says what | `alerts.annotate`, `alerts.false-positive` | none |
| 5 | Resolve | agent, user decides | `alerts.resolve` | none |
| 6 | Review how alerts were handled | agent | `alerts.analytics-summary` | none |

A question about one alert needs steps 1 and 2. Steps 3 to 5 change the alert and put the user's name on it. Step 6 stands alone.

## Before you start

- **Permissions**: access to the workspace of the alert. Among the built-in roles, `owner`, `admin` and `operator` carry every alert action; `member` reads, acknowledges and resolves.
- **Needs**: nothing to set up. Alerts are raised by rFabric.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Workspace | alerts are listed per workspace | `workspaces.list`; ask only when there is more than one |
| Which alert | when several are open | show the list from step 1 and ask; default the most severe, then the oldest |
| What they found | notes and the outcome come from the person who looked | ask before annotating, labelling or resolving |
| For step 6: the period | the summary counts alerts fired since a moment | ask; default the last 30 days, and say which period you used |

## Steps

### 1. Find the open alerts

`alerts.list` with `workspaceId`, `status` `firing` and `sort` `firedAt:desc`; then the same with `status` `acknowledged` for the alerts someone already took. Read every page.

- Filter by `workspaceId`, `status`, `severity`, `alertRuleId` only: another filter is refused (400). Narrow further by reading the pages.
- `severity`: `info`, `warning`, `error`, `critical`.

Show one table, most severe first: title, severity, status, since when (`firedAt`), what it is about (step 2), who has it (`acknowledgedBy`, as a name from `identity.account-display`). No open alert is a result too: say so and stop.

### 2. Read one alert

`alerts.get`. Tell the user, in this order:

1. `title` and `severity`.
2. Since when (`firedAt`) and how often: `occurrenceCount` counts repeats folded into this alert.
3. What it is about (table below), with names instead of ids.
4. What rFabric saw: `evidence`, two or three fields in words, not the JSON.
5. What was already done: `timeline` (who did what, when) and `annotations`.

| The alert is about | How to tell | `evidence` holds | Fix it with | Closed by |
| --- | --- | --- | --- | --- |
| A storage connection that stopped working | `subjectType` `storageConnection`, `subjectId` the connection (`sc_...`) | `connectionName`, `affectedDatasets` (the datasets read through it), `diagnostics` (the failed checks and a `summary`) | `storage-connection`, section "Fix a failed or degraded connection" | rFabric, once the connection passes a check again |
| A shift in the data | `subjectType` `driftMonitor`, `subjectId` the monitor | `dimension` (what shifted), `distance` against `threshold`, `explanation`, `baselineWindow` and `currentWindow` (each with `start`, `end`, `episodes`) | `enrichment`: read the drift findings and decide whether the shift is expected | a person (step 5) |

| `status` | Meaning |
| --- | --- |
| `firing` | raised, nobody has taken it |
| `acknowledged` | someone has it: `acknowledgedBy`, `acknowledgedAt` |
| `resolved` | closed at `resolvedAt`; `resolvedBy` null means rFabric closed it because the condition cleared |

- `alert-rules.get` with the alert's `alertRuleId` gives the rule's `name` and `description` when the user asks what raised it.
- Link: `https://app.rfabric.io/open/<alert id>`.

Done when: the user can say what is wrong, since when, and what it touches.

### 3. Acknowledge

`alerts.ack`. Before the call say: "This marks the alert as yours: everyone who lists alerts sees your name on it."

- It sets `status` `acknowledged` with the user as `acknowledgedBy`, adds a timeline entry and is recorded in the audit log.
- Acknowledge when the user has decided to look into it, not before.
- An alert that is already `acknowledged` or `resolved` is returned unchanged; the first owner stays. Tell the user who has it.
- Notes do not go here. Use `alerts.annotate` (step 4).

### 4. Record what was found

| Finding | Operation | Effect |
| --- | --- | --- |
| Something worth recording | `alerts.annotate` with `note` | adds the note with author and time to `annotations` and the timeline; status unchanged; a note cannot be edited or removed |
| The alert was wrong | `alerts.false-positive` | sets `outcomeLabel` to `falsePositive`; status unchanged; counted in step 6; no operation removes the label |

- Annotate what was checked and what was found as you go: the next person reads the timeline, not this conversation.
- Show the user the note's text before you store it.
- Before labelling, say that the label is permanent and counts in the false positive rate of step 6. Label only on the user's word.
- A false positive still needs step 5: the label does not close the alert.

### 5. Resolve

`alerts.resolve`. Before the call say: "This closes the alert for everyone. It cannot be reopened."

- It sets `status` `resolved` with the user as `resolvedBy` and adds a timeline entry.
- Resolve when the cause is fixed, or right after labelling a false positive. Add the closing note with `alerts.annotate` first, so the reason sits next to the resolution.
- If the condition comes back, rFabric raises a new alert.
- An alert about a storage connection: prefer letting rFabric close it. After the fix, verify the connection (`storage-connection`); a passed verification closes the alert, which confirms that the fix worked.
- An alert about a shift in the data stays open until a person resolves it.

Done when: `alerts.get` shows `resolved`, and `annotations` holds what was found.

### 6. Review how alerts were handled

`alerts.analytics-summary` with `workspaceId` and `since` (an ISO instant). It covers the alerts fired since then, up to now:

| Field | Tells the user |
| --- | --- |
| `volumeBySeverity`, `volumeByRule` | how many alerts, by severity and by rule |
| `topNoisyRules` | the five rules behind the most alerts |
| `falsePositiveRate` | share of alerts labelled `falsePositive`, 0 to 1 |
| `medianAckLatencySeconds` | typical time from firing to acknowledgement; null when none was acknowledged |
| `medianResolveLatencySeconds` | typical time from firing to resolution; null when none was resolved |

- Name rules with `alert-rules.get`. Give times in minutes or hours.
- State the period with every number: "since <date>, <n> alerts".
- With no alerts in the period every number is empty or zero: say there were none, not that response was fast.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `NOT_FOUND` (404) on an alert | the id is wrong or the alert is not in a workspace the user can reach | find it again with `alerts.list` |
| 403 on an alert | the user has no access to that workspace | name the workspace; `member-access` finds why it is out of reach and what can add it |
| The alert is still `firing` after the fix | nobody resolved it | resolve it (step 5) |
| A new alert with the same title right after resolving | the condition still holds | the cause is not fixed: go back to step 2 with the new alert |

## Done when

- [ ] Every alert the user asked about is `acknowledged` or `resolved` (`alerts.get`), or the user chose to leave it and knows its state.
- [ ] Each handled alert has an annotation saying what was found.
- [ ] A false positive carries the label `falsePositive` and is resolved.
- [ ] A review names its period and the number of alerts it covers.

## Next

- `storage-connection`: repair the connection a storage alert names.
- `enrichment`: look into the data behind a drift alert.
- `audit-review`: who acknowledged or resolved which alert, from the audit log.

## The rfabric CLI

They need a signed-in CLI with the workspace set; `--output json` prints what the API returned.

| Step | CLI |
| --- | --- |
| Firing alerts | `rfabric alert ls -f status=firing --sort firedAt:desc` |
| Read an alert | `rfabric alert get <alert-id>` |
| Read its rule | `rfabric alert-rule get <rule-id>` |
| Acknowledge, resolve | `rfabric api post /api/alerts/<alert-id>/ack`, `rfabric api post /api/alerts/<alert-id>/resolve` |
| Add a note | `rfabric api post /api/alerts/<alert-id>/annotate --data '{"note":"..."}'` |
| Mark as false positive | `rfabric api post /api/alerts/<alert-id>/false-positive` |
| Analytics | `rfabric api get "/api/alerts/analytics/summary?workspaceId=<workspace-id>&since=<iso-time>"` |
