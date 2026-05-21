import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  Routes,
} from 'discord-api-types/v10';
import type { APIGuildScheduledEvent } from 'discord-api-types/v10';
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

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

const ENTITY_TYPE_TO_NUM: Record<string, GuildScheduledEventEntityType> = {
  stage: GuildScheduledEventEntityType.StageInstance,
  voice: GuildScheduledEventEntityType.Voice,
  external: GuildScheduledEventEntityType.External,
};

const ENTITY_NUM_TO_NAME: Record<number, string> = {
  [GuildScheduledEventEntityType.StageInstance]: 'stage',
  [GuildScheduledEventEntityType.Voice]: 'voice',
  [GuildScheduledEventEntityType.External]: 'external',
};

const STATUS_TO_NUM: Record<string, GuildScheduledEventStatus> = {
  scheduled: GuildScheduledEventStatus.Scheduled,
  active: GuildScheduledEventStatus.Active,
  completed: GuildScheduledEventStatus.Completed,
  canceled: GuildScheduledEventStatus.Canceled,
};

const STATUS_NUM_TO_NAME: Record<number, string> = {
  [GuildScheduledEventStatus.Scheduled]: 'scheduled',
  [GuildScheduledEventStatus.Active]: 'active',
  [GuildScheduledEventStatus.Completed]: 'completed',
  [GuildScheduledEventStatus.Canceled]: 'canceled',
};

function formatEvent(e: APIGuildScheduledEvent): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    description: e.description ?? null,
    type: ENTITY_NUM_TO_NAME[e.entity_type] ?? `unknown(${e.entity_type})`,
    status: STATUS_NUM_TO_NAME[e.status] ?? `unknown(${e.status})`,
    channel_id: e.channel_id,
    location: e.entity_metadata?.location ?? null,
    scheduled_start_time: e.scheduled_start_time,
    scheduled_end_time: e.scheduled_end_time,
    user_count: e.user_count ?? 0,
    creator_id: e.creator_id ?? null,
  };
}

const TYPE_ENUM = z.enum(['stage', 'voice', 'external']);
const STATUS_ENUM = z.enum(['scheduled', 'active', 'completed', 'canceled']);

export function registerScheduledEventTools(server: McpServer): void {
  server.registerTool(
    'discord_list_scheduled_events',
    {
      description:
        "Lists scheduled events in the active guild (GET /guilds/{id}/scheduled-events). Returns name, type (stage/voice/external), status (scheduled/active/completed/canceled), channel_id (null for external), location (external only), start/end times, and user_count of subscribed members.",
      inputSchema: {
        with_user_count: z
          .boolean()
          .optional()
          .describe('Include user_count in response (defaults to true).'),
      },
      annotations: READ_ONLY,
    },
    async ({ with_user_count }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const wantCount = with_user_count !== false;
        const events = (await rest.get(Routes.guildScheduledEvents(getActiveGuildId()), {
          query: new URLSearchParams({ with_user_count: String(wantCount) }),
        })) as APIGuildScheduledEvent[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { count: events.length, events: events.map(formatEvent) },
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
    'discord_create_scheduled_event',
    {
      description:
        "Creates a scheduled event (POST /guilds/{id}/scheduled-events). type='stage' or 'voice' requires channel_id (must be a stage/voice channel). type='external' requires location AND scheduled_end_time (channel_id must NOT be set). All events use GUILD_ONLY privacy. Times are ISO8601 strings; scheduled_start_time must be in the future.",
      inputSchema: {
        name: z.string().min(1).max(100).describe('Event title (max 100 chars).'),
        type: TYPE_ENUM.describe(
          "Where the event happens. 'stage'=stage channel, 'voice'=voice channel, 'external'=outside Discord (Twitch, IRL, etc.).",
        ),
        scheduled_start_time: z
          .string()
          .describe('ISO8601 timestamp. Must be in the future.'),
        scheduled_end_time: z
          .string()
          .optional()
          .describe('ISO8601 timestamp. Required for type=external; optional for stage/voice.'),
        channel_id: z
          .string()
          .optional()
          .describe('Required for type=stage/voice. Must be the appropriate channel kind.'),
        location: z
          .string()
          .max(100)
          .optional()
          .describe(
            "Required for type=external. Free-text venue (e.g., 'Twitch.tv/foo', 'Convention Center, Hall A'). Max 100 chars.",
          ),
        description: z
          .string()
          .max(1000)
          .optional()
          .describe('Long-form event description (max 1000 chars).'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({
      name,
      type,
      scheduled_start_time,
      scheduled_end_time,
      channel_id,
      location,
      description,
      reason,
    }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {
          name,
          entity_type: ENTITY_TYPE_TO_NUM[type],
          scheduled_start_time,
          privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
        };
        if (description !== undefined) body.description = description;
        if (scheduled_end_time !== undefined) body.scheduled_end_time = scheduled_end_time;
        if (type === 'external') {
          if (!location) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: "type='external' requires the 'location' field (where the event happens).",
                },
              ],
            };
          }
          if (!scheduled_end_time) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: "type='external' requires 'scheduled_end_time' (Discord cannot infer end time without a channel).",
                },
              ],
            };
          }
          body.entity_metadata = { location };
        } else {
          if (!channel_id) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `type='${type}' requires 'channel_id' (the ${type} channel hosting the event).`,
                },
              ],
            };
          }
          body.channel_id = channel_id;
        }
        const event = (await rest.post(Routes.guildScheduledEvents(getActiveGuildId()), {
          body,
          reason,
        })) as APIGuildScheduledEvent;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, event: formatEvent(event) }, null, 2) },
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
    'discord_modify_scheduled_event',
    {
      description:
        "Modifies a scheduled event (PATCH /guilds/{id}/scheduled-events/{event_id}). Pass only fields to change. Use status to start ('active') or cancel ('canceled') an event — Discord enforces valid transitions: scheduled→active, scheduled→canceled, active→completed. To change type to/from 'external', also update location/channel_id appropriately.",
      inputSchema: {
        event_id: z.string().min(1).describe('The scheduled event to modify.'),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(1000).nullable().optional(),
        type: TYPE_ENUM.optional(),
        channel_id: z.string().nullable().optional(),
        location: z.string().max(100).optional(),
        scheduled_start_time: z.string().optional(),
        scheduled_end_time: z.string().nullable().optional(),
        status: STATUS_ENUM
          .optional()
          .describe(
            "Transition the event. 'active'=start, 'canceled'=cancel, 'completed'=mark finished.",
          ),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({
      event_id,
      name,
      description,
      type,
      channel_id,
      location,
      scheduled_start_time,
      scheduled_end_time,
      status,
      reason,
    }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (type !== undefined) body.entity_type = ENTITY_TYPE_TO_NUM[type];
        if (channel_id !== undefined) body.channel_id = channel_id;
        if (location !== undefined) body.entity_metadata = { location };
        if (scheduled_start_time !== undefined) body.scheduled_start_time = scheduled_start_time;
        if (scheduled_end_time !== undefined) body.scheduled_end_time = scheduled_end_time;
        if (status !== undefined) body.status = STATUS_TO_NUM[status];
        const event = (await rest.patch(Routes.guildScheduledEvent(getActiveGuildId(), event_id), {
          body,
          reason,
        })) as APIGuildScheduledEvent;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, event: formatEvent(event) }, null, 2) },
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
    'discord_delete_scheduled_event',
    {
      description:
        "Permanently deletes a scheduled event (DELETE /guilds/{id}/scheduled-events/{event_id}). For events that haven't started, prefer setting status='canceled' via discord_modify_scheduled_event so subscribers get notified — delete removes it without notification.",
      inputSchema: {
        event_id: z.string().min(1).describe('The event to delete.'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ event_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.delete(Routes.guildScheduledEvent(getActiveGuildId(), event_id), { reason });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, deleted_event_id: event_id }, null, 2) },
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
