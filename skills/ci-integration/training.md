# CI integration: training runs

Read this when the user wants their pipeline to launch training: "train from CI", "train on every tag", a training run per pull request, the trainer image the pipeline built, `rfabric training run` in a pipeline, or a launch refused in CI. It replaces steps 1 and 3 to 7 of `SKILL.md` for training. The sign-in model of `SKILL.md` (service credentials, trusts, "How the pipeline signs in", Rotate or remove, the sign-in rows of Problems) applies unchanged, and so do the trust values and Your turn 1 of the CI system's file.

The user ends up with a pipeline that builds their trainer image, launches a TrainingRun (`run_...`) on it from a LaunchTemplate (`ltpl_...`, named by its `slug`), and optionally waits for the outcome. The run records the build as `ci` (repository, commit, build, ref, pull request), the image as `computeConfig.image`, and the commit the image was built from as `codeVersion`; `appUrl` opens it in the app. Training itself (templates, pools, following a run, checkpoints) is `training-run`.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the template, the experiment and the quota | agent | `introspect.whoami`, `workspaces.list`, `launch-templates.list`, `experiments.list`, `workspaces.compute-quota-usage` | - |
| 2 | Let launches take the pipeline's image | agent (admin or owner), or the repository's template file | `launch-templates.get`, `launch-templates.update` | - |
| 3 | Make the trainer image pullable | user, registry or cloud console | `provider-credentials.setup-token` | - |
| 4 | Create the two credentials | agent | `credentials.create-clients`, `credentials.list-client-trusts` | - |
| 5 | Add the variables and the pipeline file | agent with a shell for git; otherwise user, CI provider | - | - |
| 6 | Run it and follow the run | user triggers, agent follows | `training-runs.list`, `training-runs.get` | the run, or only its launch |
| 7 | Continue after training | agent | `webhook-subscriptions.create` | - |

The rFabric app does steps 4 and 5 in one flow: Integrations > CI/CD > the CI provider > Connect repository, then **Launches**: **Training**. It creates both credentials (the pull request one in the workspace picked at **Pull request workspace**, **Merge request workspace** on GitLab), trusts the base branch and the tag pattern of **Tags** (default `train/*`; on Bitbucket the deployment environment `training` instead) and fills the pipeline file. Offer it to a user who prefers the app.

## Decisions

**When a pipeline trains.** Each option is a ready pipeline file (a preset) in the `rfabric/cli` repository: `https://github.com/rfabric/cli/tree/main/presets/training-run/<github|gitlab|bitbucket>`. Each builds the trainer image from the repository's own Dockerfile, pushes it, passes it on by digest, and states `code-version` as the commit it built from. A trainer image is any container image that contains the training command; it is not built from an rFabric image (`training-run`, step 2). Recommend starting with the manual and tag presets: training costs GPU hours, so the first pipelines train when a person asks.

| Preset | Trigger | Choose when | Consequence |
| --- | --- | --- | --- |
| manual.yml (start here) | GitHub "Run workflow", GitLab "Run pipeline" form, Bitbucket custom pipeline `train`, with template, dataset version and overrides as inputs | someone decides each training | one run per click; on GitHub and GitLab run it on the base branch, the only branch the base-branch credential trusts; on Bitbucket its step runs in the deployment environment `training` (below) |
| tag.yml (start here) | a pushed tag `train/<name>` | a training should be reproducible from a named commit | the run carries the tag `git-tag=<tag>`; on Bitbucket its step runs in the deployment environment `training` (below) |
| trainer-change.yml | a base-branch push touching the trainer (code, config, `Dockerfile`, lockfile, `training/`) | the template should always run the latest trainer | applies the launch template files with the new image and commit, then trains: every such merge spends GPU hours |
| schedule.yml | nightly | data grows and the model is retrained on a timetable | one run per night, whether anything changed or not |
| pull-request-approved.yml | a maintainer adds the label `train` (Bitbucket: a manual step) | a change needs a short real training before merge | a step-capped template in the pull request workspace; a new label replaces the earlier run |
| pull-request.yml | every pull request push | the trainer should be proven to start on every change | a few CPU steps of a dedicated template in the pull request workspace; each push replaces the previous run |

The pipeline decides when to train by its trigger, never by a marker in a commit message: anyone who can push a commit can write a marker, while triggers, labels, tags and environments have access control. The presets have no marker.

**Wait or not.**

| Option | Choose when | Consequence |
| --- | --- | --- |
| No wait (default) | GPU runs of hours | the step ends once the run is launched; what follows training starts from rFabric (step 7) |
| `wait: true` | short runs that fit the CI job's time limit (pull request runs) | the job holds a CI runner until the run ends and passes only when it completes; later steps read the outputs |

## Credentials

Two credentials, so a pull request can never change a template or train in the main workspace. Both are separate from the simulation credentials of `SKILL.md`.

| Credential | Workspace (`workspaceId`) | Permissions | Trusts |
| --- | --- | --- | --- |
| base branch | the main workspace | `training`: `launch`, `read`, `cancel`, `configure` (`configure` applies launch template files) | the repository identifier with the exact base branch; a second trust for tag runs: the tag pattern, or on Bitbucket the deployment environment `training` |
| pull request | a separate pull request workspace | `training`: `launch`, `read`, `cancel`; never `configure` | the repository identifier with the pull request condition |

The pull request workspace holds its own LaunchTemplate (few steps, small compute, a tight `maxRuntimeS` and `maxGpuHours`), a small DatasetVersion, an Experiment, and its own monthly GPU quota: a pull request then cannot spend the main workspace's quota. Create the workspace with `workspace-setup`, the data with `dataset-version`, the quota with `compute-setup`. A template's `slug` is unique per workspace only, so both workspaces may use the same slug.

Trust conditions for training (the issuer and repository identifier claim are in the CI system's file):

| CI system | Base branch | Tag | Pull request |
| --- | --- | --- | --- |
| GitHub Actions | `ref`: `refs/heads/<base branch>` | `ref`: `refs/tags/train/*` | `ref`: `refs/pull/*/merge` |
| GitLab CI | `ref_path`: `refs/heads/<base branch>` | `ref_path`: `refs/tags/train/*` | `pipeline_source`: `merge_request_event` |
| Bitbucket Pipelines | `branchName`: `<base branch>` | `deploymentEnvironmentUuid`: the UUID of the deployment environment `training` | only `repositoryUuid` |

The tag trust admits whoever can push a tag `train/...`: tell the user to protect that tag pattern in the code host (GitHub tag rulesets, GitLab protected tags).

Bitbucket's identity token names no tag. There the second trust of the base-branch credential holds the UUID of the repository's deployment environment `training`, and the Bitbucket tag and manual presets run their training step with `deployment: training`, as does the file the app generates. Any pipeline with such a step signs in as the base-branch credential, which can change templates (`training:configure`). Bitbucket's deployment permissions decide who may deploy to the environment, not which tags may: so create the deployment environment `training`, allow only maintainers to deploy to it (Bitbucket Premium custom deployment permissions), and copy its UUID, braces included, into the credential trust. Without that restriction any branch with a `deployment: training` step signs in as the base-branch credential. Before the credential is created:

```text
Your turn - Bitbucket, repository <workspace>/<repository>
Why: the base-branch training credential trusts this deployment environment; its permissions decide who may run a step in it.
Who: a repository admin. Custom deployment permissions need the Bitbucket Premium plan.

1. Repository settings > Deployments: add an environment named training.
2. In its deployment permissions, allow only maintainers to deploy to it.
3. Copy the environment's UUID, braces included.

Creates: one deployment environment. Undo: delete it, and remove the trust that names its UUID.
Bring back: the UUID.
Then I: create the base-branch credential with a trust on it.
```

Without Premium the restriction is not available: then create the base-branch credential with the branch trust only, leave out the tag preset, and run the manual preset on the base branch without its `deployment:` line.

## What rFabric enforces, whatever the pipeline says

A pipeline file is edited by whoever can push to the repository. These limits hold regardless:

| Limit | Where it is set | Effect |
| --- | --- | --- |
| Trust conditions | the credential's trusts (step 4) | only this repository's base branch, tags or pull requests sign in, each with its own credential |
| Template guardrails | the LaunchTemplate: `allowedOverrideKeys`, `maxRuntimeS`, `maxGpuHours`, `maxGpuCount`, `requiredTags` | an override outside them is refused, every run stops at its cap |
| Monthly GPU quota | the workspace (`workspaces.compute-quota-usage`: `gpuHoursPerMonth`, `hardStop`) | with `hardStop` a launch past the quota is refused with `quota_exceeded` |
| One run per retried step | the CLI keys each launch by the pipeline run and the launch request (a pipeline can pass its own `--idempotency-key`, which keys only the launch, never its cancels) | a retried step returns the run already launched; a re-run of the pipeline (a new attempt) launches a new one |
| Trainer image check | rFabric's pools and connected pools | a run whose image rFabric cannot read through the container registry, or whose image is built for another platform than the pool's machines, is refused at the launch, before any compute is spent |

## Steps

### 1. Check the template, the experiment and the quota

1. `introspect.whoami`: `credential` holds `create`.
2. `workspaces.list`: the main workspace and, for pull request presets, the pull request workspace.
3. `launch-templates.list` with query `workspaceId` (and `slug` to check one): the template the pipeline launches, by `slug`. None: `training-run` creates it. With the trainer change preset or the input `dir`, the template lives as a file in the repository: `training-run`, step 3, templates as files.
4. `experiments.list` with query `workspaceId`: the Experiment the runs belong to; its id goes into a variable.
5. `workspaces.compute-quota-usage` for each workspace: tell the user how many GPU hours a month the pipeline can spend and whether `hardStop` refuses a launch past it.

Done when: you can name per workspace the template slug, the Experiment, the DatasetVersions and the quota.

### 2. Let launches take the pipeline's image

The pipeline passes the image it built as `image`, which overrides the template's `defaultComputeConfig.image`. `launch-templates.get`: `guardrails.allowedOverrideKeys` must contain `image`, or every pipeline launch is refused. To add it: `launch-templates.update` with the whole `guardrails` object, `image` added (needs `training:configure`, admin or owner; in the app: the template's **Launches may override**, **Image**). A template with a non-null `ci` is managed from its repository and refuses the update with `definition_repository_managed` (409): add `image` to `allowedOverrideKeys` in its file instead.

`code-version` is the commit the image was built from. The pipeline states it; nothing infers it. The presets set it to the commit variable they built from, the wrappers never default it, and rFabric never takes it from the build's commit. A launch with `image` and no `code-version` records `codeVersion` null; a launch without `image` records the template's `codeVersion`; `code-version` without `image` is refused.

### 3. Make the trainer image pullable

The pool that runs the template must pull the image from where the pipeline pushes it. The presets push to the CI provider's registry (GitHub Container Registry, GitLab's project registry, Docker Hub on Bitbucket). On rFabric's pools and connected pools an image in Amazon ECR or Google Artifact Registry is pulled through the container registry connected to the launching workspace or its organization; an image on any other registry host, the CI providers' registries included, must be publicly readable.

| Option | Choose when | Consequence |
| --- | --- | --- |
| Public repository in the CI provider's registry (the presets) | the trainer code may be public | nothing to connect; on GitHub the user makes the package public once (`github-actions.md`, The first run) |
| Private repository in Amazon ECR or Google Artifact Registry | the trainer code must stay private | connect that account or project as a container registry the workspace can use (`compute-setup`, Container registry access): the only step, and the registry's cloud and the pool's cloud do not need to match. The pipeline then signs in to that registry instead of the CI provider's |
| A self-hosted pool | the user trains on machines they run | rFabric issues no registry sign-in there: the host's own `docker login` decides what it can pull, private repositories of the CI provider's registry included |

### 4. Create the two credentials

`credentials.create-clients`, once per credential, following step 3 of `SKILL.md` (what to say first, `expiresAt`, client secret instead). Base-branch credential on GitHub Actions:

```json
{
  "name": "robot-ci-training",
  "organizationId": "org_...",
  "workspaceId": "wks_<main workspace>",
  "permissions": { "training": ["launch", "read", "cancel", "configure"] },
  "trusts": [
    { "issuer": "https://token.actions.githubusercontent.com", "conditions": { "repository_id": "123456789", "ref": "refs/heads/main" } },
    { "issuer": "https://token.actions.githubusercontent.com", "conditions": { "repository_id": "123456789", "ref": "refs/tags/train/*" } }
  ]
}
```

The pull request credential: `workspaceId` the pull request workspace, `"training": ["launch", "read", "cancel"]`, one trust with the pull request condition.

Done when: `credentials.list-client-trusts` returns the intended conditions for both client ids, and you have the `audience`.

### 5. Add the variables and the pipeline file

Fetch the chosen preset for the user's CI system, fill in every line marked `ADAPT` (the template slug: `trainer` in the base-branch presets, `trainer-pull-request` and `trainer-pull-request-cpu` in the pull request presets; the Dockerfile and context; the audience), and hand it over as a "Your turn" block in the form of Your turn 2 of the CI system's file. The header of each preset names its variables:

| Variable | Presets | Value |
| --- | --- | --- |
| TRAINING_CLIENT_ID | manual, tag, trainer change, schedule | client id of the base-branch credential |
| TRAINING_EXPERIMENT_ID, TRAINING_DATASET_VERSIONS | the same | the Experiment and DatasetVersions of the main workspace (comma separated) |
| TRAINING_PULL_REQUEST_CLIENT_ID | both pull request presets | client id of the pull request credential |
| TRAINING_PULL_REQUEST_WORKSPACE_ID, TRAINING_PULL_REQUEST_EXPERIMENT_ID, TRAINING_PULL_REQUEST_DATASET_VERSIONS | both pull request presets | the pull request workspace, its Experiment and its small DatasetVersion |
| TRAINING_BITBUCKET_TOKEN | Bitbucket pull request presets, optional | an access token with pull request write access, for the pull request comment; Secured |
| RFABRIC_PACKAGES_TOKEN | every preset; needed only when the trainer image installs `rfabric-trainer` | a GitHub token that reads the private rFabric Python packages, `rfabric/rfabric-trainer` among them: a repository secret on GitHub, a masked CI/CD variable on GitLab, a Secured repository variable on Bitbucket |

On GitLab, a project CI/CD variable named like a job variable of the training template (`RFABRIC_` plus an input name in upper snake case, such as `RFABRIC_EXPERIMENT`) overrides the value the template maps from that input, a value typed into the Run pipeline form included. That is why the presets name their variables `TRAINING_*` and pass each to its input; keep those names. Define every variable a GitLab preset passes in every pipeline that runs it: GitLab passes an unset variable as its own text.

- **Approval before GPU spend**: on GitHub the GPU presets run the launch in the environment `gpu-training`. The user creates it under Settings > Environments and adds required reviewers; without reviewers the launch runs unapproved. GitLab and Bitbucket presets leave approval to protected environments and deployment approvals where the plan has them.
- **Trainer library**: every preset's image build passes the BuildKit secret `github_token` from RFABRIC_PACKAGES_TOKEN, which a Dockerfile that installs `rfabric-trainer` reads with `RUN --mount=type=secret,id=github_token`. It is the secret the simulation pipelines use for `rfabric-candidate` and `rfabric-simulator`: one GitHub token that reads the private rFabric Python packages. GitHub: `secrets: github_token=${{ secrets.RFABRIC_PACKAGES_TOKEN }}` on the build action. GitLab and Bitbucket: `printf '%s' "$RFABRIC_PACKAGES_TOKEN" > /tmp/github_token`, then `--secret id=github_token,src=/tmp/github_token` on the build line; the file stays outside the build context, so no `COPY` can put it in a layer, and the Bitbucket presets set `DOCKER_BUILDKIT=1`. rFabric grants the read access to `rfabric/rfabric-trainer`; ask your rFabric contact before you start. The token exists only during the build, never reaches a layer or rFabric, and is separate from the rFabric sign-in. On GitLab no input of the training template has that name, so it overrides nothing. A trainer image that does not install the library builds with the variable unset.
- **Entry points**, if the user writes their own file: GitHub `uses: rfabric/cli/training-run@v0.1`; GitLab `include` of `https://raw.githubusercontent.com/rfabric/cli/v0.1/templates/training-run.yml` (job `rfabric-training-run`); Bitbucket the pipe `docker://ghcr.io/rfabric/cli:0.1` with `RFABRIC_LAUNCH_TEMPLATE` set (that variable selects training). Inputs: `launch-template`, `experiment`, `dataset-versions`, `base-model`, `config-overrides`, `compute-overrides`, `run-tags` (the run's tags `key=value`), `image`, `code-version`, `dir`, `base-branch`, `wait`, `wait-timeout`, `replace-previous`, and the sign-in inputs of `SKILL.md`; on Bitbucket `RFABRIC_` plus the name in upper snake case (`RFABRIC_RUN_TAGS`). The simulation wrapper's `tags` selects suites and is not a training input.
- **`dir`**: the repository's launch template files. A pull request previews them (problems fail the step, nothing launches); a base-branch push applies them first, writing `image` and `code-version` into the template `launch-template` names.
- **`replace-previous`**: cancels the runs this repository launched earlier from the same ref and template, so a pull request keeps one run.
- **GitLab**: the job's `timeout:` also bounds its identity token: with `wait`, set it above `wait-timeout`.

### 6. Run it and follow the run

Ask the user to trigger the pipeline (for the manual preset on GitHub or GitLab: run it on the base branch). The step signs in, launches, logs `Training run <run id> launched from launch template <slug>` and `App: <the run's page>`, and with `wait` follows it. Give the user that page.

1. Find the run: `training-runs.list` with query `ciCommit` (the commit the pipeline checked out), `ciHeadCommit` (a pull request's head) or `ciRef`, plus `workspaceId` or `launchTemplateId`. Its `ci` names the build; `computeConfig.image` and `codeVersion` the image and commit; `appUrl` its page.
2. Follow it as `training-run` step 6 describes.

| Step exit code | Meaning |
| --- | --- |
| 0 | launched; with `wait`, completed |
| 40 | cancelled, or the pipeline was cancelled while waiting (the run is cancelled with it) |
| 50 | failed; the message is the first line of the run's `errorMessage` |
| 60 | `wait-timeout` ran out; the run keeps running |
| 2, 3, 5 | a wrong input; a launch refused (problems, guardrails, image check); a missing permission |

Outputs for later steps: `run-id`, `status`, `run-url`, `best-checkpoint-id` (with `wait`). GitLab: dotenv `RFABRIC_RUN_ID`, `RFABRIC_STATUS`, `RFABRIC_RUN_URL`, `RFABRIC_BEST_CHECKPOINT_ID`; Bitbucket: rfabric-result.json. The summary also goes to the job summary and the pull request comment.

Done when: a run with this repository in `ci` exists, with the pipeline's image and `codeVersion`.

### 7. Continue after training

Without `wait` the pipeline is done once the run is launched. To act on the outcome (evaluate the best checkpoint, promote it, notify), let rFabric call the user's endpoint: `webhook-subscriptions.create` with `organizationId`, `workspaceId`, `url`, `eventSelectors` `["trainingRun.statusChanged"]` and `payloadProfile` `"full"` (needs `webhook:create`: operator, admin, owner). Without `payloadProfile` a subscription gets the default `thin` profile, whose `data` carries only the entity reference (`entityType` `trainingRun`, `entityId`) and `trainingRunId`: no `status`. With `full`, `data` carries `trainingRunId`, `experimentId`, `workspaceId`, `organizationId`, `status` and `previousStatus`. The pipeline keeps its output `run-id`; the receiver verifies the header X-Rfabric-Signature with the subscription's signing secret, deduplicates by the event's id, and continues only when `data.trainingRunId` equals that `run-id` and the `status` in `data` is `completed`, then reads the run's `bestCheckpoint` with `training-runs.get`; `failed` and `cancelled` end the flow. The signing secret is returned once by the call: say so before it, and that it goes straight into the receiver's secret store. A receiver can start the next pipeline through the CI provider's API (GitHub `repository_dispatch`, a GitLab pipeline trigger).

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| Exit 3, `allowedOverrideKeys: Override 'image' is not permitted` | the template does not let launches change the image | step 2 |
| Exit 3, `requiredTags: Missing required tags` | the template requires tags the pipeline does not pass | add them to the input `run-tags` (Bitbucket `RFABRIC_RUN_TAGS`) |
| Exit 2, unknown launch template, the message lists `slug (id)` pairs | the slug is not in the credential's workspace | use a listed slug; a pull request credential sees only its own workspace |
| Exit 2 naming `code-version` | `code-version` without `image` | pass both, or neither |
| `container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch` (422) | on rFabric's pools and connected pools rFabric cannot read the trainer image through the container registry, or it is built for another platform than the pool's machines; the message names the image and the pool | step 3; build for the platform the message names |
| `quota_exceeded`, `budget_exceeded` (422) | the workspace's monthly GPU quota, or the template's `maxGpuHours` | `training-run` Problems |
| 403 `Missing grant training:configure` | a pull request credential applying `dir` | only base-branch runs apply; check which client id the run used |
| `kind_not_requested` in a `dir` problem | the directory holds evaluation definition files | point `dir` at the launch template directory; evaluation files go to the simulation wrapper |
| Exit 50 | the trainer failed | `training-run`, Read a failure |
| Exit 60 | the wait ran out, the run goes on | follow it with `training-runs.get`, or cancel with `training-runs.cancel` |
| A Bitbucket step stopped, the run goes on | Bitbucket sends the step no signal | cancel it with `training-runs.cancel` |

## The rfabric CLI

Any other CI system runs the CLI directly (`other-ci.md` for installing it and signing in). The CLI records the build as `ci` by itself.

| Step | CLI |
| --- | --- |
| Launch on the pipeline's image | `rfabric training run <template slug or id> --experiment <experiment-id> --image <repository>@sha256:<digest> --code-version <commit> [--dataset-version <id>] [--tag git-tag=<tag>]` |
| Launch and wait | add `--wait --wait-timeout 6h --markdown summary.md` (the summary has an `App` row linking the run's page) |
| Replace this ref's earlier run | add `--replace-previous` |
| Key the launch yourself | add `--idempotency-key <key>`; it keys only the launch request. Without it, in CI, the CLI derives one from the pipeline attempt |
| Apply launch template files | `rfabric training apply --dir training --image <slug>=<repository>@sha256:<digest> --code-version <commit>`; on a pull request `rfabric training apply --dir training --preview` |
| Find a commit's runs | `rfabric training-run ls --ci-commit <sha>`, `--ci-head-commit <sha>`, `--ci-ref <ref>` |
| Exit code table | `rfabric help exit-codes` |
