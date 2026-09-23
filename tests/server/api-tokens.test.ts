import { describe, expect, it } from 'vitest';
import { generateApiToken, hashApiToken, looksLikeApiToken, apiTokenHashesMatch } from '@/server/auth/api-tokens';

describe('api tokens', () => {
  it('generates a token with a recognizable prefix and a stable hash', () => {
    const generated = generateApiToken();
    expect(generated.token.startsWith('yc_live_')).toBe(true);
    expect(looksLikeApiToken(generated.token)).toBe(true);
    expect(hashApiToken(generated.token)).toBe(generated.tokenHash);
    expect(generated.token.endsWith(generated.tokenLast4)).toBe(true);
  });

  it('generates unique tokens on each call', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('does not treat arbitrary bearer values as api tokens', () => {
    expect(looksLikeApiToken('some-mobile-jwt.aaa.bbb')).toBe(false);
  });

  it('matches identical hashes and rejects mismatches', () => {
    const generated = generateApiToken();
    const otherHash = generateApiToken().tokenHash;
    expect(apiTokenHashesMatch(generated.tokenHash, hashApiToken(generated.token))).toBe(true);
    expect(apiTokenHashesMatch(generated.tokenHash, otherHash)).toBe(false);
  });
});
