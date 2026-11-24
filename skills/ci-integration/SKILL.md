---
name: ci-integration
description: >-
  A CI pipeline that signs in to rFabric without a stored secret and runs simulation suites as a merge check and release gate. Use when the user wants rFabric in GitHub Actions, GitLab CI, Bitbucket Pipelines or another CI system, a service credential or trust for a pipeline, a suite as a required check, a release gated against a baseline, nightly suite runs, a pipeline's verdict or cancellation, or a refused sign-in fixed. Not for authoring a suite or launching it by hand: that is `simulation-suite`.
---

# CI integration

The user ends up with a pipeline in their repository that signs in to rFabric with the CI provider's own identity token, runs a simulation suite against the image it built, and fails unless the candidate passes.

| Entity | Id | What it is |
| --- | --- | --- |
| service credential (`ClientCredential`) | client id `rf_svc_...` | the machine identity the pipeline signs in as, with its own permission map |
| trust (`ClientCredentialTrust`) | `cctr_...` | which identity tokens of the CI provider may sign in as that credential: an issuer and claim conditions |
| SimSuite | `ssut_...` | the pinned simulated scenarios the pipeline runs |
| EvaluationJob | `evj_...` | one run of a suite; it records the build that launched it as `ci` |
| EvaluationReport | `evrp_...` | the job's verdict |

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Check what the pipeline will run | agent | `introspect.whoami`, `workspaces.list`, `sim-suites.list`, `credentials.list-clients`, `workspaces-settings.get-effective` | - |
| 2 | Find the repository's identifier | agent with a shell where the CI system's file gives a command; otherwise user, CI provider | - | - |
| 3 | Create the service credentials and their trusts | agent | `credentials.create-clients`, `credentials.list-client-trusts` | - |
| 4 | Add the variables and the pipeline file | agent with a shell for the commands the CI system's file names; otherwise user, CI provider | - | - |
| 5 | Run the first pipeline | user pushes, agent follows | `evaluation-jobs.list`, `evaluation-jobs.get`, `evaluation-jobs.progress` | the job, bounded by `wall-deadline` (default 7200 seconds) |
| 6 | Read the verdict | agent | `evaluation-jobs.report`, `evaluation-reports.junit` | - |
| 7 | Make the check required | user, CI provider | - | - |

Steps 2, 4 and 7 are written out per CI system. Read the one file for the user's CI, in this skill's directory:

| CI system | File |
| --- | --- |
| GitHub Actions | [github-actions.md](github-actions.md) |
| GitLab CI | [gitlab-ci.md](gitlab-ci.md) |
| Bitbucket Pipelines | [bitbucket-pipelines.md](bitbucket-pipelines.md) |
| Jenkins, CircleCI, Buildkite, Azure Pipelines, any other | [other-ci.md](other-ci.md) |

## Before you start

- **Permissions**: creating, rotating and revoking service credentials needs `credential:create`, `credential:rotate` and `credential:revoke`; the built-in roles `owner` and `admin` carry them. Designating a baseline by hand needs `evaluationDefinition:author`. Check the `permissions` map of `introspect.whoami`.
- **Needs**:
  - a published SimSuite: `simulation-suite`;
  - a compute pool that runs it, with a simulator: `compute-setup`, `simulator-setup`;
  - a controller image that runs as a suite's candidate: `artifact-build` says what the image must do;
  - a registry the suite's pool can pull that image from. rFabric's managed pools pull from a repository that allows pulls without sign-in, or from a private repository in Amazon ECR or Google Artifact Registry connected as a container registry: `compute-setup`;
  - on the CI side: rights to edit repository settings (variables, branch rules) and to push a pipeline file;
  - only for a repository started with `rfabric eval init` (end of Decisions): read access to the rFabric simulator library. rFabric grants it; ask your rFabric contact before you start.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| CI system and repository | selects the trust's issuer and the file to read | ask |
| Base branch | the only branch the publishing credential trusts | `main` |
| What to run | the wrapper's `suite` or `dir` input | `sim-suites.list` shows the published suites; a non-null `directoryPath` means the suite comes from a definition directory |
| Candidate | `image` (built by the pipeline) or `candidate` (a fixed artifact) | image built by the pipeline |
| Registry for the image, and whether the image may be public | the pool must be able to pull it | the CI provider's registry when the image may be public; else Amazon ECR or Google Artifact Registry |

## Decisions

**What the check runs.** This decides the credentials below.

| Option | Choose when | Consequence |
| --- | --- | --- |
| `suite` | the suite is authored in rFabric | runs the slug's latest published version, or exactly `slug@version` |
| `dir` | the repository holds the evaluation definitions as files | a push to the base branch publishes the directory; a pull request runs the published suites and test-runs its changes separately, never as the verdict |

**How many credentials.**

| Option | Choose when | Consequence |
| --- | --- | --- |
| Two: base branch and pull request | the check runs a definition directory (`dir`), or uses `baseline: auto` | a pull request job cannot publish definitions or move the baseline, so it cannot weaken its own check |
| One launch-only credential with one trust per ref | the check runs one published suite (`suite`) with no baseline or an explicit one | one client id to configure and to replace when it expires; the pipeline can launch and cancel, never publish |

**How the pipeline signs in.** Fixed when the credential is created: a credential with trusts never gets a secret, and a credential with a secret never gets a trust.

| Option | Choose when | Consequence |
| --- | --- | --- |
| Trust (recommended) | GitHub Actions, GitLab CI, Bitbucket Pipelines, or another issuer whose tokens carry `repository_id`, `project_id` or `repositoryUuid` | nothing to store or rotate; only the named repository and refs can sign in |
| Client secret | any other CI, or a self-managed CI that rFabric cannot reach over public https | a secret shown once, kept in the CI's secret store, rotated by hand |

No repository yet: `rfabric eval init <name> --ci github|gitlab|bitbucket --adapter mujoco|gazebo|isaac-sim` writes a controller, a definition directory and the pipeline file. With a shell, run it yourself after the user approves; without one, hand it over as a "Your turn" block. Use that pipeline file in step 4 instead of the one in the CI system's file: it runs `dir`, so create two credentials. Its image build installs the rFabric simulator library and reads a GitHub token for it (the secret RFABRIC_SIMULATOR_TOKEN the file names; Needs). Then continue at step 2.

## Steps

### 1. Check what the pipeline will run

1. `introspect.whoami`: note `org` and confirm `credential` holds `create`.
2. `workspaces.list`: the workspace the pipeline works in.
3. `sim-suites.list` with `workspaceId` and `status` `published`: confirm the suite and note its `slug`, `version` and `protocolId`. No published suite: stop, that is `simulation-suite`.
4. `credentials.list-clients` with `organizationId`: reuse an enabled credential for this repository instead of creating a duplicate; note each one's `expiresAt`.
5. When a candidate artifact already exists (`artifacts.list`), dry-run the launch with `sim-suites.preflight` (`subjectType` `artifact`, `subjectId`). It creates nothing. `ok` false lists `blockers`: fix them now, because the pipeline stops on the same ones (Problems). `imageChecks` says per image whether the pool can read it. Its `plan` gives `runs`, `estimatedWorkerHours` and `gpuHours`: tell the user that this is what every pipeline run uses from the workspace's compute quota. The wrapper inputs `max-worker-hours`, `max-parallel-gpu` and `max-parallel-cpu` (all three or none) cap one run.
6. With `image`: every run registers the built image as an Artifact of a Model (named after the last path segment of the image repository unless the wrapper's `model-name` or `model` says otherwise; created on the first run). A Model that is not approved yet can be packaged only when the workspace setting `artifact.preApprovalPackaging` is true. Read it with `workspaces-settings.get-effective`. When `value` is false, put the choice to the user before the first run (`artifact-build` owns it: it applies to everyone in the workspace; rollouts still need an approved Model); on their yes, `workspaces-settings.replace` with that key and body `{"value": true}`.

The `credentials.*` operations answer without the `data` envelope: the body is the object itself (`credentials`, `trusts`), and a refusal is `{"error": "<code>", "error_description": "..."}`.

Done when: you can name the suite, the workspace, the credentials to create, and where the image goes.

### 2. Find the repository's identifier

Your turn 1 in the CI system's file. The trust pins the repository by an identifier that survives a rename; a name can be re-registered by someone else.

### 3. Create the service credentials and their trusts

Say before each call what the credential is: a machine identity in the organization that can launch and cancel evaluation jobs in the workspace (and, for the base-branch one, publish definitions), usable only by pipelines of the named repository and refs. `credentials.create-clients`, once per credential. Pull request credential on GitHub Actions:

```json
{
  "name": "robot-ci-pull-request",
  "organizationId": "org_...",
  "workspaceId": "wks_...",
  "permissions": {
    "simSuite": ["launch"],
    "evaluationJob": ["launch", "cancel"],
    "artifact": ["read", "create", "build"],
    "model": ["read", "create"]
  },
  "trusts": [
    { "issuer": "https://token.actions.githubusercontent.com", "conditions": { "repository_id": "123456789", "ref": "refs/pull/*/merge" } }
  ]
}
```

| Credential | Permissions | Trust conditions |
| --- | --- | --- |
| pull request | `simSuite`: `launch`; `evaluationJob`: `launch`, `cancel`; with `image` also `artifact`: `read`, `create`, `build` and `model`: `read`, `create` | the repository identifier and the pull request condition |
| base branch | the same; with `dir` also `evaluationDefinition`: `author`, `publish` and `simAsset`: `publish`; with `baseline: auto` also `evaluationDefinition`: `author` | the repository identifier and the exact base branch |
| single launch-only | as pull request | one trust per ref: base branch, pull request |

- Issuer and condition values per CI system are in its file. A condition is claim to pattern: `*` matches any run of characters, everything else matches itself. All conditions of a trust must match; any one matching trust admits the token.
- The repository identifier condition is exact, never a `*`. On a credential that can publish, the branch condition is exact too.
- `workspaceId` scopes the credential to that workspace; the pipeline then needs no workspace input.
- The response has `clientId`, `clientSecret` (null with trusts), `expiresAt` and each trust's `audience`. A credential has a fixed lifetime and cannot be extended: tell the user the `expiresAt` date and that from that day the pipeline's sign-in is refused until they replace the credential (Rotate or remove). `expiresAt` in the request shortens the lifetime, never extends it.
- More refs later (a release tag, a second branch): `credentials.create-client-trusts` with `issuer` and `conditions`. `credentials.list-client-trusts` shows what a credential trusts.

**Client secret instead.** Omit `trusts`; the response then carries `clientSecret` once. Say before the call that the secret will appear in this conversation, and offer the alternatives: in the rFabric app, Settings > Service credentials > New service credential with "Signs in with: Secret", or `rfabric credential create` in the user's own terminal. Never run that command from your shell: it prints the secret, and its output would enter the conversation. Afterwards find the credential with `credentials.list-clients` and continue from its `clientId`.

Done when: `credentials.list-client-trusts` returns the intended `issuer` and `conditions` for each client id, and you have the `audience`.

### 4. Add the variables and the pipeline file

Your turn 2 in the CI system's file, filled in with the client ids and `audience` from step 3 and the suite from step 1. Client ids are not secrets: they go in plain variables.

### 5. Run the first pipeline

Ask the user to push the pipeline file on a branch and open a pull request (with `dir`: push to the base branch first, so the directory is published; a pull request cannot pass before that).

Tell the user what a run does, so nothing surprises them:

| In order | What it changes in rFabric |
| --- | --- |
| signs in with the CI provider's identity token | nothing; each attempt is in the identity audit trail |
| with `image`: registers the image | an Artifact of the image (the same image registered again returns the same Artifact); on the first run a Model |
| checks the launch | nothing: blockers are listed and the step ends with exit code 1 |
| launches and waits | one EvaluationJob, which uses the workspace's compute quota; the step ends with its verdict |

1. Find the job: `evaluation-jobs.list` with `workspaceId` and `ciHeadCommit` (the pull request's head commit), `ciCommit` (the commit the pipeline checked out, which on a pull request can be a merge commit) or `ciRef` (the git ref of the run). Its `ci` shows the repository, `ref` and `pipelineUrl`; `appUrl` opens it in the app.
2. Follow it: `evaluation-jobs.get` until `status` is `completed`, `failed` or `cancelled`; `evaluation-jobs.progress` gives `runsByStatus` and `projectedCompletionAt`.
3. No job after the rFabric step started: the step ended before the launch. Ask for the step's last log lines and match them in Problems.

The job stops by itself at `wall-deadline` even when the pipeline is gone. A retried step in the same pipeline run returns the same job instead of launching a second one.

Done when: a job with this repository in `ci` reaches a terminal `status`.

### 6. Read the verdict

`evaluation-jobs.report` for the job. Report `conclusionStatus` and `operationalClassification`, the first failed entry of `gateChain`, and `reasonCodes`. `evaluation-reports.junit` returns the failed cases as JUnit XML, the same cases the CI system shows as test results.

| `operationalClassification` | Step exit code | Meaning | Do |
| --- | --- | --- | --- |
| `complete_pass` | 0 | the candidate passed | nothing |
| `behavioral_failure` | 10 | the candidate failed the suite | read the failing gate and the failed cases; fix the candidate |
| `inconclusive` | 20 | not enough valid evidence, or no published suite matched | read the gate's reason; with `dir`, check the suites are published and the filters match |
| `infrastructure_failure` | 30 | the runs could not produce evidence (image pull, simulator crash) | read the report's `diagnostics`; not a statement about the candidate |
| `cancelled` | 40 | cancelled, or the deadline or wait ran out | check who cancelled; raise `wall-deadline` if the suite needs longer |

Every other exit code carries no verdict: 1 a blocked launch check, a refused sign-in or a failed wait; 2 a wrong suite reference or input; 3 problems in the definition directory; `rfabric help exit-codes` lists the rest. Every non-zero code fails the step. Never advise turning one into a pass.

A report with `testRun` true is never a verdict: it comes from a pull request's test run of unpublished definitions.

Done when: the user has the verdict, the failing gate if any, and the link to the job.

### 7. Make the check required

Your turn 3 in the CI system's file. Do it only after one pipeline has passed on the base branch, so the check exists and can pass.

## Scheduled runs

- **Simulation suites**: use the CI system's scheduler (its file has the snippet). Each scheduled pipeline launches a new job.
- **Other protocols** (real robot, replay): an EvaluationSchedule (`evsc_...`) in rFabric. `evaluation-schedules.create` with `workspaceId`, `name`, `protocolId`, `subjectType`, `subjectId` and `intervalS` (at least 60); `evaluation-schedules.list` shows `nextRunAt` and `lastJobId`; `evaluation-jobs.list` with `scheduleId` lists every job it launched; `evaluation-schedules.update` with `enabled` false pauses it; `evaluation-schedules.delete` removes it. A simulation protocol is refused with `simulation_requires_suite` (422).

## Release gate with a baseline

A release gate runs the candidate and the version in production through the same cases and blocks the release unless the candidate is no worse.

- Pass the production artifact as the wrapper's `baseline`, and pin the suite as `slug@version` so a newly published version does not change the gate under a release.
- The protocol needs `statistics.nonInferiorityMargin`; without it a job with a baseline is `inconclusive`. Only a protocol whose `protocolType` is `deployment_acceptance` couples the verdict to an rFabric release; any other still gives the CI verdict. Check with `evaluation-protocols.get`.
- A tag pipeline needs a trust whose condition admits the tag (the CI system's file has the condition). Add it with `credentials.create-client-trusts` to the credential the release pipeline passes as `client-id`.
- **Standing baseline**: with `baseline: auto` the base-branch pipeline runs without a baseline and designates each passing job as its protocol's standing baseline; other refs compare against it. `evaluation-protocols.list-standing-baseline` (`workspaceId`) shows `baselineJobId` and `ageHours`, or `data` null when none is designated. To set it by hand: `evaluation-protocols.replace-standing-baseline` with `workspaceId` and `baselineJobId`, a job of the same workspace and protocol that is not a test run.
- A later deploy stage finds the verdict by commit: `evaluation-jobs.list` with `ciCommit` and `conclusion` `pass`.

## Cancel

Cancelling the pipeline cancels the job on GitHub Actions and GitLab CI. On Bitbucket Pipelines a stopped step cannot. To stop a job yourself: `evaluation-jobs.cancel`. Say first that its runs stop and the job cannot be resumed. Cancelling a `cancelled` job is a no-op; a `completed` or `failed` job answers 409.

## Rotate or remove

| Goal | Operation | Tell the user |
| --- | --- | --- |
| Stop one ref from signing in | `credentials.delete-client-trusts` | a credential keeps at least one trust |
| Stop the pipeline's access | `credentials.delete-clients` | immediate and permanent: the credential can no longer be exchanged for tokens |
| Replace a credential before `expiresAt` | step 3 for a new credential with the same permissions and trusts, then the user changes the client id variable in the CI system (step 4), then `credentials.delete-clients` for the old one | the client id changes, nothing else in the pipeline does; do it before the date, or the check fails on every run from that day |
| New client secret | `credentials.clients-rotate` | the new secret appears once in this conversation: say so first; the old one works until `rotationExpiresAt` (24 hours), so the user updates the CI secret within that window |
| Find unused credentials | `credentials.list-clients` | `stale` true means never used, or not in the last 30 days |

On the CI side, undo by deleting the variables and the pipeline file, and removing the required check.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `invalid_trust` (400) | the trust breaks a rule; `error_description` names it | fix the issuer (public https, no query or fragment) or the conditions (1 to 16, one exact repository identifier) |
| `invalid_request` (400) | `expiresAt` past the allowed lifetime, or an unknown permission | drop `expiresAt`, or correct the permission map |
| `permission_denied` (403) on a `credentials.*` operation | the user lacks the `credential` action named in the message | an organization owner or admin grants it, or creates the credential |
| `credential_has_secret` (409) | a trust was added to a secret credential | create a new credential with `trusts` |
| `last_trust` (409) | removing the only trust | revoke the credential with `credentials.delete-clients` instead |
| `credential_has_no_secret` (409) | rotate on a trust credential | nothing to rotate |
| Log: `token exchange for rf_svc_... refused (invalid_grant (Token exchange refused))` | rFabric refused the identity token. It does not say which check failed; the same log line gives the token's `iss` and `aud` and the `aud` rFabric expects | ask for the whole line, then check in order: the token's `aud` equals the trust's `audience`; its `iss` equals the trust's `issuer` byte for byte; the repository identifier matches; every ref condition matches this run (a GitHub pull request has `refs/pull/<n>/merge`, not the branch); the credential is enabled and not past `expiresAt`. `security.audit` (`organizationId`) lists each attempt as the event "auth.token-exchanged" with `outcome` `refused` or `issued` and the token's issuer and subject in `payload` |
| Sign-in refused on every run from one day on | the credential passed `expiresAt` (`credentials.list-clients`) | Rotate or remove: replace the credential |
| Log: "Not run: this pull request job cannot reach rFabric" | a pull request from a fork has no identity token | a maintainer pushes the commit to a branch of the repository and opens the pull request from it. Never give a fork a publishing credential |
| Sign-in works on the base branch, refused on pull requests | two credentials: the pull request client id is unset, so the base-branch credential is used. One credential: it has no trust for pull requests | set the pull request client id (step 4), or add the trust with `credentials.create-client-trusts` |
| Exit 1 with blocker `subject_not_runnable` | the candidate has no inference server image | pass `image`, or an artifact built from one: `artifact-build` |
| Blocker `suite_not_published` | the suite version is a draft | publish it: `simulation-suite` |
| Blocker `no_capable_pool` | no pool fits the suite's resources | `compute-setup`, or set the wrapper's `pool` |
| Blockers `pool_not_qualified`, `cell_not_supported` | a gating suite on an unqualified pool or unsupported cells | qualify the pool (`compute-setup`) or choose supported cells (`simulation-suite`) |
| Blockers `budget_exceeded`, `quota_exceeded` | the plan exceeds the launch budget or the workspace's compute quota | raise the budget inputs, narrow `cells`, or raise the quota (`compute-setup`) |
| Blockers `container_registry_not_connected`, `image_access_denied`, `image_not_found`, `image_platform_mismatch` | the pool cannot read the candidate image where the pipeline pushed it, or the image is not built for the pool's machines; the message names the image, the pool and the cause | make the image pullable: a public repository, or Amazon ECR or Google Artifact Registry connected as a container registry (`compute-setup`); build for the platform the message names |
| `artifact_model_not_approved` (409) while registering the image | the image is registered for a Model that is not approved | step 1, item 6 |
| `idempotency_conflict` (409) | the same pipeline run launched a different request | start a new pipeline run |
| Exit 40 and the job still `running` | the wait ran out; the job was not cancelled | `evaluation-jobs.cancel`, or let it finish and read it in step 6 |

## Done when

- [ ] `credentials.list-clients` shows each credential `enabled`, with the intended `permissions` and `trusts`, and a `lastUsedAt` after the first pipeline.
- [ ] `evaluation-jobs.list` with the pipeline's commit returns a job whose `ci` names the repository.
- [ ] `evaluation-jobs.report` gave a verdict that matches the pipeline's result, and you told the user what it means.
- [ ] The user confirmed the check is required on the base branch.
- [ ] The user knows each credential's `expiresAt`.

## Next

- `simulation-suite`: add scenarios or cells to what the pipeline checks.
- `evaluation-job`: inspect a failed job's runs and evidence.
- `artifact-build`: build the artifact a pipeline passes as `candidate`.
- `deployment-rollout`: roll out the artifact that passed the release gate.
- `audit-review`: review what service credentials did.

## The rfabric CLI

`rfabric credential create` without `--trust-issuer` and `rfabric credential rotate` print a client secret once. They are for the user's own terminal on every host: run from your shell, their output would bring the secret into the conversation.

| Step | CLI |
| --- | --- |
| Create a credential with a trust | `rfabric credential create --name <name> --workspace-id <id> --permission simSuite:launch --permission evaluationJob:launch,cancel --trust-issuer <issuer> --trust-condition <claim>=<pattern>` |
| Add, list, remove a trust | `rfabric credential trust add <client-id> --issuer <issuer> --condition <claim>=<pattern>`, `rfabric credential trust list <client-id>`, `rfabric credential trust remove <client-id> <trust-id>` |
| List, rotate, revoke | `rfabric credential list`, `rfabric credential rotate <client-id>`, `rfabric credential revoke <client-id>` |
| Dry-run a launch | `rfabric sim run <suite> --candidate <artifact-id> --preflight` |
| Run a suite and wait | `rfabric sim run <suite> --candidate <artifact-id> --wait --junit report.xml --markdown scorecard.md` |
| Find a commit's jobs | `rfabric evaluation-job ls --ci-commit <sha>`, `rfabric evaluation-job ls --ci-head-commit <sha>` |
| Gate a later stage | `rfabric eval gate <job-id>` (exit 0 only for a passing report that is not a test run) |
| Cancel | `rfabric evaluation-job cancel <job-id>` |
| Exit code table | `rfabric help exit-codes` |
| Sign-in attempts | `rfabric security audit` |
