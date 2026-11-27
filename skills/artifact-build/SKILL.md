---
name: artifact-build
description: >-
  A ready Artifact - one Model packaged with its inference image and weights, verified by digest, that simulation and robots can run - and optionally an artifact release published to an artifact channel. Use when asked to package, build or register a model, policy or controller image, upload weights, fix a build that failed validation, create a release with hardware variants, publish to a channel, promote (copy) an artifact to another workspace, or revoke or diff an artifact. Not for approving the model (`model-release`) or rolling it out (`deployment-rollout`).
---

# Artifact build

The user ends up with an **Artifact** (`art_...`): the deployable package of one Model, described by a manifest of layers, each with a role, a SHA-256 digest and a size. A model release Artifact has an `inference_server` layer (a container image pinned by digest, which stays in the user's registry) and usually a `weights` layer (the model files, stored by rFabric). An **ArtifactBuild** (`abld_...`) is the resumable upload that produces it. An **ArtifactRelease** (`arel_...`) is a named, versioned set of Artifacts, one variant per hardware selector; an **ArtifactChannel** (`achn_...`), called artifact channel here, is a stable name such as "production" that points at the currently published release.

Artifact statuses: `building` -> `validating` -> `ready` or `failed`; a `ready` one can become `revoked`.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

Main path: the image is registered with the `rfabric` CLI. With a shell you run it after the user approves; without one, the user runs it in a terminal or in CI.

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the model and the packaging rule | agent | `models.get`, `workspaces-settings.get-effective` | - |
| 2 | Build, push and register the image and weights | agent with a shell; otherwise user, in a terminal with Docker, or CI | - | the image build, the upload, validation |
| 3 | Confirm the Artifact | agent | `artifacts.get`, `fleets.deployable-artifacts` | - |
| 4 | Optional: release with variants, publish to an artifact channel | agent | `artifact-releases.create`, `artifact-releases.variants`, `artifact-channels.publish` | - |

Without the CLI's register command, the agent does the registration through operations: section "Register through operations".

## Before you start

- **Permissions** (`introspect.whoami`): `artifact:build` for every build step (roles `owner`, `admin`, `operator`); `artifact:create` for releases, variants and artifact channels, and `artifact:publish`, `artifact:revoke` for those actions (`owner`, `admin`); `artifact:read` to list and diff (`owner`, `admin`, `operator`, `member`).
- **Needs**:
  - a Model (`model-release`) that is `approved` or `deployed`; or `candidate` or `evaluated` when the workspace allows packaging before approval (step 1). An imported model must have finished copying its weights.
  - a container registry the machines that run the image can pull from: `compute-setup` (Container registry access) has the rule per pool. For a simulation suite on rFabric's pools and connected pools: Amazon ECR or Google Artifact Registry connected as a container registry, or a publicly readable repository on any other registry host.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which model version | the Artifact belongs to one Model | `models.names`, then `models.versions` |
| Registry and repository to push to | the `inference_server` layer names it | theirs; they need push rights |
| Weights directory, or none | the `weights` layer | the trained policy's files; none when the image contains the weights |
| Platform the image runs on | the build platform, recorded as `targetAssumptions.architecture` | `amd64` or `arm64`: what the robots or the simulation pool run |

## Decisions

Who registers the image:

| Option | Choose when | Consequence |
| --- | --- | --- |
| `rfabric artifact-build register` (recommended) | always, unless the next row applies | one command reads the image manifest with the user's Docker login, packs the weights in the layout robots accept, uploads what is missing, finalizes and waits. A rerun returns the same Artifact |
| Operations ("Register through operations") | the manifest needs more than register writes: other layer roles, `variantSelectors`, `minimumRfabricdVersion` | the layer files are prepared first; you declare every layer's digest and size |

When the model is not approved yet:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Approve first (`model-release`) | the evidence does not need a runnable Artifact | nothing else changes |
| Allow packaging before approval | the model must run in simulation to earn its approval | workspace setting `artifact.preApprovalPackaging` becomes true for everyone in the workspace. Rollouts, releases and promotions still refuse an unapproved model |

## Steps

### 1. Check the model and the packaging rule

`models.get`: note `status`, `name`, `version`. For `candidate` or `evaluated`, read `workspaces-settings.get-effective` with `key` `artifact.preApprovalPackaging`. When its `value` is false, put the second decision to the user; on their yes, `workspaces-settings.replace` with that `key` and body `{"value": true}` (a workspace admin's change; undo with `{"value": false}`). A write refused with `ancestor_locked` means a level above enforces the value: `workspace-setup` says how enforcement works.

### 2. Build, push and register

rFabric does not build images. It records the image by digest, and the machine that runs it pulls it from the registry. Fill the block in with the user's registry, the platform and the model id.

- With a shell, run actions 2 to 6 yourself after the user approves: Docker pushes with the user's registry login, and the `rfabric` CLI registers with the user's sign-in. Action 5 is needed only when `rfabric auth status` shows no sign-in.
- A missing registry sign-in (action 1) stays with the user: `docker login` asks for a password, which must not enter the conversation.
- Without a shell, hand the whole block over.

```text
Your turn - your terminal with Docker, in the directory of your Dockerfile (or the same commands in CI)
Why: the Artifact pins your image by digest, so what is evaluated is exactly what ships.
Who: someone who may push to <registry>/<repository> and holds build on artifact in rFabric (owner, admin or operator).

1. Sign in to the registry, if it is private:
   docker login <registry>
2. Build for the machines that will run it, and push:
   docker build --platform linux/<amd64|arm64> -t <registry>/<repository>:<tag> .
   docker push <registry>/<repository>:<tag>
3. Read the digest the registry gave it (line "Digest:"):
   docker buildx imagetools inspect <registry>/<repository>:<tag>
4. Put the model files the image loads into one directory, laid out as the image reads them under /rfabric/weights.
5. Install the rfabric CLI and sign in, if you have not:
   curl -fsSL https://get.rfabric.io/cli.sh | sh
   rfabric auth login
6. Register (use the digest of step 3; leave --weights out when the image contains its weights):
   rfabric artifact-build register <registry>/<repository>@sha256:<64 hex> --weights <directory> --model <model id> --timeout 30m

Creates: the image in your registry, and in rFabric an Artifact of model <name> <version> with a copy of the weights. The image itself stays in your registry: keep it there as long as the Artifact is used.
Undo: an Artifact that is ready cannot be deleted, only revoked. Deleting the image is yours to do in the registry.
Bring back: the artifact id the last command prints (art_...), or its exact error message.
Then I: read the Artifact and confirm it is ready.
```

- The command waits for validation up to `--timeout`. Run again, it finds the same Artifact and uploads nothing.
- Always pass `--model`: without it the CLI registers under a model named after the repository.
- A reference without a registry host is read from the local Docker engine, and only machines that already hold the image can run it.

What the image must do:

- Hold code and libraries. Read the weights from `/rfabric/weights`: rFabric mounts the `weights` layer there read-only for a simulation run, and `rfabricd` points that path at the active version on a robot. An image may contain its weights instead; then there is no `weights` layer.
- To run as the candidate of a simulation suite, answer the mission commands the simulator's adapter profile declares (`readiness`, `start`, `status`, `cancel`, each printing one JSON object): `simulator-setup`.

Verify: `artifacts.get` with the artifact id the register command printed.

### 3. Confirm the Artifact

- `artifacts.get`: `status` `ready`, `verifiedAt`, `manifest`, `checksum`. `driftFlags` reports a changed `dependency_manifest` layer against the previous version of the name.
- `ready` means the stored bytes match the manifest. It does not mean the policy was run: that is an evaluation (`simulation-suite`, `evaluation-job`).
- `artifacts.diff` with `compareToId` (another version of the same name) lists layers `added`, `removed` and `changed` with the size delta. `artifacts.lineage` shows the Model it packages.
- `fleets.deployable-artifacts` (path: a fleet id) lists the Artifacts a rollout to that fleet accepts, each with its `evaluationPass` precheck and whether it is `current`. An Artifact missing there is not `ready`, packages an unapproved model, or does not fit the fleet's robots.

A `ready` Artifact is immutable (only `tags`, `annotations`, `meta` change) and cannot be deleted.

### 4. Optional: release with variants, publish

Use a release when one model ships as several Artifacts, for example one per architecture or accelerator. A rollout of an Artifact that belongs to a release gives each robot the variant matching its hardware.

1. `artifact-releases.create` with `workspaceId`, `name`, `version`, `sourceModelId` and `requiredMatrix`: the selectors to cover, each `architecture` with optional `accelerator` and `embodiment`. It starts `incomplete`.
2. `artifact-releases.variants` per Artifact with `artifactId` and its `selector`. The Artifact must be `ready` and its model approved. The release is `complete` when `coverageGaps` is empty.
3. `artifact-releases.resolve-variant` with a robot's `architecture` (and `accelerator`, `embodiment`) answers which variant it would get.
4. `artifact-channels.list`, or `artifact-channels.create` with `workspaceId` and `name`. Then `artifact-channels.publish` with `releaseId`: the artifact channel's `currentReleaseId` moves to this release. Say so first: everything that follows the artifact channel now sees this release. To undo, publish the previous release again.

## Register through operations

For the second row of the first decision. Steps A to D replace action 6 of the block in step 2; actions 1 to 4 of that block come first (build, push, collect the weights).

### A. Prepare the layer files

You upload each layer from a file in your working directory. With a shell, run the commands of this block yourself after the user approves; without one, hand it over:

```text
Your turn - your terminal, in the directory this agent works in
Why: I upload each layer from a file here, and rFabric checks every byte against the digest in the manifest.

1. The image manifest, byte for byte as the registry serves it:
   docker buildx imagetools inspect --raw <registry>/<repository>@sha256:<64 hex> > image-manifest.json
2. The weights, as one uncompressed tar that holds files only (skip this when the image contains its weights):
   (cd <weights directory> && find . -type f | sed 's|^\./||' | LC_ALL=C sort | COPYFILE_DISABLE=1 tar -cf "$OLDPWD/weights.tar" --format=pax -T -)
3. Check the tar: every line is a file at the path the image reads under /rfabric/weights, none starts with "./" or "/":
   tar -tf weights.tar

Creates: image-manifest.json and weights.tar in this directory. Delete them once the Artifact is ready.
Bring back: tell me when both files exist.
Then I: measure both, check the manifest against the image digest, and open the build.
```

Then measure each file's size in bytes and SHA-256 (the rFabric agent: `rfabric_upload` with only `path`). The SHA-256 of the image manifest file must equal the image digest; when it differs, the file is not the registry's manifest: repeat action 1.

### B. Open the build

`artifact-builds.create`. The manifest names every layer before any byte moves:

```json
{
  "workspaceId": "wks_...",
  "modelId": "mdl_...",
  "name": "pick-place",
  "version": "3-4f2a9c0d1e2b",
  "payloadClass": "model_release",
  "manifest": {
    "schemaVersion": "1.0",
    "payloadClass": "model_release",
    "layers": [
      { "role": "inference_server", "digest": "<64 hex of the image digest>", "size": 1234, "repository": "ghcr.io/acme/pick-place" },
      { "role": "weights", "digest": "<64 hex of weights.tar>", "size": 987654321 }
    ],
    "targetAssumptions": { "architecture": "arm64" },
    "fullArtifactDigest": "<64 hex>"
  },
  "attestation": { "sourceRef": "<commit, or the image reference>", "buildEnvironmentId": "local", "locksetDigest": "<64 hex of the image digest>" },
  "idempotencyKey": "artifact-build-register-mdl_...-<fullArtifactDigest>"
}
```

- `inference_server`: `digest` and `size` are those of the image manifest file. `repository` is the registry path without tag or digest; only this role takes it.
- `weights`: `digest` and `size` of the weights tar. Robots refuse a tar with folder entries, links, or paths that are absolute or start with `./`. It takes no `path`.
- `fullArtifactDigest`: the SHA-256 of one line `<role>:<digest>:<size>` per layer, in manifest order, each ending in a newline. Write those lines to a file and measure it.
- `name` and `version`: the model's name, and `<model version>-<first 12 hex of fullArtifactDigest>`. They are unique together in the workspace, and a name within two characters of another artifact name is refused.
- `targetAssumptions.minimumRfabricdVersion` (optional): robots reporting a lower or unknown `rfabricd` version cannot receive the Artifact.
- All three `attestation` fields are required. The same `idempotencyKey` returns the same build and Artifact, so a retry is safe. The values above are the ones the CLI writes, so both paths find the same Artifact.

The response holds `build` (`status` `active`, `expiresAt`) and `artifact` (`status` `building`). Uploads and finalize are refused after `expiresAt`.

### C. Upload the layers the build lacks

1. `artifact-builds.get`: `layers` maps each role to `uploaded`. Skip the uploaded ones.
2. Per missing layer, `artifact-builds.layers-upload` (path `id`, `role`). The grant is issued for the size and SHA-256 the manifest declares.
   - `kind` `single`: send the whole file to `url` with `method` and `headers`.
   - `kind` `multipart`: send part n (from byte (n-1) x `partSizeBytes`, the last part shorter) to its `url` in `parts`, keep each `etag`, then `artifact-builds.layers-upload-complete` with `uploadId` and every `{"partNumber", "etag"}`.
3. Call `artifact-builds.layers-upload` again to get fresh URLs after an interruption.

Tell the user each layer's size before sending and report each layer as it completes.

### D. Finalize and wait

`artifact-builds.finalize` checks that every layer is stored with the manifest's size and returns the Artifact in `validating`; the build becomes `finalized`. Validation then reads every layer to verify its digest, as a background Operation (`operations.list` with `resourceType` `artifactBuild` and `resourceId` the build id).

`artifact-builds.wait` with `timeoutMs` returns the Artifact once it is `ready`, `failed` or `revoked`. A 409 `artifact_not_settled` means still validating: call it again. Large weights take longer to read; report at each call that it is still validating. Then step 3.

## After the build

| Goal | Call | What the user must know |
| --- | --- | --- |
| Promote to another workspace of the organization (a copy) | `promotions.artifacts-promote` with `targetWorkspaceId`, optional `disclosureLevel` | the copy is named `<name>-promoted`; the user needs access to both workspaces. A promotion gate of the source workspace or its organization can refuse it until its proof exists: `policy-automation` |
| Withdraw | `artifacts.revoke` with `reason` | cannot be undone. New rollouts refuse it. Robots already running it keep running it: list them with `deployments.list` filtered by `artifactId` and `models.impact`, then roll back with `deployment-rollout` |
| Record a correction | `artifacts.create-corrections` with `correction`, `reason`; read with `artifacts.list-corrections` | an append-only note beside the frozen Artifact |
| Remove an unfinished one | `artifacts.delete` | refused once the Artifact is `ready` or `revoked` |

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 409 on `artifact-builds.create`, message "only approved models may be packaged" (the CLI adds the model's status) | the model is `candidate` or `evaluated` and the workspace does not allow packaging before approval | the second decision: approve the model, or allow it |
| 409, message "already has version" | that name and version exist | read it with `artifacts.list` (`modelId`); when it is the same layers, use it; else choose another `version` |
| 409, message "near-duplicates existing stream" | the name differs from an existing artifact name by one or two characters | use the existing name, or a clearly different one |
| 409 `model_weights_not_ready` | the model's import is still copying | wait for its Operation (`model-release`) |
| 422 `VALIDATION_ERROR` on create | the manifest or attestation is invalid (`details` name the field), or the model is in another workspace | fix the body |
| 403 `permission_denied` | the user lacks the `artifact` action the message names | an organization admin grants it, or someone who holds it runs the step |
| The CLI reports that the image manifest cannot be read, or does not hash to its digest | not signed in to the registry, a wrong digest, or a tag beside the digest | `docker login <registry>`, then the reference as `<registry>/<repository>@sha256:<64 hex>` |
| 422 `invalid_layer_role` | the role is not in the manifest (`details` list `layers`) | use a declared role |
| 422 `upload_incomplete` | storage refused the parts (`details` hold `reason`: `InvalidPart`, `InvalidPartOrder`, `NoSuchUpload`, `EntityTooSmall`) | request the upload again and resend the parts |
| 409 on upload or finalize, "has expired" or "is 'expired'" | the build passed `expiresAt` | delete the unfinished Artifact, then open a build with a new `idempotencyKey` |
| 422 on finalize with `offendingLayers` in `details` | a layer is missing or has another size than declared | upload that layer again; when the file itself changed, open a build with the right digest and size |
| Artifact `failed` (the CLI: "is failed: ...") | `validationResult.failureReason` names the layer: digest mismatch, size, missing: the bytes stored are not the ones declared | delete the failed Artifact (`artifacts.delete`), then register again. Through operations: measure the files again first |
| 409 `artifact_not_settled` | validation still runs | call `artifact-builds.wait` again |
| `subject_not_runnable` when a simulation suite is preflighted or launched | the Artifact has no `inference_server` layer with a `repository` | build one that names the image |
| `container_registry_not_connected`, `image_access_denied`, `image_not_found` or `image_platform_mismatch` when a simulation suite is preflighted or launched | the pool cannot pull the image: private registry not connected, wrong reference, or built for another platform | `compute-setup`; or push to a registry the pool reaches; or rebuild for the pool's platform |
| 409 `artifact_model_not_approved` on a variant or rollout | the Artifact's model is not `approved` or `deployed` | `model-release` |
| 403 on `promotions.artifacts-promote` | no access to one workspace, no promotion agreement, or "Promotion blocked by policy" with the gate's name and the missing proof | the message names what is missing; for a gate, supply the proof it names (the Model's approval: `model-release`; a passing evaluation: `simulation-suite` or `evaluation-job`); `policy-automation` reads and changes the gate |
| 409 on `artifact-channels.publish` | the release is `incomplete` (read `coverageGaps`), or in another workspace | attach the missing variants (step 4) |
| 422 on `artifact-releases.resolve-variant` with `matches` in `details` | more than one variant fits the robot | make the selectors distinct |

## Done when

- [ ] `artifacts.get` shows `status` `ready` and `verifiedAt`, and its `inference_server` layer names the `repository` and digest the user pushed.
- [ ] The user knows the artifact id, its name and version, and which Model it packages.
- [ ] When a release was asked for: `artifact-releases.get` shows `complete` with no `coverageGaps`, and `artifact-channels.get` shows it as `currentReleaseId`.

## Next

- `simulation-suite`: run the Artifact as the candidate in simulation. `evaluation-job`: evaluate it on a real robot by hand, or as replay.
- `model-release`: approve the model, when it was packaged before approval.
- `deployment-rollout`: roll the Artifact out to robots in stages.
- `ci-integration`: have CI build, register and evaluate on every change.
- `policy-automation`: gate promotions of Models and Artifacts out of a workspace.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Register in one command | `rfabric artifact-build register <repository>@sha256:<digest> [--weights <dir or file>] --model <model-id> [--source-ref <ref>] --timeout 30m`; prints the artifact id |
| Allow packaging before approval | `rfabric settings set artifact.preApprovalPackaging=true --scope-type workspace --scope-id <workspace-id>` |
| Open a build | `rfabric artifact-build create --data @<file>` |
| Upload a layer | `rfabric artifact-build upload <build-id> --layer-role <role> <file>` |
| Finalize, wait | `rfabric artifact-build finalize <build-id>`, `rfabric artifact-build wait <build-id>` |
| Read, list | `rfabric artifact get <artifact-id>`, `rfabric artifact ls` |
| What a fleet can deploy | `rfabric fleet deployable-artifacts <fleet-id>` |
| Revoke | `rfabric artifact revoke <artifact-id> --reason "<text>"` |
