import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Routes } from 'discord-api-types/v10';
import type { APIMessage } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { tokenGuard } from '../guards.js';

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
  name: z.string().min(1).max(256).describe('Field title (max 256 chars).'),
  value: z.string().min(1).max(1024).describe('Field body (max 1024 chars).'),
  inline: z.boolean().optional().describe('When true, multiple inline fields render side-by-side (up to 3 per row).'),
});

const fullEmbedSchema = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  url: z.string().optional().describe('Hyperlink applied to the title.'),
  timestamp: z.string().optional().describe('ISO8601 timestamp shown in the footer.'),
  color: z.union([z.string(), z.number().int()]).optional().describe('Sidebar color. Hex string ("#5865F2") or integer.'),
  footer: z
    .object({
      text: z.string().max(2048),
      icon_url: z.string().optional(),
    })
    .optional(),
  image: z.object({ url: z.string() }).optional().describe('Large image at the bottom of the embed.'),
  thumbnail: z.object({ url: z.string() }).optional().describe('Small image in the top-right corner.'),
  author: z
    .object({
      name: z.string().max(256),
      url: z.string().optional(),
      icon_url: z.string().optional(),
    })
    .optional(),
  fields: z.array(embedFieldSchema).max(25).optional().describe('Up to 25 fields.'),
});

type EmbedInput = z.infer<typeof fullEmbedSchema>;

function buildEmbedObject(e: EmbedInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (e.title !== undefined) out.title = e.title;
  if (e.description !== undefined) out.description = e.description;
  if (e.url !== undefined) out.url = e.url;
  if (e.timestamp !== undefined) out.timestamp = e.timestamp;
  const colorInt = colorToInt(e.color);
  if (colorInt !== undefined) out.color = colorInt;
  if (e.footer) out.footer = e.footer;
  if (e.image) out.image = e.image;
  if (e.thumbnail) out.thumbnail = e.thumbnail;
  if (e.author) out.author = e.author;
  if (e.fields && e.fields.length) out.fields = e.fields;
  return out;
}

function formatMessage(m: APIMessage): Record<string, unknown> {
  return {
    id: m.id,
    channel_id: m.channel_id,
    author: m.author
      ? { id: m.author.id, username: m.author.username, bot: m.author.bot ?? false }
      : null,
    content: m.content,
    timestamp: m.timestamp,
    edited_timestamp: m.edited_timestamp,
    pinned: m.pinned,
    embed_count: m.embeds?.length ?? 0,
    attachment_count: m.attachments?.length ?? 0,
    reactions: m.reactions?.map((r) => ({
      emoji: r.emoji.name ?? r.emoji.id,
      count: r.count,
      me: r.me,
    })) ?? [],
  };
}

export function registerMessageTools(server: McpServer): void {
  server.registerTool(
    'discord_send_message',
    {
      description:
        "Sends a message to a channel (POST /channels/{id}/messages). Use for plain text, with optional rich embeds passed as the embeds array. For the common single-embed case, prefer discord_send_embed (flatter ergonomics). allowed_mentions defaults to suppressing @everyone/@here/role/user pings unless allow_mentions=true.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Target channel ID.'),
        content: z
          .string()
          .max(2000)
          .optional()
          .describe('Message text (max 2000 chars). Required when no embeds are provided.'),
        embeds: z
          .array(fullEmbedSchema)
          .max(10)
          .optional()
          .describe('Up to 10 rich embeds. Combined character total across all embeds must be <= 6000.'),
        tts: z.boolean().optional().describe('Text-to-speech message.'),
        reply_to_message_id: z
          .string()
          .optional()
          .describe('Reply to this message ID (creates a referenced reply).'),
        allow_mentions: z
          .boolean()
          .optional()
          .describe(
            'When false (default), @everyone/@here/role/user mentions in content do NOT actually ping anyone. Set true to allow real pings.',
          ),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, content, embeds, tts, reply_to_message_id, allow_mentions }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (content !== undefined) body.content = content;
        if (embeds && embeds.length) body.embeds = embeds.map(buildEmbedObject);
        if (tts !== undefined) body.tts = tts;
        if (reply_to_message_id) body.message_reference = { message_id: reply_to_message_id };
        if (!allow_mentions) body.allowed_mentions = { parse: [] };
        const message = (await rest.post(Routes.channelMessages(channel_id), { body })) as APIMessage;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, message: formatMessage(message) }, null, 2),
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
    'discord_send_embed',
    {
      description:
        "Convenience for posting a single rich embed with flat field names (no nested {url:...} objects). Use for announcements, status cards, info panels, server welcome messages. For multiple embeds in one message, use discord_send_message with the embeds array.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Target channel ID.'),
        content: z
          .string()
          .max(2000)
          .optional()
          .describe('Optional plain text shown above the embed.'),
        title: z.string().max(256).optional().describe('Embed title (max 256 chars).'),
        description: z.string().max(4096).optional().describe('Embed body (max 4096 chars).'),
        url: z.string().optional().describe('URL hyperlinked from the title.'),
        color: z
          .union([z.string(), z.number().int()])
          .optional()
          .describe('Sidebar color. Hex string ("#5865F2") or integer. Common: 0x5865F2 = blurple, 0x57F287 = green, 0xED4245 = red.'),
        timestamp: z
          .string()
          .optional()
          .describe('ISO8601 timestamp shown in the footer (e.g., new Date().toISOString()).'),
        footer_text: z.string().max(2048).optional(),
        footer_icon_url: z.string().optional(),
        image_url: z.string().optional().describe('Large image displayed at the bottom of the embed.'),
        thumbnail_url: z.string().optional().describe('Small image in the top-right corner.'),
        author_name: z.string().max(256).optional(),
        author_url: z.string().optional(),
        author_icon_url: z.string().optional(),
        fields: z
          .array(embedFieldSchema)
          .max(25)
          .optional()
          .describe('Up to 25 fields, each {name, value, inline?}. inline=true packs fields side-by-side.'),
        allow_mentions: z
          .boolean()
          .optional()
          .describe('When false (default), mentions in content are suppressed.'),
      },
      annotations: MUTATING,
    },
    async ({
      channel_id,
      content,
      title,
      description,
      url,
      color,
      timestamp,
      footer_text,
      footer_icon_url,
      image_url,
      thumbnail_url,
      author_name,
      author_url,
      author_icon_url,
      fields,
      allow_mentions,
    }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const embed: EmbedInput = {};
        if (title !== undefined) embed.title = title;
        if (description !== undefined) embed.description = description;
        if (url !== undefined) embed.url = url;
        if (color !== undefined) embed.color = color;
        if (timestamp !== undefined) embed.timestamp = timestamp;
        if (footer_text !== undefined) {
          embed.footer = { text: footer_text };
          if (footer_icon_url) embed.footer.icon_url = footer_icon_url;
        }
        if (image_url) embed.image = { url: image_url };
        if (thumbnail_url) embed.thumbnail = { url: thumbnail_url };
        if (author_name !== undefined) {
          embed.author = { name: author_name };
          if (author_url) embed.author.url = author_url;
          if (author_icon_url) embed.author.icon_url = author_icon_url;
        }
        if (fields && fields.length) embed.fields = fields;

        const body: Record<string, unknown> = { embeds: [buildEmbedObject(embed)] };
        if (content !== undefined) body.content = content;
        if (!allow_mentions) body.allowed_mentions = { parse: [] };
        const message = (await rest.post(Routes.channelMessages(channel_id), { body })) as APIMessage;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, message: formatMessage(message) }, null, 2),
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
    'discord_edit_message',
    {
      description:
        "Edits an existing message (PATCH /channels/{id}/messages/{id}). Bots can only edit their own messages. Pass only the fields to change. To clear text, pass content=''. To clear all embeds, pass embeds=[].",
      inputSchema: {
        channel_id: z.string().min(1),
        message_id: z.string().min(1),
        content: z.string().max(2000).optional(),
        embeds: z
          .array(fullEmbedSchema)
          .max(10)
          .optional()
          .describe('Replaces all embeds on the message. Pass [] to remove every embed.'),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, message_id, content, embeds }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (content !== undefined) body.content = content;
        if (embeds !== undefined) body.embeds = embeds.map(buildEmbedObject);
        const message = (await rest.patch(Routes.channelMessage(channel_id, message_id), {
          body,
        })) as APIMessage;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, message: formatMessage(message) }, null, 2),
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
    'discord_delete_message',
    {
      description:
        "Permanently deletes a message (DELETE /channels/{id}/messages/{id}). Bots can delete their own messages anywhere; deleting other users' messages requires the Manage Messages permission in that channel. Cannot be undone.",
      inputSchema: {
        channel_id: z.string().min(1),
        message_id: z.string().min(1),
        reason: z.string().max(512).optional().describe('Audit log reason.'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id, message_id, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.delete(Routes.channelMessage(channel_id, message_id), { reason });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted: { channel_id, message_id } }, null, 2),
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
    'discord_bulk_delete_messages',
    {
      description:
        "Bulk deletes 2–100 messages from a channel (POST /channels/{id}/messages/bulk-delete). All message IDs must be < 14 days old — Discord rejects anything older. Faster and cheaper than individual deletes. Requires Manage Messages perm. Returns count of deleted messages.",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel to delete messages from.'),
        message_ids: z
          .array(z.string().min(1))
          .min(2)
          .max(100)
          .describe('2–100 message IDs to delete. All must be < 14 days old.'),
        reason: z.string().max(512).optional().describe('Audit log reason.'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ channel_id, message_ids, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.post(Routes.channelBulkDelete(channel_id), {
          body: { messages: message_ids },
          reason,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted_count: message_ids.length, channel_id }, null, 2),
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
    'discord_add_reaction',
    {
      description:
        "Adds the bot's own reaction to a message (PUT /channels/{id}/messages/{id}/reactions/{emoji}/@me). For Unicode emoji, pass the character itself (e.g., '👍' or '🎉'). For custom guild emoji, pass 'name:id' (e.g., 'partyparrot:1234567890'). The route URL-encodes the emoji automatically. Returns 204 No Content on success.",
      inputSchema: {
        channel_id: z.string().min(1),
        message_id: z.string().min(1),
        emoji: z
          .string()
          .min(1)
          .describe("Unicode emoji character (e.g., '👍') OR custom emoji as 'name:id' (e.g., 'partyparrot:1234567890')."),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, message_id, emoji }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.put(
          Routes.channelMessageOwnReaction(channel_id, message_id, encodeURIComponent(emoji)),
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, reaction: { channel_id, message_id, emoji } },
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
    'discord_pin_message',
    {
      description:
        "Pins a message in a channel (PUT /channels/{id}/pins/{message_id}). A channel can have at most 50 pinned messages. Pass unpin=true to remove an existing pin (DELETE /channels/{id}/pins/{message_id}). Requires Manage Messages permission. Returns 204 No Content on success.",
      inputSchema: {
        channel_id: z.string().min(1),
        message_id: z.string().min(1),
        unpin: z
          .boolean()
          .optional()
          .describe('When true, unpins the message instead of pinning it.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, message_id, unpin, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        if (unpin) {
          await rest.delete(Routes.channelPin(channel_id, message_id), { reason });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { ok: true, unpinned: { channel_id, message_id } },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        await rest.put(Routes.channelPin(channel_id, message_id), { reason });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, pinned: { channel_id, message_id } }, null, 2),
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
