import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { examples, getExample } from '../src/examples.ts';
import { blinkAt, computePose } from '../src/motion.ts';
import { flattenPath, isInside, parsePath, PathError } from '../src/path.ts';
import { DEFAULT_COLOR, DEFAULT_EYE_COLOR, renderAvatarSvg } from '../src/render.ts';
import { analyzeBody, RECESS_MAX_AREA, validateAvatar } from '../src/validate.ts';
import type { AvatarDefinition } from '../src/types.ts';

const controller = getExample('controller')!;
const clone = (d: AvatarDefinition): AvatarDefinition => JSON.parse(JSON.stringify(d));
const errorsOf = (input: unknown) => {
  const r = validateAvatar(input);
  return r.ok ? [] : r.errors;
};

/** Minimal well-formedness check: every opened tag closes in order. */
function assertBalanced(svg: string) {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (close) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
}

describe('examples', () => {
  it('include controller and barbell and all validate', () => {
    expect(examples.map((e) => e.id)).toEqual(expect.arrayContaining(['controller', 'barbell']));
    expect(new Set(examples.map((e) => e.id)).size).toBe(examples.length);
    for (const e of examples) expect(errorsOf(e), e.id).toEqual([]);
  });

  it('normalization is idempotent', () => {
    for (const e of examples) {
      const once = validateAvatar(e);
      if (!once.ok) throw new Error(once.errors.join());
      const twice = validateAvatar(once.value);
      expect(twice.ok && twice.value).toEqual(once.value);
    }
  });

  it('skill output and system prompt examples match the engine examples', () => {
    const skillRun = JSON.parse(readFileSync('skills/generate-avatar/examples/watering-can.json', 'utf8'));
    expect(skillRun).toEqual(getExample('watering-can'));
    const design = readFileSync('skills/generate-avatar/references/system-prompt.md', 'utf8');
    const blocks = [...design.matchAll(/```json\n(.*?)\n```/gs)].map((m) => JSON.parse(m[1]));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) expect(b).toEqual(getExample(b.id));
  });
});

describe('path geometry', () => {
  it('cuts counter-wound holes and merges overlapping outlines', () => {
    const mug = flattenPath(parsePath(getExample('mug')!.body.path));
    expect(isInside(mug, 72, 53)).toBe(false); // inside the handle loop
    expect(isInside(mug, 43, 52)).toBe(true); // cup face
    const barbell = flattenPath(parsePath(getExample('barbell')!.body.path));
    expect(isInside(barbell, 30, 50)).toBe(true); // bar/plate overlap stays filled
  });

  it('classifies holes by size and keeps per-subpath probes', () => {
    const buttons = analyzeBody('M10 20H90V80H10ZM48 48A2 2 0 1 0 52 48A2 2 0 1 0 48 48Z');
    expect(buttons.holes).toHaveLength(1);
    expect(buttons.holes[0].area).toBeLessThanOrEqual(RECESS_MAX_AREA);
    const mug = analyzeBody(getExample('mug')!.body.path);
    expect(mug.holes).toHaveLength(1);
    expect(mug.holes[0].area).toBeGreaterThan(RECESS_MAX_AREA);
    const hole = mug.subpaths.find((s) => s.hole)!;
    expect(hole.probe && isInside(mug.polys, hole.probe[0], hole.probe[1])).toBe(false);
  });

  it('expands relative and shorthand commands to absolute geometry', () => {
    const a = flattenPath(parsePath('M20 20h60v60h-60z'));
    const b = flattenPath(parsePath('M20 20L80 20L80 80L20 80Z'));
    expect(a).toEqual(b);
    expect(() => parsePath('M0 0 A5 5 0 011 10 10')).toThrow(PathError);
  });
});

describe('validateAvatar', () => {
  it('rejects markup, styling and unknown fields', () => {
    const withScript = clone(controller);
    withScript.body.path = 'M10 10L90 10L90 90Z"/><script>alert(1)</script>';
    expect(errorsOf(withScript).join()).toMatch(/unsupported character/);
    expect(errorsOf({ ...clone(controller), color: '#f00' }).join()).toMatch(/unknown field "color"/);
    expect(errorsOf({ ...clone(controller), body: { path: controller.body.path, fill: 'red' } }).join()).toMatch(/body.fill/);
    expect(errorsOf(null)).not.toEqual([]);
    expect(errorsOf({ ...clone(controller), version: 3 }).join()).toMatch(/version/);
    expect(errorsOf({ ...clone(controller), id: 'Has Spaces' }).join()).toMatch(/id/);
  });

  it('rejects geometry outside the safe area or too small', () => {
    expect(errorsOf({ ...clone(controller), body: { path: 'M2 20L98 20L98 80L2 80Z' } }).join()).toMatch(/safe area/);
    expect(errorsOf({ ...clone(controller), body: { path: 'M45 40L55 40L55 52L45 52Z' } }).join()).toMatch(/too small/);
    expect(errorsOf({ ...clone(controller), body: { path: 'M10 10Q50 50 90 10X' } }).join()).toMatch(/unsupported character/);
  });

  it('rejects empty and whitespace-only paths', () => {
    for (const path of ['', '  \n\t ']) {
      expect(errorsOf({ ...clone(controller), body: { path } })).toEqual(['body.path: path is empty']);
    }
  });

  it('requires eyes on solid fill, not off-body or in a hole', () => {
    const off = clone(controller);
    off.eyes.y = 70;
    expect(errorsOf(off).join()).toMatch(/eyes must sit inside/);
    const onHandle = clone(getExample('mug')!);
    onHandle.eyes = { x: 66, y: 53, spacing: 12, scale: 1 };
    expect(errorsOf(onHandle).join()).toMatch(/outside or in a hole/);
    const crowded = clone(controller);
    crowded.eyes.spacing = 4;
    expect(errorsOf(crowded).join()).toMatch(/spacing/);
  });
});

describe('renderAvatarSvg', () => {
  it('produces balanced standalone SVG for every example and motion', () => {
    for (const e of examples) {
      for (const motion of ['idle', 'thinking', 'happy'] as const) {
        const svg = renderAvatarSvg(e, { motion, time: 1.7, size: 96 });
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="96" height="96"')).toBe(true);
        assertBalanced(svg);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it('is deterministic in time and frozen under reduced motion', () => {
    expect(renderAvatarSvg(controller, { time: 2.5 })).toBe(renderAvatarSvg(controller, { time: 2.5 }));
    expect(renderAvatarSvg(controller, { time: 0.5 })).not.toBe(renderAvatarSvg(controller, { time: 1.5 }));
    const still = renderAvatarSvg(controller, { time: 0.5, reducedMotion: true });
    expect(renderAvatarSvg(controller, { time: 9, reducedMotion: true })).toBe(still);
    expect(renderAvatarSvg(controller, { reducedMotion: true, gaze: { x: 1, y: 0 } })).not.toBe(still);
  });

  it('never echoes untrusted option or name text into markup', () => {
    const svg = renderAvatarSvg(
      { ...clone(controller), name: 'Pad & "Co"' },
      { color: 'red" onload="x', eyeColor: 'url(javascript:1)' },
    );
    expect(svg).not.toMatch(/onload|javascript/);
    expect(svg).toContain('aria-label="Pad &#38; &#34;Co&#34;"');
    expect(svg).toContain(DEFAULT_COLOR);
  });

  it('throws on invalid definitions instead of rendering them', () => {
    expect(() => renderAvatarSvg({ ...clone(controller), body: { path: 'M0 0<g/>' } })).toThrow(/Invalid avatar/);
  });

  it('draws one flat body color and plain dark eyes: no gradients, gloss, glints or shadows', () => {
    for (const e of examples) {
      for (const color of ['#ff6a1a', '#f4f4f4', '#7a7a7a']) {
        const svg = renderAvatarSvg(e, { color, time: 1.1 });
        expect(svg).not.toMatch(/Gradient|<filter|<ellipse|<circle|opacity/i);
        // Erosion masks paint black/white luminance only; they never reach the screen.
        const visible = svg.replace(/<mask[^>]*>.*?<\/mask>/g, '');
        const fills = new Set([...visible.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]).filter((c) => c !== 'none'));
        expect([...fills].sort()).toEqual([color, DEFAULT_EYE_COLOR].sort());
      }
    }
  });

  it('turning reveals volume: the drawn stack shifts with the view, flat depth does not', () => {
    const at = (yaw: number, depth?: number) => renderAvatarSvg(controller, { reducedMotion: true, view: { yaw, pitch: 0 }, depth });
    expect(at(0.6)).not.toBe(at(-0.6));
    const slices = (svg: string) => (svg.match(/<use [^>]*matrix/g) ?? []).length;
    expect(slices(at(0.9))).toBeGreaterThan(slices(at(0, 0)));
    expect(slices(at(0.9, 0))).toBe(1);
  });

  it('hides the eyes once the front turns away', () => {
    const eyes = (yaw: number) => (renderAvatarSvg(controller, { reducedMotion: true, view: { yaw, pitch: 0 } }).match(/<rect /g) ?? []).length;
    expect(eyes(0)).toBe(2);
    expect(eyes(Math.PI)).toBe(0);
  });
});

describe('motion', () => {
  it('blinks briefly and periodically', () => {
    const frames = Array.from({ length: 30 * 20 }, (_, i) => blinkAt(42, i / 30));
    const closed = frames.filter((b) => b > 0.8).length;
    expect(closed).toBeGreaterThan(0);
    expect(closed / frames.length).toBeLessThan(0.08);
  });

  it('clamps gaze and keeps poses finite', () => {
    const p = computePose({ seed: 1, time: 3, motion: 'idle', gaze: { x: 50, y: -50 }, reducedMotion: true });
    expect(p.gazeX).toBe(1);
    expect(p.gazeY).toBe(-1);
    for (const motion of ['idle', 'thinking', 'happy'] as const) {
      for (let t = 0; t < 6; t += 0.37) {
        const q = computePose({ seed: 9, time: t, motion, reducedMotion: false });
        expect(Object.values(q).every((v) => typeof v === 'string' || Number.isFinite(v))).toBe(true);
        expect(Math.abs(q.roll)).toBeLessThan(10);
        expect(q.lift).toBeLessThanOrEqual(0);
      }
    }
  });
});
