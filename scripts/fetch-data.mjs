// Fetches real Sarajevo terrain (AWS Terrarium tiles) and OSM roads/buildings/water
// and writes game-ready data into public/data/. Carves river channels into the terrain.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { smoothValley, solveRoadProfiles, conformTerrain, buildRiver, makeSampler as mkSampler } from './ground.mjs';

// ---- Area of interest (central Sarajevo) ----
const BBOX = { south: 43.84, north: 43.875, west: 18.35, east: 18.44 };
const LAT0 = (BBOX.south + BBOX.north) / 2;
const LON0 = (BBOX.west + BBOX.east) / 2;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const STEP = 5; // metres per terrain sample
const ZOOM = 15;
const UA = 'sarajevo-taxi/0.1 (personal game project)';

const toLocal = (lat, lon) => [(lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT];
const halfW = ((BBOX.east - BBOX.west) * M_PER_DEG_LON) / 2;
const halfD = ((BBOX.north - BBOX.south) * M_PER_DEG_LAT) / 2;
const r1 = (v) => Math.round(v * 10) / 10;

// ---- Terrain ----
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return [x, y];
}
async function fetchTile(z, x, y) {
  const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
  return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
}

async function buildTerrain() {
  const [x0f, y0f] = lonLatToTile(BBOX.west, BBOX.north, ZOOM);
  const [x1f, y1f] = lonLatToTile(BBOX.east, BBOX.south, ZOOM);
  const tx0 = Math.floor(x0f), ty0 = Math.floor(y0f), tx1 = Math.floor(x1f), ty1 = Math.floor(y1f);
  const tilesX = tx1 - tx0 + 1, tilesY = ty1 - ty0 + 1;
  console.log(`terrain: ${tilesX}x${tilesY} tiles at z${ZOOM}`);
  const W = tilesX * 256, H = tilesY * 256;
  const mosaic = new Float32Array(W * H);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      jobs.push(fetchTile(ZOOM, tx, ty).then((png) => {
        const ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
        for (let py = 0; py < 256; py++)
          for (let px = 0; px < 256; px++) {
            const i = (py * 256 + px) * 4;
            mosaic[(oy + py) * W + ox + px] = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
          }
      }));
  await Promise.all(jobs);

  const cols = Math.floor((2 * halfW) / STEP) + 1, rows = Math.floor((2 * halfD) / STEP) + 1;
  const heights = new Float32Array(cols * rows);
  const sample = (fx, fy) => {
    const x = Math.max(0, Math.min(W - 1.001, fx - tx0 * 256)), y = Math.max(0, Math.min(H - 1.001, fy - ty0 * 256));
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = mosaic[yi * W + xi], b = mosaic[yi * W + xi + 1], c = mosaic[(yi + 1) * W + xi], d = mosaic[(yi + 1) * W + xi + 1];
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
  };
  for (let r = 0; r < rows; r++) {
    const lat = LAT0 - (-halfD + r * STEP) / M_PER_DEG_LAT;
    for (let c = 0; c < cols; c++) {
      const lon = LON0 + (-halfW + c * STEP) / M_PER_DEG_LON;
      const [fx, fy] = lonLatToTile(lon, lat, ZOOM);
      heights[r * cols + c] = sample(fx * 256, fy * 256);
    }
  }
  // Light smoothing to hide DEM noise.
  const smoothed = new Float32Array(heights);
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++) {
      let s = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += heights[(r + dr) * cols + c + dc];
      smoothed[r * cols + c] = s / 9;
    }
  return { heights: smoothed, cols, rows, step: STEP, originX: -halfW, originZ: -halfD };
}

function makeSampler(t) {
  const { cols, rows, step, originX, originZ, heights } = t;
  return (x, z) => {
    let fx = (x - originX) / step, fz = (z - originZ) / step;
    fx = Math.max(0, Math.min(cols - 1.0001, fx)); fz = Math.max(0, Math.min(rows - 1.0001, fz));
    const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
    return (heights[r * cols + c] * (1 - u) + heights[r * cols + c + 1] * u) * (1 - v) + (heights[(r + 1) * cols + c] * (1 - u) + heights[(r + 1) * cols + c + 1] * u) * v;
  };
}

// ---- OSM ----
const LANDMARKS = { 23723663: 'vijecnica', 23723950: 'holiday', 23724013: 'parlament_low', 23724025: 'parlament_tower', 175903111: 'avaz', 474428386: 'katedrala', 609903435: 'begova' };
const ROAD_TYPES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'pedestrian'];
const FOOT_TYPES = ['footway', 'path', 'cycleway', 'steps'];

const CACHE = 'scripts/.cache-osm.json';
async function fetchOSM() {
  if (fs.existsSync(CACHE) && !process.argv.includes('--refresh')) {
    console.log('osm: using cached response (pass --refresh to re-query)');
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  }
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const q = `[out:json][timeout:180];
(
  way["highway"~"^(${ROAD_TYPES.join('|')})$"](${b});
  way["highway"~"^(${FOOT_TYPES.join('|')})$"]["bridge"](${b});
  way["building"](${b});
  way["railway"="tram"](${b});
  way["waterway"~"^(river|stream|canal)$"](${b});
  way["natural"="water"](${b});
  way["landuse"~"^(forest|grass|cemetery|meadow)$"](${b});
  way["leisure"="park"](${b});
  way["natural"="wood"](${b});
  node["place"~"^(suburb|neighbourhood|quarter|hamlet|village)$"]["name"](${b});
  node["highway"="traffic_signals"](${b});
);
out body; >; out skel qt;`;
  console.log('osm: querying overpass…');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  fs.writeFileSync(CACHE, JSON.stringify(json));
  return json;
}

function processOSM(json) {
  const nodes = new Map();
  for (const el of json.elements) if (el.type === 'node') nodes.set(el.id, toLocal(el.lat, el.lon));
  const roads = [], buildings = [], tram = [], waterways = [], waterAreas = [], green = [], places = [], signals = [];
  for (const el of json.elements) if (el.type === 'node' && el.tags?.highway === 'traffic_signals') {
    const [x, z] = toLocal(el.lat, el.lon);
    signals.push([r1(x), r1(z)]);
  }
  for (const el of json.elements) if (el.type === 'node' && el.tags?.place && el.tags.name) {
    const [x, z] = toLocal(el.lat, el.lon);
    places.push({ name: el.tags.name, kind: el.tags.place, x: Math.round(x), z: Math.round(z) });
  }
  const ptsOf = (way) => way.nodes.map((id) => nodes.get(id)).filter(Boolean).map(([x, z]) => [r1(x), r1(z)]);
  const dropClose = (pts) => { if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop(); return pts; };

  for (const el of json.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    const pts = ptsOf(el);
    if (pts.length < 2) continue;
    if (t.highway) {
      const foot = FOOT_TYPES.includes(t.highway);
      if (foot && !t.bridge) continue;
      roads.push({ type: foot ? 'footbridge' : t.highway, name: t.name, pts, tram: t.embedded_rails === 'tram' || undefined, bridge: t.bridge ? true : undefined, oneway: t.oneway === 'yes' || t.oneway === '-1' || t.oneway === '1' || undefined, lanes: parseInt(t.lanes) || undefined });
    } else if (t.building) {
      if (pts.length < 4) continue;
      let h = parseFloat(t.height);
      if (!h && t['building:levels']) h = parseFloat(t['building:levels']) * 3.2;
      buildings.push({ pts, h: r1(h || 0), kind: t.building, landmark: LANDMARKS[el.id] });
    } else if (t.railway === 'tram') {
      tram.push(pts);
    } else if (t.waterway) {
      waterways.push({ kind: t.waterway, name: t.name, pts });
    } else if (t.natural === 'water') {
      if (pts.length >= 3) waterAreas.push({ name: t.name, pts: dropClose(pts) });
    } else if (t.landuse || t.leisure || t.natural === 'wood') {
      green.push({ kind: t.landuse || t.leisure || 'forest', pts });
    }
  }
  console.log(`osm: ${roads.length} roads (${roads.filter((r) => r.bridge).length} bridges), ${buildings.length} buildings, ${tram.length} tram, ${waterways.length} waterways, ${waterAreas.length} water areas, ${green.length} green, ${places.length} places, ${signals.length} traffic signals`);
  return { roads, buildings, tram, waterways, waterAreas, green, places, signals };
}

// ---- Road widths, building conflicts, dangling ends ----
const RW_BASE = { motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6, living_street: 5.5, service: 4, pedestrian: 5 };
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
function nominalWidth(r) {
  const st = RW_BASE[r.type.replace('_link', '')] || 6;
  if (r.lanes) return Math.max(3.5, Math.min(st * 1.3, r.lanes * 3.4 + (r.oneway ? 0.5 : 1)));
  if (r.oneway && st >= 8) return st * 0.62;
  return st;
}
function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
  return Math.hypot(ax + vx * t - x, az + vz * t - z);
}
function fitRoadsToBuildings(osm, sampleH) {
  // grid of building edges
  const CELL = 20, bg = new Map();
  const gk = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  osm.buildings.forEach((b, bi) => {
    const pts = b.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      for (let cx = Math.floor(Math.min(a[0], c[0]) / CELL); cx <= Math.floor(Math.max(a[0], c[0]) / CELL); cx++)
        for (let cz = Math.floor(Math.min(a[1], c[1]) / CELL); cz <= Math.floor(Math.max(a[1], c[1]) / CELL); cz++) {
          const k = `${cx},${cz}`; if (!bg.has(k)) bg.set(k, []); bg.get(k).push([a[0], a[1], c[0], c[1], bi]);
        }
    }
  });
  const clearanceAt = (x, z) => {
    let best = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = bg.get(`${cx + dx},${cz + dz}`); if (!l) continue;
      for (const [ax, az, bx, bz] of l) { const d = segDist(x, z, ax, az, bx, bz); if (d < best) best = d; }
    }
    return best;
  };
  // 1. adaptive width for minor roads: narrow lanes hemmed in by houses
  let narrowed = 0;
  for (const r of osm.roads) {
    const w0 = nominalWidth(r);
    r.w = Math.round(w0 * 10) / 10;
    if (!['residential', 'unclassified', 'living_street', 'service', 'pedestrian'].includes(r.type) || r.bridge) continue;
    const cl = [];
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i]; const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 4));
      for (let k = 0; k <= n; k++) cl.push(clearanceAt(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n));
    }
    cl.sort((a, b) => a - b);
    const c10 = cl[Math.floor(cl.length * 0.1)] ?? Infinity; // 10th percentile clearance to a building edge
    const w = Math.max(3.2, Math.min(w0, 2 * (c10 - 0.5)));
    if (w < w0 - 0.2) { r.w = Math.round(w * 10) / 10; narrowed++; }
  }
  // 2. buildings that still sit on a road: drop them (centroid on road, or ≥ half the outline on road)
  const CELL2 = 40, rg = new Map();
  for (const r of osm.roads) {
    if (!DRIVABLE.has(r.type) && r.type !== 'service') continue;
    const hw = r.w / 2 + 0.2;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      for (let cx = Math.floor((Math.min(ax, bx) - hw) / CELL2); cx <= Math.floor((Math.max(ax, bx) + hw) / CELL2); cx++)
        for (let cz = Math.floor((Math.min(az, bz) - hw) / CELL2); cz <= Math.floor((Math.max(az, bz) + hw) / CELL2); cz++) {
          const k = `${cx},${cz}`; if (!rg.has(k)) rg.set(k, []); rg.get(k).push([ax, az, bx, bz, hw, r]);
        }
    }
  }
  const roadAt = (x, z) => {
    const l = rg.get(`${Math.floor(x / CELL2)},${Math.floor(z / CELL2)}`); if (!l) return null;
    for (const [ax, az, bx, bz, hw, r] of l) if (segDist(x, z, ax, az, bx, bz) < hw) return r;
    return null;
  };
  const before = osm.buildings.length; let underBridgeKept = 0;
  osm.buildings = osm.buildings.filter((b) => {
    if (b.landmark) return true;
    const pts = b.pts; let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
    let hits = 0, bridgeHits = 0, road = null;
    for (const [x, z] of pts) { const r = roadAt(x, z); if (r) { hits++; road = r; if (r.bridge) bridgeHits++; } }
    const cr = roadAt(cx, cz); if (cr) { hits += 2; road = cr; if (cr.bridge) bridgeHits += 2; }
    if (hits < 2) return true;
    if (road && road.bridge && bridgeHits === hits) {
      // under an elevated road: keep only if the building top stays below the deck
      const deck = Math.max(sampleH(road.pts[0][0], road.pts[0][1]), sampleH(road.pts.at(-1)[0], road.pts.at(-1)[1]));
      let base = Infinity; for (const [x, z] of pts) base = Math.min(base, sampleH(x, z));
      const top = base + (b.h || 6);
      if (top < deck - 0.5) { underBridgeKept++; return true; }
    }
    return false;
  });
  console.log(`roads: ${narrowed} lanes narrowed to fit between buildings; ${before - osm.buildings.length} buildings removed from road surfaces (${underBridgeKept} kept under bridges)`);
  // 3. snap dangling ends onto the road they nearly touch
  const nodeCount = new Map();
  for (const r of osm.roads) if (DRIVABLE.has(r.type)) for (const p of r.pts) { const k = `${p[0]},${p[1]}`; nodeCount.set(k, (nodeCount.get(k) || 0) + 1); }
  let snapped = 0;
  for (const r of osm.roads) {
    if (!DRIVABLE.has(r.type)) continue;
    for (const ei of [0, r.pts.length - 1]) {
      const end = r.pts[ei];
      if (nodeCount.get(`${end[0]},${end[1]}`) > 1) continue;
      let best = 6, hit = null;
      for (const o of osm.roads) {
        if (o === r || !DRIVABLE.has(o.type)) continue;
        for (let i = 1; i < o.pts.length; i++) {
          const [ax, az] = o.pts[i - 1], [bx, bz] = o.pts[i];
          if (Math.abs(ax - end[0]) > 30 && Math.abs(bx - end[0]) > 30) continue;
          const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
          const t = Math.max(0, Math.min(1, ((end[0] - ax) * vx + (end[1] - az) * vz) / l2));
          const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - end[0], pz - end[1]);
          if (d < best && d > 0.2) { best = d; hit = { o, i, p: [r1(px), r1(pz)] }; }
        }
      }
      if (hit) { r.pts[ei] = hit.p; hit.o.pts.splice(hit.i, 0, hit.p); snapped++; }
    }
  }
  console.log(`roads: ${snapped} dangling road ends snapped to the road they touch`);
}

// ---- Road terracing: flatten the terrain across each road to a smoothed profile (cut & fill) ----
const ROAD_HW = { motorway: 7, trunk: 6.5, primary: 6, secondary: 5, tertiary: 4, residential: 3.3, unclassified: 3, living_street: 2.8, service: 2, pedestrian: 2.5 };
function flattenRoads(terrain, osm) {
  const { cols, rows, step, originX, originZ, heights } = terrain;
  const orig = new Float32Array(heights);
  terrain.orig = orig;
  const sampleOrig = makeSampler({ ...terrain, heights: orig });
  const CELL = 16, grid = new Map();
  const gk = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  let nS = 0;
  // per-road smoothed profiles first, then reconcile heights at shared nodes
  const profiles = [];
  const nodeAcc = new Map(); // node key -> [sum, n]
  for (const r of osm.roads) {
    if (r.bridge || r.type === 'footbridge') continue;
    const hw = (r.w ? r.w / 2 : (ROAD_HW[r.type.replace('_link', '')] || 3)) + 1.2 + STEP * 0.75; // pin every vertex whose cell touches the road
    const dense = [];
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 4));
      for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    dense.push(r.pts.at(-1));
    const raw = dense.map(([x, z]) => sampleOrig(x, z));
    const win = 6; // ±24 m moving average along the road
    const prof = raw.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - win); k <= Math.min(raw.length - 1, i + win); k++) { s += raw[k]; n++; } return s / n; });
    // node keys for the original vertices (every 4 m dense point that coincides with a vertex)
    const isNode = dense.map(([x, z]) => r.pts.some((p) => p[0] === x && p[1] === z) ? `${x},${z}` : null);
    const imp = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3 }[r.type.replace('_link', '')] || 1;
    isNode.forEach((k, i) => { if (!k) return; const a = nodeAcc.get(k) || [0, 0, 0]; a[0] += prof[i] * imp; a[1] += imp; a[2]++; nodeAcc.set(k, a); });
    profiles.push({ dense, prof, isNode, hw, imp });
  }
  // blend every profile toward the shared junction height within 40 m of each junction
  let reconciled = 0;
  for (const P of profiles) {
    const target = P.prof.slice();
    const cum = [0]; for (let i = 1; i < P.dense.length; i++) cum.push(cum[i - 1] + Math.hypot(P.dense[i][0] - P.dense[i - 1][0], P.dense[i][1] - P.dense[i - 1][1]));
    const nodesHere = [];
    P.isNode.forEach((k, i) => { if (!k) return; const a = nodeAcc.get(k); if (a && a[2] > 1) nodesHere.push([i, a[0] / a[1]]); });
    if (nodesHere.length) {
      for (let i = 0; i < P.prof.length; i++) {
        let adj = 0, wsum = 0;
        for (const [ni, hN] of nodesHere) { const d = Math.abs(cum[i] - cum[ni]); if (d < 40) { const w = 1 - d / 40; adj += (hN - P.prof[ni]) * w; wsum += w; } }
        if (wsum > 0) { target[i] = P.prof[i] + adj / Math.max(1, wsum); reconciled++; }
      }
    }
    for (let i = 0; i < P.dense.length; i++) {
      const smp = { x: P.dense[i][0], z: P.dense[i][1], h: target[i], hw: P.hw };
      const k = gk(smp.x, smp.z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(smp); nS++;
    }
  }
  console.log(`roads: ${profiles.length} profiles, ${reconciled} samples reconciled at junctions`);
  terrain.roadGrid = grid; terrain.roadCell = CELL;
  let nFlat = 0;
  const BLEND = 5;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = originX + c * step, z = originZ + r * step;
      let best = Infinity, hit = null, inSum = 0, inW = 0;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const s of list) {
          const d = Math.hypot(s.x - x, s.z - z) - s.hw; // distance outside the road edge (negative = inside)
          if (d < best) { best = d; hit = s; }
          if (d < 0) { const w = d * d; inSum += s.h * w; inW += w; } // inside this road: blend by depth
        }
      }
      if (!hit || best >= BLEND) continue;
      const i = r * cols + c;
      if (best <= 0) heights[i] = inW > 0 ? inSum / inW : hit.h;
      else heights[i] = hit.h + (heights[i] - hit.h) * (best / BLEND);
      nFlat++;
    }
  console.log(`roads: ${nS} profile samples, ${nFlat} terrain vertices terraced`);
}

// ---- River carving ----
function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function carveRivers(terrain, osm) {
  const { cols, rows, step, originX, originZ, heights } = terrain;
  // river levels come from the ORIGINAL terrain (the DEM's water surface), not the road-terraced one
  const sampleH = makeSampler(terrain.orig ? { ...terrain, heights: terrain.orig } : terrain);
  const DEPTH = { river: 4.2, canal: 2.5, stream: 1.4 };
  const SURFACE = { river: 2.6, canal: 1.6, stream: 1.0 }; // water surface below bank level
  const RADIUS = { river: 9, canal: 4, stream: 4.5 };

  // 1. Smoothed, monotone-downstream level profile along every waterway.
  const samples = []; // {x, z, level, kind}
  const CELL = 40, grid = new Map();
  const gkey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const w of osm.waterways) {
    const dense = [];
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i];
      const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 8));
      for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    dense.push(w.pts.at(-1));
    const raw = dense.map(([x, z]) => sampleH(x, z));
    const win = w.kind === 'river' ? 25 : 8; // samples each side (~200 m / ~64 m)
    let level = raw.map((_, i) => {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - win); k <= Math.min(raw.length - 1, i + win); k++) { s += raw[k]; n++; }
      return s / n;
    });
    // flow direction: downhill overall
    const q = Math.max(1, Math.floor(level.length / 5));
    const head = level.slice(0, q).reduce((a, b) => a + b, 0) / q, tail = level.slice(-q).reduce((a, b) => a + b, 0) / q;
    const forward = head >= tail;
    const order = forward ? level.map((_, i) => i) : level.map((_, i) => level.length - 1 - i);
    let run = Infinity;
    for (const i of order) { run = Math.min(run, level[i]); level[i] = run; }
    // never let the water rise above riverside roads (gorge walls fool the DEM near Bentbaša)
    if (terrain.roadGrid) {
      const RC = terrain.roadCell;
      for (let i = 0; i < dense.length; i++) {
        const [x, z] = dense[i]; let minRoad = Infinity;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const l = terrain.roadGrid.get(`${Math.floor(x / RC) + dx},${Math.floor(z / RC) + dz}`); if (!l) continue;
          for (const s of l) if (Math.hypot(s.x - x, s.z - z) < 30) minRoad = Math.min(minRoad, s.h);
        }
        if (minRoad < Infinity) level[i] = Math.min(level[i], minRoad - (w.kind === 'river' ? 1.0 : 0.6) + SURFACE[w.kind]); // → surface ≥ 1 m below road
      }
      run = Infinity; for (const i of order) { run = Math.min(run, level[i]); level[i] = run; }
    }
    w.levels = dense.map((_, i) => r1(level[i] - SURFACE[w.kind]));
    w.dense = dense.map(([x, z]) => [r1(x), r1(z)]);
    dense.forEach(([x, z], i) => {
      const s = { x, z, level: level[i], kind: w.kind };
      samples.push(s);
      const k = gkey(x, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    });
  }
  function nearest(x, z, maxD, kindFilter) {
    let best = maxD * maxD, hit = null;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const s of list) {
        if (kindFilter && s.kind !== kindFilter) continue;
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < best) { best = d; hit = s; }
      }
    }
    return hit;
  }

  // Roads (except bridges) must keep their ground: build a segment grid and skip carving near them.
  const RW = { motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6, living_street: 5.5, service: 4, pedestrian: 5 };
  const roadGrid = new Map();
  for (const r of osm.roads) {
    if (r.bridge) continue;
    const hw = (r.w || RW[r.type.replace('_link', '')] || 6) / 2 + 3 + STEP * 0.75;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const c0 = Math.floor((Math.min(ax, bx) - hw) / CELL), c1 = Math.floor((Math.max(ax, bx) + hw) / CELL);
      const z0 = Math.floor((Math.min(az, bz) - hw) / CELL), z1 = Math.floor((Math.max(az, bz) + hw) / CELL);
      for (let cx = c0; cx <= c1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = `${cx},${cz}`;
        if (!roadGrid.has(k)) roadGrid.set(k, []);
        roadGrid.get(k).push([ax, az, bx, bz, hw]);
      }
    }
  }
  function nearRoad(x, z) {
    const segs = roadGrid.get(gkey(x, z));
    if (!segs) return false;
    for (const [ax, az, bx, bz, hw] of segs) {
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const dx = ax + vx * t - x, dz = az + vz * t - z;
      if (dx * dx + dz * dz < hw * hw) return true;
    }
    return false;
  }

  // 2. Carve: inside water-area polygons (the Miljacka riverbank) and along centrelines.
  let carved = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = originX + c * step, z = originZ + r * step, i = r * cols + c;
      const s = nearest(x, z, 60);
      if (!s || nearRoad(x, z)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= RADIUS[s.kind] + step * 0.5) {
        const target = s.level - DEPTH[s.kind];
        if (heights[i] > target) { heights[i] = target; carved++; }
      }
    }
  // Riverbank polygons: everything inside is channel bottom.
  for (const a of osm.waterAreas) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of a.pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const big = (maxx - minx) > 400 || (maxz - minz) > 400;
    a.levels = a.pts.map(([x, z]) => {
      const s = nearest(x, z, 120, big ? 'river' : undefined);
      return r1(s ? s.level - SURFACE[s.kind] : sampleH(x, z) - 0.3);
    });
    if (!big) continue;
    const c0 = Math.max(0, Math.floor((minx - originX) / step)), c1 = Math.min(cols - 1, Math.ceil((maxx - originX) / step));
    const r0 = Math.max(0, Math.floor((minz - originZ) / step)), r1_ = Math.min(rows - 1, Math.ceil((maxz - originZ) / step));
    for (let r = r0; r <= r1_; r++)
      for (let c = c0; c <= c1; c++) {
        const x = originX + c * step, z = originZ + r * step;
        if (!pointInPoly(x, z, a.pts) || nearRoad(x, z)) continue;
        const s = nearest(x, z, 120, 'river');
        if (!s) continue;
        const target = s.level - DEPTH.river, i = r * cols + c;
        if (heights[i] > target) { heights[i] = target; carved++; }
      }
  }
  console.log(`rivers: ${osm.waterways.length} waterways, ${samples.length} profile samples, ${carved} terrain vertices carved`);
}

// ---- Main ----
const [terrain, osm] = await Promise.all([buildTerrain(), fetchOSM().then(processOSM)]);
terrain.orig = new Float32Array(terrain.heights);
const sampleOrig = mkSampler({ ...terrain, heights: terrain.orig });
const nanCount = (label) => { let n = 0; for (const v of terrain.heights) if (!Number.isFinite(v)) n++; console.log(`  [nan check] ${label}: ${n}`); };
nanCount('after DEM');
smoothValley(terrain);                                             // 1. valley floor
nanCount('after smoothValley');
fitRoadsToBuildings(osm, mkSampler(terrain));                      // 2. widths, building conflicts, dangling ends
solveRoadProfiles(osm.roads, mkSampler(terrain));                  // 3. global road elevation solve → r.line
const SW = (r) => (['primary', 'secondary', 'trunk', 'primary_link', 'secondary_link'].includes(r.type) ? 3.0 : r.type === 'tertiary' ? 2.4 : ['service', 'pedestrian', 'living_street', 'footbridge'].includes(r.type) ? 0 : 1.8);
conformTerrain(terrain, osm.roads, (r) => r.w || nominalWidth(r), SW); // 4. terrain follows roads
nanCount('after conformTerrain');
const water = [
  ...osm.waterways.map((w) => ({ kind: w.kind, name: w.name, pts: w.pts })),
  ...osm.waterAreas.map((a) => ({ kind: 'area', name: a.name, pts: a.pts })),
];
buildRiver(terrain, water, osm.roads, sampleOrig);                 // 5. channel bed, quays, water levels
// streams: shallow gully + surface just below ground
const sampleNow = mkSampler(terrain);
for (const w of water) {
  if (w.kind === 'river' || w.kind === 'area') { if (w.dense) { w.pts = w.dense; delete w.dense; } continue; }
  const dense = [];
  for (let i = 1; i < w.pts.length; i++) { const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i]; const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 8)); for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); }
  dense.push(w.pts.at(-1));
  w.pts = dense.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]);
  w.levels = dense.map(([x, z]) => +(sampleNow(x, z) - 0.35).toFixed(2));
}
let minH = Infinity, maxH = -Infinity;
for (const h of terrain.heights) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
fs.writeFileSync('public/data/terrain.bin', Buffer.from(terrain.heights.buffer));
fs.writeFileSync('public/data/terrain.json', JSON.stringify({ cols: terrain.cols, rows: terrain.rows, step: STEP, originX: -halfW, originZ: -halfD, minH, maxH }));
fs.writeFileSync('public/data/city.json', JSON.stringify({
  bbox: BBOX, center: [LAT0, LON0], halfW, halfD,
  roads: osm.roads, buildings: osm.buildings, tram: osm.tram, water, green: osm.green, places: osm.places, signals: osm.signals,
}));
const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(1) + 'MB';
console.log(`terrain: ${terrain.cols}x${terrain.rows} @ ${STEP} m, ${minH.toFixed(0)}–${maxH.toFixed(0)} m; written terrain.bin ${mb('public/data/terrain.bin')}, city.json ${mb('public/data/city.json')}`);
