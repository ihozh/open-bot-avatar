# Avatar definition contract — v1

An avatar definition contains geometry only. The runtime controls color, inferred volume, view, gaze, blinking and animation. Definitions do not contain raster images. Use recognizable, soft, minimal object silhouettes with two eyes that remain readable at sidebar size.

```json
{
  "version": 1,
  "id": "controller",
  "name": "Controller",
  "body": { "path": "M ... Z" },
  "eyes": { "x": 50, "y": 46, "spacing": 15, "scale": 1 }
}
```

- Coordinates use a fixed `0 0 100 100` viewBox.
- `body.path` is one monochrome filled SVG path (several closed subpaths allowed, nonzero fill rule; holes wind opposite to their outline). Keep it roughly within 8..92 so there is room for turning and motion. No embedded SVG markup, scripts, external assets, colors or animation.
- `eyes`: `x`/`y` are the center of the pair, `spacing` is center to center, and `scale` 1 means each neutral eye is about 4 units wide and 11 tall. Validation uses that size; the renderer draws eyes up to 1.45× larger where the body has room (every drawn eye shape keeps 3 units from the outline). Eyes must sit visibly inside the body.
- `id` is a lowercase slug, `name` a short display name. Unknown fields are rejected.

## v2: depth frames for parts

Version 1 places every part on one mid-plane (z = 0), so a body can only be as deep as its parts are thick. Version 2 keeps the same geometry and adds an optional `parts` array that moves individual parts in depth and tilts them. Everything else is unchanged; a v2 definition without `parts` renders exactly like v1.

```json
{
  "version": 2,
  "id": "ram",
  "name": "Ram",
  "body": { "path": "<head>Z<left horn>Z<right horn>Z" },
  "parts": [
    {},
    { "z": 6, "pitch": 30, "yaw": -25, "pivot": [34, 36] },
    { "z": 6, "pitch": 30, "yaw": 25, "pivot": [66, 36] }
  ],
  "eyes": { "x": 50, "y": 56, "spacing": 18, "scale": 1.1 }
}
```

- `parts[i]` is the frame of the i-th **outline** subpath in path order (holes are not counted). A shorter array leaves the remaining parts at the default; `{}` is the default.
- `z` (−30..30): offset of the part's own mid-plane toward the viewer.
- `pitch`, `yaw` (degrees, −75..75): tilt about the part's horizontal / vertical axis through `pivot`. Positive `pitch` leans the part's top toward the viewer; positive `yaw` brings its right edge toward the viewer. `pivot` defaults to the part's bounding-box center; put it on the joint where the part meets its neighbour so the join stays closed.
- The eyes ride on whichever part is highest under them once `z` is counted, and move with that part's frame.
- A hole cuts only the smallest outline that contains it, so a ring placed in front of a larger part keeps that part intact behind it.
- Renderers (`avatarFrame`, `renderAvatarSvg`, the CSS scene) pick the slice stack per part, so a tilted part still shows a solid silhouette from every view. A part with a `pitch` also gets horizontal (y-plane) cross-sections, because its z- and x-planes turn edge-on together once it leans far forward. `avatarExtent` grows to hold the offset parts.
- A part is still one flat shape turned in space. To make something curve toward the viewer, chain parts: the ram's horn is a frontal spiral plus a separate tip part pitched −72° at the spiral's end.

## v2: tubes

A part is a flat shape with inferred thickness, so a horn that grows out of the head, bends forward and tapers cannot be built from `parts` alone. Version 2 adds an optional `tubes` array: solid tubes swept along a curve in space, drawn after the body's outline parts.

```json
{
  "version": 2,
  "id": "ram",
  "name": "Ram",
  "body": { "path": "<head>Z" },
  "tubes": [
    { "path": [[36,34,0],[30,26,6],[22,30,16],[18,41,26],[22,51,32]], "radius": [7, 2] },
    { "path": [[64,34,0],[70,26,6],[78,30,16],[82,41,26],[78,51,32]], "radius": [7, 2] }
  ],
  "eyes": { "x": 50, "y": 60, "spacing": 16, "scale": 1.1 }
}
```

- `path`: 2..16 control points `[x, y, z]`. `x`, `y` are viewBox units; `z` is depth, **positive toward the viewer**, `|z| ≤ 40`. The tube follows a Catmull-Rom spline through every control point (the end points are repeated at the ends).
- `radius` (0.5..15): one number for a constant radius, `[root, tip]` for a linear taper over arc length, or one number per control point. Normalization writes it as `[root, tip]` or the per-point array, with every number rounded to one decimal.
- Safe area: for every control point, `x ± r` and `y ± r` must lie within 8..92. At most 8 tubes.
- Rendering: a tube is approximated by a chain of overlapping spheres, so it reads as solid from any angle. In `avatarFrame` each sphere is one disc (the unit circle scaled by its radius) placed at the projected centre and sorted by depth with everything else; the CSS scene draws one disc per sphere and keeps them facing the viewer. Tubes contribute to the eye host (the eyes ride on whatever is highest under them) and to `avatarExtent`. The `depth` option scales their `z` as it scales the body's inferred depth.
- A v2 definition without `tubes` renders exactly as before.

Before rendering imported definitions, call `validateAvatar`. It returns `{ ok: true, value }` with the normalized definition or `{ ok: false, errors }` with validation errors.

## Strict targets for generated avatars

`validate.sh --strict` (and the gallery check in CI) also requires:

- Face room: the face-bearing part is the dominant mass, and the enlarged eyes keep 4.5 units of clearance at rest and at full gaze travel.
- No silhouette seams: no small sudden steps (0.3–2.5 units) in the outer outline where parts meet. Each join should be a clear step or a smooth, flush continuation.

Valid v1 definitions that do not meet these targets still import and render. The renderer reduces eye enlargement or gaze travel when space is limited.

## The design prompt

The canonical, model-neutral design prompt is [skills/generate-avatar/references/system-prompt.md](../skills/generate-avatar/references/system-prompt.md): schema, geometry rules, face-first proportions and reference examples (kept equal to the engine's examples by tests). The editor includes it in copied generation and repair prompts. Agent-app links reference the hosted prompt. The optional `generate-avatar` skill adds a local validation loop.
