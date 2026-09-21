import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { ok, unauthorized, error } from '@/server/http';
import { withApiError } from '@/server/errors';
import { authenticateApiRequest } from '@/server/api-user';
import { createApiTokenSchema } from '@/server/validators/api-tokens';
import { generateApiToken } from '@/server/auth/api-tokens';

const MAX_ACTIVE_TOKENS_PER_USER = 20;

export const GET = withApiError(async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const tokens = await prisma.apiToken.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, tokenLast4: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return ok(tokens.map(t => ({
    id: t.id,
    name: t.name,
    last4: t.tokenLast4,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
  })));
}, 'Failed to list API tokens');

export const POST = withApiError(async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();

  const json = await req.json();
  const parsed = createApiTokenSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]?.message || 'Invalid token payload';
    return error('VALIDATION_ERROR', first, 400, parsed.error.flatten());
  }

  const activeCount = await prisma.apiToken.count({ where: { userId: auth.userId, revokedAt: null } });
  if (activeCount >= MAX_ACTIVE_TOKENS_PER_USER) {
    return error('TOO_MANY_TOKENS', `You can have at most ${MAX_ACTIVE_TOKENS_PER_USER} active API tokens. Revoke one first.`, 422);
  }

  const generated = generateApiToken();
  const record = await prisma.apiToken.create({
    data: {
      userId: auth.userId,
      name: parsed.data.name,
      tokenHash: generated.tokenHash,
      tokenLast4: generated.tokenLast4,
    },
    select: { id: true, name: true, createdAt: true },
  });

  // The plaintext token is only ever returned here, at creation time.
  return ok({
    id: record.id,
    name: record.name,
    token: generated.token,
    createdAt: record.createdAt.toISOString(),
  }, { status: 201 });
}, 'Failed to create API token');
