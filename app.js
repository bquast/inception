import * as THREE from './three.module.js';
import { OrbitControls } from './OrbitControls.js';
import { postProcessing } from './post.js';
import { traffic } from './traffic.js';
import { walking } from './walk.js';
import { buildCity } from './city.js';
import { environment } from './environment.js';
import { vr } from './vr.js';
import { bendPoint, frameAt, createBall, stepBall, clamp } from './curve.js';

const $ = (id) => document.getElementById(id);
const DEG = 180 / Math.PI;
const WALK_HINT = 'WASD / arrows to walk · Shift to run · drag to look · double-click to lock mouse · Esc to release';
const ORBIT_HINT = 'Drag to orbit. Right-drag to pan.';

// ---- renderer, scene, camera

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bad0d7');
scene.fog = new THREE.Fog('#c0d1d3', 300, 780);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('error').hidden = false;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
$('world').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 1100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 9;
controls.maxDistance = 650;
controls.minPolarAngle = 0.001;
controls.maxPolarAngle = Math.PI - 0.001;

// ---- light and sky

scene.add(new THREE.HemisphereLight('#dae9f5', '#8b795a', 1.5));
const sun = new THREE.DirectionalLight('#ffe1ac', 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 130, bottom: -100, near: 1, far: 350 });
sun.shadow.bias = -0.00022;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 2;
sun.target.position.set(0, 14, 6);
scene.add(sun, sun.target);

const env = environment(scene);

function daylight() {
  const a = (+$('sun').value * Math.PI) / 180;
  sun.position.set(-90, Math.sin(a) * 155, -Math.cos(a) * 120);
  env.skyUniforms.sunDirection.value.copy(sun.position).normalize();
  $('sunValue').textContent = $('sun').value + '°';
}
daylight();
$('sun').oninput = daylight;

function shadowSize(n) {
  sun.shadow.mapSize.set(n, n);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}

// ---- city, traffic, walker

const foldUniform = { value: 0 };
const city = buildCity(scene, foldUniform);
const vehicles = traffic(scene, city.colliders);
const walker = walking(camera, controls, renderer.domElement, city.colliders);

// ---- camera views

let streetView = true;

function setMode(walk, keepPlace = false) {
  walker.set(walk, keepPlace);
  $('cameraMode').value = walk ? 'walk' : 'orbit';
  $('walkHint').textContent = walk ? WALK_HINT : ORBIT_HINT;
}

function resetView() {
  if (walker.active) {
    setMode(false);
  }
  camera.up.set(0, 1, 0);
  streetView = true;
  const narrow = innerWidth < 700;
  camera.position.set(narrow ? 1.6 : 2.2, 5.4, -31);
  controls.target.set(narrow ? 0 : -2.5, 11.5, 15);
  controls.update();
  $('cameraReset').textContent = 'Overview ↗';
}
resetView();

$('cameraReset').onclick = () => {
  if (walker.active) {
    setMode(false);
  }
  if (!streetView) {
    resetView();
    return;
  }
  streetView = false;
  camera.position.set(108, 77, -126);
  controls.target.set(-1, 24, 17);
  controls.update();
  $('cameraReset').textContent = 'Street view ↗';
};

// ---- chrome sphere

const ball = new THREE.Mesh(
  new THREE.SphereGeometry(0.65, 32, 24),
  new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, envMapIntensity: 1.2 })
);
ball.castShadow = true;
scene.add(ball);

const cubeRT = new THREE.WebGLCubeRenderTarget(128, {
  type: THREE.HalfFloatType,
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
});
const cubeCam = new THREE.CubeCamera(0.2, 240, cubeRT);
ball.material.envMap = cubeRT.texture;

const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.83, 24),
  new THREE.MeshBasicMaterial({ color: 0x2e332c, transparent: true, opacity: 0.18, depthWrite: false })
);
scene.add(shadow);

let sphere = createBall();
let acc = 0;

function resetSphere() {
  sphere = createBall();
  acc = 0;
  $('release').disabled = false;
  $('release').innerHTML = 'Release sphere <span>↘</span>';
  $('sphereStatus').textContent = 'Ready on the far street';
}

function releaseSphere() {
  sphere.released = true;
  sphere.vs = -5.2;
  $('release').disabled = true;
  $('release').textContent = 'Sphere in motion';
  $('sphereStatus').textContent = 'Rolling along the curve';
}

resetSphere();
$('release').onclick = releaseSphere;
$('sphereReset').onclick = resetSphere;

// ---- fold

let fold = 0;
let targetFold = 0;
let autoPhase = 0;

function setAngle(a, manual = true) {
  if (manual) {
    $('autoFold').checked = false;
  }
  a = clamp(a, 0, 180);
  targetFold = a / DEG;
  $('fold').value = a;
  document.querySelectorAll('[data-angle]').forEach((b) => b.classList.toggle('active', Math.abs(+b.dataset.angle - a) < 0.1));
}

// Auto fold follows 90 * (1 - cos(phase)); pick up the phase from the current angle so it does not jump.
function syncAutoPhase() {
  const phase = Math.acos(clamp(1 - (targetFold * DEG) / 90, -1, 1));
  autoPhase = Math.sin(autoPhase) < 0 ? 2 * Math.PI - phase : phase;
}

$('fold').oninput = () => setAngle(+$('fold').value);
document.querySelectorAll('[data-angle]').forEach((b) => (b.onclick = () => setAngle(+b.dataset.angle)));
$('autoFold').onchange = syncAutoPhase;

// Bracket keys: a gentle tap, or continuous frame-rate-independent folding while held.
const foldKeys = new Set();
const typingIn = (t) => t?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName);
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) {
    return;
  }
  const dir = e.code === 'BracketLeft' ? -1 : e.code === 'BracketRight' ? 1 : 0;
  if (!dir) {
    return;
  }
  e.preventDefault();
  if (!foldKeys.has(e.code)) {
    foldKeys.add(e.code);
    setAngle(targetFold * DEG + dir * 0.5);
  }
});
window.addEventListener('keyup', (e) => foldKeys.delete(e.code));
window.addEventListener('blur', () => foldKeys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    foldKeys.clear();
  }
});

// ---- the gold arc: a screen-space semicircle keeps the handle usable even when looking along the bend

let arcCenter = { x: 0, y: 0, r: 0 };
let dragging = false;

function arcPoint(deg) {
  const a = ((160 - (deg * 7) / 9) * Math.PI) / 180;
  return [arcCenter.x + Math.cos(a) * arcCenter.r, arcCenter.y - Math.sin(a) * arcCenter.r];
}

function updateArc() {
  const mobile = innerWidth < 700;
  arcCenter = { x: innerWidth * 0.5, y: innerHeight - 38, r: Math.min(innerWidth * 0.17, mobile ? 64 : 98) };
  let d = '';
  for (let i = 0; i <= 180; i += 2) {
    const p = arcPoint(i);
    d += (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
  }
  $('arcLine').setAttribute('d', d);
  $('arcHit').setAttribute('d', d);
  const [x, y] = arcPoint(fold * DEG);
  $('knob').setAttribute('cx', x);
  $('knob').setAttribute('cy', y);
  $('arcLabel').setAttribute('x', arcCenter.x);
  $('arcLabel').setAttribute('y', arcCenter.y + 12);
}

function drag(e) {
  if (!dragging) {
    return;
  }
  const angle = clamp((Math.atan2(arcCenter.y - e.clientY, e.clientX - arcCenter.x) * 180) / Math.PI, 20, 160);
  setAngle(((160 - angle) * 9) / 7);
  e.preventDefault();
}

for (const el of [$('knob'), $('arcHit')]) {
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    controls.enabled = false;
    el.setPointerCapture(e.pointerId);
    drag(e);
  });
  el.addEventListener('pointermove', drag);
  const end = () => {
    dragging = false;
    controls.enabled = !walker.active;
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(type, end);
  }
}

// ---- post-processing and the advanced panel (Cmd/Ctrl + ' shows it, Cmd/Ctrl + / hides all UI)

const post = postProcessing(renderer, scene, camera);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = +$('fov').value;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.resize();
  updateArc();
}
window.addEventListener('resize', resize);

function updateEffects() {
  const dof = +$('dof').value;
  post.ao.enabled = $('aoToggle').checked || dof > 0;
  post.ao.blendIntensity = $('aoToggle').checked ? 0.85 : 0;
  post.dof.enabled = dof > 0;
  post.dof.uniforms.strength.value = dof;
  post.dof.uniforms.focus.value = +$('focus').value;
  $('dofValue').textContent = dof ? $('dof').value : 'Off';
  $('focusValue').textContent = $('focus').value + ' m';
}

function updateBloom() {
  post.bloom.strength = +$('bloomStrength').value;
  $('bloomValue').textContent = post.bloom.strength.toFixed(2);
  $('bloomToggle').checked = post.bloom.strength > 0;
  post.bloom.enabled = $('bloomToggle').checked;
}

function updateFov() {
  camera.fov = +$('fov').value;
  camera.updateProjectionMatrix();
  $('fovValue').textContent = camera.fov + '°';
}

$('aoToggle').onchange = updateEffects;
$('bloomToggle').onchange = (e) => (post.bloom.enabled = e.target.checked);
$('dof').oninput = updateEffects;
$('focus').oninput = updateEffects;
$('bloomStrength').oninput = updateBloom;
$('fov').oninput = updateFov;
$('cameraMode').onchange = () => setMode($('cameraMode').value === 'walk');

window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) {
    return;
  }
  if (e.code === 'Quote') {
    e.preventDefault();
    if (!e.repeat) {
      document.body.classList.toggle('advanced-visible');
    }
  }
  if (e.code === 'Slash' || e.key === '/') {
    e.preventDefault();
    document.body.classList.toggle('ui-hidden');
  }
});

$('sceneReset').onclick = () => {
  setAngle(0, false);
  autoPhase = 0;
  $('autoFold').checked = true;
  $('aoToggle').checked = true;
  $('bloomToggle').checked = true;
  post.ao.enabled = true;
  post.bloom.enabled = true;
  $('sun').value = 42;
  daylight();
  resetSphere();
  resetView();
  $('dof').value = 0;
  $('focus').value = 35;
  updateEffects();
  $('bloomStrength').value = 0.6;
  updateBloom();
  $('fov').value = 60;
  updateFov();
  setMode(true);
};

// ---- VR

const xr = vr(renderer, scene, camera, walker, {
  onEnter() {
    walker.set(false);
    controls.enabled = false;
    shadowSize(1024);
    $('autoFold').checked = true;
    syncAutoPhase();
  },
  onExit() {
    shadowSize(2048);
    resize();
    setMode(true, true);
  },
  foldBy: (d) => setAngle(targetFold * DEG + d),
  toggleAuto() {
    $('autoFold').checked = !$('autoFold').checked;
    syncAutoPhase();
  },
  sphere: () => (sphere.released ? resetSphere() : releaseSphere()),
});

setMode(true);

// ---- frame loop

const normal = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1);
let last = performance.now();
let reflectionTime = -1000;

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;

  if ($('autoFold').checked) {
    autoPhase = (autoPhase + (dt * Math.PI) / 45) % (2 * Math.PI);
    setAngle(90 * (1 - Math.cos(autoPhase)), false);
  }
  const keyDirection = (foldKeys.has('BracketRight') ? 1 : 0) - (foldKeys.has('BracketLeft') ? 1 : 0);
  if (keyDirection) {
    setAngle(targetFold * DEG + keyDirection * 24 * dt);
  }
  fold += (targetFold - fold) * (1 - Math.exp(-dt * 7));
  if (Math.abs(targetFold - fold) < 1e-6) {
    fold = targetFold;
  }
  foldUniform.value = fold;
  vehicles.update(dt, fold);

  if (sphere.released) {
    acc += dt;
    while (acc >= 1 / 120) {
      stepBall(sphere, fold, 1 / 120);
      acc -= 1 / 120;
    }
  }
  const f = frameAt(sphere.s, fold);
  ball.position.fromArray(bendPoint(0.5, sphere.h, sphere.s, fold));
  ball.rotation.x = sphere.rotation;
  shadow.position.fromArray(bendPoint(0.5, 0.085, sphere.s, fold));
  normal.set(0, f.ny, f.nz);
  shadow.quaternion.setFromUnitVectors(zAxis, normal);
  shadow.material.opacity = 0.2 / Math.max(1, sphere.h);
  shadow.scale.setScalar(1 + Math.max(0, sphere.h - 0.74) * 0.18);

  $('degrees').innerHTML = Math.round(fold * DEG) + '<span>°</span>';

  if (xr.presenting) {
    xr.update(dt, fold);
  } else if (walker.active) {
    walker.update(dt, fold);
  } else {
    controls.update();
  }
  updateArc();
  renderer.shadowMap.needsUpdate = true;

  // Refresh reflections slowly; the street and its shadow bend together on the GPU.
  // In VR the six cube renders would drop frames, so the sphere keeps its last reflection.
  if (now - reflectionTime > 1400 && !xr.presenting) {
    ball.visible = false;
    shadow.visible = false;
    cubeCam.position.copy(ball.position);
    cubeCam.update(renderer, scene);
    ball.visible = true;
    shadow.visible = true;
    reflectionTime = now;
  }

  if (xr.presenting) {
    renderer.render(scene, camera);
  } else {
    post.composer.render(dt);
  }
}
renderer.setAnimationLoop(frame);
