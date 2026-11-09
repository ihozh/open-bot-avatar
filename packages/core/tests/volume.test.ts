import { describe, expect, it } from 'vitest';
import { contourLoops, simplifyLoop } from '../src/contour.ts';
import { examples, getExample } from '../src/examples.ts';
import { filledArea, flattenPath, insideRow, isInside, parsePath, winding } from '../src/path.ts';
import { activeStack, planeMatrix, projectPoint, renderAvatarScene, renderAvatarSvg, sceneFrame, sidePlaneMatrix, viewBasis } from '../src/render.ts';
import { EYE_CLEARANCE, EYE_H, GAZE_X, GAZE_Y, analyzeBody, drawnEyesFit, gazeRange, validateAvatar } from '../src/validate.ts';
import { EYE_BOOST, EYE_BOOST_PAD, FACE_ROOM_TARGET, type VolumePart, buildVolume, erosionAt, faceRoom, revolveAxis, surfaceZ } from '../src/volume.ts';
import { SEAM_MAX, SEAM_MIN, silhouetteSeams } from '../src/seams.ts';
import type { AvatarDefinition } from '../src/types.ts';

const def = (path: string, eyes = { x: 50, y: 50, spacing: 14, scale: 1 }): AvatarDefinition => {
  const r = validateAvatar({ version: 1, id: 'test', name: 'Test', body: { path }, eyes });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
};
const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const pathPolys = (d: string) => flattenPath(parsePath(d));

describe('buildVolume', () => {
  it('gives every example finite, closed, nonzero 3D extent in both slice stacks', () => {
    for (const e of examples) {
      const vol = buildVolume(e);
      expect(vol.parts.length, e.id).toBeGreaterThan(0);
      for (const part of vol.parts) {
        expect(part.depth, e.id).toBeGreaterThan(2);
        expect(part.zSlices.length, e.id).toBeGreaterThan(4);
        expect(part.xSlices.length, e.id).toBeGreaterThan(2);
        for (const s of [...part.zSlices, ...part.xSlices]) {
          expect(numbers(s.d).every(Number.isFinite)).toBe(true);
          expect(s.d).toMatch(/Z$/); // every loop closed
          expect(s.box.w).toBeGreaterThan(0);
        }
        // Front and back are mirror images; the stack spans most of the depth.
        const zs = part.zSlices.map((s) => s.at);
        expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0, 6);
        expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(part.depth * 0.6);
        // A side plane now represents an entire slab, so the outer plane can
        // sit just outside the outline by half a slab plus one sampling cell.
        // Keep that approximation bounded, and never exceed the solid's depth.
        const sideTolerance = Math.max(1.1, (part.bounds.maxX - part.bounds.minX) / 40) / 2 + 0.45;
        for (const s of part.xSlices) {
          expect(s.at).toBeGreaterThanOrEqual(part.bounds.minX - sideTolerance);
          expect(s.at).toBeLessThanOrEqual(part.bounds.maxX + sideTolerance);
          expect(s.box.w / 2).toBeLessThanOrEqual(part.depth / 2 + 0.2);
        }
      }
      expect(vol.eyeZ.every((z) => z > 0)).toBe(true);
    }
  });

  it('rounds inflated edges: cross-sections shrink toward front and back, never at the core', () => {
    const part = buildVolume(getExample('controller')!).parts[0];
    expect(part.kind).toBe('inflate');
    expect(erosionAt(part, 0)).toBe(0);
    let prev = 0;
    for (let z = 0; z <= part.depth / 2; z += part.depth / 40) {
      const e = erosionAt(part, z);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = e;
    }
    expect(surfaceZ(part, part.rxy + 1)).toBeCloseTo(part.depth / 2, 9);
    expect(surfaceZ(part, 0.5)).toBeLessThan(part.depth / 2 - 1);
    // Outer slices are nested inside the core outline and pulled in from it.
    const outer = part.zSlices[part.zSlices.length - 1];
    expect(outer.inset).toBeGreaterThan(2);
    const core = pathPolys(part.d);
    for (let k = 0; k < numbers(outer.d).length; k += 2) {
      const [x, y] = numbers(outer.d).slice(k, k + 2);
      expect(isInside(core, x, y)).toBe(true);
    }
  });

  it('handles concavity and holes: the controller notch and the mug handle loop stay empty', () => {
    const controller = buildVolume(getExample('controller')!).parts[0];
    expect(controller.height(50, 70)).toBe(0); // between the grips
    expect(controller.height(50, 45)).toBeGreaterThan(5);
    const mug = buildVolume(getExample('mug')!);
    const handle = mug.parts.find((p) => p.kind === 'inflate')!;
    expect(isInside(handle.polys, 72, 53)).toBe(false);
    // Contour slices are drawn with evenodd, the core with the original nonzero rule.
    for (const s of handle.zSlices) {
      const w = winding(pathPolys(s.d), 72, 53);
      expect(s.evenOdd ? Math.abs(w) % 2 === 1 : w !== 0).toBe(false);
    }
    // A ring is as deep as its band is thick, not as deep as its bounding box is wide.
    expect(handle.depth).toBeLessThan(18);
  });

  it('turns symmetric parts of multi-part bodies into solids of revolution', () => {
    const mug = buildVolume(getExample('mug')!);
    const cup = mug.parts.find((p) => p.kind === 'revolve-y')!;
    expect(cup).toBeDefined();
    // A cylinder: as deep as it is wide, round in the top view.
    expect(cup.depth).toBeCloseTo(cup.bounds.maxX - cup.bounds.minX, 0);
    const r = cup.depth / 2;
    expect(cup.height(cup.axis!, 50)).toBeCloseTo(r, 0);
    expect(cup.height(cup.axis! + r * Math.SQRT1_2, 50)).toBeCloseTo(r * Math.SQRT1_2, 0);
    // Single-part bodies (controller, chat bubble) stay inflated slabs.
    expect(buildVolume(getExample('controller')!).parts[0].kind).toBe('inflate');
    expect(buildVolume(getExample('chat')!).parts[0].kind).toBe('inflate');
  });

  it('reads the symmetric barbell as round discs on a cylinder about one horizontal axis', () => {
    expect(revolveAxis(analyzeBody(getExample('barbell')!.body.path))).toBeCloseTo(50, 6);
    const vol = buildVolume(getExample('barbell')!);
    expect(vol.parts.every((p) => p.kind === 'revolve-x' && p.axis === 50)).toBe(true);
    const plate = vol.parts.find((p) => isInside(p.polys, 26, 20))!;
    // Round: as deep as it is tall, and its side profile is a circle.
    expect(plate.depth).toBeCloseTo(plate.bounds.maxY - plate.bounds.minY, 0);
    const side = plate.xSlices.reduce((a, b) => (a.box.w * a.box.h > b.box.w * b.box.h ? a : b));
    expect(side.box.w).toBeCloseTo(side.box.h, 0);
    const bar = vol.parts[vol.eyePart];
    expect(plate.depth).toBeGreaterThan(bar.depth * 1.5); // discs much wider than the grip cylinder
    expect(revolveAxis(analyzeBody(getExample('watering-can')!.body.path))).toBeNull();
    expect(revolveAxis(analyzeBody(getExample('controller')!.body.path))).toBeNull();
  });

  it('scales with the volume amount and goes flat at 0', () => {
    const c = getExample('controller')!;
    const one = buildVolume(c, 1).parts[0].depth;
    expect(buildVolume(c, 2).parts[0].depth).toBeCloseTo(Math.min(one * 2, 60), 6);
    const flat = buildVolume(c, 0).parts[0];
    expect(flat.zSlices).toHaveLength(1);
    expect(flat.xSlices).toHaveLength(0);
  });

  it('enlarges the eyes where the body has room and seats them above the surface', () => {
    const box = buildVolume(def('M15 25H85V75H15Z'));
    expect(box.eyeScale).toBeCloseTo(EYE_BOOST, 6);
    expect(box.eyeZ[0]).toBeCloseTo(box.parts[0].depth / 2, 1);
    for (const e of examples) {
      const vol = buildVolume(e);
      expect(vol.eyeScale, e.id).toBeGreaterThanOrEqual(e.eyes.scale * 1.15);
      const host = vol.parts[vol.eyePart];
      expect(vol.eyeZ[0]).toBeGreaterThanOrEqual(host.height(e.eyes.x - e.eyes.spacing / 2, e.eyes.y) - 1e-9);
    }
  });
});

describe('contours', () => {
  it('traces closed loops of a sampled disc, including a hole', () => {
    const n = 41, step = 1, values = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = Math.hypot(i - 20, j - 20);
      values[j * n + i] = r < 6 ? -1 : 15 - r; // ring between radius 6 and 15
    }
    const loops = contourLoops({ values, nx: n, ny: n, x0: 0, y0: 0, step }, 0);
    expect(loops).toHaveLength(2);
    const radii = loops.map((l) => l.reduce((s, [x, y]) => s + Math.hypot(x - 20, y - 20), 0) / l.length).sort((a, b) => a - b);
    expect(radii[1]).toBeCloseTo(15, 0);
    expect(radii[0]).toBeGreaterThan(5);
    expect(simplifyLoop(loops[0], 0.05).length).toBeLessThanOrEqual(loops[0].length);
  });

  it('scanline inside tests agree with per-point winding', () => {
    const polys = pathPolys(getExample('mug')!.body.path);
    const xs = Array.from({ length: 90 }, (_, i) => 5.3 + i);
    const row = new Uint8Array(xs.length);
    for (const y of [30.1, 53.2, 70.7]) {
      insideRow(polys, y, xs, row);
      xs.forEach((x, k) => expect(row[k] === 1).toBe(isInside(polys, x, y)));
    }
  });
});

describe('projection', () => {
  const pivot: [number, number] = [50, 50];

  it('is the identity for the front view and keeps the pivot fixed', () => {
    const v = viewBasis(0, 0);
    expect(planeMatrix(v, 0, pivot)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(projectPoint(v, [30, 70, 5], pivot)).toEqual([30, 70, 5]);
    const [x, y] = projectPoint(viewBasis(0.7, 0.3), [50, 50, 0], pivot);
    expect(x).toBeCloseTo(50, 9);
    expect(y).toBeCloseTo(50, 9);
  });

  it('turns about the vertical axis: front points move right and toward the viewer for positive yaw', () => {
    const v = viewBasis(Math.PI / 4, 0);
    const [x, , depth] = projectPoint(v, [50, 50, 10], pivot);
    expect(x).toBeCloseTo(50 + 10 * Math.SQRT1_2, 9);
    expect(depth).toBeCloseTo(10 * Math.SQRT1_2, 9);
    expect(projectPoint(viewBasis(Math.PI, 0), [50, 50, -10], pivot)[2]).toBeGreaterThan(9);
  });

  it('maps side planes consistently with front planes and switches stacks at 45°', () => {
    const v = viewBasis(1.1, 0.4);
    for (const [x, y, z] of [[20, 80, -12], [60, 30, 7]] as const) {
      const m = sidePlaneMatrix(v, x, pivot);
      const [px, py] = projectPoint(v, [x, y, z], pivot);
      // Side planes use local u = -z.
      expect(m[0] * -z + m[2] * y + m[4]).toBeCloseTo(px, 9);
      expect(m[1] * -z + m[3] * y + m[5]).toBeCloseTo(py, 9);
    }
    expect(activeStack(viewBasis(0.7, 0))).toBe('z');
    expect(activeStack(viewBasis(0.9, 0))).toBe('x');
    expect(activeStack(viewBasis(Math.PI, 0))).toBe('z');
  });
});

describe('live scene', () => {
  it('mounts static slices once and animates through transforms only', () => {
    const c = getExample('controller')!;
    const html = renderAvatarScene(c);
    const vol = buildVolume(c);
    const slices = vol.parts.reduce((n, p) => n + p.zSlices.length + p.xSlices.length, 0);
    expect((html.match(/<svg /g) ?? []).length).toBe(slices + 2); // + one happy-eye arc per eye
    expect(html).toContain('preserve-3d');
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
    const a = sceneFrame(c, { time: 0.4 }), b = sceneFrame(c, { time: 2.9 });
    expect(a.scene).toBe(b.scene);
    expect(a.view).not.toBe(b.view);
    expect(sceneFrame(c, { reducedMotion: true, view: { yaw: 1.3, pitch: 0 } }).stack).toBe('x');
    expect(sceneFrame(c, { reducedMotion: true, view: { yaw: Math.PI, pitch: 0 } }).eyes.every((e) => !e.visible)).toBe(true);
    expect(sceneFrame(c, { motion: 'happy', time: 0.3 }).eyes.every((e) => e.happy)).toBe(true);
  });

  it('keeps every part core when small sizes thin out the slices', () => {
    const chat = getExample('chat')!;
    expect(sceneFrame(chat, { size: 32, reducedMotion: true, view: { yaw: 0.3, pitch: -0.2 } }).slices.z.some(Boolean)).toBe(true);
    for (const e of examples) {
      const cores: number[] = [];
      buildVolume(e).parts.reduce((at, part) => {
        cores.push(at + part.zSlices.findIndex((s) => s.at === 0 && s.inset === 0));
        return at + part.zSlices.length;
      }, 0);
      for (const size of [16, 32, 64]) {
        for (const [yaw, pitch] of [[0.3, -0.2], [0.3, 0], [0, 0.2], [0.6, 0.3]]) {
          const frame = sceneFrame(e, { size, reducedMotion: true, view: { yaw, pitch } });
          if (frame.stack === 'z') for (const i of cores) expect(frame.slices.z[i], `${e.id} ${size}px`).toBe(true);
        }
      }
    }
  });
});

describe('face room', () => {
  const corners = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as const;

  it('every starter keeps visible room around the eyes as drawn: enlarged, happy arcs, any gaze', () => {
    for (const e of examples) {
      const room = faceRoom(e);
      expect(room, e.id).toMatchObject({ boost: EYE_BOOST, ok: true });
      expect(room.clearance, e.id).toBeGreaterThanOrEqual(FACE_ROOM_TARGET);
      // Eye offsets exactly as the renderer computes them, at every gaze extreme.
      const body = analyzeBody(e.body.path);
      const scale = buildVolume(e).eyeScale;
      const eyes = { ...e.eyes, scale };
      const range = gazeRange(body.polys, eyes);
      for (const [gx, gy] of corners) {
        const dx = gx * (gx >= 0 ? range.right : range.left) * GAZE_X * scale;
        const dy = gy * (gy >= 0 ? range.down : range.up) * GAZE_Y * scale;
        expect(drawnEyesFit(body.polys, eyes, dx, dy, EYE_CLEARANCE), `${e.id} gaze ${gx},${gy}`).toBeNull();
      }
    }
  });

  it('the part carrying the face is the largest part of every starter', () => {
    for (const e of examples) {
      const vol = buildVolume(e);
      const areas = vol.parts.map((p) => filledArea(p.polys, p.bounds));
      expect(Math.max(...areas), e.id).toBe(areas[vol.eyePart]);
    }
  });

  it('accessories stay subordinate by outer extent, not just by filled area', () => {
    // How big each secondary part looks next to the face part: its bounding box (a hollow
    // loop counts whole, hole included) relative to the face part's, and how far it pokes out.
    const extents = (e: AvatarDefinition) => {
      const vol = buildVolume(e);
      const f = vol.parts[vol.eyePart].bounds;
      const fw = f.maxX - f.minX, fh = f.maxY - f.minY;
      // A member that runs right through the face part (a shaft) is structure, not an add-on.
      const through = (b: typeof f) => (b.minX < f.minX && b.maxX > f.maxX) || (b.minY < f.minY && b.maxY > f.maxY);
      return vol.parts.filter((p, i) => i !== vol.eyePart && !through(p.bounds)).map((p) => {
        const b = p.bounds, w = b.maxX - b.minX, h = b.maxY - b.minY;
        return {
          hollow: p.polys.length > 1,
          box: (w * h) / (fw * fh),
          tall: h / fh,
          out: Math.max(0, (f.minX - b.minX) / fw, (b.maxX - f.maxX) / fw, (f.minY - b.minY) / fh, (b.maxY - f.maxY) / fh),
        };
      });
    };
    const subordinate = (e: AvatarDefinition) =>
      extents(e).every((a) => a.box <= 0.5 && (!a.hollow || (a.box <= 0.3 && a.tall <= 0.7 && a.out <= 0.35)));
    for (const e of examples) expect(subordinate(e), e.id).toBe(true);
    // The earlier watering can: the face part had by far the most fill, yet its thin handle
    // arch spanned nearly the body's height and towered over it, so the handle read as the shape.
    const archCan = def(
      'M24 44H56C62 44 65 47 66 52L68 76C68.5 82 64 86 58 86H22C16 86 11.5 82 12 76L14 52C15 47 18 44 24 44Z' +
        'M14 58C8 50 7 36 12 28C17 20 29 19 36 25C41 29 43 36 43 46ZM35 44C35 36 31 29 25 29C19 29 16 34 16 40C16 43 17 45 18 47Z' +
        'M64 60C70 55 75 47 79 35.5L84 38.5C80 52 73 66 66 76ZM77.8 31.3A7.5 3.4 34 0 1 90.2 39.7A7.5 3.4 34 0 1 77.8 31.3Z',
      { x: 40, y: 64, spacing: 16, scale: 1.15 },
    );
    const vol = buildVolume(archCan);
    const areas = vol.parts.map((p) => filledArea(p.polys, p.bounds));
    expect(Math.max(...areas)).toBe(areas[vol.eyePart]);
    expect(subordinate(archCan)).toBe(false);
  });

  it('shrunken handle loops stay attached: their opening closes against the face part', () => {
    // A loop handle is a band joined to the body at both ends, so its see-through opening is
    // bounded by the body on one side. A free ring parked on the corner has fill all round it.
    const closesOnFace = (e: AvatarDefinition): number[] => {
      const vol = buildVolume(e);
      const host = vol.parts[vol.eyePart].polys;
      const all = analyzeBody(e.body.path).polys;
      return vol.parts.filter((p, i) => i !== vol.eyePart && p.polys.length > 1).map((p) => {
        // Share of the opening's edge that is the face part rather than the handle band.
        let onHost = 0, edge = 0;
        const b = p.bounds;
        for (let x = b.minX; x <= b.maxX; x += 0.5) {
          for (let y = b.minY; y <= b.maxY; y += 0.5) {
            if (!isInside([p.polys[0]], x, y) || isInside(all, x, y)) continue; // not in the opening
            for (const [dx, dy] of [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]]) {
              if (!isInside(all, x + dx, y + dy)) continue;
              edge++;
              if (isInside(host, x + dx, y + dy)) onHost++;
            }
          }
        }
        return onHost / edge;
      });
    };
    for (const id of ['mug', 'watering-can']) {
      const shares = closesOnFace(getExample(id)!);
      expect(shares, id).toHaveLength(1);
      expect(shares[0], id).toBeGreaterThan(0.2);
    }
    const body = 'M32 38H62C68 38 71 41 72 47L74 76C74.5 82 70 86 64 86H30C24 86 19.5 82 20 76L22 47C23 41 26 38 32 38Z';
    const ring = 'M12.8 50.2A12.5 9 -55 0 1 27.2 29.8A12.5 9 -55 0 1 12.8 50.2ZM15.7 46.1A7.5 4 -55 0 0 24.3 33.9A7.5 4 -55 0 0 15.7 46.1Z';
    expect(closesOnFace(def(body + ring, { x: 47, y: 61, spacing: 16, scale: 1.15 }))[0]).toBeLessThan(0.1);
  });

  it('barbell: a grip just big enough for the face, stepping down through two weight tiers to a bar end', () => {
    const vol = buildVolume(getExample('barbell')!);
    const grip = vol.parts[vol.eyePart];
    const h = (p: VolumePart) => p.bounds.maxY - p.bounds.minY;
    // Right half, from the grip outward: two weight tiers, then the bar continuing past them.
    const right = vol.parts.filter((p) => p !== grip && p.bounds.minX > 50).sort((p, q) => p.bounds.minX - q.bounds.minX);
    expect(right).toHaveLength(3);
    const [big, small, end] = right;
    expect(h(big)).toBeGreaterThan(h(grip) * 1.5);
    expect(h(small)).toBeLessThan(h(big) * 0.8);
    expect(h(end)).toBeLessThan(h(small) * 0.6);
    expect(h(end)).toBeGreaterThanOrEqual(15); // a chunky bar end, not a pin
    expect(end.bounds.maxX - small.bounds.maxX).toBeGreaterThanOrEqual(5);
    // The grip carries the face without being padded into a block.
    expect(faceRoom(getExample('barbell')!).clearance).toBeLessThan(FACE_ROOM_TARGET * 2);
    // The eyes' vertical reach stays inside the grip's round section, so they hug the curve when turned.
    expect((EYE_H * vol.eyeScale) / 2 + GAZE_Y * vol.eyeScale).toBeLessThan((h(grip) / 2) * 0.65);
  });

  it('gaze is a small nudge, not a slide to the edge', () => {
    expect(GAZE_X * EYE_BOOST).toBeLessThanOrEqual(2.5);
    expect(GAZE_Y * EYE_BOOST).toBeLessThanOrEqual(2);
  });

  it('still accepts tight v1 faces: they validate and render, and are only flagged by the face-room check', () => {
    const tight = def('M20 39H80A6 6 0 0 1 86 45V55A6 6 0 0 1 80 61H20A6 6 0 0 1 14 55V45A6 6 0 0 1 20 39Z');
    expect(validateAvatar(tight).ok).toBe(true);
    expect(faceRoom(tight).ok).toBe(false);
    const vol = buildVolume(tight);
    // Not enlarged into the edge: the renderer only boosts eyes that keep EYE_BOOST_PAD.
    if (vol.eyeScale > tight.eyes.scale) {
      expect(drawnEyesFit(analyzeBody(tight.body.path).polys, { ...tight.eyes, scale: vol.eyeScale }, 0, 0, EYE_BOOST_PAD)).toBeNull();
    }
  });
});

describe('eye visibility on curved hosts', () => {
  const eyesAt = (e: AvatarDefinition, yaw: number) =>
    (renderAvatarSvg(e, { reducedMotion: true, view: { yaw, pitch: 0 } }).match(/<rect /g) ?? []).length;

  it('drops the eye nearer the limb of a round part first instead of letting it hang past the edge', () => {
    for (const id of ['mug', 'lightbulb', 'sprout', 'watering-can']) {
      const e = getExample(id)!;
      expect(eyesAt(e, 0), id).toBe(2);
      expect([-1.1, 1.4].map((yaw) => eyesAt(e, yaw)), id).toContain(1);
    }
  });

  it('keeps both eyes on flat faces until the whole front turns away', () => {
    const c = getExample('controller')!;
    expect(eyesAt(c, 0.8)).toBe(2);
    expect(eyesAt(c, Math.PI)).toBe(0);
  });
});

describe('silhouette seams', () => {
  const seams = (d: string) => silhouetteSeams(analyzeBody(d).polys);
  // A dome whose neck ends at x 36..64 on y 66, over a base below it.
  const dome = 'M36 72V66C36 60 18 55 18 40A32 32 0 0 1 82 40C82 55 64 60 64 66V72Z';
  const roundedBase = (l: number, r: number, top: number) =>
    `M${l + 4} ${top}H${r - 4}A4 4 0 0 1 ${r} ${top + 4}V80A4 4 0 0 1 ${r - 4} 84H${l + 4}A4 4 0 0 1 ${l} 80V${top + 4}A4 4 0 0 1 ${l + 4} ${top}Z`;

  it('flags joins whose edges nearly line up: a notch from a rounded corner at the joint, or a thin ledge', () => {
    // Same width as the neck, but its rounded top corners sit on the outline at the joint.
    const notch = seams(dome.replace('V72Z', 'V70Z').replace('M36 72', 'M36 70') + roundedBase(36, 64, 68));
    expect(notch.map((s) => s.side).sort()).toEqual(['left', 'right']);
    for (const s of notch) expect(Math.abs(s.size)).toBeGreaterThanOrEqual(SEAM_MIN);
    // Base a unit narrower than the neck, flush-cornered: a sliver of a step on both sides.
    const ledge = seams(dome + 'M37 68H63V84H37Z');
    expect(ledge.filter((s) => s.side === 'left' || s.side === 'right')).toHaveLength(2);
    for (const s of ledge) expect(Math.abs(s.size)).toBeLessThan(SEAM_MAX);
  });

  it('accepts a flush, continuous join and a clear rounded step, at any offset', () => {
    for (const dx of [0, 0.37, 1.5]) {
      const flush = `M${36 + dx} 72V66C${36 + dx} 60 ${18 + dx} 55 ${18 + dx} 40A32 32 0 0 1 ${82 + dx} 40C${82 + dx} 55 ${64 + dx} 60 ${64 + dx} 66V72Z` +
        `M${36 + dx} 68H${64 + dx}V80A4 4 0 0 1 ${60 + dx} 84H${40 + dx}A4 4 0 0 1 ${36 + dx} 80Z`;
      expect(seams(flush), `flush ${dx}`).toEqual([]);
      const step = flush.slice(0, flush.indexOf('Z') + 1) + roundedBase(40 + dx, 60 + dx, 68);
      expect(seams(step), `step ${dx}`).toEqual([]);
    }
  });

  it('every starter has only decisive steps or smooth joins, and revolved parts keep their own round volume', () => {
    for (const e of examples) expect(seams(e.body.path), e.id).toEqual([]);
    const bulb = buildVolume(getExample('lightbulb')!);
    expect(bulb.parts.map((p) => p.kind)).toEqual(['revolve-y', 'revolve-y', 'revolve-y']);
    // The flush neck and base turn as one continuous round surface at their join.
    const [glass, base] = bulb.parts;
    expect(glass.height(50, 70)).toBeCloseTo(base.height(50, 70), 0);
  });
});
