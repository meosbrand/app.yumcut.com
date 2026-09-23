# YumCut Agent Automation: BYOK, MCP, and the Stick-Figure Renderer

This is the reference doc for the agent-facing layer added on top of YumCut: bring-your-own-key
provider credentials, an MCP server any agent harness (Claude Code, Codex, Hermes Agent, or any
other MCP client) can drive, and a procedural stick-figure video renderer with no GPU and no
diffusion model. It's self-contained -- read this and you shouldn't need to jump elsewhere, though
`docs/mcp.md` and `docs/stick-renderer.md` cover the same ground with more surrounding context if
you want it.

## Contents

- [What this is, and why](#what-this-is-and-why)
- [Architecture](#architecture)
- [Quick start](#quick-start)
  - [Path A: render-only, no database](#path-a-render-only-no-database)
  - [Path B: full project/credential tools](#path-b-full-projectcredential-tools)
- [Tool reference](#tool-reference)
- [Connecting an agent harness](#connecting-an-agent-harness)
- [Self-hosted HTTP transport](#self-hosted-http-transport)
- [The async render job queue](#the-async-render-job-queue)
- [The stick-figure renderer](#the-stick-figure-renderer)
- [BYOK provider credentials & personal access tokens](#byok-provider-credentials--personal-access-tokens)
- [Environment variable reference](#environment-variable-reference)
- [Testing](#testing)
- [Security notes](#security-notes)
- [What's not built yet](#whats-not-built-yet)
- [File map](#file-map)

## What this is, and why

YumCut's Next.js app + daemon is a solid production/publishing backbone (job queueing,
multi-language, YouTube OAuth publishing, billing), but two things were missing to let an AI agent
drive it end to end instead of a human clicking through the UI:

1. **A way for a user to authorize an agent and bring their own provider keys**, instead of
   everything running through platform-wide `.env` secrets.
2. **A tool surface an agent can actually call** -- and, since the goal was stick-figure YouTube
   content specifically, a rendering engine that doesn't need per-frame diffusion image generation
   (expensive, inconsistent, GPU-hungry) to draw a simple figure.

This adds both: `ApiToken` + `ProviderCredential` (Prisma models, encrypted at rest) for the first,
and an MCP server (`scripts/mcp`) plus a procedural renderer (`remotion/`, `src/shared/stick-scenes/`,
`scripts/stick-renderer/`) for the second.

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │   Agent harness (any MCP client)         │
                         │   Claude Code / Codex / Hermes Agent /   │
                         │   a raw StreamableHTTPClientTransport    │
                         └───────────────┬───────────────────────┬─┘
                                          │ stdio                 │ HTTP (self-hosted)
                                          ▼                       ▼
                         ┌─────────────────────────────────────────┐
                         │   scripts/mcp (this server)              │
                         │   index.ts branches on MCP_TRANSPORT     │
                         └───────┬───────────────────────┬─────────┘
                                 │                        │
              project/credential tools          render tools
           (scripts/mcp/client.ts, HTTP)   (scripts/mcp/render-jobs.ts)
                                 │                        │
                                 ▼                        ▼
                  ┌───────────────────────┐   ┌─────────────────────────────┐
                  │ YumCut REST API        │   │ render-lib.ts               │
                  │ (Next.js app + Prisma  │   │  -> bundles remotion/       │
                  │  + MySQL)               │   │  -> headless Chromium       │
                  │ auth: ApiToken (PAT)   │   │  -> mp4                     │
                  └───────────────────────┘   └─────────────────────────────┘
```

Two independent halves share one MCP process:

- **Project/credential tools** are a thin HTTP client over the *existing* YumCut REST API
  (`scripts/mcp/client.ts`) -- no direct database access, so an agent can never do more than the
  authenticated user could already do through the web UI. These need a running YumCut app + MySQL
  behind `YUMCUT_API_BASE_URL`.
- **Render tools** run entirely locally: they bundle the `remotion/` composition and render through
  a real (headless) browser on whatever machine hosts this MCP server. They need **no** YumCut app,
  no database, nothing but Node and the pre-installed Chromium.

## Quick start

### Path A: render-only, no database

This is the fastest way to see it work. No YumCut app, no MySQL, no personal access token.

```sh
npm install
MCP_TRANSPORT=http MCP_HTTP_PORT=8787 npm run mcp:server
```

From another terminal (or any MCP HTTP client):

```sh
curl -s http://127.0.0.1:8787/health
# {"ok":true}
```

To actually drive it, use an MCP client -- `tests/stick-renderer/http-server.e2e.spec.ts` is a
complete, working example that starts a server and calls `start_stick_render_job` /
`get_render_job` / downloads the result over `GET /files/<name>`:

```sh
npx vitest run tests/stick-renderer/http-server.e2e.spec.ts
```

Or try the CLI directly, which needs no MCP server at all:

```sh
npm run stick:render -- --scene scripts/stick-renderer/example-scene.json --out /tmp/demo.mp4
npm run stick:studio   # interactive Remotion Studio preview in a browser
```

### Path B: full project/credential tools

This needs a running YumCut app (see the root `README.md` / `docs/server.md` for full app setup --
MySQL, `npm run prisma:migrate:deploy`, `npm run dev`).

1. Set `PROVIDER_CREDENTIAL_SECRET` (32+ random chars) in the app's `.env`.
2. Sign in to the app once, then generate a personal access token:
   ```
   POST /api/settings/api-tokens
   { "name": "my agent" }
   ```
   The response's `token` field (`yc_live_...`) is shown **once** -- save it.
3. Run the MCP server with that token:
   ```sh
   YUMCUT_API_BASE_URL="http://localhost:3000" \
   YUMCUT_API_TOKEN="yc_live_..." \
   npm run mcp:server
   ```
4. Connect an agent harness (see below), or call tools directly the same way the e2e tests do.

## Tool reference

| Tool | Needs | Input | Output |
| --- | --- | --- | --- |
| `list_projects` | YumCut API | *(none)* | `[{ id, title, status, createdAt }]` |
| `get_project` | YumCut API | `projectId` (uuid) | Full project: status, scripts, audio candidates, videos, template |
| `create_project` | YumCut API | `prompt` or `rawScript`, `templateId?`, `durationSeconds?`, `voiceId?`, `languages?`, `useExactTextAsScript?` | New project record |
| `list_templates` | YumCut API | `onlyPublic?`, `mine?` | `[{ id, title, description, ... }]` |
| `list_provider_credentials` | YumCut API | *(none)* | `[{ id, provider, label, maskedPreview, ... }]` |
| `set_provider_credential` | YumCut API | `provider` (enum, see below), `label`, `value` | Saved credential (masked) |
| `delete_provider_credential` | YumCut API | `credentialId` (uuid) | `{ id, deleted: true }` |
| `validate_stick_scene_script` | *(local only)* | `script` (any JSON) | `{ valid: true, sceneCount, totalDurationSeconds }` or `{ valid: false, errors }` |
| `start_stick_render_job` | *(local only)* | `script` (validated scene script), `outputFileName?`, `wait?`, `waitTimeoutMs?` | A `RenderJobRecord` (see below); the finished result if `wait: true` |
| `get_render_job` | *(local only)* | `jobId` (uuid) | The current `RenderJobRecord` |
| `list_render_jobs` | *(local only)* | `limit?` (default 20) | Recent `RenderJobRecord[]`, newest first |

`provider` for `set_provider_credential` is one of: `openai`, `anthropic`, `google-gemini`,
`elevenlabs`, `minimax`, `runware`, `youtube-data-api`, `custom`.

A `RenderJobRecord`:

```ts
{
  id: string;                 // uuid
  status: 'queued' | 'running' | 'done' | 'error';
  createdAt: string;          // ISO timestamp
  updatedAt: string;
  outPath: string;            // absolute local path to the mp4
  result?: { outPath, durationInFrames, fps, width, height };
  error?: string;             // present when status is 'error'
}
```

## Connecting an agent harness

Every harness launches the identical stdio command; only the config file differs, so the tool
surface (and everything it can/can't do) is the same no matter which one is driving.

**Claude Code** -- project-scoped `.mcp.json` (or `claude mcp add yumcut -- npm run mcp:server`):

```json
{
  "mcpServers": {
    "yumcut": {
      "command": "npm",
      "args": ["run", "mcp:server"],
      "cwd": "/path/to/app.yumcut.com",
      "env": { "YUMCUT_API_BASE_URL": "http://localhost:3000", "YUMCUT_API_TOKEN": "yc_live_..." }
    }
  }
}
```

**OpenAI Codex CLI** -- `~/.codex/config.toml`:

```toml
[mcp_servers.yumcut]
command = "npm"
args = ["run", "mcp:server"]
env = { YUMCUT_API_BASE_URL = "http://localhost:3000", YUMCUT_API_TOKEN = "yc_live_..." }
```

**Hermes Agent** (Nous Research) -- MCP-native with no fixed tool catalog, so `~/.hermes/config.yaml`
is where its tools come from:

```yaml
mcp_servers:
  yumcut:
    command: "npm"
    args: ["run", "mcp:server"]
    env:
      YUMCUT_API_BASE_URL: "http://localhost:3000"
      YUMCUT_API_TOKEN: "yc_live_..."
    tools:
      include: [list_projects, get_project, create_project, list_templates,
                validate_stick_scene_script, start_stick_render_job, get_render_job, list_render_jobs]
```

The `tools.include` allowlist is optional but recommended (Hermes's own docs call it the "smallest
useful surface" pattern) -- it keeps credential-management tools out of reach unless you
deliberately add them back. Verify with `hermes mcp test yumcut` before starting a session.

Full per-harness detail (Claude Desktop, troubleshooting) is in `docs/mcp.md`.

## Self-hosted HTTP transport

Instead of stdio (an agent harness spawning `npm run mcp:server` as its own subprocess), run it as
a standalone service other machines/processes connect to:

```sh
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8787 \
MCP_HTTP_ACCESS_TOKEN="<random secret>" \
YUMCUT_API_BASE_URL="http://localhost:3000" \
YUMCUT_API_TOKEN="yc_live_..." \
npm run mcp:server
```

Endpoints:

- `POST /mcp` -- the MCP Streamable HTTP transport, stateless (each request gets a fresh server
  instance; there's no per-connection state to keep). Connect with any MCP HTTP client, e.g. the
  SDK's `StreamableHTTPClientTransport`.
- `GET /files/<name>` -- downloads a finished render (the basename of `outPath` from
  `get_render_job`). A remote HTTP client has no access to this process's local filesystem, so this
  is how it actually gets the mp4.
- `GET /health` -- unauthenticated liveness check.

`MCP_HTTP_ACCESS_TOKEN`, when set, is required as `Authorization: Bearer <token>` on every request
except `/health`. **Without it, anything that can reach the port can call the server.** The default
host (`MCP_HTTP_HOST=127.0.0.1`) only accepts local connections, so leaving the token unset is fine
for local-only testing -- set one before binding to `0.0.0.0` or any other host.

This mirrors the dual-transport design of [HyperFrames](https://hyperframes.heygen.com/guides/mcp)
(HeyGen's self-hosted rendering MCP server), which has the identical local-render-server problem.

## The async render job queue

A headless-browser render takes tens of seconds to minutes, so it can't hold an MCP/HTTP request
open. `start_stick_render_job` enqueues and returns a `jobId` immediately by default; poll it with
`get_render_job`. Pass `wait: true` (with an optional `waitTimeoutMs`, default 20s, max 120s) to
block and get the finished result in one call instead -- useful for short clips.

- **Persistence**: every job is written to disk as `<STICK_RENDER_JOBS_DIR>/<id>.json` as it
  progresses (`queued` -> `running` -> `done`/`error`), so `get_render_job`/`list_render_jobs`
  survive an MCP server restart. An in-flight render does **not** resume across a restart --
  `reconcileInterruptedJobs()` (called on every startup) marks anything still `queued`/`running`
  from a prior process as `error: "Interrupted by server restart"` rather than leaving a caller
  polling forever for a render that isn't happening.
- **Concurrency**: capped by `STICK_RENDER_CONCURRENCY` (default `1`) -- each render is a full
  browser instance, so don't raise this past what the host machine can actually handle.
- **Output**: files land under `<STICK_RENDER_OUTPUT_DIR>/<name>.mp4`. `outputFileName` (basename
  only; path separators are stripped) lets you name it, otherwise a uuid is generated.

Implementation: `scripts/mcp/render-jobs.ts`. The queue class (`RenderJobQueue`) takes an injectable
`RenderRunner`, so tests exercise the concurrency/persistence/error-handling logic with a fake
runner and never spawn a real browser; `getRenderJobQueue()` is the process-wide singleton wired to
the real renderer that production code (`scripts/mcp/tools.ts`, `scripts/mcp/http-server.ts`) uses.

## The stick-figure renderer

A second content engine alongside YumCut's existing diffusion-based image pipeline: instead of
prompting an AI image model per scene, an LLM (or a human) writes a structured **scene script**
(JSON), and code renders it deterministically. No GPU, no per-frame generation cost, and every
render of the same script looks identical -- solving the exact problem (expensive, inconsistent,
GPU-hungry diffusion output) that motivated building this instead of reusing YumCut's existing
image-gen pipeline for stick figures.

**The rig** (`src/shared/stick-scenes/rig.ts`): a pure 2D forward-kinematics skeleton -- joint
angles in, pixel positions out. No React, no DOM; fully unit-tested independent of rendering. Nine
named poses (`idle`, `walk`, `wave`, `point-left`, `point-right`, `sit`, `think`, `explain`,
`celebrate`), plus procedural motion layered on top (a real walk cycle, wave oscillation, subtle
idle breathing) so figures move instead of holding frozen poses.

**The scene script contract** (`src/shared/stick-scenes/schema.ts`), the zod schema an agent or
human targets:

```ts
{
  fps?: number,                              // 15-60, default 30
  aspect?: 'horizontal-16-9' | 'vertical-9-16', // default horizontal-16-9 (1920x1080 / 1080x1920)
  characterDefs: [{ id, label?, color? }],   // at least one
  scenes: [{                                  // at least one
    id: string,
    durationSeconds: number,                  // 0.5-60
    background?: 'blank' | 'whiteboard' | 'grid', // default whiteboard
    characters?: [{
      characterId: string,                    // must match a characterDefs id
      pose: 'idle'|'walk'|'wave'|'point-left'|'point-right'|'sit'|'think'|'explain'|'celebrate',
      position: { x: number, y: number },     // 0-1 normalized, anchors the character's hip
      facing?: 'left' | 'right',
      scale?: number,                         // 0.2-3
    }],
    props?: [
      { id, kind: 'icon', position, iconKey: 'lightbulb'|'chat-bubble'|'checkmark'|'cross'|'question-mark'|'gear'|'arrow-right'|'star', scale? },
      { id, kind: 'text', position, text, scale? },
      { id, kind: 'arrow', from: {x,y}, to: {x,y} },
    ],
    camera?: { from: {x,y}, to: {x,y}, fromZoom: number, toZoom: number }, // 0.5-4
    captionText?: string,                     // burned-in caption, max 300 chars
  }],
}
```

See `scripts/stick-renderer/example-scene.json` for a full worked example (a 5-scene, ~14s
explainer). Icons are hand-built SVG line art (`remotion/stick-figure/Icon.tsx`), not emoji/text
glyphs, so they render identically regardless of what fonts are installed on the render host.

**Rendering**: `scripts/stick-renderer/render-lib.ts` bundles `remotion/index.ts` and renders via
`@remotion/renderer`, pointed at the pre-installed Playwright Chromium headless shell by default
(`REMOTION_BROWSER_EXECUTABLE` to override). The CLI (`scripts/stick-renderer/render.ts`,
`npm run stick:render`) and the `start_stick_render_job` MCP tool both call this same function --
one implementation, two entry points.

## BYOK provider credentials & personal access tokens

Two new Prisma models, alongside the existing session-cookie and mobile-JWT auth in
`authenticateApiRequest` (`src/server/api-user.ts`):

- **`ApiToken`** -- personal access tokens (`yc_live_<random>`). Only a SHA-256 hash is stored; the
  plaintext is shown once, at creation (`POST /api/settings/api-tokens`). List with
  `GET /api/settings/api-tokens` (masked to last 4 chars), revoke with
  `DELETE /api/settings/api-tokens/{id}`. A token scopes an agent to exactly one user's data and
  permissions -- there is no elevated "service" identity.
- **`ProviderCredential`** -- per-user, AES-256-GCM encrypted API keys for external providers
  (`POST /api/settings/credentials`), so a user's own OpenAI/ElevenLabs/etc. key can be used instead
  of relying solely on platform-wide `.env` secrets. `GET /api/settings/credentials` returns only a
  masked preview (`sk-a...b91f`) -- the encrypted value is never echoed back. Server-side code
  resolves a user's own key via `resolveProviderCredential(userId, provider)`
  (`src/server/settings/provider-credentials.ts`), falling back to the platform default when unset.

Both are encrypted/hashed using the same AES-256-GCM pattern already used for publish-channel OAuth
tokens (`src/server/crypto/publish-tokens.ts`); `PROVIDER_CREDENTIAL_SECRET` (32+ random chars, set
in the app's `.env`) is required before `ProviderCredential` will store anything.

## Environment variable reference

**MCP server** (`scripts/mcp`, standalone process -- see `mcp.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `8787` | http transport only |
| `MCP_HTTP_HOST` | `127.0.0.1` | http transport only |
| `MCP_HTTP_ACCESS_TOKEN` | *(unset)* | Required as `Bearer` auth once set; strongly recommended before binding beyond `127.0.0.1` |
| `YUMCUT_API_BASE_URL` | `http://localhost:3000` | Base URL for project/credential tools |
| `YUMCUT_API_TOKEN` | *(required for project/credential tools)* | A personal access token (`yc_live_...`) |
| `STICK_RENDER_CONCURRENCY` | `1` | Max concurrent renders |
| `STICK_RENDER_JOBS_DIR` | `scripts/stick-renderer/out/jobs` | Job record storage |
| `STICK_RENDER_OUTPUT_DIR` | `scripts/stick-renderer/out/renders` | Rendered mp4 storage |
| `REMOTION_BROWSER_EXECUTABLE` | pre-installed Playwright headless shell | Override the Chromium binary |

**Main YumCut app** (`.env`, only the additions from this work -- see `example.env` for the rest):

| Variable | Purpose |
| --- | --- |
| `PROVIDER_CREDENTIAL_SECRET` | 32+ random chars; encrypts `ProviderCredential` values at rest |

## Testing

- **Pure logic** (`tests/shared/stick-scenes/`, `tests/server/api-tokens.test.ts`,
  `tests/server/provider-credentials-crypto.test.ts`, `tests/mcp/tools.test.ts`,
  `tests/mcp/render-jobs.test.ts`) -- schema validation, pose/forward-kinematics math, crypto
  round-trips, the MCP tool surface via the SDK's in-memory transport, and the job queue's
  concurrency/persistence logic against a fake runner. No browser, no network. Part of the normal
  `npm run test:fast` / pre-commit suite.
- **Real end-to-end renders** (`tests/stick-renderer/*.e2e.spec.ts`) -- actual bundle +
  headless-Chromium renders through every path: `render-lib` directly, the MCP tool call
  (in-process transport), and the self-hosted HTTP transport over a real socket including the
  `GET /files` download. These need a real browser and take several seconds each, so they're
  excluded from `test:fast`:
  ```sh
  npx vitest run tests/stick-renderer
  ```

## Security notes

- **Least privilege by construction**: the MCP server's project/credential tools only ever call the
  same REST API a browser session would, with the same per-user authorization checks -- there is no
  path for an agent to exceed what the token's owner could do through the UI, and no direct
  database access from the MCP process.
- **The render tools are unauthenticated by identity** (there's no "user" concept for a local
  render) but are guarded by the HTTP transport's access token when self-hosted, and by process
  ownership when run over stdio.
- **`MCP_HTTP_ACCESS_TOKEN` is not optional in any real deployment.** It's only skippable for
  `127.0.0.1`-only local testing, and the server prints a warning on startup if it's unset.
- **Personal access tokens are shown once.** If one leaks, revoke it (`DELETE /api/settings/api-tokens/{id}`)
  -- there's no way to recover the plaintext from the stored hash.
- **Provider credentials are encrypted, not just masked.** Losing `PROVIDER_CREDENTIAL_SECRET` makes
  stored credentials unrecoverable (by design -- there's no backdoor decryption path); rotate it
  deliberately, not accidentally.

## What's not built yet

- **A "VisualDirector" step** that turns a topic or approved script into scene-script JSON. Today an
  agent (or a human) writes that JSON directly, using `validate_stick_scene_script` to iterate. This
  is the natural next piece -- it's what would let the whole pipeline run end to end from a one-line
  topic instead of hand-authored scene JSON.
- **Daemon integration**: the renderer isn't wired into YumCut's `ProjectStatus` pipeline yet, so a
  stick-figure render doesn't produce a `VideoAsset` or show up in a project's normal lifecycle --
  it's currently a standalone tool/CLI.
- **Publishing/scheduling MCP tools** (`schedule_publish_task`, `list_publish_channels`) -- the
  underlying YumCut publish system exists (YouTube OAuth, `PublishTask`), just not exposed here yet.
- **Trend research / the nightly learning loop** -- ingesting YouTube Data/Analytics signals and
  versioning a prompt/playbook library that tomorrow's script-writing draws from. Entirely unbuilt.

## File map

```
src/shared/stick-scenes/
  schema.ts            Scene script zod schema + types (the agent-facing contract)
  rig.ts                Pure forward-kinematics rig, pose library, procedural motion

remotion/
  index.ts, Root.tsx    Remotion composition registration
  StickFigureScene.tsx  Scene compositor: background, camera, figures, props, captions
  stick-figure/
    StickFigure.tsx     SVG rig renderer
    Icon.tsx            Hand-built line-art icon set

scripts/stick-renderer/
  render-lib.ts          renderStickFigureScript() -- shared by the CLI and the MCP tool
  render.ts               CLI entry point (npm run stick:render)
  example-scene.json      Worked example scene script

scripts/mcp/
  index.ts               Entry point; branches on MCP_TRANSPORT
  tools.ts                All registered MCP tools
  client.ts                HTTP client for the YumCut REST API (project/credential tools)
  render-jobs.ts           Async job queue for renders
  http-server.ts           Self-hosted HTTP transport (POST /mcp, GET /files, GET /health)

src/server/auth/api-tokens.ts          PAT generation/hashing
src/server/crypto/provider-credentials.ts  AES-256-GCM encryption for BYOK values
src/server/settings/provider-credentials.ts  resolveProviderCredential() for pipeline code
src/app/api/settings/api-tokens/       PAT CRUD routes
src/app/api/settings/credentials/      ProviderCredential CRUD routes

docs/mcp.md               Narrower MCP/BYOK reference with more surrounding app context
docs/stick-renderer.md    Narrower renderer reference
mcp.env.example            Env var template for scripts/mcp
```
