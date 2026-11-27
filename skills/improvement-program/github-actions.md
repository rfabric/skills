# Improvement program CI on GitHub Actions

Read this when the program allows change level `code`, its repository is on GitHub and its CI is GitHub Actions. It fills step 3 and the Git access of step 6 of `SKILL.md`. Names here assume `branchPrefix` `rsi/`; with another prefix replace `rsi/` everywhere.

What the user ends up with: a workflow that builds both images on every push to an `rsi/` branch and reports them to the Experiment, a CI credential in rFabric that holds no secret, and a repository where the agent can push `rsi/` branches and cannot change the default or release branches.

## Order matters

The agent branches each code change from the commit the parent Artifact is attested with (`attestation.sourceRef`), and GitHub runs the workflow file of the pushed commit. So the workflow must already be in the commit the reference Artifact was built from:

1. Add the workflow (below) on the default branch.
2. Build the trainer and inference images from that commit or a later one, and register the reference Artifact with that commit as its source (`artifact-build`).
3. Create or update the program with that Artifact as `referenceArtifactId`.

The agent cannot remove or edit the workflow later: `.github/**` is always protected.

## 1. Get the repository id

The trust pins the numeric repository id: it never changes when the repository is renamed, and it is not a secret. With a shell where the user's `gh` is signed in, run the command yourself after the user approves. First show which account it is signed in to (`gh auth status`) and let the user confirm it is the right one. Without a shell, or when the CLI is not signed in, ask the user to run it and bring back the number.

```bash
gh api repos/<owner>/<repo> --jq .id
```

## 2. Create the CI credential

`credentials.create-clients`:

```json
{
  "name": "<repo>-rsi-ci",
  "organizationId": "org_...",
  "workspaceId": "wks_...",
  "permissions": { "training": ["read", "launch"] },
  "trusts": [{
    "issuer": "https://token.actions.githubusercontent.com",
    "conditions": { "repository_id": "<repository id>", "ref": "refs/heads/rsi/*" }
  }]
}
```

- The response has `clientSecret` `null` and a `clientId` (`rf_svc_...`): nothing secret appears in the conversation.
- The credential holds the `training` permission with `read` and `launch` in this Workspace, which is what updating an Experiment requires. It holds nothing for models, artifacts, evaluations or deployments.
- The trust admits only identity tokens GitHub issues to this repository's workflow runs on `rsi/` branches. A run on any other branch, or in a fork, is refused.

## 3. Hand over

Ask the user for their registry path and the two image names, then fill in those, `<clientId>` and `<owner>/<repo>`.

With a shell where the user's `gh` is signed in, and a clone of the repository, run the commands of actions 1, 2 and 4 yourself after the user approves. First show which account it is signed in to (`gh auth status`) and let the user confirm it is the right one. Action 3 is a settings page: it stays with the user. Without a shell, or when the CLI is not signed in, hand the block over.

```text
Your turn - GitHub, repository <owner>/<repo>
Why: rfabric-rsi-agent pushes each code change to a branch rsi/<experimentId>. Your CI builds it, so the agent never builds or runs your code outside your pipeline.
Who: a repository admin (variables and rulesets need admin rights).

1. Set two repository variables (Settings > Secrets and variables > Actions > Variables), or from a terminal:
     gh variable set RFABRIC_CLIENT_ID -R <owner>/<repo> --body <clientId>
     gh variable set IMAGE_REGISTRY -R <owner>/<repo> --body <your registry host and path>
2. Commit the workflow below as .github/workflows/rsi-build.yml on the default branch.
   Adjust three things: the registry login step, the two build directories, the two image names.
3. Protect what the agent must not change: under Settings > Rules > Rulesets, make sure a branch ruleset covers your default and release branches with "Restrict updates" and "Restrict deletions" (or "Require a pull request before merging"), and that deploy keys are not in its bypass list.
4. Check the trigger from a clone of the default branch:
     git push origin HEAD:refs/heads/rsi/ci-check
   The run "rsi-build" should finish green and print "nothing to build". Then remove the branch:
     git push origin --delete rsi/ci-check

This creates on your side: two variables, one workflow file, one ruleset if none covered those branches. No secret is stored in GitHub.
To undo: delete the workflow file and the variables; I revoke the CI credential.

Bring back: tell me when the run of step 4 was green.
Then I: check the credential's trust, and continue with the program.
```

The workflow:

```yaml
name: rsi-build

on:
  push:
    branches: ["rsi/**"]

# One build per branch at a time.
concurrency:
  group: rsi-build-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write   # lets the rfabric CLI exchange the job's identity token; no stored secret

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Install the rfabric CLI
        run: curl -fsSL https://get.rfabric.io/cli.sh | sh

      - uses: docker/setup-buildx-action@v3

      # Replace with the login of your registry. A failed login must not stop the job:
      # the last step still reports the failure to the Experiment.
      - name: Log in to the image registry
        continue-on-error: true
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build both images and report to the Experiment
        env:
          RFABRIC_CLIENT_ID: ${{ vars.RFABRIC_CLIENT_ID }}
          REGISTRY: ${{ vars.IMAGE_REGISTRY }}
        run: |
          experiment="${GITHUB_REF_NAME#rsi/}"
          case "$experiment" in
            exp_*) ;;
            *) echo "$GITHUB_REF_NAME is not rsi/<experimentId>: nothing to build"; exit 0 ;;
          esac
          # Fails here, before the build, when the sign-in or the Experiment is wrong.
          rfabric experiment get "$experiment" > /dev/null

          build() {  # build <directory> <image name>, prints <registry>/<name>@sha256:<digest>
            docker buildx build --push --platform linux/amd64 --metadata-file "$2.json" \
              -t "$REGISTRY/$2:$GITHUB_SHA" "$1" >&2 || return 1
            echo "$REGISTRY/$2@$(jq -r '."containerimage.digest"' "$2.json")"
          }

          if trainer=$(build trainer my-policy-trainer) && inference=$(build inference my-policy-inference); then
            jq -n --arg c "$GITHUB_SHA" --arg t "$trainer" --arg i "$inference" \
              '{attributes: {"rsi.commit": $c, "rsi.trainerImage": $t, "rsi.inferenceImage": $i, "rsi.buildError": null}}' > report.json
          else
            run="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
            jq -n --arg c "$GITHUB_SHA" --arg e "image build failed: $run" \
              '{attributes: {"rsi.commit": $c, "rsi.trainerImage": null, "rsi.inferenceImage": null, "rsi.buildError": $e}}' > report.json
          fi

          # A branch that moved on is reported by its later push.
          head=$(git ls-remote --heads origin "refs/heads/$GITHUB_REF_NAME" | cut -f1)
          if [ "$head" != "$GITHUB_SHA" ]; then echo "branch moved on: nothing reported"; exit 0; fi

          rfabric experiment update "$experiment" --data @report.json
          jq -e '.attributes["rsi.buildError"] == null' report.json > /dev/null
```

Notes for the user's adjustments:

- **Registry**: the example logs in to GitHub's registry; pushing there also needs `packages: write` under `permissions`. For Amazon ECR use `aws-actions/configure-aws-credentials` with a role that trusts GitHub's identity tokens, then `aws-actions/amazon-ecr-login`. Whichever registry: the program's compute pools must be able to pull from it. On rFabric's pools and connected pools an image in Amazon ECR or Google Artifact Registry is pulled through a connected container registry, and an image on any other registry host, GitHub's included, must be publicly readable (`compute-setup`, Container registry access).
- **Build directories**: `trainer` and `inference` are the directories holding each Dockerfile. The trainer image is the one the program's LaunchTemplate runs: any container image that contains the training command, not built from an rFabric image (`training-run`, step 2). The inference image is the one the reference Artifact was registered with.
- **Trainer library**: a trainer Dockerfile that installs `rfabric-trainer` reads the BuildKit secret `github_token`, a GitHub token with read access to `rfabric/rfabric-trainer`. Add `--secret id=github_token,env=RFABRIC_TRAINER_TOKEN` to the `docker buildx build` line and `RFABRIC_TRAINER_TOKEN: ${{ secrets.RFABRIC_TRAINER_TOKEN }}` to the step's `env`; the user stores the token as the repository secret RFABRIC_TRAINER_TOKEN. That is then the one secret this setup stores in GitHub: say so in the block. It is used by the image build only and never reaches rFabric.
- **Platform**: `linux/amd64` is what the example builds; use the architecture of the compute pools.
- The CLI targets rFabric production by default and needs only `RFABRIC_CLIENT_ID`.

## 4. Give the agent push access

The agent pushes with its own SSH key. Its public key comes from the user's rFabric contact when the agent is connected to the Workspace (`SKILL.md`, Needs). It is not a secret. Hand over when the user has it:

```text
Your turn - GitHub, repository <owner>/<repo>
Why: rfabric-rsi-agent pushes each code change as a branch rsi/<experimentId>, under its own identity, never yours.
Who: a repository admin.

1. Open Settings > Deploy keys > Add deploy key.
2. Title: rfabric-rsi-agent. Key: the public key from your rFabric contact. Tick "Allow write access". Choose "Add key".

This creates on your side: one deploy key. It can push branches of this repository only; the ruleset of the earlier step keeps it off your default and release branches.
To undo: Settings > Deploy keys > Delete next to rfabric-rsi-agent.

Bring back: tell me when the key is added.
Then I: check the agent is connected, and activate the program on your go.
```

rFabric cannot read a repository's deploy keys: the user's word is the check here, and the first `code` Experiment is the proof.

## 5. Verify

- `credentials.list-client-trusts` with the `clientId`: one trust with the issuer and both conditions above; `audience` is the value GitHub tokens are issued for (the CLI requests it itself).
- The run of step 4 in section 3 finished green.
- Proof of the whole chain comes with the first `code` Experiment: `experiments.get` shows `"rsi.commit"`, `"rsi.trainerImage"` and `"rsi.inferenceImage"` after its branch was pushed.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| No workflow run for an `rsi/` branch | the workflow file is not in the commit the agent branched from | follow "Order matters": the reference Artifact's source commit must contain the workflow |
| Run fails at `rfabric experiment get` with a refused token exchange | the identity token does not match the trust; the CLI prints the token's issuer and audience and the audience expected | compare with `credentials.list-client-trusts`: `repository_id` (a re-created repository has a new id), `ref` pattern, and `id-token: write` in the workflow |
| Run fails at `rfabric experiment get` with not found or forbidden | the credential is scoped to another Workspace, or lacks `training` `read` | `credentials.list-clients`: `workspaceId` and `permissions`; create a new credential when wrong (a credential's scope does not change) |
| Experiment shows `"rsi.buildError"` | the build or the registry login failed; the value links the run | the user fixes the build; that Experiment concludes `inconclusive` |
| Images reported, the training launch is refused or the run fails to pull the trainer image | rFabric cannot read the trainer image from its registry | `compute-setup` (Container registry access) |
| The agent's push is rejected | the deploy key lacks write access, or a ruleset also covers `rsi/**` | tick "Allow write access"; exclude `rsi/**` from the ruleset's target branches |
