import path from 'path';
import { Config } from '@remotion/cli/config';

// Mirrors the tsconfig `@/*` -> `src/*` path alias for Remotion's own
// webpack bundling (Studio, `remotion render`, `remotion still`), matching
// the webpackOverride in scripts/stick-renderer/render.ts.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...(config.resolve?.alias ?? {}), '@': path.resolve('src') },
  },
}));
