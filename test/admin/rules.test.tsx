// @vitest-environment jsdom
//
// Real-render integration test for the production bug: "Load Standard
// Rules" only ever called createRule.mutate() (once per rule, via
// forEach) from inside an Alert.alert button's onPress, which React
// Native Web does not reliably invoke -- so on web, confirming could
// silently load zero rules.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is AdminRulesScreen itself and lib/confirm-then-run.
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
  gameData: { id: 5, gameType: "last_man_standing" } as { id: number; gameType: string } | undefined,
  rules: [] as Array<{ id: number; ruleText: string; isEnabled: boolean; isStandard: boolean }>,
  seedMutateAsync: vi.fn(),
  lastSeedOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  invalidateRulesList: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: { get: { useQuery: () => ({ data: trpcState.gameData }) } },
    rules: {
      list: { useQuery: () => ({ data: trpcState.rules }) },
      create: { useMutation: (options: any) => ({ mutate: trpcState.createMutate, isPending: false }) },
      update: { useMutation: (options: any) => ({ mutate: trpcState.updateMutate, isPending: false }) },
      seedStandard: {
        useMutation: (options: any) => {
          trpcState.lastSeedOptions = options;
          return { mutateAsync: trpcState.seedMutateAsync, isPending: false };
        },
      },
    },
    useUtils: () => ({
      rules: { list: { invalidate: trpcState.invalidateRulesList } },
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  trpcState.lastSeedOptions = null;
  trpcState.gameData = { id: 5, gameType: "last_man_standing" };
  trpcState.rules = [];
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

const { default: AdminRulesScreen } = await import("@/app/admin/rules");

describe("AdminRulesScreen: Load Standard Rules", () => {
  it("web: accepting window.confirm invokes the seed mutation exactly once", () => {
    trpcState.seedMutateAsync.mockResolvedValue({ created: 8, skipped: 0, total: 8 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminRulesScreen));

    fireEvent.click(screen.getByText("📋 Load Standard Rules"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledWith({ gameId: 5 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the seed mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminRulesScreen));

    fireEvent.click(screen.getByText("📋 Load Standard Rules"));

    expect(trpcState.seedMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("native: pressing the confirm button still invokes the seed mutation", async () => {
    platformState.OS = "ios";
    trpcState.seedMutateAsync.mockResolvedValue({ created: 8, skipped: 0, total: 8 });
    alertState.alert.mockImplementation((_title: string, _message: string, buttons: any[]) => {
      const confirm = buttons?.find((button) => button.text === "Add All");
      confirm?.onPress?.();
    });
    render(React.createElement(AdminRulesScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📋 Load Standard Rules"));
    });

    expect(alertState.alert).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("repeated clicks before the request settles invoke only one seed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminRulesScreen));

    const button = screen.getByText("📋 Load Standard Rules");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // The mutation never resolves in this test -- proving the guard
    // itself, not a lucky fast resolution, blocked the repeats. Also
    // proves window.confirm wasn't re-opened while already running.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: refetches rules.list once and shows an inline count from the server response", async () => {
    trpcState.seedMutateAsync.mockResolvedValue({ created: 5, skipped: 3, total: 8 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminRulesScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📋 Load Standard Rules"));
    });
    act(() => trpcState.lastSeedOptions?.onSuccess?.({ created: 5, skipped: 3, total: 8 }));

    expect(trpcState.invalidateRulesList).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidateRulesList).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText(/Added 5 standard rules/)).toBeTruthy();
    expect(screen.getByText(/3 already loaded/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: unlocks the button and displays the server's actual error message", async () => {
    trpcState.seedMutateAsync.mockRejectedValue(new Error("boom"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminRulesScreen));

    await act(async () => {
      fireEvent.click(screen.getByText("📋 Load Standard Rules"));
    });
    act(() => trpcState.lastSeedOptions?.onError?.({ message: "Admin access required" }));

    expect(screen.getByText("Admin access required")).toBeTruthy();
    const button = screen.getByText(/Load Standard Rules/).closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    confirmSpy.mockRestore();
  });
});
