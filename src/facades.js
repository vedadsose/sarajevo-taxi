import * as THREE from 'three';

export const BAYS = 4, FLOORS = 3; // a tile covers 4 bays × 3 floors so lit-window patterns can vary
const TW = 256, TH = 256;
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Draws a tile by calling draw(g, x, y, w, h, bay, floor) once per window cell. */
function tile(drawBg, drawCell, seed = 1) {
  const c = document.createElement('canvas'); c.width = TW * BAYS; c.height = TH * FLOORS;
  const g = c.getContext('2d');
  drawBg(g, c.width, c.height);
  for (let f = 0; f < FLOORS; f++) for (let b = 0; b < BAYS; b++) {
    g.save(); g.translate(b * TW, f * TH); drawCell(g, hash(b + seed * 7, f + seed * 3)); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const bg = (color, band) => (g, w, h) => {
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  if (band) for (let f = 0; f < FLOORS; f++) { g.fillStyle = band.c; g.fillRect(0, f * TH, w, band.h); }
};
const win = (g, x, y, w, h, frame = '#3a3f4a', glass = '#25303f') => {
  g.fillStyle = frame; g.fillRect(x - 6, y - 6, w + 12, h + 12);
  g.fillStyle = glass; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, h * 0.45);
  g.fillStyle = frame; g.fillRect(x + w / 2 - 2, y, 4, h);
};
/** Emissive mask: black walls, warm lit windows for ~55% of cells. */
const lit = (x, y, w, h, prob = 0.55) => (g, r) => {
  if (r > prob) return;
  const warm = r < 0.2 ? '#ffe7b0' : r < 0.4 ? '#ffd27a' : '#ffc466';
  g.fillStyle = warm; g.fillRect(x, y, w, h);
};
const black = (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); };

export function createFacadeMaterials() {
  const styles = {
    oldtown: { map: tile(bg('#f4f0e6', { c: '#5a3f2a', h: 10 }), (g) => { win(g, 88, 84, 80, 96, '#6b4a2f', '#2b3038'); g.fillStyle = '#6b4a2f'; g.fillRect(70, 186, 116, 8); }, 1), em: tile(black, lit(88, 84, 80, 96, 0.5), 1) },
    house: { map: tile(bg('#f6f2ea'), (g) => { win(g, 84, 78, 88, 100, '#ffffff', '#2a3542'); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(70, 184, 116, 8); }, 2), em: tile(black, lit(84, 78, 88, 100, 0.5), 2) },
    austro: { map: tile(bg('#f2ecdf', { c: 'rgba(0,0,0,.22)', h: 14 }), (g) => { g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 14, 256, 4); win(g, 90, 60, 76, 140, '#e9e2d2', '#1f2a38'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(70, 48, 116, 10); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(74, 200, 108, 8); }, 3), em: tile(black, lit(90, 60, 76, 140, 0.55), 3) },
    socialist: { map: tile(bg('#efece6', { c: 'rgba(0,0,0,.28)', h: 20 }), (g) => { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, 20, 256, 60); for (let x = 8; x < 256; x += 24) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 20, 3, 60); } win(g, 40, 104, 176, 100, '#d8d4cc', '#232d3a'); }, 4), em: tile(black, lit(40, 104, 176, 100, 0.6), 4) },
    glass: { map: tile(bg('#5b7f9a'), (g) => { g.fillStyle = '#6f95b0'; g.fillRect(0, 0, 256, 110); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 0, 256, 6); g.fillRect(0, 128, 256, 4); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 118, 256, 10); g.fillRect(124, 0, 8, 256); }, 5), em: tile(black, lit(8, 8, 240, 100, 0.45), 5) },
  };
  const mk = (st, extra = {}) => new THREE.MeshStandardMaterial({ map: st.map, emissiveMap: st.em, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide, ...extra });
  const mats = {
    oldtown: mk(styles.oldtown), house: mk(styles.house), austro: mk(styles.austro), socialist: mk(styles.socialist),
    glass: mk(styles.glass, { roughness: 0.25, metalness: 0.55 }),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide }),
  };
  /** 0 = day, 1 = night */
  mats.setNight = (n) => { for (const k of ['oldtown', 'house', 'austro', 'socialist', 'glass']) mats[k].emissiveIntensity = n * 1.05; };
  return mats;
}

/** Bay width (m), floor height (m), wall tints, roof colours per style. */
export const STYLE = {
  oldtown: { bay: 3.4, floor: 3.0, walls: ['#f4efe4', '#efe7d6', '#f6f1e8', '#e9dfcc', '#ecebe4'], roofs: ['#8a4b35', '#96553c', '#7c4432', '#a05f43'], pyramid: true },
  house: { bay: 3.6, floor: 3.0, walls: ['#f1eadc', '#e6d9c4', '#ded3c6', '#f0dfc4', '#d7cbb7', '#e8d3be', '#f3ece0', '#cfd6c9', '#e4c9b0'], roofs: ['#8a4b35', '#9a5a3c', '#7b4433', '#6e6a68', '#a4634a'], pyramid: true },
  austro: { bay: 3.3, floor: 3.7, walls: ['#e3c58b', '#e8d5a3', '#dfc198', '#dccbb7', '#cdbaa1', '#e2bda6', '#cbc9ab', '#ead9be', '#d9b98c', '#c9d1c7'], roofs: ['#4b4f55', '#5a4a44', '#55585e', '#6a5048'] },
  socialist: { bay: 3.8, floor: 2.9, walls: ['#aaa8a3', '#bab7b0', '#c6c1b7', '#9e9c99', '#d1c4a6', '#b1aa9b', '#c8c8c0', '#b7b09f'], roofs: ['#5c5e63', '#66686c', '#4f5155'] },
  glass: { bay: 4.0, floor: 3.6, walls: ['#ffffff', '#e8eef2', '#dbe6ee'], roofs: ['#3a3f47'] },
  plain: { bay: 4, floor: 3, walls: ['#b3aea6', '#a8a39b', '#c0bbb2'], roofs: ['#6a6a6a', '#5e5b57'] },
  mosque: { bay: 4, floor: 3.4, walls: ['#f5f2ea', '#efe9dc'], roofs: ['#8a4b35'] },
};
