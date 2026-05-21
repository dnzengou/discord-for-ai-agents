import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIUser } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { patchState } from '../state.js';
import { tokenGuard } from '../guards.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerWhoamiTool(server: McpServer): void {
  server.registerTool(
    'discord_whoami',
    {
      description:
        "Verifies the configured Discord bot token by fetching the bot's identity (GET /users/@me). Returns the bot's username, id, discriminator, and feature flags. Use this first when troubleshooting — it confirms the token works.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const user = (await rest.get(Routes.user('@me'))) as APIUser;
        patchState({
          bot_user_id: user.id,
          bot_username: user.username,
          last_verified_at: new Date().toISOString(),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  bot: {
                    id: user.id,
                    username: user.username,
                    global_name: user.global_name,
                    discriminator: user.discriminator,
                    bot: user.bot,
                    verified: user.verified,
                    flags: user.flags,
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
          content: [
            {
              type: 'text' as const,
              text: formatDiscordError(err),
            },
          ],
        };
      }
    },
  );

}
