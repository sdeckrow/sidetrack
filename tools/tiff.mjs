/* Minimal GeoTIFF reader for USGS 3DEP exportImage responses:
 * little-endian, single-band Float32, tiled or stripped,
 * uncompressed (compression=1) or deflate (8/32946). No dependencies.
 */

import zlib from "node:zlib";

export function decodeTIFF(buf) {
  if (buf.readUInt16LE(0) !== 0x4949 || buf.readUInt16LE(2) !== 42) {
    throw new Error("not a little-endian TIFF");
  }
  const tags = {};
  let ifd = buf.readUInt32LE(4);
  const n = buf.readUInt16LE(ifd);
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8 };
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12;
    const tag = buf.readUInt16LE(o), type = buf.readUInt16LE(o + 2), count = buf.readUInt32LE(o + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    const off = size <= 4 ? o + 8 : buf.readUInt32LE(o + 8);
    const vals = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) vals.push(buf.readUInt16LE(off + k * 2));
      else if (type === 4) vals.push(buf.readUInt32LE(off + k * 4));
      else if (type === 11) vals.push(buf.readFloatLE(off + k * 4));
      else if (type === 12) vals.push(buf.readDoubleLE(off + k * 8));
      else if (type === 2) { vals.push(buf.toString("ascii", off, off + count - 1)); break; }
      else vals.push(buf.readUInt8(off + k));
    }
    tags[tag] = vals;
  }

  const W = tags[256][0], H = tags[257][0];
  const compression = tags[259]?.[0] ?? 1;
  if ((tags[258]?.[0] ?? 32) !== 32 || (tags[339]?.[0] ?? 3) !== 3) {
    throw new Error("expected Float32 sample format");
  }
  const out = new Float32Array(W * H);

  const inflate = (b) =>
    compression === 8 || compression === 32946 ? zlib.inflateSync(b) : b;
  if (compression !== 1 && compression !== 8 && compression !== 32946) {
    throw new Error(`unsupported TIFF compression ${compression}`);
  }

  if (tags[324]) {
    // tiled
    const tw = tags[322][0], th = tags[323][0];
    const offs = tags[324], counts = tags[325];
    const tilesAcross = Math.ceil(W / tw);
    offs.forEach((off, ti) => {
      const data = inflate(buf.subarray(off, off + counts[ti]));
      const tx = (ti % tilesAcross) * tw, ty = Math.floor(ti / tilesAcross) * th;
      for (let y = 0; y < th && ty + y < H; y++) {
        for (let x = 0; x < tw && tx + x < W; x++) {
          out[(ty + y) * W + tx + x] = data.readFloatLE((y * tw + x) * 4);
        }
      }
    });
  } else {
    // stripped
    const rps = tags[278]?.[0] ?? H;
    const offs = tags[273], counts = tags[279];
    offs.forEach((off, si) => {
      const data = inflate(buf.subarray(off, off + counts[si]));
      const y0 = si * rps;
      for (let y = 0; y < rps && y0 + y < H; y++) {
        for (let x = 0; x < W; x++) {
          out[(y0 + y) * W + x] = data.readFloatLE((y * W + x) * 4);
        }
      }
    });
  }
  return { width: W, height: H, data: out, nodata: tags[42113] ? parseFloat(tags[42113][0]) : null };
}
