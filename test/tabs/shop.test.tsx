// @vitest-environment jsdom
//
// Real-render integration test for the production bug: both
// handlePurchase() and handleActivate() only ever called their mutation
// from inside an Alert.alert button's onPress, which React Native Web
// does not reliably invoke -- so on web, confirming a purchase or an
// activation could silently do nothing.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is ShopScreen itself and lib/confirm-then-run.
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

vi.mock("expo-location", () => ({ geocodeAsync: vi.fn() }));

vi.mock("@/components/screen-container", () => ({
  ScreenContainer: (props: any) => React.createElement("div", null, props.children),
}));

const routerState = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => routerState }));

const gameContextState = vi.hoisted(() => ({ activeGameId: 5 }));
vi.mock("@/lib/game-context", () => ({
  useGame: () => ({ activeGameId: gameContextState.activeGameId, setActiveGameId: vi.fn(), isAdmin: false, setIsAdmin: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const NON_TARGETED_POWER_UP = { id: 20, name: "Immunity Shield", emoji: "🛡️", effect: "Immunity", cost: 200, discount: 0, category: "defensive", isEnabled: true, maxUsesPerGame: null, duration: 240 };
const TARGETED_POWER_UP_ITEM = { id: 501, powerUpId: 30, gameId: 5, status: "inventory", powerUp: { name: "Bounty", emoji: "💰", usageFeeCents: 0 } };
const NON_TARGETED_ITEM = { id: 502, powerUpId: 20, gameId: 5, status: "inventory", powerUp: { name: "Immunity Shield", emoji: "🛡️", usageFeeCents: 0 } };

const trpcState = vi.hoisted(() => ({
  powerUps: [] as any[],
  inventory: [] as any[],
  players: [] as any[],
  player: { id: 1, points: 500, reservedPoints: 0, pendingDiscountPercent: null } as any,
  reconData: undefined as any,
  purchaseMutateAsync: vi.fn(),
  lastPurchaseOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  activateMutateAsync: vi.fn(),
  lastActivateOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  invalidate: {
    playerMe: vi.fn(),
    inventory: vi.fn(),
    playerList: vi.fn(),
    reconTarget: vi.fn(),
    leaderboard: vi.fn(),
    achievementPlayerList: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    powerUp: {
      list: { useQuery: () => ({ data: trpcState.powerUps }) },
      inventory: { useQuery: () => ({ data: trpcState.inventory }) },
      purchase: {
        useMutation: (options: any) => {
          trpcState.lastPurchaseOptions = options;
          return { mutateAsync: trpcState.purchaseMutateAsync, isPending: false };
        },
      },
      activate: {
        useMutation: (options: any) => {
          trpcState.lastActivateOptions = options;
          return { mutateAsync: trpcState.activateMutateAsync, isPending: false };
        },
      },
    },
    player: {
      reconTarget: { useQuery: () => ({ data: trpcState.reconData }) },
      me: { useQuery: () => ({ data: trpcState.player }) },
      list: { useQuery: () => ({ data: trpcState.players }) },
    },
    useUtils: () => ({
      player: {
        me: { invalidate: trpcState.invalidate.playerMe },
        list: { invalidate: trpcState.invalidate.playerList },
        reconTarget: { invalidate: trpcState.invalidate.reconTarget },
      },
      powerUp: {
        inventory: { invalidate: trpcState.invalidate.inventory },
      },
      game: {
        leaderboard: { invalidate: trpcState.invalidate.leaderboard },
      },
      achievement: {
        playerList: { invalidate: trpcState.invalidate.achievementPlayerList },
      },
    }),
  },
}));

beforeEach(() => {
  trpcState.lastPurchaseOptions = null;
  trpcState.lastActivateOptions = null;
  trpcState.powerUps = [NON_TARGETED_POWER_UP];
  trpcState.inventory = [];
  trpcState.players = [];
  trpcState.player = { id: 1, points: 500, reservedPoints: 0, pendingDiscountPercent: null };
  trpcState.reconData = undefined;
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: ShopScreen } = await import("@/app/(tabs)/shop");

describe("ShopScreen: purchase flow", () => {
  it("web: accepting window.confirm invokes the purchase mutation exactly once", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    fireEvent.click(screen.getByText("Purchase"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.purchaseMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.purchaseMutateAsync).toHaveBeenCalledWith({ gameId: 5, powerUpId: 20 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the purchase mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(ShopScreen));

    fireEvent.click(screen.getByText("Purchase"));

    expect(trpcState.purchaseMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("rapid repeated purchase clicks invoke only one mutation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    const button = screen.getByText("Purchase");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.purchaseMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: invalidates player balance and inventory once, and shows the server-reported result", async () => {
    trpcState.purchaseMutateAsync.mockResolvedValue({ success: true, inventoryId: 999, cost: 200, status: "inventory" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("Purchase"));
    });
    act(() => trpcState.lastPurchaseOptions?.onSuccess?.({ success: true, inventoryId: 999, cost: 200, status: "inventory" }));

    expect(trpcState.invalidate.playerMe).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.inventory).toHaveBeenCalledTimes(1);
    // A purchase can immediately trigger an achievement server-side, so
    // the balance/badge-adjacent views need invalidating too.
    expect(trpcState.invalidate.playerList).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.leaderboard).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.achievementPlayerList).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Purchased for 200 pts/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: unlocks the button and shows the server's actual error message", async () => {
    trpcState.purchaseMutateAsync.mockRejectedValue(new Error("Not enough available points"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("Purchase"));
    });
    act(() => trpcState.lastPurchaseOptions?.onError?.({ message: "Not enough available points" }));

    expect(screen.getByText("Not enough available points")).toBeTruthy();
    const button = screen.getByText("Purchase").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    confirmSpy.mockRestore();
  });
});

describe("ShopScreen: activation flow", () => {
  it("web: accepting window.confirm invokes the activate mutation exactly once", async () => {
    trpcState.inventory = [NON_TARGETED_ITEM];
    trpcState.activateMutateAsync.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("Activate"));
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.activateMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.activateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 5, inventoryId: NON_TARGETED_ITEM.id }),
    );
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the activate mutation zero times", () => {
    trpcState.inventory = [NON_TARGETED_ITEM];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(ShopScreen));

    fireEvent.click(screen.getByText("Activate"));

    expect(trpcState.activateMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("repeated activation clicks cannot consume twice", () => {
    trpcState.inventory = [NON_TARGETED_ITEM];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    const button = screen.getByText("Activate");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.activateMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: invalidates inventory, balance, player list, and recon target once, and shows an inline success message", async () => {
    trpcState.inventory = [NON_TARGETED_ITEM];
    trpcState.activateMutateAsync.mockImplementation(async () => {
      trpcState.lastActivateOptions?.onSuccess?.({ success: true });
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("Activate"));
    });

    expect(trpcState.invalidate.inventory).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.playerMe).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.playerList).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.reconTarget).toHaveBeenCalledTimes(1);
    // Activation can also immediately trigger an achievement server-side.
    expect(trpcState.invalidate.leaderboard).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.achievementPlayerList).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Activated!/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: shows the server's actual error message inline and does not consume the item", async () => {
    trpcState.inventory = [NON_TARGETED_ITEM];
    trpcState.activateMutateAsync.mockImplementation(async () => {
      trpcState.lastActivateOptions?.onError?.({ message: "Your power-up inventory is currently frozen" });
      throw new Error("Your power-up inventory is currently frozen");
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(ShopScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("Activate"));
    });

    expect(screen.getByText("Your power-up inventory is currently frozen")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  // Validation must be visible on web without depending on Alert.alert --
  // Bounty is in TARGETED_POWER_UPS, so activating it with no target
  // selected must surface an inline message, not a dialog.
  it("shows required target validation inline, without opening any dialog or calling the mutation", () => {
    trpcState.inventory = [TARGETED_POWER_UP_ITEM];
    const confirmSpy = vi.spyOn(window, "confirm");
    render(React.createElement(ShopScreen));

    fireEvent.click(screen.getByText("Activate"));

    expect(screen.getByText("Select a player before activating this power-up.")).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(trpcState.activateMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
