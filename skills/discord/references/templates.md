# Applying Discord Server Templates

Use this when the user says "apply the X template" or pastes a custom JSON spec. Templates bulk-create roles, categories, channels, welcome screen, AutoMod rules, and scheduled events. Apply is **idempotent and create-only** — anything matching an existing entity by name is left alone, never modified or deleted.

## Step 1 — Confirm the active guild

Call `discord_get_active_guild`.

- If `isError: true` ("no active guild") → tell the user to run `/discord:setup` first and **stop**.
- Otherwise, anchor the rest of the conversation on `<active_guild_name>`.

## Step 2 — Pick a template

If the user already named one, skip to Step 3.

Otherwise, call `discord_list_templates` to get the current bundled list, then ask:

> Which template do you want to apply to **`<guild.name>`**?
>
> - **gaming-community** — multi-game lobby with squad voice rooms
> - **study-group** — subject channels and quiet study halls
> - **dev-community** — language-organized dev hangout with showcase
> - **content-creator** — creator hub with tiered subscriber channels
>
> Or paste a custom JSON spec and I'll apply that instead.

(Use the actual list from `discord_list_templates` — the four above are the current starters but the list may grow.)

## Step 3 — Optional dry run

If the user is hesitant or wants to see the breakdown first, call `discord_apply_template` with `template_name` (or `spec`) AND `dry_run: true`. Show the preview:

> Dry run for **`<template_name>`** on **`<guild.name>`**:
>
> - **<n> roles**: Mod, Squad Leader, Veteran
> - **<n> categories**: Welcome, General, Games, Voice Rooms
> - **<n> channels**: rules, announcements, introductions, general, …
> - **<n> AutoMod rules**: No slurs, Mention spam
>
> Apply for real?

Wait for confirmation before Step 4. Don't apply until they say yes.

## Step 4 — Apply

Call `discord_apply_template` with `template_name` (or `spec`), no `dry_run`, and a clear `reason` like `"Applied via /discord by user request."`.

Read the returned `counts` and `summary` and report to the user grouped by status. Example:

> Done. Here's what happened in **`<guild.name>`**:
>
> **Created**: 3 roles, 4 categories, 12 channels, 2 AutoMod rules
> **Skipped (already existed)**: 1 channel (general), 1 role (Mod)
> **Failed**: (none)

If anything failed, list each failure with its `detail` so the user can see Discord's error message and fix the underlying cause (perms, missing Community feature, etc.).

If `welcome_screen.warning` is set, call it out — usually means a referenced channel name didn't get created (check the channels[] failures).

## Step 5 — Suggest next steps

After a successful apply, offer:

> Want me to:
>
> - **Reorder** roles or channels (`discord_modify_role_positions` / `discord_modify_channel_positions`)
> - **Set channel-specific permission overwrites** (e.g., hide `subs-only` from `@everyone`)
> - **Send a welcome embed** to `#announcements`
> - **Schedule an event** in one of the new voice/stage channels

## Custom specs

If the user pastes a JSON spec inline, validate the shape mentally before passing it as `spec` (the tool will reject malformed input but a friendlier upfront message is nice). Spec shape:

```jsonc
{
  "guild": { "verification_level": "low", "default_message_notifications": "only_mentions" },
  "roles": [
    { "name": "Mod", "color": "#5865F2", "permissions": ["kick_members"], "hoist": true }
  ],
  "categories": [{ "name": "Welcome" }],
  "channels": [
    { "name": "rules", "type": "text", "category": "Welcome", "topic": "..." }
  ],
  "welcome_screen": {
    "enabled": true,
    "description": "Welcome!",
    "channels": [{ "channel": "rules", "description": "Start here", "emoji_name": "📜" }]
  },
  "automod_rules": [
    { "name": "No slurs", "trigger": "keyword_preset", "presets": ["slurs"], "block_message": "No." }
  ],
  "scheduled_events": [
    { "name": "Weekly hangout", "type": "voice", "channel": "Lobby",
      "scheduled_start_time": "2026-06-01T19:00:00Z" }
  ]
}
```

Cross-references go by **name**, not ID:

- `channels[].category` → must match a `categories[].name`
- `welcome_screen.channels[].channel` → must match a `channels[].name`
- `scheduled_events[].channel` → must match a `channels[].name`
- `automod_rules[].alert_channel` / `.exempt_channels[]` → channel names
- `automod_rules[].exempt_roles[]` → role names

Names are matched case-insensitively. The macro resolves them at apply time.

## Important rules

- **Apply only creates**, never deletes or edits. If the user wants a clean slate, point them at `discord_delete_role` / `discord_delete_channel` first — but don't run those without explicit confirmation.
- **Welcome screens require Community**: if `welcome_screen` fails, the guild probably doesn't have the Community feature enabled. Tell the user to enable it under Server Settings → Enable Community.
- **AutoMod has per-trigger rule limits**: 6 keyword rules, 1 each of spam / keyword_preset / mention_spam / member_profile per guild. If a rule fails with a 400, that's likely why.
- **Bot role hierarchy**: roles created above the bot's own highest role become unmanageable by the bot afterwards. Default templates don't trigger this, but custom specs might.
- **Don't apply silently after a dry run** — always wait for the user's explicit go-ahead.
