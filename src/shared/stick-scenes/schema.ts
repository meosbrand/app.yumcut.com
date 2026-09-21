import { z } from 'zod';

/// The structured "scene script" format the stick-figure renderer consumes.
/// This is the contract an LLM (or a human) targets instead of a diffusion
/// image prompt: every field is a discrete, validated instruction, so a
/// script always renders into the same deterministic output. No GPU, no
/// per-frame generation cost -- see docs/stick-renderer.md.

export const POSE_NAMES = [
  'idle',
  'walk',
  'point-right',
  'point-left',
  'wave',
  'sit',
  'think',
  'explain',
  'celebrate',
] as const;
export type PoseName = (typeof POSE_NAMES)[number];

export const ICON_KEYS = [
  'lightbulb',
  'chat-bubble',
  'checkmark',
  'cross',
  'question-mark',
  'gear',
  'arrow-right',
  'star',
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export const BACKGROUND_KINDS = ['blank', 'whiteboard', 'grid'] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];

export const ASPECT_PRESETS = {
  'horizontal-16-9': { width: 1920, height: 1080 },
  'vertical-9-16': { width: 1080, height: 1920 },
} as const;
export type AspectPreset = keyof typeof ASPECT_PRESETS;

const vec2Schema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const characterDefSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(64).optional(),
  color: z.string().max(32).optional(),
});
export type CharacterDef = z.infer<typeof characterDefSchema>;

export const characterInstructionSchema = z.object({
  characterId: z.string().min(1).max(64),
  pose: z.enum(POSE_NAMES),
  /// Normalized (0-1) position of the character's hip anchor within the
  /// frame -- the rig's torso/head extend upward and legs downward from
  /// this point, matching `computeStickFigurePoints`'s `origin` param.
  position: vec2Schema,
  facing: z.enum(['left', 'right']).optional(),
  scale: z.number().min(0.2).max(3).optional(),
});
export type CharacterInstruction = z.infer<typeof characterInstructionSchema>;

export const propInstructionSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1).max(64),
    kind: z.literal('icon'),
    position: vec2Schema,
    iconKey: z.enum(ICON_KEYS),
    scale: z.number().min(0.2).max(4).optional(),
  }),
  z.object({
    id: z.string().min(1).max(64),
    kind: z.literal('text'),
    position: vec2Schema,
    text: z.string().min(1).max(200),
    scale: z.number().min(0.2).max(4).optional(),
  }),
  z.object({
    id: z.string().min(1).max(64),
    kind: z.literal('arrow'),
    from: vec2Schema,
    to: vec2Schema,
  }),
]);
export type PropInstruction = z.infer<typeof propInstructionSchema>;

export const cameraMoveSchema = z.object({
  from: vec2Schema,
  to: vec2Schema,
  fromZoom: z.number().min(0.5).max(4),
  toZoom: z.number().min(0.5).max(4),
});
export type CameraMove = z.infer<typeof cameraMoveSchema>;

export const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  durationSeconds: z.number().min(0.5).max(60),
  background: z.enum(BACKGROUND_KINDS).default('whiteboard'),
  characters: z.array(characterInstructionSchema).default([]),
  props: z.array(propInstructionSchema).default([]),
  camera: cameraMoveSchema.optional(),
  captionText: z.string().max(300).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

export const sceneScriptSchema = z
  .object({
    fps: z.number().int().min(15).max(60).default(30),
    aspect: z.enum(['horizontal-16-9', 'vertical-9-16']).default('horizontal-16-9'),
    characterDefs: z.array(characterDefSchema).min(1),
    scenes: z.array(sceneSchema).min(1),
  })
  .superRefine((script, ctx) => {
    const knownIds = new Set(script.characterDefs.map((c) => c.id));
    script.scenes.forEach((scene, sceneIndex) => {
      scene.characters.forEach((instruction, charIndex) => {
        if (!knownIds.has(instruction.characterId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown characterId "${instruction.characterId}" (not in characterDefs)`,
            path: ['scenes', sceneIndex, 'characters', charIndex, 'characterId'],
          });
        }
      });
    });
  });
export type SceneScript = z.infer<typeof sceneScriptSchema>;

export function totalDurationSeconds(script: SceneScript): number {
  return script.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
}

export function totalDurationFrames(script: SceneScript): number {
  return Math.round(totalDurationSeconds(script) * script.fps);
}
