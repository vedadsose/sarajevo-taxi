import * as THREE from 'three';

const SPEED = 9.5, ACCEL = 1.1, STOP_EVERY = 420, STOP_TIME = 6, CAR_LEN = 10.5, CAR_GAP = 0.9;

/** Build tram routes from OSM tram ways and run articulated trams along them. */
export function createTrams(RAPIER, world, scene, data, groundHeight) {
  const ways = data.city.tram;
  const key = (p) => `${p[0]},${p[1]}`;
  // graph
  const adj = new Map(), coord = new Map();
  const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const edges = new Set();
  for (const w of ways) for (let i = 1; i < w.length; i++) {
    const a = key(w[i - 1]), b = key(w[i]);
    if (a === b) continue;
    coord.set(a, w[i - 1]); coord.set(b, w[i]);
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a); edges.add(edgeKey(a, b));
  }
  // walk routes: start at termini (degree 1), follow the straightest unvisited edge
  const visited = new Set(), routes = [];
  const walk = (start) => {
    const path = [start]; let cur = start, prev = null;
    for (;;) {
      const pc = coord.get(cur); let best = null, bestScore = -Infinity;
      for (const nb of adj.get(cur)) {
        if (visited.has(edgeKey(cur, nb))) continue;
        let score = 0;
        if (prev) { const pp = coord.get(prev), nc = coord.get(nb); const d1x = pc[0] - pp[0], d1z = pc[1] - pp[1], d2x = nc[0] - pc[0], d2z = nc[1] - pc[1]; score = (d1x * d2x + d1z * d2z) / ((Math.hypot(d1x, d1z) * Math.hypot(d2x, d2z)) || 1); }
        if (score > bestScore) { bestScore = score; best = nb; }
      }
      if (!best) break;
      visited.add(edgeKey(cur, best)); path.push(best); prev = cur; cur = best;
    }
    return path;
  };
  const starts = [...adj.keys()].filter((k) => adj.get(k).size === 1);
  for (const st of starts) { const p = walk(st); if (p.length > 2) routes.push(p); }
  for (const k of adj.keys()) { if ([...adj.get(k)].some((nb) => !visited.has(edgeKey(k, nb)))) { const p = walk(k); if (p.length > 2) routes.push(p); } }

  const group = new THREE.Group();
  const trams = [];
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ece7dc', roughness: 0.5, metalness: 0.2 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: '#b3251c', roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1e2a36', roughness: 0.15, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.9 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff4cc', emissive: '#ffe9a0', emissiveIntensity: 2 });
  function makeCar(withPanto) {
    const g = new THREE.Group();
    const box = (w, h, d, m, x, y, z) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mm.position.set(x, y, z); mm.castShadow = true; g.add(mm); return mm; };
    box(2.3, 1.1, CAR_LEN, bodyMat, 0, 1.15, 0);           // lower body
    box(2.32, 0.22, CAR_LEN, stripeMat, 0, 1.45, 0);       // red stripe
    box(2.3, 0.9, CAR_LEN - 0.4, glassMat, 0, 2.15, 0);    // window band
    box(2.2, 0.5, CAR_LEN, bodyMat, 0, 2.85, 0);           // roof
    box(2.0, 0.5, CAR_LEN - 1, darkMat, 0, 0.35, 0);       // skirt / bogies
    if (withPanto) { box(0.1, 0.9, 0.1, darkMat, -0.5, 3.5, -1.5); box(0.1, 0.9, 0.1, darkMat, 0.5, 3.5, -1.5); box(1.4, 0.06, 0.4, darkMat, 0, 3.95, -1.5); }
    box(0.5, 0.25, 0.05, lampMat, 0.7, 1.0, CAR_LEN / 2 + 0.01); box(0.5, 0.25, 0.05, lampMat, -0.7, 1.0, CAR_LEN / 2 + 0.01);
    return g;
  }

  // Phase 1: build all route geometry (heights) before any tram collider exists
  const built = [];
  // grid of all densified track points (for the parallel-track side test)
  const TG = new Map(), TC = 8, routeVotes = [];
  for (const w of ways) for (let i = 1; i < w.length; i++) {
    const [ax, az] = w[i - 1], [bx, bz] = w[i]; const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 1.5));
    for (let k = 0; k <= n; k++) { const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n; const kk = `${Math.floor(x / TC)},${Math.floor(z / TC)}`; if (!TG.has(kk)) TG.set(kk, []); TG.get(kk).push([x, z]); }
  }
  const nearTrack = (x, z) => { const out = []; const cx = Math.floor(x / TC), cz = Math.floor(z / TC); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const l = TG.get(`${cx + dx},${cz + dz}`); if (l) out.push(...l); } return out; };
  const HW = data.city.halfW - 60, HD = data.city.halfD - 60;
  const inside = ([x, z]) => Math.abs(x) < HW && Math.abs(z) < HD;
  for (const path of routes) {
    // densify + heights
    let pts = [];
    for (let i = 0; i < path.length; i++) {
      const [x, z] = coord.get(path[i]);
      if (i > 0) { const [px, pz] = coord.get(path[i - 1]); const d = Math.hypot(x - px, z - pz), n = Math.max(1, Math.ceil(d / 3)); for (let k = 1; k <= n; k++) pts.push([px + ((x - px) * k) / n, pz + ((z - pz) * k) / n]); }
      else pts.push([x, z]);
    }
    // keep the longest run of points inside the map (track continues beyond the loaded area)
    let bestRun = [], run = [];
    for (const p of pts) { if (inside(p)) run.push(p); else { if (run.length > bestRun.length) bestRun = run; run = []; } }
    if (run.length > bestRun.length) bestRun = run;
    pts = bestRun;
    if (pts.length < 20) continue;
    // Right-hand running: the parallel track should be on our LEFT. Vote over the route; reverse if it's on the right.
    let left = 0, right = 0;
    for (let i = 5; i < pts.length - 5; i += 4) {
      const [x, z] = pts[i]; const [px, pz] = pts[i - 3], [nx, nz] = pts[i + 3];
      let tx = nx - px, tz = nz - pz; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      for (const o of nearTrack(x, z)) {
        const dx = o[0] - x, dz = o[1] - z;
        const along = dx * tx + dz * tz, perp = dx * tz - dz * tx; // perp > 0 → left of travel (y-up, x east, z south)
        if (Math.abs(along) < 1.5 && Math.abs(perp) > 2 && Math.abs(perp) < 7) { if (perp > 0) left++; else right++; }
      }
    }
    if (right > left) pts.reverse();
    routeVotes.push({ left, right, reversed: right > left });
    const ys = pts.map(([x, z]) => groundHeight(x, z) + 0.4);
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < ys.length - 1; i++) ys[i] = (ys[i - 1] + ys[i] + ys[i + 1]) / 3;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total < 500) continue;
    const at = (s) => {
      s = Math.max(0, Math.min(total, s));
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
      const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
      const x = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, z = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t, y = ys[lo] + (ys[hi] - ys[lo]) * t;
      const yaw = Math.atan2(pts[hi][0] - pts[lo][0], pts[hi][1] - pts[lo][1]);
      return { x, y, z, yaw };
    };
    built.push({ at, total });
  }
  // Phase 2: spawn trams
  for (const { at, total } of built) {
    const count = Math.max(1, Math.round(total / 900));
    for (let i = 0; i < count; i++) {
      const cars = [0, 1].map((k) => {
        const mesh = makeCar(k === 0); group.add(mesh);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        world.createCollider(RAPIER.ColliderDesc.cuboid(1.15, 1.6, CAR_LEN / 2).setTranslation(0, 1.7, 0), body);
        return { mesh, body };
      });
      const s0 = (total / count) * i + 30;
      trams.push({ at, total, s: s0, dir: 1, v: 0, cars, nextStop: s0 + STOP_EVERY, wait: 0 });
    }
  }
  console.log(`[trams] ${routes.length} routes, ${trams.length} trams; direction votes`, routeVotes.map((v) => `${v.left}L/${v.right}R${v.reversed ? ' rev' : ''}`).join(', '));

  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  function placeCar(car, s, tr) {
    const p = tr.at(s);
    car.mesh.position.set(p.x, p.y, p.z);
    q.setFromAxisAngle(up, p.yaw + (tr.dir < 0 ? Math.PI : 0));
    car.mesh.quaternion.copy(q);
    car.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    car.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  function update(dt) {
    for (const tr of trams) {
      if (tr.wait > 0) { tr.wait -= dt; tr.v = 0; }
      else {
        const toStop = Math.abs(tr.nextStop - tr.s), toEnd = tr.dir > 0 ? tr.total - tr.s : tr.s;
        const brakeDist = (tr.v * tr.v) / (2 * ACCEL);
        const target = Math.min(toStop, toEnd) <= brakeDist + 0.5 ? 0 : SPEED;
        tr.v += Math.sign(target - tr.v) * ACCEL * dt; tr.v = Math.max(0, Math.min(SPEED, tr.v));
        tr.s += tr.v * tr.dir * dt;
        if (toEnd <= 0.6 && tr.v < 0.2) { tr.s = 12; tr.wait = STOP_TIME; tr.nextStop = tr.s + STOP_EVERY; } // end of line: reappear at the start
        else if (toStop <= 0.6 && tr.v < 0.2) { tr.wait = STOP_TIME; tr.nextStop = tr.s + STOP_EVERY; }
      }
      const half = (CAR_LEN + CAR_GAP) / 2;
      placeCar(tr.cars[0], tr.s + half * tr.dir, tr);
      placeCar(tr.cars[1], tr.s - half * tr.dir, tr);
    }
  }
  return { group, update, trams };
}
