import { describe, expect, it } from 'vitest';
import {
  computeStickFigurePoints,
  getPoseAngles,
  blendPoseAngles,
  REST_ANGLES,
  DEFAULT_BONE_LENGTHS,
} from '@/shared/stick-scenes/rig';

describe('computeStickFigurePoints', () => {
  it('places the head above the hip and feet below it for a zeroed rig', () => {
    const zeroAngles = {
      torsoLean: 0,
      headTilt: 0,
      shoulderL: 0,
      shoulderR: 0,
      elbowL: 0,
      elbowR: 0,
      hipL: 0,
      hipR: 0,
      kneeL: 0,
      kneeR: 0,
    };
    const origin = { x: 100, y: 200 };
    const points = computeStickFigurePoints(zeroAngles, origin, 1);

    expect(points.head.y).toBeLessThan(origin.y);
    expect(points.footL.y).toBeGreaterThan(origin.y);
    expect(points.footR.y).toBeGreaterThan(origin.y);
    // Zeroed rig is bilaterally symmetric around the origin's x.
    expect(points.head.x).toBeCloseTo(origin.x, 5);
    expect(points.footL.x).toBeCloseTo(2 * origin.x - points.footR.x, 5);
  });

  it('scales all bone lengths uniformly', () => {
    const origin = { x: 0, y: 0 };
    const p1 = computeStickFigurePoints(REST_ANGLES, origin, 1);
    const p2 = computeStickFigurePoints(REST_ANGLES, origin, 2);
    const dist = (a: { x: number; y: number }) => Math.hypot(a.x - origin.x, a.y - origin.y);
    expect(dist(p2.head)).toBeCloseTo(dist(p1.head) * 2, 4);
    expect(p2.headRadius).toBeCloseTo(DEFAULT_BONE_LENGTHS.headRadius * 2, 4);
  });
});

describe('directional poses', () => {
  it('extends the pointing hand to the correct side of the body', () => {
    const origin = { x: 100, y: 200 };
    const pointRight = computeStickFigurePoints(getPoseAngles('point-right', 0), origin, 1);
    const pointLeft = computeStickFigurePoints(getPoseAngles('point-left', 0), origin, 1);
    expect(pointRight.handR.x).toBeGreaterThan(origin.x);
    expect(pointLeft.handL.x).toBeLessThan(origin.x);
  });

  it('raises the waving hand above the head instead of across the body', () => {
    const origin = { x: 100, y: 200 };
    const points = computeStickFigurePoints(getPoseAngles('wave', 0), origin, 1);
    expect(points.handR.y).toBeLessThan(points.head.y);
    expect(points.handR.x).toBeGreaterThanOrEqual(origin.x);
  });
});

describe('getPoseAngles', () => {
  it('oscillates leg angles for the walk cycle', () => {
    const atStart = getPoseAngles('walk', 0);
    const atQuarterStride = getPoseAngles('walk', 1 / (4 * 1.6));
    expect(Math.abs(atQuarterStride.hipL - atStart.hipL)).toBeGreaterThan(5);
  });

  it('keeps a static pose recognizably close to its base shape', () => {
    const angles = getPoseAngles('point-right', 0.5);
    expect(angles.shoulderR).toBeGreaterThan(60); // right arm extended out to the right
    expect(Number.isFinite(angles.torsoLean)).toBe(true);
  });

  it('produces finite angles for every named pose', () => {
    const poses = ['idle', 'walk', 'wave', 'point-right', 'point-left', 'sit', 'think', 'explain', 'celebrate'] as const;
    for (const pose of poses) {
      const angles = getPoseAngles(pose, 1.234);
      for (const value of Object.values(angles)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('blendPoseAngles', () => {
  it('returns the first pose at mix=0 and the second at mix=1', () => {
    const t = 0;
    const a = getPoseAngles('idle', t);
    const b = getPoseAngles('celebrate', t);
    expect(blendPoseAngles('idle', 'celebrate', t, 0)).toEqual(a);
    expect(blendPoseAngles('idle', 'celebrate', t, 1)).toEqual(b);
  });

  it('interpolates linearly at mix=0.5', () => {
    const t = 0;
    const a = getPoseAngles('idle', t);
    const b = getPoseAngles('celebrate', t);
    const mid = blendPoseAngles('idle', 'celebrate', t, 0.5);
    expect(mid.shoulderL).toBeCloseTo((a.shoulderL + b.shoulderL) / 2, 5);
  });
});
