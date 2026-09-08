import * as THREE from 'three';

const CANOPY = ['#4f7f3a', '#5d8b43', '#6a9a4a', '#3f6f33', '#7a9a3f', '#5b7f45'];

/** Instanced trees: rows along boulevards, random fill in parks and woods. Chunked per cell so off-screen trees are culled; never planted in water. */
export function createTrees(data, sampleHeight, isBlocked, exclusions = []) {
  const city = data.city;
  const spots = [];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // water exclusion: inside a riverbank polygon, or within 5 m of a stream/river centreline
  const pip = (x, z, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; } return inside; };
  const areas = (city.water || []).filter((w) => w.kind === 'area').map((w) => {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of w.pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    return { pts: w.pts, minx, maxx, minz, maxz };
  });
  const WCELL = 30, wGrid = new Map();
  for (const w of city.water || []) {
    if (w.kind === 'area') continue;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i];
      for (let cx = Math.floor((Math.min(ax, bx) - 5) / WCELL); cx <= Math.floor((Math.max(ax, bx) + 5) / WCELL); cx++)
        for (let cz = Math.floor((Math.min(az, bz) - 5) / WCELL); cz <= Math.floor((Math.max(az, bz) + 5) / WCELL); cz++) {
          const k = `${cx},${cz}`; if (!wGrid.has(k)) wGrid.set(k, []); wGrid.get(k).push([ax, az, bx, bz]);
        }
    }
  }
  const inWater = (x, z) => {
    for (const a of areas) if (x > a.minx && x < a.maxx && z > a.minz && z < a.maxz && pip(x, z, a.pts)) return true;
    const segs = wGrid.get(`${Math.floor(x / WCELL)},${Math.floor(z / WCELL)}`);
    if (segs) for (const [ax, az, bx, bz] of segs) {
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const dx = ax + vx * t - x, dz = az + vz * t - z;
      if (dx * dx + dz * dz < 25) return true;
    }
    return false;
  };
  const excluded = (x, z) => { for (const [ex, ez, er] of exclusions) { const dx = x - ex, dz = z - ez; if (dx * dx + dz * dz < er * er) return true; } return false; };
  const bad = (x, z) => isBlocked(x, z) || inWater(x, z) || excluded(x, z);

  // boulevards: outside the pavement, every ~13 m, alternating sides
  for (const r of city.roads) {
    if (!r.line || r.bridge || !['primary', 'secondary', 'tertiary'].includes(r.type)) continue;
    const w = r.w || 8, sw = r.type === 'tertiary' ? 2.4 : 3.0, L = r.line;
    let acc = 5, side = 1;
    for (let i = 1; i < L.length; i++) {
      const [ax, , az] = L[i - 1], [bx, , bz] = L[i]; const seg = Math.hypot(bx - ax, bz - az); acc += seg;
      if (acc < 13) continue; acc = 0; side = r.oneway ? 1 : -side;
      const dx = (bx - ax) / (seg || 1), dz = (bz - az) / (seg || 1);
      const off = (w / 2 + sw + 1.6) * side, x = bx - dz * off, z = bz + dx * off;
      if (bad(x, z)) continue;
      spots.push({ x, z, s: rnd(0.8, 1.1) });
    }
  }
  // parks & woods
  for (const g of city.green) {
    const pts = g.pts; if (pts.length < 3) continue;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, a2 = 0;
    for (let i = 0; i < pts.length; i++) { const [x, z] = pts[i], [nx, nz] = pts[(i + 1) % pts.length]; a2 += x * nz - nx * z; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const area = Math.abs(a2) / 2; if (area < 300) continue;
    const forest = g.kind === 'forest' || g.kind === 'wood';
    if (g.kind === 'cemetery' || g.kind === 'grass' || g.kind === 'meadow') continue;
    const n = Math.min(forest ? 900 : 260, Math.floor(area / (forest ? 90 : 320)));
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const x = rnd(minx, maxx), z = rnd(minz, maxz);
      if (!pip(x, z, pts) || bad(x, z)) continue;
      if (Math.abs(x) > city.halfW - 30 || Math.abs(z) > city.halfD - 30) continue;
      spots.push({ x, z, s: rnd(forest ? 0.9 : 0.7, forest ? 1.5 : 1.2) }); k++;
    }
  }

  // chunk the spots per ~250 m cell → one trunk + one canopy InstancedMesh per cell, frustum-culled
  const group = new THREE.Group();
  const chunks = [];
  const CELL = 250, cells = new Map();
  for (const t of spots) { const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(t); }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6);
  const canopyGeo = new THREE.IcosahedronGeometry(2.3, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4530', roughness: 0.9 });
  const canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.9 }); // smooth-shaded → rounder crowns
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  for (const [, list] of cells) {
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, list.length);
    list.forEach((t, i) => {
      const y = sampleHeight(t.x, t.z), yaw = Math.random() * Math.PI * 2;
      q.setFromAxisAngle(up, yaw);
      m.compose(pos.set(t.x, y + 1.6 * t.s, t.z), q, scl.set(t.s, t.s, t.s)); trunk.setMatrixAt(i, m);
      m.compose(pos.set(t.x, y + (3.2 + 1.6) * t.s, t.z), q, scl.set(t.s * rnd(0.85, 1.15), t.s * rnd(0.9, 1.3), t.s * rnd(0.85, 1.15))); canopy.setMatrixAt(i, m);
      canopy.setColorAt(i, c.set(CANOPY[Math.floor(Math.random() * CANOPY.length)]));
    });
    trunk.computeBoundingSphere(); canopy.computeBoundingSphere();
    canopy.castShadow = true; canopy.receiveShadow = true; trunk.castShadow = true;
    trunk.userData.spots = list; trunk.userData.canopy = canopy; // for the in-game editor
    chunks.push(trunk);
    group.add(trunk, canopy);
  }
  console.log(`[trees] ${spots.length} trees in ${cells.size} chunks`);
  /** hide every tree within radius of (x,z) right now; returns how many were hidden */
  const hiddenM = new THREE.Matrix4().makeScale(0, 0, 0);
  function hideNear(x, z, radius) {
    let n = 0;
    for (const trunk of chunks) {
      const list = trunk.userData.spots, canopy = trunk.userData.canopy;
      let touched = false;
      list.forEach((t, i) => {
        if (t.hidden) return;
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz < radius * radius) { t.hidden = true; trunk.setMatrixAt(i, hiddenM); canopy.setMatrixAt(i, hiddenM); touched = true; n++; }
      });
      if (touched) { trunk.instanceMatrix.needsUpdate = true; canopy.instanceMatrix.needsUpdate = true; }
    }
    return n;
  }
  return { group, count: spots.length, hideNear };
}
