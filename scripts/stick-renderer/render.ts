#!/usr/bin/env tsx
/// CLI entry point for the procedural stick-figure renderer. Bundles the
/// `remotion/` composition and renders a scene script (JSON matching
/// `@/shared/stick-scenes/schema`) to an mp4 -- no GPU, no diffusion model,
/// just code drawing an SVG rig frame by frame. This is the equivalent of
/// what the daemon's external caption-video renderer does for captions;
/// wiring this into the daemon's pipeline as a new job stage is follow-up
/// work (see docs/stick-renderer.md).
///
/// Usage: npm run stick:render -- --scene path/to/scene.json --out out.mp4

import path from 'path';
import fs from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { sceneScriptSchema } from '@/shared/stick-scenes/schema';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = value;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenePath = path.resolve(args.scene ?? 'scripts/stick-renderer/example-scene.json');
  const outPath = path.resolve(args.out ?? 'scripts/stick-renderer/out/render.mp4');

  const raw = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const script = sceneScriptSchema.parse(raw);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const browserExecutable =
    process.env.REMOTION_BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
  const entryPoint = path.resolve('remotion/index.ts');

  console.log(`Bundling ${entryPoint}...`);
  const serveUrl = await bundle({
    entryPoint,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...(config.resolve?.alias ?? {}), '@': path.resolve('src') },
      },
    }),
  });

  console.log('Selecting composition...');
  const composition = await selectComposition({
    serveUrl,
    id: 'StickFigureScenes',
    inputProps: { script },
    browserExecutable: fs.existsSync(browserExecutable) ? browserExecutable : undefined,
  });

  console.log(`Rendering ${composition.durationInFrames} frames at ${composition.fps}fps (${composition.width}x${composition.height})...`);
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outPath,
    inputProps: { script },
    browserExecutable: fs.existsSync(browserExecutable) ? browserExecutable : undefined,
    chromiumOptions: { headless: true },
    onProgress: ({ progress }) => {
      process.stdout.write(`\rRendering: ${Math.round(progress * 100)}%`);
    },
  });

  console.log(`\nDone. Wrote ${outPath}`);
}

main().catch((err) => {
  console.error('Stick-figure render failed:', err);
  process.exit(1);
});
