#!/usr/bin/env tsx
/// MCP server exposing YumCut's project/template/credential API, plus the
/// stick-figure renderer, as tools for an MCP-compatible agent host (Claude
/// Code, Codex, Hermes Agent, or any other MCP client). The project/
/// credential tools talk to the regular REST API over HTTP using a
/// per-user personal access token (YUMCUT_API_TOKEN) -- it has no direct
/// database access and enforces no more than the API itself already
/// enforces for that user. The render tools run locally on whatever
/// machine hosts this process, since they need a real headless browser.
///
/// Two transports, chosen by MCP_TRANSPORT (default "stdio"):
///  - stdio: spawned as a subprocess by an agent harness. Run with:
///      npm run mcp:server
///  - http: a standalone, self-hosted service other machines/processes can
///    connect to. Run with:
///      MCP_TRANSPORT=http MCP_HTTP_PORT=8787 MCP_HTTP_ACCESS_TOKEN=... npm run mcp:server
///    See docs/mcp.md for the full self-hosted setup.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerYumCutTools } from './tools';
import { reconcileInterruptedJobs } from './render-jobs';
import { startHttpServer } from './http-server';

async function runStdio() {
  const server = new McpServer({ name: 'yumcut', version: '0.1.0' });
  registerYumCutTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('YumCut MCP server running on stdio');
}

async function runHttp() {
  const port = Number(process.env.MCP_HTTP_PORT) || 8787;
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  if (!process.env.MCP_HTTP_ACCESS_TOKEN) {
    console.error(
      'Warning: MCP_HTTP_ACCESS_TOKEN is not set. Anyone who can reach ' +
        `${host}:${port} can call this server. Fine for 127.0.0.1-only local testing; set a token before binding to any other host.`,
    );
  }
  await startHttpServer(port, host);
  console.error(`YumCut MCP server running on http://${host}:${port} (POST /mcp, GET /files/<name>, GET /health)`);
}

async function main() {
  reconcileInterruptedJobs();
  const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  if (transport === 'http') {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error('YumCut MCP server failed to start:', err);
  process.exit(1);
});
