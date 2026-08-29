import * as THREE from 'three';
import { createFacadeMaterials, STYLE, BAYS, FLOORS } from './facades.js';
import { buildLandmarks } from './landmarks.js';

const hash = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const ROAD_STYLE = {
  motorway: { w: 14, c: '#50505a', y: 0.32 }, trunk: { w: 13, c: '#50505a', y: 0.32 },
  primary: { w: 12, c: '#54545c', y: 0.31 }, secondary: { w: 10, c: '#58585f', y: 0.30 },
  tertiary: { w: 8, c: '#5c5c62', y: 0.29 }, residential: { w: 6.5, c: '#63636a', y: 0.28 },
  unclassified: { w: 6, c: '#63636a', y: 0.28 }, living_street: { w: 5.5, c: '#6e6a63', y: 0.27 },
  service: { w: 4, c: '#6c6c72', y: 0.26 }, pedestrian: { w: 5, c: '#a8987e', y: 0.27 },
  motorway_link: { w: 8, c: '#50505a', y: 0.30 }, trunk_link: { w: 8, c: '#50505a', y: 0.30 },
  primary_link: { w: 8, c: '#54545c', y: 0.30 }, secondary_link: { w: 7, c: '#58585f', y: 0.29 },
  tertiary_link: { w: 6, c: '#5c5c62', y: 0.28 }, footbridge: { w: 3, c: '#b8a789', y: 0.3 },
};

/** Effective road width: one-way carriageways of dual roads are ~2 lanes, not the full two-way width. */
export function roadWidth(road) {
  if (road.w) return road.w;
  const st = ROAD_STYLE[road.type] || ROAD_STYLE.residential;
  if (road.lanes) return Math.max(3.5, Math.min(st.w * 1.3, road.lanes * 3.4 + (road.oneway ? 0.5 : 1)));
  if (road.oneway && st.w >= 8) return st.w * 0.62;
  return st.w;
}

/** Per-point widths for a road: tapers over ~15 m at each end toward the width of the continuing road at that node. */
let _nodeWidths = null;
function roadWidths(road, roads) {
  if (!_nodeWidths) {
    _nodeWidths = new Map();
    for (const r of roads) {
      if (r.type === 'footbridge') continue;
      for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const k = `${end[0]},${end[1]}`;
        if (!_nodeWidths.has(k)) _nodeWidths.set(k, []);
        _nodeWidths.get(k).push(r);
      }
    }
  }
  const w = roadWidth(road), pts = road.pts;
  const endW = (pt) => {
    const list = (_nodeWidths.get(`${pt[0]},${pt[1]}`) || []).filter((o) => o !== road && (o.name === road.name || o.type === road.type));
    if (!list.length) return w;
    return (w + Math.max(...list.map(roadWidth))) / 2; // meet the neighbour half-way
  };
  const w0 = endW(pts[0]), w1 = endW(pts[pts.length - 1]);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1, T = Math.min(15, total / 2);
  return cum.map((d) => { const a = Math.min(1, d / T), b = Math.min(1, (total - d) / T); return w0 * (1 - a) + w1 * (1 - b) + w * (a + b - 1); });
}

/** Densify a polyline so no segment exceeds maxLen. */
function densify(pts, maxLen) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / maxLen));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Densify a polyline together with per-point values. */
function densifyWith(pts, vals, maxLen) {
  const P = [pts[0]], V = [vals[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / maxLen));
    for (let k = 1; k <= n; k++) { P.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); V.push(vals[i - 1] + ((vals[i] - vals[i - 1]) * k) / n); }
  }
  return [P, V];
}

/** Build a flat ribbon mesh along a polyline. Height from `levels` (per input point) if given, else draped on ground. */
function ribbon(pts, width, yOff, color, groundHeight, P, C, N, levels) {
  const [d, lv] = levels ? densifyWith(pts, levels, 12) : [densify(pts, 12), null];
  const wd = Array.isArray(width) ? densifyWith(pts, width, 12)[1] : null;
  const L = [], R = [];
  for (let i = 0; i < d.length; i++) {
    const hw = (wd ? wd[i] : width) / 2;
    const [x, z] = d[i];
    const [px, pz] = d[Math.max(0, i - 1)], [nx, nz] = d[Math.min(d.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const y = (lv ? lv[i] : groundHeight(x, z)) + yOff;
    L.push([x - dz * hw, y, z + dx * hw]);
    R.push([x + dz * hw, y, z - dx * hw]);
  }
  for (let i = 0; i < d.length - 1; i++) {
    const a = L[i], b = R[i], c = L[i + 1], e = R[i + 1];
    P.push(...a, ...c, ...b, ...b, ...c, ...e);
    for (let k = 0; k < 6; k++) { C.push(color.r, color.g, color.b); N.push(0, 1, 0); }
  }
  return [L, R];
}

/** Vertical wall quads along a 3D polyline (parapets). */
function wall(line, height, color, P, C, N) {
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay, az] = line[i], [bx, by, bz] = line[i + 1];
    let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    P.push(ax, ay, az, bx, by, bz, ax, ay + height, az, ax, ay + height, az, bx, by, bz, bx, by + height, bz);
    P.push(ax, ay, az, ax, ay + height, az, bx, by, bz, ax, ay + height, az, bx, by + height, bz, bx, by, bz);
    for (let k = 0; k < 6; k++) { C.push(color.r, color.g, color.b); N.push(nx, 0, nz); }
    for (let k = 0; k < 6; k++) { C.push(color.r, color.g, color.b); N.push(-nx, 0, -nz); }
  }
}

function makeMesh(P, C, N, opts = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, ...opts }));
  m.receiveShadow = true;
  return m;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
}

const WALLS_SMALL = ['#dccaa6', '#e5d5b5', '#cdb690', '#bfae92', '#e9dfce', '#d8bda3', '#e0d0c0', '#d3c4a8'];
const WALLS_BIG = ['#a3a09a', '#b8b3aa', '#c9c2b4', '#9d9a95', '#d4c9a8', '#c2b7a5'];
const ROOF_SMALL = new THREE.Color('#7a4b3a'), ROOF_BIG = new THREE.Color('#5a5b60');

export function buildCity(RAPIER, world, data, groundHeight) {
  const group = new THREE.Group();
  const city = data.city;

  // ---- Roads: built from the solved 3D centrelines (r.line = [[x,y,z],…]); the car drives on these ----
  const KERB = 0.12;
  const colChunks = new Map(); // physics: collision triangles per 300 m chunk
  const colPush = (P) => {
    for (let i = 0; i < P.length; i += 9) {
      const k = `${Math.floor(P[i] / 300)},${Math.floor(P[i + 2] / 300)}`;
      if (!colChunks.has(k)) colChunks.set(k, []);
      const arr = colChunks.get(k); for (let j = 0; j < 9; j++) arr.push(P[i + j]);
    }
  };
  /** per-point widths along the 3D line, tapering at the ends toward the continuing road */
  const lineWidths = (road) => {
    if (road.bridge) return road.line.map(() => roadWidth(road)); // decks keep a constant width
    const ws = roadWidths(road, city.roads), w = roadWidth(road), w0 = ws[0], w1 = ws[ws.length - 1];
    const L = road.line, cum = [0];
    for (let i = 1; i < L.length; i++) cum.push(cum[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][2] - L[i - 1][2]));
    const total = cum[cum.length - 1] || 1, T = Math.min(15, total / 2);
    return cum.map((d) => { const a = Math.min(1, d / T), b = Math.min(1, (total - d) / T); return w0 * (1 - a) + w1 * (1 - b) + w * (a + b - 1); });
  };
  /** ribbon along a 3D line; returns 3D left/right edges */
  const ribbon3 = (L, widths, yOff, color, P, C, N, lateral = 0) => {
    const Lp = [], Rp = [];
    for (let i = 0; i < L.length; i++) {
      const hw = (Array.isArray(widths) ? widths[i] : widths) / 2;
      const [x, y, z] = L[i]; const p = L[Math.max(0, i - 1)], n = L[Math.min(L.length - 1, i + 1)];
      let dx = n[0] - p[0], dz = n[2] - p[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const ox = -dz * lateral, oz = dx * lateral; // lateral shift (right = +)
      Lp.push([x + ox - dz * hw, y + yOff, z + oz + dx * hw]); Rp.push([x + ox + dz * hw, y + yOff, z + oz - dx * hw]);
    }
    const start = P.length;
    for (let i = 0; i < L.length - 1; i++) {
      const a = Lp[i], b = Rp[i], c = Lp[i + 1], e = Rp[i + 1];
      P.push(...a, ...c, ...b, ...b, ...c, ...e);
      for (let k = 0; k < 6; k++) { C.push(color.r, color.g, color.b); N.push(0, 1, 0); }
    }
    return { L: Lp, R: Rp, tris: P.slice(start) };
  };
  const offsetLine3 = (L, off, yOff) => L.map(([x, y, z], i) => {
    const p = L[Math.max(0, i - 1)], n = L[Math.min(L.length - 1, i + 1)];
    let dx = n[0] - p[0], dz = n[2] - p[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const o = typeof off === 'function' ? off(i) : off;
    return [x - dz * o, y + yOff, z + dx * o];
  });

  // Asphalt lookup: is (x,z) on any road surface (optionally ignoring one road)?
  const RG = new Map(), RC = 30;
  city.roads.forEach((r, idx) => {
    if (r.type === 'footbridge' || !r.line) return;
    const hw = roadWidth(r) / 2 + 0.3, L = r.line;
    for (let i = 1; i < L.length; i++) {
      const [ax, , az] = L[i - 1], [bx, , bz] = L[i];
      for (let cx = Math.floor((Math.min(ax, bx) - hw) / RC); cx <= Math.floor((Math.max(ax, bx) + hw) / RC); cx++)
        for (let cz = Math.floor((Math.min(az, bz) - hw) / RC); cz <= Math.floor((Math.max(az, bz) + hw) / RC); cz++) {
          const k = `${cx},${cz}`; if (!RG.has(k)) RG.set(k, []); RG.get(k).push([ax, az, bx, bz, hw, idx]);
        }
    }
  });
  const onAsphalt = (x, z, exclude = -1) => {
    const list = RG.get(`${Math.floor(x / RC)},${Math.floor(z / RC)}`); if (!list) return false;
    for (const [ax, az, bx, bz, hw, idx] of list) {
      if (idx === exclude) continue;
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const dx = ax + vx * t - x, dz = az + vz * t - z;
      if (dx * dx + dz * dz < hw * hw) return true;
    }
    return false;
  };
  const sidewalkWidth = (road) => (['primary', 'secondary', 'trunk', 'primary_link', 'secondary_link'].includes(road.type) ? 3.0 : road.type === 'tertiary' ? 2.4 : ['service', 'pedestrian', 'living_street', 'footbridge'].includes(road.type) ? 0 : 1.8);

  // road surfaces
  const byStyle = new Map();
  const roadEdges = new Map(); // road idx -> {L, R, widths}
  city.roads.forEach((road, idx) => {
    if (!road.line) return;
    const st = ROAD_STYLE[road.type] || ROAD_STYLE.residential;
    if (!byStyle.has(st)) byStyle.set(st, { P: [], C: [], N: [] });
    const b = byStyle.get(st), widths = lineWidths(road);
    const e = ribbon3(road.line, widths, 0, new THREE.Color(st.c), b.P, b.C, b.N);
    colPush(e.tris); roadEdges.set(idx, { L: e.L, R: e.R, widths });
  });

  // ---- Sidewalks + kerbs (pavement 12 cm above the road, broken where another road crosses) ----
  const sidewalks = []; // walkable polylines [[x,y,z],...] for pedestrians
  {
    const P = [], C = [], N = [], pave = new THREE.Color('#a19d93'), paveOld = new THREE.Color('#9a8f7c'), kerbC = new THREE.Color('#8f8c86');
    city.roads.forEach((road, idx) => {
      if (!road.line) return;
      if (road.type === 'pedestrian' || road.type === 'living_street') { sidewalks.push(road.line.map(([x, y, z]) => [x, y + 0.05, z])); return; }
      const sw = sidewalkWidth(road); if (!sw || road.bridge) return;
      const widths = lineWidths(road);
      for (const side of [1, -1]) {
        const centre = offsetLine3(road.line, (i) => (widths[i] / 2 + sw / 2) * side, KERB);
        const inner = offsetLine3(road.line, (i) => (widths[i] / 2) * side, 0);
        let run = [], runIn = [];
        const flush = () => {
          if (run.length >= 2) {
            const e = ribbon3(run, sw, 0, road.type === 'residential' || road.type === 'unclassified' ? paveOld : pave, P, C, N);
            colPush(e.tris);
            wall(runIn, KERB, kerbC, P, C, N); // kerb face
            sidewalks.push(run);
          }
          run = []; runIn = [];
        };
        for (let i = 0; i < centre.length; i++) { const p = centre[i]; if (onAsphalt(p[0], p[2], idx)) flush(); else { run.push(p); runIn.push(inner[i]); } }
        flush();
      }
    });
    if (P.length) group.add(makeMesh(P, C, N, { roughness: 0.95 }));
    console.log(`[city] ${sidewalks.length} sidewalk runs`);
  }

  // ---- Junction patches at node heights ----
  {
    const nodeRoads = new Map();
    city.roads.forEach((road) => {
      if (!road.line || road.type === 'footbridge') return;
      const st = ROAD_STYLE[road.type] || ROAD_STYLE.residential, w = roadWidth(road);
      for (const p of [road.line[0], road.line[road.line.length - 1]]) {
        const k = `${p[0]},${p[2]}`, e = nodeRoads.get(k);
        if (!e) nodeRoads.set(k, { x: p[0], y: p[1], z: p[2], n: 1, st, w, roads: [road] }); else { e.n++; e.roads.push(road); if (w > e.w) { e.st = st; e.w = w; } }
      }
    });
    // height of the road surface near a point: nearest sample among the junction's roads (so patches follow sloping roads)
    const surfaceY = (e, x, z) => {
      let best = Infinity, y = e.y;
      for (const r of e.roads) for (const p of r.line) { const d = (p[0] - x) ** 2 + (p[2] - z) ** 2; if (d < best) { best = d; y = p[1]; } }
      return y;
    };
    let nJ = 0;
    for (const [, e] of nodeRoads) {
      if (e.n < 2) continue;
      const b = byStyle.get(e.st); if (!b) continue;
      const col = new THREE.Color(e.st.c), r = e.w / 2, Nn = 16;
      const rim = []; for (let i = 0; i < Nn; i++) { const a = (i / Nn) * Math.PI * 2, x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r; rim.push([x, surfaceY(e, x, z) + 0.004, z]); }
      for (let i = 0; i < Nn; i++) {
        const p0 = rim[i], p1 = rim[(i + 1) % Nn];
        b.P.push(e.x, e.y + 0.004, e.z, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2]);
        for (let k = 0; k < 3; k++) { b.C.push(col.r, col.g, col.b); b.N.push(0, 1, 0); }
      }
      nJ++; // visual only
    }
    console.log(`[city] ${nJ} junction patches`);
  }
  const roadMeshes = [];
  for (const [, b] of byStyle) { const m = makeMesh(b.P, b.C, b.N); roadMeshes.push(m); group.add(m); }

  // ---- Road markings on the 3D lines ----
  {
    const P = [], C = [], N = [], white = new THREE.Color('#d8d5c6');
    const quadAt = (x, y, z, dx, dz, len, wid) => {
      const hx = dx * len / 2, hz = dz * len / 2, wx = -dz * wid / 2, wz = dx * wid / 2;
      const a = [x - hx - wx, y, z - hz - wz], b = [x - hx + wx, y, z - hz + wz], c = [x + hx + wx, y, z + hz + wz], e = [x + hx - wx, y, z + hz - wz];
      P.push(...a, ...b, ...c, ...a, ...c, ...e);
      for (let k = 0; k < 6; k++) { C.push(white.r, white.g, white.b); N.push(0, 1, 0); }
    };
    const dashes = (L, yOff, dash, gap, wid) => {
      let carry = 0;
      for (let i = 1; i < L.length; i++) {
        const [ax, ay, az] = L[i - 1], [bx, by, bz] = L[i];
        const len = Math.hypot(bx - ax, bz - az); if (len < 0.01) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        let d = 0;
        while (d < len) {
          const period = dash + gap, inP = carry % period;
          if (inP < dash) {
            const l2 = Math.min(dash - inP, len - d), t = (d + l2 / 2) / len;
            quadAt(ax + dx * (d + l2 / 2), ay + (by - ay) * t + yOff, az + dz * (d + l2 / 2), dx, dz, l2, wid);
            d += l2; carry += l2;
          } else { const skip = Math.min(period - inP, len - d); d += skip; carry += skip; }
        }
      }
    };
    const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']);
    city.roads.forEach((road, idx) => {
      if (!road.line) return;
      const e = roadEdges.get(idx); if (!e) return;
      const L = road.line, wd = e.widths;
      if (MAIN.has(road.type)) {
        dashes(offsetLine3(L, (i) => wd[i] / 2 - 0.35, 0), 0.02, 1000, 0, 0.13);
        dashes(offsetLine3(L, (i) => -(wd[i] / 2 - 0.35), 0), 0.02, 1000, 0, 0.13);
        const w = roadWidth(road);
        if (road.oneway) { // n lanes → n-1 dashed dividers, evenly spaced
          const lanes = road.lanes || Math.max(1, Math.round(w / 3.4));
          for (let k = 1; k < lanes; k++) { const f = k / lanes - 0.5; dashes(offsetLine3(L, (i) => wd[i] * f, 0), 0.02, 3, 6, 0.12); }
        } else {
          dashes(L, 0.02, 3, 4, 0.16); // centre line
          const perSide = Math.max(1, Math.round((road.lanes || Math.round(w / 3.4)) / 2));
          for (let k = 1; k < perSide; k++) { const f = (k / perSide) * 0.5; dashes(offsetLine3(L, (i) => wd[i] * f, 0), 0.02, 3, 6, 0.12); dashes(offsetLine3(L, (i) => -wd[i] * f, 0), 0.02, 3, 6, 0.12); }
        }
      } else if (road.type === 'tertiary') dashes(L, 0.02, 3, 5, 0.14);
    });
    // zebra crossings at traffic signals
    const segs = [];
    city.roads.forEach((r) => {
      if (!r.line || r.bridge || ['footbridge', 'pedestrian', 'service'].includes(r.type)) return;
      const w = roadWidth(r);
      for (let i = 1; i < r.line.length; i++) segs.push([r.line[i - 1], r.line[i], w]);
    });
    let nZ = 0;
    for (const [sx, sz] of city.signals || []) {
      let best = 30 * 30, hit = null, ht = 0;
      for (const sg of segs) {
        const [a, b] = sg; if (Math.abs(a[0] - sx) > 40 && Math.abs(b[0] - sx) > 40) continue;
        const vx = b[0] - a[0], vz = b[2] - a[2], l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((sx - a[0]) * vx + (sz - a[2]) * vz) / l2));
        const dd = (a[0] + vx * t - sx) ** 2 + (a[2] + vz * t - sz) ** 2;
        if (dd < best) { best = dd; hit = sg; ht = t; }
      }
      if (!hit) continue;
      const [a, b, w] = hit; let dx = b[0] - a[0], dz = b[2] - a[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const y = a[1] + (b[1] - a[1]) * ht + 0.022, cx = sx - dx * 5, cz = sz - dz * 5;
      const span = w - 1.0, n = Math.floor(span / 1.0);
      for (let i = 0; i < n; i++) { const off = -span / 2 + 0.5 + i; quadAt(cx - dz * off, y, cz + dx * off, dx, dz, 3.0, 0.5); }
      nZ++;
    }
    if (P.length) group.add(makeMesh(P, C, N, { roughness: 0.8 }));
    console.log(`[city] road markings: ${P.length / 18 | 0} quads, ${nZ} zebra crossings`);
  }

  // ---- Street lamps along main roads (instanced), glow discs shown at night ----
  const lampGlow = { mesh: null, heads: null };
  {
    const spots = [];
    const LAMP_ROADS = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link']);
    let rejected = 0;
    city.roads.forEach((road) => {
      if (!road.line || road.bridge || !LAMP_ROADS.has(road.type)) return;
      const w = roadWidth(road), sw = sidewalkWidth(road) || 1.6, L = road.line;
      let acc = 17, side = 1;
      for (let i = 1; i < L.length; i++) {
        const [ax, ay, az] = L[i - 1], [bx, by, bz] = L[i]; const seg = Math.hypot(bx - ax, bz - az);
        acc += seg;
        if (acc >= 34) {
          acc = 0; side = road.oneway ? 1 : -side;
          const dx = (bx - ax) / (seg || 1), dz = (bz - az) / (seg || 1);
          const x = bx - dz * (w / 2 + sw * 0.55) * side, z = bz + dx * (w / 2 + sw * 0.55) * side;
          if (onAsphalt(x, z)) { rejected++; continue; }
          spots.push({ x, z, y: by + KERB, yaw: Math.atan2(dx, dz), side });
        }
      }
    });
    const n = spots.length;
    if (n) {
      const dark = new THREE.MeshStandardMaterial({ color: '#3a3b3f', roughness: 0.6, metalness: 0.5 });
      const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 7, 6), dark, n);
      const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.6), dark, n);
      const headMat = new THREE.MeshStandardMaterial({ color: '#f0e6c8', emissive: '#ffd27a', emissiveIntensity: 0 });
      const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.7), headMat, n);
      const gc = document.createElement('canvas'); gc.width = gc.height = 128;
      const gg = gc.getContext('2d'); const grd = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,205,120,0.55)'); grd.addColorStop(0.5, 'rgba(255,190,100,0.18)'); grd.addColorStop(1, 'rgba(255,180,90,0)');
      gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
      const glowTex = new THREE.CanvasTexture(gc); glowTex.colorSpace = THREE.SRGBColorSpace;
      const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14), glowMat, n);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      spots.forEach((s, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw + (s.side > 0 ? Math.PI / 2 : -Math.PI / 2));
        const ax = -Math.cos(s.yaw) * s.side, az = Math.sin(s.yaw) * s.side;
        m.compose(pos.set(s.x, s.y + 3.5, s.z), q, one); pole.setMatrixAt(i, m);
        m.compose(pos.set(s.x + ax * 0.8, s.y + 6.95, s.z + az * 0.8), q, one); arm.setMatrixAt(i, m);
        m.compose(pos.set(s.x + ax * 1.6, s.y + 6.9, s.z + az * 1.6), q, one); head.setMatrixAt(i, m);
        m.compose(pos.set(s.x + ax * 2.2, s.y + 0.3, s.z + az * 2.2), qg, one); glow.setMatrixAt(i, m);
      });
      pole.castShadow = true;
      group.add(pole, arm, head, glow);
      lampGlow.mesh = glow; lampGlow.heads = head;
    }
    console.log(`[city] ${n} street lamps (${rejected} rejected on asphalt)`);
  }

  // ---- Bridges: the solved road IS the deck; add parapets and an underside ----
  {
    const P = [], C = [], N = [], stone = new THREE.Color('#b5ab98');
    let nB = 0;
    city.roads.forEach((road, idx) => {
      if (!road.bridge || !road.line) return;
      const e = roadEdges.get(idx); if (!e) return;
      const under = (L) => L.map(([x, y, z]) => [x, y - 1.0, z]);
      wall(under(e.L), 1.0, stone, P, C, N); wall(under(e.R), 1.0, stone, P, C, N);
      wall(e.L, 0.85, stone, P, C, N); wall(e.R, 0.85, stone, P, C, N);
      // solid parapets just outside the deck edge (slippery, trimmed back from the abutments) so you can't drive off.
      // Footbridges (often OSM's separate walkway alongside a road bridge) stay visual-only so they never block the deck.
      if (road.type === 'footbridge') { nB++; return; }
      const total = e.L.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - e.L[i - 1][0], p[2] - e.L[i - 1][2]) : 0), 0);
      for (const [edge, sign] of [[e.L, 1], [e.R, -1]]) {
        let cum = 0;
        for (let i = 1; i < edge.length; i++) {
          const a = edge[i - 1], b = edge[i]; const len = Math.hypot(b[0] - a[0], b[2] - a[2]); const c0 = cum; cum += len; if (len < 0.3) continue;
          if (c0 < 1.5 || cum > total - 1.5) continue;
          const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
          const ox = -Math.cos(yaw) * 0.35 * sign, oz = Math.sin(yaw) * 0.35 * sign; // outward from the deck
          world.createCollider(RAPIER.ColliderDesc.cuboid(0.12, 0.6, len / 2).setTranslation((a[0] + b[0]) / 2 + ox, (a[1] + b[1]) / 2 + 0.45, (a[2] + b[2]) / 2 + oz).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setFriction(0.02));
        }
      }
      nB++;
    });
    if (P.length) group.add(makeMesh(P, C, N));
    console.log(`[city] ${nB} bridge spans`);
  }

  // ---- Physics: road + pavement + junction triangles as trimesh colliders (the car drives on these) ----
  {
    let nTri = 0, nCol = 0;
    for (const [, arr] of colChunks) {
      const v = new Float32Array(arr), idx = new Uint32Array(v.length / 3);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setFriction(1.0));
      nTri += idx.length / 3; nCol++;
    }
    console.log(`[city] road collision: ${nTri} triangles in ${nCol} chunks`);
  }

  // ---- Tram rails ----
  {
    const P = [], C = [], N = [], c = new THREE.Color('#2b2b2e');
    for (const pts of city.tram) {
      const d = densify(pts, 12);
      const l = [], r = [];
      for (let i = 0; i < d.length; i++) {
        const [x, z] = d[i];
        const [px, pz] = d[Math.max(0, i - 1)], [nx, nz] = d[Math.min(d.length - 1, i + 1)];
        let dx = nx - px, dz = nz - pz; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        l.push([x - dz * 0.72, z + dx * 0.72]); r.push([x + dz * 0.72, z - dx * 0.72]);
      }
      ribbon(l, 0.14, 0.36, c, groundHeight, P, C, N);
      ribbon(r, 0.14, 0.36, c, groundHeight, P, C, N);
    }
    if (P.length) group.add(makeMesh(P, C, N, { roughness: 0.4, metalness: 0.6 }));
  }

  // ---- Water: riverbank polygons with quay walls, stream ribbons ----
  {
    const P = [], C = [], N = [], Q = [], QC = [], QN = [];
    const cRiver = new THREE.Color('#4a9ac0'), cStream = new THREE.Color('#4f9db8'), quay = new THREE.Color('#b8b0a2');
    for (const w of city.water) {
      if (w.kind === 'area') {
        if (w.cells) { // river: one quad per carved channel cell (robust for the long riverbank outline)
          const h = data.terrain.step * 0.53;
          for (const [x, z, lv] of w.cells) {
            P.push(x - h, lv, z - h, x - h, lv, z + h, x + h, lv, z - h, x + h, lv, z - h, x - h, lv, z + h, x + h, lv, z + h);
            for (let k = 0; k < 6; k++) { C.push(cRiver.r, cRiver.g, cRiver.b); N.push(0, 1, 0); }
          }
        } else {
          const v2 = w.pts.map(([x, z]) => new THREE.Vector2(x, -z));
          const tris = THREE.ShapeUtils.triangulateShape(v2, []);
          for (const [i0, i1, i2] of tris) for (const i of [i0, i2, i1]) { P.push(w.pts[i][0], w.levels[i], w.pts[i][1]); C.push(cRiver.r, cRiver.g, cRiver.b); N.push(0, 1, 0); }
        }
        if (w.quay) { // vertical quay walls along the polygon edge: [top, bottom] per vertex
          for (let i = 0; i < w.pts.length; i++) {
            const j = (i + 1) % w.pts.length, [ax, az] = w.pts[i], [bx, bz] = w.pts[j];
            const [ta, ba] = w.quay[i], [tb, bb] = w.quay[j];
            let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
            Q.push(ax, ba, az, bx, bb, bz, ax, ta, az, ax, ta, az, bx, bb, bz, bx, tb, bz);
            Q.push(ax, ba, az, ax, ta, az, bx, bb, bz, ax, ta, az, bx, tb, bz, bx, bb, bz);
            for (let k = 0; k < 6; k++) { QC.push(quay.r, quay.g, quay.b); QN.push(nx, 0, nz); }
            for (let k = 0; k < 6; k++) { QC.push(quay.r, quay.g, quay.b); QN.push(-nx, 0, -nz); }
          }
        }
      } else if (w.kind === 'stream' || w.kind === 'canal') {
        ribbon(w.pts, w.kind === 'canal' ? 6 : 4, 0, cStream, groundHeight, P, C, N, w.levels);
      }
    }
    if (P.length) { const m = makeMesh(P, C, N, { roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.9 }); m.name = 'water'; group.add(m); }
    if (Q.length) group.add(makeMesh(Q, QC, QN, { roughness: 0.95 }));
  }

  // ---- Buildings: styled walls with window textures, roofs, mosques; merged per 500 m chunk ----
  const mats = createFacadeMaterials();
  const OLD_TOWN = new Set(['Baščaršija', 'Kovači', 'Bistrik', 'Sedrenik', 'Hrid', 'Mahmutovac', 'Širokača', 'Soukbunar', 'Medrese', 'Sumbuluša', 'Babića bašča', 'Vratnik', 'Logavina', 'Mejtaš', 'Bjelave', 'Podhrastovi']);
  const places = city.places.filter((p) => p.kind === 'suburb' || p.kind === 'quarter' || p.kind === 'neighbourhood');
  const placeOf = (x, z) => { let best = Infinity, n = null; for (const p of places) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; n = p.name; } } return n; };
  const isConvex = (pts) => {
    let sgn = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-6) continue;
      if (sgn === 0) sgn = Math.sign(cr); else if (Math.sign(cr) !== sgn) return false;
    }
    return true;
  };
  const CH = 500;
  const chunks = new Map(); // key -> { style -> {P,N,U,C} }
  const bucket = (key, style) => {
    if (!chunks.has(key)) chunks.set(key, {});
    const ch = chunks.get(key);
    if (!ch[style]) ch[style] = { P: [], N: [], U: [], C: [] };
    return ch[style];
  };
  const pushV = (B, x, y, z, nx, ny, nz, u, v, c) => { B.P.push(x, y, z); B.N.push(nx, ny, nz); B.U.push(u, v); B.C.push(c.r, c.g, c.b); };
  function addWalls(B, pts, base, top, bay, floorH, tint) {
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area2 += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area2 > 0 ? 1 : -1;
    const v0 = -(top - base) / floorH / FLOORS;
    let uOff = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.05) continue;
      const nx = (dz / len) * sgn, nz = (-dx / len) * sgn;
      const bays = Math.max(1, Math.round(len / bay));
      const u0 = uOff / BAYS, u1 = (uOff + bays) / BAYS; uOff += bays;
      // two triangles, wound to face outward
      const quad = [[ax, base, az, u0, v0], [bx, base, bz, u1, v0], [bx, top, bz, u1, 0], [ax, top, az, u0, 0]];
      const order = sgn > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) { const q = quad[k]; pushV(B, q[0], q[1], q[2], nx, 0, nz, q[3], q[4], tint); }
    }
  }
  function addFlatRoof(B, pts, y, color) {
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, -z)), []);
    for (const [i0, i1, i2] of tris) for (const i of [i0, i2, i1]) pushV(B, pts[i][0], y, pts[i][1], 0, 1, 0, 0, 0, color);
  }
  function addPyramidRoof(B, pts, y, apexY, cx, cz, color) {
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      // normal of triangle (a, b, apex)
      const ux = bx - ax, uy = 0, uz = bz - az, vx = cx - ax, vy = apexY - y, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      pushV(B, ax, y, az, nx, ny, nz, 0, 0, color); pushV(B, bx, y, bz, nx, ny, nz, 0, 0, color); pushV(B, cx, apexY, cz, nx, ny, nz, 0, 0, color);
      pushV(B, ax, y, az, nx, ny, nz, 0, 0, color); pushV(B, cx, apexY, cz, nx, ny, nz, 0, 0, color); pushV(B, bx, y, bz, nx, ny, nz, 0, 0, color);
    }
  }
  function addGeometry(B, geo, x, y, z, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) pushV(B, p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z, n.getX(i), n.getY(i), n.getZ(i), 0, 0, color);
  }
  const domeGeo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const minaretGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const coneGeo = new THREE.ConeGeometry(1.3, 3, 10);
  const tmpC = new THREE.Color();
  const pick = (arr, rnd) => arr[Math.floor(rnd * arr.length) % arr.length];

  let nCol = 0, nB = 0, nMosque = 0;
  const landmarkList = [];
  for (const b of city.buildings) {
    const pts = b.pts;
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3) continue;
    if (b.landmark) { landmarkList.push(b); continue; }
    const area = polyArea(pts);
    if (area < 12) continue;
    let cx = 0, cz = 0, base = Infinity;
    for (const [x, z] of pts) { cx += x; cz += z; }
    cx /= pts.length; cz /= pts.length;
    for (const [x, z] of pts) base = Math.min(base, data.sampleHeight(x, z));
    const rnd = hash(cx, cz), rnd2 = hash(cz * 1.7, cx * 0.3);
    const kind = b.kind || 'yes';
    let h = b.h;
    if (!h) {
      if (kind === 'apartments') h = 12 + rnd * 18;
      else if (kind === 'house' || kind === 'detached' || kind === 'semidetached_house') h = 6 + rnd * 3;
      else if (area < 60) h = 3.5 + rnd * 2;
      else if (area < 250) h = 6.5 + rnd * 5;
      else if (area < 700) h = 9 + rnd * 8;
      else h = 14 + rnd * 18;
    }
    // ---- style selection ----
    const place = placeOf(cx, cz);
    let style;
    if (kind === 'mosque') style = 'mosque';
    else if (['garage', 'garages', 'shed', 'hut', 'roof', 'ruins', 'construction', 'warehouse', 'industrial'].includes(kind)) style = 'plain';
    else if (h > 38 || (['office', 'commercial', 'hotel'].includes(kind) && h > 24)) style = 'glass';
    else if (OLD_TOWN.has(place) && area < 750 && h < 17) style = 'oldtown';
    else if (kind === 'apartments' || area > 900 || h > 21) style = 'socialist';
    else if (area < 260 && h <= 10.5) style = 'house';
    else style = 'austro';
    const S = STYLE[style];
    const wall = tmpC.set(pick(S.walls, rnd)).clone().multiplyScalar(0.92 + rnd2 * 0.12);
    const roof = tmpC.set(pick(S.roofs, rnd2)).clone();
    const key = `${Math.floor(cx / CH)},${Math.floor(cz / CH)}`;
    const top = base + h, sink = 3;
    const wallStyle = style === 'mosque' ? 'plain' : style;
    addWalls(bucket(key, wallStyle), pts, base - sink, top, S.bay, S.floor, wall);
    const R = bucket(key, 'plain');
    const ridge = Math.min(3.2, 0.32 * Math.sqrt(area));
    if (S.pyramid && pts.length <= 8 && isConvex(pts) && area < 320) addPyramidRoof(R, pts, top, top + ridge, cx, cz, roof);
    else addFlatRoof(R, pts, top, roof);
    if (style === 'mosque') {
      const r = Math.max(3, Math.min(9, Math.sqrt(area) * 0.38));
      addGeometry(R, domeGeo.clone().scale(r, r * 0.9, r), cx, top, cz, tmpC.set('#6b7280').clone());
      // minaret at the footprint vertex farthest from the centroid
      let far = pts[0], fd = 0;
      for (const p of pts) { const d = (p[0] - cx) ** 2 + (p[1] - cz) ** 2; if (d > fd) { fd = d; far = p; } }
      const mh = Math.max(20, h * 2.6);
      const mx = far[0] + (far[0] - cx) * 0.15, mz = far[1] + (far[1] - cz) * 0.15;
      addGeometry(R, minaretGeo.clone().scale(1.1, mh, 1.1), mx, base + mh / 2, mz, tmpC.set('#ebe6da').clone());
      addGeometry(R, minaretGeo.clone().scale(1.6, 0.6, 1.6), mx, base + mh * 0.72, mz, tmpC.set('#ebe6da').clone()); // šerefe (balcony)
      addGeometry(R, coneGeo, mx, base + mh + 1.5, mz, tmpC.set('#6b7280').clone());
      nMosque++;
    }
    nB++;
    // collider
    if (area >= 25) {
      const v = new Float32Array(pts.length * 6);
      pts.forEach(([x, z], i) => { v[i * 6] = x; v[i * 6 + 1] = base - 1; v[i * 6 + 2] = z; v[i * 6 + 3] = x; v[i * 6 + 4] = top; v[i * 6 + 5] = z; });
      const desc = RAPIER.ColliderDesc.convexHull(v);
      if (desc) { world.createCollider(desc.setFriction(0.4)); nCol++; }
    }
  }
  let nMesh = 0;
  for (const [, ch] of chunks)
    for (const style in ch) {
      const B = ch[style];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.C, 3));
      const m = new THREE.Mesh(g, mats[style]);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); nMesh++;
    }
  console.log(`[city] ${nB} buildings (${nMosque} mosques) in ${nMesh} meshes, ${nCol} colliders, ${city.roads.length} roads`);
  buildLandmarks(landmarkList, { group, RAPIER, world, data });

  // ---- Street-name lookup: grid of road segments ----
  const CELL = 100, grid = new Map();
  for (const road of city.roads) {
    if (!road.name) continue;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
      const c0 = Math.floor(Math.min(ax, bx) / CELL), c1 = Math.floor(Math.max(ax, bx) / CELL);
      const r0 = Math.floor(Math.min(az, bz) / CELL), r1 = Math.floor(Math.max(az, bz) / CELL);
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const k = `${c},${r}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([ax, az, bx, bz, road.name]);
      }
    }
  }
  function nearestStreet(x, z) {
    let best = 40 * 40, name = null;
    const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const segs = grid.get(`${c + dc},${r + dr}`);
      if (!segs) continue;
      for (const [ax, az, bx, bz, n] of segs) {
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
        let t = ((x - ax) * vx + (z - az) * vz) / l2; t = Math.max(0, Math.min(1, t));
        const dx = ax + vx * t - x, dz = az + vz * t - z, d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; name = n; }
      }
    }
    return name;
  }

  // ---- Landmarks: Sebilj fountain (Baščaršija) and the Eternal Flame (Vječna vatra) ----
  {
    const [sx, sz] = data.toLocal(43.85975, 18.43133);
    const sy = groundHeight(sx, sz);
    const wood = new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.8 }), lead = new THREE.MeshStandardMaterial({ color: '#6b7280', roughness: 0.6, metalness: 0.3 }), stone = new THREE.MeshStandardMaterial({ color: '#c9bfae', roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 1.0, 8), stone); base.position.set(sx, sy + 0.5, sz);
    const kiosk = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 8), wood); kiosk.position.set(sx, sy + 2.6, sz);
    const eave = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.25, 8), wood); eave.position.set(sx, sy + 4.3, sz);
    const roofM = new THREE.Mesh(new THREE.ConeGeometry(2.7, 2.2, 8), lead); roofM.position.set(sx, sy + 5.5, sz);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lead); finial.position.set(sx, sy + 6.7, sz);
    for (const m of [base, kiosk, eave, roofM, finial]) { m.castShadow = true; group.add(m); }
    world.createCollider(RAPIER.ColliderDesc.cylinder(3, 2.6).setTranslation(sx, sy + 3, sz));
    // eternal flame
    const [fx, fz] = data.toLocal(43.85865, 18.42085);
    const fy = groundHeight(fx, fz);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 1.2), new THREE.MeshStandardMaterial({ color: '#b8b0a2', roughness: 0.9 })); wall.position.set(fx, fy + 1.6, fz - 1.2); wall.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.6, 0.5, 12), stone); bowl.position.set(fx, fy + 0.25, fz);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 8), new THREE.MeshStandardMaterial({ color: '#ff7a1a', emissive: '#ff6a00', emissiveIntensity: 2.5, transparent: true, opacity: 0.9 })); flame.position.set(fx, fy + 1.1, fz);
    const fl = new THREE.PointLight('#ff8a30', 30, 18, 2); fl.position.set(fx, fy + 1.6, fz);
    group.add(wall, bowl, flame, fl);
    group.userData.flame = flame;
  }

  function setWet(w) { for (const m of roadMeshes) { m.material.roughness = 0.95 - 0.7 * w; m.material.metalness = 0.35 * w; } }
  function setNight(nf) {
    mats.setNight(nf);
    if (lampGlow.mesh) { lampGlow.mesh.material.opacity = nf; lampGlow.heads.material.emissiveIntensity = nf * 3; }
  }
  // blocked test for planting: on asphalt or inside a building footprint (bbox grid)
  const BB = new Map(), BC = 40;
  for (const b of city.buildings) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of b.pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    for (let cx = Math.floor(minx / BC); cx <= Math.floor(maxx / BC); cx++) for (let cz = Math.floor(minz / BC); cz <= Math.floor(maxz / BC); cz++) { const k = `${cx},${cz}`; if (!BB.has(k)) BB.set(k, []); BB.get(k).push([minx - 1.5, maxx + 1.5, minz - 1.5, maxz + 1.5]); }
  }
  const isBlocked = (x, z) => {
    if (onAsphalt(x, z)) return true;
    const l = BB.get(`${Math.floor(x / BC)},${Math.floor(z / BC)}`); if (!l) return false;
    for (const [a, b, c2, d] of l) if (x > a && x < b && z > c2 && z < d) return true;
    return false;
  };
  return { group, nearestStreet, setNight, setWet, sidewalks, isBlocked };
}
