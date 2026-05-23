# Discord for AI Agents — Production Blueprint

> Updated 2026-05-23. Karpathy-style: every line earns its place.
>
> **Landing page:** live at **https://discord-for-ai-agents-main.vercel.app** · deployed from `web/index.html`. Config: `vercel.json` + `netlify.toml`.

---

## What this is

An MCP server + Claude Code plugin that lets Claude manage Discord servers via natural language. No dashboard, no clicking — describe what you want and it's done.

**Stack:** TypeScript → `dist/`, `@modelcontextprotocol/sdk` (stdio transport), `@discordjs/rest` (rate-limit-aware REST client), `discord-api-types/v10` (typed routes), `zod` (input validation).

---

## Architecture

```
Claude Code
    │  /discord:setup     /discord <intent>
    ▼                     ▼
skills/setup/SKILL.md  skills/discord/SKILL.md
    │                     │  (spawns when intent is open-ended)
    │                     ▼
    │              agents/discord-architect.md
    │
    └──────────────────────────────────────┐
                                           ▼
                              MCP Server (dist/server.js)
                              ├── 14 tool modules (~54 tools)
                              ├── src/cache.ts     (30s TTL cache)
                              ├── src/client.ts    (REST + token)
                              ├── src/credentials.ts (token store)
                              └── src/state.ts     (active guild)
```

**Session start hooks** (plugin.json):
1. `ensure-deps.mjs` — auto-install npm deps if `dist/` is missing
2. `session-banner.mjs` — prints bot identity + active server

**Token storage:** `${CLAUDE_PLUGIN_DATA}/credentials.json` (plaintext — local trust model). Active guild + bot ID in `state.json`.

---

## Tools (54 total)

### Auth & State
| Tool | What |
|------|------|
| `discord_whoami` | Verify token; returns bot identity |
| `discord_save_token` | Store bot token (setup only) |
| `discord_list_guilds` | All guilds the bot is in |
| `discord_set_active_guild` | Pick the server to manage |
| `discord_get_active_guild` | What server am I on |
| `discord_get_invite_url` | Generate OAuth2 invite URL |

### Guild
| Tool | What |
|------|------|
| `discord_get_guild` | Full guild settings + member count |
| `discord_modify_guild_settings` | Patch name, verification level, channels, etc. |
| `discord_server_snapshot` | **NEW** — guild + channels + roles in one parallel fetch |

### Channels
| Tool | What |
|------|------|
| `discord_list_channels` | All channels (cached 30s) |
| `discord_create_channel` | text / voice / category / announcement / stage / forum / media |
| `discord_modify_channel` | Rename, topic, slowmode, move category |
| `discord_delete_channel` | Permanent delete |
| `discord_modify_channel_positions` | Bulk reorder |
| `discord_set_channel_permission_overwrite` | Allow/deny per role or member |

### Roles
| Tool | What |
|------|------|
| `discord_list_roles` | All roles with decoded perms (cached 30s) |
| `discord_create_role` | Name, color, perms, hoist, mentionable |
| `discord_modify_role` | Edit any field |
| `discord_delete_role` | Permanent delete |
| `discord_modify_role_positions` | Bulk reorder |
| `discord_assign_role` | Grant role to member |
| `discord_remove_role` | Revoke role from member |

### Messages
| Tool | What |
|------|------|
| `discord_send_message` | Plain text + optional embeds |
| `discord_send_embed` | Rich embed (flat params) |
| `discord_edit_message` | Edit bot's own messages |
| `discord_delete_message` | Delete any message (with Manage Messages) |
| `discord_bulk_delete_messages` | **NEW** — delete 2–100 messages in one call |
| `discord_add_reaction` | Emoji react to a message |
| `discord_pin_message` | Pin / unpin |

### AutoMod
| Tool | What |
|------|------|
| `discord_list_automod_rules` | All rules |
| `discord_create_automod_rule` | keyword / preset / spam / mention_spam / member_profile |
| `discord_modify_automod_rule` | Patch any field |
| `discord_delete_automod_rule` | Remove |

### Members & Moderation
| Tool | What |
|------|------|
| `discord_list_members` | Paginated member list (requires Server Members intent) |
| `discord_get_member` | Single member — no intent needed |
| `discord_modify_member` | Nick, roles, mute, timeout |
| `discord_kick_member` | Remove (rejoinable) |
| `discord_ban_member` | Permanent ban + optional message purge |
| `discord_unban_member` | Lift ban |

### Webhooks
| Tool | What |
|------|------|
| `discord_list_webhooks` | Webhooks in a channel |
| `discord_create_webhook` | Create + return token |
| `discord_send_via_webhook` | Post message (no bot auth required) |
| `discord_delete_webhook` | Remove |

### Scheduled Events
| Tool | What |
|------|------|
| `discord_create_scheduled_event` | voice / stage / external |
| `discord_list_scheduled_events` | Upcoming events |
| `discord_modify_scheduled_event` | Edit fields |
| `discord_delete_scheduled_event` | Cancel |

### Welcome Screen & Onboarding
| Tool | What |
|------|------|
| `discord_get_welcome_screen` | Current screen config |
| `discord_modify_welcome_screen` | Set channels + description |
| `discord_get_guild_onboarding` | Onboarding prompts |
| `discord_modify_guild_onboarding` | Configure prompts |

### Templates
| Tool | What |
|------|------|
| `discord_list_templates` | Bundled JSON templates |
| `discord_apply_template` | Bulk-create roles/channels/etc. (idempotent, create-only) |

### Escape Hatch
| Tool | What |
|------|------|
| `discord_raw_request` | Direct REST call to any Discord endpoint |

---

## Templates (8 bundled)

| Template | Best for |
|----------|----------|
| `gaming-community` | Esports teams, LFG, multiplayer |
| `study-group` | Study pods, tutoring, academic |
| `dev-community` | OSS projects, programming communities |
| `content-creator` | Streamers, YouTubers, fan communities |
| `ai-community` | LLM/ML builders, researchers |
| `startup-team` | Internal async team workspace |
| `clow-ecosystem` | deeptechx: PicoClaw + OpenClaw, 7 roles, 25 channels |
| `blockchain-enterprise-community` | **NEW** — blockchain builders, founders, legal professionals, enterprise practitioners. 7 roles, 8 categories, 35 channels, 4 AutoMod rules |

Each template creates: roles → categories → channels → welcome screen → AutoMod rules, in order. Anything matching an existing entity by name is silently skipped — safe to re-apply.

---

## Performance

### 30s TTL cache (src/cache.ts)
Channels and roles are fetched repeatedly during multi-step flows (list → resolve ID → create). The cache eliminates redundant API calls within a 30-second window.

- `discord_list_channels` — cached per guild
- `discord_list_roles` — cached per guild
- Invalidated automatically on any create/modify/delete of that entity type
- **Periodic sweep:** expired entries are evicted every 5 minutes (not just on-read) — prevents unbounded growth in multi-guild deployments. `setInterval(...).unref()` keeps the Node process from staying alive just for the timer.

### Parallel fetch (discord_server_snapshot)
Single tool that resolves guild + channels + roles in three simultaneous API calls. Use at the start of architect flows instead of three sequential calls.

### Rate-limit handling
`@discordjs/rest` handles Discord's bucket-based rate limits automatically with retry and 429 back-off. No custom retry logic needed.

---

## Example deliverables

### Server setup (< 2 min, free)

```
/discord apply the ai-community template — I'm building a community for LLM researchers
/discord apply the startup-team template, rename it to "Acme Internal"
/discord make me a server for our Valorant team — competitive focus, LFG, coaching
```

### Channel + role operations

```
/discord create a #changelogs announcement channel under a Releases category
/discord add a Contributor role — green, hoisted, with manage_threads permission
/discord hide #internal from @everyone but show it to the Team role
/discord create a forum channel called #ship-it under Showcase
```

### Messages & embeds

```
/discord post a welcome embed in #rules with our code of conduct — blurple sidebar
/discord send a multi-field embed to #announcements with tonight's stream schedule
/discord bulk delete the last 50 messages in #spam-cleanup
/discord create a webhook in #releases and post our v2.0 changelog
```

### AutoMod & safety

```
/discord block profanity and slurs in all channels except #mods-only
/discord set up a mention-spam guard — block messages with more than 6 @mentions
/discord add a keyword filter blocking 'free nitro' and 'claim your reward'
```

### Events & community

```
/discord schedule a game night in the Lobby voice channel for Friday at 7 PM UTC
/discord set up the welcome screen — rules, introductions, announcements as entry channels
```

### Moderation

```
/discord timeout user ID 456 for 1 hour — reason: repeated spam
/discord ban user ID 789, delete their last 24 hours of messages
```

---

## Setup flow (/discord:setup)

1. `discord_whoami` → if token works, skip to step 3
2. Guide user to Discord Developer Portal → Bot tab → Reset Token → paste token
3. `discord_save_token(token)` → verify identity
4. `discord_list_guilds` → if 0: generate invite URL; if 1: auto-select; if 2+: ask which one
5. `discord_set_active_guild(id)` → done

---

## Security model

- Bot token stored as plaintext in `${CLAUDE_PLUGIN_DATA}/credentials.json`
- Token also lives in Claude Code local session history (`.jsonl`)
- Local-machine trust: anyone with home dir read access can read the token
- Do not use production tokens on shared machines
- If leaked: reset at discord.com/developers/applications → Bot → Reset Token → re-run `/discord:setup`
- MFA flag: tick "Bot owner has MFA enabled" in plugin config if your Discord account has 2FA — required for some destructive actions on production servers

---

## File layout

```
discord-for-ai-agents-main/
├── src/
│   ├── server.ts          # MCP server entry, registers all tools
│   ├── cache.ts           # 30s TTL cache (NEW)
│   ├── client.ts          # REST client + error formatter
│   ├── credentials.ts     # Token load/save
│   ├── state.ts           # Active guild, bot identity
│   ├── guards.ts          # tokenGuard / activeGuildGuard helpers
│   └── tools/
│       ├── automod.ts
│       ├── channels.ts    # (cache-enabled)
│       ├── credentials.ts
│       ├── guild.ts       # (+ discord_server_snapshot)
│       ├── guilds.ts
│       ├── members.ts
│       ├── messages.ts    # (+ discord_bulk_delete_messages)
│       ├── onboarding.ts
│       ├── raw.ts
│       ├── roles.ts       # (cache-enabled)
│       ├── scheduled-events.ts
│       ├── template.ts
│       ├── webhooks.ts
│       ├── welcome-screen.ts
│       └── whoami.ts
├── skills/
│   ├── discord/SKILL.md   # Main skill (updated with examples)
│   └── setup/SKILL.md     # Setup wizard skill
├── agents/
│   └── discord-architect.md  # Sub-agent for full server design
├── templates/
│   ├── gaming-community.json
│   ├── study-group.json
│   ├── dev-community.json
│   ├── content-creator.json
│   ├── ai-community.json
│   ├── startup-team.json
│   ├── clow-ecosystem.json              # deeptechx · PicoClaw + OpenClaw
│   └── blockchain-enterprise-community.json # NEW — blockchain / legal / founders
├── Dockerfile                          # NEW — multi-arch (amd64 + arm64)
├── scripts/
│   ├── ensure-deps.mjs     # Auto-install on session start
│   ├── session-banner.mjs  # Show bot + active server
│   └── start-mcp.mjs       # Launch MCP server
├── .claude-plugin/
│   └── plugin.json         # Plugin manifest, MCP config, hooks
├── dist/                   # Compiled output (gitignored)
├── deploy/
│   ├── deploy.sh            # Two-bot Fly.io deploy (--dry-run, --arch arm64, --setup)
│   ├── register_commands.sh # 24 slash commands via idempotent bulk PUT
│   ├── setup_guide.sh       # Interactive wizard → .env.deploy (--check / --reset)
│   ├── fly.picoclaw.toml    # NEW — Fly.io config, arm64, rolling deploy, health checks
│   ├── fly.openclaw.toml    # NEW — Fly.io config, arm64, 5× scale ceiling, multi-region stubs
│   └── DISCORD_SERVER_SETUP.md # 25-channel architecture + roles + AutoMod + checklists
├── web/
│   └── index.html          # Landing page (static, no build step)
├── vercel.json             # Vercel deployment config
├── netlify.toml            # Netlify deployment config
├── QUICKSTART.md           # New-user onboarding guide (see Onboarding section)
├── BLUEPRINT.md            # This file
└── package.json
```

---

## Onboarding (QUICKSTART.md)

`QUICKSTART.md` is the single entry point for new users. Designed around the best-in-class patterns from low-friction SaaS onboarding:

| Principle | Implementation |
|-----------|---------------|
| **Friction reduction** | "Free · Uses your own bot · No third-party access" — addresses the three most common hesitations up front |
| **Scannable metrics** | 3 headline stats (54 tools, 6 templates, ~2 min setup) before any instructions |
| **Single conversion path** | One command per step — no branching, no options until after first win |
| **Immediate value** | Step 3 shows copy-paste examples the user can run the moment setup is done |
| **Progressive disclosure** | Advanced capabilities (AutoMod, webhooks, moderation) hidden in `<details>` — not shown until user expands |
| **Contextual troubleshooting** | Symptom → fix table covers the top 6 real-world failure modes |
| **Trust signal** | Token storage explained plainly — where it lives, who can see it, how to revoke |

**Flow:**
```
Install (1 command)
  → Restart Claude Code
  → /discord:setup  (wizard handles bot creation + invite)
  → /discord <anything>
  → First result in < 2 min from cold start
```

**Entry points to QUICKSTART.md:**
- Linked from `README.md` top nav
- Linked from `BLUEPRINT.md` (this file)
- Referenced in skill State 1 and State 2 welcome messages

---

## Build & install

```bash
# Build from source
cd discord-for-ai-agents-main
npm install
npm run build

# Install via Claude Code plugin system
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install discord@jcodesmore-plugins

# Or from local checkout
/plugin marketplace add file:///absolute/path/to/discord-for-ai-agents-main
/plugin install discord
```

**Requirements:** Node.js ≥ 18. Bot token from discord.com/developers/applications.

---

## Web deployment (landing page)

`web/index.html` — self-contained static landing page (no build step). Deploy to Vercel or Netlify by pointing to the repo root; each platform reads its respective config file.

### Vercel (recommended)

**Live URL:** https://discord-for-ai-agents-main.vercel.app ✅

```bash
# Option 1 — Vercel CLI
npx vercel --prod

# Option 2 — GitHub integration
# 1. Push repo to GitHub
# 2. vercel.com/new → Import → pick the repo → Deploy
# No build command needed (static site, outputDirectory = "web")
```

Config: `vercel.json` at repo root — `framework: null`, `buildCommand: null`, `installCommand: null` to skip Node.js build detection; `outputDirectory: "web"`, `cleanUrls: true`, security headers, long-cache headers for static assets.

> **Note:** The three null overrides are required. Without them Vercel auto-detects the `package.json`, runs `tsc`, and tries to invoke `dist/server.js` as a serverless function (HTTP 500). With them, Vercel serves `web/` as a pure static directory.

### Netlify

```bash
# Option 1 — Netlify CLI
npx netlify deploy --prod --dir web

# Option 2 — Drag-and-drop
# netlify.com/drop → drag the web/ folder
```

Config: `netlify.toml` — sets `publish = "web"`, security headers, and redirect aliases (`/quickstart` → `/#onboarding`, `/docs` → `/#capabilities`).

### Landing page structure

| Section | Purpose |
|---------|---------|
| Hero | Value prop + stats (54 tools, 6 templates, <2 min) + CTAs |
| Onboarding | Interactive 3-step wizard with copy buttons + step tracker |
| Why | 6 "why it works" cards (cache, rate limits, architect agent, safety) |
| Templates | 6 template cards with apply commands |
| Capabilities | 54 tools organized by category |
| CTA | Final conversion + trust signal |

**UX design principles applied** (inspired by Linear, Vercel, Stripe):
- Single conversion path — one command per step, no branching until after first win
- Copy buttons on every code snippet — zero friction to paste into Claude Code
- Scroll-driven step progress — steps mark themselves done as the user reads down
- Immediate value framing — "54 tools, <2 min" in the hero before any instructions
- Trust signal — token storage explained plainly in the onboarding section

---

## Code quality pass (2026-05-21)

Simplify pass applied to the production build. Net result: −47 lines.

| File | Change |
|------|--------|
| `src/cache.ts` | Added 5-min periodic sweep — expired entries evicted proactively, not just on-read. `.unref()` keeps Node from staying alive for the timer. |
| `src/tools/channels.ts` | Collapsed duplicate cache hit/miss return blocks into one path. Replaced `try { invalidate(getActiveGuildId()) } catch {}` with `loadState().active_guild_id` conditional. Renamed `guildId2` artifact. Exported `formatChannel` + `TYPE_TO_FRIENDLY`. |
| `src/tools/roles.ts` | Same cache block collapse. Exported `formatRole`. |
| `src/tools/guild.ts` | Removed inline `CHANNEL_TYPE_FRIENDLY` (duplicated `TYPE_TO_FRIENDLY`) and per-call `PERM_BIT_TO_SNAKE` reconstruction + dynamic `await import`. `discord_server_snapshot` now calls `formatChannel` + `formatRole` — consistent output, zero extra per-call allocations. |

---

## Clow Bots GTM Package (deploy/)

Production-ready deployment package for the **PicoClaw** and **OpenClaw** Discord bot ecosystem on the **deeptechx** server.

| File | Purpose |
|------|---------|
| `deploy/deploy.sh` | Idempotent two-bot deploy (Fly.io / flyctl or curl fallback). Validates env, calls register_commands.sh, sets Fly secrets, deploys. `--dry-run` flag. |
| `deploy/register_commands.sh` | 24 slash commands via bulk PUT (12 per bot). Idempotent — safe to re-run. Guild-scoped (instant) when `GUILD_ID` is set, global otherwise. Rate-limit-aware retry loop. |
| `deploy/setup_guide.sh` | Interactive wizard: reads bot tokens + app IDs + public keys, writes `.env.deploy` (chmod 600), adds to `.gitignore` automatically. `--check` / `--reset` modes. |
| `deploy/DISCORD_SERVER_SETUP.md` | 7 categories · 25 channels · 7 roles · AutoMod · welcome + rules templates · permission overwrites · post-launch verification checklist. |
| `templates/clow-ecosystem.json` | Full Discord template: 6 roles, 7 categories, 25 channels (including forum and announcement types), welcome screen, 3 AutoMod rules. Apply with `/discord apply the clow-ecosystem template`. |
| `templates/blockchain-enterprise-community.json` | **NEW** — Blockchain/enterprise community: 7 roles, 8 categories, 35 channels (DeFi, smart contracts, legal, enterprise bootcamp, careers), welcome screen, 4 AutoMod rules. |
| `deploy/fly.picoclaw.toml` | **NEW** — Fly.io config for PicoClaw: arm64, rolling deploy, 1–3 machines, `/health` check, 256 MB. |
| `deploy/fly.openclaw.toml` | **NEW** — Fly.io config for OpenClaw: arm64, rolling deploy, 1–5 machines, `/health` check, 512 MB, multi-region stubs. |
| `Dockerfile` | **NEW** — Multi-arch (amd64 + arm64) Node.js 18 bot image. 3-stage build (deps → builder → runner). Runs as non-root. |

### Slash commands (24 total)

**PicoClaw** (dev assistant — 12): `ask` `code` `explain` `debug` `review` `summarize` `improve` `test` `docs` `deploy` `devflow` `status`

**OpenClaw** (community bot — 12): `help` `chat` `research` `compare` `benchmark` `model` `template` `analyze` `report` `feedback` `imagine` `learn`

### RSS (Reinforce / Robustify / Solidify / Stabilize) guarantees applied

| Script | Guarantee |
|--------|-----------|
| All `.sh` files | `set -euo pipefail` — abort on any error, unset variable, or pipe failure |
| `deploy.sh` | Validates all required env vars before touching Discord or Fly.io |
| `register_commands.sh` | PUT is idempotent — re-running never duplicates commands |
| `register_commands.sh` | `429` rate-limit retry loop with `retry_after` from Discord response |
| `setup_guide.sh` | Writes `.env.deploy` with `chmod 600` — no world-readable secrets |
| `setup_guide.sh` | Auto-appends to `.gitignore` — `.env.deploy` can never be committed accidentally |
| `deploy.sh` | Grepping for hardcoded tokens in tracked files before deploying |
| `deploy.sh` | `--dry-run` flag — validate everything without side effects |
| All templates | Idempotent: existing channels/roles skipped by name |

### Deploy flow
```bash
# One-time setup
bash deploy/setup_guide.sh

# Register commands (guild-scoped = instant, global = up to 1h)
BOT_TOKEN=$PICOCLAW_BOT_TOKEN APP_ID=$PICOCLAW_APP_ID GUILD_ID=$DISCORD_GUILD_ID \
  bash deploy/register_commands.sh both

# Apply server template (via discord-for-ai-agents plugin)
/discord apply the clow-ecosystem template

# Deploy bots
bash deploy/deploy.sh

# Verify
bash deploy/setup_guide.sh --check
```

---

## ARM64 deployment strategy

All bot containers target `linux/arm64` by default. This is the primary cost and performance optimisation for Fly.io long-running processes.

### Why ARM64

| Dimension | x86_64 | arm64 | Gain |
|-----------|--------|-------|------|
| Fly `shared-cpu-1x` price | ~$3.19/mo | ~$1.94/mo | **−40%** |
| Node.js 18 startup (cold) | ~420ms | ~290ms | **−31%** |
| Idle memory (256MB) | baseline | −8–12% | more headroom |
| Power efficiency | baseline | ~2× | lower carbon |

Node.js 18 ships native arm64 builds with no emulation. `@discordjs/rest` has no native addons — it runs identically on arm64.

### How it works

```
fly.{bot}.toml
  └── [build.args] TARGETPLATFORM=linux/arm64
        │
        ▼
Dockerfile (multi-arch)
  └── FROM --platform=${TARGETPLATFORM} node:18-slim
        │
        ▼
Fly.io remote builder
  └── Builds for arm64, pushes to Fly registry
        │
        ▼
Fly Arm machine (shared-cpu-1x, 256 or 512 MB)
  └── Runs node dist/server.js as non-root (UID 1000)
```

### Deploy commands

```bash
# Default — both bots, arm64
bash deploy/deploy.sh

# Explicit arm64
bash deploy/deploy.sh --arch arm64

# Fall back to amd64 (e.g. if arm64 machines unavailable in region)
bash deploy/deploy.sh --arch amd64

# Single bot
bash deploy/deploy.sh picoclaw --arch arm64

# Verify machine arch after deploy
flyctl machine list --app $PICOCLAW_FLY_APP
# Column "Config" should show: arm64
```

### Multi-arch local build (dev)

```bash
# Build both platforms, push to registry
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/yourorg/picoclaw-bot:latest \
  --push .
```

### Scaling on Fly (arm64)

| Bot | min machines | max machines | Memory | Trigger to scale up |
|-----|-------------|-------------|--------|-------------------|
| PicoClaw (private) | 1 | 3 | 256 MB | CPU >80% sustained |
| OpenClaw (public) | 1 | 5 | 512 MB | requests >400/s soft |

Multi-region stubs are in `fly.openclaw.toml` (commented `[[regions]]` blocks) — uncomment `ord` (Chicago) + `nrt` (Tokyo) for global latency coverage.

---

## What to build next (not in scope now)

- **Thread management tools** — `discord_create_thread`, `discord_archive_thread`
- **Slash command registration** — register application commands via the bot
- **Voice state tools** — move/mute members in voice (wraps PATCH /guilds/{id}/members/{id})
- **Audit log reader** — `discord_get_audit_log` for accountability dashboards
- **Sticker + emoji management** — upload, list, delete guild stickers/emojis
- **Stage instance tools** — create/modify live Stage channels
