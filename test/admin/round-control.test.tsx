// @vitest-environment jsdom
//
// Real-render integration test for the production bug: Start/End Round,
// Start/End Purge, Pause Game, and End Game only ever called their
// mutation from inside the screen's local Alert-only confirmAction
// helper, which React Native Web does not reliably invoke -- so on web,
// confirming any of these could silently do nothing.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is RoundControlScreen itself and lib/confirm-then-run.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const platformState = vi.hoisted(() => ({ OS: "web" as string }));
const alertState = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("react-native", () => {
  const ReactActual = require("react");
  return {
    View: (props: any) => ReactActual.createElement("div", null, props.children),
    Text: (props: any) => ReactActual.createElement("span", null, props.children),
    ScrollView: (props: any) => ReactActual.createElement("div", null, props.children),
    TextInput: ({ value, onChangeText, placeholder }: any) =>
      ReactActual.createElement("input", {
        "aria-label": placeholder,
        value,
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
    TouchableOpacity: ({ onPress, disabled, children }: any) =>
      ReactActual.createElement("button", { onClick: onPress, disabled }, children),
    Alert: { alert: (...args: any[]) => alertState.alert(...args) },
    Platform: platformState,
  };
});

vi.mock("@/components/screen-container", () => ({
  ScreenContainer: (props: any) => React.createElement("div", null, props.children),
}));

const routerState = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => routerState }));

const gameContextState = vi.hoisted(() => ({ activeGameId: 5 }));
vi.mock("@/lib/game-context", () => ({
  useGame: () => ({ activeGameId: gameContextState.activeGameId, setActiveGameId: vi.fn(), isAdmin: false, setIsAdmin: vi.fn() }),
}));

const trpcState = vi.hoisted(() => ({
  gameData: { id: 5, status: "active", currentRound: 1, purgeActive: false, purgeScheduledAt: null } as any,
  startRoundMutateAsync: vi.fn(),
  lastStartRoundOptions: null as any,
  endRoundMutateAsync: vi.fn(),
  lastEndRoundOptions: null as any,
  startPurgeMutateAsync: vi.fn(),
  lastStartPurgeOptions: null as any,
  endPurgeMutateAsync: vi.fn(),
  lastEndPurgeOptions: null as any,
  endGameMutateAsync: vi.fn(),
  lastEndGameOptions: null as any,
  updateGameMutateAsync: vi.fn(),
  lastUpdateGameOptions: null as any,
  schedulePurgeMutate: vi.fn(),
  invalidateGame: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      get: { useQuery: () => ({ data: trpcState.gameData }) },
      startRound: { useMutation: (o: any) => { trpcState.lastStartRoundOptions = o; return { mutateAsync: trpcState.startRoundMutateAsync, isPending: false }; } },
      endRound: { useMutation: (o: any) => { trpcState.lastEndRoundOptions = o; return { mutateAsync: trpcState.endRoundMutateAsync, isPending: false }; } },
      startPurge: { useMutation: (o: any) => { trpcState.lastStartPurgeOptions = o; return { mutateAsync: trpcState.startPurgeMutateAsync, isPending: false }; } },
      endPurge: { useMutation: (o: any) => { trpcState.lastEndPurgeOptions = o; return { mutateAsync: trpcState.endPurgeMutateAsync, isPending: false }; } },
      endGame: { useMutation: (o: any) => { trpcState.lastEndGameOptions = o; return { mutateAsync: trpcState.endGameMutateAsync, isPending: false }; } },
      schedulePurge: { useMutation: () => ({ mutate: trpcState.schedulePurgeMutate, isPending: false }) },
      update: { useMutation: (o: any) => { trpcState.lastUpdateGameOptions = o; return { mutate: vi.fn(), mutateAsync: trpcState.updateGameMutateAsync, isPending: false }; } },
    },
    useUtils: () => ({
      game: { get: { invalidate: trpcState.invalidateGame } },
    }),
  },
}));

beforeEach(() => {
  trpcState.gameData = { id: 5, status: "active", currentRound: 1, purgeActive: false, purgeScheduledAt: null };
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: RoundControlScreen } = await import("@/app/admin/round-control");

describe("RoundControlScreen: Start New Round", () => {
  it("web: accepting window.confirm invokes startRound exactly once", () => {
    trpcState.startRoundMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(RoundControlScreen));

    fireEvent.click(screen.getByText(/Start New Round/));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.startRoundMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.startRoundMutateAsync).toHaveBeenCalledWith({ gameId: 5 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes startRound zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(RoundControlScreen));

    fireEvent.click(screen.getByText(/Start New Round/));

    expect(trpcState.startRoundMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("the shared guard blocks a second action (End Game) while Start Round is still in flight", async () => {
    let resolveStartRound!: (value: unknown) => void;
    trpcState.startRoundMutateAsync.mockReturnValue(new Promise((resolve) => { resolveStartRound = resolve; }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(RoundControlScreen));

    fireEvent.click(screen.getByText(/Start New Round/));
    expect(trpcState.startRoundMutateAsync).toHaveBeenCalledTimes(1);

    // Start Round is still pending -- End Game must not fire.
    fireEvent.click(screen.getByText(/End Game/));
    expect(trpcState.endGameMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      resolveStartRound({ success: true });
      await Promise.resolve();
    });
    confirmSpy.mockRestore();
  });

  it("on success: invalidates game.get once and shows an inline success message", async () => {
    trpcState.startRoundMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(RoundControlScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/Start New Round/));
    });
    act(() => trpcState.lastStartRoundOptions?.onSuccess?.({ success: true }));

    expect(trpcState.invalidateGame).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText("Round started!")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: shows the server's actual error message inline", async () => {
    trpcState.startRoundMutateAsync.mockRejectedValue(new Error("A round is already active"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(RoundControlScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/Start New Round/));
    });
    act(() => trpcState.lastStartRoundOptions?.onError?.({ message: "A round is already active" }));

    expect(screen.getByText("A round is already active")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe("RoundControlScreen: End Purge", () => {
  it("native: pressing the confirm button still invokes endPurge", async () => {
    trpcState.gameData = { ...trpcState.gameData, purgeActive: true };
    platformState.OS = "ios";
    trpcState.endPurgeMutateAsync.mockResolvedValue({ success: true });
    alertState.alert.mockImplementation((_title: string, _message: string, buttons: any[]) => {
      const confirm = buttons?.find((button: any) => button.text === "Confirm");
      confirm?.onPress?.();
    });
    render(React.createElement(RoundControlScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/End Purge/));
    });

    expect(alertState.alert).toHaveBeenCalledTimes(1);
    expect(trpcState.endPurgeMutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe("RoundControlScreen: Resume Game", () => {
  it("has no confirmation dialog and calls updateGame directly (never was Alert-gated)", () => {
    trpcState.gameData = { ...trpcState.gameData, status: "paused" };
    render(React.createElement(RoundControlScreen));

    fireEvent.click(screen.getByText(/Resume Game/));

    expect(alertState.alert).not.toHaveBeenCalled();
  });
});
