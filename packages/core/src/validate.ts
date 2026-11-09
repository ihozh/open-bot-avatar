import { bounds, filledArea, flattenPath, insideRow, isInside, parsePath, PathError, serializePath, splitSubpaths } from './path.ts';
import type { Bounds, Point } from './path.ts';
import type { AvatarDefinition, AvatarEyes, AvatarPartFrame, AvatarTube, ValidationResult } from './types.ts';

/** Neutral eye size at scale 1, viewBox units. */
export const EYE_W = 4;
export const EYE_H = 11;
/** Hard limits; the contract's soft target for the body is 8..92. */
export const BODY_MIN = 6;
export const BODY_MAX = 94;
const EYE_MARGIN = 1.2;
/**
 * Max gaze travel of the eyes inside the face at scale 1. Deliberately small:
 * a subtle shift reads as looking around, and the enlarged eyes stay well
 * inside the face instead of sliding toward its edge.
 */
export const GAZE_X = 1.5;
export const GAZE_Y = 1.1;
/**
 * Happy-eye arc, as fractions of the drawn eye size (w = width, h = height):
 * a quadratic from (x ∓ halfWidth·w, y + base·h) through the control point
 * (x, y − peak·h), stroked `stroke`·w wide with round caps.
 */
export const HAPPY_ARC = { halfWidth: 0.72, base: 0.1, peak: 0.42, stroke: 0.6 } as const;
/** Gap the renderer keeps between every drawn eye shape and the outline while the eyes look around. */
export const EYE_CLEARANCE = 1.5;

const TOP_KEYS = ['version', 'id', 'name', 'body', 'eyes', 'parts', 'tubes'];
const V2_KEYS = ['parts', 'tubes'];
const TUBE_KEYS = ['path', 'radius'];
const EYE_KEYS = ['x', 'y', 'spacing', 'scale'];
const PART_KEYS = ['z', 'yaw', 'pitch', 'pivot'];
/** v2 part frames: depth offset and tilt limits. */
export const PART_Z_MAX = 30;
export const PART_ANGLE_MAX = 75;
/** v2 tubes: count, control points, radius and depth limits; x ± r and y ± r must stay in TUBE_MIN..TUBE_MAX. */
export const TUBES_MAX = 8;
export const TUBE_POINTS_MIN = 2;
export const TUBE_POINTS_MAX = 16;
export const TUBE_RADIUS_MIN = 0.5;
export const TUBE_RADIUS_MAX = 15;
export const TUBE_Z_MAX = 40;
export const TUBE_MIN = 8;
export const TUBE_MAX = 92;

export interface BodyHole {
  /** The hole's own subpath, serialized. */
  d: string;
  /** Approximate cut-out area, units². */
  area: number;
}

export interface BodySubpath {
  /** The subpath, serialized. */
  d: string;
  /** Its own flattened polygon(s). */
  polys: Point[][];
  /** True when the subpath cuts a hole rather than adding fill. */
  hole: boolean;
  /** A point inside the subpath's own fill (for holes: inside the cut-out). */
  probe: Point | null;
}

export interface BodyAnalysis {
  polys: Point[][];
  bounds: Bounds;
  area: number;
  holes: BodyHole[];
  subpaths: BodySubpath[];
}

/** Holes up to this area count as small details (buttons, sockets). The renderer cuts every hole through. */
export const RECESS_MAX_AREA = 110;

export interface GazeRange { left: number; right: number; up: number; down: number }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Points on the outline of an eye pill expanded by `margin`. */
function eyeOutline(cx: number, cy: number, scale: number, margin: number): Point[] {
  const hw = (EYE_W * scale) / 2 + margin;
  const hh = (EYE_H * scale) / 2 + margin;
  const pts: Point[] = [];
  const straight = hh - hw; // half-length of the straight flank
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = Math.cos(a) * hw;
    const y = Math.sin(a) * hw + Math.sign(Math.sin(a)) * Math.max(0, straight);
    pts.push([cx + x, cy + y]);
  }
  for (const f of [-0.5, 0, 0.5]) {
    pts.push([cx - hw, cy + f * straight], [cx + hw, cy + f * straight]);
  }
  pts.push([cx, cy]);
  return pts;
}

/** Outline points of every shape the renderer may draw for one eye (pill and happy arc), expanded by `margin`. */
function drawnEyeOutline(cx: number, cy: number, scale: number, margin: number): Point[] {
  const pts = eyeOutline(cx, cy, scale, margin);
  const w = EYE_W * scale, h = EYE_H * scale;
  const x0 = cx - HAPPY_ARC.halfWidth * w, x1 = cx + HAPPY_ARC.halfWidth * w;
  const yb = cy + HAPPY_ARC.base * h, yc = cy - HAPPY_ARC.peak * h;
  const r = (HAPPY_ARC.stroke * w) / 2 + margin;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, m = 1 - t;
    const x = m * m * x0 + 2 * m * t * cx + t * t * x1;
    const y = (m * m + t * t) * yb + 2 * m * t * yc;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  }
  return pts;
}

export function eyeCenters(eyes: AvatarEyes): [Point, Point] {
  return [[eyes.x - eyes.spacing / 2, eyes.y], [eyes.x + eyes.spacing / 2, eyes.y]];
}

export function eyesFit(polys: Point[][], eyes: AvatarEyes, dx: number, dy: number, margin: number): Point | null {
  for (const [cx, cy] of eyeCenters(eyes)) {
    for (const [x, y] of eyeOutline(cx + dx, cy + dy, eyes.scale, margin)) {
      if (!isInside(polys, x, y)) return [x, y];
    }
  }
  return null;
}

/** Like eyesFit, but for everything the renderer draws: the pill and the wider happy arc. */
export function drawnEyesFit(polys: Point[][], eyes: AvatarEyes, dx: number, dy: number, margin: number): Point | null {
  for (const [cx, cy] of eyeCenters(eyes)) {
    for (const [x, y] of drawnEyeOutline(cx + dx, cy + dy, eyes.scale, margin)) {
      if (!isInside(polys, x, y)) return [x, y];
    }
  }
  return null;
}

/** Largest gap (viewBox units, to 0.1) between the drawn eyes at rest and the outline; 0 when they touch it. */
export function eyeClearance(polys: Point[][], eyes: AvatarEyes): number {
  if (drawnEyesFit(polys, eyes, 0, 0, 0)) return 0;
  let lo = 0, hi = 20;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (drawnEyesFit(polys, eyes, 0, 0, mid)) hi = mid;
    else lo = mid;
  }
  return Math.floor(lo * 10) / 10;
}

/**
 * How far (0..1 of GAZE_X/GAZE_Y) the drawn eyes can travel each way and keep
 * EYE_CLEARANCE from the outline.
 */
export function gazeRange(polys: Point[][], eyes: AvatarEyes): GazeRange {
  const reach = (ux: number, uy: number) => {
    for (const k of [1, 0.8, 0.6, 0.4, 0.2]) {
      if (!drawnEyesFit(polys, eyes, ux * k * GAZE_X * eyes.scale, uy * k * GAZE_Y * eyes.scale, EYE_CLEARANCE)) return k;
    }
    return 0;
  };
  return { left: reach(-1, 0), right: reach(1, 0), up: reach(0, -1), down: reach(0, 1) };
}

export function analyzeBody(path: string): BodyAnalysis {
  const segs = parsePath(path);
  const polys = flattenPath(segs);
  const b = bounds(polys);
  const holes: BodyHole[] = [];
  const subpaths: BodySubpath[] = [];
  for (const sub of splitSubpaths(segs)) {
    const own = flattenPath(sub);
    if (!own.length) continue;
    const ob = bounds(own);
    let inside = 0, cut = 0;
    let probe: Point | null = null, cutProbe: Point | null = null;
    // Small subpaths (buttons, sockets) need a fine grid; big ones classify fine on a coarser one.
    const step = (ob.maxX - ob.minX) * (ob.maxY - ob.minY) < 900 ? 0.5 : 1;
    const alone = own.length === polys.length;
    const xs: number[] = [];
    for (let x = Math.floor(ob.minX) + step / 2; x < ob.maxX; x += step) xs.push(x);
    const mine = new Uint8Array(xs.length), all = new Uint8Array(xs.length);
    for (let y = Math.floor(ob.minY) + step / 2; y < ob.maxY; y += step) {
      insideRow(own, y, xs, mine);
      if (!alone) insideRow(polys, y, xs, all);
      for (let k = 0; k < xs.length; k++) {
        if (!mine[k]) continue;
        inside++;
        probe ??= [xs[k], y];
        if (!alone && !all[k]) { cut++; cutProbe ??= [xs[k], y]; }
      }
    }
    cut *= step * step * 4;
    inside *= step * step * 4;
    const d = serializePath(sub);
    // A subpath that is mostly empty under the full fill rule is a cut-out.
    const hole = inside > 0 && cut / inside > 0.6;
    if (hole) holes.push({ d, area: Math.round(cut / 4) });
    subpaths.push({ d, polys: own, hole, probe: hole ? cutProbe : probe });
  }
  return { polys, bounds: b, area: filledArea(polys, b), holes, subpaths };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function validateAvatar(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['definition must be a JSON object'] };

  const version = input.version === 2 ? 2 : 1;
  const allowed = version === 2 ? TOP_KEYS : TOP_KEYS.filter((k) => !V2_KEYS.includes(k));
  for (const k of Object.keys(input)) if (!allowed.includes(k)) errors.push(`unknown field "${k}" (allowed: ${allowed.join(', ')})`);
  if (input.version !== 1 && input.version !== 2) errors.push('version must be 1 or 2');

  // v2: optional depth frames, one per outline subpath (checked against the body below).
  let parts: AvatarPartFrame[] | null = null;
  if (version === 2 && input.parts !== undefined) {
    if (!Array.isArray(input.parts)) errors.push('parts must be an array of { z?, yaw?, pitch?, pivot? }');
    else {
      parts = [];
      input.parts.forEach((p: unknown, i: number) => {
        if (!isRecord(p)) { errors.push(`parts[${i}] must be an object`); return; }
        for (const k of Object.keys(p)) if (!PART_KEYS.includes(k)) errors.push(`unknown field "parts[${i}].${k}" (allowed: ${PART_KEYS.join(', ')})`);
        const frame: AvatarPartFrame = {};
        for (const k of ['z', 'yaw', 'pitch'] as const) {
          if (p[k] === undefined) continue;
          const v = p[k];
          const max = k === 'z' ? PART_Z_MAX : PART_ANGLE_MAX;
          if (!num(v)) errors.push(`parts[${i}].${k} must be a finite number`);
          else if (Math.abs(v) > max) errors.push(`parts[${i}].${k} ${v} out of range -${max}..${max}`);
          else if (v !== 0) frame[k] = r1(v);
        }
        if (p.pivot !== undefined) {
          const pv = p.pivot;
          if (!Array.isArray(pv) || pv.length !== 2 || !num(pv[0]) || !num(pv[1])) errors.push(`parts[${i}].pivot must be [x, y]`);
          else if (pv[0] < 0 || pv[0] > 100 || pv[1] < 0 || pv[1] > 100) errors.push(`parts[${i}].pivot must lie within the 0..100 canvas`);
          else frame.pivot = [r1(pv[0]), r1(pv[1])];
        }
        (parts as AvatarPartFrame[]).push(frame);
      });
    }
  }

  // v2: optional solid tubes swept along a spline.
  let tubes: AvatarTube[] | null = null;
  if (version === 2 && input.tubes !== undefined) {
    if (!Array.isArray(input.tubes)) errors.push('tubes must be an array of { path, radius }');
    else {
      if (input.tubes.length > TUBES_MAX) errors.push(`tubes has ${input.tubes.length} entries; at most ${TUBES_MAX} are allowed`);
      tubes = [];
      input.tubes.forEach((t: unknown, i: number) => {
        if (!isRecord(t)) { errors.push(`tubes[${i}] must be an object { path, radius }`); return; }
        for (const k of Object.keys(t)) if (!TUBE_KEYS.includes(k)) errors.push(`unknown field "tubes[${i}].${k}" (allowed: ${TUBE_KEYS.join(', ')})`);
        const pts = t.path;
        if (!Array.isArray(pts) || pts.length < TUBE_POINTS_MIN || pts.length > TUBE_POINTS_MAX || !pts.every((q: unknown) => Array.isArray(q) && q.length === 3 && q.every(num))) {
          errors.push(`tubes[${i}].path must be ${TUBE_POINTS_MIN}..${TUBE_POINTS_MAX} control points [x, y, z]`);
          return;
        }
        const path = (pts as number[][]).map(([x, y, z]) => [r1(x), r1(y), r1(z)] as [number, number, number]);
        const rr = t.radius;
        let radius: [number, number] | number[];
        if (num(rr)) radius = [rr, rr];
        else if (Array.isArray(rr) && (rr.length === 2 || rr.length === path.length) && rr.every(num)) radius = rr.map(r1);
        else {
          errors.push(`tubes[${i}].radius must be a number, [root, tip] or one number per control point`);
          return;
        }
        radius = radius.map(r1);
        const badR = radius.filter((r) => r < TUBE_RADIUS_MIN || r > TUBE_RADIUS_MAX);
        if (badR.length) errors.push(`tubes[${i}].radius ${badR[0]} out of range ${TUBE_RADIUS_MIN}..${TUBE_RADIUS_MAX}`);
        // Radius at each control point: constant, root-to-tip over the point index (close enough for the
        // safe-area check; the renderer interpolates over arc length), or per point.
        const rAt = (k: number) => radius.length === path.length ? radius[k] : radius[0] + (radius[1] - radius[0]) * (path.length > 1 ? k / (path.length - 1) : 0);
        path.forEach(([x, y, z], k) => {
          const r = rAt(k);
          const out: string[] = [];
          if (x - r < TUBE_MIN) out.push(`x=${r1(x - r)}`);
          if (x + r > TUBE_MAX) out.push(`x=${r1(x + r)}`);
          if (y - r < TUBE_MIN) out.push(`y=${r1(y - r)}`);
          if (y + r > TUBE_MAX) out.push(`y=${r1(y + r)}`);
          if (out.length) errors.push(`tubes[${i}].path[${k}] leaves the safe area (${out.join(', ')}); keep geometry within ${TUBE_MIN}..${TUBE_MAX}`);
          if (Math.abs(z) > TUBE_Z_MAX) errors.push(`tubes[${i}].path[${k}] z ${z} out of range -${TUBE_Z_MAX}..${TUBE_Z_MAX}`);
        });
        (tubes as AvatarTube[]).push({ path, radius });
      });
    }
  }

  const id = input.id;
  if (typeof id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(id)) {
    errors.push('id must be a lowercase slug of 1-40 chars [a-z0-9-]');
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 40 || /[\u0000-\u001f<>]/.test(name)) {
    errors.push('name must be 1-40 printable characters without < or >');
  }

  let path: string | null = null;
  if (!isRecord(input.body)) errors.push('body must be an object { "path": "..." }');
  else {
    for (const k of Object.keys(input.body)) if (k !== 'path') errors.push(`unknown field "body.${k}" (only "path" is allowed)`);
    if (typeof input.body.path !== 'string') errors.push('body.path must be a string');
    else path = input.body.path;
  }

  let eyes: AvatarEyes | null = null;
  if (!isRecord(input.eyes)) errors.push('eyes must be an object { x, y, spacing, scale }');
  else {
    const e = input.eyes;
    for (const k of Object.keys(e)) if (!EYE_KEYS.includes(k)) errors.push(`unknown field "eyes.${k}" (allowed: ${EYE_KEYS.join(', ')})`);
    const bad = EYE_KEYS.filter((k) => !num(e[k]));
    if (bad.length) errors.push(`eyes.${bad.join(', eyes.')} must be finite numbers`);
    else {
      eyes = { x: e.x as number, y: e.y as number, spacing: e.spacing as number, scale: e.scale as number };
      if (eyes.scale < 0.6 || eyes.scale > 1.8) errors.push(`eyes.scale ${eyes.scale} out of range 0.6..1.8`);
      const minSpacing = EYE_W * eyes.scale * 1.75;
      if (eyes.spacing < minSpacing || eyes.spacing > 40) {
        errors.push(`eyes.spacing ${eyes.spacing} out of range ${r1(minSpacing)}..40 for scale ${eyes.scale}`);
      }
    }
  }

  let normalized = '';
  let body: BodyAnalysis | null = null;
  if (path !== null) {
    try {
      const segs = parsePath(path);
      normalized = serializePath(segs);
      body = analyzeBody(normalized);
    } catch (err) {
      if (err instanceof PathError) errors.push(`body.path: ${err.message}`);
      else throw err;
    }
  }

  if (body) {
    const b = body.bounds;
    const out: string[] = [];
    if (b.minX < BODY_MIN) out.push(`left edge x=${r1(b.minX)}`);
    if (b.minY < BODY_MIN) out.push(`top edge y=${r1(b.minY)}`);
    if (b.maxX > BODY_MAX) out.push(`right edge x=${r1(b.maxX)}`);
    if (b.maxY > BODY_MAX) out.push(`bottom edge y=${r1(b.maxY)}`);
    if (out.length) errors.push(`body.path leaves the safe area (${out.join(', ')}); keep geometry within 8..92`);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (Math.max(w, h) < 40 || Math.min(w, h) < 14) {
      errors.push(`body is too small (${r1(w)}x${r1(h)}); use at least 40 units on the long side and 14 on the short side`);
    }
    if (body.area < 600) errors.push(`body fill area ${body.area} is too thin to carry eyes; must be at least 600 units²`);

    if (parts) {
      const outlines = body.subpaths.filter((s) => !s.hole).length;
      if (parts.length > outlines) errors.push(`parts has ${parts.length} entries but the body has only ${outlines} outline subpath${outlines === 1 ? '' : 's'}`);
    }

    if (eyes) {
      const miss = eyesFit(body.polys, eyes, 0, 0, EYE_MARGIN);
      if (miss) {
        errors.push(
          `eyes must sit inside the body with ${EYE_MARGIN} units margin; point (${r1(miss[0])}, ${r1(miss[1])}) is outside or in a hole. ` +
          'Move eyes.x/y toward the widest solid area, reduce spacing or scale.',
        );
      }
    }
  }

  if (errors.length || !eyes) return { ok: false, errors };
  const value: AvatarDefinition = { version, id: id as string, name, body: { path: normalized }, eyes: { ...eyes } };
  if (parts) value.parts = parts;
  if (tubes) value.tubes = tubes;
  return { ok: true, value };
}
