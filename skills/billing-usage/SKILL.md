---
name: billing-usage
description: >-
  A clear picture of what rFabric costs, why, where it is heading, and the controls to keep it in bounds. Use when asked about the bill, spend or usage by workspace, project, fleet or robot, a forecast, quota or "quota exceeded", a quota lift, compute or storage usage, a rise in spend, credits, an invoice or one of its charges, a dispute, what a job will cost, exporting usage records, or changing or cancelling the plan. Not for creating compute capacity: that is `compute-setup`.
---

# Billing and usage

The user ends up knowing what they spend and on what, what the period will cost, how close they are to their limits, and with a quota lift or a plan change in place when they decide so. Entities:

- **BillingAccount** (`ba_...`): who pays; owns one or more Organizations, their Subscription, Invoices and Credits.
- **Subscription** (`sub_...`): joins the billing account to a **Plan** (`pln_...`), which prices usage and sets limits.
- **UsageEvent** (`ue_...`): one metered fact (a quantity of one billable metric, in one Workspace).
- **Invoice** (`inv_...`) with **InvoiceLineItem**s (`ili_...`): the charges of one period.
- **Credit** (`crd_...`): prepaid, promotional or refund balance that invoices consume.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

Each row is one job. Step 1 always; then the jobs the request names.

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Find the account and its state | agent | `introspect.whoami`, `billing-accounts.list`, `billing.overview-by-organization` | none |
| 2 | Explain where spend goes | agent | `billing.cost-query`, `billing.showback`, `billing.robot-economics`, `billing.usage-aggregation`, `usage-events.list` | none |
| 3 | Read compute and storage usage | agent | `workspaces.compute-quota-usage`, `storage-usage.summary`, `storage-usage-snapshots.list` | none |
| 4 | Say where the period is heading | agent | `billing.invoice-preview-by-organization`, `billing.forecast-by-organization`, `billing.cost-query` | none |
| 5 | Check limits, lift a quota | agent, user decides | `billing.quota-state-by-organization`, `billing-entitlement-overrides.list`, `billing.quota-lifts` | none |
| 6 | Price a job before it runs | agent | `billing.cost-preview` | none |
| 7 | Explain an invoice, credits, dispute a charge | agent, user decides | `invoices.list`, `invoice-line-items.list`, `billing.invoice-line-items-explanation`, `billing.credits-balance-by-organization`, `billing.disputes` | rFabric reviews a dispute |
| 8 | Export usage records | agent | `usage-events.list`, `invoice-line-items.list`, `storage-usage-snapshots.list` | none |
| 9 | Change plan or billing details | agent, user decides | `billing.subscriptions-change-plan`, `billing.subscriptions-cancel`, `billing-accounts.update` | none |

## Before you start

- **Permissions** (`introspect.whoami` shows what the user holds):

| To | The user needs | Built-in roles |
| --- | --- | --- |
| See usage of a Workspace, quota state, the overview without money | `billing:readUsage` | owner, admin, member |
| See costs across the Organization, invoices, credits, previews, showback; lift a quota | `billing:administer` | owner, admin |
| Read a Workspace's compute quota | `compute:read` | owner, admin, operator, member, auditor |

  Without `billing:administer`, the overview returns `creditSummary` null, `invoices` empty and `paymentStatus` null. Say that the user cannot see financial data; do not report "no invoices".
- **Needs**: an Organization (`workspace-setup`). Prices, previews and forecasts need an active Subscription; usage is recorded without one. A quota lift above twice the plan limit: rFabric grants it; ask your rFabric contact before you start.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| The question, and the period it is about | every figure is for a period | default: the current calendar month in UTC, which is the period rFabric uses for quotas and previews; say which period you used |
| The slice: Workspace, project, fleet, robot or metric | decides `sliceBy` | default `metric` for "what", `workspace` for "who" |
| For a plan change: the target plan's id (`pln_...`) | customers cannot list plans | the user asks their rFabric contact for it |

## Reading the numbers

- Money is a string of cents in a field ending in `Cents`, in the billing account's `currency`. Show it as currency: `"308880"` with `USD` is 3,088.80 USD.
- Quantities are decimal strings in the metric's unit. Never add quantities of different metrics: only costs add up.
- A period is `periodStart` (inclusive) to `periodEnd` (exclusive), ISO 8601 in UTC.
- Give every figure with its period and one of these labels, in the same line:

| Figure from | Label | Period to name |
| --- | --- | --- |
| `billing.cost-query`, `billing.showback`, `billing.robot-economics` | estimate: usage priced at the plan's rates | the `periodStart` and `periodEnd` you sent |
| `billing.invoice-preview-by-organization`, a `draft` Invoice | estimate, non-binding: the running period so far | the response's `periodStart` to now |
| `billing.forecast-by-organization`, `projectedEndOfPeriodTotalCents` | projection | the response's whole period |
| `billing.cost-preview`, storage `projectedMonthlyCostCents` and `estimatedCostCents` | estimate | per month (snapshot: its `snapshotAt` day) |
| An Invoice that is `finalized`, `sent`, `paid` or `overdue`, and its line items | invoiced | the Invoice's period |
| `billing.usage-aggregation`, quota state, compute quota | measured quantity, no money | the period sent; quota: until `resetAt`; compute: the month to date |

- Payment data stays out of the conversation: never ask for or accept a card number or bank details. Paying an Invoice is between the user and rFabric.

## Decisions

When a limit is reached (step 5):

| Option | Choose when | Consequence |
| --- | --- | --- |
| Wait for the reset | the work can wait until `resetAt` | no cost; work on that metric stays refused until then |
| Lift the quota | a temporary peak, up to twice the plan limit | applies at once until `expiresAt`; the extra usage is metered and priced by the plan like any other |
| Change the plan | the higher level is the new normal | changes the bill from `effectiveAt`; prorated in the period |

When cancelling the Subscription (step 9):

| Option | Choose when | Consequence |
| --- | --- | --- |
| At the end of the period (recommended) | the user leaves or pauses | paid features stay until `currentPeriodEnd`; then the free plan and its limits apply |
| Immediately | the user insists | the free plan applies now; work above its limits is refused at once |

## Steps

### 1. Find the account and its state

1. `introspect.whoami` for the Organization (`org`); `billing-accounts.list` for its billing account: `name`, `email`, `currency`, `taxId`, `billingAddress`, plus `paymentTerms` and `dunningState`.
2. `billing.overview-by-organization` (`pathParameters` `organizationId`): `plan`, `subscription`, `usageMetrics` (per metric `quantity`, `includedUnits`, `progressPercent`), `creditSummary`, the latest 12 `invoices`, `paymentStatus`, `workspaceCount`.

Tell the user in three lines: plan and Subscription `status`, usage against what the plan includes, and payment state.

| Field | Value | Say |
| --- | --- | --- |
| `plan`, `subscription` | null | no active Subscription: usage is recorded, costs read as 0, previews and forecasts are unavailable |
| Subscription `status` | `trialing` | on trial until `trialEnd`; the free plan applies after it unless a plan is chosen |
| | `active` | running; `cancelledAt` set means it ends at `currentPeriodEnd` |
| | `past_due` | a payment failed; see Problems |
| `paymentStatus` | `current`, `paid` | nothing owed now |

Several Organizations on one billing account: `governance.billing-accounts-enterprise` (`pathParameters` `billingAccountId`) lists them with aggregate counts.

### 2. Explain where spend goes

| Question | Operation | Notes |
| --- | --- | --- |
| What do we spend on | `billing.cost-query` with `sliceBy` `metric` | one slice per billable metric: `quantity`, `costCents`, `eventCount` |
| Which Workspace, project, fleet or robot spends it | `billing.cost-query` with `sliceBy` `workspace`, `project`, `fleet`, `robot` | usage that names none goes under `unattributed`: report it, it is often the largest surprise |
| Internal chargeback per Workspace | `billing.showback` | one row per Workspace and `totalCostCents`; ignore a row's `quantity`, it mixes units |
| Cost per robot of one fleet | `billing.robot-economics` (`fleetId`) | one slice per robot |
| Raw quantities of one Workspace | `billing.usage-aggregation` (`workspaceId`) | per metric: `quantity`, `unit`, `aggregationType`; no prices |
| Which jobs caused it | `usage-events.list` with `workspaceId`, `billableMetricCode` | each event's `properties` name the source: `operationId`, `taskType`, `computeTaskId` |

- With `workspaceId`, `billing.cost-query` needs only `readUsage` in that Workspace; without it, `administer`.
- A slice carries up to 100 `drilldownEventIds`. Open a few with `usage-events.get` to name the jobs behind a cost: "62% of GPU cost came from 3 training runs" is the answer the user wants, not a table of ids.
- Compare with the previous period (same call, earlier `periodStart` and `periodEnd`) whenever the question is "why is it higher".
- `cost-events.list` shows provider costs passed through to the Organization (`provider`, `service`, `costCents`), when the plan bills them.

### 3. Read compute and storage usage

**Compute**: `workspaces.compute-quota-usage` (`pathParameters` `id`, the Workspace) returns the month to date: `gpuSeconds`, `cpuSeconds`, against `gpuHoursPerMonth`, `cpuHoursPerMonth`. Divide seconds by 3600 before comparing. `hardStop` true: once the month's usage plus the estimate of new work passes the quota, new compute work is refused (`422` `quota_exceeded`); false: it is admitted with a warning. The quota is a Workspace setting; `compute-setup` covers changing it.

**Storage**: `storage-usage.summary` (`workspaceId`): `totalBytes` split into `rawBytes` and `derivedBytes`, `connectedBytes` (data that stays in the user's own connected storage), `projectedMonthlyCostCents`, the `topDatasets` and a `trend`. `storage-usage-snapshots.list` (`workspaceId`) adds the daily history: `snapshotAt`, `tierBreakdown` per storage tier and `estimatedCostCents`.

Report sizes in GB or TB, the three largest Datasets by name, and the trend in one sentence. To shrink storage, point to `data-governance` (retention).

### 4. Say where the period is heading

| Question | Operation | Notes |
| --- | --- | --- |
| What is the bill so far | `billing.invoice-preview-by-organization` | `label` `non_binding_preview`: `invoiceSoFar`, `projectedEndOfPeriodTotalCents`, `lineItems`; `unavailable` true when it could not be rated |
| What will the period cost | `billing.forecast-by-organization` | `currentTotalCents`, `projectedTotalCents`; `method` `linear_run_rate` over `confidenceBasisDays` days |
| Is spend unusual | `billing.cost-query` for this period and for the previous one | compare `costCents` slice by slice |

- The forecast extends the spend so far in a straight line. With few `confidenceBasisDays`, or work that comes in bursts, say that it is rough.
- Both preview and forecast refresh the period's `draft` Invoice. A `draft` in `invoices.list` is the running period, not a bill.
- For a rise, slice both periods by `workspace` and by `metric` (step 2) and name what grew. With no usage in the previous period there is nothing to compare with: say so instead of "normal".

### 5. Check limits, lift a quota

`billing.quota-state-by-organization` returns one entry per limited metric: `metricCode`, `limit`, `consumed`, `remaining`, `resetAt`, `enforcementMode`, `lifted`.

| `enforcementMode` | At the limit |
| --- | --- |
| `hard` | further usage of the metric is refused: `429` `quota_exceeded`, whose `details` carry `limit`, `consumed`, `resetAt` |
| `soft`, `warn` | not refused; usage goes on being metered and priced by the plan |
| `none` | tracked only |

- Report every entry at or above 90% of its limit (where rFabric itself starts to warn), and when it resets.
- `degraded` true: billing data could not be loaded fully; the figures may be stale. Say so and read again later.
- No entries: no active Subscription, or the plan limits nothing.

Lift (after the Decisions table): `billing.quota-lifts` with `organizationId`, optional `workspaceId`, `metricCode`, `liftedLimit`, `expiresAt`, `reason`. Before the call say: "This raises the limit for <metric> from <limit> to <liftedLimit> until <expiresAt>. The extra usage is priced by your plan." Choose the shortest `expiresAt` that covers the peak. A lift above twice the plan limit is refused (Needs). Verify: the entry shows `lifted` true and the new `limit`; `billing-entitlement-overrides.list` shows the lift (`beo_...`) `active`. A lift ends by itself at `expiresAt`.

The Workspace compute quota of step 3 is a separate limit with its own setting (`compute-setup`). A refusal names which one: `429` from this step's quota, `422` from the compute quota.

### 6. Price a job before it runs

`billing.cost-preview` with `organizationId`, `metricCode` and `projectedQuantityDelta` (the extra units, as a string) returns `projectedMonthlyDeltaCents` and the `pricingModel`. It is a POST that changes nothing; the host may still ask the user to approve it.

- Take `metricCode` from the quota state or from a `billing.cost-query` slice `key`, and its unit from `billing.usage-aggregation`. Compute work is metered as `compute.gpu_seconds` and `compute.cpu_seconds`: 4 GPUs for 2 hours is `"28800"`.
- `unavailable` true with a zero amount: the plan has no price for that metric. Report "no price", not "free".
- Add the remaining quota (step 5) and the compute quota (step 3): a job the user can afford may still be refused by a limit.
- The launching skill (`training-run`, `simulation-suite`, `enrichment`, `evaluation-job`) gives the job's own estimate; use this step to turn units into money.

### 7. Explain an invoice, credits, dispute a charge

1. `invoices.list` with `billingAccountId` (always pass it) and optionally `status`. An Invoice moves `draft` -> `finalized` -> `sent` -> `paid`, or `overdue`, `void`, `refunded`. `subtotalCents` minus `creditAppliedCents` plus `taxCents` is `totalCents`. `pdfUrl` is the document; `dueDate` and `paidAt` the payment dates.
2. `invoice-line-items.list` with `invoiceId`: `description`, `quantity`, `unitAmountCents`, `totalCents`; `isPassthrough` true marks a provider cost passed on, with `providerCostCents` and `markupPercent`.
3. For "why this amount": `billing.invoice-line-items-explanation` (`pathParameters` `id`, the line item) returns the metric, `pricingModel`, `quantity`, the `pricingBreakdown` recorded when it was rated, and the `usageEventIds` and `storageSnapshotIds` behind it. Walk the user through it: quantity, what the plan includes, the rate, the result. Open a few usage events to name the work.
4. Corrections recorded against an Invoice after it was finalized: `invoices.list-corrections`.

**Credits**: `billing.credits-balance-by-organization` returns `totalRemainingCents`, each credit (`type` `prepaid`, `promotional` or `refund`, `remainingAmountCents`, `expiresAt`), the `upcomingExpirations` (within 30 days) and the `consumptionHistory` per Invoice. `credits.list` with `billingAccountId` adds `originalAmountCents` and `reason`. Credits apply themselves when an Invoice is finalized, the soonest to expire first. Warn about credits that expire before the period ends.

**Dispute**: when the user says a charge is wrong, first show the explanation of point 3. If they still dispute it, `billing.disputes` with `invoiceLineItemId` and `reason` (their words, with the usage events in question). The Invoice must be `finalized`.

- It opens with status `open`. rFabric reviews it and either grants a `refund` credit (`resolved_credit`) or upholds the charge (`resolved_upheld`).
- Tell the user: the outcome arrives as a credit on the billing account; the disputed Invoice itself is not changed.
- Keep the dispute id (`bdsp_...`) in your report. A `refund` credit in the balance (`billing.credits-balance-by-organization`) shows it was accepted.

### 8. Export usage records

Page the list operation for the period and write a CSV or JSONL file in the working directory:

| Records | Operation |
| --- | --- |
| Usage events | `usage-events.list` (`organizationId` or `workspaceId`, `billableMetricCode`); it has no period filter, so keep the rows whose `timestamp` is in the period |
| Invoice line items | `invoice-line-items.list` (`invoiceId`) |
| Storage snapshots | `storage-usage-snapshots.list` (`workspaceId`) |
| Costs per slice | `billing.cost-query`, `billing.showback` |

Read every page (`limit` up to 200), tell the user the row count and the file path, and keep the ids so finance can reconcile.

### 9. Change plan or billing details

**Plan change**: `billing.subscriptions-change-plan` (`pathParameters` `id`, the `sub_...` from step 1; body `planId`, optional `effectiveAt`, now when omitted). Before the call say which plan replaces which, from when, and that the period is prorated across both plans. It changes the bill: this is the user's decision, never a default. Verify with `billing.overview-by-organization`: `plan` is the target; then read the quota state again, since limits change with the plan.

**Cancel**: `billing.subscriptions-cancel` with body `{"immediate": false}` (see Decisions). Before the call say: "Paid features end at <`currentPeriodEnd`> (or now, with `immediate`). Then the free plan and its limits apply, and usage above a `hard` limit is refused." The free plan's limits show in the quota state only after the downgrade: the user confirms them with their rFabric contact first when work depends on them. Verify: `subscription.cancelledAt` is set in `billing.overview-by-organization`.

**Billing details**: `billing-accounts.update` with `name`, `email`, `taxId` or `billingAddress` (`line1`, `line2`, `city`, `state`, `postalCode`, `country`). Read them back to the user after the change; they appear on the next Invoice.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `403` `FORBIDDEN` "Missing grant billing:administer" | the read needs `billing:administer` | name the permission; with `billing:readUsage` only, answer per Workspace with `billing.cost-query` and `workspaceId` |
| `404` `NOT_FOUND` "Subscription not found" on preview, forecast or cost preview | no active Subscription | report usage quantities (step 2) without prices; a plan starts with rFabric |
| `403` on rating a period, finalizing or marking an Invoice paid, granting credits, adjustments, resolving a dispute | rFabric runs these | tell the user what rFabric will do and when the result becomes visible (an Invoice status, a credit) |
| `429` `quota_exceeded` | a `hard` plan limit is reached | step 5 and the Decisions table |
| `422` `quota_exceeded` when launching compute work | the Workspace compute quota with `hardStop` | step 3; raising it is a setting (`compute-setup`) |
| `422` `VALIDATION_ERROR` with `reason` `quota_lift_out_of_bounds` in `details` | the lift exceeds twice the plan limit | lift to at most twice, or change the plan; a higher lift is rFabric's to grant (Needs) |
| `422` "Disputes can only be opened on finalized invoice line items" | the Invoice is a `draft`, or already past `finalized` | for a draft, wait for the Invoice; otherwise the user contacts rFabric with the line item id |
| `422` "Target plan must be active or grandfathered" | wrong or retired `planId` | the user confirms the plan id with their rFabric contact |
| Subscription `past_due`, account `dunningState` `past_due` | a payment is overdue; `dunningGraceDeadline` is when the grace period ends | show the overdue Invoice (`invoices.list` with `status` `overdue`): amount, `dueDate`, `pdfUrl`; the user arranges payment with rFabric, outside this conversation |
| Asked to "apply credits" | credits apply by themselves when an Invoice is finalized | explain it and show the balance; there is nothing to call |

## Done when

- [ ] Every figure names its period, its scope and whether it is an estimate or an invoiced amount.
- [ ] A "why" question is answered with the slices and the jobs behind them, not only totals.
- [ ] A lift shows `lifted` true in `billing.quota-state-by-organization`; a plan change shows in `billing.overview-by-organization`.
- [ ] Before each change to the plan or a limit the user saw what it changes on the bill and decided.
- [ ] No payment data was asked for or shown.

## Next

- `compute-setup`: compute quotas and the capacity that drives compute cost.
- `data-governance`: retention, to bring storage cost down.
- `workspace-status`: what is running now and consuming.
- `audit-review`: who changed a plan or a quota.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Billing account | `rfabric billing-account ls` |
| Invoices and line items | `rfabric invoice ls`, `rfabric invoice-line-item ls` |
| Credits | `rfabric credit ls` |
| Usage events | `rfabric usage-event ls` |
| Any other read | `rfabric api get /api/billing/overview/by-organization/<organization-id>` |
