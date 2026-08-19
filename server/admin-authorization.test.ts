import { beforeEach, describe, expect, it, vi } from "vitest";

// Router-level authorization coverage for player.update (previously had
// no auth check at all), achievement.create/award/seedAll, and
// mapPowerUp.create's coordinate/cross-game validation. Mirrors
// server/rules-authorization.test.ts's approach: mock ./db, then drive
// the real router logic through appRouter.createCaller().
const mockGetPlayerById = vi.fn();
const mockGetGame = vi.fn();
const mockUpdatePlayer = vi.fn();
const mockCreateAchievement = vi.fn();
const mockAwardAchievement = vi.fn();
const mockGetGameAchievements = vi.fn();
const mockSeedAchievements = vi.fn();
const mockCreateKillFeedEvent = vi.fn();
const mockGetGamePowerUps = vi.fn();
const mockCreateMapPowerUp = vi.fn();

vi.mock("./db", () => ({
  getPlayerById: (...args: unknown[]) => mockGetPlayerById(...args),
  getGame: (...args: unknown[]) => mockGetGame(...args),
  updatePlayer: (...args: unknown[]) => mockUpdatePlayer(...args),
  createAchievement: (...args: unknown[]) => mockCreateAchievement(...args),
  awardAchievement: (...args: unknown[]) => mockAwardAchievement(...args),
  getGameAchievements: (...args: unknown[]) => mockGetGameAchievements(...args),
  seedAchievements: (...args: unknown[]) => mockSeedAchievements(...args),
  createKillFeedEvent: (...args: unknown[]) => mockCreateKillFeedEvent(...args),
  getGamePowerUps: (...args: unknown[]) => mockGetGamePowerUps(...args),
  createMapPowerUp: (...args: unknown[]) => mockCreateMapPowerUp(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number, isSuperAdmin = false) {
  return { req: {} as never, res: {} as never, user: { id: userId, isSuperAdmin } as never, authError: null };
}

const BASE_GAME = { id: 1, adminId: 7 };

describe("player.update authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerById.mockResolvedValue({ id: 5, gameId: 1, userId: 42 });
    mockGetGame.mockResolvedValue(BASE_GAME);
  });

  it("rejects a user who is not this player's game admin", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.player.update({ playerId: 5, status: "eliminated" })).rejects.toThrow("Admin access required");
    expect(mockUpdatePlayer).not.toHaveBeenCalled();
  });

  it("allows the owning game's admin", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.player.update({ playerId: 5, status: "eliminated" })).resolves.toEqual({ success: true });
    expect(mockUpdatePlayer).toHaveBeenCalledWith(5, { status: "eliminated" });
  });

  it("allows a super admin who isn't the game's own admin", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7, true));
    await expect(caller.player.update({ playerId: 5, status: "safe" })).resolves.toEqual({ success: true });
  });

  it("rejects when the player does not exist, without ever loading a game", async () => {
    mockGetPlayerById.mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.player.update({ playerId: 404, status: "safe" })).rejects.toThrow("Player not found");
    expect(mockGetGame).not.toHaveBeenCalled();
    expect(mockUpdatePlayer).not.toHaveBeenCalled();
  });
});

describe("achievement.create / achievement.award authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockCreateAchievement.mockResolvedValue(42);
    mockGetPlayerById.mockResolvedValue({ id: 5, gameId: 1 });
    mockGetGameAchievements.mockResolvedValue([{ id: 9, gameId: 1 }]);
  });

  it("rejects a non-admin creating an achievement", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.create({ gameId: 1, name: "Test" })).rejects.toThrow("Admin access required");
    expect(mockCreateAchievement).not.toHaveBeenCalled();
  });

  it("allows the owning admin to create an achievement", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.create({ gameId: 1, name: "Test" })).resolves.toEqual({ id: 42 });
  });

  it("rejects a non-admin awarding an achievement", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.award({ gamePlayerId: 5, achievementId: 9, gameId: 1 })).rejects.toThrow("Admin access required");
    expect(mockAwardAchievement).not.toHaveBeenCalled();
  });

  it("rejects awarding when the player belongs to a different game", async () => {
    mockGetPlayerById.mockResolvedValue({ id: 5, gameId: 2 }); // player is actually in game 2
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.award({ gamePlayerId: 5, achievementId: 9, gameId: 1 })).rejects.toThrow("Player not found in this game");
    expect(mockAwardAchievement).not.toHaveBeenCalled();
  });

  it("rejects awarding an achievement that belongs to a different game", async () => {
    mockGetGameAchievements.mockResolvedValue([{ id: 999, gameId: 1 }]); // achievementId 9 isn't in this game's list
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.award({ gamePlayerId: 5, achievementId: 9, gameId: 1 })).rejects.toThrow("Achievement not found in this game");
    expect(mockAwardAchievement).not.toHaveBeenCalled();
  });

  it("awards when the player and achievement both genuinely belong to the game", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.award({ gamePlayerId: 5, achievementId: 9, gameId: 1 })).resolves.toEqual({ success: true });
    expect(mockAwardAchievement).toHaveBeenCalledWith(5, 9);
  });
});

describe("achievement.seedAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockSeedAchievements.mockResolvedValue({ created: 52, skipped: 0, total: 52 });
  });

  it("rejects a non-admin", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.achievement.seedAll({ gameId: 1 })).rejects.toThrow("Admin access required");
    expect(mockSeedAchievements).not.toHaveBeenCalled();
  });

  it("delegates to db.seedAchievements with the full 52-entry catalog", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.achievement.seedAll({ gameId: 1 });
    expect(result).toEqual({ created: 52, skipped: 0, total: 52 });
    expect(mockSeedAchievements).toHaveBeenCalledTimes(1);
    const [gameIdArg, catalogArg] = mockSeedAchievements.mock.calls[0];
    expect(gameIdArg).toBe(1);
    expect(Array.isArray(catalogArg)).toBe(true);
    expect(catalogArg.length).toBe(52);
    expect(catalogArg.map((entry: { name: string }) => entry.name)).toContain("First Blood");
  });
});

describe("mapPowerUp.create validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockGetGamePowerUps.mockResolvedValue([{ id: 9, gameId: 1, isEnabled: true }]);
    mockCreateMapPowerUp.mockResolvedValue(123);
  });

  it("rejects a non-admin", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude: "10", longitude: "10" })).rejects.toThrow("Admin access required");
  });

  it.each([
    ["not a number", "abc", "10"],
    ["too far north", "91", "10"],
    ["too far south", "-91", "10"],
  ])("rejects an invalid latitude: %s", async (_label, latitude, longitude) => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude, longitude })).rejects.toThrow("Latitude");
    expect(mockCreateMapPowerUp).not.toHaveBeenCalled();
  });

  it.each([
    ["not a number", "10", "xyz"],
    ["too far east", "10", "181"],
    ["too far west", "10", "-181"],
  ])("rejects an invalid longitude: %s", async (_label, latitude, longitude) => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude, longitude })).rejects.toThrow("Longitude");
    expect(mockCreateMapPowerUp).not.toHaveBeenCalled();
  });

  it("accepts boundary coordinates (±90 / ±180)", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude: "90", longitude: "-180" })).resolves.toEqual({ id: 123 });
  });

  it("rejects a power-up that doesn't exist", async () => {
    mockGetGamePowerUps.mockResolvedValue([]);
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 999, latitude: "10", longitude: "10" })).rejects.toThrow("not found");
    expect(mockCreateMapPowerUp).not.toHaveBeenCalled();
  });

  it("rejects a power-up belonging to a different game", async () => {
    mockGetGamePowerUps.mockResolvedValue([{ id: 9, gameId: 2, isEnabled: true }]);
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude: "10", longitude: "10" })).rejects.toThrow("does not belong to this game");
    expect(mockCreateMapPowerUp).not.toHaveBeenCalled();
  });

  it("rejects a disabled power-up", async () => {
    mockGetGamePowerUps.mockResolvedValue([{ id: 9, gameId: 1, isEnabled: false }]);
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude: "10", longitude: "10" })).rejects.toThrow("disabled");
    expect(mockCreateMapPowerUp).not.toHaveBeenCalled();
  });

  it("creates the map power-up when everything is valid", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.mapPowerUp.create({ gameId: 1, powerUpId: 9, latitude: "29.76", longitude: "-95.37" })).resolves.toEqual({ id: 123 });
  });
});
