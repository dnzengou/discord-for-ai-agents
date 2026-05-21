#!/usr/bin/env node

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');
const entrypoint = join(pluginRoot, 'dist', 'server.js');

if (!existsSync(entrypoint)) {
  process.stderr.write(
    '[discord-for-ai-agents] dist/server.js not found. Run `npm install && npm run build` in the plugin directory, or restart your AI coding agent so the SessionStart hook can build it.\n'
  );
  process.exit(1);
}

await import(pathToFileURL(entrypoint).href);
