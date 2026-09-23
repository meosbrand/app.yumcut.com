import { z } from 'zod';

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(191, 'Name must be at most 191 characters'),
});
