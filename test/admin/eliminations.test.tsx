// @vitest-environment jsdom
//
// Real-render integration test for the production bug: Approve/Deny
// elimination, Approve/Reject duel, and Approve/Return Sanctuary only
// ever called their mutation from inside Alert.alert's button callbacks
// (or, for Return Sanctuary, with no confirmation at all), which React
// Native Web does not reliably invoke -- so on web, confirming any of
// these could silently do nothing.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is AdminEliminationsScreen itself and
// lib/confirm-then-run.
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
    TouchableOpacity: ({ onPress, disabled, children }: any) =>
      ReactActual.createElement("button", { onClick: onPress, disabled }, children),
    FlatList: ({ data, renderItem, keyExtractor }: any) =>
      ReactActual.createElement("div", null, data.map((item: any) => ReactActual.createElement(
        ReactActual.Fragment,
        { key: keyExtractor(item) },
        renderItem({ item }),
      ))),
    Linking: { openURL: vi.fn() },
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
  pending: [] as any[],
  reviewMutateAsync: vi.fn(),
  lastReviewOptions: null as any,
  duels: [] as any[],
  resolveDuelMutateAsync: vi.fn(),
  lastResolveDuelOptions: null as any,
  sanctuaries: [] as any[],
  approveSanctuaryMutateAsync: vi.fn(),
  lastApproveSanctuaryOptions: null as any,
  rejectSanctuaryMutateAsync: vi.fn(),
  lastRejectSanctuaryOptions: null as any,
  invalidatePlayerList: vi.fn(),
  invalidateLeaderboard: vi.fn(),
  invalidateAchievementPlayerList: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    elimination: {
      pending: { useQuery: () => ({ data: trpcState.pending, refetch: vi.fn() }) },
      review: {
        useMutation: (options: any) => {
          trpcState.lastReviewOptions = options;
          return { mutateAsync: trpcState.reviewMutateAsync, isPending: false };
        },
      },
    },
    duel: {
      pending: { useQuery: () => ({ data: trpcState.duels, refetch: vi.fn() }) },
      resolve: {
        useMutation: (options: any) => {
          trpcState.lastResolveDuelOptions = options;
          return { mutateAsync: trpcState.resolveDuelMutateAsync, isPending: false };
        },
      },
    },
    powerUp: {
      pendingSanctuaries: { useQuery: () => ({ data: trpcState.sanctuaries, refetch: vi.fn() }) },
      approveSanctuary: {
        useMutation: (options: any) => {
          trpcState.lastApproveSanctuaryOptions = options;
          return { mutateAsync: trpcState.approveSanctuaryMutateAsync, isPending: false };
        },
      },
      rejectSanctuary: {
        useMutation: (options: any) => {
          trpcState.lastRejectSanctuaryOptions = options;
          return { mutateAsync: trpcState.rejectSanctuaryMutateAsync, isPending: false };
        },
      },
    },
    useUtils: () => ({
      player: { list: { invalidate: trpcState.invalidatePlayerList } },
      game: { leaderboard: { invalidate: trpcState.invalidateLeaderboard } },
      achievement: { playerList: { invalidate: trpcState.invalidateAchievementPlayerList } },
    }),
  },
}));

const ELIMINATION = {
  id: 501, round: 2, createdAt: new Date().toISOString(), videoUrl: null,
  eliminator: { userId: 101, user: { name: "Hunter" } },
  eliminated: { userId: 102, user: { name: "Target" } },
};
const DUEL = {
  id: 601, challengerId: 11, opponentId: 12, proposedWinnerId: 11, witnessName: null, evidenceUrl: null,
  challenger: { userId: 201, user: { name: "Challenger" } },
  opponent: { userId: 202, user: { name: "Opponent" } },
};
const SANCTUARY = {
  id: 701, activationData: { zoneLatitude: "29.76", zoneLongitude: "-95.37" },
  player: { userId: 301, user: { name: "Sanctuary Owner" } },
};

beforeEach(() => {
  gameContextState.activeGameId = 5;
  trpcState.pending = [];
  trpcState.duels = [];
  trpcState.sanctuaries = [];
  trpcState.lastReviewOptions = null;
  trpcState.lastResolveDuelOptions = null;
  trpcState.lastApproveSanctuaryOptions = null;
  trpcState.lastRejectSanctuaryOptions = null;
  platformState.OS = "web";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: AdminEliminationsScreen } = await import("@/app/admin/eliminations");

describe("AdminEliminationsScreen: elimination review", () => {
  beforeEach(() => {
    trpcState.pending = [ELIMINATION];
  });

  it("web: accepting the confirmation invokes the review mutation exactly once", () => {
    trpcState.reviewMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("✅ Approve"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.reviewMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.reviewMutateAsync).toHaveBeenCalledWith({ eliminationId: 501, gameId: 5, approved: true });
    confirmSpy.mockRestore();
  });

  it("web: cancelling the confirmation invokes the review mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("❌ Deny"));

    expect(trpcState.reviewMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("rapid repeated clicks invoke only one review mutation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    const button = screen.getByText("✅ Approve");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.reviewMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: invalidates player.list, leaderboard, and achievement.playerList, and shows an inline success message", async () => {
    trpcState.reviewMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("✅ Approve"));
    });
    act(() => trpcState.lastReviewOptions?.onSuccess?.({ success: true }, { eliminationId: 501, gameId: 5, approved: true }));

    expect(trpcState.invalidatePlayerList).toHaveBeenCalledWith({ gameId: 5 });
    expect(trpcState.invalidateLeaderboard).toHaveBeenCalledWith({ gameId: 5 });
    expect(trpcState.invalidateAchievementPlayerList).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText("Elimination approved.")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: shows the server's actual error message inline, not just via Alert", async () => {
    trpcState.reviewMutateAsync.mockRejectedValue(new Error("This elimination was already reviewed"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("✅ Approve"));
    });
    act(() => trpcState.lastReviewOptions?.onError?.(new Error("This elimination was already reviewed"), { eliminationId: 501, gameId: 5, approved: true }));

    expect(screen.getByText("This elimination was already reviewed")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe("AdminEliminationsScreen: duel review", () => {
  beforeEach(() => {
    trpcState.duels = [DUEL];
  });

  it("web: accepting the confirmation invokes the duel resolve mutation exactly once", () => {
    trpcState.resolveDuelMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("Approve Result"));

    expect(trpcState.resolveDuelMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.resolveDuelMutateAsync).toHaveBeenCalledWith({ gameId: 5, duelId: 601, approved: true });
    confirmSpy.mockRestore();
  });

  it("web: cancelling the confirmation invokes the duel resolve mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("Reject Result"));

    expect(trpcState.resolveDuelMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("on failure: shows the server's actual error message inline", async () => {
    trpcState.resolveDuelMutateAsync.mockRejectedValue(new Error("Duel already resolved"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("Approve Result"));
    });
    act(() => trpcState.lastResolveDuelOptions?.onError?.(new Error("Duel already resolved"), { gameId: 5, duelId: 601, approved: true }));

    expect(screen.getByText("Duel already resolved")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe("AdminEliminationsScreen: Sanctuary review", () => {
  beforeEach(() => {
    trpcState.sanctuaries = [SANCTUARY];
  });

  it("web: accepting the confirmation invokes the approveSanctuary mutation exactly once", () => {
    trpcState.approveSanctuaryMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("✅ Approve"));

    expect(trpcState.approveSanctuaryMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.approveSanctuaryMutateAsync).toHaveBeenCalledWith({ gameId: 5, inventoryId: 701 });
    confirmSpy.mockRestore();
  });

  it("web: accepting the confirmation invokes the rejectSanctuary mutation exactly once (Return now requires confirmation)", () => {
    trpcState.rejectSanctuaryMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("Return"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.rejectSanctuaryMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.rejectSanctuaryMutateAsync).toHaveBeenCalledWith({ gameId: 5, inventoryId: 701 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling the confirmation invokes the rejectSanctuary mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminEliminationsScreen));

    fireEvent.click(screen.getByText("Return"));

    expect(trpcState.rejectSanctuaryMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("on failure: shows the server's actual error message inline", async () => {
    trpcState.approveSanctuaryMutateAsync.mockRejectedValue(new Error("Sanctuary request not found"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminEliminationsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("✅ Approve"));
    });
    act(() => trpcState.lastApproveSanctuaryOptions?.onError?.(new Error("Sanctuary request not found"), { gameId: 5, inventoryId: 701 }));

    expect(screen.getByText("Sanctuary request not found")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe("AdminEliminationsScreen: native confirmation path", () => {
  beforeEach(() => {
    trpcState.pending = [ELIMINATION];
    platformState.OS = "ios";
  });

  it("native: pressing the confirm button in Alert.alert still invokes the review mutation", async () => {
    trpcState.reviewMutateAsync.mockResolvedValue({ success: true });
    alertState.alert.mockImplementation((_title: string, _message: string, buttons: any[]) => {
      const confirm = buttons?.find((button) => button.text === "Approve");
      confirm?.onPress?.();
    });
    render(React.createElement(AdminEliminationsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("✅ Approve"));
    });

    expect(trpcState.reviewMutateAsync).toHaveBeenCalledTimes(1);
  });
});
