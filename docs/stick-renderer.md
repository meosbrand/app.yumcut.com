# Procedural stick-figure renderer

A second content engine alongside YumCut's existing diffusion-based image pipeline: instead of
prompting an AI image model per scene, an LLM (or a human) writes a structured **scene script**
(JSON), and this renders it deterministically with code-driven stick figures. No GPU, no
per-frame generation cost, and every render of the same script looks identical.

## Why this exists

Diffusion image-gen struggles to keep a simple line-figure consistent across frames (drifting
proportions, extra limbs), and it's still a slideshow of stills rather than real animation. This
renderer instead uses:

- A pure 2D forward-kinematics rig (`src/shared/stick-scenes/rig.ts`) -- joint angles in, pixel
  positions out. No React, no DOM; fully unit-tested independent of rendering.
- A small named-pose library (`idle`, `walk`, `wave`, `point-left`, `point-right`, `sit`, `think`,
  `explain`, `celebrate`) plus procedural motion (walk cycle, wave oscillation, idle breathing) so
  figures actually move instead of holding frozen poses.
- [Remotion](https://remotion.dev) (`remotion/`) to composite scenes -- background, camera
  pan/zoom, stick figures, line-art icons, arrows, and burned-in captions -- into an mp4 via
  headless Chromium, the same "render frames, stitch with ffmpeg" approach the daemon already uses
  for captions.

## The scene script contract

`src/shared/stick-scenes/schema.ts` is the zod schema an LLM script-writer agent (or a human)
targets. Top level:

```ts
{
  fps: number,               // default 30
  aspect: 'horizontal-16-9' | 'vertical-9-16',
  characterDefs: [{ id, label?, color? }],
  scenes: [{
    id, durationSeconds,
    background: 'blank' | 'whiteboard' | 'grid',
    characters: [{ characterId, pose, position: {x,y}, facing?, scale? }],
    props: [ /* icon | text | arrow */ ],
    camera?: { from, to, fromZoom, toZoom },
    captionText?: string,
  }],
}
```

`position` is normalized (0-1) within the frame and anchors the character's hip -- the rig extends
upward (torso/head) and downward (legs) from that point. See `scripts/stick-renderer/example-scene.json`
for a full worked example (a 5-scene, ~14s explainer).

## Rendering

```
npm run stick:render -- --scene path/to/scene.json --out out.mp4
npm run stick:studio   # interactive Remotion Studio preview
```

Both the CLI and the `render_stick_figure_video` MCP tool (see docs/mcp.md) share the same
implementation, `scripts/stick-renderer/render-lib.ts`, which bundles `remotion/index.ts` and
renders via `@remotion/renderer`. It points at the pre-installed Playwright Chromium headless shell
by default (`REMOTION_BROWSER_EXECUTABLE` env var to override) rather than letting Remotion
download its own browser.

## Driving it from an agent

An MCP-connected agent (Claude Code, Codex, Hermes Agent -- see docs/mcp.md) can call
`validate_stick_scene_script` to check a script cheaply, then `render_stick_figure_video` to render
it, without ever touching this repo's CLI directly. Renders longer than 600s total are rejected by
the tool; split a long video into several scene scripts instead.

## Tests

- `tests/shared/stick-scenes/schema.test.ts`, `rig.test.ts` -- pure logic (schema validation, pose
  math, forward kinematics), run as part of the normal fast suite.
- `tests/mcp/tools.test.ts` -- exercises the MCP tool surface in-process (validation logic, the
  render-duration guard), also in the normal fast suite.
- `tests/stick-renderer/render.e2e.spec.ts` and `mcp-render-tool.e2e.spec.ts` -- real bundle +
  headless-Chromium renders, one through render-lib directly and one through the actual MCP tool
  call, proving the whole pipeline (CLI and agent-facing alike) produces a valid mp4. Both need a
  real browser, so they're excluded from `test:fast`/pre-commit; run them directly with
  `npx vitest run tests/stick-renderer`.

## Not yet wired up

This is a standalone renderer, not yet a daemon job stage: there's no `ProjectStatus` step that
calls it, and no LLM agent that writes scene scripts yet. Follow-up work, in roughly this order:

1. An LLM "VisualDirector" step that turns an approved script into a scene-script JSON (the
   natural next consumer of the MCP/BYOK credentials from the first phase of this project).
2. A new daemon job stage (mirroring how `process_captions_video` shells out to the external
   caption renderer today) that calls `stick:render` and stores the output as a `VideoAsset`.
3. A larger pose library and multi-character scenes (the rig and schema already support more than
   one character per scene; only the example script is single-character).
