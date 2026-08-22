export function analyzeLoudnessOffThread(
  buffer: AudioBuffer,
  signal?: AbortSignal,
): Promise<number | null> {
  if (signal?.aborted) return Promise.reject(new DOMException("Analysis aborted", "AbortError"));

  const worker = new Worker(new URL("./loudness-analysis.worker.ts", import.meta.url), {
    type: "module",
  });
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel).slice(),
  );
  const transfer = channels.map((channel) => channel.buffer);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Analysis aborted", "AbortError"));
    };

    worker.onmessage = (event: MessageEvent<number | null>) => {
      cleanup();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(event.error || new Error(event.message || "Loudness analysis failed"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, transfer);
  });
}
