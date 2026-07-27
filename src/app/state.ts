import type {
  MpcdiProject,
  Region,
  SourceMedia,
  RenderSettings,
  DebugMode,
  CoordSpace,
} from '../model/types';
import { DEFAULT_RENDER_SETTINGS } from '../model/types';

export type StateListener = () => void;

/**
 * Central app state. Simple observable: call onChange() to subscribe,
 * call update() after mutations to notify.
 */
export class AppState {
  project: MpcdiProject | null = null;
  selectedBufferIdx = 0;
  selectedRegionIdx = 0;
  media: SourceMedia | null = null;
  settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS, warp: { ...DEFAULT_RENDER_SETTINGS.warp } };

  private listeners: StateListener[] = [];

  onChange(fn: StateListener) {
    this.listeners.push(fn);
  }

  update() {
    for (const fn of this.listeners) fn();
  }

  get currentRegion(): Region | null {
    if (!this.project) return null;
    const buf = this.project.buffers[this.selectedBufferIdx];
    return buf?.regions[this.selectedRegionIdx] ?? null;
  }

  /** Convenience setters that auto-notify */
  setProject(p: MpcdiProject) {
    this.project = p;
    this.selectedBufferIdx = 0;
    this.selectedRegionIdx = 0;
    this.update();
  }

  setMedia(m: SourceMedia) {
    this.media = m;
    this.update();
  }

  selectRegion(bufIdx: number, regIdx: number) {
    this.selectedBufferIdx = bufIdx;
    this.selectedRegionIdx = regIdx;
    this.update();
  }

  setDebugMode(mode: DebugMode) {
    this.settings.debugMode = mode;
    this.update();
  }

  setCoordSpace(cs: CoordSpace) {
    this.settings.warp.coordSpace = cs;
    this.update();
  }

  setFlipY(v: boolean) {
    this.settings.warp.flipY = v;
    this.update();
  }

  setInverseMapping(v: boolean) {
    this.settings.warp.inverseMapping = v;
    this.update();
  }

  setBlendEnabled(v: boolean) {
    this.settings.blendEnabled = v;
    this.update();
  }

  setBlackLevelEnabled(v: boolean) {
    this.settings.blackLevelEnabled = v;
    this.update();
  }

  setBoundsOverlay(v: boolean) {
    this.settings.boundsOverlay = v;
    this.update();
  }
}
