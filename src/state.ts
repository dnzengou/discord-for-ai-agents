import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const STATE_FILENAME = 'state.json';

export interface PluginState {
  active_guild_id?: string;
  active_guild_name?: string;
  bot_user_id?: string;
  bot_username?: string;
  last_verified_at?: string;
}

export function getStatePath(): string {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) {
    return join(process.cwd(), '.discord-state.json');
  }
  return join(dataDir, STATE_FILENAME);
}

export function loadState(): PluginState {
  const p = getStatePath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PluginState;
  } catch {
    return {};
  }
}

export function saveState(next: PluginState): PluginState {
  const p = getStatePath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}

export function patchState(patch: Partial<PluginState>): PluginState {
  const current = loadState();
  return saveState({ ...current, ...patch });
}

export class NoActiveGuildError extends Error {
  constructor() {
    super(
      'No active Discord guild is set. The user should run `/discord:setup` to pick the guild this bot will manage.',
    );
    this.name = 'NoActiveGuildError';
  }
}

export function getActiveGuildId(): string {
  const id = loadState().active_guild_id;
  if (!id) throw new NoActiveGuildError();
  return id;
}
