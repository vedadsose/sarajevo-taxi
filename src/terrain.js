import * as THREE from 'three';

// Deterministic noise for colour variety
const hash = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function createTerrain(RAPIER, world, data) {
  const { cols, rows, step, originX, originZ, heights } = data.terrain;
  const sizeX = (cols - 1) * step, sizeZ = (rows - 1) * step;
  const cx = originX + sizeX / 2, cz = originZ + sizeZ / 2;

  // --- Physics heightfield. Try the documented layout (rows→z, cols→x, column-major)
  // and verify against known grid heights; fall back to the transposed layout if wrong.
  const ray = new RAPIER.Ray({ x: 0, y: 3000, z: 0 }, { x: 0, y: -1, z: 0 });
  function groundHeight(x, z) {
    ray.origin.x = x; ray.origin.z = z;
    const hit = world.castRay(ray, 6000, true);
    return hit ? 3000 - (hit.timeOfImpact ?? hit.toi) : data.sampleHeight(x, z);
  }
  function buildCollider(transposed) {
    const hf = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const idx = transposed ? c + r * cols : r + c * rows;
        hf[idx] = heights[r * cols + c];
      }
    const desc = transposed
      ? RAPIER.ColliderDesc.heightfield(cols - 1, rows - 1, hf, { x: sizeX, y: 1, z: sizeZ })
      : RAPIER.ColliderDesc.heightfield(rows - 1, cols - 1, hf, { x: sizeX, y: 1, z: sizeZ });
    desc.setTranslation(cx, 0, cz).setFriction(1.0);
    return world.createCollider(desc);
  }
  function maxVertexError() {
    let err = 0;
    for (let i = 0; i < 60; i++) {
      const r = 1 + Math.floor(hash(i, 3) * (rows - 2)), c = 1 + Math.floor(hash(i, 7) * (cols - 2));
      const g = groundHeight(originX + c * step, originZ + r * step);
      err = Math.max(err, Math.abs(g - heights[r * cols + c]));
    }
    return err;
  }
  let collider = buildCollider(false);
  let err = maxVertexError();
  if (err > 0.5) {
    console.warn(`[terrain] heightfield layout mismatch (err ${err.toFixed(2)}m), using transposed layout`);
    world.removeCollider(collider, false);
    collider = buildCollider(true);
    err = maxVertexError();
  }
  console.log(`[terrain] heightfield vertex error ${err.toFixed(3)}m`);

  // --- Detect which diagonal Rapier uses per cell so the visual mesh matches the collider.
  // Sample inside each cell at (u=.25,v=.5): diag A (p00-p11) → tri {p00,p10,p11}; diag B (p10-p01) → tri {p00,p10,p01}.
  const tally = [[0, 0], [0, 0]]; // [parity][A|B]
  for (let i = 0; i < 300; i++) {
    const r = Math.floor(hash(i, 11) * (rows - 1)), c = Math.floor(hash(i, 13) * (cols - 1));
    const h00 = heights[r * cols + c], h01 = heights[r * cols + c + 1];
    const h10 = heights[(r + 1) * cols + c], h11 = heights[(r + 1) * cols + c + 1];
    const u = 0.25, v = 0.5;
    const hA = h00 + (h10 - h00) * v + (h11 - h10) * u;
    const hB = h00 + (h01 - h00) * u + (h10 - h00) * v;
    if (Math.abs(hA - hB) < 0.05) continue;
    const g = groundHeight(originX + (c + u) * step, originZ + (r + v) * step);
    tally[(r + c) & 1][Math.abs(g - hA) < Math.abs(g - hB) ? 0 : 1]++;
  }
  const diagA = (r, c) => tally[(r + c) & 1][0] >= tally[(r + c) & 1][1];
  console.log(`[terrain] diagonal tally even A/B ${tally[0]}, odd A/B ${tally[1]}`);

  // --- Visual mesh
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  const cLow = new THREE.Color('#9aa383'), cMid = new THREE.Color('#6f8a4e'), cHigh = new THREE.Color('#4b6a3c');
  const cRock = new THREE.Color('#8a7d6e'), cPark = new THREE.Color('#5f944a'), cForest = new THREE.Color('#3d6534');
  const cGrave = new THREE.Color('#7f9a6c');
  const tmp = new THREE.Color();
  const { minH } = data.terrain;

  // Paint green areas into a lookup grid first
  const paint = new Uint8Array(cols * rows); // 0 none, 1 park/grass, 2 forest, 3 cemetery
  for (const g of data.city.green) {
    const pts = g.pts;
    if (pts.length < 3) continue;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const c0 = Math.max(0, Math.floor((minx - originX) / step)), c1 = Math.min(cols - 1, Math.ceil((maxx - originX) / step));
    const r0 = Math.max(0, Math.floor((minz - originZ) / step)), r1 = Math.min(rows - 1, Math.ceil((maxz - originZ) / step));
    const kind = g.kind === 'forest' || g.kind === 'wood' ? 2 : g.kind === 'cemetery' ? 3 : 1;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (pointInPoly(originX + c * step, originZ + r * step, pts)) paint[r * cols + c] = kind;
  }

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c, h = heights[i];
      const x = originX + c * step, z = originZ + r * step;
      pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
      // slope
      const hx = heights[r * cols + Math.min(cols - 1, c + 1)] - heights[r * cols + Math.max(0, c - 1)];
      const hz = heights[Math.min(rows - 1, r + 1) * cols + c] - heights[Math.max(0, r - 1) * cols + c];
      const slope = Math.hypot(hx, hz) / (2 * step);
      const t = Math.min(1, (h - minH) / 350);
      if (t < 0.25) tmp.copy(cLow).lerp(cMid, t / 0.25); else tmp.copy(cMid).lerp(cHigh, (t - 0.25) / 0.75);
      if (slope > 0.45) tmp.lerp(cRock, Math.min(1, (slope - 0.45) * 2));
      const p = paint[i];
      if (p === 1) tmp.copy(cPark); else if (p === 2) tmp.copy(cForest); else if (p === 3) tmp.copy(cGrave);
      const n = 0.92 + hash(c, r) * 0.16;
      col[i * 3] = tmp.r * n; col[i * 3 + 1] = tmp.g * n; col[i * 3 + 2] = tmp.b * n;
    }
  let k = 0;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const i00 = r * cols + c, i01 = i00 + 1, i10 = i00 + cols, i11 = i10 + 1;
      if (diagA(r, c)) { index[k++] = i00; index[k++] = i10; index[k++] = i11; index[k++] = i00; index[k++] = i11; index[k++] = i01; }
      else { index[k++] = i00; index[k++] = i10; index[k++] = i01; index[k++] = i10; index[k++] = i11; index[k++] = i01; }
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = new Float32Array(cols * rows * 2);
  for (let i = 0; i < cols * rows; i++) { uv[i * 2] = pos[i * 3] / 9; uv[i * 2 + 1] = pos[i * 3 + 2] / 9; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  // ground texture: soft grass/earth noise (multiplies the vertex colours)
  const tc = document.createElement('canvas'); tc.width = tc.height = 256;
  const g2 = tc.getContext('2d'); g2.fillStyle = '#c9c9c9'; g2.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 150 + Math.floor(Math.random() * 105); g2.fillStyle = `rgba(${v},${v},${v},0.55)`; const r = 1 + Math.random() * 3; g2.fillRect(Math.random() * 256, Math.random() * 256, r, r * (0.6 + Math.random())); }
  for (let i = 0; i < 600; i++) { g2.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.1})`; g2.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1 + Math.random() * 2); }
  const groundTex = new THREE.CanvasTexture(tc); groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, groundHeight, collider };
}
