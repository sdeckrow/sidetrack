/* Download AWS Terrain Tiles (terrarium PNGs) covering each park's bbox.
 *
 * Public dataset, no API key: s3.amazonaws.com/elevation-tiles-prod.
 * Tiles are cached in tools/raw/tiles/{z}/{x}/{y}.png so re-running the
 * build never re-downloads. build-mapdata.mjs decodes them into a DEM.
 *
 * Usage: node tools/fetch-elevation.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILE_DIR = path.join(HERE, "raw", "tiles");
const Z = 15; // ~4 m/px at this latitude — fine enough for terrain-feature detection

const lng2x = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

for (const id of ["redmountain", "oakmountain"]) {
  const { bbox } = JSON.parse(await readFile(path.join(HERE, "raw", `${id}.json`), "utf8"));
  const x0 = Math.floor(lng2x(bbox.lngMin, Z)), x1 = Math.floor(lng2x(bbox.lngMax, Z));
  const y0 = Math.floor(lat2y(bbox.latMax, Z)), y1 = Math.floor(lat2y(bbox.latMin, Z));
  console.log(`${id}: tiles x ${x0}-${x1}, y ${y0}-${y1} (${(x1 - x0 + 1) * (y1 - y0 + 1)} tiles)`);

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const file = path.join(TILE_DIR, String(Z), String(x), `${y}.png`);
      try { await readFile(file); continue; } catch {} // cached
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      console.log(`  ${Z}/${x}/${y}.png`);
    }
  }
}
console.log("done.");
