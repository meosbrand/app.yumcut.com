import { describe, expect, it, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sceneScriptSchema } from '@/shared/stick-scenes/schema';
import { renderStickFigureScript, DEFAULT_BROWSER_EXECUTABLE } from '../../scripts/stick-renderer/render-lib';

/// Genuine end-to-end smoke test: bundles the real `remotion/` composition
/// and renders an actual mp4 through headless Chromium via the same
/// render-lib the CLI and the `render_stick_figure_video` MCP tool both
/// call, proving the whole stick-figure pipeline works end to end (see
/// tests/shared/stick-scenes for the pure pose/schema math). Needs a real
/// browser, so it's excluded from `test:fast` / the pre-commit hook, same
/// as tests/daemon.

const hasBrowser = fs.existsSync(DEFAULT_BROWSER_EXECUTABLE);

const tinyScript = sceneScriptSchema.parse({
  fps: 15,
  aspect: 'horizontal-16-9',
  characterDefs: [{ id: 'narrator' }],
  scenes: [
    {
      id: 'only-scene',
      durationSeconds: 1,
      background: 'blank',
      characters: [{ characterId: 'narrator', pose: 'idle', position: { x: 0.5, y: 0.7 } }],
      captionText: 'smoke test',
    },
  ],
});

describe.skipIf(!hasBrowser)('stick-figure renderer (e2e)', () => {
  let outDir: string;

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('bundles, renders, and writes a valid mp4', async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stick-renderer-e2e-'));
    const outPath = path.join(outDir, 'smoke.mp4');

    const result = await renderStickFigureScript({ script: tinyScript, outPath });

    expect(result.durationInFrames).toBe(15);
    expect(result.fps).toBe(15);
    const stats = fs.statSync(outPath);
    expect(stats.size).toBeGreaterThan(1000);
  }, 120_000);
});
