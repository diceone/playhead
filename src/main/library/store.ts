import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultAppSettings,
  defaultLibrarySettings,
  emptyLibraryState,
  type AppSettings,
  type LibrarySettings,
  type LibraryState,
  type SelectedSource,
  type SessionSettings,
} from "../../shared/library";
import { electron } from "../electron";
import { materializeStoredArtwork } from "../artwork";

const { app } = electron;
let writeQueue: Promise<void> = Promise.resolve();

function libraryPath(): string {
  return join(app.getPath("userData"), "library.json");
}

function libraryBackupPath(): string {
  return `${libraryPath()}.bak`;
}

export async function readLibraryState(): Promise<LibraryState> {
  await writeQueue.catch(() => undefined);

  try {
    const raw = await readFile(libraryPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LibraryState>;
    const normalized = await normalizeLibraryState(parsed);
    if (raw.includes('"dataUrl"')) await writeLibraryState(normalized);
    return normalized;
  } catch {
    try {
      const raw = await readFile(libraryBackupPath(), "utf8");
      return normalizeLibraryState(JSON.parse(raw) as Partial<LibraryState>);
    } catch {
      return emptyLibraryState();
    }
  }
}

export async function writeLibraryState(state: LibraryState): Promise<LibraryState> {
  const nextState = stripEmbeddedArtwork(state);
  const write = writeQueue.then(() => writeLibraryStateFile(nextState));
  writeQueue = write.catch(() => undefined);
  await write;
  return nextState;
}

export async function writeLibrarySessionSettings(
  session: SessionSettings,
): Promise<LibraryState> {
  const current = await readLibraryState();
  return writeLibraryState({
    ...current,
    settings: { ...current.settings, session },
  });
}

export async function writeLibraryTrackAnalysis(
  trackId: string,
  bpm: number,
): Promise<LibraryState> {
  const current = await readLibraryState();
  const track = current.tracks[trackId];
  if (!track) return current;

  return writeLibraryState({
    ...current,
    tracks: {
      ...current.tracks,
      [trackId]: {
        ...track,
        bpm,
        bpmSource: "analysis",
      },
    },
  });
}

export async function writeLibrarySelectedSource(
  selectedSource: SelectedSource | null,
): Promise<LibraryState> {
  const current = await readLibraryState();
  return writeLibraryState({ ...current, selectedSource });
}

async function writeLibraryStateFile(state: LibraryState): Promise<void> {
  const filePath = libraryPath();
  const backupPath = libraryBackupPath();
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const content = `${JSON.stringify(state)}\n`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeBackupIfPrimaryIsValid(filePath, backupPath);

  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeBackupIfPrimaryIsValid(filePath: string, backupPath: string): Promise<void> {
  try {
    const raw = await readFile(filePath, "utf8");
    JSON.parse(raw);
    await writeFile(backupPath, raw, "utf8");
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export async function normalizeLibraryState(state: Partial<LibraryState>): Promise<LibraryState> {
  const settings = normalizeSettings(state.settings);
  return materializeStoredArtwork({
    ...emptyLibraryState(),
    ...state,
    tags: state.tags || [],
    favoriteTrackIds: state.favoriteTrackIds || [],
    settings,
  });
}

export function normalizeSettings(
  settings: Partial<AppSettings> | Partial<LibrarySettings> | undefined,
): AppSettings {
  const defaults = defaultAppSettings();
  if (!settings) return defaults;

  if ("library" in settings || "playback" in settings || "session" in settings) {
    const grouped = settings as Partial<AppSettings>;
    return {
      library: { ...defaults.library, ...(grouped.library || {}) },
      playback: { ...defaults.playback, ...(grouped.playback || {}) },
      appearance: { ...defaults.appearance, ...(grouped.appearance || {}) },
      telemetry: { ...defaults.telemetry, ...(grouped.telemetry || {}) },
      lastfm: { ...defaults.lastfm, ...(grouped.lastfm || {}) },
      soundcloud: { ...defaults.soundcloud, ...(grouped.soundcloud || {}) },
      session: {
        ...defaults.session,
        ...(grouped.session || {}),
        sidebarGroupOrder: grouped.session?.sidebarGroupOrder || defaults.session.sidebarGroupOrder,
        queue: {
          ...defaults.session.queue,
          ...(grouped.session?.queue || {}),
          items: grouped.session?.queue?.items || [],
          shuffledItems: grouped.session?.queue?.shuffledItems || [],
          activeItemId: grouped.session?.queue?.activeItemId || null,
          source: grouped.session?.queue?.source || null,
          panelOpen: grouped.session?.queue?.panelOpen || false,
        },
      },
    };
  }

  return {
    ...defaults,
    library: {
      ...defaultLibrarySettings(),
      ...(settings as Partial<LibrarySettings>),
    },
  };
}

function stripEmbeddedArtwork(state: LibraryState): LibraryState {
  let changed = false;
  const tracks: LibraryState["tracks"] = {};

  for (const [trackId, track] of Object.entries(state.tracks)) {
    if (!track.artwork?.dataUrl) {
      tracks[trackId] = track;
      continue;
    }

    changed = true;
    tracks[trackId] = {
      ...track,
      artwork: track.artwork.src
        ? { mimeType: track.artwork.mimeType, src: track.artwork.src }
        : undefined,
    };
  }

  return changed ? { ...state, tracks } : state;
}
