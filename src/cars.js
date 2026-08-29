import * as THREE from 'three';
import { roadWidth } from './city.js';

const COUNT = 110, SPAWN_MIN = 90, SPAWN_MAX = 360, DESPAWN = 460;
const LIMIT = { motorway: 22, trunk: 20, primary: 15, secondary: 14, tertiary: 12.5, residential: 8.5, unclassified: 8.5, living_street: 5, primary_link: 11, secondary_link: 10, tertiary_link: 9, trunk_link: 12, motorway_link: 14 };
const COLORS = ['#c9c9c9', '#1f1f22', '#8f9aa6', '#5b6068', '#a41d1d', '#1d3f7a', '#e0dccf', '#2f5b3a', '#b8b8bc', '#6e1f5a', '#d8a020', '#ffffff', '#3a3a3a', '#7a1d1d'];
const ACCEL = 3.2, BRAKE = 6.5;

/** AI traffic: cars follow right-hand lanes along the OSM road graph, turn at junctions, queue behind each other and stop at red lights. */
export function createCars(RAPIER, world, scene, data, groundHeight, traffic, player) {
  // drive on the solved 3D centrelines: pts = [x,z] of the line, ys = its heights
  const roads = data.city.roads.map((r) => (r.line ? { ...r, pts: r.line.map((p) => [p[0], p[2]]), ys: r.line.map((p) => p[1]) } : r));
  const key = (p) => `${p[0]},${p[1]}`;
  const drivable = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
  // node graph: node key -> list of {r (road idx), i (point idx)}
  const nodes = new Map();
  roads.forEach((r, ri) => {
    if (!drivable.has(r.type) || r.type === 'footbridge') return;
    r.pts.forEach((p, i) => { const k = key(p); if (!nodes.has(k)) nodes.set(k, []); nodes.get(k).push({ r: ri, i }); });
  });
  // node -> junction (traffic light) if a signal sits on it
  const nodeJunction = new Map();
  for (const L of traffic.lights || []) {
    // find the nearest node within 6 m of the signal's road-side pole: use the light's junction and match by signal coords stored on light
  }
  for (const [x, z] of data.city.signals || []) {
    const j = traffic.junctions.find((J) => Math.hypot(J.x - x, J.z - z) < 36);
    if (j) nodeJunction.set(key([x, z]), j);
  }
  const rightOf = (dx, dz) => [-dz, dx]; // right-hand perpendicular for heading (dx,dz)

  // spatial index of roads for spawning (by point)
  const CELL = 150, rgrid = new Map();
  roads.forEach((r, ri) => {
    if (!drivable.has(r.type)) return;
    for (let i = 0; i < r.pts.length - 1; i++) { const k = `${Math.floor(r.pts[i][0] / CELL)},${Math.floor(r.pts[i][1] / CELL)}`; if (!rgrid.has(k)) rgrid.set(k, []); rgrid.get(k).push([ri, i]); }
  });

  // ---- rendering (instanced) ----
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1c2630', roughness: 0.15, metalness: 0.5 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 });
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.76, 0.55, 4.2), bodyMat, COUNT);
  const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.5, 2.1), glassMat, COUNT);
  const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.08, 1.9), bodyMat, COUNT);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10); wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [0, 1, 2, 3].map(() => new THREE.InstancedMesh(wheelGeo, wheelMat, COUNT));
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.14, 0.05), new THREE.MeshStandardMaterial({ color: '#fff7dc', emissive: '#fff0c0', emissiveIntensity: 1.2 }), COUNT);
  const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: '#7a0f0f', emissive: '#ff2a1a', emissiveIntensity: 1.2 }), COUNT);
  const all = [body, cabin, roof, ...wheels, head, tail];
  for (const m of all) { m.frustumCulled = false; group.add(m); }
  body.castShadow = cabin.castShadow = true;
  const wheelOff = [[0.8, 1.35], [-0.8, 1.35], [0.8, -1.35], [-0.8, -1.35]];

  const cars = [];
  const c = new THREE.Color();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qs = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  /** lane point for road r at point index i, travelling in direction dir, offset to the right */
  function lanePoint(r, i, dir) {
    const pts = r.pts, n = pts.length;
    const a = pts[Math.max(0, Math.min(n - 1, i - dir))], b = pts[Math.max(0, Math.min(n - 1, i + dir))];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const [rx, rz] = rightOf(dx, dz);
    const off = r.oneway ? 0 : roadWidth(r) / 4;
    const x = pts[i][0] + rx * off, z = pts[i][1] + rz * off;
    return { x, y: (r.ys ? r.ys[i] : data.sampleHeight(x, z)) + 0.1, z, node: key(pts[i]), limit: LIMIT[r.type] || 8 };
  }

  /** choose the next (road, index, dir) from a node; avoids U-turns unless dead end */
  function nextLeg(car) {
    const r = roads[car.r];
    const atEnd = (car.dir > 0 && car.i >= r.pts.length - 1) || (car.dir < 0 && car.i <= 0);
    const options = (nodes.get(key(r.pts[car.i])) || []).filter((o) => o.r !== car.r && drivable.has(roads[o.r].type));
    const cands = [];
    for (const o of options) {
      const rr = roads[o.r];
      if (o.i < rr.pts.length - 1) cands.push({ r: o.r, i: o.i, dir: 1 });
      if (o.i > 0 && !rr.oneway) cands.push({ r: o.r, i: o.i, dir: -1 });
    }
    const wantTurn = atEnd || Math.random() < 0.3;
    if (wantTurn && cands.length) {
      const pickd = pick(cands);
      car.r = pickd.r; car.i = pickd.i; car.dir = pickd.dir;
      return true;
    }
    if (!atEnd) return true; // continue straight along current road
    if (!r.oneway) { car.dir *= -1; return true; } // dead end: U-turn
    return false; // one-way dead end → respawn
  }

  function extendPath(car) {
    // append lane points until we have ≥ 60 m ahead
    let guard = 0;
    while (car.ahead < 60 && guard++ < 40) {
      const r = roads[car.r];
      const ni = car.i + car.dir;
      if (ni < 0 || ni >= r.pts.length) { if (!nextLeg(car)) { car.dead = true; return; } continue; }
      car.i = ni;
      const lp = lanePoint(r, car.i, car.dir);
      const last = car.path[car.path.length - 1];
      let d = last ? Math.hypot(lp.x - last.x, lp.z - last.z) : 0;
      // long straights: insert intermediate waypoints every ~14 m so steering and height stay tight
      if (last && d > 20) {
        const n = Math.ceil(d / 14);
        for (let k = 1; k < n; k++) {
          const t = k / n, x = last.x + (lp.x - last.x) * t, z = last.z + (lp.z - last.z) * t;
          const mid = { x, y: last.y + (lp.y - last.y) * t, z, node: null, limit: lp.limit, d: d / n };
          car.path.push(mid); car.ahead += d / n;
        }
        d = d / n;
      }
      lp.d = d; car.path.push(lp); car.ahead += d;
      // at intersections with other roads, maybe turn
      if ((nodes.get(lp.node) || []).length > 1 && !(car.i === 0 || car.i === r.pts.length - 1)) nextLeg(car);
    }
  }

  function spawn(idx) {
    const px = player.x, pz = player.z;
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    const cand = [];
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { const l = rgrid.get(`${cx + dx},${cz + dz}`); if (l) cand.push(...l); }
    if (!cand.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const [ri, i] = pick(cand); const r = roads[ri];
      const p = r.pts[i]; const d = Math.hypot(p[0] - px, p[1] - pz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      const dir = r.oneway ? 1 : Math.random() < 0.5 ? 1 : -1;
      const i0 = dir > 0 ? i : Math.min(r.pts.length - 1, i + 1);
      if (cars.some((o) => o && Math.hypot(o.x - p[0], o.z - p[1]) < 12)) continue;
      const lp = lanePoint(r, i0, dir);
      const car = { r: ri, i: i0, dir, path: [{ ...lp, d: 0 }], ahead: 0, x: lp.x, y: lp.y, z: lp.z, yaw: 0, v: 0, color: pick(COLORS), body: null };
      extendPath(car);
      if (car.dead || car.path.length < 2) continue;
      car.yaw = Math.atan2(car.path[1].x - car.x, car.path[1].z - car.z);
      return car;
    }
    return null;
  }

  for (let i = 0; i < COUNT; i++) {
    const car = spawn(i);
    if (car) {
      car.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(car.x, car.y, car.z));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.88, 0.6, 2.1).setTranslation(0, 0.7, 0), car.body);
    }
    cars.push(car);
    body.setColorAt(i, c.set(car ? car.color : '#000')); roof.setColorAt(i, c);
  }
  body.instanceColor.needsUpdate = roof.instanceColor.needsUpdate = true;

  // per-frame spatial hash of cars for following behaviour
  const HG = new Map(), HC = 25;
  function rebuildHash() { HG.clear(); for (const car of cars) { if (!car) continue; const k = `${Math.floor(car.x / HC)},${Math.floor(car.z / HC)}`; if (!HG.has(k)) HG.set(k, []); HG.get(k).push(car); } }
  function obstacleAhead(car, fx, fz, playerPos, playerV) {
    let best = Infinity, bestV = 0;
    const cx = Math.floor(car.x / HC), cz = Math.floor(car.z / HC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = HG.get(`${cx + dx},${cz + dz}`); if (!l) continue;
      for (const o of l) {
        if (o === car) continue;
        const ox = o.x - car.x, oz = o.z - car.z, along = ox * fx + oz * fz, lat = Math.abs(ox * fz - oz * fx);
        if (along > 0 && along < 22 && lat < 2.3 && along < best) { best = along; bestV = o.v; }
      }
    }
    const ox = playerPos.x - car.x, oz = playerPos.z - car.z, along = ox * fx + oz * fz, lat = Math.abs(ox * fz - oz * fx);
    if (along > -1 && along < 22 && lat < 2.6 && along < best) { best = along; bestV = Math.max(0, playerV); }
    return { dist: best, v: bestV };
  }

  function update(dt, playerPos, playerV) {
    rebuildHash();
    for (let idx = 0; idx < COUNT; idx++) {
      let car = cars[idx];
      if (car && (car.dead || Math.hypot(car.x - playerPos.x, car.z - playerPos.z) > DESPAWN)) {
        if (car.body) world.removeRigidBody(car.body);
        car = cars[idx] = null;
      }
      if (!car) {
        if (Math.random() < 0.05) {
          car = spawn(idx);
          if (car) {
            car.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(car.x, car.y, car.z));
            world.createCollider(RAPIER.ColliderDesc.cuboid(0.88, 0.6, 2.1).setTranslation(0, 0.7, 0), car.body);
            cars[idx] = car; body.setColorAt(idx, c.set(car.color)); roof.setColorAt(idx, c); body.instanceColor.needsUpdate = roof.instanceColor.needsUpdate = true;
          }
        }
        if (!car) { for (const mm of all) mm.setMatrixAt(idx, hidden); continue; }
      }
      // ---- steering along path ----
      let tgt = car.path[1];
      if (!tgt) { extendPath(car); tgt = car.path[1]; if (!tgt) { car.dead = true; continue; } }
      let dx = tgt.x - car.x, dz = tgt.z - car.z, dist = Math.hypot(dx, dz);
      // advance when close OR when we've driven past the waypoint (projection onto the next leg is behind us)
      const passed = () => { const nx = car.path[2]; if (!nx) return false; const lx = nx.x - tgt.x, lz = nx.z - tgt.z; return ((car.x - tgt.x) * lx + (car.z - tgt.z) * lz) > 0; };
      while (car.path.length > 2 && (dist < 2.0 || passed())) { car.ahead -= car.path[1].d; car.path.shift(); tgt = car.path[1]; dx = tgt.x - car.x; dz = tgt.z - car.z; dist = Math.hypot(dx, dz); }
      if (car.ahead < 60) extendPath(car);
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      // desired speed
      let target = tgt.limit;
      // slow for upcoming turns
      if (car.path[2]) {
        const a = Math.atan2(car.path[2].x - tgt.x, car.path[2].z - tgt.z), diff = Math.abs(((a - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff > 0.4 && dist < 14) target = Math.min(target, 3.5 + (dist / 14) * 6);
      }
      // traffic lights: next signalled node on path
      let acc = 0;
      for (let k = 1; k < car.path.length && acc < 40; k++) {
        acc += k === 1 ? dist : car.path[k].d;
        const j = car.path[k].node ? nodeJunction.get(car.path[k].node) : null;
        if (j) {
          const st = traffic.stateFor(j, car.yaw);
          if (st !== 2 && acc > 2.5) { const stopAt = Math.max(0, acc - 6); target = Math.min(target, stopAt < 1 ? 0 : Math.sqrt(2 * BRAKE * stopAt) * 0.8); }
          break;
        }
      }
      // following / player
      const ob = obstacleAhead(car, fx, fz, playerPos, playerV);
      if (ob.dist < 22) { const gap = ob.dist - 6; target = Math.min(target, gap <= 0 ? 0 : Math.min(ob.v + gap * 0.6, Math.sqrt(2 * BRAKE * gap) * 0.9)); }
      // integrate
      if (car.v < target) car.v = Math.min(target, car.v + ACCEL * dt); else car.v = Math.max(target, car.v - BRAKE * dt);
      const wantYaw = Math.atan2(dx, dz);
      let dy = ((wantYaw - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      car.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, dy));
      const step = car.v * dt;
      car.x += Math.sin(car.yaw) * step; car.z += Math.cos(car.yaw) * step;
      const ty = tgt.y; car.y += (ty - car.y) * Math.min(1, dt * 6);
      car.wheel = (car.wheel || 0) + step / 0.32;
      // physics + instances
      q.setFromAxisAngle(up, car.yaw);
      car.body.setNextKinematicTranslation({ x: car.x, y: car.y, z: car.z });
      car.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      const px = car.x, py = car.y, pz = car.z, sx = Math.sin(car.yaw), cz2 = Math.cos(car.yaw);
      m.compose(pos.set(px, py + 0.62, pz), q, one); body.setMatrixAt(idx, m);
      m.compose(pos.set(px - sx * 0.25, py + 1.12, pz - cz2 * 0.25), q, one); cabin.setMatrixAt(idx, m);
      m.compose(pos.set(px - sx * 0.25, py + 1.4, pz - cz2 * 0.25), q, one); roof.setMatrixAt(idx, m);
      qs.setFromAxisAngle(new THREE.Vector3(1, 0, 0), car.wheel).premultiply(q);
      wheelOff.forEach(([ox, oz], k) => { const wx = px + cz2 * ox + sx * oz, wz = pz - sx * ox + cz2 * oz; m.compose(pos.set(wx, py + 0.32, wz), qs, one); wheels[k].setMatrixAt(idx, m); });
      m.compose(pos.set(px + sx * 2.1, py + 0.7, pz + cz2 * 2.1), q, one); head.setMatrixAt(idx, m);
      m.compose(pos.set(px - sx * 2.1, py + 0.7, pz - cz2 * 2.1), q, one); tail.setMatrixAt(idx, m);
    }
    for (const mm of all) mm.instanceMatrix.needsUpdate = true;
  }
  console.log(`[cars] ${cars.filter(Boolean).length} AI cars spawned, ${nodeJunction.size} signalled nodes`);
  return { group, update, cars };
}
