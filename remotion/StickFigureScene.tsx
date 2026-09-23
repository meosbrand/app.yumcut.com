import React from 'react';
import { AbsoluteFill, Series, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Scene, SceneScript } from '@/shared/stick-scenes/schema';
import { StickFigure } from './stick-figure/StickFigure';
import { StickIcon } from './stick-figure/Icon';

const BACKGROUND_FILL: Record<Scene['background'], string> = {
  blank: '#ffffff',
  whiteboard: '#fbfaf5',
  grid: '#ffffff',
};

function Background({ kind, width, height }: { kind: Scene['background']; width: number; height: number }) {
  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND_FILL[kind] }}>
      {kind === 'grid' ? (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e5e5" strokeWidth={1} />
            </pattern>
          </defs>
          <rect width={width} height={height} fill="url(#grid)" />
        </svg>
      ) : null}
    </AbsoluteFill>
  );
}

function CameraLayer({ scene, width, height, children }: { scene: Scene; width: number; height: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSeconds = frame / fps;

  if (!scene.camera) {
    return <>{children}</>;
  }

  const { from, to, fromZoom, toZoom } = scene.camera;
  const progress = Math.min(1, tSeconds / scene.durationSeconds);
  const cx = interpolate(progress, [0, 1], [from.x, to.x]);
  const cy = interpolate(progress, [0, 1], [from.y, to.y]);
  const zoom = interpolate(progress, [0, 1], [fromZoom, toZoom]);
  const tx = (0.5 - cx) * width;
  const ty = (0.5 - cy) * height;

  return (
    <div
      style={{
        width,
        height,
        transform: `scale(${zoom}) translate(${tx}px, ${ty}px)`,
        transformOrigin: '50% 50%',
      }}
    >
      {children}
    </div>
  );
}

function Caption({ text, width }: { text: string; width: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '6%',
        left: 0,
        width,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 5%',
      }}
    >
      <span
        style={{
          fontFamily: 'sans-serif',
          fontSize: Math.round(width * 0.028),
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center',
          textShadow: '0 0 6px rgba(0,0,0,0.85), 0 0 12px rgba(0,0,0,0.6)',
          maxWidth: '90%',
        }}
      >
        {text}
      </span>
    </div>
  );
}

function SceneLayer({ scene, characterDefs, width, height }: { scene: Scene; characterDefs: SceneScript['characterDefs']; width: number; height: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSeconds = frame / fps;
  const defsById = new Map(characterDefs.map((c) => [c.id, c]));

  return (
    <AbsoluteFill>
      <Background kind={scene.background} width={width} height={height} />
      <CameraLayer scene={scene} width={width} height={height}>
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <marker id="arrowhead" markerWidth={10} markerHeight={10} refX={7} refY={5} orient="auto">
              <path d="M0,0 L10,5 L0,10 Z" fill="#1a1a1a" />
            </marker>
          </defs>
          {scene.props
            .filter((p) => p.kind === 'arrow')
            .map((p) =>
              p.kind === 'arrow' ? (
                <g key={p.id}>
                  <line
                    x1={p.from.x * width}
                    y1={p.from.y * height}
                    x2={p.to.x * width}
                    y2={p.to.y * height}
                    stroke="#1a1a1a"
                    strokeWidth={4}
                    markerEnd="url(#arrowhead)"
                  />
                </g>
              ) : null,
            )}
          {scene.characters.map((instruction) => {
            const def = defsById.get(instruction.characterId);
            return (
              <StickFigure
                key={instruction.characterId}
                pose={instruction.pose}
                tSeconds={tSeconds}
                origin={{ x: instruction.position.x * width, y: instruction.position.y * height }}
                scale={instruction.scale ?? 1}
                facing={instruction.facing ?? 'right'}
                color={def?.color ?? '#1a1a1a'}
                label={def?.label}
              />
            );
          })}
        </svg>
        {scene.props
          .filter((p) => p.kind === 'icon' || p.kind === 'text')
          .map((p) => (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: p.position.x * width,
                top: p.position.y * height,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {p.kind === 'icon' ? (
                <StickIcon iconKey={p.iconKey} size={48 * (p.scale ?? 1)} />
              ) : (
                <span
                  style={{
                    fontFamily: 'sans-serif',
                    fontSize: 28 * (p.scale ?? 1),
                    fontWeight: 600,
                    color: '#1a1a1a',
                  }}
                >
                  {p.text}
                </span>
              )}
            </div>
          ))}
      </CameraLayer>
      {scene.captionText ? <Caption text={scene.captionText} width={width} /> : null}
    </AbsoluteFill>
  );
}

export function StickFigureScenes({ script }: { script: SceneScript }) {
  return (
    <Series>
      {script.scenes.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={Math.round(scene.durationSeconds * script.fps)}>
          <SceneLayerWithConfig scene={scene} characterDefs={script.characterDefs} />
        </Series.Sequence>
      ))}
    </Series>
  );
}

function SceneLayerWithConfig({ scene, characterDefs }: { scene: Scene; characterDefs: SceneScript['characterDefs'] }) {
  const { width, height } = useVideoConfig();
  return <SceneLayer scene={scene} characterDefs={characterDefs} width={width} height={height} />;
}
