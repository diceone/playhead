import { describe, expect, it } from "vitest";
import type { LibraryTrack } from "../../../../../shared/library";
import { buildTrackNormalizationCacheKey } from "../volume-normalization";

const track: LibraryTrack = {
  id: "track-1",
  path: "/music/track.mp3",
  fileName: "track.mp3",
  title: "Track",
  artist: "Artist",
  duration: 180,
  folderId: "folder-1",
};

describe("volume normalization cache", () => {
  it("invalidates a local result when the source file changes", () => {
    const original = buildTrackNormalizationCacheKey(track, { size: 1_000, mtimeMs: 100 });
    const replaced = buildTrackNormalizationCacheKey(track, { size: 1_200, mtimeMs: 200 });

    expect(replaced).not.toBe(original);
  });
});
