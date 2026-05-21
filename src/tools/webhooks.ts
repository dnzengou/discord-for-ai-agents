import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIWebhook } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { tokenGuard } from '../guards.js';

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

function colorToInt(input: string | number | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') return input;
  const s = input.startsWith('#') ? input.slice(1) : input;
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? undefined : n;
}

const embedFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  inline: z.boolean().optional(),
});

const embedSchema = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  url: z.string().optional(),
  timestamp: z.string().optional().describe('ISO8601 timestamp shown in the footer.'),
  color: z.union([z.string(), z.number().int()]).optional().describe('Hex string or integer.'),
  footer: z
    .object({
      text: z.string().max(2048),
      icon_url: z.string().optional(),
    })
    .optional(),
  image: z.object({ url: z.string() }).optional(),
  thumbnail: z.object({ url: z.string() }).optional(),
  author: z
    .object({
      name: z.string().max(256),
      url: z.string().optional(),
      icon_url: z.string().optional(),
    })
    .optional(),
  fields: z.array(embedFieldSchema).max(25).optional(),
});

type EmbedInput = z.infer<typeof embedSchema>;

function buildEmbed(e: EmbedInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (e.title !== undefined) out.title = e.title;
  if (e.description !== undefined) out.description = e.description;
  if (e.url !== undefined) out.url = e.url;
  if (e.timestamp !== undefined) out.timestamp = e.timestamp;
  const c = colorToInt(e.color);
  if (c !== undefined) out.color = c;
  if (e.footer) out.footer = e.footer;
  if (e.image) out.image = e.image;
  if (e.thumbnail) out.thumbnail = e.thumbnail;
  if (e.author) out.author = e.author;
  if (e.fields && e.fields.length) out.fields = e.fields;
  return out;
}

function formatWebhook(w: APIWebhook): Record<string, unknown> {
  return {
    id: w.id,
    type: w.type,
    name: w.name,
    channel_id: w.channel_id,
    guild_id: w.guild_id ?? null,
    avatar: w.avatar ?? null,
    application_id: w.application_id ?? null,
    user: w.user ? { id: w.user.id, username: w.user.username } : null,
    token: w.token ?? null,
  };
}

export function registerWebhookTools(server: McpServer): void {
  server.registerTool(
    'discord_list_webhooks',
    {
      description:
        "Lists webhooks in a channel (GET /channels/{id}/webhooks). Returns id, name, channel_id, and the webhook token (when the bot can see it). The token is the credential needed to call discord_send_via_webhook without bot auth. Requires Manage Webhooks perm.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel to list webhooks for.'),
      },
      annotations: READ_ONLY,
    },
    async ({ channel_id }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const hooks = (await rest.get(Routes.channelWebhooks(channel_id))) as APIWebhook[];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { count: hooks.length, webhooks: hooks.map(formatWebhook) },
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
    'discord_create_webhook',
    {
      description:
        "Creates a webhook in a channel (POST /channels/{id}/webhooks). The response contains the webhook id AND token — SAVE THE TOKEN, you need it to call discord_send_via_webhook later. Discord forbids names containing 'clyde' or 'discord' (case-insensitive). Requires Manage Webhooks perm.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel to host the webhook (must be a text/announcement/forum channel).'),
        name: z
          .string()
          .min(1)
          .max(80)
          .describe("Webhook display name (1-80 chars). Cannot contain 'clyde' or 'discord'."),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, name, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const w = (await rest.post(Routes.channelWebhooks(channel_id), {
          body: { name },
          reason,
        })) as APIWebhook;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, webhook: formatWebhook(w) }, null, 2) },
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
    'discord_send_via_webhook',
    {
      description:
        "Posts a message via a webhook (POST /webhooks/{id}/{token}). Authenticates with the webhook token in the URL — bot perms in the channel are NOT required. Each call can override username and avatar_url to spoof a different sender (handy for relay bots, system messages, multi-persona content). Pass wait=true to get the created message back; default returns just ok:true.",
      inputSchema: {
        webhook_id: z
          .string()
          .min(1)
          .describe('Webhook id (from discord_create_webhook or discord_list_webhooks).'),
        webhook_token: z
          .string()
          .min(1)
          .describe('Webhook token (from discord_create_webhook or discord_list_webhooks).'),
        content: z
          .string()
          .max(2000)
          .optional()
          .describe('Message text (max 2000 chars). Required when no embeds are provided.'),
        embeds: z
          .array(embedSchema)
          .max(10)
          .optional()
          .describe('Up to 10 rich embeds. Combined character total across all embeds must be <= 6000.'),
        username: z
          .string()
          .max(80)
          .optional()
          .describe("Override the webhook's display name for this message only."),
        avatar_url: z
          .string()
          .optional()
          .describe("Override the webhook's avatar for this message only."),
        tts: z.boolean().optional(),
        thread_id: z
          .string()
          .optional()
          .describe('Post into a specific thread within the webhook channel (forum/announcement threads).'),
        wait: z
          .boolean()
          .optional()
          .describe('When true, Discord returns the created message in the response. Default false.'),
        allow_mentions: z
          .boolean()
          .optional()
          .describe(
            'When false (default), @everyone/@here/role/user pings in content are suppressed.',
          ),
      },
      annotations: MUTATING,
    },
    async ({
      webhook_id,
      webhook_token,
      content,
      embeds,
      username,
      avatar_url,
      tts,
      thread_id,
      wait,
      allow_mentions,
    }) => {
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (content !== undefined) body.content = content;
        if (embeds && embeds.length) body.embeds = embeds.map(buildEmbed);
        if (username !== undefined) body.username = username;
        if (avatar_url !== undefined) body.avatar_url = avatar_url;
        if (tts !== undefined) body.tts = tts;
        if (!allow_mentions) body.allowed_mentions = { parse: [] };
        const params: Record<string, string> = {};
        if (wait) params.wait = 'true';
        if (thread_id) params.thread_id = thread_id;
        const opts: Record<string, unknown> = { body, auth: false };
        if (Object.keys(params).length) opts.query = new URLSearchParams(params);
        const result = await rest.post(Routes.webhook(webhook_id, webhook_token), opts);
        const payload = wait ? { ok: true, message: result } : { ok: true, webhook_id };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
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
    'discord_delete_webhook',
    {
      description:
        "Deletes a webhook (DELETE /webhooks/{id}). Permanently removes it; messages already sent via it stay in the channel. By default uses bot auth (requires Manage Webhooks). Pass webhook_token to delete via token instead — no bot perms needed.",
      inputSchema: {
        webhook_id: z.string().min(1).describe('The webhook to delete.'),
        webhook_token: z
          .string()
          .optional()
          .describe('Optional — when supplied, deletes via webhook token (no bot Manage Webhooks perm needed).'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ webhook_id, webhook_token, reason }) => {
      try {
        const rest = getRest();
        if (webhook_token) {
          await rest.delete(Routes.webhook(webhook_id, webhook_token), { reason, auth: false });
        } else {
          const guard = tokenGuard();
          if (guard) return guard;
          await rest.delete(Routes.webhook(webhook_id), { reason });
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted_webhook_id: webhook_id }, null, 2),
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
