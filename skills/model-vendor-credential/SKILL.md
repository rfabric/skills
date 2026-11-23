---
name: model-vendor-credential
description: >-
  A model vendor account (OpenAI, Anthropic or Hugging Face) connected to rFabric with an API key or access token the vendor accepted, so sim asset builds call the user's own models and imports read private or gated Hugging Face repositories. Use when the user wants to connect OpenAI, Anthropic or Hugging Face, bring their own API key, fix `sim_asset_build_models_unavailable` or `credential_rejected`, replace a key, or revoke one. Not for buckets (`storage-connection`), compute or container registries (`compute-setup`), or credentials for CI (`ci-integration`).
---

# Connect a model vendor account

The user ends up with a credential rFabric uses to call a model vendor on their behalf. The entity is a **ProviderCredential** (`pcred_...`): rFabric's access to one account for one purpose, here `purpose` `models`, with `authMethod` `accessToken` and `cloud` `openai`, `anthropic` or `huggingface`. rFabric checks the key with the vendor before it stores it, keeps it encrypted, and never returns it.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Read which vendor accounts are connected | agent | `workspaces-provider-credentials.list` | none |
| 2 | Choose the vendor and the scope | user decides | none | none |
| 3 | Create the key at the vendor and enter it in rFabric | user, vendor console then rFabric app | none by the agent (the app calls `provider-credentials.create`) | until the user reports back |
| 4 | Confirm the credential | agent | `provider-credentials.list` | none |

Further sections: Replace a key, Revoke, Rename.

## Before you start

- **Permissions**: an organization admin (organization role `owner` or `admin`; `orgRole` in `introspect.whoami`). At the vendor: someone who may create API keys or tokens in the account.
- **Needs**: an organization and a workspace (`workspace-setup`); an account at the vendor with billing set up where the vendor requires it.
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Which vendor | one credential per vendor | from what they want to do (Decisions) |
| Organization-wide or one workspace | the scope | default organization-wide |

Never ask for the key itself.

## Decisions

**Which vendor.**

| Vendor (`cloud`) | rFabric uses it for | Without it |
| --- | --- | --- |
| OpenAI (`openai`) | image generation and image editing in sim asset builds; their text calls too | a build that needs images is refused with `sim_asset_build_models_unavailable`; text calls run on rFabric-provided models, billed by rFabric |
| Anthropic (`anthropic`) | text calls of sim asset builds on Anthropic models | they run on rFabric-provided models, billed by rFabric |
| Hugging Face (`huggingface`) | imports of models and sim assets from private or gated Hugging Face repositories | only public repositories can be imported |

**Own key or rFabric-provided models** (OpenAI and Anthropic text calls). With the user's key the vendor bills them directly and rFabric records the usage without charging for it. Without a key rFabric runs its own provided model and meters and bills the tokens. The user decides; say which applies today.

**Scope.** `organization` (default, what the app creates): every workspace uses the key. `workspace`: that workspace alone, and it wins over the organization's key there. Choose `workspace` when one team's usage should go to its own vendor account.

## Steps

### 1. Read which vendor accounts are connected

`workspaces-provider-credentials.list` with the workspace id: rows with `purpose` `models` are vendor accounts the workspace uses, its own and the organization's. Show `cloud`, `name`, `ownerScope`, `status`, and for Hugging Face `principal` (the account name the token signs in as).

An `active` credential of the vendor already covers the workspace: stop and say so, unless the user wants another account or scope.

### 2. Choose the vendor and the scope

Present the Decisions with what step 1 found. A request that failed with `sim_asset_build_models_unavailable` names the vendors to connect in `details` (`clouds`).

### 3. Your turn: create the key and enter it in rFabric

The key is a secret: the user types it into the rFabric app, never into this conversation. Get the organization's `slug` from `organizations.get` and hand over the block of the vendor. When the vendor account and the rFabric organization are administered by two people, they do the block side by side: the key goes from one screen to the other, not through chat or email.

OpenAI:

```text
Your turn - OpenAI platform, then the rFabric app
Who: someone who may create API keys in your OpenAI project, and an rFabric organization admin (one person, or two side by side).
Why: sim asset builds generate and edit images with your OpenAI account, and run their text calls on it. OpenAI bills you directly.

1. Open https://platform.openai.com/settings/organization, select the project, open "API Keys" and choose "Create new secret key".
2. Permissions: "All". A restricted key must still be able to list models, call the Responses API, and generate and edit images.
3. Copy the key (it starts with sk-). OpenAI shows it once.
4. In rFabric, open https://app.rfabric.io/<organization slug>/integrations/openai
   choose "Connect credential", paste the key into "API key" and choose "Connect".
5. Do not paste the key here.

Creates: one API key in your OpenAI project; one credential in rFabric.
Undo: delete the key on the OpenAI "API Keys" page; I revoke the credential in rFabric.

Bring back: nothing, just tell me when rFabric says "OpenAI connected".
Then I: confirm the credential is active.
```

Anthropic:

```text
Your turn - Claude Console, then the rFabric app
Who: someone who may create API keys in your Anthropic organization, and an rFabric organization admin (one person, or two side by side).
Why: sim asset builds run their text calls on your Anthropic account. Anthropic bills you directly.

1. Open https://platform.claude.com/settings/keys (the "API keys" page of the Claude Console).
2. Choose "Create key" and name it. Set "Linked account" to a service account (a key linked to yourself stops working when you leave the organization).
   Select the workspace the key is scoped to: rFabric sends the key alone, so a key without a workspace cannot make calls.
   Expiration: with a date, rFabric's calls fail from that day until you replace the key; "Never" needs no replacement.
3. Copy the key (it starts with sk-ant-). The Console shows it once.
4. In rFabric, open https://app.rfabric.io/<organization slug>/integrations/anthropic
   choose "Connect credential", paste the key into "API key" and choose "Connect".
5. Do not paste the key here.

Creates: one API key in your Anthropic organization; one credential in rFabric.
Undo: delete the key on the "API keys" page; I revoke the credential in rFabric.

Bring back: nothing, just tell me when rFabric says "Anthropic connected".
Then I: confirm the credential is active.
```

Hugging Face:

```text
Your turn - Hugging Face, then the rFabric app
Who: the owner of the Hugging Face account (or a member of the organization that owns the repositories), and an rFabric organization admin (one person, or two side by side).
Why: rFabric reads your private and gated Hugging Face repositories with this token when you import a model or a sim asset.

1. Open https://huggingface.co/settings/tokens and choose "New token".
2. Choose the role "read", or "fine-grained" with read access to the repositories rFabric should import.
3. For a gated repository, request access on its page with this account first; the token only reads what the account may read.
4. Copy the token (it starts with hf_).
5. In rFabric, open https://app.rfabric.io/<organization slug>/integrations/huggingface
   choose "Connect credential", paste the token into "Access token" and choose "Connect".
6. Do not paste the token here.

Creates: one access token in your Hugging Face account; one credential in rFabric.
Undo: delete the token on the same Hugging Face page; I revoke the credential in rFabric.

Bring back: nothing, just tell me when rFabric says "Connected as <your account>".
Then I: confirm the credential is active and which account it signs in as.
```

What the user may see in the app instead of the success message:

| Message in the app | Meaning | Do |
| --- | --- | --- |
| "<Vendor> did not accept this API key." (or "access token") | the vendor refused it: mistyped, deleted, expired, or not allowed to list models | create a fresh key and paste it again; nothing was stored |
| "<Vendor> could not be reached to check this API key. Try again." | the vendor did not answer the check | try again in a minute; nothing was stored |
| "You do not have permission to connect accounts for this organization." | the user is not an organization admin | an organization admin does step 4 or 5 of the block |

The app creates an organization-wide credential. For a workspace-scoped one, or instead of the app, the user registers the key from their own terminal, where the key is set and stays out of this conversation; it is read from an environment variable so it also stays out of the shell history: `jq -n --arg key "$OPENAI_API_KEY" '{name: "openai", ownerScope: "workspace", workspaceId: "<workspace id>", cloud: "openai", purpose: "models", authMethod: "accessToken", accessToken: $key}' | rfabric provider-credential create --data -` (the same shape with `anthropic` or `huggingface`).

### 4. Confirm the credential

`provider-credentials.list` with `query` `{"purpose": "models", "cloud": "<cloud>", "status": "active"}`. The credential exists only if the vendor accepted the key, so an `active` row is the proof. For Hugging Face, read `principal` back to the user: it is the account the token signs in as.

Final report: the vendor, the credential id, its scope, and who is billed from now on. The page is `https://app.rfabric.io/<organization slug>/integrations/<cloud>`.

To see the key in use: the model calls of a later sim asset build carry `credentialSource` `workspace` when they ran on the user's key and `platform` when they ran on an rFabric-provided model (`sim-asset-builds.get`, `steps[].modelCalls[]`).

## Replace a key

Use when a key expires, leaks, or the vendor account changes. The credential id stays the same, so nothing that uses it has to change.

`provider-credentials.rotate-secret` takes the replacement key in its body, so do not call it from the conversation. Your turn for the user:

1. Create the replacement key at the vendor (step 3, actions 1 to 3 of the vendor's block).
2. In the rFabric app, on `https://app.rfabric.io/<organization slug>/integrations/<cloud>`, open the credential's menu and choose "Replace API key" ("Replace access token" for Hugging Face); or in their own terminal: `printf '%s' "$OPENAI_API_KEY" | rfabric provider-credential rotate-secret <credential-id> --access-token-stdin`.
3. Delete the old key at the vendor.

rFabric checks the replacement with the vendor before it stores it; a refused key leaves the old one in place. Afterwards `provider-credentials.get`: `status` `active`, and `meta.rotatedAt` is the time of the replacement.

## Revoke

Say what stops before the call, then `provider-credentials.delete` with the credential id. It sets the credential `revoked` and deletes the stored key; it cannot be undone, connecting again makes another credential.

| Vendor | What stops |
| --- | --- |
| OpenAI | sim asset builds can no longer generate or edit images, so builds that need them are refused until another OpenAI key is connected; text calls run on rFabric-provided models, billed by rFabric |
| Anthropic | sim asset builds stop calling Anthropic with this key and run on rFabric-provided models, billed by rFabric |
| Hugging Face | private and gated repositories of that account can no longer be imported; models already imported keep their weights |

When the workspace also has another `active` credential of the vendor (the organization's behind a workspace's), that one takes over: say which.

Then the user deletes the key at the vendor (the undo line of the block). Revoking in rFabric does not do that.

## Rename

`provider-credentials.update` with body `{"name": "..."}`. The name is only a label.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 422 `sim_asset_build_models_unavailable` when a build is created | the workspace can run no allowed model for a role the build calls; `details` names the `roles` and, when a vendor key would fix it, the `clouds` | connect that vendor (step 3) in a scope that covers the workspace. Empty `clouds`: no key helps, the model choice is a workspace setting (`sim-asset-build`) |
| 422 `credential_rejected` (CLI) | the vendor refused the key | create a fresh key; nothing was stored |
| 502 `model_unavailable` or `huggingface_unreachable` (CLI) | the vendor did not answer the check | retry; nothing was stored |
| a build's model calls still show `credentialSource` `platform` | no `active` credential of that model's vendor covers the build's workspace | step 1 for that workspace: check `cloud`, `status` and scope |
| 422 `huggingface_credential_required` on an import although the credential is `active` | the token's account may not read that repository | the user requests access to the gated repository with that account, or widens a fine-grained token, then replaces the key if a new token was made |

## Done when

- [ ] `provider-credentials.list`: an `active` credential with `purpose` `models` and the vendor's `cloud`, in a scope that covers the workspace.
- [ ] Hugging Face: `principal` is the account the user expects.
- [ ] The user knows who bills the model calls from now on, and that the key lives at the vendor until they delete it there.

## Next

- `sim-asset-build`: build simulation assets; its model calls now run on the user's account.
- `model-release`: import a model from a private or gated Hugging Face repository.

## The rfabric CLI

Connect and Replace a key are for the user's own terminal on every host: the key is set in that terminal and stays out of the conversation.

| Step | CLI |
| --- | --- |
| List | `rfabric workspace provider-credentials <workspace-id>` |
| Connect | `jq -n --arg key "$ANTHROPIC_API_KEY" '{name: "anthropic", ownerScope: "workspace", workspaceId: "<workspace id>", cloud: "anthropic", purpose: "models", authMethod: "accessToken", accessToken: $key}' \| rfabric provider-credential create --data -` |
| Replace a key | `printf '%s' "$ANTHROPIC_API_KEY" \| rfabric provider-credential rotate-secret <credential-id> --access-token-stdin` |
| Rename | `rfabric provider-credential update <credential-id> --field name=<name>` |
| Revoke | `rfabric provider-credential delete <credential-id>` |
