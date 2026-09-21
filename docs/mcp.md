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

This starts a stdio MCP server (`scripts/mcp/index.ts`). Point an MCP-compatible client at it, e.g.
in Claude Desktop / Claude Code config:

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

The MCP server is intentionally a thin HTTP client (`scripts/mcp/client.ts`) over the existing REST
API — it has no direct database access, so an agent can never do more than the authenticated user
could already do through the UI.

### Not yet wired up

Publishing/scheduling tools (`schedule_publish_task`, `list_publish_channels`), a trend-research
tool backed by the YouTube Data/Analytics APIs, and the nightly "learning loop" that updates a
prompt/playbook library are follow-up work, not part of this pass.
