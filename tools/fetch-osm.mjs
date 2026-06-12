/* Fetch real OSM data for Sidetrack's parks.
 *
 * Pulls the park boundary polygon, then every trail, road, water feature
 * and parking lot inside it (plus a small buffer). Raw responses land in
 * tools/raw/<park>.json for build-mapdata.mjs to process.
 *
 * Usage: node tools/fetch-osm.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "raw");
const UA = "sidetrack-map-build/1.0 (github.com/sdeckrow/sidetrack)";
const OVERPASS = "https://overpass-api.de/api/interpreter";

// OSM way ids of the park boundary polygons (found 2026-06-12).
const PARKS = [
  { id: "redmountain", name: "Red Mountain Park", boundaryWay: 405947402, bufferDeg: 0.002 },
  { id: "oakmountain", name: "Oak Mountain State Park", boundaryWay: 152253403, bufferDeg: 0.002 },
];

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const park of PARKS) {
  console.log(`\n=== ${park.name} ===`);

  // 1. boundary polygon with full geometry
  const bq = `[out:json][timeout:60];way(${park.boundaryWay});out geom;`;
  const bres = await overpass(bq);
  const boundary = bres.elements[0];
  if (!boundary?.geometry) throw new Error(`no boundary geometry for ${park.id}`);
  const lats = boundary.geometry.map((p) => p.lat);
  const lons = boundary.geometry.map((p) => p.lon);
  const bbox = {
    latMin: Math.min(...lats) - park.bufferDeg,
    latMax: Math.max(...lats) + park.bufferDeg,
    lngMin: Math.min(...lons) - park.bufferDeg,
    lngMax: Math.max(...lons) + park.bufferDeg,
  };
  console.log(`boundary: ${boundary.geometry.length} pts, bbox`, bbox);

  await sleep(2000); // be polite to the public API

  // 2. everything interesting inside the bbox
  const bb = `(${bbox.latMin},${bbox.lngMin},${bbox.latMax},${bbox.lngMax})`;
  const fq = `[out:json][timeout:120];
(
  way["highway"~"^(path|footway|track|cycleway|bridleway|steps)$"]${bb};
  way["highway"~"^(residential|service|unclassified|tertiary|secondary|primary)$"]${bb};
  way["natural"="water"]${bb};
  way["waterway"~"^(river|stream|dam)$"]${bb};
  way["amenity"="parking"]${bb};
  way["landuse"~"^(reservoir|meadow|grass|recreation_ground)$"]${bb};
  way["leisure"~"^(pitch|golf_course|swimming_area|beach_resort)$"]${bb};
  way["natural"~"^(beach|grassland|scrub|cliff)$"]${bb};
  way["power"="line"]${bb};
  way["man_made"="pier"]${bb};
  node["tourism"~"^(viewpoint|attraction|camp_site|picnic_site)$"]${bb};
  node["historic"]${bb};
  node["natural"~"^(peak|saddle|spring|cave_entrance)$"]${bb};
  node["waterway"="waterfall"]${bb};
  node["amenity"~"^(parking|drinking_water|shelter|toilets)$"]${bb};
  node["man_made"~"^(tower|adit|mineshaft)$"]${bb};
);
out geom;`;
  const fres = await overpass(fq);
  console.log(`features: ${fres.elements.length} elements`);

  const counts = {};
  for (const e of fres.elements) {
    const k =
      e.tags?.highway ? `highway=${e.tags.highway}` :
      e.tags?.natural ? `natural=${e.tags.natural}` :
      e.tags?.waterway ? `waterway=${e.tags.waterway}` :
      e.tags?.amenity ? `amenity=${e.tags.amenity}` :
      e.tags?.historic ? `historic=*` :
      e.tags?.tourism ? `tourism=${e.tags.tourism}` :
      e.tags?.landuse ? `landuse=${e.tags.landuse}` :
      e.tags?.leisure ? `leisure=${e.tags.leisure}` :
      e.tags?.power ? "power=line" :
      e.tags?.man_made ? `man_made=${e.tags.man_made}` : "other";
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join("\n"));

  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(
    path.join(RAW_DIR, `${park.id}.json`),
    JSON.stringify({ park: park.id, name: park.name, bbox, boundary, elements: fres.elements })
  );
  console.log(`wrote tools/raw/${park.id}.json`);

  await sleep(3000);
}
console.log("\ndone.");
