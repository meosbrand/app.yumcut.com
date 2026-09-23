# Driving YumCut from an AI agent (MCP + BYOK)

This adds two things to YumCut that were missing before:

1. **BYOK provider credentials** (`ProviderCredential`) — each user can store their own encrypted
   API key/secret for a provider (OpenAI, Anthropic, Gemini, ElevenLabs, MiniMax, Runware, YouTube
   Data API, or a custom one), instead of relying solely on platform-wide `.env` secrets.
2. **An MCP server** (`scripts/mcp`) that exposes YumCut's project/template/credential API as tools,
   so any MCP-compatible agent host (Claude Desktop, Claude Code, etc.) can drive project creation
   and pipeline status the same way a human does through the web UI — just as tool calls instead of
   clicks.

Both pieces authenticate through a new **personal access token** type (`ApiToken`), which sits
alongside the existing session-cookie and mobile-JWT auth in `authenticateApiRequest`
(`src/server/api-user.ts`). A token scopes the agent to exactly one user's data and permissions;
there is no elevated "service" identity here.

## 1. Configure the encryption secret

Add a random 32+ character value to your `.env`:

```
PROVIDER_CREDENTIAL_SECRET="<random 32+ char string>"
```

Without this set, `POST /api/settings/credentials` returns a `NOT_CONFIGURED` error rather than
storing anything in plaintext.

## 2. Generate a personal access token

From a signed-in session (or any existing auth method), call:

```
POST /api/settings/api-tokens
{ "name": "Claude agent" }
```

The response's `token` field (`yc_live_...`) is shown **once** — store it securely. List existing
tokens with `GET /api/settings/api-tokens` (masked) and revoke one with
`DELETE /api/settings/api-tokens/{tokenId}`.

## 3. (Optional) Store your own provider keys

```
POST /api/settings/credentials
{ "provider": "openai", "label": "my openai key", "value": "sk-..." }
```

`GET /api/settings/credentials` lists credentials with a masked preview only (`sk-a...b91f`); the
encrypted value is never returned. Server-side code resolves a user's own key via
`resolveProviderCredential(userId, provider)` in `src/server/settings/provider-credentials.ts`,
falling back to the platform default when the user hasn't configured one.

## 4. Run the MCP server

```
YUMCUT_API_BASE_URL="http://localhost:3000" \
YUMCUT_API_TOKEN="yc_live_..." \
npm run mcp:server
```

This starts a stdio MCP server (`scripts/mcp/index.ts`) that any MCP-compatible agent harness can
connect to. It's a thin HTTP client (`scripts/mcp/client.ts`) over the existing REST API for the
project/credential tools — no direct database access, so an agent can never do more than the
authenticated user could already do through the UI — plus a local wrapper around the stick-figure
renderer (`scripts/stick-renderer/render-lib.ts`), which runs on whatever machine hosts this MCP
server since it needs a real headless browser.

### Tools exposed today

| Tool | Purpose |
| --- | --- |
| `list_projects` | List the user's projects with status |
| `get_project` | Full project detail (scripts, audio, video, status history) |
| `create_project` | Start a new project from a prompt or exact script |
| `list_templates` | List available art-style/voice/music templates |
| `list_provider_credentials` | List the user's BYOK credentials (masked) |
| `set_provider_credential` | Store/replace a provider API key |
| `delete_provider_credential` | Remove a stored provider credential |
| `validate_stick_scene_script` | Check a stick-figure scene script against its schema, cheaply, without rendering |
| `render_stick_figure_video` | Render a validated scene script to mp4 via the procedural renderer (see docs/stick-renderer.md) |

### Not yet wired up

Publishing/scheduling tools (`schedule_publish_task`, `list_publish_channels`), a trend-research
tool backed by the YouTube Data/Analytics APIs, and the nightly "learning loop" that updates a
prompt/playbook library are follow-up work, not part of this pass. There's also no tool yet that
turns a topic or approved script into a stick-figure scene script -- that's currently the calling
agent's job, using `validate_stick_scene_script` to iterate.

## 5. Connecting an agent harness

Any MCP-native coding agent can drive this server the same way; only the config file differs. All
three below launch the identical command (`npm run mcp:server` in this repo, with a personal
access token), so the tool surface and everything it can/can't do is the same regardless of which
one is doing the driving.

### Claude Code

Project-scoped `.mcp.json` at the repo root (or `claude mcp add yumcut -- npm run mcp:server`):

```json
{
  "mcpServers": {
    "yumcut": {
      "command": "npm",
      "args": ["run", "mcp:server"],
      "cwd": "/path/to/app.yumcut.com",
      "env": {
        "YUMCUT_API_BASE_URL": "http://localhost:3000",
        "YUMCUT_API_TOKEN": "yc_live_..."
      }
    }
  }
}
```

### OpenAI Codex CLI

`~/.codex/config.toml` (or a trusted project-scoped `.codex/config.toml`):

```toml
[mcp_servers.yumcut]
command = "npm"
args = ["run", "mcp:server"]
env = { YUMCUT_API_BASE_URL = "http://localhost:3000", YUMCUT_API_TOKEN = "yc_live_..." }
```

`args`/`command` run relative to Codex's working directory, so either `cd` into the repo before
launching Codex there, or point `command` at an absolute path (e.g. `npm --prefix /path/to/app.yumcut.com`).

### Hermes Agent (Nous Research)

Hermes Agent is MCP-native and MCP-first: it has no fixed built-in tool catalog, so the servers you
configure *are* its tools. Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  yumcut:
    command: "npm"
    args: ["run", "mcp:server"]
    env:
      YUMCUT_API_BASE_URL: "http://localhost:3000"
      YUMCUT_API_TOKEN: "yc_live_..."
    tools:
      include:
        - list_projects
        - get_project
        - create_project
        - list_templates
        - validate_stick_scene_script
        - render_stick_figure_video
```

The `tools.include` allowlist is optional but recommended -- Hermes's own docs call this the
"smallest useful surface" pattern, and it keeps credential-management tools out of an agent's reach
unless you deliberately add them back. Verify the connection with `hermes mcp test yumcut` before
starting a session.
