import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIGuildMember } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { getActiveGuildId, loadState } from '../state.js';
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

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

function formatMember(m: APIGuildMember): Record<string, unknown> {
  return {
    user: m.user
      ? {
          id: m.user.id,
          username: m.user.username,
          global_name: m.user.global_name ?? null,
          bot: m.user.bot ?? false,
        }
      : null,
    nick: m.nick ?? null,
    roles: m.roles,
    joined_at: m.joined_at,
    premium_since: m.premium_since ?? null,
    deaf: m.deaf,
    mute: m.mute,
    pending: m.pending ?? false,
    communication_disabled_until: m.communication_disabled_until ?? null,
  };
}

export function registerMemberTools(server: McpServer): void {
  server.registerTool(
    'discord_list_members',
    {
      description:
        "Lists members in the active guild (GET /guilds/{id}/members). REQUIRES the Server Members privileged intent enabled in the Discord Developer Portal under Bot → Privileged Gateway Intents — without it Discord returns 403. Pagination uses an 'after' cursor (pass the highest user.id from the previous page). limit defaults to 1, max 1000.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Members per page (1-1000). Default 1.'),
        after: z
          .string()
          .optional()
          .describe('Pagination cursor — pass the highest member.user.id from the previous page.'),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, after }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const params: Record<string, string> = {};
        if (limit !== undefined) params.limit = String(limit);
        if (after !== undefined) params.after = after;
        const members = (await rest.get(Routes.guildMembers(getActiveGuildId()), {
          query: new URLSearchParams(params),
        })) as APIGuildMember[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { count: members.length, members: members.map(formatMember) },
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
    'discord_get_member',
    {
      description:
        "Returns a single guild member (GET /guilds/{id}/members/{user_id}). Does NOT require the Server Members privileged intent — useful when you already have a user_id and just need their nick, roles, join date, or active timeout.",
      inputSchema: {
        user_id: z.string().min(1).describe('The user to fetch.'),
      },
      annotations: READ_ONLY,
    },
    async ({ user_id }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const m = (await rest.get(
          Routes.guildMember(getActiveGuildId(), user_id),
        )) as APIGuildMember;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(formatMember(m), null, 2) }],
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
    'discord_modify_member',
    {
      description:
        "Modifies a guild member (PATCH /guilds/{id}/members/{user_id}). Pass only fields to change. Setting roles REPLACES the entire role set — for incremental edits use discord_assign_role / discord_remove_role. timeout_until is ISO8601 (max 28 days from now); pass null to lift an active timeout. mute/deaf/channel_id only affect members currently in voice. Self-nick edits (user_id == bot's own id, nick is the only field) are auto-routed to PATCH /members/@me, which only requires Change Nickname instead of Manage Nicknames.",
      inputSchema: {
        user_id: z.string().min(1).describe('The user to modify.'),
        nick: z
          .string()
          .max(32)
          .nullable()
          .optional()
          .describe('Server nickname (max 32 chars). Pass null to clear. Manage Nicknames perm required for editing other members; Change Nickname is enough when editing the bot itself (auto-routed to @me).'),
        roles: z
          .array(z.string())
          .optional()
          .describe(
            'REPLACES the entire role set. Requires Manage Roles. Use discord_assign_role / discord_remove_role for incremental edits.',
          ),
        mute: z
          .boolean()
          .optional()
          .describe('Server-mute in voice (member must currently be in a voice channel).'),
        deaf: z
          .boolean()
          .optional()
          .describe('Server-deafen in voice (member must currently be in a voice channel).'),
        channel_id: z
          .string()
          .nullable()
          .optional()
          .describe('Move the member to this voice channel. Pass null to disconnect them from voice.'),
        timeout_until: z
          .string()
          .nullable()
          .optional()
          .describe(
            'ISO8601 timestamp when the timeout expires (max 28 days from now). Pass null to lift an active timeout. Requires Moderate Members perm.',
          ),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ user_id, nick, roles, mute, deaf, channel_id, timeout_until, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (nick !== undefined) body.nick = nick;
        if (roles !== undefined) body.roles = roles;
        if (mute !== undefined) body.mute = mute;
        if (deaf !== undefined) body.deaf = deaf;
        if (channel_id !== undefined) body.channel_id = channel_id;
        if (timeout_until !== undefined) body.communication_disabled_until = timeout_until;
        const botUserId = loadState().bot_user_id;
        const isSelfNickOnly =
          botUserId !== undefined &&
          user_id === botUserId &&
          Object.keys(body).length === 1 &&
          'nick' in body;
        const route = isSelfNickOnly
          ? Routes.guildMember(getActiveGuildId(), '@me')
          : Routes.guildMember(getActiveGuildId(), user_id);
        const m = (await rest.patch(route, {
          body,
          reason,
        })) as APIGuildMember;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, member: formatMember(m) }, null, 2) },
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
    'discord_kick_member',
    {
      description:
        "Removes a member from the guild (DELETE /guilds/{id}/members/{user_id}). The user can rejoin via any active invite — for permanent removal use discord_ban_member. Requires Kick Members perm. Returns 204 No Content.",
      inputSchema: {
        user_id: z.string().min(1).describe('The user to kick.'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ user_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.delete(Routes.guildMember(getActiveGuildId(), user_id), { reason });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, kicked_user_id: user_id }, null, 2) },
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
    'discord_ban_member',
    {
      description:
        "Bans a user from the guild (PUT /guilds/{id}/bans/{user_id}). The user is removed and CANNOT rejoin via any invite until unbanned. Optionally bulk-deletes their recent messages with delete_message_seconds (0-604800; max 7 days). Works even when the user isn't in the guild (preemptive ban). Requires Ban Members perm.",
      inputSchema: {
        user_id: z.string().min(1).describe('The user to ban.'),
        delete_message_seconds: z
          .number()
          .int()
          .min(0)
          .max(604800)
          .optional()
          .describe(
            'Seconds of message history to wipe (0-604800 = 7 days). Default 0 (keep all messages).',
          ),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ user_id, delete_message_seconds, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (delete_message_seconds !== undefined)
          body.delete_message_seconds = delete_message_seconds;
        await rest.put(Routes.guildBan(getActiveGuildId(), user_id), { body, reason });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, banned_user_id: user_id }, null, 2) },
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
    'discord_unban_member',
    {
      description:
        "Removes a ban (DELETE /guilds/{id}/bans/{user_id}). The user can then rejoin via any active invite. Requires Ban Members perm. Returns 204 No Content.",
      inputSchema: {
        user_id: z.string().min(1).describe('The banned user to unban.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ user_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.delete(Routes.guildBan(getActiveGuildId(), user_id), { reason });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, unbanned_user_id: user_id }, null, 2) },
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
