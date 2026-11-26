# rFabric skills

Agent skills for [rFabric](https://rfabric.io), and the `rfabric` plugin that installs them in Claude Code and Codex.

An agent skill is a Markdown document (`skills/<name>/SKILL.md`) that teaches a coding agent one rFabric workflow spanning several platform operations: their order, what to wait for, what the user approves and the decisions along the way, including the steps the user takes outside rFabric (a cloud console, a Git host, a robot's terminal). Skills drive the tools of the `rfabric` MCP server, the remote Model Context Protocol server of the rFabric API, which reaches every rFabric API operation as the signed-in user.

Every skill keeps the user informed: the plan before the first change, each change before it happens, what is running, what they must do themselves and why, what went wrong and the options, and what exists at the end.

## Skills

Ask your agent in your own words; it picks the skill. The stages follow the loop rFabric serves.

| Stage | Skill | Workflow |
| --- | --- | --- |
| Base | [`rfabric-basics`](skills/rfabric-basics/SKILL.md) | What the agent tells you at each moment, how it calls rFabric, how bytes and secrets are handled; every other skill builds on it |
| Orient | [`workspace-status`](skills/workspace-status/SKILL.md) | Where you stand: your organization and workspaces, what waits for you, what is running or failed |
| Set up | [`workspace-setup`](skills/workspace-setup/SKILL.md) | Organization, workspaces, projects, environments, regions and settings |
| Set up | [`member-access`](skills/member-access/SKILL.md) | Who can do what and why; access narrowed, time-boxed, reviewed or ended; sessions and sign-in policy |
| Set up | [`storage-connection`](skills/storage-connection/SKILL.md) | Connect an Amazon S3, Google Cloud Storage or S3-compatible bucket, with the steps in your cloud account |
| Set up | [`compute-setup`](skills/compute-setup/SKILL.md) | Compute for training, simulation, enrichment and builds: rFabric's cloud or your own cloud account, container registry access, quota |
| Set up | [`model-vendor-credential`](skills/model-vendor-credential/SKILL.md) | Connect a model vendor account (OpenAI, Anthropic, Hugging Face) |
| Set up | [`ci-integration`](skills/ci-integration/SKILL.md) | Run simulation suites from GitHub Actions, GitLab CI or Bitbucket Pipelines as a merge check and release gate, and launch training on the trainer image the pipeline built, without a stored secret |
| Fleet | [`robot-enrollment`](skills/robot-enrollment/SKILL.md) | Register a robot, install and provision the robot software, bring it online; reprovision, replace, retire |
| Fleet | [`fleet-inventory`](skills/fleet-inventory/SKILL.md) | Sites, fleets, devices, missions, tasks, capabilities, bulk changes |
| Fleet | [`robot-recording`](skills/robot-recording/SKILL.md) | Record demonstrations on a robot and get them uploaded; collection campaigns |
| Collect | [`dataset-upload`](skills/dataset-upload/SKILL.md) | Upload a local dataset directory and get it imported |
| Collect | [`dataset-import`](skills/dataset-import/SKILL.md) | Import datasets from a connected bucket, by copy or by link |
| Collect | [`recording-conversion`](skills/recording-conversion/SKILL.md) | Convert ROS 2 bag or MCAP recordings into datasets |
| Prepare data | [`episode-search`](skills/episode-search/SKILL.md) | Find and inspect episodes; trace lineage |
| Prepare data | [`enrichment`](skills/enrichment/SKILL.md) | Enrich episodes with descriptions, tags, embeddings and findings; register your own enrichment method |
| Prepare data | [`annotation-project`](skills/annotation-project/SKILL.md) | Labeling work: schema, queue, review, sign-off, export |
| Prepare data | [`dataset-curation`](skills/dataset-curation/SKILL.md) | Select, score and compose the episodes worth training on |
| Prepare data | [`dataset-version`](skills/dataset-version/SKILL.md) | Freeze an immutable, training-ready dataset version and manage it |
| Prepare data | [`dataset-export`](skills/dataset-export/SKILL.md) | Export a dataset or episodes as a checksummed bundle |
| Simulate | [`sim-asset-build`](skills/sim-asset-build/SKILL.md) | Build simulation assets for a robot from a prompt: plan, review, build, qualify or rebuild, publish; add the robot model a build needs |
| Simulate | [`simulator-setup`](skills/simulator-setup/SKILL.md) | Make a simulator runnable: adapter profile, simulator image, sim assets |
| Simulate | [`simulation-suite`](skills/simulation-suite/SKILL.md) | Define scenarios and a suite, run a candidate against a baseline in simulation |
| Train | [`training-run`](skills/training-run/SKILL.md) | Train a policy on rFabric compute from a launch template, kept in rFabric or as files in your repository; follow, retry, pick a checkpoint |
| Train | [`experiment`](skills/experiment/SKILL.md) | Group runs around a hypothesis, launch follow-ups, compare, conclude |
| Train | [`external-training-run`](skills/external-training-run/SKILL.md) | Record a run trained elsewhere: status, metrics, logs, checkpoint upload |
| Package | [`model-release`](skills/model-release/SKILL.md) | Promote a checkpoint to a model and take it through approval |
| Package | [`artifact-build`](skills/artifact-build/SKILL.md) | Package a model with its inference image as a deployable artifact |
| Evaluate | [`evaluation-definitions`](skills/evaluation-definitions/SKILL.md) | Metrics, criteria, scenarios and protocols: author, test, publish |
| Evaluate | [`evaluation-job`](skills/evaluation-job/SKILL.md) | Evaluate a model or artifact; read the report, compare, reproduce |
| Evaluate | [`evaluation-grading`](skills/evaluation-grading/SKILL.md) | Execute runs by hand at the robot and grade runs in the review queue |
| Deploy | [`deployment-rollout`](skills/deployment-rollout/SKILL.md) | Roll an artifact out to robots in stages; pause, advance, roll back |
| Operate | [`fleet-monitoring`](skills/fleet-monitoring/SKILL.md) | Fleet health, telemetry, and the evidence around a failure in the field |
| Operate | [`alerting`](skills/alerting/SKILL.md) | Read, acknowledge, annotate and resolve open alerts |
| Operate | [`robot-maintenance`](skills/robot-maintenance/SKILL.md) | Maintenance records, maintenance mode and exit checks, downtime |
| Operate | [`intervention-session`](skills/intervention-session/SKILL.md) | Take remote control of a robot or supervise one; operator team setup |
| Automate | [`policy-automation`](skills/policy-automation/SKILL.md) | A gate that refuses model and artifact promotions until approval or a passing evaluation exists, simulated before it is enabled |
| Automate | [`improvement-program`](skills/improvement-program/SKILL.md) | An improvement program for autonomous one-change experiments on one task's model, with its repository and CI |
| Govern | [`audit-review`](skills/audit-review/SKILL.md) | Who did what, with evidence; the organization's security state |
| Govern | [`data-governance`](skills/data-governance/SKILL.md) | Residency, retention, legal holds, erasure |
| Govern | [`billing-usage`](skills/billing-usage/SKILL.md) | Spend, usage, forecast, quotas, invoices, credits, plan |

## Install

### rFabric agent

`rfabric agent` users install nothing: every agent release bundles a pinned release of these skills, and the agent connects the `rfabric` MCP server itself.

### Claude Code

```text
/plugin install rfabric --marketplace rfabric/skills
```

From a shell: `claude plugin install rfabric --marketplace rfabric/skills`. On Claude Code before 2.1.275, add the marketplace first, then install:

```text
/plugin marketplace add rfabric/skills
/plugin install rfabric@rfabric
```

### Codex

```bash
codex plugin marketplace add rfabric/skills
codex plugin add rfabric@rfabric
```

Or add the marketplace, then install `rfabric` from the plugin browser (`/plugins` in Codex CLI, the **Plugins** tab in the ChatGPT desktop app).

### Sign in

The plugin adds the skills and registers the MCP server `rfabric` at `https://api.rfabric.io/mcp`. It holds no token or secret: installing configures your agent, it does not authorize it. On the first rFabric call your agent opens the browser; you sign in to rFabric and approve the agent's access to the organization you choose. Every call then runs as you, with your permissions. To sign in ahead of time: `/mcp` in Claude Code or Codex, or `codex mcp login rfabric`.

## Writing a skill

- **The user comes first.** A skill exists so that the person the agent works for always knows what is going on: the plan, each change before it happens, what is running, what they must do themselves and why, what went wrong, what exists at the end. [`rfabric-basics`](skills/rfabric-basics/SKILL.md) defines these moments and how to call rFabric; every other skill builds on it and never repeats it.
- **One workflow per skill**, spanning several operations: the order, waits, approvals and decisions. A fact about one operation or one field belongs in that operation's API description, which `describe_operation` returns, not in a skill.
- **The whole workflow**, including the steps the user takes outside rFabric (a cloud console, a Git host, an identity provider, a robot's terminal): where, with which rights, the exact values, what it creates, how to undo it, and the read operation that verifies it. Prefer what rFabric generates (links, scripts, policies) over click paths.
- **MCP first.** Drive the three tools of the `rfabric` server by `operationId`: `describe_operation` before every `call_operation`, `search_operations` to find one. Assume the server is connected: no setup or sign-in steps. CLI commands may follow in a closing section: an agent with a shell (the rFabric agent started with `rfabric agent --with-shell` included) runs them itself after the user approves; without a shell the step is a "Your turn" block for the user's own terminal. A command that prints a secret stays in the user's own terminal on every host.
- **No secrets in the conversation.** Prefer grants without a secret; send the user to the rFabric app or their own terminal to enter one; announce a secret that rFabric shows once before the call that returns it.
- **Released operations only.** A skill names only operations that are live in production when it is released.
- **Public.** This repository is public: no secrets, no internal hostnames, no unreleased features.

### Layout

`skills/<name>/SKILL.md` starts with YAML front matter in exactly this form; `name` equals the directory name:

```markdown
---
name: <name>
description: >-
  <the description on one line, indented two spaces>
---
```

The folded scalar (`>-`) is required: a plain `description: ...` that holds a colon followed by a space is invalid YAML, and a host does not load such a skill. The description says what the user ends up with, when to use the skill in the user's words, and the nearest skill it is not, in at most 90 words. Its first 90 characters must work alone: with many skills installed a host shows only the start of each description (the rFabric agent does), so they name the outcome in the user's words. A new skill gets a row in [Skills](#skills) and in the "Finding the skill" table of `rfabric-basics`; the tests fail without both.

Every workflow skill has the same sections in the same order, so an agent and a reviewer find the same thing in the same place:

| Section | Holds |
| --- | --- |
| Title and opening | what the user ends up with; each entity with its name, id prefix and one clause; the line applying `rfabric-basics` |
| At a glance | one row per step: who does it (agent, or user and where), the operations, what it waits for |
| Before you start | permissions, what must exist first and the skill that provides it, what to ask the user |
| Decisions | the forks the user owns: option, when to choose it, consequence; recommended first |
| Steps | numbered; what to call, what to tell the user that is specific to the step, when the step is done; steps outside rFabric as "Your turn" blocks |
| Problems | signal (error code and status, or a stuck status), what it means for the user, what to do |
| Done when | observable checks, each backed by a read operation |
| Next | the skills that follow |
| The rfabric CLI | optional table of CLI commands |

`SKILL.md` stays under 300 lines. A variant only some users need (one cloud, one CI system) goes into a supporting Markdown file beside it, named in `SKILL.md` in a code span (`aws.md`) with when to read it; the tests fail when a named file is missing.

### operationIds

Name an operation only by its `operationId` in an inline code span: `` `sim-asset-builds.create` ``. The tests treat every inline code span shaped like an operationId (lowercase kebab-case words joined by dots, such as `sim-assets.versions-qualify`), in `SKILL.md` and its supporting files, as one and fail when the MCP catalog has no such operation, so a misspelled operationId cannot pass as plain text. Write other dotted names so they do not take that shape: field names in camelCase as the API spells them (`previews.thumbnailUrl`), or in words (the previews `error`). A name that keeps the shape but is no operation, such as a permission, goes in [`tests/not-operation-ids.txt`](tests/not-operation-ids.txt); the tests fail when a name there is an operation. The name of a supporting file is no operation. Code blocks are not checked.

## Tests

Node.js 22 or later, no packages:

```bash
RFABRIC_MCP_URL=<MCP URL of a test deployment> RFABRIC_MCP_TOKEN=<access token for it> node --test
```

The tests check that every `operationId` a skill names, in `SKILL.md` and its supporting files, exists in that deployment's MCP catalog (read with `search_operations`, one call per resource), that each skill's front matter is in the required form with `name` equal to its directory, that every supporting file a skill names exists, that [Skills](#skills) and the routing table of `rfabric-basics` list exactly the skill directories, and that the plugin manifests parse and register the server `rfabric` at `https://api.rfabric.io/mcp`.

Without a deployment, give the catalog as a file with one `operationId` per line:

```bash
RFABRIC_OPERATION_IDS=<file> node --test
```

With neither source set the catalog test fails; it never skips.

Where the skills name an operation, by operationId or by resource (every operationId that starts with it):

```bash
node tests/references.mjs sim-asset-builds.plan-approve datasets
```

It reads the skills alone, so it also finds an operation that was renamed or removed. With `RFABRIC_OPERATION_IDS` set, an operationId that file lacks is marked `NOT in the catalog`.

Releases: [RELEASE.md](RELEASE.md).
