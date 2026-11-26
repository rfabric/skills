# Container registry: the grant on the cloud side

Read this for steps 3 to 5 of "Container registry access" in `compute-setup`. It connects an Amazon ECR account or a Google Artifact Registry project so rFabric's managed pools can use the user's private simulation and trainer images. Values in `<angle brackets>` come from `provider-credentials.setup-token` with `query` `{"cloud": "aws" | "gcp", "purpose": "container_registry"}` (no `region`) unless a line says otherwise. It changes nothing. Call it once and show `externalId` to the user with the block: rFabric keeps none until the credential is registered.

One connected registry serves one AWS account or one Google Cloud project. An organization can hold several.

## Amazon ECR

```text
Your turn - AWS console, one page
Who: someone who may create CloudFormation stacks and IAM roles in the AWS account that holds the ECR repositories.
     If that is not you, forward this whole block: it holds no secret.
Why: rFabric checks your images before a launch and lets the machine that runs them pull them, through a role in your account. No key leaves AWS and no image is copied.

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
Why: rFabric checks your images before a launch and lets the machine that runs them pull them, as a service account of your project. No key file, and no image is copied.

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

## Trainer images

Step 5 of "Container registry access". A simulation machine gets a short-lived sign-in from the container registry; a training machine of rFabric's managed pools pulls as rFabric's own pull identity instead, which the repository must let read. The container registry above is still needed: through it rFabric checks the trainer image before a run starts. Do this once per repository that holds trainer images. The value comes from the same `provider-credentials.setup-token` answer: `aws.imagePullRoleArn` or `gcp.imagePullMember`. When it is null, stop: this deployment pulls no private trainer images on its managed pools.

```text
Your turn - AWS console, Amazon ECR, the repository of the trainer image
Who: someone who may change the repository's policy (ecr:SetRepositoryPolicy).
Why: rFabric's training machines pull your trainer image as rFabric's pull identity; the repository must allow it to read.

1. Open Amazon ECR > Private registry > Repositories, select <repository>, then Permissions > Edit policy JSON.
2. Add this statement to the policy's "Statement" list, keeping the statements already there:
   {
     "Sid": "RfabricComputeImagePull",
     "Effect": "Allow",
     "Principal": { "AWS": "<aws.imagePullRoleArn>" },
     "Action": ["ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer"]
   }
3. Save.

Lets rFabric: pull images of this repository on its training machines. It cannot push or delete.
Undo: remove the statement.
Bring back: tell me when it is saved.
Then I: preview a launch on the image.
```

```text
Your turn - a terminal with gcloud, signed in to the project of the trainer image
Who: someone who may change the repository's IAM policy (an Artifact Registry admin or project owner).
Why: rFabric's training machines pull your trainer image as rFabric's pull identity; the repository must allow it to read.

1. Run:
   gcloud artifacts repositories add-iam-policy-binding <repository> \
     --project=<project id> --location=<location> \
     --member=<gcp.imagePullMember> \
     --role=roles/artifactregistry.reader

Lets rFabric: read images of this repository. It cannot push or delete.
Undo: the same command with remove-iam-policy-binding.
Bring back: tell me when it ran.
Then I: preview a launch on the image.
```

With a shell where the user's `gcloud` is signed in, run the Google Cloud command yourself after the user approves, as for the script above. The rFabric app shows the same statement or command after a container registry is connected, in the Grant step.

## Both clouds

- **Probe result**: poll every 3 seconds, up to 90 seconds. `assumed` `true` with `discovery.pullImages` `true` is the goal. `pullImages` `false` means the grant works but may not pull: on AWS the role lacks `ecr:GetAuthorizationToken`, on Google Cloud the service account lacks read access to Artifact Registry on the project. Have the user repeat the stack or script before you register. One exception: on Google Cloud, read access bound on single repositories only (the "grant less" line) also reports `false`; register it, and the image check at the launch is the proof.
- **A later session, or `invalid_external_id`**: on AWS ask the user for the value of "External ID" on the stack's Parameters tab, then probe and register with it as `externalId`. On Google Cloud call `provider-credentials.setup-token` again and have the user run that script: it reuses the pool and the service account and adds one provider.
- **Scope**: `ownerScope` `workspace` with `workspaceId` (instead of `organizationId`) limits the registry to one workspace. Creating needs organization role `owner` or `admin` for that scope; anyone else gets 403.
- **Matching**: rFabric picks the registry from the image address: an image at `<account>.dkr.ecr.<region>.amazonaws.com/...` uses the active AWS registry whose role is in that account; one at `<location>-docker.pkg.dev/<project>/...` uses the active Google Cloud registry of that project. The workspace's own registry is preferred, then the newest.
- **Remove**: `provider-credentials.delete`. Nothing depends on a container registry, so it is never refused; launches of images from that account then fail the image check. Then the undo line above.

| Signal at a launch | What it means | Do |
| --- | --- | --- |
| 422 `container_registry_not_connected` | the image's AWS account or Google Cloud project has no container registry the workspace can use | connect it (this file), in a scope that covers the workspace |
| 422 `image_access_denied` | the registry, or the grant of its container registry, refused rFabric read access to the image | check the repository pattern (AWS) or the reader binding (Google Cloud) covers that repository |
| 422 `image_not_pinned` | the image is referenced by tag | reference it as `<repository>@sha256:<64 hex>` |
