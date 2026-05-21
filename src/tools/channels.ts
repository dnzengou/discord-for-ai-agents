import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ChannelType, Routes } from 'discord-api-types/v10';
import type { APIChannel } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { getActiveGuildId, loadState } from '../state.js';
import { activeGuildGuard, tokenGuard } from '../guards.js';
import { getCached, setCached, invalidate } from '../cache.js';

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

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

const FRIENDLY_TO_TYPE = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia,
} as const;

type FriendlyChannelType = keyof typeof FRIENDLY_TO_TYPE;

export const TYPE_TO_FRIENDLY: Record<number, string> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.DM]: 'dm',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GroupDM]: 'group_dm',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.AnnouncementThread]: 'announcement_thread',
  [ChannelType.PublicThread]: 'public_thread',
  [ChannelType.PrivateThread]: 'private_thread',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildDirectory]: 'directory',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildMedia]: 'media',
};

export function formatChannel(c: APIChannel): Record<string, unknown> {
  const any = c as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: any.id,
    name: any.name ?? null,
    type: TYPE_TO_FRIENDLY[c.type] ?? `unknown(${c.type})`,
    type_id: c.type,
  };
  if (any.parent_id !== undefined) out.parent_id = any.parent_id;
  if (any.position !== undefined) out.position = any.position;
  if (any.topic) out.topic = any.topic;
  if (any.nsfw) out.nsfw = any.nsfw;
  if (any.rate_limit_per_user) out.rate_limit_per_user = any.rate_limit_per_user;
  if (any.bitrate !== undefined) out.bitrate = any.bitrate;
  if (any.user_limit !== undefined) out.user_limit = any.user_limit;
  return out;
}

export function registerChannelTools(server: McpServer): void {
  server.registerTool(
    'discord_list_channels',
    {
      description:
        "Lists all channels in the active guild (GET /guilds/{id}/channels). Returns id, name, type (friendly + numeric), parent_id (the category it lives under), and position. Categories appear as their own entries with type='category'; child channels reference them via parent_id.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      const guildId = getActiveGuildId();
      const cacheKey = `channels:${guildId}`;
      let channels = getCached<APIChannel[]>(cacheKey);
      if (!channels) {
        try {
          channels = (await getRest().get(Routes.guildChannels(guildId))) as APIChannel[];
          setCached(cacheKey, channels);
        } catch (err) {
          return { isError: true, content: [{ type: 'text' as const, text: formatDiscordError(err) }] };
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: channels.length, channels: channels.map(formatChannel) }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'discord_create_channel',
    {
      description:
        "Creates a new channel in the active guild (POST /guilds/{id}/channels). To put channels under a category, create the category first (type='category') then create children passing the category's id as parent_id. Discord lowercases names and replaces spaces/uppercase with hyphens for text/forum/announcement channels.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(100)
          .describe('Channel name (max 100 chars). Discord normalizes text/forum/announcement names to lowercase-with-hyphens.'),
        type: z
          .enum(['text', 'voice', 'category', 'announcement', 'stage', 'forum', 'media'])
          .describe(
            "Channel type: text=normal chat, voice=voice channel, category=collapsible group, announcement=news channel other servers can follow, stage=stage voice, forum=Reddit-style threaded posts, media=media gallery.",
          ),
        parent_id: z
          .string()
          .optional()
          .describe("Category ID this channel should live under. Omit when creating a category or top-level channel."),
        topic: z
          .string()
          .max(1024)
          .optional()
          .describe('Channel topic / description (text/announcement/forum/media only). Max 1024 chars.'),
        nsfw: z.boolean().optional().describe('Mark as age-restricted.'),
        rate_limit_per_user: z
          .number()
          .int()
          .min(0)
          .max(21600)
          .optional()
          .describe('Slowmode in seconds (0-21600). Applies to text/forum/media/voice/stage.'),
        bitrate: z
          .number()
          .int()
          .min(8000)
          .max(384000)
          .optional()
          .describe('Voice bitrate in bps (voice/stage only). Max depends on guild boost level.'),
        user_limit: z
          .number()
          .int()
          .min(0)
          .max(99)
          .optional()
          .describe('Voice user cap (0=unlimited, 1-99). voice/stage only.'),
        position: z.number().int().min(0).optional().describe('Sort position. Lower = higher in the list.'),
        reason: z.string().max(512).optional().describe('Audit log reason for this action.'),
      },
      annotations: MUTATING,
    },
    async ({
      name,
      type,
      parent_id,
      topic,
      nsfw,
      rate_limit_per_user,
      bitrate,
      user_limit,
      position,
      reason,
    }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {
          name,
          type: FRIENDLY_TO_TYPE[type as FriendlyChannelType],
        };
        if (parent_id) body.parent_id = parent_id;
        if (topic !== undefined) body.topic = topic;
        if (nsfw !== undefined) body.nsfw = nsfw;
        if (rate_limit_per_user !== undefined) body.rate_limit_per_user = rate_limit_per_user;
        if (bitrate !== undefined) body.bitrate = bitrate;
        if (user_limit !== undefined) body.user_limit = user_limit;
        if (position !== undefined) body.position = position;
        const guildId = getActiveGuildId();
        const channel = (await rest.post(Routes.guildChannels(guildId), {
          body,
          reason,
        })) as APIChannel;
        invalidate(`channels:${guildId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, channel: formatChannel(channel) }, null, 2),
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
    'discord_modify_channel',
    {
      description:
        "Modifies an existing channel (PATCH /channels/{id}). Pass only the fields you want to change. Type can be converted between 'text' and 'announcement' only — other type changes are rejected by Discord. parent_id=null moves a channel out of any category.",
      inputSchema: {
        channel_id: z.string().min(1).describe('The channel to modify.'),
        name: z.string().min(1).max(100).optional(),
        topic: z.string().max(1024).optional(),
        nsfw: z.boolean().optional(),
        rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
        bitrate: z.number().int().min(8000).max(384000).optional(),
        user_limit: z.number().int().min(0).max(99).optional(),
        position: z.number().int().min(0).optional(),
        parent_id: z
          .string()
          .nullable()
          .optional()
          .describe("Move under a different category. Pass null to remove from any category."),
        type: z
          .enum(['text', 'announcement'])
          .optional()
          .describe('Convert between text and announcement. Other type changes are not supported by Discord.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, type, reason, ...patch }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) body[k] = v;
        }
        if (type) body.type = FRIENDLY_TO_TYPE[type as FriendlyChannelType];
        const channel = (await rest.patch(Routes.channel(channel_id), { body, reason })) as APIChannel;
        const gId = loadState().active_guild_id;
        if (gId) invalidate(`channels:${gId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, channel: formatChannel(channel) }, null, 2),
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
    'discord_delete_channel',
    {
      description:
        "Permanently deletes a channel (DELETE /channels/{id}). Cannot be undone. Returns the deleted channel object. For categories, child channels become top-level (they are NOT deleted).",
      inputSchema: {
        channel_id: z.string().min(1).describe('The channel to delete.'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const channel = (await rest.delete(Routes.channel(channel_id), { reason })) as APIChannel;
        const gId = loadState().active_guild_id;
        if (gId) invalidate(`channels:${gId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted_channel: formatChannel(channel) }, null, 2),
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
    'discord_modify_channel_positions',
    {
      description:
        "Bulk reorders channels in the active guild (PATCH /guilds/{id}/channels). Pass an array of {id, position?, parent_id?, lock_permissions?} entries. Use this to sort channels or move them between categories. Returns ok:true with the submitted positions echoed back (Discord returns 204 No Content on success).",
      inputSchema: {
        positions: z
          .array(
            z.object({
              id: z.string().min(1).describe('Channel ID to reposition.'),
              position: z.number().int().min(0).optional().describe('New sort position.'),
              parent_id: z
                .string()
                .nullable()
                .optional()
                .describe('Move under this category, or null for top-level.'),
              lock_permissions: z
                .boolean()
                .optional()
                .describe("When parent_id changes, sync permission overwrites with the new parent."),
            }),
          )
          .min(1)
          .describe('Channels to reposition. At least one entry.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ positions, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const guildId = getActiveGuildId();
        await rest.patch(Routes.guildChannels(guildId), {
          body: positions,
          reason,
        });
        invalidate(`channels:${guildId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, updated: positions }, null, 2),
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
