# Trainer image

Read this for step 2 of `SKILL.md`, when no LaunchTemplate with the wanted image exists yet. It carries what a trainer image is, what the trainer must do, where the image goes, and the block that builds and pushes it.

## What a trainer image is

A trainer image is any container image that contains the training command, pinned by digest (`<repository>@sha256:<64 hex>`). It is not built from an rFabric image and contains no rFabric worker.

| Part | What it is | Who provides it |
| --- | --- | --- |
| Handler image | the image the compute machine starts. Its worker downloads the DatasetVersions, staged sim assets and base weights, pulls the trainer image, runs the template's `command` in it as a separate container, reports progress and metrics, stores checkpoints, and resumes the trainer after a machine is lost | rFabric. Nothing of it is in the trainer image |
| Trainer image | the user's training code and its framework | the user |
| Trainer library `rfabric-trainer` (Python module `rfabric_trainer`) | run config, datasets, progress and metrics, checkpoint requests, outputs | rFabric; the user's build installs it into the trainer image. Optional: a training command may speak the trainer protocol itself |

The trainer container gets no credentials, no worker token and no access to the cloud metadata endpoint; it has internet access. Data, sim assets and base weights reach it at launch, read-only: none of them belongs in the image. The directories the trainer writes to (checkpoint, output and cache) belong to the user the trainer container runs as, the image's `USER`. In a multi-node run every node pulls the trainer image itself, and the nodes share the worker's network.

## Check the trainer against the library

A trainer that uses the library imports it as `import rfabric_trainer as trainer`. Check the user's trainer against it before the build:

| The trainer must | Call |
| --- | --- |
| read its parameters | `parameter(key, default, cast)`: the environment variable `TRAIN_<KEY>` (`TRAIN_BATCH_SIZE` for `batchSize`) wins over the run's parameter, which wins over the default |
| read the data (imitation learning) | `dataset_versions()`, or `lerobot_frames(columns, split="train")` for LeRobot v3 numeric columns (the image must hold `numpy` and `pyarrow` for it); a version with split labels yields only the asked split |
| read staged simulation assets (reinforcement learning) | `sim_assets_dir()` |
| report progress and metrics | `report_progress(step, total_steps=..., epoch=..., metrics=...)`: the numeric metrics become the run's metric series, and the steps feed the estimates of later launches |
| save a checkpoint when asked | create `CheckpointRequests()` before the first progress report; when `take()` is true, write the files to `checkpoint_dir()`, then `checkpoint_done(step, ...)` |
| continue after an interruption | load from `resume_dir()` when it is not `None` |
| start from a model (fine-tune) | load weights from `base_model_dir()` when `resume_dir()` is `None` |
| leave its result | write the final model to `output_dir()`, and one last checkpoint with `checkpoint_done` before exit so the run ends with a promotable Checkpoint |

A trainer that misses one of these still builds; the gap shows in the run (no metrics, no checkpoint, a restart from step 0). Tell the user which rows their trainer lacks and let them decide.

A trainer without the library does the same through the trainer protocol (environment variables, progress lines on standard output, a checkpoint marker file), which the README of `rfabric/rfabric-trainer` states.

## The trainer library

`rfabric-trainer` lives in its own private repository `rfabric/rfabric-trainer` and is pinned by git tag: `rfabric-trainer @ git+https://github.com/rfabric/rfabric-trainer.git@v0.1.0`. No image and no package index carries it. The image build installs it with a GitHub token that reads that repository, passed as the BuildKit secret `github_token`: the token reaches one build step and stays out of the image.

The token is the user's secret. It stays in their terminal or their CI secret store and never enters the conversation. With a shell, check that the variable the build reads is set without printing it (`test -n "$GITHUB_TOKEN"`); when it is not, the build stays with the user.

## Where to push it

The pool's compute target decides (`compute-targets.get` with the pool's `computeTargetId`: `placement`):

| Target | Push the image to |
| --- | --- |
| `managed` (rFabric's pools) and `connected` (the user's AWS account or Google Cloud project) | Amazon ECR or Google Artifact Registry, with that account or project connected as a container registry the workspace can use (`compute-setup`, Container registry access). The image is pulled straight from that registry with a short-lived registry sign-in rFabric issues for that one run; nothing is copied. The registry's cloud and the pool's cloud do not need to match. An image on any other registry host must be publicly readable |
| `self_hosted`, and local Docker | any registry Docker on that host can pull from. rFabric issues no registry sign-in there: the host's own `docker login` decides what it can pull, so the user runs `docker login <registry>` once as the user the worker runs as |

The image holds the user's training code. When that code must not be publicly readable, push it to Amazon ECR or Google Artifact Registry and connect that account or project as a container registry; say so before the build.

## Build and push the image

Fill in every value first. `<registry>/<repository>` is the user's repository from the table above. With a shell, run the commands of the block yourself after the user approves; without one, hand the block over. Before the registry sign-in of step 2, show which account the cloud CLI is signed in to (`aws sts get-caller-identity`, `gcloud config list account project`) and let the user confirm it is the right one.

```text
Your turn - a terminal with Docker, in the directory of your trainer code
Why: rFabric runs your training code as a container image you own. It pins the image by digest, so every run uses exactly these bytes.
Who: someone with Docker (buildx), push rights on the registry, and a GitHub token that reads rfabric/rfabric-trainer in the variable GITHUB_TOKEN.

1. Put this Dockerfile beside your trainer (train.py):

   ARG UV_IMAGE=ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
   FROM ${UV_IMAGE} AS uv
   FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
   RUN --mount=from=uv,source=/usr/local/bin/uv,target=/usr/local/bin/uv \
       uv pip install --system --no-cache <your framework>==<version>
   RUN --mount=from=uv,source=/usr/local/bin/uv,target=/usr/local/bin/uv \
       --mount=type=secret,id=github_token,required=true \
       --mount=type=tmpfs,target=/run/gitconfig \
       apt-get update && apt-get install -y --no-install-recommends git \
       && export GIT_CONFIG_GLOBAL=/run/gitconfig/config \
       && git config --global url."https://x-access-token:$(cat /run/secrets/github_token)@github.com/rfabric/".insteadOf "https://github.com/rfabric/" \
       && uv pip install --system --no-cache 'rfabric-trainer @ git+https://github.com/rfabric/rfabric-trainer.git@v0.1.0' \
       && apt-get purge -y --auto-remove git && rm -rf /var/lib/apt/lists/*
   COPY train.py /opt/trainer/train.py
   RUN useradd --uid 10001 --user-group --create-home trainer
   USER 10001:10001

2. Sign in to your registry.
   Amazon ECR:
     aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   Google Artifact Registry:
     gcloud auth configure-docker <location>-docker.pkg.dev

3. Build for the pool's machines and push:
     docker buildx build --platform linux/amd64 --push \
       --secret id=github_token,env=GITHUB_TOKEN \
       -t <registry>/<repository>:<tag> .

4. Read the digest:
     docker buildx imagetools inspect <registry>/<repository>:<tag>
   Copy the line "Digest: sha256:...".

Creates: one image in your registry. Nothing changes in rFabric, and rFabric gets no access from this step: a private registry is connected separately.
Undo: delete the image tag in your registry. Do that only when no training configuration uses its digest.
Bring back: <registry>/<repository>@sha256:<digest>
Then I: create the training configuration with it and preview a launch, which checks that rFabric can read the image.
```

Notes for filling it in:

- The first element of the LaunchTemplate's `command` is the program the trainer container starts, the rest are its arguments, so the command must match the `COPY` line: `["python", "/opt/trainer/train.py"]` for this Dockerfile.
- The image's `USER` must name a user and group the image defines, as the `useradd` line does here: otherwise the run fails as `invalid` with code `image_user_not_found`.
- A trainer without the library: leave out the second `RUN` step, the token in "Who" and the `--secret` line.
- A GPU pool needs the GPU build of the framework (for PyTorch, its CUDA wheels); a CPU pool the CPU build.
- `--platform`: build for the pool's machines. An image without a variant for their platform is refused at the launch with `image_platform_mismatch`.
- The ECR repository must exist before the push (`aws ecr create-repository --repository-name <repository> --region <region>`).
- For another registry, step 2 is that registry's own `docker login`. It asks for a password, so it stays with the user on every host.

## After the push

1. Check the reference has the form `<registry>/<repository>@sha256:<64 hex>`. A tag is refused with `image_not_pinned` when the LaunchTemplate is created.
2. Continue with step 3 of `SKILL.md`.
3. Nothing has pulled the image yet. On rFabric's pools and connected pools the preview's `trainerImage` check (step 4 of `SKILL.md`) reads it through the container registry and compares its platform with the pool's machines. On self-hosted and local Docker pools the check is `not_checked` and the first run proves the pull. Keep the first run small (a few steps), and tell the user so.
