import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/// Personal access tokens carry a readable prefix so they're easy to spot in
/// logs/diffs and safely revoke, e.g. `yc_live_<43 base64url chars>`.
const TOKEN_PREFIX = 'yc_live_';

export interface GeneratedApiToken {
  token: string;
  tokenHash: string;
  tokenLast4: string;
}

export function generateApiToken(): GeneratedApiToken {
  const secret = randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}${secret}`;
  return {
    token,
    tokenHash: hashApiToken(token),
    tokenLast4: secret.slice(-4),
  };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function looksLikeApiToken(candidate: string): boolean {
  return candidate.startsWith(TOKEN_PREFIX);
}

/// Constant-time comparison guard for callers that already have both hashes
/// (the Prisma unique-index lookup on tokenHash is the primary defense; this
/// exists for any code path that re-checks a candidate against a known hash).
export function apiTokenHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
