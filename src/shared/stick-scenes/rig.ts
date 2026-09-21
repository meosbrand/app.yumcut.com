import type { PoseName } from './schema';

/// A minimal 2D forward-kinematics stick-figure rig: every limb is defined
/// by an angle (degrees, measured from "hanging straight down", positive =
/// swings toward the front/right) plus a fixed bone length. This is pure
/// math -- no React, no DOM -- so poses and animation curves are testable
/// in isolation and reusable by both the Remotion renderer and any future
/// preview/QA tooling.

export interface JointAngles {
  torsoLean: number; // degrees, torso tilt from vertical
  headTilt: number;
  shoulderL: number;
  shoulderR: number;
  elbowL: number;
  elbowR: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
}

export const REST_ANGLES: JointAngles = {
  torsoLean: 0,
  headTilt: 0,
  shoulderL: 15,
  shoulderR: -15,
  elbowL: 10,
  elbowR: -10,
  hipL: 5,
  hipR: -5,
  kneeL: 0,
  kneeR: 0,
};

/// Static base pose presets. Angles are deltas layered onto standing rest;
/// `getPoseAngles` below adds time-based motion for the animated poses.
const BASE_POSES: Record<PoseName, JointAngles> = {
  idle: REST_ANGLES,
  walk: REST_ANGLES,
  wave: { ...REST_ANGLES, shoulderR: 150, elbowR: 20 },
  'point-right': { ...REST_ANGLES, shoulderR: 90, elbowR: 10 },
  'point-left': { ...REST_ANGLES, shoulderL: -90, elbowL: -10 },
  sit: {
    ...REST_ANGLES,
    hipL: 90,
    hipR: 90,
    kneeL: -90,
    kneeR: -90,
    shoulderL: 25,
    shoulderR: -25,
  },
  think: { ...REST_ANGLES, headTilt: -8, shoulderR: -120, elbowR: -100 },
  explain: { ...REST_ANGLES, shoulderL: -60, elbowL: 25, shoulderR: 70, elbowR: -20 },
  celebrate: { ...REST_ANGLES, shoulderL: -160, shoulderR: 160, elbowL: -10, elbowR: 10 },
};

const DEG2RAD = Math.PI / 180;

function lerpAngles(a: JointAngles, b: JointAngles, t: number): JointAngles {
  const keys = Object.keys(a) as (keyof JointAngles)[];
  const out = {} as JointAngles;
  for (const key of keys) out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

/// Returns joint angles for a pose at a given time. Static poses get a
/// subtle idle "breathing" bob; walk/wave overlay a periodic oscillation so
/// the figure actually moves instead of holding a frozen slideshow pose.
export function getPoseAngles(pose: PoseName, tSeconds: number): JointAngles {
  const base = BASE_POSES[pose];

  if (pose === 'walk') {
    const cycle = Math.sin(tSeconds * 2 * Math.PI * 1.6); // ~1.6 strides/sec
    const swing = 35 * cycle;
    return {
      ...base,
      shoulderL: base.shoulderL - swing,
      shoulderR: base.shoulderR + swing,
      hipL: base.hipL + swing,
      hipR: base.hipR - swing,
      kneeL: Math.max(0, swing) * 0.8,
      kneeR: Math.max(0, -swing) * 0.8,
      torsoLean: 3 * Math.sin(tSeconds * 2 * Math.PI * 3.2),
    };
  }

  if (pose === 'wave') {
    const wag = 25 * Math.sin(tSeconds * 2 * Math.PI * 2.2);
    return { ...base, elbowR: base.elbowR + wag };
  }

  // Subtle idle bob for every other (otherwise static) pose.
  const bob = 1.5 * Math.sin(tSeconds * 2 * Math.PI * 0.35);
  return { ...base, torsoLean: base.torsoLean + bob };
}

export interface Point {
  x: number;
  y: number;
}

export interface StickFigurePoints {
  head: Point;
  neck: Point;
  hip: Point;
  shoulderL: Point;
  shoulderR: Point;
  elbowL: Point;
  elbowR: Point;
  handL: Point;
  handR: Point;
  hipL: Point;
  hipR: Point;
  kneeL: Point;
  kneeR: Point;
  footL: Point;
  footR: Point;
  headRadius: number;
}

export interface BoneLengths {
  torso: number;
  neck: number;
  upperArm: number;
  lowerArm: number;
  upperLeg: number;
  lowerLeg: number;
  headRadius: number;
}

export const DEFAULT_BONE_LENGTHS: BoneLengths = {
  torso: 130,
  neck: 25,
  upperArm: 65,
  lowerArm: 60,
  upperLeg: 88,
  lowerLeg: 82,
  headRadius: 40,
};

function project(origin: Point, angleDeg: number, length: number): Point {
  const rad = angleDeg * DEG2RAD;
  return { x: origin.x + Math.sin(rad) * length, y: origin.y + Math.cos(rad) * length };
}

/// Forward-kinematics: given joint angles, an origin (the hip/pelvis
/// anchor, i.e. where the character "stands"), a uniform scale, and bone
/// lengths, compute every joint's 2D position. All limbs hang from their
/// parent joint at their given angle, matching how `project` measures
/// angle from "straight down".
export function computeStickFigurePoints(
  angles: JointAngles,
  origin: Point,
  scale = 1,
  bones: BoneLengths = DEFAULT_BONE_LENGTHS,
): StickFigurePoints {
  const b: BoneLengths = {
    torso: bones.torso * scale,
    neck: bones.neck * scale,
    upperArm: bones.upperArm * scale,
    lowerArm: bones.lowerArm * scale,
    upperLeg: bones.upperLeg * scale,
    lowerLeg: bones.lowerLeg * scale,
    headRadius: bones.headRadius * scale,
  };

  const hip = origin;
  // Torso runs upward from the hip; project() measures from "down", so we
  // negate the length to go up, and lean shifts the top of the torso.
  const neckBase = project(hip, 180 + angles.torsoLean, b.torso);
  const head = project(neckBase, 180 + angles.torsoLean + angles.headTilt, b.neck + b.headRadius);

  // Shoulders sit roughly horizontal from the neck, spread left/right with
  // a slight upward bias (100 deg = just past horizontal, per `project`'s
  // "0 = straight down" convention).
  const shoulderL = project(neckBase, angles.torsoLean - 100, b.neck * 1.4);
  const shoulderR = project(neckBase, angles.torsoLean + 100, b.neck * 1.4);

  const elbowL = project(shoulderL, angles.shoulderL, b.upperArm);
  const handL = project(elbowL, angles.shoulderL + angles.elbowL, b.lowerArm);
  const elbowR = project(shoulderR, angles.shoulderR, b.upperArm);
  const handR = project(elbowR, angles.shoulderR + angles.elbowR, b.lowerArm);

  const hipL = project(hip, angles.hipL - 8, 4 * scale);
  const hipR = project(hip, angles.hipR + 8, 4 * scale);
  const kneeL = project(hipL, angles.hipL, b.upperLeg);
  const footL = project(kneeL, angles.hipL + angles.kneeL, b.lowerLeg);
  const kneeR = project(hipR, angles.hipR, b.upperLeg);
  const footR = project(kneeR, angles.hipR + angles.kneeR, b.lowerLeg);

  return {
    head,
    neck: neckBase,
    hip,
    shoulderL,
    shoulderR,
    elbowL,
    elbowR,
    handL,
    handR,
    hipL,
    hipR,
    kneeL,
    kneeR,
    footL,
    footR,
    headRadius: b.headRadius,
  };
}

/// Convenience for cross-scene transitions: blends two poses' angles.
export function blendPoseAngles(poseA: PoseName, poseB: PoseName, tSeconds: number, mix: number): JointAngles {
  return lerpAngles(getPoseAngles(poseA, tSeconds), getPoseAngles(poseB, tSeconds), mix);
}
