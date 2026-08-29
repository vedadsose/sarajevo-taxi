import * as THREE from 'three';

export const TUNE = {
  engine: 3200, reverse: 2000, brake: 45, handbrake: 120,
  maxSteer: 0.6, steerSpeedFalloff: 28, topSpeedKmh: 140,
  suspStiffness: 34, suspRest: 0.32, suspTravel: 0.22, suspCompression: 2.4, suspRelaxation: 3.2,
  frictionSlip: 3.0, sideFriction: 1.0, driftSideFriction: 0.35, linDamping: 0.12, angDamping: 1.2,
};

function taxiSignTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#111'; g.font = 'bold 64px Helvetica, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('TAXI', 128, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCarMesh() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: '#e8e2d2', roughness: 0.35, metalness: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#233040', roughness: 0.1, metalness: 0.6 });
  const box = (w, h, d, m, x, y, z) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mm.position.set(x, y, z); mm.castShadow = true; g.add(mm); return mm; };
  // Golf Mk2-ish proportions: front is +z
  box(1.66, 0.55, 4.0, body, 0, -0.1, 0);          // lower body
  box(1.56, 0.5, 2.15, body, 0, 0.42, -0.25);       // cabin
  box(1.58, 0.36, 2.05, glass, 0, 0.45, -0.25);     // glass band
  box(1.7, 0.18, 0.2, trim, 0, -0.3, 2.0);          // front bumper
  box(1.7, 0.18, 0.2, trim, 0, -0.3, -2.0);         // rear bumper
  const sign = box(0.55, 0.2, 0.22, new THREE.MeshStandardMaterial({ map: taxiSignTexture(), emissive: '#ffd23f', emissiveIntensity: 0.6, emissiveMap: taxiSignTexture() }), 0, 0.77, -0.1);
  sign.material.side = THREE.DoubleSide;
  const hl = new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: '#fff1b0', emissiveIntensity: 3 });
  box(0.34, 0.16, 0.05, hl, 0.58, -0.02, 2.0); box(0.34, 0.16, 0.05, hl, -0.58, -0.02, 2.0);
  const tl = new THREE.MeshStandardMaterial({ color: '#8a1010', emissive: '#ff2020', emissiveIntensity: 1.5 });
  box(0.34, 0.14, 0.05, tl, 0.58, -0.02, -2.0); box(0.34, 0.14, 0.05, tl, -0.58, -0.02, -2.0);
  // headlight spots
  const spots = [];
  const spot = (x) => {
    const s = new THREE.SpotLight('#fff2c8', 18, 45, 0.5, 0.6, 1.4);
    s.position.set(x, -0.02, 2.0); s.target.position.set(x, -0.6, 12); g.add(s, s.target); spots.push(s); return s;
  };
  spot(0.58); spot(-0.58);
  g.userData.spots = spots;
  return g;
}

export function createCar(RAPIER, world, scene, spawn) {
  const mesh = buildCarMesh();
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) })
      .setLinearDamping(TUNE.linDamping).setAngularDamping(TUNE.angDamping).setCcdEnabled(true).setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.83, 0.3, 2.0).setTranslation(0, -0.15, 0).setDensity(120).setFriction(0.5), body);
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.75, 0.25, 1.05).setTranslation(0, 0.4, -0.25).setDensity(40), body);

  const vehicle = world.createVehicleController(body);
  const R = 0.32;
  const wheelPos = [[0.8, -0.2, 1.3], [-0.8, -0.2, 1.3], [0.8, -0.2, -1.3], [-0.8, -0.2, -1.3]];
  wheelPos.forEach(([x, y, z], i) => {
    vehicle.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, TUNE.suspRest, R);
    vehicle.setWheelSuspensionStiffness(i, TUNE.suspStiffness);
    vehicle.setWheelMaxSuspensionTravel(i, TUNE.suspTravel);
    vehicle.setWheelSuspensionCompression(i, TUNE.suspCompression);
    vehicle.setWheelSuspensionRelaxation(i, TUNE.suspRelaxation);
    vehicle.setWheelFrictionSlip(i, TUNE.frictionSlip);
    vehicle.setWheelSideFrictionStiffness(i, TUNE.sideFriction);
  });

  // wheel visuals
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#2b2b2d", roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#b9b9b9', roughness: 0.4, metalness: 0.6 });
  const wheels = wheelPos.map(() => {
    const pivot = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.24, 18), wheelMat);
    tyre.rotation.z = Math.PI / 2; tyre.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.25, 12), rimMat);
    rim.rotation.z = Math.PI / 2;
    const spin = new THREE.Group(); spin.add(tyre, rim); pivot.add(spin);
    scene.add(pivot);
    return { pivot, spin, angle: 0 };
  });

  let steer = 0, flippedFor = 0;
  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), up = new THREE.Vector3();

  const fwdV = new THREE.Vector3();
  /** Signed forward speed in m/s, computed from the body velocity (Rapier's own reading is stale at rest). */
  function forwardSpeed() {
    const q = body.rotation(), v = body.linvel();
    fwdV.set(0, 0, 1).applyQuaternion(tmpQ.set(q.x, q.y, q.z, q.w));
    return fwdV.x * v.x + fwdV.y * v.y + fwdV.z * v.z;
  }
  function speedKmh() { return forwardSpeed() * 3.6; }

  function reset(pos) {
    const p = pos || body.translation();
    const rot = body.rotation();
    const yaw = Math.atan2(2 * (rot.w * rot.y + rot.x * rot.z), 1 - 2 * (rot.y * rot.y + rot.z * rot.z));
    body.setTranslation({ x: p.x, y: p.y + 1.5, z: p.z }, true);
    body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  function update(dt, input) {
    const speed = forwardSpeed(); // m/s, signed
    const kmh = speed * 3.6;
    // steering with speed falloff
    const maxSteer = TUNE.maxSteer / (1 + Math.abs(kmh) / TUNE.steerSpeedFalloff);
    const target = input.steer * maxSteer;
    steer += (target - steer) * Math.min(1, dt * 8);
    vehicle.setWheelSteering(0, steer); vehicle.setWheelSteering(1, steer);

    let force = 0, brake = 0;
    if (input.throttle > 0) {
      force = TUNE.engine * Math.max(0.15, 1 - Math.max(0, kmh) / TUNE.topSpeedKmh);
      if (speed < -1.5) brake = TUNE.brake; // rolling backwards fast: brake while pushing forward
    } else if (input.throttle < 0) {
      if (speed > 1.0) brake = TUNE.brake; else force = -TUNE.reverse * Math.max(0.2, 1 - Math.max(0, -kmh) / 40);
    } else if (Math.abs(speed) < 0.5) brake = 5; // hold on hills
    for (let i = 0; i < 4; i++) {
      vehicle.setWheelEngineForce(i, i >= 2 ? force : force * 0.35); // mostly rear drive
      vehicle.setWheelBrake(i, brake);
    }
    const hb = input.handbrake;
    vehicle.setWheelBrake(2, hb ? TUNE.handbrake : brake); vehicle.setWheelBrake(3, hb ? TUNE.handbrake : brake);
    vehicle.setWheelSideFrictionStiffness(2, hb ? TUNE.driftSideFriction : TUNE.sideFriction);
    vehicle.setWheelSideFrictionStiffness(3, hb ? TUNE.driftSideFriction : TUNE.sideFriction);
    vehicle.updateVehicle(dt);

    // auto-recover when flipped
    const q = body.rotation();
    up.set(0, 1, 0).applyQuaternion(tmpQ.set(q.x, q.y, q.z, q.w));
    flippedFor = up.y < 0.25 ? flippedFor + dt : 0;
    if (flippedFor > 2) { reset(); flippedFor = 0; }
  }

  function sync(dt) {
    const p = body.translation(), q = body.rotation();
    mesh.position.set(p.x, p.y, p.z); mesh.quaternion.set(q.x, q.y, q.z, q.w);
    const dist = forwardSpeed() * dt;
    wheels.forEach((w, i) => {
      const c = vehicle.wheelChassisConnectionPointCs(i);
      const len = vehicle.wheelSuspensionLength(i) ?? TUNE.suspRest;
      tmpV.set(c.x, c.y - len, c.z).applyQuaternion(mesh.quaternion).add(mesh.position);
      w.pivot.position.copy(tmpV);
      w.pivot.quaternion.copy(mesh.quaternion);
      if (i < 2) w.pivot.rotateY(steer);
      w.angle += dist / R;
      w.spin.rotation.x = w.angle;
    });
  }

  function setNight(nf) { for (const s of mesh.userData.spots) { s.intensity = 12 + 70 * nf; s.distance = 45 + 40 * nf; } }
  return { mesh, body, vehicle, update, sync, reset, speedKmh, setNight, get position() { return mesh.position; } };
}
