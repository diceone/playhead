import { describe, expect, it } from "vitest";
import {
  buildWaveformCachePeaks,
  estimateIntegratedLoudnessDb,
  getLoudnessNormalizationGain,
  getWaveformAnalysisPeakCount,
  shouldAnalyzeTrackBpm,
} from "../audio-analysis";
import type { LibraryTrack } from "../../../../../shared/library";

function createTrack(overrides: Partial<LibraryTrack> = {}): LibraryTrack {
  return {
    id: "track-1",
    path: "/music/a.mp3",
    fileName: "a.mp3",
    title: "A",
    artist: "Artist",
    duration: 1,
    folderId: "folder-1",
    ...overrides,
  };
}

function createBuffer(samples: number[], sampleRate = 1): AudioBuffer {
  return {
    numberOfChannels: 1,
    length: samples.length,
    duration: samples.length / sampleRate,
    sampleRate,
    getChannelData: () => Float32Array.from(samples),
  } as unknown as AudioBuffer;
}

describe("shouldAnalyzeTrackBpm", () => {
  it("includes tracks without bpm", () => {
    expect(shouldAnalyzeTrackBpm(createTrack())).toBe(true);
  });

  it("skips metadata and legacy bpm", () => {
    expect(shouldAnalyzeTrackBpm(createTrack({ bpm: 128, bpmSource: "metadata" }))).toBe(false);
    expect(shouldAnalyzeTrackBpm(createTrack({ bpm: 128 }))).toBe(false);
  });

  it("allows analyzed bpm to be revalidated from cache", () => {
    expect(shouldAnalyzeTrackBpm(createTrack({ bpm: 128, bpmSource: "analysis" }))).toBe(true);
  });
});

describe("volume normalization", () => {
  it("estimates steady-state loudness from decoded audio", () => {
    const samples = Array.from({ length: 16000 }, () => 0.1);
    const loudnessDb = estimateIntegratedLoudnessDb(createBuffer(samples, 16000));
    expect(loudnessDb).not.toBeNull();
    expect(loudnessDb!).toBeCloseTo(-20.691, 2);
  });

  it("attenuates toward -18 dB without boosting quiet tracks", () => {
    expect(getLoudnessNormalizationGain(-20)).toBe(1);
    expect(getLoudnessNormalizationGain(-8)).toBeCloseTo(10 ** (-10 / 20), 5);
    expect(getLoudnessNormalizationGain(-40)).toBe(1);
    expect(getLoudnessNormalizationGain(4)).toBeCloseTo(10 ** (-12 / 20), 5);
  });

  it("ignores silence", () => {
    expect(estimateIntegratedLoudnessDb(createBuffer([0, 0, 0], 3))).toBeNull();
  });
});

describe("buildWaveformCachePeaks", () => {
  it("produces one channel of normalized signed peaks", () => {
    const peaks = buildWaveformCachePeaks(createBuffer([-0.5, 0.25, -1, 0.75]), 2);
    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toHaveLength(40);
    expect(Math.max(...peaks[0].map((peak) => Math.abs(peak)))).toBe(1);
  });

  it("keeps silent peaks at zero", () => {
    const peaks = buildWaveformCachePeaks(createBuffer([0, 0, 0]), 2);
    expect(peaks[0]).toHaveLength(40);
    expect(peaks[0].every((peak) => peak === 0)).toBe(true);
  });

  it("caps long peak counts", () => {
    expect(getWaveformAnalysisPeakCount(10_000)).toBe(24_000);
  });
});
