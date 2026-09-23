/// Shared implementation behind both the CLI (`scripts/stick-renderer/render.ts`)
/// and the `render_stick_figure_video` MCP tool -- bundles the `remotion/`
/// composition and renders a validated scene script to mp4 through headless
/// Chromium. Kept as a plain function (no process.exit, no CLI arg parsing)
/// so it's safe to call from either context.

import path from 'path';
import fs from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { SceneScript } from '@/shared/stick-scenes/schema';

export const DEFAULT_BROWSER_EXECUTABLE =
  process.env.REMOTION_BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

export interface RenderStickFigureOptions {
  script: SceneScript;
  outPath: string;
  browserExecutable?: string;
  onProgress?: (progress: number) => void;
}

export interface RenderStickFigureResult {
  outPath: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export async function renderStickFigureScript(options: RenderStickFigureOptions): Promise<RenderStickFigureResult> {
  const { script, outPath, onProgress } = options;
  const browserExecutable = options.browserExecutable ?? DEFAULT_BROWSER_EXECUTABLE;
  const resolvedBrowserExecutable = fs.existsSync(browserExecutable) ? browserExecutable : undefined;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const serveUrl = await bundle({
    entryPoint: path.resolve('remotion/index.ts'),
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...(config.resolve?.alias ?? {}), '@': path.resolve('src') },
      },
    }),
  });

  const composition = await selectComposition({
    serveUrl,
    id: 'StickFigureScenes',
    inputProps: { script },
    browserExecutable: resolvedBrowserExecutable,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outPath,
    inputProps: { script },
    browserExecutable: resolvedBrowserExecutable,
    chromiumOptions: { headless: true },
    onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
  });

  return {
    outPath,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
  };
}
