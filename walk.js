import * as T from 'three';
import { bendPoint, frameAt, clamp, STREET_MIN, STREET_MAX } from './curve.js';

// First person walker, in street coordinates: x across, s along, yaw and pitch relative to the street.
// The desktop camera and the VR rig both read the same position, so a mode switch keeps you where you are.

const WALK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];

export const isBlocked = (colliders, x, s) =>
  colliders.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(s - b.z) < b.d / 2 + 0.3);

// Height of the walking surface: the pavement is a kerb above the road.
export const groundAt = (x) => (Math.abs(x) > 4.5 && Math.abs(x) < 7.5 ? 0.27 : 0.08);

export function walking(camera, controls, canvas, colliders) {
  canvas.tabIndex = 0;
  const pos = { x: 0, s: -25 };
  let active = false;
  let yaw = 0;
  let pitch = 0.08;
  let drag = false;
  let lastX = 0;
  let lastY = 0;
  const keys = new Set();
  const up = new T.Vector3();
  const look = new T.Vector3();

  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  // Move by (dx, ds) in street coordinates, one axis at a time, so you slide along walls.
  function step(dx, ds) {
    const nx = clamp(pos.x + dx, -368, 368);
    const ns = clamp(pos.s + ds, STREET_MIN + 1, STREET_MAX - 1);
    if (!isBlocked(colliders, nx, pos.s)) {
      pos.x = nx;
    }
    if (!isBlocked(colliders, pos.x, ns)) {
      pos.s = ns;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!active || typing() || e.metaKey || e.ctrlKey) {
      return;
    }
    if (WALK_KEYS.includes(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    drag = false;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!active) {
      return;
    }
    canvas.focus({ preventScroll: true });
    drag = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) {
      return;
    }
    const locked = document.pointerLockElement === canvas;
    if (!drag && !locked) {
      return;
    }
    const dx = locked ? e.movementX : e.clientX - lastX;
    const dy = locked ? e.movementY : e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw += dx * 0.003;
    pitch = clamp(pitch - dy * 0.003, -Math.PI * 0.49, Math.PI * 0.49);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, () => (drag = false));
  }
  canvas.addEventListener('dblclick', () => {
    if (active && canvas.requestPointerLock) {
      try {
        canvas.requestPointerLock()?.catch(() => {});
      } catch {}
    }
  });

  function set(value, keepPlace = false) {
    active = value;
    controls.enabled = !active;
    keys.clear();
    if (active) {
      canvas.focus({ preventScroll: true });
      if (!keepPlace) {
        pos.x = 0;
        pos.s = -25;
        yaw = 0;
        pitch = 0.08;
      }
    } else {
      document.exitPointerLock?.();
      camera.up.set(0, 1, 0);
      controls.target.copy(camera.position).add(look.clone().multiplyScalar(20));
      controls.update();
    }
  }

  function update(dt, angle) {
    if (!active) {
      return;
    }
    const held = (...codes) => (codes.some((c) => keys.has(c)) ? 1 : 0);
    const fw = held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown');
    const rt = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
    const speed = ((held('ShiftLeft', 'ShiftRight') ? 12 : 4.5) * dt) / Math.max(1, Math.hypot(fw, rt));
    step((-Math.sin(yaw) * fw - Math.cos(yaw) * rt) * speed, (Math.cos(yaw) * fw - Math.sin(yaw) * rt) * speed);

    camera.position.fromArray(bendPoint(pos.x, 1.72 + groundAt(pos.x), pos.s, angle));
    const basis = frameAt(pos.s, angle);
    up.set(0, basis.ny, basis.nz);
    camera.up.copy(up);
    look
      .set(-Math.sin(yaw), basis.ty * Math.cos(yaw), basis.tz * Math.cos(yaw))
      .multiplyScalar(Math.cos(pitch))
      .addScaledVector(up, Math.sin(pitch));
    camera.lookAt(camera.position.clone().add(look));
  }

  return {
    set,
    update,
    step,
    pos,
    get yaw() {
      return yaw;
    },
    set yaw(v) {
      yaw = v;
    },
    get active() {
      return active;
    },
  };
}
