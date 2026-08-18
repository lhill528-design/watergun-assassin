// @vitest-environment jsdom
//
// Real-render integration test for the production bug: creation success
// used to be reported through Alert.alert(), with navigation itself living
// inside that alert's button onPress -- which React Native Web does not
// reliably invoke, so the game got created server-side while the screen
// just sat there, and nothing stopped a second, duplicate submission.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent) -- what's
// real and unmocked here is CreateGameScreen itself and lib/game-creation.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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
    Alert: { alert: vi.fn() },
    Platform: { OS: "web" },
  };
});

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
  setActiveGameId: vi.fn(),
}));
vi.mock("@/lib/game-context", () => ({
  useGame: () => ({ activeGameId: null, setActiveGameId: gameContextState.setActiveGameId, isAdmin: false, setIsAdmin: vi.fn() }),
}));

const trpcState = vi.hoisted(() => ({
  mutate: vi.fn(),
  lastMutationOptions: null as null | { onSuccess?: (data: any) => void; onError?: (err: any) => void },
  invalidateMyGames: vi.fn(),
  invalidateAdminGames: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      create: {
        useMutation: (options: any) => {
          trpcState.lastMutationOptions = options;
          return { mutate: trpcState.mutate, isPending: false };
        },
      },
    },
    useUtils: () => ({
      game: {
        myGames: { invalidate: trpcState.invalidateMyGames },
        adminGames: { invalidate: trpcState.invalidateAdminGames },
      },
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  trpcState.lastMutationOptions = null;
});

const { default: CreateGameScreen } = await import("@/app/admin/create-game");

function typeGameName(name: string) {
  fireEvent.change(screen.getByLabelText("e.g., Summer Assassin 2025"), { target: { value: name } });
}

describe("CreateGameScreen", () => {
  it("on success: sets the active game, invalidates both list queries, and navigates via router.replace -- no Alert involved", () => {
    render(React.createElement(CreateGameScreen));
    typeGameName("Summer Assassin");
    fireEvent.click(screen.getByText("Create Game"));

    expect(trpcState.mutate).toHaveBeenCalledTimes(1);

    // Simulates the mutation completing -- exactly what useMutation's
    // onSuccess wiring does for real; no Alert.alert stands between this
    // and the effects below.
    act(() => trpcState.lastMutationOptions?.onSuccess?.({ gameId: 77 }));

    expect(gameContextState.setActiveGameId).toHaveBeenCalledWith(77);
    expect(trpcState.invalidateMyGames).toHaveBeenCalledTimes(1);
    expect(trpcState.invalidateAdminGames).toHaveBeenCalledTimes(1);
    expect(routerState.replace).toHaveBeenCalledWith("/admin/game-setup");
    expect(screen.getByText(/Game created/i)).toBeTruthy();
  });

  it("repeated clicks before the request settles call the mutation only once", () => {
    render(React.createElement(CreateGameScreen));
    typeGameName("Summer Assassin");

    const button = screen.getByText("Create Game");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // The mutation never resolves in this test (onSuccess/onError are
    // never invoked) -- proving the guard itself, not a lucky fast
    // resolution, is what blocked the repeats.
    expect(trpcState.mutate).toHaveBeenCalledTimes(1);
  });

  it("shows an inline error and does not navigate when the mutation fails", () => {
    render(React.createElement(CreateGameScreen));
    typeGameName("Summer Assassin");
    fireEvent.click(screen.getByText("Create Game"));

    act(() => trpcState.lastMutationOptions?.onError?.({ message: "Game name already in use" }));

    expect(screen.getByText("Game name already in use")).toBeTruthy();
    expect(routerState.replace).not.toHaveBeenCalled();
    expect(gameContextState.setActiveGameId).not.toHaveBeenCalled();
  });

  it("rejects a blank name locally without ever calling the mutation", () => {
    render(React.createElement(CreateGameScreen));
    fireEvent.click(screen.getByText("Create Game"));

    expect(trpcState.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Game name is required")).toBeTruthy();
  });
});
