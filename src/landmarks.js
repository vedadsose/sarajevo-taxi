import * as THREE from 'three';

/** Hand-built Sarajevo landmarks placed on their real OSM footprints. */
const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide, ...o }); // footprints come in both windings

function centroid(pts) { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }
/** Oriented bounding box along the footprint's longest edge: {cx, cz, ang, w (along), d (across)} */
function obb(pts) {
  let bi = 0, bl = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; bi = i; } }
  const a = pts[bi], b = pts[(bi + 1) % pts.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, z] of pts) { const u = x * c - z * s, v = x * s + z * c; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const c2 = Math.cos(ang), s2 = Math.sin(ang);
  return { cx: cu * c2 - cv * s2, cz: cu * s2 + cv * c2, ang, w: maxU - minU, d: maxV - minV, minU, maxU, minV, maxV };
}
/** Walls with metric UVs (u along the wall in metres, v height in metres) so textures repeat correctly. */
function walls(pts, y0, y1, mat) {
  const P = [], N = [], U = [];
  let area2 = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area2 += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area2 > 0 ? 1 : -1; let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length]; const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue;
    const nx = ((bz - az) / len) * sgn, nz = (-(bx - ax) / len) * sgn;
    const q = [[ax, y0, az, u, 0], [bx, y0, bz, u + len, 0], [bx, y1, bz, u + len, y1 - y0], [ax, y1, az, u, y1 - y0]];
    const order = sgn > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); U.push(v[3], v[4]); }
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}
function cap(pts, y, mat) {
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, -z)), []);
  const P = [], N = [];
  for (const [a, b, c] of tris) for (const i of [a, c, b]) { P.push(pts[i][0], y, pts[i][1]); N.push(0, 1, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
const mesh = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; return m; };
const regular = (n, r) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
const shift = (pts, x, z) => pts.map(([a, b]) => [a + x, b + z]);

// ---------------------------------------------------------------- builders
const B = {};

/** Vijećnica — pseudo-Moorish city hall. One 5 m bay × 22 m tall façade tile: stone arcade, striped upper floors, cornice. */
B.vijecnica = ({ pts, base, add, collide }) => {
  const BAY = 5, WH = 22; // metres per tile
  const facade = tex(320, 1408, (g, w, h) => {
    const px = h / WH; // pixels per metre
    const Y = (m) => h - m * px; // metre height → canvas y (v=0 at the bottom)
    const stone = '#efe3c8', yellow = '#e3c26e', red = '#bf5a35', dark = '#1c1916', frame = '#d9c9a4';
    const arch = (cx, yb, wd, ht, fill, ring) => { // pointed arch: base at yb (m), width wd, height ht
      const x0 = cx - wd / 2, x1 = cx + wd / 2, top = Y(yb + ht), shoulder = Y(yb + ht - wd / 2);
      if (ring) { g.fillStyle = ring; g.beginPath(); g.moveTo(x0 - 0.35 * px, Y(yb)); g.lineTo(x0 - 0.35 * px, shoulder); g.quadraticCurveTo(cx, top - 0.5 * px, x1 + 0.35 * px, shoulder); g.lineTo(x1 + 0.35 * px, Y(yb)); g.closePath(); g.fill(); }
      g.fillStyle = fill; g.beginPath(); g.moveTo(x0, Y(yb)); g.lineTo(x0, shoulder); g.quadraticCurveTo(cx, top, x1, shoulder); g.lineTo(x1, Y(yb)); g.closePath(); g.fill();
    };
    const stripes = (y0, y1) => { let i = 0; for (let m = y0; m < y1; m += 0.75, i++) { g.fillStyle = i % 2 ? red : yellow; g.fillRect(0, Y(Math.min(y1, m + 0.75)), w, (Math.min(y1, m + 0.75) - m) * px + 1); } };
    // ground floor: pale stone with a tall pointed arcade opening and alternating voussoirs
    g.fillStyle = stone; g.fillRect(0, Y(5.2), w, h - Y(5.2));
    g.fillStyle = '#e3d5b4'; for (let m = 0; m < 5.2; m += 0.65) g.fillRect(0, Y(m) - 2, w, 2); // ashlar courses
    arch(w / 2, 0.3, 2.7 * px, 4.4 * px, dark, null);
    // voussoirs ring drawn as alternating wedges
    for (let k = 0; k < 14; k++) { const a0 = Math.PI + (k / 14) * Math.PI, a1 = Math.PI + ((k + 1) / 14) * Math.PI; g.fillStyle = k % 2 ? red : yellow; g.beginPath(); g.arc(w / 2, Y(0.3 + 4.4 - 1.35), 1.35 * px + 0.5 * px, a0, a1); g.arc(w / 2, Y(0.3 + 4.4 - 1.35), 1.35 * px, a1, a0, true); g.closePath(); g.fill(); }
    g.fillStyle = dark; g.beginPath(); g.arc(w / 2, Y(0.3 + 4.4 - 1.35), 1.35 * px, Math.PI, 2 * Math.PI); g.fill();
    g.fillStyle = dark; g.fillRect(w / 2 - 1.35 * px, Y(0.3 + 4.4 - 1.35), 2.7 * px, (4.4 - 1.35) * px);
    // string course
    g.fillStyle = '#8a4a2a'; g.fillRect(0, Y(5.75), w, 0.55 * px);
    // first floor: broad stripes, tall arched window with stone frame
    stripes(5.75, 12.6);
    arch(w / 2, 6.6, 2.1 * px, 5.2 * px, dark, frame);
    g.fillStyle = frame; g.fillRect(w / 2 - 1.5 * px, Y(6.6), 3 * px, 0.35 * px); // sill
    g.fillStyle = '#8a4a2a'; g.fillRect(0, Y(13.15), w, 0.55 * px);
    // second floor: stripes, smaller twin arches
    stripes(13.15, 18.4);
    arch(w / 2 - 0.85 * px, 14.2, 1.3 * px, 3.0 * px, dark, frame); arch(w / 2 + 0.85 * px, 14.2, 1.3 * px, 3.0 * px, dark, frame);
    // attic band + cornice
    g.fillStyle = stone; g.fillRect(0, Y(WH), w, (WH - 18.4) * px);
    g.fillStyle = dark; g.beginPath(); g.arc(w / 2, Y(19.9), 0.55 * px, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a4a2a'; g.fillRect(0, Y(18.9), w, 0.5 * px);
    g.fillStyle = '#c9b48a'; g.fillRect(0, Y(WH), w, 0.5 * px); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, Y(WH - 0.5), w, 0.25 * px);
    // corner pilaster shading at the tile edges
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, 0.12 * w, h); g.fillRect(0.88 * w, 0, 0.12 * w, h);
  });
  facade.repeat.set(1 / BAY, 1 / WH);
  const wall = std({ map: facade, roughness: 0.85 });
  const stone = std({ color: '#efe3c8', roughness: 0.9 }), slate = std({ color: '#4d5560', roughness: 0.7 }), glass = std({ color: '#79a19a', metalness: 0.45, roughness: 0.3 });
  const [cx, cz] = centroid(pts);
  add(walls(pts, base, base + WH, wall));
  add(walls(pts, base - 8, base, stone)); // plinth down to the low side of the site
  // hipped perimeter roof: outer ring at 22 m rising to an inset ring at 26.5 m
  const inner = pts.map(([x, z]) => [cx + (x - cx) * 0.7, cz + (z - cz) * 0.7]);
  {
    const P = [], N = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], c = inner[(i + 1) % pts.length], d = inner[i];
      const A = [a[0], base + WH, a[1]], Bv = [b[0], base + WH, b[1]], C = [c[0], base + 26.5, c[1]], D = [d[0], base + 26.5, d[1]];
      const ux = Bv[0] - A[0], uy = 0, uz = Bv[2] - A[2], vx = D[0] - A[0], vy = 4.5, vz = D[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const v of [A, Bv, C, A, C, D]) { P.push(...v); N.push(nx, ny, nz); }
      for (const v of [A, C, Bv, A, D, C]) { P.push(...v); N.push(nx, ny, nz); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    const m = new THREE.Mesh(g, slate); m.castShadow = m.receiveShadow = true; add(m);
  }
  add(cap(inner, base + 26.5, slate));
  // central drum + great glass dome
  const drum = shift(regular(16, 10.5), cx, cz);
  add(walls(drum, base + 24, base + 32, wall)); add(cap(drum, base + 32, slate));
  const dome = mesh(new THREE.SphereGeometry(11, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass, cx, base + 32, cz); dome.scale.y = 0.72; add(dome);
  add(mesh(new THREE.SphereGeometry(1.1, 10, 8), std({ color: '#c9a34a', metalness: 0.7, roughness: 0.3 }), cx, base + 32 + 11 * 0.72 + 0.6, cz));
  // corner turrets: three footprint vertices farthest from the centre, ≥ 25 m apart
  const far = pts.map((p) => ({ p, d: Math.hypot(p[0] - cx, p[1] - cz) })).sort((a, b) => b.d - a.d);
  const corners = [];
  for (const f of far) { if (corners.every((c) => Math.hypot(c[0] - f.p[0], c[1] - f.p[1]) > 25)) corners.push(f.p); if (corners.length === 3) break; }
  for (const [tx, tz] of corners) {
    const ix = tx + (cx - tx) * 0.07, iz = tz + (cz - tz) * 0.07;
    const oct = shift(regular(8, 3.6), ix, iz);
    add(walls(oct, base + 21, base + 27, wall));
    add(cap(oct, base + 27, slate));
    const d = mesh(new THREE.SphereGeometry(3.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, ix, base + 27, iz); d.scale.y = 0.75; add(d);
    add(mesh(new THREE.SphereGeometry(0.5, 8, 6), std({ color: '#c9a34a', metalness: 0.7 }), ix, base + 27 + 3.8 * 0.75 + 0.3, iz));
  }
  collide(pts, base, base + WH);
};

/** Hotel Holiday — the yellow cube with brown ribbon windows on a dark glass base. */
B.holiday = ({ pts, base, add, collide, box }) => {
  add(walls(pts, base - 6, base + 8, std({ color: '#262a33', roughness: 0.2, metalness: 0.6 })));
  add(cap(pts, base + 8, std({ color: '#3a3d44' })));
  const yellow = tex(256, 256, (g, w, h) => { // 4 m × 3.3 m
    g.fillStyle = '#f2c11c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4d3222'; g.fillRect(0, h * 0.3, w, h * 0.34);
    g.fillStyle = '#8a6a4a'; g.fillRect(0, h * 0.36, w, h * 0.22);
  });
  yellow.repeat.set(1 / 4, 1 / 3.3);
  const { cx, cz, ang } = obb(pts);
  const W = 48, D = 48, H = 40;
  const c = Math.cos(ang), s = Math.sin(ang);
  const rect = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
  add(walls(rect, base + 8, base + 8 + H, std({ map: yellow, roughness: 0.7 })));
  add(cap(rect, base + 8 + H, std({ color: '#4d3222' })));
  add(walls(rect, base + 8 + H, base + 8 + H + 1.4, std({ color: '#4d3222' })));
  collide(pts, base, base + 8); collide(rect, base + 8, base + 8 + H);
};

/** Parliament of BiH — the 21-storey tower with white vertical fins. */
B.parlament_tower = ({ pts, base, add, collide }) => {
  const fins = tex(256, 256, (g, w, h) => { // 2 m × 3.6 m
    g.fillStyle = '#1f2a36'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4a5f75'; g.fillRect(0, 0, w, h * 0.45);
    g.fillStyle = '#e9ebee'; g.fillRect(0, 0, w * 0.34, h); g.fillRect(w * 0.83, 0, w * 0.17, h);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, h * 0.9, w, h * 0.1);
  });
  fins.repeat.set(1 / 2, 1 / 3.6);
  add(walls(pts, base - 6, base + 78, std({ map: fins, roughness: 0.6, metalness: 0.2 })));
  add(cap(pts, base + 78, std({ color: '#55595f' })));
  add(walls(pts, base + 78, base + 82, std({ color: '#5f636a' }))); add(cap(pts, base + 82, std({ color: '#4a4d52' })));
  collide(pts, base, base + 82);
};
/** Parliament — the low horizontal block. */
B.parlament_low = ({ pts, base, add, collide }) => {
  const bands = tex(256, 256, (g, w, h) => { g.fillStyle = '#d7d9db'; g.fillRect(0, 0, w, h); g.fillStyle = '#26303c'; g.fillRect(0, h * 0.18, w, h * 0.5); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, h * 0.18, w, h * 0.12); });
  bands.repeat.set(1 / 4, 1 / 3.6);
  add(walls(pts, base - 6, base + 18, std({ map: bands, roughness: 0.6 })));
  add(cap(pts, base + 18, std({ color: '#5a5e64' })));
  collide(pts, base, base + 18);
};

/** Avaz Twist Tower — glass podium and a 36-floor shaft that twists as it rises. */
B.avaz = ({ pts, base, add, collide, box }) => {
  const glassPod = std({ color: '#6f93b3', roughness: 0.25, metalness: 0.35 });
  add(walls(pts, base - 6, base + 24, glassPod)); add(cap(pts, base + 24, std({ color: '#3d4a58' })));
  const { cx, cz, ang } = obb(pts);
  const floors = 36, fh = 4.1, W = 34, D = 22;
  const light = std({ color: '#a9c8e2', roughness: 0.2, metalness: 0.35 }), dark = std({ color: '#5b83a6', roughness: 0.25, metalness: 0.35 });
  for (let i = 0; i < floors; i++) {
    const a = -ang + (i / floors) * (Math.PI / 3); // 60° twist over the height
    add(box(W, fh * 0.78, D, i % 2 ? light : dark, cx, base + 24 + i * fh + fh * 0.39, cz, a));
    add(box(W + 0.4, fh * 0.22, D + 0.4, std({ color: '#dfe6ee', roughness: 0.4, metalness: 0.5 }), cx, base + 24 + i * fh + fh * 0.89, cz, a));
  }
  const top = base + 24 + floors * fh;
  add(box(W * 0.6, 4, D * 0.6, std({ color: '#2f3b47' }), cx, top + 2, cz, -ang + Math.PI / 3));
  add(mesh(new THREE.CylinderGeometry(0.25, 0.5, 22, 8), std({ color: '#c8ccd2', metalness: 0.8 }), cx, top + 15, cz));
  collide(pts, base, base + 24);
  collide(shift(regular(8, Math.max(W, D) * 0.55), cx, cz), base + 24, top);
};

/** Katedrala Srca Isusova — twin-tower neo-Gothic cathedral facing south onto Ferhadija. */
B.katedrala = ({ pts, base, add, collide, box }) => {
  const stone = std({ color: '#d9ccb2', roughness: 0.9 }), slate = std({ color: '#4a4e57', roughness: 0.8 });
  const wallH = 16;
  add(walls(pts, base - 6, base + wallH, stone));
  add(cap(pts, base + wallH, slate));
  const o = obb(pts);
  const c = Math.cos(o.ang), s = Math.sin(o.ang);
  // pitched roof along the long axis
  const roofLen = o.w, halfW = Math.min(o.d, 22) / 2;
  const tri = new THREE.Shape([new THREE.Vector2(-halfW, 0), new THREE.Vector2(halfW, 0), new THREE.Vector2(0, 8)]);
  const roofG = new THREE.ExtrudeGeometry(tri, { depth: roofLen, bevelEnabled: false }); roofG.translate(0, 0, -roofLen / 2); roofG.rotateY(Math.PI / 2 - o.ang); // extrusion axis (+z) → footprint long axis (cos a, sin a)
  add(mesh(roofG, slate, o.cx, base + wallH, o.cz));
  // front = the short side facing south (larger z)
  const endA = [o.cx + c * (o.w / 2), o.cz + s * (o.w / 2)], endB = [o.cx - c * (o.w / 2), o.cz - s * (o.w / 2)];
  const front = endA[1] > endB[1] ? endA : endB, dirIn = front === endA ? [-c, -s] : [c, s];
  const px = -s, pz = c; // across direction
  const tW = 7, tH = 38, off = Math.min(o.d, 22) / 2 - tW / 2 + 0.5;
  for (const side of [1, -1]) {
    const tx = front[0] + dirIn[0] * (tW / 2 + 0.5) + px * off * side, tz = front[1] + dirIn[1] * (tW / 2 + 0.5) + pz * off * side;
    add(box(tW, tH, tW, stone, tx, base + tH / 2 - 1, tz, -o.ang));
    const spire = mesh(new THREE.ConeGeometry(tW * 0.72, 15, 4), slate, tx, base + tH - 1 + 7.5, tz, -o.ang + Math.PI / 4); add(spire);
    add(mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), std({ color: '#c9a34a', metalness: 0.7 }), tx, base + tH + 15, tz));
    // tall lancet windows on the tower fronts
    add(box(1.4, 9, 0.3, std({ color: '#1e2a3a' }), tx - dirIn[0] * (tW / 2), base + 22, tz - dirIn[1] * (tW / 2), -o.ang + Math.PI / 2));
  }
  // rose window + portal on the front gable
  const gx = front[0] + dirIn[0] * 0.2, gz = front[1] + dirIn[1] * 0.2;
  const rose = mesh(new THREE.CircleGeometry(2.6, 24), std({ color: '#2a3c66', emissive: '#3a4c7a', emissiveIntensity: 0.3 }), gx, base + 13, gz, Math.atan2(-dirIn[0], -dirIn[1])); add(rose);
  add(mesh(new THREE.RingGeometry(2.6, 3.1, 24), stone, gx - dirIn[0] * 0.05, base + 13, gz - dirIn[1] * 0.05, Math.atan2(-dirIn[0], -dirIn[1])));
  add(box(4.5, 6.5, 0.4, std({ color: '#2a2018' }), gx, base + 3.2, gz, -o.ang + Math.PI / 2));
  collide(pts, base, base + wallH);
};

/** Gazi Husrev-begova džamija — great lead dome, five-domed portico, 45 m minaret, courtyard fountain. */
B.begova = ({ pts, base, add, collide }) => {
  const stone = std({ color: '#f3e9d8', roughness: 0.85 }), lead = std({ color: '#7e8b94', roughness: 0.55, metalness: 0.3 });
  const h = 11, [cx, cz] = centroid(pts);
  add(walls(pts, base - 6, base + h, stone)); add(cap(pts, base + h, std({ color: '#9aa3aa' })));
  const drum = shift(regular(16, 7.6), cx, cz);
  add(walls(drum, base + h, base + h + 2.5, stone));
  const dome = mesh(new THREE.SphereGeometry(7.9, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), lead, cx, base + h + 2.5, cz); dome.scale.y = 0.9; add(dome);
  add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), std({ color: '#c9a34a', metalness: 0.7 }), cx, base + h + 2.5 + 7.1 + 1.5, cz));
  // portico along the north (min z) edge: find the footprint edge with the smallest average z
  let best = Infinity, e = null;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const zz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len > 12 && zz < best) { best = zz; e = [a, b]; } }
  if (e) {
    const [a, b] = e; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const nx = dz, nz = -dx; const outward = ((a[0] + b[0]) / 2 + nx * 3 - cx) * nx + ((a[1] + b[1]) / 2 + nz * 3 - cz) * nz > 0 ? 1 : -1;
    const ox = nx * outward, oz = nz * outward;
    const porch = [[a[0], a[1]], [b[0], b[1]], [b[0] + ox * 5, b[1] + oz * 5], [a[0] + ox * 5, a[1] + oz * 5]];
    add(walls(porch, base - 1, base + 6.5, stone)); add(cap(porch, base + 6.5, std({ color: '#9aa3aa' })));
    for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5; const d = mesh(new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lead, a[0] + dx * len * t + ox * 2.5, base + 6.5, a[1] + dz * len * t + oz * 2.5); add(d); }
    // columns
    for (let i = 0; i <= 5; i++) { const t = i / 5; add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 5.5, 8), stone, a[0] + dx * len * t + ox * 4.6, base + 2.75, a[1] + dz * len * t + oz * 4.6)); }
    // šadrvan (courtyard fountain) 14 m out from the portico
    const fx = (a[0] + b[0]) / 2 + ox * 16, fz = (a[1] + b[1]) / 2 + oz * 16;
    const oct = shift(regular(8, 3.2), fx, fz);
    add(cap(oct, base + 0.9, std({ color: '#b9c3c9' })));
    for (let i = 0; i < 8; i++) { const p = oct[i]; add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.4, 8), stone, p[0] * 0.96 + fx * 0.04, base + 1.7, p[1] * 0.96 + fz * 0.04)); }
    add(mesh(new THREE.ConeGeometry(4.2, 2.4, 8), lead, fx, base + 3.4 + 1.2, fz));
    add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.0, 12), std({ color: '#c9c3b4' }), fx, base + 0.5, fz));
    // minaret at the corner of the north edge nearest the west (min x)
    const corner = a[0] < b[0] ? a : b; const mx = corner[0] + (cx - corner[0]) * 0.06 + ox * 1.5, mz = corner[1] + (cz - corner[1]) * 0.06 + oz * 1.5;
    add(mesh(new THREE.CylinderGeometry(1.35, 1.6, 34, 12), stone, mx, base + 17, mz));
    add(mesh(new THREE.CylinderGeometry(2.0, 1.4, 1.1, 12), stone, mx, base + 34.5, mz)); // šerefe
    add(mesh(new THREE.CylinderGeometry(1.15, 1.35, 7, 12), stone, mx, base + 38.5, mz));
    add(mesh(new THREE.ConeGeometry(1.5, 5.5, 12), lead, mx, base + 44.7, mz));
    add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6), std({ color: '#c9a34a', metalness: 0.7 }), mx, base + 48.5, mz));
    collide(shift(regular(8, 1.7), mx, mz), base, base + 45);
  }
  collide(pts, base, base + h);
};

export function buildLandmarks(list, { group, RAPIER, world, data }) {
  const box = (w, h, d, mat, x, y, z, ry = 0) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);
  let n = 0;
  for (const b of list) {
    const fn = B[b.landmark]; if (!fn) continue;
    const pts = b.pts;
    // landmarks sit on the high side of their footprint (with a plinth down to the low side) so arcades aren't buried by sloping lawns
    const hs = pts.map(([x, z]) => data.sampleHeight(x, z)).sort((a, b) => a - b);
    const base = hs[Math.floor(hs.length * 0.8)];
    const add = (m) => group.add(m);
    const collide = (poly, y0, y1) => {
      const v = new Float32Array(poly.length * 6);
      poly.forEach(([x, z], i) => { v[i * 6] = x; v[i * 6 + 1] = y0 - 1; v[i * 6 + 2] = z; v[i * 6 + 3] = x; v[i * 6 + 4] = y1; v[i * 6 + 5] = z; });
      const desc = RAPIER.ColliderDesc.convexHull(v); if (desc) world.createCollider(desc.setFriction(0.4));
    };
    fn({ pts, base, add, collide, box }); n++;
  }
  console.log(`[landmarks] ${n} built`);
}
