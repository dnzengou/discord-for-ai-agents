#!/usr/bin/env node

// SessionStart hook — prints a context block for the assistant about
// the discord plugin's current state (token presence, active guild).
// Output is consumed by Claude Code as additionalContext, not shown verbatim.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const dataDir = process.env.CLAUDE_PLUGIN_DATA;

let tokenPresent = false;
let activeGuildLine = '';

if (dataDir) {
  const credPath = join(dataDir, 'credentials.json');
  if (existsSync(credPath)) {
    try {
      const creds = JSON.parse(readFileSync(credPath, 'utf8'));
      tokenPresent = !!(creds?.bot_token || '').trim();
    } catch { /* ignore corrupt creds */ }
  }

  const statePath = join(dataDir, 'state.json');
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      if (state?.active_guild_id) {
        const name = state.active_guild_name ? ` (${state.active_guild_name})` : '';
        activeGuildLine = `\n- Active guild: \`${state.active_guild_id}\`${name}`;
      }
    } catch { /* ignore corrupt state */ }
  }
}

let lines;
if (!tokenPresent) {
  lines = [
    '# Discord plugin status',
    '',
    'No bot token configured. Suggest the user run `/discord:setup` — that walks through creating a bot, getting the token, and picking which server to manage.',
  ];
} else if (!activeGuildLine) {
  lines = [
    '# Discord plugin status',
    '',
    '- Bot token: configured',
    '- Active guild: not set',
    '',
    'Suggest the user run `/discord:setup` to pick an active guild.',
  ];
} else {
  lines = [
    '# Discord plugin status',
    '',
    '- Bot token: configured' + activeGuildLine,
    '',
    'Discord admin tools are ready. Use the `discord_*` tools (or just ask in plain English) to manage the active guild.',
  ];
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
};

process.stdout.write(JSON.stringify(payload));
