// @vitest-environment jsdom
//
// Real-render integration test for the production bug: "Load All 44
// Power-Ups" only ever called powerUp.seedAll's mutate() from inside an
// Alert.alert button's onPress, which React Native Web does not reliably
// invoke -- so on web, confirming could silently seed nothing.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is AdminPowerUpsScreen itself and lib/confirm-then-run.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  powerUps: [] as Array<{ id: number; name: string; isEnabled: boolean }>,
  pendingFees: [] as Array<{ id: number; status: string }>,
  seedMutateAsync: vi.fn(),
  lastSeedOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  resolveFeeMutate: vi.fn(),
  invalidatePowerUpList: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    powerUp: {
      list: { useQuery: () => ({ data: trpcState.powerUps }) },
      pendingFees: { useQuery: () => ({ data: trpcState.pendingFees }) },
      create: { useMutation: () => ({ mutate: trpcState.createMutate, isPending: false }) },
      update: { useMutation: () => ({ mutate: trpcState.updateMutate, isPending: false }) },
      resolveFee: { useMutation: () => ({ mutate: trpcState.resolveFeeMutate, isPending: false }) },
      seedAll: {
        useMutation: (options: any) => {
          trpcState.lastSeedOptions = options;
          return { mutateAsync: trpcState.seedMutateAsync, isPending: false };
        },
      },
    },
    useUtils: () => ({
      powerUp: { list: { invalidate: trpcState.invalidatePowerUpList } },
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  trpcState.lastSeedOptions = null;
  trpcState.powerUps = [];
  trpcState.pendingFees = [];
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

const { default: AdminPowerUpsScreen } = await import("@/app/admin/power-ups");

describe("AdminPowerUpsScreen: Load All 44", () => {
  it("web: accepting window.confirm invokes the seed mutation exactly once", () => {
    trpcState.seedMutateAsync.mockResolvedValue({ count: 44, ids: [] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminPowerUpsScreen));

    fireEvent.click(screen.getByText("📦 Load All 44"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledWith({ gameId: 5 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the seed mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminPowerUpsScreen));

    fireEvent.click(screen.getByText("📦 Load All 44"));

    expect(trpcState.seedMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("native: pressing the confirm button still invokes the seed mutation", async () => {
    platformState.OS = "ios";
    trpcState.seedMutateAsync.mockResolvedValue({ count: 44, ids: [] });
    alertState.alert.mockImplementation((_title: string, _message: string, buttons: any[]) => {
      const confirm = buttons?.find((button) => button.text === "Load All");
      confirm?.onPress?.();
    });
    render(React.createElement(AdminPowerUpsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📦 Load All 44"));
    });

    expect(alertState.alert).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("repeated clicks before the request settles invoke only one seed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminPowerUpsScreen));

    const button = screen.getByText("📦 Load All 44");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: refetches powerUp.list once and shows an inline count taken from the server response, not hard-coded", async () => {
    trpcState.seedMutateAsync.mockResolvedValue({ count: 44, ids: [] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminPowerUpsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📦 Load All 44"));
    });
    act(() => trpcState.lastSeedOptions?.onSuccess?.({ count: 44, ids: [] }));

    expect(trpcState.invalidatePowerUpList).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidatePowerUpList).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText("Loaded 44 power-ups from the full catalog.")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  // Proves the count is read from the response, not baked into the UI
  // string -- a different server-reported number renders as that number.
  it("reports whatever count the server actually returns", async () => {
    trpcState.seedMutateAsync.mockResolvedValue({ count: 12, ids: [] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminPowerUpsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📦 Load All 44"));
    });
    act(() => trpcState.lastSeedOptions?.onSuccess?.({ count: 12, ids: [] }));

    expect(screen.getByText("Loaded 12 power-ups from the full catalog.")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: unlocks the button and displays the server's actual error message", async () => {
    trpcState.seedMutateAsync.mockRejectedValue(new Error("boom"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminPowerUpsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📦 Load All 44"));
    });
    act(() => trpcState.lastSeedOptions?.onError?.({ message: "Admin access required" }));

    expect(screen.getByText("Admin access required")).toBeTruthy();
    const button = screen.getByText(/Load All 44/).closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    confirmSpy.mockRestore();
  });
});
