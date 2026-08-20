import { beforeEach, describe, expect, it, vi } from "vitest";

// Router-level coverage for player.checkLocation and player.list's use of
// the shared db.computeEffectiveLocations pipeline (server/db.ts). Mocks
// ./db so the real router logic runs, with computeEffectiveLocations
// itself mocked to a canned result -- its actual transformation logic
// (Decoy, Doppelganger, Blackout, ...) is covered directly in
// server/db-effective-locations.test.ts. This file proves: checkLocation
// never falls back to reading raw target.latitude/longitude for a
// non-admin viewer, authorization/hidden-target rejections still work,
// admin bypass still returns raw coordinates, and Radar Detector still
// fires its notification.
const mockGetGame = vi.fn();
const mockGetPlayerInGame = vi.fn();
const mockGetPlayerById = vi.fn();
const mockGetActivePowerUpByName = vi.fn();
const mockExpirePlayerPowerUps = vi.fn();
const mockGetGamePlayers = vi.fn();
const mockComputeEffectiveLocations = vi.fn();
const mockCreateNotification = vi.fn();
const mockGetPlayerPowerUps = vi.fn();

vi.mock("./db", () => ({
  getGame: (...args: unknown[]) => mockGetGame(...args),
  getPlayerInGame: (...args: unknown[]) => mockGetPlayerInGame(...args),
  getPlayerById: (...args: unknown[]) => mockGetPlayerById(...args),
  getActivePowerUpByName: (...args: unknown[]) => mockGetActivePowerUpByName(...args),
  expirePlayerPowerUps: (...args: unknown[]) => mockExpirePlayerPowerUps(...args),
  getGamePlayers: (...args: unknown[]) => mockGetGamePlayers(...args),
  computeEffectiveLocations: (...args: unknown[]) => mockComputeEffectiveLocations(...args),
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
  getPlayerPowerUps: (...args: unknown[]) => mockGetPlayerPowerUps(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number, isSuperAdmin = false) {
  return { req: {} as never, res: {} as never, user: { id: userId, isSuperAdmin } as never, authError: null };
}

const BASE_GAME = { id: 1, adminId: 7, purgeActive: false, showLocationsDuringPurge: false };
const VIEWER = { id: 1, userId: 42, targetId: 2 };
const TARGET = { id: 2, gameId: 1, userId: 43, latitude: "37.700000", longitude: "-122.400000" };

describe("player.checkLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockGetPlayerInGame.mockResolvedValue(VIEWER);
    mockGetPlayerById.mockResolvedValue(TARGET);
    mockGetActivePowerUpByName.mockResolvedValue(undefined); // no Radar/Vendetta/Radar Detector by default
    mockGetGamePlayers.mockResolvedValue([VIEWER, TARGET]);
    mockComputeEffectiveLocations.mockResolvedValue({
      hiddenIds: new Set<number>(),
      canSeeAll: false,
      locationsByPlayerId: new Map([[2, { latitude: "37.700000", longitude: "-122.400000" }]]),
      sanctuaryZonesByPlayerId: new Map(),
    });
  });

  it("rejects checking a non-target player without Radar/Purge", async () => {
    mockGetPlayerInGame.mockResolvedValue({ ...VIEWER, targetId: 999 }); // target 2 isn't the viewer's target
    const caller = appRouter.createCaller(makeCtx(50));
    await expect(caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 })).rejects.toThrow("only check your current target's location");
    expect(mockComputeEffectiveLocations).not.toHaveBeenCalled();
  });

  it("returns the effective (pipeline) coordinates for a normal target check, not raw target.latitude/longitude", async () => {
    mockComputeEffectiveLocations.mockResolvedValue({
      hiddenIds: new Set<number>(),
      canSeeAll: false,
      locationsByPlayerId: new Map([[2, { latitude: "9.999999", longitude: "9.999999" }]]), // decoy'd, differs from TARGET's raw row
      sanctuaryZonesByPlayerId: new Map(),
    });
    const caller = appRouter.createCaller(makeCtx(50));
    const result = await caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 });

    expect(result).toEqual({ latitude: "9.999999", longitude: "9.999999" });
    expect(mockExpirePlayerPowerUps).toHaveBeenCalledWith(1);
    expect(mockComputeEffectiveLocations).toHaveBeenCalledWith(1, [VIEWER, TARGET], VIEWER, { purgeActive: false, showLocationsDuringPurge: false });
  });

  it("rejects when the pipeline reports the target as hidden (Blackout, Dead Zone, etc.), never falling back to raw coordinates", async () => {
    mockComputeEffectiveLocations.mockResolvedValue({
      hiddenIds: new Set<number>([2]),
      canSeeAll: false,
      locationsByPlayerId: new Map([[2, { latitude: null, longitude: null }]]),
      sanctuaryZonesByPlayerId: new Map(),
    });
    const caller = appRouter.createCaller(makeCtx(50));
    await expect(caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 })).rejects.toThrow("currently hidden");
  });

  it("bypasses the pipeline entirely for the game's admin, returning raw coordinates", async () => {
    const caller = appRouter.createCaller(makeCtx(7)); // game.adminId
    const result = await caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 });

    expect(result).toEqual({ latitude: "37.700000", longitude: "-122.400000" });
    expect(mockComputeEffectiveLocations).not.toHaveBeenCalled();
  });

  it("bypasses the pipeline for a super admin who isn't this game's own admin", async () => {
    const caller = appRouter.createCaller(makeCtx(999, true));
    const result = await caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 });

    expect(result).toEqual({ latitude: "37.700000", longitude: "-122.400000" });
    expect(mockComputeEffectiveLocations).not.toHaveBeenCalled();
  });

  it("still notifies the target when they have an active Radar Detector, using the effective coordinates already computed", async () => {
    mockGetActivePowerUpByName.mockImplementation(async (_playerId: number, name: string) => (name === "Radar Detector" ? { id: 1 } : undefined));
    const caller = appRouter.createCaller(makeCtx(50));
    await caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 });

    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: TARGET.userId, title: "📟 Someone Checked Your Location" }));
  });

  it("allows checking any player's location during a purge with showLocationsDuringPurge, via canSeeAll", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, purgeActive: true, showLocationsDuringPurge: true });
    mockGetPlayerInGame.mockResolvedValue({ ...VIEWER, targetId: 999 }); // target 2 isn't the direct target
    const caller = appRouter.createCaller(makeCtx(50));
    await expect(caller.player.checkLocation({ gameId: 1, targetPlayerId: 2 })).resolves.toEqual({ latitude: "37.700000", longitude: "-122.400000" });
  });
});

describe("player.list uses the same computeEffectiveLocations pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockGetGamePlayers.mockResolvedValue([VIEWER, TARGET]);
    mockExpirePlayerPowerUps.mockResolvedValue(undefined);
    mockGetPlayerPowerUps.mockResolvedValue([]);
    mockComputeEffectiveLocations.mockResolvedValue({
      hiddenIds: new Set<number>(),
      canSeeAll: false,
      locationsByPlayerId: new Map([
        [1, { latitude: null, longitude: null }],
        [2, { latitude: "9.999999", longitude: "9.999999" }],
      ]),
      sanctuaryZonesByPlayerId: new Map(),
    });
  });

  it("applies the pipeline's effective coordinates to the returned player list for a non-admin viewer", async () => {
    const caller = appRouter.createCaller(makeCtx(42)); // matches VIEWER.userId, not the game admin
    const result = await caller.player.list({ gameId: 1 });

    const target = (result as any[]).find((p) => p.id === 2);
    expect(target.latitude).toBe("9.999999");
    expect(target.longitude).toBe("9.999999");
    expect(mockComputeEffectiveLocations).toHaveBeenCalledWith(1, [VIEWER, TARGET], VIEWER, { purgeActive: false, showLocationsDuringPurge: false });
  });
});
