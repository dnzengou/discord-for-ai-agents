import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const CREDENTIALS_FILENAME = 'credentials.json';

interface Credentials {
  bot_token?: string;
}

export function getCredentialsPath(): string {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) {
    return join(process.cwd(), '.discord-credentials.json');
  }
  return join(dataDir, CREDENTIALS_FILENAME);
}

export function loadBotToken(): string | undefined {
  const p = getCredentialsPath();
  if (!existsSync(p)) return undefined;
  try {
    const c = JSON.parse(readFileSync(p, 'utf8')) as Credentials;
    const token = (c.bot_token ?? '').trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function saveBotToken(token: string): void {
  const p = getCredentialsPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify({ bot_token: token }, null, 2));
}
