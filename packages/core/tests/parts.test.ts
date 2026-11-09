/**
 * v2 part frames: per-part depth offset and tilt. v2 without `parts` must be
 * byte-identical to v1, validation must fence the new fields, and the per-part
 * projection must reproduce the v1 plane matrices under the default frame.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { examples, getExample } from '../src/examples.ts';
import {
  avatarFrame,
  partProjection,
  partXPlane,
  partYPlane,
  partZPlane,
  planeMatrix,
  renderAvatarScene,
  renderAvatarSvg,
  sceneFrame,
  sidePlaneMatrix,
  viewBasis,
} from '../src/render.ts';
import { PART_ANGLE_MAX, PART_Z_MAX, analyzeBody, validateAvatar } from '../src/validate.ts';
import { buildVolume } from '../src/volume.ts';
import type { Point } from '../src/path.ts';
import type { AvatarDefinition } from '../src/types.ts';

const clone = (d: AvatarDefinition): AvatarDefinition => JSON.parse(JSON.stringify(d));
const errorsOf = (input: unknown) => {
  const r = validateAvatar(input);
  return r.ok ? [] : r.errors;
};
/** The body pivot the view rotates about: the center of the whole body's bounds (as render.ts does). */
const pivotOf = (b: { minX: number; maxX: number; minY: number; maxY: number }): Point => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
const ram = JSON.parse(readFileSync('gallery/ram.json', 'utf8')) as AvatarDefinition;
const bull = getExample('bull') ?? examples[0];

describe('v2 without parts', () => {
  it('renders byte-identical to v1', () => {
    for (const e of examples) {
      const v2 = { ...clone(e), version: 2 as const };
      expect(renderAvatarSvg(v2), e.id).toBe(renderAvatarSvg(e));
      expect(renderAvatarScene(v2), e.id).toBe(renderAvatarScene(e));
      const view = { yaw: 0.6, pitch: -0.3 };
      expect(avatarFrame(v2, { reducedMotion: true, view }), e.id).toEqual(avatarFrame(e, { reducedMotion: true, view }));
    }
  });

  it('validates and normalizes with version 2 kept', () => {
    const r = validateAvatar({ ...clone(bull), version: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.version).toBe(2);
      expect(r.value.parts).toBeUndefined();
    }
  });
});

describe('validateAvatar parts', () => {
  const frames = [{}, { z: 10, pitch: 20, yaw: -15, pivot: [50, 40] }];

  it('rejects parts on a v1 definition', () => {
    expect(errorsOf({ ...clone(bull), parts: [{}] }).join()).toMatch(/parts/);
  });

  it('rejects more parts than outline subpaths', () => {
    const outlines = buildVolume(bull).parts.length;
    const parts = Array.from({ length: outlines + 1 }, () => ({}));
    expect(errorsOf({ ...clone(bull), version: 2, parts }).join()).toMatch(/outline subpath/);
    expect(errorsOf({ ...clone(bull), version: 2, parts: parts.slice(1) })).toEqual([]);
  });

  it('rejects out-of-range z, angles and pivot', () => {
    const v2 = { ...clone(bull), version: 2 as const };
    expect(errorsOf({ ...v2, parts: [{ z: 40 }] }).join()).toMatch(new RegExp(`z 40 out of range -${PART_Z_MAX}\\.\\.${PART_Z_MAX}`));
    expect(errorsOf({ ...v2, parts: [{ pitch: 90 }] }).join()).toMatch(new RegExp(`pitch 90 out of range -${PART_ANGLE_MAX}\\.\\.${PART_ANGLE_MAX}`));
    expect(errorsOf({ ...v2, parts: [{ yaw: -80 }] }).join()).toMatch(/yaw -80 out of range/);
    expect(errorsOf({ ...v2, parts: [{ pivot: [1] }] }).join()).toMatch(/pivot must be \[x, y\]/);
    expect(errorsOf({ ...v2, parts: [{ pivot: [50, 120] }] }).join()).toMatch(/pivot must lie within/);
    expect(errorsOf({ ...v2, parts: [{ z: 'deep' }] }).join()).toMatch(/finite number/);
    expect(errorsOf({ ...v2, parts: [{ tilt: 3 }] }).join()).toMatch(/unknown field "parts\[0\]\.tilt"/);
    expect(errorsOf({ ...v2, parts: {} }).join()).toMatch(/parts must be an array/);
    expect(errorsOf({ ...v2, parts: [3] }).join()).toMatch(/parts\[0\] must be an object/);
    expect(errorsOf({ ...v2, parts: frames.slice(0, 1) })).toEqual([]);
  });

  it('normalization of parts is idempotent', () => {
    const once = validateAvatar(ram);
    if (!once.ok) throw new Error(once.errors.join());
    const twice = validateAvatar(once.value);
    if (!twice.ok) throw new Error(twice.errors.join());
    expect(twice.value).toEqual(once.value);
    expect(once.value.parts).toHaveLength(ram.parts!.length);
  });
});

describe('gallery/ram.json', () => {
  const deg = (d: number) => (d * Math.PI) / 180;

  it('validates, builds the frames it declares and renders every mode', () => {
    expect(errorsOf(ram)).toEqual([]);
    const vol = buildVolume(ram);
    const declared = ram.parts!;
    expect(vol.parts.length).toBeGreaterThanOrEqual(declared.length);
    declared.forEach((d, i) => {
      const f = vol.parts[i].frame;
      const moved = (d.z ?? 0) !== 0 || (d.pitch ?? 0) !== 0 || (d.yaw ?? 0) !== 0;
      expect(f.moved, `part ${i}`).toBe(moved);
      expect(f.z, `part ${i}`).toBe(d.z ?? 0);
      expect(f.pitch, `part ${i}`).toBeCloseTo(deg(d.pitch ?? 0));
      expect(f.yaw, `part ${i}`).toBeCloseTo(deg(d.yaw ?? 0));
      if (d.pivot) expect(f.pivot, `part ${i}`).toEqual(d.pivot);
      // Only pitched parts carry horizontal cross-sections.
      expect(vol.parts[i].ySlices.length > 0, `part ${i} y-slices`).toBe((d.pitch ?? 0) !== 0);
    });
    expect(declared.some((d) => (d.pitch ?? 0) !== 0)).toBe(true);
    // Eyes stay on the head (the first, unmoved outline), not on a horn that now sits in front of it.
    expect(vol.eyePart).toBe(0);

    const svg = renderAvatarSvg(ram);
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    const total = vol.parts.reduce((n, p) => n + p.zSlices.length + p.xSlices.length + p.ySlices.length, 0);
    for (const [yaw, pitch] of [[0, 0], [Math.PI / 2, 0], [0, -1.2], [0.6, 0.3]]) {
      const frame = avatarFrame(ram, { reducedMotion: true, view: { yaw, pitch } });
      expect(JSON.stringify(frame)).not.toMatch(/NaN|undefined|Infinity/);
      const scene = sceneFrame(ram, { reducedMotion: true, view: { yaw, pitch } });
      expect(scene.slices.z.length + scene.slices.x.length + scene.slices.y.length).toBe(total);
      expect(scene.slices.z.some(Boolean) || scene.slices.x.some(Boolean) || scene.slices.y.some(Boolean)).toBe(true);
    }
    const html = renderAvatarScene(ram);
    expect(html).toContain('data-stack="y"');
    const tip = declared.findIndex((d) => (d.pitch ?? 0) !== 0);
    const t = declared[tip];
    const re = new RegExp(`data-part="${tip}" style="[^"]*transform-origin:${t.pivot![0]}cqw ${t.pivot![1]}cqw 0;transform:translateZ\\(${t.z}cqw\\) rotateY\\(${(-deg(t.yaw ?? 0)).toFixed(4).replace('-0.0000', '0')}rad\\) rotateX\\(${(-deg(t.pitch!)).toFixed(4)}rad\\)`);
    expect(html).toMatch(re);
    expect(html).toContain('data-eyes');
  });

  it('pitched horn tips face the viewer through their y-planes when seen from the front', () => {
    const vol = buildVolume(ram);
    const pivot = pivotOf(vol.bounds);
    const v = viewBasis(0, 0);
    const tip = ram.parts!.findIndex((d) => Math.abs(d.pitch ?? 0) >= 60);
    expect(tip).toBeGreaterThan(0);
    const P = partProjection(v, pivot, vol.parts[tip].frame, true);
    expect(P.stack).toBe('y');
    // Without y-slices the same part would have to fall back to z or x planes.
    expect(partProjection(v, pivot, vol.parts[tip].frame, false).stack).not.toBe('y');
    // Every distinct y-slice path has its own id in the still render.
    const svg = renderAvatarSvg(ram);
    const ids = [...svg.matchAll(/<path id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(svg).not.toContain('href="#undefined"');
  });

  it('is not the same picture as the flat v1 reading of the same body', () => {
    const flat: AvatarDefinition = { ...clone(ram), version: 1 };
    delete (flat as { parts?: unknown }).parts;
    expect(errorsOf(flat)).toEqual([]);
    const view = { yaw: Math.PI / 2, pitch: 0 };
    expect(renderAvatarSvg(ram, { view })).not.toBe(renderAvatarSvg(flat, { view }));
  });
});

describe('holes', () => {
  it('cut exactly one part each: the ring horns stay open, the head and wool stay solid', () => {
    const vol = buildVolume(ram);
    const holes = analyzeBody(ram.body.path).subpaths.filter((s) => s.hole).length;
    expect(holes).toBeGreaterThan(0);
    const cut = vol.parts.map((p) => p.polys.length - 1);
    expect(cut.reduce((n, c) => n + c, 0)).toBe(holes);
    // The head (first part) carries no hole even though the horns sit in front of it.
    expect(cut[0]).toBe(0);
    const rings = cut.flatMap((c, i) => (c > 0 ? [i] : []));
    for (const i of rings) {
      const { center } = vol.parts[i];
      expect(vol.parts[i].height(center[0], center[1]), `ring ${i} open at its center`).toBe(0);
    }
  });
});

describe('partProjection', () => {
  const views = [[0, 0], [0.4, 0], [0, -0.5], [1.1, 0.3], [Math.PI, 0.2], [-2, -0.7]];

  it('reproduces planeMatrix and sidePlaneMatrix under the default frame', () => {
    const vol = buildVolume(bull);
    const pivot = pivotOf(vol.bounds);
    for (const [yaw, pitch] of views) {
      const v = viewBasis(yaw, pitch);
      const P = partProjection(v, pivot, vol.parts[0].frame);
      for (const at of [-12, 0, 7.5]) {
        const z = partZPlane(P, at), zRef = planeMatrix(v, at, pivot);
        const x = partXPlane(P, at), xRef = sidePlaneMatrix(v, at, pivot);
        for (let k = 0; k < 6; k++) {
          expect(Math.abs(z[k] - zRef[k]), `z yaw=${yaw} pitch=${pitch} at=${at} [${k}]`).toBeLessThan(1e-9);
          expect(Math.abs(x[k] - xRef[k]), `x yaw=${yaw} pitch=${pitch} at=${at} [${k}]`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('partYPlane maps the horizontal plane consistently with partZPlane', () => {
    const vol = buildVolume(ram);
    const pivot = pivotOf(vol.bounds);
    for (const [yaw, pitch] of views) {
      const v = viewBasis(yaw, pitch);
      for (const part of vol.parts) {
        const P = partProjection(v, pivot, part.frame, true);
        for (const at of [-9, 0, 11]) {
          const Y = partYPlane(P, at);
          // A y-plane point (x, w = -z) at local y = at is the local point (x, at, -w).
          for (const [x, w] of [[12, 0], [0, 7], [-5, -3]]) {
            const Z = partZPlane(P, -w);
            const fromZ = [Z[0] * x + Z[2] * at + Z[4], Z[1] * x + Z[3] * at + Z[5]];
            const fromY = [Y[0] * x + Y[2] * w + Y[4], Y[1] * x + Y[3] * w + Y[5]];
            expect(Math.abs(fromY[0] - fromZ[0])).toBeLessThan(1e-9);
            expect(Math.abs(fromY[1] - fromZ[1])).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('shifts a part by z straight toward the viewer when facing front', () => {
    const vol = buildVolume(ram);
    const pivot = pivotOf(vol.bounds);
    const v = viewBasis(0, 0);
    const i = ram.parts!.findIndex((d) => (d.z ?? 0) !== 0 && d.pivot);
    const head = partProjection(v, pivot, vol.parts[0].frame);
    const horn = partProjection(v, pivot, vol.parts[i].frame);
    // Depth of the horn's pivot (which the tilt leaves in place) is z closer than the head plane.
    const [px, py] = vol.parts[i].frame.pivot;
    const depth = (P: typeof head) => P.l[6] * px + P.l[7] * py + P.t[2];
    expect(depth(horn) - depth(head)).toBeCloseTo(ram.parts![i].z!, 9);
    // And the pivot stays put on screen.
    expect(horn.l[0] * px + horn.l[1] * py + horn.t[0]).toBeCloseTo(px, 9);
    expect(horn.l[3] * px + horn.l[4] * py + horn.t[1]).toBeCloseTo(py, 9);
  });
});
