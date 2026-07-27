import type { WarpMap, BlendMap } from '../model/types';

/** Upload a warp map (Float32 RGB) as a GL texture */
export function uploadWarpTexture(
  gl: WebGL2RenderingContext,
  warp: WarpMap,
  existing?: WebGLTexture | null
): WebGLTexture {
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0,
    gl.RGB32F,               // internal format
    warp.width, warp.height, 0,
    gl.RGB,                   // format
    gl.FLOAT,                 // type
    warp.data
  );
  // Use NEAREST for warp maps to avoid interpolation artifacts during debugging.
  // Switch to LINEAR for production-quality rendering.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Upload a blend/correction map (single-channel float) as R32F texture */
export function uploadBlendTexture(
  gl: WebGL2RenderingContext,
  map: BlendMap,
  existing?: WebGLTexture | null
): WebGLTexture {
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0,
    gl.R32F,
    map.width, map.height, 0,
    gl.RED,
    gl.FLOAT,
    map.data
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Upload a source frame from an image or video element.
 * Creates a new texture on first call; reuses on subsequent calls.
 */
export function uploadSourceTexture(
  gl: WebGL2RenderingContext,
  source: HTMLImageElement | HTMLVideoElement,
  existing?: WebGLTexture | null
): WebGLTexture {
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    source
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Create a 1x1 placeholder texture (used when a map isn't loaded) */
export function createPlaceholderTexture(
  gl: WebGL2RenderingContext,
  r = 0, g = 0, b = 0, a = 255
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0,
    gl.RGBA,
    1, 1, 0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([r, g, b, a])
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return tex;
}
