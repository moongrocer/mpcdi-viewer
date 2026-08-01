// ── MPCDI internal model ─────────────────────────────────────────────

/** MPCDI profile type — we only support 2d and 3d, not simulator profiles */
export type MpcdiProfile = '2d' | '3d' | 'sl' | 'a3d';

/** Frustum angles (degrees) for a region */
export interface Frustum {
  yaw: number;
  pitch: number;
  roll: number;
  rightAngle: number;
  leftAngle: number;
  upAngle: number;
  downAngle: number;
}

/** Measured statistics of a warp map — used to validate interpretation */
export interface WarpStats {
  minX: number; maxX: number;
  minY: number; maxY: number;
  /** Count of NaN / unmapped texels */
  nanCount: number;
  totalTexels: number;
  /** True if all finite values fall inside [0,1] → normalized coords */
  looksNormalized: boolean;
}

/** A single PFM-derived warp map */
export interface WarpMap {
  width: number;
  height: number;
  /** Float32 interleaved [x, y, intensity] per pixel, row-major */
  data: Float32Array;
  /** path inside the mpcdi archive */
  path: string;
  stats: WarpStats;
}

/** Blend / correction map (loaded from PNG, stored as normalized float) */
export interface BlendMap {
  width: number;
  height: number;
  /** Single-channel float [0..1] */
  data: Float32Array;
  path: string;
  /** gammaEmbedded declared in the manifest, if present (typically 2.2) */
  gammaEmbedded?: number;
}

/** Full set of optional correction maps */
export interface BlendMapSet {
  alphaMap?: BlendMap;     // edge-blend alpha
  betaMap?: BlendMap;      // edge-blend beta (gamma helper)
  blackLevelMap?: BlendMap; // per-pixel black-level offset
}

/** A single projection region within a buffer */
export interface Region {
  id: string;
  x: number;
  y: number;
  xSize: number;
  ySize: number;
  xResolution: number;
  yResolution: number;
  frustum?: Frustum;
  warpMap?: WarpMap;
  blendMaps: BlendMapSet;
}

/** A display buffer containing one or more regions */
export interface MpcdiBuffer {
  id: string;
  xResolution: number;
  yResolution: number;
  regions: Region[];
}

/** Top-level MPCDI project */
export interface MpcdiProject {
  profile: MpcdiProfile;
  version: string;
  date?: string;
  buffers: MpcdiBuffer[];
}

// ── Warp interpretation config ────────────────────────────────────────

export type CoordSpace = 'normalized' | 'absolute';

export interface WarpInterpretation {
  coordSpace: CoordSpace;
  /** Flip V of the content UV produced by the warp map */
  flipY: boolean;
  /** Flip V used to *read* the warp map (screen-side orientation) */
  flipScreenY: boolean;
  /** If true, the warp map is treated as inverse (screen→source) rather than forward (source→screen) */
  inverseMapping: boolean;
  /** Rescale full-display content UVs into region-local [0,1] */
  regionLocal: boolean;
}

export const DEFAULT_WARP_INTERPRETATION: WarpInterpretation = {
  coordSpace: 'normalized',
  flipY: false,
  flipScreenY: false,
  inverseMapping: false,
  regionLocal: false,
};

// ── Render settings ──────────────────────────────────────────────────

export type DebugMode = 'final' | 'source' | 'uv' | 'checker' | 'warpViz';

export interface RenderSettings {
  debugMode: DebugMode;
  blendEnabled: boolean;
  blackLevelEnabled: boolean;
  boundsOverlay: boolean;
  /** Undo the gammaEmbedded baked into the alpha PNG before blending */
  alphaLinearize: boolean;
  alphaGamma: number;
  warp: WarpInterpretation;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  debugMode: 'final',
  blendEnabled: true,
  blackLevelEnabled: true,
  boundsOverlay: false,
  alphaLinearize: false,
  alphaGamma: 2.2,
  warp: { ...DEFAULT_WARP_INTERPRETATION },
};

// ── Source media ──────────────────────────────────────────────────────

export type MediaType = 'image' | 'video' | 'none';

export interface SourceMedia {
  type: MediaType;
  name: string;
  width: number;
  height: number;
  /** The element we can draw/upload from */
  element: HTMLImageElement | HTMLVideoElement | null;
}
