import { z } from 'zod';
import path from 'path';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { yumcutFetch, YumCutApiError } from './client';
import { sceneScriptSchema, totalDurationSeconds } from '@/shared/stick-scenes/schema';
import { renderStickFigureScript } from '../stick-renderer/render-lib';

const MAX_RENDER_DURATION_SECONDS = 600;
const RENDER_OUTPUT_DIR = path.resolve('scripts/stick-renderer/out/mcp');

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

  server.registerTool(
    'validate_stick_scene_script',
    {
      title: 'Validate a stick-figure scene script',
      description:
        'Check a stick-figure scene script (the JSON contract in src/shared/stick-scenes/schema.ts: characterDefs, ' +
        'scenes with poses/props/camera/captions) against its schema without rendering. Use this to iterate on a ' +
        'script cheaply before calling render_stick_figure_video, which bundles and renders through a real browser.',
      inputSchema: {
        script: z.unknown().describe('The candidate scene script JSON'),
      },
    },
    async ({ script }) => {
      const result = sceneScriptSchema.safeParse(script);
      if (!result.success) {
        return textResult({ valid: false, errors: result.error.issues });
      }
      return textResult({
        valid: true,
        sceneCount: result.data.scenes.length,
        totalDurationSeconds: totalDurationSeconds(result.data),
      });
    },
  );

  server.registerTool(
    'render_stick_figure_video',
    {
      title: 'Render a stick-figure scene script to mp4',
      description:
        'Renders a validated stick-figure scene script to an mp4 using the procedural (no GPU, no diffusion model) ' +
        'renderer in remotion/. This runs a real headless-browser render on the machine hosting this MCP server and ' +
        `can take tens of seconds; scripts longer than ${MAX_RENDER_DURATION_SECONDS}s total are rejected -- split ` +
        'a long video into several renders instead. Returns the absolute output path plus frame/fps/resolution info.',
      inputSchema: {
        script: sceneScriptSchema,
        outputFileName: z
          .string()
          .max(128)
          .optional()
          .describe('Optional .mp4 filename (basename only, no path separators); a unique name is generated if omitted'),
      },
      annotations: { title: 'Render stick-figure video', destructiveHint: false },
    },
    async ({ script, outputFileName }) => runTool(async () => {
      const duration = totalDurationSeconds(script);
      if (duration > MAX_RENDER_DURATION_SECONDS) {
        throw new Error(
          `Script totals ${duration}s, over the ${MAX_RENDER_DURATION_SECONDS}s render limit. Split it into shorter scripts.`,
        );
      }
      const safeName = (outputFileName ? path.basename(outputFileName) : `${randomUUID()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(RENDER_OUTPUT_DIR, safeName.endsWith('.mp4') ? safeName : `${safeName}.mp4`);
      const result = await renderStickFigureScript({ script, outPath });
      return result;
    }),
  );
}
