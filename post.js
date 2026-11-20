import * as T from 'three';
import { EffectComposer } from './EffectComposer.js';
import { RenderPass } from './RenderPass.js';
import { GTAOPass } from './GTAOPass.js';
import { UnrealBloomPass } from './UnrealBloomPass.js';
import { OutputPass } from './OutputPass.js';
import { ShaderPass } from './ShaderPass.js';
import { FXAAShader } from './FXAAShader.js';

// Desktop only. WebXR renders the scene directly (see app.js), without these passes.

const DOF_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOF_FRAG = `
uniform sampler2D tDiffuse, tDepth;
uniform vec2 resolution;
uniform float focus, strength, near, far;
varying vec2 vUv;
float distanceAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return near * far / (far - d * (far - near));
}
void main() {
  float depth = distanceAt(vUv);
  float coc = clamp(abs(depth - focus) / max(depth, 1.0), 0.0, 1.0);
  float radius = coc * strength * 18.0;
  vec4 sum = texture2D(tDiffuse, vUv);
  float total = 1.0;
  for (int i = 0; i < 24; i++) {
    float a = float(i) * 2.399963;
    float r = sqrt((float(i) + 0.5) / 24.0) * radius;
    vec2 uv = clamp(vUv + vec2(cos(a), sin(a)) * r / resolution, vec2(0.001), vec2(0.999));
    float sd = distanceAt(uv);
    float weight = sd < depth * 0.85 ? 0.12 : 1.0;
    sum += texture2D(tDiffuse, uv) * weight;
    total += weight;
  }
  gl_FragColor = sum / total;
}`;

export function postProcessing(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 2.4, thickness: 1.25, distanceExponent: 1.8, distanceFallOff: 0.8, scale: 1, samples: 12 });
  ao.updatePdMaterial({ radius: 4, samples: 8, rings: 2 });
  ao.blendIntensity = 0.85;

  // GTAO's stock override flattens custom vertex deformation. Swap each mesh to
  // its matching deformed normal material while preserving the real depth buffer.
  const staticNormal = new T.MeshNormalMaterial();
  const clear = new T.Color();
  ao.renderOverride = (r, unused, target) => {
    const auto = r.autoClear;
    const background = scene.background;
    const alpha = r.getClearAlpha();
    const override = scene.overrideMaterial;
    r.getClearColor(clear);
    const saved = [];
    scene.traverse((o) => {
      if (!o.isMesh) {
        return;
      }
      saved.push([o, o.material, o.visible]);
      if (o.userData.skipAO || o.material.transparent) {
        o.visible = false;
      } else {
        o.material = o.userData.aoNormal || staticNormal;
      }
    });
    scene.background = null;
    scene.overrideMaterial = null;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.setClearColor(0x7777ff, 1);
    r.clear();
    try {
      r.render(scene, camera);
    } finally {
      for (const [o, m, v] of saved) {
        o.material = m;
        o.visible = v;
      }
      scene.background = background;
      scene.overrideMaterial = override;
      r.autoClear = auto;
      r.setClearColor(clear, alpha);
    }
  };
  composer.addPass(ao);

  const dof = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: ao.depthTexture },
      resolution: { value: new T.Vector2(innerWidth, innerHeight) },
      focus: { value: 35 },
      strength: { value: 0 },
      near: { value: camera.near },
      far: { value: camera.far },
    },
    vertexShader: DOF_VERT,
    fragmentShader: DOF_FRAG,
  });
  dof.enabled = false;
  composer.addPass(dof);

  const bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.6, 0.65, 0.62);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  function resize() {
    composer.setSize(innerWidth, innerHeight);
    const dpr = renderer.getPixelRatio();
    dof.uniforms.resolution.value.set(innerWidth * dpr, innerHeight * dpr);
    fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * dpr), 1 / (innerHeight * dpr));
  }
  resize();

  return { composer, ao, bloom, dof, resize };
}
