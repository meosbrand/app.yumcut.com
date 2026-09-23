#!/usr/bin/env tsx
/// CLI entry point for the procedural stick-figure renderer -- no GPU, no
/// diffusion model, just code drawing an SVG rig frame by frame. Shares its
/// implementation with the `render_stick_figure_video` MCP tool via
/// render-lib.ts. See docs/stick-renderer.md.
///
/// Usage: npm run stick:render -- --scene path/to/scene.json --out out.mp4

import path from 'path';
import fs from 'fs';
import { sceneScriptSchema } from '@/shared/stick-scenes/schema';
import { renderStickFigureScript } from './render-lib';

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

  console.log(`Bundling and rendering ${scenePath}...`);
  const result = await renderStickFigureScript({
    script,
    outPath,
    onProgress: (progress) => process.stdout.write(`\rRendering: ${Math.round(progress * 100)}%`),
  });

  console.log(`\nDone. Wrote ${result.outPath} (${result.durationInFrames} frames @ ${result.fps}fps, ${result.width}x${result.height})`);
}

main().catch((err) => {
  console.error('Stick-figure render failed:', err);
  process.exit(1);
});
