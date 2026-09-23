import { prisma } from '@/server/db';
import { decryptProviderCredential } from '@/server/crypto/provider-credentials';
import type { ProviderCredentialProvider } from '@/server/validators/provider-credentials';

/// Resolves a user's own BYOK credential for a provider, decrypted for
/// immediate use (e.g. by a daemon job or pipeline step). Returns null when
/// the user hasn't configured that provider, so callers can fall back to a
/// platform-wide default key where one exists.
export async function resolveProviderCredential(
  userId: string,
  provider: ProviderCredentialProvider,
): Promise<string | null> {
  const record = await prisma.providerCredential.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { id: true, encryptedValue: true },
  });
  if (!record) return null;
  const value = decryptProviderCredential(record.encryptedValue);
  if (!value) return null;
  prisma.providerCredential.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return value;
}
