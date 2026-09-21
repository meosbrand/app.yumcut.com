import { describe, expect, it } from 'vitest';
import { sceneScriptSchema, totalDurationFrames, totalDurationSeconds } from '@/shared/stick-scenes/schema';

function validScript() {
  return {
    fps: 30,
    aspect: 'horizontal-16-9' as const,
    characterDefs: [{ id: 'narrator' }],
    scenes: [
      {
        id: 'scene-1',
        durationSeconds: 4,
        background: 'whiteboard' as const,
        characters: [{ characterId: 'narrator', pose: 'explain' as const, position: { x: 0.5, y: 0.8 } }],
        props: [],
        captionText: 'Hello world',
      },
      {
        id: 'scene-2',
        durationSeconds: 2,
        characters: [],
      },
    ],
  };
}

describe('sceneScriptSchema', () => {
  it('accepts a well-formed script and applies defaults', () => {
    const parsed = sceneScriptSchema.parse(validScript());
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.scenes[1].background).toBe('whiteboard');
  });

  it('rejects a character instruction referencing an unknown characterId', () => {
    const script = validScript();
    script.scenes[0].characters[0].characterId = 'ghost';
    const result = sceneScriptSchema.safeParse(script);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Unknown characterId/);
    }
  });

  it('rejects a scene with an out-of-range duration', () => {
    const script = validScript();
    script.scenes[0].durationSeconds = 0.1;
    expect(sceneScriptSchema.safeParse(script).success).toBe(false);
  });

  it('rejects an empty characterDefs list', () => {
    const script = validScript();
    (script as any).characterDefs = [];
    expect(sceneScriptSchema.safeParse(script).success).toBe(false);
  });

  it('computes total duration in seconds and frames', () => {
    const parsed = sceneScriptSchema.parse(validScript());
    expect(totalDurationSeconds(parsed)).toBe(6);
    expect(totalDurationFrames(parsed)).toBe(180);
  });
});
