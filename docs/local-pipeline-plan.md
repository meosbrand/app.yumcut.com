# Local Video Generation Pipeline — Architecture & Implementation Plan

> **Goal:** Transform YumCut into a self-hosted, client-customizable video generation
> pipeline that can use any combination of local AI models and cloud APIs
> (Anthropic, OpenAI, Ollama, Stable Diffusion, Coqui TTS, etc.).

---

## Table of Contents

1. [Current Architecture Summary](#1-current-architecture-summary)
2. [Target Architecture Overview](#2-target-architecture-overview)
3. [Provider Abstraction Layer](#3-provider-abstraction-layer)
4. [Script Generation Providers](#4-script-generation-providers)
5. [Voice / TTS Providers](#5-voice--tts-providers)
6. [Image Generation Providers](#6-image-generation-providers)
7. [Video Assembly (Local Pipeline)](#7-video-assembly-local-pipeline)
8. [Per-Client Customization](#8-per-client-customization)
9. [Configuration System Changes](#9-configuration-system-changes)
10. [Database Schema Changes](#10-database-schema-changes)
11. [File-by-File Change Map](#11-file-by-file-change-map)
12. [Migration Roadmap (Phased)](#12-migration-roadmap-phased)
13. [Risk & Trade-off Analysis](#13-risk--trade-off-analysis)

---

## 1. Current Architecture Summary

### Pipeline Stages (8 phases, run by the daemon)

```
User prompt
  → ProcessScript       (external CLI: `npm run prompt-to-text`)
  → ProcessAudio        (external CLI: ElevenLabs / MiniMax / Inworld)
  → ProcessTranscription
  → ProcessMetadata
  → ProcessCaptionsVideo
  → ProcessImagesGeneration (Runware API + external CLI)
  → ProcessVideoPartsGeneration (external CLI: FFmpeg-based)
  → ProcessVideoMain    (external CLI: FFmpeg merge-layers)
  → Done
```

### Current External Dependencies

| Stage | Provider(s) | Integration Style |
|-------|-------------|-------------------|
| Script generation | Unknown CLI (`npm run prompt-to-text`) in a separate workspace | `child_process.spawn` in `scripts/daemon/helpers/prompt-to-text.ts` |
| Voice / TTS | ElevenLabs, MiniMax, Inworld | `child_process.spawn` to separate CLI repos (`prompt-to-wav`, `audio:minimax`, `audio:inworld`) |
| Image generation | Runware API | Direct HTTP in `src/server/image-generation/runware.ts` |
| Video parts | External CLI (`npm run video:parts`) | `child_process.spawn` in `scripts/daemon/helpers/video.ts` |
| Final video | External CLI (`npm run video:merge`) | `child_process.spawn` in `scripts/daemon/helpers/video.ts` |

### Key Observation

The current system relies on **external CLI tools in separate workspace directories**
(`DAEMON_SCRIPT_WORKSPACE`, `DAEMON_SCRIPT_WORKSPACE_V2`). These are opaque — the
daemon does not know what model or API the CLI uses internally.

---

## 2. Target Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Pipeline Orchestrator                    │
│            (existing daemon executor + job queue)            │
└──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────┘
       │      │      │      │      │      │      │
       ▼      ▼      ▼      ▼      ▼      ▼      ▼
   ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
   │Script││Audio ││Trans-││Meta- ││Cap-  ││Image ││Video │
   │ Gen  ││ Gen  ││cript ││data  ││tions ││ Gen  ││Build │
   └──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘
      │       │       │       │       │       │       │
      ▼       ▼       ▼       ▼       ▼       ▼       ▼
  ┌───────────────────────────────────────────────────────┐
  │              Provider Registry (new)                   │
  │  resolveProvider(stage, clientConfig) → ProviderImpl   │
  └───┬───────┬───────┬───────┬───────┬───────┬───────────┘
      │       │       │       │       │       │
      ▼       ▼       ▼       ▼       ▼       ▼
  ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
  │OpenAI││Anthr-││Ollama││Coqui ││Stable││Local │
  │  API ││opic  ││Local ││ TTS  ││Diff. ││FFmpeg│
  └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘
```

### Design Principles

1. **Provider interfaces** — each pipeline stage has a typed interface; any provider
   that satisfies it can be swapped in.
2. **Registry pattern** — a central registry maps `(stage, providerId)` → implementation.
   Client config selects which provider to use per stage.
3. **Backward compatibility** — the existing external-CLI mode becomes just another
   provider (`cli-legacy`), so nothing breaks during migration.
4. **Local-first option** — every stage can run with a fully local model
   (Ollama for text, Coqui/Piper for TTS, Stable Diffusion for images, FFmpeg for video).
5. **Per-client config** — a `ClientProfile` stored in the DB (or a JSON/YAML file)
   maps each stage to a provider + credentials + model parameters.

---

## 3. Provider Abstraction Layer

### 3.1 New Directory Structure

```
scripts/daemon/providers/
├── index.ts                    # ProviderRegistry + resolveProvider()
├── types.ts                    # Shared provider interfaces
├── script/
│   ├── types.ts                # ScriptProvider interface
│   ├── openai.ts               # OpenAI ChatCompletion
│   ├── anthropic.ts            # Anthropic Messages API
│   ├── ollama.ts               # Local Ollama (llama3, mistral, etc.)
│   └── cli-legacy.ts           # Wraps existing prompt-to-text CLI
├── voice/
│   ├── types.ts                # VoiceProvider interface
│   ├── openai-tts.ts           # OpenAI TTS API
│   ├── elevenlabs.ts           # ElevenLabs direct API (not CLI)
│   ├── coqui.ts                # Coqui TTS (local)
│   ├── piper.ts                # Piper TTS (local, lightweight)
│   └── cli-legacy.ts           # Wraps existing prompt-to-wav CLIs
├── image/
│   ├── types.ts                # ImageProvider interface
│   ├── openai-dalle.ts         # DALL·E 3 API
│   ├── stable-diffusion.ts     # Local Stable Diffusion (A1111 / ComfyUI API)
│   ├── runware.ts              # Existing Runware (refactored)
│   └── cli-legacy.ts           # Wraps existing image CLI
└── video/
    ├── types.ts                # VideoProvider interface
    ├── ffmpeg-local.ts         # Direct FFmpeg invocation (local)
    └── cli-legacy.ts           # Wraps existing video CLIs
```

### 3.2 Core Interfaces

```typescript
// scripts/daemon/providers/types.ts

export type ProviderStage = 'script' | 'voice' | 'image' | 'video';

export interface ProviderMeta {
  id: string;               // e.g. 'openai', 'anthropic', 'ollama'
  stage: ProviderStage;
  label: string;             // Human-readable name
  isLocal: boolean;          // true = no external API calls
  requiresApiKey: boolean;
}

export interface ProviderConfig {
  apiKey?: string;
  apiBaseUrl?: string;       // For self-hosted endpoints (Ollama, A1111)
  model?: string;            // e.g. 'gpt-4o', 'claude-sonnet-4-20250514', 'llama3:8b'
  extraParams?: Record<string, unknown>;
}

export interface ProviderResult<T> {
  data: T;
  usage?: { tokens?: number; cost?: number; durationMs?: number };
  providerMeta: ProviderMeta;
}
```

### 3.3 Provider Registry

```typescript
// scripts/daemon/providers/index.ts

import type { ProviderStage, ProviderConfig } from './types';

type ProviderFactory<T> = (config: ProviderConfig) => T;

const registry = new Map<string, ProviderFactory<unknown>>();

export function registerProvider<T>(
  stage: ProviderStage,
  providerId: string,
  factory: ProviderFactory<T>,
): void {
  registry.set(`${stage}:${providerId}`, factory);
}

export function resolveProvider<T>(
  stage: ProviderStage,
  providerId: string,
  config: ProviderConfig,
): T {
  const key = `${stage}:${providerId}`;
  const factory = registry.get(key) as ProviderFactory<T> | undefined;
  if (!factory) {
    throw new Error(
      `No provider registered for ${stage}:${providerId}. ` +
      `Available: ${[...registry.keys()].filter(k => k.startsWith(stage + ':')).join(', ')}`,
    );
  }
  return factory(config);
}
```

---

## 4. Script Generation Providers

### 4.1 Interface

```typescript
// scripts/daemon/providers/script/types.ts

export interface ScriptGenerationInput {
  prompt: string;
  durationSeconds?: number | null;
  language?: string | null;
  mustHave?: string | null;
  avoid?: string | null;
}

export interface ScriptRefinementInput {
  existingScript: string;
  instructions: string;
  durationSeconds?: number | null;
}

export interface ScriptGenerationOutput {
  text: string;
  model: string;
  tokensUsed?: number;
}

export interface ScriptProvider {
  generate(input: ScriptGenerationInput): Promise<ScriptGenerationOutput>;
  refine(input: ScriptRefinementInput): Promise<ScriptGenerationOutput>;
}
```

### 4.2 Provider Implementations

#### OpenAI

```typescript
// scripts/daemon/providers/script/openai.ts

import type { ProviderConfig } from '../types';
import type { ScriptProvider, ScriptGenerationInput, ScriptRefinementInput, ScriptGenerationOutput } from './types';

export function createOpenAIScriptProvider(config: ProviderConfig): ScriptProvider {
  const apiKey = config.apiKey;
  const model = config.model ?? 'gpt-4o';
  const baseUrl = config.apiBaseUrl ?? 'https://api.openai.com/v1';

  return {
    async generate(input: ScriptGenerationInput): Promise<ScriptGenerationOutput> {
      const systemPrompt = buildSystemPrompt(input);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: input.prompt },
          ],
          max_tokens: 4096,
        }),
      });
      const json = await response.json();
      return {
        text: json.choices[0].message.content,
        model,
        tokensUsed: json.usage?.total_tokens,
      };
    },
    async refine(input: ScriptRefinementInput): Promise<ScriptGenerationOutput> {
      // Similar pattern with existing script in context
    },
  };
}
```

#### Anthropic

```typescript
// scripts/daemon/providers/script/anthropic.ts
// Uses Anthropic Messages API (https://docs.anthropic.com/en/api/messages)
// model: 'claude-sonnet-4-20250514', 'claude-3-haiku', etc.
// Endpoint: POST https://api.anthropic.com/v1/messages
// Header: x-api-key, anthropic-version: '2023-06-01'
```

#### Ollama (Local)

```typescript
// scripts/daemon/providers/script/ollama.ts
// Calls local Ollama API at http://localhost:11434/api/generate
// Models: llama3:8b, mistral:7b, phi3, etc.
// No API key needed, fully offline
// config.apiBaseUrl defaults to 'http://localhost:11434'
```

#### CLI Legacy (Backward-Compatible)

```typescript
// scripts/daemon/providers/script/cli-legacy.ts
// Wraps the existing prompt-to-text.ts logic
// Uses DAEMON_SCRIPT_WORKSPACE + child_process.spawn
// This is the zero-risk migration path
```

### 4.3 Integration Point

**File to modify:** `scripts/daemon/helpers/executor/script-phase.ts`

Current code calls `generateScript()` / `refineScript()` from `prompt-to-text.ts` directly.

**Change:** Resolve the script provider from the client config, then call `provider.generate()` instead.

```typescript
// Before (script-phase.ts):
const result = await generateScript({ prompt, durationSeconds, mustHave, avoid, language });

// After:
const provider = resolveProvider<ScriptProvider>('script', clientConfig.scriptProvider, clientConfig.scriptProviderConfig);
const result = await provider.generate({ prompt, durationSeconds, language, mustHave, avoid });
```

---

## 5. Voice / TTS Providers

### 5.1 Interface

```typescript
// scripts/daemon/providers/voice/types.ts

export interface VoiceGenerationInput {
  text: string;
  voiceId: string;
  languageCode: string;
  style?: string | null;
  outputDir: string;          // Where to write WAV files
  takeCount: number;          // Number of alternative takes (1-3)
}

export interface VoiceGenerationOutput {
  outputs: Array<{ path: string; take: number }>;
  durationMs?: number;
}

export interface VoiceProvider {
  generate(input: VoiceGenerationInput): Promise<VoiceGenerationOutput>;
  listVoices?(): Promise<Array<{ id: string; name: string; languages: string[] }>>;
}
```

### 5.2 Provider Implementations

| Provider | Type | Notes |
|----------|------|-------|
| `openai-tts` | Cloud API | OpenAI TTS (`tts-1`, `tts-1-hd`). 6 voices. Simple HTTP POST. |
| `elevenlabs` | Cloud API | Direct API call (replace CLI wrapper). Voice cloning support. |
| `coqui` | Local | Coqui TTS / XTTS v2. GPU recommended. Multi-language, voice cloning. |
| `piper` | Local | Piper TTS. CPU-friendly, fast, limited voices. |
| `cli-legacy` | CLI | Wraps existing `prompt-to-wav` / `audio:minimax` / `audio:inworld` CLIs |

### 5.3 Integration Point

**File to modify:** `scripts/daemon/helpers/executor/audio-phase.ts`

Current code calls `generateVoiceovers()` from `prompt-to-wav.ts`, which internally
routes to one of three CLI runners based on `voiceProvider`.

**Change:** Resolve provider from registry; the CLI-legacy provider wraps existing behavior.

```typescript
// Before (audio-phase.ts):
const result = await generateVoiceovers({ text, voice, voiceProvider, ... });

// After:
const provider = resolveProvider<VoiceProvider>('voice', clientConfig.voiceProvider, clientConfig.voiceProviderConfig);
const result = await provider.generate({ text, voiceId, languageCode, outputDir, takeCount, style });
```

### 5.4 Voice Provider Constants Update

**File to modify:** `src/shared/constants/voice-providers.ts`

Add new provider IDs to the `VOICE_PROVIDERS` array:

```typescript
export const VOICE_PROVIDERS = [
  { id: 'inworld', label: 'Inworld' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  // New providers:
  { id: 'openai-tts', label: 'OpenAI TTS' },
  { id: 'coqui', label: 'Coqui TTS (Local)' },
  { id: 'piper', label: 'Piper TTS (Local)' },
] as const;
```

---

## 6. Image Generation Providers

### 6.1 Interface

```typescript
// scripts/daemon/providers/image/types.ts

export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  style?: string | null;        // Art style guidance
  characterImagePath?: string | null;
  count?: number;               // Number of images
}

export interface ImageGenerationOutput {
  images: Array<{ path: string; index: number }>;
  model: string;
}

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
```

### 6.2 Provider Implementations

| Provider | Type | Notes |
|----------|------|-------|
| `openai-dalle` | Cloud API | DALL·E 3. HTTP POST to `/v1/images/generations`. |
| `stable-diffusion` | Local | Automatic1111 or ComfyUI API (`http://localhost:7860`). Full control over models, LoRAs, samplers. |
| `runware` | Cloud API | Existing Runware integration refactored into provider interface. |
| `cli-legacy` | CLI | Wraps existing image generation CLI. |

### 6.3 Integration Point

**File to modify:** `scripts/daemon/helpers/executor/images-phase.ts`

Current code calls `generateImages()` from `scripts/daemon/helpers/images.ts`.

**Change:** Resolve image provider, call `provider.generate()` with metadata-derived prompts.

### 6.4 Stable Diffusion Local Example

```typescript
// scripts/daemon/providers/image/stable-diffusion.ts

export function createStableDiffusionProvider(config: ProviderConfig): ImageProvider {
  const baseUrl = config.apiBaseUrl ?? 'http://127.0.0.1:7860';
  const model = config.model ?? 'sd_xl_base_1.0';

  return {
    async generate(input) {
      const response = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input.prompt,
          negative_prompt: input.negativePrompt ?? '',
          width: input.width,
          height: input.height,
          steps: 20,
          cfg_scale: 7,
          batch_size: input.count ?? 1,
        }),
      });
      const json = await response.json();
      // Write base64 images to disk, return paths
    },
  };
}
```

---

## 7. Video Assembly (Local Pipeline)

### 7.1 Current State

Video assembly currently uses external CLIs (`npm run video:parts` and
`npm run video:merge`) invoked from separate workspace directories. These CLIs wrap
FFmpeg with custom logic for effects, transitions, and layer merging.

### 7.2 Target: Inline FFmpeg Provider

The video assembly step is already FFmpeg-based. The local provider would invoke
FFmpeg directly using `fluent-ffmpeg` or raw `child_process.spawn`, removing the
dependency on external workspaces.

```typescript
// scripts/daemon/providers/video/types.ts

export interface VideoPartsInput {
  projectId: string;
  workspaceRoot: string;
  metadataJsonPath: string;
  imagesDir: string;
  effectName: string | null;
  audioPath: string;
  targetLanguage: string;
}

export interface VideoPartsOutput {
  mainVideoPath: string;
  logPath: string | null;
}

export interface FinalVideoInput {
  mainVideoPath: string;
  audioPath: string;
  captionsOverlayPath: string | null;
  includeDefaultMusic: boolean;
  addOverlay: boolean;
  watermarkEnabled: boolean;
  customOverlayPath: string | null;
  customMusicPath: string | null;
}

export interface FinalVideoOutput {
  finalVideoPath: string;
  logPath: string | null;
  overlays: unknown;
}

export interface VideoProvider {
  renderParts(input: VideoPartsInput): Promise<VideoPartsOutput>;
  buildFinal(input: FinalVideoInput): Promise<FinalVideoOutput>;
}
```

### 7.3 Integration Points

**Files to modify:**
- `scripts/daemon/helpers/executor/video-parts-phase.ts` — use `provider.renderParts()`
- `scripts/daemon/helpers/executor/video-main-phase.ts` — use `provider.buildFinal()`

---

## 8. Per-Client Customization

### 8.1 Client Profile Concept

Each client (user, organization, or deployment) gets a **ClientProfile** that specifies
which provider to use for each pipeline stage, along with credentials and parameters.

```typescript
// src/shared/types/client-profile.ts

export interface ClientProviderConfig {
  providerId: string;          // e.g. 'openai', 'ollama', 'coqui'
  apiKey?: string;             // Encrypted at rest
  apiBaseUrl?: string;
  model?: string;
  extraParams?: Record<string, unknown>;
}

export interface ClientProfile {
  id: string;
  name: string;
  scriptProvider: ClientProviderConfig;
  voiceProvider: ClientProviderConfig;
  imageProvider: ClientProviderConfig;
  videoProvider: ClientProviderConfig;
  defaults: {
    language: string;
    durationSeconds: number;
    artStyle: string | null;
    voiceId: string | null;
  };
}
```

### 8.2 Configuration Sources (Priority Order)

1. **Project-level override** — a specific project can override providers (e.g., "use
   DALL·E for this one project")
2. **Client profile** — the user/organization default providers
3. **Daemon-level default** — the deployment-wide fallback (from `.daemon.env`)

### 8.3 Configuration Resolution

```typescript
// scripts/daemon/helpers/executor/resolve-config.ts

export function resolveProviderForStage(
  stage: ProviderStage,
  projectOverrides: Partial<ClientProfile> | null,
  clientProfile: ClientProfile,
  daemonDefaults: DaemonConfig,
): { providerId: string; config: ProviderConfig } {
  // 1. Check project-level override
  // 2. Check client profile
  // 3. Fall back to daemon default (cli-legacy)
}
```

### 8.4 Client API Keys Security

- API keys stored in the database **encrypted** (AES-256-GCM, key from env variable)
- Never logged or included in status payloads
- Decrypted only at the moment of provider invocation
- Key rotation support via versioned encryption

---

## 9. Configuration System Changes

### 9.1 New Daemon Environment Variables

```bash
# .daemon.env additions

# Default provider for each stage (used when no client profile is set)
DAEMON_SCRIPT_PROVIDER=cli-legacy        # or: openai, anthropic, ollama
DAEMON_VOICE_PROVIDER=cli-legacy         # or: openai-tts, elevenlabs, coqui, piper
DAEMON_IMAGE_PROVIDER=cli-legacy         # or: openai-dalle, stable-diffusion, runware
DAEMON_VIDEO_PROVIDER=cli-legacy         # or: ffmpeg-local

# API keys for default providers (when not using client profiles)
DAEMON_OPENAI_API_KEY=
DAEMON_ANTHROPIC_API_KEY=
DAEMON_OLLAMA_BASE_URL=http://localhost:11434
DAEMON_STABLE_DIFFUSION_BASE_URL=http://localhost:7860

# Encryption key for client API keys stored in DB
CLIENT_API_KEY_ENCRYPTION_KEY=
```

### 9.2 DaemonConfig Type Extension

**File to modify:** `scripts/daemon/helpers/config.ts`

```typescript
export type DaemonConfig = {
  // ... existing fields ...

  // New fields:
  defaultScriptProvider: string;
  defaultVoiceProvider: string;
  defaultImageProvider: string;
  defaultVideoProvider: string;

  // Provider-specific defaults:
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  ollamaBaseUrl: string;
  stableDiffusionBaseUrl: string;
};
```

---

## 10. Database Schema Changes

### 10.1 New `ClientProfile` Table

```prisma
model ClientProfile {
  id                String   @id @default(cuid())
  userId            String?
  organizationId    String?
  name              String
  isDefault         Boolean  @default(false)

  // Provider selections (JSON with encrypted API keys)
  scriptProvider    Json     // { providerId, model, apiKeyEncrypted, ... }
  voiceProvider     Json
  imageProvider     Json
  videoProvider     Json

  // Defaults
  defaultLanguage   String   @default("en")
  defaultDuration   Int      @default(60)
  defaultArtStyle   String?
  defaultVoiceId    String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  user              User?    @relation(fields: [userId], references: [id])

  @@index([userId])
}
```

### 10.2 Project Table Addition

```prisma
model Project {
  // ... existing fields ...

  // New: optional per-project provider overrides
  providerOverrides  Json?   // Partial<ClientProfile> serialized
  clientProfileId    String?
  clientProfile      ClientProfile? @relation(fields: [clientProfileId], references: [id])
}
```

### 10.3 Provider Usage Tracking

```prisma
model ProviderUsageLog {
  id              String   @id @default(cuid())
  projectId       String
  stage           String   // 'script' | 'voice' | 'image' | 'video'
  providerId      String   // 'openai', 'anthropic', etc.
  model           String?
  tokensUsed      Int?
  estimatedCostUsd Float?
  durationMs      Int?
  success         Boolean
  errorMessage    String?  @db.Text
  createdAt       DateTime @default(now())

  project         Project  @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([providerId, createdAt])
}
```

---

## 11. File-by-File Change Map

### New Files

| File | Purpose |
|------|---------|
| `scripts/daemon/providers/types.ts` | Core provider interfaces, `ProviderConfig`, `ProviderMeta` |
| `scripts/daemon/providers/index.ts` | `ProviderRegistry`, `resolveProvider()`, auto-registration |
| `scripts/daemon/providers/script/types.ts` | `ScriptProvider` interface |
| `scripts/daemon/providers/script/openai.ts` | OpenAI ChatCompletion script generation |
| `scripts/daemon/providers/script/anthropic.ts` | Anthropic Messages API script generation |
| `scripts/daemon/providers/script/ollama.ts` | Local Ollama script generation |
| `scripts/daemon/providers/script/cli-legacy.ts` | Wraps existing `prompt-to-text.ts` |
| `scripts/daemon/providers/voice/types.ts` | `VoiceProvider` interface |
| `scripts/daemon/providers/voice/openai-tts.ts` | OpenAI TTS API |
| `scripts/daemon/providers/voice/elevenlabs.ts` | ElevenLabs direct API |
| `scripts/daemon/providers/voice/coqui.ts` | Coqui TTS (local) |
| `scripts/daemon/providers/voice/piper.ts` | Piper TTS (local) |
| `scripts/daemon/providers/voice/cli-legacy.ts` | Wraps existing `prompt-to-wav.ts` |
| `scripts/daemon/providers/image/types.ts` | `ImageProvider` interface |
| `scripts/daemon/providers/image/openai-dalle.ts` | DALL·E image generation |
| `scripts/daemon/providers/image/stable-diffusion.ts` | Local Stable Diffusion API |
| `scripts/daemon/providers/image/runware.ts` | Refactored existing Runware |
| `scripts/daemon/providers/image/cli-legacy.ts` | Wraps existing image CLI |
| `scripts/daemon/providers/video/types.ts` | `VideoProvider` interface |
| `scripts/daemon/providers/video/ffmpeg-local.ts` | Direct FFmpeg invocation |
| `scripts/daemon/providers/video/cli-legacy.ts` | Wraps existing video CLIs |
| `src/shared/types/client-profile.ts` | `ClientProfile` type definitions |
| `prisma/migrations/XXXX_add_client_profiles/` | DB migration for new tables |

### Modified Files

| File | Change |
|------|--------|
| `scripts/daemon/helpers/config.ts` | Add new env vars for default providers |
| `scripts/daemon/helpers/executor/script-phase.ts` | Use `resolveProvider('script', ...)` instead of direct `generateScript()` |
| `scripts/daemon/helpers/executor/audio-phase.ts` | Use `resolveProvider('voice', ...)` instead of direct `generateVoiceovers()` |
| `scripts/daemon/helpers/executor/images-phase.ts` | Use `resolveProvider('image', ...)` instead of direct `generateImages()` |
| `scripts/daemon/helpers/executor/video-parts-phase.ts` | Use `resolveProvider('video', ...)` for `renderParts()` |
| `scripts/daemon/helpers/executor/video-main-phase.ts` | Use `resolveProvider('video', ...)` for `buildFinal()` |
| `scripts/daemon/helpers/executor/context.ts` | Load client profile into execution context |
| `scripts/daemon/helpers/executor/types.ts` | Add `clientProfile` to `CreationSnapshot` |
| `src/shared/constants/voice-providers.ts` | Add new provider IDs |
| `src/server/admin/voice-providers.ts` | Support admin management of new providers |
| `prisma/schema.prisma` | Add `ClientProfile`, `ProviderUsageLog` models |

### Unchanged (Preserved as `cli-legacy` Providers)

| File | Status |
|------|--------|
| `scripts/daemon/helpers/prompt-to-text.ts` | Preserved; wrapped by `cli-legacy` script provider |
| `scripts/daemon/helpers/prompt-to-wav.ts` | Preserved; wrapped by `cli-legacy` voice provider |
| `scripts/daemon/helpers/images.ts` | Preserved; wrapped by `cli-legacy` image provider |
| `scripts/daemon/helpers/video.ts` | Preserved; wrapped by `cli-legacy` video provider |
| `src/server/image-generation/runware.ts` | Preserved; refactored into provider but original untouched |

---

## 12. Migration Roadmap (Phased)

### Phase 1: Provider Abstraction (No Behavior Change)

**Goal:** Introduce provider interfaces and registry without changing any behavior.

1. Create `scripts/daemon/providers/` directory with types and registry
2. Create `cli-legacy` providers for all 4 stages (wrapping existing code)
3. Register `cli-legacy` as the default for all stages
4. Update daemon config to read `DAEMON_*_PROVIDER` env vars (defaulting to `cli-legacy`)
5. Update each executor phase to go through the provider registry
6. **All tests must pass unchanged** — behavior is identical

**Estimated effort:** 2–3 days  
**Risk:** Low — pure refactor, no new external calls

### Phase 2: Script Generation Providers

**Goal:** Add OpenAI, Anthropic, and Ollama as script generation options.

1. Implement `openai.ts`, `anthropic.ts`, `ollama.ts` script providers
2. Add system prompt templates for video script generation
3. Add provider usage logging
4. Add integration tests with mock HTTP servers
5. Update admin UI to allow provider selection

**Estimated effort:** 3–4 days  
**Risk:** Medium — new API integrations, prompt engineering needed

### Phase 3: Voice / TTS Providers

**Goal:** Add OpenAI TTS, direct ElevenLabs, and local TTS options.

1. Implement `openai-tts.ts` (simplest — single HTTP call)
2. Implement `elevenlabs.ts` (direct API, replacing CLI wrapper)
3. Implement `coqui.ts` or `piper.ts` for local TTS
4. Update voice listing API to include new providers
5. Handle voice ID mapping between providers

**Estimated effort:** 4–5 days  
**Risk:** Medium — audio format handling, voice compatibility

### Phase 4: Image Generation Providers

**Goal:** Add DALL·E and local Stable Diffusion as image options.

1. Implement `openai-dalle.ts`
2. Implement `stable-diffusion.ts` (A1111/ComfyUI API)
3. Refactor existing Runware into provider interface
4. Handle image sizing, format normalization
5. Style prompt adaptation per provider

**Estimated effort:** 3–4 days  
**Risk:** Medium — image quality varies significantly between providers

### Phase 5: Per-Client Profiles & UI

**Goal:** Allow users to configure their own AI providers.

1. Create `ClientProfile` DB migration
2. Build API endpoints for profile CRUD
3. Build admin UI for profile management
4. Build user-facing settings UI for provider selection
5. Integrate profile resolution into daemon executor
6. Add API key encryption/decryption

**Estimated effort:** 5–7 days  
**Risk:** Medium-High — security (key management), UX complexity

### Phase 6: Local Video Pipeline (FFmpeg Direct)

**Goal:** Remove dependency on external video CLIs.

1. Implement `ffmpeg-local.ts` provider
2. Port effect application, transition logic, layer merging to inline code
3. Test with various template types
4. Support custom templates

**Estimated effort:** 5–7 days  
**Risk:** High — complex FFmpeg logic, many edge cases in video assembly

---

## 13. Risk & Trade-off Analysis

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Provider quality variance | High | Offer preview/comparison mode; store provider metadata with each output |
| API key security | High | Encrypt at rest, audit access, never log keys |
| Prompt compatibility | Medium | Per-provider prompt templates; test matrix |
| Local model performance | Medium | Document hardware requirements; fallback to cloud APIs |
| Breaking existing behavior | Low | `cli-legacy` providers ensure backward compatibility |
| Increased daemon complexity | Medium | Keep provider resolution in a single file; comprehensive tests |

### Trade-offs

| Decision | Pro | Con |
|----------|-----|-----|
| Provider registry pattern | Clean abstraction, easy to add providers | Extra indirection layer |
| Per-client profiles in DB | Flexible, multi-tenant | Requires key encryption infra |
| `cli-legacy` as default | Zero-risk migration | Delays removal of external dependencies |
| Inline FFmpeg (Phase 6) | Eliminates workspace dependencies | Large porting effort for video effects |
| Local-first option | Data privacy, no recurring API costs | Requires GPU/CPU resources, lower quality |

### Hardware Requirements for Local Providers

| Provider | CPU | RAM | GPU | Disk |
|----------|-----|-----|-----|------|
| Ollama (llama3:8b) | 4+ cores | 8 GB | Optional (4 GB VRAM recommended) | 5 GB per model |
| Coqui XTTS v2 | 4+ cores | 4 GB | 4 GB VRAM recommended | 2 GB |
| Piper TTS | 2+ cores | 1 GB | Not needed | 100 MB per voice |
| Stable Diffusion XL | 4+ cores | 16 GB | 8+ GB VRAM | 7 GB per model |
| FFmpeg (video) | 4+ cores | 4 GB | Optional (HW encode) | — |

---

## Summary

This plan transforms YumCut from a fixed-provider pipeline into a **pluggable,
multi-provider architecture** while maintaining full backward compatibility. The key
enabler is the **Provider Registry** pattern — a thin abstraction layer that maps
pipeline stages to interchangeable implementations.

**Minimum viable change:** Phase 1 (provider abstraction only) + one new provider
(e.g., OpenAI script generation in Phase 2) demonstrates the entire pattern end-to-end
with minimal risk.

**Full local deployment:** After all 6 phases, the entire pipeline can run on a single
machine with Ollama + Piper TTS + Stable Diffusion + FFmpeg — no cloud APIs required.
