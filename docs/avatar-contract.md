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
- Renderers (`avatarFrame`, `renderAvatarSvg`, the CSS scene) pick the slice stack per part, so a tilted part still shows a solid silhouette from every view. `avatarExtent` grows to hold the offset parts.

Before rendering imported definitions, call `validateAvatar`. It returns `{ ok: true, value }` with the normalized definition or `{ ok: false, errors }` with validation errors.

## Strict targets for generated avatars

`validate.sh --strict` (and the gallery check in CI) also requires:

- Face room: the face-bearing part is the dominant mass, and the enlarged eyes keep 4.5 units of clearance at rest and at full gaze travel.
- No silhouette seams: no small sudden steps (0.3–2.5 units) in the outer outline where parts meet. Each join should be a clear step or a smooth, flush continuation.

Valid v1 definitions that do not meet these targets still import and render. The renderer reduces eye enlargement or gaze travel when space is limited.

## The design prompt

The canonical, model-neutral design prompt is [skills/generate-avatar/references/system-prompt.md](../skills/generate-avatar/references/system-prompt.md): schema, geometry rules, face-first proportions and reference examples (kept equal to the engine's examples by tests). The editor includes it in copied generation and repair prompts. Agent-app links reference the hosted prompt. The optional `generate-avatar` skill adds a local validation loop.
