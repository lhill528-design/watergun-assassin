// Extracted out of create-game.tsx's onPress/onSuccess so the
// duplicate-submission guard, field parsing, and the post-creation
// sequencing are all exercised directly by tests, without rendering the
// full form or a real trpc/router stack.
//
// The production bug this replaces: creation success used to be reported
// via Alert.alert(), with navigation itself living inside that alert's
// button onPress. React Native Web does not reliably invoke Alert.alert's
// button callbacks (the same defect fixed for Sign Out in lib/sign-out.ts),
// so on web the game was created server-side while the screen just sat
// there -- and nothing stopped a confused admin from pressing Create again.

export type GameType = "last_man_standing" | "highest_points" | "most_eliminations" | "teams";

export interface GameCreationFormValues {
  name: string;
  gameType: GameType;
  entryFee: string;
  roundLength: string;
  safeObject: string;
  targetAssignment: "auto" | "manual";
  endCondition: string;
  showLocations: boolean;
  inheritTarget: boolean;
  startingPoints: string;
  eliminationPoints: string;
  locationPingInterval: string;
}

export interface GameCreateInput {
  name: string;
  gameType: GameType;
  entryFee: number;
  roundLength: number;
  safeObject?: string;
  targetAssignment: "auto" | "manual";
  endCondition?: string;
  showLocationsDuringPurge: boolean;
  inheritTarget: boolean;
  startingPoints: number;
  eliminationPoints: number;
  locationPingInterval: number;
}

// Converts the form's raw string state into the shape game.create expects
// -- pulled out of the component so parsing (parseInt fallbacks, trimming,
// blank-to-undefined) is covered without needing a name already known to
// be non-blank passed in twice.
export function buildGameCreateInput(values: GameCreationFormValues, trimmedName: string): GameCreateInput {
  return {
    name: trimmedName,
    gameType: values.gameType,
    entryFee: parseInt(values.entryFee) || 0,
    roundLength: parseInt(values.roundLength) || 72,
    safeObject: values.safeObject || undefined,
    targetAssignment: values.targetAssignment,
    endCondition: values.endCondition || undefined,
    showLocationsDuringPurge: values.showLocations,
    inheritTarget: values.inheritTarget,
    startingPoints: parseInt(values.startingPoints) || 0,
    eliminationPoints: parseInt(values.eliminationPoints) || 100,
    locationPingInterval: parseInt(values.locationPingInterval) || 15,
  };
}

export interface RequestGameCreationOptions {
  values: GameCreationFormValues;
  // Whether a create request is already in flight -- checked up front
  // (and expected to be backed by a ref, not just React state, so a
  // second tap that lands before a re-render still gets blocked) so
  // rapid/repeated clicks can't call createGame() more than once.
  isSubmitting: boolean;
  onSubmittingChange: (submitting: boolean) => void;
  createGame: (input: GameCreateInput) => void;
  onValidationError: (message: string) => void;
}

export function requestGameCreation(options: RequestGameCreationOptions): void {
  if (options.isSubmitting) return;

  const name = options.values.name.trim();
  if (!name) {
    options.onValidationError("Game name is required");
    return;
  }

  options.onSubmittingChange(true);
  options.createGame(buildGameCreateInput(options.values, name));
}

export interface GameCreatedDeps {
  gameId: number;
  setActiveGameId: (id: number) => void;
  invalidateMyGames: () => void;
  invalidateAdminGames: () => void;
  navigateToGameSetup: () => void;
}

// Runs entirely on the mutation's onSuccess callback -- no Alert, no
// button press required to reach the new game's setup screen.
export function handleGameCreated(deps: GameCreatedDeps): void {
  deps.setActiveGameId(deps.gameId);
  deps.invalidateMyGames();
  deps.invalidateAdminGames();
  deps.navigateToGameSetup();
}
