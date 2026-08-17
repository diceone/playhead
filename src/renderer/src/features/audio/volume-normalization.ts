import WaveSurfer from "wavesurfer.js";
import type { LibraryTrack } from "../../../../shared/library";
import {
  decodeAudioBytes,
  decodeAudioTrack,
  estimateIntegratedLoudnessDb,
  getLoudnessNormalizationGain,
} from "./audio-analysis";

const normalizationCacheStorageKey = "playhead:volume-normalization-cache:v1";
const normalizationCacheLimit = 2_000;

type CachedNormalization = {
  gain: number;
  loudnessDb: number;
  analyzedAt: number;
};

type NormalizationCache = Record<string, CachedNormalization>;

type VolumeNormalizationRuntime = {
  patched: boolean;
  activeWaveSurfer: WaveSurfer | null;
  baseVolume: number;
  gain: number;
  setRawVolume: ((waveSurfer: WaveSurfer, volume: number) => void) | null;
};

const globalScope = globalThis as typeof globalThis & {
  __playheadVolumeNormalizationRuntime?: VolumeNormalizationRuntime;
};
const runtime =
  globalScope.__playheadVolumeNormalizationRuntime ||
  (globalScope.__playheadVolumeNormalizationRuntime = {
    patched: false,
    activeWaveSurfer: null,
    baseVolume: 1,
    gain: 1,
    setRawVolume: null,
  });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getEffectiveVolume(baseVolume: number, gain: number): number {
  return clamp(baseVolume * gain, 0, 1);
}

if (!runtime.patched) {
  const rawSetVolume = WaveSurfer.prototype.setVolume;
  const rawDestroy = WaveSurfer.prototype.destroy;

  runtime.setRawVolume = (waveSurfer, volume) => rawSetVolume.call(waveSurfer, volume);

  WaveSurfer.prototype.setVolume = function setVolumeWithNormalization(volume: number) {
    runtime.activeWaveSurfer = this;
    runtime.baseVolume = clamp(volume, 0, 1);
    runtime.setRawVolume?.(this, getEffectiveVolume(runtime.baseVolume, runtime.gain));
  };

  WaveSurfer.prototype.destroy = function destroyWithNormalizationCleanup() {
    if (runtime.activeWaveSurfer === this) {
      runtime.activeWaveSurfer = null;
      runtime.baseVolume = 1;
    }
    return rawDestroy.call(this);
  };

  runtime.patched = true;
}

let normalizationCache: NormalizationCache | null = null;
const analysisPromises = new Map<string, Promise<number>>();

function getNormalizationCache(): NormalizationCache {
  if (normalizationCache) return normalizationCache;
  normalizationCache = {};
  if (typeof localStorage === "undefined") return normalizationCache;

  try {
    const raw = localStorage.getItem(normalizationCacheStorageKey);
    if (!raw) return normalizationCache;
    const parsed = JSON.parse(raw) as NormalizationCache;
    if (parsed && typeof parsed === "object") normalizationCache = parsed;
  } catch {
    normalizationCache = {};
  }

  return normalizationCache;
}

function getTrackCacheKey(track: LibraryTrack): string {
  const sourceKey = track.soundcloud
    ? `soundcloud:${track.soundcloud.id}`
    : `${track.source || "local"}:${track.id}`;
  return [
    sourceKey,
    Math.round((track.duration || 0) * 1_000),
    track.fileName,
    track.sampleRate || 0,
    track.bitRate || 0,
  ].join("|");
}

function saveNormalizationCacheEntry(
  cacheKey: string,
  loudnessDb: number,
  gain: number,
): void {
  const cache = getNormalizationCache();
  cache[cacheKey] = { gain, loudnessDb, analyzedAt: Date.now() };

  const entries = Object.entries(cache);
  if (entries.length > normalizationCacheLimit) {
    entries
      .sort(([, a], [, b]) => b.analyzedAt - a.analyzedAt)
      .slice(normalizationCacheLimit)
      .forEach(([key]) => delete cache[key]);
  }

  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(normalizationCacheStorageKey, JSON.stringify(cache));
  } catch {
    // Cache persistence is optional. Normalization still works for this session.
  }
}

async function decodeTrackForNormalization(track: LibraryTrack): Promise<AudioBuffer | null> {
  if (track.source === "soundcloud" || track.soundcloud) {
    const soundcloud = track.soundcloud;
    if (!soundcloud || !track.duration || track.duration > 480) return null;

    const bytes = await window.playhead.getSoundCloudAnalysisAudioData(
      soundcloud.id,
      track.duration,
      soundcloud.transcodings,
      soundcloud.trackAuthorization,
    );
    return bytes ? decodeAudioBytes(bytes) : null;
  }

  return decodeAudioTrack(track, window.playhead.readAudioFile);
}

export function setPlaybackNormalizationGain(gain: number): void {
  runtime.gain = Number.isFinite(gain) ? clamp(gain, 0.25, 2) : 1;

  const waveSurfer = runtime.activeWaveSurfer;
  if (!waveSurfer || !runtime.setRawVolume) return;

  try {
    runtime.setRawVolume(waveSurfer, getEffectiveVolume(runtime.baseVolume, runtime.gain));
  } catch {
    // The WaveSurfer instance may already be tearing down.
  }
}

export function getCachedTrackNormalizationGain(track: LibraryTrack): number | null {
  const cached = getNormalizationCache()[getTrackCacheKey(track)];
  return cached && Number.isFinite(cached.gain) ? cached.gain : null;
}

export function analyzeTrackNormalizationGain(track: LibraryTrack): Promise<number> {
  const cacheKey = getTrackCacheKey(track);
  const cached = getNormalizationCache()[cacheKey];
  if (cached && Number.isFinite(cached.gain)) return Promise.resolve(cached.gain);

  const pending = analysisPromises.get(cacheKey);
  if (pending) return pending;

  const analysis = (async () => {
    try {
      const buffer = await decodeTrackForNormalization(track);
      if (!buffer) return 1;

      const loudnessDb = estimateIntegratedLoudnessDb(buffer);
      if (loudnessDb === null) return 1;

      const gain = getLoudnessNormalizationGain(loudnessDb);
      saveNormalizationCacheEntry(cacheKey, loudnessDb, gain);
      return gain;
    } catch (error) {
      console.warn("Failed to analyze track loudness", { path: track.path, error });
      return 1;
    } finally {
      analysisPromises.delete(cacheKey);
    }
  })();

  analysisPromises.set(cacheKey, analysis);
  return analysis;
}
