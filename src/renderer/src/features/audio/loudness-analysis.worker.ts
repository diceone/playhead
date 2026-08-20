/// <reference lib="webworker" />

import { estimateIntegratedLoudnessDb } from "./audio-analysis";

type LoudnessAnalysisRequest = {
  channels: Float32Array[];
  sampleRate: number;
};

self.onmessage = (event: MessageEvent<LoudnessAnalysisRequest>) => {
  const { channels, sampleRate } = event.data;
  const buffer = {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    duration: channels[0]?.length ? channels[0].length / sampleRate : 0,
    sampleRate,
    getChannelData: (channel: number) => channels[channel],
  } as AudioBuffer;

  self.postMessage(estimateIntegratedLoudnessDb(buffer));
};

export {};
