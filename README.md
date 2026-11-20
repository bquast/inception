# Paris Fold

The street from Inception that folds up over your head, in three.js, with a WebXR mode for Meta Quest.

Original work by Ryan Sael: https://sael.net/paris-inception/ (used with permission).
Credit to the author stays on the page, in the scene and here.

## Run

ES modules need http, not `file://`:

```
python3 -m http.server 8000
```

Open http://localhost:8000. For the headset, use the GitHub Pages URL (WebXR needs https).

## Deploy

Push to `master`. The workflow in `.github/workflows/pages.yml` publishes the repo root.
In the repo settings, set Pages > Source to "GitHub Actions".

## Files

All files are in the root. No build step, no CDN.

| File | What |
| --- | --- |
| `index.html`, `style.css` | page and UI |
| `app.js` | renderer, scene, UI wiring, frame loop |
| `curve.js` | the bend: street frame on the CPU, and the same bend in GLSL |
| `city.js` | buildings, street, clay district, built flat and folded in the vertex shader |
| `traffic.js` | parked and moving cars (instanced) |
| `walk.js` | first person walker in street coordinates, shared by desktop and VR |
| `environment.js` | sky shader and ground plane |
| `post.js` | desktop post-processing: GTAO, depth of field, bloom, FXAA |
| `vr.js` | WebXR rig on the folded street, controllers |
| `three.module.js` + addons | three.js r170, unmodified (MIT, see `THREE-LICENSE`) |

## Desktop controls

- WASD or arrows: walk. Shift: run. Drag: look. Double-click: lock the mouse.
- `[` and `]`: fold. Or drag the gold arc, or use the slider.
- Cmd/Ctrl + `'`: advanced panel (camera mode, FOV, bloom, depth of field, GTAO).
- Cmd/Ctrl + `/`: hide all UI.

## VR controls

- Left stick: walk where you look. Left grip or trigger: run.
- Right stick left/right: snap turn 30°.
- Right stick up/down: fold the street (auto fold goes off).
- A: auto fold on/off. B: release the sphere, or reset it.

You start on the flat part of the street, before the bend. Walk forward into the bend: the street stays
under your feet and the world turns around you.

In VR the post-processing is off, the shadow map is 1024 instead of 2048, and the sphere reflection
does not refresh.
