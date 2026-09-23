import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { ok, unauthorized, notFound } from '@/server/http';
import { withApiError } from '@/server/errors';
import { authenticateApiRequest } from '@/server/api-user';

export const DELETE = withApiError(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ credentialId: string }> },
) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const { credentialId } = await params;

  const existing = await prisma.providerCredential.findFirst({ where: { id: credentialId, userId: auth.userId } });
  if (!existing) return notFound('Provider credential not found');

  await prisma.providerCredential.delete({ where: { id: credentialId } });
  return ok({ id: credentialId, deleted: true });
}, 'Failed to delete provider credential');
