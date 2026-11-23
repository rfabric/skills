# Author sim assets locally

The faster path to a scene or an object: you write the files on the user's machine, check that they load, and upload them as sim asset versions. rFabric validates them, renders previews, and the user qualifies and publishes them exactly as build outputs. Nothing runs on rFabric compute before the upload, and no budget is spent.

What is not recorded is the build history: no prompt, no approved plan, no builder images and no model calls. Each version still pins the content hash of every version it depends on.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Agree on the scene | user decides | - | the user's answer |
| 2 | Stage the dependencies locally | agent | `sim-assets.list`, `sim-assets.list-versions`, `sim-assets.versions-fetch-url` | downloads |
| 3 | Write the files and check that they load | agent | - | none |
| 4 | Register and upload each version, dependencies first | agent | `sim-assets.create`, `sim-assets.create-versions`, `sim-assets.versions-upload`, `sim-assets.versions-upload-sessions`, `sim-assets.versions-upload-sessions-parts`, `sim-assets.versions-upload-sessions-parts-acknowledge`, `sim-assets.versions-upload-sessions-complete` | upload |
| 5 | Check validation and previews, fix by a new version | agent, then the user looks | `sim-assets.list-versions`, `operations.list` | validation and previews |
| 6 | Qualify and publish | user decides, agent calls | `sim-assets.versions-qualify`, `sim-assets.versions-publish` | none |

## Steps

### 1. Agree on the scene

Ask what the build's prompt would hold: the robot, the target format (`mjcf` for MuJoCo, `openusd` for Isaac Sim), the objects with their sizes, counts and materials, the floor extent and the robot's route. Write it back to the user as a short plan, one table of objects (key, size in metres, mass, position, rotation) and the scene parameters scenarios should vary. Start once the user agrees.

### 2. Stage the dependencies locally

Mirror the layout every rFabric task stages, so the paths you write load the same way locally and on rFabric: a working directory `sim-assets/` with one directory per version, `sim-assets/<smavId>/`.

- Find the robot as in step 1 of `SKILL.md`: a published `robot_description` version in the target format.
- For each version the scene uses (the robot, objects already in the workspace), `sim-assets.versions-fetch-url` returns a `url` and its `contentHash`. Download it with `rfabric_download` into `sim-assets/<smavId>/`; check the `sha256` against `contentHash`. An archive (`rootPath` set on the version) is extracted there; a single file is named `content.<ext>` (`content.xml` for `mjcf`, `content.usd` for `openusd`).
- A version's root document is `sim-assets/<smavId>/<rootPath>` for an archive and `sim-assets/<smavId>/content.<ext>` for a single file.

### 3. Write the files and check that they load

Write each new object and the scene in its own directory under `sim-assets/`, named after the asset's slug until its version id exists (rename it then; step 4):

- **References**: a file of the version itself by a path relative to its root document; a dependency by `../<smavId>/<path>`. Every referenced file must resolve inside `sim-assets/`, so never reference an absolute path, a URL or `..` beyond `sim-assets/`.
- **Units**: metres and kilograms. The largest extent of the geometry must lie within 0.001 to 100 m, or validation grants only `visual_preview`. OpenUSD sets `metersPerUnit` (1.0) and `upAxis` (`Z`).
- **Physics**: every body that moves has mass and inertia; collision geometry is simple shapes (boxes, cylinders, capsules) close to the visual shape; friction is set where the robot touches a surface. These are the four items of the qualification checklist (step 6).
- **The scene**: one root document that places the robot at the route's first point, every object at its position and rotation, and a floor covering the extent. In `mjcf`, include each object and the robot by `../<smavId>/content.xml` (or their root documents) rather than copying them.
- **Scene parameters**: each value scenarios vary (a ramp angle, a friction) is declared at version creation (step 4) and bound to one place in the document.

With the shell, check that each root document loads before you upload it, for example `python -c "import mujoco; mujoco.MjModel.from_xml_path('sim-assets/<dir>/scene.xml')"` for `mjcf`, or `usdchecker` for `openusd`. Fix what fails; validation would refuse it too.

### 4. Register and upload each version, dependencies first

Objects before the scene, because a scene's `dependencies` must already hold content. For each:

1. `sim-assets.create` (`workspaceId`, `name`, `slug`, `kind` `object` or `scene`) unless the asset exists.
2. `sim-assets.create-versions` with `format`, `dependencies` (`[{"assetVersionId": "smav_..."}]`, every version its files reference), `parameters` (the scene parameters) and, for an archive, `rootPath`. A version's declaration is fixed once created.
3. Rename its directory to the new version id, `sim-assets/<smavId>/`, and update the scene's `../<smavId>/` references to it.
4. Package it: a single root document as it is, or a `.tar` or `.tar.gz` of its directory's contents with `rootPath` the root document inside it.
5. Upload it as step 2 of [robot-models.md](robot-models.md) describes for local files: `sim-assets.versions-upload` with `sizeBytes` and `sha256` (measure them with `rfabric_upload` and `path` alone), each part with `rfabric_upload`, `sim-assets.versions-upload-sessions-parts-acknowledge` with each part's `etag`, then `sim-assets.versions-upload-sessions-complete`.

A version accepts content once: a fix is another version (step 5).

### 5. Check validation and previews

Validation and previews run after each upload. Read the version with `sim-assets.list-versions` until they settle, as step 4 of `SKILL.md` describes, and show the user one table (version, validation, qualification) and the preview files to look at.

A `fail` check cannot be repaired in place: fix the files, create a new version (step 4), and deprecate nothing yet, since a draft can simply be left unused. A scene that depends on a fixed object needs a new version too, with the new object version as its dependency.

### 6. Qualify and publish

Exactly step 5 (qualify) and step 6 (publish) of `SKILL.md`, dependencies first: the user decides per version, you confirm each checklist item only after checking it, and a published version is immutable. Reject and rebuild do not apply; a version the user does not accept stays an unused draft.

## Done when

- [ ] Every root document loaded locally before its upload.
- [ ] Every version has no `fail` validation check, and its previews were looked at.
- [ ] Every accepted version is qualified at `interaction_eval`, its dependencies before it, with notes on what was checked, and is `published`.
- [ ] The final report lists each version id with its asset, dependencies, qualification and status.
