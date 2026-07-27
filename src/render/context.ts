/**
 * Initialize a WebGL2 context with required extensions.
 */
export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 not supported');

  // Enable float textures (needed for PFM warp maps)
  const extFloat = gl.getExtension('EXT_color_buffer_float');
  const extLinear = gl.getExtension('OES_texture_float_linear');
  if (!extFloat) console.warn('EXT_color_buffer_float not available — float render targets disabled');
  if (!extLinear) console.warn('OES_texture_float_linear not available — float texture filtering disabled');

  return gl;
}

/** Compile a shader and return it, or throw with error log */
export function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown error';
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

/** Link a vertex + fragment shader into a program */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertShader: WebGLShader,
  fragShader: WebGLShader
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown error';
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${log}`);
  }
  return program;
}
