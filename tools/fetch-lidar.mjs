/* Fetch lidar-grade elevation for each park from USGS 3DEP.
 *
 * The 3DEPElevation ImageServer resamples the 1 m lidar DEM to any grid
 * we ask for, in web mercator, as uncompressed Float32 TIFF. We request
 * a mercator-aligned grid fine enough for terrain-feature work:
 *   Red Mountain: 1.5 merc-m/px (~1.25 m ground)
 *   Oak Mountain: 2.5 merc-m/px (~2.1 m ground)  — park is huge
 * Chunks land in tools/raw/lidar/<park>/ and are mosaicked at build.
 *
 * Usage: node tools/fetch-lidar.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVC = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const CHUNK = 2048; // px per request (the service 500s on big F32 exports)

export const LIDAR_RES = { redmountain: 1.5, oakmountain: 2.5 }; // merc-m per px

const R = 6378137;
export const lng2mx = (lng) => (R * lng * Math.PI) / 180;
export const lat2my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

for (const id of ["redmountain", "oakmountain"]) {
  const { bbox } = JSON.parse(await readFile(path.join(HERE, "raw", `${id}.json`), "utf8"));
  const res = LIDAR_RES[id];
  // snap origin to the resolution grid so reruns align
  const mx0 = Math.floor(lng2mx(bbox.lngMin) / res) * res;
  const my1 = Math.ceil(lat2my(bbox.latMax) / res) * res; // top
  const W = Math.ceil((lng2mx(bbox.lngMax) - mx0) / res);
  const H = Math.ceil((my1 - lat2my(bbox.latMin)) / res);
  const dir = path.join(HERE, "raw", "lidar", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "meta.json"), JSON.stringify({ mx0, my1, res, W, H, chunk: CHUNK }));
  console.log(`${id}: ${W}x${H} px @ ${res} m/px (${Math.ceil(W / CHUNK) * Math.ceil(H / CHUNK)} chunks)`);

  for (let cy = 0; cy * CHUNK < H; cy++) {
    for (let cx = 0; cx * CHUNK < W; cx++) {
      const file = path.join(dir, `${cx}_${cy}.tif`);
      try { await readFile(file); console.log(`  ${cx}_${cy}.tif (cached)`); continue; } catch {}
      const w = Math.min(CHUNK, W - cx * CHUNK), h = Math.min(CHUNK, H - cy * CHUNK);
      const x1 = mx0 + cx * CHUNK * res, y2 = my1 - cy * CHUNK * res;
      const bb = `${x1},${y2 - h * res},${x1 + w * res},${y2}`;
      const url = `${SVC}?bbox=${bb}&bboxSR=3857&imageSR=3857&size=${w},${h}` +
        `&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
      let resp, attempt = 0;
      for (;;) {
        resp = await fetch(url);
        if (resp.ok) break;
        if (++attempt >= 4) throw new Error(`${id} chunk ${cx},${cy}: HTTP ${resp.status}`);
        await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1000 || buf.readUInt16LE(0) !== 0x4949) {
        throw new Error(`${id} chunk ${cx},${cy}: not a TIFF (${buf.length} bytes): ${buf.toString("utf8", 0, 200)}`);
      }
      await writeFile(file, buf);
      console.log(`  ${cx}_${cy}.tif ${(buf.length / 1e6).toFixed(1)} MB`);
      await new Promise((r) => setTimeout(r, 1500)); // be polite
    }
  }
}
console.log("done.");
