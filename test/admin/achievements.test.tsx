// @vitest-environment jsdom
//
// Real-render integration test for the production bug: "Load All 52"
// only ever called seedAll's mutate() from inside an Alert.alert button's
// onPress, which React Native Web does not reliably invoke -- so on web,
// confirming could silently seed nothing.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is AdminAchievementsScreen itself and
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
  achievements: [] as any[],
  createMutateAsync: vi.fn(),
  seedMutateAsync: vi.fn(),
  lastSeedOptions: null as any,
  invalidateAchievementList: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    achievement: {
      list: { useQuery: () => ({ data: trpcState.achievements }) },
      create: { useMutation: () => ({ mutateAsync: trpcState.createMutateAsync, isPending: false }) },
      seedAll: {
        useMutation: (options: any) => {
          trpcState.lastSeedOptions = options;
          return { mutateAsync: trpcState.seedMutateAsync, isPending: false };
        },
      },
    },
    useUtils: () => ({
      achievement: { list: { invalidate: trpcState.invalidateAchievementList } },
    }),
  },
}));

beforeEach(() => {
  trpcState.achievements = [];
  trpcState.lastSeedOptions = null;
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: AdminAchievementsScreen } = await import("@/app/admin/achievements");

describe("AdminAchievementsScreen: Load All 52", () => {
  it("web: accepting window.confirm invokes the seed mutation exactly once", () => {
    trpcState.seedMutateAsync.mockResolvedValue({ created: 52, skipped: 0, total: 52 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminAchievementsScreen));

    fireEvent.click(screen.getByText(/Load All 52/));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledWith({ gameId: 5 });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the seed mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(AdminAchievementsScreen));

    fireEvent.click(screen.getByText(/Load All 52/));

    expect(trpcState.seedMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("repeated clicks before the request settles invoke only one seed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminAchievementsScreen));

    const button = screen.getByText(/Load All 52/);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.seedMutateAsync).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("on success: invalidates achievement.list once and shows a count derived from skips too (idempotent seeding surfaced honestly)", async () => {
    trpcState.seedMutateAsync.mockResolvedValue({ created: 0, skipped: 52, total: 52 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminAchievementsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/Load All 52/));
    });
    act(() => trpcState.lastSeedOptions?.onSuccess?.({ created: 0, skipped: 52, total: 52 }));

    expect(trpcState.invalidateAchievementList).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText(/already loaded/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("on failure: shows the server's actual error message inline", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AdminAchievementsScreen));

    await act(async () => {
      fireEvent.click(screen.getByText(/Load All 52/));
    });
    act(() => trpcState.lastSeedOptions?.onError?.({ message: "Admin access required" }));

    expect(screen.getByText("Admin access required")).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe("AdminAchievementsScreen: custom creation", () => {
  it("shows an inline validation error and does not call the mutation when name is blank", async () => {
    render(React.createElement(AdminAchievementsScreen));
    fireEvent.click(screen.getByText("+ Custom"));

    await act(async () => {
      fireEvent.click(screen.getByText("Create Achievement"));
    });

    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(trpcState.createMutateAsync).not.toHaveBeenCalled();
  });

  it("shows the backend error inline when creation fails", async () => {
    trpcState.createMutateAsync.mockRejectedValue(new Error("Admin access required"));
    render(React.createElement(AdminAchievementsScreen));
    fireEvent.click(screen.getByText("+ Custom"));
    fireEvent.change(screen.getByLabelText("Badge Name"), { target: { value: "Test Badge" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Create Achievement"));
    });

    expect(screen.getByText("Admin access required")).toBeTruthy();
  });
});
