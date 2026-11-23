# S3-compatible stores: keys and endpoint

Read this for steps 2 to 5 of `storage-connection` when the bucket is in a store that speaks the S3 API but is not Amazon S3: Cloudflare R2, MinIO, Wasabi and the like.

What differs from Amazon S3 and Google Cloud Storage:

| Topic | S3-compatible |
| --- | --- |
| Access | an access key pair only (`authMethod` `accessKey`); no role, no setup token, no grant probe |
| Endpoint | required: the store's HTTPS address, for example `https://<account-id>.r2.cloudflarestorage.com`. It must be reachable from the internet: a private, loopback or `localhost` address is refused |
| Bucket discovery | none: the user names the bucket |
| Region | the region string the store documents for the bucket |
| New data as it lands | the bucket cannot notify rFabric; `dataset-import` covers the other ways to keep importing |

The key is a secret, so the user enters it in the rFabric app. The form registers the credential, creates the connection and starts verification in one go; you continue from the connection it created.

```text
Your turn - the store's console, then the rFabric app
Who: someone who may create access keys in the store, and an rFabric organization admin (the same person, or two people side by side: the key goes from one screen to the other).
Why: rFabric signs its requests to your store with an access key. The key is stored encrypted in rFabric and never shown again.

1. In your store's console, create an access key that can list and read the bucket <bucket>, and nothing else
   (add write only if rFabric should write files there).
2. In rFabric, open https://app.rfabric.io/<organization slug>/storage/connect/s3-compatible
3. Fill in "Connect S3-compatible bucket":
   Endpoint: your store's HTTPS address
   Access key ID, Secret access key: the key from step 1
   Bucket: <bucket>
   Region: the region your store names for the bucket
   Folder: leave empty for the whole bucket, or a folder to confine rFabric to it
4. Choose "Connect". The page checks the bucket and shows the result; then choose "Done".
5. Do not paste the key here.

Creates: one access key in your store; one credential and one storage connection in rFabric. Nothing in your bucket changes.
Undo: delete the access key in your store's console; I revoke the connection and the credential in rFabric.

Bring back: nothing, just tell me when the form is submitted.
Then I: find the connection, follow its verification and show you the bucket's content.
```

Afterwards:

1. `workspaces-storage-connections.list`: the connection has `provider` `s3_compatible`, the bucket's name and the `endpoint`.
2. Continue with step 5 of `SKILL.md` from "Poll `storage-connections.get`", then step 6.

To change the endpoint later, `storage-connections.update` takes `endpoint`; a changed `prefix` or `credentialId` starts verification again.

The user can do the same from their own terminal, the key staying out of this conversation:

1. `jq -n --arg id "$ACCESS_KEY_ID" --arg secret "$SECRET_ACCESS_KEY" '{ownerScope: "organization", organizationId: "<org id>", name: "<store name>", cloud: "s3_compatible", purpose: "storage", authMethod: "accessKey", accessKeyId: $id, secretAccessKey: $secret}' | rfabric provider-credential create --data -`
2. You then call `storage-connections.create` as in step 5, adding `"endpoint": "https://..."` and the `region`.
