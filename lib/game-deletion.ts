import { Alert, Platform } from "react-native";

// Same defect as Sign Out (lib/sign-out.ts) and game creation
// (lib/game-creation.ts): the "final confirmation" before a permanent
// delete previously lived entirely inside an Alert.alert() destructive
// button's onPress, which React Native Web does not reliably invoke -- so
// on web, confirming the delete could silently do nothing.

type AlertButton = { text: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void };
type AlertFn = (title: string, message?: string, buttons?: AlertButton[]) => void;

export function buildDeleteConfirmationMessage(gameName: string): string {
  return `Permanently delete “${gameName}”? Completed games should normally be preserved in Game History. This cannot be undone.`;
}

export interface RequestGameDeletionOptions {
  gameName: string;
  deleteGame: () => Promise<unknown> | void;
  // Whether a delete is already in flight -- checked up front so a second
  // tap/click while deleteGame() is still pending can't fire it twice.
  isDeleting: boolean;
  onDeletingChange: (deleting: boolean) => void;
  isWeb?: boolean;
  confirmWeb?: (message: string) => boolean;
  alertNative?: AlertFn;
}

// Extracted so the platform branch, the duplicate-submission guard, and
// the confirm-then-delete sequencing are all exercised directly by tests,
// without rendering the screen or simulating a real Alert/confirm dialog.
//
// The guard flips on as soon as this runs -- before the confirmation
// dialog even opens, not just after it's accepted. That matters on native:
// Alert.alert() doesn't block, so two rapid taps on the delete button
// could otherwise each open their own confirmation dialog before either
// had a chance to set anything. It flips back off on cancel (so a
// mistaken tap doesn't lock the button) and, either way, once
// deleteGame() settles.
export function requestGameDeletion(options: RequestGameDeletionOptions): void {
  if (options.isDeleting) return;

  const isWeb = options.isWeb ?? Platform.OS === "web";
  const confirmWeb = options.confirmWeb ?? ((message: string) => window.confirm(message));
  const alertNative = options.alertNative ?? Alert.alert;
  const message = buildDeleteConfirmationMessage(options.gameName);

  options.onDeletingChange(true);

  const performDelete = async () => {
    try {
      await options.deleteGame();
    } catch {
      // The caller's own mutation error handler is responsible for
      // surfacing this (inline error state). Caught here only so it can't
      // surface as an unhandled promise rejection from `void performDelete()`.
    } finally {
      options.onDeletingChange(false);
    }
  };

  if (isWeb) {
    if (confirmWeb(message)) {
      void performDelete();
    } else {
      options.onDeletingChange(false);
    }
    return;
  }

  alertNative("Final confirmation", message, [
    { text: "Cancel", style: "cancel", onPress: () => options.onDeletingChange(false) },
    { text: "Delete Permanently", style: "destructive", onPress: () => void performDelete() },
  ]);
}
