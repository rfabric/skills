# CI integration: any other CI system

The repository side of `ci-integration` for Jenkins, CircleCI, Buildkite, Azure Pipelines and any system without a first-party wrapper. The pipeline runs the `rfabric` CLI directly. The step numbers are those of the main file.

## How it signs in

| Option | Choose when | Consequence |
| --- | --- | --- |
| Client secret (usual here) | the CI's identity tokens carry none of `repository_id`, `project_id`, `repositoryUuid`, or the CI is not reachable from the internet | `RFABRIC_CLIENT_SECRET` in the CI's secret store; rotate it by hand |
| Trust | the CI issues OpenID Connect tokens that carry one of those three claims, for the trust's `audience`, from a public https issuer | no secret; the pipeline exports the token as `RFABRIC_ID_TOKEN`, and it must stay valid until the wait ends |

Step 2 is skipped for a client secret credential. For a trust, the user reads the issuer URL and the repository identifier from their CI's OpenID Connect documentation or settings.

## Your turn 2: secret and pipeline steps (step 4)

Create the credential first (step 3). For a client secret, the user creates it in the rFabric app or with `rfabric credential create` in their own terminal, so the secret goes straight from there into the CI's secret store and never through this conversation.

```text
Your turn - your CI system, repository <repository>
Why: the pipeline signs in as the service credential; the client id is public, the secret is not.
Who: whoever may edit the pipeline and its secrets.

1. Store two values in the CI's secret or variable store:
   RFABRIC_CLIENT_ID = <client id>            (plain variable)
   RFABRIC_CLIENT_SECRET = <the client secret> (secret; shown once when the credential was created)
2. Add the steps below to the pipeline, after the step that builds and pushes the image.
3. Publish report.xml as the step's test results:
   Jenkins: junit 'report.xml'. CircleCI: store_test_results. Buildkite: a test collector or an artifact upload.
   Azure Pipelines: PublishTestResults@2.
4. Run the pipeline on a branch.

Creates: one variable, one secret and the pipeline steps.
Undo: delete them, and revoke the credential in rFabric.
Bring back: the commit the pipeline built.
Then I: find the evaluation job by that commit and follow it.
```

```bash
# install a pinned CLI into the workspace (or run the steps in the image ghcr.io/rfabric/cli:0.1)
curl -fsSL https://get.rfabric.io/cli.sh | RFABRIC_VERSION=v<version> RFABRIC_INSTALL_DIR="$PWD/.rfabric" sh
export PATH="$PWD/.rfabric:$PATH"

# register the image the pipeline pushed; prints the artifact id; a rerun returns the same artifact
ARTIFACT=$(rfabric artifact-build register "<registry>/<namespace>/<image>@$DIGEST" --timeout 30m)

# list blockers without launching, then run and wait for the verdict
rfabric sim run <suite slug> --candidate "$ARTIFACT" --wall-deadline 7200 --preflight
rfabric sim run <suite slug> --candidate "$ARTIFACT" --wall-deadline 7200 \
  --wait --wait-timeout 2h5m --junit report.xml --markdown scorecard.md
```

- Commands use the credential's workspace; no workspace flag is needed.
- The last command exits with the verdict (main file, step 6). Run the CLI as the step's main process, so the CI's cancel signal reaches it and it cancels the evaluation job.
- `--wall-deadline` stops the job on rFabric even when the pipeline is gone; `--wait-timeout` only ends the wait (exit 40) and the job keeps running. Keep the CI's own job limit above the wait timeout.
- The CLI detects Jenkins, CircleCI, Buildkite and Azure Pipelines and records the repository, commit, build and pull request on the job as `ci`. On another system pass `--ci-repository`, `--ci-commit` and `--ci-build-id` together.
- A retried step of the same build returns the job already launched.

## Your turn 3: require the check (step 7)

Requiring a passing build is a setting of the code host, not of rFabric. Ask the user to make the pipeline's status a required check on the base branch in their code host, after one pipeline has passed there.

## Scheduled runs and release gate

Use the CI's own scheduler and tag triggers with the same commands. For a release gate add `--baseline <artifact id in production>` and pin the suite as `<slug>@<version>`.
