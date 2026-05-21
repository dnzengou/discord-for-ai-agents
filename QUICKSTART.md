<div align="center">

# Discord for AI Agents — Quick Start

**54 tools. Natural language. Your first Discord change in under 2 minutes.**

Free · Uses your own bot · No third-party access to your server

---

| ⚡ 54 Discord tools | 🎨 6 ready-made templates | ⏱ ~2 min to first action |
|---|---|---|

</div>

---

## Step 1 — Install (30 seconds)

Inside Claude Code, run:

```
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install discord@jcodesmore-plugins
```

Then **fully quit and reopen Claude Code** so the skills load.

> **No Claude Code yet?** → [claude.ai/download](https://claude.ai/download)

---

## Step 2 — Connect your bot (60–90 seconds)

```
/discord:setup
```

Claude walks you through it — no docs to read:

1. Opens [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** tab → **Reset Token** → **Copy**
3. Paste the token in chat → Claude verifies it instantly
4. Claude generates an invite link → add the bot to your server
5. Pick which server to manage → done

> **Already have a bot token?** Skip to pasting it. The wizard detects what's already configured.

---

## Step 3 — Your first action

Type `/discord` to see what's connected, then describe what you want:

```
/discord make me a server for my AI research community
```

```
/discord create a #announcements channel under an Info category
```

```
/discord add a Moderator role with kick and ban permissions
```

That's it. No menus. No settings panels. Just describe and it happens.

---

## What you can do

<details>
<summary><b>🏗 Build an entire server from one sentence</b></summary>

```
/discord make me a Magic: The Gathering trading community
/discord apply the dev-community template to this server
/discord set up an internal workspace for my 6-person startup
```

Claude designs the full structure — roles, channels, categories, AutoMod rules — dry-runs it, shows you a preview, and asks before applying anything.

**Bundled templates (apply instantly):**
- `gaming-community` — squads, LFG, tournaments
- `dev-community` — code review, language channels, OSS showcase
- `study-group` — subjects, tutoring, study rooms
- `content-creator` — fan channels, subscriber roles, stream schedules
- `ai-community` — LLM/ML builders, research, agents
- `startup-team` — async workspace by function (eng, design, growth)

</details>

<details>
<summary><b>📐 Channels & structure</b></summary>

```
/discord create a forum channel called #ship-it under Showcase
/discord add a voice channel called Focus Room with a 4-person limit
/discord move #general under a Community category
/discord rename #random to #off-topic and set the topic to 'not work'
```

</details>

<details>
<summary><b>🎭 Roles & permissions</b></summary>

```
/discord add a Contributor role — green, hoisted, with manage_threads perm
/discord hide #internal from @everyone but show it to the Team role
/discord assign the Moderator role to @username
/discord create an Admin role and grant it to me
```

</details>

<details>
<summary><b>📣 Messages & embeds</b></summary>

```
/discord post a welcome embed in #rules with a blurple sidebar and three fields
/discord send our v2.0 changelog to #announcements with a thumbnail
/discord bulk delete the last 50 messages in #spam-cleanup
/discord create a webhook in #releases and post the deploy summary
```

</details>

<details>
<summary><b>🛡 AutoMod & safety</b></summary>

```
/discord block profanity and slurs in all channels except #mods-only
/discord set up a mention-spam guard — block messages with more than 6 @mentions
/discord add a keyword filter for 'free nitro' and common scam phrases
```

</details>

<details>
<summary><b>📅 Events & onboarding</b></summary>

```
/discord schedule a game night in Lobby voice for Friday at 7 PM UTC
/discord set up the welcome screen — rules, introductions, announcements
/discord configure onboarding prompts for new members
```

</details>

<details>
<summary><b>🔨 Moderation</b></summary>

```
/discord timeout @spammer for 1 hour — reason: repeated spam
/discord kick @testuser — reason: alt account
/discord ban user ID 1234567890, delete their last 24 hours of messages
```

</details>

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/discord` says "No bot token saved" | Run `/discord:setup` |
| "No active server" | Run `/discord:setup` again — pick a guild |
| Discord returns 401 | Token was reset on Discord's side. Re-run `/discord:setup` to paste a fresh one |
| "Missing Permissions" error | Your bot needs Administrator permission. Re-invite it with the link from `/discord:setup` |
| Skills don't appear after install | Fully quit and reopen Claude Code (not just reload) |
| "discord.gg" invite filter on a staff channel | Add exempt roles or exempt channels when creating the AutoMod rule |

---

## How the bot token is stored

Your token is saved to `${CLAUDE_PLUGIN_DATA}/credentials.json` — a file in Claude Code's local plugin data directory on **your machine**. Nothing is sent to any third-party server. If a token ever leaks, reset it at [discord.com/developers/applications](https://discord.com/developers/applications) → your app → **Bot** → **Reset Token**, then re-run `/discord:setup`.

---

## Switch servers anytime

```
/discord:setup
```

Re-running setup lists all guilds the bot is in and lets you pick a different one. Your token stays saved — you only re-paste it if Discord rejects it.

---

<div align="center">

**Start here → `/discord:setup`**

[Community Discord](https://discord.gg/babcVNJBet) · [Issues](https://github.com/JCodesMore/discord-for-ai-agents/issues) · [Full README](README.md) · [Blueprint](BLUEPRINT.md)

</div>
