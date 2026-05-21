#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerWhoamiTool } from './tools/whoami.js';
import { registerCredentialTools } from './tools/credentials.js';
import { registerGuildSetupTools } from './tools/guilds.js';
import { registerChannelTools } from './tools/channels.js';
import { registerRoleTools } from './tools/roles.js';
import { registerMessageTools } from './tools/messages.js';
import { registerWelcomeScreenTools } from './tools/welcome-screen.js';
import { registerOnboardingTools } from './tools/onboarding.js';
import { registerAutoModTools } from './tools/automod.js';
import { registerScheduledEventTools } from './tools/scheduled-events.js';
import { registerGuildTools } from './tools/guild.js';
import { registerMemberTools } from './tools/members.js';
import { registerWebhookTools } from './tools/webhooks.js';
import { registerTemplateTools } from './tools/template.js';
import { registerRawTool } from './tools/raw.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

const server = new McpServer({
  name: 'discord',
  version: pkg.version,
});

registerWhoamiTool(server);
registerCredentialTools(server);
registerGuildSetupTools(server);
registerChannelTools(server);
registerRoleTools(server);
registerMessageTools(server);
registerWelcomeScreenTools(server);
registerOnboardingTools(server);
registerAutoModTools(server);
registerScheduledEventTools(server);
registerGuildTools(server);
registerMemberTools(server);
registerWebhookTools(server);
registerTemplateTools(server);
registerRawTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Discord MCP server failed to start:', error);
  process.exit(1);
});
