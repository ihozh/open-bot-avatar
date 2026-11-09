/**
 * v2 tubes: solid tubes swept along a spline, approximated by a chain of
 * spheres. Validation fences the fields, the chain stays closed, and every
 * renderer draws one disc per sphere at its projected centre.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { examples, getExample } from '../src/examples.ts';
import { avatarExtent, avatarFrame, liveFrame, renderAvatarScene, renderAvatarSvg, sceneFrame, UNIT_CIRCLE } from '../src/render.ts';
import { TUBES_MAX, validateAvatar } from '../src/validate.ts';
import { buildVolume, tubeBalls } from '../src/volume.ts';
import type { AvatarDefinition, AvatarTube } from '../src/types.ts';

const clone = <T>(d: T): T => JSON.parse(JSON.stringify(d));
const errorsOf = (input: unknown) => {
  const r = validateAvatar(input);
  return r.ok ? [] : r.errors;
};
const ram = JSON.parse(readFileSync('gallery/ram.json', 'utf8')) as AvatarDefinition;
const bull = getExample('bull') ?? examples[0];
const horn: AvatarTube = { path: [[36, 34, 0], [30, 26, 6], [22, 30, 16], [18, 41, 26], [22, 51, 32]], radius: [7, 2] };

describe('validateAvatar tubes', () => {
  it('rejects tubes on a v1 definition', () => {
    expect(errorsOf({ ...clone(bull), tubes: [horn] }).join()).toMatch(/unknown field "tubes"/);
  });

  it('rejects bad radius, points outside the safe area, bad shapes and too many tubes', () => {
    const v2 = { ...clone(bull), version: 2 as const };
    expect(errorsOf({ ...v2, tubes: [{ ...horn, radius: 20 }] }).join()).toMatch(/tubes\[0\]\.radius 20 out of range 0\.5\.\.15/);
    expect(errorsOf({ ...v2, tubes: [{ ...horn, radius: [7, 0.2] }] }).join()).toMatch(/radius 0\.2 out of range/);
    const far = clone(horn);
    far.path[3] = [90, 41, 26];
    expect(errorsOf({ ...v2, tubes: [far] }).join()).toMatch(/tubes\[0\]\.path\[3\] leaves the safe area \(x=9[0-9.]+\); keep geometry within 8\.\.92/);
    const deep = clone(horn);
    deep.path[1] = [30, 26, 45];
    expect(errorsOf({ ...v2, tubes: [deep] }).join()).toMatch(/tubes\[0\]\.path\[1\] z 45 out of range -40\.\.40/);
    expect(errorsOf({ ...v2, tubes: [{ path: [[50, 50, 0]], radius: 3 }] }).join()).toMatch(/tubes\[0\]\.path must be 2\.\.16 control points/);
    expect(errorsOf({ ...v2, tubes: [{ ...horn, radius: [1, 2, 3] }] }).join()).toMatch(/tubes\[0\]\.radius must be a number, \[root, tip\] or one number per control point/);
    expect(errorsOf({ ...v2, tubes: [{ ...horn, color: 'red' }] }).join()).toMatch(/unknown field "tubes\[0\]\.color"/);
    expect(errorsOf({ ...v2, tubes: {} }).join()).toMatch(/tubes must be an array/);
    expect(errorsOf({ ...v2, tubes: Array.from({ length: TUBES_MAX + 1 }, () => horn) }).join()).toMatch(/at most 8 are allowed/);
  });

  it('accepts and normalizes the ram, and is idempotent', () => {
    const once = validateAvatar(ram);
    if (!once.ok) throw new Error(once.errors.join());
    expect(once.value.tubes).toHaveLength(2);
    expect(once.value.tubes![0].radius).toEqual([7, 2]);
    const twice = validateAvatar(once.value);
    if (!twice.ok) throw new Error(twice.errors.join());
    expect(twice.value).toEqual(once.value);

    const v2 = { ...clone(bull), version: 2 as const };
    const constant = validateAvatar({ ...v2, tubes: [{ ...horn, radius: 4.26 }] });
    expect(constant.ok && constant.value.tubes![0].radius).toEqual([4.3, 4.3]);
    const perPoint = validateAvatar({ ...v2, tubes: [{ ...horn, radius: [6, 5, 4, 3, 2.04] }] });
    expect(perPoint.ok && perPoint.value.tubes![0].radius).toEqual([6, 5, 4, 3, 2]);
    const rounded = validateAvatar({ ...v2, tubes: [{ ...horn, path: horn.path.map(([x, y, z]) => [x + 0.04, y, z + 0.26] as [number, number, number]) }] });
    expect(rounded.ok && rounded.value.tubes![0].path[0]).toEqual([36, 34, 0.3]);
  });
});

describe('tube geometry', () => {
  it('samples each horn into an overlapping chain of 10..64 spheres that ends on the tip', () => {
    const vol = buildVolume(ram);
    const tubes = vol.parts.filter((p) => p.kind === 'tube');
    expect(tubes).toHaveLength(2);
    expect(vol.parts.slice(0, vol.parts.length - 2).every((p) => p.kind !== 'tube')).toBe(true);
    for (const part of tubes) {
      const balls = part.balls!;
      expect(balls.length).toBeGreaterThanOrEqual(10);
      expect(balls.length).toBeLessThanOrEqual(64);
      for (let j = 1; j < balls.length; j++) {
        const a = balls[j - 1], b = balls[j];
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), `gap ${j}`).toBeLessThan((a.r + b.r) / 2);
      }
      expect(balls[0].r).toBeCloseTo(7, 5);
      expect(balls[balls.length - 1].r).toBeCloseTo(2, 5);
      const [root, , , , tip] = ram.tubes![tubes.indexOf(part)].path;
      expect(balls[balls.length - 1].x).toBeCloseTo(tip[0], 5);
      expect(balls[balls.length - 1].z).toBeCloseTo(tip[2], 5);
      expect(part.zSlices.length + part.xSlices.length + part.ySlices.length).toBe(0);
      // Height is the spheres' union: solid at the root, nothing far away.
      expect(part.height(root[0], root[1])).toBeGreaterThan(6);
      expect(part.height(50, 50)).toBe(0);
    }
    // The volume's bounds grow to hold the horns.
    expect(vol.bounds.minX).toBeLessThan(20);
    expect(vol.bounds.maxX).toBeGreaterThan(80);
  });

  it('interpolates per-point radii and honours the depth scale', () => {
    const balls = tubeBalls({ path: [[20, 50, 0], [50, 50, 10], [80, 50, 20]], radius: [2, 6, 2] });
    const mid = balls.reduce((best, q) => (Math.abs(q.x - 50) < Math.abs(best.x - 50) ? q : best));
    expect(mid.r).toBeGreaterThan(5);
    expect(balls[0].r).toBeCloseTo(2, 5);
    const flat = tubeBalls(horn, 0);
    expect(flat.every((q) => q.z === 0)).toBe(true);
    const half = tubeBalls(horn, 0.5);
    expect(half[half.length - 1].z).toBeCloseTo(16, 5);
  });
});

describe('tube rendering', () => {
  const total = (d: AvatarDefinition) => buildVolume(d).parts.reduce((n, p) => n + (p.balls?.length ?? 0), 0);
  const ballShapes = (frame: ReturnType<typeof avatarFrame>) => frame.shapes.filter((s) => s.kind === 'slice' && /^\d+b\d+$/.test(s.key)) as Extract<(typeof frame.shapes)[number], { kind: 'slice' }>[];

  it('draws one unit-circle disc per sphere at the front view', () => {
    const frame = avatarFrame(ram, { reducedMotion: true, view: { yaw: 0, pitch: 0 } });
    const discs = ballShapes(frame);
    expect(discs).toHaveLength(total(ram));
    const circle = frame.paths.find((p) => p.d === UNIT_CIRCLE)!;
    expect(circle).toBeDefined();
    expect(circle.box).toEqual({ x: -1, y: -1, w: 2, h: 2 });
    for (const d of discs) {
      expect(d.path).toBe(circle.id);
      expect(d.matrix[0]).toBe(d.matrix[3]);
      expect(d.matrix[1]).toBe(0);
      expect(d.matrix[2]).toBe(0);
      expect(d.matrix[0]).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(d.matrix[0]).toBeLessThanOrEqual(7 + 1e-9);
    }
    const svg = renderAvatarSvg(ram);
    expect(svg).toContain(`d="${UNIT_CIRCLE}"`);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('turned 90°, the horn reaches forward: screen x follows the sphere depth', () => {
    // The resting pose is a three-quarter turn, so undo it to look exactly along the x axis.
    const frame = avatarFrame(ram, { reducedMotion: true, view: { yaw: Math.PI / 2 + 0.3, pitch: -0.2 } });
    const vol = buildVolume(ram);
    const i = vol.parts.findIndex((p) => p.kind === 'tube');
    const balls = vol.parts[i].balls!;
    const xs = ballShapes(frame).filter((s) => s.key.startsWith(`${i}b`)).map((s) => ({ j: Number(s.key.slice(`${i}b`.length)), sx: s.matrix[4] }));
    expect(xs).toHaveLength(balls.length);
    // Spheres with a greater z land further along the screen x axis, monotonically.
    xs.sort((a, b) => balls[a.j].z - balls[b.j].z);
    for (let k = 1; k < xs.length; k++) expect(xs[k].sx, `sphere ${xs[k].j}`).toBeGreaterThan(xs[k - 1].sx);
    // And the tip sits well in front of the head's mid-plane.
    const head = frame.shapes.filter((s) => s.kind === 'slice' && s.key.startsWith('0z')) as Extract<(typeof frame.shapes)[number], { kind: 'slice' }>[];
    const headX = head.map((s) => s.matrix[4]);
    expect(Math.max(...xs.map((x) => x.sx))).toBeGreaterThan(Math.max(...headX) + 8);
  });

  it('sorts a nearer sphere over a farther one and sizes the extent for the horns', () => {
    const frame = avatarFrame(ram, { reducedMotion: true, view: { yaw: 0.3, pitch: -0.2 } });
    const discs = ballShapes(frame);
    const vol = buildVolume(ram);
    const order = discs.map((d) => d.key);
    const i = vol.parts.findIndex((p) => p.kind === 'tube');
    const balls = vol.parts[i].balls!;
    const first = order.indexOf(`${i}b0`), last = order.indexOf(`${i}b${balls.length - 1}`);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first);
    const ext = avatarExtent(ram);
    const flat = { ...clone(ram), tubes: undefined } as AvatarDefinition;
    delete (flat as { tubes?: unknown }).tubes;
    expect(ext.size).toBeGreaterThan(avatarExtent(flat).size);
  });

  it('thins tiny live tubes without opening the chain, and never thins avatarFrame', () => {
    const full = avatarFrame(ram, { reducedMotion: true, size: 16 });
    expect(ballShapes(full)).toHaveLength(total(ram));
    const live = liveFrame(ram, { reducedMotion: true, size: 16 });
    const kept = ballShapes(live);
    expect(kept.length).toBeLessThan(total(ram));
    const vol = buildVolume(ram);
    for (const [i, part] of vol.parts.entries()) {
      if (!part.balls) continue;
      const js = kept.filter((s) => s.key.startsWith(`${i}b`)).map((s) => Number(s.key.slice(`${i}b`.length))).sort((a, b) => a - b);
      expect(js[0]).toBe(0);
      expect(js[js.length - 1]).toBe(part.balls.length - 1);
      for (let k = 1; k < js.length; k++) {
        const a = part.balls[js[k - 1]], b = part.balls[js[k]];
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThanOrEqual(Math.max(a.r, b.r) + 1e-9);
      }
    }
    expect(ballShapes(liveFrame(ram, { reducedMotion: true, size: 512 }))).toHaveLength(total(ram));
  });

  it('CSS scene: one disc per sphere, a billboard that undoes the view', () => {
    const html = renderAvatarScene(ram);
    expect((html.match(/data-ball="/g) ?? []).length).toBe(total(ram));
    expect(html).toContain('data-tubes');
    expect(html).toContain('var(--billboard,)');
    const frame = sceneFrame(ram, { reducedMotion: true, view: { yaw: 0.4, pitch: 0.1 } });
    const [, vp, vy] = frame.view.match(/rotateX\(([-\d.]+)rad\) rotateY\(([-\d.]+)rad\)/)!;
    const [, by, bp] = frame.billboard.match(/rotateY\(([-\d.]+)rad\) rotateX\(([-\d.]+)rad\)/)!;
    expect(Number(by)).toBeCloseTo(-Number(vy), 3);
    expect(Number(bp)).toBeCloseTo(-Number(vp), 3);
    const none = renderAvatarScene(bull);
    expect(none).not.toContain('data-tubes');
  });

  it('leaves everything without tubes untouched', () => {
    for (const e of examples) {
      const v2 = { ...clone(e), version: 2 as const };
      expect(renderAvatarSvg(v2), e.id).toBe(renderAvatarSvg(e));
      expect(renderAvatarScene(v2), e.id).toBe(renderAvatarScene(e));
    }
    expect(sceneFrame(bull).billboard).toMatch(/^rotateY\(/);
  });
});
