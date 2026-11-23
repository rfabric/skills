# Sign-in rules: second factor and password length

Part of `member-access`. Read this when the user asks who signs in with a second factor (MFA, two-factor) and how a member adds one, or to set the shortest password members may choose.

Both are done in the rFabric app: you prepare the step, hand it over with exact values, and verify with the membership reads. Apply `rfabric-basics` throughout.

## At a glance

| # | Job | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | See who has a second factor | agent | `introspect.whoami`, `organizations.get`, `membership.members` | none |
| 2 | A member adds a second factor | each member, rFabric app | `membership.members` | none |
| 3 | Set the password minimum length | user, rFabric app | none | none |

Each job stands alone. Do step 1 first: it gives the organization `slug` for the links.

## 1. See who has a second factor

1. `introspect.whoami`: the organization id (`org`) and the user's role (`orgRole`).
2. `organizations.get` with that id: the `slug`.
3. `membership.members`: `twoFactorEnabled` per member.

Give the user two lists: members with a second factor, members without.

## 2. A member adds a second factor

Each person does this for their own account. Give the user this block to pass on:

```text
Your turn - rFabric app (each member, for their own account)
Why: adds a second factor to your sign-in. You need an authenticator app on your phone.

1. Open https://app.rfabric.io/<organization slug>/settings/account
2. In "Sign-in", on the row "MFA", choose "Enable".
3. Enter your Password and choose "Continue".
4. The dialog shows the "Authenticator secret" and your "Backup codes", once. Choose "Open in authenticator app", or type the secret into the app. Choose "Copy" and store the backup codes somewhere safe.
5. Enter the "Code from the authenticator" and choose "Verify". The row "MFA" reads "On".

Changes: your account asks for a code from the app at every sign-in.
Undo: the same row, "Disable", with your password.
Bring back: tell me when it reads "On". Do not paste the secret or the codes here.
```

Verify with `membership.members`: `twoFactorEnabled` is true for that person. Report who is still without.

## 3. Set the password minimum length

What it does:

- A member who sets a password (a change or a reset) must use at least this many characters. A shorter one is refused with "Password must be at least <n> characters per organization policy."
- Passwords already set stay valid.
- A person in several organizations gets the strictest of their values.

```text
Your turn - rFabric app
Why: sets the shortest password your members may choose.
Who: an owner or admin of the organization.

1. Open https://app.rfabric.io/<organization slug>/settings/identity
2. In "Auth policy" choose "Edit".
3. Set "Password minimum length" to <n>, 8 or more.
4. Only if "Allowed auth methods" is marked "Choose at least one": select "Password".
5. Change nothing else. Leave "Enforce MFA", "Enforce SSO", "Session idle timeout" and "Password sign-in exceptions" exactly as they are.
6. Choose "Save". The message is "Saved".

Undo: the same steps with the earlier number (8 when the row read "Not set").
Bring back: how the row "Password minimum length" reads.
```

No operation reads the policy back: record what the user reports.

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| "Auth policy" shows no "Edit" | the person signed in is not an `owner` or `admin` | an owner or admin does the step |
| "Password minimum length" is marked "At least 8" | the field is empty or below 8 | enter 8 or more and save again |
| "Allowed auth methods" is marked "Choose at least one" | no method is selected | select "Password" and save again |
| "Auth policy was not saved: ..." | the save was refused | ask the user for the exact message |
| "Password must be at least <n> characters per organization policy." | the new password is shorter than the rule | choose a longer one |

## Done when

- [ ] Second factor: `membership.members` shows `twoFactorEnabled` true for everyone the user expected; the rest were named.
- [ ] Password length: the user confirmed how the row reads, and was told it applies to passwords set from now on.
