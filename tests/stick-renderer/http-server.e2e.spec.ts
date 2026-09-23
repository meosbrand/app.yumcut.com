import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../../scripts/mcp/http-server';
import { DEFAULT_BROWSER_EXECUTABLE } from '../../scripts/stick-renderer/render-lib';

/// Proves the self-hosted HTTP transport (MCP_TRANSPORT=http) actually
/// works end to end, not just stdio: starts scripts/mcp/http-server.ts's
/// real Node HTTP server on an ephemeral local port, connects a real MCP
/// HTTP client to it (the same SDK class any remote/self-hosted caller
/// would use), drives the async render-job flow over the wire, then
/// downloads the finished file via GET /files/<name> -- the path a client
/// with no access to this process's local filesystem has to use.

const hasBrowser = fs.existsSync(DEFAULT_BROWSER_EXECUTABLE);

function toolJson(result: Awaited<ReturnType<Client['callTool']>>) {
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

describe.skipIf(!hasBrowser)('self-hosted HTTP MCP transport (e2e)', () => {
  let server: ReturnType<typeof createHttpServer>;
  let baseUrl: string;
  let jobsDir: string;
  let outputDir: string;
  const accessToken = 'test-http-access-token';

  beforeAll(async () => {
    jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-e2e-jobs-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-e2e-renders-'));
    process.env.STICK_RENDER_JOBS_DIR = jobsDir;
    process.env.STICK_RENDER_OUTPUT_DIR = outputDir;
    process.env.MCP_HTTP_ACCESS_TOKEN = accessToken;

    server = createHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.STICK_RENDER_JOBS_DIR;
    delete process.env.STICK_RENDER_OUTPUT_DIR;
    delete process.env.MCP_HTTP_ACCESS_TOKEN;
    fs.rmSync(jobsDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('rejects requests without the access token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('serves a health check with no auth required', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('drives the full render-job flow over real HTTP and downloads the file', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const client = new Client({ name: 'http-e2e-client', version: '0.0.0' });
    await client.connect(transport);

    const started = toolJson(
      await client.callTool({
        name: 'start_stick_render_job',
        arguments: {
          script: {
            fps: 15,
            aspect: 'horizontal-16-9',
            characterDefs: [{ id: 'narrator' }],
            scenes: [
              {
                id: 'only',
                durationSeconds: 1,
                characters: [{ characterId: 'narrator', pose: 'celebrate', position: { x: 0.5, y: 0.7 } }],
                captionText: 'self-hosted http transport smoke test',
              },
            ],
          },
        },
      }),
    );
    expect(started.id).toBeTruthy();

    let job = started;
    const deadline = Date.now() + 90_000;
    while (job.status !== 'done' && job.status !== 'error' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      job = toolJson(await client.callTool({ name: 'get_render_job', arguments: { jobId: started.id } }));
    }
    expect(job.status).toBe('done');

    await client.close();

    const fileName = path.basename(job.outPath as string);
    const fileRes = await fetch(`${baseUrl}/files/${fileName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toBe('video/mp4');
    const bytes = await fileRes.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 120_000);
});
