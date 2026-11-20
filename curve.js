// One continuous, injective bend shared by the visible street, shadows, cars, sphere and walker.
// At 180 degrees the minimum radius is 25.46 m; all architecture stays below 15 m.
// s = distance along the street, x = across, y = height above the street surface.

export const BEND_START = -4;
export const BEND_LENGTH = 80;
export const STREET_MIN = -172;
export const STREET_MAX = 268;
export const MAX_HEIGHT = 15;

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// The street frame at distance s: origin (y, z), normal (ny, nz), tangent (ty, tz),
// bend angle phi so far, and curvature k (zero outside the bend).
export function frameAt(s, angle) {
  const u = clamp(s - BEND_START, 0, BEND_LENGTH);
  const k = angle / BEND_LENGTH;
  const phi = k * u;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const flat = angle < 1e-7;
  const cy = flat ? 0 : (1 - c) / k;
  const cz = flat ? u : sn / k;
  const tail = s - BEND_START - u;
  return {
    y: cy + tail * sn,
    z: BEND_START + cz + tail * c,
    ny: c,
    nz: -sn,
    ty: sn,
    tz: c,
    phi,
    k: s > BEND_START && s < BEND_START + BEND_LENGTH ? k : 0,
  };
}

export function bendPoint(x, y, s, angle) {
  const f = frameAt(s, angle);
  return [x, f.y + y * f.ny, f.z + y * f.nz];
}

export const createBall = () => ({
  s: 111, h: 2.8, vs: 0, vh: 0, released: false, grounded: false, rotation: 0,
});

export function stepBall(b, angle, dt) {
  if (!b.released) {
    return;
  }
  const f = frameAt(b.s, angle);
  // Angular interpolation stays well-defined when the two street normals oppose at 180 degrees.
  const u = clamp((b.s - BEND_START) / BEND_LENGTH, 0, 1);
  const gravityPhi = Math.max(0, f.phi - (0.22 * Math.sin(Math.PI * u) + 0.1 * u) * Math.min(1, angle));
  const gy = -Math.cos(gravityPhi);
  const gz = Math.sin(gravityPhi);
  const gt = 9.81 * (gy * f.ty + gz * f.tz);
  const gn = 9.81 * (gy * f.ny + gz * f.nz);
  b.vs = (b.vs + gt * dt) * Math.exp(-0.01 * dt);
  // Once contact is made, curved gravity keeps the sphere rolling on the street.
  if (!b.grounded) {
    b.vh += gn * dt;
  }
  b.s += (b.vs * dt) / Math.max(0.5, 1 - b.h * f.k);
  b.h += b.vh * dt;
  if (b.h <= 0.74 || b.grounded) {
    b.h = 0.74;
    b.vh = 0;
    b.grounded = true;
  }
  if (b.s < STREET_MIN + 1) {
    b.s = STREET_MIN + 1;
    b.vs = Math.abs(b.vs) * 0.32;
  }
  if (b.s > STREET_MAX - 1) {
    b.s = STREET_MAX - 1;
    b.vs = -Math.abs(b.vs) * 0.32;
  }
  b.rotation += (b.vs * dt) / 0.65;
}

// The same bend on the GPU. Geometry is built flat (z = s) and folded in the vertex shader.
export const bendGLSL = `
uniform float uFold;
vec3 streetFrame(float s) {
  float u = clamp(s + 4.0, 0.0, 80.0);
  float phi = uFold * u / 80.0;
  if (uFold < 0.000001) return vec3(0.0, s, phi);
  float r = 80.0 / uFold;
  float tail = s + 4.0 - u;
  return vec3(r * (1.0 - cos(phi)) + tail * sin(phi), -4.0 + r * sin(phi) + tail * cos(phi), phi);
}
vec3 bendPosition(vec3 p) {
  vec3 f = streetFrame(p.z);
  return vec3(p.x, f.x + p.y * cos(f.z), f.y - p.y * sin(f.z));
}
vec3 bendNormal(vec3 n, vec3 p) {
  vec3 f = streetFrame(p.z);
  float k = (p.z > -4.0 && p.z < 76.0) ? uFold / 80.0 : 0.0;
  n.z /= max(0.25, 1.0 - p.y * k);
  return normalize(vec3(n.x, cos(f.z) * n.y + sin(f.z) * n.z, -sin(f.z) * n.y + cos(f.z) * n.z));
}
`;
