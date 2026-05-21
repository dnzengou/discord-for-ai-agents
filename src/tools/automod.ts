import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  Routes,
} from 'discord-api-types/v10';
import type {
  APIAutoModerationAction,
  APIAutoModerationRule,
  APIAutoModerationRuleTriggerMetadata,
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

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

const TRIGGER_TYPE_TO_NUM: Record<string, AutoModerationRuleTriggerType> = {
  keyword: AutoModerationRuleTriggerType.Keyword,
  spam: AutoModerationRuleTriggerType.Spam,
  keyword_preset: AutoModerationRuleTriggerType.KeywordPreset,
  mention_spam: AutoModerationRuleTriggerType.MentionSpam,
  member_profile: AutoModerationRuleTriggerType.MemberProfile,
};

const TRIGGER_NUM_TO_NAME: Record<number, string> = {
  [AutoModerationRuleTriggerType.Keyword]: 'keyword',
  [AutoModerationRuleTriggerType.Spam]: 'spam',
  [AutoModerationRuleTriggerType.KeywordPreset]: 'keyword_preset',
  [AutoModerationRuleTriggerType.MentionSpam]: 'mention_spam',
  [AutoModerationRuleTriggerType.MemberProfile]: 'member_profile',
};

const EVENT_TYPE_TO_NUM: Record<string, AutoModerationRuleEventType> = {
  message_send: AutoModerationRuleEventType.MessageSend,
  member_update: AutoModerationRuleEventType.MemberUpdate,
};

const EVENT_NUM_TO_NAME: Record<number, string> = {
  [AutoModerationRuleEventType.MessageSend]: 'message_send',
  [AutoModerationRuleEventType.MemberUpdate]: 'member_update',
};

const PRESET_TO_NUM: Record<string, AutoModerationRuleKeywordPresetType> = {
  profanity: AutoModerationRuleKeywordPresetType.Profanity,
  sexual_content: AutoModerationRuleKeywordPresetType.SexualContent,
  slurs: AutoModerationRuleKeywordPresetType.Slurs,
};

const PRESET_NUM_TO_NAME: Record<number, string> = {
  [AutoModerationRuleKeywordPresetType.Profanity]: 'profanity',
  [AutoModerationRuleKeywordPresetType.SexualContent]: 'sexual_content',
  [AutoModerationRuleKeywordPresetType.Slurs]: 'slurs',
};

const ACTION_NUM_TO_NAME: Record<number, string> = {
  [AutoModerationActionType.BlockMessage]: 'block_message',
  [AutoModerationActionType.SendAlertMessage]: 'send_alert_message',
  [AutoModerationActionType.Timeout]: 'timeout',
  [AutoModerationActionType.BlockMemberInteraction]: 'block_member_interaction',
};

interface ActionInputs {
  block_message?: boolean | string;
  alert_channel_id?: string;
  timeout_seconds?: number;
  block_member_interaction?: boolean;
}

function buildActions(inputs: ActionInputs): APIAutoModerationAction[] {
  const out: APIAutoModerationAction[] = [];
  if (inputs.block_message !== undefined && inputs.block_message !== false) {
    if (typeof inputs.block_message === 'string') {
      out.push({
        type: AutoModerationActionType.BlockMessage,
        metadata: { custom_message: inputs.block_message },
      });
    } else {
      out.push({ type: AutoModerationActionType.BlockMessage });
    }
  }
  if (inputs.alert_channel_id) {
    out.push({
      type: AutoModerationActionType.SendAlertMessage,
      metadata: { channel_id: inputs.alert_channel_id },
    });
  }
  if (inputs.timeout_seconds !== undefined && inputs.timeout_seconds > 0) {
    out.push({
      type: AutoModerationActionType.Timeout,
      metadata: { duration_seconds: inputs.timeout_seconds },
    });
  }
  if (inputs.block_member_interaction) {
    out.push({ type: AutoModerationActionType.BlockMemberInteraction });
  }
  return out;
}

interface TriggerInputs {
  keyword_filter?: string[];
  regex_patterns?: string[];
  presets?: string[];
  allow_list?: string[];
  mention_total_limit?: number;
  mention_raid_protection_enabled?: boolean;
}

function buildTriggerMetadata(
  trigger: string,
  inputs: TriggerInputs,
): APIAutoModerationRuleTriggerMetadata | undefined {
  const md: APIAutoModerationRuleTriggerMetadata = {};
  if (trigger === 'keyword' || trigger === 'member_profile') {
    if (inputs.keyword_filter) md.keyword_filter = inputs.keyword_filter;
    if (inputs.regex_patterns) md.regex_patterns = inputs.regex_patterns;
    if (inputs.allow_list) md.allow_list = inputs.allow_list;
  } else if (trigger === 'keyword_preset') {
    if (inputs.presets) {
      md.presets = inputs.presets.map((p) => {
        const num = PRESET_TO_NUM[p];
        if (num === undefined) {
          throw new Error(`Unknown preset '${p}'. Allowed: profanity, sexual_content, slurs.`);
        }
        return num;
      });
    }
    if (inputs.allow_list) md.allow_list = inputs.allow_list;
  } else if (trigger === 'mention_spam') {
    if (inputs.mention_total_limit !== undefined) md.mention_total_limit = inputs.mention_total_limit;
    if (inputs.mention_raid_protection_enabled !== undefined)
      md.mention_raid_protection_enabled = inputs.mention_raid_protection_enabled;
  }
  return Object.keys(md).length ? md : undefined;
}

function formatRule(r: APIAutoModerationRule): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger_type: TRIGGER_NUM_TO_NAME[r.trigger_type] ?? `unknown(${r.trigger_type})`,
    event_type: EVENT_NUM_TO_NAME[r.event_type] ?? `unknown(${r.event_type})`,
    trigger_metadata: {
      ...r.trigger_metadata,
      preset_names: r.trigger_metadata.presets?.map((p) => PRESET_NUM_TO_NAME[p] ?? `unknown(${p})`),
    },
    actions: r.actions.map((a) => ({
      type: ACTION_NUM_TO_NAME[a.type] ?? `unknown(${a.type})`,
      metadata: a.metadata ?? null,
    })),
    creator_id: r.creator_id,
    exempt_roles: r.exempt_roles,
    exempt_channels: r.exempt_channels,
  };
}

const TRIGGER_ENUM = z.enum(['keyword', 'spam', 'keyword_preset', 'mention_spam', 'member_profile']);
const EVENT_ENUM = z.enum(['message_send', 'member_update']);
const PRESET_ENUM = z.enum(['profanity', 'sexual_content', 'slurs']);

export function registerAutoModTools(server: McpServer): void {
  server.registerTool(
    'discord_list_automod_rules',
    {
      description:
        "Lists all AutoMod rules for the active guild (GET /guilds/{id}/auto-moderation/rules). Returns each rule's id, name, trigger_type (keyword/spam/keyword_preset/mention_spam/member_profile), event_type, trigger_metadata, actions, and exempt lists. Discord limits: 6 keyword rules, 1 each of spam/keyword_preset/mention_spam/member_profile per guild.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const rules = (await rest.get(
          Routes.guildAutoModerationRules(getActiveGuildId()),
        )) as APIAutoModerationRule[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { count: rules.length, rules: rules.map(formatRule) },
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
    'discord_create_automod_rule',
    {
      description:
        "Creates an AutoMod rule (POST /guilds/{id}/auto-moderation/rules). Pick a trigger then supply the matching metadata fields. At least one action is required. Common patterns: (a) keyword block — trigger='keyword', keyword_filter=['word1','word2'], block_message=true. (b) preset slur block — trigger='keyword_preset', presets=['slurs'], block_message=true. (c) mention spam guard — trigger='mention_spam', mention_total_limit=10, block_message=true. Discord rate-limits rule counts per trigger type; see discord_list_automod_rules.",
      inputSchema: {
        name: z.string().min(1).max(100).describe('Rule display name.'),
        trigger: TRIGGER_ENUM.describe(
          "What this rule scans. 'keyword'=user-defined word/phrase list, 'keyword_preset'=Discord-maintained word lists, 'spam'=generic spam heuristic, 'mention_spam'=cap on @mentions per message, 'member_profile'=scan usernames/display names.",
        ),
        event_type: EVENT_ENUM
          .optional()
          .describe(
            "When the rule fires. 'message_send' (default) for content rules, 'member_update' for member_profile rules.",
          ),
        keyword_filter: z
          .array(z.string().max(60))
          .max(1000)
          .optional()
          .describe(
            "For trigger=keyword/member_profile. Substrings to block (max 60 chars each, max 1000 entries). Wildcards: * matches any chars, e.g. 'cat*' blocks 'cats', 'category'.",
          ),
        regex_patterns: z
          .array(z.string().max(260))
          .max(10)
          .optional()
          .describe('For trigger=keyword/member_profile. Rust-flavored regex (max 10 patterns, 260 chars each).'),
        presets: z
          .array(PRESET_ENUM)
          .optional()
          .describe(
            "For trigger=keyword_preset. Discord-maintained word lists. Pick any of: 'profanity', 'sexual_content', 'slurs'.",
          ),
        allow_list: z
          .array(z.string().max(60))
          .max(1000)
          .optional()
          .describe('Substrings to ignore (whitelist). Applies to keyword, keyword_preset, member_profile.'),
        mention_total_limit: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('For trigger=mention_spam. Max user+role mentions per message (0-50).'),
        mention_raid_protection_enabled: z
          .boolean()
          .optional()
          .describe('For trigger=mention_spam. Auto-detect mention raids.'),
        block_message: z
          .union([z.boolean(), z.string().max(150)])
          .optional()
          .describe(
            "Action: prevent the offending message. true = silent block, string = block with custom explanation shown to user (max 150 chars).",
          ),
        alert_channel_id: z
          .string()
          .optional()
          .describe('Action: log triggered content to this channel.'),
        timeout_seconds: z
          .number()
          .int()
          .min(0)
          .max(2419200)
          .optional()
          .describe(
            'Action: timeout the offending member. Max 2419200 (4 weeks). Only valid with trigger=keyword or member_profile, and bot needs MODERATE_MEMBERS perm.',
          ),
        block_member_interaction: z
          .boolean()
          .optional()
          .describe('Action: block the member from text/voice/interactions. trigger=member_profile only.'),
        enabled: z.boolean().optional().describe('Default true.'),
        exempt_roles: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Roles that bypass this rule (max 20).'),
        exempt_channels: z
          .array(z.string())
          .max(50)
          .optional()
          .describe('Channels where this rule does not apply (max 50).'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({
      name,
      trigger,
      event_type,
      keyword_filter,
      regex_patterns,
      presets,
      allow_list,
      mention_total_limit,
      mention_raid_protection_enabled,
      block_message,
      alert_channel_id,
      timeout_seconds,
      block_member_interaction,
      enabled,
      exempt_roles,
      exempt_channels,
      reason,
    }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const actions = buildActions({
          block_message,
          alert_channel_id,
          timeout_seconds,
          block_member_interaction,
        });
        if (actions.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'At least one action is required (block_message, alert_channel_id, timeout_seconds, or block_member_interaction).',
              },
            ],
          };
        }
        const triggerMetadata = buildTriggerMetadata(trigger, {
          keyword_filter,
          regex_patterns,
          presets,
          allow_list,
          mention_total_limit,
          mention_raid_protection_enabled,
        });
        const body: Record<string, unknown> = {
          name,
          event_type: EVENT_TYPE_TO_NUM[event_type ?? 'message_send'],
          trigger_type: TRIGGER_TYPE_TO_NUM[trigger],
          actions,
        };
        if (triggerMetadata) body.trigger_metadata = triggerMetadata;
        if (enabled !== undefined) body.enabled = enabled;
        if (exempt_roles) body.exempt_roles = exempt_roles;
        if (exempt_channels) body.exempt_channels = exempt_channels;
        const rule = (await rest.post(Routes.guildAutoModerationRules(getActiveGuildId()), {
          body,
          reason,
        })) as APIAutoModerationRule;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, rule: formatRule(rule) }, null, 2) },
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
    'discord_modify_automod_rule',
    {
      description:
        "Modifies an existing AutoMod rule (PATCH /guilds/{id}/auto-moderation/rules/{rule_id}). Pass only fields to change. To replace actions, pass any of the action fields (block_message, alert_channel_id, timeout_seconds, block_member_interaction) — the new action set REPLACES the old one. To toggle the rule, pass enabled.",
      inputSchema: {
        rule_id: z.string().min(1).describe('The AutoMod rule to modify.'),
        name: z.string().min(1).max(100).optional(),
        event_type: EVENT_ENUM.optional(),
        keyword_filter: z.array(z.string().max(60)).max(1000).optional(),
        regex_patterns: z.array(z.string().max(260)).max(10).optional(),
        presets: z.array(PRESET_ENUM).optional(),
        allow_list: z.array(z.string().max(60)).max(1000).optional(),
        mention_total_limit: z.number().int().min(0).max(50).optional(),
        mention_raid_protection_enabled: z.boolean().optional(),
        block_message: z.union([z.boolean(), z.string().max(150)]).optional(),
        alert_channel_id: z.string().optional(),
        timeout_seconds: z.number().int().min(0).max(2419200).optional(),
        block_member_interaction: z.boolean().optional(),
        enabled: z.boolean().optional(),
        exempt_roles: z.array(z.string()).max(20).optional(),
        exempt_channels: z.array(z.string()).max(50).optional(),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({
      rule_id,
      name,
      event_type,
      keyword_filter,
      regex_patterns,
      presets,
      allow_list,
      mention_total_limit,
      mention_raid_protection_enabled,
      block_message,
      alert_channel_id,
      timeout_seconds,
      block_member_interaction,
      enabled,
      exempt_roles,
      exempt_channels,
      reason,
    }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (event_type !== undefined) body.event_type = EVENT_TYPE_TO_NUM[event_type];

        const triggerInputsProvided =
          keyword_filter !== undefined ||
          regex_patterns !== undefined ||
          presets !== undefined ||
          allow_list !== undefined ||
          mention_total_limit !== undefined ||
          mention_raid_protection_enabled !== undefined;
        if (triggerInputsProvided) {
          const md: APIAutoModerationRuleTriggerMetadata = {};
          if (keyword_filter !== undefined) md.keyword_filter = keyword_filter;
          if (regex_patterns !== undefined) md.regex_patterns = regex_patterns;
          if (allow_list !== undefined) md.allow_list = allow_list;
          if (presets !== undefined)
            md.presets = presets.map((p) => PRESET_TO_NUM[p]).filter((n) => n !== undefined);
          if (mention_total_limit !== undefined) md.mention_total_limit = mention_total_limit;
          if (mention_raid_protection_enabled !== undefined)
            md.mention_raid_protection_enabled = mention_raid_protection_enabled;
          body.trigger_metadata = md;
        }

        const actionInputsProvided =
          block_message !== undefined ||
          alert_channel_id !== undefined ||
          timeout_seconds !== undefined ||
          block_member_interaction !== undefined;
        if (actionInputsProvided) {
          body.actions = buildActions({
            block_message,
            alert_channel_id,
            timeout_seconds,
            block_member_interaction,
          });
        }

        if (enabled !== undefined) body.enabled = enabled;
        if (exempt_roles !== undefined) body.exempt_roles = exempt_roles;
        if (exempt_channels !== undefined) body.exempt_channels = exempt_channels;

        const rule = (await rest.patch(Routes.guildAutoModerationRule(getActiveGuildId(), rule_id), {
          body,
          reason,
        })) as APIAutoModerationRule;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, rule: formatRule(rule) }, null, 2) },
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
    'discord_delete_automod_rule',
    {
      description:
        "Permanently deletes an AutoMod rule (DELETE /guilds/{id}/auto-moderation/rules/{rule_id}). Cannot be undone — the rule and its trigger/action config are gone.",
      inputSchema: {
        rule_id: z.string().min(1).describe('The AutoMod rule to delete.'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ rule_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.delete(Routes.guildAutoModerationRule(getActiveGuildId(), rule_id), { reason });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, deleted_rule_id: rule_id }, null, 2) },
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
