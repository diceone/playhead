import { analyze } from "web-audio-beat-detector";
import type { LibraryTrack } from "../../../../shared/library";

export const waveformAnalysisPeakRate = 20;
export const waveformAnalysisMaxPeaks = 24_000;
export const volumeNormalizationTargetLoudnessDb = -14;

const loudnessAbsoluteGateDb = -70;
const loudnessOffsetDb = -0.691;
const loudnessRelativeGateDb = 10;
const volumeNormalizationMinGainDb = -12;
const volumeNormalizationMaxGainDb = 6;

export function shouldAnalyzeTrackBpm(track: LibraryTrack): boolean {
  if (!track.bpm) return true;
  return track.bpmSource === "analysis";
}

export async function decodeAudioTrack(
  track: LibraryTrack,
  readAudioFile: (path: string) => Promise<ArrayBuffer>,
): Promise<AudioBuffer> {
  const bytes = await readAudioFile(track.path);
  return decodeAudioBytes(bytes);
}

export async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const audioContext = new AudioContext({ sampleRate: 16000 });

  try {
    return await audioContext.decodeAudioData(bytes.slice(0));
  } finally {
    await audioContext.close();
  }
}

export async function analyzeBpmFromBuffer(buffer: AudioBuffer): Promise<{
  bpm: number;
  tempo: number;
}> {
  const tempo = await analyze(buffer);
  const bpm = Math.round(tempo);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("BPM could not be detected.");
  return { bpm, tempo };
}

function energyToLoudnessDb(energy: number): number {
  return loudnessOffsetDb + 10 * Math.log10(energy);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function estimateIntegratedLoudnessDb(buffer: AudioBuffer): number | null {
  if (!buffer.numberOfChannels || !buffer.length || !buffer.sampleRate) return null;

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const blockLength = Math.max(1, Math.round(buffer.sampleRate * 0.4));
  const stepLength = Math.max(1, Math.round(buffer.sampleRate * 0.1));
  const blockEnergies: number[] = [];

  const measureBlock = (start: number, end: number) => {
    let energy = 0;
    let frames = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let frameEnergy = 0;
      for (const channel of channels) {
        const sample = channel[sampleIndex] ?? 0;
        frameEnergy += sample * sample;
      }
      energy += frameEnergy / channels.length;
      frames += 1;
    }

    if (frames === 0) return;
    const meanSquare = energy / frames;
    if (meanSquare <= 0 || !Number.isFinite(meanSquare)) return;
    if (energyToLoudnessDb(meanSquare) >= loudnessAbsoluteGateDb) blockEnergies.push(meanSquare);
  };

  if (buffer.length <= blockLength) {
    measureBlock(0, buffer.length);
  } else {
    for (let start = 0; start + blockLength <= buffer.length; start += stepLength) {
      measureBlock(start, start + blockLength);
    }
  }

  if (blockEnergies.length === 0) return null;

  const ungatedLoudnessDb = energyToLoudnessDb(average(blockEnergies));
  const relativeGateDb = Math.max(
    loudnessAbsoluteGateDb,
    ungatedLoudnessDb - loudnessRelativeGateDb,
  );
  const gatedEnergies = blockEnergies.filter(
    (energy) => energyToLoudnessDb(energy) >= relativeGateDb,
  );
  if (gatedEnergies.length === 0) return null;

  const loudnessDb = energyToLoudnessDb(average(gatedEnergies));
  return Number.isFinite(loudnessDb) ? loudnessDb : null;
}

export function getLoudnessNormalizationGain(
  loudnessDb: number,
  targetLoudnessDb = volumeNormalizationTargetLoudnessDb,
): number {
  if (!Number.isFinite(loudnessDb) || !Number.isFinite(targetLoudnessDb)) return 1;

  const gainDb = Math.min(
    volumeNormalizationMaxGainDb,
    Math.max(volumeNormalizationMinGainDb, targetLoudnessDb - loudnessDb),
  );
  return 10 ** (gainDb / 20);
}

export function getWaveformAnalysisPeakCount(duration: number): number {
  const sanitizedDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.max(
    1,
    Math.min(waveformAnalysisMaxPeaks, Math.ceil(sanitizedDuration * waveformAnalysisPeakRate)),
  );
}

export function buildWaveformCachePeaks(
  buffer: AudioBuffer,
  duration = buffer.duration,
): number[][] {
  const peakCount = getWaveformAnalysisPeakCount(duration);
  const sampleLength =
    Number.isFinite(duration) && duration > 0
      ? Math.min(buffer.length, Math.max(1, Math.round(duration * buffer.sampleRate)))
      : buffer.length;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const peaks: number[] = [];
  let largest = 0;

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const start = Math.floor((peakIndex * sampleLength) / peakCount);
    const end = Math.max(start + 1, Math.floor(((peakIndex + 1) * sampleLength) / peakCount));
    let strongestSample = 0;

    for (let sampleIndex = start; sampleIndex < Math.min(end, sampleLength); sampleIndex += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[sampleIndex] ?? 0;
      sample /= channels.length || 1;

      if (Math.abs(sample) > Math.abs(strongestSample)) strongestSample = sample;
    }

    largest = Math.max(largest, Math.abs(strongestSample));
    peaks.push(strongestSample);
  }

  if (largest === 0) return [peaks];
  return [peaks.map((peak) => peak / largest)];
}
