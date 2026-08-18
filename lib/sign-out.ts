import { Alert, Platform } from "react-native";

// React Native Web does not reliably invoke Alert.alert()'s button
// callbacks -- clicking "Sign Out" there previously never called logout()
// at all. window.confirm() is a real, synchronous browser dialog whose
// return value is reliable, so web gets that instead; native keeps the
// existing Alert.alert() confirmation, which does work there.
export const SIGN_OUT_CONFIRM_MESSAGE = "Are you sure you want to sign out?";

type AlertButton = { text: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void };
type AlertFn = (title: string, message?: string, buttons?: AlertButton[]) => void;

export interface RequestSignOutOptions {
  logout: () => Promise<void> | void;
  // Whether a sign-out is already in flight -- checked up front so a
  // second tap/click while logout() is still pending can't fire it twice.
  isSigningOut: boolean;
  onSigningOutChange: (signingOut: boolean) => void;
  isWeb?: boolean;
  confirmWeb?: (message: string) => boolean;
  alertNative?: AlertFn;
}

// Extracted out of the JSX onPress so the platform branch, the
// duplicate-submission guard, and the confirm-then-logout sequencing are
// all exercised directly by tests, without rendering the screen or
// simulating a real Alert/confirm dialog.
export function requestSignOut(options: RequestSignOutOptions): void {
  if (options.isSigningOut) return;

  const isWeb = options.isWeb ?? Platform.OS === "web";
  const confirmWeb = options.confirmWeb ?? ((message: string) => window.confirm(message));
  const alertNative = options.alertNative ?? Alert.alert;

  const performLogout = async () => {
    options.onSigningOutChange(true);
    try {
      await options.logout();
    } catch {
      // No error-recovery UI for a failed sign-out attempt -- the
      // in-progress flag is still cleared below either way, so a retry
      // isn't blocked. Caught (not left to reject `void performLogout()`)
      // so this can't surface as an unhandled promise rejection.
    } finally {
      options.onSigningOutChange(false);
    }
  };

  if (isWeb) {
    if (confirmWeb(SIGN_OUT_CONFIRM_MESSAGE)) {
      void performLogout();
    }
    return;
  }

  alertNative("Logout", "Are you sure?", [
    { text: "Cancel", style: "cancel" },
    { text: "Logout", style: "destructive", onPress: () => void performLogout() },
  ]);
}
