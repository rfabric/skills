# Robot models for a sim asset build

Read this when the workspace has no published `robot_description` sim asset version in a target format of the build. It adds one: from rFabric's asset catalog, from a public GitHub or Hugging Face repository, or from local files; converts it when the format is missing; and publishes it. Permissions are those of `SKILL.md`.

An imported version is a draft that records its `source` (`library`, `repository`, the `revision` asked for, the `commit` it resolved to, `path`) and holds the root document with every file it references. A conversion is a draft version with `provenance` `converted` and `conversion` (`sourceAssetVersionId`, `sourceContentHash`, `converter`).

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Choose where the model comes from | user decides | `sim-assets.catalog`, `sim-assets.sources-resolve` | none |
| 2 | Import it, or upload it | agent | `sim-assets.catalog-import`, `sim-assets.imports`, or `sim-assets.create`, `sim-assets.create-versions`, `sim-assets.versions-upload`, `sim-assets.versions-upload-sessions`, `sim-assets.versions-upload-sessions-parts`, `sim-assets.versions-upload-sessions-complete` | `operations.get` until `succeeded` |
| 3 | Convert to a missing format | agent | `sim-assets.versions-convert` | `operations.get` until `succeeded` |
| 4 | Check validation and previews, publish | agent | `sim-assets.list-versions`, `sim-assets.versions-publish` | until validation and previews settle |

## Decisions

| Source | Choose when | Consequence |
| --- | --- | --- |
| Asset catalog (recommended) | the robot is in the catalog | curated models (MuJoCo Menagerie, work-r-labs/robots, robots_usd), each pinned to one commit |
| Repository | the model is in a public GitHub or Hugging Face repository | pinned to the commit the revision resolves to |
| Local files | the model exists only on the user's machine | a version accepts content once: other bytes need another version |

## Steps

### 1. Choose the source

- **Catalog**: `sim-assets.catalog` lists the entries (`query` `search`, `maker`, `robotType`, `format`); show the user the matches for their robot (maker, robot type, formats, licence).
- **Repository**: the URL has the form `https://github.com/<owner>/<name>[/tree/<revision>/<dir> | /blob/<revision>/<path>]` or `https://huggingface.co/[datasets/|spaces/]<repository id>[...]`. `sim-assets.sources-resolve` with body `workspaceId`, `url` and, for a revision containing `/`, `revision` returns the `commit` and the `files` under the URL's directory; a file with a non-null `format` is a root document. Show the user the root documents found and which one you will import. The repository must be public.
- **Local files**: a root document, or a `.tar` or `.tar.gz` archive that holds it and every file it references.

### 2. Import or upload

**Catalog**: `sim-assets.catalog-import` with `pathParameters` `key`, the entry's `key`, and body `workspaceId`; `formats` limits the import to some of the entry's formats. It creates one version per format, each in that format's sibling `robot_description` asset; the operation's description says how that asset is named and found.

**Repository**: `sim-assets.imports` with `workspaceId`, `source` `{"library", "repository", "revision", "path"}` (the first three as resolve returned them, `path` a root document), and either `asset` `{"name", "slug", "kind": "robot_description"}` for a new asset or `simAssetId` to add a version to an existing one.

**Local files**:

1. `sim-assets.create` (`workspaceId`, `name`, `slug`, `kind` `robot_description`) unless the asset exists.
2. `sim-assets.create-versions` for a draft version with its `format` and, for an archive, `rootPath`, the root document inside it.
3. `sim-assets.versions-upload` with the file's `sizeBytes` and `sha256`: it returns the upload session (`sessionId`, `status`, `parts` with presigned URLs). `status` `completed` means the content is already stored: send nothing.
4. `sim-assets.versions-upload-sessions` gives `partSizeBytes`, `partCount` and the `acknowledgedParts`. Upload part n (from byte (n-1) x `partSizeBytes`, `partSizeBytes` long, the last part shorter) to its URL and keep its `etag`. Sign the part URLs you lack with `sim-assets.versions-upload-sessions-parts` (`fromPartNumber`, `toPartNumber`).
5. `sim-assets.versions-upload-sessions-parts-acknowledge` with the `{"partNumber", "etag"}` of each part you sent; a part not acknowledged fails completion with `part_not_acknowledged`.
6. `sim-assets.versions-upload-sessions-complete` with every `{"partNumber", "etag"}`.

A version accepts content once: create another version to upload other bytes.

An import returns `{asset, version, operation}`, a completed upload an `operationId`. Follow the Operation with `operations.get` until `succeeded`. A `failed` one carries an `error` whose `code` is `sim_asset_import_failed` or `sim_asset_conversion_failed` and whose message names the file.

### 3. Convert to a missing format

`sim-assets.versions-convert` with body `format` converts `urdf` or `xacro` to `mjcf` or `openusd`, and `mjcf` to `openusd`; the version needs content. The result lands in the source asset's format sibling; the operation's description says how it is named and found. It returns `{asset, version, operation}`: follow the Operation as in step 2.

### 4. Check and publish

Validation and previews run after the import, upload or conversion succeeds. Read the version with `sim-assets.list-versions` until it has validation results and previews (the settling rules are in step 4 of `SKILL.md`). Show the user the validation result, the preview files and the licence.

Before the call, tell the user a published version is immutable: other content is another version. Then `sim-assets.versions-publish`. A build accepts only published versions.

A version without an SPDX licence needs a `License: <license>` line in the notes when it is later qualified: ask the user for the licence now.

Done when: `sim-assets.list-versions` shows the version `published` in each target format of the build. Continue with step 1 of `SKILL.md`.

## Updates of an imported model

`sim-assets.versions-source-update` compares the commit the version's `revision` names now (`latestCommit`) with its `commit` and answers `updateAvailable`; it changes nothing. Import an update as the next version of the same asset: `sim-assets.imports` with the response's `simAssetId` and the version's `source` without `commit`.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `sim_asset_source_invalid` (422) | not a GitHub or Hugging Face URL in the forms above (`url` or `repository` in `details`) | ask the user for the repository URL |
| `sim_asset_source_not_found` (422) | the host does not serve the `repository` in `details` at its `revision` (or the directory) | check the URL and revision with the user; the repository must be public |
| `sim_asset_source_path_invalid` (422) | the `path` in `details` is not a sim asset file at its `commit` | pick a root document from the `files` that resolve returned |
| `sim_asset_conversion_unsupported` (422) | no converter from the `sourceFormat` in `details` to its `format` | convert through a supported pair, or import the model in the target format |
| `sim_asset_version_content_missing` (409) | the version has no content yet | wait for its import or upload, then convert |
| `sim_asset_version_not_imported` (409) | the version has no `source` | only imported versions can be checked for updates |
| `asset_validation_incomplete` (409) on publish | the latest validation has not completed | wait for it (step 4) |
| `asset_validation_failed` (422) on publish | a `fail` check; `details` lists the checks | fix the files and add them as another version |

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Browse the asset catalog | `rfabric sim-asset catalog ls [--search go2] [--maker <maker>] [--robot-type <type>] [--format mjcf]` |
| Import a catalog entry | `rfabric sim-asset catalog import <key> [--format <f>]... [--robot <id>] --wait` |
| Resolve a repository URL | `rfabric sim-asset resolve <url> [--revision <revision>]` |
| Import from a repository | `rfabric sim-asset import <url> [--revision <revision>] [--path <path>] (--asset <asset-id> \| --name <n> --slug <s>) --wait`; it resolves for you, `--path` is needed when the URL names no file |
| Upload local files | `rfabric sim-asset create-version <asset-id> --format <f> [--root-path <path>]`, then `rfabric sim-asset upload <version-id> <file>` |
| Convert to MJCF or OpenUSD | `rfabric sim-asset convert <version-id> --format mjcf\|openusd --wait` |
| Check its source for an update | `rfabric sim-asset source-update <version-id>`; it prints the `rfabric sim-asset import` command of the update |
| Publish a version | `rfabric sim-asset publish <version-id>` |
