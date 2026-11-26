# Releasing rFabric skills

A skills release is a git tag `v<version>` on this repository, `<version>` semver; the first release is `v0.1.0`.

## Rules

- **Only deployed operations.** A release names only operations that are live, when it is tagged, on the release deployment: production, or rFabric's development deployment while production is not running. A skill that needs an operation the release deployment does not serve yet waits on a branch until that API release ships there.
- **`main` is installable.** Claude Code and Codex install the plugin from the default branch, so every commit on `main` may reach users: merge only what may ship.
- **Public.** No secrets, no internal hostnames or URLs other than `https://api.rfabric.io/mcp` and public sites, no unreleased features.
- **One version.** The version is held by `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`, because each host reads only its own manifest; the tests fail when the two differ. The tag is `v` followed by that version.

## Steps

1. Set `version` in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` to the new version (patch for wording fixes, minor for a new skill or a new step, major when a skill drops a workflow users rely on). Plugin users receive the release when the version changes.
2. Merge to `main`, then tag that commit and push the tag:

   ```bash
   version="$(jq -r .version .codex-plugin/plugin.json)"
   git tag "v$version"
   git push origin "v$version"
   ```

3. Create the GitHub Release `v<version>` from the tag, its notes listing the skills added or changed.

A release runs no tests and needs no test deployment: the tests run on every change before it merges.

## The rFabric agent

An agent release bundles one skills release: the tag its build pins. A new skills release reaches `rfabric agent` users when a new agent release pins its tag; nothing else couples the two.
