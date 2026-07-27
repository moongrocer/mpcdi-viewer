import type { SourceMedia } from '../model/types';

/**
 * Load a video file.
 *
 * Uses HTMLVideoElement for v0.1 — reliable, supports most codecs the browser does.
 * A future version can layer WebCodecs on top for frame-accurate decode.
 */
export function loadVideo(file: File): Promise<SourceMedia> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.loop = true;

    video.onloadedmetadata = () => {
      resolve({
        type: 'video',
        name: file.name,
        width: video.videoWidth,
        height: video.videoHeight,
        element: video,
      });
    };
    video.onerror = () => {
      reject(new Error(
        `Cannot decode "${file.name}". ` +
        `Your browser may not support this codec. ` +
        `Try H.264/MP4 or VP9/WebM.`
      ));
    };
    video.src = url;
  });
}

/** Simple transport controls */
export class VideoTransport {
  private video: HTMLVideoElement;
  playing = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  play() {
    this.video.play();
    this.playing = true;
  }

  pause() {
    this.video.pause();
    this.playing = false;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(fraction: number) {
    if (isFinite(this.video.duration)) {
      this.video.currentTime = fraction * this.video.duration;
    }
  }

  get currentTime() { return this.video.currentTime; }
  get duration() { return this.video.duration; }
  get progress() {
    return isFinite(this.duration) ? this.currentTime / this.duration : 0;
  }

  formatTime(t: number): string {
    if (!isFinite(t)) return '--:--.---';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }
}
