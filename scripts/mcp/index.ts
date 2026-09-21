#!/usr/bin/env tsx
/// MCP server exposing YumCut's project/template/credential API as tools for
/// an MCP-compatible agent host (e.g. Claude). It talks to the regular REST
/// API over HTTP using a per-user personal access token (YUMCUT_API_TOKEN) --
/// it has no direct database access and enforces no more than the API itself
/// already enforces for that user.
///
/// Run with: npm run mcp:server
/// Required env: YUMCUT_API_TOKEN, YUMCUT_API_BASE_URL (defaults to
/// http://localhost:3000).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerYumCutTools } from './tools';

async function main() {
  const server = new McpServer({
    name: 'yumcut',
    version: '0.1.0',
  });

  registerYumCutTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('YumCut MCP server running on stdio');
}

main().catch((err) => {
  console.error('YumCut MCP server failed to start:', err);
  process.exit(1);
});
