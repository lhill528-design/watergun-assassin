// @vitest-environment jsdom
//
// Real-render integration test for the review correction: checkedTargetPin
// stored a checked location independently of player.list's ongoing
// visibility-safe result, so it could keep showing a player's old (or now
// -hidden) location after Blackout, Dead Zone, Witness Protection, target
// reassignment, or a game/round change. player.list must be the
// continuing authority; this proves the reconciliation, not just the
// happy path.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). GameMap
// itself is stubbed to a prop-capturing component -- its real Leaflet/
// WebView internals aren't what this test is about; see
// components/game-map-html.test.ts for that.
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
    TouchableOpacity: ({ onPress, disabled, children }: any) =>
      ReactActual.createElement("button", { onClick: onPress, disabled }, children),
    TextInput: ({ value, onChangeText, placeholder }: any) =>
      ReactActual.createElement("input", {
        "aria-label": placeholder,
        value,
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
    ActivityIndicator: () => ReactActual.createElement("span", null, "loading"),
    Modal: ({ visible, children }: any) => (visible ? ReactActual.createElement("div", null, children) : null),
    StyleSheet: { create: (styles: any) => styles },
    Alert: { alert: (...args: any[]) => alertState.alert(...args) },
    Platform: platformState,
  };
});

vi.mock("expo-haptics", () => ({
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));

vi.mock("@/lib/location-service", () => ({
  requestLocationPermissions: vi.fn(),
  getCurrentLocation: vi.fn(),
  startForegroundTracking: vi.fn(),
  stopBackgroundLocationTracking: vi.fn(),
}));

vi.mock("@/components/screen-container", () => ({
  ScreenContainer: (props: any) => React.createElement("div", null, props.children),
}));

const gameMapPropsRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/components/game-map", () => ({
  GameMap: (props: any) => {
    gameMapPropsRef.current = props;
    const ReactActual = require("react");
    return ReactActual.createElement(
      "div",
      { "data-testid": "game-map" },
      props.pins.map((p: any) =>
        ReactActual.createElement("span", { key: p.id, "data-testid": `pin-${p.id}` }, `${p.label}|${p.latitude}|${p.longitude}`),
      ),
    );
  },
}));

const gameContextState = vi.hoisted(() => ({ activeGameId: 5 }));
vi.mock("@/lib/game-context", () => ({
  useGame: () => ({ activeGameId: gameContextState.activeGameId, setActiveGameId: vi.fn(), isAdmin: false, setIsAdmin: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const trpcState = vi.hoisted(() => ({
  game: { id: 5, purgeActive: false, showLocationsDuringPurge: false } as any,
  players: [] as any[],
  myPlayer: { id: 1, userId: 101, targetId: 2 } as any,
  mapPowerUps: [] as any[],
  vendettaTarget: null as any,
  proximityData: [] as any[],
  checkLocationMutate: vi.fn(),
  lastCheckLocationOptions: null as null | { onSuccess?: (data: any, variables: any) => void; onError?: (err: any) => void },
  geocodingSearchFetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      get: { useQuery: () => ({ data: trpcState.game }) },
    },
    player: {
      list: { useQuery: () => ({ data: trpcState.players }) },
      me: { useQuery: () => ({ data: trpcState.myPlayer }) },
      vendettaTarget: { useQuery: () => ({ data: trpcState.vendettaTarget }) },
      updateLocation: { useMutation: () => ({ mutate: vi.fn() }) },
      disableLocation: { useMutation: (options: any) => ({ mutate: vi.fn(), ...options }) },
      checkLocation: {
        useMutation: (options: any) => {
          trpcState.lastCheckLocationOptions = options;
          return { mutate: trpcState.checkLocationMutate, isPending: false };
        },
      },
    },
    mapPowerUp: {
      list: { useQuery: () => ({ data: trpcState.mapPowerUps }) },
      checkProximity: { useQuery: () => ({ data: trpcState.proximityData }) },
      claim: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      submitGuess: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      geocoding: { search: { fetch: trpcState.geocodingSearchFetch } },
    }),
  },
}));

function alivePlayer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 2, userId: 202, status: "alive", targetId: null, kills: 0, points: 0,
    latitude: "29.760000", longitude: "-95.370000",
    user: { name: "Target Player" },
    ...overrides,
  };
}

beforeEach(() => {
  gameMapPropsRef.current = null;
  gameContextState.activeGameId = 5;
  trpcState.game = { id: 5, purgeActive: false, showLocationsDuringPurge: false };
  trpcState.myPlayer = { id: 1, userId: 101, targetId: 2 };
  trpcState.players = [alivePlayer()];
  trpcState.vendettaTarget = null;
  trpcState.mapPowerUps = [];
  trpcState.proximityData = [];
  trpcState.lastCheckLocationOptions = null;
  platformState.OS = "web";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: MapScreen } = await import("@/app/(tabs)/map");

function checkPlayer2Location() {
  fireEvent.click(screen.getByText("📍 Check Location"));
}

async function succeedCheck(latitude: string, longitude: string) {
  await act(async () => {
    trpcState.lastCheckLocationOptions?.onSuccess?.({ latitude, longitude }, { gameId: 5, targetPlayerId: 2 });
  });
}

describe("MapScreen: checked-location pin reconciliation", () => {
  it("a successful check adds the pin and focuses the map on it", async () => {
    render(React.createElement(MapScreen));
    checkPlayer2Location();
    await succeedCheck("29.760000", "-95.370000");

    expect(screen.getByTestId("pin-2")).toBeTruthy();
    expect(gameMapPropsRef.current.focusLocation).toEqual({ latitude: 29.76, longitude: -95.37 });
    expect(screen.getByText(/now focused on the map above/)).toBeTruthy();
  });

  it("a later player.list refresh returning null coordinates removes the pin and clears focus", async () => {
    const { rerender } = render(React.createElement(MapScreen));
    checkPlayer2Location();
    await succeedCheck("29.760000", "-95.370000");
    expect(screen.getByTestId("pin-2")).toBeTruthy();

    // Simulate player.list's periodic refetch landing with the target now
    // hidden (Blackout, Dead Zone, Witness Protection, etc.).
    trpcState.players = [alivePlayer({ latitude: null, longitude: null })];
    await act(async () => {
      rerender(React.createElement(MapScreen));
    });

    expect(screen.queryByTestId("pin-2")).toBeNull();
    expect(gameMapPropsRef.current.focusLocation).toBeNull();
  });

  it("target reassignment (the checked player is no longer the viewer's target) removes the pin", async () => {
    const { rerender } = render(React.createElement(MapScreen));
    checkPlayer2Location();
    await succeedCheck("29.760000", "-95.370000");
    expect(screen.getByTestId("pin-2")).toBeTruthy();

    // Player 2 is still visible/alive, but the viewer got reassigned to
    // target player 3 instead -- checking player 2 is no longer
    // authorized, so its pin must not linger.
    trpcState.myPlayer = { ...trpcState.myPlayer, targetId: 3 };
    await act(async () => {
      rerender(React.createElement(MapScreen));
    });

    expect(screen.queryByTestId("pin-2")).toBeNull();
  });

  it("changing the active game removes the pin and the check-location message", async () => {
    const { rerender } = render(React.createElement(MapScreen));
    checkPlayer2Location();
    await succeedCheck("29.760000", "-95.370000");
    expect(screen.getByTestId("pin-2")).toBeTruthy();
    expect(screen.getByText(/now focused on the map above/)).toBeTruthy();

    gameContextState.activeGameId = 9;
    trpcState.game = { id: 9, purgeActive: false, showLocationsDuringPurge: false };
    trpcState.players = [];
    await act(async () => {
      rerender(React.createElement(MapScreen));
    });

    expect(screen.queryByTestId("pin-2")).toBeNull();
    expect(screen.queryByText(/now focused on the map above/)).toBeNull();
  });

  it("a failed re-check clears the previous checked result (map focus) and shows the error inline", async () => {
    render(React.createElement(MapScreen));
    checkPlayer2Location();
    await succeedCheck("29.760000", "-95.370000");
    expect(gameMapPropsRef.current.focusLocation).toEqual({ latitude: 29.76, longitude: -95.37 });

    // Player 2 remains a genuinely valid, still-visible target throughout
    // this test (buildPins() keeps drawing their live pin regardless --
    // that's correct, not stale), so the observable effect of clearing
    // checkedTargetPin here is that the map focus it alone drives goes
    // away, and the success message is replaced by the failure.
    checkPlayer2Location();
    await act(async () => {
      trpcState.lastCheckLocationOptions?.onError?.(new Error("This player's location is currently hidden"));
    });

    expect(gameMapPropsRef.current.focusLocation).toBeNull();
    expect(screen.getByText("This player's location is currently hidden")).toBeTruthy();
    expect(screen.queryByText(/now focused on the map above/)).toBeNull();
  });
});
