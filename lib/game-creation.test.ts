import { describe, expect, it, vi } from "vitest";
import { buildGameCreateInput, handleGameCreated, requestGameCreation, type GameCreationFormValues } from "./game-creation";

function values(overrides: Partial<GameCreationFormValues> = {}): GameCreationFormValues {
  return {
    name: "Summer Assassin",
    gameType: "last_man_standing",
    entryFee: "0",
    roundLength: "72",
    safeObject: "",
    targetAssignment: "auto",
    endCondition: "",
    showLocations: true,
    inheritTarget: true,
    startingPoints: "100",
    eliminationPoints: "100",
    locationPingInterval: "15",
    ...overrides,
  };
}

describe("buildGameCreateInput", () => {
  it("parses numeric fields and falls back on invalid input", () => {
    const input = buildGameCreateInput(values({ entryFee: "abc", roundLength: "", startingPoints: "50" }), "Trimmed Name");
    expect(input.name).toBe("Trimmed Name");
    expect(input.entryFee).toBe(0);
    expect(input.roundLength).toBe(72);
    expect(input.startingPoints).toBe(50);
  });

  it("omits blank optional text fields instead of sending empty strings", () => {
    const input = buildGameCreateInput(values({ safeObject: "", endCondition: "" }), "Name");
    expect(input.safeObject).toBeUndefined();
    expect(input.endCondition).toBeUndefined();
  });
});

describe("requestGameCreation", () => {
  it("rejects a blank name without ever calling createGame", () => {
    const createGame = vi.fn();
    const onValidationError = vi.fn();
    const onSubmittingChange = vi.fn();

    requestGameCreation({
      values: values({ name: "   " }),
      isSubmitting: false,
      onSubmittingChange,
      createGame,
      onValidationError,
    });

    expect(onValidationError).toHaveBeenCalledWith("Game name is required");
    expect(createGame).not.toHaveBeenCalled();
    expect(onSubmittingChange).not.toHaveBeenCalled();
  });

  it("calls createGame exactly once with the trimmed name, and marks submitting", () => {
    const createGame = vi.fn();
    const onSubmittingChange = vi.fn();

    requestGameCreation({
      values: values({ name: "  Summer Assassin  " }),
      isSubmitting: false,
      onSubmittingChange,
      createGame,
      onValidationError: vi.fn(),
    });

    expect(onSubmittingChange).toHaveBeenCalledWith(true);
    expect(createGame).toHaveBeenCalledTimes(1);
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({ name: "Summer Assassin" }));
  });

  // The exact scenario a fast double-click/tap produces: a caller backing
  // `isSubmitting` with a synchronous ref (not just React state) means the
  // guard sees the up-to-date value immediately, even before a re-render.
  it("does nothing on a repeated call while a request is already in flight", () => {
    const createGame = vi.fn();
    const onSubmittingChange = vi.fn();

    const options = { values: values(), onSubmittingChange, createGame, onValidationError: vi.fn() };
    requestGameCreation({ ...options, isSubmitting: false });
    requestGameCreation({ ...options, isSubmitting: true }); // simulates the guard already flipped on
    requestGameCreation({ ...options, isSubmitting: true });

    expect(createGame).toHaveBeenCalledTimes(1);
  });
});

describe("handleGameCreated", () => {
  it("sets the active game, invalidates both game list queries, and navigates -- no Alert involved", () => {
    const setActiveGameId = vi.fn();
    const invalidateMyGames = vi.fn();
    const invalidateAdminGames = vi.fn();
    const navigateToGameSetup = vi.fn();

    handleGameCreated({ gameId: 42, setActiveGameId, invalidateMyGames, invalidateAdminGames, navigateToGameSetup });

    expect(setActiveGameId).toHaveBeenCalledWith(42);
    expect(invalidateMyGames).toHaveBeenCalledTimes(1);
    expect(invalidateAdminGames).toHaveBeenCalledTimes(1);
    expect(navigateToGameSetup).toHaveBeenCalledTimes(1);
  });
});
