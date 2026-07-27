// ── Vertex shader ────────────────────────────────────────────────────
// Renders a fullscreen triangle (3 vertices, no buffer needed).

export const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

out vec2 vUV;

void main() {
  // Fullscreen triangle trick: vertex IDs 0,1,2 cover the screen
  float x = float((gl_VertexID & 1) << 2);
  float y = float((gl_VertexID & 2) << 1);
  vUV = vec2(x * 0.5, y * 0.5);
  gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
}
`;

// ── Fragment shader ──────────────────────────────────────────────────

export const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

// Source content
uniform sampler2D uSource;

// Warp map: RGB32F texture. R=x, G=y, B=intensity
uniform sampler2D uWarpMap;
uniform bool uHasWarp;

// Blend maps
uniform sampler2D uAlphaMap;
uniform bool uHasAlpha;
uniform sampler2D uBlackLevelMap;
uniform bool uHasBlackLevel;

// Settings
uniform int  uDebugMode;       // 0=final, 1=source, 2=uv, 3=checker, 4=warpViz
uniform bool uBlendEnabled;
uniform bool uBlackLevelEnabled;
uniform bool uBoundsOverlay;

// Warp interpretation
uniform bool uWarpFlipY;
uniform bool uWarpInverse;
uniform int  uWarpCoords;      // 0=normalized, 1=absolute
uniform vec2 uWarpSize;        // pixel dimensions of warp map (for absolute coords)
uniform vec2 uSourceSize;      // pixel dimensions of source

// ── Checkerboard pattern ─────────────────────────────────────────────
float checkerboard(vec2 uv, float scale) {
  vec2 c = floor(uv * scale);
  return mod(c.x + c.y, 2.0);
}

void main() {
  vec2 screenUV = vUV;

  // ── Debug: source only (no warp) ───────────────────────────────
  if (uDebugMode == 1) {
    fragColor = texture(uSource, screenUV);
    return;
  }

  // ── Debug: warp texture visualization ──────────────────────────
  if (uDebugMode == 4) {
    if (!uHasWarp) {
      fragColor = vec4(0.5, 0.0, 0.5, 1.0); // magenta = no warp
      return;
    }
    vec3 raw = texture(uWarpMap, screenUV).rgb;
    fragColor = vec4(raw, 1.0);
    return;
  }

  // ── Compute source UV from warp map ────────────────────────────
  vec2 sourceUV = screenUV; // passthrough if no warp

  if (uHasWarp) {
    // Sample warp map at screen position
    vec3 warpSample = texture(uWarpMap, screenUV).rgb;
    vec2 rawUV = warpSample.xy;
    float intensity = warpSample.z;

    // Coordinate normalization
    if (uWarpCoords == 1) {
      // Absolute pixel coordinates → normalize to [0,1]
      rawUV = rawUV / uSourceSize;
    }

    // Y-flip
    if (uWarpFlipY) {
      rawUV.y = 1.0 - rawUV.y;
    }

    // The warp map is typically an inverse map (screen→source).
    // If uWarpInverse is true, we interpret it as forward (source→screen)
    // and would need to invert it. For real-time, we skip full inversion
    // and simply pass through (since MPCDI 2d profile uses inverse maps).
    sourceUV = rawUV;
  }

  // ── Debug: UV gradient ─────────────────────────────────────────
  if (uDebugMode == 2) {
    fragColor = vec4(sourceUV.x, sourceUV.y, 0.0, 1.0);
    return;
  }

  // ── Debug: checkerboard (reveals distortion) ───────────────────
  if (uDebugMode == 3) {
    float check = checkerboard(sourceUV, 20.0);
    vec3 col = mix(vec3(0.15), vec3(0.85), check);
    // Tint out-of-bounds red
    if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) {
      col = vec3(0.8, 0.1, 0.1);
    }
    fragColor = vec4(col, 1.0);
    return;
  }

  // ── Final composited output ────────────────────────────────────
  // Clamp source UV and sample
  vec4 color = texture(uSource, clamp(sourceUV, 0.0, 1.0));

  // Mark out-of-bounds pixels
  if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) {
    color.rgb *= 0.1; // darken out-of-range
  }

  // Blend alpha
  if (uBlendEnabled && uHasAlpha) {
    float alpha = texture(uAlphaMap, screenUV).r;
    color.rgb *= alpha;
  }

  // Black-level compensation
  if (uBlackLevelEnabled && uHasBlackLevel) {
    float bl = texture(uBlackLevelMap, screenUV).r;
    color.rgb = max(color.rgb - bl, 0.0);
  }

  // Region bounds overlay
  if (uBoundsOverlay) {
    float edge = 0.005;
    if (screenUV.x < edge || screenUV.x > 1.0 - edge ||
        screenUV.y < edge || screenUV.y > 1.0 - edge) {
      color.rgb = mix(color.rgb, vec3(0.0, 1.0, 0.5), 0.7);
    }
  }

  fragColor = color;
}
`;
