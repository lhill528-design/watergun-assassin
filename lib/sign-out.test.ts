import { describe, expect, it, vi } from "vitest";

// Dependency-free from this test's perspective too: requestSignOut() never
// actually touches react-native's real Alert/Platform in these tests
// (isWeb/confirmWeb/alertNative are always passed explicitly), but the
// module under test still imports react-native at the top level, and the
// real package can't be loaded outside Metro/babel (Flow syntax). Mocked
// the same way sign-in-form.integration.test.tsx mocks it.
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
}));

const { requestSignOut, SIGN_OUT_CONFIRM_MESSAGE } = await import("./sign-out");

describe("requestSignOut", () => {
  it("on web, accepting the confirm() dialog calls logout exactly once", () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const onSigningOutChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestSignOut({ logout, isSigningOut: false, onSigningOutChange, isWeb: true, confirmWeb });

    expect(confirmWeb).toHaveBeenCalledWith(SIGN_OUT_CONFIRM_MESSAGE);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("on web, cancelling the confirm() dialog does not call logout", () => {
    const logout = vi.fn();
    const onSigningOutChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(false);

    requestSignOut({ logout, isSigningOut: false, onSigningOutChange, isWeb: true, confirmWeb });

    expect(confirmWeb).toHaveBeenCalledWith(SIGN_OUT_CONFIRM_MESSAGE);
    expect(logout).not.toHaveBeenCalled();
    expect(onSigningOutChange).not.toHaveBeenCalled();
  });

  // The exact production bug: RN Web doesn't reliably invoke Alert.alert's
  // button callbacks. This proves the destructive-button wiring itself is
  // correct on the native path -- given a real callback invocation (which
  // is what a working Alert.alert does), logout gets called.
  it("on native, pressing the destructive Logout button in the Alert calls logout", () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const onSigningOutChange = vi.fn();
    const alertNative = vi.fn((_title, _message, buttons) => {
      const destructive = buttons?.find((button: { style?: string }) => button.style === "destructive");
      destructive?.onPress?.();
    });

    requestSignOut({ logout, isSigningOut: false, onSigningOutChange, isWeb: false, alertNative });

    expect(alertNative).toHaveBeenCalledWith(
      "Logout",
      "Are you sure?",
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel", style: "cancel" }),
        expect.objectContaining({ text: "Logout", style: "destructive" }),
      ]),
    );
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("on native, pressing Cancel does not call logout", () => {
    const logout = vi.fn();
    const onSigningOutChange = vi.fn();
    const alertNative = vi.fn((_title, _message, buttons) => {
      const cancel = buttons?.find((button: { style?: string }) => button.style === "cancel");
      cancel?.onPress?.();
    });

    requestSignOut({ logout, isSigningOut: false, onSigningOutChange, isWeb: false, alertNative });

    expect(logout).not.toHaveBeenCalled();
  });

  it("does nothing when a sign-out is already in progress, even on the accepting web path", () => {
    const logout = vi.fn();
    const onSigningOutChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestSignOut({ logout, isSigningOut: true, onSigningOutChange, isWeb: true, confirmWeb });

    expect(confirmWeb).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it("toggles onSigningOutChange(true) then (false) around a successful logout", async () => {
    let resolveLogout!: () => void;
    const logout = vi.fn(() => new Promise<void>((resolve) => { resolveLogout = resolve; }));
    const onSigningOutChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestSignOut({ logout, isSigningOut: false, onSigningOutChange, isWeb: true, confirmWeb });

    expect(onSigningOutChange).toHaveBeenNthCalledWith(1, true);
    resolveLogout();
    await Promise.resolve();
    await Promise.resolve();
    expect(onSigningOutChange).toHaveBeenNthCalledWith(2, false);
  });

  it("still clears the in-progress flag if logout itself rejects", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("network error"));
    const onSigningOutChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestSignOut({ logout, isSigningOut: false, onSigningOutChange, isWeb: true, confirmWeb });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSigningOutChange).toHaveBeenNthCalledWith(1, true);
    expect(onSigningOutChange).toHaveBeenNthCalledWith(2, false);
  });
});
