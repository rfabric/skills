# Connected compute in a Google Cloud project

Read this for step 4 of `compute-setup` when the user's machines should run in their own Google Cloud project. rFabric then creates Batch jobs there as a service account the user grants; the user keeps the machines, the quota and the Google Cloud bill. Values in `<angle brackets>` come from `provider-credentials.setup-token` with `query` `{"cloud": "gcp", "purpose": "compute", "region": "<region>"}` unless a line says otherwise.

Before the grant, have ready:

- the region (a Google Cloud region such as `europe-west4`); a grant covers one region;
- the project id;
- a verified storage connection to a bucket of the same project, with write access (`storage-connection`): the target keeps task inputs, outputs, checkpoints and logs there, and rFabric signs the workers' transfers with that connection's grant. The compute script grants no bucket access of its own;
- pull access to rFabric's handler images for the project's worker service account: every job starts one. rFabric serves Google Cloud targets the handler images from its own Artifact Registry repository and grants that service account read access there, an rFabric operator step at onboarding. Tell your rFabric contact the project id before you start; the account is rfabric-worker@<project id>.iam.gserviceaccount.com, which the script creates. Until the grant, jobs fail at the image pull.

## Run the compute script

`gcp.setupScript` is a bash script of gcloud commands with the region filled in. First replace `<your-gcp-project-id>` in its `PROJECT_ID` line with the user's project id.

With a shell where the user's `gcloud` is signed in, save the script and run it yourself after the user approves. First show which account and project it is signed in to (`gcloud config list account project`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - Google Cloud Shell in the project the machines should run in
Who: a project Owner, or someone who may enable APIs, create workload identity pools, service accounts, custom roles, networks and firewall rules, and change the project's IAM policy.
     If that is not you, forward this whole block and the script: they hold no secret.
Why: rFabric runs your training, simulation and enrichment jobs as Batch jobs in your project. You keep the machines and the bill; rFabric holds no key.

1. Open Cloud Shell in the Google Cloud console.
2. Save the script I give you as rfabric-compute.sh and run: bash rfabric-compute.sh
3. Copy the three lines it prints under "Paste these values into rFabric".

Creates, in project <project id>:
- a workload identity pool rfabric-compute with one provider, <gcp.providerId>, that accepts only rFabric's cloud account <gcp.rfabricAccountId> acting for this connection;
- a service account rfabric-compute that rFabric acts as: it may create Batch jobs, read logs, and read quota and network details;
- a service account rfabric-worker that the machines run as: it may write logs and report to Batch;
- a network rfabric-compute with a subnetwork, router and NAT named rfabric-compute-<region>, and firewall rules that allow only HTTPS out and traffic between workers of one job. Machines get no external address;
- a custom role rfabricComputeQuotaReader, and six enabled Google APIs (Batch, Compute Engine, IAM, IAM Credentials, Cloud Logging, Security Token Service).
Cost: Google Cloud bills you for the machines while jobs run, and for the NAT gateway.
Running the script again is safe: it reuses what exists. Another region is another run with another script.
Undo: gcloud iam service-accounts delete rfabric-compute@<project id>.iam.gserviceaccount.com
      gcloud iam service-accounts delete rfabric-worker@<project id>.iam.gserviceaccount.com
      gcloud iam workload-identity-pools providers delete <gcp.providerId> --location=global --workload-identity-pool=rfabric-compute
      gcloud compute routers delete rfabric-compute-<region> --region=<region>   (removes the router and its NAT)
      then delete the subnetwork, the firewall rules and the network named rfabric-compute in the console if you no longer want them.

Bring back: the three printed values (projectId, workloadIdentityPoolProvider, serviceAccountEmail). None is a secret.
Then I: check the grant, list the capacity, and connect the pools you choose.
```

## Check and register

Probe (`provider-credentials.probe-grant`), the last three values as the script printed them:

```json
{
  "cloud": "gcp",
  "purpose": "compute",
  "region": "<region>",
  "externalId": "<externalId>",
  "projectId": "<projectId>",
  "workloadIdentityPoolProvider": "<workloadIdentityPoolProvider>",
  "serviceAccountEmail": "<serviceAccountEmail>"
}
```

`not_yet_assumable` right after the script is normal while the pool binding takes effect: keep polling up to 90 seconds. `invalid_external_id`, or a later session that no longer holds the setup token: call `provider-credentials.setup-token` again with the same region and have the user run that script; it reuses what exists and adds one provider.

Register (`provider-credentials.create`, needs `compute:administer`):

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "<projectId> <region>",
  "cloud": "gcp",
  "purpose": "compute",
  "authMethod": "workloadIdentity",
  "principal": "<serviceAccountEmail>",
  "externalId": "<externalId>",
  "providerConfig": { "projectId": "<projectId>", "workloadIdentityPoolProvider": "<workloadIdentityPoolProvider>" }
}
```

## Discover and connect

`provider-credentials.compute-resources` with `query` `{"region": "<region>"}`. On Google Cloud the proposed pools have `backend` `gcp_batch` and the keys `<region>/gpu` and `<region>/cpu`; GPU pools are proposed for training and simulation attempts, CPU pools for enrichment and generation.

`compute-targets.connect`:

```json
{
  "scope": "organization",
  "organizationId": "org_...",
  "name": "gcp-<region>",
  "providerCredentialId": "pcred_...",
  "region": "<region>",
  "storageConnectionId": "sc_...",
  "pools": [{ "key": "<region>/gpu" }, { "key": "<region>/cpu" }]
}
```

Omit a pool's `taskTypes`, `name` and `maxCapacity` to take what discovery proposed. With `scope` `workspace`, add `workspaceId`.

## What the checks prove

`verification.checks[]` of a connected Google Cloud target, all needed for `verified`:

| `name` | Passing means |
| --- | --- |
| `credential` | the compute credential exists, is active and is for this cloud |
| `impersonate` | rFabric can act as the rfabric-compute service account |
| `batch_list_jobs` | it can list Batch jobs in the region |
| `batch_create_permission` | it may create Batch jobs |
| `bucket_access` | the storage connection reaches the bucket |

## Images on this target

A trainer, simulator or candidate image is pulled by the worker with a short-lived registry sign-in rFabric issues for that one run, as on rFabric's pools: an image in Google Artifact Registry, this project's own included, or in Amazon ECR needs that project or account connected as a container registry; an image on any other registry host must be publicly readable (`compute-setup`, Container registry access). The worker service account needs no access to that registry.

An enrichment method's image is the image the machine itself starts, as the rfabric-worker service account. To let it pull the project's own Artifact Registry images, referenced by digest, read access is granted once, by the rule of the script (you with a shell, after the user approves; the user otherwise):

```bash
gcloud projects add-iam-policy-binding <project id> \
  --member=serviceAccount:rfabric-worker@<project id>.iam.gserviceaccount.com \
  --role=roles/artifactregistry.reader
```
