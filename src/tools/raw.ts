import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatDiscordError, getRest } from '../client.js';
import { tokenGuard } from '../guards.js';

const ESCAPE_HATCH = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

export function registerRawTool(server: McpServer): void {
  server.registerTool(
    'discord_raw_request',
    {
      description:
        "Escape hatch for any Discord REST endpoint not covered by a dedicated tool (e.g., guild widget, integrations, voice regions, sticker packs, application commands). The bot token is sent automatically. Path must start with '/' and reference the API path AFTER the version (e.g., '/guilds/{id}/widget', NOT '/v10/guilds/...'). For mutations, prefer dedicated tools where they exist — this skips the friendly schema layer.",
      inputSchema: {
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
          .describe('HTTP method.'),
        path: z
          .string()
          .min(1)
          .describe(
            "Endpoint path starting with '/'. Example: '/guilds/123/widget' or '/users/@me/connections'. Do NOT include the API version prefix.",
          ),
        body: z
          .record(z.string(), z.any())
          .optional()
          .describe('JSON body for POST/PUT/PATCH/DELETE. Pass an object; it will be serialized.'),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Query string params as a flat object. Values are coerced to strings.'),
        reason: z
          .string()
          .max(512)
          .optional()
          .describe('X-Audit-Log-Reason header for mutating endpoints.'),
      },
      annotations: ESCAPE_HATCH,
    },
    async ({ method, path, body, query, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      if (!path.startsWith('/')) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `path must start with '/'. Got: ${path}`,
            },
          ],
        };
      }
      try {
        const rest = getRest();
        const route = path as `/${string}`;
        const opts: Record<string, unknown> = {};
        if (body !== undefined) opts.body = body;
        if (reason !== undefined) opts.reason = reason;
        if (query) {
          const params: Record<string, string> = {};
          for (const [k, v] of Object.entries(query)) params[k] = String(v);
          opts.query = new URLSearchParams(params);
        }
        let result: unknown;
        switch (method) {
          case 'GET':
            result = await rest.get(route, opts);
            break;
          case 'POST':
            result = await rest.post(route, opts);
            break;
          case 'PUT':
            result = await rest.put(route, opts);
            break;
          case 'PATCH':
            result = await rest.patch(route, opts);
            break;
          case 'DELETE':
            result = await rest.delete(route, opts);
            break;
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, method, path, result: result ?? null },
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
