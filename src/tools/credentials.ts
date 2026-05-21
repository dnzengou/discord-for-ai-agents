import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { APIUser } from 'discord-api-types/v10';
import { z } from 'zod';
import { saveBotToken } from '../credentials.js';
import { formatDiscordError } from '../client.js';

export function registerCredentialTools(server: McpServer): void {
  server.registerTool(
    'discord_save_token',
    {
      description:
        "Validate a Discord bot token by calling Discord's GET /users/@me, then save it to plugin storage if valid. Used by /discord:setup. NEVER call this with a token guessed or pulled from elsewhere in the conversation — only with a token the user has explicitly typed for this purpose during the setup flow.",
      inputSchema: {
        token: z
          .string()
          .min(20)
          .describe(
            'The Discord bot token from https://discord.com/developers/applications → your app → Bot → Reset Token → Copy.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ token }) => {
      const trimmed = token.trim();
      const rest = new REST({ version: '10' }).setToken(trimmed);
      try {
        const user = (await rest.get(Routes.user('@me'))) as APIUser;
        saveBotToken(trimmed);
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
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const message =
          status === 401
            ? 'Discord rejected the token (HTTP 401). Double-check the value at https://discord.com/developers/applications → your app → Bot → Reset Token → Copy. The token was NOT saved.'
            : `${formatDiscordError(err)}. The token was NOT saved.`;
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
        };
      }
    },
  );
}
