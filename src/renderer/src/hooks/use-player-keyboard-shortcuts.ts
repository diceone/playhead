import { useEffect } from "react";
import type { PlaybackSettings } from "../../../shared/library";
import { isEditableTarget } from "@/lib/dom";
import { isMacPlatform } from "@/lib/platform";

export function usePlayerKeyboardShortcuts({
  playbackSettings,
  onToggleQueue,
  onOpenSearch,
  onOpenSettings,
  onTogglePlayback,
  onSeekBy,
  onChangeVolumeBy,
  onSelectAdjacentTrack,
  onPlaySelectedTrack,
  onToggleSelectedTrackFavorite,
  onPitchChange,
  onToggleLoop,
  onSetCuePoint,
  onJumpToCuePoint,
}: {
  playbackSettings: PlaybackSettings;
  onToggleQueue: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onTogglePlayback: () => void;
  onSeekBy: (offset: number) => void;
  onChangeVolumeBy: (offset: number) => void;
  onSelectAdjacentTrack: (direction: 1 | -1, step?: number) => void;
  onPlaySelectedTrack: () => void;
  onToggleSelectedTrackFavorite: () => void;
  onPitchChange: (delta: number) => void;
  onToggleLoop: () => void;
  onSetCuePoint: (index: number) => void;
  onJumpToCuePoint: (index: number) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "f")
      ) {
        event.preventDefault();
        onOpenSearch();
        return;
      }

      const primaryModifier = isMacPlatform() ? event.metaKey : event.ctrlKey;
      if (primaryModifier && event.key.toLowerCase() === "l") {
        event.preventDefault();
        onToggleQueue();
        return;
      }

      if (primaryModifier && event.key === ",") {
        event.preventDefault();
        onOpenSettings();
        return;
      }

      if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onTogglePlayback();
        return;
      }

      if (event.code === "ArrowLeft" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const step = playbackSettings.seekStepSeconds;
        onSeekBy(event.shiftKey ? -(step * 2) : -step);
        return;
      }

      if (event.code === "ArrowRight" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const step = playbackSettings.seekStepSeconds;
        onSeekBy(event.shiftKey ? step * 2 : step);
        return;
      }

      if (event.code === "ArrowUp" && primaryModifier && !event.altKey) {
        event.preventDefault();
        const step = playbackSettings.volumeStepPercent / 100;
        onChangeVolumeBy(event.shiftKey ? step * 2 : step);
        return;
      }

      if (event.code === "ArrowDown" && primaryModifier && !event.altKey) {
        event.preventDefault();
        const step = playbackSettings.volumeStepPercent / 100;
        onChangeVolumeBy(event.shiftKey ? -(step * 2) : -step);
        return;
      }

      if (event.code === "ArrowUp" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onSelectAdjacentTrack(-1, event.shiftKey ? 10 : 1);
        return;
      }

      if (event.code === "ArrowDown" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onSelectAdjacentTrack(1, event.shiftKey ? 10 : 1);
        return;
      }

      // Pitch control: [ and ] to nudge, Shift for larger steps
      if (event.key === "[" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onPitchChange(event.shiftKey ? -1 : -0.1);
        return;
      }

      if (event.key === "]" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onPitchChange(event.shiftKey ? 1 : 0.1);
        return;
      }

      // Reset pitch with Backslash
      if (event.key === "\\" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onPitchChange(-playbackSettings.pitchPercent);
        return;
      }

      // Loop toggle: Shift + L
      if (event.key.toLowerCase() === "l" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onToggleLoop();
        return;
      }

      // Cue points: 1-8 to jump, Shift+1-8 to set
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 8) {
          event.preventDefault();
          if (event.shiftKey) onSetCuePoint(digit - 1);
          else onJumpToCuePoint(digit - 1);
          return;
        }
      }

      if (event.code === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onPlaySelectedTrack();
        return;
      }

      if (event.key.toLowerCase() === "l" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onToggleSelectedTrackFavorite();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onChangeVolumeBy,
    onOpenSearch,
    onOpenSettings,
    onPitchChange,
    onPlaySelectedTrack,
    onToggleLoop,
    onSetCuePoint,
    onJumpToCuePoint,
    onSeekBy,
    onSelectAdjacentTrack,
    onToggleQueue,
    onTogglePlayback,
    onToggleSelectedTrackFavorite,
    playbackSettings,
  ]);
}
