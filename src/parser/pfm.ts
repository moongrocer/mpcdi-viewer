/**
 * PFM (Portable Float Map) parser.
 *
 * PFM format:
 *   Line 1: "PF" (color, 3-channel) or "Pf" (grayscale, 1-channel)
 *   Line 2: "<width> <height>"
 *   Line 3: scale factor (negative = little-endian, positive = big-endian)
 *   Remainder: raw float32 pixel data, bottom-to-top scanlines
 *
 * For MPCDI warp maps: typically PF (3-channel): R=x, G=y, B=intensity.
 * The data is stored bottom-row-first in the file, so we flip to top-row-first.
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
      if (ch === 0x0a) break; // newline
      if (ch !== 0x0d) line += String.fromCharCode(ch); // skip CR
    }
    return line;
  }

  // Line 1: magic
  const magic = readLine();
  let channels: number;
  if (magic === 'PF') channels = 3;
  else if (magic === 'Pf') channels = 1;
  else throw new Error(`Invalid PFM magic: "${magic}"`);

  // Line 2: dimensions
  const dims = readLine().trim().split(/\s+/);
  const width = parseInt(dims[0], 10);
  const height = parseInt(dims[1], 10);
  if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid PFM dimensions: ${dims.join(' ')}`);
  }

  // Line 3: scale (sign encodes endianness)
  const scaleStr = readLine().trim();
  const scale = parseFloat(scaleStr);
  if (isNaN(scale) || scale === 0) {
    throw new Error(`Invalid PFM scale: ${scaleStr}`);
  }
  const littleEndian = scale < 0;

  // Remaining bytes: float32 pixel data
  const pixelCount = width * height * channels;
  const expectedBytes = pixelCount * 4;
  const rawBytes = bytes.subarray(pos, pos + expectedBytes);

  if (rawBytes.length < expectedBytes) {
    throw new Error(
      `PFM data truncated: expected ${expectedBytes} bytes, got ${rawBytes.length}`
    );
  }

  // Read floats respecting endianness
  const dataView = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const pixelsBottomUp = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    pixelsBottomUp[i] = dataView.getFloat32(i * 4, littleEndian);
  }

  // PFM stores rows bottom-to-top. Flip to top-to-top (standard image order).
  const rowFloats = width * channels;
  const data = new Float32Array(pixelCount);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    const srcOff = srcRow * rowFloats;
    const dstOff = y * rowFloats;
    data.set(pixelsBottomUp.subarray(srcOff, srcOff + rowFloats), dstOff);
  }

  return { width, height, channels, data };
}

/**
 * Normalize a 3-channel PFM warp map to a Float32Array with 3 floats per pixel.
 * If input is 1-channel, expand to 3 channels (value, 0, 0).
 */
export function normalizeWarpData(pfm: PfmResult): Float32Array {
  if (pfm.channels === 3) return pfm.data;
  // Expand 1-channel to 3-channel
  const out = new Float32Array(pfm.width * pfm.height * 3);
  for (let i = 0; i < pfm.width * pfm.height; i++) {
    out[i * 3] = pfm.data[i];
    out[i * 3 + 1] = 0;
    out[i * 3 + 2] = 0;
  }
  return out;
}
