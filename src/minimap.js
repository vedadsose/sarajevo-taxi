const ROAD_W = { motorway: 5, trunk: 5, primary: 4, secondary: 3.2, tertiary: 2.4, residential: 1.5, unclassified: 1.4, living_street: 1.2, service: 0.8, pedestrian: 1.2 };
const ROAD_C = { motorway: '#f0e6d0', trunk: '#f0e6d0', primary: '#e8dfca', secondary: '#cfc7b6', tertiary: '#b3aea3', pedestrian: '#a58f6e' };

export function createMinimap(data) {
  const city = data.city;
  const SCALE = 0.25; // px per metre on the base map
  const W = Math.ceil(city.halfW * 2 * SCALE), H = Math.ceil(city.halfD * 2 * SCALE);
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const b = base.getContext('2d');
  const mx = (x) => (x + city.halfW) * SCALE, my = (z) => (z + city.halfD) * SCALE;
  b.fillStyle = '#1a2130'; b.fillRect(0, 0, W, H);
  const poly = (pts, fill) => { b.beginPath(); pts.forEach(([x, z], i) => (i ? b.lineTo(mx(x), my(z)) : b.moveTo(mx(x), my(z)))); b.closePath(); b.fillStyle = fill; b.fill(); };
  for (const g of city.green) poly(g.pts, g.kind === 'forest' || g.kind === 'wood' ? '#243a2c' : '#2b4a33');
  b.fillStyle = '#2b3446'; for (const bl of city.buildings) poly(bl.pts, '#2b3446');
  b.lineCap = 'round'; b.lineJoin = 'round';
  for (const w of city.water) {
    if (w.kind === 'area') { poly(w.pts, '#3d7aa8'); continue; }
    b.beginPath(); w.pts.forEach(([x, z], i) => (i ? b.lineTo(mx(x), my(z)) : b.moveTo(mx(x), my(z))));
    b.strokeStyle = '#3d7aa8'; b.lineWidth = w.kind === 'river' ? 3.5 : 1.2; b.stroke();
  }
  const order = ['service', 'living_street', 'pedestrian', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
  for (const t of order) for (const r of city.roads) {
    if ((r.type.replace('_link', '')) !== t) continue;
    b.beginPath(); r.pts.forEach(([x, z], i) => (i ? b.lineTo(mx(x), my(z)) : b.moveTo(mx(x), my(z))));
    b.strokeStyle = ROAD_C[t] || '#8f8f95'; b.lineWidth = (ROAD_W[t] || 1) * (r.oneway && (ROAD_W[t] || 1) >= 3 ? 0.65 : 1); b.stroke();
  }
  for (const t of city.tram) { b.beginPath(); t.forEach(([x, z], i) => (i ? b.lineTo(mx(x), my(z)) : b.moveTo(mx(x), my(z)))); b.strokeStyle = '#c0392b'; b.lineWidth = 1; b.stroke(); }

  const el = document.getElementById('minimap');
  const S = el.width; const ctx = el.getContext('2d');
  const ZOOM = 1.6; // base px → screen px

  function currentPlace(x, z) {
    let best = 700 * 700, name = null;
    for (const p of city.places) {
      if (p.kind === 'hamlet') continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; name = p.name; }
    }
    return name;
  }

  function update(x, z, yaw, marker) {
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.clip();
    const view = S / ZOOM; // base px covered
    const sx = mx(x) - view / 2, sy = my(z) - view / 2;
    ctx.fillStyle = '#1a2130'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(base, sx, sy, view, view, 0, 0, S, S);
    // place labels
    ctx.font = 'bold 11px Helvetica, Arial'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4;
    for (const p of city.places) {
      if (p.kind !== 'suburb' && p.kind !== 'quarter') continue;
      const px = (mx(p.x) - sx) * ZOOM, py = (my(p.z) - sy) * ZOOM;
      if (px < 10 || py < 10 || px > S - 10 || py > S - 10) continue;
      ctx.fillText(p.name.toUpperCase(), px, py);
    }
    ctx.shadowBlur = 0;
    // fare marker (clamped to the rim if off-map)
    if (marker) {
      let mx2 = (mx(marker.x) - sx) * ZOOM - S / 2, my2 = (my(marker.z) - sy) * ZOOM - S / 2;
      const d = Math.hypot(mx2, my2), R = S / 2 - 12;
      if (d > R) { mx2 *= R / d; my2 *= R / d; }
      ctx.beginPath(); ctx.arc(S / 2 + mx2, S / 2 + my2, 6, 0, Math.PI * 2);
      ctx.fillStyle = marker.color || '#ffd23f'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // player arrow
    ctx.translate(S / 2, S / 2); ctx.rotate(Math.atan2(Math.sin(yaw), -Math.cos(yaw)));
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    // ring + north
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = 'bold 12px Helvetica, Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('N', S / 2, 16);
  }
  // ---- full-screen map: click to teleport ----
  const big = document.getElementById('bigmap'), bigCanvas = document.getElementById('bigmap-canvas');
  const bctx = bigCanvas.getContext('2d');
  let bigOpen = false, view = null, last = { x: 0, z: 0, yaw: 0, marker: null };
  function layout() {
    bigCanvas.width = window.innerWidth; bigCanvas.height = window.innerHeight;
    const pad = 40, sc = Math.min((bigCanvas.width - pad * 2) / W, (bigCanvas.height - pad * 2) / H);
    view = { sc, ox: (bigCanvas.width - W * sc) / 2, oy: (bigCanvas.height - H * sc) / 2 };
  }
  const toScreen = (x, z) => [view.ox + mx(x) * view.sc, view.oy + my(z) * view.sc];
  const toWorld = (sx, sy) => [(sx - view.ox) / view.sc / SCALE - city.halfW, (sy - view.oy) / view.sc / SCALE - city.halfD];
  function drawBig() {
    if (!view) layout();
    bctx.fillStyle = '#0d1118'; bctx.fillRect(0, 0, bigCanvas.width, bigCanvas.height);
    bctx.drawImage(base, view.ox, view.oy, W * view.sc, H * view.sc);
    bctx.font = 'bold 12px Helvetica, Arial'; bctx.textAlign = 'center'; bctx.fillStyle = 'rgba(255,255,255,.9)'; bctx.shadowColor = 'rgba(0,0,0,.9)'; bctx.shadowBlur = 4;
    for (const p of city.places) { if (p.kind !== 'suburb' && p.kind !== 'quarter') continue; const [px, py] = toScreen(p.x, p.z); bctx.fillText(p.name.toUpperCase(), px, py); }
    bctx.shadowBlur = 0;
    if (last.marker) { const [px, py] = toScreen(last.marker.x, last.marker.z); bctx.beginPath(); bctx.arc(px, py, 7, 0, Math.PI * 2); bctx.fillStyle = last.marker.color || '#ffd23f'; bctx.fill(); bctx.strokeStyle = '#000'; bctx.lineWidth = 1.5; bctx.stroke(); }
    const [px, py] = toScreen(last.x, last.z);
    bctx.save(); bctx.translate(px, py); bctx.rotate(Math.atan2(Math.sin(last.yaw), -Math.cos(last.yaw)));
    bctx.beginPath(); bctx.moveTo(0, -11); bctx.lineTo(7, 9); bctx.lineTo(0, 5); bctx.lineTo(-7, 9); bctx.closePath(); bctx.fillStyle = '#ffd23f'; bctx.fill(); bctx.strokeStyle = '#000'; bctx.lineWidth = 1.5; bctx.stroke(); bctx.restore();
  }
  let onSpawn = null;
  bigCanvas.addEventListener('click', (e) => { if (!view) return; const [x, z] = toWorld(e.clientX, e.clientY); if (Math.abs(x) < city.halfW && Math.abs(z) < city.halfD && onSpawn) { onSpawn(x, z); closeBig(); } });
  window.addEventListener('resize', () => { if (bigOpen) { layout(); drawBig(); } });
  document.getElementById('bigmap-close').addEventListener('click', () => closeBig());
  function openBig() { bigOpen = true; big.classList.add('open'); layout(); drawBig(); }
  function closeBig() { bigOpen = false; big.classList.remove('open'); }
  el.addEventListener('click', () => (bigOpen ? closeBig() : openBig()));

  const baseUpdate = update;
  function update2(x, z, yaw, marker) { last = { x, z, yaw, marker }; baseUpdate(x, z, yaw, marker); if (bigOpen) drawBig(); }
  return { update: update2, currentPlace, openBig, closeBig, toggleBig: () => (bigOpen ? closeBig() : openBig()), get isOpen() { return bigOpen; }, set onSpawn(fn) { onSpawn = fn; } };
}
