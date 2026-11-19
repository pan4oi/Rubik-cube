# Realistic Mode — webcam hand tracking

One way to drive the cube with the camera: **Grab**. Pinch or fist a sticker,
drag it, and an open palm orbits the whole cube.

An **on-cube reticle** follows the hand over the game, not just over the small
camera preview. It sits on the index fingertip while the hand is open, turns
warm when it is over a sticker, and shows the layer name while a grab is being
dragged. A ring is drawn on the sticker the raycast actually hit, so the
hand-to-cube mapping is visible. The camera panel still shows the **hologram of
the cube**, which lights up the layer a grab is about to turn.

The game cube keeps its original three-face view: red front toward the player,
white up, seen from above and to the right. The hologram is the part that faces
you square on, so the face it shows is the same colour as the front of the game
cube. Mouse drags still work. `Esc` leaves the mode.

## Running it

Realistic Mode needs a camera, and browsers only expose cameras to secure
origins. `file://` is not one of them, so double-clicking `index.html` plays the
game with the mouse but cannot start hand tracking. Serve the folder instead:

```bash
python3 -m http.server 8321
# open http://localhost:8321
```

Then start a game, press **Hands** (top right) or **H**, and allow the camera.
Leave the tab on `localhost`; `127.0.0.1` works too. HTTPS works if you host it.

The MediaPipe runtime and model are vendored in `vendor/mediapipe/`, so tracking
itself needs no network. Only the camera permission prompt is external.

## Grab gestures

| Gesture | Result |
| --- | --- |
| Point an open hand at the cube | The reticle follows the index fingertip and the ring marks the sticker under it |
| Thumb tip touches index tip over a sticker | Grab that layer |
| Closed fist over a sticker | Grab that layer (knuckles are the grab point) |
| Move the grabbing hand | Rotate the layer continuously; the reticle names the layer |
| Open the hand | Ease to the nearest 90° and commit the move |
| Open palm drag | Orbit the whole cube |
| Two open palms, move them together | Orbit the whole cube |

Every completed turn goes through `Controls.endHandLayer`, which rounds to the
nearest 90°, re-parents the pieces, saves the game and runs the solved check —
the same path as a mouse move, so the timer behaves identically.

## The hologram

The camera panel draws a second canvas over the video (`js/hand-hologram.js`).
It is not a game view: it is a small, translucent projection fixed in the middle
of the frame, so the gesture and the thing it turns are visible in the same
place without the reference drifting around with your hand.

- **Anchor.** The cube is centred in the camera frame and never moves with the
  hands — one hand or two, near or far, it stays in the same place at the same
  size. A fixed reference is easier to aim a fingertip at than one that drifts
  with the palm.
- **Hold orientation.** It is held the way a cube sits in your hand: **red
  centre facing you, white up**, drawn square on so the front face fills the
  hologram and reads as a flat 3×3 grid. The game cube behind it keeps the
  original three-face view, but the face pointing at you is the same red (or
  themed) front, so the two agree on colour.
- **Content.** 54 stickers read from the real pieces, so a scrambled cube looks
  scrambled there too. It keeps updating while a layer turns.
- **Target.** Once a grab starts, every sticker in the layer is lit warm, three
  animated chevrons show which way it will spin, and the caption names it in
  plain language — `TOP ROW`, `LEFT COLUMN`, `FRONT LAYER`.
- **Not mirrored.** The video and the hand skeleton are mirrored by CSS; the
  hologram canvas is not, because mirrored text is unreadable. The touch that
  lands on it is mirrored (`x -> 1 - x`) so the lit sticker is the one under the
  hand in the video.
- **Cost.** One 2D canvas, ~0.3 ms per frame at 480×360 (measured). It only runs
  while the mode is on and a hand is in frame; it fades out when the hand leaves
  and clears when the mode stops.

## Files

| File | Responsibility |
| --- | --- |
| `js/hand-tracking.js` | `HandTracker`: getUserMedia, MediaPipe model, 30 fps detection loop, smoothing, typed errors. |
| `js/realistic-mode.js` | `RealisticMode`: landmark → screen → cube mapping, Grab gestures, camera preview overlay, hologram feed. |
| `js/hand-hologram.js` | `HandHologram`: the cube projected into the camera preview in a fixed hand-held orientation (red front, white up), with the grabbed layer highlighted. |
| `js/controls.js` | Cube API shared with the mouse flow: `getLayerAtPiece`, `startHandLayer` / `rotateHandLayer` / `endHandLayer`, and the orbit methods. |
| `index.html` | Camera panel, toggle button, script order. |
| `style.css` | Panel and toggle styling. Sized in px/vw because the game scales its root font to the viewport. |
| `vendor/mediapipe/` | Tasks Vision 1.1.1 (`vision_bundle.js`), SIMD wasm, `hand_landmarker.task`. |

MediaPipe Tasks Vision is Apache-2.0; the hand model comes from Google's
`mediapipe-models` bucket. Versions: `@mediapipe/tasks-vision@1.1.1`.

## How the mapping works

1. **Hands → screen.** MediaPipe returns 21 landmarks normalized to the video
   frame. `x` is mirrored (`1 - x`) because the preview is a mirror and moving
   your hand right should move the pointer right. The result is scaled to the
   canvas.
2. **Grab.** A pinch (thumb tip close to index tip) or a closed fist over the
   cube is a grab. The ray through the pinch point picks the piece and the face
   under it.
3. **Rotation axis.** The screen-space drag is projected onto the grabbed face,
   then the axis is `r × t` quantized to the nearest cube axis. The layer is the
   one containing the grabbed piece along that axis, so the layer follows the
   hand in either direction.
4. **Angle.** The drag is intersected with a plane through the contact facing
   the camera, giving a real 3D movement vector. Its dot product with the
   rotation tangent, divided by the radius, is the angle; the sensitivity slider
   scales it. Per-frame rotation is clamped so a tracking jump cannot spin a
   layer.
5. **Orbit.** One or two open palms start an orbit only after a deliberate drag,
   so a hand hovering in frame does not spin the cube. Orbit uses world axes, so
   the cube always ends on one of its 24 axis-aligned orientations.
6. **Commit.** Releasing the pinch or fist calls `Controls.endHandLayer`, which
   snaps to 90°, saves the game and checks whether the cube is solved.

## Tuning

| Constant | Where | Effect |
| --- | --- | --- |
| `GRAB_DEADZONE` | `realistic-mode.js` | Pixels of movement before the grabbed layer starts turning. |
| `ORBIT_DEADZONE` | `realistic-mode.js` | Pixels an open palm must travel before the whole cube starts orbiting. |
| `PINCH_START` / `PINCH_END` | `realistic-mode.js` | Hysteresis for the pinch: how close the thumb and index tip must come to grab and how far apart they must open to release. |
| `Turn sensitivity` slider | panel | Multiplies the grab angle, 0.6–2.0×, persisted as `theCube_handsSensitivity`. Default 1.15. |
| `LOST_GRACE` | `realistic-mode.js` | How long a grab survives without a hand before snapping (180 ms). |
| `minInterval` | `hand-tracking.js` | Detection rate (default 33 ms ≈ 30 fps). |
| `smoothAlpha` | `hand-tracking.js` | Low-pass strength; higher = snappier, noisier. |
| `numHands` | `hand-tracking.js` | 2 by default; 1 halves the work. |

## Performance

- Detection runs at ~30 fps on the main thread; `detectForVideo` is skipped when
  the video frame has not advanced. The cube's own rAF loop is untouched.
- GPU delegate is requested first; if the device rejects it the tracker retries
  on CPU.
- Assets are local: 156 KB bundle, 13.5 MB SIMD wasm, 7.8 MB model. They are only
  fetched when the user enables the mode.
- Landmarks are smoothed with a one-pole filter keyed by hand, so a hand leaving
  and re-entering the frame does not inherit a stale position.

## Known limitations

- Monocular depth (`landmark.z`) is noisy, so depth comes from ray/plane
  intersection rather than the landmarks.
- The camera looks at the cube from the front, so the red face dominates and the
  white top and blue right faces show as thin strips. Rotate the view with the
  mouse to grab a layer on another face.
- The sticker ring and layer label live on the main cube, but the whole layer is
  not outlined before the drag starts: whether the row or the column turns
  depends on the direction of the drag.
- Whole-cube mouse drags rotate it in the picture plane, as they always have.
  There is no separate drag gesture for yaw or pitch.
- Very low light, motion blur, or a hand partly outside the frame will drop
  tracking; the current rotation snaps and ends rather than hanging.
- SIMD is assumed for the wasm build (all current browsers support it). The
  non-SIMD build is not vendored.

## Possible next steps

- Outline the whole row or column on the main cube once the drag direction is
  known, in addition to the sticker ring.
- Detect two fingertips on opposite faces for a two-handed twist (U + D).
- Move detection into a Web Worker to keep the main thread free on low-end
  laptops.
