import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIGuild, APIPartialGuild, APIUser } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { loadState, patchState } from '../state.js';
import { tokenGuard } from '../guards.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const STATE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

interface PartialGuildWithOwner extends APIPartialGuild {
  owner?: boolean;
  permissions?: string;
}

export function registerGuildSetupTools(server: McpServer): void {
  server.registerTool(
    'discord_list_guilds',
    {
      description:
        "Lists all Discord guilds (servers) the bot is currently a member of (GET /users/@me/guilds). Use this during setup so the user can pick which guild this bot will manage. Returns id, name, owner flag, and permissions string for each guild. If the result is empty, call discord_get_invite_url to give the user a link for adding the bot.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const raw = (await rest.get(Routes.userGuilds())) as PartialGuildWithOwner[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: raw.length,
                  guilds: raw.map((g) => ({
                    id: g.id,
                    name: g.name,
                    icon: g.icon ?? null,
                    owner: g.owner ?? false,
                    permissions: g.permissions ?? null,
                    features: g.features,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatDiscordError(err) }],
        };
      }
    },
  );

  server.registerTool(
    'discord_set_active_guild',
    {
      description:
        "Saves the active Discord guild for this plugin so all subsequent admin tools (channels, roles, etc.) operate on it. Verifies access by calling GET /guilds/{id} — if the bot is not in the guild or lacks permission, returns the Discord error. On success, persists guild_id and guild_name to ${CLAUDE_PLUGIN_DATA}/state.json.",
      inputSchema: {
        guild_id: z
          .string()
          .min(1)
          .describe('The Discord guild (server) ID to make active. Get this from discord_list_guilds.'),
      },
      annotations: STATE_WRITE,
    },
    async ({ guild_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const guild = (await rest.get(Routes.guild(guild_id))) as APIGuild;
        const next = patchState({
          active_guild_id: guild.id,
          active_guild_name: guild.name,
          last_verified_at: new Date().toISOString(),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  active_guild: {
                    id: next.active_guild_id,
                    name: next.active_guild_name,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatDiscordError(err) }],
        };
      }
    },
  );

  server.registerTool(
    'discord_get_active_guild',
    {
      description:
        'Returns the currently-active Discord guild from plugin state plus the cached bot identity. Read-only — does not call the Discord API. Fields are null if setup has not been run yet.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const state = loadState();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                active_guild_id: state.active_guild_id ?? null,
                active_guild_name: state.active_guild_name ?? null,
                bot_user_id: state.bot_user_id ?? null,
                bot_username: state.bot_username ?? null,
                last_verified_at: state.last_verified_at ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'discord_get_invite_url',
    {
      description:
        "Generates the OAuth2 URL the user opens to add this bot to a guild they own or admin. Defaults to Administrator permissions (integer 8) — what this plugin needs for full functionality. Includes integration_type=0 (GUILD_INSTALL) to ensure the bot installs to a server, not a user account. Use when discord_list_guilds returns 0 guilds, or when the user wants to add the bot to another guild.",
      inputSchema: {
        permissions: z
          .string()
          .optional()
          .describe(
            'Discord permissions integer as a string. Default "8" = Administrator. Use "8" unless the user explicitly asks for narrower permissions.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ permissions }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const user = (await rest.get(Routes.user('@me'))) as APIUser;
        const perms = permissions ?? '8';
        const params = new URLSearchParams({
          client_id: user.id,
          scope: 'bot applications.commands',
          permissions: perms,
          integration_type: '0',
        });
        const url = `https://discord.com/oauth2/authorize?${params.toString()}`;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  invite_url: url,
                  bot_id: user.id,
                  bot_username: user.username,
                  permissions: perms,
                  integration_type: 'GUILD_INSTALL',
                  note:
                    perms === '8'
                      ? 'Administrator (full access). Required for AutoMod, role management, and most admin operations.'
                      : 'Custom permissions integer.',
                  troubleshooting:
                    "If the OAuth2 page only asks for 'Create slash commands' (no server picker, no Administrator checkbox), the bot's app isn't configured for Guild Install. Fix: https://discord.com/developers/applications → your app → Installation → set Installation Contexts to include 'Guild Install', then under Default Install Settings → Guild Install set scopes to bot + applications.commands and permissions to Administrator. Save, then reopen the invite URL.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatDiscordError(err) }],
        };
      }
    },
  );
}
