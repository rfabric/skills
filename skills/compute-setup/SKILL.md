---
name: compute-setup
description: >-
  A workspace with compute to run training, simulation, enrichment and builds on, in rFabric's cloud or in the user's own AWS account or Google Cloud project, with a quota the user chose. Use when the user asks where work runs, wants GPUs or their own cloud account, hits `no_capable_pool`, `target_not_verified`, `quota_exceeded`, `container_registry_not_connected` or `image_access_denied`, needs pools to pull their container images (container registry access), wants to read or set the compute quota, read tasks, attempts or logs, or qualify a pool for gating evaluations. Not for buckets: that is `storage-connection`.
---

# Set up compute

The user ends up with at least one verified place where their workspace's tasks run, a quota they chose, and a way to see what runs there. The entities:

| Entity | Id | What it is |
| --- | --- | --- |
| ComputeTarget | `ctgt_...` | where machines live. `placement` is `managed` (rFabric's cloud), `connected` (the user's AWS account or Google Cloud project, driven by rFabric) or `self_hosted` (machines the user runs) |
| ComputePool | `cpol_...` | one class of machines on a target, with the task types it runs (`taskTypes`) and the size of one machine (`capabilities`) |
| ComputeWorker | `cwkr_...` | a process that claims tasks from a pool |
| ComputeTask, ComputeAttempt | `ctsk_...`, `catt_...` | one unit of work behind an Operation, and one try of it |
| ComputeMachine, ComputeReservation | `cmch_...`, `cres_...` | a machine rFabric started for a pool; the estimate and actual usage of one Operation |
| ComputeQualification | `cqlf_...` | an approved record that a pool's configuration may produce gating evidence |
| ProviderCredential | `pcred_...` | rFabric's access to the user's cloud account for one `purpose`: `compute` (run machines) or `container_registry` (pull images) |

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read what the workspace can run on today | agent | `compute-targets.list`, `compute-pools.list`, `workspaces.compute-quota-usage` | none |
| 2 | Choose where work runs | user decides | none | none |
| 3 | Managed: confirm a pool runs the task type | agent | `compute-pools.list`, `compute-handler-images.list` | none |
| 4 | Connected account: grant, check, discover, connect | grant: user in the cloud console (AWS stack); agent with a shell, otherwise user, for the Google Cloud script. Then agent | `provider-credentials.setup-token`, `provider-credentials.probe-grant`, `provider-credentials.create`, `provider-credentials.compute-resources`, `compute-targets.connect` | the stack or script; then probe every 3 seconds, up to 90 seconds |
| 5 | Make the workspace use the target | agent | `workspaces-settings.replace` | none |
| 6 | Set the compute quota | user decides, agent | `workspaces.compute-quota-usage`, `workspaces-settings.get-effective`, `workspaces-settings.replace` | none |
| 7 | Follow work | agent | `compute-tasks.list`, `compute-attempts.list`, `compute-attempts.logs` | none |

The user often arrives with one need. Go straight to its section; each is usable on its own:

| The user needs | Section |
| --- | --- |
| pools to pull a private image; a launch refused with `container_registry_not_connected` or `image_access_denied` | Container registry access (after the steps) |
| to read or change the compute quota; work refused with `quota_exceeded` | Step 6, Set the compute quota |
| a pool that may produce gating evidence; `pool_not_qualified` | Qualify a pool for gating evaluations |
| to see why a task waits or failed, or its log | Step 7, Follow work |
| to check, drain or cut off a worker on their own machines | Registered workers |
| to disable, resize or remove a target or pool, or end rFabric's access to their cloud account | Change or remove |

## Before you start

- **Permissions**: reading needs `compute:read` (every member); targets, pools, workers, machines, compute credentials and the compute settings need `compute:administer` (built-in roles `operator`, `admin`, `owner`); recording and approving qualifications needs `compute:qualify` (`admin`, `owner`). `introspect.whoami` lists them under `permissions`. A container registry credential needs organization role `owner` or `admin` in the scope it is created for.
- **Needs**: a workspace (`workspace-setup`). A connected target also needs a verified storage connection to a bucket in the same cloud account, with write access (`storage-connection`: the hand-built role on AWS, an object write role on Google Cloud), and on the cloud side a person who may create the stack or run the script: ask who that is before step 4.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| What they want to run | decides the task types a pool must list | training, simulation, enrichment |
| Region, and AWS account ID or Google Cloud project ID | connected account only: a compute grant is made for one region | the region their data and GPU quota are in |
| Monthly GPU and CPU hours | the quota | default: keep the effective values |

## Decisions

**Where work runs.** Recommend `managed` unless the second row applies.

| Option | Choose when | Consequence |
| --- | --- | --- |
| `managed` (recommended) | fastest start; no cloud account of their own needed | nothing to set up; usage counts against the workspace quota and is billed by rFabric |
| `connected` | committed cloud spend or reserved GPUs; data must stay in their account | a cloud administrator creates a stack (AWS) or runs a script (Google Cloud) once per region; the user pays their cloud directly; rFabric holds no key and loses access when the grant is deleted. On AWS, simulation attempts still run on rFabric's managed pools |

**Scope of a new target.** `organization` (default): every workspace can use it. `workspace`: that workspace alone.

## Steps

### 1. Read what the workspace can run on today

1. `compute-targets.list` and `compute-pools.list`. Rows with `scope` `platform` are rFabric's managed capacity offered to every organization; `organization` and `workspace` rows are the user's own.
2. Show one table: pool name, target, `placement`, `status`, `taskTypes`, and from `capabilities` vCPUs, memory, `gpuClass` x `gpuCount`, `maxNodes`.
3. `workspaces.compute-quota-usage`: month-to-date `gpuSeconds` and `cpuSeconds` against `gpuHoursPerMonth` and `cpuHoursPerMonth`, and `hardStop`. Give hours, not seconds.

The user's own pools run these task types, written as the API spells them: `"training.run"`, `"sim.attempt"`, `"simAssetBuild.step"`, `"enrichment.batch"`. Imports, conversions, exports and other platform work always run on rFabric's own pools and need no setup.

### 2. Choose where work runs

Present the Decisions table with what step 1 found. When a managed pool already lists the task type the user needs and they have no reason for their own account, say that nothing has to be set up and go to step 6.

### 3. Managed: confirm a pool runs the task type

Nothing is created. Check in the list of step 1 that an `active` pool with `scope` `platform` lists the task type and is large enough (GPU, memory, `maxRuntimeS`). `compute-handler-images.list` shows the image rFabric runs for each task type (`taskType`, `imageDigest`, `handler`, `version`); customers read it, they do not change it.

### 4. Connected account

Read `connected-aws.md` or `connected-gcp.md` in this skill's directory: each holds the "Your turn" block and the exact bodies. The order is the same:

1. `provider-credentials.setup-token` with `query` `{"cloud", "purpose": "compute", "region"}`. It changes nothing. Call it once and show `externalId` to the user with the block: each call returns another one, rFabric keeps none until the credential is registered, and a later session needs it to finish. One region is one grant; another region is another setup token, stack or script, and credential.
2. The grant. AWS: a "Your turn" block for the user, or the cloud administrator they forward it to (it holds no secret), who creates the stack in the cloud console. Google Cloud: with a shell where the user's `gcloud` is signed in, run the script yourself after the user approves (the cloud file says how); otherwise the same kind of block. Say first what it creates in their account and that they pay their cloud for the machines while jobs run.
3. `provider-credentials.probe-grant` every 3 seconds, up to 90 seconds, until `assumed` is `true`. `discovery.listComputeResources` `false` means the grant cannot see its capacity: discovery will be denied.
4. `provider-credentials.create` with `purpose` `compute`.
5. `provider-credentials.compute-resources` with the credential id and `query` `{"region"}`: `data.pools[]` are the pools rFabric can create on the capacity the grant made, each with `key`, `name`, `capabilities`, `instanceTypes`, `spotPolicy` and proposed `taskTypes`. `data.connectedTarget` not `null` means a target already runs on this credential in this region: do not connect it twice.
6. Show the proposed pools and let the user choose which to connect and for which task types.
7. `compute-targets.connect`: creates the target and the chosen pools and verifies the target in the same call. The response's target carries `status` and `verification.checks[]` (`name`, `ok`, `detail`).

Done when: the target's `status` is `verified`. On `failed`, name each check with `ok` `false` and its `detail` to the user (the cloud file says what each check proves), have them fix the grant, then `compute-targets.verify`.

### 5. Make the workspace use the target

rFabric picks the target for each task in this order: a target or pool the request names (a launch template, a suite, an enricher placement); else the workspace's `compute.defaultTargetId` setting, when one was set; else, when the task reads from a storage connection, a verified target in that connection's cloud and region; else rFabric's managed target. The first one with an `active` pool listing the task type runs it.

So a connected target is used reliably only when it is named or is the default. To make it the workspace's default:

`workspaces-settings.replace` with `pathParameters` `{"id": "wks_...", "key": "compute.defaultTargetId"}` and body `{"value": "ctgt_..."}`. Confirm with `workspaces-settings.get-effective` (`value`, `isDefault`).

Tell the user the effect: tasks of every type the target's pools list now run there, on their cloud bill; a task type none of its pools lists still runs on the next candidate.

### 6. Set the compute quota

The compute quota of a workspace is five settings. Read usage against it with `workspaces.compute-quota-usage`. Read each setting with `workspaces-settings.get-effective` (`value`, `isDefault`, `sourceScopeType`), change one with `workspaces-settings.replace` (`pathParameters` `{"id", "key"}`, body `{"value"}`). Both answer the object itself, without `data`.

| Key | Value | Meaning |
| --- | --- | --- |
| `quotas.computeGpuHoursPerMonth` | integer, default 200 | GPU hours per calendar month (UTC): finished work plus the estimate of work still open |
| `quotas.computeCpuHoursPerMonth` | integer, default 20000 | the same for CPU hours |
| `quotas.computeHardStop` | boolean, default `true` | `true`: work over the monthly quota is refused with `quota_exceeded`. `false`: it is admitted anyway |
| `quotas.computeParallelGpu` | integer, default 8 | GPUs the workspace's running attempts may hold at once |
| `quotas.computeParallelCpu` | integer, default 256 | vCPUs they may hold at once |

- The quota is the user's decision: it bounds what they can be billed (managed) or what runs in their account (connected). State the current value, the usage from `workspaces.compute-quota-usage`, and what the change allows.
- Usage counts the workspace's work on every target.
- When a write is refused or the effective value does not move, the organization's value governs: `workspace-setup` covers how settings combine and who may change them.
- `workspaces-settings.quotas-status` lists every quota of the workspace: `key`, `consumption`, `blocked`, and the limit in force as `effectiveLimitProvenance.value` (0 means unlimited).

### 7. Follow work

Every piece of work is an Operation (`op_...`) with one or more tasks. From an Operation id:

| To learn | Call | Read |
| --- | --- | --- |
| which tasks it has and where they stand | `compute-tasks.list` with `query` `{"operationId"}` | `status` (`blocked`, `claimable`, `running`, `succeeded`, `failed`, `cancelled`), `classification`, `progress`, `computePoolId`, `attemptCount` |
| why a task waits | `compute-tasks.get` | `claimable` with no attempt: no machine has claimed it yet (capacity is starting, or the pool is at `maxCapacity`); `blocked`: it waits for the tasks in `dependsOn` |
| each try | `compute-attempts.list` with `query` `{"computeTaskId"}` | `status` (`claimed`, `running`, `committed`, `expired`, `cancelled`), `classification`, `error`, `executionProvenance`, `usage` |
| the log | `compute-attempts.logs` with `query` `{"tail": 200}` | `lines[]`; `source` `none` means the attempt has no log yet; 503 means the log cannot be read right now |
| the machines of a pool | `compute-machines.list` with `query` `{"computePoolId"}` | `state` (`requested`, `pending`, `running`, `succeeded`, `failed`, `cancelled`, `lost`), `instanceType`, `spot` |
| what it used | `compute-reservations.list` with `query` `{"operationId"}` | `estimateGpuSeconds`, `actualGpuSeconds`, `estimateCostMicros`, `actualCostMicros`, `status` (`reserved`, `settled`, `released`) |

`classification` says how a task or attempt ended: `succeeded`; `product_failure` (the user's code or model failed); `invalid` (bad input); `timeout`; `infra_error` and `preempted` (rFabric retries these); `cancelled`. Report `product_failure` and `invalid` as the user's to fix, with the log tail.

## Container registry access

Pools pull container images: the user's trainer, simulator, enrichment or candidate image. Images are referenced by digest (`<repository>@sha256:<64 hex>`). Where the user's image must be depends on the pool's target (`placement`, in `compute-targets.get`) and on the task type:

| Pool | Task | The image must be in |
| --- | --- | --- |
| rFabric's managed pools | simulation attempts (`"sim.attempt"`): the candidate and the simulator image | a repository that allows pulls without sign-in, or a private repository in an Amazon ECR account or Google Artifact Registry project connected as a **container registry** (below). A private image in any other registry cannot be pulled |
| rFabric's managed pools | training (`"training.run"`): the trainer image | a repository that allows pulls without sign-in, or rFabric's own registry. A private repository of the user is not offered on managed pools in AWS (the target's `provider` `aws` in `compute-targets.get`): rFabric shows no pull statement for Amazon ECR. On managed pools in Google Cloud, a private Google Artifact Registry repository works only where the deployment offers it (step 5) |
| rFabric's managed pools | every other task type (enrichment) | a repository that allows pulls without sign-in. A container registry does not help here |
| pools of a connected AWS target | training, enrichment (simulation attempts stay on rFabric's managed pools) | a repository in that account's own Amazon ECR (the compute stack grants the pull) |
| pools of a connected Google Cloud target | every task type its pools list | that project's Artifact Registry, once the worker service account may read it: one command, in `connected-gcp.md` under "Images on this target" |
| pools of a `self_hosted` target | every task type its pools list | any registry Docker on that host can pull from: the user runs `docker login <registry>` once as the user the worker runs as |

An image that must stay private and is neither a simulation image nor a trainer image on a managed Google Cloud pool that offers the grant (an enrichment method; a trainer on managed AWS pools): run it on a pool in a connected account.

A container registry is a ProviderCredential with `purpose` `container_registry`: a keyless grant (`authMethod` `assumeRole` on AWS, `workloadIdentity` on Google Cloud) through which rFabric checks the images of a simulation launch and the trainer image of a training run before they start, and hands a simulation machine a short-lived sign-in to pull them. Images are never copied out of the user's registry; the grant cannot push or delete.

| # | Step | Who | Operations |
| --- | --- | --- | --- |
| 1 | List the registries the workspace can use | agent | `workspaces-provider-credentials.list` |
| 2 | Choose the scope | user decides | none |
| 3 | Grant read access to the images | AWS stack: user or their cloud administrator. Google Cloud script: agent with a shell; otherwise user or their cloud administrator | `provider-credentials.setup-token` |
| 4 | Check the grant and register it | agent | `provider-credentials.probe-grant`, `provider-credentials.create` |
| 5 | Google Cloud trainer images only, where offered: let rFabric's machines pull the repository | user or their cloud administrator | `provider-credentials.setup-token` |

1. `workspaces-provider-credentials.list`: rows with `purpose` `container_registry`. rFabric matches an image to a registry by its address: the AWS account in an ECR host, the project in an Artifact Registry path. An `active` row for that account (in `principal`) or project (`providerConfig.projectId`) already covers the image: stop and say so. A workspace's own registry wins over the organization's.
2. Decide the scope with the user: `organization` (every workspace) or `workspace`. Creating it needs organization role `owner` or `admin` for that scope.
3. Read `container-registry.md` in this skill's directory for the "Your turn" block and the bodies: `provider-credentials.setup-token` with `purpose` `container_registry` (no `region`), then the stack or the script. It creates one read-only role (AWS) or service account (Google Cloud) in their account, and nothing in rFabric yet.
4. `provider-credentials.probe-grant` until `assumed` is `true` and `discovery.pullImages` is `true`, then `provider-credentials.create`.
5. A private trainer image on rFabric's managed Google Cloud pools also needs the repository to grant read access to rFabric's pull identity, which `provider-credentials.setup-token` (`cloud` `gcp`, `purpose` `container_registry`) names as `gcp.imagePullMember`. When it is null, this deployment does not offer it yet: use a public repository or a pool in a connected account. `container-registry.md`, section "Trainer images", has the block. On managed AWS pools there is no such grant: rFabric does not pull private Amazon ECR trainer images there.

Done when: `provider-credentials.get` shows the credential `active` with `purpose` `container_registry`, and the probe reported `pullImages` `true`. For a Google Cloud trainer image also: the user confirmed the repository grant of step 5. The launch preview's `trainerImage` check (`training-run`, step 4) proves rFabric can read the image; only the first run reaching `running` proves the machines can pull it.

## Qualify a pool for gating evaluations

A gating evaluation accepts simulation results only from a pool configuration with an `approved`, `passed` qualification. Two people are needed: the one who records cannot approve.

1. `compute-qualifications.create`: `computePoolId`, `config` (`workerImageDigest`, `hostImageId`, `gpuClass`, `adapterProfileId`: the exact configuration that was tested; a later task matches only when all four equal its own), `outcome` (`passed` or `failed`) and `evidenceRefs[]` (`kind`, `uri`, `sha256` of each piece of evidence). It starts `recorded`. Records are append-only: a changed configuration is a new qualification.
2. Your turn for a second person with `qualify`: they call `compute-qualifications.approve`. Tell the user who recorded it, so they ask someone else.
3. `compute-qualifications.list` with `query` `{"computePoolId", "status": "approved"}` confirms it. Each pool a gating suite runs on needs its own.

## Registered workers

A pool on machines the user runs has workers they registered. `compute-workers.list` with `query` `{"computePoolId"}` shows each with `status` (`active`, `draining`, `revoked`, `terminated`), `lastHeartbeatAt`, `maxConcurrency` and `conformanceStatus`.

| Goal | Call | Effect to state first |
| --- | --- | --- |
| Check a worker is alive | `compute-workers.get` | `lastHeartbeatAt` within the last 2 minutes means rFabric hears from it |
| Stop taking work, finish what runs | `compute-workers.update` with `{"status": "draining"}` | the worker finishes its attempts and exits; `{"status": "active"}` resumes |
| Replace the credential | `compute-workers.rotate-credential` | returns a fresh credential (`cwk_...`) once; the old one stops working at once, so the user restarts the worker with the fresh one |
| Cut a worker off | `compute-workers.revoke` | the credential stops working and its running attempts are asked to stop; cannot be undone |
| Re-check the target | `compute-targets.verify` | the check `agent_or_worker_heartbeat` passes when a worker of one of the target's pools was heard from in the last 2 minutes |

The rotated credential is a secret shown once: say before the call that it will appear in this conversation, and offer the alternative that the user runs the CLI command in their own terminal (the table at the end). It goes straight into their secret store, never into a file here. Never run that command from your shell: it prints the credential, and its output would enter the conversation.

## Change or remove

| Goal | Call | Effect to state first |
| --- | --- | --- |
| Take a target out of service | `compute-targets.update` with `{"status": "disabled"}` | no new tasks are placed on it; set `pending_verification` and verify to bring it back |
| Stop a pool | `compute-pools.update` with `{"status": "disabled"}` | the pool takes no new tasks |
| Resize a pool | `compute-pools.update` with `maxCapacity` or `taskTypes` | applies to new tasks |
| Delete a pool | `compute-pools.delete` | refused with `pool_has_open_tasks` while tasks are open on it |
| Delete a target | `compute-targets.delete` | the workspace's tasks run on the next candidate target; the cloud-side grant stays until the user removes it |
| End rFabric's access to the cloud account | `provider-credentials.delete`, then the undo line of the cloud file | refused with `credential_in_use` while a target uses the compute credential: delete the target first |

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 422 `no_capable_pool` (`details`: `taskType`, `resourceClass`) | no pool the workspace can use lists that task type at that size | step 1; add the task type to a pool, connect capacity, or pick a smaller resource class |
| 422 `target_not_verified` (`details`: `computeTargetId`, `status`) | the target that should run the task is not `verified` | `compute-targets.verify`, read the failing checks |
| 422 `quota_exceeded` (`details`: `gpuSeconds` or `cpuSeconds`, the monthly limits) | the request's estimate would pass the monthly quota and `hardStop` is on | step 6: the user raises the quota, waits for the next month, or runs less |
| 422 `budget_exceeded` | the request's own budget is below its estimate | raise the budget on the request (the workflow's skill) |
| 422 `platform_task_type_not_allowed` | a pool was given a platform task type | list only the task types of step 1 |
| 400 `compute_resource_not_found` | the pool `key` was not discovered in that region, or discovery is denied (`details.missingPermission`) | call `provider-credentials.compute-resources` again and use its keys; fix the grant |
| 400 `credential_purpose_mismatch` | the credential is not a `compute` credential of that cloud | register one (step 4) |
| 403 `permission_denied` (`details`: `resource` `compute`, `action`) | the user lacks that `compute` action | name the permission; `member-access` finds why it is missing and what can add it |
| 409 `qualification_self_approval` | the recorder tried to approve | a second person approves |
| task `claimable` for long, machines `failed` or none | capacity does not start: the cloud quota for the instance type, a Spot shortage, a worker that cannot reach rFabric | `compute-machines.list` for the pool, relay `state` and `providerState`; on a connected account the user checks their cloud quota |
| 422 `container_registry_not_connected` at a launch | the image's AWS account or Google Cloud project has no container registry the workspace can use | Container registry access: connect it in a scope that covers the workspace |
| 422 `image_access_denied` at a launch | the registry, or the grant of its container registry, refused rFabric read access to the image | the message names the image and the cause; `container-registry.md` has the fix per cloud. A private image in any other registry cannot be pulled by rFabric's managed pools: move it to Amazon ECR or Google Artifact Registry, or make it public |
| 422 `pool_not_qualified` at a launch | a gating evaluation was placed on a pool configuration without an `approved`, `passed` qualification | Qualify a pool for gating evaluations |
| attempt log shows an image that cannot be pulled | the image is not where that pool and task type can pull it | the table in Container registry access: move the image, or run the task on a pool that can pull it |

## Done when

- [ ] `compute-pools.list`: an `active` pool on a `verified` target lists every task type the user wants to run.
- [ ] For a new target: `compute-targets.get` shows `status` `verified` and every check `ok`.
- [ ] `workspaces-settings.get-effective` for `compute.defaultTargetId` names the target the user chose, or the user chose to leave the default.
- [ ] `workspaces.compute-quota-usage` shows the quota the user decided on.
- [ ] The user knows what they pay for, where, what was created in their cloud account, and how to undo the grant.

## Next

- `training-run`, `simulation-suite`, `enrichment`, `sim-asset-build`: start work on the pool. A gating suite needs the pool qualified.
- `simulator-setup`: register a simulator image the pools pull.
- `evaluation-job`: run a replay evaluation on the pool.
- `billing-usage`: what the compute usage costs.

## The rfabric CLI

`rfabric compute-worker rotate-credential` prints a secret once. It is for the user's own terminal on every host: run from your shell, its output would bring the secret into the conversation.

| Step | CLI |
| --- | --- |
| List | `rfabric compute-target ls`, `rfabric compute-pool ls`, `rfabric compute-task ls -f operationId=<id>` |
| Grant | `rfabric provider-credential setup-token --cloud aws --purpose compute --region <region>`, then `rfabric provider-credential probe-grant` with the same flags plus `--external-id` and `--account-id` |
| Discover and connect | `rfabric provider-credential compute-resources <credential-id> --region <region>`, `rfabric compute-target connect --name <name> --credential <credential-id> --region <region> --storage-connection <connection-id> --pool <key>` |
| Verify | `rfabric compute-target verify <target-id>` |
| Logs | `rfabric compute-attempt logs <attempt-id>` |
| Workers | `rfabric compute-worker ls`, `rfabric compute-worker update <worker-id> --field status=draining`, `rfabric compute-worker rotate-credential <worker-id>`, `rfabric compute-worker revoke <worker-id>` |
| Qualify | `rfabric compute-qualification create --data @qualification.json`, `rfabric compute-qualification approve <qualification-id>` |
