import { beforeEach, describe, expect, it, vi } from "vitest";

// Router-level coverage for powerUp.purchase's existing business rules --
// discount stacking, Sabotage doubling + consumption, Blacklist, reserved
// (Bodyguard) points, max-use limits, and Roulette exclusion -- to prove
// none of that regressed when the actual balance/inventory writes moved
// from two separate sequential db calls into one purchasePowerUpAtomic()
// transaction. Mirrors server/rules-authorization.test.ts's approach:
// mock ./db, then drive the real router logic through appRouter.createCaller().
const mockGetPlayerInGame = vi.fn();
const mockGetGamePowerUps = vi.fn();
const mockGetPlayerPowerUpUsageCount = vi.fn();
const mockExpirePlayerPowerUps = vi.fn();
const mockGetActiveTargetedPowerUp = vi.fn();
const mockPurchasePowerUpAtomic = vi.fn();
const mockCheckAndAwardAchievements = vi.fn();

vi.mock("./db", () => ({
  getPlayerInGame: (...args: unknown[]) => mockGetPlayerInGame(...args),
  getGamePowerUps: (...args: unknown[]) => mockGetGamePowerUps(...args),
  getPlayerPowerUpUsageCount: (...args: unknown[]) => mockGetPlayerPowerUpUsageCount(...args),
  expirePlayerPowerUps: (...args: unknown[]) => mockExpirePlayerPowerUps(...args),
  getActiveTargetedPowerUp: (...args: unknown[]) => mockGetActiveTargetedPowerUp(...args),
  purchasePowerUpAtomic: (...args: unknown[]) => mockPurchasePowerUpAtomic(...args),
  checkAndAwardAchievements: (...args: unknown[]) => mockCheckAndAwardAchievements(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number) {
  return { req: {} as never, res: {} as never, user: { id: userId } as never, authError: null };
}

const BASE_PLAYER = { id: 1, userId: 7, points: 500, reservedPoints: 0, pendingDiscountPercent: null as number | null };
const BASE_POWER_UP = { id: 9, name: "Radar", isEnabled: true, cost: 100, discount: 0, maxUsesPerGame: null as number | null };

describe("powerUp.purchase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerInGame.mockResolvedValue(BASE_PLAYER);
    mockGetGamePowerUps.mockResolvedValue([BASE_POWER_UP]);
    mockGetPlayerPowerUpUsageCount.mockResolvedValue(0);
    mockExpirePlayerPowerUps.mockResolvedValue(undefined);
    mockGetActiveTargetedPowerUp.mockResolvedValue(undefined);
    mockPurchasePowerUpAtomic.mockResolvedValue({ inventoryId: 555 });
    mockCheckAndAwardAchievements.mockResolvedValue(undefined);
  });

  it("charges full price with no discount, Sabotage, or coupon in play", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(result).toEqual({ success: true, inventoryId: 555, cost: 100, status: "inventory" });
    expect(mockPurchasePowerUpAtomic).toHaveBeenCalledWith({
      gamePlayerId: 1,
      gameId: 5,
      powerUpId: 9,
      cost: 100,
      clearPendingDiscount: false,
      sabotageIdToConsume: undefined,
    });
    expect(mockCheckAndAwardAchievements).toHaveBeenCalledWith(1, 5);
  });

  it("applies the catalog's own admin discount", async () => {
    mockGetGamePowerUps.mockResolvedValue([{ ...BASE_POWER_UP, discount: 25 }]); // 100 -> 75
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(result.cost).toBe(75);
    expect(mockPurchasePowerUpAtomic).toHaveBeenCalledWith(expect.objectContaining({ cost: 75 }));
  });

  it("doubles the cost when the player is under an active Sabotage, and consumes it on success", async () => {
    mockGetActiveTargetedPowerUp.mockImplementation((_gameId: number, _playerId: number, name: string) =>
      name === "Sabotage" ? Promise.resolve({ id: 88 }) : Promise.resolve(undefined),
    );
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(result.cost).toBe(200); // 100 * 2
    expect(mockPurchasePowerUpAtomic).toHaveBeenCalledWith(expect.objectContaining({ cost: 200, sabotageIdToConsume: 88 }));
  });

  it("applies a pending Roulette discount coupon on top of the catalog price, and clears it", async () => {
    mockGetPlayerInGame.mockResolvedValue({ ...BASE_PLAYER, pendingDiscountPercent: 50 });
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(result.cost).toBe(50); // 100 * (1 - 0.5)
    expect(mockPurchasePowerUpAtomic).toHaveBeenCalledWith(expect.objectContaining({ cost: 50, clearPendingDiscount: true }));
  });

  it("rejects a blacklisted player before ever calling purchasePowerUpAtomic", async () => {
    mockGetActiveTargetedPowerUp.mockImplementation((_gameId: number, _playerId: number, name: string) =>
      name === "Blacklist" ? Promise.resolve({ id: 3 }) : Promise.resolve(undefined),
    );
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("blacklisted");
    expect(mockPurchasePowerUpAtomic).not.toHaveBeenCalled();
  });

  it("rejects when the up-front affordability check fails, honoring Bodyguard's reservedPoints", async () => {
    mockGetPlayerInGame.mockResolvedValue({ ...BASE_PLAYER, points: 150, reservedPoints: 100 }); // 50 available, cost 100
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("Not enough available points");
    expect(mockPurchasePowerUpAtomic).not.toHaveBeenCalled();
  });

  it("rejects once the max-uses-per-game limit is reached", async () => {
    mockGetGamePowerUps.mockResolvedValue([{ ...BASE_POWER_UP, maxUsesPerGame: 2 }]);
    mockGetPlayerPowerUpUsageCount.mockResolvedValue(2);
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("already used the maximum");
    expect(mockPurchasePowerUpAtomic).not.toHaveBeenCalled();
  });

  it("excludes Roulette from direct purchase", async () => {
    mockGetGamePowerUps.mockResolvedValue([{ ...BASE_POWER_UP, name: "Roulette" }]);
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("cannot be purchased");
    expect(mockPurchasePowerUpAtomic).not.toHaveBeenCalled();
  });

  it("rejects a disabled power-up", async () => {
    mockGetGamePowerUps.mockResolvedValue([{ ...BASE_POWER_UP, isEnabled: false }]);
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("not available");
  });
});
