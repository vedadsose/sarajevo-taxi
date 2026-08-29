# Sarajevo Taxi

A browser driving game set in real Sarajevo. Terrain comes from open elevation data, streets and buildings from OpenStreetMap.

## Run it

```sh
npm install
npm run dev
```

Open http://localhost:5173.

## Controls

- **WASD / arrows** — drive
- **Space** — handbrake (drift)
- **R** — flip the car upright
- **T** — back to Maršala Tita
- **C** — toggle camera
- **N** — skip time forward 2 hours (one game hour passes every 75 s)
- **H** — horn
- **P** — toggle rain
- **C** — cycles chase / far / bonnet camera
- **M** (or click the minimap) — full-screen map; click anywhere to spawn there

A passenger waits at the green beacon; stop next to them, then drive to the yellow beacon (destination shown at the top and on the minimap). Fares pay ~1.5 KM + 1.2 KM/km, plus a tip for a fast ride.

## Regenerate city data

`public/data/` is generated from OpenStreetMap + AWS Terrarium elevation tiles. To change the area, edit `BBOX` in `scripts/fetch-data.mjs` and run:

```sh
node scripts/fetch-data.mjs            # uses scripts/.cache-osm.json if present
node scripts/fetch-data.mjs --refresh  # re-query Overpass
node scripts/audit-roads.mjs           # smoothness / junction / bridge report
```

### How the ground is built (`scripts/ground.mjs`)

1. **Valley floor** — where the DEM is flatter than ~3 %, it is smoothed over ~90 m (the 30 m elevation model is noisy on flat ground); hills keep their detail.
2. **Roads first** — every road becomes a smooth 3D centreline from a single global least-squares solve (curvature-minimising, junction heights shared, bridges as free spans, roads under viaducts pushed down into underpasses). The car drives on these road meshes, not on the terrain.
3. **Terrain follows the roads** — a 5 m grid is pulled to kerb level across road + pavement and graded out over up to 30 m; ground under bridge decks is kept below them.
4. **River** — the Miljacka bed is carved inside the OSM riverbank polygon with a monotone downstream water level kept below riverside roads; quay walls line the polygon edge.

`src/city.js` then builds road surfaces, kerbs, pavements, markings, bridges (with solid parapets), lamps and the collision meshes from `road.line`.

## Play online

**https://sarajevo-taxi-production.up.railway.app** — static build served by nginx on Railway (`Dockerfile` + `nginx.conf`). Every `railway up` from this folder redeploys; the repo lives at https://github.com/vedadsose/sarajevo-taxi.

To host elsewhere: `npm run build` and serve `dist/` from any static host.
