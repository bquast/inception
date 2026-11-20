import * as T from './three.module.js';
import { mergeGeometries } from './BufferGeometryUtils.js';
import { bendGLSL, MAX_HEIGHT } from './curve.js';
// The whole street and the side district around it, built flat (z = s) and merged into one mesh per material.
// Every material folds in its vertex shader (see bendGLSL in curve.js), so the fold costs nothing on the CPU.
// Returns the colliders for the walker, and bounds used to check the 15 m height limit.
// A Haussmann facade painted on a canvas, 6.08 m wide and 9.35 m tall, on the same grid as the
// geometry: rusticated ground floor, three floors of framed windows, balconies on the first and third.
// Drawn near-white so a material colour tints it.
function paintedFacade() {
  const W = 512;
  const H = 768;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const px = W / 6.08;
  const py = H / 9.35;
  // Rectangle in metres: centre x from the middle, bottom y from the base of the wall.
  const rect = (fill, cx, y, w, h) => {
    g.fillStyle = fill;
    g.fillRect((cx - w / 2 + 3.04) * px, H - (y + h) * py, w * px, h * py);
  };
  rect('#f3f1ec', 0, 0, 6.08, 9.35);
  for (let r = 0; r < 7; r++) rect('#b8b3aa', 0, 0.42 + r * 0.28, 6.08, 0.025);
  rect('#ffffff', 0, 2.27, 6.08, 0.2);
  rect('#aaa59c', 0, 2.25, 6.08, 0.03);
  // Door and two ground-floor openings.
  rect('#38423f', 0, 0.2, 1.14, 2.08);
  rect('#6b553b', 0, 0.25, 0.93, 1.85);
  for (const cx of [-1.85, 1.85]) {
    rect('#e9e6df', cx, 0.6, 1.3, 1.55);
    rect('#33454f', cx, 0.7, 1.08, 1.35);
  }
  // Windows: frame, glass, glazing bars, pediment.
  for (let floor = 0; floor < 3; floor++) {
    const yy = 3.37 + floor * 2.12;
    for (const cx of [-1.68, 0, 1.68]) {
      rect('#d4cfc5', cx, yy - 0.9, 1.07, 1.8);
      rect('#ffffff', cx, yy - 0.86, 1.03, 1.72);
      rect('#344a56', cx, yy - 0.745, 0.79, 1.49);
      rect('#4f6672', cx - 0.2, yy + 0.2, 0.3, 0.45);
      rect('#e8e4da', cx, yy - 0.745, 0.04, 1.49);
      rect('#e8e4da', cx, yy + 0.3, 0.79, 0.04);
      rect('#ffffff', cx, yy + 0.89, 1.18, 0.12);
      rect('#b8b3aa', cx, yy + 0.87, 1.18, 0.02);
    }
  }
  // Balconies: slab, its shadow, rails and bars.
  for (const floor of [0, 2]) {
    const yy = 3.37 + floor * 2.12;
    rect('#ffffff', 0, yy - 0.94, 6.08, 0.13);
    rect('#9f9a91', 0, yy - 1.0, 6.08, 0.06);
    rect('#2d3636', 0, yy - 0.32, 5.9, 0.05);
    rect('#2d3636', 0, yy - 0.79, 5.9, 0.04);
    for (let b = 0; b < 40; b++) rect('#2d3636', -2.92 + b * 0.15, yy - 0.79, 0.025, 0.5);
  }
  rect('#a29d94', 0, 9.0, 6.08, 0.08);
  const map = new T.CanvasTexture(c);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

export function buildCity(scene, foldUniform) {
  const palette = {
    stone: 0xc8baa0,
    cream: 0xdfd2b7,
    ochre: 0xbaae94,
    trim: 0xe8dabd,
    shadow: 0x8f8878,
    roof: 0x505c65,
    roofEdge: 0x707c82,
    glass: 0x334956,
    glassLight: 0x526974,
    iron: 0x303b3a,
    road: 0x686d68,
    paving: 0xb9b5a5,
    joint: 0x959789,
    white: 0xded9c6,
    earth: 0x888b7d,
    wood: 0x705b40,
    leaf: 0x8d9462,
    leafLight: 0xa8ad76,
    leafDark: 0x6c8057,
    awning: 0x536b62,
    ground: 0xa9a69b,
    gold: 0xeccd85,
  };
  const materials = {},
    batches = new Map(),
    bounds = { maxY: 0, vertices: 0, colliders: [] };
  function deform(material, normals = true) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFold = foldUniform;
      shader.vertexShader = bendGLSL + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed = bendPosition(transformed);'
      );
      if (normals)
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\nobjectNormal = bendNormal(objectNormal,position);'
        );
    };
    material.customProgramCacheKey = () => (normals ? 'curved-city-v2' : 'curved-depth-v2');
    return material;
  }
  for (const [key, color] of Object.entries(palette))
    materials[key] = deform(
      new T.MeshStandardMaterial({
        color,
        roughness: key.startsWith('glass') ? 0.33 : 0.88,
        metalness: key === 'iron' ? 0.25 : 0,
      })
    );
  materials.gold.emissive = new T.Color(0xf0bb48);
  materials.gold.emissiveIntensity = 0.35;
  // The far rows share one painted facade, tinted by the stone colours.
  const facadeMap = paintedFacade();
  for (const key of ['stone', 'cream', 'ochre']) {
    materials['painted-' + key] = deform(new T.MeshStandardMaterial({ color: palette[key], map: facadeMap, roughness: 0.88 }));
  }
  const aoNormal = deform(new T.MeshNormalMaterial());
  const depth = deform(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), false);
  function addGeometry(key, g) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) bounds.maxY = Math.max(bounds.maxY, p.getY(i));
    bounds.vertices += p.count;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(g);
  }
  const geoCache = new Map();
  // step: segment length along z, for the bend. 1.5 m keeps the error under 3 cm at roof height on
  // the tightest fold (the original used 0.7 m); far out 3 m is enough.
  function box(key, x, y, z, w, h, d, rx = 0, ry = 0, step = Math.abs(x) > 150 ? 3 : 1.5) {
    const seg = Math.max(1, Math.ceil(d / step)),
      cacheKey = 'b' + seg;
    let base = geoCache.get(cacheKey);
    if (!base) {
      base = new T.BoxGeometry(1, 1, 1, 1, 1, seg);
      geoCache.set(cacheKey, base);
    }
    const g = base.clone();
    g.scale(w, h, d);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    addGeometry(key, g);
  }
  function shape(key, g, x, y, z, sx = 1, sy = 1, sz = 1) {
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    addGeometry(key, g);
  }
  function roof(x, y, z, w, d, step = 0.6) {
    const g = new T.BoxGeometry(w, 1.7, d, 1, 1, Math.ceil(d / step));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * 0.7);
        p.setZ(i, p.getZ(i) * 0.76);
      }
    }
    g.computeVertexNormals();
    g.translate(x, y + 0.85, z);
    addGeometry('roof', g);
    box('roofEdge', x, y + 1.75, z, w * 0.72, 0.16, d * 0.78, 0, 0, Math.max(1.5, step));
  }
  function lamp(x, z) {
    shape('iron', new T.CylinderGeometry(0.055, 0.115, 3.35, 6), x, 1.9, z);
    shape('iron', new T.CylinderGeometry(0.15, 0.24, 0.5, 6), x, 0.48, z);
    box('iron', x, 3.63, z, 0.48, 0.13, 0.48);
    box('cream', x, 3.97, z, 0.3, 0.52, 0.3);
    for (const dx of [-0.17, 0.17])
      for (const dz of [-0.17, 0.17]) box('iron', x + dx, 3.96, z + dz, 0.035, 0.63, 0.035);
    shape('iron', new T.ConeGeometry(0.43, 0.36, 4), x, 4.43, z);
    shape('iron', new T.ConeGeometry(0.085, 0.3, 5), x, 4.69, z);
  }
  function tree(x, z, index) {
    box('shadow', x, 0.29, z, 1.35, 0.16, 1.35);
    box('earth', x, 0.38, z, 1.12, 0.08, 1.12);
    shape('wood', new T.CylinderGeometry(0.075, 0.14, 2.9, 5), x, 1.75, z);
    const g = new T.IcosahedronGeometry(1, 1);
    shape(index % 2 ? 'leaf' : 'leafLight', g, x, 3.55, z, 1.13, 1.85, 1.03);
    shape('leafDark', new T.IcosahedronGeometry(1, 0), x + 0.5, 3.35, z - 0.2, 0.85, 1.1, 0.8);
  }
  function bench(x, z, side) {
    for (let i = 0; i < 4; i++) box('wood', x, 0.67, z + (i - 1.5) * 0.16, 1.6, 0.085, 0.12);
    for (let i = 0; i < 3; i++) box('wood', x, 1.03 + i * 0.13, z + side * 0.37, 1.6, 0.08, 0.07);
    for (const dx of [-0.58, 0.58]) {
      box('iron', x + dx, 0.44, z, 0.07, 0.5, 0.6);
      box('iron', x + dx, 0.91, z + side * 0.38, 0.065, 0.7, 0.06);
    }
  }
  const signMats = new Map();
  function sign(text, x, y, z, side, bg = '#334d48', w = 2.3) {
    let key = 'sign-' + text;
    if (!signMats.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const c = canvas.getContext('2d');
      c.fillStyle = bg;
      c.fillRect(0, 0, 512, 96);
      c.strokeStyle = '#c8b991';
      c.lineWidth = 4;
      c.strokeRect(7, 7, 498, 82);
      c.fillStyle = '#f1e4c9';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '32px Georgia';
      c.fillText(text, 256, 50);
      const map = new T.CanvasTexture(canvas);
      map.colorSpace = T.SRGBColorSpace;
      materials[key] = deform(new T.MeshStandardMaterial({ map, roughness: 0.8 }));
      signMats.set(key, true);
    }
    const g = new T.PlaneGeometry(w, 0.43, 8, 1);
    g.rotateY((-side * Math.PI) / 2);
    g.translate(x, y, z);
    addGeometry(key, g);
  }
  // A continuous road and pavements, subdivided along the bend.
  box('earth', 0, -0.5, 48, 740, 1.0, 440);
  box('ground', 0, -0.025, 48, 740, 0.06, 440);
  box('road', 0, -0.015, 48, 9, 0.16, 440);
  for (const side of [-1, 1]) {
    box('paving', side * 6, 0.11, 48, 3, 0.3, 440);
    box('trim', side * 4.57, 0.19, 48, 0.2, 0.3, 440);
    box('joint', side * 7.4, 0.22, 48, 0.09, 0.09, 440);
    for (let z = -171; z < 268; z += 1.5) {
      box('joint', side * 6, 0.267, z, 2.8, 0.013, 0.025);
      box('shadow', side * 4.56, 0.352, z, 0.205, 0.011, 0.023);
    }
    for (const x of [5.3, 6.4]) box('joint', side * x, 0.267, 48, 0.025, 0.014, 440);
    for (let i = 0; i < 64; i++) {
      if (i % 4 === 3) continue;
      const z = -168.5 + i * 6.35,
        x = side * 10.65,
        h = 8.45 + ((i * 3 + (side > 0 ? 1 : 0)) % 4) * 0.6,
        face = side * 7.55,
        key = ['stone', 'cream', 'ochre', 'cream'][i % 4];
      bounds.colliders.push({ x, z, w: 6.1, d: 6.08 });
      box(key, x, h / 2 + 0.28, z, 6.1, h, 6.08);
      box('shadow', face - side * 0.012, h / 2, z, 0.035, h - 0.2, 5.7);
      box(key, face - side * 0.045, h / 2, z, 0.08, h - 0.2, 5.57);
      box('trim', x, 0.52, z, 6.22, 0.45, 6.16);
      for (const [yy, hh, over] of [
        [2.65, 0.2, 0.15],
        [h - 0.1, 0.14, 0.15],
        [h + 0.14, 0.28, 0.3],
        [h + 0.38, 0.12, 0.42],
      ])
        box('trim', x, yy, z, 6.1 + over, hh, 6.08 + over * 0.5);
      roof(x, h + 0.44, z, 6.3, 6.24);
      for (const zz of [z - 2.6, z + 2.6]) {
        box('stone', x + side * 1.8, h + 2.1, zz, 0.44, 1.4, 0.52);
        for (const offset of [-0.11, 0.11])
          shape('wood', new T.CylinderGeometry(0.08, 0.1, 0.38, 6), x + side * 1.8 + offset, h + 2.96, zz);
      }
      for (const zz of [z - 1.65, z, z + 1.65]) {
        box('trim', face + side * 0.42, h + 1.12, zz, 0.5, 1.13, 0.9);
        box('glass', face + side * 0.14, h + 1.12, zz, 0.04, 0.91, 0.66);
        box('trim', face + side * 0.105, h + 1.12, zz, 0.04, 0.94, 0.04);
        box('roofEdge', face + side * 0.35, h + 1.8, zz, 0.75, 0.14, 1.13);
      }
      // Rusticated ground floor and pilasters.
      for (let row = 0; row < 7; row++)
        box('shadow', face - side * 0.065, 0.62 + row * 0.28, z, 0.06, 0.018, 5.87);
      for (const zz of [z - 2.93, z + 2.93]) {
        box('trim', face - side * 0.13, h / 2, zz, 0.18, h - 0.15, 0.2);
        for (let r = 0; r < 7; r++) box('cream', face - side * 0.21, 0.68 + r * 0.28, zz, 0.15, 0.17, 0.34);
      }
      for (let floor = 0; floor < 3; floor++) {
        const yy = 3.65 + floor * 2.12;
        for (let col = 0; col < 3; col++) {
          const zz = z + (col - 1) * 1.68;
          box('shadow', face - side * 0.115, yy, zz, 0.07, 1.84, 1.17);
          box('trim', face - side * 0.19, yy, zz, 0.17, 1.72, 1.03);
          box(
            (i + col + floor) % 4 === 0 ? 'glassLight' : 'glass',
            face - side * 0.29,
            yy,
            zz,
            0.06,
            1.49,
            0.79
          );
          box('trim', face - side * 0.335, yy, zz, 0.04, 1.5, 0.055);
          box('trim', face - side * 0.34, yy + 0.1, zz, 0.04, 0.065, 0.79);
          box('trim', face - side * 0.3, yy + 0.95, zz, 0.34, 0.12, 1.18);
          box('trim', face - side * 0.36, yy - 0.92, zz, 0.48, 0.12, 1.2);
          if ((i + col) % 3 === 0) {
            for (const dz of [-0.66, 0.66]) {
              box('awning', face - side * 0.16, yy, zz + dz, 0.1, 1.48, 0.29);
              for (let sl = 0; sl < 6; sl++)
                box('iron', face - side * 0.225, yy - 0.55 + sl * 0.21, zz + dz, 0.024, 0.025, 0.24);
            }
          }
          if (floor === 0 || floor === 2) {
            box('trim', face - side * 0.51, yy - 0.87, zz, 0.75, 0.13, 1.3);
            box('iron', face - side * 0.86, yy - 0.29, zz, 0.07, 0.07, 1.3);
            box('iron', face - side * 0.86, yy - 0.76, zz, 0.05, 0.04, 1.3);
            for (let rail = 0; rail < 7; rail++)
              box('iron', face - side * 0.86, yy - 0.52, zz - 0.58 + rail * 0.193, 0.036, 0.48, 0.036);
            for (const dz of [-0.62, 0.62])
              box('iron', face - side * 0.53, yy - 0.29, zz + dz, 0.66, 0.06, 0.05);
          }
        }
      }
      for (const end of [-1, 1])
        for (let floor = 0; floor < 4; floor++)
          for (const dx of [-1.75, 0, 1.75]) {
            box('trim', x + dx, 1.42 + floor * 2.05, z + end * 3.08, 1.05, 1.55, 0.12);
            box('glass', x + dx, 1.42 + floor * 2.05, z + end * 3.16, 0.81, 1.32, 0.04);
            box('trim', x + dx, 1.42 + floor * 2.05, z + end * 3.2, 0.06, 1.35, 0.04);
          }
      // Doors and occasional small shopfronts.
      box('iron', face - side * 0.17, 1.34, z, 0.13, 2.08, 1.14);
      box('wood', face - side * 0.26, 1.26, z, 0.08, 1.75, 0.93);
      box('gold', face - side * 0.315, 1.2, z + 0.27, 0.025, 0.18, 0.045);
      if (i % 3 === 1) {
        for (const zz of [z - 1.85, z + 1.85]) {
          box('iron', face - side * 0.18, 1.26, zz, 0.12, 1.72, 1.4);
          box('glass', face - side * 0.26, 1.3, zz, 0.055, 1.51, 1.21);
          box('awning', face - side * 0.48, 2.2, zz, 0.84, 0.16, 1.7);
          box('trim', face - side * 0.88, 2.12, zz, 0.055, 0.19, 1.7);
        }
        sign(i % 2 ? 'BOULANGERIE' : 'CAFÉ', face - side * 0.25, 2.49, z, side, '#3e534b', 2.0);
      }
      if (i === 1 || i === 9) sign('RUE DES RÊVES', face - side * 0.26, 2.72, z + 1.8, side, '#284354', 1.4);
    }
    for (let i = 0; i < 50; i++) {
      lamp(side * 5.15, -167 + i * 8.5);
      tree(side * 6.3, -163 + i * 8.5, i);
      if (i % 3 === 1) bench(side * 6.0, -165 + i * 8.5, side);
    }
    for (let z = -170; z < 268; z += 4.2) box('iron', side * 4.96, 0.65, z, 0.12, 0.76, 0.12);
  }
  for (let z = -170; z < 268; z += 3.0) box('white', 0, 0.073, z, 0.11, 0.017, 1.35);
  for (const s of [-25, 42]) for (let i = -3; i <= 3; i++) box('white', i * 1.13, 0.076, s, 0.64, 0.019, 2.7);
  // Subtle gold bands identify the bend's two tangent joins.
  for (const s of [-4, 76]) box('gold', 0, 0.083, s, 9, 0.025, 0.055);
  // ---- Side district.
  // The main street's gaps (i % 4 === 3) continue as cross streets, and long streets run parallel to the
  // main street, every PITCH metres. Each long street has a row of buildings on each side, on the same
  // 6.35 m rhythm as the main street. Rows near the main street get real facades (sideFacade); rows
  // further out get a painted facade texture (paintedBlock), so the whole city reads as finished.
  const LONG0 = 23.1; // first long street, |x|
  const PITCH = 18.8; // long street to long street
  const HALF = 3.3; // long street half-width, facade to centre
  const DEPTH = 6.1; // building depth across x
  const NEAR = 50; // rows closer than this get real facades
  const sAt = (i) => -168.5 + i * 6.35;

  // A Haussmann facade in geometry, lighter than the main street's. dir points from the street to the
  // building centre; the facade plane is at face, and its details stand out toward the street.
  function sideFacade(key, x, z, dir, h, i) {
    const face = x - dir * DEPTH / 2;
    const S = 2; // long boxes need fewer segments than on the main street
    box(key, x, h / 2 + 0.28, z, DEPTH, h, 6.08, 0, 0, S);
    box('trim', x, 0.52, z, 6.22, 0.45, 6.16, 0, 0, S);
    box('trim', x, 2.65, z, 6.25, 0.2, 6.15, 0, 0, S);
    box('trim', x, h + 0.14, z, 6.4, 0.28, 6.23, 0, 0, S);
    roof(x, h + 0.44, z, 6.3, 6.24, S);
    for (const zz of [z - 2.6, z + 2.6]) box('stone', x + dir * 1.8, h + 2.1, zz, 0.44, 1.4, 0.52);
    for (const zz of [z - 1.65, z, z + 1.65]) {
      box('trim', face + dir * 0.42, h + 1.12, zz, 0.5, 1.13, 0.9);
      box('glass', face + dir * 0.14, h + 1.12, zz, 0.04, 0.91, 0.66);
    }
    // Rusticated ground floor, door, and a shop or two windows either side of it.
    for (let r = 0; r < 3; r++) box('shadow', face - dir * 0.02, 0.95 + r * 0.56, z, 0.04, 0.02, 5.9, 0, 0, S);
    box('iron', face - dir * 0.07, 1.34, z, 0.13, 2.08, 1.14);
    box('wood', face - dir * 0.15, 1.26, z, 0.08, 1.75, 0.93);
    for (const zz of [z - 1.85, z + 1.85]) {
      box(i % 3 === 1 ? 'iron' : 'trim', face - dir * 0.06, 1.4, zz, 0.12, 1.55, 1.3);
      box('glass', face - dir * 0.14, 1.42, zz, 0.05, 1.35, 1.08);
      if (i % 3 === 1) box('awning', face - dir * 0.45, 2.3, zz, 0.8, 0.14, 1.5);
    }
    // Three floors of windows with pediments.
    for (let floor = 0; floor < 3; floor++) {
      const yy = 3.65 + floor * 2.12;
      for (let col = 0; col < 3; col++) {
        const zz = z + (col - 1) * 1.68;
        box('trim', face - dir * 0.09, yy, zz, 0.17, 1.72, 1.03);
        box((i + col + floor) % 4 === 0 ? 'glassLight' : 'glass', face - dir * 0.19, yy, zz, 0.06, 1.49, 0.79);
        box('trim', face - dir * 0.2, yy + 0.95, zz, 0.34, 0.12, 1.18);
      }
    }
    // Continuous balconies on the first and third floor, as on a Haussmann block.
    for (const floor of [0, 2]) {
      const yy = 3.65 + floor * 2.12;
      box('trim', face - dir * 0.4, yy - 0.87, z, 0.8, 0.13, 5.9, 0, 0, S);
      box('iron', face - dir * 0.76, yy - 0.29, z, 0.06, 0.06, 5.9, 0, 0, S);
      box('iron', face - dir * 0.76, yy - 0.76, z, 0.05, 0.04, 5.9, 0, 0, S);
      for (let b = 0; b < 7; b++) box('iron', face - dir * 0.76, yy - 0.52, z - 2.85 + b * 0.95, 0.036, 0.48, 0.036);
    }
    // The end walls that face a cross street get windows too.
    const ends = i % 4 === 0 ? [-1] : i % 4 === 2 ? [1] : [];
    for (const end of ends) {
      for (let floor = 0; floor < 4; floor++) {
        for (const dx of [-1.75, 0, 1.75]) {
          box('trim', x + dx, 1.42 + floor * 2.05, z + end * 3.08, 1.05, 1.55, 0.12);
          box('glass', x + dx, 1.42 + floor * 2.05, z + end * 3.16, 0.81, 1.32, 0.04);
        }
      }
    }
  }

  // A far building: one box with a painted facade on all four sides, a cornice, a roof and a chimney.
  function paintedBlock(key, x, z, h) {
    box('painted-' + key, x, h / 2 + 0.28, z, DEPTH, h, 6.08, 0, 0, 3);
    box('trim', x, h + 0.14, z, 6.4, 0.28, 6.23, 0, 0, 6.5);
    roof(x, h + 0.44, z, 6.3, 6.24, 3.2);
    box('stone', x + 1.8, h + 2.1, z - 2.6, 0.44, 1.4, 0.52);
  }

  for (const side of [-1, 1]) {
    // Cross streets, from the main street's pavement to the edge of the city.
    for (let i = 3; i < 64; i += 4) box('road', side * 187.75, 0.02, sAt(i), 360.5, 0.06, 3.6);
    for (let m = 0; LONG0 + m * PITCH < 368; m++) {
      const L = LONG0 + m * PITCH;
      box('road', side * L, 0.015, 48, 3.6, 0.06, 440, 0, 0, 4);
      const near = L < NEAR + 10;
      for (let i = 1; near && i < 64; i += 4) {
        lamp(side * (L - 2.6), sAt(i));
        lamp(side * (L + 2.6), sAt(i + 1));
      }
      for (const out of [-1, 1]) {
        const dist = L + out * (HALF + DEPTH / 2);
        const x = side * dist;
        const dir = side * out;
        for (let i = 0; i < 64; i++) {
          if (i % 4 === 3) continue;
          const z = sAt(i);
          const seed = i * 3 + m * 5 + (out > 0 ? 2 : 0) + (side > 0 ? 1 : 0);
          const h = 8.45 + (seed % 4) * 0.6;
          const key = ['stone', 'cream', 'ochre', 'cream'][(i + m + (out > 0 ? 1 : 0)) % 4];
          bounds.colliders.push({ x, z, w: DEPTH, d: 6.08 });
          if (dist < NEAR) sideFacade(key, x, z, dir, h, i);
          else paintedBlock(key, x, z, h);
        }
      }
    }
  }
  // Freestanding ad panels. Both support legs end strictly below the text panel.
  const stopCanvas = document.createElement('canvas');
  stopCanvas.width = 1024;
  stopCanvas.height = 1280;
  const ctx = stopCanvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1024, 1280);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 144px Arial';
  ctx.fillText('Follow', 512, 315);
  ctx.font = 'bold 155px Arial';
  ctx.fillText('@RyanSael', 512, 640);
  ctx.font = 'bold 144px Arial';
  ctx.fillText('on X', 512, 965);
  const stopMap = new T.CanvasTexture(stopCanvas);
  stopMap.colorSpace = T.SRGBColorSpace;
  stopMap.anisotropy = 8;
  materials.busStop = deform(new T.MeshBasicMaterial({ map: stopMap, toneMapped: false }));
  for (let i = 0; i < 10; i++) {
    const stopX = (i % 2 ? -1 : 1) * 5.7,
      stopS = -116.3 + i * 44;
    for (const dx of [-0.62, 0.62]) box('iron', stopX + dx, 0.69, stopS, 0.1, 0.86, 0.14);
    box('iron', stopX, 2.35, stopS, 1.96, 2.4, 0.2);
    bounds.colliders.push({ x: stopX, z: stopS, w: 1.96, d: 0.24 });
    for (const side of [-1, 1]) {
      const g = new T.PlaneGeometry(1.88, 2.32);
      if (side < 0) g.rotateY(Math.PI);
      g.translate(stopX, 2.35, stopS + side * 0.115);
      addGeometry('busStop', g);
    }
  }
  if (bounds.maxY >= MAX_HEIGHT) throw new Error('Architecture exceeds safe bend radius clearance');
  for (const [key, list] of batches) {
    const g = mergeGeometries(list, false);
    for (const item of list) item.dispose();
    const m = new T.Mesh(g, materials[key]);
    m.name = key;
    m.customDepthMaterial = depth;
    m.userData.aoNormal = aoNormal;
    m.castShadow = !['road', 'paving', 'white', 'joint', 'gold'].includes(key);
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }
  for (const g of geoCache.values()) g.dispose();
  return bounds;
}
