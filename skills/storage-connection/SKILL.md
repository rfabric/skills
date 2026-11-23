---
name: storage-connection
description: >-
  A customer bucket (Amazon S3, Google Cloud Storage or an S3-compatible store) connected to rFabric and verified, so data can be imported from it. Use when the user wants to connect a bucket or cloud storage, give rFabric access to S3 or GCS, fix a failed or degraded connection, browse a connected bucket, rotate a storage key, or revoke bucket access. Not for running the import, or importing new data as it lands: that is `dataset-import`. Not for compute in the user's cloud account: that is `compute-setup`.
---

# Connect a storage bucket

The user ends up with a bucket rFabric can read (and write, when they grant it), proven by a verification that names every missing permission. Two entities carry it:

- **ProviderCredential** (`pcred_...`): rFabric's access to one cloud account for one purpose, here `storage`. One credential serves every bucket of that account.
- **StorageConnection** (`sc_...`): one bucket, or one folder of it (`prefix`), reached through one credential.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Find what exists, choose how rFabric gets in | agent, user decides | `workspaces-provider-credentials.list`, `workspaces-storage-connections.list` | none |
| 2 | Grant access in the cloud account | console page: user or their cloud administrator. Cloud CLI commands: agent with a shell; otherwise user or their cloud administrator | `provider-credentials.setup-token` | until the grant is made |
| 3 | Check the grant, register the credential | agent | `provider-credentials.probe-grant`, `provider-credentials.create` | probe every 3 seconds, up to 90 seconds |
| 4 | Pick the bucket and folder | agent, user confirms | `provider-credentials.buckets` | none |
| 5 | Create the connection, wait for verification | agent | `storage-connections.create`, `storage-connections.get` | seconds; a connection still `pending` after 15 minutes is failed by rFabric |
| 6 | Show the user their data | agent | `storage-connections.list-objects`, `storage-connections.health` | none |

Further sections, each usable on its own: Fix a failed or degraded connection, Rotate a secret, Revoke.

## Before you start

- **Permissions**: an organization admin (organization role `owner` or `admin`; `orgRole` in `introspect.whoami`). The rFabric app offers these steps to organization admins only.
- **Needs**: an organization and a workspace (`workspace-setup`). On the cloud side, a person who may create IAM roles (AWS) or IAM resources in the project (Google Cloud). That is often not the user: ask who it is before step 2.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which store | selects the path and the supporting file | Amazon S3, Google Cloud Storage, or S3-compatible (Cloudflare R2, MinIO, Wasabi) |
| AWS account ID (12 digits) or Google Cloud project ID | the grant check needs it | AWS console account menu, or `aws sts get-caller-identity --query Account --output text`; Google Cloud console project picker |
| Bucket and folder | what to connect | AWS and Google Cloud: discovered in step 4, do not ask first. S3-compatible: ask |
| Read only, or read and write | decides the grant | default read only (Decisions) |
| Who runs the cloud step | the block in step 2 goes to that person | the user, or a cloud administrator they forward it to |

## Decisions

**How rFabric gets in.** Recommend the first option of the user's cloud.

| Option | Choose when | Consequence |
| --- | --- | --- |
| AWS: IAM role from the quick-create stack (recommended) | someone can create a CloudFormation stack in the account | no key leaves AWS; read only, on every bucket of the account; deleting the stack ends access |
| AWS: IAM role built by hand | stacks are not allowed, the role must be limited to chosen buckets, or rFabric must write | no key; the user creates the role from the trust policy |
| AWS: access keys | no role can be created in that account | a long-lived key stored in rFabric, to rotate; entered in the rFabric app, never here |
| Google Cloud: workload identity (recommended) | someone can run a gcloud script in the project | keyless; read only, on every bucket of the project |
| Google Cloud: service account key | workload identity federation is not allowed | a key file stored in rFabric, to rotate; uploaded in the rFabric app |
| S3-compatible: access keys | always (the only method) | a key stored in rFabric; entered in the rFabric app |

**Read only, or read and write.** Importing needs read only. rFabric writes to the bucket only when a connected compute target keeps its task data there (`compute-setup`), or when files are created, moved or deleted through the connection. The quick-create stack and the workload identity script grant read only, so write access means the hand-built role, access keys or an extra grant: see the cloud file.

**Scope.** `ownerScope` `organization` (default, what the app creates): every workspace of the organization can use the credential and the connection. `workspace`: that workspace alone; a workspace-scoped connection needs a credential its workspace can use (its own or the organization's).

## Steps

### 1. Find what exists and choose the path

1. `introspect.whoami` for the organization (`org`) and `orgRole`; `workspaces.list` when the workspace is not known.
2. `workspaces-provider-credentials.list` and `workspaces-storage-connections.list` with the workspace id: every credential and connection the workspace can use, its own and the organization's.
3. Decide with the user:
   - The bucket is already connected and `verified`: stop, report it.
   - An `active` credential with `purpose` `storage` exists for the same AWS account or Google Cloud project (`principal` names the account, `providerConfig.projectId` the project): reuse it and go to step 4. One credential serves all buckets of its account; a second grant is not needed.
   - Otherwise present the Decisions and continue.

Then read the file for the user's store, in this skill's directory: `aws.md`, `gcp.md` or `s3-compatible.md`. It holds the "Your turn" blocks for step 2 and the exact bodies for step 3.

### 2. Grant access in the cloud account

For a role or workload identity, call `provider-credentials.setup-token` with `query` `{"cloud": "aws" | "gcp", "purpose": "storage"}` (no `region` for storage). It changes nothing and returns:

- `externalId`: the identifier the grant is bound to. It is not a secret. Each call returns another one and rFabric keeps none until step 3, so call once and show it to the user with the block: a later session needs it to finish.
- `aws`: `quickCreateUrl` (the prefilled stack link), `roleName`, `rfabricAccountId`, `trustPolicySnippet`.
- `gcp`: `setupScript`, `poolId`, `providerId`, `serviceAccountId`, `rfabricAccountId`.

Fill in the "Your turn" block from the cloud file. A block of cloud CLI commands (the AWS role by hand, the Google Cloud script) you run yourself with a shell where that CLI is signed in, as its file says; every other block you hand over. Tell the user:

- The block is complete on its own and holds no secret: when someone else administers the cloud account, they forward it as it is.
- What it creates in their account, what that lets rFabric do, and the undo line. Nothing in the bucket changes.
- Nothing exists in rFabric yet. If the cloud step never happens, there is nothing to clean up.

For access keys, a service account key or an S3-compatible store there is no setup token: the user enters the secret in the rFabric app (the cloud file says where), which registers the credential; continue from step 4 with the credential you then find through `workspaces-provider-credentials.list`.

### 3. Check the grant and register the credential

1. `provider-credentials.probe-grant` with the body from the cloud file. It writes nothing and is safe to repeat: poll every 3 seconds for up to 90 seconds after the user reports back.
   - 200 with `assumed` `true`: `principal` (the role ARN or service account email), `account`, `accountAlias`, and `discovery` (`listBuckets`, `getBucketLocation`: `false` means step 4 cannot list buckets or regions, the grant still works).
   - 409: the body is `{"assumed": false, "reason", "detail"}`. Read `reason` (Problems) and relay `detail`.
2. Tell the user what was reached: "rFabric can assume `<principal>` in account `<account>`".
3. `provider-credentials.create` with the body from the cloud file. Name it after `accountAlias`, else the account or project id. The `id` in the response's `data` is the credential; `status` is `active`.

Done when: `provider-credentials.get` shows the credential `active` with `purpose` `storage`.

### 4. Pick the bucket and folder

`provider-credentials.buckets` with the credential id returns `data[]` (`bucket`, `region`, `alreadyConnected`, `connectionId`, `connectionName`, `connectionPrefix`), and beside it `discoveryDenied` and `missingPermission`.

- Show the list (name, region, already connected) and let the user pick. Never guess a bucket.
- `alreadyConnected` `true`: offer the existing connection, or another folder of the same bucket. Two connections with overlapping folders import the same data twice: say so.
- `discoveryDenied` `true`: rFabric cannot list buckets with this credential (`missingPermission` names the list permission when that is the cause). Ask the user for the bucket name; the rest works the same.
- `region` `null`: the bucket's location is hidden from the credential. Create the connection with `us-east-1` (S3) or `us` (Google Cloud Storage); verification replaces it with the bucket's own region.
- Folder: default the whole bucket. To narrow, pass `prefix` (no leading slash). Every object operation and import of the connection is then confined to it.

### 5. Create the connection and wait for verification

`storage-connections.create`:

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "acme-robot-data",
  "bucket": "acme-robot-data",
  "region": "eu-west-2",
  "prefix": "recordings/",
  "credentialId": "pcred_..."
}
```

- `name` is unique per scope: default the bucket name, with a suffix when taken.
- `provider` is derived from the credential; `endpoint` is for S3-compatible stores only (`s3-compatible.md`).
- With `ownerScope` `workspace`, send `workspaceId` instead of `organizationId`.

The connection starts `pending` and rFabric verifies it on its own: it reaches the bucket, lists it and reads from it with the grant. Poll `storage-connections.get` every 5 seconds.

| `status` | Meaning for the user | Do |
| --- | --- | --- |
| `pending` | verification is running | keep polling; after 15 minutes rFabric fails it with summary `verification_timeout` |
| `verified` | rFabric can reach, list and read the bucket | continue with step 6 |
| `failed` | a check did not pass; nothing was deleted | read `verificationDiagnostics` (Fix a failed or degraded connection, below) |
| `revoked` | the connection was revoked; it cannot be verified again | create another connection |

Done when: `status` is `verified` and `lastVerifiedAt` is set.

### 6. Show the user their data

- `storage-connections.list-objects` with `query` `{"prefix": ""}` returns one level: `folders` and `files` (`key`, `size`, `lastModified`). Show the top level so the user recognises their bucket; go deeper with `prefix`, page with `nextContinuationToken` passed back as `continuationToken`.
- `storage-connections.objects-metadata` reads one object's size, type and time; `storage-connections.list-objects-content` returns its bytes (a large object: tell the size first).
- `storage-connections.health` returns `healthStatus` (`unknown`, `healthy`, `degraded`), `healthConsecutiveFailures` and `affectedDatasets`, the datasets that read through this connection in place. `unknown` is normal for a connection no such dataset uses yet.

Final report: the credential id, the connection id, the bucket and folder, `status` and `lastVerifiedAt`, whether the grant is read only, the undo line of the cloud file, and the page `https://app.rfabric.io/<organization slug>/storage` (`slug` from `organizations.get`).

## Fix a failed or degraded connection

`storage-connections.get`: `verificationDiagnostics` is `{"probes": [...], "summary"}`. Each probe has `probe`, `passed` and, when it failed on a permission, `missingPermission`, `resource`, `policyStatement` (a ready IAM statement for S3, a ready gcloud command for Google Cloud Storage) and `remediation`.

| `probe` | Passing means |
| --- | --- |
| `reachability.head_bucket` | the bucket exists and the grant reaches it |
| `authorization.list_prefix` | the grant lists objects |
| `authorization.read_prefix` | the grant reads objects |
| `authorization.sign_url` | Google Cloud Storage with workload identity: rFabric can sign download links as the service account |

1. Tell the user which probe failed, on which `resource`, and give them `policyStatement` to apply (or to forward to their cloud administrator). A failed probe without `missingPermission` is not a permission problem: relay `remediation` and `detail` (wrong bucket name, unreachable endpoint).
2. After they changed the grant: `storage-connections.verify`. The connection returns to `pending`; poll as in step 5. Nothing has to be recreated.

A `verified` connection can degrade later. rFabric probes connections that datasets read in place; after 3 failed probes in a row `healthStatus` becomes `degraded` and `status` `failed`, and reads through the connection are refused until a probe or `storage-connections.verify` passes again. `storage-connections.health` names the datasets affected: tell the user which ones. A degraded connection also raises an alert, which rFabric closes once a check passes again: read and annotate it in `alerting`.

## Rotate a secret

Only credentials with `authMethod` `accessKey` or `serviceAccountKey` hold a secret. A role or workload identity has none: when its trust is broken, rerun the grant (the cloud file) instead.

`provider-credentials.rotate-secret` takes the replacement secret in its body, so do not call it from the conversation. Your turn for the user, in this order so access never breaks:

1. Create the replacement key in the cloud console; keep the old one.
2. Enter it in the rFabric app: `https://app.rfabric.io/<organization slug>/integrations/<cloud>` (`aws`, `gcp` or `s3_compatible`), the credential's menu, "Rotate keys" ("Replace key file" for a service account key). Or with the CLI in their own terminal (the table at the end), where the key is set and stays out of this conversation.
3. Tell you. Call `storage-connections.verify` on each connection of the credential and confirm `verified`.
4. Then they delete the old key in the cloud console.

The credential id and every connection on it stay the same.

## Revoke

Say what stops before each call: imports from the bucket, and datasets that read through it in place.

1. `storage-connections.delete` sets the connection `revoked`; it cannot be verified again. It is refused while dataset imports that are not cancelled or failed, or datasets linked to it, still use it (409 naming the count): the user decides what to cancel or delete first (`dataset-import`).
2. `provider-credentials.delete` sets the credential `revoked` and deletes its stored secret. It is refused with `reason` `credential_in_use` in `details` while a connection that is not revoked (`details.dependentConnections`) or a compute target (`details.dependentComputeTargets`) uses it.
3. Your turn for the user: remove the grant on the cloud side (the undo line of the cloud file). Revoking in rFabric does not delete the role, service account or key in their account.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| probe 409, `reason` `not_yet_assumable` | the role or workload identity pool is not there yet, or still propagating | keep polling up to 90 seconds; then ask whether the stack reached CREATE_COMPLETE or the script finished |
| probe 409, `reason` `access_denied` | the grant exists but refuses rFabric; `detail` says why, for example a role in another AWS account than the one given | compare the account id with the one the stack ran in; relay `detail` |
| probe 409, `reason` `invalid_external_id` | the grant trusts another `externalId` (an earlier setup token) | the cloud file says how to bring the grant and your setup token together |
| 429 on `provider-credentials.probe-grant` | more than 120 probes a minute in the organization | wait a minute, poll every 3 seconds |
| 400 `BAD_REQUEST` on `provider-credentials.setup-token` | the cloud has no grant flow (S3-compatible) | follow `s3-compatible.md` |
| 422 `VALIDATION_ERROR`, `region must not be set when purpose is storage` | a storage grant is global | drop `region` |
| 400 `credential_purpose_mismatch` on `storage-connections.create` | the credential is not a storage credential | use or create one with `purpose` `storage` |
| 400 `BAD_REQUEST` naming the bucket or `endpoint` | the bucket name does not fit the provider, an endpoint is missing (S3-compatible) or set (S3, Google Cloud Storage), or it points at a private address | correct the value named in `details` |
| 409 `CONFLICT`, credential `is revoked` | the credential was revoked | register another credential (steps 2 and 3) |
| `status` `failed`, summary `verification_timeout` | verification did not finish in 15 minutes | `storage-connections.verify`; if it repeats, report with the `correlationId` |
| 409 `CONFLICT`, `reason` in `details` is `connection_not_verified`, `connection_degraded` or `connection_revoked`, on an object operation | the connection may not serve bytes in that state | Fix a failed or degraded connection |
| 409 `CONFLICT`, `reason` in `details` is `prefix_traversal` | the key lies outside the connection's folder | use a key under `details.allowedPrefix` |
| 403, `code` in `details` is `storage_permission_denied` | the grant denies the action named by `operation` in `details` (a write on a read-only grant) | read only is the default; add write access (the cloud file) if the user wants it |

## Done when

- [ ] `provider-credentials.get`: the credential is `active`, `purpose` `storage`.
- [ ] `storage-connections.get`: `status` `verified`, `lastVerifiedAt` set, every probe in `verificationDiagnostics` passed.
- [ ] `storage-connections.list-objects` returned the folders or files the user expects.
- [ ] The user knows what was created in their cloud account, whether the grant is read only, and how to remove it there.

## Next

- `dataset-import`: import recordings or datasets from the bucket, copied into rFabric or read in place; it also covers importing new data as it lands (bucket notifications).
- `recording-conversion`: convert a ROS 2 bag or MCAP recording that sits in the bucket.
- `compute-setup`: run work in the same cloud account; a connected compute target needs a storage connection with write access.

## The rfabric CLI

Registering a credential with a key and rotating a secret are for the user's own terminal on every host: the key is set in that terminal and stays out of the conversation.

| Step | CLI |
| --- | --- |
| List what a workspace can use | `rfabric workspace provider-credentials <workspace-id>`, `rfabric workspace storage-connections <workspace-id>` |
| Setup token | `rfabric provider-credential setup-token --cloud aws --purpose storage` |
| Check the grant | `rfabric provider-credential probe-grant --cloud aws --purpose storage --external-id <uuid> --account-id <id>`; Google Cloud: `--cloud gcp --project-id <id> --pool-provider <name> --service-account-email <email>` |
| Register the credential | `rfabric provider-credential create --data @credential.json` (`--data -` reads it from stdin, the way to pass a secret) |
| List buckets | `rfabric provider-credential buckets <credential-id>` |
| Create, verify, health | `rfabric storage-connection create --data @connection.json`, `rfabric storage-connection verify <connection-id>`, `rfabric storage-connection health <connection-id>` |
| Browse | `rfabric storage-connection list-objects <connection-id>` |
| Rotate a secret | `rfabric provider-credential rotate-secret <credential-id> --access-key-id "$AWS_ACCESS_KEY_ID" --secret-access-key "$AWS_SECRET_ACCESS_KEY"`, or `--service-account-key-file <path>` |
| Revoke | `rfabric storage-connection delete <connection-id>`, `rfabric provider-credential delete <credential-id>` |
