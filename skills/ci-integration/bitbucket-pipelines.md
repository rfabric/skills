# CI integration: Bitbucket Pipelines

The repository side of `ci-integration` for Bitbucket Pipelines (Bitbucket Cloud). The step numbers are those of the main file.

## Trust values

| Field | Value |
| --- | --- |
| `issuer` | `https://api.bitbucket.org/2.0/workspaces/<workspace>/pipelines-config/identity/oidc` (the "Identity provider URL" Bitbucket shows) |
| Repository identifier claim | `repositoryUuid` (the UUID with its braces, `{...}`) |
| Base branch condition | `branchName`: `<base branch>` |
| Pull request condition | none: the token has no pull request claim |
| Deployment environment condition | `deploymentEnvironmentUuid`: `{...}` |

Because no claim marks a pull request, the pull request credential trusts every pipeline of the repository (only the `repositoryUuid` condition). That is safe only because it cannot publish. The base-branch credential keeps its exact `branchName` condition.

The identity token must carry the trust's `audience`: the step's `oidc: audiences:` sets it.

## Your turn 1: find the issuer and the repository UUID (step 2)

```text
Your turn - Bitbucket, repository <workspace>/<repository>
Why: rFabric trusts your repository by its UUID, which stays the same when the repository is renamed.
Who: a repository admin (repository settings).

1. Open the repository, then More actions (...) > Settings.
2. Under Pipelines, select OpenID Connect.
3. Copy the "Identity provider URL".
4. From the example payload under "Unique identifiers", copy repositoryUuid, braces included.

Bring back: the URL and the UUID.
Then I: create the service credentials that trust this repository.
```

## Your turn 2: variables and pipeline file (step 4)

Fill in the client ids and `audience` from step 3, the suite from step 1 and the image repository first. With a shell in a clone of the repository, do action 3 yourself after the user approves (the file on a new branch, pushed with the user's `git`): first show where it pushes (`git remote -v`) and let the user confirm. The settings pages, the registry login and the pull request stay with the user. Without a shell, hand the whole block over.

```text
Your turn - Bitbucket, repository <workspace>/<repository>
Why: the step signs in with Bitbucket's own identity token, so the only rFabric values it needs are the client ids, which are not secrets.
Who: a repository admin.

1. Repository settings > Pipelines > Repository variables. Add, not Secured:
   RFABRIC_CLIENT_ID = <client id of the base-branch credential, or of the single credential>
   RFABRIC_PULL_REQUEST_CLIENT_ID = <client id of the pull request credential>   (only with two credentials)
   IMAGE_REPOSITORY = <registry>/<namespace>/<image name>
2. Add, with "Secured" ticked, the login of the registry the image is pushed to:
   DOCKERHUB_USER, DOCKERHUB_TOKEN (your Docker Hub user name and an access token that may push; neither reaches rFabric).
3. Add the content below as bitbucket-pipelines.yml at the repository root, on a new branch.
4. Open a pull request from that branch.

Creates: the variables and one pipeline file. From then on every pull request pipeline and every pipeline on <base branch> builds the image
         and launches one evaluation job in workspace <workspace>, which uses its compute quota.
Undo: delete the variables and the file.
Bring back: the pull request's link.
Then I: follow the evaluation job the pipeline launches.
```

```yaml
definitions:
  steps:
    - step: &build
        name: Build
        services: [docker]
        script:
          - export DOCKER_BUILDKIT=1
          - docker login -u "$DOCKERHUB_USER" -p "$DOCKERHUB_TOKEN"
          - docker build -t "$IMAGE_REPOSITORY:$BITBUCKET_COMMIT" .
          - docker push "$IMAGE_REPOSITORY:$BITBUCKET_COMMIT"
          - echo "export IMAGE=$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE_REPOSITORY:$BITBUCKET_COMMIT")" > image.env
        artifacts: [image.env]
    - step: &rfabric
        name: rFabric
        max-time: 130   # minutes; covers RFABRIC_WALL_DEADLINE (7200 s) plus the 300 s wait margin
        oidc:
          audiences: [https://auth.rfabric.io]
        script:
          - source image.env
          - pipe: docker://ghcr.io/rfabric/cli:0.1
            variables:
              RFABRIC_SUITE: <suite slug>
              RFABRIC_IMAGE: $IMAGE
              RFABRIC_CLIENT_ID: $RFABRIC_CLIENT_ID
              RFABRIC_PULL_REQUEST_CLIENT_ID: $RFABRIC_PULL_REQUEST_CLIENT_ID

pipelines:
  pull-requests:
    '**':
      - step: *build
      - step: *rfabric
  branches:
    main:
      - step: *build
      - step: *rfabric
```

Adapt before handing over:

| Case | Change |
| --- | --- |
| Base branch is not `main` | the key under `branches:`, and add the pipe variable `RFABRIC_BASE_BRANCH: <base branch>` (Bitbucket gives a step no default branch) |
| Definition directory | replace `RFABRIC_SUITE: <slug>` with `RFABRIC_DIR: <directory>` |
| One launch-only credential | delete the `RFABRIC_PULL_REQUEST_CLIENT_ID` line and variable |
| Fixed artifact, no image build | delete the Build step; replace `RFABRIC_IMAGE` with `RFABRIC_CANDIDATE: <artifact id>` |
| The image build reads the BuildKit secret `github_token` (a Dockerfile with `--mount=type=secret,id=github_token`, as the starter controller has) | before `docker login` add `printf '%s' "$RFABRIC_PACKAGES_TOKEN" > /tmp/github_token`, and add `--secret id=github_token,src=/tmp/github_token` to the build line: the file stays outside the build context, so no `COPY` can put it in a layer. The user stores the GitHub token their local build passes as that secret (it reads the private rFabric Python packages) as a Secured repository variable RFABRIC_PACKAGES_TOKEN. It is used by the image build only and never reaches rFabric |
| Client secret credential | add the pipe variable `RFABRIC_CLIENT_SECRET: $RFABRIC_CLIENT_SECRET` and store the secret as a Secured repository variable; `oidc:` is then not needed |
| Longer suites | set `RFABRIC_WALL_DEADLINE` (seconds) and raise `max-time` (minutes) to cover it plus 300 seconds |
| Pin an exact wrapper release | `ghcr.io/rfabric/cli:<full version>` instead of the floating `0.1` |

Pipe variables are the wrapper's inputs as `RFABRIC_` plus the name in upper snake case: `client-id` is `RFABRIC_CLIENT_ID`.

The image must be pullable by the suite's pool. On rFabric's pools and connected pools: a publicly readable repository, or one in Amazon ECR or Google Artifact Registry connected as a container registry (`compute-setup`, Container registry access). A private Docker Hub repository is not.

## What the user sees

- A Code Insights report on the commit, `rfabric-sim-run-<suite>`: `PASSED`, `FAILED`, or `PENDING` when there is no verdict, with the gate chain, links to the job and an annotation per failed case (the first 1000).
- Failed cases as the step's test results (`test-results/rfabric/`).
- The outputs as JSON in the file rfabric-result.json in the clone directory, for later steps.
- A pull request comment per run, only when a repository variable `RFABRIC_BITBUCKET_TOKEN` holds an access token with pull request write access. The user creates it in Bitbucket and stores it Secured; it is optional. The pipe posts a new comment each run and never edits one.

## Your turn 3: require the check (step 7)

```text
Your turn - Bitbucket, repository <workspace>/<repository>
Why: until a passing build is required, a failing suite does not block a merge.
Who: a repository admin. Blocking the merge (not just warning) needs the Bitbucket Premium plan.

1. Repository settings > Workflow > Branch restrictions > Add a branch restriction.
2. Branch or pattern: <base branch>.
3. Under merge checks, select "Minimum number of successful builds for the last commit with no failed builds and no in progress builds" and choose 1.
4. On Premium, also select "Prevent a merge with unresolved merge checks".
5. Save.

Bring back: whether step 4 was available.
Then I: tell you whether a failing pipeline blocks the merge or only warns.
```

## Scheduled runs

Add a custom pipeline and schedule it under Pipelines > Schedules. The credential it signs in with needs a trust whose conditions the scheduled pipeline's token matches.

```yaml
pipelines:
  custom:
    nightly:
      - step:
          max-time: 130
          oidc:
            audiences: [https://auth.rfabric.io]
          script:
            - pipe: docker://ghcr.io/rfabric/cli:0.1
              variables:
                RFABRIC_SUITE: <suite slug>
                RFABRIC_CANDIDATE: <artifact id>
                RFABRIC_CLIENT_ID: $RFABRIC_CLIENT_ID
```

## Release gate

In the step of the pipeline that gates the release, pass the pipe variables `RFABRIC_SUITE: <slug>@<version>` and `RFABRIC_BASELINE: <artifact id in production>`. A Bitbucket trust has no tag condition.

## Behaviour to tell the user

| Situation | What happens |
| --- | --- |
| Step stopped in Bitbucket | the evaluation job is not cancelled: Bitbucket sends the step no signal. It runs until `RFABRIC_WALL_DEADLINE`. Cancel it from rFabric (main file, Cancel) |
| Identity token lifetime | the step's `max-time` bounds how long the step can sign in. Keep it at `RFABRIC_WALL_DEADLINE` plus 300 seconds or more: a shorter one ends the step with exit code 1 while the job runs on |
| Pull request pipeline | Bitbucket merges the destination branch locally: the job's `ci` records the source head as `commit` and `destinationMerged` true |
| Pull request from a fork | the step has no identity token and fails with a notice. A maintainer pushes the commit to a branch of the repository |
