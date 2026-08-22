import { describe, expect, it } from "vitest";
import { PlaybackVolumeController, type VolumeAnimationScheduler } from "../playback-volume";

function createScheduler(): VolumeAnimationScheduler & { advanceTo: (time: number) => void } {
  let now = 0;
  let nextId = 0;
  const frames = new Map<number, () => void>();

  return {
    now: () => now,
    requestFrame: (callback) => {
      nextId += 1;
      frames.set(nextId, callback);
      return nextId;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    advanceTo: (time) => {
      now = time;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

describe("PlaybackVolumeController", () => {
  it("adjusts the user's base volume without compounding normalization gain", () => {
    const outputs: number[] = [];
    const controller = new PlaybackVolumeController((volume) => outputs.push(volume));

    controller.setBaseVolume(0.8);
    controller.setNormalizationGain(0.5);
    controller.adjustBaseVolume(0.05);

    expect(controller.getBaseVolume()).toBeCloseTo(0.85);
    expect(outputs.at(-1)).toBeCloseTo(0.425);
  });

  it("ramps an uncached gain change instead of applying an abrupt drop", () => {
    const outputs: number[] = [];
    const scheduler = createScheduler();
    const controller = new PlaybackVolumeController((volume) => outputs.push(volume), scheduler);

    controller.setBaseVolume(1);
    controller.setNormalizationGain(0.5, 200);
    expect(outputs.at(-1)).toBe(1);

    scheduler.advanceTo(100);
    expect(outputs.at(-1)).toBeCloseTo(0.75);

    scheduler.advanceTo(200);
    expect(outputs.at(-1)).toBeCloseTo(0.5);
  });

  it("restores the user's base volume when normalization is disabled", () => {
    const outputs: number[] = [];
    const controller = new PlaybackVolumeController((volume) => outputs.push(volume));

    controller.setBaseVolume(0.8);
    controller.setNormalizationGain(0.5);
    controller.setNormalizationGain(1);

    expect(outputs.at(-1)).toBeCloseTo(0.8);
  });
});
