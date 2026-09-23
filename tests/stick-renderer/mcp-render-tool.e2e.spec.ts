import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerYumCutTools } from '../../scripts/mcp/tools';
import { DEFAULT_BROWSER_EXECUTABLE } from '../../scripts/stick-renderer/render-lib';

/// Proves the render_stick_figure_video MCP tool itself (not just the
/// render-lib it wraps, covered by render.e2e.spec.ts) drives a real
/// bundle + headless-Chromium render end to end through the MCP call
/// surface an agent would actually use.

const hasBrowser = fs.existsSync(DEFAULT_BROWSER_EXECUTABLE);

describe.skipIf(!hasBrowser)('render_stick_figure_video (mcp e2e)', () => {
  let client: Client;
  let server: McpServer;
  let outputPath: string | undefined;

  beforeAll(async () => {
    server = new McpServer({ name: 'yumcut-test', version: '0.0.0' });
    registerYumCutTools(server);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    if (outputPath) fs.rmSync(outputPath, { force: true });
  });

  it('renders a tiny script and returns a real mp4 path', async () => {
    const fileName = `mcp-e2e-${Date.now()}.mp4`;
    const result = await client.callTool({
      name: 'render_stick_figure_video',
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
              captionText: 'mcp render tool smoke test',
            },
          ],
        },
        outputFileName: fileName,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    expect(parsed.durationInFrames).toBe(15);
    outputPath = parsed.outPath as string;
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
  }, 120_000);
});
