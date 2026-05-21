import { hasBotToken } from './client.js';
import { NoActiveGuildError, getActiveGuildId } from './state.js';

export function tokenGuard() {
  if (hasBotToken()) return null;
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: 'Discord bot token is not configured. Tell the user to run `/discord:setup` — that walks through creating a bot, getting the token, and saving it.',
      },
    ],
  };
}

export function activeGuildGuard() {
  const tg = tokenGuard();
  if (tg) return tg;
  try {
    getActiveGuildId();
    return null;
  } catch (err) {
    if (err instanceof NoActiveGuildError) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: 'No active Discord guild is set. Run `/discord:setup` to pick one, or call discord_set_active_guild with a guild_id from discord_list_guilds.',
          },
        ],
      };
    }
    throw err;
  }
}
