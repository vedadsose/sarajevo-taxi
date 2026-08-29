import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createEnvironment(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const sky = new Sky();
  sky.scale.setScalar(50000);
  scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.008; u.mieDirectionalG.value = 0.85;

  const sunDir = new THREE.Vector3();
  const sun = new THREE.DirectionalLight('#ffb27a', 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -140; sun.shadow.camera.right = 140;
  sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 1.4;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight('#7f9bd0', 0);
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight('#a9b8dc', '#7a6555', 1.25);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2('#d8a684', 0.00075);

  // stars: a few thousand points, faded in at night
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(2500 * 3);
  for (let i = 0; i < 2500; i++) { const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95); const r = 30000; sp[i * 3] = r * Math.sin(ph) * Math.cos(th); sp[i * 3 + 1] = r * Math.cos(ph) + 200; sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 60, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const cDay = new THREE.Color('#fff4e0'), cGold = new THREE.Color('#ffb27a'), cDusk = new THREE.Color('#ff7a4a');
  const fogDay = new THREE.Color('#c9d3e0'), fogGold = new THREE.Color('#d8a684'), fogNight = new THREE.Color('#0a0e18');
  const hemiSkyDay = new THREE.Color('#a9b8dc'), hemiSkyNight = new THREE.Color('#1c2438'), hemiGndDay = new THREE.Color('#7a6555'), hemiGndNight = new THREE.Color('#0d0b10');
  const tmp = new THREE.Color();
  let night = 0, rain = 0;

  /** hours: 0–24. Sun rises ~5:30, sets ~19:30 (Sarajevo summer-ish). */
  function setTime(hours) {
    const t = ((hours - 5.5) / 14) ; // 0 at sunrise, 1 at sunset
    const elev = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 62 - (t < 0 || t > 1 ? 12 * Math.min(1, Math.abs(t < 0 ? t : t - 1) * 3) : 0);
    const azim = 75 + t * 200; // east → south → west
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(azim);
    sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunDir);
    const day = THREE.MathUtils.clamp(elev / 12, 0, 1);         // 1 when sun well up
    const golden = THREE.MathUtils.clamp(1 - elev / 25, 0, 1);  // 1 near the horizon
    night = 1 - THREE.MathUtils.clamp((elev + 6) / 10, 0, 1);   // 1 when well below horizon
    sun.intensity = 3.2 * day * (1 - 0.75 * rain);
    sun.color.copy(cDay).lerp(cGold, golden * 0.8).lerp(cDusk, THREE.MathUtils.clamp(1 - elev / 8, 0, 1) * 0.6);
    moon.intensity = 0.35 * night;
    hemi.intensity = 1.25 * (1 - night) + 0.22 * night;
    hemi.color.copy(hemiSkyDay).lerp(hemiSkyNight, night);
    hemi.groundColor.copy(hemiGndDay).lerp(hemiGndNight, night);
    scene.fog.color.copy(fogDay).lerp(fogGold, golden).lerp(fogNight, night);
    scene.fog.color.lerp(new THREE.Color('#6d7580'), rain * 0.7);
    scene.fog.density = 0.00075 + 0.0004 * night + 0.0016 * rain;
    renderer.toneMappingExposure = 0.95 - 0.25 * night - 0.25 * rain;
    u.rayleigh.value = 2.2 + 1.5 * golden + 2 * rain;
    u.turbidity.value = 6 + 6 * golden + 14 * rain;
    hemi.intensity *= 1 - 0.35 * rain;
    starMat.opacity = night * 0.9;
    return night;
  }
  setTime(18.2);

  return {
    sunDir, setTime,
    setRain(r) { rain = r; },
    get night() { return night; },
    follow(target) {
      sun.target.position.copy(target); sun.position.copy(target).addScaledVector(sunDir, 450);
      moon.target.position.copy(target); moon.position.copy(target).add(new THREE.Vector3(-200, 400, 150));
    },
  };
}
