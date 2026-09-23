import { z } from 'zod';

/// Known provider identifiers the pipeline (or an MCP-driven agent) can be
/// pointed at with a user-supplied key. `custom` covers anything not yet
/// listed here (e.g. a self-hosted model gateway).
export const PROVIDER_CREDENTIAL_PROVIDERS = [
  'openai',
  'anthropic',
  'google-gemini',
  'elevenlabs',
  'minimax',
  'runware',
  'youtube-data-api',
  'custom',
] as const;

export type ProviderCredentialProvider = (typeof PROVIDER_CREDENTIAL_PROVIDERS)[number];

export const upsertProviderCredentialSchema = z.object({
  provider: z.enum(PROVIDER_CREDENTIAL_PROVIDERS),
  label: z.string().trim().min(1, 'Label is required').max(191, 'Label must be at most 191 characters'),
  value: z.string().trim().min(1, 'Credential value is required').max(8192, 'Credential value is too long'),
});
