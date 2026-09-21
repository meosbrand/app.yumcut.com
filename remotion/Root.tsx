import React from 'react';
import { Composition } from 'remotion';
import { sceneScriptSchema, totalDurationFrames, ASPECT_PRESETS, type SceneScript } from '@/shared/stick-scenes/schema';
import { StickFigureScenes } from './StickFigureScene';
import exampleScript from '../scripts/stick-renderer/example-scene.json';

const DEFAULT_SCRIPT = sceneScriptSchema.parse(exampleScript) as SceneScript;

export function RemotionRoot() {
  return (
    <Composition
      id="StickFigureScenes"
      component={StickFigureScenes}
      schema={sceneScriptSchema as any}
      defaultProps={{ script: DEFAULT_SCRIPT }}
      durationInFrames={totalDurationFrames(DEFAULT_SCRIPT)}
      fps={DEFAULT_SCRIPT.fps}
      width={ASPECT_PRESETS[DEFAULT_SCRIPT.aspect].width}
      height={ASPECT_PRESETS[DEFAULT_SCRIPT.aspect].height}
      calculateMetadata={async ({ props }) => {
        const script = props.script as SceneScript;
        const { width, height } = ASPECT_PRESETS[script.aspect];
        return {
          durationInFrames: totalDurationFrames(script),
          fps: script.fps,
          width,
          height,
        };
      }}
    />
  );
}
