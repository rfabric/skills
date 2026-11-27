# Customer simulator image

Read this when the user chose "Customer simulator image" in `SKILL.md`: their task needs simulator code of its own. It carries step 2 (build and push) and the profile body for step 3.

## What the image must contain

| Part | What it is | Who provides it |
| --- | --- | --- |
| Simulator runtime | the `rfabric-simulator` library and its commands `rfabric-simulator run` and `rfabric-simulator probe`: probes, simulated clock, both transports, evidence (video, recording, replay archive), fault intake | rFabric: already in every platform simulator image |
| Simulator program | a Python class with `load`, `reset`, `step`, `truth`, `apply_fault`, `evidence_frame`, `sim_time_ns` and `close`: it loads the world, advances one control step per action and reports ground truth | the user |
| Engine | MuJoCo, Gazebo or Isaac Sim with its rendering and video tools | rFabric: the platform simulator image of that adapter |

The runtime starts the program with `rfabric-simulator run --program <module>:<Class>`. Each attempt gets the scenario and its case parameters under `/inputs` and the staged sim assets under `/inputs/sim-assets`, so neither the scene nor the model weights belong in the image. Put only code in it; an image that carries anything confidential belongs in a private registry.

The image is built on the platform simulator image of the chosen adapter, so the Dockerfile only adds the program and its Python dependencies.

## Where to push it

The rule per pool and task type is in `compute-setup` (Container registry access). For a simulator image:

| Pool that runs the attempts | Push the image to |
| --- | --- |
| rFabric's pools and connected pools (the user's AWS account or Google Cloud project) | Amazon ECR or Google Artifact Registry, with that account or project connected as a container registry the workspace can use (`compute-setup`). The registry's cloud and the pool's cloud do not need to match. An image on any other registry host must be publicly readable |
| Self-hosted pools and local Docker | any registry Docker on that host can pull from. rFabric issues no registry sign-in there: the host's own `docker login` decides what it can pull, so the user runs `docker login <registry>` once as the user the worker runs as |

Recommend Amazon ECR or Google Artifact Registry for a private image, and connect it through `compute-setup` before the first launch.

## Build and push the image

Fill in every value first. `<base image>` is the simulator `image` of the platform profile chosen in step 1 of `SKILL.md`: it is already pinned by digest. `<module>` and `<Class>` are the user's program file and class. With a shell, run the commands of the block yourself after the user approves; without one, hand the block over. Before the registry sign-in of step 3, show which account the cloud CLI is signed in to (`aws sts get-caller-identity`, `gcloud config list account project`) and let the user confirm it is the right one.

```text
Your turn - your terminal, with Docker and your container registry
Why: rFabric runs your simulator program from an image you own. It pins the image by digest, so every run uses exactly these bytes.
Who: someone with Docker (buildx) and push rights on the registry.

1. Check that you can pull the base image:
     docker pull --platform linux/amd64 <base image>

2. Put this Dockerfile beside your program (sim.py):

   FROM <base image>
   USER root
   COPY requirements.txt /opt/program/requirements.txt
   RUN pip install --no-cache-dir -r /opt/program/requirements.txt
   COPY sim.py /opt/program/
   ENV PYTHONPATH=/opt/program:${PYTHONPATH}
   USER 10001
   RUN python3 -c "import sim; sim.<Class>()"

3. Sign in to your registry.
   Amazon ECR:
     aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   Google Artifact Registry:
     gcloud auth configure-docker <location>-docker.pkg.dev

4. Build for the pool's machines and push:
     docker buildx build --platform linux/amd64 --provenance=false --sbom=false --push -t <registry>/<repository>:<tag> .

5. Read the digest:
     docker buildx imagetools inspect <registry>/<repository>:<tag>
   Copy the line "Digest: sha256:...".

6. Print what the program declares:
     docker run --rm --platform linux/amd64 <registry>/<repository>:<tag> rfabric-simulator capabilities --program <module>:<Class>

Creates: one image in your registry. rFabric gets no access from this step; a private registry is connected separately.
Undo: delete the image tag in your registry. Do that only when no published profile pins its digest.
Bring back: <registry>/<repository>@sha256:<digest> and the JSON that step 6 printed.
Then I: register the adapter profile with that digest and continue with step 3.
```

Notes for filling it in:

- The last `RUN` line imports the program at build time, so a missing dependency fails the build and not the first attempt. The image runs as user 10001.
- Isaac Sim: the base image is `linux/amd64` only, about 30 GB, and its Python is `/isaac-sim/python.sh` (use `/isaac-sim/python.sh -m pip` and `/isaac-sim/python.sh -c`). It runs only on a machine with an NVIDIA RTX GPU.
- `--platform`: rFabric's simulation pools run `linux/amd64`. For a pool of ARM machines build `linux/arm64` too; an image without a variant for the pool's platform is refused at launch with `image_platform_mismatch`.
- The ECR repository must exist before the push (`aws ecr create-repository --repository-name <repository> --region <region>`).
- Leave out the COPY and pip lines for the requirements file when the program needs no package beyond what the base image carries.
- The exact signatures of the program contract are in the library the image carries: `docker run --rm <base image> python3 -c "import rfabric_simulator.program as p; help(p.SimulatorProgram)"`.

## After the push

1. Check the reference has the form `<registry>/<repository>@sha256:<64 hex>`. A tag is refused at publish with `image_not_pinned`.
2. Read the capability document:
   - `programs` and `transports` are empty: the program declares nothing. Leave `capabilities` out of the profile `spec`; rFabric then skips the format, embodiment and mission checks when a scenario is published, and a scenario the program cannot run fails at run time instead.
   - otherwise: use the document as `capabilities`. The profile's `transport` must be one of its `transports`.
3. Register the profile (below), publish it (`SKILL.md` step 4).
4. rFabric first reads the image at a suite preflight: `sim-suites.preflight` lists it in `imageChecks` with `role` `simulator`, or reports a blocker (`container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch`). That step is in `simulation-suite`; tell the user the image is unproven until then.

## Profile body

Two ways, same result:

- Clone the platform profile (`sim-adapter-profiles.clone`), then send the whole `spec` back through `sim-adapter-profiles.update` with the simulator `image` and `argv` replaced and `capabilities` set or removed as above. The profile keeps the platform profile's slug.
- For a slug of its own: `sim-adapter-profiles.create` with the body below. Every command under `missionInterface` and every probe is run by rFabric inside the containers; the values shown are the runtime's own commands.

```json
{
  "workspaceId": "wks_...",
  "slug": "warehouse-sim",
  "name": "Warehouse simulator",
  "adapter": "mujoco",
  "adapterVersion": "warehouse-sim-1.0.0",
  "realTimeFactorMax": 2,
  "spec": {
    "scenarioMode": "mission",
    "pollIntervalS": 0.5,
    "clockStallS": 30,
    "statusFailuresMax": 3,
    "deadlines": { "SIMULATOR_READY": 180, "AUTONOMY_READY": 60, "WARMED": 60 },
    "preflight": { "minDiskFreeGb": 5, "minMemoryGb": 4 },
    "transport": { "profile": "policy-bridge/1", "actionTimeoutS": 10 },
    "missionInterface": {
      "profile": "exec-json-v1",
      "name": "rfabric-candidate",
      "timeoutS": 15,
      "readiness": { "cmd": ["rfabric-candidate", "readiness"] },
      "start": { "cmd": ["rfabric-candidate", "start", "--mission-id", "{mission_id}"] },
      "status": { "cmd": ["rfabric-candidate", "status", "--mission-id", "{mission_id}"] },
      "cancel": { "cmd": ["rfabric-candidate", "cancel", "--mission-id", "{mission_id}"] }
    },
    "simulator": {
      "image": "<registry>/<repository>@sha256:<digest>",
      "argv": ["rfabric-simulator", "run", "--program", "sim:WarehouseProgram"],
      "resources": { "vcpu": 2, "memoryMiB": 4096 },
      "gpus": 0,
      "readyTimeoutS": 120,
      "finalizeTimeoutS": 180,
      "clockProbe": ["rfabric-simulator", "probe", "clock"],
      "readyProbe": ["rfabric-simulator", "probe", "ready"],
      "variationArgv": ["rfabric-simulator", "probe", "variation"],
      "groundTruthProbe": ["rfabric-simulator", "probe", "truth"],
      "finalizeArgv": ["rfabric-simulator", "probe", "finalize"]
    },
    "autonomy": { "resources": { "vcpu": 1, "memoryMiB": 1024 } }
  }
}
```

- `adapter` is the engine the program runs on: `gazebo`, `mujoco` or `isaac-sim`.
- `missionInterface` is how rFabric drives the candidate: four commands that each print one JSON object. `rfabric-candidate` implements them for a candidate built on the `rfabric-candidate` library (a `Policy` under the entry point group `rfabric_candidate.policies`; `artifact-build` covers packaging a candidate).
- `deadlines` are seconds allowed per stage of an attempt; raise `SIMULATOR_READY` for a slow-starting engine.
- `clockStallS` must be greater than `actionTimeoutS`; a candidate that loads a large model needs both raised.
- Size `resources` to what the program measured; simulator plus `autonomy` is what one machine must offer.
