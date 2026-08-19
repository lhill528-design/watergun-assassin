// @vitest-environment jsdom
//
// Real-render integration test for the production bug: "Auto-Assign All
// Targets" and "Clear All Targets" only ever called their mutation from
// inside an Alert.alert button's onPress, which React Native Web does not
// reliably invoke -- so on web, confirming could silently do nothing.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is AdminTargetsScreen itself and lib/confirm-then-run.
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
  gameData: { id: 5, targetAssignment: "auto" } as any,
  players: [] as any[],
  assignMutateAsync: vi.fn(),
  lastAssignOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  clearMutateAsync: vi.fn(),
  lastClearOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  updateGameMutate: vi.fn(),
  invalidatePlayerList: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      get: { useQuery: () => ({ data: trpcState.gameData }) },
      update: { useMutation: () => ({ mutate: trpcState.updateGameMutate, isPending: false }) },
      assignTargets: {
        useMutation: (options: any) => {
          trpcState.lastAssignOptions = options;
          return { mutateAsync: trpcState.assignMutateAsync, isPending: false };
        },
      },
      clearTargets: {
        useMutation: (options: any) => {
          trpcState.lastClearOptions = options;
          return { mutateAsync: trpcState.clearMutateAsync, isPending: false };
        },
      },
    },
    player: {
      list: { useQuery: () => ({ data: trpcState.players }) },
    },
    useUtils: () => ({
      player: { list: { invalidate: trpcState.invalidatePlayerList } },
    }),
  },
}));

beforeEach(() => {
  trpcState.lastAssignOptions = null;
  trpcState.lastClearOptions = null;
  trpcState.gameData = { id: 5, targetAssignment: "auto" };
  trpcState.players = [
    { id: 1, userId: 1, status: "alive", targetId: 2, kills: 0, points: 0, user: { name: "P1" } },
    { id: 2, userId: 2, status: "alive", targetId: 1, kills: 0, points: 0, user: { name: "P2" } },
  ];
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: AdminTargetsScreen } = await import("@/app/admin/targets");

describe("AdminTargetsScreen: Auto-Assign All Targets", () => {
  it("web: accepting window.confirm invokes the assign mutation exactly once", () => {
    trpcState.assignMutateAsync.mockResolvedValue({ affected: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Auto-Assign All Targets/));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.assignMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.assignMutateAsync).toHaveBeenCalledWith({ gameId: 5 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the assign mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Auto-Assign All Targets/));

    expect(trpcState.assignMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("rapid repeated clicks invoke only one assign mutation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminTargetsScreen));

    const button = screen.getByText(/Auto-Assign All Targets/);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.assignMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: invalidates player.list once and shows the server-reported count", async () => {
    trpcState.assignMutateAsync.mockResolvedValue({ affected: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminTargetsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/Auto-Assign All Targets/));
    });
    act(() => trpcState.lastAssignOptions?.onSuccess?.({ affected: 2 }));

    expect(trpcState.invalidatePlayerList).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidatePlayerList).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText(/Assigned targets for 2 players/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("rejects locally with fewer than 2 alive players, without opening a dialog or calling the mutation", () => {
    trpcState.players = [{ id: 1, userId: 1, status: "alive", targetId: null, kills: 0, points: 0, user: { name: "P1" } }];
    const confirmSpy = vi.spyOn(window, "confirm");
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Auto-Assign All Targets/));

    expect(screen.getByText("Need at least 2 alive players to assign targets")).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(trpcState.assignMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // Correction from review: Assign and Clear used to guard themselves
  // independently, so a Clear click could slip through while an Assign
  // mutation (which rewrites the same players' targetId) was still in
  // flight, and vice versa. Both buttons now share one ref-backed lock.
  it("the shared guard blocks Clear from starting while Assign is still in flight, and disables both buttons", async () => {
    let resolveAssign!: (value: unknown) => void;
    trpcState.assignMutateAsync.mockReturnValue(new Promise((resolve) => { resolveAssign = resolve; }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Auto-Assign All Targets/));
    expect(trpcState.assignMutateAsync).toHaveBeenCalledTimes(1);

    // Assign is still pending -- Clear must not fire, and both buttons
    // must read as disabled.
    fireEvent.click(screen.getByText(/Clear All Targets/));
    expect(trpcState.clearMutateAsync).not.toHaveBeenCalled();
    expect((screen.getByText(/Assigning\.\.\./).closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText(/Clear All Targets/).closest("button") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveAssign({ affected: 2 });
      await Promise.resolve();
    });
    confirmSpy.mockRestore();
  });
});

describe("AdminTargetsScreen: Clear All Targets", () => {
  it("web: accepting window.confirm invokes the clear mutation exactly once, with real NULL semantics server-side", () => {
    trpcState.clearMutateAsync.mockResolvedValue({ affected: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Clear All Targets/));

    expect(trpcState.clearMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.clearMutateAsync).toHaveBeenCalledWith({ gameId: 5 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the clear mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Clear All Targets/));

    expect(trpcState.clearMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("native: pressing the confirm button still invokes the clear mutation", async () => {
    platformState.OS = "ios";
    trpcState.clearMutateAsync.mockResolvedValue({ affected: 2 });
    alertState.alert.mockImplementation((_title: string, _message: string, buttons: any[]) => {
      const confirm = buttons?.find((button) => button.text === "Clear");
      confirm?.onPress?.();
    });
    render(React.createElement(AdminTargetsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/Clear All Targets/));
    });

    expect(alertState.alert).toHaveBeenCalledTimes(1);
    expect(trpcState.clearMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("the shared guard blocks Assign from starting while Clear is still in flight", async () => {
    let resolveClear!: (value: unknown) => void;
    trpcState.clearMutateAsync.mockReturnValue(new Promise((resolve) => { resolveClear = resolve; }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminTargetsScreen));

    fireEvent.click(screen.getByText(/Clear All Targets/));
    expect(trpcState.clearMutateAsync).toHaveBeenCalledTimes(1);

    // Clear is still pending -- Assign must not fire.
    fireEvent.click(screen.getByText(/Auto-Assign All Targets/));
    expect(trpcState.assignMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      resolveClear({ affected: 2 });
      await Promise.resolve();
    });
    confirmSpy.mockRestore();
  });
});
