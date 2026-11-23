# Amazon S3: the grant on the AWS side

Read this for steps 2 and 3 of `storage-connection` when the bucket is in Amazon S3. Three ways in; the decision is in `SKILL.md`. Values in `<angle brackets>` come from `provider-credentials.setup-token` (`cloud` `aws`, `purpose` `storage`) unless a line says otherwise.

One AWS account needs one grant. Before starting, make sure no `active` storage credential already has a `principal` in this account: if one does, reuse it.

| Path | Who does it on the AWS side | What it creates there | Undo |
| --- | --- | --- | --- |
| A. Quick-create stack | someone who may create CloudFormation stacks and IAM roles | one IAM role (in one stack) | delete the stack |
| B. Role by hand | someone who may create IAM roles | one IAM role with one inline policy | delete the policy and the role |
| C. Access keys | someone who may create IAM users | one IAM user with one access key | delete the key and the user |

## A. IAM role from the quick-create stack (recommended)

Use when `aws.quickCreateUrl` is not `null`. When it is `null`, use B.

```text
Your turn - AWS console, one page, a few minutes
Who: someone who may create CloudFormation stacks and IAM roles in the AWS account that owns the bucket.
     If that is not you, forward this whole block: it holds no secret.
Why: rFabric reads your buckets through a role in your account, so no access key leaves AWS.

1. Sign in to the AWS account that owns the bucket, then open: <aws.quickCreateUrl>
2. The page "Quick create stack" opens in region us-east-1 with the stack name rFabric-S3-Access
   and three prefilled parameters: External ID, IAM role name, rFabric AWS account ID. Change none of them.
3. Tick the acknowledgement that AWS CloudFormation might create IAM resources with custom names.
4. Choose "Create stack" and wait until the stack status is CREATE_COMPLETE.

Creates: one IAM role, <aws.roleName>. Nothing else, and nothing in your buckets changes.
Lets rFabric: list the buckets of the account, read the account alias, and list and read objects in every bucket.
              It cannot write or delete. (A role limited to chosen buckets: ask me for the hand-built role instead.)
Only rFabric's AWS account <aws.rfabricAccountId> can use the role, and only with the External ID <externalId>.
Undo: delete the stack rFabric-S3-Access (CloudFormation, region us-east-1). Access ends at once.

Bring back: the 12-digit AWS account ID the stack was created in (console account menu, top right).
Then I: check that rFabric can use the role, and register it.
```

The stack runs in us-east-1 whatever the bucket's region: the role is global.

Probe (`provider-credentials.probe-grant`):

```json
{ "cloud": "aws", "purpose": "storage", "externalId": "<externalId>", "accountId": "<12-digit account id from the user>" }
```

Register (`provider-credentials.create`), `principal` being the `principal` the probe returned:

```json
{
  "ownerScope": "organization",
  "organizationId": "org_...",
  "name": "<accountAlias from the probe, else the account id>",
  "cloud": "aws",
  "purpose": "storage",
  "authMethod": "assumeRole",
  "principal": "arn:aws:iam::<account id>:role/<aws.roleName>",
  "externalId": "<externalId>"
}
```

When the probe answers `invalid_external_id`, or you no longer hold the setup token (a later session): the stack rFabric-S3-Access already exists with its own External ID. Ask the user for the value of "External ID" on the stack's Parameters tab, then probe and register with that value as `externalId`. Nothing has to be recreated. When an `active` credential already uses that role, reuse the credential instead.

## B. IAM role built by hand

For accounts that do not allow the stack, for a role limited to chosen buckets, or for write access.

With a shell where the user's `aws` is signed in, write the two files and run these yourself after the user approves. First show which account it is signed in to (`aws sts get-caller-identity`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - a terminal with the AWS CLI signed in to the account that owns the bucket (AWS CloudShell works)
Who: someone who may create IAM roles in that account. If that is not you, forward this whole block and the two files: they hold no secret.
Why: the same keyless role as the stack, with exactly the permissions you choose.

1. Save the trust policy below as trust.json. It lets only rFabric's AWS account assume the role, and only with your External ID.
   <aws.trustPolicySnippet>
2. Save the permissions policy below as policy.json, with your bucket name in place of BUCKET.
3. Run:
   aws iam create-role --role-name <aws.roleName> --assume-role-policy-document file://trust.json
   aws iam put-role-policy --role-name <aws.roleName> --policy-name rfabric-s3-access --policy-document file://policy.json

Creates: one IAM role, <aws.roleName>, with one inline policy. Nothing in your buckets changes.
Lets rFabric: what policy.json says, on the buckets it names.
Undo: aws iam delete-role-policy --role-name <aws.roleName> --policy-name rfabric-s3-access
      aws iam delete-role --role-name <aws.roleName>

Bring back: your 12-digit AWS account ID (aws sts get-caller-identity --query Account --output text).
Then I: check that rFabric can use the role, and register it.
```

Permissions policy, read only on one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "RfabricDiscovery", "Effect": "Allow", "Action": ["s3:ListAllMyBuckets", "iam:ListAccountAliases"], "Resource": "*" },
    { "Sid": "RfabricReadBucket", "Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:ListBucket"], "Resource": "arn:aws:s3:::BUCKET" },
    { "Sid": "RfabricReadObjects", "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::BUCKET/*" }
  ]
}
```

- **Write access** (a connected compute target, or writing files through the connection): add `s3:PutObject` to the `RfabricReadObjects` statement. Add `s3:DeleteObject` only when the user wants to move or delete files through rFabric.
- **More buckets**: list each bucket's two ARNs in the `Resource` of the second and third statement.
- **Without the discovery statement** the role still works: step 4 then cannot list buckets (`discoveryDenied`) and you ask for the bucket name.
- **Changing the policy later** (adding write access to an existing role): the `put-role-policy` line runs again with the changed policy.json, by you or the user as above; then you call `storage-connections.verify`.
- The user may pick another role name: pass it as `roleName` in the probe body. Probe and register as in A.

## C. Access keys

For an account where no role can be created. The secret never passes through this conversation.

```text
Your turn - AWS console, then the rFabric app
Who: someone who may create IAM users in the AWS account, and an rFabric organization admin (the same person, or two people side by side: the key goes from one screen to the other).
Why: rFabric signs its requests with a key of a user in your account. The key is stored encrypted in rFabric and never shown again.

1. In AWS IAM, create a user without console access and attach the permissions policy I gave you (read only on your bucket).
2. On that user, open "Security credentials" and choose "Create access key". Keep the page open.
3. In rFabric, open https://app.rfabric.io/<organization slug>/integrations/aws/connect?purpose=storage
   choose Access: "Access keys" and "Continue", paste "Access key ID" and "Secret access key", and choose "Continue".
4. rFabric shows "Keys accepted": choose "Done". I connect the bucket.
5. Close the AWS page. Do not paste the key here.

Creates: one IAM user with one access key in your account; one credential in rFabric.
Undo: delete the access key and the user in IAM.

Bring back: nothing, just tell me when rFabric shows "Keys accepted".
Then I: find the credential and connect the bucket.
```

- Give the user the policy of B (without the trust policy).
- Afterwards find the credential with `workspaces-provider-credentials.list`: `cloud` `aws`, `authMethod` `accessKey`, `status` `active`. There is no grant probe for keys: the connection's verification in step 5 is the proof.
- The user can register the key from their own terminal instead of the app, so the key stays out of this conversation: `jq -n --arg id "$AWS_ACCESS_KEY_ID" --arg secret "$AWS_SECRET_ACCESS_KEY" '{ownerScope: "organization", organizationId: "<org id>", name: "<name>", cloud: "aws", purpose: "storage", authMethod: "accessKey", accessKeyId: $id, secretAccessKey: $secret}' | rfabric provider-credential create --data -`
