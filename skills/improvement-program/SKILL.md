---
name: improvement-program
description: >-
  An ImprovementProgram that lets `rfabric-rsi-agent` improve the model of one robot Task on its own, one change per Experiment, with the repository, CI and credential it needs on the user's side. Use when asked to set up, check, change, pause or remove an improvement program, to let the agent improve a policy autonomously, to prepare a repository or CI for the agent's `rsi/` branches, or to follow its Experiments and verdicts. Not for an experiment you run yourself: that is `experiment`. Not for other CI pipelines: that is `ci-integration`.
---

# Set up an improvement program

The user ends up with an active **ImprovementProgram** (`imp_...`): the configuration of one robot Task that tells `rfabric-rsi-agent` where to start, how to train, how candidates are judged and what it may change. `rfabric-rsi-agent` is rFabric's self-improvement system: an API client that runs outside the platform under its own service credential. For each hypothesis it opens one **Experiment** (`exp_...`) with one change, trains a candidate, packages it as an Artifact (`art_...`), evaluates it against the current best, and concludes the Experiment by a fixed rule. A person ships the result.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check the building blocks | agent | `tasks.list`, `artifacts.get`, `launch-templates.get`, `evaluation-protocols.get`, `sim-suites.get`, `workspaces.compute-quota-usage` | none |
| 2 | Explain the boundaries; decide change levels and frozen paths | user | none | the user's answer |
| 3 | Prepare the repository and its CI (level `code`) | agent creates the CI credential; agent with a shell runs the Git host commands, otherwise user; settings pages: user | `credentials.create-clients`, `credentials.list-client-trusts` | the user |
| 4 | Create the program, paused | agent | `improvement-programs.list`, `improvement-programs.create` | none |
| 5 | Verify it | agent | `improvement-programs.get` | none |
| 6 | Check `rfabric-rsi-agent` is connected, then activate | agent, on the user's go | `credentials.list-clients`, `webhook-subscriptions.list`, `improvement-programs.update` | the user's go |
| 7 | Follow Experiments and verdicts | agent | `experiments.list`, `experiments.get`, `training-runs.list`, `evaluation-jobs.list`, `evaluation-jobs.report`, `evaluation-comparisons.list` | per Experiment: one training plus its evaluation jobs |

## Before you start

- **Permissions**: creating, changing and deleting a program needs `improvementProgram:manage` (roles `owner`, `admin`); reading needs `improvementProgram:read`. Creating the CI credential needs `credential:create` (`owner`, `admin`).
- **Needs**, all in the program's Workspace:

| Needs | Constraint | Skill |
| --- | --- | --- |
| A robot Task (`tsk_...`) | the behaviour being improved | `fleet-inventory` |
| A reference Artifact (`art_...`) | `payloadClass` `model_release`; the model the program starts from | `training-run`, `artifact-build` |
| A LaunchTemplate (`ltpl_...`) | every training of the program uses it; its `guardrails` bound every launch | `training-run` |
| One published EvaluationProtocol (`evp_...`) per role: `dev`, `validation`, `final`, optional `retention` | see step 1 | `evaluation-definitions` |
| A published SimSuite (`ssut_...`) for each role whose protocol runs in simulation | the suite runs that protocol | `simulation-suite` |
| A monthly compute quota with a hard stop | the budget all programs of the Workspace share | `compute-setup` |
| For level `code`: a Git repository with the trainer and inference code, CI, and a registry the compute pools can pull from | step 3 | `compute-setup` for registry access |
| `rfabric-rsi-agent` connected to the Workspace | rFabric grants it; ask your rFabric contact before you start, with the organization id and the workspace id. A program can be created and checked without it, but stays `paused` | none |

- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which Task, reference Artifact and LaunchTemplate | the program's identity and start | list them (`tasks.list`, `artifacts.list` with `payloadClass` `model_release`, `launch-templates.list`) and let the user pick |
| Repository clone URL | where code changes go; required at every change level | the URL the repository is cloned with (HTTPS or SSH) |
| Paths the agent must never edit | they become `frozenPaths` | step 2 proposes a list |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| `changeLevels` `["config"]` (recommended first) | start small, or there is no CI yet | the agent only changes one training parameter per Experiment, within the LaunchTemplate's `allowedOverrideKeys`; candidates reuse the parent's images; step 3 is not needed |
| `changeLevels` `["config", "code"]` | the limit is in the code: rewards, preprocessing, observation or action design | the agent also commits to `<branchPrefix><experimentId>` branches of the repository; needs step 3 and a reference Artifact attested with a commit |

## Steps

### 1. Check the building blocks

Read each one; fix through the named skill what does not hold.

| Read | Must hold | Otherwise |
| --- | --- | --- |
| `artifacts.get` (reference) | `payloadClass` `model_release`, same Workspace. For `config`: its Model (`models.get` with `modelId`) has a `checkpointId`, so the agent can reuse the trainer image of the TrainingRun behind it. For `code`: `attestation.sourceRef` is a full commit SHA of the repository, the commit both images were built from | create is refused (422); or the agent proposes no change of that level |
| `launch-templates.get` | `guardrails.allowedOverrideKeys` contains `image` and every training parameter the agent may tune | the agent skips the program: it sets the trainer image as a launch override |
| `evaluation-protocols.get` per role | `status` `published`; `resultVisibility` `workspace` for `dev`, `validation` and `retention`, `restricted` for `final`; no rollout seed shared between two roles; the `validation` protocol's primary metric has direction `higher_is_better` or `lower_is_better` | create is refused (422) |
| `sim-suites.get` per simulation role | `status` `published`, `protocolId` equals the role's protocol | create is refused (422) |
| `workspaces.compute-quota-usage` | `hardStop` `true` and quotas the user accepts as the monthly budget | the agent has no spending limit |

Roles in the user's terms: `dev` is a cheap screen of every candidate; `validation` decides acceptance against the current best; `retention` checks that what already worked still works; `final` is for the release decision and stays hidden from the agent.

A role whose protocol has `executionMode` `simulation` is launched by the agent. For any other mode a person launches the job on each candidate (`evaluation-job`) and the agent waits for it: tell the user that this makes every Experiment wait for them.

### 2. Explain the boundaries and decide

Tell the user what they are authorizing before they decide:

| The agent may | The agent may not |
| --- | --- |
| create Experiments on this program and conclude them | change the program, its roles, protocols, suites or simulator assets |
| launch and cancel trainings from the program's LaunchTemplate, within its `guardrails` and the Workspace quota | change the LaunchTemplate or exceed the quota's hard stop |
| promote the final Checkpoint and register a `model_release` Artifact for the candidate | approve a Model, promote or publish an Artifact, deploy anything |
| launch simulation suites for `dev`, `validation` and `retention`; cancel superseded jobs | launch or read the `final` role; launch real-robot evaluations |
| commit to `<branchPrefix><experimentId>` branches (level `code`) | edit CI definitions (such as `.github/**`, `.gitlab-ci.yml`, `Jenkinsfile`), `.gitattributes`, `.gitmodules`, submodules, or any path in `frozenPaths` |

Acceptance is not the agent's opinion: fixed code accepts a candidate only when its `validation` report passes, the comparison against the current best says `candidate_better`, and every `retention` report passes.

Then settle with the user:

- **Change levels**: Decisions, above.
- **`frozenPaths`**: globs of repository paths the agent never commits. Propose everything that judges or builds a candidate: the CI script, evaluation and simulator code, packaging scripts, tests, dependency locks. Leave the trainer and inference code open. `*` matches within one path segment, `**` whole segments, `?` one character; no leading `/`.
- **`branchPrefix`**: default `rsi/`. Change it only when the repository already uses that prefix.

### 3. Prepare the repository and its CI

Only for level `code`. The repository must do three things:

1. **Build on push.** On a push to `<branchPrefix><experimentId>`, CI builds the trainer image and the inference image from that commit and pushes both, pinned by digest (`repository@sha256:<64 hex>`; tags are rejected), to a registry the program's compute pools can pull from.
2. **Report to the Experiment.** CI then updates the Experiment's `attributes` with exactly four keys (below) and writes `null` for the ones it does not report. rFabric merges attributes key by key, so the agent's keys stay. On a failed build: the commit, both images `null`, and a short failure summary in the error key. A build whose branch has moved on reports nothing.
3. **One commit, two images.** The trainer writes everything inference needs into its final checkpoint at paths of its choosing; the inference image reads the same relative paths under `/rfabric/weights`. Both come from one commit, so they change together.

The report of a successful build, the body of `experiments.update`:

```json
{ "attributes": {
  "rsi.commit": "<full commit SHA>",
  "rsi.trainerImage": "<registry>/<trainer>@sha256:<digest>",
  "rsi.inferenceImage": "<registry>/<inference>@sha256:<digest>",
  "rsi.buildError": null
} }
```

The CI definition must already be in the commit the reference Artifact was built from (`attestation.sourceRef`): the agent branches every code change from its parent's commit and can never add or edit CI files itself.

CI signs in with its own client credential, without a stored secret. Create it (it returns no secret, so it is safe here):

`credentials.create-clients` with `name`, `organizationId`, `workspaceId`, `permissions` `{"training": ["read", "launch"]}` and one entry in `trusts`: the CI provider's `issuer` and `conditions` that pin the repository by its immutable id and the ref to the agent's branches. Keep the returned `clientId` (`rf_svc_...`). `credentials.list-client-trusts` shows the trust and the `audience` its tokens must carry. Issuers and claim names of each provider are in `ci-integration`.

For GitHub Actions read `github-actions.md` in this skill's directory: the workflow file, the trust values and the branch protection, as one "Your turn" block. For another CI system this skill has no ready pipeline: the job must meet the three requirements above, sign in with the `clientId` as `ci-integration` describes for that system, and report with `rfabric experiment update <experimentId> --data @report.json`.

Done when: `credentials.list-client-trusts` shows the trust, and the CI job exists on the default branch.

### 4. Create the program, paused

1. `improvement-programs.list` with `taskId`: a Task should have one program. If one exists, change it (Change a program) instead of creating a second.
2. `improvement-programs.create`:

```json
{
  "workspaceId": "wks_...",
  "taskId": "tsk_...",
  "status": "paused",
  "referenceArtifactId": "art_...",
  "launchTemplateId": "ltpl_...",
  "evaluations": {
    "dev": { "protocolId": "evp_...", "simSuiteId": "ssut_..." },
    "validation": { "protocolId": "evp_...", "simSuiteId": "ssut_..." },
    "retention": [{ "protocolId": "evp_...", "simSuiteId": "ssut_..." }],
    "final": { "protocolId": "evp_..." }
  },
  "repository": { "url": "https://github.com/acme/pick-policy.git", "branchPrefix": "rsi/", "frozenPaths": ["ci/**", "eval/**"] },
  "changeLevels": ["config"]
}
```

- `status`: send `paused`. Omitted, it is `active`, and the agent starts on its next round.
- `simSuiteId`: required for a simulation protocol, refused for any other.
- `repository` needs its `url` at every change level.
- `taskId` and `workspaceId` are fixed for the life of the program.

Saving pins each role to the version its ids name: the response shows `protocolVersion` and `simSuiteVersion`. A newer version of a protocol or suite is used only after you update the program with that version's id.

### 5. Verify it

`improvement-programs.get`, then show the user one table: Task, reference Artifact, LaunchTemplate, each role with its protocol, pinned version and who launches it, repository, branch prefix, frozen paths, change levels, monthly quota. Repeat the checks of step 1 against the stored ids. Nothing runs yet: the program is `paused`.

### 6. Check the agent is connected, then activate

Connecting the agent to a Workspace (Needs) leaves two things in the user's organization. Read both and show them to the user: they are what the agent acts with.

| What | Read | Must hold |
| --- | --- | --- |
| A client credential named `rfabric-rsi-agent <workspace id>` | `credentials.list-clients` with `organizationId` | `enabled` `true`, the program's `workspaceId`, and `permissions` exactly: `improvementProgram` `read`; `training` `read`, `launch`, `cancel`, `promote`; `model` `read`; `artifact` `read`, `build`, `create`; `simSuite` `launch`; `evaluationJob` `cancel`; `compute` `read` |
| A webhook subscription to the agent | `webhook-subscriptions.list` with `workspaceId` | `status` `active`; it sends training, checkpoint, artifact and evaluation events of the Workspace to the agent |

- Either one missing: the agent is not connected. Leave the program `paused` and tell the user: "Nothing runs yet. Ask your rFabric contact to connect rfabric-rsi-agent to workspace <wks_...> of organization <org_...>, then tell me." Check again when they return.
- More permissions than listed: tell the user which, and activate only when they accept them.
- Level `code`: the agent pushes its branches with its own Git identity. On GitHub that is the deploy key of the "Your turn" block in `github-actions.md`; check with the user that it was added.

Then, on the user's go, `improvement-programs.update` with `{"status": "active"}`. Say what starts: the agent evaluates the reference Artifact once under `validation`, then proposes its first Experiment; every training and evaluation spends the Workspace's compute quota.

### 7. Follow Experiments and verdicts

`experiments.list` with `improvementProgramId` (and `sort` `createdAt:desc`). The agent's Experiments carry the tag `rsi`; `hypothesis` says what it expects, and `attributes` hold its record under `rsi.*` keys.

| Read | Says |
| --- | --- |
| `attributes` `"rsi.changeLevel"`, `"rsi.change"`, `"rsi.parentArtifactId"` | the one change (`config`: one parameter and value; `code`: the planned edit) and the Artifact it must beat |
| `"rsi.changeCommit"`, `"rsi.changeReview"` | a code change was recorded and reviewed; it is pushed only after an approving review |
| `"rsi.commit"`, `"rsi.trainerImage"`, `"rsi.inferenceImage"` | the user's CI built the branch |
| `"rsi.buildError"` | the user's CI failed: the Experiment concludes `inconclusive` |
| `training-runs.list` with `experimentId` | the candidate's training and its status |
| `evaluation-jobs.list` with `protocolId` (a role's protocol), newest first | the jobs of that role; the candidate's is the one whose `subjectId` is its Artifact. `evaluation-jobs.report` gives `conclusionStatus` `pass`, `fail` or `inconclusive` |
| `evaluation-comparisons.list` with `protocolId` (validation) | `conclusion` `status` (`candidate_better`, `baseline_better`, `no_clear_difference`, `inconclusive`) and `winner` |
| `"rsi.llmCostMicros"` | model spend of this Experiment in millionths of a US dollar |
| `status` `completed` and `conclusion` | the verdict: `decision`, `outcomeSummary`, `winningModelId`, `winningRunId` |

| `decision` | Meaning | Tell the user |
| --- | --- | --- |
| `accept` | validation passed, the candidate beat the current best, every retention check passed | the new current best is the `model_release` Artifact of `winningModelId` (`artifacts.list` with `modelId`). Nothing is shipped: releasing is theirs (Next) |
| `reject` | a review refused the change, a protected path was touched, or a report or the comparison went against it | no action; the evidence feeds the next proposal |
| `inconclusive` | CI build failed, the training failed, infrastructure failed twice, the evidence did not separate the two, or the Experiment's model budget ran out | check `"rsi.buildError"` and the failed run; fix what is theirs |
| `evaluator_issue` | the evaluation itself looks defective (it rewards degenerate behaviour, or cannot be passed) | the agent stops proposing on that evidence; an evaluation engineer fixes the protocol or scenario (`evaluation-definitions`), then update the program with the new version |

Report per Experiment in one line: change, stage, verdict. Do not poll in a loop: an Experiment takes a training plus several evaluation jobs; offer to check again later.

## Change a program

`improvement-programs.update` with only the fields that change. Every edit is audited.

- `evaluations` and `repository` are replaced whole: send the complete object. A `repository` without `frozenPaths` clears them.
- New protocol or suite version: send `evaluations` with the new ids; the response shows the new pins.
- Adding `code` to `changeLevels`: do step 3 first.
- Experiments already open keep running under the edited program; pause first when the edit changes how candidates are judged.

## Pause, archive or delete

| Goal | Operation | Effect |
| --- | --- | --- |
| Stop for now | `improvement-programs.update` `{"status": "paused"}` | the agent leaves the program alone from its next round: no new Experiments, open ones stop advancing. Trainings and evaluation jobs already running finish and still spend quota; cancel them through `training-run` and `evaluation-job` when needed. Reversible with `active` |
| Stop for good, keep it readable | `improvement-programs.update` `{"status": "archived"}` | as paused; marks the program as finished |
| Remove it | `improvement-programs.delete` | the program is gone and cannot be restored here; its Experiments, Models and Artifacts stay. Prefer `archived` |

After stopping for good, on the user's side: revoke the CI credential (`credentials.delete-clients`), remove the agent's deploy key and the CI job (`github-actions.md`, "To undo"). The agent's own credential serves every program of the Workspace: revoke it only when no program remains.

## Problems

A refused create or update is 422 `VALIDATION_ERROR`; `field` in its `details` names the input at fault and the message says why.

| Signal | What it means | Do |
| --- | --- | --- |
| 422, `field` `referenceArtifactId` | not an Artifact of this Workspace, or not `model_release` | pick a `model_release` Artifact of the Workspace |
| 422, `field` `taskId` or `launchTemplateId` | not in this Workspace | use the Workspace's own Task and LaunchTemplate |
| 422, `field` `evaluations.<role>.protocolId` (retention: `evaluations.retention.<i>.protocolId`) | one of: not visible, not `published`, wrong `resultVisibility` for the role, a rollout seed shared with another role, simulation protocol without `simSuiteId`, or a validation primary metric that defines no order | fix the protocol through `evaluation-definitions` or choose another; give each role its own seeds |
| 422, `field` `evaluations.<role>.simSuiteId` | suite not visible, not `published`, runs another protocol, or given for a protocol that is not simulation | pass the suite of that protocol, or drop `simSuiteId` |
| 422, `field` `repository.frozenPaths[<i>]` | that glob is invalid or repeated | no leading `/`, no `.` or `..` segment, no backslash, no `[`, `]`, `{`, `}`; at most 100 entries |
| 403 on create or update | `improvementProgram:manage` is missing | an organization `owner` or `admin` does it |
| Program `active`, no Experiment appears | in order: the agent is not connected to this Workspace (step 6); the LaunchTemplate does not allow `image`; the quota is spent (`workspaces.compute-quota-usage`); the reference's validation job has not finished or failed twice on infrastructure; a diagnosis reported an evaluator defect | check each with the read named in steps 1, 6 and 7; when all hold, the user asks their rFabric contact to look at the agent's log, with the program id |
| Experiment stays without `"rsi.commit"` after `"rsi.changeReview"` approved | the user's CI did not run or could not report | the CI run on branch `<branchPrefix><experimentId>`; a refused sign-in names the token's issuer and audience: compare with `credentials.list-client-trusts` |
| No `code` Experiment, only `config` | the parent Artifact's `attestation.sourceRef` is not a commit SHA | register the reference Artifact again with its source commit (`artifact-build`) and update `referenceArtifactId` |
| Candidates wait at an evaluation | the role's protocol is not simulation: a person must launch it | `evaluation-job` on the candidate Artifact with the role's protocol |
| Every Experiment `reject` on the same paths | the change the task needs lies in `frozenPaths` | decide with the user whether that path may open; update `repository` |

## Done when

- [ ] `improvement-programs.get`: `status` `active`, the roles pinned to the versions the user confirmed, `changeLevels` and `frozenPaths` as decided.
- [ ] `launch-templates.get`: `allowedOverrideKeys` contains `image`.
- [ ] `workspaces.compute-quota-usage`: `hardStop` `true`.
- [ ] `credentials.list-clients`: the agent's credential has exactly the permissions of step 6; for `code`, the CI credential has `training` `read`, `launch` only and one trust on the agent's branches.
- [ ] The user saw the boundaries table of step 2 before activation.
- [ ] `experiments.list` with `improvementProgramId` shows the first Experiment, or you told the user what must happen first.

## Next

- `evaluation-job`: launch the `final` role on an accepted candidate, and the roles that need a person.
- `model-release`: approve the accepted Model.
- `deployment-rollout`: roll the released Artifact out to robots.
- `experiment`: compare the agent's Experiments with your own.

## The rfabric CLI

| Step | CLI |
| --- | --- |
| Create the CI credential | `rfabric credential create --name <name> --workspace-id <wks> --permission training:read,launch --trust-issuer <issuer> --trust-condition <claim>=<value> --trust-condition '<ref claim>=<pattern>'` |
| Show its trusts and audience | `rfabric credential trust list <clientId>` |
| Create the program | `rfabric improvement-program create --data @program.json --frozen-path 'ci/**'` |
| Read, list | `rfabric improvement-program get <id>`, `rfabric improvement-program ls` |
| Pause, activate | `rfabric improvement-program update <id> --field status=paused` |
| Replace the frozen paths only | `rfabric improvement-program update <id> --frozen-path 'ci/**' --frozen-path 'eval/**'` |
| Report a build from CI | `rfabric experiment update <experimentId> --data @report.json` |
