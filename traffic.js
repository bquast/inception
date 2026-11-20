import * as T from './three.module.js';
import { mergeGeometries } from './BufferGeometryUtils.js';
import { bendPoint, frameAt, STREET_MIN, STREET_MAX } from './curve.js';

const PALETTE = [0xd4d4c9, 0x667778, 0x3f4c56, 0x826c61, 0xa6a899];

// Parked cars on both kerbs (with gaps at the two crossings), and six moving cars.
function makeCars() {
  const cars = [];
  for (let i = 0; i < 32; i++) {
    const s = -149 + i * 12.5;
    if (Math.abs(s + 25) < 5 || Math.abs(s - 42) < 5) {
      continue;
    }
    cars.push({ s, x: (i % 2 ? 1 : -1) * 3.48, direction: i % 2 ? 1 : -1, speed: 0, color: i % 5 });
  }
  for (let i = 0; i < 6; i++) {
    cars.push({ s: -120 + i * 66, x: (i % 2 ? 1 : -1) * 1.85, direction: i % 2 ? 1 : -1, speed: 4.2, color: (i + 2) % 5 });
  }
  return cars;
}

function carParts() {
  const body = new T.BoxGeometry(1.4, 0.45, 3.1);
  body.translate(0, 0.55, 0);

  const cabin = new T.BoxGeometry(1.23, 0.53, 1.65);
  const p = cabin.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * 0.81);
      p.setZ(i, p.getZ(i) * 0.78);
    }
  }
  cabin.computeVertexNormals();
  cabin.translate(0, 1, -0.12);

  const roof = new T.BoxGeometry(1.04, 0.07, 1.33);
  roof.translate(0, 1.3, -0.12);

  const tires = [];
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.99, 0.99]) {
      const g = new T.CylinderGeometry(0.29, 0.29, 0.15, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(x, 0.36, z);
      tires.push(g);
    }
  }
  const lamps = [-0.49, 0.49].map((x) => {
    const g = new T.BoxGeometry(0.28, 0.13, 0.035);
    g.translate(x, 0.67, 1.56);
    return g;
  });
  const rear = [-0.5, 0.5].map((x) => {
    const g = new T.BoxGeometry(0.25, 0.12, 0.035);
    g.translate(x, 0.65, -1.56);
    return g;
  });
  return { body, cabin, roof, tires, lamps, rear };
}

export function traffic(scene, colliders) {
  const cars = makeCars();
  for (const car of cars) {
    car.collider = { x: car.x, z: car.s, w: 1.4, d: 3.15 };
    colliders.push(car.collider);
  }

  const { body, cabin, roof, tires, lamps, rear } = carParts();
  const instances = [];
  const part = (g, mat, selection = cars) => {
    const m = new T.InstancedMesh(g, mat, selection.length);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
    instances.push({ m, selection });
  };
  for (let color = 0; color < 5; color++) {
    part(
      mergeGeometries([body.clone(), roof.clone()]),
      new T.MeshStandardMaterial({ color: PALETTE[color], metalness: 0.25, roughness: 0.43 }),
      cars.filter((c) => c.color === color)
    );
  }
  part(cabin, new T.MeshStandardMaterial({ color: 0x32464e, metalness: 0.22, roughness: 0.28 }));
  part(mergeGeometries(tires), new T.MeshStandardMaterial({ color: 0x292d2c, roughness: 1 }));
  part(mergeGeometries(lamps), new T.MeshStandardMaterial({ color: 0xe8ddb5, roughness: 0.35 }));
  part(mergeGeometries(rear), new T.MeshStandardMaterial({ color: 0x743b35, roughness: 0.45 }));

  const dummy = new T.Object3D();
  function update(dt, angle) {
    for (const car of cars) {
      car.s += car.speed * car.direction * dt;
      if (car.s > STREET_MAX - 5) {
        car.s = STREET_MIN + 5;
      }
      if (car.s < STREET_MIN + 5) {
        car.s = STREET_MAX - 5;
      }
      car.collider.z = car.s;
    }
    for (const { m, selection } of instances) {
      selection.forEach((car, i) => {
        const f = frameAt(car.s, angle);
        dummy.position.fromArray(bendPoint(car.x, 0.08, car.s, angle));
        dummy.rotation.set(-f.phi, car.direction < 0 ? Math.PI : 0, 0, 'XYZ');
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, 0);

  return { update, count: cars.length, moving: 6 };
}
