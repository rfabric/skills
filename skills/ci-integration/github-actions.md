# CI integration: GitHub Actions

The repository side of `ci-integration` for GitHub Actions: where each step of the main file happens on GitHub, the exact values, and what the user sees. The step numbers are those of the main file.

| Step | On GitHub | Who |
| --- | --- | --- |
| 2 | read the repository's numeric id | anyone who can read the repository |
| 4 | two repository variables, one workflow file, a pull request | a repository admin |
| 5 | the first run: the check `rfabric` on the pull request | the user watches, the agent follows the job |
| 6 | the verdict: the check, the pull request comment, the job summary | the user reads, the agent explains |
| 7 | make the check required on the base branch | a repository admin |

## Trust values

| Field | Value |
| --- | --- |
| `issuer` | `https://token.actions.githubusercontent.com` |
| Repository identifier claim | `repository_id` (the numeric id, as a string) |
| Base branch condition | `ref`: `refs/heads/<base branch>` |
| Pull request condition | `ref`: `refs/pull/*/merge` |
| Tag condition | `ref`: `refs/tags/v*` |
| Environment condition | `environment`: `<environment name>` |

The audience needs no setting: the wrapper asks GitHub for a token with the trust's `audience`. The job only needs `id-token: write`.

## Your turn 1: find the repository id (step 2)

For a public repository, read `id` from `https://api.github.com/repos/<owner>/<repo>` yourself and skip this block.

With a shell where the user's `gh` is signed in, run the command yourself after the user approves. First show which account it is signed in to (`gh auth status`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - a terminal with the GitHub CLI, one command
Why: rFabric trusts your repository by its numeric id, which stays the same when the repository is renamed.
Who: anyone who can read the repository.

1. Run: gh api repos/<owner>/<repo> --jq .id

Changes nothing. Bring back: the number it prints.
Then I: create the service credentials that trust this repository.
```

## Your turn 2: variables and workflow file (step 4)

**Decide where the image goes first.** The suite's pool must be able to pull it.

| Option | Choose when | Consequence |
| --- | --- | --- |
| GitHub Container Registry, public package (the workflow below) | the controller image may be public | no cloud account needed. A package pushed from a private repository starts private: the user makes it public once (The first run, below). A public package cannot be made private again |
| Amazon ECR or Google Artifact Registry, private | the image must stay private | connect the registry to rFabric first (`compute-setup`, Container registry access); the workflow signs in to that registry instead (Adapt, below) |

Fill in the client ids from step 3, the suite from step 1 and the workspace name first.

With a shell where the user's `gh` is signed in, and a clone of the repository, do the three actions yourself after the user approves: `gh variable set <NAME> -R <owner>/<repo> --body <client id>` per variable, the workflow file committed on a new branch and pushed, then `gh pr create`. First show which account it is signed in to (`gh auth status`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - GitHub, repository <owner>/<repo>
Why: the workflow signs in with GitHub's own identity token, so the only rFabric values it needs are the client ids, which are not secrets.
Who: a repository admin (variables need admin rights).

1. Settings > Secrets and variables > Actions > Variables tab > New repository variable:
   RFABRIC_CLIENT_ID = <client id of the base-branch credential, or of the single credential>
   RFABRIC_PULL_REQUEST_CLIENT_ID = <client id of the pull request credential>   (only with two credentials)
2. Add the file .github/workflows/rfabric.yml with the content below, on a new branch.
3. Open a pull request from that branch into <base branch>.

Creates: the variables and one workflow file. From then on every pull request and every push to <base branch> builds the image,
         pushes it to the GitHub Container Registry and launches one evaluation job in workspace <workspace>, which uses its compute quota.
Undo: delete the variables and the file.
Bring back: the pull request's link.
Then I: follow the evaluation job the workflow launches.
```

```yaml
name: rfabric
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write        # the identity token exchanged for rFabric access
  pull-requests: write   # the pull request comment
  packages: write        # the push to the GitHub Container Registry

concurrency:
  group: rfabric-${{ github.ref }}
  cancel-in-progress: true   # a new push cancels the evaluation job of the previous one

jobs:
  rfabric:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Image repository
        run: echo "IMAGE_REPOSITORY=ghcr.io/${GITHUB_REPOSITORY,,}/controller" >> "$GITHUB_ENV"
      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          provenance: false
          tags: ${{ env.IMAGE_REPOSITORY }}:${{ github.sha }}
      - uses: rfabric/cli@v0.1
        with:
          suite: <suite slug>
          image: ${{ env.IMAGE_REPOSITORY }}@${{ steps.build.outputs.digest }}
          client-id: ${{ vars.RFABRIC_CLIENT_ID }}
          pull-request-client-id: ${{ vars.RFABRIC_PULL_REQUEST_CLIENT_ID }}
```

The wrapper's inputs in this file, and the ones most often added:

| Input | Meaning | Default |
| --- | --- | --- |
| `suite` | the suite's slug, `slug@version` or id. Set this or `dir` | none |
| `dir` | a definition directory; runs its published suites | none |
| `image` | the candidate image as `<repository>@sha256:<digest>`; the wrapper registers it as an Artifact. Set this or `candidate` | none |
| `candidate` | an Artifact id instead of `image` | none |
| `client-id` | the credential used on every run but a pull request's (required) | none |
| `pull-request-client-id` | the credential used on pull request runs | `client-id` |
| `model-name` | the Model the image is registered for | the last path segment of the image repository (`controller`) |
| `baseline` | the baseline's id (the Artifact in production), or `auto` | none |
| `wall-deadline` | seconds the job may run; also bounds the wait | `7200` |
| `comment` | write the pull request comment | `true` |

Further inputs, each described by the action: `suites`, `tags`, `base-branch`, `test-run`, `weights`, `model`, `cells`, `pool`, `max-worker-hours`, `max-parallel-gpu`, `max-parallel-cpu`, `workspace`, `client-secret`, `cli-version`.

Adapt before handing over:

| Case | Change |
| --- | --- |
| Base branch is not `main` | `branches:` under `push` |
| Definition directory | replace `suite: <slug>` with `dir: <directory>` |
| One launch-only credential | set only `RFABRIC_CLIENT_ID` and delete the `pull-request-client-id` line |
| Fixed artifact, no image build | delete the four image steps and `packages: write`; replace `image:` with `candidate: <artifact id>` |
| Dockerfile not at the root | add `file: <path>` to the build step |
| The image build reads the BuildKit secret `github_token` (a Dockerfile with `--mount=type=secret,id=github_token`, as the starter controller has) | add `secrets: github_token=${{ secrets.RFABRIC_PACKAGES_TOKEN }}` to the build step; the user stores the GitHub token their local build passes as that secret (it reads the private rFabric Python packages) under Secrets tab > New repository secret, named RFABRIC_PACKAGES_TOKEN. It is used by the image build only and never reaches rFabric |
| Private image in Amazon ECR | replace the `docker/login-action` step with `aws-actions/configure-aws-credentials@v4` (`role-to-assume`: a role in the user's AWS account that trusts GitHub's identity tokens and may push to the repository; `aws-region`) and `aws-actions/amazon-ecr-login@v2`; set `IMAGE_REPOSITORY` to `<account id>.dkr.ecr.<region>.amazonaws.com/<repository>`; delete `packages: write`. GitHub's guide "Configuring OpenID Connect in Amazon Web Services" covers the role |
| Client secret credential | add `client-secret: ${{ secrets.RFABRIC_CLIENT_SECRET }}` and store the secret as a repository secret; `id-token: write` is then not needed |
| Pin an exact wrapper release | `rfabric/cli@v<full version>` instead of the floating `v0.1` |

## The first run (step 5)

Tell the user what the pull request shows, in this order. The check is named `rfabric`.

| Workflow step | What happens | A stop here means |
| --- | --- | --- |
| the image steps | the image is built and pushed as `ghcr.io/<owner>/<repo>/controller` | a build error of their Dockerfile |
| "Install the rFabric CLI" | the pinned CLI is installed on the runner | nothing to do with rFabric access |
| "Run the sim suites" | sign-in with GitHub's identity token; the image is registered as an Artifact (the first run also creates the Model `controller`); the launch is checked; the EvaluationJob starts (log line "Simulation job evj_...") and the step waits for its verdict | a refused sign-in, a blocker, or the verdict (main file, Problems and step 6) |
| "Publish the result" | the scorecard is written to the job summary and the pull request comment | never fails the check by itself |

While it waits, find the job with `evaluation-jobs.list`: `workspaceId` and `ciRef` `refs/pull/<number>/merge`.

With a private repository the first run stops at the launch check with an image blocker naming ghcr.io (`image_access_denied`): the package is private, and rFabric's pools and connected pools pull from the GitHub Container Registry without signing in. Then:

```text
Your turn - GitHub, package <repo>/controller
Why: rFabric's pools and connected pools pull this image without signing in, so the package must be public.
Who: an owner of the account or organization that owns the package. An organization can forbid public packages: then use Amazon ECR or Google Artifact Registry instead.

1. On the repository's main page, under "Packages", open <repo>/controller.
2. Choose "Package settings".
3. Under "Danger Zone" choose "Change visibility", select "Public" and confirm.
4. Run the workflow again: open the failed run ("Details" on the check) and choose "Re-run jobs".

Cannot be undone: a public package cannot be made private again. Anyone can then pull the image.
Bring back: nothing, tell me when the workflow runs again.
Then I: follow the evaluation job.
```

## Reading the verdict on the pull request (step 6)

| Where | What it shows |
| --- | --- |
| The check `rfabric` in the pull request's checks box | green only for `complete_pass`; red for every other outcome, a blocker or a refused sign-in included |
| The pull request comment, one per suite or definition directory, updated on every push | the scorecard |
| "Details" on the check, then Summary | the same scorecard, also for pushes to the base branch |
| Error annotations on the run | launch blockers, one per blocker, titled with its code |
| The workflow artifact `rfabric-sim-run-<suite>-<job id>` | the JUnit XML and the scorecard as files |

The scorecard, top to bottom: Conclusion and Classification, the candidate and its run counts, a link to the job, "Gate chain" (each step with its status and reasons: the first failed step is why it did not pass), "Failed and inconclusive cases" (case, side, cell, seed, outcome, reason), "Baseline comparison" when there is a baseline, metrics, and the command that reproduces the job. With `dir`, a section "Test run - not yet approved" reports changed definitions; it never decides the check.

Step outputs for later steps: `job-id`, `report-id`, `conclusion`, `operational-classification`, `job-url`, `artifact-id`, `suites`.

## Your turn 3: require the check (step 7)

```text
Your turn - GitHub, repository <owner>/<repo>
Why: until the check is required, a failing suite does not block a merge.
Who: a repository admin. A private repository needs a paid GitHub plan for protected branches.

1. Settings > Branches > add or edit the branch protection rule for <base branch>.
2. Tick "Require status checks to pass before merging".
3. Search for the check "rfabric" (the workflow's job) and select it. It is listed only after the workflow has run once.
4. Save.

Effect: no pull request merges into <base branch> unless the suite passes on it. Undo: untick the check in the same rule.
Bring back: nothing, tell me when it is saved.
Then I: confirm with you on the next pull request that a failing run blocks the merge.
```

Keep the workflow file's `suite`, `suites` and `tags` values under review: whoever can change them changes what the check runs.

## Scheduled runs

A second workflow file, for example .github/workflows/rfabric-nightly.yml:

```yaml
name: rfabric-nightly
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  nightly:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: rfabric/cli@v0.1
        with:
          suite: <suite slug>
          candidate: <artifact id>
          client-id: ${{ vars.RFABRIC_CLIENT_ID }}
```

A scheduled workflow runs on the default branch, so its token's `ref` is `refs/heads/<default branch>`: the base-branch trust admits it.

## Release gate

```yaml
on:
  push:
    tags: ['v*']
```

with the wrapper inputs `suite: <slug>@<version>`, `baseline: <artifact id in production>` and `client-id:` set to a credential that has a trust with `ref`: `refs/tags/v*`.

## Behaviour to tell the user

| Situation | What happens |
| --- | --- |
| Pull request from a fork | GitHub gives the job no identity token: the step fails with a notice and posts no comment. A maintainer pushes the commit to a branch of the repository |
| Workflow cancelled, or superseded by a new push | the wrapper cancels the evaluation job |
| "Re-run jobs" | launches a new evaluation job; a retried step inside one run attempt returns the same job |
| Long suites | the job's `timeout-minutes` (GitHub default 360) must cover `wall-deadline` plus 300 seconds |
| `commit` on a pull request | the job's `ci` records the merge commit as `commit` and the branch head as `headCommit` |
| The workflow fails before its first step, naming `rfabric/cli` as not allowed | the organization limits which actions may run: an organization owner allows `rfabric/cli` under Settings > Actions > General |
