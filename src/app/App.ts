import { AppState } from './state';
import { Renderer } from '../render/renderer';
import { parseMpcdiPackage, loadStandalonePfm, parseDiag } from '../parser/mpcdi';
import { loadImage } from '../media/image';
import { loadVideo, VideoTransport } from '../media/video';
import { initUI, initVideoTransport, hideVideoTransport } from '../ui/controls';

export class App {
  state: AppState;
  renderer: Renderer;
  transport: VideoTransport | null = null;

  private frameCount = 0;
  private lastFpsTime = 0;

  constructor() {
    const canvas = document.getElementById('glcanvas') as HTMLCanvasElement;
    this.state = new AppState();
    this.renderer = new Renderer(canvas);

    initUI(this.state);
    this.bindFileInputs();
    this.state.onChange(() => this.onStateChange());

    // Status
    const status = document.getElementById('gl-status')!;
    const gl = this.renderer.gl;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    status.textContent = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : 'WebGL2';

    this.startRenderLoop();
  }

  private bindFileInputs() {
    const mpcdiInput = document.getElementById('input-mpcdi') as HTMLInputElement;
    const sourceInput = document.getElementById('input-source') as HTMLInputElement;
    const pfmInput = document.getElementById('input-pfm') as HTMLInputElement;

    // Wire visible buttons to hidden inputs
    document.getElementById('btn-pfm')!.addEventListener('click', () => pfmInput.click());

    // ── MPCDI package ────────────────────────────────────────────
    mpcdiInput.addEventListener('change', async () => {
      const file = mpcdiInput.files?.[0];
      if (!file) return;
      try {
        this.setStatus(`Loading ${file.name}…`);
        const project = await parseMpcdiPackage(file);
        this.state.setProject(project);
        document.getElementById('name-mpcdi')!.textContent = file.name;

        // Show diagnostics
        this.showDiagnostics();

        const nRegions = project.buffers.reduce((s, b) => s + b.regions.length, 0);
        const nWarps = project.buffers.reduce((s, b) =>
          s + b.regions.filter(r => r.warpMap).length, 0);
        this.setStatus(`Loaded: ${project.buffers.length} buf, ${nRegions} region(s), ${nWarps} warp(s)`);
      } catch (err: any) {
        this.setStatus(`Error: ${err.message}`);
        this.showDiagnostics();
        console.error(err);
      }
    });

    // ── Source media ─────────────────────────────────────────────
    sourceInput.addEventListener('change', async () => {
      const file = sourceInput.files?.[0];
      if (!file) return;
      try {
        this.setStatus(`Loading ${file.name}…`);
        let media;
        if (file.type.startsWith('video/')) {
          media = await loadVideo(file);
          this.transport = new VideoTransport(media.element as HTMLVideoElement);
          initVideoTransport(this.transport);
        } else {
          hideVideoTransport();
          this.transport = null;
          media = await loadImage(file);
        }
        this.state.setMedia(media);
        this.renderer.uploadSource(media);
        document.getElementById('name-source')!.textContent = file.name;
        document.getElementById('empty-msg')!.style.display = 'none';
        this.setStatus(`Source: ${media.width}×${media.height} ${media.type}`);
      } catch (err: any) {
        this.setStatus(`Error: ${err.message}`);
        console.error(err);
      }
    });

    // ── Manual PFM override ─────────────────────────────────────
    pfmInput.addEventListener('change', async () => {
      const file = pfmInput.files?.[0];
      if (!file) return;
      try {
        this.setStatus(`Loading PFM: ${file.name}…`);
        const warpMap = await loadStandalonePfm(file);
        document.getElementById('name-pfm')!.textContent =
          `${file.name} (${warpMap.width}×${warpMap.height})`;

        // Assign to current region (or create a minimal project if none loaded)
        if (!this.state.project) {
          // Create a bare-bones project to hold this warp
          this.state.setProject({
            profile: '2d',
            version: '1.0',
            buffers: [{
              id: 'manual',
              xResolution: warpMap.width,
              yResolution: warpMap.height,
              regions: [{
                id: 'manual',
                x: 0, y: 0, xSize: 1, ySize: 1,
                xResolution: warpMap.width,
                yResolution: warpMap.height,
                warpMap,
                blendMaps: {},
              }],
            }],
          });
        } else {
          // Overwrite warp on current region
          const region = this.state.currentRegion;
          if (region) {
            region.warpMap = warpMap;
            this.state.update();
          }
        }
        this.setStatus(`PFM loaded: ${warpMap.width}×${warpMap.height}`);
      } catch (err: any) {
        this.setStatus(`PFM error: ${err.message}`);
        console.error(err);
      }
    });
  }

  private showDiagnostics() {
    const logEl = document.getElementById('diag-log');
    if (logEl) {
      logEl.textContent = parseDiag.join('\n');
      // Auto-expand the panel
      const body = document.getElementById('panel-diag');
      body?.classList.remove('collapsed');
    }
  }

  private onStateChange() {
    // When region changes, reload textures
    const region = this.state.currentRegion;
    if (region) {
      this.renderer.loadRegion(region);
    }
  }

  private startRenderLoop() {
    const loop = (now: number) => {
      // FPS counter
      this.frameCount++;
      if (now - this.lastFpsTime >= 1000) {
        const fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsTime = now;
        document.getElementById('stat-fps')!.textContent = `${fps} fps`;
      }

      // Update video texture if playing
      if (this.state.media?.type === 'video' && this.state.media.element) {
        const video = this.state.media.element as HTMLVideoElement;
        if (!video.paused && !video.ended) {
          this.renderer.updateVideoFrame(video);
        }
      }

      // Render
      this.renderer.render(this.state.settings);

      // Canvas size status
      const gl = this.renderer.gl;
      document.getElementById('stat-size')!.textContent =
        `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`;

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private setStatus(msg: string) {
    document.getElementById('stat-info')!.textContent = msg;
  }
}
