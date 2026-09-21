import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { yumcutFetch, YumCutApiError } from './client';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  if (err instanceof YumCutApiError) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `${err.code}: ${err.message}` }],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function runTool<T>(fn: () => Promise<T>) {
  try {
    return textResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

const PROVIDER_CREDENTIAL_PROVIDERS = [
  'openai',
  'anthropic',
  'google-gemini',
  'elevenlabs',
  'minimax',
  'runware',
  'youtube-data-api',
  'custom',
] as const;

export function registerYumCutTools(server: McpServer) {
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: "List the authenticated user's video projects (id, title, status, createdAt).",
      inputSchema: {},
    },
    async () => runTool(() => yumcutFetch('/api/projects')),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'Fetch full details for a single project: pipeline status, scripts, audio candidates, rendered videos, and template.',
      inputSchema: {
        projectId: z.string().uuid().describe('The project id returned by list_projects or create_project'),
      },
    },
    async ({ projectId }) => runTool(() => yumcutFetch(`/api/projects/${projectId}`)),
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Start a new video project. Provide either `prompt` (a topic/idea for the pipeline to write a script from) ' +
        'or `rawScript` (exact script text), plus a `templateId` to control visual/voice style. Returns the new ' +
        'project id; poll get_project to track it through the pipeline stages.',
      inputSchema: {
        prompt: z.string().min(1).max(4000).optional().describe('Topic/idea to generate a script from'),
        rawScript: z.string().min(1).optional().describe('Exact script text to use verbatim'),
        useExactTextAsScript: z.boolean().optional(),
        durationSeconds: z.number().int().min(30).max(1800).optional(),
        templateId: z.string().uuid().optional().describe('A template id from list_templates; controls art style, voice, music'),
        voiceId: z.string().optional(),
        languages: z.array(z.string()).min(1).optional().describe('Target language codes, e.g. ["en"]'),
      },
      annotations: { title: 'Create project', destructiveHint: false },
    },
    async (input) => runTool(() => yumcutFetch('/api/projects', { method: 'POST', body: input })),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description: 'List available video templates (art style, voice style, music, captions) that create_project can reference.',
      inputSchema: {
        onlyPublic: z.boolean().optional(),
        mine: z.boolean().optional(),
      },
    },
    async ({ onlyPublic, mine }) => runTool(() => {
      const qs = new URLSearchParams();
      if (onlyPublic) qs.set('public', '1');
      if (mine) qs.set('mine', '1');
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return yumcutFetch(`/api/templates${suffix}`);
    }),
  );

  server.registerTool(
    'list_provider_credentials',
    {
      title: 'List BYOK provider credentials',
      description:
        "List the user's bring-your-own-key provider credentials (masked previews only, never the secret value).",
      inputSchema: {},
    },
    async () => runTool(() => yumcutFetch('/api/settings/credentials')),
  );

  server.registerTool(
    'set_provider_credential',
    {
      title: 'Set BYOK provider credential',
      description:
        'Store or replace the API key/secret this user wants the pipeline to use for a given provider ' +
        '(e.g. their own OpenAI or ElevenLabs key). The value is encrypted at rest and never echoed back.',
      inputSchema: {
        provider: z.enum(PROVIDER_CREDENTIAL_PROVIDERS),
        label: z.string().min(1).max(191),
        value: z.string().min(1).max(8192).describe('The raw API key/secret. Handle with care; not logged.'),
      },
      annotations: { title: 'Set provider credential', destructiveHint: false },
    },
    async (input) => runTool(() => yumcutFetch('/api/settings/credentials', { method: 'POST', body: input })),
  );

  server.registerTool(
    'delete_provider_credential',
    {
      title: 'Delete BYOK provider credential',
      description: 'Remove a stored provider credential by id (as returned by list_provider_credentials).',
      inputSchema: {
        credentialId: z.string().uuid(),
      },
      annotations: { title: 'Delete provider credential', destructiveHint: true },
    },
    async ({ credentialId }) => runTool(() => yumcutFetch(`/api/settings/credentials/${credentialId}`, { method: 'DELETE' })),
  );
}
