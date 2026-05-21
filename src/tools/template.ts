import { z } from 'zod';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
  Routes,
} from 'discord-api-types/v10';
import type {
  APIAutoModerationRule,
  APIChannel,
  APIGuildScheduledEvent,
  APIRole,
} from 'discord-api-types/v10';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
const TEMPLATES_DIR = resolve(PLUGIN_ROOT, 'templates');

const PERMISSION_NAME_TO_BIT: Record<string, bigint> = {};
for (const [pascal, bit] of Object.entries(PermissionFlagsBits)) {
  const snake = pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  PERMISSION_NAME_TO_BIT[pascal] = bit as bigint;
  PERMISSION_NAME_TO_BIT[snake] = bit as bigint;
}

function permsNamesToString(names: string[]): string {
  let bits = 0n;
  const unknown: string[] = [];
  for (const n of names) {
    const bit = PERMISSION_NAME_TO_BIT[n] ?? PERMISSION_NAME_TO_BIT[n.toLowerCase()];
    if (bit === undefined) unknown.push(n);
    else bits |= bit;
  }
  if (unknown.length) {
    throw new Error(
      `Unknown permission(s): ${unknown.join(', ')}. Use snake_case names like kick_members, ban_members, manage_messages.`,
    );
  }
  return bits.toString();
}

function colorToInt(input: string | number | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') return input;
  const s = input.startsWith('#') ? input.slice(1) : input;
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? undefined : n;
}

const FRIENDLY_TO_CHANNEL_TYPE = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia,
} as const;

type FriendlyChannelType = keyof typeof FRIENDLY_TO_CHANNEL_TYPE;

const TRIGGER_TYPE_TO_NUM: Record<string, AutoModerationRuleTriggerType> = {
  keyword: AutoModerationRuleTriggerType.Keyword,
  spam: AutoModerationRuleTriggerType.Spam,
  keyword_preset: AutoModerationRuleTriggerType.KeywordPreset,
  mention_spam: AutoModerationRuleTriggerType.MentionSpam,
  member_profile: AutoModerationRuleTriggerType.MemberProfile,
};

const EVENT_TYPE_TO_NUM: Record<string, AutoModerationRuleEventType> = {
  message_send: AutoModerationRuleEventType.MessageSend,
  member_update: AutoModerationRuleEventType.MemberUpdate,
};

const PRESET_TO_NUM: Record<string, AutoModerationRuleKeywordPresetType> = {
  profanity: AutoModerationRuleKeywordPresetType.Profanity,
  sexual_content: AutoModerationRuleKeywordPresetType.SexualContent,
  slurs: AutoModerationRuleKeywordPresetType.Slurs,
};

const ENTITY_TYPE_TO_NUM: Record<string, GuildScheduledEventEntityType> = {
  stage: GuildScheduledEventEntityType.StageInstance,
  voice: GuildScheduledEventEntityType.Voice,
  external: GuildScheduledEventEntityType.External,
};

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

const guildSpecSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  verification_level: z.enum(['none', 'low', 'medium', 'high', 'very_high']).optional(),
  explicit_content_filter: z.enum(['disabled', 'members_without_roles', 'all_members']).optional(),
  default_message_notifications: z.enum(['all_messages', 'only_mentions']).optional(),
  afk_timeout: z.number().int().optional(),
  preferred_locale: z.string().optional(),
});

const roleSpecSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.union([z.string(), z.number().int()]).optional(),
  permissions: z.array(z.string()).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
});

const categorySpecSchema = z.object({
  name: z.string().min(1).max(100),
});

const channelSpecSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['text', 'voice', 'announcement', 'stage', 'forum', 'media']).optional(),
  category: z.string().optional(),
  topic: z.string().max(1024).optional(),
  nsfw: z.boolean().optional(),
  rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
  bitrate: z.number().int().min(8000).max(384000).optional(),
  user_limit: z.number().int().min(0).max(99).optional(),
});

const welcomeChannelSpecSchema = z.object({
  channel: z.string().min(1),
  description: z.string().min(1).max(50),
  emoji_name: z.string().optional(),
  emoji_id: z.string().optional(),
});

const welcomeScreenSpecSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().max(140).optional(),
  channels: z.array(welcomeChannelSpecSchema).max(5).optional(),
});

const automodRuleSpecSchema = z.object({
  name: z.string().min(1).max(100),
  trigger: z.enum(['keyword', 'spam', 'keyword_preset', 'mention_spam', 'member_profile']),
  event_type: z.enum(['message_send', 'member_update']).optional(),
  keyword_filter: z.array(z.string().max(60)).max(1000).optional(),
  regex_patterns: z.array(z.string().max(260)).max(10).optional(),
  presets: z.array(z.enum(['profanity', 'sexual_content', 'slurs'])).optional(),
  allow_list: z.array(z.string().max(60)).max(1000).optional(),
  mention_total_limit: z.number().int().min(0).max(50).optional(),
  mention_raid_protection_enabled: z.boolean().optional(),
  block_message: z.union([z.boolean(), z.string().max(150)]).optional(),
  alert_channel: z.string().optional(),
  timeout_seconds: z.number().int().min(0).max(2419200).optional(),
  block_member_interaction: z.boolean().optional(),
  enabled: z.boolean().optional(),
  exempt_roles: z.array(z.string()).max(20).optional(),
  exempt_channels: z.array(z.string()).max(50).optional(),
});

const scheduledEventSpecSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['stage', 'voice', 'external']),
  channel: z.string().optional(),
  location: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  scheduled_start_time: z.string(),
  scheduled_end_time: z.string().optional(),
});

const templateSpecSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  guild: guildSpecSchema.optional(),
  roles: z.array(roleSpecSchema).max(50).optional(),
  categories: z.array(categorySpecSchema).max(50).optional(),
  channels: z.array(channelSpecSchema).max(500).optional(),
  welcome_screen: welcomeScreenSpecSchema.optional(),
  automod_rules: z.array(automodRuleSpecSchema).max(20).optional(),
  scheduled_events: z.array(scheduledEventSpecSchema).max(20).optional(),
});

type TemplateSpec = z.infer<typeof templateSpecSchema>;

interface Outcome {
  status: 'created' | 'skipped_exists' | 'failed';
  name: string;
  detail?: string;
}

interface ApplySummary {
  guild_settings: { applied: boolean; error: string | null };
  roles: Outcome[];
  categories: Outcome[];
  channels: Outcome[];
  welcome_screen: { applied: boolean; error: string | null; warning: string | null };
  automod_rules: Outcome[];
  scheduled_events: Outcome[];
}

function emptySummary(): ApplySummary {
  return {
    guild_settings: { applied: false, error: null },
    roles: [],
    categories: [],
    channels: [],
    welcome_screen: { applied: false, error: null, warning: null },
    automod_rules: [],
    scheduled_events: [],
  };
}

function listBundledTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function errorResult(text: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text }],
  };
}

function previewSpec(spec: TemplateSpec) {
  return {
    name: spec.name ?? null,
    description: spec.description ?? null,
    guild_settings: spec.guild ?? null,
    roles: (spec.roles ?? []).map((r) => r.name),
    categories: (spec.categories ?? []).map((c) => c.name),
    channels: (spec.channels ?? []).map(
      (c) => `${c.name} (${c.type ?? 'text'}${c.category ? ` in ${c.category}` : ''})`,
    ),
    welcome_screen: spec.welcome_screen
      ? {
          enabled: spec.welcome_screen.enabled ?? null,
          description: spec.welcome_screen.description ?? null,
          channels: (spec.welcome_screen.channels ?? []).map((w) => w.channel),
        }
      : null,
    automod_rules: (spec.automod_rules ?? []).map((r) => `${r.name} (${r.trigger})`),
    scheduled_events: (spec.scheduled_events ?? []).map(
      (e) => `${e.name} (${e.type} @ ${e.scheduled_start_time})`,
    ),
  };
}

async function applyTemplate(
  spec: TemplateSpec,
  reason: string | undefined,
): Promise<ApplySummary> {
  const summary = emptySummary();
  const rest = getRest();
  const guildId = getActiveGuildId();

  if (spec.guild) {
    const body: Record<string, unknown> = {};
    if (spec.guild.name !== undefined) body.name = spec.guild.name;
    if (spec.guild.description !== undefined) body.description = spec.guild.description;
    if (spec.guild.verification_level !== undefined)
      body.verification_level = VERIFICATION_LEVEL[spec.guild.verification_level];
    if (spec.guild.explicit_content_filter !== undefined)
      body.explicit_content_filter = EXPLICIT_CONTENT_FILTER[spec.guild.explicit_content_filter];
    if (spec.guild.default_message_notifications !== undefined)
      body.default_message_notifications =
        DEFAULT_NOTIFICATIONS[spec.guild.default_message_notifications];
    if (spec.guild.afk_timeout !== undefined) body.afk_timeout = spec.guild.afk_timeout;
    if (spec.guild.preferred_locale !== undefined)
      body.preferred_locale = spec.guild.preferred_locale;
    if (Object.keys(body).length) {
      try {
        await rest.patch(Routes.guild(guildId), { body, reason });
        summary.guild_settings.applied = true;
      } catch (err) {
        summary.guild_settings.error = formatDiscordError(err);
      }
    }
  }

  const roleByName = new Map<string, APIRole>();
  const needRoles =
    !!spec.roles?.length ||
    !!spec.automod_rules?.some((r) => r.exempt_roles && r.exempt_roles.length);
  if (needRoles) {
    try {
      const existing = (await rest.get(Routes.guildRoles(guildId))) as APIRole[];
      for (const r of existing) roleByName.set(r.name.toLowerCase(), r);
    } catch (err) {
      const detail = `failed to list roles: ${formatDiscordError(err)}`;
      for (const r of spec.roles ?? []) {
        summary.roles.push({ status: 'failed', name: r.name, detail });
      }
    }
  }
  if (spec.roles?.length && (roleByName.size > 0 || !needRoles)) {
    for (const role of spec.roles) {
      const key = role.name.toLowerCase();
      if (key === '@everyone') {
        summary.roles.push({
          status: 'skipped_exists',
          name: role.name,
          detail: 'cannot create @everyone — modify it directly via discord_modify_role',
        });
        continue;
      }
      if (roleByName.has(key)) {
        summary.roles.push({ status: 'skipped_exists', name: role.name });
        continue;
      }
      try {
        const body: Record<string, unknown> = { name: role.name };
        if (role.permissions) body.permissions = permsNamesToString(role.permissions);
        const ci = colorToInt(role.color);
        if (ci !== undefined) body.color = ci;
        if (role.hoist !== undefined) body.hoist = role.hoist;
        if (role.mentionable !== undefined) body.mentionable = role.mentionable;
        const created = (await rest.post(Routes.guildRoles(guildId), { body, reason })) as APIRole;
        roleByName.set(key, created);
        summary.roles.push({ status: 'created', name: role.name });
      } catch (err) {
        summary.roles.push({
          status: 'failed',
          name: role.name,
          detail: formatDiscordError(err),
        });
      }
    }
  }

  const categoryByName = new Map<string, APIChannel>();
  const channelByName = new Map<string, APIChannel>();
  const needChannels =
    !!spec.categories?.length ||
    !!spec.channels?.length ||
    !!spec.welcome_screen?.channels?.length ||
    !!spec.scheduled_events?.length ||
    !!spec.automod_rules?.some(
      (r) => (r.exempt_channels && r.exempt_channels.length) || r.alert_channel,
    );
  if (needChannels) {
    try {
      const existing = (await rest.get(Routes.guildChannels(guildId))) as APIChannel[];
      for (const c of existing) {
        const ac = c as APIChannel & { name?: string | null };
        if (!ac.name) continue;
        const key = ac.name.toLowerCase();
        if (c.type === ChannelType.GuildCategory) categoryByName.set(key, c);
        else channelByName.set(key, c);
      }
    } catch (err) {
      const detail = `failed to list channels: ${formatDiscordError(err)}`;
      for (const c of spec.categories ?? [])
        summary.categories.push({ status: 'failed', name: c.name, detail });
      for (const c of spec.channels ?? [])
        summary.channels.push({ status: 'failed', name: c.name, detail });
    }
  }

  if (spec.categories?.length) {
    for (const cat of spec.categories) {
      const key = cat.name.toLowerCase();
      if (categoryByName.has(key)) {
        summary.categories.push({ status: 'skipped_exists', name: cat.name });
        continue;
      }
      try {
        const created = (await rest.post(Routes.guildChannels(guildId), {
          body: { name: cat.name, type: ChannelType.GuildCategory },
          reason,
        })) as APIChannel;
        categoryByName.set(key, created);
        summary.categories.push({ status: 'created', name: cat.name });
      } catch (err) {
        summary.categories.push({
          status: 'failed',
          name: cat.name,
          detail: formatDiscordError(err),
        });
      }
    }
  }

  if (spec.channels?.length) {
    for (const ch of spec.channels) {
      const key = ch.name.toLowerCase();
      if (channelByName.has(key)) {
        summary.channels.push({ status: 'skipped_exists', name: ch.name });
        continue;
      }
      const friendly = (ch.type ?? 'text') as FriendlyChannelType;
      try {
        const body: Record<string, unknown> = {
          name: ch.name,
          type: FRIENDLY_TO_CHANNEL_TYPE[friendly],
        };
        if (ch.category) {
          const cat = categoryByName.get(ch.category.toLowerCase());
          if (!cat) {
            summary.channels.push({
              status: 'failed',
              name: ch.name,
              detail: `category '${ch.category}' not found (declare it in categories[] or create it first)`,
            });
            continue;
          }
          body.parent_id = cat.id;
        }
        if (ch.topic !== undefined) body.topic = ch.topic;
        if (ch.nsfw !== undefined) body.nsfw = ch.nsfw;
        if (ch.rate_limit_per_user !== undefined) body.rate_limit_per_user = ch.rate_limit_per_user;
        if (ch.bitrate !== undefined) body.bitrate = ch.bitrate;
        if (ch.user_limit !== undefined) body.user_limit = ch.user_limit;
        const created = (await rest.post(Routes.guildChannels(guildId), {
          body,
          reason,
        })) as APIChannel;
        channelByName.set(key, created);
        summary.channels.push({ status: 'created', name: ch.name });
      } catch (err) {
        summary.channels.push({
          status: 'failed',
          name: ch.name,
          detail: formatDiscordError(err),
        });
      }
    }
  }

  if (spec.welcome_screen) {
    try {
      const body: Record<string, unknown> = {};
      if (spec.welcome_screen.enabled !== undefined) body.enabled = spec.welcome_screen.enabled;
      if (spec.welcome_screen.description !== undefined)
        body.description = spec.welcome_screen.description;
      if (spec.welcome_screen.channels !== undefined) {
        const wc: Record<string, unknown>[] = [];
        const missing: string[] = [];
        for (const w of spec.welcome_screen.channels) {
          const ch = channelByName.get(w.channel.toLowerCase());
          if (!ch) {
            missing.push(w.channel);
            continue;
          }
          const entry: Record<string, unknown> = {
            channel_id: ch.id,
            description: w.description,
          };
          if (w.emoji_name !== undefined) entry.emoji_name = w.emoji_name;
          if (w.emoji_id !== undefined) entry.emoji_id = w.emoji_id;
          wc.push(entry);
        }
        if (missing.length) {
          summary.welcome_screen.warning = `welcome channel(s) not found, skipped: ${missing.join(', ')}`;
        }
        body.welcome_channels = wc;
      }
      if (Object.keys(body).length) {
        await rest.patch(Routes.guildWelcomeScreen(guildId), { body, reason });
        summary.welcome_screen.applied = true;
      }
    } catch (err) {
      summary.welcome_screen.error = formatDiscordError(err);
    }
  }

  if (spec.automod_rules?.length) {
    let existing: APIAutoModerationRule[] = [];
    try {
      existing = (await rest.get(
        Routes.guildAutoModerationRules(guildId),
      )) as APIAutoModerationRule[];
    } catch (err) {
      const detail = `failed to list automod rules: ${formatDiscordError(err)}`;
      for (const r of spec.automod_rules)
        summary.automod_rules.push({ status: 'failed', name: r.name, detail });
      existing = [];
    }
    const automodByName = new Map<string, APIAutoModerationRule>();
    for (const r of existing) automodByName.set(r.name.toLowerCase(), r);

    if (existing.length || summary.automod_rules.length === 0) {
      for (const r of spec.automod_rules) {
        const key = r.name.toLowerCase();
        if (automodByName.has(key)) {
          summary.automod_rules.push({ status: 'skipped_exists', name: r.name });
          continue;
        }
        try {
          const actions: Record<string, unknown>[] = [];
          if (r.block_message !== undefined && r.block_message !== false) {
            if (typeof r.block_message === 'string') {
              actions.push({
                type: AutoModerationActionType.BlockMessage,
                metadata: { custom_message: r.block_message },
              });
            } else {
              actions.push({ type: AutoModerationActionType.BlockMessage });
            }
          }
          if (r.alert_channel) {
            const ch = channelByName.get(r.alert_channel.toLowerCase());
            if (ch) {
              actions.push({
                type: AutoModerationActionType.SendAlertMessage,
                metadata: { channel_id: ch.id },
              });
            }
          }
          if (r.timeout_seconds !== undefined && r.timeout_seconds > 0) {
            actions.push({
              type: AutoModerationActionType.Timeout,
              metadata: { duration_seconds: r.timeout_seconds },
            });
          }
          if (r.block_member_interaction) {
            actions.push({ type: AutoModerationActionType.BlockMemberInteraction });
          }
          if (actions.length === 0) {
            summary.automod_rules.push({
              status: 'failed',
              name: r.name,
              detail:
                'rule needs at least one action: block_message, alert_channel, timeout_seconds, or block_member_interaction',
            });
            continue;
          }
          const md: Record<string, unknown> = {};
          if (r.trigger === 'keyword' || r.trigger === 'member_profile') {
            if (r.keyword_filter) md.keyword_filter = r.keyword_filter;
            if (r.regex_patterns) md.regex_patterns = r.regex_patterns;
            if (r.allow_list) md.allow_list = r.allow_list;
          } else if (r.trigger === 'keyword_preset') {
            if (r.presets) md.presets = r.presets.map((p) => PRESET_TO_NUM[p]);
            if (r.allow_list) md.allow_list = r.allow_list;
          } else if (r.trigger === 'mention_spam') {
            if (r.mention_total_limit !== undefined) md.mention_total_limit = r.mention_total_limit;
            if (r.mention_raid_protection_enabled !== undefined)
              md.mention_raid_protection_enabled = r.mention_raid_protection_enabled;
          }
          const body: Record<string, unknown> = {
            name: r.name,
            event_type: EVENT_TYPE_TO_NUM[r.event_type ?? 'message_send'],
            trigger_type: TRIGGER_TYPE_TO_NUM[r.trigger],
            actions,
          };
          if (Object.keys(md).length) body.trigger_metadata = md;
          body.enabled = r.enabled ?? true;
          if (r.exempt_roles?.length) {
            const ids: string[] = [];
            for (const rn of r.exempt_roles) {
              const role = roleByName.get(rn.toLowerCase());
              if (role) ids.push(role.id);
            }
            body.exempt_roles = ids;
          }
          if (r.exempt_channels?.length) {
            const ids: string[] = [];
            for (const cn of r.exempt_channels) {
              const ch =
                channelByName.get(cn.toLowerCase()) ?? categoryByName.get(cn.toLowerCase());
              if (ch) ids.push(ch.id);
            }
            body.exempt_channels = ids;
          }
          await rest.post(Routes.guildAutoModerationRules(guildId), { body, reason });
          summary.automod_rules.push({ status: 'created', name: r.name });
        } catch (err) {
          summary.automod_rules.push({
            status: 'failed',
            name: r.name,
            detail: formatDiscordError(err),
          });
        }
      }
    }
  }

  if (spec.scheduled_events?.length) {
    let eventByName = new Map<string, APIGuildScheduledEvent>();
    try {
      const existing = (await rest.get(
        Routes.guildScheduledEvents(guildId),
      )) as APIGuildScheduledEvent[];
      for (const e of existing) eventByName.set(e.name.toLowerCase(), e);
    } catch {
      eventByName = new Map();
    }
    for (const ev of spec.scheduled_events) {
      const key = ev.name.toLowerCase();
      if (eventByName.has(key)) {
        summary.scheduled_events.push({ status: 'skipped_exists', name: ev.name });
        continue;
      }
      try {
        const body: Record<string, unknown> = {
          name: ev.name,
          entity_type: ENTITY_TYPE_TO_NUM[ev.type],
          scheduled_start_time: ev.scheduled_start_time,
          privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
        };
        if (ev.description !== undefined) body.description = ev.description;
        if (ev.scheduled_end_time !== undefined) body.scheduled_end_time = ev.scheduled_end_time;
        if (ev.type === 'external') {
          if (!ev.location) {
            summary.scheduled_events.push({
              status: 'failed',
              name: ev.name,
              detail: "external events require 'location'",
            });
            continue;
          }
          if (!ev.scheduled_end_time) {
            summary.scheduled_events.push({
              status: 'failed',
              name: ev.name,
              detail: "external events require 'scheduled_end_time'",
            });
            continue;
          }
          body.entity_metadata = { location: ev.location };
        } else {
          if (!ev.channel) {
            summary.scheduled_events.push({
              status: 'failed',
              name: ev.name,
              detail: `${ev.type} events require 'channel' (channel name)`,
            });
            continue;
          }
          const ch = channelByName.get(ev.channel.toLowerCase());
          if (!ch) {
            summary.scheduled_events.push({
              status: 'failed',
              name: ev.name,
              detail: `channel '${ev.channel}' not found`,
            });
            continue;
          }
          body.channel_id = ch.id;
        }
        await rest.post(Routes.guildScheduledEvents(guildId), { body, reason });
        summary.scheduled_events.push({ status: 'created', name: ev.name });
      } catch (err) {
        summary.scheduled_events.push({
          status: 'failed',
          name: ev.name,
          detail: formatDiscordError(err),
        });
      }
    }
  }

  return summary;
}

function summarizeCounts(summary: ApplySummary) {
  function tally(items: Outcome[]) {
    return {
      created: items.filter((i) => i.status === 'created').length,
      skipped: items.filter((i) => i.status === 'skipped_exists').length,
      failed: items.filter((i) => i.status === 'failed').length,
    };
  }
  return {
    roles: tally(summary.roles),
    categories: tally(summary.categories),
    channels: tally(summary.channels),
    automod_rules: tally(summary.automod_rules),
    scheduled_events: tally(summary.scheduled_events),
  };
}

export function registerTemplateTools(server: McpServer): void {
  server.registerTool(
    'discord_list_templates',
    {
      description:
        "Lists the bundled server templates shipped with this plugin. Use the returned names as `template_name` for discord_apply_template. Each template is a JSON spec under templates/<name>.json describing roles, categories, channels, welcome screen, AutoMod rules, and scheduled events.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const names = listBundledTemplates();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: names.length, templates: names }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'discord_apply_template',
    {
      description:
        "Applies a server template to the active guild — bulk-creates roles, categories, channels, welcome screen, AutoMod rules, and scheduled events from one JSON spec. Idempotent: anything matching an existing entity by name is SKIPPED, never modified or deleted. Order: guild settings → roles → categories → channels → welcome screen → automod → scheduled events. Channel `category`, welcome `channel`, scheduled-event `channel`, and automod `exempt_*` / `alert_channel` reference other entities BY NAME (resolved at apply time). Pass either `template_name` (bundled, see discord_list_templates) OR `spec` (inline). Use `dry_run: true` to preview without making any changes.",
      inputSchema: {
        template_name: z
          .string()
          .optional()
          .describe(
            "Name of a bundled template (from discord_list_templates). Mutually exclusive with `spec`. Allowed chars: a-z, 0-9, hyphen.",
          ),
        spec: templateSpecSchema
          .optional()
          .describe(
            "Inline template object. Mutually exclusive with `template_name`. Field reference: guild=guild settings to PATCH, roles[]=create roles by name, categories[]=create category channels, channels[]=create real channels (category field references categories[].name), welcome_screen.channels[].channel=channel name, automod_rules[].alert_channel/exempt_channels[]/exempt_roles[]=names, scheduled_events[].channel=channel name.",
          ),
        dry_run: z
          .boolean()
          .optional()
          .describe(
            'When true, returns a structured preview of what WOULD be created without making any API calls. Useful for confirming with the user before applying.',
          ),
        reason: z
          .string()
          .max(512)
          .optional()
          .describe('Audit log reason applied to every create/patch performed by this run.'),
      },
      annotations: MUTATING,
    },
    async ({ template_name, spec: inlineSpec, dry_run, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;

      let spec: TemplateSpec;
      let source: string;
      if (template_name && inlineSpec) {
        return errorResult('Pass either template_name or spec, not both.');
      }
      if (template_name) {
        const safe = template_name.trim();
        if (!/^[a-z0-9-]+$/i.test(safe)) {
          return errorResult(
            `template_name '${template_name}' must contain only letters, digits, and hyphens.`,
          );
        }
        const path = resolve(TEMPLATES_DIR, `${safe}.json`);
        if (!existsSync(path)) {
          const avail = listBundledTemplates();
          return errorResult(
            `No bundled template '${safe}'. Available: ${avail.join(', ') || '(none)'}`,
          );
        }
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(path, 'utf-8'));
        } catch (err) {
          return errorResult(`Failed to read template '${safe}': ${(err as Error).message}`);
        }
        const parsed = templateSpecSchema.safeParse(raw);
        if (!parsed.success) {
          return errorResult(
            `Bundled template '${safe}' failed validation: ${parsed.error.message}`,
          );
        }
        spec = parsed.data;
        source = `template:${safe}`;
      } else if (inlineSpec) {
        spec = inlineSpec;
        source = 'inline';
      } else {
        return errorResult('Pass either template_name (bundled) or spec (inline).');
      }

      if (dry_run) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  dry_run: true,
                  source,
                  active_guild_id: getActiveGuildId(),
                  preview: previewSpec(spec),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const summary = await applyTemplate(spec, reason);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                source,
                active_guild_id: getActiveGuildId(),
                counts: summarizeCounts(summary),
                summary,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
