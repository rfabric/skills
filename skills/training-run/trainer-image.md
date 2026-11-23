# Trainer image

Read this for step 2 of `SKILL.md`, when no LaunchTemplate with the wanted image exists yet. It carries what the trainer must do, where the image goes, and the block that builds and pushes it.

## What the image contains

| Part | What it is | Who provides it |
| --- | --- | --- |
| Training handler | downloads the DatasetVersions and staged sim assets, starts the trainer's command, reports progress and metrics, stores checkpoints, resumes the trainer after a machine is lost | rFabric: the handler image the trainer image is built `FROM` |
| Trainer | the user's training code and its framework, installed into the handler's interpreter in `/opt/rfabric-worker` | the user |

Data, sim assets and base weights reach the run at launch: none of them belongs in the image.

## Check the trainer against the handler

The trainer talks to the handler through the Python module `rfabric_training_run.trainer`, present in the image. Check the user's trainer against it before the build:

| The trainer must | Call |
| --- | --- |
| read its parameters | `parameter(key, default, cast)`: the environment variable `TRAIN_<KEY>` (`TRAIN_BATCH_SIZE` for `batchSize`) wins over the run's parameter, which wins over the default |
| read the data (imitation learning) | `dataset_versions()`, or `lerobot_frames(columns, split="train")` for LeRobot v3 numeric columns; a version with split labels yields only the asked split |
| read staged simulation assets (reinforcement learning) | `sim_assets_dir()` |
| report progress and metrics | `report_progress(step, total_steps=..., epoch=..., metrics=...)`: the numeric metrics become the run's metric series, and the steps feed the estimates of later launches |
| save a checkpoint when asked | create `CheckpointRequests()` before the first progress report; when `take()` is true, write the files to `checkpoint_dir()`, then `checkpoint_done(step, ...)` |
| continue after an interruption | load from `resume_dir()` when it is not `None` |
| start from a model (fine-tune) | load weights from `base_model_dir()` when `resume_dir()` is `None` |
| leave its result | write the final model to `output_dir()`, and one last checkpoint with `checkpoint_done` before exit so the run ends with a promotable Checkpoint |

A trainer that misses one of these still builds; the gap shows in the run (no metrics, no checkpoint, a restart from step 0). Tell the user which rows their trainer lacks and let them decide.

## Where to push it

The pool's compute target decides (`compute-targets.get` with the pool's `computeTargetId`: `placement`):

| Target | Push the image to |
| --- | --- |
| `managed` (rFabric's cloud) | a repository that allows pulls without sign-in |
| `connected`, the user's AWS account | a repository in that account's own Amazon ECR |
| `connected`, the user's Google Cloud project | that project's Artifact Registry (`compute-setup`, Container registry access, says how its machines get read access) |
| `self_hosted` | any registry Docker on that host can pull from: the user runs `docker login <registry>` once as the user the worker runs as |

The image holds the user's training code. When that code must not be publicly readable, train on a pool in a connected cloud account (`compute-setup`) and say so before the build.

## Build and push the image

Fill in every value first. `<handler image>` is `imageDigest` of the handler image row (step 2 of `SKILL.md`): it is already pinned by digest. `<registry>/<repository>` is the user's repository from the table above. With a shell, run the commands of the block yourself after the user approves; without one, hand the block over. Before the registry sign-in of step 3, show which account the cloud CLI is signed in to (`aws sts get-caller-identity`, `gcloud config list account project`) and let the user confirm it is the right one.

```text
Your turn - a terminal with Docker, in the directory of your trainer code
Why: rFabric runs your training code as a container image you own. It pins the image by digest, so every run uses exactly these bytes.
Who: someone with Docker (buildx) and push rights on the registry.

1. Check that you can pull the handler image:
     docker pull --platform linux/amd64 <handler image>

2. Put this Dockerfile beside your trainer (train.py):

   ARG RFABRIC_HANDLER_TRAINING_RUN_IMAGE
   FROM ${RFABRIC_HANDLER_TRAINING_RUN_IMAGE}
   USER root
   RUN --mount=from=ghcr.io/astral-sh/uv:python3.12-bookworm-slim,source=/usr/local/bin/uv,target=/usr/local/bin/uv \
       uv pip install --python /opt/rfabric-worker/bin/python --no-cache <your framework>==<version>
   COPY train.py /opt/trainer/train.py
   USER 10001:10001

3. Sign in to your registry.
   Amazon ECR:
     aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   Google Artifact Registry:
     gcloud auth configure-docker <location>-docker.pkg.dev

4. Build for the pool's machines and push:
     docker buildx build --platform linux/amd64 --push \
       --build-arg RFABRIC_HANDLER_TRAINING_RUN_IMAGE=<handler image> \
       -t <registry>/<repository>:<tag> .

5. Read the digest:
     docker buildx imagetools inspect <registry>/<repository>:<tag>
   Copy the line "Digest: sha256:...".

Creates: one image in your registry. Nothing changes in rFabric.
Undo: delete the image tag in your registry. Do that only when no training configuration uses its digest.
Bring back: <registry>/<repository>@sha256:<digest>
Then I: create the training configuration with it and prove that the pool pulls it with a short first run.
```

Notes for filling it in:

- The handler runs the trainer's command with the interpreter in `/opt/rfabric-worker`, so the framework is installed into it, as the Dockerfile does. The image runs as user 10001.
- The command of the LaunchTemplate must match the `COPY` line: `["python", "/opt/trainer/train.py"]` for this Dockerfile.
- A GPU pool needs the GPU build of the framework (for PyTorch, its CUDA wheels); a CPU pool the CPU build.
- The ECR repository must exist before the push (`aws ecr create-repository --repository-name <repository> --region <region>`).
- For another registry, step 3 is that registry's own `docker login`. It asks for a password, so it stays with the user on every host.

## After the push

1. Check the reference has the form `<registry>/<repository>@sha256:<64 hex>`. A tag is refused with `image_not_pinned` when the LaunchTemplate is created.
2. Continue with step 3 of `SKILL.md`.
3. Nothing has pulled the image yet: the first run proves it. Keep that run small (a few steps), and tell the user so.
