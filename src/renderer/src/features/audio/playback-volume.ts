export type VolumeAnimationScheduler = {
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
};

const browserScheduler: VolumeAnimationScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class PlaybackVolumeController {
  private baseVolume = 1;
  private normalizationGain = 1;
  private animationFrame: number | null = null;

  constructor(
    private readonly writeVolume: (volume: number) => void,
    private readonly scheduler = browserScheduler,
  ) {}

  getBaseVolume(): number {
    return this.baseVolume;
  }

  setBaseVolume(volume: number): number {
    this.baseVolume = Number.isFinite(volume) ? clamp(volume, 0, 1) : 1;
    this.applyVolume();
    return this.baseVolume;
  }

  adjustBaseVolume(offset: number): number {
    return this.setBaseVolume(this.baseVolume + offset);
  }

  setNormalizationGain(gain: number, rampDurationMs = 0): void {
    const nextGain = Number.isFinite(gain) ? clamp(gain, 0.25, 1) : 1;
    this.cancelRamp();

    if (rampDurationMs <= 0 || nextGain === this.normalizationGain) {
      this.normalizationGain = nextGain;
      this.applyVolume();
      return;
    }

    const initialGain = this.normalizationGain;
    const startedAt = this.scheduler.now();
    const update = () => {
      const progress = clamp((this.scheduler.now() - startedAt) / rampDurationMs, 0, 1);
      this.normalizationGain = initialGain + (nextGain - initialGain) * progress;
      this.applyVolume();
      if (progress < 1) this.animationFrame = this.scheduler.requestFrame(update);
      else this.animationFrame = null;
    };

    this.animationFrame = this.scheduler.requestFrame(update);
  }

  dispose(): void {
    this.cancelRamp();
  }

  private applyVolume(): void {
    this.writeVolume(clamp(this.baseVolume * this.normalizationGain, 0, 1));
  }

  private cancelRamp(): void {
    if (this.animationFrame === null) return;
    this.scheduler.cancelFrame(this.animationFrame);
    this.animationFrame = null;
  }
}
