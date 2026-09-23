/// Thin HTTP client the MCP tools use to call the existing YumCut REST API,
/// authenticated with a personal access token (see `/api/settings/api-tokens`).
/// This intentionally does not touch Prisma/the database directly: the MCP
/// server is a separate process (possibly on a separate machine) and should
/// only ever act through the same authorized, validated API surface a human
/// user goes through in the browser.

const BASE_URL = (process.env.YUMCUT_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_TOKEN = process.env.YUMCUT_API_TOKEN;

export class YumCutApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'YumCutApiError';
  }
}

function requireToken(): string {
  if (!API_TOKEN) {
    throw new Error(
      'YUMCUT_API_TOKEN is not set. Generate one from Account settings or POST /api/settings/api-tokens, ' +
        'then set it in the MCP server environment.',
    );
  }
  return API_TOKEN;
}

export async function yumcutFetch<T>(
  path: string,
  init?: { method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'; body?: unknown },
): Promise<T> {
  const token = requireToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = json?.error;
    throw new YumCutApiError(
      res.status,
      err?.code ?? 'UNKNOWN_ERROR',
      err?.message ?? `Request failed with status ${res.status}`,
      err?.details,
    );
  }

  return json as T;
}
