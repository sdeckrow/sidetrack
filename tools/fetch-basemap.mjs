/* Download USGS Topo basemap tiles covering each park.
 *
 * The National Map's USGSTopo service is public domain — real USGS
 * cartography (lidar contours, woodland tint, hydrography). Tiles land
 * in tiles/usgstopo/{z}/{x}/{y}.png at the web root so the app can show
 * them offline; the build emits each park's tile range.
 *
 * Usage: node tools/fetch-basemap.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "tiles", "usgstopo");
const LEVELS = [15, 16]; // 16 is the deepest the USGS Topo cache serves
const URL = (z, x, y) =>
  `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${z}/${y}/${x}`;

const lng2x = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

for (const id of ["redmountain", "oakmountain"]) {
  const { bbox } = JSON.parse(await readFile(path.join(HERE, "raw", `${id}.json`), "utf8"));
  for (const Z of LEVELS) {
    const x0 = Math.floor(lng2x(bbox.lngMin, Z)), x1 = Math.floor(lng2x(bbox.lngMax, Z));
    const y0 = Math.floor(lat2y(bbox.latMax, Z)), y1 = Math.floor(lat2y(bbox.latMin, Z));
    console.log(`${id}: ${(x1 - x0 + 1) * (y1 - y0 + 1)} tiles (z${Z})`);

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const file = path.join(OUT_DIR, String(Z), String(x), `${y}.png`);
        try { await readFile(file); continue; } catch {}
        const res = await fetch(URL(Z, x, y));
        if (!res.ok) throw new Error(`tile ${Z}/${x}/${y} -> ${res.status}`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 120)); // be polite
      }
    }
    console.log(" done");
  }
}
