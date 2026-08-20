// @vitest-environment jsdom
//
// Real-render integration test for the production finding: the create
// mutation itself wasn't Alert-gated, but validation, geocoding, backend,
// and success messages only ever appeared via Alert.alert -- so on web, a
// failed submission looked like nothing happened at all.
//
// react-native primitives are stubbed to their plain DOM equivalents (see
// components/sign-in-form.integration.test.tsx for precedent). What's real
// and unmocked here is AdminMapPowerUpsScreen itself.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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
    ActivityIndicator: () => ReactActual.createElement("span", null, "loading"),
    Switch: ({ value, onValueChange }: any) =>
      ReactActual.createElement("input", { type: "checkbox", checked: value, onChange: (e: any) => onValueChange?.(e.target.checked) }),
    StyleSheet: { create: (styles: any) => styles },
    Alert: { alert: (...args: any[]) => alertState.alert(...args) },
  };
});

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  reverseGeocodeAsync: vi.fn(),
  geocodeAsync: vi.fn(),
  Accuracy: { High: 1 },
}));

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
  mapPowerUps: [] as any[],
  powerUps: [{ id: 9, name: "Radar", emoji: "📡", effect: "reveals", isEnabled: true }] as any[],
  createMutateAsync: vi.fn(),
  invalidateMapPowerUpList: vi.fn(),
  geocodingSearchFetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mapPowerUp: {
      list: { useQuery: () => ({ data: trpcState.mapPowerUps }) },
      create: { useMutation: () => ({ mutateAsync: trpcState.createMutateAsync, isPending: false }) },
    },
    powerUp: {
      list: { useQuery: () => ({ data: trpcState.powerUps }) },
    },
    useUtils: () => ({
      mapPowerUp: { list: { invalidate: trpcState.invalidateMapPowerUpList } },
      geocoding: { search: { fetch: trpcState.geocodingSearchFetch } },
    }),
  },
}));

beforeEach(() => {
  trpcState.mapPowerUps = [];
  trpcState.powerUps = [{ id: 9, name: "Radar", emoji: "📡", effect: "reveals", isEnabled: true }];
  gameContextState.activeGameId = 5;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { default: AdminMapPowerUpsScreen } = await import("@/app/admin/map-powerups");

function openFormAndSelectPowerUp() {
  fireEvent.click(screen.getByText("+ Place New Power-Up"));
  fireEvent.click(screen.getByText("Radar"));
}

describe("AdminMapPowerUpsScreen: inline validation", () => {
  it("shows an inline error when no power-up is selected, without calling the mutation", async () => {
    render(React.createElement(AdminMapPowerUpsScreen));
    fireEvent.click(screen.getByText("+ Place New Power-Up"));

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(screen.getByText("Please select a power-up.")).toBeTruthy();
    expect(trpcState.createMutateAsync).not.toHaveBeenCalled();
    expect(alertState.alert).not.toHaveBeenCalled();
  });

  it("shows an inline error when no location is set", async () => {
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(screen.getByText("Please set a location for this power-up.")).toBeTruthy();
    expect(trpcState.createMutateAsync).not.toHaveBeenCalled();
  });

  it("rejects a latitude out of the -90..90 range inline", async () => {
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();
    fireEvent.change(screen.getByLabelText("e.g. 29.760427"), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText("e.g. -95.369804"), { target: { value: "10" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(screen.getByText("Latitude must be a number between -90 and 90.")).toBeTruthy();
    expect(trpcState.createMutateAsync).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric longitude inline", async () => {
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();
    fireEvent.change(screen.getByLabelText("e.g. 29.760427"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("e.g. -95.369804"), { target: { value: "abc" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(screen.getByText("Longitude must be a number between -180 and 180.")).toBeTruthy();
  });

  it("requires a clue for hidden power-ups", async () => {
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();
    fireEvent.change(screen.getByLabelText("e.g. 29.760427"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("e.g. -95.369804"), { target: { value: "10" } });
    // isVisible defaults to false in DEFAULT_FORM, so no need to toggle the switch.

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(screen.getByText("Hidden power-ups must have a clue for players.")).toBeTruthy();
    expect(trpcState.createMutateAsync).not.toHaveBeenCalled();
  });
});

describe("AdminMapPowerUpsScreen: address search", () => {
  it("populates latitude/longitude from the shared geocoding service and can submit successfully", async () => {
    trpcState.geocodingSearchFetch.mockResolvedValue({ displayName: "123 Main St, Houston, TX, USA", latitude: 29.76, longitude: -95.37 });
    trpcState.createMutateAsync.mockResolvedValue({ id: 123 });
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();

    fireEvent.change(screen.getByLabelText("Type an address, e.g. 123 Main St, Houston TX"), { target: { value: "123 Main St, Houston TX" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Find"));
    });

    expect(trpcState.geocodingSearchFetch).toHaveBeenCalledWith({ address: "123 Main St, Houston TX" });
    expect((screen.getByLabelText("e.g. 29.760427") as HTMLInputElement).value).toBe("29.760000");
    expect((screen.getByLabelText("e.g. -95.369804") as HTMLInputElement).value).toBe("-95.370000");

    fireEvent.change(screen.getByLabelText("Clue players must solve to find this power-up..."), { target: { value: "Near the fountain" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(trpcState.createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ latitude: "29.760000", longitude: "-95.370000" }));
  });

  it("shows the geocoding service's own error message inline when the address search fails", async () => {
    trpcState.geocodingSearchFetch.mockRejectedValue(new Error("Couldn't find that address. Try being more specific."));
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();

    fireEvent.change(screen.getByLabelText("Type an address, e.g. 123 Main St, Houston TX"), { target: { value: "nowhere at all" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Find"));
    });

    expect(screen.getByText("Couldn't find that address. Try being more specific.")).toBeTruthy();
  });
});

describe("AdminMapPowerUpsScreen: submission", () => {
  it("on success: invalidates mapPowerUp.list once, shows an inline success message, and resets/closes the form", async () => {
    trpcState.createMutateAsync.mockResolvedValue({ id: 123 });
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();
    fireEvent.change(screen.getByLabelText("e.g. 29.760427"), { target: { value: "29.76" } });
    fireEvent.change(screen.getByLabelText("e.g. -95.369804"), { target: { value: "-95.37" } });
    fireEvent.change(screen.getByLabelText("Clue players must solve to find this power-up..."), { target: { value: "Near the fountain" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(trpcState.createMutateAsync).toHaveBeenCalledWith({
      gameId: 5,
      powerUpId: 9,
      latitude: "29.76",
      longitude: "-95.37",
      isVisible: false,
      clue: "Near the fountain",
    });
    expect(trpcState.invalidateMapPowerUpList).toHaveBeenCalledWith({ gameId: 5 });
    expect(screen.getByText(/placed successfully/)).toBeTruthy();
    // Form closed and reset -- back to the "+ Place New Power-Up" button.
    expect(screen.getByText("+ Place New Power-Up")).toBeTruthy();
    expect(alertState.alert).not.toHaveBeenCalled();
  });

  it("on failure: shows the server's actual error message inline and keeps the form open (not reset)", async () => {
    trpcState.createMutateAsync.mockRejectedValue(new Error("Selected power-up does not belong to this game"));
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();
    fireEvent.change(screen.getByLabelText("e.g. 29.760427"), { target: { value: "29.76" } });
    fireEvent.change(screen.getByLabelText("e.g. -95.369804"), { target: { value: "-95.37" } });
    fireEvent.change(screen.getByLabelText("Clue players must solve to find this power-up..."), { target: { value: "Near the fountain" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Place Power-Up"));
    });

    expect(screen.getByText("Selected power-up does not belong to this game")).toBeTruthy();
    // Still open -- the power-up chip selection is still visible.
    expect(screen.getByText("New Map Power-Up")).toBeTruthy();
  });

  it("rapid repeated submits invoke only one mutation", async () => {
    let resolveCreate!: (value: unknown) => void;
    trpcState.createMutateAsync.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    render(React.createElement(AdminMapPowerUpsScreen));
    openFormAndSelectPowerUp();
    fireEvent.change(screen.getByLabelText("e.g. 29.760427"), { target: { value: "29.76" } });
    fireEvent.change(screen.getByLabelText("e.g. -95.369804"), { target: { value: "-95.37" } });
    fireEvent.change(screen.getByLabelText("Clue players must solve to find this power-up..."), { target: { value: "Near the fountain" } });

    const button = screen.getByText("Place Power-Up");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(trpcState.createMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({ id: 123 });
      await Promise.resolve();
    });
  });
});
