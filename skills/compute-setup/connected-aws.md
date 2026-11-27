# Connected compute in an AWS account

Read this for step 4 of `compute-setup` when the user's machines should run in their own AWS account. rFabric then starts AWS Batch jobs there through a role the user grants; the user keeps the machines, the GPU quota and the AWS bill. Values in `<angle brackets>` come from `provider-credentials.setup-token` with `query` `{"cloud": "aws", "purpose": "compute", "region": "<region>"}` unless a line says otherwise.

Before the grant, have ready:

- the region (an AWS region such as `eu-west-2`); a grant covers one region;
- a verified storage connection to an S3 bucket in the same account, with write access (`storage-connection`, the hand-built role with `s3:PutObject`): the target keeps task inputs, outputs, checkpoints and logs there, and rFabric signs the workers' transfers with that connection's grant;
- a VPC in that region with private subnets that reach the internet through a NAT gateway: the stack asks for them and creates no network of its own;
- pull access to rFabric's handler images for this AWS account: every job starts one, and the account may pull them only after rFabric grants it, an rFabric operator step at onboarding. Send your rFabric contact the 12-digit AWS account ID before you start; until the grant, jobs fail at the image pull. Running rFabric's own enrichment methods on these machines needs a second grant of the same kind: ask for it too.

## Your turn: create the compute stack

```text
Your turn - AWS console, one page with a few choices
Who: someone who may create CloudFormation stacks with IAM roles, AWS Batch and EC2 resources in the account (an AWS administrator).
     If that is not you, forward this whole block: it holds no secret.
Why: rFabric runs your training, simulation and enrichment jobs on AWS Batch in your account. You keep the machines and the bill; rFabric holds no key.

1. Sign in to the AWS account, then open: <aws.quickCreateUrl>
   The page "Quick create stack" opens in region <region> with the stack name rFabric-Compute-<region>.
2. Leave the group "rFabric connection (prefilled - do not edit)" unchanged.
3. Network: choose the VPC, and "Private subnets" with NAT egress. Workers take no inbound traffic; they call rFabric over HTTPS.
4. Capacity: keep or change "GPU instance types" and "CPU instance types" (empty means no pool of that kind),
   and "Maximum vCPUs per compute environment" (default 256; your EC2 quota bounds it too).
5. Data: "rFabric bucket" = <bucket of the storage connection>; keep "rFabric bucket prefix" (rfabric/) unless you use another.
6. Tick the acknowledgement that AWS CloudFormation might create IAM resources with custom names.
7. Choose "Create stack" and wait until the stack status is CREATE_COMPLETE.

Creates, all in your account:
- one IAM role, <aws.roleName>, that only rFabric's AWS account <aws.rfabricAccountId> can assume, and only with the External ID <externalId>.
  It can submit, describe and stop jobs on the Batch resources of this stack, read service quotas and read the worker log group. It cannot read your data.
- AWS Batch compute environments (Spot and on-demand), job queues and job definitions for the instance types you chose. Idle capacity scales to zero.
  The job definitions mount the host Docker socket: training and simulation run your trainer, simulator and candidate images as separate containers on the machine.
- a worker role limited to the bucket prefix, with no registry permission, a security group with HTTPS-only egress, and a log group for worker logs (kept 30 days).
Cost: you pay AWS for the instances while jobs run. Nothing runs while no rFabric task is waiting.
Undo: delete the stack rFabric-Compute-<region> (CloudFormation, region <region>). Running jobs stop; the role, queues and capacity are removed.

Bring back: the 12-digit AWS account ID the stack was created in, and which instance types you kept.
Then I: check the role, list the capacity it created, and connect the pools you choose.
```

When `aws.quickCreateUrl` is `null`, there is no link to hand over: stop and report it.

## Check and register

Probe (`provider-credentials.probe-grant`):

```json
{ "cloud": "aws", "purpose": "compute", "region": "<region>", "externalId": "<externalId>", "accountId": "<12-digit account id>" }
```

- `assumed` `true` with `discovery.listComputeResources` `true`: the role works and can see its queues.
- Not found after 90 seconds: ask the user for `RoleArn` from the stack's Outputs tab and probe again with its role name as `roleName`.
- `reason` values are those of `storage-connection` (Problems): `not_yet_assumable`, `access_denied`, `invalid_external_id`.
- `invalid_external_id`, or a later session that no longer holds the setup token: the stack already exists with its own External ID. Ask the user for the value of "External ID" on the stack's Parameters tab, then probe and register with that value as `externalId`.

Register (`provider-credentials.create`, needs `compute:administer`):

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "<account id> <region>",
  "cloud": "aws",
  "purpose": "compute",
  "authMethod": "assumeRole",
  "principal": "<principal from the probe>",
  "externalId": "<externalId>"
}
```

## Discover and connect

`provider-credentials.compute-resources` with `query` `{"region": "<region>"}`. On AWS each pool's `key` is its job queue ARN, `backend` is `aws_batch`, and the proposed `taskTypes` follow the pool class: GPU queues are proposed for training and simulation attempts, CPU queues for enrichment and generation.

Training and simulation need the host Docker socket, so a GPU queue is proposed for them only when its job definitions mount it, which the connected stack (the CloudFormation template above, or rFabric's OpenTofu module) provides. A stack without the mount is offered neither, and `compute-targets.connect` refuses such a pool for them (422; the message names the pool). The stack must be updated: the user updates the stack rFabric-Compute-<region> with the current template, whose address is the `templateURL` parameter of `aws.quickCreateUrl`; then call `provider-credentials.compute-resources` again.

`compute-targets.connect`:

```json
{
  "scope": "organization",
  "organizationId": "org_...",
  "name": "aws-<region>",
  "providerCredentialId": "pcred_...",
  "region": "<region>",
  "storageConnectionId": "sc_...",
  "pools": [
    { "key": "<key of a discovered GPU pool>", "taskTypes": ["training.run"] },
    { "key": "<key of a discovered CPU pool>" }
  ]
}
```

- Omit `taskTypes`, `name` and `maxCapacity` of a pool to take what discovery proposed.
- With `scope` `workspace`, add `workspaceId`.
- The credential and the storage connection must be usable from the target's scope and not revoked.

## What the checks prove

`verification.checks[]` of a connected AWS target, all needed for `verified`:

| `name` | Passing means |
| --- | --- |
| `credential` | the compute credential exists, is active and is for this cloud |
| `assume_role` | rFabric can assume the role |
| `batch_describe_queues` | it sees the job queues of the stack |
| `batch_submit_dry` | it can submit a job (a zero-duration job is submitted and stopped at once) |
| `pass_worker_role` | it may hand the worker role to jobs |
| `read_quota` | it can read the account's service quotas |
| `bucket_access` | the storage connection reaches the bucket |

A failing check after a stack change: the user updates the stack, then `compute-targets.verify`.

## Images on this target

- A trainer, simulator or candidate image is pulled by the worker with a short-lived registry sign-in rFabric issues for that one run, as on rFabric's pools: an image in Amazon ECR, this account's own included, or in Google Artifact Registry needs that account or project connected as a container registry; an image on any other registry host must be publicly readable (`compute-setup`, Container registry access).
- An enrichment method's image is the image the machine itself starts: the stack lets the machines pull every repository of this account's own ECR, so it belongs there, referenced by digest.
