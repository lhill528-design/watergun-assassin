import { describe, expect, it, vi } from "vitest";

// requestConfirmedAction imports react-native at the top level (for the
// Alert/Platform defaults), and the real package can't load outside
// Metro/babel (Flow syntax) -- mocked the same way lib/sign-out.test.ts
// and lib/game-deletion.test.ts mock it. Every test below passes
// isWeb/confirmWeb/alertNative explicitly, so the mock's actual shape
// barely matters beyond loading.
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
}));

const { requestConfirmedAction } = await import("./confirm-then-run");

const baseOptions = {
  title: "Load Standard Rules",
  message: "Add the standard rules?",
  confirmLabel: "Add All",
};

describe("requestConfirmedAction", () => {
  it("on web, accepting the confirm() dialog runs the action exactly once", () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const onRunningChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestConfirmedAction({ ...baseOptions, run, isRunning: false, onRunningChange, isWeb: true, confirmWeb });

    expect(confirmWeb).toHaveBeenCalledWith(baseOptions.message);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("on web, cancelling the confirm() dialog runs the action zero times", () => {
    const run = vi.fn();
    const onRunningChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(false);

    requestConfirmedAction({ ...baseOptions, run, isRunning: false, onRunningChange, isWeb: true, confirmWeb });

    expect(run).not.toHaveBeenCalled();
    expect(onRunningChange).toHaveBeenNthCalledWith(1, true);
    expect(onRunningChange).toHaveBeenNthCalledWith(2, false);
  });

  // The exact production bug: Alert.alert's confirm-button callback
  // doesn't reliably fire on RN Web. This proves the wiring is correct on
  // the native path -- given a real callback invocation (what a working
  // Alert.alert does), the action runs.
  it("on native, pressing the confirm button runs the action", () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const onRunningChange = vi.fn();
    const alertNative = vi.fn((_title, _message, buttons) => {
      const confirm = buttons?.find((button: { text?: string }) => button.text === baseOptions.confirmLabel);
      confirm?.onPress?.();
    });

    requestConfirmedAction({ ...baseOptions, run, isRunning: false, onRunningChange, isWeb: false, alertNative });

    expect(alertNative).toHaveBeenCalledWith(
      baseOptions.title,
      baseOptions.message,
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel", style: "cancel" }),
        expect.objectContaining({ text: baseOptions.confirmLabel }),
      ]),
      expect.objectContaining({ cancelable: false }),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("on native, pressing Cancel runs the action zero times", () => {
    const run = vi.fn();
    const alertNative = vi.fn((_title, _message, buttons) => {
      const cancel = buttons?.find((button: { style?: string }) => button.style === "cancel");
      cancel?.onPress?.();
    });

    requestConfirmedAction({ ...baseOptions, run, isRunning: false, onRunningChange: vi.fn(), isWeb: false, alertNative });

    expect(run).not.toHaveBeenCalled();
  });

  // On Android, the dialog can be dismissed (back button / tapping
  // outside it) without either button's onPress firing.
  it("on native, dismissing the dialog clears the in-progress flag without running the action", () => {
    const run = vi.fn();
    const onRunningChange = vi.fn();
    const alertNative = vi.fn((_title, _message, _buttons, dialogOptions) => {
      dialogOptions?.onDismiss?.();
    });

    requestConfirmedAction({ ...baseOptions, run, isRunning: false, onRunningChange, isWeb: false, alertNative });

    expect(run).not.toHaveBeenCalled();
    expect(onRunningChange).toHaveBeenLastCalledWith(false);
  });

  // Rapid/repeated clicks: a caller backing `isRunning` with a synchronous
  // ref (not just React state) means the guard sees the up-to-date value
  // immediately, even before a re-render -- this proves the guard itself
  // blocks a second call regardless of how the first one is progressing.
  it("does nothing on a repeated call while already running -- no second dialog, no second run", () => {
    const run = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);
    const alertNative = vi.fn();

    requestConfirmedAction({ ...baseOptions, run, isRunning: true, onRunningChange: vi.fn(), isWeb: true, confirmWeb });
    requestConfirmedAction({ ...baseOptions, run, isRunning: true, onRunningChange: vi.fn(), isWeb: false, alertNative });

    expect(confirmWeb).not.toHaveBeenCalled();
    expect(alertNative).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("clears the in-progress flag even if the action itself rejects", async () => {
    const run = vi.fn().mockRejectedValue(new Error("server exploded"));
    const onRunningChange = vi.fn();
    const confirmWeb = vi.fn().mockReturnValue(true);

    requestConfirmedAction({ ...baseOptions, run, isRunning: false, onRunningChange, isWeb: true, confirmWeb });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRunningChange).toHaveBeenNthCalledWith(1, true);
    expect(onRunningChange).toHaveBeenNthCalledWith(2, false);
  });
});
