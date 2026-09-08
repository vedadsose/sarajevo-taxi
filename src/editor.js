import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { roadWidth } from './city.js';
import { saveOverrides, clearOverrides } from './overrides.js';

/** In-game city editor (toggle with E): resize or delete roads, erase trees.
 *  Edits persist to localStorage as overrides; road changes take effect after a reload. */
export function createEditor({ scene, camera, world, data, trees, overrides }) {
  const panel = document.getElementById('editor');
  const els = {
    modeRoad: document.getElementById('ed-mode-road'),
    modeTree: document.getElementById('ed-mode-tree'),
    sel: document.getElementById('ed-selection'),
    name: document.getElementById('ed-name'),
    width: document.getElementById('ed-width'),
    widthVal: document.getElementById('ed-width-val'),
    del: document.getElementById('ed-delete'),
    count: document.getElementById('ed-count'),
    apply: document.getElementById('ed-apply'),
    reset: document.getElementById('ed-reset'),
    download: document.getElementById('ed-download'),
    hint: document.getElementById('ed-hint'),
  };
  let active = false, mode = 'road', selected = null, dirtyRoads = false, painting = false;
  let lastPaint = { x: 1e9, z: 1e9 };

  // ---- picking: camera ray → physics world → ground point ----
  const ndc = new THREE.Vector2(), rayDir = new THREE.Vector3();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  function groundPoint(ev) {
    const rect = ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    rayDir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    ray.origin.x = camera.position.x; ray.origin.y = camera.position.y; ray.origin.z = camera.position.z;
    ray.dir.x = rayDir.x; ray.dir.y = rayDir.y; ray.dir.z = rayDir.z;
    const hit = world.castRay(ray, 3000, true);
    if (!hit) return null;
    const t = hit.timeOfImpact ?? hit.toi;
    return { x: ray.origin.x + rayDir.x * t, y: ray.origin.y + rayDir.y * t, z: ray.origin.z + rayDir.z * t };
  }
  function pickRoad(p) {
    let best = Infinity, hit = null;
    for (const r of data.city.roads) {
      if (!r.line) continue;
      const tol = roadWidth(r) / 2 + 3, L = r.line;
      for (let i = 1; i < L.length; i++) {
        const a = L[i - 1], b = L[i];
        if (Math.abs(a[0] - p.x) > 60 && Math.abs(b[0] - p.x) > 60) continue;
        const vx = b[0] - a[0], vz = b[2] - a[2], l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a[0]) * vx + (p.z - a[2]) * vz) / l2));
        const dx = a[0] + vx * t - p.x, dz = a[2] + vz * t - p.z, d = Math.hypot(dx, dz);
        if (d < tol && d < best) { best = d; hit = r; }
      }
    }
    return hit;
  }

  // ---- highlight ribbon + tree brush ring ----
  const hlMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.4, depthWrite: false });
  let hlMesh = null;
  function highlight(r, color = '#ffd23f') {
    if (hlMesh) { scene.remove(hlMesh); hlMesh.geometry.dispose(); hlMesh = null; }
    if (!r) return;
    hlMat.color.set(color);
    const w = (overrides.roadWidths[r.id] ?? roadWidth(r)) + 0.6, L = r.line, P = [];
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1];
      let dx = b[0] - a[0], dz = b[2] - a[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const ox = -dz * w / 2, oz = dx * w / 2;
      P.push(a[0] + ox, a[1] + 0.18, a[2] + oz, b[0] + ox, b[1] + 0.18, b[2] + oz, a[0] - ox, a[1] + 0.18, a[2] - oz);
      P.push(a[0] - ox, a[1] + 0.18, a[2] - oz, b[0] + ox, b[1] + 0.18, b[2] + oz, b[0] - ox, b[1] + 0.18, b[2] - oz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.computeBoundingSphere();
    hlMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial().copy(hlMat));
    hlMesh.material.side = THREE.DoubleSide;
    scene.add(hlMesh);
  }
  const brush = new THREE.Mesh(new THREE.RingGeometry(5.4, 6, 32), new THREE.MeshBasicMaterial({ color: '#ff5544', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  brush.rotation.x = -Math.PI / 2; brush.visible = false; scene.add(brush);

  // ---- state / UI ----
  const editCount = () => Object.keys(overrides.roadWidths).length + overrides.deletedRoads.length + overrides.treeExclusions.length;
  function refresh() {
    els.count.textContent = `${editCount()} izmjena`;
    els.apply.style.display = dirtyRoads ? 'inline-block' : 'none';
    els.modeRoad.classList.toggle('on', mode === 'road');
    els.modeTree.classList.toggle('on', mode === 'tree');
    els.hint.textContent = mode === 'road' ? 'Klikni cestu da je odabereš' : 'Klikni ili povuci preko drveća da ga obrišeš';
    if (selected) {
      els.sel.style.display = 'block';
      els.name.textContent = `${selected.name || selected.type}${selected.bridge ? ' (most)' : ''} · ${selected.type}`;
      const w = overrides.roadWidths[selected.id] ?? roadWidth(selected);
      els.width.value = w; els.widthVal.textContent = `${(+w).toFixed(1)} m`;
      els.del.textContent = overrides.deletedRoads.includes(selected.id) ? 'Vrati cestu' : 'Obriši cestu';
    } else els.sel.style.display = 'none';
  }
  function select(r) {
    selected = r;
    if (r) highlight(r, overrides.deletedRoads.includes(r.id) ? '#ff5544' : '#ffd23f');
    else highlight(null);
    refresh();
  }
  function setMode(m) { mode = m; select(null); brush.visible = m === 'tree'; refresh(); }
  els.modeRoad.addEventListener('click', () => setMode('road'));
  els.modeTree.addEventListener('click', () => setMode('tree'));
  els.width.addEventListener('input', () => {
    if (!selected) return;
    overrides.roadWidths[selected.id] = +els.width.value;
    els.widthVal.textContent = `${(+els.width.value).toFixed(1)} m`;
    saveOverrides(overrides); dirtyRoads = true; highlight(selected); refresh();
  });
  els.del.addEventListener('click', () => {
    if (!selected) return;
    const i = overrides.deletedRoads.indexOf(selected.id);
    if (i >= 0) overrides.deletedRoads.splice(i, 1); else overrides.deletedRoads.push(selected.id);
    saveOverrides(overrides); dirtyRoads = true; select(selected);
  });
  els.apply.addEventListener('click', () => location.reload());
  els.reset.addEventListener('click', () => { if (confirm('Poništiti sve izmjene?')) { clearOverrides(); location.reload(); } });
  els.download.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'overrides.json'; a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---- pointer handlers ----
  function onMove(ev) {
    if (!active) return;
    const p = groundPoint(ev); if (!p) return;
    if (mode === 'tree') {
      brush.position.set(p.x, p.y + 0.25, p.z);
      if (painting && Math.hypot(p.x - lastPaint.x, p.z - lastPaint.z) > 2.5) {
        lastPaint = p;
        if (trees.hideNear(p.x, p.z, 6) > 0) { overrides.treeExclusions.push([+p.x.toFixed(1), +p.z.toFixed(1), 6]); refresh(); }
      }
    }
  }
  function onDown(ev) {
    if (!active || ev.button !== 0) return;
    const p = groundPoint(ev); if (!p) return;
    if (mode === 'road') select(pickRoad(p));
    else {
      painting = true; lastPaint = p;
      if (trees.hideNear(p.x, p.z, 6) > 0) { overrides.treeExclusions.push([+p.x.toFixed(1), +p.z.toFixed(1), 6]); refresh(); }
    }
  }
  function onUp() { if (painting) { painting = false; saveOverrides(overrides); } }
  const canvas = document.getElementById('game');
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  function toggle() {
    active = !active;
    panel.style.display = active ? 'block' : 'none';
    brush.visible = active && mode === 'tree';
    if (!active) select(null);
    refresh();
  }
  refresh();
  return { toggle, get active() { return active; } };
}
