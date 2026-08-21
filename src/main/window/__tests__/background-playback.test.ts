import { describe, expect, it, vi } from "vitest";
import { keepPlaybackWindowAlive, revealPlaybackWindow } from "../background-playback";

function createWindow(overrides: { destroyed?: boolean; minimized?: boolean } = {}) {
  return {
    focus: vi.fn(),
    hide: vi.fn(),
    isDestroyed: vi.fn(() => overrides.destroyed ?? false),
    isMinimized: vi.fn(() => overrides.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
  };
}

describe("background playback window lifecycle", () => {
  it("hides a normally closed window so its renderer keeps playing", () => {
    const event = { preventDefault: vi.fn() };
    const window = createWindow();

    keepPlaybackWindowAlive(event, window, false);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it("allows the window to close while the app is quitting", () => {
    const event = { preventDefault: vi.fn() };
    const window = createWindow();

    keepPlaybackWindowAlive(event, window, true);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("restores and focuses the existing playback window", () => {
    const window = createWindow({ minimized: true });

    revealPlaybackWindow(window);

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("does nothing after the playback window is destroyed", () => {
    const event = { preventDefault: vi.fn() };
    const window = createWindow({ destroyed: true, minimized: true });

    keepPlaybackWindowAlive(event, window, false);
    revealPlaybackWindow(window);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.restore).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });
});
