import { REST } from '@discordjs/rest';
import { loadBotToken } from './credentials.js';

let cachedRest: REST | null = null;
let cachedTokenSignature: string | null = null;

export class MissingTokenError extends Error {
  constructor() {
    super(
      'Discord bot token is not configured. Run `/discord:setup` to set it up.',
    );
    this.name = 'MissingTokenError';
  }
}

export function getBotToken(): string {
  const token = loadBotToken();
  if (!token) throw new MissingTokenError();
  return token;
}

export function hasBotToken(): boolean {
  return !!loadBotToken();
}

export function getRest(): REST {
  const token = getBotToken();
  if (cachedRest && cachedTokenSignature === token) return cachedRest;
  cachedRest = new REST({ version: '10' }).setToken(token);
  cachedTokenSignature = token;
  return cachedRest;
}

export function isMfaEnabled(): boolean {
  const v = (process.env.CLAUDE_PLUGIN_OPTION_MFA_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export interface DiscordApiError {
  status?: number;
  code?: number;
  message?: string;
  rawError?: unknown;
}

export function formatDiscordError(err: unknown): string {
  const e = err as DiscordApiError & { name?: string };
  if (e?.name === 'MissingTokenError' && e?.message) return e.message;
  const status = e?.status ? ` (HTTP ${e.status})` : '';
  const code = e?.code ? ` [code ${e.code}]` : '';
  const msg = e?.message ?? String(err);
  return `Discord API error${status}${code}: ${msg}`;
}
