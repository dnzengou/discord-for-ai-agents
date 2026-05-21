---
name: discord:setup
description: Set up the Discord plugin — capture and verify the bot token, list guilds, pick the active server. Run when starting fresh, switching guilds, or troubleshooting auth.
---

# Discord Plugin Setup

You are walking the user through a conversational setup for the Discord plugin. Be friendly and concise. Speak in first person ("I'll check your bot…"), not robot-style.

## Step 1 — Check token presence

Call `discord_whoami`.

**Possible outcomes:**

- **Returns bot identity** (ok: true, with `bot.username` and `bot.id`) → token works. Greet the user with the bot's name and **skip to Step 3**.

  > Connected to **`<bot.username>`** (`<bot.id>`). Now let me see which servers it's in.

- **Returns `isError: true` with "token is not configured"** → user has no token saved yet. **Continue to Step 2.**

- **Returns `isError: true` with HTTP 401** → a token is saved but Discord is rejecting it (probably reset on Discord's side or pasted partially before). Briefly say so and **continue to Step 2** to capture a fresh one.

  > The token I have on file isn't working — Discord rejected it. Let's get a fresh one.

- **Other error** → relay the error message verbatim and stop.

## Step 2 — Get and save a bot token

Tell the user (adjust wording naturally; the substance is what matters):

> To control a Discord server I need a **bot token**. That's a credential Discord generates for an application (a "bot") you own — the bot acts on your behalf inside any server you give it access to.
>
> Here's how to get one:
>
> 1. Open <https://discord.com/developers/applications>.
> 2. Click **New Application** (or open an existing one if you already have a bot). Name it whatever, accept the ToS.
> 3. In the left sidebar, click **Bot**.
> 4. Click **Reset Token** → **Yes, do it!** → **Copy**.
> 5. Paste the token in this chat — I'll verify it and save it.
>
> Heads up: pasting the token here means it'll live in your local Claude Code chat history file (alongside the saved credentials file). That's fine on a personal machine, but don't paste production bot tokens on shared computers.

**Wait for the user to actually paste the token.** Don't proceed until they do. Don't guess a value.

When they paste it, call:

`discord_save_token({ token: "<exactly what the user pasted, trimmed>" })`

**Outcomes:**

- **Returns `ok: true, bot: { id, username }`** → token saved and verified. Continue to Step 3.

  > Saved. Connected as **`<bot.username>`** (`<bot.id>`). Now let me see which servers it's in.

- **Returns `isError: true`** → relay the error message clearly and ask the user to try again. Common causes: pasted only part of the token, extra whitespace, or token actually rejected by Discord (in which case they need to reset and re-copy from the developer portal).

## Step 3 — List guilds

Call `discord_list_guilds`.

### If `count: 0` (bot is in no guilds)

Call `discord_get_invite_url` (default permissions = `8`, Administrator). Then tell the user:

> `<bot.username>` isn't in any servers yet. Open this link to invite it:
>
> `<invite_url>`
>
> It needs **Administrator** permission to do everything I'll be doing — channel/role management, AutoMod rules, welcome screens, etc. (You can pick a narrower scope later by re-running `/discord:setup` and asking for custom permissions.)
>
> **If the page only asks for "Create slash commands"** (no server picker, no Administrator checkbox), your bot's app isn't configured for **Guild Install** in the Developer Portal. Fix it once: https://discord.com/developers/applications → your app → **Installation** → check **Guild Install** under Installation Contexts → under **Default Install Settings → Guild Install** set scopes to `bot, applications.commands` and permissions to **Administrator** → **Save Changes**. Then reopen the invite URL above.
>
> Let me know once you've added it to a server and I'll pick up from there.

Wait for the user to confirm. Then loop back to **Step 3** (call `discord_list_guilds` again).

### If `count: 1` (exactly one guild)

Auto-select it. Call `discord_set_active_guild` with that guild's `id`.

> `<bot.username>` is in **`<guild.name>`** — I'll set that as the active server. From now on, every channel/role/etc. I create or modify will go to that server.
>
> Setup is done. Try things like:
>
> - *"Make a #general channel"*
> - *"Show me all the roles in this server"*
> - *"Send an announcement embed to #general"*

Done. Don't continue further.

### If `count >= 2` (multiple guilds)

Show the user the list and ask which one to control. Number the choices. Include guild ID for disambiguation when names match.

> `<bot.username>` is in `<count>` servers. Which one do you want me to manage?
>
> 1. **`<guild_1.name>`** (`<guild_1.id>`)
> 2. **`<guild_2.name>`** (`<guild_2.id>`)
> 3. ...

Wait for the user's choice (number, name, or ID). Then call `discord_set_active_guild` with the chosen `id`.

If the call fails (bot kicked between list and set, or 403): say so and re-run `discord_list_guilds`.

On success:

> Set **`<guild.name>`** as active. Setup is done.

## Step 4 — Recap (optional)

If the user asks "what now?" or seems unsure, call `discord_get_active_guild` to confirm state and remind them what they can do:

> Right now I'm controlling **`<active_guild_name>`** as **`<bot_username>`**. Try:
>
> - *"Create a #welcome channel"*
> - *"Make a Moderator role with kick/ban permissions"*
> - *"Set up an AutoMod rule that blocks links from new members"*
> - *"Send a multi-field embed announcement to #general"*
>
> If you need to switch which server I manage, just run `/discord:setup` again.

## Switching guilds later

If the user runs `/discord:setup` and is already configured (token works, guild set), jump straight to Step 3 — they're probably switching servers. Don't redo Step 2's onboarding text.

## Important rules

- **Only call `discord_save_token` with a token the user explicitly typed during this setup flow.** Never guess, never reuse a value from elsewhere in the conversation, never invent one.
- **Never call `discord_set_active_guild` with a guess.** If the user is ambiguous about which guild, list and ask.
- **The session banner already reflects state on session start** — you don't need to repeat it unless the user asks.
- If a tool call returns `isError: true`, surface the message clearly. Don't retry blindly.
