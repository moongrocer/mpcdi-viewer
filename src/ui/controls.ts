import type { AppState } from '../app/state';
import type { DebugMode, CoordSpace, Region } from '../model/types';
import { VideoTransport } from '../media/video';

/**
 * Bind all UI controls to the app state.
 * Pure DOM manipulation — no framework.
 */
export function initUI(state: AppState) {
  // ── Panel collapse ─────────────────────────────────────────────
  document.querySelectorAll<HTMLElement>('.panel-header').forEach((hdr) => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling as HTMLElement;
      body?.classList.toggle('collapsed');
    });
  });

  // ── File buttons → hidden file inputs ──────────────────────────
  wire('btn-mpcdi', 'input-mpcdi');
  wire('btn-source', 'input-source');

  // ── Debug mode buttons ─────────────────────────────────────────
  const modeGroup = document.getElementById('mode-group')!;
  modeGroup.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.mode-btn') as HTMLElement | null;
    if (!btn) return;
    modeGroup.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.setDebugMode(btn.dataset.mode as DebugMode);
  });

  // ── Warp interpretation controls ───────────────────────────────
  const selCoords = document.getElementById('warp-coords') as HTMLSelectElement;
  selCoords.addEventListener('change', () => state.setCoordSpace(selCoords.value as CoordSpace));

  const chkFlipY = document.getElementById('warp-flipy') as HTMLInputElement;
  chkFlipY.addEventListener('change', () => state.setFlipY(chkFlipY.checked));

  const chkInverse = document.getElementById('warp-inverse') as HTMLInputElement;
  chkInverse.addEventListener('change', () => state.setInverseMapping(chkInverse.checked));

  // ── Blend toggles ──────────────────────────────────────────────
  const chkBlend = document.getElementById('opt-blend') as HTMLInputElement;
  chkBlend.addEventListener('change', () => state.setBlendEnabled(chkBlend.checked));

  const chkBL = document.getElementById('opt-blacklevel') as HTMLInputElement;
  chkBL.addEventListener('change', () => state.setBlackLevelEnabled(chkBL.checked));

  const chkBounds = document.getElementById('opt-bounds') as HTMLInputElement;
  chkBounds.addEventListener('change', () => state.setBoundsOverlay(chkBounds.checked));

  // ── Region selector ────────────────────────────────────────────
  const selRegion = document.getElementById('sel-region') as HTMLSelectElement;
  selRegion.addEventListener('change', () => {
    const [bufIdx, regIdx] = selRegion.value.split(':').map(Number);
    state.selectRegion(bufIdx, regIdx);
  });

  // ── Update metadata panel on state change ──────────────────────
  state.onChange(() => updateMetadata(state));
  state.onChange(() => updateRegionSelect(state, selRegion));
}

/** Wire a visible button to a hidden file input */
function wire(btnId: string, inputId: string) {
  const btn = document.getElementById(btnId)!;
  const inp = document.getElementById(inputId) as HTMLInputElement;
  btn.addEventListener('click', () => inp.click());
}

function updateRegionSelect(state: AppState, sel: HTMLSelectElement) {
  const proj = state.project;
  if (!proj) return;

  // Only rebuild if option count changed
  const expectedCount = proj.buffers.reduce((s, b) => s + b.regions.length, 0);
  if (sel.options.length === expectedCount) return;

  sel.innerHTML = '';
  proj.buffers.forEach((buf, bi) => {
    buf.regions.forEach((reg, ri) => {
      const opt = document.createElement('option');
      opt.value = `${bi}:${ri}`;
      opt.textContent = `${buf.id} / ${reg.id}`;
      sel.appendChild(opt);
    });
  });
}

function updateMetadata(state: AppState) {
  const proj = state.project;
  const region = state.currentRegion;
  const media = state.media;

  setText('meta-profile', proj?.profile ?? '—');
  setText('meta-version', proj?.version ?? '—');

  if (proj && region) {
    const buf = proj.buffers[state.selectedBufferIdx];
    setText('meta-buffer', `${buf.id} (${buf.xResolution}×${buf.yResolution})`);
    setText('meta-region', region.id);
    setText('meta-resolution', `${region.xResolution}×${region.yResolution}`);

    if (region.frustum) {
      const f = region.frustum;
      setText('meta-frustum',
        `Y${f.yaw.toFixed(1)} P${f.pitch.toFixed(1)} R${f.roll.toFixed(1)} ` +
        `L${f.leftAngle.toFixed(1)} R${f.rightAngle.toFixed(1)} ` +
        `U${f.upAngle.toFixed(1)} D${f.downAngle.toFixed(1)}`
      );
    } else {
      setText('meta-frustum', '—');
    }

    setText('meta-warpsize', region.warpMap
      ? `${region.warpMap.width}×${region.warpMap.height}`
      : 'none');
    setText('meta-blendsize', region.blendMaps.alphaMap
      ? `${region.blendMaps.alphaMap.width}×${region.blendMaps.alphaMap.height}`
      : 'none');
  }

  setText('meta-source', media ? `${media.name} (${media.width}×${media.height})` : '—');
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── Video transport UI ──────────────────────────────────────────────

export function initVideoTransport(transport: VideoTransport) {
  const bar = document.getElementById('transport')!;
  bar.classList.add('visible');

  const btnPlay = document.getElementById('btn-play')!;
  const seekbar = document.getElementById('seekbar') as HTMLInputElement;
  const timecode = document.getElementById('timecode')!;

  btnPlay.addEventListener('click', () => {
    transport.toggle();
    btnPlay.textContent = transport.playing ? '⏸' : '▶';
  });

  seekbar.addEventListener('input', () => {
    transport.seek(Number(seekbar.value) / 1000);
  });

  // Update loop
  function tick() {
    seekbar.value = String(Math.round(transport.progress * 1000));
    timecode.textContent = transport.formatTime(transport.currentTime);
    requestAnimationFrame(tick);
  }
  tick();
}

export function hideVideoTransport() {
  document.getElementById('transport')?.classList.remove('visible');
}
