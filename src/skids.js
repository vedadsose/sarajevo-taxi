import * as THREE from 'three';

const MAX = 2500; // skid quads kept (ring buffer)

export function createSkids(scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 6 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ color: '#141414', transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2;
  scene.add(mesh);
  let head = 0, count = 0;
  const last = [null, null];

  // smoke sprites
  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const g = sc.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(230,230,230,0.7)'); grd.addColorStop(1, 'rgba(230,230,230,0)'); g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const smokeTex = new THREE.CanvasTexture(sc);
  const puffs = Array.from({ length: 40 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false })); s.visible = false; scene.add(s); return { s, life: 0, vx: 0, vz: 0 }; });
  let puffIdx = 0;

  function mark(wheelIdx, x, y, z, dirX, dirZ) {
    const prev = last[wheelIdx];
    last[wheelIdx] = [x, y, z];
    if (!prev) return;
    const hw = 0.13; const nx = -dirZ * hw, nz = dirX * hw;
    const i = head * 18;
    const a = [prev[0] - nx, prev[1], prev[2] - nz], b = [prev[0] + nx, prev[1], prev[2] + nz], c = [x + nx, y, z + nz], d = [x - nx, y, z - nz];
    pos.set([...a, ...c, ...b, ...a, ...d, ...c], i);
    head = (head + 1) % MAX; count = Math.min(MAX, count + 1);
    geo.setDrawRange(0, count * 6); geo.attributes.position.needsUpdate = true;
  }
  function puff(x, y, z) {
    const p = puffs[puffIdx++ % puffs.length];
    p.s.position.set(x, y, z); p.s.scale.setScalar(0.6); p.s.material.opacity = 0.35; p.s.visible = true; p.life = 1.1; p.vx = (Math.random() - 0.5) * 0.8; p.vz = (Math.random() - 0.5) * 0.8;
  }
  /** rearWheels: [{x,y,z}] world contact points; dir: heading unit vector; skidding: bool */
  function update(dt, rearWheels, dir, skidding) {
    if (skidding) {
      rearWheels.forEach((w, i) => { mark(i, w.x, w.y + 0.02, w.z, dir.x, dir.z); if (Math.random() < 0.5) puff(w.x, w.y + 0.2, w.z); });
    } else { last[0] = last[1] = null; }
    for (const p of puffs) {
      if (!p.s.visible) continue;
      p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
      p.s.position.x += p.vx * dt; p.s.position.z += p.vz * dt; p.s.position.y += 0.8 * dt;
      p.s.scale.setScalar(0.6 + (1.1 - p.life) * 1.6); p.s.material.opacity = 0.35 * (p.life / 1.1);
    }
  }
  return { update };
}
