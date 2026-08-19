import { beforeEach, describe, expect, it, vi } from "vitest";

// Router-level coverage for what powerUp.purchase itself is still
// responsible for, now that the entire purchase decision (cost, coupon,
// Sabotage, max-use, Blacklist, Roulette exclusion, balance) has moved
// into purchasePowerUpAtomic() -- see server/db-purchase-atomicity.test.ts
// for that. This file only proves the router: resolves the calling
// player, runs housekeeping, delegates to purchasePowerUpAtomic with the
// minimal params (not a precomputed cost -- there's nothing left out here
// that could be trusted for correctness), awards achievements only after
// a successful purchase, and returns the atomic call's own authoritative
// inventoryId/cost untouched.
const mockGetPlayerInGame = vi.fn();
const mockExpirePlayerPowerUps = vi.fn();
const mockPurchasePowerUpAtomic = vi.fn();
const mockCheckAndAwardAchievements = vi.fn();

vi.mock("./db", () => ({
  getPlayerInGame: (...args: unknown[]) => mockGetPlayerInGame(...args),
  expirePlayerPowerUps: (...args: unknown[]) => mockExpirePlayerPowerUps(...args),
  purchasePowerUpAtomic: (...args: unknown[]) => mockPurchasePowerUpAtomic(...args),
  checkAndAwardAchievements: (...args: unknown[]) => mockCheckAndAwardAchievements(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number) {
  return { req: {} as never, res: {} as never, user: { id: userId } as never, authError: null };
}

const BASE_PLAYER = { id: 1, userId: 7, points: 500, reservedPoints: 0, pendingDiscountPercent: null as number | null };

describe("powerUp.purchase router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerInGame.mockResolvedValue(BASE_PLAYER);
    mockExpirePlayerPowerUps.mockResolvedValue(undefined);
    mockPurchasePowerUpAtomic.mockResolvedValue({ inventoryId: 555, cost: 100 });
    mockCheckAndAwardAchievements.mockResolvedValue(undefined);
  });

  it("delegates the entire purchase decision to purchasePowerUpAtomic with only the minimal params", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(mockPurchasePowerUpAtomic).toHaveBeenCalledWith({ gamePlayerId: 1, gameId: 5, powerUpId: 9 });
    // Notably absent from that call: cost, discount, coupon, or Sabotage --
    // none of that is computed here anymore. If a future change reintroduces
    // any of it, this assertion (an exact object match) will fail.
    expect(result).toEqual({ success: true, inventoryId: 555, cost: 100, status: "inventory" });
  });

  it("returns purchasePowerUpAtomic's own cost and inventoryId verbatim, not a router-computed value", async () => {
    mockPurchasePowerUpAtomic.mockResolvedValue({ inventoryId: 999, cost: 42 });
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(result).toEqual({ success: true, inventoryId: 999, cost: 42, status: "inventory" });
  });

  it("rejects if the caller isn't a player in this game, without touching the atomic purchase at all", async () => {
    mockGetPlayerInGame.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("Not in this game");
    expect(mockPurchasePowerUpAtomic).not.toHaveBeenCalled();
    expect(mockCheckAndAwardAchievements).not.toHaveBeenCalled();
  });

  it("runs expiry housekeeping before attempting the purchase", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(mockExpirePlayerPowerUps).toHaveBeenCalledWith(5);
  });

  it("propagates a rejection from purchasePowerUpAtomic (e.g. Blacklist, max-use, insufficient balance) without awarding achievements", async () => {
    mockPurchasePowerUpAtomic.mockRejectedValue(new Error("You are currently blacklisted and cannot purchase power-ups"));
    const caller = appRouter.createCaller(makeCtx(7));

    await expect(caller.powerUp.purchase({ gameId: 5, powerUpId: 9 })).rejects.toThrow("blacklisted");
    expect(mockCheckAndAwardAchievements).not.toHaveBeenCalled();
  });

  it("awards achievements for the purchasing player only after a successful purchase", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await caller.powerUp.purchase({ gameId: 5, powerUpId: 9 });

    expect(mockCheckAndAwardAchievements).toHaveBeenCalledWith(1, 5);
  });
});
