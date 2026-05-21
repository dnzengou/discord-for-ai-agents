# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-05-06

One front door for everything. Type `/discord` for any Discord task, `/discord:setup` for configuration. That's it.

### Changed

- **Front-door consolidation.** The plugin now exposes two skills instead of three: `/discord` (do-anything) and `/discord:setup` (one-shot configuration). Modeled after the YouTube plugin's `/youtube` + `/youtube:setup` shape.
- **`/discord` is the conversational entry point.** Typed bare, it reports current bot + active-guild status and offers a capabilities menu. Typed with a request, it routes the user's intent: open-ended briefs spawn the `discord-architect` sub-agent, "apply X template" runs the inline template flow, concrete asks ("create a #lobby channel") call the matching `discord_*` tool directly.
- **Stale tool-prefix references replaced with bare names.** `skills/setup/SKILL.md` and `scripts/session-banner.mjs` now use `discord_*` (e.g., `discord_whoami`) instead of the stale `mcp__discord__discord_*` prefix. Bare names match the live convention used by the architect agent and the YouTube plugin.

### Added

- **`skills/discord/SKILL.md`** — the new front door. Welcome message with three states (no token / no guild / fully configured), intent-routing table, common-tools cheat sheet, common-flow recipes, and a pointer to `references/` for deeper workflows.
- **`skills/discord/references/templates.md`** — progressive-disclosure detail on the template-apply flow, lifted from the old `apply-template` skill (dry-run-then-apply, the four bundled templates, custom JSON spec shape, name-based cross-refs, Community/AutoMod gotchas).
- **`skills/discord/references/architect.md`** — progressive-disclosure detail on spawning the `discord-architect` agent for open-ended briefs, lifted from the old `server-from-prompt` skill.

### Removed

- **`/discord:apply-template`** skill. Functionality is now reachable via `/discord apply the X template` (intent-routed, with the same dry-run-then-apply flow). Clean break — no redirect shim.
- **`/discord:server-from-prompt`** skill. Functionality is now reachable via `/discord make me a server for X` (intent-routed, spawns the same architect agent). Clean break — no redirect shim.
- Stray literal `${CLAUDE_PLUGIN_DATA}/` directory in the repo root, left over from an early dev session where the env var didn't expand. Already gitignored — just clutter.

### Fixed

- 13 references to the stale tool prefix `mcp__discord__discord_*` (7 in `skills/setup/SKILL.md`, 4 in the now-removed `apply-template` skill, 1 in the now-removed `server-from-prompt` skill, 1 in the SessionStart banner). The live MCP tool prefix is `mcp__plugin_discord_discord__`; bare suffix names like `discord_whoami` are the safest convention since they don't depend on plugin-loader-side prefixing.

### Migration from 0.2.0

No state or credentials changes — `${CLAUDE_PLUGIN_DATA}/credentials.json` and `state.json` are untouched. After updating, the only user-visible difference is that `/discord:apply-template` and `/discord:server-from-prompt` no longer autocomplete or resolve. Both flows are reachable via plain `/discord ...` instead.

## [0.2.0] - 2026-05-04

Setup is now fully conversational. No install-time dialog, no Claude Code restart — install the plugin and run `/discord:setup`.

### Changed

- **Token capture moved into `/discord:setup`.** The install-time `userConfig.bot_token` prompt is gone. The setup skill now explains what a Discord bot token is, walks the user through generating one at https://discord.com/developers/applications, asks them to paste it in chat, and verifies + saves it via a new MCP tool. No `/plugin` config UI step required.
- **Token storage moved from OS keychain to `${CLAUDE_PLUGIN_DATA}/credentials.json`.** Plain JSON file under your plugin data directory. The MCP server reads it at request time, so a freshly saved token works immediately — no Claude Code restart needed.

### Added

- `discord_save_token` — MCP tool that validates a token by calling Discord's `GET /users/@me`, then persists it to `credentials.json` only if Discord accepts it. Used exclusively by `/discord:setup`.
- `src/credentials.ts` — module that owns the credentials file (read/write/path resolution).

### Removed

- `userConfig.bot_token` field from `.claude-plugin/plugin.json`. (`mfa_enabled` is unchanged.)
- `CLAUDE_PLUGIN_OPTION_BOT_TOKEN` env var passthrough to the MCP server.

### Migration from 0.1.0

Existing users will see "no bot token configured" on the first 0.2.0 session, because the token is no longer read from the keychain. Run `/discord:setup` to paste it in (the wizard is the same flow you'd run on a fresh install). The old keychain entry can be deleted via `/plugin` config or left alone — nothing reads it anymore.

### Security note

Pasting the token in chat means it lives in two places on disk: `${CLAUDE_PLUGIN_DATA}/credentials.json` and your Claude Code session history file (`.jsonl`). This is a local-machine trust model — fine for personal machines, not appropriate for shared computers. See README "Bot token storage" for the full picture.

## [0.1.0] - 2026-05-04

First public release. Hand Claude a Discord bot token, get a fully-administered server.

### Added

**Setup & state**
- `userConfig.bot_token` (sensitive) — token captured at install via Claude Code's keychain-backed prompt.
- `userConfig.mfa_enabled` flag for accounts with 2FA.
- `${CLAUDE_PLUGIN_DATA}/state.json` for non-sensitive state (active guild id, last verified timestamp).
- `SessionStart` hooks: `ensure-deps.mjs` installs runtime deps lazily; `session-banner.mjs` surfaces token + active-guild status to the assistant on every session.
- `/discord:setup` skill — interactive wizard: verifies token, lists bot's guilds, generates an OAuth2 invite URL when needed, sets the active guild.

**MCP tools (51 total)**
- `discord_whoami` — prove the bot token works.
- Guild setup: `discord_list_guilds`, `discord_set_active_guild`, `discord_get_active_guild`, `discord_get_invite_url`.
- Channels: `discord_list_channels`, `discord_create_channel` (text/voice/forum/stage/category/announcement), `discord_modify_channel`, `discord_delete_channel`, `discord_modify_channel_positions`.
- Roles: `discord_list_roles`, `discord_create_role`, `discord_modify_role`, `discord_delete_role`, `discord_modify_role_positions`, `discord_assign_role`, `discord_remove_role`, `discord_set_channel_permission_overwrite`.
- Messages & embeds: `discord_send_message`, `discord_send_embed`, `discord_edit_message`, `discord_delete_message`, `discord_add_reaction`, `discord_pin_message`.
- AutoMod: `discord_list_automod_rules`, `discord_create_automod_rule` (keyword / keyword_preset / spam / mention_spam / member_profile triggers), `discord_modify_automod_rule`, `discord_delete_automod_rule`.
- Onboarding: `discord_get_onboarding`, `discord_modify_onboarding`.
- Welcome screen: `discord_get_welcome_screen`, `discord_modify_welcome_screen`.
- Scheduled events: `discord_list_scheduled_events`, `discord_create_scheduled_event`, `discord_modify_scheduled_event`, `discord_delete_scheduled_event`.
- Guild settings: `discord_get_guild`, `discord_modify_guild_settings`.
- Members: `discord_list_members`, `discord_get_member`, `discord_modify_member`, `discord_kick_member`, `discord_ban_member`, `discord_unban_member`.
- Webhooks: `discord_list_webhooks`, `discord_create_webhook`, `discord_send_via_webhook`, `discord_delete_webhook`.
- `discord_raw_request` — escape hatch for any REST endpoint not yet wrapped, plus forward-compat with new Discord API releases.

**Templates & macros**
- `discord_apply_template` macro — bulk-creates roles, categories, channels, welcome screen, AutoMod rules, and scheduled events from a single JSON spec. Idempotent: anything matching by name is skipped, never overwritten. Cross-references resolved by name (case-insensitive).
- `discord_list_templates` — discover bundled starter templates.
- Bundled templates: `gaming-community`, `study-group`, `dev-community`, `content-creator`.
- `/discord:apply-template` skill — pick a template (or paste a custom spec), optional dry-run preview, apply on confirmation.

**Server-from-prompt**
- `discord-architect` sub-agent — translates a natural-language brief ("make me a Magic: The Gathering trading server") into a structured template spec, dry-runs it, asks for approval via `AskUserQuestion`, then applies. Restricted to four tools (`discord_get_active_guild`, `discord_list_templates`, `discord_apply_template`, `AskUserQuestion`) so it can't bypass the macro.
- `/discord:server-from-prompt` skill — thin orchestrator that confirms the active guild and spawns the architect.

### Built on

- [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) for tool exposure
- [@discordjs/rest](https://discord.js.org/docs/packages/rest/main) — REST client with built-in rate-limit handling
- [discord-api-types](https://github.com/discordjs/discord-api-types) — typed REST routes
- [zod](https://zod.dev/) for input validation
