# Register a workspace enrichment method

Read this when the user wants episodes enriched by code of their own. A workspace method is three things: a Python class that turns one episode into records, a container image (rFabric's enrichment handler image with that class installed), and an EnricherRegistration (`enr_...`, `managed` `tenant`) that tells rFabric what the method writes, how large a machine it needs, which pool runs it and which image to start. The image is built and pushed with the user's Docker; you register the method and run it.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the pool and find the base image | agent | `compute-pools.list`, `compute-handler-images.list` | none |
| 2 | Write the method, build and push the image | agent with a shell; otherwise user, in a terminal with Docker | none | the image build and push |
| 3 | Register the method | agent | `enrichment.create-enrichers` | none |
| 4 | Trial run on a few episodes | agent | `enrichment.runs-preview`, `enrichment.runs`, `enrichment.list-jobs` | as steps 3 to 6 of the main skill |
| 5 | Keep it on; change it later | agent | `enrichment.replace-pass-entries`, `enrichment.update-enrichers`, `enrichment.enrichers-deactivate` | none |

## Before you start

- **Permissions**: `enrichment:register` (built-in roles `admin`, `owner`) to register, update and deactivate; `enrichment:run` to run.
- **Needs**:
  - A compute pool the workspace can use, whose machines can pull images from the user's registry (`compute-setup` covers pools and registry access).
  - Docker and push rights to that registry on the user's machine.
  - Pull access to the rFabric handler image: rFabric grants it to your registry account; ask your rFabric contact before you start.
- **Ask the user**:

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | What the method should record per episode | it fixes the record kinds and their keys | the record table in step 2 |
  | The method's name | it is permanent on every record | lowercase with hyphens, prefixed with their organization, for example `acme-episode-length`; a name of a platform method is refused |
  | Registry and repository to push to | the pool pulls from it | the registry their pool already pulls from |

## Steps

### 1. Check the pool and find the base image

1. `compute-pools.list` with `status` `active`. A usable pool has `taskTypes` containing `"enrichment.batch"` and `capabilities` at least as large as the method's machine (by default 1 vCPU, 2048 MiB memory, 4 GiB disk, 900 s runtime). Pools of the organization or workspace and pools with `offered` true qualify. With none, set one up with `compute-setup` first.
2. `compute-handler-images.list` with `query` `{"taskType": "enrichment.batch"}`. The row's `imageDigest` is the base image reference (`<registry>/rfabric-handler-enrichment@sha256:<digest>`); `version` is the handler version. Use the reference exactly: the base must be pinned by digest.

Done when you hold a pool id (`cpol_...`) and the base image reference.

### 2. Write the method, build and push the image

Fill in the names, the base image reference and the manifest first. With a shell, do the actions of the block yourself after the user approves each command: Docker pulls and pushes with the user's registry logins. Without one, hand the block over.

```text
Your turn - a terminal with Docker; allow for the image build and push
Why: the method is your code. rFabric runs it as a container image that you build on top of
     rFabric's enrichment handler image and keep in your own registry.
Who: someone who can push to <registry>.

1. Pull the rFabric handler image:

   docker pull <base image reference>

2. Create the project folder:

   mkdir -p <project>/<package> && cd <project> && touch <package>/__init__.py

3. Write the method as <package>/method.py. The class turns one episode into a list of records:

   from typing import Any

   class Method:
       enricher = "<enricher>"
       version = "1.0"

       def produce(self, inputs: Any, parameters: dict[str, Any], backend: Any) -> list[dict[str, Any]]:
           if inputs.duration_ms is None:
               return []
           seconds = inputs.duration_ms / 1000
           value = "short" if seconds < 10 else "medium" if seconds < 60 else "long"
           return [{"kind": "tag", "key": "episode.length", "value": value, "confidence": 1.0}]

4. Write pyproject.toml. The entry point is how rFabric finds the method inside the image:

   [project]
   name = "<project>"
   version = "1.0.0"
   requires-python = ">=3.12"

   [project.entry-points."rfabric_enrichment.methods"]
   <enricher> = "<package>.method:Method"

   [build-system]
   requires = ["setuptools>=68"]
   build-backend = "setuptools.build_meta"

5. Write enrichment-methods.json, the description of the method that I register:

   <a JSON array holding the entry of step 3 without workspaceId, computePoolId and imageDigest>

6. Write Dockerfile:

   ARG BASE
   FROM ${BASE}
   USER root
   COPY . /src/method
   RUN --mount=from=ghcr.io/astral-sh/uv:0.6.16,source=/uv,target=/usr/local/bin/uv \
       uv pip install --python /opt/rfabric-worker/bin/python --no-cache /src/method \
       && rm -rf /src/method \
       && /opt/rfabric-worker/bin/python -c "from rfabric_enrichment.methods import resolve_method; resolve_method('<enricher>')"
   USER 10001:10001

7. Build (the last RUN line fails the build if the handler cannot load your method), push,
   and print the reference. The handler image is built for amd64:

   docker build --platform linux/amd64 -t <registry>/<image>:1.0 --build-arg BASE=<base image reference> .
   docker push <registry>/<image>:1.0
   docker inspect -f '{{index .RepoDigests 0}}' <registry>/<image>:1.0

Creates on your side: one image in <registry>. Nothing in rFabric changes yet.
Undo: delete the image from your registry.
Bring back: the last line printed, <registry>/<image>@sha256:<64 hex characters>.
Then I: register the method with that image and run it on a few episodes.
```

**What the class receives.** `inputs` has `episode_id`, `dataset_id`, `duration_ms` (or `None`), `text` (name, type, review note and source joined) and `streams` (each with `id`, `modality`, `objectUri`, `duration`, `channels`, `meta`, `sha256`, `timeseries`, `deviceType`). `parameters` are the run's settings with the defaults of `parametersSchema` filled in. `backend` is whatever an optional `resolve_backend()` method returned, called once per batch; load a model there.

**What it returns.** A list of records. Times are milliseconds from the start of the episode; confidences are 0 to 1.

| `kind` | Required fields | Optional fields |
| --- | --- | --- |
| `tag` | `key`, `value` (string), `confidence` | `frameRangeMs` (`[startMs, endMs]`), `box` (`[x, y, width, height]`, 0 to 1, top-left origin) |
| `segment` | `type`, `startMs`, `endMs` | `confidence`, `payload` |
| `finding` | `category`, `severity` (`info`, `warning`, `critical`), `explanation` | `channels`, `startMs`, `endMs`, `payload` |
| `metric` | `key`, `value` (number), `unit` | `startMs` and `endMs` together, `payload` |
| `description` | `fields`: `{name: {"value", "confidence"}}` | `checklistId`, `answers` |
| `embedding` | `space`, `granularity` (`episode`, `clip`, `frame`), `vector`, `dims` | `atMs`, `rangeMs`, `sensorStreamId` |

- A tag key becomes a search field, so it needs at least two dot-separated parts of the user's own (`"key": "acme.grip-state"`), no whitespace, quotes, parentheses, `:` or `@`, and no leading `-`. A tag value must not contain a double quote.
- Returning `[]` means "nothing to write": the episode counts as done. A method that returns `[]` for every episode succeeds with no records.
- Raising an exception fails that one episode with the message as its reason; the rest of the batch continues.

### 3. Register the method

`enrichment.create-enrichers` takes the manifest entry plus the three values only you hold: `workspaceId`, `computePoolId` (step 1) and `imageDigest` (the reference action 7 printed).

```json
{
  "workspaceId": "wks_...",
  "computePoolId": "cpol_...",
  "imageDigest": "<registry>/<image>@sha256:<64 hex characters>",
  "enricher": "acme-episode-length",
  "version": "1.0",
  "displayName": "Episode length",
  "description": "Tags each episode short, medium or long by duration.",
  "about": {
    "howItWorks": "Reads each episode's recorded duration and tags it short under 10 s, medium under 60 s, long from 60 s.",
    "limits": "Uses only the recorded duration. An episode without one gets no tag."
  },
  "group": "describe",
  "costClass": "light",
  "outputKinds": ["tag"],
  "modalities": ["mixed"],
  "parametersSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "defaultEnabled": false,
  "batchSize": 100,
  "resourceClass": { "vcpu": 1, "memoryMiB": 2048, "gpuClass": null, "gpuCount": 0, "diskGiB": 4, "nodes": 1 },
  "maxRuntimeS": 900
}
```

The manifest file the user keeps is a JSON array of such entries without `workspaceId`, `computePoolId` and `imageDigest`.

| Field | What it decides |
| --- | --- |
| `enricher`, `version` | must equal the class's `enricher` and `version`; both are stamped on every record for good |
| `outputKinds` | the only record kinds the method may write; any other is rejected when the method writes it |
| `group` | where the app lists it: `searchAndMap`, `describe`, `segmentAndMeasure`, `sensors`, `audio`, `privacy` |
| `defaultEnabled` | true runs the method on every import into this workspace without a pass entry; keep false until the trial run is good |
| `batchSize`, `resourceClass`, `maxRuntimeS` | episodes per batch, and the machine and time every batch requests; the pool must fit them |
| `parametersSchema` | JSON Schema of the run settings; its defaults are applied at every run |
| `metrics` | when present, every `metric` record must match a declared `key` and `unit` |
| `declaredSpaces` | embedding spaces the method writes; a `textEncoder` must be one rFabric runs (`siglip2-base-patch16-256` 1.0, `cosmos-embed1-224p` 1.0, `marengo-embed` 3.0), and without one the space answers no text queries |
| `dependsOn` | methods whose records this one reads; a run schedules them first |

Do not send `capabilities`: only platform methods may declare them.

Done when `enrichment.list-enrichers` with `managed` `tenant` shows the method with `status` `active`.

### 4. Trial run on a few episodes

Run steps 3 to 6 of the main skill with `scope` `{"episodeIds": [...]}` (three to five episodes) and `enrichers` naming the method. Then check:

- the job in `enrichment.list-jobs` is `completed` with an empty `failureRoster`;
- its `recordCounts` are not zero: a job that succeeded with no records usually means the method returned `[]` for every episode;
- `enrichment.facets` lists the method's keys, and the registration's `queryFields` are filled.

Show the user two or three records and how to search by them (`episode-search`).

### 5. Keep it on; change it later

| Change | Do |
| --- | --- |
| run on new data | `enrichment.replace-pass-entries` with `enabled` true at the workspace or a dataset |
| new code, same records | the user builds and pushes again; `enrichment.update-enrichers` with the new `imageDigest` |
| another pool, a larger machine, a longer runtime | `enrichment.update-enrichers` with `computePoolId`, `resourceClass` (the whole object) or `maxRuntimeS` |
| different records (kinds, keys, meaning) | a new `version` in the class and the manifest, a new image, and `enrichment.create-enrichers` again; earlier records keep the version that wrote them |
| retire it | `enrichment.enrichers-deactivate`; its records stay |

Do not clear `imageDigest` to null: the method would then run on the bare handler image, which contains no methods.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| the build fails at the `resolve_method` line | the entry point name or class path does not match | make the entry point name equal `enricher` and point it at the class |
| `pool_not_capable` (422) | the pool does not admit enrichment batches, or is smaller than `resourceClass` and `maxRuntimeS` in `details` | pick a larger pool, or lower the profile |
| `enricher_name_reserved` (409) | the name belongs to a platform method | choose another `enricher` |
| `enricher_already_registered` (409) | this `enricher` and `version` exist | update it, or register a new `version` |
| `enricher_capabilities_platform_only` (422) | the body has `capabilities` | remove them |
| `text_encoder_unknown` (422) | a `textEncoder` rFabric does not run | name a listed encoder or drop `textEncoder` |
| `VALIDATION_ERROR` (422) on `imageDigest` | not `repository@sha256:` followed by 64 hex characters | use the reference from `docker inspect` |
| every episode fails with `method_not_hosted` | the image on the pool does not contain the method | rebuild; check `imageDigest` is the image the user pushed |
| episodes fail with "Undeclared record kind" | the method wrote a kind missing from `outputKinds` | register a new version that declares it |
| episodes fail with "Tag key must be an episode query field" | the tag key breaks the key rule in step 2 | use a dotted key of the user's own namespace |
| the batch never starts, the image cannot be pulled | the pool's machines have no access to the user's registry | `compute-setup`, container registry access |
| `no_capable_pool` (422) on launch | the pool is inactive or too small for one batch | activate or resize the pool |

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Find a pool | `rfabric compute-pool ls` |
| Register from the manifest | `rfabric enrichment enrichers register --file enrichment-methods.json --pool <pool-id> --image-digest <image reference>` |
| Run it | `rfabric enrichment run --dataset <dataset-id> --enricher <enricher>` |
| Change pool, image or machine | `rfabric enrichment enrichers update <registration-id> [--pool <pool-id>] [--image-digest <reference>] [--vcpu <n>] [--memory-mib <n>] [--max-runtime-s <n>]` |
| Deactivate | `rfabric enrichment enrichers deactivate <registration-id>` |
