import * as T from './three.module.js';

const SKY_VERT = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
varying vec3 vDirection;
uniform vec3 sunDirection;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 d = normalize(vDirection);
  float h = max(d.y, 0.0);
  vec3 col = mix(vec3(0.77, 0.83, 0.83), vec3(0.26, 0.48, 0.65), pow(h, 0.5));
  float sun = max(dot(d, normalize(sunDirection)), 0.0);
  col += vec3(0.30, 0.23, 0.10) * pow(sun, 12.0) + vec3(0.8, 0.65, 0.35) * pow(sun, 350.0);
  vec2 uv = d.xz / (0.16 + max(d.y, 0.03)) * 2.2;
  float n = noise(uv) * 0.58 + noise(uv * 2.1) * 0.27 + noise(uv * 4.3) * 0.15;
  float cloud = smoothstep(0.56, 0.74, n) * smoothstep(0.015, 0.2, d.y);
  col = mix(col, vec3(0.91, 0.91, 0.85), cloud * 0.80);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function environment(scene) {
  const skyUniforms = { sunDirection: { value: new T.Vector3(-0.5, 0.6, -0.6) } };
  const sky = new T.Mesh(
    new T.SphereGeometry(750, 32, 16),
    new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    })
  );
  sky.renderOrder = -10;
  sky.userData.skipAO = true;
  scene.add(sky);

  const floor = new T.Mesh(
    new T.PlaneGeometry(1500, 1500),
    new T.MeshStandardMaterial({ color: 0xabb5ac, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.57;
  floor.receiveShadow = true;
  scene.add(floor);

  return { skyUniforms, sky };
}
