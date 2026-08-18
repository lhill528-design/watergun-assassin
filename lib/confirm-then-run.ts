import { Alert, Platform } from "react-native";

// Shared by any "confirm, then run one mutation" flow -- currently the
// admin Rules screen's "Load Standard Rules" and the Power-Ups screen's
// "Load All 44" buttons -- that needs the same web/native split already
// established in lib/sign-out.ts and lib/game-deletion.ts: React Native
// Web does not reliably invoke Alert.alert()'s button callbacks, so the
// actual mutation used to run only from inside one of those callbacks and
// could silently never fire on web.

type AlertButton = { text: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void };
type AlertDialogOptions = { cancelable?: boolean; onDismiss?: () => void };
type AlertFn = (title: string, message?: string, buttons?: AlertButton[], options?: AlertDialogOptions) => void;

export interface RequestConfirmedActionOptions {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<unknown> | void;
  // Whether a run is already in flight -- checked up front so a second
  // tap/click can't fire it twice.
  isRunning: boolean;
  onRunningChange: (running: boolean) => void;
  isWeb?: boolean;
  confirmWeb?: (message: string) => boolean;
  alertNative?: AlertFn;
}

// The guard flips on as soon as this runs -- before the confirmation
// dialog even opens, not just after it's accepted. That matters on
// native: Alert.alert() doesn't block, so two rapid taps could otherwise
// each open their own confirmation dialog before either had a chance to
// set anything. It flips back off on cancel (so a mistaken tap doesn't
// lock the button) and, either way, once run() settles.
//
// On Android, Alert.alert's dialog can also be dismissed without either
// button firing (back button / tapping outside it) -- explicitly
// non-cancelable, with an onDismiss fallback in case that's ever
// overridden, so that path can't leave the guard stuck on either.
export function requestConfirmedAction(options: RequestConfirmedActionOptions): void {
  if (options.isRunning) return;

  const isWeb = options.isWeb ?? Platform.OS === "web";
  const confirmWeb = options.confirmWeb ?? ((message: string) => window.confirm(message));
  const alertNative = options.alertNative ?? Alert.alert;

  options.onRunningChange(true);

  const performRun = async () => {
    try {
      await options.run();
    } catch {
      // The caller's own mutation error handler is responsible for
      // surfacing this (inline error state). Caught here only so it
      // can't surface as an unhandled promise rejection from
      // `void performRun()`.
    } finally {
      options.onRunningChange(false);
    }
  };

  if (isWeb) {
    if (confirmWeb(options.message)) {
      void performRun();
    } else {
      options.onRunningChange(false);
    }
    return;
  }

  alertNative(
    options.title,
    options.message,
    [
      { text: "Cancel", style: "cancel", onPress: () => options.onRunningChange(false) },
      { text: options.confirmLabel, style: "default", onPress: () => void performRun() },
    ],
    { cancelable: false, onDismiss: () => options.onRunningChange(false) },
  );
}
