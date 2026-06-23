import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ChannelType, Routes } from 'discord-api-types/v10';
import type { APIChannel, APIThreadChannel, APIThreadMember } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { getActiveGuildId, loadState } from '../state.js';
import { activeGuildGuard, tokenGuard } from '../guards.js';
import { invalidate } from '../cache.js';
import { formatChannel } from './channels.js';

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

const FRIENDLY_TO_THREAD_TYPE: Record<'public' | 'private' | 'announcement', number> = {
  public: ChannelType.PublicThread,
  private: ChannelType.PrivateThread,
  announcement: ChannelType.AnnouncementThread,
};

function formatThreadMember(m: APIThreadMember): Record<string, unknown> {
  return {
    user_id: m.user_id,
    thread_id: m.id,
    join_timestamp: m.join_timestamp,
    flags: m.flags,
  };
}

function invalidateGuildChannels(): void {
  const gId = loadState().active_guild_id;
  if (gId) invalidate(`channels:${gId}`);
}

export function registerThreadTools(server: McpServer): void {
  server.registerTool(
    'discord_create_thread',
    {
      description:
        "Creates a thread. Two modes: (1) channel mode — pass channel_id alone to create a standalone thread (text/announcement channels only; type defaults to 'public'). (2) message mode — pass channel_id + message_id to thread off an existing message; the thread inherits the channel's type and Discord ignores the type field. For forum/media channels use discord_send_message — threads there are created implicitly with each post. auto_archive_minutes: 60 (1h), 1440 (1d), 4320 (3d), 10080 (7d).",
      inputSchema: {
        channel_id: z.string().min(1).describe('Parent channel ID (text or announcement).'),
        name: z.string().min(1).max(100).describe('Thread name (max 100 chars).'),
        message_id: z
          .string()
          .optional()
          .describe('When set, threads off this message instead of creating a standalone thread.'),
        type: z
          .enum(['public', 'private', 'announcement'])
          .optional()
          .describe(
            "Standalone-thread type. Defaults to 'public'. Ignored in message mode (inherits channel type).",
          ),
        auto_archive_minutes: z
          .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
          .optional()
          .describe('Auto-archive after N minutes of inactivity: 60, 1440, 4320, 10080.'),
        rate_limit_per_user: z
          .number()
          .int()
          .min(0)
          .max(21600)
          .optional()
          .describe('Slowmode in seconds (0-21600).'),
        invitable: z
          .boolean()
          .optional()
          .describe("Private threads only: when true, non-moderators can invite others."),
        reason: z.string().max(512).optional().describe('Audit log reason.'),
      },
      annotations: MUTATING,
    },
    async ({
      channel_id,
      name,
      message_id,
      type,
      auto_archive_minutes,
      rate_limit_per_user,
      invitable,
      reason,
    }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = { name };
        if (auto_archive_minutes !== undefined) body.auto_archive_duration = auto_archive_minutes;
        if (rate_limit_per_user !== undefined) body.rate_limit_per_user = rate_limit_per_user;
        if (!message_id) {
          body.type = FRIENDLY_TO_THREAD_TYPE[type ?? 'public'];
          if (invitable !== undefined) body.invitable = invitable;
        }
        const route = message_id
          ? Routes.threads(channel_id, message_id)
          : Routes.threads(channel_id);
        const thread = (await rest.post(route, { body, reason })) as APIChannel;
        invalidateGuildChannels();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, thread: formatChannel(thread) }, null, 2),
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
    'discord_list_active_threads',
    {
      description:
        "Lists all active (non-archived) threads in the active guild (GET /guilds/{id}/threads/active). Returns threads + the caller's membership entries for any joined threads. Active threads do NOT count against the channel pagination limits; archived threads do — use discord_list_archived_threads for those.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const guildId = getActiveGuildId();
        const resp = (await rest.get(Routes.guildActiveThreads(guildId))) as {
          threads: APIThreadChannel[];
          members: APIThreadMember[];
        };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: resp.threads.length,
                  threads: resp.threads.map(formatChannel),
                  joined_members: resp.members.map(formatThreadMember),
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
    'discord_list_archived_threads',
    {
      description:
        "Lists archived threads in a channel (GET /channels/{id}/threads/archived/{public|private}). Public archived = anyone can read; private archived = caller must have Manage Threads OR be a member. Results are paginated via the 'before' ISO8601 timestamp and 'limit' (max 100). has_more in the response indicates more pages.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Parent text/announcement channel.'),
        archived_type: z
          .enum(['public', 'private'])
          .describe("'public' lists public archived threads; 'private' lists private archived threads."),
        before: z
          .string()
          .optional()
          .describe('ISO8601 timestamp — return threads archived before this time (pagination cursor).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max results per page (1-100). Defaults to Discord server limit (~50).'),
      },
      annotations: READ_ONLY,
    },
    async ({ channel_id, archived_type, before, limit }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const query = new URLSearchParams();
        if (before) query.set('before', before);
        if (limit !== undefined) query.set('limit', String(limit));
        const resp = (await rest.get(Routes.channelThreads(channel_id, archived_type), {
          query,
        })) as {
          threads: APIThreadChannel[];
          members: APIThreadMember[];
          has_more: boolean;
        };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: resp.threads.length,
                  has_more: resp.has_more,
                  threads: resp.threads.map(formatChannel),
                  joined_members: resp.members.map(formatThreadMember),
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
    'discord_modify_thread',
    {
      description:
        "Modifies a thread (PATCH /channels/{thread_id}). Pass archived=true to archive (closes it) or archived=false + locked=false to unarchive an open one. locked=true prevents non-moderators from unarchiving. Renaming, slowmode, and auto-archive duration are also patched here. To delete instead, use discord_delete_thread.",
      inputSchema: {
        thread_id: z.string().min(1).describe('The thread to modify.'),
        name: z.string().min(1).max(100).optional(),
        archived: z
          .boolean()
          .optional()
          .describe('true = archive thread, false = unarchive.'),
        locked: z
          .boolean()
          .optional()
          .describe('When true, only Manage Threads users can unarchive.'),
        invitable: z
          .boolean()
          .optional()
          .describe('Private threads only: non-moderators can invite when true.'),
        auto_archive_minutes: z
          .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
          .optional(),
        rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({
      thread_id,
      name,
      archived,
      locked,
      invitable,
      auto_archive_minutes,
      rate_limit_per_user,
      reason,
    }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (archived !== undefined) body.archived = archived;
        if (locked !== undefined) body.locked = locked;
        if (invitable !== undefined) body.invitable = invitable;
        if (auto_archive_minutes !== undefined) body.auto_archive_duration = auto_archive_minutes;
        if (rate_limit_per_user !== undefined) body.rate_limit_per_user = rate_limit_per_user;
        const thread = (await rest.patch(Routes.channel(thread_id), { body, reason })) as APIChannel;
        invalidateGuildChannels();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, thread: formatChannel(thread) }, null, 2),
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
    'discord_delete_thread',
    {
      description:
        "Permanently deletes a thread (DELETE /channels/{thread_id}). Cannot be undone. Use discord_modify_thread with archived=true to archive instead — archiving is reversible. Requires Manage Threads or being the thread creator on a recent thread.",
      inputSchema: {
        thread_id: z.string().min(1).describe('The thread to delete.'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ thread_id, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const thread = (await rest.delete(Routes.channel(thread_id), { reason })) as APIChannel;
        invalidateGuildChannels();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted_thread: formatChannel(thread) }, null, 2),
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
    'discord_join_thread',
    {
      description:
        "Adds the bot itself to a thread (PUT /channels/{thread_id}/thread-members/@me). Required before the bot can send messages in private threads. For public threads, posting a message auto-joins. Returns 204 No Content on success.",
      inputSchema: {
        thread_id: z.string().min(1),
      },
      annotations: MUTATING,
    },
    async ({ thread_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        await getRest().put(Routes.threadMembers(thread_id, '@me'));
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, joined: { thread_id } }, null, 2),
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
    'discord_leave_thread',
    {
      description:
        "Removes the bot from a thread (DELETE /channels/{thread_id}/thread-members/@me). The bot stops receiving thread events but the thread remains. Returns 204 No Content.",
      inputSchema: {
        thread_id: z.string().min(1),
      },
      annotations: MUTATING,
    },
    async ({ thread_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        await getRest().delete(Routes.threadMembers(thread_id, '@me'));
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, left: { thread_id } }, null, 2),
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
    'discord_add_thread_member',
    {
      description:
        "Adds a user to a thread (PUT /channels/{thread_id}/thread-members/{user_id}). For private threads, the caller must have Manage Threads OR be the thread creator (with invitable=true). For public threads, anyone with view permission can be added. Returns 204 No Content.",
      inputSchema: {
        thread_id: z.string().min(1),
        user_id: z.string().min(1),
      },
      annotations: MUTATING,
    },
    async ({ thread_id, user_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        await getRest().put(Routes.threadMembers(thread_id, user_id));
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, added: { thread_id, user_id } }, null, 2),
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
    'discord_remove_thread_member',
    {
      description:
        "Removes a user from a thread (DELETE /channels/{thread_id}/thread-members/{user_id}). Requires Manage Threads OR being the thread creator on an invitable private thread. Returns 204 No Content.",
      inputSchema: {
        thread_id: z.string().min(1),
        user_id: z.string().min(1),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ thread_id, user_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        await getRest().delete(Routes.threadMembers(thread_id, user_id));
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, removed: { thread_id, user_id } }, null, 2),
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
    'discord_list_thread_members',
    {
      description:
        "Lists members of a thread (GET /channels/{thread_id}/thread-members). Requires the GUILD_MEMBERS privileged gateway intent for guild data, but REST returns minimal entries without it. Returns {user_id, join_timestamp, flags} per entry.",
      inputSchema: {
        thread_id: z.string().min(1),
      },
      annotations: READ_ONLY,
    },
    async ({ thread_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const members = (await getRest().get(Routes.threadMembers(thread_id))) as APIThreadMember[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { count: members.length, members: members.map(formatThreadMember) },
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
