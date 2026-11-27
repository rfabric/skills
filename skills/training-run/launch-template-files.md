# Launch templates as files

Read this when the user keeps, or wants to keep, launch templates as files in a Git repository: "training as code", `rfabric training apply` or `rfabric training export`, a directory such as `training/`, or a template refused with `definition_repository_managed`. Step 3 of `SKILL.md` covers what each field of a template means; this file covers the files and their preview and apply. A pipeline that applies them is `ci-integration`.

rFabric takes the directory's launch template files in one call, compares each file with the template of its slug in the workspace, and creates or updates what changed. A template written this way is managed from that repository and directory: only the next apply from there changes it.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Get the files: export what the workspace has | agent | `definition-directories.export` | none |
| 2 | Edit the files | agent or user, in the repository | none | none |
| 3 | Preview | agent | `definition-directories.create` (`action` `preview`) | none |
| 4 | Apply | agent, or the user's pipeline | `definition-directories.create` (`action` `apply`), `operations.get` | the Operation |

## Before you start

- **Permissions**: preview and export need `training:read` (member, operator, admin, owner); apply needs `training:configure` (admin, owner). A 403 reads "Missing grant training:<action> in workspace <id>".
- **Needs**: the repository checked out where you can read its files; the pools, compute targets and sim assets the files name, in the workspace.
- **Ask the user**: the directory's path inside the repository (default `training`), and whether a pipeline will apply it (`ci-integration`) or people apply by hand. Recommend one owner: mixing the two leads to refusals.

## The files

`<directory>/launch-templates/<slug>.yaml` (or `.yml`, `.json`), one template per file:

```yaml
$schema: https://api.rfabric.io/api/definition-directories/schemas/launch_template.json
formatVersion: 2
kind: launch_template
slug: act-pick-and-place
name: ACT pick and place
poolRef: <pool name>
datasetFormat: lerobot_v3
architecture: act
defaultConfig:
  command: [python, /opt/trainer/train.py]
  steps: 20000
  batchSize: 8
defaultComputeConfig:
  image: <repository>@sha256:<64 hex>
  gpuCount: 1
codeVersion: <commit the image was built from>
guardrails:
  allowedOverrideKeys: [steps, batchSize, image]
  maxRuntimeS: 14400
  maxGpuHours: 4
requiredTags: []
```

- The header: `formatVersion` `2` (an integer), `kind` `launch_template`, `slug` (1 to 128 characters, unique in the workspace). No workspace id and no rFabric id anywhere.
- The body is the create body of step 3 of `SKILL.md` without `workspaceId`, `slug`, `computeTargetId`, `computePoolId` and `simAssetVersionIds`, plus `tags` and `attributes`. In their place, references by name:

| Field | Names | Resolves |
| --- | --- | --- |
| `poolRef` | a ComputePool by its `name` | among the pools the workspace can use |
| `computeTargetRef` | a ComputeTarget by its `name` | among the workspace's, its organization's and rFabric's targets that offer a pool; a name carried by more than one is ambiguous |
| `simAssets` | sim assets to stage: `slug`, `slug@<version>` or `slug@latest-published` | the workspace's published versions |

- `codeVersion` only with `defaultComputeConfig.image`.
- Every rule of a template created through `launch-templates.create` still applies: an image pinned by digest, a selectable pool or target, published sim assets.
- The JSON Schema in the `$schema` line lets an editor check the file.
- Evaluation definition files (`evaluation-definitions`) live in another directory: one request manages either launch template files or evaluation definitions, never both.

## Steps

### 1. Get the files

`definition-directories.export` with query `workspaceId` and `kind` `launch_template` returns `files`, each a `path` and its `content`, one per template of the workspace (pool and target as names, sim assets as references, the image and `codeVersion` as stored). Write them into the directory. A preview of an unchanged export reports every entry `unchanged`.

### 2. Edit the files

Show the user each change as a diff of the file. Nothing reaches rFabric until a preview or an apply.

### 3. Preview

`definition-directories.create` with `action` `preview` writes nothing. Body:

- `workspaceId`; `kinds` `["launch_template"]`;
- `path`: the directory's path inside the repository (`""` for the root);
- `files`: every file as `{"path", "content"}`, `path` relative to the directory, `content` its text;
- `assetContents`: `[]`;
- `ci`: see "Who manages a template" below;
- `launchTemplateImages` (optional): per template slug, an `image` built for it and the `codeVersion` it was built from, which win over the file's image (below).

| Field | Tell the user |
| --- | --- |
| `problems` | each `path`, `field`, `line`, `code` and `message`: what blocks an apply |
| `entries` | per file: `action` `create`, `update` or `unchanged`, and for an update each changed field with `before` and `after` |
| `removed` | templates managed from this directory that no file holds any more; `deleted` false until an apply deletes them |

Done when `problems` is empty and the user has seen the `entries` table.

### 4. Apply

Before the call tell the user what the preview showed. Runs already launched keep the config they started with; `deprecateRemoved` `true` also deletes the templates listed in `removed`, which cannot be undone.

`action` `apply` returns an Operation. Poll `operations.get` until `succeeded` (`result` lists every entry with its `id`) or `failed` with `error` `code` `definition_directory_invalid` (`result` has the `problems`; nothing was applied). Send `idempotencyKey` (8 to 200 characters) so a repeat returns the same Operation.

Done when the Operation is `succeeded` and a second preview reports every entry `unchanged`.

## The image and its commit

A pipeline builds a new trainer image and writes it into the template at apply time, without editing the file. Per template the image and `codeVersion` come from the first that has one:

1. its `launchTemplateImages` entry (`codeVersion` is the entry's, else none);
2. the file's `defaultComputeConfig.image` and `codeVersion`;
3. the template's stored image and `codeVersion`: a file without an image never clears the image a pipeline wrote.

The build's commit (`commit` in `ci`) is never taken as `codeVersion`. On rFabric's pools and connected pools a template whose image changes is checked on the pool a launch from it lands on, as at a launch (`trainer-image.md`, Where to push it).

## Who manages a template

- An apply that carries `ci` records it, with `path`, on every template it writes. From then on `launch-templates.update` and `launch-templates.delete` refuse that template with `definition_repository_managed` (409), whose `details` name the `kind`, `slug`, `repository`, `directoryPath` and `commit`; launches and previews from it work as before.
- A template created through `launch-templates.create` (no `ci`) with the slug of a file is adopted by the first apply: an `update` whose changes include the `repository` of `ci` and `directoryPath`.
- An apply without `ci` writes unmanaged templates.
- The CLI sends `ci` by itself: in a pipeline the build's identity; in a local checkout the `origin` remote, the HEAD commit and `local` as the build. To act on a managed directory through the operations, send a `ci` with the same `repository`, and the directory's `path`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `kind_not_requested` | the directory holds a file of another kind (an evaluation definition) | move it to the evaluation directory; the CLI names `rfabric eval apply` for it |
| `reference_unresolved` | `poolRef`, `computeTargetRef` or a `simAssets` entry names nothing the workspace can use, or more than one; or a `launchTemplateImages` slug that no file holds | fix the name, or add the file |
| `VALIDATION_ERROR` on `codeVersion` | `codeVersion` without an image | add the image, or drop `codeVersion` |
| `container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch` on `defaultComputeConfig.image` | rFabric cannot read the new image through the container registry, or it is built for another platform than the pool's machines | `trainer-image.md`, Where to push it |
| `definition_repository_managed` | another repository or directory manages the slug | apply from the owning directory, or rename the slug |
| `launch_template_in_use` on `deprecateRemoved` | an improvement program launches from a template the apply would delete; nothing was applied | `improvement-program`: point it at another template first, or keep the file |
| `VALIDATION_ERROR` (422) on `kinds` | `launch_template` listed beside another kind, or a test run of templates | send `kinds` `["launch_template"]` alone; templates have no test run |
| `FORBIDDEN` 403 | `training:read` (preview, export) or `training:configure` (apply) is missing | an organization admin grants it |

## The rfabric CLI

The commands run in the repository; `--dir` defaults to `training`.

| Step | CLI |
| --- | --- |
| Export | `rfabric training export [--dir <dir>]` |
| Preview | `rfabric training apply --preview [--dir <dir>]` |
| Apply | `rfabric training apply [--dir <dir>] [--deprecate-removed] [--markdown <file>]` |
| Apply with a pipeline's image | `rfabric training apply --image <slug>=<repository>@sha256:<digest> --code-version <commit>` (`--image` repeatable, `--code-version` only with it) |
