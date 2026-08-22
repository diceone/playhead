type BackgroundPlaybackWindow = Pick<
  Electron.BrowserWindow,
  "focus" | "hide" | "isDestroyed" | "isMinimized" | "restore" | "show"
>;

type CloseEvent = Pick<Electron.Event, "preventDefault">;

export function keepPlaybackWindowAlive(
  event: CloseEvent,
  window: BackgroundPlaybackWindow,
  isQuitting: boolean,
): void {
  if (isQuitting || window.isDestroyed()) return;

  event.preventDefault();
  window.hide();
}

export function revealPlaybackWindow(window: BackgroundPlaybackWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();

  window.show();
  window.focus();
}
