/** City edits made in the in-game editor (E). Kept in localStorage while editing;
 *  `public/data/overrides.json` ships the baked version with the game.
 *  Shape: { roadWidths: { [osmWayId]: metres }, deletedRoads: [osmWayId…], treeExclusions: [[x, z, radius]…] } */
const KEY = 'sarajevo-overrides';
const EMPTY = () => ({ roadWidths: {}, deletedRoads: [], treeExclusions: [] });

export async function loadOverrides() {
  let base = EMPTY();
  try {
    const r = await fetch('/data/overrides.json');
    if (r.ok) base = { ...EMPTY(), ...(await r.json()) };
  } catch (e) { /* none shipped */ }
  let local = null;
  try { local = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
  if (local) {
    base.roadWidths = { ...base.roadWidths, ...local.roadWidths };
    base.deletedRoads = [...new Set([...base.deletedRoads, ...(local.deletedRoads || [])])];
    base.treeExclusions = [...base.treeExclusions, ...(local.treeExclusions || [])];
  }
  return base;
}

export function saveOverrides(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* full/blocked */ }
}

export function clearOverrides() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

/** Mutates the loaded city data: drops deleted roads, applies width overrides. */
export function applyOverrides(data, o) {
  const del = new Set(o.deletedRoads.map(Number));
  const before = data.city.roads.length;
  data.city.roads = data.city.roads.filter((r) => !del.has(r.id));
  for (const [id, w] of Object.entries(o.roadWidths)) {
    const r = data.city.roads.find((x) => x.id === Number(id));
    if (r) r.w = w;
  }
  const nW = Object.keys(o.roadWidths).length;
  if (before - data.city.roads.length || nW || o.treeExclusions.length)
    console.log(`[overrides] ${before - data.city.roads.length} roads deleted, ${nW} widths changed, ${o.treeExclusions.length} tree exclusions`);
  return o;
}
