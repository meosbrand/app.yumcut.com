import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_SECRET = process.env.PROVIDER_CREDENTIAL_SECRET;

describe('provider credential crypto', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PROVIDER_CREDENTIAL_SECRET = 'a'.repeat(32);
  });

  afterEach(() => {
    vi.resetModules();
    if (ORIGINAL_SECRET === undefined) delete process.env.PROVIDER_CREDENTIAL_SECRET;
    else process.env.PROVIDER_CREDENTIAL_SECRET = ORIGINAL_SECRET;
  });

  it('round-trips a secret value', async () => {
    const { encryptProviderCredential, decryptProviderCredential } = await import('@/server/crypto/provider-credentials');
    const encrypted = encryptProviderCredential('sk-super-secret-value');
    expect(encrypted).not.toContain('sk-super-secret-value');
    expect(decryptProviderCredential(encrypted)).toBe('sk-super-secret-value');
  });

  it('produces different ciphertext for the same value (random IV)', async () => {
    const { encryptProviderCredential } = await import('@/server/crypto/provider-credentials');
    const a = encryptProviderCredential('same-value');
    const b = encryptProviderCredential('same-value');
    expect(a).not.toBe(b);
  });

  it('masks a value to a short, non-reversible preview', async () => {
    const { maskCredentialValue } = await import('@/server/crypto/provider-credentials');
    expect(maskCredentialValue('sk-abcdefghijklmnop')).toBe('sk-a...mnop');
    expect(maskCredentialValue('short')).toBe('****');
  });

  it('throws a clear error when the secret is not configured', async () => {
    vi.resetModules();
    delete process.env.PROVIDER_CREDENTIAL_SECRET;
    const { encryptProviderCredential } = await import('@/server/crypto/provider-credentials');
    expect(() => encryptProviderCredential('value')).toThrow(/PROVIDER_CREDENTIAL_SECRET/);
  });
});
