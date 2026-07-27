import type { Region, RenderSettings, SourceMedia, DebugMode } from '../model/types';
import { createContext, compileShader, linkProgram } from './context';
import { VERT_SRC, FRAG_SRC } from './shaders';
import {
  uploadWarpTexture,
  uploadBlendTexture,
  uploadSourceTexture,
  createPlaceholderTexture,
} from './textures';

/**
 * Largest box of the given aspect (width / height) that fits in availW × availH.
 * A null aspect fills the space.
 */
export function fitBox(
  availW: number,
  availH: number,
  aspect: number | null,
): [number, number] {
  if (aspect === null) return [availW, availH];
  return availW / availH > aspect
    ? [Math.max(1, Math.round(availH * aspect)), availH]
    : [availW, Math.max(1, Math.round(availW / aspect))];
}

/** width / height, or null if either dimension is missing or nonsensical. */
function toAspect(w: number | undefined, h: number | undefined): number | null {
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return w / h;
}

const DEBUG_MODE_MAP: Record<DebugMode, number> = {
  final: 0,
  source: 1,
  uv: 2,
  checker: 3,
  warpViz: 4,
};

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  // Uniform locations (cached)
  private loc: Record<string, WebGLUniformLocation | null> = {};

  // Textures
  private texSource: WebGLTexture | null = null;
  private texWarp: WebGLTexture | null = null;
  private texAlpha: WebGLTexture | null = null;
  private texBlackLevel: WebGLTexture | null = null;
  private texPlaceholder: WebGLTexture;

  // State
  private hasWarp = false;
  private hasAlpha = false;
  private hasBlackLevel = false;
  private sourceSize: [number, number] = [1, 1];
  private warpSize: [number, number] = [1, 1];

  // Aspects the canvas can be letterboxed to (width / height); null = unknown.
  private regionAspect: number | null = null;
  private sourceAspect: number | null = null;
  private cssSize: [number, number] = [0, 0];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    const gl = this.gl;

    // Compile shaders
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    this.program = linkProgram(gl, vert, frag);

    // Cache uniform locations
    const uniforms = [
      'uSource', 'uWarpMap', 'uHasWarp',
      'uAlphaMap', 'uHasAlpha',
      'uBlackLevelMap', 'uHasBlackLevel',
      'uDebugMode', 'uBlendEnabled', 'uBlackLevelEnabled', 'uBoundsOverlay',
      'uWarpFlipY', 'uWarpInverse', 'uWarpCoords',
      'uWarpSize', 'uSourceSize',
    ];
    for (const name of uniforms) {
      this.loc[name] = gl.getUniformLocation(this.program, name);
    }

    // Empty VAO for the fullscreen triangle (no vertex attributes needed)
    this.vao = gl.createVertexArray()!;

    // Placeholder texture
    this.texPlaceholder = createPlaceholderTexture(gl, 128, 128, 128);
  }

  /** Upload region data (warp + blend maps) */
  loadRegion(region: Region) {
    const gl = this.gl;

    // The region's output raster defines the preview's shape — not the source,
    // which the warp is free to resample into a different aspect entirely.
    this.regionAspect = toAspect(region.xResolution, region.yResolution);

    // Warp
    if (region.warpMap) {
      this.texWarp = uploadWarpTexture(gl, region.warpMap, this.texWarp);
      this.hasWarp = true;
      this.warpSize = [region.warpMap.width, region.warpMap.height];
    } else {
      this.hasWarp = false;
    }

    // Alpha blend
    if (region.blendMaps.alphaMap) {
      this.texAlpha = uploadBlendTexture(gl, region.blendMaps.alphaMap, this.texAlpha);
      this.hasAlpha = true;
    } else {
      this.hasAlpha = false;
    }

    // Black level
    if (region.blendMaps.blackLevelMap) {
      this.texBlackLevel = uploadBlendTexture(gl, region.blendMaps.blackLevelMap, this.texBlackLevel);
      this.hasBlackLevel = true;
    } else {
      this.hasBlackLevel = false;
    }
  }

  /** Upload source media (called once for images, every frame for video) */
  uploadSource(media: SourceMedia) {
    if (!media.element) return;
    const gl = this.gl;
    this.texSource = uploadSourceTexture(gl, media.element, this.texSource);
    this.sourceSize = [media.width, media.height];
    this.sourceAspect = toAspect(media.width, media.height);
  }

  /**
   * Aspect the preview is letterboxed to: the region's output raster when an
   * MPCDI region is loaded, falling back to the source when it isn't (or when
   * the manifest omits a usable resolution). null = fill the pane.
   */
  get displayAspect(): number | null {
    return this.regionAspect ?? this.sourceAspect;
  }

  /** Update source texture from video without recreating */
  updateVideoFrame(video: HTMLVideoElement) {
    if (!this.texSource) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texSource);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /**
   * Fit the canvas inside its pane, letterboxed to `displayAspect` and centred.
   * The drawing buffer tracks the fitted CSS box so pixels stay square —
   * sizing the buffer to the pane instead would stretch the render.
   */
  resize() {
    const host = this.canvas.parentElement;
    const availW = host ? host.clientWidth : this.canvas.clientWidth;
    const availH = host ? host.clientHeight : this.canvas.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    const [cssW, cssH] = fitBox(availW, availH, this.displayAspect);

    if (this.cssSize[0] !== cssW || this.cssSize[1] !== cssH) {
      this.cssSize = [cssW, cssH];
      const style = this.canvas.style;
      style.width = `${cssW}px`;
      style.height = `${cssH}px`;
      style.left = `${Math.round((availW - cssW) / 2)}px`;
      style.top = `${Math.round((availH - cssH) / 2)}px`;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Render one frame */
  render(settings: RenderSettings) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    // Bind textures to units
    this.bindTex(0, this.texSource ?? this.texPlaceholder, 'uSource');
    this.bindTex(1, this.texWarp ?? this.texPlaceholder, 'uWarpMap');
    this.bindTex(2, this.texAlpha ?? this.texPlaceholder, 'uAlphaMap');
    this.bindTex(3, this.texBlackLevel ?? this.texPlaceholder, 'uBlackLevelMap');

    // Uniforms — map presence
    gl.uniform1i(this.loc['uHasWarp'], this.hasWarp ? 1 : 0);
    gl.uniform1i(this.loc['uHasAlpha'], this.hasAlpha ? 1 : 0);
    gl.uniform1i(this.loc['uHasBlackLevel'], this.hasBlackLevel ? 1 : 0);

    // Debug mode
    gl.uniform1i(this.loc['uDebugMode'], DEBUG_MODE_MAP[settings.debugMode] ?? 0);

    // Blend / correction toggles
    gl.uniform1i(this.loc['uBlendEnabled'], settings.blendEnabled ? 1 : 0);
    gl.uniform1i(this.loc['uBlackLevelEnabled'], settings.blackLevelEnabled ? 1 : 0);
    gl.uniform1i(this.loc['uBoundsOverlay'], settings.boundsOverlay ? 1 : 0);

    // Warp interpretation
    gl.uniform1i(this.loc['uWarpFlipY'], settings.warp.flipY ? 1 : 0);
    gl.uniform1i(this.loc['uWarpInverse'], settings.warp.inverseMapping ? 1 : 0);
    gl.uniform1i(this.loc['uWarpCoords'], settings.warp.coordSpace === 'absolute' ? 1 : 0);
    gl.uniform2f(this.loc['uWarpSize'], this.warpSize[0], this.warpSize[1]);
    gl.uniform2f(this.loc['uSourceSize'], this.sourceSize[0], this.sourceSize[1]);

    // Draw fullscreen triangle
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private bindTex(unit: number, tex: WebGLTexture, uniformName: string) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc[uniformName], unit);
  }
}
