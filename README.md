# rFabric skills

Agent skills for [rFabric](https://rfabric.io), and the `rfabric` plugin that installs them in Claude Code and Codex.

An agent skill is a Markdown document (`skills/<name>/SKILL.md`) that teaches a coding agent one rFabric workflow spanning several platform operations: their order, what to wait for, what the user approves and the decisions along the way. Skills drive the tools of the `rfabric` MCP server, the remote Model Context Protocol server of the rFabric API, which reaches every rFabric API operation as the signed-in user.

| Skill | Workflow |
| --- | --- |
| [`sim-asset-build`](skills/sim-asset-build/SKILL.md) | Build simulation assets for a robot from a prompt: plan, review, build, qualify or rebuild; add the robot model a build needs |

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

- **One workflow per skill**, spanning several operations: the order, waits, approvals and decisions. A fact about one operation or one field belongs in that operation's API description, which `describe_operation` returns, not in a skill.
- **MCP first.** Drive the three tools of the `rfabric` server by `operationId`: `describe_operation` before every `call_operation`, `search_operations` to find one. Assume the server is connected: no setup or sign-in steps. CLI commands may follow in a closing section for agents with a shell; the rFabric agent has none.
- **Bytes through presigned URLs.** File bytes never pass through the MCP server: the operations that move bytes return presigned URLs. The rFabric agent uses its tools `rfabric_upload` and `rfabric_download` for them; other agents send the requests themselves.
- **Layout.** `skills/<name>/SKILL.md` with YAML front matter holding `name` and `description`; `name` equals the directory name. Supporting files sit beside `SKILL.md`.
- **Released operations only.** A skill names only operations that are live in production when it is released.
- **Public.** This repository is public: no secrets, no internal hostnames, no unreleased features.

### operationIds

Name an operation only by its `operationId` in an inline code span: `` `sim-asset-builds.create` ``. The tests treat every inline code span shaped like an operationId (lowercase kebab-case words joined by dots, such as `sim-assets.versions-qualify`) as one and fail when the MCP catalog has no such operation, so a misspelled operationId cannot pass as plain text. Write other dotted names so they do not take that shape: field names in camelCase as the API spells them (`previews.thumbnailUrl`), or in words (the previews `error`). A name that keeps the shape but is no operation, such as a permission, goes in [`tests/not-operation-ids.txt`](tests/not-operation-ids.txt); the tests fail when a name there is an operation. Code blocks are not checked.

## Tests

Node.js 22 or later, no packages:

```bash
RFABRIC_MCP_URL=<MCP URL of a test deployment> RFABRIC_MCP_TOKEN=<access token for it> node --test
```

The tests check that every `operationId` a skill names exists in that deployment's MCP catalog (read with `describe_operation`), that each skill's front matter has `name` and `description` with `name` equal to its directory, and that the plugin manifests parse and register the server `rfabric` at `https://api.rfabric.io/mcp`. With either variable unset the catalog tests fail; they never skip.

Releases: [RELEASE.md](RELEASE.md).
