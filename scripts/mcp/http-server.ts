/// Self-hosted network transport for the MCP server, alongside the default
/// stdio mode -- same pattern HyperFrames (HeyGen's self-hosted rendering
/// MCP server) uses: MCP_TRANSPORT=stdio for a harness-spawned subprocess
/// (Claude Code / Codex / Hermes Agent), MCP_TRANSPORT=http to run as a
/// standalone service other machines/processes can connect to, e.g. via
/// the SDK's StreamableHTTPClientTransport.
///
/// Stateless streamable HTTP: each POST /mcp request gets its own McpServer
/// + transport (cheap -- no per-connection state to share), while the
/// render job queue underneath (scripts/mcp/render-jobs.ts) is a
/// process-wide singleton, so a job started in one request is visible to
/// `get_render_job` calls in later ones. Rendered files are served back
/// over GET /files/<name> since a remote HTTP caller has no access to this
/// process's local filesystem.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerYumCutTools } from './tools';

function outputDir(): string {
  return path.resolve(process.env.STICK_RENDER_OUTPUT_DIR || 'scripts/stick-renderer/out/renders');
}

function checkAuth(req: http.IncomingMessage): boolean {
  const expected = process.env.MCP_HTTP_ACCESS_TOKEN;
  if (!expected) return true; // no token configured: rely on host/network binding for access control
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${expected}`;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const server = new McpServer({ name: 'yumcut', version: '0.1.0' });
  registerYumCutTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function handleFileRequest(req: http.IncomingMessage, res: http.ServerResponse, name: string) {
  const safeName = path.basename(decodeURIComponent(name));
  const filePath = path.join(outputDir(), safeName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'content-type': safeName.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream',
    'content-length': stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
}

export function createHttpServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!checkAuth(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (url.pathname === '/mcp' && req.method === 'POST') {
      handleMcpRequest(req, res).catch((err) => {
        if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }

    if (url.pathname.startsWith('/files/') && req.method === 'GET') {
      handleFileRequest(req, res, url.pathname.slice('/files/'.length));
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

export function startHttpServer(port: number, host: string): Promise<http.Server> {
  const server = createHttpServer();
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}
