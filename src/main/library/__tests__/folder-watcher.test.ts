import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryFolder } from "../../../shared/library";

const watcherMocks = vi.hoisted(() => {
  const close = vi.fn(async () => undefined);
  const on = vi.fn().mockReturnThis();
  return { close, on, watch: vi.fn(() => ({ close, on })) };
});

vi.mock("chokidar", () => ({ default: { watch: watcherMocks.watch } }));
vi.mock("../../electron", () => ({
  electron: { BrowserWindow: { getAllWindows: () => [] } },
}));

import { closeFolderWatcher, watchLibraryFolders } from "../folder-watcher";

const folder: LibraryFolder = {
  id: "folder-1",
  name: "Music",
  path: "/music",
  trackIds: [],
};

beforeEach(() => {
  watcherMocks.close.mockClear();
  watcherMocks.on.mockClear();
  watcherMocks.watch.mockClear();
});

afterEach(async () => {
  await closeFolderWatcher();
});

describe("folder watcher", () => {
  it("keeps the existing watcher when folder configuration is unchanged", async () => {
    await watchLibraryFolders([folder], [".mp3", ".flac"]);
    await watchLibraryFolders([{ ...folder, trackIds: ["track-1"] }], [".flac", ".mp3"]);

    expect(watcherMocks.watch).toHaveBeenCalledOnce();
    expect(watcherMocks.close).not.toHaveBeenCalled();
  });

  it("rebuilds the watcher when a filesystem-relevant setting changes", async () => {
    await watchLibraryFolders([folder], [".mp3"]);
    await watchLibraryFolders([folder], [".flac"]);

    expect(watcherMocks.watch).toHaveBeenCalledTimes(2);
    expect(watcherMocks.close).toHaveBeenCalledOnce();
  });
});
