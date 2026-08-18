// @vitest-environment jsdom
//
// Real-render integration test for the production bug: the "final
// confirmation" before a permanent delete used to live entirely inside an
// Alert.alert() destructive button's onPress, which React Native Web does
// not reliably invoke -- so on web, confirming the delete could silently
// call trpc.game.delete.useMutation's mutate zero times.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is DeleteGameScreen itself and lib/game-deletion.
// DeleteGameScreen calls requestGameDeletion() without overriding
// isWeb/confirmWeb/alertNative, so it always uses the library's own
// defaults (window.confirm / the real Alert.alert) -- this test stubs
// window.confirm directly and controls the mocked Platform.OS per test,
// the same seams a real browser/device would provide.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const platformState = vi.hoisted(() => ({ OS: "web" as string }));
vi.mock("react-native", () => {
  const ReactActual = require("react");
  return {
    View: (props: any) => ReactActual.createElement("div", null, props.children),
    Text: (props: any) => ReactActual.createElement("span", null, props.children),
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

const alertState = vi.hoisted(() => ({ alert: vi.fn() }));

vi.mock("@/components/screen-container", () => ({
  ScreenContainer: (props: any) => React.createElement("div", null, props.children),
}));

const routerState = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => routerState,
}));

const gameContextState = vi.hoisted(() => ({
  activeGameId: 5,
  setActiveGameId: vi.fn(),
}));
vi.mock("@/lib/game-context", () => ({
  useGame: () => ({ activeGameId: gameContextState.activeGameId, setActiveGameId: gameContextState.setActiveGameId, isAdmin: false, setIsAdmin: vi.fn() }),
}));

const trpcState = vi.hoisted(() => ({
  gameData: { id: 5, name: "Summer Assassin" } as { id: number; name: string } | undefined,
  mutateAsync: vi.fn(),
  lastMutationOptions: null as null | { onSuccess?: () => void; onError?: (err: any) => void },
  invalidate: {
    myGames: vi.fn(),
    adminGames: vi.fn(),
    history: vi.fn(),
    get: vi.fn(),
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      get: { useQuery: () => ({ data: trpcState.gameData }) },
      delete: {
        useMutation: (options: any) => {
          trpcState.lastMutationOptions = options;
          return { mutateAsync: trpcState.mutateAsync, isPending: false };
        },
      },
    },
    useUtils: () => ({
      game: {
        myGames: { invalidate: trpcState.invalidate.myGames },
        adminGames: { invalidate: trpcState.invalidate.adminGames },
        history: { invalidate: trpcState.invalidate.history },
        get: { invalidate: trpcState.invalidate.get },
      },
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  trpcState.lastMutationOptions = null;
  trpcState.gameData = { id: 5, name: "Summer Assassin" };
  gameContextState.activeGameId = 5;
  platformState.OS = "web";
});

const { default: DeleteGameScreen } = await import("@/app/admin/delete-game");

function typeConfirmationName(name: string) {
  fireEvent.change(screen.getByLabelText("Exact game name"), { target: { value: name } });
}

describe("DeleteGameScreen", () => {
  it("web: accepting window.confirm invokes the mutation exactly once, with the confirmation name trimmed", async () => {
    trpcState.mutateAsync.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(DeleteGameScreen));

    typeConfirmationName("  Summer Assassin  ");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Game Permanently" }));
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.mutateAsync).toHaveBeenCalledTimes(1);
    expect(trpcState.mutateAsync).toHaveBeenCalledWith({ gameId: 5, confirmationName: "Summer Assassin" });
    confirmSpy.mockRestore();
  });

  it("web: cancelling window.confirm invokes the mutation zero times", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(DeleteGameScreen));

    typeConfirmationName("Summer Assassin");
    fireEvent.click(screen.getByRole("button", { name: "Delete Game Permanently" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trpcState.mutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("native: pressing the destructive confirmation button still invokes deletion", async () => {
    platformState.OS = "ios";
    trpcState.mutateAsync.mockResolvedValue(undefined);
    alertState.alert.mockImplementation((_title: string, _message: string, buttons: any[]) => {
      const destructive = buttons?.find((button) => button.style === "destructive");
      destructive?.onPress?.();
    });
    render(React.createElement(DeleteGameScreen));

    typeConfirmationName("Summer Assassin");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Game Permanently" }));
    });

    expect(alertState.alert).toHaveBeenCalledTimes(1);
    expect(trpcState.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("on success: clears activeGameId, invalidates myGames/adminGames/history/get for the deleted id, and navigates to profile", async () => {
    trpcState.mutateAsync.mockImplementation(async () => {
      trpcState.lastMutationOptions?.onSuccess?.();
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(DeleteGameScreen));

    typeConfirmationName("Summer Assassin");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Game Permanently" }));
    });

    expect(gameContextState.setActiveGameId).toHaveBeenCalledWith(null);
    expect(trpcState.invalidate.myGames).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.adminGames).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.history).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidate.get).toHaveBeenCalledWith({ gameId: 5 });
    expect(routerState.replace).toHaveBeenCalledWith("/(tabs)/profile");
    confirmSpy.mockRestore();
  });

  it("on failure: shows the actual server error inline and does not navigate", async () => {
    trpcState.mutateAsync.mockImplementation(async () => {
      trpcState.lastMutationOptions?.onError?.({ message: "Only the game's admin can delete it" });
      throw new Error("Only the game's admin can delete it");
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(DeleteGameScreen));

    typeConfirmationName("Summer Assassin");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Game Permanently" }));
    });

    expect(screen.getByText("Only the game's admin can delete it")).toBeTruthy();
    expect(routerState.replace).not.toHaveBeenCalled();
    expect(gameContextState.setActiveGameId).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("the delete button stays disabled (via !matches) until the typed name matches exactly", () => {
    render(React.createElement(DeleteGameScreen));
    const button = screen.getByRole("button", { name: "Delete Game Permanently" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    typeConfirmationName("wrong name");
    expect(button.disabled).toBe(true);

    typeConfirmationName("Summer Assassin");
    expect(button.disabled).toBe(false);
  });
});
