import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SceneScript } from '@/shared/stick-scenes/schema';

const tinyScript: SceneScript = {
  fps: 30,
  aspect: 'horizontal-16-9',
  characterDefs: [{ id: 'narrator' }],
  scenes: [
    {
      id: 's1',
      durationSeconds: 1,
      background: 'blank',
      characters: [{ characterId: 'narrator', pose: 'idle', position: { x: 0.5, y: 0.7 } }],
      props: [],
    },
  ],
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-jobs-test-'));
  process.env.STICK_RENDER_JOBS_DIR = path.join(tmpDir, 'jobs');
  process.env.STICK_RENDER_OUTPUT_DIR = path.join(tmpDir, 'renders');
});

afterEach(() => {
  delete process.env.STICK_RENDER_JOBS_DIR;
  delete process.env.STICK_RENDER_OUTPUT_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RenderJobQueue', () => {
  it('enqueues a job as queued and transitions to done once the runner resolves', async () => {
    const { RenderJobQueue, readJob } = await import('../../scripts/mcp/render-jobs');
    const queue = new RenderJobQueue(1, async ({ outPath }) => {
      return { outPath, durationInFrames: 30, fps: 30, width: 1920, height: 1080 };
    });

    const record = queue.enqueue(tinyScript);
    expect(record.status).toBe('queued');

    const finished = await queue.waitForJob(record.id, 5000);
    expect(finished.status).toBe('done');
    expect(finished.result?.durationInFrames).toBe(30);
    expect(readJob(record.id)?.status).toBe('done');
  });

  it('records an error status when the runner rejects', async () => {
    const { RenderJobQueue } = await import('../../scripts/mcp/render-jobs');
    const queue = new RenderJobQueue(1, async () => {
      throw new Error('boom');
    });

    const record = queue.enqueue(tinyScript);
    const finished = await queue.waitForJob(record.id, 5000);
    expect(finished.status).toBe('error');
    expect(finished.error).toMatch(/boom/);
  });

  it('respects the concurrency limit, running the second job only after the first finishes', async () => {
    const { RenderJobQueue, readJob } = await import('../../scripts/mcp/render-jobs');
    let resolveFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const started: string[] = [];

    const queue = new RenderJobQueue(1, async ({ outPath }) => {
      started.push(outPath);
      if (started.length === 1) await firstGate;
      return { outPath, durationInFrames: 1, fps: 30, width: 100, height: 100 };
    });

    const jobA = queue.enqueue(tinyScript, 'a.mp4');
    const jobB = queue.enqueue(tinyScript, 'b.mp4');

    await new Promise((r) => setTimeout(r, 50));
    expect(readJob(jobA.id)?.status).toBe('running');
    expect(readJob(jobB.id)?.status).toBe('queued');

    resolveFirst?.();
    await queue.waitForJob(jobA.id, 5000);
    await queue.waitForJob(jobB.id, 5000);
    expect(started).toHaveLength(2);
  });

  it('lists recent jobs newest first and reconciles interrupted ones on startup', async () => {
    const { RenderJobQueue, listJobs, reconcileInterruptedJobs } = await import('../../scripts/mcp/render-jobs');
    let resolveGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const queue = new RenderJobQueue(2, async ({ outPath }) => {
      await gate;
      return { outPath, durationInFrames: 1, fps: 30, width: 100, height: 100 };
    });

    const job = queue.enqueue(tinyScript);
    await new Promise((r) => setTimeout(r, 20));
    expect(listJobs()[0]?.id).toBe(job.id);

    reconcileInterruptedJobs();
    expect(listJobs()[0]?.status).toBe('error');
    expect(listJobs()[0]?.error).toMatch(/Interrupted/);

    resolveGate?.();
  });
});
