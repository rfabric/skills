# Import as new data lands: bucket notifications

Read this when the user wants new dataset roots imported without asking, and the storage connection's `provider` is `s3` or `gcs`. The bucket then tells rFabric about every new object, and rFabric runs the covering imports for the affected roots only.

An `s3_compatible` connection has no notifications: use a schedule or the producer signal from "Keep importing" in [SKILL.md](SKILL.md).

## At a glance

| # | Step | Who | Operations |
| --- | --- | --- | --- |
| 1 | Check the connection and that the import was started once | agent | `storage-connections.get`, `dataset-imports.get` |
| 2 | Copy the setup script from rFabric and run it in the cloud account that owns the bucket | user: an rFabric organization admin, in the rFabric app, then AWS CloudShell or Google Cloud Shell | none |
| 3 | Verify with a new dataset root | agent | `dataset-imports.list-runs`, `operations.list` |

## Before you start

- **Permissions**: in rFabric, an organization admin (organization role `owner` or `admin`) to read the setup script. In the cloud account, the rights named under "Who" in the block.
- **Needs**: a DatasetImport on this connection that was started at least once (`meta` of `dataset-imports.get` has an `operationId`) and is not `cancelled` or `failed`. An import that was only created takes no notifications: start it first.

## The script is a secret

The setup script contains this connection's notification secret (the `token` in the address it subscribes). Anyone who has it can announce objects to rFabric for this bucket. It goes from rFabric straight to the user's cloud shell and never through this conversation:

- Do not call `storage-connections.notification-setup`: its response would put the secret here.
- Never run `rfabric storage-connection notification-setup` or the script from your shell, on any host: the command prints the script, and the script and its output hold the secret. The whole block stays with the user.
- Do not ask the user to paste the script, the push endpoint or the script's output. When the script fails, ask for the error line only.
- When the person who can read the script (organization admin) is not the person who can run it (cloud rights), they hand it over between themselves.

## Your turn blocks

Fill in the bucket, region, connection name, connection id and workspace name from `storage-connections.get` and the import, and hand over the block for the provider.

### AWS (`provider` `s3`)

```text
Your turn - rFabric app, then AWS CloudShell
Why: your bucket then tells rFabric about each new object, so new datasets are imported without a manual run.
Who: an rFabric organization admin copies the script. It is run by someone signed in to the AWS account that owns bucket <bucket>
     who may create and configure an SNS topic and change the bucket's event notifications
     (sns:CreateTopic, sns:SetTopicAttributes, sns:Subscribe, s3:GetBucketNotification, s3:PutBucketNotification).

1. Check what the bucket sends today. In AWS CloudShell:
   aws s3api get-bucket-notification-configuration --bucket <bucket> --region <region>
   Empty output means none: go on. An entry for the topic rfabric-storage-notifications only: go on.
   Anything else: stop and tell me which kinds are listed. The script replaces the bucket's whole
   notification configuration, so your entries must be added to it first (I tell you where).
2. Copy the script: rFabric app > workspace <workspace name> > Collect > Raw data > Buckets > <connection name> > actions menu (...) > Notifications > copy "Setup script".
   Treat it like a password. With the CLI instead: rfabric storage-connection notification-setup <connection id>
3. Paste the script into CloudShell and run it once.

It creates, in region <region>:
- an SNS topic named rfabric-storage-notifications that only Amazon S3 from your account may publish to;
- one event notification on the bucket: every created object (s3:ObjectCreated:*) is sent to that topic;
- one HTTPS subscription that delivers the topic to rFabric. rFabric confirms it by itself.
rFabric receives the bucket name and key of each new object. It gets no new access to the bucket.

To undo, in CloudShell:
   aws sns delete-topic --region <region> --topic-arn "arn:aws:sns:<region>:$(aws sts get-caller-identity --query Account --output text):rfabric-storage-notifications"
   then delete the event notification that names that topic: S3 console > <bucket> > Properties > Event notifications.
   Deleting the topic removes its subscriptions, also those of other rFabric connections on this bucket.

Bring back: "done", or the error line only (never the script or its full output).
Then I: check with the next new dataset folder that rFabric imports it by itself.
```

When step 1 lists other entries: the user edits the script before running it. In its `put-bucket-notification-configuration` command, the JSON gets their existing `TopicConfigurations`, `QueueConfigurations`, `LambdaFunctionConfigurations` and `EventBridgeConfiguration` entries next to the rFabric topic entry (the output of step 1, which carries no secret, is what to merge in). Offer to write the merged JSON from that output.

### Google Cloud (`provider` `gcs`)

```text
Your turn - rFabric app, then Google Cloud Shell
Why: your bucket then tells rFabric about each new object, so new datasets are imported without a manual run.
Who: an rFabric organization admin copies the script. It is run by someone with the roles Storage Admin on bucket <bucket>
     and Pub/Sub Admin on the project that owns it. The Pub/Sub API must be enabled in that project.

1. Copy the script: rFabric app > workspace <workspace name> > Collect > Raw data > Buckets > <connection name> > actions menu (...) > Notifications > copy "Setup script".
   Treat it like a password. With the CLI instead: rfabric storage-connection notification-setup <connection id>
2. Open Cloud Shell in the project that owns the bucket, paste the script and run it once.

It creates:
- a Pub/Sub topic named rfabric-storage-notifications (kept if it exists);
- a notification on the bucket: every finished object (OBJECT_FINALIZE) is published to that topic, limited to the connection's folder when it has one;
- a push subscription named rfabric-<connection id> that delivers the topic to rFabric.
rFabric receives the bucket name and name of each new object. It gets no new access to the bucket.

To undo, in Cloud Shell:
   gcloud pubsub subscriptions delete rfabric-<connection id>
   gcloud storage buckets notifications list gs://<bucket>
   gcloud storage buckets notifications delete projects/_/buckets/<bucket>/notificationConfigs/<id of the entry for rfabric-storage-notifications>
   gcloud pubsub topics delete rfabric-storage-notifications   (only when no other subscription uses it)

Bring back: "done", or the error line only (never the script or its full output).
Then I: check with the next new dataset folder that rFabric imports it by itself.
```

## Verify

No read operation shows the wiring itself; verify by effect, and say so.

1. Ask the user to write one new, complete dataset root under the import's `sourcePrefix`. When none is at hand, report the setup as done but unverified, and check at the next arrival.
2. `dataset-imports.list-runs`: a run for that root appears and moves to `ready`.
3. `operations.list` with `resourceType` `datasetImport` and `resourceId` the import id, newest first: the run's Operation has `requestedBy` `system:dataset-import`, which marks a run rFabric started by itself.

How notified roots are handled:

- Each notified root is queued on every started import of the connection whose prefix covers it.
- A burst of new objects for one root starts one run. Roots that arrive while a run is open are imported in one run after it settles.
- A root that is still being written shows as `incomplete` and is tried again with the next notification or run.
- A recording (ROS 2 bag, MCAP) found this way is not converted automatically: its run waits with `conversionStatus` `pending`. Rerun that root with `dataset-imports.runs-rerun` to convert it as the user (`recording-conversion`).

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| App shows "Could not load the notification setup"; CLI answers 403 `Organization administrator role required` | the user is not an organization admin | an organization admin (role `owner` or `admin`) copies the script |
| Script stops with an access error | the cloud identity lacks a right | ask for the error line; the user reruns it as an identity with the rights under "Who" |
| Google Cloud: the script stops at the subscription, "already exists" | the script ran before for this connection | nothing more to create; the bucket now has one notification entry too many: list them and delete the newer one (undo commands) |
| Other event notifications on the bucket stopped | the AWS script replaced the bucket's notification configuration | the user adds them again next to the rFabric entry (S3 console > Properties > Event notifications) |
| New root, no run after 15 minutes | the import was never started, is `cancelled` or `failed`, or its prefix does not cover the root | `dataset-imports.get`; start it once, or create an import whose `sourcePrefix` covers the root |

## Done when

- [ ] The user ran the script without error.
- [ ] A new root written after the setup has a `ready` run in `dataset-imports.list-runs`, from an Operation requested by `system:dataset-import`; or the user knows the setup is not yet verified.
- [ ] Neither the script nor the push endpoint appeared in the conversation.
