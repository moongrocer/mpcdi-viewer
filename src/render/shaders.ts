// ── Vertex shader ────────────────────────────────────────────────────
// Fullscreen triangle (3 vertices, no attribute buffers needed).
//
// vRaw is in GL clip-space UV: (0,0) = BOTTOM-left, (1,1) = TOP-right.
// The fragment shader converts this to image-space (top-left origin)
// because every texture we upload (PFM warp, PNG alpha, source frame)
// is stored top-row-first.

export const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

out vec2 vRaw;

void main() {
  float x = float((gl_VertexID & 1) << 2);
  float y = float((gl_VertexID & 2) << 1);
  vRaw = vec2(x * 0.5, y * 0.5);
  gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
}
`;

// ── Fragment shader ──────────────────────────────────────────────────

export const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vRaw;
out vec4 fragColor;

uniform sampler2D uSource;

uniform sampler2D uWarpMap;
uniform bool uHasWarp;

uniform sampler2D uAlphaMap;
uniform bool uHasAlpha;
uniform sampler2D uBlackLevelMap;
uniform bool uHasBlackLevel;

uniform int  uDebugMode;        // 0=final 1=source 2=uv 3=checker 4=warpViz
uniform bool uBlendEnabled;
uniform bool uBlackLevelEnabled;
uniform bool uBoundsOverlay;

// Warp interpretation
uniform bool  uWarpFlipY;       // flip the V of the *resulting* content UV
uniform bool  uWarpFlipScreenY; // flip the V used to *read* the warp map
uniform bool  uWarpInverse;
uniform int   uWarpCoords;      // 0=normalized 1=absolute
uniform vec2  uWarpSize;
uniform vec2  uSourceSize;

// Region rect in normalized content space (x, y, xSize, ySize).
// MPCDI warp maps store content UVs spanning the whole display, so a
// single region only covers this sub-rect. Used for the "region-local"
// remap option and the bounds overlay.
uniform vec4 uRegionRect;
uniform bool uRegionLocal;      // remap content UV into region-local [0,1]

// Alpha gamma (gammaEmbedded from the MPCDI manifest, usually 2.2)
uniform float uAlphaGamma;
uniform bool  uAlphaLinearize;

// Aspect-correct fit
uniform float uRegionAspect;    // region w/h
uniform float uViewAspect;      // canvas w/h

// ── Helpers ──────────────────────────────────────────────────────────

// NaN-safe range test. NaN fails every comparison, so a value that is
// NOT provably inside [0,1] is treated as invalid. This catches both
// out-of-range coordinates and the NaN "unmapped pixel" markers that
// calibration tools write into PFM warp maps.
bool isValidUV(vec2 uv) {
  return (uv.x >= 0.0) && (uv.x <= 1.0) && (uv.y >= 0.0) && (uv.y <= 1.0);
}

float checkerboard(vec2 uv, float scale) {
  vec2 c = floor(uv * scale);
  return mod(c.x + c.y, 2.0);
}

void main() {
  // ── Letterbox so the region renders at its true aspect ratio ──
  vec2 fit = vRaw;
  if (uViewAspect > uRegionAspect) {
    // Viewport wider than region → pillarbox left/right
    fit.x = (fit.x - 0.5) * (uViewAspect / uRegionAspect) + 0.5;
  } else {
    // Viewport taller than region → letterbox top/bottom
    fit.y = (fit.y - 0.5) * (uRegionAspect / uViewAspect) + 0.5;
  }
  if (fit.x < 0.0 || fit.x > 1.0 || fit.y < 0.0 || fit.y > 1.0) {
    fragColor = vec4(0.06, 0.06, 0.07, 1.0); // neutral bar colour
    return;
  }

  // ── Convert to image space: origin top-left ───────────────────
  // GL clip UV has V=0 at the bottom; all our textures are uploaded
  // top-row-first, so V must be inverted to address them correctly.
  vec2 screenUV = vec2(fit.x, 1.0 - fit.y);

  // Optional override for validating a producer that used the other
  // convention when authoring the warp map.
  vec2 warpLookup = uWarpFlipScreenY ? vec2(screenUV.x, 1.0 - screenUV.y) : screenUV;

  // ── Debug: source only ────────────────────────────────────────
  if (uDebugMode == 1) {
    fragColor = texture(uSource, screenUV);
    return;
  }

  // ── Debug: raw warp texture ───────────────────────────────────
  if (uDebugMode == 4) {
    if (!uHasWarp) { fragColor = vec4(0.5, 0.0, 0.5, 1.0); return; }
    vec3 raw = texture(uWarpMap, warpLookup).rgb;
    // Invalid/NaN texels render as magenta so dead zones are obvious.
    if (!isValidUV(raw.xy)) { fragColor = vec4(0.6, 0.0, 0.4, 1.0); return; }
    fragColor = vec4(raw.xy, 0.0, 1.0);
    return;
  }

  // ── Derive content UV from the warp map ───────────────────────
  vec2 contentUV = screenUV;
  bool mapped = true;

  if (uHasWarp) {
    vec3 warpSample = texture(uWarpMap, warpLookup).rgb;
    vec2 uv = warpSample.xy;

    // Absolute pixel coordinates → normalize
    if (uWarpCoords == 1) uv /= uSourceSize;

    if (uWarpFlipY) uv.y = 1.0 - uv.y;

    // NOTE: MPCDI 2d warp maps are inverse maps (projector pixel →
    // content coordinate), which is exactly what a gather-style
    // fragment shader wants. A forward map would need a scatter pass
    // to invert; this toggle is a placeholder for that comparison and
    // currently only flags the mode.
    mapped = isValidUV(uv);

    // Optionally rescale from full-display space into region-local
    // [0,1] so a single projector's slice fills the frame.
    if (uRegionLocal && mapped) {
      uv = (uv - uRegionRect.xy) / uRegionRect.zw;
    }

    contentUV = uv;
  }

  // ── Debug: UV gradient ────────────────────────────────────────
  if (uDebugMode == 2) {
    if (!mapped) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    fragColor = vec4(contentUV.x, contentUV.y, 0.0, 1.0);
    return;
  }

  // ── Debug: checkerboard ───────────────────────────────────────
  if (uDebugMode == 3) {
    if (!mapped) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float c = checkerboard(contentUV, 24.0);
    fragColor = vec4(mix(vec3(0.12), vec3(0.88), c), 1.0);
    return;
  }

  // ── Final composite ───────────────────────────────────────────
  // Unmapped texels are genuine dead projector area — output black
  // rather than sampling garbage.
  vec4 color = mapped
    ? texture(uSource, clamp(contentUV, 0.0, 1.0))
    : vec4(0.0, 0.0, 0.0, 1.0);

  if (uBlendEnabled && uHasAlpha) {
    float a = texture(uAlphaMap, screenUV).r;
    // The manifest declares a baked-in gamma on the alpha PNG; undo it
    // to get a linear blend weight before multiplying.
    if (uAlphaLinearize) a = pow(a, uAlphaGamma);
    color.rgb *= a;
  }

  if (uBlackLevelEnabled && uHasBlackLevel) {
    float bl = texture(uBlackLevelMap, screenUV).r;
    color.rgb = max(color.rgb - bl, 0.0);
  }

  if (uBoundsOverlay) {
    float e = 0.004;
    if (screenUV.x < e || screenUV.x > 1.0 - e ||
        screenUV.y < e || screenUV.y > 1.0 - e) {
      color.rgb = mix(color.rgb, vec3(0.0, 1.0, 0.5), 0.8);
    }
    // Mark the dead-zone boundary in amber
    if (!mapped) color.rgb = vec3(0.25, 0.15, 0.0);
  }

  fragColor = vec4(color.rgb, 1.0);
}
`;
