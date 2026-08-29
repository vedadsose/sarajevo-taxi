import * as THREE from 'three';

const START_FARE = 1.5, PER_KM = 1.2; // KM (convertible marks), roughly Sarajevo tariff

/** Taxi fare loop: a passenger waits on a pavement → drive them to a named part of town → get paid. */
export function createFares(scene, data, sidewalks, groundHeight, hud) {
  const roads = data.city.roads.filter((r) => !r.bridge && ['primary', 'secondary', 'tertiary', 'residential', 'unclassified'].includes(r.type));
  const roadPts = []; for (const r of roads) for (const p of r.pts) roadPts.push(p);
  const places = data.city.places.filter((p) => p.kind === 'suburb' || p.kind === 'quarter');
  // snap each place to the nearest road point so destinations are reachable
  const dests = places.map((p) => { let best = Infinity, q = p; for (const rp of roadPts) { const d = (rp[0] - p.x) ** 2 + (rp[1] - p.z) ** 2; if (d < best) { best = d; q = rp; } } return { name: p.name, x: q[0], z: q[1] }; })
    .filter((d) => Math.abs(d.x) < data.city.halfW - 150 && Math.abs(d.z) < data.city.halfD - 150);
  const walkPts = []; for (const w of sidewalks) for (let i = 0; i < w.length; i += 3) walkPts.push(w[i]);

  // beacons
  const mkBeacon = (color) => {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    col.position.y = 20; g.add(col);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; g.add(ring);
    g.userData.ring = ring; g.visible = false; scene.add(g); return g;
  };
  const pickupBeacon = mkBeacon('#3dff8a'), dropBeacon = mkBeacon('#ffd23f');

  // the passenger: waiting figure (arm raised) at the pickup, and a seated figure in the cab during the ride
  const skin = new THREE.MeshStandardMaterial({ color: '#e0ac7e', roughness: 0.8 }), coat = new THREE.MeshStandardMaterial({ color: '#7a1f1f', roughness: 0.9 }), pants = new THREE.MeshStandardMaterial({ color: '#23324a', roughness: 0.9 });
  const waiting = new THREE.Group();
  {
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), coat); torso.position.y = 1.05;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.8, 0.22), pants); legs.position.y = 0.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skin); head.position.y = 1.52;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.1), coat); arm.position.set(0.3, 1.5, 0); arm.rotation.z = -0.35;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), skin); hand.position.set(0.41, 1.82, 0);
    for (const m of [torso, legs, head, arm, hand]) m.castShadow = true;
    waiting.add(torso, legs, head, arm, hand); waiting.visible = false; scene.add(waiting);
  }
  const seated = new THREE.Group();
  {
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.24), coat); torso.position.y = 0.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skin); head.position.y = 0.62;
    seated.add(torso, head); seated.position.set(0.38, 0.1, -0.55); seated.visible = false;
  }
  let seatedAttached = false;

  const state = { phase: 'idle', target: null, dest: null, money: 0, fare: 0, startDist: 0, timer: 0, msg: '', msgT: 0, count: 0 };
  const dist2 = (x, z, px, pz) => Math.hypot(x - px, z - pz);

  function newPickup(px, pz) {
    let p = null;
    for (let t = 0; t < 60 && !p; t++) { const c = walkPts[Math.floor(Math.random() * walkPts.length)]; const d = dist2(c[0], c[2], px, pz); if (d > 140 && d < 520) p = c; }
    if (!p) return;
    state.target = { x: p[0], z: p[2], y: p[1] }; state.phase = 'pickup';
    pickupBeacon.position.set(p[0], p[1], p[2]); pickupBeacon.visible = true;
    waiting.position.set(p[0], p[1], p[2]); waiting.rotation.y = Math.atan2(px - p[0], pz - p[2]); waiting.visible = true;
  }
  function newDropoff(px, pz) {
    const far = dests.filter((d) => dist2(d.x, d.z, px, pz) > 500);
    const d = (far.length ? far : dests)[Math.floor(Math.random() * (far.length ? far : dests).length)];
    state.dest = { ...d, y: groundHeight(d.x, d.z) }; state.phase = 'dropoff';
    state.startDist = dist2(d.x, d.z, px, pz); state.timer = 0;
    dropBeacon.position.set(d.x, state.dest.y, d.z); dropBeacon.visible = true;
  }
  const flash = (m, t = 3.5) => { state.msg = m; state.msgT = t; state.next = null; };
  const LINES = ['Hajmo, žurim!', 'Može malo brže, majstore?', 'Uh, kakva gužva danas...', 'Idemo preko Skenderije, jel\' može?', 'Znaš gdje je to, jelde?', 'Samo polako, nema žurbe.', 'Pusti malo radio.', 'E, kako je kod tebe?', 'Vozi, vozi, kasnim na posao!', 'Ma svi oni voze k\'o ludi.'];
  const say = (line, then) => { state.msg = `„${line}“`; state.msgT = 2.6; state.next = then; };

  function update(dt, car) {
    const p = car.position, kmh = Math.abs(car.speedKmh());
    state.msgT -= dt;
    if (state.msgT <= 0 && state.next) { state.msg = state.next; state.next = null; state.msgT = 3; }
    const pulse = 1 + Math.sin(performance.now() / 250) * 0.15;
    pickupBeacon.userData.ring.scale.setScalar(pulse); dropBeacon.userData.ring.scale.setScalar(pulse);
    if (state.phase === 'idle') { state.timer += dt; if (state.timer > 2) { state.timer = 0; newPickup(p.x, p.z); } }
    else if (state.phase === 'pickup') {
      const d = dist2(state.target.x, state.target.z, p.x, p.z);
      hud.fare(`PUTNIK ČEKA · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}`, 'pickup');
      if (d < 7 && kmh < 4) { pickupBeacon.visible = false; waiting.visible = false; if (!seatedAttached) { car.mesh.add(seated); seatedAttached = true; } seated.visible = true; newDropoff(p.x, p.z); say(LINES[Math.floor(Math.random() * LINES.length)], `Vozi → ${state.dest.name}!`); }
    } else if (state.phase === 'dropoff') {
      state.timer += dt;
      const d = dist2(state.dest.x, state.dest.z, p.x, p.z);
      const est = START_FARE + PER_KM * (state.startDist / 1000);
      hud.fare(`→ ${state.dest.name.toUpperCase()} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} · ~${est.toFixed(2)} KM`, 'dropoff');
      if (d < 12 && kmh < 4) {
        const quick = state.timer < state.startDist / 8; // faster than ~29 km/h average → tip
        const pay = est + (quick ? 2 : 0);
        state.money += pay; state.count++;
        flash(`+${pay.toFixed(2)} KM${quick ? ' · bakšiš!' : ''}`);
        dropBeacon.visible = false; seated.visible = false; state.phase = 'idle'; state.timer = 0; state.dest = null;
      }
    }
    if (state.phase === 'idle') hud.fare('', 'idle');
    hud.flash(state.msgT > 0 ? state.msg : '');
    hud.money(state.money, state.count);
  }
  return { update, state, get marker() { return state.phase === 'pickup' ? state.target : state.phase === 'dropoff' ? state.dest : null; } };
}
