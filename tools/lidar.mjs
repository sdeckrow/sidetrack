/* Load the cached USGS 3DEP lidar chunks into one elevation grid.
 *
 * Grid is web-mercator-aligned (see fetch-lidar.mjs). Exposes:
 *   grid/W/H        Float32 elevations in FEET
 *   res             mercator meters per pixel
 *   toLL(cx, cy)    grid cell → {lat, lng}
 *   atLL(lat, lng)  bilinear elevation lookup in feet
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeTIFF } from "./tiff.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = 6378137;
const lng2mx = (lng) => (R * lng * Math.PI) / 180;
const lat2my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mx2lng = (mx) => (mx / R) * (180 / Math.PI);
const my2lat = (my) => (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * (180 / Math.PI);

export async function loadLidar(parkId) {
  const dir = path.join(HERE, "raw", "lidar", parkId);
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8"));
  const { mx0, my1, res, W, H, chunk } = meta;
  const grid = new Float32Array(W * H);

  for (let cy = 0; cy * chunk < H; cy++) {
    for (let cx = 0; cx * chunk < W; cx++) {
      const tif = decodeTIFF(await readFile(path.join(dir, `${cx}_${cy}.tif`)));
      const ox = cx * chunk, oy = cy * chunk;
      for (let y = 0; y < tif.height; y++) {
        for (let x = 0; x < tif.width; x++) {
          grid[(oy + y) * W + ox + x] = tif.data[y * tif.width + x] * 3.28084; // m → ft
        }
      }
    }
  }
  // nodata guard: clamp absurd values to the local minimum
  let lo = Infinity;
  for (let i = 0; i < grid.length; i++) if (grid[i] > -1000 && grid[i] < lo) lo = grid[i];
  for (let i = 0; i < grid.length; i++) if (grid[i] <= -1000 || !isFinite(grid[i])) grid[i] = lo;

  return {
    grid, W, H, res,
    toLL: (cx, cy) => ({ lat: my2lat(my1 - (cy + 0.5) * res), lng: mx2lng(mx0 + (cx + 0.5) * res) }),
    atLL(lat, lng) {
      const fx = (lng2mx(lng) - mx0) / res - 0.5;
      const fy = (my1 - lat2my(lat)) / res - 0.5;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
      const dx = Math.max(0, Math.min(1, fx - x0)), dy = Math.max(0, Math.min(1, fy - y0));
      return (
        grid[y0 * W + x0] * (1 - dx) * (1 - dy) + grid[y0 * W + x0 + 1] * dx * (1 - dy) +
        grid[(y0 + 1) * W + x0] * (1 - dx) * dy + grid[(y0 + 1) * W + x0 + 1] * dx * dy
      );
    },
  };
}
