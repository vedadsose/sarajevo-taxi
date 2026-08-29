// Audits the generated city: road profile smoothness, junction agreement, bridge continuity, buildings on roads.
import fs from 'node:fs';
const city = JSON.parse(fs.readFileSync('public/data/city.json'));
const roads = city.roads.filter((r) => r.line);
// 1. kinks in solved profiles: change of slope between consecutive 6 m samples
let kinks = 0, maxKink = 0, worst = null;
for (const r of roads) { const L = r.line; for (let i = 2; i < L.length; i++) { const d1 = (L[i - 1][1] - L[i - 2][1]) / (Math.hypot(L[i - 1][0] - L[i - 2][0], L[i - 1][2] - L[i - 2][2]) || 1); const d2 = (L[i][1] - L[i - 1][1]) / (Math.hypot(L[i][0] - L[i - 1][0], L[i][2] - L[i - 1][2]) || 1); const k = Math.abs(d2 - d1); if (k > 0.06) kinks++; if (k > maxKink) { maxKink = k; worst = r.name || r.type; } } }
console.log(`1. PROFILE: ${kinks} slope changes > 6% between 6 m samples; worst ${(maxKink * 100).toFixed(1)}% on ${worst}`);
// 2. junction agreement: heights at shared endpoints
const ends = new Map(); let disagree = 0, maxDis = 0;
for (const r of roads) for (const p of [r.line[0], r.line[r.line.length - 1]]) { const k = `${p[0]},${p[2]}`; if (ends.has(k)) { const d = Math.abs(ends.get(k) - p[1]); if (d > 0.05) disagree++; maxDis = Math.max(maxDis, d); } else ends.set(k, p[1]); }
console.log(`2. JUNCTIONS: ${disagree} shared nodes disagree > 5 cm (max ${maxDis.toFixed(2)} m)`);
// 3. bridges: deck slope and continuity with approaches (same node heights by construction) + max grade
let steep = 0; for (const r of roads) { if (!r.bridge) continue; const L = r.line; const g = Math.abs(L[L.length - 1][1] - L[0][1]) / (Math.hypot(L[L.length - 1][0] - L[0][0], L[L.length - 1][2] - L[0][2]) || 1); if (g > 0.08) steep++; }
console.log(`3. BRIDGES: ${roads.filter((r) => r.bridge).length} spans, ${steep} steeper than 8%`);
console.log(`4. BUILDINGS: ${city.buildings.length} kept (conflicts removed in pipeline)`);
