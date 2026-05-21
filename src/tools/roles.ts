import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PermissionFlagsBits, Routes } from 'discord-api-types/v10';
import type { APIRole } from 'discord-api-types/v10';
import { formatDiscordError, getRest } from '../client.js';
import { getActiveGuildId } from '../state.js';
import { activeGuildGuard, tokenGuard } from '../guards.js';
import { getCached, setCached, invalidate } from '../cache.js';

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

const PERMISSION_NAME_TO_BIT: Record<string, bigint> = {};
const PERMISSION_BIT_TO_SNAKE: Array<[bigint, string]> = [];
{
  const seen = new Set<bigint>();
  for (const [pascalName, bit] of Object.entries(PermissionFlagsBits)) {
    const b = bit as bigint;
    const snake = pascalName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    PERMISSION_NAME_TO_BIT[pascalName] = b;
    PERMISSION_NAME_TO_BIT[snake] = b;
    PERMISSION_NAME_TO_BIT[snake.toUpperCase()] = b;
    if (!seen.has(b)) {
      seen.add(b);
      PERMISSION_BIT_TO_SNAKE.push([b, snake]);
    }
  }
}

function namesToPermissionString(names: string[]): string {
  let bits = 0n;
  const unknown: string[] = [];
  for (const n of names) {
    const bit = PERMISSION_NAME_TO_BIT[n] ?? PERMISSION_NAME_TO_BIT[n.toLowerCase()];
    if (bit === undefined) {
      unknown.push(n);
    } else {
      bits |= bit;
    }
  }
  if (unknown.length) {
    throw new Error(
      `Unknown permission name(s): ${unknown.join(', ')}. Examples: kick_members, ban_members, administrator, manage_channels, manage_roles, send_messages, view_channel, moderate_members.`,
    );
  }
  return bits.toString();
}

function permissionStringToNames(permsStr: string): string[] {
  const bits = BigInt(permsStr);
  const names: string[] = [];
  for (const [bit, name] of PERMISSION_BIT_TO_SNAKE) {
    if ((bits & bit) === bit) names.push(name);
  }
  return names;
}

function resolvePermissions(input: string | string[] | undefined): string | undefined {
  if (input === undefined) return undefined;
  if (Array.isArray(input)) return namesToPermissionString(input);
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return namesToPermissionString(parsed.map(String));
    } catch {
      // fall through
    }
  }
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (trimmed.includes(',')) {
    return namesToPermissionString(
      trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return namesToPermissionString([trimmed]);
}

function colorToInt(input: string | number | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') return input;
  const s = input.startsWith('#') ? input.slice(1) : input;
  return parseInt(s, 16);
}

function colorIntToHex(c: number): string | null {
  if (!c) return null;
  return '#' + c.toString(16).padStart(6, '0').toUpperCase();
}

export function formatRole(r: APIRole): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    name: r.name,
    color: colorIntToHex(r.color),
    color_int: r.color,
    hoist: r.hoist,
    position: r.position,
    permissions: r.permissions,
    permission_names: permissionStringToNames(r.permissions),
    managed: r.managed,
    mentionable: r.mentionable,
  };
  if (r.icon) out.icon = r.icon;
  if (r.unicode_emoji) out.unicode_emoji = r.unicode_emoji;
  if (r.tags) out.tags = r.tags;
  return out;
}

const permissionsInput = z.union([z.array(z.string()), z.string()]);
const colorInput = z.union([z.string(), z.number().int()]);

export function registerRoleTools(server: McpServer): void {
  server.registerTool(
    'discord_list_roles',
    {
      description:
        "Lists all roles in the active guild (GET /guilds/{id}/roles). Returns id, name, color (hex + int), position (higher = higher in hierarchy), permissions (raw bitmask string + decoded snake_case names like 'kick_members'), hoist, mentionable, and managed (true = bot/integration-owned, do NOT modify or delete). The @everyone role's id equals the guild id and always sits at position 0.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      const guildId = getActiveGuildId();
      const cacheKey = `roles:${guildId}`;
      let roles = getCached<APIRole[]>(cacheKey);
      if (!roles) {
        try {
          roles = (await getRest().get(Routes.guildRoles(guildId))) as APIRole[];
          setCached(cacheKey, roles);
        } catch (err) {
          return { isError: true, content: [{ type: 'text' as const, text: formatDiscordError(err) }] };
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: roles.length, roles: roles.map(formatRole) }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'discord_create_role',
    {
      description:
        "Creates a new role in the active guild (POST /guilds/{id}/roles). New roles spawn at the bottom (just above @everyone) — use discord_modify_role_positions to reorder. The bot's highest role must be HIGHER than any role it tries to assign or modify, so creating an admin role above the bot's role makes that role unmanageable by the bot.",
      inputSchema: {
        name: z.string().min(1).max(100).describe('Role name (max 100 chars).'),
        permissions: permissionsInput
          .optional()
          .describe(
            'Permission set. Accepts an array of snake_case names like ["kick_members", "ban_members", "manage_messages"], OR a raw bitmask string like "8" (=Administrator). Names are case-insensitive and accept PascalCase too. Omit for no permissions.',
          ),
        color: colorInput
          .optional()
          .describe('Role color. Hex string ("#FF0000" / "FF0000") or integer. 0 = default (no color).'),
        hoist: z
          .boolean()
          .optional()
          .describe('Display members of this role separately in the member sidebar.'),
        mentionable: z
          .boolean()
          .optional()
          .describe('Allow @mention of this role by anyone.'),
        reason: z.string().max(512).optional().describe('Audit log reason for this action.'),
      },
      annotations: MUTATING,
    },
    async ({ name, permissions, color, hoist, mentionable, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = { name };
        const perms = resolvePermissions(permissions);
        if (perms !== undefined) body.permissions = perms;
        const colorInt = colorToInt(color);
        if (colorInt !== undefined) body.color = colorInt;
        if (hoist !== undefined) body.hoist = hoist;
        if (mentionable !== undefined) body.mentionable = mentionable;
        const guildId = getActiveGuildId();
        const role = (await rest.post(Routes.guildRoles(guildId), {
          body,
          reason,
        })) as APIRole;
        invalidate(`roles:${guildId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, role: formatRole(role) }, null, 2),
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
    'discord_modify_role',
    {
      description:
        "Modifies an existing role (PATCH /guilds/{id}/roles/{role_id}). Pass only the fields to change. To reorder, use discord_modify_role_positions. To change @everyone's default permissions, pass role_id equal to the guild id. Permissions REPLACE the existing set, not merge — pass the full desired set every time.",
      inputSchema: {
        role_id: z
          .string()
          .min(1)
          .describe('The role to modify. Use the guild id to modify the @everyone role.'),
        name: z.string().min(1).max(100).optional(),
        permissions: permissionsInput
          .optional()
          .describe('Replaces the entire permission set. Same input format as discord_create_role.'),
        color: colorInput.optional().describe('Hex string or integer. 0 = no color.'),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ role_id, name, permissions, color, hoist, mentionable, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        const perms = resolvePermissions(permissions);
        if (perms !== undefined) body.permissions = perms;
        const colorInt = colorToInt(color);
        if (colorInt !== undefined) body.color = colorInt;
        if (hoist !== undefined) body.hoist = hoist;
        if (mentionable !== undefined) body.mentionable = mentionable;
        const guildId = getActiveGuildId();
        const role = (await rest.patch(Routes.guildRole(guildId, role_id), {
          body,
          reason,
        })) as APIRole;
        invalidate(`roles:${guildId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, role: formatRole(role) }, null, 2),
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
    'discord_delete_role',
    {
      description:
        "Permanently deletes a role (DELETE /guilds/{id}/roles/{role_id}). All members lose the role. Cannot delete @everyone or managed roles (managed=true in discord_list_roles). Cannot be undone.",
      inputSchema: {
        role_id: z.string().min(1).describe('The role to delete.'),
        reason: z.string().max(512).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ role_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const guildId = getActiveGuildId();
        await rest.delete(Routes.guildRole(guildId, role_id), { reason });
        invalidate(`roles:${guildId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, deleted_role_id: role_id }, null, 2),
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
    'discord_modify_role_positions',
    {
      description:
        "Bulk reorders roles in the active guild (PATCH /guilds/{id}/roles). Pass an array of {id, position} entries. Higher position = higher in the hierarchy and the role list. The bot's own highest role caps how high other roles can be moved. Returns the full updated role list.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              id: z.string().min(1).describe('Role ID to reposition.'),
              position: z
                .number()
                .int()
                .min(0)
                .describe('New sort position (higher = higher in the hierarchy).'),
            }),
          )
          .min(1)
          .describe('Roles to reposition. At least one entry.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ positions, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const guildId = getActiveGuildId();
        const roles = (await rest.patch(Routes.guildRoles(guildId), {
          body: positions,
          reason,
        })) as APIRole[];
        invalidate(`roles:${guildId}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, roles: roles.map(formatRole) }, null, 2),
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
    'discord_assign_role',
    {
      description:
        "Adds a role to a guild member (PUT /guilds/{id}/members/{user_id}/roles/{role_id}). The bot's highest role must be higher than the role being assigned. Returns ok:true on success (Discord returns 204 No Content with no body).",
      inputSchema: {
        user_id: z.string().min(1).describe('The member to receive the role.'),
        role_id: z.string().min(1).describe('The role to assign.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ user_id, role_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.put(Routes.guildMemberRole(getActiveGuildId(), user_id, role_id), { reason });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, user_id, role_id }, null, 2),
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
    'discord_remove_role',
    {
      description:
        "Removes a role from a guild member (DELETE /guilds/{id}/members/{user_id}/roles/{role_id}). Returns ok:true on success (Discord returns 204 No Content with no body).",
      inputSchema: {
        user_id: z.string().min(1).describe('The member to remove the role from.'),
        role_id: z.string().min(1).describe('The role to remove.'),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ user_id, role_id, reason }) => {
      const guard = activeGuildGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        await rest.delete(Routes.guildMemberRole(getActiveGuildId(), user_id, role_id), {
          reason,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, user_id, role_id }, null, 2),
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
    'discord_set_channel_permission_overwrite',
    {
      description:
        "Sets a permission overwrite on a single channel for a role or member (PUT /channels/{channel_id}/permissions/{overwrite_id}). Channel overwrites layer ON TOP of role-level permissions: 'allow' explicitly grants, 'deny' explicitly denies, anything in neither is inherited from the role. Use this to e.g. hide a channel from @everyone but show it to a 'Moderator' role. Pass empty arrays for both allow and deny to leave an explicit no-op overwrite (use the raw API if you need to fully remove an overwrite).",
      inputSchema: {
        channel_id: z.string().min(1).describe('Channel to set the overwrite on.'),
        target_id: z
          .string()
          .min(1)
          .describe(
            "Role ID or user ID to set the overwrite for. To target @everyone, use the guild id.",
          ),
        target_type: z
          .enum(['role', 'member'])
          .describe("'role' to overwrite for a role, 'member' for a single user."),
        allow: permissionsInput
          .optional()
          .describe(
            'Permissions to explicitly grant. Array of snake_case names like ["view_channel", "send_messages"] OR bitmask string. Omit or pass [] for none.',
          ),
        deny: permissionsInput
          .optional()
          .describe(
            'Permissions to explicitly deny. Array of names or bitmask string. Omit or pass [] for none.',
          ),
        reason: z.string().max(512).optional(),
      },
      annotations: MUTATING,
    },
    async ({ channel_id, target_id, target_type, allow, deny, reason }) => {
      const guard = tokenGuard();
      if (guard) return guard;
      try {
        const rest = getRest();
        const allowStr = resolvePermissions(allow) ?? '0';
        const denyStr = resolvePermissions(deny) ?? '0';
        const body = {
          type: target_type === 'role' ? 0 : 1,
          allow: allowStr,
          deny: denyStr,
        };
        await rest.put(Routes.channelPermission(channel_id, target_id), { body, reason });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  channel_id,
                  target_id,
                  target_type,
                  allow: allowStr,
                  allow_names: permissionStringToNames(allowStr),
                  deny: denyStr,
                  deny_names: permissionStringToNames(denyStr),
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
}
