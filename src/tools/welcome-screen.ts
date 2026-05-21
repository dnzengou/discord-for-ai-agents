import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIGuildWelcomeScreen } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { getActiveGuildId } from '../state.js';
import { activeGuildGuard } from '../guards.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const MUTATING = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const welcomeChannelSchema = z.object({
  channel_id: z.string().min(1).describe('The channel to feature on the welcome screen.'),
  description: z.string().min(1).max(50).describe('Short blurb shown next to the channel (max 50 chars).'),
  emoji_id: z.string().optional().describe('Custom emoji ID (mutually exclusive with emoji_name for unicode).'),
  emoji_name: z
    .string()
    .optional()
    .describe('Unicode emoji char (e.g., "👋") OR custom emoji name when paired with emoji_id.'),
});

export function registerWelcomeScreenTools(server: McpServer): void {
  server.registerTool(
    'discord_get_welcome_screen',
    {
      description:
        "Returns the active guild's welcome screen (GET /guilds/{id}/welcome-screen). Welcome screens are only available on Community-enabled servers — returns 404 otherwise. Shows the description text and up to 5 featured channels new members see when joining.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const screen = (await rest.get(
          Routes.guildWelcomeScreen(getActiveGuildId()),
        )) as APIGuildWelcomeScreen;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(screen, null, 2) },
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
    'discord_modify_welcome_screen',
    {
      description:
        "Modifies the welcome screen for the active guild (PATCH /guilds/{id}/welcome-screen). Requires Community to be enabled on the server. Pass only fields you want to change. welcome_channels REPLACES the full list (max 5). Set enabled=true to surface the welcome screen to new members.",
      inputSchema: {
        enabled: z.boolean().optional().describe('Show or hide the welcome screen for new members.'),
        description: z
          .string()
          .max(140)
          .optional()
          .describe("Server description shown at the top of the welcome screen (max 140 chars)."),
        welcome_channels: z
          .array(welcomeChannelSchema)
          .max(5)
          .optional()
          .describe('Up to 5 featured channels. REPLACES the existing list.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ enabled, description, welcome_channels, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (enabled !== undefined) body.enabled = enabled;
        if (description !== undefined) body.description = description;
        if (welcome_channels !== undefined) body.welcome_channels = welcome_channels;
        const screen = (await rest.patch(Routes.guildWelcomeScreen(getActiveGuildId()), {
          body,
          reason,
        })) as APIGuildWelcomeScreen;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, welcome_screen: screen }, null, 2) },
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
