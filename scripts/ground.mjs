// Ground pipeline: smooth valley floor, global road elevation solve, terrain conforming to roads, river channel.
export function makeSampler(t) {
  const { cols, rows, step, originX, originZ, heights } = t;
  return (x, z) => {
    let fx = (x - originX) / step, fz = (z - originZ) / step;
    fx = Math.max(0, Math.min(cols - 1.0001, fx)); fz = Math.max(0, Math.min(rows - 1.0001, fz));
    const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
    return (heights[r * cols + c] * (1 - u) + heights[r * cols + c + 1] * u) * (1 - v) + (heights[(r + 1) * cols + c] * (1 - u) + heights[(r + 1) * cols + c + 1] * u) * v;
  };
}

/** Separable box blur (repeated → ~Gaussian) on a grid, radius in cells. */
function blur(src, cols, rows, radius, passes = 3) {
  let a = new Float32Array(src), b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < rows; r++) { // horizontal
      let s = 0, n = 0;
      for (let c = -radius; c <= radius; c++) { const cc = Math.min(cols - 1, Math.max(0, c)); s += a[r * cols + cc]; n++; }
      for (let c = 0; c < cols; c++) {
        b[r * cols + c] = s / n;
        const out = Math.min(cols - 1, Math.max(0, c - radius)), inn = Math.min(cols - 1, Math.max(0, c + radius + 1));
        s += a[r * cols + inn] - a[r * cols + out];
      }
    }
    for (let c = 0; c < cols; c++) { // vertical
      let s = 0, n = 0;
      for (let r = -radius; r <= radius; r++) { const rr = Math.min(rows - 1, Math.max(0, r)); s += b[rr * cols + c]; n++; }
      for (let r = 0; r < rows; r++) {
        a[r * cols + c] = s / n;
        const out = Math.min(rows - 1, Math.max(0, r - radius)), inn = Math.min(rows - 1, Math.max(0, r + radius + 1));
        s += b[inn * cols + c] - b[out * cols + c];
      }
    }
  }
  return a;
}

/** Valley floor: where the (smoothed) slope is gentle, replace the DEM with a heavily blurred version. Hills keep detail. */
export function smoothValley(terrain) {
  const { cols, rows, step, heights } = terrain;
  const wide = blur(heights, cols, rows, Math.round(45 / step), 3);   // ~90 m
  const light = blur(heights, cols, rows, Math.round(6 / step), 2);   // ~12 m
  const slopeRef = blur(heights, cols, rows, Math.round(20 / step), 2);
  let nFlat = 0;
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const sx = (slopeRef[i + 1] - slopeRef[i - 1]) / (2 * step), sz = (slopeRef[i + cols] - slopeRef[i - cols]) / (2 * step);
      const slope = Math.hypot(sx, sz);
      const t = 1 - Math.min(1, Math.max(0, (slope - 0.03) / 0.05)); // 1 = flat (<3%), 0 = hillside (>8%)
      heights[i] = light[i] * (1 - t) + wide[i] * t;
      if (t > 0.5) nFlat++;
    }
  console.log(`ground: valley floor smoothed on ${nFlat} vertices (${Math.round((100 * nFlat) / heights.length)}% of map)`);
}

/** Chaikin corner cutting that keeps the endpoints (junction nodes) fixed. */
function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) return p;
    // Chaikin: for each edge emit the 3/4–1/4 and 1/4–3/4 points, keep the ends
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (i > 0) q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i < p.length - 2) q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

/**
 * Global road elevation solve. Every road becomes a dense 3D centreline (≈6 m samples).
 * Minimises  Σ w_d (h − ground)²  +  Σ w_c (h″)²  with shared unknowns at junction nodes,
 * so profiles are smooth AND agree wherever roads meet. Bridge samples have no ground term
 * (free spans), so decks become straight chords between their approaches.
 */
export function solveRoadProfiles(roads, sampleH, opts = {}) {
  const SP = opts.spacing || 6, WC = opts.curvature || 60, ITER = opts.iterations || 3000;
  const nodeIdx = new Map(); // "x,z" -> unknown index
  const G = [], W = [], H = []; // ground, data weight, height per unknown
  const chains = []; // per road: array of unknown indices along the (smoothed) centreline
  const lines = [];  // per road: [x,z] per sample
  const nodeKey = (p) => `${p[0]},${p[1]}`;
  const unknown = (g, w) => { G.push(g); W.push(w); H.push(g); return G.length - 1; };

  // junction vertices (shared by ≥2 roads) must stay fixed when smoothing
  const nodeCount = new Map();
  for (const r of roads) for (const p of r.pts) { const k = nodeKey(p); nodeCount.set(k, (nodeCount.get(k) || 0) + 1); }
  const smoothKeepingJunctions = (pts) => {
    const out = []; let piece = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      piece.push(pts[i]);
      const isJ = nodeCount.get(nodeKey(pts[i])) > 1 || i === pts.length - 1;
      if (isJ) { const sm = piece.length > 2 ? chaikin(piece, 2) : piece; for (let k = out.length ? 1 : 0; k < sm.length; k++) out.push(sm[k]); piece = [pts[i]]; }
    }
    return out;
  };
  const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
  const chainWeight = []; // curvature multiplier per chain
  for (const r of roads) {
    if (!DRIVABLE.has(r.type) && r.type !== 'footbridge') { chains.push(null); lines.push(null); chainWeight.push(1); continue; }
    const main = MAIN.has(r.type);
    const wData = main ? 0.25 : 1; // main roads trust the noisy DEM less…
    chainWeight.push(main ? 6 : 1);  // …and are held much smoother
    // smooth the horizontal path between junctions, then densify
    const smooth = r.pts.length > 2 ? smoothKeepingJunctions(r.pts) : r.pts;
    const dense = [];
    for (let i = 1; i < smooth.length; i++) {
      const [ax, az] = smooth[i - 1], [bx, bz] = smooth[i];
      const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / SP));
      for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    dense.push(smooth[smooth.length - 1]);
    const chain = dense.map((p, i) => {
      const isEnd = i === 0 || i === dense.length - 1;
      const g = sampleH(p[0], p[1]);
      const w = r.bridge ? (isEnd ? wData : 0) : wData;
      const k = nodeKey(p);
      if (isEnd || nodeCount.get(k) > 1) { // shared junction unknown (ends, and mid-road junction vertices)
        if (!nodeIdx.has(k)) nodeIdx.set(k, unknown(g, w)); else if (w > 0) { const u = nodeIdx.get(k); if (W[u] === 0 || w < W[u]) { W[u] = w; G[u] = g; H[u] = g; } }
        return nodeIdx.get(k);
      }
      return unknown(g, w);
    });
    chains.push(chain); lines.push(dense);
  }
  // Underpasses: where a non-bridge road crosses a bridge span (no shared node), pull the road under it.
  {
    const segIntersect = (p1, p2, p3, p4) => {
      const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]); if (Math.abs(d) < 1e-9) return null;
      const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d, u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
      return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
    };
    let nUnder = 0;
    roads.forEach((b, bi) => {
      if (!b.bridge || !lines[bi] || b.type === 'footbridge') return;
      const bl = lines[bi], bkeys = new Set(b.pts.map(nodeKey));
      const deckH = (G[chains[bi][0]] + G[chains[bi][chains[bi].length - 1]]) / 2; // approx deck level from its abutments
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (const p of bl) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
      roads.forEach((r, ri) => {
        if (ri === bi || r.bridge || !lines[ri] || r.type === 'footbridge') return;
        if (r.pts.some((p) => bkeys.has(nodeKey(p)))) return; // connected roads are approaches, not underpasses
        const rl = lines[ri];
        for (let i = 1; i < rl.length; i++) {
          const a = rl[i - 1], c = rl[i];
          if (Math.max(a[0], c[0]) < minx - 5 || Math.min(a[0], c[0]) > maxx + 5 || Math.max(a[1], c[1]) < minz - 5 || Math.min(a[1], c[1]) > maxz + 5) continue;
          for (let j = 1; j < bl.length; j++) {
            const X = segIntersect(a, c, bl[j - 1], bl[j]); if (!X) continue;
            const under = deckH - 5.2; // clearance for a bus
            for (let k = -2; k <= 2; k++) { const idx = i - 1 + k; if (idx < 0 || idx >= rl.length) continue; const u = chains[ri][idx]; if (W[u] === 0) continue; if (G[u] > under) { G[u] = under; W[u] = 6; H[u] = under; } }
            nUnder++;
          }
        }
      });
    });
    console.log(`ground: ${nUnder} underpass crossings lowered beneath bridge decks`);
  }
  // Conjugate gradient on the normal equations  (D + WC·LᵀL) h = D g,  D = diag(W), L = second-difference along chains
  const n = G.length;
  // curvature terms are spacing-aware: r = s·[(h_c−h_b)/l2 − (h_b−h_a)/l1], s = mean spacing (so uniform 6 m spacing reproduces h_a−2h_b+h_c)
  const terms = [], tw = [], tc = []; // unknown triplets, weight, coefficients (ca, cb, cc)
  chains.forEach((ch, ci) => {
    if (!ch || ch.length < 3) return;
    const pts = lines[roads.indexOf(roads.find((_, ri) => chains[ri] === ch))];
    for (let j = 1; j < ch.length - 1; j++) {
      const l1 = Math.max(0.5, Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
      const l2 = Math.max(0.5, Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]));
      const sc = (l1 + l2) / 2;
      terms.push(ch[j - 1], ch[j], ch[j + 1]); tw.push(WC * chainWeight[ci]); tc.push(sc / l1, -(sc / l1 + sc / l2), sc / l2);
    }
  });
  const T = new Int32Array(terms), TW = new Float64Array(tw), TC = new Float64Array(tc);
  const applyA = (x, out) => {
    for (let i = 0; i < n; i++) out[i] = W[i] * x[i];
    for (let k = 0, t = 0; k < T.length; k += 3, t++) {
      const a = T[k], b = T[k + 1], c = T[k + 2], ca = TC[k], cb = TC[k + 1], cc = TC[k + 2];
      const r = TW[t] * (ca * x[a] + cb * x[b] + cc * x[c]);
      out[a] += ca * r; out[b] += cb * r; out[c] += cc * r;
    }
  };
  const h = new Float64Array(n), rhs = new Float64Array(n), res = new Float64Array(n), pdir = new Float64Array(n), Ap = new Float64Array(n);
  for (let i = 0; i < n; i++) { h[i] = G[i]; rhs[i] = W[i] * G[i]; }
  applyA(h, Ap);
  let rr = 0; for (let i = 0; i < n; i++) { res[i] = rhs[i] - Ap[i]; pdir[i] = res[i]; rr += res[i] * res[i]; }
  const rr0 = rr; let it = 0;
  for (; it < ITER && rr > rr0 * 1e-12 && rr > 1e-6; it++) {
    applyA(pdir, Ap);
    let pAp = 0; for (let i = 0; i < n; i++) pAp += pdir[i] * Ap[i];
    if (pAp <= 0) break;
    const alpha = rr / pAp;
    let rrNew = 0;
    for (let i = 0; i < n; i++) { h[i] += alpha * pdir[i]; res[i] -= alpha * Ap[i]; rrNew += res[i] * res[i]; }
    const beta = rrNew / rr; rr = rrNew;
    for (let i = 0; i < n; i++) pdir[i] = res[i] + beta * pdir[i];
  }
  for (let i = 0; i < n; i++) H[i] = h[i];
  let maxDev = 0; for (let i = 0; i < n; i++) if (W[i] > 0) maxDev = Math.max(maxDev, Math.abs(H[i] - G[i]));
  console.log(`ground: road solve: ${it} CG iterations, residual ${(rr / rr0).toExponential(1)}, max deviation from ground ${maxDev.toFixed(2)} m`);
  // write back: r.line = [[x,y,z],...]
  let n3 = 0;
  roads.forEach((r, i) => { if (!chains[i]) return; r.line = lines[i].map((p, k) => [+p[0].toFixed(1), +H[chains[i][k]].toFixed(2), +p[1].toFixed(1)]); n3 += r.line.length; });
  console.log(`ground: ${n} unknowns, ${nodeIdx.size} junction nodes, ${n3} road samples`);
}

/** Terrain follows the roads: kerb-level plateau across road+pavement, smooth falloff beyond. */
export function conformTerrain(terrain, roads, widthOf, sidewalkOf) {
  const { cols, rows, step, originX, originZ, heights } = terrain;
  const CELL = 24, grid = new Map();
  const gk = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const r of roads) {
    if (!r.line) continue;
    const hw = widthOf(r) / 2, sw = sidewalkOf(r), isBridge = !!r.bridge;
    for (let i = 0; i < r.line.length; i++) {
      const [x, y, z] = r.line[i];
      // segment direction for distance-to-segment
      const nx = r.line[Math.min(r.line.length - 1, i + 1)], px = r.line[Math.max(0, i - 1)];
      const endDist = Math.min(i, r.line.length - 1 - i) * 6; // ~metres from the nearest abutment
      let ux = nx[0] - px[0], uz = nx[2] - px[2]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const s = { x, y, z, hw, sw, isBridge, clamp: Math.max(0.03, Math.min(0.9, (endDist / 8) * 0.9)), ux, uz };
      const k = gk(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s);
    }
  }
  const KERB = 0.12, FALL_MAX = 32;
  let nCon = 0, underDeck = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = originX + c * step, z = originZ + r * step, i = r * cols + c;
      let best = Infinity, hit = null;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const l = grid.get(`${cx + dx},${cz + dz}`); if (!l) continue;
        for (const s of l) {
          if (s.isBridge) continue; // decks don't shape the ground (handled in the final pass below)
          // true distance to the centreline: lateral distance while alongside this sample, point distance beyond it
          const rx = x - s.x, rz = z - s.z, along = rx * s.ux + rz * s.uz;
          const dc = Math.abs(along) <= 3.5 ? Math.abs(rx * s.uz - rz * s.ux) : Math.hypot(rx, rz);
          const d = dc - (s.hw + s.sw); // distance outside the pavement edge
          if (d < best) { best = d; hit = s; hit._dc = dc; }
        }
      }
      if (!hit || best >= FALL_MAX) continue;
      const target = hit.y + (best <= 0 ? (hit._dc < Math.max(hit.hw, step * 0.6) ? -0.04 : KERB) : KERB);
      // gentle grading for small differences (reads as landscaping), short steep banks for big ones (retaining walls on hillsides)
      const delta = Math.abs(heights[i] - target);
      const fall = delta < 2.5 ? FALL_MAX : 12;
      if (best >= fall) continue;
      if (best <= 0) heights[i] = target;
      else { const t = best / fall, s = t * t * (3 - 2 * t); heights[i] = target * (1 - s) + heights[i] * s; }
      nCon++;
    }
  // final pass A: no terrain vertex may sit above a road surface within its ribbon (+0.4 m margin for the wheels)
  let above = 0;
  for (const [, list] of grid) for (const s of list) {
    if (s.isBridge) continue;
    const R = s.hw + step * 0.75; // reach one grid cell beyond the edge so every vertex that shapes the surface under the road is claimed
    const c0 = Math.floor((s.x - R - originX) / step), c1 = Math.ceil((s.x + R - originX) / step);
    const r0 = Math.floor((s.z - R - originZ) / step), r1 = Math.ceil((s.z + R - originZ) / step);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const x = originX + c * step, z = originZ + r * step;
        const rx = x - s.x, rz = z - s.z, along = rx * s.ux + rz * s.uz;
        const dc = Math.abs(along) <= 3.5 ? Math.abs(rx * s.uz - rz * s.ux) : Math.hypot(rx, rz);
        if (dc > R) continue;
        const i = r * cols + c, lim = s.y - 0.04;
        if (heights[i] > lim) { heights[i] = lim; above++; }
      }
  }
  console.log(`ground: ${above} terrain vertices pushed back under road surfaces`);
  // final pass B: ground under a deck must stay below it (approach-road grading is not allowed to rise into the span)
  for (const [, list] of grid) for (const s of list) {
    if (!s.isBridge) continue;
    const c0 = Math.floor((s.x - s.hw - 2 - originX) / step), c1 = Math.ceil((s.x + s.hw + 2 - originX) / step);
    const r0 = Math.floor((s.z - s.hw - 2 - originZ) / step), r1 = Math.ceil((s.z + s.hw + 2 - originZ) / step);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const x = originX + c * step, z = originZ + r * step;
        if (Math.hypot(s.x - x, s.z - z) > s.hw + 1.5) continue;
        const i = r * cols + c, lim = s.y - s.clamp;
        if (heights[i] > lim) { heights[i] = lim; underDeck++; }
      }
  }
  console.log(`ground: ${nCon} terrain vertices conformed to roads, ${underDeck} pushed below bridge decks`);
}

/**
 * River channel: inside the riverbank polygon the ground drops to a flat bed; vertical quay walls
 * run along the polygon edge from the bed up to the bank. Water level follows a monotone downstream profile,
 * always ≥ 1 m below any road nearby.
 */
export function buildRiver(terrain, water, roads, sampleOrig) {
  const { cols, rows, step, originX, originZ, heights } = terrain;
  const rivers = water.filter((w) => w.kind === 'river');
  const areas = water.filter((w) => w.kind === 'area');
  // 1. profile samples along river centrelines
  const samples = [];
  for (const w of rivers) {
    const dense = [];
    for (let i = 1; i < w.pts.length; i++) { const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i]; const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 8)); for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); }
    dense.push(w.pts.at(-1));
    const raw = dense.map(([x, z]) => sampleOrig(x, z));
    const win = 25;
    let level = raw.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - win); k <= Math.min(raw.length - 1, i + win); k++) { s += raw[k]; n++; } return s / n; });
    // clamp below roads (bank ≈ road level): water ≥ 1.2 m below the lowest road within 40 m
    for (let i = 0; i < dense.length; i++) {
      const [x, z] = dense[i]; let minRoad = Infinity;
      for (const r of roads) { if (!r.line || r.bridge) continue; for (const p of r.line) { if (Math.abs(p[0] - x) > 40 || Math.abs(p[2] - z) > 40) continue; if (Math.hypot(p[0] - x, p[2] - z) < 40) minRoad = Math.min(minRoad, p[1]); } }
      if (minRoad < Infinity) level[i] = Math.min(level[i], minRoad - 1.2 - 0); // water surface
    }
    const q = Math.max(1, Math.floor(level.length / 5));
    const head = level.slice(0, q).reduce((a, b) => a + b, 0) / q, tail = level.slice(-q).reduce((a, b) => a + b, 0) / q;
    const order = head >= tail ? level.map((_, i) => i) : level.map((_, i) => level.length - 1 - i);
    let run = Infinity; for (const i of order) { run = Math.min(run, level[i]); level[i] = run; }
    w.dense = dense.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]);
    w.levels = level.map((v) => +v.toFixed(2)); // WATER SURFACE
    dense.forEach(([x, z], i) => samples.push({ x, z, level: level[i] }));
  }
  const nearestLevel = (x, z, maxD = 150) => { let best = maxD * maxD, lv = null; for (const s of samples) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < best) { best = d; lv = s.level; } } return lv; };
  const pointInPoly = (x, z, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; } return inside; };
  // 2. channel bed inside big water areas + quay walls
  const DEPTH = 1.6; // bed below water surface
  let carved = 0;
  for (const a of areas) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of a.pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const big = maxx - minx > 400 || maxz - minz > 400;
    a.levels = a.pts.map(([x, z]) => { const lv = nearestLevel(x, z, big ? 200 : 60); return +(lv != null ? lv : sampleOrig(x, z) - 0.3).toFixed(2); });
    if (!big) continue;
    const c0 = Math.max(0, Math.floor((minx - originX) / step)), c1 = Math.min(cols - 1, Math.ceil((maxx - originX) / step));
    const r0 = Math.max(0, Math.floor((minz - originZ) / step)), r1 = Math.min(rows - 1, Math.ceil((maxz - originZ) / step));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = originX + c * step, z = originZ + r * step;
        if (!pointInPoly(x, z, a.pts)) continue;
        const lv = nearestLevel(x, z); if (lv == null) continue;
        heights[r * cols + c] = lv - DEPTH; carved++;
        (a.cells || (a.cells = [])).push([+x.toFixed(1), +z.toFixed(1), +lv.toFixed(2)]);
      }
    // quay walls: along the polygon edge, bottom = bed, top = bank terrain just outside
    const sampler = makeSampler(terrain);
    a.quay = a.pts.map(([x, z], i) => {
      const lv = a.levels[i];
      // outward normal (approx): away from the polygon centroid
      const j = (i + 1) % a.pts.length, [nx, nz] = a.pts[j];
      let dx = nx - x, dz = z - nz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const outside = [x + dz * 3, z - dx * 3], inside = [x - dz * 3, z + dx * 3];
      const outH = pointInPoly(outside[0], outside[1], a.pts) ? sampler(inside[0], inside[1]) : sampler(outside[0], outside[1]);
      return [+Math.max(outH, lv + 0.6).toFixed(2), +(lv - DEPTH).toFixed(2)]; // [top, bottom]
    });
  }
  console.log(`ground: river bed carved on ${carved} vertices, ${areas.filter((a) => a.quay).length} quay polygons`);
}
