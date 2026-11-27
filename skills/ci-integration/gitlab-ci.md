# CI integration: GitLab CI

The repository side of `ci-integration` for GitLab CI. The step numbers are those of the main file.

## Trust values

| Field | Value |
| --- | --- |
| `issuer` | `https://gitlab.com`; self-managed: the GitLab URL, exactly as its tokens carry it in `iss` |
| Repository identifier claim | `project_id` (the numeric id, as a string) |
| Base branch condition | `ref_path`: `refs/heads/<base branch>` |
| Merge request condition | `pipeline_source`: `merge_request_event` |
| Tag condition | `ref_path`: `refs/tags/v*` |
| Environment conditions | `environment`: `<name>`, `deployment_tier`: `<tier>` |

A self-managed GitLab must be reachable from the internet over https, because rFabric fetches its signing keys from the issuer URL. If it is not, use a client secret credential.

The identity token must carry the trust's `audience`: the template's `audience` input sets it (default `https://auth.rfabric.io`).

## Your turn 1: find the project id (step 2)

```text
Your turn - GitLab, project <group>/<project>
Why: rFabric trusts your project by its numeric id, which stays the same when the project is renamed or moved.
Who: anyone who can open the project.

1. Open the project's overview page.
2. Copy the Project ID shown under the project name (or in the actions menu next to it).

Bring back: the number.
Then I: create the service credentials that trust this project.
```

## Your turn 2: variables and pipeline file (step 4)

Fill in the client ids and `audience` from step 3 and the suite from step 1 first. With a shell in a clone of the repository, do action 2 yourself after the user approves (the file on a new branch, pushed with the user's `git`): first show where it pushes (`git remote -v`) and let the user confirm. The settings page and the merge request stay with the user. Without a shell, hand the whole block over.

```text
Your turn - GitLab, project <group>/<project>
Why: the job signs in with GitLab's own identity token, so the only rFabric values it needs are the client ids, which are not secrets.
Who: a project member with the Maintainer role (CI/CD variables need it).

1. Settings > CI/CD > Variables > Add variable. For each: Visibility "Visible", "Protect variable" not selected
   (a protected variable is missing in merge request pipelines of unprotected branches).
   RFABRIC_CLIENT_ID = <client id of the base-branch credential, or of the single credential>
   RFABRIC_PULL_REQUEST_CLIENT_ID = <client id of the pull request credential>   (only with two credentials)
2. Add the content below to .gitlab-ci.yml at the repository root, on a new branch.
3. Open a merge request from that branch.

Creates: the variables and one pipeline file. From then on every merge request pipeline and every pipeline on the default branch builds the image
         and launches one evaluation job in workspace <workspace>, which uses its compute quota.
Undo: delete the variables and the rFabric parts of the file.
Bring back: the merge request's link.
Then I: follow the evaluation job the pipeline launches.
```

```yaml
stages: [build, test]

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

build:
  stage: build
  image: docker:27
  services: [docker:27-dind]
  script:
    - apk add --no-cache jq
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
    - docker buildx build --provenance=false --push
        --metadata-file meta.json -t "$CI_REGISTRY_IMAGE/controller:$CI_COMMIT_SHA" .
    - echo "IMAGE=$CI_REGISTRY_IMAGE/controller@$(jq -r '."containerimage.digest"' meta.json)" > build.env
  artifacts:
    reports:
      dotenv: build.env

include:
  - remote: https://raw.githubusercontent.com/rfabric/cli/v0.1/templates/sim-run.yml
    inputs:
      suite: <suite slug>
      image: $IMAGE
      client-id: $RFABRIC_CLIENT_ID
      audience: https://auth.rfabric.io

rfabric-sim-run:
  timeout: 2h10m   # covers wall-deadline (7200 s) plus the 300 s wait margin
```

Adapt before handing over:

| Case | Change |
| --- | --- |
| Definition directory | replace `suite: <slug>` with `dir: <directory>` |
| One launch-only credential | create only `RFABRIC_CLIENT_ID` |
| Fixed artifact, no image build | delete the `build` job and the `build` stage; replace `image:` with `candidate: <artifact id>` |
| The image build reads the BuildKit secret `github_token` (a Dockerfile with `--mount=type=secret,id=github_token`, as the starter controller has) | before `docker login` add `printf '%s' "$RFABRIC_PACKAGES_TOKEN" > github_token`, and add `--secret id=github_token,src=github_token` to the build line; the user stores the GitHub token their local build passes as that secret (it reads the private rFabric Python packages) as a CI/CD variable RFABRIC_PACKAGES_TOKEN, Visibility "Masked". It is used by the image build only and never reaches rFabric |
| Client secret credential | add the input `client-secret: $RFABRIC_CLIENT_SECRET` and store the secret as a masked CI/CD variable; never write the secret into the file |
| Longer suites | set the input `wall-deadline` and raise `timeout:` to cover it plus 300 seconds |
| Pin an exact wrapper release | `/v<full version>/` in the `remote:` URL instead of the floating `v0.1` |

Two rules that are easy to get wrong:

- Do not pass the input `pull-request-client-id: $RFABRIC_PULL_REQUEST_CLIENT_ID`. The project variable of that name reaches the job by itself; as an input, GitLab passes the literal text when the variable is unset.
- The job's `timeout:` also bounds its identity token. With no timeout the token lives 5 minutes and a longer wait ends with exit code 1 while the evaluation job runs on.

The image must be pullable by the suite's pool: the Container Registry of a private GitLab project is not. Push to a registry the pool can reach (`compute-setup`).

## What the user sees

- The template adds the job `rfabric-sim-run` on the stage `test` (input `stage`); it runs in the wrapper's own image, so nothing is installed.
- Failed cases in the merge request's test summary and the pipeline's Tests tab.
- The scorecard and the outputs as job artifacts under `rfabric-sim-run/`, kept on failure.
- Dotenv variables for later jobs: `RFABRIC_JOB_ID`, `RFABRIC_REPORT_ID`, `RFABRIC_CONCLUSION`, `RFABRIC_OPERATIONAL_CLASSIFICATION`, `RFABRIC_JOB_URL`, `RFABRIC_ARTIFACT_ID`.
- A merge request note per suite or definition directory, only when a CI/CD variable `RFABRIC_GITLAB_TOKEN` holds a GitLab token with the `api` scope. The user creates that token in GitLab and stores it as a masked variable; it is optional.

## Your turn 3: require the check (step 7)

```text
Your turn - GitLab, project <group>/<project>
Why: until pipelines must succeed, a failing suite does not block a merge.
Who: a project member with the Maintainer role.

1. Settings > Merge requests.
2. Under "Merge checks", select "Pipelines must succeed".
3. Save changes.

Bring back: nothing, tell me when it is saved.
Then I: confirm with you on the next merge request that a failing pipeline blocks the merge.
```

## Scheduled runs

Create a pipeline schedule under Build > Pipeline schedules. The token's `ref_path` is the schedule's target branch, which the trust's condition must admit. To run the rFabric job only for the schedule, limit it:

```yaml
rfabric-sim-run:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
```

## Release gate

Run the template for tags (a `workflow` rule on `$CI_COMMIT_TAG`) with the inputs `suite: <slug>@<version>` and `baseline: <artifact id in production>`, and a `client-id` whose credential has a trust with `ref_path`: `refs/tags/v*`.

## Behaviour to tell the user

| Situation | What happens |
| --- | --- |
| Merge request from a fork | a pipeline running in the fork project fails with a notice: it cannot reach rFabric. A maintainer pushes the commit to a branch of the project |
| Job cancelled | the template's `after_script` cancels the evaluation job |
| Job retried in the same pipeline | returns the evaluation job already launched; a new pipeline launches a new one |
| Merged results pipeline | the job's `ci` records the merge result as `commit` and the source branch head as `headCommit` |
