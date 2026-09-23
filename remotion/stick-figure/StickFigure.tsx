import React from 'react';
import { computeStickFigurePoints, getPoseAngles, type Point } from '@/shared/stick-scenes/rig';
import type { PoseName } from '@/shared/stick-scenes/schema';

export interface StickFigureProps {
  pose: PoseName;
  tSeconds: number;
  origin: Point;
  scale?: number;
  facing?: 'left' | 'right';
  color?: string;
  label?: string;
}

/// Renders one stick figure as SVG line segments driven by the pure
/// forward-kinematics rig in `@/shared/stick-scenes/rig`. `facing: 'left'`
/// mirrors the whole figure horizontally around its origin.
export function StickFigure({ pose, tSeconds, origin, scale = 1, facing = 'right', color = '#1a1a1a', label }: StickFigureProps) {
  const angles = getPoseAngles(pose, tSeconds);
  const points = computeStickFigurePoints(angles, origin, scale);

  const mirror = (p: Point): Point => (facing === 'left' ? { x: 2 * origin.x - p.x, y: p.y } : p);
  const m = {
    head: mirror(points.head),
    neck: mirror(points.neck),
    hip: mirror(points.hip),
    shoulderL: mirror(points.shoulderL),
    shoulderR: mirror(points.shoulderR),
    elbowL: mirror(points.elbowL),
    elbowR: mirror(points.elbowR),
    handL: mirror(points.handL),
    handR: mirror(points.handR),
    hipL: mirror(points.hipL),
    hipR: mirror(points.hipR),
    kneeL: mirror(points.kneeL),
    kneeR: mirror(points.kneeR),
    footL: mirror(points.footL),
    footR: mirror(points.footR),
  };

  const line = (a: Point, b: Point, key: string) => (
    <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={9} strokeLinecap="round" />
  );

  return (
    <g>
      <circle cx={m.head.x} cy={m.head.y} r={points.headRadius} fill="none" stroke={color} strokeWidth={9} />
      {line(m.neck, m.hip, 'torso')}
      {line(m.shoulderL, m.elbowL, 'upperArmL')}
      {line(m.elbowL, m.handL, 'lowerArmL')}
      {line(m.shoulderR, m.elbowR, 'upperArmR')}
      {line(m.elbowR, m.handR, 'lowerArmR')}
      {line(m.hip, m.hipL, 'pelvisL')}
      {line(m.hip, m.hipR, 'pelvisR')}
      {line(m.hipL, m.kneeL, 'upperLegL')}
      {line(m.kneeL, m.footL, 'lowerLegL')}
      {line(m.hipR, m.kneeR, 'upperLegR')}
      {line(m.kneeR, m.footR, 'lowerLegR')}
      {label ? (
        <text
          x={m.head.x}
          y={m.head.y - points.headRadius - 10}
          textAnchor="middle"
          fontSize={26}
          fontFamily="sans-serif"
          fill={color}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
