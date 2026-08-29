import * as THREE from 'three';

const CANOPY = ['#4f7f3a', '#5d8b43', '#6a9a4a', '#3f6f33', '#7a9a3f', '#5b7f45'];

/** Instanced low-poly trees: rows along boulevards, random fill in parks and woods. */
export function createTrees(data, sampleHeight, isBlocked) {
  const city = data.city;
  const spots = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
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
      if (isBlocked(x, z)) continue;
      spots.push({ x, z, s: rnd(0.8, 1.1) });
    }
  }
  // parks & woods
  const pip = (x, z, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; } return inside; };
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
      if (!pip(x, z, pts) || isBlocked(x, z)) continue;
      if (Math.abs(x) > city.halfW - 30 || Math.abs(z) > city.halfD - 30) continue;
      spots.push({ x, z, s: rnd(forest ? 0.9 : 0.7, forest ? 1.5 : 1.2) }); k++;
    }
  }
  const N = spots.length;
  const group = new THREE.Group();
  if (!N) return { group, count: 0 };
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#5a4530', roughness: 0.9 }), N);
  const canopyGeo = new THREE.IcosahedronGeometry(2.3, 1);
  const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  spots.forEach((t, i) => {
    const y = sampleHeight(t.x, t.z), yaw = Math.random() * Math.PI * 2;
    q.setFromAxisAngle(up, yaw);
    m.compose(pos.set(t.x, y + 1.6 * t.s, t.z), q, scl.set(t.s, t.s, t.s)); trunk.setMatrixAt(i, m);
    m.compose(pos.set(t.x, y + (3.2 + 1.6) * t.s, t.z), q, scl.set(t.s * rnd(0.85, 1.15), t.s * rnd(0.9, 1.3), t.s * rnd(0.85, 1.15))); canopy.setMatrixAt(i, m);
    canopy.setColorAt(i, c.set(CANOPY[Math.floor(Math.random() * CANOPY.length)]));
  });
  canopy.castShadow = true; canopy.receiveShadow = true; trunk.castShadow = true;
  canopy.frustumCulled = trunk.frustumCulled = false;
  group.add(trunk, canopy);
  console.log(`[trees] ${N} trees`);
  return { group, count: N };
}
