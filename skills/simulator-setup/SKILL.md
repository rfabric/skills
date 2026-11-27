---
name: simulator-setup
description: >-
  A simulator a workspace can run - a published adapter profile on a platform simulator image or on your own image, plus the published sim assets its scenarios load, optionally as a sim asset pack. Use when asked to set up or add a simulator (MuJoCo, Gazebo, Isaac Sim), clone, publish or retire an adapter profile, pin a simulator image, register scenes, objects or a pack, or validate, trace or deprecate a sim asset version. Not for building scenes or robot models - `sim-asset-build`; not for compute pools - `compute-setup`.
---

# Set up a simulator

The user ends up with everything a simulated scenario pins, published and reproducible:

- **SimAdapterProfile** (`sapf_...`): how a simulator and the candidate run for one simulation attempt: the `adapter` (`gazebo`, `mujoco`, `isaac-sim`), the simulator image pinned by digest, commands, resources, transport and capabilities. A **platform profile** is one rFabric maintains (`isSystemManaged` true, no workspace), readable from every workspace.
- **Platform simulator image**: rFabric's image for one adapter. It runs the default simulator program, which loads a staged world and robot and runs a mission described as data, so most users build no image.
- **SimAsset** (`sma_...`) and **SimAssetVersion** (`smav_...`): a named scene, object or robot description, and its immutable content.
- **SimAssetPack** (`smpk_...`) and its versions (`smpv_...`): a named, versioned set of published sim asset versions, each under a role.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Pick the simulator and the route | agent, user decides | `sim-adapter-profiles.list` | - |
| 2 | Build and push a simulator image (customer image only) | agent with a shell; otherwise user, in a terminal with Docker | - | the image build and push |
| 3 | Register the adapter profile (clone or customer image) | agent | `sim-adapter-profiles.clone`, `sim-adapter-profiles.create`, `sim-adapter-profiles.update` | - |
| 4 | Publish the profile | agent | `sim-adapter-profiles.publish` | - |
| 5 | Register the sim assets | agent | `sim-assets.list`, `sim-assets.create`, `sim-assets.create-versions`, `sim-assets.versions-publish` | upload, then validation of each version |
| 6 | Validate the versions | agent | `sim-assets.versions-list`, `sim-assets.versions-validate`, `operations.get` | validation Operation |
| 7 | Group versions into a pack (optional) | agent | `sim-asset-packs.create`, `sim-asset-packs.create-versions`, `sim-asset-packs.versions-publish` | - |
| 8 | Check the setup | agent | `sim-adapter-profiles.get`, `compute-pools.list`, `compute-handler-images.list` | - |

With a platform profile used as it is, steps 2 to 4 do not apply.

## Before you start

- **Permissions** (read them with `introspect.whoami`):

| Action | Permission | Built-in roles |
| --- | --- | --- |
| Create, clone or edit a profile, a sim asset, a version or a pack; rerun validation | `evaluationDefinition:author` | operator, admin, owner |
| Publish or deprecate a profile | `evaluationDefinition:publish` | admin, owner |
| Publish a sim asset version or a pack version | `simAsset:publish` | operator, admin, owner |
| Deprecate a sim asset version | `simAsset:deprecate` | operator, admin, owner |
| Read pools and handler images | `compute:read` | member and above |

  An operator can prepare a profile draft; an admin or owner publishes it. Say so in the plan when the user is an operator. A 403 names the missing permission in the API's own words, for example `definition.author` for `evaluationDefinition:author` and `simAsset.publish` for `simAsset:publish`.
- **Needs**:
  - A compute pool that runs simulation attempts (task type "sim.attempt"): `compute-setup`.
  - A robot model (a `robot_description` sim asset version): `sim-asset-build` (its robot models file).
  - Customer image only: Docker with buildx on the user's machine, and a container registry the pool can pull from (`customer-image.md` lists what each kind of pool can pull).
  - Customer image only: pull access to the platform simulator image: rFabric grants it to your registry account; ask your rFabric contact before you start.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Simulator engine | selects the `adapter` | MuJoCo when they have an MJCF scene, Gazebo for SDF worlds and ROS 2 stacks, Isaac Sim for OpenUSD scenes and RTX rendering |
| How the candidate talks to the simulator | selects the transport | `policy-bridge/1` unless their software is a ROS 2 stack (Decisions) |
| Whether the default simulator program can run their mission | platform image or customer image | default yes; no when the task needs simulator code of their own |
| World and object files, with their licence | sim assets | local files, or a build from `sim-asset-build` |

## Decisions

**Which profile**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Platform profile as it is (recommended) | the default simulator program can run the mission, and the profile's resources and timeouts fit | nothing to build or publish; scenarios pin the platform profile version by id |
| Clone of a platform profile | same image, other resources, GPUs, deadlines, timeouts or candidate command | a draft the workspace owns, edits and publishes; later platform versions do not reach it |
| Customer simulator image | the task needs simulator code of its own (a simulator program) | the user builds, pushes and maintains an image, and the pool needs pull access to its registry |

**Which transport** (a profile has exactly one)

| Option | Choose when | Consequence |
| --- | --- | --- |
| `policy-bridge/1` (recommended) | the candidate is a policy or controller stepped by the simulator | lockstep: physics advances only when an action arrives, so a run is repeatable |
| `ros2` | the candidate is a ROS 2 Jazzy stack | the simulator publishes the clock and runs free at a real-time factor: not lockstep, not deterministic |

| Adapter | Runs on | Platform profile slugs |
| --- | --- | --- |
| `gazebo` | CPU | `gazebo-policy-bridge`, `gazebo-ros2` |
| `mujoco` | CPU or GPU | `mujoco-policy-bridge`, `mujoco-ros2` |
| `isaac-sim` | NVIDIA RTX GPU, `linux/amd64` | `isaac-sim-policy-bridge`, `isaac-sim-ros2` |

The `local-process` adapter is reserved to rFabric: creating, editing, cloning or publishing such a profile answers `adapter_reserved`.

## Steps

### 1. Pick the simulator and the route

1. `workspaces.list`, then `sim-adapter-profiles.list` with `query` `{"workspaceId": "wks_...", "status": "published"}`: the workspace's own profiles and the platform profiles together. `{"isSystemManaged": true, "adapter": "mujoco", "status": "published", "sort": "version:desc"}` lists only platform profiles of one adapter.
2. A slug has one row per version. Use the highest `version` of the slug; its `id` is what a scenario pins.
3. Read the candidate profile's `spec` and tell the user what it means:

| Field | Tells the user |
| --- | --- |
| simulator `image` | the exact image every attempt runs, pinned by digest |
| `capabilities`: `programs` | `default/1` means the default simulator program: missions are data, no simulator code |
| `capabilities`: `formats` (`world`, `robot`) | the sim asset formats this simulator loads; a scenario with another format is refused at publish |
| `capabilities`: `embodiment` | the action targets, control modes, state quantities, cameras and sensors a scenario may declare |
| `transport` | `policy-bridge/1` or `ros2` |
| simulator `faultArgv` keys | the fault kinds a scenario may inject |
| simulator and `autonomy` `resources` and `gpus` | the machine one attempt needs: both containers run on one machine, so vCPU, memory and GPUs add up |
| `realTimeFactorMax` | fastest simulated-to-wall speed; a launch estimates each case at `limits.missionSimS` / `realTimeFactorMax` + 120 seconds of worker time |

4. State the route (Decisions) and the plan. A workspace profile that already fits needs no new one.

Done when: the user has chosen the adapter, the transport and one of the three routes, and for a platform profile you hold its `id`.

### 2. Build and push a simulator image (customer image only)

Read `customer-image.md` in this skill's directory and fill in its block. With a shell, run its commands yourself after the user approves; without one, hand it over as a "Your turn" block. It ends with an image reference `<registry>/<repository>@sha256:<64 hex>` and the image's capability document.

Done when: you hold the digest reference and the capability document.

### 3. Register the adapter profile

**Clone** (also the usual start for a customer image): `sim-adapter-profiles.clone` with `pathParameters` `{"id": "<platform profile id>"}` and body `{"workspaceId": "wks_..."}`. It returns a `draft` in the workspace with the source's `slug` and the next `version` for that slug. A clone cannot be renamed to another slug.

**With a slug of its own**: `sim-adapter-profiles.create` with `workspaceId`, `slug`, `name`, `adapter`, `adapterVersion`, `realTimeFactorMax` and the whole `spec`; `customer-image.md` has a body.

Then edit the draft with `sim-adapter-profiles.update`. `spec` is one field: send the complete `spec` you read, with your changes, never a fragment.

| Change | Field | Rule |
| --- | --- | --- |
| Customer image | simulator `image`, `argv` | `image` is `<registry>/<repository>@sha256:<64 hex>`; `argv` starts the program: `["rfabric-simulator", "run", "--program", "<module>:<Class>"]` |
| What the image supports | `capabilities` | the document the image printed, or no `capabilities` at all when it printed an empty one (`customer-image.md`); never keep the platform profile's document for another program |
| Label of the simulator build | `adapterVersion` | free text, for example the engine or program version |
| Machine size | simulator and `autonomy` `resources` (`vcpu`, `memoryMiB`), `gpus`; `preflight` `minDiskFreeGb` | the sum must fit one machine of a pool that runs simulation attempts (step 8) |
| Slow candidate (large model) | `transport` `actionTimeoutS`, `clockStallS`, `deadlines` | under `policy-bridge/1`, `clockStallS` must be greater than `actionTimeoutS` |
| Speed | `realTimeFactorMax` | set it to what the simulator reaches; it only sizes the worker-hour estimate |
| Environment variables | simulator and `autonomy` `env` | never `ROS_DOMAIN_ID`, `ROS_AUTOMATIC_DISCOVERY_RANGE`, `ROS_STATIC_PEERS`, `RMW_IMPLEMENTATION`, `FASTDDS_BUILTIN_TRANSPORTS`, `RFABRIC_SIMULATOR_STATE_DIR`: rFabric sets them |

The profile never names the candidate image: the candidate is what a launch evaluates.

Done when: `sim-adapter-profiles.get` shows the draft with the intended `spec`.

### 4. Publish the profile

Before the call, tell the user: publishing freezes this version. It cannot be edited or unpublished afterwards; a change is a new version with a new id.

`sim-adapter-profiles.publish` with the draft's `id`. It checks the `spec` again, then sets `status` `published` and returns the profile with its `digest` (the digest of `spec`).

- **Change a published profile**: `sim-adapter-profiles.create-versions` makes a draft copy with the next `version` and a new `id`; edit and publish it. Scenarios keep pinning the old id until a new scenario version pins the new one (`simulation-suite`). `sim-adapter-profiles.list-versions` shows the history, oldest first.
- **Retire a version**: `sim-adapter-profiles.deprecate`. Before the call, tell the user it affects running work: no new scenario can pin the version, and every suite launch whose scenario pins it is refused with `adapter_profile_not_published`. There is no way back to `published`. Find the scenarios first with `evaluation-scenarios.list` and `query` `{"adapterProfileId": "sapf_..."}`.
- **Discard a draft** nobody needs: `sim-adapter-profiles.delete`.

Done when: the profile's `status` is `published`.

### 5. Register the sim assets

A scenario pins one `world` version, one `robot` version (or none) and any number of `inputs`. Register what is missing:

1. `sim-assets.list` with `query` `{"workspaceId": "wks_...", "kind": "scene"}` (also `object`, `robot_description`), and `sim-assets.versions-list` for their versions.
2. New asset: `sim-assets.create` with `workspaceId`, `name`, `slug` and `kind`. A `slug` already used in the workspace answers 409.
3. New version: `sim-assets.create-versions` on the asset. Decide these now, because a version's declaration is fixed once created:

| Field | Set it when |
| --- | --- |
| `format` | always; it must be in the profile's `capabilities` `formats` for its role (`world` or `robot`) |
| `rootPath` | the content is a `.tar` or `.tar.gz` archive: the root document inside it |
| `dependencies` | the content references other versions, for example each object a scene includes; each must already have content |
| `parameters` | scenarios should vary a value of the scene (a ramp angle, a friction, a light): each scene parameter binds a name, type and range to one place in the document. Supported for `openusd`, `mjcf` and `sdf` |
| `license` | the licence is known: an object such as `{"spdx": "<SPDX id>"}` |

4. Content: upload it exactly as `sim-asset-build` describes for local files in its robot models file. Building a scene from a prompt, importing or converting a robot model are in that skill too; the outputs of a build are already registered, and that skill qualifies and publishes them.
5. Wait for the validation (step 6), then publish with `sim-assets.versions-publish`, dependencies first. Publishing does not wait for the previews. Tell the user a published version is immutable: new content is a new version.
6. A suite whose protocol gates a release, and every training launch, stages only versions qualified at `interaction_eval`, dependencies included; qualify them as `sim-asset-build` describes (its step "Qualify, reject, or rebuild"). Advisory suites need published versions only.

Done when: every version the scenarios will pin is `published`, with no `fail` check.

### 6. Validate the versions

Validation starts on its own when a version's content is stored. It checks the content against its format (the scene opens or compiles, every referenced file resolves inside the version or its dependencies, scene parameter bindings resolve), measures the geometry, and records the sim asset inventory.

1. Read the version (`sim-assets.versions-list`, or `sim-assets.list-versions` of one asset). In `validationResults`:
   - `checks`: each `pass`, `warn` or `fail` with a message naming the problem. Report every `fail` and `warn` to the user in their words.
   - `inventory`: the names of the bodies, joints, sites, cameras, sensors and keyframes the content declares. Scenarios must use these names exactly; give them to the user when they write a scenario.
   - `grantedLevel` and the version's `qualification`: `visual_preview` or `perception_eval` come from validation once both previews are ready.
2. Nothing recorded yet: the run is its newest Operation. `operations.list` with `query` `{"kind": "simAsset.validate", "resourceType": "simAssetVersion", "resourceId": "smav_...", "sort": "createdAt:desc"}`, then `operations.get` until it settles. Stop and report after 15 minutes without a result.
3. Run it again with `sim-assets.versions-validate` once the cause of a failed run is fixed (for example a dependency that had no content yet), or when the inventory is missing. It returns an Operation; the previous checks clear until it completes.
4. A `fail` check cannot be repaired in place: fix the files and upload them as a new version.

Done when: each version shows `validationResults` without a `fail` check and, for `openusd`, `mjcf`, `sdf`, `urdf` and `xacro`, an `inventory`.

### 7. Group versions into a pack (optional)

Use a pack to name the set of versions that belong together (a site's scene with its objects and robot) and to version that set as one.

1. `sim-asset-packs.create` with `workspaceId`, `name`, `slug`.
2. `sim-asset-packs.create-versions` with `assetVersionRefs`: one `{"assetVersionId": "smav_...", "role": "<role>"}` per member. Every member must be a published version of the same workspace. Roles are free text; use the roles a scenario pins (`world`, `robot`) for those members.
3. `sim-asset-packs.versions-publish` with the pack version's id (`smpv_...`). Published pack versions are immutable; a changed set is the next version.

A pack records the set. Scenarios still pin sim asset version ids: read them from the pack version's `assetVersionRefs` (`sim-asset-packs.list-versions`).

Done when: the pack version's `status` is `published`.

### 8. Check the setup

1. `sim-adapter-profiles.get`: `status` `published`; note `id`, `version`, `digest`.
2. `compute-pools.list`: an `active` pool whose `taskTypes` include "sim.attempt" and whose `capabilities` cover the profile's summed vCPU, memory, GPUs and disk. None: a launch will answer `no_capable_pool`; send the user to `compute-setup`.
3. `compute-handler-images.list` with `query` `{"taskType": "sim.attempt"}`: the handler image rFabric runs each simulation attempt with. Its `imageDigest` and the profile `id` are what a pool qualification records for a gating suite (`compute-setup`).
4. Each sim asset version: `published`, the format is in the profile's `capabilities`, and its `qualification` fits the suite (step 5).
5. Tell the user what is not proven yet: nothing has pulled the simulator image. The first proof is the image check of a suite preflight (`simulation-suite`).

Report the profile id and version, each sim asset version id with its qualification, and the pack version id.

## Retire a sim asset version

1. `sim-assets.versions-usage` with the version id: `jobs`, `runs` and `trainingRuns` that pinned it, and `dependents`, the versions whose content references it. Show the user the counts and the dependents.
2. Before the call, tell the user: deprecation cannot be undone (a deprecated version cannot be published again). It stops new use only: no scenario being published, pack version or training launch can pin it. Published scenarios that already pin it keep running it, and past results keep their record.
3. `sim-assets.versions-deprecate`. Only a `published` version can be deprecated.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 403 on clone, create or update | the user lacks `evaluationDefinition:author` | name the permission; an organization admin grants it |
| 403 on publish or deprecate of a profile | the user lacks `evaluationDefinition:publish`, or the profile is a platform profile | an admin or owner publishes; a platform profile is changed only through a clone |
| `adapter_reserved` (422) | the profile's adapter is `local-process` | use `gazebo`, `mujoco` or `isaac-sim` |
| `image_not_pinned` (422) on publish | the simulator `image` is a tag | use the digest form from `customer-image.md`; `details` lists the image |
| `transport_unsupported` (422) on publish | `transport` is not in `capabilities` `transports` | pick a listed transport, or correct `capabilities` from the image's own document |
| `clock_stall_below_action_timeout` (422) on publish | `clockStallS` (30 when unset) is not greater than `actionTimeoutS` | raise `clockStallS` above the action timeout |
| `env_reserved` (422) on publish | an `env` sets a name rFabric sets itself | remove the names in `details` |
| 422 `VALIDATION_ERROR` on create or update | the `spec` has an unknown key, lacks `missionInterface` or `simulator`, lacks `transport` beside `default/1`, or mixes an image with `local-process` | fix the field named in `details` |
| 409 on update | the profile is `published` or `deprecated` | make a new version (step 4) |
| `asset_scope_invalid` (422) | `robotId` or `datasetId` on a kind other than `robot_description`, both together, or outside the workspace | scope only a robot description, to one of them |
| `asset_dependency_unknown` (422) | a dependency is not a version of this workspace with content | upload the dependency first; ids in `details` |
| `asset_validation_incomplete` (409) on publish | the latest validation has not completed | wait for it (step 6) |
| `asset_validation_failed` (422) on publish | a `fail` check; `details` lists the checks | fix the content, upload a new version |
| `asset_dependency_unpublished` (422) on publish | a dependency is `draft` or `deprecated` | publish the versions in `details` first |
| `sim_asset_version_not_validatable` (409) | the version has no stored content | finish its upload |
| `definition_repository_managed` (409) | the asset is published from files in a Git repository | change the files there and apply the directory (`evaluation-definitions`; the file shapes of sim assets are in `simulation-suite`, its definition directory file) |
| 422 on a pack version | a member does not exist, is in another workspace or is not `published` | publish the member, or remove it |
| 409 on pack publish | the pack version is already published | create the next version |

## Done when

- [ ] `sim-adapter-profiles.get` shows the chosen profile `published`, and the user knows its `id` and `version`.
- [ ] `sim-assets.versions-list` shows every world, robot and input version `published`, without a `fail` check, in a format the profile's `capabilities` list.
- [ ] `compute-pools.list` shows an `active` pool that runs simulation attempts and fits the profile's resources.
- [ ] For a pack: `sim-asset-packs.list-versions` shows the version `published` with the intended members.
- [ ] The user was told that the image is first pulled at a suite preflight.

## Next

- `simulation-suite`: write scenarios that pin this profile and these versions, group them in a suite, preflight and launch it.
- `sim-asset-build`: build a scene for the robot from a prompt, or qualify versions at `interaction_eval`.
- `compute-setup`: add or qualify a pool, or connect the registry of a private image.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| List platform profiles | `rfabric sim-adapter-profile ls --system-managed -f adapter=mujoco -f status=published` |
| Clone a profile | `rfabric sim-adapter-profile clone <profile-id> --workspace <workspace>` |
| Create or edit a profile | `rfabric sim-adapter-profile create --data @profile.json`, `rfabric sim-adapter-profile update <profile-id> --data @changes.json` |
| Publish, new version, retire, history | `rfabric sim-adapter-profile publish <profile-id>`, `versions <profile-id>`, `deprecate <profile-id>`, `history <profile-id>` |
| Create an asset and a version | `rfabric sim-asset create --field kind=scene --field name=<name> --field slug=<slug>`, `rfabric sim-asset create-version <asset-id> --format <format> [--root-path <path>] [--dependency <version-id>]... [--parameters @<file>]` |
| Upload, validate, publish | `rfabric sim-asset upload <version-id> <file>`, `rfabric sim-asset validate <version-id> --wait`, `rfabric sim-asset publish <version-id>` |
| Versions, usage, deprecate | `rfabric sim-asset versions <asset-id>`, `rfabric sim-asset usage <version-id>`, `rfabric sim-asset deprecate <version-id>` |
| Pack | `rfabric sim-asset-pack create --data @pack.json`, `rfabric api post /api/sim-asset-packs/<pack-id>/versions --data @members.json`, `rfabric sim-asset-pack publish <pack-version-id>` |
