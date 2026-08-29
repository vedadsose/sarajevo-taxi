import * as THREE from 'three';

const N = 5000, BOX = 44, H = 26;

export function createWeather(scene) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * BOX; p[i * 3 + 1] = Math.random() * H; p[i * 3 + 2] = (Math.random() - 0.5) * BOX; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  // streak texture so each point reads as a falling drop, not a square
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(210,222,240,0)'); grd.addColorStop(0.5, 'rgba(210,222,240,0.9)'); grd.addColorStop(1, 'rgba(210,222,240,0)');
  g.fillStyle = grd; g.fillRect(6, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.PointsMaterial({ map: tex, color: '#dfe7f2', size: 0.7, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true, alphaTest: 0.02 });
  const rain = new THREE.Points(geo, mat); rain.frustumCulled = false; rain.visible = false;
  scene.add(rain);
  let on = false, intensity = 0; // 0..1 fade
  const listeners = [];
  return {
    get raining() { return on; },
    toggle() { on = !on; },
    onChange(fn) { listeners.push(fn); },
    update(dt, camPos, camDir) {
      intensity += ((on ? 1 : 0) - intensity) * Math.min(1, dt * 0.8);
      rain.visible = intensity > 0.02;
      mat.opacity = 0.5 * intensity;
      for (const fn of listeners) fn(intensity);
      if (!rain.visible) return;
      // keep the rain volume centred a bit ahead of the camera
      rain.position.set(camPos.x + camDir.x * 12, camPos.y - 8, camPos.z + camDir.z * 12);
      const a = geo.attributes.position.array;
      const fall = 18 * dt, windX = 2.5 * dt;
      for (let i = 0; i < N; i++) {
        a[i * 3 + 1] -= fall; a[i * 3] += windX;
        if (a[i * 3 + 1] < 0) { a[i * 3 + 1] += H; a[i * 3] = (Math.random() - 0.5) * BOX; a[i * 3 + 2] = (Math.random() - 0.5) * BOX; }
        if (a[i * 3] > BOX / 2) a[i * 3] -= BOX;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
