#!/usr/bin/env node

// SessionStart hook — ensures runtime dependencies and built dist/ are in
// place. Skips work when package.json hash matches and dist/server.js exists.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');
const nodeModules = join(pluginRoot, 'node_modules');
const distEntry = join(pluginRoot, 'dist', 'server.js');
const hashFile = join(nodeModules, '.package-hash');

function fileHash(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readHashMarker() {
  try {
    return readFileSync(hashFile, 'utf8').trim();
  } catch {
    return null;
  }
}

function runNpm(args) {
  const result = spawnSync('npm', args, {
    cwd: pluginRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 240_000,
    shell: true,
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return !result.error && result.status === 0;
}

const currentHash = fileHash(join(pluginRoot, 'package.json'));
const cacheValid = currentHash && readHashMarker() === currentHash && existsSync(distEntry);

if (cacheValid) {
  process.exit(0);
}

process.stderr.write('[discord] Installing dependencies...\n');

// Install full deps first (need typescript for build)
if (!runNpm(['install', '--no-audit', '--no-fund'])) {
  process.stderr.write('[discord] Dependency install failed. MCP tools will not work until resolved.\n');
  process.exit(0);
}

process.stderr.write('[discord] Building TypeScript...\n');

if (!runNpm(['run', 'build'])) {
  process.stderr.write('[discord] Build failed. MCP tools will not work until resolved.\n');
  process.exit(0);
}

if (!existsSync(distEntry)) {
  process.stderr.write('[discord] Build completed but dist/server.js missing. MCP tools will not work.\n');
  process.exit(0);
}

try { writeFileSync(hashFile, currentHash); } catch {}

process.stderr.write('[discord] Ready.\n');
