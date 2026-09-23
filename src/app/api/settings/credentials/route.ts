import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { ok, unauthorized, error } from '@/server/http';
import { withApiError } from '@/server/errors';
import { authenticateApiRequest } from '@/server/api-user';
import { upsertProviderCredentialSchema } from '@/server/validators/provider-credentials';
import { encryptProviderCredential, maskCredentialValue } from '@/server/crypto/provider-credentials';

export const GET = withApiError(async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const credentials = await prisma.providerCredential.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, provider: true, label: true, maskedPreview: true, createdAt: true, updatedAt: true, lastUsedAt: true },
  });
  return ok(credentials.map(c => ({
    id: c.id,
    provider: c.provider,
    label: c.label,
    maskedPreview: c.maskedPreview,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
  })));
}, 'Failed to list provider credentials');

export const POST = withApiError(async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();

  const json = await req.json();
  const parsed = upsertProviderCredentialSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]?.message || 'Invalid credential payload';
    return error('VALIDATION_ERROR', first, 400, parsed.error.flatten());
  }
  const { provider, label, value } = parsed.data;

  let encryptedValue: string;
  try {
    encryptedValue = encryptProviderCredential(value);
  } catch (err) {
    return error('NOT_CONFIGURED', (err as Error).message, 500);
  }

  const record = await prisma.providerCredential.upsert({
    where: { userId_provider: { userId: auth.userId, provider } },
    update: { label, encryptedValue, maskedPreview: maskCredentialValue(value) },
    create: { userId: auth.userId, provider, label, encryptedValue, maskedPreview: maskCredentialValue(value) },
    select: { id: true, provider: true, label: true, maskedPreview: true, createdAt: true, updatedAt: true },
  });

  return ok({
    id: record.id,
    provider: record.provider,
    label: record.label,
    maskedPreview: record.maskedPreview,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }, { status: 201 });
}, 'Failed to save provider credential');
