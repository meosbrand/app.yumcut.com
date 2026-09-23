/// Async, filesystem-persisted render job queue -- the same pattern
/// HyperFrames (HeyGen's self-hosted rendering MCP server) uses for the
/// identical problem: a headless-browser render takes tens of seconds to
/// minutes and must not hold an MCP/HTTP request open. `start_stick_render_job`
/// enqueues and returns a job id immediately (or blocks briefly with
/// `wait: true` for short clips); `get_render_job` polls it.
///
/// Jobs are written to disk as they progress, so `list_render_jobs`/
/// `get_render_job` survive an MCP server restart -- though an in-flight
/// render does not resume; `reconcileInterruptedJobs` marks it as
/// interrupted rather than pretending it completed.

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SceneScript } from '@/shared/stick-scenes/schema';
import { renderStickFigureScript, type RenderStickFigureResult } from '../stick-renderer/render-lib';

export type RenderJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface RenderJobRecord {
  id: string;
  status: RenderJobStatus;
  createdAt: string;
  updatedAt: string;
  outPath: string;
  result?: RenderStickFigureResult;
  error?: string;
}

export type RenderRunner = (opts: { script: SceneScript; outPath: string }) => Promise<RenderStickFigureResult>;

function jobsDir(): string {
  return path.resolve(process.env.STICK_RENDER_JOBS_DIR || 'scripts/stick-renderer/out/jobs');
}

function outputDir(): string {
  return path.resolve(process.env.STICK_RENDER_OUTPUT_DIR || 'scripts/stick-renderer/out/renders');
}

function jobFilePath(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

function writeJob(record: RenderJobRecord): void {
  fs.mkdirSync(jobsDir(), { recursive: true });
  fs.writeFileSync(jobFilePath(record.id), JSON.stringify(record, null, 2));
}

export function readJob(id: string): RenderJobRecord | null {
  try {
    return JSON.parse(fs.readFileSync(jobFilePath(id), 'utf8')) as RenderJobRecord;
  } catch {
    return null;
  }
}

export function listJobs(limit = 20): RenderJobRecord[] {
  const dir = jobsDir();
  if (!fs.existsSync(dir)) return [];
  const records = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RenderJobRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is RenderJobRecord => r !== null);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/// Call once at server startup: a job still marked "queued"/"running" from
/// a prior process means that process died mid-render, not that the job is
/// progressing -- mark it honestly rather than leaving callers polling
/// forever.
export function reconcileInterruptedJobs(): void {
  for (const job of listJobs(1000)) {
    if (job.status === 'queued' || job.status === 'running') {
      writeJob({ ...job, status: 'error', error: 'Interrupted by server restart', updatedAt: new Date().toISOString() });
    }
  }
}

export class RenderJobQueue {
  private queue: string[] = [];
  private activeCount = 0;
  private pendingInput = new Map<string, { script: SceneScript; outPath: string }>();

  constructor(
    private concurrency: number,
    private runner: RenderRunner,
  ) {}

  enqueue(script: SceneScript, fileName?: string): RenderJobRecord {
    const id = randomUUID();
    const safeBase = (fileName ? path.basename(fileName) : id).replace(/[^a-zA-Z0-9._-]/g, '_');
    const outPath = path.join(outputDir(), safeBase.endsWith('.mp4') ? safeBase : `${safeBase}.mp4`);
    const now = new Date().toISOString();
    const record: RenderJobRecord = { id, status: 'queued', createdAt: now, updatedAt: now, outPath };
    writeJob(record);
    this.pendingInput.set(id, { script, outPath });
    this.queue.push(id);
    this.pump();
    return record;
  }

  async waitForJob(id: string, timeoutMs: number): Promise<RenderJobRecord> {
    const start = Date.now();
    for (;;) {
      const job = readJob(id);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for render job ${id}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) continue;
      const input = this.pendingInput.get(id);
      if (!input) continue;
      this.pendingInput.delete(id);
      this.activeCount += 1;
      this.runJob(id, input)
        .catch(() => {})
        .finally(() => {
          this.activeCount -= 1;
          this.pump();
        });
    }
  }

  private async runJob(id: string, input: { script: SceneScript; outPath: string }): Promise<void> {
    const queued = readJob(id);
    if (queued) writeJob({ ...queued, status: 'running', updatedAt: new Date().toISOString() });
    try {
      const result = await this.runner(input);
      const current = readJob(id);
      if (current) writeJob({ ...current, status: 'done', result, updatedAt: new Date().toISOString() });
    } catch (err) {
      const current = readJob(id);
      if (current) {
        writeJob({
          ...current,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }
}

let singleton: RenderJobQueue | null = null;

/// Production wiring: a process-wide singleton backed by the real renderer.
/// Tests should construct `new RenderJobQueue(...)` directly with a fake
/// runner instead of calling this, so they never spawn a real browser.
export function getRenderJobQueue(): RenderJobQueue {
  if (!singleton) {
    const concurrency = Math.max(1, Number(process.env.STICK_RENDER_CONCURRENCY) || 1);
    singleton = new RenderJobQueue(concurrency, renderStickFigureScript);
  }
  return singleton;
}
