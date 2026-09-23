import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { config } from '@/server/config';

function getKey() {
  const secret = config.PROVIDER_CREDENTIAL_SECRET;
  if (!secret) return null;
  return createHash('sha256').update(secret).digest();
}

export function encryptProviderCredential(value: string): string {
  const key = getKey();
  if (!key) {
    throw new Error('PROVIDER_CREDENTIAL_SECRET must be configured to store provider credentials');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptProviderCredential(payload: string): string | null {
  const key = getKey();
  if (!key) return null;
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Failed to decrypt provider credential', err);
    return null;
  }
}

/// Masked preview shown in list views, e.g. "sk-p...a91f". Never reversible.
export function maskCredentialValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
