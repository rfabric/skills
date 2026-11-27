# Container registry: the grant on the cloud side

Read this for steps 3 and 4 of "Container registry access" in `compute-setup`. It connects an Amazon ECR account or a Google Artifact Registry project so training and simulation runs on rFabric's pools and on connected pools pull the user's trainer, candidate and simulator images straight from it. Connecting it is the only step, for simulation and for training. Values in `<angle brackets>` come from `provider-credentials.setup-token` with `query` `{"cloud": "aws" | "gcp", "purpose": "container_registry"}` (no `region`) unless a line says otherwise. It changes nothing. Call it once and show `externalId` to the user with the block: rFabric keeps none until the credential is registered.

One connected registry serves one AWS account or one Google Cloud project. An organization can hold several.

## Amazon ECR

```text
Your turn - AWS console, one page
Who: someone who may create CloudFormation stacks and IAM roles in the AWS account that holds the ECR repositories.
     If that is not you, forward this whole block: it holds no secret.
Why: rFabric reads your trainer and simulation images before a launch and signs the worker that runs them in to pull them, through a role in your account. No key leaves AWS and no image is copied.

1. Sign in to the AWS account that holds the images, then open: <aws.quickCreateUrl>
   The page "Quick create stack" opens in region us-east-1 with a stack name starting rFabric-Container-Registry-.
2. Leave the group "rFabric connection (prefilled - do not edit)" unchanged.
3. "Repository name or pattern": keep * for every repository of the account, or narrow it to a name (controller) or a pattern (team-a/*).
4. Tick the acknowledgement that AWS CloudFormation might create IAM resources with custom names.
5. Choose "Create stack" and wait until the stack status is CREATE_COMPLETE.

Creates: one IAM role, <aws.roleName>. Nothing else, and nothing in your repositories changes.
Lets rFabric: sign in to the registry and read images in the repositories you named. It cannot push or delete.
Only rFabric's AWS account <aws.rfabricAccountId> can use the role, and only with the External ID <externalId>.
Undo: delete that stack (CloudFormation, region us-east-1). Access ends at once.

Bring back: the 12-digit AWS account ID the stack was created in.
Then I: check that rFabric can use the role and pull, and register it.
```

The stack runs in us-east-1 whatever the repositories' region: the role is global.

Probe (`provider-credentials.probe-grant`):

```json
{ "cloud": "aws", "purpose": "container_registry", "externalId": "<externalId>", "accountId": "<12-digit account id>" }
```

Register (`provider-credentials.create`):

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "<account id> images",
  "cloud": "aws",
  "purpose": "container_registry",
  "authMethod": "assumeRole",
  "principal": "<principal from the probe>",
  "externalId": "<externalId>"
}
```

## Google Artifact Registry

`gcp.setupScript` is a bash script of gcloud commands. First replace `<your-gcp-project-id>` in its `PROJECT_ID` line with the id of the project whose repositories hold the images.

With a shell where the user's `gcloud` is signed in, save the script and run it yourself after the user approves. First show which account and project it is signed in to (`gcloud config list account project`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - Google Cloud Shell in the project that holds the images
Who: a project Owner, or someone who may enable APIs, create workload identity pools and service accounts, and change the project's IAM policy.
     If that is not you, forward this whole block and the script: they hold no secret.
Why: rFabric reads your trainer and simulation images before a launch and signs the worker that runs them in to pull them, as a service account of your project. No key file, and no image is copied.

1. Open Cloud Shell in the Google Cloud console.
2. Save the script I give you as rfabric-registry.sh and run: bash rfabric-registry.sh
3. Copy the three lines it prints under "Paste these values into rFabric".

Creates, in project <project id>:
- a workload identity pool rfabric-registry with one provider, <gcp.providerId>, that accepts only rFabric's cloud account <gcp.rfabricAccountId> acting for this connection;
- a service account rfabric-registry@<project id>.iam.gserviceaccount.com with roles/artifactregistry.reader on the project.
It also enables five Google APIs in the project (IAM, Security Token Service, IAM Credentials, Artifact Registry, Cloud Resource Manager).
Lets rFabric: read images of every Artifact Registry repository of the project. It cannot push or delete.
To grant less: remove the project binding and bind roles/artifactregistry.reader on single repositories (the script's comment shows the command).
Undo: gcloud iam service-accounts delete rfabric-registry@<project id>.iam.gserviceaccount.com
      gcloud iam workload-identity-pools providers delete <gcp.providerId> --location=global --workload-identity-pool=rfabric-registry

Bring back: the three printed values (projectId, workloadIdentityPoolProvider, serviceAccountEmail). None is a secret.
Then I: check that rFabric can act as the service account and pull, and register it.
```

Probe (`provider-credentials.probe-grant`):

```json
{
  "cloud": "gcp",
  "purpose": "container_registry",
  "externalId": "<externalId>",
  "projectId": "<projectId>",
  "workloadIdentityPoolProvider": "<workloadIdentityPoolProvider>",
  "serviceAccountEmail": "<serviceAccountEmail>"
}
```

Register (`provider-credentials.create`):

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "<projectId> images",
  "cloud": "gcp",
  "purpose": "container_registry",
  "authMethod": "workloadIdentity",
  "principal": "<serviceAccountEmail>",
  "externalId": "<externalId>",
  "providerConfig": { "projectId": "<projectId>", "workloadIdentityPoolProvider": "<workloadIdentityPoolProvider>" }
}
```

## Both clouds

- **Probe result**: poll every 3 seconds, up to 90 seconds. `assumed` `true` with `discovery.pullImages` `true` is the goal. `pullImages` `false` means the grant works but may not pull: on AWS the role lacks `ecr:GetAuthorizationToken`, on Google Cloud the service account lacks read access to Artifact Registry on the project. Have the user repeat the stack or script before you register. One exception: on Google Cloud, read access bound on single repositories only (the "grant less" line) also reports `false`; register it, and the image check at the launch is the proof.
- **A later session, or `invalid_external_id`**: on AWS ask the user for the value of "External ID" on the stack's Parameters tab, then probe and register with it as `externalId`. On Google Cloud call `provider-credentials.setup-token` again and have the user run that script: it reuses the pool and the service account and adds one provider.
- **Scope**: `ownerScope` `workspace` with `workspaceId` (instead of `organizationId`) limits the registry to one workspace. Creating needs organization role `owner` or `admin` for that scope; anyone else gets 403.
- **Matching**: rFabric picks the registry from the image address: an image at `<account>.dkr.ecr.<region>.amazonaws.com/...` uses the active AWS registry whose role is in that account; one at `<location>-docker.pkg.dev/<project>/...` uses the active Google Cloud registry of that project. The workspace's own registry is preferred, then the newest.
- **Remove**: `provider-credentials.delete`. Nothing depends on a container registry, so it is never refused. Before every run, also when the image is already on the machine, rFabric checks that the container registry can still read the exact image: a revoked or narrowed container registry refuses new launches of images from that account or project and stops the next run of one already launched. Then the undo line above.

| Signal at a launch | What it means | Do |
| --- | --- | --- |
| 422 `container_registry_not_connected` | no connected container registry of the workspace or its organization serves the image's AWS account or Google Cloud project | connect it (this file), in a scope that covers the workspace |
| 422 `image_access_denied` | the registry refuses the read | check the repository pattern (AWS) or the reader binding (Google Cloud) covers that repository |
| 422 `image_not_found`, `image_platform_mismatch` | the registry holds no such image, or the image is built for another platform than the pool's machines | push the image and use its digest; rebuild for the platform the message names |
| 502 `UPSTREAM_ERROR` | the image check could not complete | launch again: it is retryable |
| 422 `image_not_pinned` | the image is referenced by tag | reference it as `<repository>@sha256:<64 hex>` |
