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
  partZPlane,
  planeMatrix,
  renderAvatarScene,
  renderAvatarSvg,
  sceneFrame,
  sidePlaneMatrix,
  viewBasis,
} from '../src/render.ts';
import { PART_ANGLE_MAX, PART_Z_MAX, validateAvatar } from '../src/validate.ts';
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
    expect(once.value.parts).toHaveLength(3);
  });
});

describe('gallery/ram.json', () => {
  it('validates, builds moved frames and renders every mode', () => {
    expect(errorsOf(ram)).toEqual([]);
    const vol = buildVolume(ram);
    expect(vol.parts).toHaveLength(3);
    expect(vol.parts[0].frame.moved).toBe(false);
    for (const i of [1, 2]) {
      const f = vol.parts[i].frame;
      expect(f.moved).toBe(true);
      expect(f.z).toBe(16);
      expect(f.pitch).toBeCloseTo((35 * Math.PI) / 180);
      expect(Math.abs(f.yaw)).toBeCloseTo((30 * Math.PI) / 180);
    }
    // Eyes stay on the head, not on a horn that now sits in front of it.
    expect(vol.eyePart).toBe(0);

    const svg = renderAvatarSvg(ram);
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    for (const [yaw, pitch] of [[0, 0], [Math.PI / 2, 0], [0, -1.2], [0.6, 0.3]]) {
      const frame = avatarFrame(ram, { reducedMotion: true, view: { yaw, pitch } });
      expect(JSON.stringify(frame)).not.toMatch(/NaN|undefined|Infinity/);
      const scene = sceneFrame(ram, { reducedMotion: true, view: { yaw, pitch } });
      expect(scene.slices.z.length + scene.slices.x.length).toBe(vol.parts.reduce((n, p) => n + p.zSlices.length + p.xSlices.length, 0));
      expect(scene.slices.z.some(Boolean) || scene.slices.x.some(Boolean)).toBe(true);
    }
    const html = renderAvatarScene(ram);
    expect(html).toContain('data-part="1"');
    // The horn wrappers carry the frame: z shift, then the turn, in radians about the pivot.
    expect(html).toMatch(/data-part="1" style="[^"]*transform-origin:34cqw 36cqw 0;transform:translateZ\(16cqw\) rotateY\(0\.5236rad\) rotateX\(-0\.6109rad\)/);
    expect(html).toMatch(/data-part="2" style="[^"]*rotateY\(-0\.5236rad\)/);
    expect(html).toContain('data-eyes');
  });

  it('is not the same picture as the flat v1 reading of the same body', () => {
    const flat: AvatarDefinition = { ...clone(ram), version: 1 };
    delete (flat as { parts?: unknown }).parts;
    expect(errorsOf(flat)).toEqual([]);
    const view = { yaw: Math.PI / 2, pitch: 0 };
    expect(renderAvatarSvg(ram, { view })).not.toBe(renderAvatarSvg(flat, { view }));
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

  it('shifts a part by z straight toward the viewer when facing front', () => {
    const vol = buildVolume(ram);
    const pivot = pivotOf(vol.bounds);
    const v = viewBasis(0, 0);
    const head = partProjection(v, pivot, vol.parts[0].frame);
    const horn = partProjection(v, pivot, vol.parts[1].frame);
    // Depth of the horn's pivot (which the tilt leaves in place) is z closer than the head plane.
    const [px, py] = vol.parts[1].frame.pivot;
    const depth = (P: typeof head) => P.l[6] * px + P.l[7] * py + P.t[2];
    expect(depth(horn) - depth(head)).toBeCloseTo(16, 9);
    // And the pivot stays put on screen.
    expect(horn.l[0] * px + horn.l[1] * py + horn.t[0]).toBeCloseTo(px, 9);
    expect(horn.l[3] * px + horn.l[4] * py + horn.t[1]).toBeCloseTo(py, 9);
  });
});
