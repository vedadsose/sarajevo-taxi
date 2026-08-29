import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadData } from './data.js';
import { createTerrain } from './terrain.js';
import { buildCity, roadWidth } from './city.js';
import { createCar, TUNE } from './car.js';
import { createEnvironment } from './environment.js';
import { createInput } from './input.js';
import { createHUD } from './hud.js';
import { createMinimap } from './minimap.js';
import { createTrafficLights } from './traffic.js';
import { createTrams } from './trams.js';
import { createPedestrians } from './pedestrians.js';
import { createCars } from './cars.js';
import { createFares } from './fares.js';
import { createAudio } from './audio.js';
import { createSkids } from './skids.js';
import { createWeather } from './weather.js';
import { createTrees } from './trees.js';

const msg = (t) => (document.getElementById('loadmsg').textContent = t);

async function main() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 20000);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const [data] = await Promise.all([loadData(msg), RAPIER.init()]);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  msg('Shaping the valley…');
  await new Promise((r) => setTimeout(r));
  const terrain = createTerrain(RAPIER, world, data);
  scene.add(terrain.mesh);

  msg('Building Sarajevo…');
  await new Promise((r) => setTimeout(r));
  const cityObj = buildCity(RAPIER, world, data, terrain.groundHeight);
  scene.add(cityObj.group);
  const traffic = createTrafficLights(data, (x, z) => data.sampleHeight(x, z));
  scene.add(traffic.group);
  const trams = createTrams(RAPIER, world, scene, data, (x, z) => data.sampleHeight(x, z));
  scene.add(trams.group);

  const trees = createTrees(data, (x, z) => data.sampleHeight(x, z), cityObj.isBlocked);
  scene.add(trees.group);
  const env = createEnvironment(scene, renderer);
  let clock = 18.2; // hours; one game hour every 75 real seconds
  const clockEl = document.getElementById('clock');
  function applyTime() {
    const nf = env.setTime(clock);
    cityObj.setNight(nf);
    car.setNight?.(nf);
    if (clockEl) clockEl.textContent = `${String(Math.floor(clock)).padStart(2, '0')}:${String(Math.floor((clock % 1) * 60)).padStart(2, '0')}`;
  }

  // Spawn on the longest stretch of a named street, heading east
  function spawnOnStreet(name) {
    let best = null, bestLen = 0;
    for (const r of data.city.roads) {
      if (r.name !== name) continue;
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      if (len > bestLen) { bestLen = len; best = r; }
    }
    const pts = best.pts, a = pts[0], b = pts[pts.length - 1];
    const east = b[0] >= a[0] ? [a, b] : [b, a];
    const [cx, cz] = pts[Math.floor(pts.length / 2)];
    const yaw = Math.atan2(east[1][0] - east[0][0], east[1][1] - east[0][1]); // forward is local +z
    // park in the right-hand lane, not on the centreline
    const off = roadWidth(best) / 4, x = cx - Math.cos(yaw) * off, z = cz + Math.sin(yaw) * off;
    return { x, y: terrain.groundHeight(x, z) + 1.2, z, yaw };
  }
  const spawn = spawnOnStreet('Maršala Tita');
  const car = createCar(RAPIER, world, scene, spawn);
  const peds = createPedestrians(scene, cityObj.sidewalks, car.position);
  scene.add(peds.group);
  const aiCars = createCars(RAPIER, world, scene, data, terrain.groundHeight, traffic, car.position);
  scene.add(aiCars.group);
  const input = createInput();
  const hud = createHUD();
  const minimap = createMinimap(data);
  const fares = createFares(scene, data, cityObj.sidewalks, terrain.groundHeight, hud);
  // click-to-spawn: snap to the nearest drivable road and face along it
  const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
  minimap.onSpawn = (x, z) => {
    let best = Infinity, hit = null;
    for (const r of data.city.roads) {
      if (!DRIVE.has(r.type) || r.bridge) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
        if (Math.abs(ax - x) > 150 && Math.abs(bx - x) > 150) continue;
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
        const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - x, pz - z);
        if (d < best) { best = d; hit = { px, pz, yaw: Math.atan2(vx, vz), w: roadWidth(r) }; }
      }
    }
    const sx = hit ? hit.px - Math.cos(hit.yaw) * (hit.w / 4) : x, sz = hit ? hit.pz + Math.sin(hit.yaw) * (hit.w / 4) : z, yaw = hit ? hit.yaw : 0;
    car.body.setTranslation({ x: sx, y: terrain.groundHeight(sx, sz) + 1.2, z: sz }, true);
    car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true); car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    camPos.set(sx - Math.sin(yaw) * 8, terrain.groundHeight(sx, sz) + 4, sz - Math.cos(yaw) * 8);
  };
  const audio = createAudio();
  const skids = createSkids(scene);
  const weather = createWeather(scene);
  weather.onChange((r) => { env.setRain(r); cityObj.setWet(r); });

  // Chase camera
  let camMode = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
  const camRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  camPos.set(spawn.x - 8, spawn.y + 3, spawn.z);
  function updateCamera(dt) {
    if (window.game && window.game.freeCam) { const f = window.game.freeCam; camera.position.set(f.x, f.y, f.z); camera.lookAt(f.tx, f.ty, f.tz); return; }
    const p = car.position;
    fwd.set(0, 0, 1).applyQuaternion(car.mesh.quaternion);
    const vel = car.body.linvel(); const sp = Math.hypot(vel.x, vel.z);
    if (sp > 3) { tmp.set(vel.x, 0, vel.z).normalize(); fwd.lerp(tmp, 0.5).normalize(); }
    if (camMode === 2) { // bonnet cam
      tmp.copy(p).addScaledVector(fwd, 0.9); tmp.y += 1.25;
      camPos.lerp(tmp, Math.min(1, dt * 30));
      camLook.lerp(tmp.copy(p).addScaledVector(fwd, 30).setY(p.y + 0.9), Math.min(1, dt * 12));
      camera.position.copy(camPos); camera.lookAt(camLook); return;
    }
    const dist = camMode === 1 ? 14 : 8.5, height = camMode === 1 ? 5.5 : 3.0;
    tmp.copy(p).addScaledVector(fwd, -dist); tmp.y += height;
    // keep camera above ground
    tmp.y = Math.max(tmp.y, terrain.groundHeight(tmp.x, tmp.z) + 1.2);
    // pull camera in if a building blocks the view of the car
    camRay.origin.x = p.x; camRay.origin.y = p.y + 1.0; camRay.origin.z = p.z;
    camRay.dir.x = tmp.x - p.x; camRay.dir.y = tmp.y - p.y - 1.0; camRay.dir.z = tmp.z - p.z;
    const hit = world.castRay(camRay, 1, true, undefined, undefined, undefined, car.body);
    if (hit) { const t = Math.max(0.15, (hit.timeOfImpact ?? hit.toi) - 0.08); tmp.set(p.x + camRay.dir.x * t, p.y + 1.0 + camRay.dir.y * t, p.z + camRay.dir.z * t); }
    camPos.lerp(tmp, Math.min(1, dt * (hit ? 12 : 4.5)));
    camLook.lerp(tmp.copy(p).addScaledVector(fwd, 6).setY(p.y + 1.0), Math.min(1, dt * 8));
    camera.position.copy(camPos); camera.lookAt(camLook);
  }

  document.getElementById('loading').classList.add('hidden');
  console.log('[game] ready');

  let last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (input.pressed('KeyR')) car.reset();
    if (input.pressed('KeyT')) respawn();
    if (input.pressed('KeyC')) camMode = (camMode + 1) % 3;
    if (input.pressed('KeyP')) weather.toggle();
    if (input.pressed('KeyM')) minimap.toggleBig();
    if (input.pressed('Escape') && minimap.isOpen) minimap.closeBig();
    if (input.pressed('KeyN')) clock = (clock + 2) % 24;
    clock = (clock + dt / 75) % 24;
    applyTime();
    const ctl = input.override || input;
    acc += dt;
    while (acc >= STEP) { trams.update(STEP); aiCars.update(STEP, car.position, car.speedKmh() / 3.6); car.update(STEP, ctl); world.step(); acc -= STEP; }
    car.sync(dt);
    updateCamera(dt);
    env.follow(car.position);
    if (cityObj.group.userData.flame) { const f = cityObj.group.userData.flame; f.scale.set(1 + Math.sin(now / 90) * 0.12, 1 + Math.sin(now / 130) * 0.2, 1 + Math.cos(now / 110) * 0.12); }
    traffic.update(now / 1000);
    peds.update(dt, car.position, car.speedKmh());
    const q = car.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    fares.update(dt, car);
    {
      const v = car.body.linvel(), qq = car.mesh.quaternion;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(qq), fw = new THREE.Vector3(0, 0, 1).applyQuaternion(qq);
      const lat = v.x * right.x + v.z * right.z, sp = Math.hypot(v.x, v.z);
      const skidding = sp > 3 && (Math.abs(lat) > 2.8 || (ctl.handbrake && sp > 4));
      const rw = [[0.8, -1.3], [-0.8, -1.3]].map(([ox, oz]) => { const w = new THREE.Vector3(ox, -0.2, oz).applyQuaternion(qq).add(car.mesh.position); w.y = terrain.groundHeight(w.x, w.z); return w; });
      skids.update(dt, rw, fw, skidding);
      weather.update(dt, camera.position, fwd);
    }
    audio.update(car.speedKmh(), ctl.throttle, input.pressedNow ? input.pressedNow('KeyH') : false);
    const mk = fares.marker; minimap.update(car.position.x, car.position.z, yaw, mk ? { ...mk, color: fares.state.phase === 'pickup' ? '#3dff8a' : '#ffd23f' } : null);
    hud.update(car.speedKmh(), cityObj.nearestStreet(car.position.x, car.position.z), minimap.currentPlace(car.position.x, car.position.z), dt);
    input.endFrame();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function respawn() {
    car.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
    car.body.setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true); car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // Debug / automation hooks
  window.game = {
    spawn, respawn,
    car, world, TUNE, camera, scene, renderer, data, terrain, input, trams, env, peds, aiCars, traffic, fares, weather,
    setClock(h) { clock = h; },
    teleport(lat, lon, yawDeg = 90) {
      const [x, z] = data.toLocal(lat, lon);
      car.body.setTranslation({ x, y: terrain.groundHeight(x, z) + 1.2, z }, true);
      const yaw = (yawDeg * Math.PI) / 180;
      car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true); car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
    drive(throttle, steer, handbrake = false) { input.override = throttle === null ? null : { throttle, steer, handbrake }; },
    state() { const p = car.body.translation(); return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), kmh: +car.speedKmh().toFixed(1), street: cityObj.nearestStreet(p.x, p.z) }; },
  };
}

main().catch((e) => { console.error(e); msg('Failed: ' + e.message); });
