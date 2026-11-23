# Google Cloud Storage: the grant on the Google Cloud side

Read this for steps 2 and 3 of `storage-connection` when the bucket is in Google Cloud Storage. Two ways in; the decision is in `SKILL.md`. Values in `<angle brackets>` come from `provider-credentials.setup-token` (`cloud` `gcp`, `purpose` `storage`) unless a line says otherwise.

One project needs one grant. Before starting, make sure no `active` storage credential already has this project in `providerConfig.projectId`: if one does, reuse it.

| Path | Who does it on the Google Cloud side | What it creates there | Undo |
| --- | --- | --- | --- |
| A. Workload identity | a project Owner, or someone with the rights listed in the block | a workload identity pool with one provider, a service account, a custom role, two project role bindings | delete the service account and the provider |
| B. Service account key | someone who may create service accounts and keys | a service account with one key and two bucket role bindings | delete the service account |

## A. Workload identity (recommended)

Keyless: the project trusts rFabric's own cloud identity, and rFabric acts as a service account of the project. `gcp.setupScript` is a bash script of gcloud commands. First replace `<your-gcp-project-id>` in its `PROJECT_ID` line with the user's project id.

With a shell where the user's `gcloud` is signed in, save the script and run it yourself after the user approves. First show which account and project it is signed in to (`gcloud config list account project`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - Google Cloud Shell in the project that owns the buckets, a few minutes
Who: a project Owner, or someone who may enable APIs, create workload identity pools, service accounts and custom roles, and change the project's IAM policy.
     If that is not you, forward this whole block and the script: they hold no secret.
Why: rFabric reads your buckets as a service account of your project, with no key file to store or rotate.

1. Open Cloud Shell in the Google Cloud console.
2. Save the script I give you as rfabric-access.sh and run: bash rfabric-access.sh
3. Copy the three lines it prints under "Paste these values into rFabric".

Creates, in project <project id>:
- a workload identity pool rfabric-access with one provider, <gcp.providerId>, that accepts only rFabric's cloud account <gcp.rfabricAccountId> acting for this connection;
- a service account rfabric-access@<project id>.iam.gserviceaccount.com;
- a custom role rfabricStorageAccess (list buckets, read bucket details, list and read objects), and that role plus roles/storage.objectViewer for the service account on the project.
It also enables four Google APIs in the project (IAM, Security Token Service, IAM Credentials, Cloud Storage).
Lets rFabric: list the project's buckets and read the objects of every bucket, and sign download links as the service account.
              It cannot write or delete. Nothing in your buckets changes.
Running the script again is safe: it reuses what exists.
Undo: gcloud iam service-accounts delete rfabric-access@<project id>.iam.gserviceaccount.com
      gcloud iam workload-identity-pools providers delete <gcp.providerId> --location=global --workload-identity-pool=rfabric-access
      gcloud iam roles delete rfabricStorageAccess --project=<project id>

Bring back: the three printed values (projectId, workloadIdentityPoolProvider, serviceAccountEmail). None is a secret.
Then I: check that rFabric can act as the service account, and register it.
```

Probe (`provider-credentials.probe-grant`), the last three values as the script printed them:

```json
{
  "cloud": "gcp",
  "purpose": "storage",
  "externalId": "<externalId>",
  "projectId": "<projectId>",
  "workloadIdentityPoolProvider": "projects/<project number>/locations/global/workloadIdentityPools/rfabric-access/providers/<gcp.providerId>",
  "serviceAccountEmail": "rfabric-access@<projectId>.iam.gserviceaccount.com"
}
```

A fresh pool binding can take a moment to work: `not_yet_assumable` right after the script is normal, keep polling.

Register (`provider-credentials.create`):

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "<projectId>",
  "cloud": "gcp",
  "purpose": "storage",
  "authMethod": "workloadIdentity",
  "principal": "<serviceAccountEmail>",
  "externalId": "<externalId>",
  "providerConfig": {
    "projectId": "<projectId>",
    "workloadIdentityPoolProvider": "<workloadIdentityPoolProvider>"
  }
}
```

- `invalid_external_id` from the probe, or a later session that no longer holds the setup token: the provider in the project belongs to another setup token. Call `provider-credentials.setup-token` once more if you hold none, and have the user run that script: it reuses the pool and the service account and adds one provider. Probe and register with the values it prints.
- **Fewer buckets**: the script grants read on every bucket of the project. To narrow it, remove the project binding of roles/storage.objectViewer and bind it on single buckets: `gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:<serviceAccountEmail> --role=roles/storage.objectViewer`.
- **Write access** (a connected compute target, or writing files through the connection): bind an object write role on the bucket, for example `gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:<serviceAccountEmail> --role=roles/storage.objectAdmin`. Say that this role also allows deleting objects. Afterwards call `storage-connections.verify`.
- These `gcloud` commands follow the rule of the script: yours to run with a shell after the user approves, the user's otherwise.

## B. Service account key

For projects that do not allow workload identity federation. The block creates a key file, so it stays with the user on every host: the key file never passes through this conversation.

```text
Your turn - Google Cloud Shell, then the rFabric app
Who: someone who may create service accounts and keys in the project, and an rFabric organization admin (the same person, or two people side by side: the key file goes from one to the other).
Why: rFabric signs in as a service account of your project with its key file. The key is stored encrypted in rFabric and never shown again.

1. In Cloud Shell, with your project selected, run (BUCKET is your bucket, PROJECT your project id):
   gcloud iam service-accounts create rfabric-access --display-name="rFabric storage access"
   gcloud storage buckets add-iam-policy-binding gs://BUCKET --member=serviceAccount:rfabric-access@PROJECT.iam.gserviceaccount.com --role=roles/storage.objectViewer
   gcloud storage buckets add-iam-policy-binding gs://BUCKET --member=serviceAccount:rfabric-access@PROJECT.iam.gserviceaccount.com --role=roles/storage.legacyBucketReader
   gcloud iam service-accounts keys create rfabric-access-key.json --iam-account=rfabric-access@PROJECT.iam.gserviceaccount.com
2. Download rfabric-access-key.json from Cloud Shell.
3. In rFabric, open https://app.rfabric.io/<organization slug>/integrations/gcp/connect?purpose=storage
   choose Access: "Service account key" and "Continue", upload the key file, and choose "Continue".
4. rFabric shows "Key accepted": choose "Done". I connect the bucket.
5. Delete the downloaded file and the copy in Cloud Shell. Do not paste the key here.

Creates: one service account with one key and read access to that bucket; one credential in rFabric. Nothing in your bucket changes.
Undo: gcloud iam service-accounts delete rfabric-access@PROJECT.iam.gserviceaccount.com

Bring back: nothing, just tell me when rFabric shows "Key accepted".
Then I: find the credential and connect the bucket.
```

- Afterwards find the credential with `workspaces-provider-credentials.list`: `cloud` `gcp`, `authMethod` `serviceAccountKey`, `status` `active`. Its `principal` is the service account email, taken from the key.
- With these bucket-level roles the account cannot list the project's buckets: step 4 answers `discoveryDenied` and you ask for the bucket name. That is expected.
- There is no grant probe for a key: the connection's verification in step 5 is the proof.
