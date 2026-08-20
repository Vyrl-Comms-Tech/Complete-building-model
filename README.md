# GLB Viewer — parity build

A minimal viewer built to reproduce the rendering pipeline of
[gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/)
([three-gltf-viewer](https://github.com/donmccurdy/three-gltf-viewer), MIT,
by Don McCurdy), pixel-for-pixel where technically possible. Every rendering
value in [src/viewer.js](src/viewer.js) is traceable to that project's
`src/viewer.js` / `src/environments.js` as of `three@0.176.0` — see the
`REFERENCE:` comments inline. UI chrome (dat.GUI, Stats panel, drag-and-drop)
was intentionally left out; it doesn't affect the rendered image.

## Reference viewer configuration (verified from source, three@0.176.0)

```text
Three.js revision:      0.176.x
Renderer:                new WebGLRenderer({ antialias: true })
Pixel ratio:              window.devicePixelRatio (uncapped)
Output color space:       three r176 default (SRGBColorSpace) — never set explicitly
Tone mapping default:     LinearToneMapping
Exposure default:         0.0 EV -> renderer.toneMappingExposure = Math.pow(2, 0) = 1.0
Environment default:      'Neutral' = THREE.RoomEnvironment baked once via PMREMGenerator
scene.environment:        the selected env map (reflections/IBL)
scene.background:         flat color '#191919' unless "show background" is enabled,
                           in which case it's the same env map used for lighting
Ambient light:            only added if the GLB has NO embedded lights.
                           AmbientLight('#FFFFFF', 0.3), parented to the camera
Directional light:        only added under the same condition.
                           DirectionalLight('#FFFFFF', 0.8*Math.PI ≈ 2.513),
                           position (0.5, 0, 0.866), parented to the camera
Camera:                   PerspectiveCamera, fov 60, near = size/100, far = size*100
                           (size = bounding-box diagonal length)
Camera framing:            position = center + (size/2, size/5, size/2); lookAt(center);
                           model is re-centered to the origin first
OrbitControls:             screenSpacePanning = true; maxDistance = size*10; no damping
Shadows:                    off (renderer.shadowMap never touched)
Animation:                  only the first clip autoplays; real-elapsed-time delta
```

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Put a `.glb` at `public/models/model.glb`
(or change `MODEL_URL` in [src/main.js](src/main.js)).

## Required assets

`RoomEnvironment` ("Neutral") is procedural — no file needed. The two HDR
environments are optional; only add them if you want the "Venice Sunset" /
"Footprint Court" choices available:

```text
/public
  /environments
    venice_sunset_1k.exr        (from Don McCurdy's donmccurdy-static bucket)
    footprint_court_2k.exr      (HDR Labs, via the same bucket)
  /models
    model.glb
```

Rehosting the identical source files changes nothing about the rendered
image — same bytes, same `EXRLoader`, same PMREM pass as the reference.
Default environment stays `'Neutral'`, so nothing breaks if you skip these.

## Debug / parity overlay

Press **`d`** in the browser to `console.table()` the current renderer,
camera, environment, and scene-graph state (see [src/debug.js](src/debug.js)).
Use it to diff against the reference viewer's own dat.GUI values side by side.

## Verification checklist

- Same GLB file (identical bytes) in both viewers
- Same environment selected (`'Neutral'` is the default in both)
- Same tone mapping (`Linear` is the default in both — NOT ACES)
- Same exposure (`0` EV is the default in both)
- Same viewport pixel dimensions, same browser zoom (100%)
- Same `devicePixelRatio` (e.g. both on a 2x display, or both on 1x)
- No CSS `filter`/`opacity`/`transform` on the canvas or an ancestor
- No canvas CSS width/height that differs from its backing resolution
- Same browser/GPU if chasing sub-pixel differences (driver-level AA/precision varies)

## Deliberate deviations from the reference (and why)

- **`three` pinned to exact `0.176.0`**, not `^0.176.0` — for a parity tool, an
  exact version removes one more axis of "why does this differ" if a future
  patch release changes any shader or default.
- **`dispose()` method added.** The reference's `Viewer` is a single
  page-lifetime singleton — its `requestAnimationFrame` loop runs forever and
  is never torn down. A real app that loads/unloads models or viewers needs a
  way to stop the loop and free GPU resources; this doesn't change what a
  single load-and-view session renders.
- **dat.GUI / Stats / AxesHelper widget removed** — explicitly requested;
  none of it changes the rendered pixels of the model itself.
- **`clear()` also disposes materials**, not just their textures. The
  reference only disposes textures in its `clear()`; it never calls `clear()`
  more than once per page load in practice. A production app that repeatedly
  swaps models needs the material disposed too, or it leaks a compiled WebGL
  program per swap. Doesn't change what's rendered.
