import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { ok, unauthorized, notFound } from '@/server/http';
import { withApiError } from '@/server/errors';
import { authenticateApiRequest } from '@/server/api-user';

export const DELETE = withApiError(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const { tokenId } = await params;

  const existing = await prisma.apiToken.findFirst({ where: { id: tokenId, userId: auth.userId } });
  if (!existing) return notFound('API token not found');

  await prisma.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  return ok({ id: tokenId, revoked: true });
}, 'Failed to revoke API token');
