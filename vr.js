import * as T from 'three';
import { bendPoint, frameAt } from './curve.js';
import { groundAt } from './walk.js';

// WebXR mode (Meta Quest and other headsets).
// A rig carries the headset camera and both controllers. Every frame the rig is put on the street
// at the walker's position, with its up axis along the street normal, so the street stays under
// your feet when it folds. Room-scale steps and the headset pose are added by three.js inside the rig.
//
// Controls:
//   left stick       walk, in the direction you look. Hold left grip or trigger to run.
//   right stick L/R  snap turn 30 degrees
//   right stick U/D  fold the street (this turns auto fold off)
//   A                auto fold on / off
//   B                release the sphere, or reset it when it is already rolling

const SNAP = Math.PI / 6;
const DEAD = 0.2;
const WALK = 2.2;
const RUN = 7;
const FOLD_RATE = 40; // degrees per second at full stick

const X_AXIS = new T.Vector3(-1, 0, 0); // street x runs to your left when you look along +s
const Y_UP = new T.Vector3(0, 1, 0);

const dead = (v) => (Math.abs(v) < DEAD ? 0 : v);

// xr-standard gamepads put the thumbstick on axes 2 and 3; some older ones use 0 and 1.
const stick = (gp) => (gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0]);
const pressed = (gp, i) => !!gp.buttons[i]?.pressed;

// Rotate a vector (x, z) in the horizontal plane by angle a about +Y.
const rotY = (x, z, a) => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];

function handModel() {
  const g = new T.Group();
  const body = new T.Mesh(
    new T.BoxGeometry(0.035, 0.03, 0.11),
    new T.MeshStandardMaterial({ color: 0x2c3435, roughness: 0.6 })
  );
  const tip = new T.Mesh(
    new T.BoxGeometry(0.036, 0.008, 0.02),
    new T.MeshStandardMaterial({ color: 0xe5c88a, emissive: 0xe5c88a, emissiveIntensity: 0.4 })
  );
  tip.position.set(0, 0.018, -0.045);
  g.add(body, tip);
  g.traverse((o) => (o.userData.skipAO = true));
  return g;
}

export function vr(renderer, scene, camera, walker, actions) {
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const rig = new T.Group();
  rig.add(camera);
  scene.add(rig);
  for (let i = 0; i < 2; i++) {
    const grip = renderer.xr.getControllerGrip(i);
    grip.add(handModel());
    rig.add(grip);
  }

  const basis = new T.Matrix4();
  const yawQ = new T.Quaternion();
  const headDir = new T.Vector3();
  const zAxis = new T.Vector3();
  const prev = { a: false, b: false };
  let snapped = false;

  // The button only shows when the browser can start an immersive VR session.
  const button = document.getElementById('vrButton');
  let session = null;
  navigator.xr?.isSessionSupported('immersive-vr').then((ok) => (button.hidden = !ok)).catch(() => {});
  button.onclick = async () => {
    if (session) {
      session.end();
      return;
    }
    try {
      const s = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      s.addEventListener('end', () => {
        session = null;
        button.textContent = 'Enter VR';
      });
      await renderer.xr.setSession(s);
      session = s;
      button.textContent = 'Exit VR';
    } catch (e) {
      console.error(e);
    }
  };

  renderer.xr.addEventListener('sessionstart', () => actions.onEnter());
  renderer.xr.addEventListener('sessionend', () => {
    rig.position.set(0, 0, 0);
    rig.quaternion.identity();
    actions.onExit();
  });

  // Head position and look direction in the rig's horizontal plane, from the last rendered pose.
  function head() {
    headDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const len = Math.hypot(headDir.x, headDir.z) || 1;
    return { hx: camera.position.x, hz: camera.position.z, fx: headDir.x / len, fz: headDir.z / len };
  }

  // Snap turn about the head, not about the rig origin, so you do not swing around the room.
  function turn(dir) {
    const { hx, hz } = head();
    const before = rotY(hx, hz, -walker.yaw);
    walker.yaw += dir * SNAP;
    const after = rotY(hx, hz, -walker.yaw);
    // Rig space x maps to street -x and rig space -z maps to street +s.
    walker.pos.x -= before[0] - after[0];
    walker.pos.s -= before[1] - after[1];
  }

  function controllers(dt) {
    for (const src of session?.inputSources || []) {
      const gp = src.gamepad;
      if (!gp) {
        continue;
      }
      const [ax, ay] = stick(gp).map(dead);
      if (src.handedness === 'left') {
        if (ax || ay) {
          const { fx, fz } = head();
          const speed = (pressed(gp, 0) || pressed(gp, 1) ? RUN : WALK) * dt;
          // forward * -ay + right * ax, with right = (-fz, fx) in the horizontal plane
          const vx = fx * -ay + -fz * ax;
          const vz = fz * -ay + fx * ax;
          const [bx, bz] = rotY(vx, vz, -walker.yaw);
          walker.step(-bx * speed, -bz * speed);
        }
      } else if (src.handedness === 'right') {
        if (Math.abs(ax) > 0.6 && !snapped) {
          turn(Math.sign(ax));
          snapped = true;
        }
        if (Math.abs(ax) < 0.3) {
          snapped = false;
        }
        if (ay) {
          actions.foldBy(-ay * FOLD_RATE * dt);
        }
        const a = pressed(gp, 4);
        const b = pressed(gp, 5);
        if (a && !prev.a) {
          actions.toggleAuto();
        }
        if (b && !prev.b) {
          actions.sphere();
        }
        prev.a = a;
        prev.b = b;
      }
    }
  }

  function update(dt, angle) {
    controllers(dt);
    const { x, s } = walker.pos;
    const f = frameAt(s, angle);
    rig.position.fromArray(bendPoint(x, groundAt(x), s, angle));
    // Columns: street x (to the left), street normal (up), minus the street tangent (back).
    basis.makeBasis(X_AXIS, new T.Vector3(0, f.ny, f.nz), zAxis.set(0, -f.ty, -f.tz));
    rig.quaternion.setFromRotationMatrix(basis).multiply(yawQ.setFromAxisAngle(Y_UP, -walker.yaw));
  }

  return {
    update,
    rig,
    get presenting() {
      return renderer.xr.isPresenting;
    },
  };
}
