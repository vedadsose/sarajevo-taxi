import * as THREE from 'three';
import { roadWidth } from './city.js';

const ROAD_W = { motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6, living_street: 5.5, service: 4, pedestrian: 5 };
const CYCLE = 14, GREEN = 6, AMBER = 1.5; // seconds; red fills the rest

/** Traffic lights at OSM traffic_signals nodes. Cross-streets at one junction run on opposite phases. */
export function createTrafficLights(data, groundHeight) {
  const city = data.city;
  const signals = city.signals || [];
  const group = new THREE.Group();
  if (!signals.length) return { group, update() {}, junctions: [], stateFor: () => 2, lights: [] };

  // nearest road segment to a point
  const segs = [];
  for (const r of city.roads) {
    if (r.type === 'footbridge' || r.type === 'pedestrian') continue;
    const w = roadWidth(r);
    for (let i = 1; i < r.pts.length; i++) segs.push([r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1], w]);
  }
  function nearestSeg(x, z) {
    let best = Infinity, hit = null, ht = 0;
    for (const s of segs) {
      const [ax, az, bx, bz] = s;
      if (Math.abs(ax - x) > 60 && Math.abs(bx - x) > 60) continue;
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const d = (ax + vx * t - x) ** 2 + (az + vz * t - z) ** 2;
      if (d < best) { best = d; hit = s; ht = t; }
    }
    return hit;
  }

  // group into junctions (within 35 m) → shared phase; split by road axis
  const lights = [];
  const junctions = [];
  for (const [x, z] of signals) {
    const s = nearestSeg(x, z);
    if (!s) continue;
    let dx = s[2] - s[0], dz = s[3] - s[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let j = junctions.find((J) => Math.hypot(J.x - x, J.z - z) < 35);
    if (!j) { j = { x, z, phase: Math.random() * CYCLE, axis: Math.atan2(dz, dx) }; junctions.push(j); }
    // angle between this road and the junction's primary axis, folded to [0, 90]
    let da = Math.abs(Math.atan2(dz, dx) - j.axis) % Math.PI; if (da > Math.PI / 2) da = Math.PI - da;
    const cross = da > Math.PI / 4;
    const px = x + dz * (s[4] / 2 + 1.3), pz = z - dx * (s[4] / 2 + 1.3); // on the right-hand sidewalk
    lights.push({ x: px, z: pz, y: groundHeight(px, pz), yaw: Math.atan2(dx, dz), j, cross });
  }
  const n = lights.length;

  const dark = new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.7, metalness: 0.4 });
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8), dark, n);
  const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 1.0, 0.3), dark, n);
  const lampGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const lamps = [0, 1, 2].map(() => new THREE.InstancedMesh(lampGeo, lampMat, n));
  const ON = [new THREE.Color('#ff2a1f'), new THREE.Color('#ffb020'), new THREE.Color('#2dff5a')];
  const OFF = [new THREE.Color('#3a1210'), new THREE.Color('#3a2a10'), new THREE.Color('#0f2a15')];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  lights.forEach((L, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.yaw);
    m.compose(pos.set(L.x, L.y + 2.1, L.z), q, scl); pole.setMatrixAt(i, m);
    m.compose(pos.set(L.x, L.y + 3.7, L.z), q, scl); housing.setMatrixAt(i, m);
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw); // lamps face oncoming traffic (backwards along the road)
    [4.02, 3.7, 3.38].forEach((h, k) => { m.compose(pos.set(L.x - fx * 0.17, L.y + h, L.z - fz * 0.17), q, scl); lamps[k].setMatrixAt(i, m); lamps[k].setColorAt(i, OFF[k]); });
  });
  pole.castShadow = housing.castShadow = true;
  group.add(pole, housing, ...lamps);

  const state = new Int8Array(n).fill(-1);
  let now = 0;
  /** Light state for a vehicle at heading `yaw` (radians, atan2(dx,dz)) near junction j: 2 green, 1 amber, 0 red. */
  function stateFor(j, yaw) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    let da = Math.abs(Math.atan2(dz, dx) - j.axis) % Math.PI; if (da > Math.PI / 2) da = Math.PI - da;
    const cross = da > Math.PI / 4;
    const ph = (now + j.phase + (cross ? CYCLE / 2 : 0)) % CYCLE;
    return ph < GREEN ? 2 : ph < GREEN + AMBER ? 1 : 0;
  }
  function update(t) {
    now = t;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      let ph = (t + L.j.phase + (L.cross ? CYCLE / 2 : 0)) % CYCLE;
      const s = ph < GREEN ? 2 : ph < GREEN + AMBER ? 1 : 0;
      if (s !== state[i]) { state[i] = s; changed = true; for (let k = 0; k < 3; k++) lamps[k].setColorAt(i, k === s ? ON[k] : OFF[k]); }
    }
    if (changed) for (const l of lamps) l.instanceColor.needsUpdate = true;
  }
  console.log(`[traffic] ${n} traffic lights at ${junctions.length} junctions`);
  return { group, update, junctions, stateFor, lights };
}
