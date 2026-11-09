/**
 * Avatar definition contract v1 (see docs/avatar-contract.md).
 *
 * A definition is geometry only: one monochrome silhouette path in a fixed
 * 0 0 100 100 viewBox plus a placement for the eye pair. Everything else
 * (color, implied volume, view, gaze, blinking, motion) is owned by the
 * runtime renderer.
 */

export interface AvatarEyes {
  /** Center of the eye pair, viewBox units. */
  x: number;
  y: number;
  /** Center-to-center distance between the two eyes, viewBox units. */
  spacing: number;
  /** 1 = each neutral eye is ~4 units wide and ~11 units tall. */
  scale: number;
}

/**
 * v2: where one part (one filled outline subpath, in path order, holes not
 * counted) sits in depth. Every field is optional; a missing frame is the v1
 * placement (centered on the mid-plane, upright).
 */
export interface AvatarPartFrame {
  /** Offset of the part's own mid-plane toward the viewer, viewBox units (-30..30). */
  z?: number;
  /** Turn about the part's vertical axis through `pivot`, degrees (-75..75). Positive brings the part's right edge toward the viewer. */
  yaw?: number;
  /** Tip about the part's horizontal axis through `pivot`, degrees (-75..75). Positive leans the part's top toward the viewer. */
  pitch?: number;
  /** Point the part turns about, viewBox units. Defaults to the part's bounding-box center. */
  pivot?: [number, number];
}

/**
 * v2: a solid tube swept along a curve in space, for limbs and horns that a
 * flat part cannot express. The curve is a Catmull-Rom spline through `path`;
 * the renderer approximates the tube with a chain of overlapping spheres, so
 * it reads as solid from every view.
 */
export interface AvatarTube {
  /** 2..16 control points [x, y, z]: x, y in viewBox units; z is depth, positive toward the viewer (|z| ≤ 40). */
  path: [number, number, number][];
  /**
   * Radius 0.5..15 along the tube: one number (constant), [root, tip] (linear in arc length), or
   * one number per control point.
   */
  radius: number | [number, number] | number[];
}

export interface AvatarDefinition {
  /** 1: flat contract. 2: adds optional `parts` depth frames and `tubes`. */
  version: 1 | 2;
  /** Lowercase slug, e.g. "controller". */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One filled path, nonzero fill rule; holes wind opposite to their outline. */
  body: { path: string };
  eyes: AvatarEyes;
  /** v2 only: one frame per outline subpath, in path order; shorter arrays leave the rest at the default. */
  parts?: AvatarPartFrame[];
  /** v2 only: up to 8 solid tubes, drawn after the body's outline parts. */
  tubes?: AvatarTube[];
}

export type AvatarMotion = 'idle' | 'thinking' | 'happy';

/**
 * A mood easing in over what was shown before it: a plain mood, or a mood that
 * was itself still easing in (its progress frozen where it was). `t` 0..1.
 */
export interface AvatarMotionBlend {
  from: AvatarMotion | { motion: AvatarMotion; blend?: AvatarMotionBlend };
  t: number;
}

export interface RenderOptions {
  /** Body color as #rgb or #rrggbb. Invalid values fall back to the default. */
  color?: string;
  /** Eye color as #rgb or #rrggbb. Defaults to a plain near-black ink. */
  eyeColor?: string;
  /**
   * Rendered width/height in CSS pixels. Omit for a fluid SVG. In sceneFrame it lets small
   * live avatars skip cross-sections that would sit less than a pixel apart.
   */
  size?: number;
  /** Volume amount 0..14 (default 6 = natural depth; 0 = flat). Scales every part's inferred depth. */
  depth?: number;
  /** Extra view rotation in radians on top of the resting view (drag-to-turn). yaw turns left/right, pitch tips. */
  view?: { yaw: number; pitch: number };
  /** Animation clock in seconds. Same inputs always produce the same SVG. */
  time?: number;
  /**
   * Look target, each axis normalized -1..1 (x right, y down). Overrides idle eye
   * wander and turns the body toward it; `weight` (0..1, default 1) blends it in
   * over the idle pose so following can start and stop without a jump.
   */
  gaze?: { x: number; y: number; weight?: number };
  motion?: AvatarMotion;
  /**
   * Ease into `motion` from the mood shown before: the pose blends between the
   * two, and eyes that change shape close and reopen. Hosts leave it out once
   * `t` reaches 1 (and under reduced motion).
   */
  motionBlend?: AvatarMotionBlend;
  /** Freeze body motion and blinking at a calm pose; gaze still applies. */
  reducedMotion?: boolean;
}

export type ValidationResult =
  | { ok: true; value: AvatarDefinition }
  | { ok: false; errors: string[] };
