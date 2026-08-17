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

type AudioGraph = {
  context: AudioContext;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
};

type VolumeNormalizationRuntime = {
  patched: boolean;
  activeWaveSurfer: WaveSurfer | null;
  baseVolume: number;
  gain: number;
  useWebAudioGain: boolean;
  rawSetVolume: ((waveSurfer: WaveSurfer, volume: number) => void) | null;
  graphs: WeakMap<HTMLMediaElement, AudioGraph>;
  activeTrack: LibraryTrack | null;
  requestId: number;
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
    useWebAudioGain: false,
    rawSetVolume: null,
    graphs: new WeakMap<HTMLMediaElement, AudioGraph>(),
    activeTrack: null,
    requestId: 0,
  });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getFallbackVolume(baseVolume: number, gain: number): number {
  return clamp(baseVolume * Math.min(gain, 1), 0, 1);
}

function configureLimiter(limiter: DynamicsCompressorNode): void {
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
}

function ensureAudioGraph(waveSurfer: WaveSurfer): AudioGraph | null {
  const media = waveSurfer.getMediaElement();
  const existing = runtime.graphs.get(media);
  if (existing) return existing;

  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    configureLimiter(limiter);
    source.connect(gain).connect(limiter).connect(context.destination);
    const graph = { context, gain, limiter };
    runtime.graphs.set(media, graph);
    return graph;
  } catch (error) {
    console.warn("Could not initialize Web Audio volume normalization", error);
    return null;
  }
}

function applyRuntimeGain(): void {
  const waveSurfer = runtime.activeWaveSurfer;
  if (!waveSurfer || !runtime.rawSetVolume) return;

  if (runtime.useWebAudioGain) {
    const graph = ensureAudioGraph(waveSurfer);
    if (graph) {
      runtime.rawSetVolume(waveSurfer, runtime.baseVolume);
      graph.gain.gain.setTargetAtTime(runtime.gain, graph.context.currentTime, 0.015);
      if (graph.context.state === "suspended") void graph.context.resume().catch(() => undefined);
      return;
    }
  }

  runtime.rawSetVolume(waveSurfer, getFallbackVolume(runtime.baseVolume, runtime.gain));
}

if (!runtime.patched) {
  const rawCreate = WaveSurfer.create.bind(WaveSurfer);
  const rawSetVolume = WaveSurfer.prototype.setVolume;
  const rawDestroy = WaveSurfer.prototype.destroy;

  runtime.rawSetVolume = (waveSurfer, volume) => rawSetVolume.call(waveSurfer, volume);

  WaveSurfer.create = ((options: Parameters<typeof WaveSurfer.create>[0]) => {
    const waveSurfer = rawCreate(options);
    runtime.activeWaveSurfer = waveSurfer;
    runtime.baseVolume = 1;
    runtime.gain = 1;
    runtime.useWebAudioGain = false;
    return waveSurfer;
  }) as typeof WaveSurfer.create;

  WaveSurfer.prototype.setVolume = function setVolumeWithNormalization(volume: number) {
    runtime.activeWaveSurfer = this;
    runtime.baseVolume = clamp(volume, 0, 1);
    applyRuntimeGain();
  };

  WaveSurfer.prototype.destroy = function destroyWithNormalizationCleanup() {
    if (runtime.activeWaveSurfer === this) {
      runtime.activeWaveSurfer = null;
      runtime.activeTrack = null;
      runtime.baseVolume = 1;
      runtime.gain = 1;
      runtime.useWebAudioGain = false;
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

function setPlaybackNormalizationGain(gain: number, allowBoost: boolean): void {
  runtime.gain = Number.isFinite(gain) ? clamp(gain, 0.25, 2) : 1;
  runtime.useWebAudioGain = allowBoost;
  applyRuntimeGain();
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

export async function applyTrackVolumeNormalization(track: LibraryTrack | null): Promise<void> {
  const requestId = runtime.requestId + 1;
  runtime.requestId = requestId;
  runtime.activeTrack = track;

  if (!track) {
    setPlaybackNormalizationGain(1, false);
    return;
  }

  let enabled = false;
  try {
    const library = await window.playhead.getLibraryState();
    enabled = library.settings.playback.normalizeVolume;
  } catch (error) {
    console.warn("Could not read volume normalization setting", error);
  }

  if (requestId !== runtime.requestId || runtime.activeTrack?.id !== track.id) return;
  if (!enabled) {
    setPlaybackNormalizationGain(1, false);
    return;
  }

  const allowBoost = track.source !== "soundcloud" && !track.soundcloud;
  const cachedGain = getCachedTrackNormalizationGain(track);
  if (cachedGain !== null) setPlaybackNormalizationGain(cachedGain, allowBoost);
  else setPlaybackNormalizationGain(1, allowBoost);

  const gain = await analyzeTrackNormalizationGain(track);
  if (requestId !== runtime.requestId || runtime.activeTrack?.id !== track.id) return;
  setPlaybackNormalizationGain(gain, allowBoost);
}
