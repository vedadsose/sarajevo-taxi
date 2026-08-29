import * as THREE from 'three';

const COUNT = 380, NEAR = 260, FAR = 330;
const SHIRTS = ['#2b2f3a', '#7a1f1f', '#1f3d7a', '#e8e2d4', '#556b2f', '#3a3a3a', '#b04a2a', '#d9c7a0', '#4a2a5a', '#8a8f99', '#c33', '#2f6f6f'];
const PANTS = ['#1c1f2a', '#2a2e3a', '#3b3b3b', '#5a4a3a', '#6a7080', '#23324a'];
const SKIN = ['#f1c9a5', '#e0ac7e', '#c68b5b', '#f6d7bd', '#a86b45'];

/** Low-poly pedestrians walking the sidewalks near the player. Get hit → fall over, then respawn elsewhere. */
export function createPedestrians(scene, walks, player) {
  const group = new THREE.Group();
  // walk data: cumulative lengths + spatial index by start point
  const W = walks.map((pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    return { pts, cum, total: cum[cum.length - 1] };
  }).filter((w) => w.total > 6);
  const CELL = 120, grid = new Map();
  W.forEach((w, i) => { const p = w.pts[Math.floor(w.pts.length / 2)]; const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[2] / CELL)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const at = (w, s) => {
    s = Math.max(0, Math.min(w.total, s));
    let lo = 0, hi = w.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w.cum[m] <= s) lo = m; else hi = m; }
    const t = (s - w.cum[lo]) / ((w.cum[hi] - w.cum[lo]) || 1), a = w.pts[lo], b = w.pts[hi];
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, yaw: Math.atan2(b[0] - a[0], b[2] - a[2]) };
  };

  const torso = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), new THREE.MeshStandardMaterial({ roughness: 0.9 }), COUNT);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.8, 0.22), new THREE.MeshStandardMaterial({ roughness: 0.9 }), COUNT);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), COUNT);
  for (const m of [torso, legs, head]) { m.frustumCulled = false; m.castShadow = true; group.add(m); }

  const peds = [];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const c = new THREE.Color();
  function spawn(i, anywhere = false) {
    const px = player.x, pz = player.z;
    let cand = [];
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const l = grid.get(`${cx + dx},${cz + dz}`); if (l) cand.push(...l); }
    if (!cand.length) return false;
    let wi = pick(cand), tries = 0;
    // prefer spawning out of the immediate vicinity
    while (tries++ < 6 && !anywhere) { const p = W[wi].pts[0]; const d = Math.hypot(p[0] - px, p[2] - pz); if (d > 60) break; wi = pick(cand); }
    const w = W[wi];
    peds[i] = { w, s: Math.random() * w.total, dir: Math.random() < 0.5 ? 1 : -1, v: 1.1 + Math.random() * 0.7, phase: Math.random() * 6.28, state: 'walk', timer: 0, yaw: 0 };
    torso.setColorAt(i, c.set(pick(SHIRTS))); legs.setColorAt(i, c.set(pick(PANTS))); head.setColorAt(i, c.set(pick(SKIN)));
    return true;
  }
  for (let i = 0; i < COUNT; i++) if (!spawn(i, true)) peds[i] = null;
  torso.instanceColor.needsUpdate = legs.instanceColor.needsUpdate = head.instanceColor.needsUpdate = true;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qx = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  let hits = 0;
  function update(dt, carPos, carSpeedKmh) {
    for (let i = 0; i < COUNT; i++) {
      const p = peds[i];
      if (!p) { if (Math.random() < 0.02) spawn(i); torso.setMatrixAt(i, hidden); legs.setMatrixAt(i, hidden); head.setMatrixAt(i, hidden); continue; }
      let a = at(p.w, p.s);
      const dPlayer = Math.hypot(a.x - player.x, a.z - player.z);
      if (dPlayer > FAR) { spawn(i); continue; }
      if (p.state === 'walk') {
        p.s += p.v * p.dir * dt; p.phase += dt * 7;
        if (p.s <= 0 || p.s >= p.w.total) { p.dir *= -1; p.s = Math.max(0, Math.min(p.w.total, p.s)); }
        a = at(p.w, p.s);
        p.yaw = a.yaw + (p.dir < 0 ? Math.PI : 0);
        // hit by the taxi
        const dc = Math.hypot(a.x - carPos.x, a.z - carPos.z);
        if (dc < 1.7 && Math.abs(carSpeedKmh) > 6) { p.state = 'down'; p.timer = 7; hits++; }
        const bob = Math.abs(Math.sin(p.phase)) * 0.05;
        q.setFromAxisAngle(up, p.yaw);
        m.compose(pos.set(a.x, a.y + 1.05 + bob, a.z), q, one); torso.setMatrixAt(i, m);
        qx.setFromAxisAngle(xAxis, Math.sin(p.phase) * 0.35).premultiply(q);
        m.compose(pos.set(a.x, a.y + 0.42 + bob, a.z), qx, one); legs.setMatrixAt(i, m);
        m.compose(pos.set(a.x, a.y + 1.52 + bob, a.z), q, one); head.setMatrixAt(i, m);
      } else {
        p.timer -= dt;
        if (p.timer <= 0) { spawn(i); continue; }
        // lying flat on the pavement
        q.setFromAxisAngle(up, p.yaw); qx.setFromAxisAngle(xAxis, -Math.PI / 2).premultiply(q);
        m.compose(pos.set(a.x, a.y + 0.14, a.z), qx, one); torso.setMatrixAt(i, m);
        m.compose(pos.set(a.x - Math.sin(p.yaw) * 0.7, a.y + 0.12, a.z - Math.cos(p.yaw) * 0.7), qx, one); legs.setMatrixAt(i, m);
        m.compose(pos.set(a.x + Math.sin(p.yaw) * 0.45, a.y + 0.13, a.z + Math.cos(p.yaw) * 0.45), qx, one); head.setMatrixAt(i, m);
      }
    }
    torso.instanceMatrix.needsUpdate = legs.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true;
    torso.instanceColor.needsUpdate = legs.instanceColor.needsUpdate = head.instanceColor.needsUpdate = true;
  }
  console.log(`[peds] ${W.length} walkable runs, ${COUNT} pedestrians`);
  return { group, update, get hits() { return hits; } };
}
