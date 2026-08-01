import type { WarpStats } from '../model/types';

/**
 * PFM (Portable Float Map) parser.
 *
 *   Line 1: "PF" (3-channel) or "Pf" (1-channel)
 *   Line 2: "<width> <height>"
 *   Line 3: scale factor — negative means little-endian
 *   Then:   raw float32 pixel data, BOTTOM-to-TOP scanlines
 *
 * MPCDI geometry warp files are "PF": R = content U, G = content V,
 * B = unused/zero in every producer we've seen. Unmapped projector
 * pixels are written as NaN, which must be preserved (not zeroed) so
 * the renderer can mask them out.
 */

export interface PfmResult {
  width: number;
  height: number;
  channels: number;
  data: Float32Array;
}

export function parsePFM(buffer: ArrayBuffer): PfmResult {
  const bytes = new Uint8Array(buffer);
  let pos = 0;

  function readLine(): string {
    let line = '';
    while (pos < bytes.length) {
      const ch = bytes[pos++];
      if (ch === 0x0a) break;
      if (ch !== 0x0d) line += String.fromCharCode(ch);
    }
    return line;
  }

  const magic = readLine().trim();
  let channels: number;
  if (magic === 'PF') channels = 3;
  else if (magic === 'Pf') channels = 1;
  else throw new Error(`Invalid PFM magic: "${magic}"`);

  const dims = readLine().trim().split(/\s+/);
  const width = parseInt(dims[0], 10);
  const height = parseInt(dims[1], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid PFM dimensions: ${dims.join(' ')}`);
  }

  const scale = parseFloat(readLine().trim());
  if (!Number.isFinite(scale) || scale === 0) {
    throw new Error(`Invalid PFM scale factor`);
  }
  const littleEndian = scale < 0;

  const pixelCount = width * height * channels;
  const expectedBytes = pixelCount * 4;
  const raw = bytes.subarray(pos, pos + expectedBytes);
  if (raw.length < expectedBytes) {
    throw new Error(`PFM truncated: expected ${expectedBytes} bytes, got ${raw.length}`);
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bottomUp = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    bottomUp[i] = view.getFloat32(i * 4, littleEndian);
  }

  // PFM scanlines run bottom-to-top. Flip to top-first so the array
  // matches how WebGL uploads texture rows.
  const rowFloats = width * channels;
  const data = new Float32Array(pixelCount);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowFloats;
    data.set(bottomUp.subarray(src, src + rowFloats), y * rowFloats);
  }

  return { width, height, channels, data };
}

/** Expand 1-channel PFM to 3-channel; pass 3-channel through unchanged. */
export function normalizeWarpData(pfm: PfmResult): Float32Array {
  if (pfm.channels === 3) return pfm.data;
  const out = new Float32Array(pfm.width * pfm.height * 3);
  for (let i = 0; i < pfm.width * pfm.height; i++) {
    out[i * 3] = pfm.data[i];
  }
  return out;
}

/**
 * Measure the warp map so the UI can report whether coordinates look
 * normalized or absolute, and how much of the frame is unmapped.
 * NaN texels are counted separately rather than skewing the range.
 */
export function computeWarpStats(data: Float32Array, width: number, height: number): WarpStats {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let nanCount = 0;
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const x = data[i * 3];
    const y = data[i * 3 + 1];
    if (Number.isNaN(x) || Number.isNaN(y)) { nanCount++; continue; }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }

  // Values comfortably inside [0,1] indicate normalized coordinates;
  // anything much larger is almost certainly absolute pixel values.
  const looksNormalized = maxX <= 1.001 && maxY <= 1.001 && minX >= -0.001 && minY >= -0.001;

  return { minX, maxX, minY, maxY, nanCount, totalTexels: total, looksNormalized };
}
