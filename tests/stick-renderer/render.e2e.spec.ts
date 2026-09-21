import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { sceneScriptSchema } from '@/shared/stick-scenes/schema';

/// Genuine end-to-end smoke test: bundles the real `remotion/` composition
/// and renders an actual mp4 through headless Chromium, proving the whole
/// stick-figure pipeline works, not just the pure pose/schema math (see
/// tests/shared/stick-scenes for that). Needs a real browser, so it's
/// excluded from `test:fast` / the pre-commit hook, same as tests/daemon.

const browserExecutable =
  process.env.REMOTION_BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const hasBrowser = fs.existsSync(browserExecutable);

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
  let serveUrl: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stick-renderer-e2e-'));
    serveUrl = await bundle({
      entryPoint: path.resolve('remotion/index.ts'),
      webpackOverride: (config) => ({
        ...config,
        resolve: { ...config.resolve, alias: { ...(config.resolve?.alias ?? {}), '@': path.resolve('src') } },
      }),
    });
  }, 120_000);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('bundles, selects the composition, and renders a valid mp4', async () => {
    const composition = await selectComposition({
      serveUrl,
      id: 'StickFigureScenes',
      inputProps: { script: tinyScript },
      browserExecutable,
    });
    expect(composition.durationInFrames).toBe(15);
    expect(composition.fps).toBe(15);

    const outputLocation = path.join(outDir, 'smoke.mp4');
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      inputProps: { script: tinyScript },
      browserExecutable,
      chromiumOptions: { headless: true },
    });

    const stats = fs.statSync(outputLocation);
    expect(stats.size).toBeGreaterThan(1000);
  }, 120_000);
});
