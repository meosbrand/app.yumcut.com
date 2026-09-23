import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateApiRequest } from '@/server/api-user';
import { generateApiToken, hashApiToken } from '@/server/auth/api-tokens';

const findUniqueUser = vi.hoisted(() => vi.fn());
const findUniqueApiToken = vi.hoisted(() => vi.fn());
const updateApiToken = vi.hoisted(() => vi.fn());

vi.mock('@/server/db', () => ({
  prisma: {
    user: {
      findUnique: findUniqueUser,
    },
    apiToken: {
      findUnique: findUniqueApiToken,
      update: updateApiToken,
    },
  },
}));

vi.mock('@/server/auth', () => ({
  getAuthSession: vi.fn(),
}));

vi.mock('@/server/mobile-auth', () => ({
  verifyMobileAccessToken: vi.fn(),
}));

import { getAuthSession } from '@/server/auth';
import { verifyMobileAccessToken } from '@/server/mobile-auth';

const mockedSession = vi.mocked(getAuthSession);
const mockedVerifyMobile = vi.mocked(verifyMobileAccessToken);

describe('authenticateApiRequest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue({ id: 'session-user', deleted: false });
    findUniqueApiToken.mockReset();
    updateApiToken.mockReset();
    updateApiToken.mockResolvedValue(undefined);
  });

  it('returns api-token context when bearer is a valid personal access token', async () => {
    const generated = generateApiToken();
    findUniqueApiToken.mockResolvedValue({
      id: 'token-1',
      userId: 'user-agent',
      revokedAt: null,
      user: { deleted: false, isAdmin: false, email: 'agent@example.com', name: 'Agent' },
    });
    const req = new NextRequest('http://localhost/api/projects', {
      headers: new Headers({ authorization: `Bearer ${generated.token}` }),
    });

    const result = await authenticateApiRequest(req);

    expect(result).toEqual({
      userId: 'user-agent',
      sessionUser: { id: 'user-agent', email: 'agent@example.com', name: 'Agent', isAdmin: false },
      source: 'api-token',
    });
    expect(findUniqueApiToken).toHaveBeenCalledWith({
      where: { tokenHash: hashApiToken(generated.token) },
      select: expect.anything(),
    });
    expect(mockedVerifyMobile).not.toHaveBeenCalled();
    expect(mockedSession).not.toHaveBeenCalled();
  });

  it('rejects a revoked personal access token', async () => {
    const generated = generateApiToken();
    findUniqueApiToken.mockResolvedValue({
      id: 'token-1',
      userId: 'user-agent',
      revokedAt: new Date(),
      user: { deleted: false, isAdmin: false, email: null, name: null },
    });
    const req = new NextRequest('http://localhost/api/projects', {
      headers: new Headers({ authorization: `Bearer ${generated.token}` }),
    });

    await expect(authenticateApiRequest(req)).resolves.toBeNull();
  });

  it('returns mobile context when bearer token is valid', async () => {
    mockedVerifyMobile.mockResolvedValue({ sub: 'user-mobile' } as any);
    const req = new NextRequest('http://localhost/api/projects', {
      headers: new Headers({ authorization: 'Bearer test-token' }),
    });

    const result = await authenticateApiRequest(req);

    expect(result).toEqual({ userId: 'user-mobile', source: 'mobile' });
    expect(mockedSession).not.toHaveBeenCalled();
  });

  it('falls back to session when bearer is missing', async () => {
    mockedSession.mockResolvedValue({ user: { id: 'session-user', email: 'test@example.com', name: 'Test', isAdmin: true } } as any);
    const req = new NextRequest('http://localhost/api/projects');

    const result = await authenticateApiRequest(req);

    expect(result).toEqual({
      userId: 'session-user',
      sessionUser: { id: 'session-user', email: 'test@example.com', name: 'Test', isAdmin: true },
      source: 'session',
    });
    expect(mockedVerifyMobile).not.toHaveBeenCalled();
  });

  it('returns null when neither auth strategy succeeds', async () => {
    mockedSession.mockResolvedValue(null);
    mockedVerifyMobile.mockResolvedValue(null as any);
    const req = new NextRequest('http://localhost/api/projects');

    await expect(authenticateApiRequest(req)).resolves.toBeNull();
  });
});
