import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { yumcutFetch, YumCutApiError } from './client';
import { sceneScriptSchema, totalDurationSeconds } from '@/shared/stick-scenes/schema';
import { getRenderJobQueue, readJob, listJobs } from './render-jobs';

const MAX_RENDER_DURATION_SECONDS = 600;
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;

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
        'script cheaply before calling start_stick_render_job, which bundles and renders through a real browser.',
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
    'start_stick_render_job',
    {
      title: 'Start (or wait for) a stick-figure render job',
      description:
        'Renders a validated stick-figure scene script to mp4 using the procedural (no GPU, no diffusion model) ' +
        'renderer in remotion/. A real headless-browser render takes tens of seconds, so by default this enqueues ' +
        'the job and returns immediately with a jobId -- poll it with get_render_job. Pass wait: true to block ' +
        `and return the finished result directly, for short clips. Scripts longer than ${MAX_RENDER_DURATION_SECONDS}s ` +
        'total are rejected up front -- split a long video into several jobs instead.',
      inputSchema: {
        script: sceneScriptSchema,
        outputFileName: z
          .string()
          .max(128)
          .optional()
          .describe('Optional .mp4 filename (basename only, no path separators); a unique name is generated if omitted'),
        wait: z.boolean().optional().describe('Block until the render finishes (or times out) instead of returning immediately'),
        waitTimeoutMs: z.number().int().min(1000).max(120_000).optional(),
      },
      annotations: { title: 'Start stick-figure render job', destructiveHint: false },
    },
    async ({ script, outputFileName, wait, waitTimeoutMs }) => runTool(async () => {
      const duration = totalDurationSeconds(script);
      if (duration > MAX_RENDER_DURATION_SECONDS) {
        throw new Error(
          `Script totals ${duration}s, over the ${MAX_RENDER_DURATION_SECONDS}s render limit. Split it into shorter scripts.`,
        );
      }
      const queue = getRenderJobQueue();
      const job = queue.enqueue(script, outputFileName);
      if (!wait) return job;
      return queue.waitForJob(job.id, waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    }),
  );

  server.registerTool(
    'get_render_job',
    {
      title: 'Get a stick-figure render job',
      description: 'Poll a render job started by start_stick_render_job by id: status is queued, running, done, or error.',
      inputSchema: { jobId: z.string().uuid() },
    },
    async ({ jobId }) => runTool(async () => {
      const job = readJob(jobId);
      if (!job) throw new Error(`No render job found with id ${jobId}`);
      return job;
    }),
  );

  server.registerTool(
    'list_render_jobs',
    {
      title: 'List recent stick-figure render jobs',
      description: 'List recent render jobs (newest first), on this MCP server instance, regardless of who started them.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ limit }) => runTool(() => Promise.resolve(listJobs(limit ?? 20))),
  );
}
