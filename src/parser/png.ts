import type { BlendMap } from '../model/types';

/**
 * Load a PNG from an ArrayBuffer and extract a single-channel float map.
 * Uses an offscreen canvas to decode. Takes the red channel as the value.
 */
export async function loadPngAsBlendMap(
  buffer: ArrayBuffer,
  path: string
): Promise<BlendMap> {
  const blob = new Blob([buffer], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data; // RGBA Uint8

  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    // Use red channel, normalized to [0,1]
    data[i] = pixels[i * 4] / 255;
  }

  return { width, height, data, path };
}
