import type { Region, RenderSettings, SourceMedia, DebugMode } from '../model/types';
import { createContext, compileShader, linkProgram } from './context';
import { VERT_SRC, FRAG_SRC } from './shaders';
import {
  uploadWarpTexture, uploadBlendTexture,
  uploadSourceTexture, createPlaceholderTexture,
} from './textures';

const DEBUG_MODE_MAP: Record<DebugMode, number> = {
  final: 0, source: 1, uv: 2, checker: 3, warpViz: 4,
};

const UNIFORMS = [
  'uSource', 'uWarpMap', 'uHasWarp',
  'uAlphaMap', 'uHasAlpha', 'uBlackLevelMap', 'uHasBlackLevel',
  'uDebugMode', 'uBlendEnabled', 'uBlackLevelEnabled', 'uBoundsOverlay',
  'uWarpFlipY', 'uWarpFlipScreenY', 'uWarpInverse', 'uWarpCoords',
  'uWarpSize', 'uSourceSize', 'uRegionRect', 'uRegionLocal',
  'uAlphaGamma', 'uAlphaLinearize', 'uRegionAspect', 'uViewAspect',
] as const;

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  private texSource: WebGLTexture | null = null;
  private texWarp: WebGLTexture | null = null;
  private texAlpha: WebGLTexture | null = null;
  private texBlackLevel: WebGLTexture | null = null;
  private texPlaceholder: WebGLTexture;

  private hasWarp = false;
  private hasAlpha = false;
  private hasBlackLevel = false;
  private sourceSize: [number, number] = [1, 1];
  private warpSize: [number, number] = [1, 1];
  private regionRect: [number, number, number, number] = [0, 0, 1, 1];
  private regionAspect = 16 / 9;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    const gl = this.gl;

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    this.program = linkProgram(gl, vert, frag);

    for (const name of UNIFORMS) {
      this.loc[name] = gl.getUniformLocation(this.program, name);
    }

    this.vao = gl.createVertexArray()!;
    this.texPlaceholder = createPlaceholderTexture(gl, 0, 0, 0);
  }

  loadRegion(region: Region) {
    const gl = this.gl;

    if (region.warpMap) {
      this.texWarp = uploadWarpTexture(gl, region.warpMap, this.texWarp);
      this.hasWarp = true;
      this.warpSize = [region.warpMap.width, region.warpMap.height];
    } else {
      this.hasWarp = false;
    }

    if (region.blendMaps.alphaMap) {
      this.texAlpha = uploadBlendTexture(gl, region.blendMaps.alphaMap, this.texAlpha);
      this.hasAlpha = true;
    } else {
      this.hasAlpha = false;
    }

    if (region.blendMaps.blackLevelMap) {
      this.texBlackLevel = uploadBlendTexture(gl, region.blendMaps.blackLevelMap, this.texBlackLevel);
      this.hasBlackLevel = true;
    } else {
      this.hasBlackLevel = false;
    }

    this.regionRect = [region.x, region.y, region.xSize, region.ySize];
    this.regionAspect = region.xResolution / region.yResolution;
  }

  uploadSource(media: SourceMedia) {
    if (!media.element) return;
    this.texSource = uploadSourceTexture(this.gl, media.element, this.texSource);
    this.sourceSize = [media.width, media.height];
  }

  updateVideoFrame(video: HTMLVideoElement) {
    if (!this.texSource) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texSource);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(s: RenderSettings) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.04, 0.04, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    this.bindTex(0, this.texSource ?? this.texPlaceholder, 'uSource');
    this.bindTex(1, this.texWarp ?? this.texPlaceholder, 'uWarpMap');
    this.bindTex(2, this.texAlpha ?? this.texPlaceholder, 'uAlphaMap');
    this.bindTex(3, this.texBlackLevel ?? this.texPlaceholder, 'uBlackLevelMap');

    gl.uniform1i(this.loc['uHasWarp'], +this.hasWarp);
    gl.uniform1i(this.loc['uHasAlpha'], +this.hasAlpha);
    gl.uniform1i(this.loc['uHasBlackLevel'], +this.hasBlackLevel);

    gl.uniform1i(this.loc['uDebugMode'], DEBUG_MODE_MAP[s.debugMode] ?? 0);
    gl.uniform1i(this.loc['uBlendEnabled'], +s.blendEnabled);
    gl.uniform1i(this.loc['uBlackLevelEnabled'], +s.blackLevelEnabled);
    gl.uniform1i(this.loc['uBoundsOverlay'], +s.boundsOverlay);

    gl.uniform1i(this.loc['uWarpFlipY'], +s.warp.flipY);
    gl.uniform1i(this.loc['uWarpFlipScreenY'], +s.warp.flipScreenY);
    gl.uniform1i(this.loc['uWarpInverse'], +s.warp.inverseMapping);
    gl.uniform1i(this.loc['uWarpCoords'], s.warp.coordSpace === 'absolute' ? 1 : 0);
    gl.uniform1i(this.loc['uRegionLocal'], +s.warp.regionLocal);

    gl.uniform2f(this.loc['uWarpSize'], this.warpSize[0], this.warpSize[1]);
    gl.uniform2f(this.loc['uSourceSize'], this.sourceSize[0], this.sourceSize[1]);
    gl.uniform4f(this.loc['uRegionRect'], ...this.regionRect);

    gl.uniform1f(this.loc['uAlphaGamma'], s.alphaGamma);
    gl.uniform1i(this.loc['uAlphaLinearize'], +s.alphaLinearize);

    gl.uniform1f(this.loc['uRegionAspect'], this.regionAspect);
    gl.uniform1f(this.loc['uViewAspect'], gl.drawingBufferWidth / gl.drawingBufferHeight);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private bindTex(unit: number, tex: WebGLTexture, name: string) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc[name], unit);
  }
}
