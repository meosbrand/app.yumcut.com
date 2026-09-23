import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerYumCutTools } from '../../scripts/mcp/tools';

/// Exercises the MCP tool surface directly (in-process, no stdio subprocess,
/// no network) via the SDK's linked in-memory transport. Covers the
/// stick-figure tools' validation logic; the actual browser render is only
/// covered by tests/stick-renderer/render.e2e.spec.ts, which is excluded
/// from the fast suite.

let client: Client;
let server: McpServer;

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
});

function parseToolJson(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== 'text' || !first.text) throw new Error('Expected a text content block');
  return JSON.parse(first.text);
}

describe('validate_stick_scene_script', () => {
  it('reports a valid script with a scene/duration summary', async () => {
    const result = await client.callTool({
      name: 'validate_stick_scene_script',
      arguments: {
        script: {
          characterDefs: [{ id: 'narrator' }],
          scenes: [
            {
              id: 's1',
              durationSeconds: 3,
              characters: [{ characterId: 'narrator', pose: 'idle', position: { x: 0.5, y: 0.7 } }],
            },
          ],
        },
      },
    });
    const parsed = parseToolJson(result);
    expect(parsed.valid).toBe(true);
    expect(parsed.sceneCount).toBe(1);
    expect(parsed.totalDurationSeconds).toBe(3);
  });

  it('reports validation errors for an unknown characterId', async () => {
    const result = await client.callTool({
      name: 'validate_stick_scene_script',
      arguments: {
        script: {
          characterDefs: [{ id: 'narrator' }],
          scenes: [
            {
              id: 's1',
              durationSeconds: 3,
              characters: [{ characterId: 'ghost', pose: 'idle', position: { x: 0.5, y: 0.7 } }],
            },
          ],
        },
      },
    });
    const parsed = parseToolJson(result);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors[0].message).toMatch(/Unknown characterId/);
  });
});

describe('start_stick_render_job', () => {
  it('rejects a script over the render duration cap without attempting a render', async () => {
    const result = await client.callTool({
      name: 'start_stick_render_job',
      arguments: {
        script: {
          characterDefs: [{ id: 'narrator' }],
          scenes: [
            {
              id: 's1',
              durationSeconds: 60,
              characters: [{ characterId: 'narrator', pose: 'idle', position: { x: 0.5, y: 0.7 } }],
            },
          ].concat(
            Array.from({ length: 10 }, (_, i) => ({
              id: `s${i + 2}`,
              durationSeconds: 60,
              characters: [{ characterId: 'narrator', pose: 'idle', position: { x: 0.5, y: 0.7 } }],
            })),
          ),
        },
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/render limit/);
  });
});
