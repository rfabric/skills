---
name: robot-enrollment
description: >-
  A robot or recording bench registered in rFabric, placed in its site and fleet, and online with its own device identity. Use when the user wants to add, enroll, onboard, provision or connect a robot or bench, install `rfabricd`, get or revoke a provisioning token, find out why a robot does not come online, or reprovision, replace, retire or decommission a robot. Not for organizing sites, fleets, devices and tasks: that is `fleet-inventory`. Not for recording data: that is `robot-recording`.
---

# Enroll a robot

The user ends up with a Robot that is registered, placed, enrolled and online: `lifecycleState` `active`, presence `online`, and a command answered by the robot. The entities:

- **Robot** (`rbt_...`): the platform record of one physical machine or recording bench.
- **Site** (`site_...`) and **Fleet** (`flt_...`): where the robot physically is, and the group whose settings and rollouts it follows. A **FleetMembership** (`flm_...`) joins a robot to a fleet for a period.
- **Provisioning token** (`rpt_...`, secret `prov_...`): a single-use secret, bound to one robot, that the robot exchanges for its certificate.
- **`rfabricd`**: the rFabric software on the robot. It holds the robot's identity and connects it to the platform.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Register the Robot | agent | `robots.list`, `robots.create` | none |
| 2 | Place it in a Site and a Fleet | agent | `sites.list`, `fleets.list`, `robots.placement`, `fleet-memberships.create` | none |
| 3 | Mint the token, install `rfabricd`, enroll, start | user: rFabric app in a browser, then a terminal on the robot | none | the user; the token expires 24 hours after it is minted |
| 4 | Confirm enrollment and first connection | agent | `robots.get`, `robots.presence` | at most 5 minutes after the user reports the start command |
| 5 | Activate | agent | `robots.confirm-activation` | none |
| 6 | Check that the robot answers a command | agent | `robots.create-commands`, `robots.get-commands` | the command expires after 10 minutes |

Variants after the main path: Reprovision, Replace, Decommission.

## Before you start

- **Permissions**: `robot:provision` (mint or revoke a token), `robot:activate`, `robot:reprovision`, `robot:retire` (replace), `robot:decommission`. The built-in role `operator` carries all of them; `admin` and `owner` pass every check.
- **Needs**: a Workspace (`workspace-setup`). On the robot: Linux or macOS on amd64 or arm64, a terminal (its own keyboard, or SSH from the user's laptop), sudo for a service install, outbound HTTPS (443) and MQTT over TLS (8883).
- **Ask the user**:

| Input | Why | How to find it or default |
| --- | --- | --- |
| Robot name and type | `name`, and `type`: `arm`, `mobile`, `humanoid`, `drone`, `quadruped` or `custom` (then `customSubtype` says what it is) | no default; `model` and `serialNumber` are optional |
| Fleet and Site | settings, rollouts and location | list them first and offer the existing ones; "no fleet, place it later" is valid |
| How `rfabricd` runs | decides the three commands | Decisions, below |

## Decisions

Build of `rfabricd` (a robot installs one):

| Option | Choose when | Consequence |
| --- | --- | --- |
| `rfabricd` (recommended) | the robot may join live video or teleoperation | needs GStreamer, which the package installs |
| `rfabricd-core` | smallest footprint, no live video | no interactive media and no teleoperation; `intervention-session` will not work on this robot |

Install method:

| Option | Choose when | Consequence |
| --- | --- | --- |
| Linux package (recommended) | Debian, Ubuntu, Fedora or RHEL robot | runs as a systemd service under the `rfabric` user, starts at boot, identity in `/etc/rfabric`, upgrades with `sudo apt-get upgrade` or `sudo dnf upgrade` |
| Homebrew | a macOS bench or a developer laptop | runs under the user's own account while `rfabricd run` is open; identity in `~/.config/rfabric` |
| Binary only | another Linux, a custom image | same as Homebrew: no service, the user keeps it running |

## Steps

### 1. Register the Robot

1. `robots.list` with `workspaceId` and `search` set to the name: reuse an existing Robot instead of creating a second one with the same name.
2. `robots.create` with `workspaceId`, `name`, `type`, and `model`, `serialNumber` when given.

Tell the user: this only creates the record. Nothing touches the hardware yet, and `lifecycleState` is null until the robot enrolls.

Done when: you hold the `rbt_...` id.

### 2. Place it in a Site and a Fleet

1. `sites.list` and `fleets.list` with `workspaceId`. A missing one is created with `sites.create` or `fleets.create` (`fleet-inventory` has the detail).
2. `robots.placement` with `siteId`: records where the robot is; earlier placements stay in its history.
3. `fleet-memberships.create` with `fleetId` and `robotId`.

Tell the user what joining the fleet means: the robot takes the fleet's settings (its upload rules among them) and gets an artifact from the fleet's next rollout, not from one already running. A robot that is a current member of a fleet whose Environment is named production is protected against decommissioning.

Done when: `fleet-memberships.list` with `robotId` shows a membership with `leftAt` null, or the user chose no fleet.

### 3. Your turn: mint the token and run three commands on the robot

The token is a secret: the user mints it in the rFabric app, so it never enters the conversation. Two machines are involved; the block says at each action which one. Hand over one block, with the user's values filled in:

```text
Your turn - rFabric app on your laptop, then a terminal on the robot
Why: the robot creates its own private key and trades a single-use token for its certificate. The key never leaves the robot.
Who: a member with robot:provision (operator, admin or owner) who has sudo on the robot.

1. Robot: open a terminal on it (its own keyboard, or SSH from your laptop). Keep it open.
2. Laptop, browser: open https://app.rfabric.io/open/<robotId>. The robot shows "Not connected yet": choose "Connect it".
3. Laptop, browser: pick the tab for the robot's system: "Linux (apt / dnf)", "Homebrew" or "Binary only".
   Leave "Minimal build (rfabricd-core)" and "Keep the key in hardware" off.
4. Laptop, browser: choose "New token". The page now shows three commands: "Install rfabricd", "Enroll it", "Start it".
   The Enroll command contains the token: it works once and expires in 24 hours. Paste it only into the robot's terminal.
5. Robot terminal: run the three commands, in that order.
6. Laptop, browser: the line under the commands goes from "Waiting for <name> to connect..." to
   "Enrolled - waiting for its first report", then "<name> is connected".

Creates on the robot: the rfabricd program, the robot's key and certificate, and its config (table below).
Bring back: tell me when the third command has run. If one fails, paste its error output, not the command line (it holds the token).
Then I: confirm the robot enrolled and is online, activate it, and send it one harmless command.
```

Adjust action 3 to the Decisions. When the robot is the machine the user sits at (a laptop used as a bench), the browser and the terminal are on the same machine: say so and drop the laptop and robot labels.

The commands the page shows, so you can explain them and recognise errors (`<token>` is filled in by the page; never ask for it):

```bash
# Linux package: service install
curl -fsSL https://get.rfabric.io/rfabricd.sh | sh
sudo rfabricd provision <token> --yes --out-dir /etc/rfabric
sudo systemctl enable --now rfabricd

# Homebrew: per-user install
brew install rfabric/tap/rfabricd
rfabricd provision <token> --yes
rfabricd run

# Binary only: per-user install
curl -fsSL https://get.rfabric.io/rfabricd.sh | RFABRIC_INSTALL_DIR=/usr/local/bin sh
rfabricd provision <token> --yes
rfabricd run
```

For `rfabricd-core`: the installer ends with `| sh -s -- --core`, the formula is `rfabric/tap/rfabricd-core`, and every command says `rfabricd-core` where it says `rfabricd`.

| Command | What it does on the robot | How to undo |
| --- | --- | --- |
| Install | Linux package: adds the rFabric package repository (`https://linux.rfabric.io`, with sudo), installs the package, creates the `rfabric` system user and enables the service. Otherwise places the checksum-verified binary in `/usr/local/bin` | remove the package or the binary |
| Enroll | creates a private key on the robot, exchanges the token for a certificate, and writes the certificate, the key, `/etc/rfabric/provisioned.toml` and a starting `/etc/rfabric/rfabricd.toml` (per-user install: the same files in `~/.config/rfabric`). `--yes` skips a prompt that shows the workspace and robot ids | Decommission, below |
| Start | connects the robot. Service install: it restarts by itself and starts at boot. Per-user install: it runs while that terminal stays open | `sudo systemctl disable --now rfabricd`; per-user: Ctrl+C |

Say these up front:

- Under `sudo`, the Enroll command needs `--out-dir /etc/rfabric`. Without it the identity lands in `/root/.config/rfabric`, which the service does not read.
- A lost, used or expired token cannot be recovered. "New token" on the same page revokes it and shows a fresh one.
- "Keep the key in hardware" adds `--key-backend hardware`. It is for a robot whose secure element or TPM is already set up as a PKCS#11 token; `rfabricd provision --help` lists the `--pkcs11-*` flags that name it.

Without a browser: the user mints the token in their own terminal on the laptop, where the `rfabric` CLI is signed in: `rfabric robot-provisioning-token create --workspace <workspaceId> --robot <robotId>`. It prints `secret` once, so never run it from your shell: its output would enter the conversation. That value is `<token>` in the commands above, typed on the robot.

A token that is no longer needed is revoked: `rfabric robot-provisioning-token list --robot <robotId> --status active`, then `rfabric robot-provisioning-token revoke <token-id>`.

### 4. Confirm enrollment and first connection

After the user reports back, read; do not take "done" as proof.

| Read | Value | Meaning |
| --- | --- | --- |
| `robots.get` `lifecycleState` | null | the token was not exchanged: the Enroll command failed or has not run |
| | `enrolled` | the robot holds its certificate |
| `robots.presence` `data` | null | never connected: `rfabricd` is not running, or reads another config directory |
| `robots.presence` `status` | `online` | connected; `freshness` `live` means the report is current |
| | `offline`, `stale` | it connected and dropped, or stopped reporting |

Poll both every 5 to 10 seconds and tell the user what you wait for. If the robot is not `online` 5 minutes after the Start command, stop and go to Problems. `clockSkewed` true means the robot's clock is off: have the user sync it before going on.

### 5. Activate

An `enrolled` robot holds its identity but is not in service yet. `robots.confirm-activation` puts it in service: say that you are activating the robot, then call it. It takes an optional `reason`.

| `lifecycleState` | Meaning |
| --- | --- |
| null | registered, never enrolled |
| `enrolled` | has its identity, not yet in service |
| `active` | in service |
| `maintenance` | taken out of service through a maintenance record (`robot-maintenance`) |
| `retired` | out of service for good |

Done when: `robots.get` shows `active`.

### 6. Check that the robot answers a command

`robots.create-commands` with body `{"kind": "dataset.list", "data": {}}` asks the robot to report the recordings it holds. Say that it changes nothing on the robot. It returns a command (`rcmd_...`); poll `robots.get-commands` (`robotId`, `commandId`) every few seconds:

| `status` | Meaning |
| --- | --- |
| `queued` | the robot is offline; the command is held until it reconnects |
| `dispatched`, `acknowledged`, `running` | on its way, or the robot has it |
| `succeeded` | the robot receives and answers commands |
| `failed` | the robot answered with an error; `error` says why |
| `expired` | no answer within 10 minutes. Go to Problems |

## Reprovision: a new certificate for the same robot

Use when the certificate nears its end (it is valid 365 days), the robot's disk was reimaged, its key may have leaked, or `rfabricd doctor` asks for re-enrollment. The Robot must be `active` or `enrolled`.

1. Choose where the token appears. Recommend the app: on the robot's page, the More menu, "Re-provision identity" mints the token and opens the Connect page with the commands. The alternative, `robots.reprovision`, returns the `secret` into this conversation: say so before the call.
2. Through the operation only: `robots.reprovision` with `ttlSeconds` (60 to 604800; 86400 when omitted). Pick the shortest that covers the trip to the robot, for example 900 when the user sits at it. Show `secret` once in a code block, with where it goes. `robots.get` now shows `reprovisioningState` `in_progress`.
3. Your turn, robot terminal. On a robot that still holds its identity, add `--force-reprovision` to the Enroll command, then restart the running service so it loads the new certificate (service install shown; a per-user install drops `sudo` and `--out-dir`, and restarts by stopping `rfabricd run` with Ctrl+C and running it again):

```bash
sudo rfabricd provision <token> --yes --out-dir /etc/rfabric --force-reprovision
sudo systemctl try-restart rfabricd
```

`--force-reprovision` replaces the identity on disk in one step; without it the command stops with "device is already provisioned". Edits to `/etc/rfabric/rfabricd.toml` survive. A service that was not running is started with the Start command of step 3.

4. Verify: `reprovisioningState` is null, then steps 4 and 6. The previous certificate is superseded.

## Replace: new hardware takes over

1. Decommission the old Robot (next section); it must be `retired`.
2. `robots.replace` on the retired robot's id. `carryOver` (`name`, `tags`, `placement`, `memberships`, each true or false) says what the successor inherits; `name`, `type` and `serialNumber` set its own. Model, hardware profile, config and description are always copied. The two are linked by `predecessorRobotId` and `successorRobotId`.
3. Enroll the successor on the new hardware: steps 3 to 6 with the successor's id. It starts with `lifecycleState` null.

## Decommission: lock a robot out for good

Say before the call: this cannot be undone. It revokes the robot's credential and certificates, ends its fleet memberships and retires it. The Robot record, its history and the data it recorded stay.

1. `robots.get`: `lifecycleActions` must list `decommission`. A robot in `maintenance` first leaves maintenance mode (`robot-maintenance`).
2. `robots.decommission` with `{"confirm": true, "reason": "<why>"}`.
3. Read the result:

| Result | Meaning | Do |
| --- | --- | --- |
| 200 | the returned `robot` has `lifecycleState` `retired`; the `decommission` object beside it reports `authCredentialRevoked`, `refreshChainsRevoked`, `messagingPlaneRevoked`, `certificatesRevoked` and `lockoutLatencyMs` | report them |
| 409, message names approval | the robot is a current member of a fleet whose Environment is named production, which protects it; nothing was revoked | stop and report it. The protection ends when the robot leaves that fleet, which also takes it out of the fleet's rollouts: that is the user's decision. Only on their instruction end the membership (`fleet-inventory`), then decommission again |
| 409, message names certificate revocation | revocation was incomplete; the robot is not retired | call `robots.decommission` once more; if it fails again, report it with the `correlationId` |

4. Your turn, robot terminal (service install): `sudo systemctl disable --now rfabricd` stops the service and keeps it from starting at boot. The files under `/etc/rfabric` no longer grant anything.
5. Verify: `robots.lifecycle-history` ends with a `retired` interval whose `effectiveTo` is null; `fleet-memberships.list` with `robotId` shows no membership with `leftAt` null.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| `lifecycleState` stays null | the Enroll command did not succeed | ask for its error output (not the command line) |
| Enroll: token expired, revoked or already used | a token works once, for 24 hours | "New token" on the Connect page, run Enroll again |
| Enroll: "device is already provisioned" | this machine already holds an identity | same Robot: Reprovision. Another Robot's identity: add `--force-reprovision` only after the user confirms the machine changes robot |
| Enroll: "hardware key backend selected but no PKCS#11 module configured" | "Keep the key in hardware" was on | turn it off and copy the command again, or add the `--pkcs11-*` flags from `rfabricd provision --help` |
| Install: no `rfabricd` build for this platform | the installer never falls back by itself | decide on `rfabricd-core` with the user |
| `enrolled`, presence `data` null | the service is not running, or the identity is in `/root/.config/rfabric` | on the robot: `sudo systemctl enable --now rfabricd`, then `sudo journalctl -u rfabricd -f` and ask for what it prints. Wrong directory: Reprovision with `--out-dir /etc/rfabric` |
| Presence `offline` or `stale`, or the command `expired` | the robot cannot reach rFabric | on the robot: `sudo -u rfabric rfabricd --config /etc/rfabric/rfabricd.toml doctor` (per-user install: `rfabricd doctor`). It checks the certificate, the clock, sign-in, API access and the messaging connection, each with a fix. `robots.connectivity-sessions` lists connects and drops with their close reason |
| `robots.confirm-activation` 409 | the robot is not `enrolled` | read `lifecycleState`: null means step 3 is not done, `active` means nothing to do |
| `robots.reprovision` 409 | the robot is not `active` or `enrolled` | never enrolled: step 3. `retired`: Replace |
| `robots.replace` 409 | the predecessor is not `retired`, or already has a successor | decommission first; read `successorRobotId` |
| 403 naming a permission | the user's role lacks it | name the permission; `member-access` finds why it is missing and what can add it |

## Done when

- [ ] `robots.get`: `lifecycleState` is `active`.
- [ ] `robots.presence`: `status` `online`, `freshness` `live`.
- [ ] `robots.get-commands`: the command is `succeeded`.
- [ ] Placement as the user chose: `robots.placement-history` has a current entry (`effectiveTo` null) at the Site; `fleet-memberships.list` with `robotId` shows the Fleet with `leftAt` null.
- [ ] Variants: Reprovision ends with `reprovisioningState` null and the robot `online`; Decommission with `lifecycleState` `retired`.

## Next

- `fleet-inventory`: devices on the robot, tasks it can do, saved views, bulk changes.
- `robot-recording`: recording profile, upload rules, recording sessions.
- `deployment-rollout`: put an artifact on the robot through its fleet.
- `fleet-monitoring`: health, uptime and telemetry of enrolled robots.

## The rfabric CLI

Commands that print a secret are for the user's own terminal on every host: run from your shell, their output would bring the secret into the conversation.

| Step | CLI |
| --- | --- |
| Register | `rfabric robot create --field name=<name> --field type=<type>` |
| Join a fleet | `rfabric fleet-membership create --field fleetId=<fleet-id> --field robotId=<robot-id>` |
| Mint the first token (prints `secret` once) | `rfabric robot-provisioning-token create --workspace <workspace-id> --robot <robot-id> [--ttl-seconds <n>]` |
| List or revoke tokens | `rfabric robot-provisioning-token list --robot <robot-id>`, `rfabric robot-provisioning-token revoke <token-id>` |
| Read the robot and its presence | `rfabric robot get <robot-id>`, `rfabric telemetry presence --robot <robot-id>` |
| Activate | `rfabric robot activate <robot-id>` |
| Check that it answers a command | `rfabric robot command dispatch <robot-id> --kind dataset.list --wait` |
| Certificates | `rfabric robot-certificate list` |
| Reprovision (prints `secret` once) | `rfabric robot reprovision <robot-id> [--ttl-seconds <n>]` |
| Replace | `rfabric robot replace <retired-robot-id> [--name <name>] [--serial-number <serial>]` |
| Decommission | `rfabric api post /api/robots/<robot-id>/decommission --data '{"confirm":true,"reason":"..."}'` |
