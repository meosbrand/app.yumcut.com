import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerYumCutTools } from '../../scripts/mcp/tools';
import { DEFAULT_BROWSER_EXECUTABLE } from '../../scripts/stick-renderer/render-lib';

/// Proves the start_stick_render_job / get_render_job MCP tools (not just
/// render-lib itself, covered by render.e2e.spec.ts) drive a real bundle +
/// headless-Chromium render end to end through the async job-queue pattern
/// an agent would actually use: enqueue, poll, download.

const hasBrowser = fs.existsSync(DEFAULT_BROWSER_EXECUTABLE);

function toolJson(result: Awaited<ReturnType<Client['callTool']>>) {
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

describe.skipIf(!hasBrowser)('render job MCP tools (e2e)', () => {
  let client: Client;
  let server: McpServer;
  let jobsDir: string;
  let outputDir: string;

  beforeAll(async () => {
    jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-jobs-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-renders-'));
    process.env.STICK_RENDER_JOBS_DIR = jobsDir;
    process.env.STICK_RENDER_OUTPUT_DIR = outputDir;

    server = new McpServer({ name: 'yumcut-test', version: '0.0.0' });
    registerYumCutTools(server);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    delete process.env.STICK_RENDER_JOBS_DIR;
    delete process.env.STICK_RENDER_OUTPUT_DIR;
    fs.rmSync(jobsDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('enqueues a job, polls it to completion, and produces a real mp4', async () => {
    const startResult = await client.callTool({
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
              characters: [{ characterId: 'narrator', pose: 'wave', position: { x: 0.5, y: 0.7 } }],
              captionText: 'mcp render job smoke test',
            },
          ],
        },
      },
    });
    expect(startResult.isError).toBeFalsy();
    const started = toolJson(startResult);
    expect(started.status).toBe('queued');
    expect(started.id).toBeTruthy();

    let job = started;
    const deadline = Date.now() + 90_000;
    while (job.status !== 'done' && job.status !== 'error' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const polled = await client.callTool({ name: 'get_render_job', arguments: { jobId: started.id } });
      job = toolJson(polled);
    }

    expect(job.status).toBe('done');
    expect(job.result.durationInFrames).toBe(15);
    expect(fs.statSync(job.outPath).size).toBeGreaterThan(1000);

    const listed = await client.callTool({ name: 'list_render_jobs', arguments: {} });
    const jobs = toolJson(listed);
    expect(jobs.some((j: { id: string }) => j.id === started.id)).toBe(true);
  }, 120_000);
});
