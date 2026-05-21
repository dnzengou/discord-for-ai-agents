import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIChannel, APIGuild, APIRole } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { getActiveGuildId } from '../state.js';
import { activeGuildGuard, tokenGuard } from '../guards.js';
import { patchState } from '../state.js';

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

const VERIFICATION_LEVEL = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
} as const;

const EXPLICIT_CONTENT_FILTER = {
  disabled: 0,
  members_without_roles: 1,
  all_members: 2,
} as const;

const DEFAULT_NOTIFICATIONS = {
  all_messages: 0,
  only_mentions: 1,
} as const;

function formatGuild(g: APIGuild): Record<string, unknown> {
  return {
    id: g.id,
    name: g.name,
    description: g.description ?? null,
    owner_id: g.owner_id,
    icon: g.icon ?? null,
    banner: g.banner ?? null,
    features: g.features,
    verification_level: g.verification_level,
    explicit_content_filter: g.explicit_content_filter,
    default_message_notifications: g.default_message_notifications,
    system_channel_id: g.system_channel_id ?? null,
    system_channel_flags: g.system_channel_flags,
    rules_channel_id: g.rules_channel_id ?? null,
    public_updates_channel_id: g.public_updates_channel_id ?? null,
    afk_channel_id: g.afk_channel_id ?? null,
    afk_timeout: g.afk_timeout,
    preferred_locale: g.preferred_locale,
    premium_tier: g.premium_tier,
    premium_subscription_count: g.premium_subscription_count ?? 0,
    member_count: (g as APIGuild & { approximate_member_count?: number }).approximate_member_count ?? null,
  };
}

export function registerGuildTools(server: McpServer): void {
  server.registerTool(
    'discord_get_guild',
    {
      description:
        "Returns the active guild's full settings (GET /guilds/{id}?with_counts=true). Includes name, description, owner, icon/banner, verification/content filter levels, system/rules/AFK channel IDs, features (e.g. COMMUNITY enables welcome screen + onboarding), premium tier, and approximate member count.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const guild = (await rest.get(Routes.guild(getActiveGuildId()), {
          query: new URLSearchParams({ with_counts: 'true' }),
        })) as APIGuild;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(formatGuild(guild), null, 2) },
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
    'discord_modify_guild_settings',
    {
      description:
        "Modifies the active guild's settings (PATCH /guilds/{id}). Pass only fields to change. Set channels by ID (use discord_list_channels). To remove an optional channel (system/rules/AFK), pass null. system_channel_flags is a bitfield (1=suppress join notifications, 2=suppress boost notifications, 4=suppress setup tips, 8=suppress sticker join button, 16=suppress role subscription purchase notifications, 32=suppress role subscription replies). On success, refreshes the cached guild name in plugin state.",
      inputSchema: {
        name: z.string().min(2).max(100).optional().describe('Guild display name (2-100 chars).'),
        description: z
          .string()
          .max(300)
          .nullable()
          .optional()
          .describe('Server description (Community servers, max 300 chars). Null to clear.'),
        verification_level: z
          .enum(['none', 'low', 'medium', 'high', 'very_high'])
          .optional()
          .describe(
            "Verification gate for new members. low=verified email, medium=registered >5min, high=member >10min, very_high=verified phone.",
          ),
        explicit_content_filter: z
          .enum(['disabled', 'members_without_roles', 'all_members'])
          .optional()
          .describe('Discord scans uploaded media; disabled=off, members_without_roles=scan unroled members only, all_members=scan everyone.'),
        default_message_notifications: z
          .enum(['all_messages', 'only_mentions'])
          .optional()
          .describe('Default notification setting for new members.'),
        system_channel_id: z
          .string()
          .nullable()
          .optional()
          .describe('Channel for join messages, boost messages, etc. Null to disable system messages entirely.'),
        system_channel_flags: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Bitfield (see tool description for individual flag values).'),
        rules_channel_id: z
          .string()
          .nullable()
          .optional()
          .describe('Required Community feature. Channel that holds the server rules.'),
        public_updates_channel_id: z
          .string()
          .nullable()
          .optional()
          .describe('Required Community feature. Channel where Discord posts admin updates.'),
        afk_channel_id: z
          .string()
          .nullable()
          .optional()
          .describe('Voice channel idle members get moved into. Null to disable.'),
        afk_timeout: z
          .number()
          .int()
          .optional()
          .describe('Seconds before idle voice users get moved to the AFK channel. Allowed: 60, 300, 900, 1800, 3600.'),
        preferred_locale: z
          .string()
          .optional()
          .describe("Locale code for Community announcements (e.g., 'en-US', 'ja')."),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({
      name,
      description,
      verification_level,
      explicit_content_filter,
      default_message_notifications,
      system_channel_id,
      system_channel_flags,
      rules_channel_id,
      public_updates_channel_id,
      afk_channel_id,
      afk_timeout,
      preferred_locale,
      reason,
    }) => {
      const guard = tokenGuard() ?? activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (verification_level !== undefined) body.verification_level = VERIFICATION_LEVEL[verification_level];
        if (explicit_content_filter !== undefined)
          body.explicit_content_filter = EXPLICIT_CONTENT_FILTER[explicit_content_filter];
        if (default_message_notifications !== undefined)
          body.default_message_notifications = DEFAULT_NOTIFICATIONS[default_message_notifications];
        if (system_channel_id !== undefined) body.system_channel_id = system_channel_id;
        if (system_channel_flags !== undefined) body.system_channel_flags = system_channel_flags;
        if (rules_channel_id !== undefined) body.rules_channel_id = rules_channel_id;
        if (public_updates_channel_id !== undefined) body.public_updates_channel_id = public_updates_channel_id;
        if (afk_channel_id !== undefined) body.afk_channel_id = afk_channel_id;
        if (afk_timeout !== undefined) body.afk_timeout = afk_timeout;
        if (preferred_locale !== undefined) body.preferred_locale = preferred_locale;
        const guild = (await rest.patch(Routes.guild(getActiveGuildId()), { body, reason })) as APIGuild;
        if (name !== undefined) {
          patchState({ active_guild_name: guild.name });
        }
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, guild: formatGuild(guild) }, null, 2) },
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
    'discord_server_snapshot',
    {
      description:
        "Returns guild info, all channels, and all roles in a single parallel fetch — faster than calling discord_get_guild + discord_list_channels + discord_list_roles separately. Ideal for the architect agent or any flow that needs full context before making decisions. Channels include type, position, and parent_id. Roles include name, color, permissions decoded as snake_case names.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      const guildId = getActiveGuildId();
      const rest = getRest();
      const [guildResult, channelsResult, rolesResult] = await Promise.allSettled([
        rest.get(Routes.guild(guildId), { query: new URLSearchParams({ with_counts: 'true' }) }) as Promise<APIGuild>,
        rest.get(Routes.guildChannels(guildId)) as Promise<APIChannel[]>,
        rest.get(Routes.guildRoles(guildId)) as Promise<APIRole[]>,
      ]);

      const out: Record<string, unknown> = { guild_id: guildId };

      if (guildResult.status === 'fulfilled') {
        const g = guildResult.value;
        out.guild = formatGuild(g);
      } else {
        out.guild_error = formatDiscordError(guildResult.reason);
      }

      if (channelsResult.status === 'fulfilled') {
        const CHANNEL_TYPE_FRIENDLY: Record<number, string> = {
          0: 'text', 1: 'dm', 2: 'voice', 3: 'group_dm', 4: 'category',
          5: 'announcement', 10: 'announcement_thread', 11: 'public_thread',
          12: 'private_thread', 13: 'stage', 14: 'directory', 15: 'forum', 16: 'media',
        };
        out.channels = channelsResult.value.map((c) => {
          const a = c as unknown as Record<string, unknown>;
          return {
            id: a.id, name: a.name ?? null,
            type: CHANNEL_TYPE_FRIENDLY[c.type] ?? `unknown(${c.type})`,
            parent_id: a.parent_id ?? null, position: a.position ?? null,
            topic: a.topic ?? null,
          };
        });
        out.channel_count = channelsResult.value.length;
      } else {
        out.channels_error = formatDiscordError(channelsResult.reason);
      }

      if (rolesResult.status === 'fulfilled') {
        const PERM_BIT_TO_SNAKE: Array<[bigint, string]> = [];
        const { PermissionFlagsBits } = await import('discord-api-types/v10');
        const seen = new Set<bigint>();
        for (const [pascal, bit] of Object.entries(PermissionFlagsBits)) {
          const b = bit as bigint;
          if (!seen.has(b)) {
            seen.add(b);
            PERM_BIT_TO_SNAKE.push([b, pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()]);
          }
        }
        out.roles = rolesResult.value.map((r) => {
          const bits = BigInt(r.permissions);
          const perm_names = PERM_BIT_TO_SNAKE.filter(([bit]) => (bits & bit) === bit).map(([, name]) => name);
          return {
            id: r.id, name: r.name,
            color: r.color ? '#' + r.color.toString(16).padStart(6, '0').toUpperCase() : null,
            hoist: r.hoist, position: r.position, mentionable: r.mentionable,
            managed: r.managed, perm_names,
          };
        });
        out.role_count = rolesResult.value.length;
      } else {
        out.roles_error = formatDiscordError(rolesResult.reason);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }],
      };
    },
  );
}
