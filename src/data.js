export async function loadData(onMsg = () => {}) {
  onMsg('Loading terrain…');
  const [meta, bin, city] = await Promise.all([
    fetch('/data/terrain.json').then((r) => r.json()),
    fetch('/data/terrain.bin').then((r) => r.arrayBuffer()),
    fetch('/data/city.json').then((r) => r.json()),
  ]);
  const heights = new Float32Array(bin);
  const { cols, rows, step, originX, originZ } = meta;

  // Bilinear height sampler in world coords (x east, z south).
  function sampleHeight(x, z) {
    let fx = (x - originX) / step, fz = (z - originZ) / step;
    fx = Math.max(0, Math.min(cols - 1.0001, fx));
    fz = Math.max(0, Math.min(rows - 1.0001, fz));
    const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
    const h00 = heights[r * cols + c], h01 = heights[r * cols + c + 1];
    const h10 = heights[(r + 1) * cols + c], h11 = heights[(r + 1) * cols + c + 1];
    return (h00 * (1 - u) + h01 * u) * (1 - v) + (h10 * (1 - u) + h11 * u) * v;
  }

  const [lat0, lon0] = city.center;
  const mLat = 110540, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toLocal = (lat, lon) => [(lon - lon0) * mLon, -(lat - lat0) * mLat];

  return { terrain: { ...meta, heights }, city, sampleHeight, toLocal };
}
