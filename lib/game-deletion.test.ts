import { describe, expect, it, vi } from "vitest";

// requestGameDeletion imports react-native at the top level (for the
// Alert/Platform defaults), and the real package can't load outside
// Metro/babel (Flow syntax) -- mocked the same way lib/sign-out.test.ts
// mocks it. Every test below passes isWeb/confirmWeb/alertNative
// explicitly, so the mock's actual shape barely matters beyond loading.
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
}));

const { requestGameDeletion, buildDeleteConfirmationMessage } = await import("./game-deletion");

describe("requestGameDeletion", () => {
  it("on web, accepting the confirm() dialog calls deleteGame exactly once", () => {
    const deleteGame = vi.fn().mockResolvedValue(undefined);
    const onDeletingChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestGameDeletion({ gameName: "Summer Assassin", deleteGame, isDeleting: false, onDeletingChange, isWeb: true, confirmWeb });

    expect(confirmWeb).toHaveBeenCalledWith(buildDeleteConfirmationMessage("Summer Assassin"));
    expect(deleteGame).toHaveBeenCalledTimes(1);
  });

  it("on web, cancelling the confirm() dialog calls deleteGame zero times", () => {
    const deleteGame = vi.fn();
    const onDeletingChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(false);

    requestGameDeletion({ gameName: "Summer Assassin", deleteGame, isDeleting: false, onDeletingChange, isWeb: true, confirmWeb });

    expect(deleteGame).not.toHaveBeenCalled();
  });

  it("on web, the guard flips on before the dialog opens and back off if cancelled", () => {
    const onDeletingChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(false);

    requestGameDeletion({ gameName: "Summer Assassin", deleteGame: vi.fn(), isDeleting: false, onDeletingChange, isWeb: true, confirmWeb });

    expect(onDeletingChange).toHaveBeenNthCalledWith(1, true);
    expect(onDeletingChange).toHaveBeenNthCalledWith(2, false);
  });

  // The exact production bug: Alert.alert's destructive-button callback
  // doesn't reliably fire on RN Web. This proves the wiring is correct on
  // the native path -- given a real callback invocation (what a working
  // Alert.alert does), deleteGame gets called.
  it("on native, pressing the destructive Delete Permanently button calls deleteGame", () => {
    const deleteGame = vi.fn().mockResolvedValue(undefined);
    const onDeletingChange = vi.fn();
    const alertNative = vi.fn((_title, _message, buttons) => {
      const destructive = buttons?.find((button: { style?: string }) => button.style === "destructive");
      destructive?.onPress?.();
    });

    requestGameDeletion({ gameName: "Summer Assassin", deleteGame, isDeleting: false, onDeletingChange, isWeb: false, alertNative });

    expect(alertNative).toHaveBeenCalledWith(
      "Final confirmation",
      buildDeleteConfirmationMessage("Summer Assassin"),
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel", style: "cancel" }),
        expect.objectContaining({ text: "Delete Permanently", style: "destructive" }),
      ]),
      expect.objectContaining({ cancelable: false }),
    );
    expect(deleteGame).toHaveBeenCalledTimes(1);
  });

  // The correction this proves: on Android, Alert.alert's dialog can be
  // dismissed (back button / tapping outside it) without either button's
  // onPress ever firing. Without cancelable:false + onDismiss, the guard
  // set at the top of requestGameDeletion would stay true forever,
  // permanently disabling the delete button.
  it("on native, dismissing the dialog without pressing a button still clears the in-progress flag", () => {
    const deleteGame = vi.fn();
    const onDeletingChange = vi.fn();
    const alertNative = vi.fn((_title, _message, _buttons, dialogOptions) => {
      // Simulates Android's back button / tap-outside dismissal, which
      // invokes onDismiss rather than any button's onPress.
      dialogOptions?.onDismiss?.();
    });

    requestGameDeletion({ gameName: "Summer Assassin", deleteGame, isDeleting: false, onDeletingChange, isWeb: false, alertNative });

    expect(alertNative).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cancelable: false, onDismiss: expect.any(Function) }),
    );
    expect(deleteGame).not.toHaveBeenCalled();
    expect(onDeletingChange).toHaveBeenLastCalledWith(false);
  });

  it("on native, pressing Cancel calls deleteGame zero times and clears the in-progress flag", () => {
    const deleteGame = vi.fn();
    const onDeletingChange = vi.fn();
    const alertNative = vi.fn((_title, _message, buttons) => {
      const cancel = buttons?.find((button: { style?: string }) => button.style === "cancel");
      cancel?.onPress?.();
    });

    requestGameDeletion({ gameName: "Summer Assassin", deleteGame, isDeleting: false, onDeletingChange, isWeb: false, alertNative });

    expect(deleteGame).not.toHaveBeenCalled();
    expect(onDeletingChange).toHaveBeenLastCalledWith(false);
  });

  // A second tap landing before the first confirmation dialog even opens
  // (native's Alert.alert doesn't block, unlike web's confirm()) must not
  // open a second one.
  it("does nothing when a deletion is already in progress", () => {
    const deleteGame = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);
    const alertNative = vi.fn();

    requestGameDeletion({ gameName: "X", deleteGame, isDeleting: true, onDeletingChange: vi.fn(), isWeb: true, confirmWeb });
    requestGameDeletion({ gameName: "X", deleteGame, isDeleting: true, onDeletingChange: vi.fn(), isWeb: false, alertNative });

    expect(confirmWeb).not.toHaveBeenCalled();
    expect(alertNative).not.toHaveBeenCalled();
    expect(deleteGame).not.toHaveBeenCalled();
  });

  it("clears the in-progress flag even if deleteGame itself rejects", async () => {
    const deleteGame = vi.fn().mockRejectedValue(new Error("server exploded"));
    const onDeletingChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestGameDeletion({ gameName: "X", deleteGame, isDeleting: false, onDeletingChange, isWeb: true, confirmWeb });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDeletingChange).toHaveBeenNthCalledWith(1, true);
    expect(onDeletingChange).toHaveBeenNthCalledWith(2, false);
  });
});
