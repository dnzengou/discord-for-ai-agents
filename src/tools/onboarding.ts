import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GuildOnboardingMode, GuildOnboardingPromptType, Routes } from 'discord-api-types/v10';
import type { APIGuildOnboarding } from 'discord-api-types/v10';
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

const PROMPT_TYPE_TO_NUM: Record<string, GuildOnboardingPromptType> = {
  multiple_choice: GuildOnboardingPromptType.MultipleChoice,
  dropdown: GuildOnboardingPromptType.Dropdown,
};

const PROMPT_NUM_TO_NAME: Record<number, string> = {
  [GuildOnboardingPromptType.MultipleChoice]: 'multiple_choice',
  [GuildOnboardingPromptType.Dropdown]: 'dropdown',
};

const MODE_TO_NUM: Record<string, GuildOnboardingMode> = {
  default: GuildOnboardingMode.OnboardingDefault,
  advanced: GuildOnboardingMode.OnboardingAdvanced,
};

const MODE_NUM_TO_NAME: Record<number, string> = {
  [GuildOnboardingMode.OnboardingDefault]: 'default',
  [GuildOnboardingMode.OnboardingAdvanced]: 'advanced',
};

function formatOnboarding(o: APIGuildOnboarding): Record<string, unknown> {
  return {
    guild_id: o.guild_id,
    enabled: o.enabled,
    mode: MODE_NUM_TO_NAME[o.mode] ?? `unknown(${o.mode})`,
    default_channel_ids: o.default_channel_ids,
    prompts: o.prompts.map((p) => ({
      id: p.id,
      type: PROMPT_NUM_TO_NAME[p.type] ?? `unknown(${p.type})`,
      title: p.title,
      single_select: p.single_select,
      required: p.required,
      in_onboarding: p.in_onboarding,
      options: p.options.map((opt) => ({
        id: opt.id,
        title: opt.title,
        description: opt.description ?? null,
        channel_ids: opt.channel_ids,
        role_ids: opt.role_ids,
        emoji: opt.emoji ?? null,
      })),
    })),
  };
}

const emojiSchema = z.object({
  id: z.string().nullable().optional().describe('Custom emoji ID, null for unicode.'),
  name: z.string().optional().describe('Unicode char or custom emoji name.'),
  animated: z.boolean().optional(),
});

const promptOptionSchema = z.object({
  title: z.string().min(1).max(50).describe('Option label (max 50 chars).'),
  description: z.string().max(100).optional().describe('Optional helper text (max 100 chars).'),
  channel_ids: z.array(z.string()).optional().describe('Channels granted when this option is picked.'),
  role_ids: z.array(z.string()).optional().describe('Roles granted when this option is picked.'),
  emoji: emojiSchema.optional().describe('Icon shown next to the option.'),
});

const promptSchema = z.object({
  type: z
    .enum(['multiple_choice', 'dropdown'])
    .describe("UI: 'multiple_choice'=cards/grid, 'dropdown'=collapsible select."),
  title: z.string().min(1).max(100).describe('Question shown to the new member.'),
  options: z.array(promptOptionSchema).min(1).max(50).describe('Pickable options (1-50).'),
  single_select: z.boolean().optional().describe('When true, only one option may be picked. Default: true.'),
  required: z
    .boolean()
    .optional()
    .describe('Member must answer to finish onboarding. Default: true.'),
  in_onboarding: z
    .boolean()
    .optional()
    .describe('Show during initial onboarding flow (vs only in Channels & Roles browser). Default: true.'),
});

export function registerOnboardingTools(server: McpServer): void {
  server.registerTool(
    'discord_get_onboarding',
    {
      description:
        "Returns the active guild's onboarding config (GET /guilds/{id}/onboarding). Includes enabled flag, mode (default=only default channels count, advanced=prompt-granted channels count too), default_channel_ids granted on join, and the prompt list with options (each option grants its own channel_ids and role_ids).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const onboarding = (await rest.get(
          Routes.guildOnboarding(getActiveGuildId()),
        )) as APIGuildOnboarding;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(formatOnboarding(onboarding), null, 2) },
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
    'discord_modify_onboarding',
    {
      description:
        "Replaces the active guild's onboarding config (PUT /guilds/{id}/onboarding). Requires Community to be enabled. Pass only fields you want to set; omitted fields keep their current value (unlike pure PUT, the SDK merges with current state). Discord requires at least 7 default channels OR enough prompt-granted channels to satisfy onboarding constraints — set mode='advanced' if you want prompt channels to count.",
      inputSchema: {
        prompts: z
          .array(promptSchema)
          .max(5)
          .optional()
          .describe(
            'Up to 5 onboarding prompts (questions). REPLACES the existing prompts list. Each prompt has 1-50 options.',
          ),
        default_channel_ids: z
          .array(z.string())
          .optional()
          .describe(
            'Channel IDs every new member gets opted into. REPLACES the existing list. In default mode, must satisfy Discord onboarding minimums (~7 channels including a community-relevant mix).',
          ),
        enabled: z.boolean().optional().describe('Toggle onboarding on/off.'),
        mode: z
          .enum(['default', 'advanced'])
          .optional()
          .describe(
            "'default'=only default_channel_ids count toward Discord's minimum, 'advanced'=channels granted by prompt options also count.",
          ),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ prompts, default_channel_ids, enabled, mode, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (prompts !== undefined) {
          body.prompts = prompts.map((p, pIdx) => ({
            id: pIdx.toString(),
            type: PROMPT_TYPE_TO_NUM[p.type],
            title: p.title,
            single_select: p.single_select ?? true,
            required: p.required ?? true,
            in_onboarding: p.in_onboarding ?? true,
            options: p.options.map((opt, oIdx) => ({
              id: `${pIdx}-${oIdx}`,
              title: opt.title,
              description: opt.description ?? null,
              channel_ids: opt.channel_ids ?? [],
              role_ids: opt.role_ids ?? [],
              emoji: opt.emoji ?? null,
            })),
          }));
        }
        if (default_channel_ids !== undefined) body.default_channel_ids = default_channel_ids;
        if (enabled !== undefined) body.enabled = enabled;
        if (mode !== undefined) body.mode = MODE_TO_NUM[mode];
        const onboarding = (await rest.put(Routes.guildOnboarding(getActiveGuildId()), {
          body,
          reason,
        })) as APIGuildOnboarding;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, onboarding: formatOnboarding(onboarding) }, null, 2),
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
