import type { Region, RenderSettings, SourceMedia, DebugMode } from '../model/types';
import { createContext, compileShader, linkProgram } from './context';
import { VERT_SRC, FRAG_SRC } from './shaders';
import {
  uploadWarpTexture,
  uploadBlendTexture,
  uploadSourceTexture,
  createPlaceholderTexture,
} from './textures';

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
  }

  /** Update source texture from video without recreating */
  updateVideoFrame(video: HTMLVideoElement) {
    if (!this.texSource) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texSource);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /** Resize the canvas to match its display size */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
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
