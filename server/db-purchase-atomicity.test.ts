import { beforeEach, describe, expect, it, vi } from "vitest";
import { gamePlayers, playerPowerUps, powerUps } from "../drizzle/schema";

// IMPORTANT, for anyone reading these results as proof of anything beyond
// what's stated: this file mocks the driver modules underneath
// server/db.ts (drizzle-orm/mysql2, mysql2/promise) so purchasePowerUpAtomic()
// runs for real against a fake in-memory "database" and a fake
// transaction wrapper. What that proves: given the sequence of reads and
// writes this function actually issues, the purchase decision (cost,
// coupon, Sabotage, max-use, Blacklist, balance) is computed from data
// read strictly after the row lock, and a second sequential call sees the
// first's committed result. It does NOT prove MySQL/TiDB's own
// `SELECT ... FOR UPDATE` row-locking or transaction isolation semantics
// -- those are the database's own, independently-documented behavior.
// What IS this code's own responsibility, and what these tests actually
// exercise: that nothing here reads authoritative state before the lock
// is (conceptually) held, and that a failure partway through rolls back
// every write in the same transaction.
//
// The fake below doesn't parse real SQL WHERE clauses (it can't -- they're
// opaque drizzle-orm AST objects). Instead it disambiguates which of
// purchasePowerUpAtomic's fixed set of queries is running by its shape
// (which table, whether `.for("update")` or `.limit()` was chained, and
// whether a `count(*)` field selection was passed to `.select()`), and
// each test scopes its fixture data to a single player/power-up so no
// value-level filtering is actually needed to get a meaningful answer.

interface FakePlayer {
  id: number;
  points: number;
  reservedPoints: number;
  pendingDiscountPercent: number | null;
}
interface FakeCatalogEntry {
  id: number;
  gameId: number;
  name: string;
  cost: number;
  discount: number;
  isEnabled: boolean;
  maxUsesPerGame: number | null;
}
interface FakeTargetedActive {
  id: number;
  powerUpId: number;
  isActive: boolean;
  expiresAt: Date | null;
}

let committedPlayer: FakePlayer;
let catalog: FakeCatalogEntry[];
let purchasedPowerUpId: number;
let targetedActive: FakeTargetedActive[];
let committedUsageCount: number;
let insertShouldFail: boolean;
let transactionCallCount = 0;
let nextInsertId = 1000;
let sabotageConsumedIds: number[] = [];

function resetFakeState() {
  committedPlayer = { id: 1, points: 500, reservedPoints: 0, pendingDiscountPercent: null };
  purchasedPowerUpId = 9;
  catalog = [{ id: 9, gameId: 5, name: "Radar", cost: 100, discount: 0, isEnabled: true, maxUsesPerGame: null }];
  targetedActive = [];
  committedUsageCount = 0;
  insertShouldFail = false;
  transactionCallCount = 0;
  nextInsertId = 1000;
  sabotageConsumedIds = [];
}
resetFakeState();

function makeSelectBuilder(fields: unknown) {
  const state = { fields, table: null as unknown, hasLimit: false, hasFor: false };
  const builder: any = {
    from(table: unknown) {
      state.table = table;
      return builder;
    },
    where(_cond: unknown) {
      return builder;
    },
    for(_strength: unknown) {
      state.hasFor = true;
      return builder;
    },
    limit(_n: unknown) {
      state.hasLimit = true;
      return builder;
    },
    then(resolve: (value: unknown) => void, reject: (err: unknown) => void) {
      try {
        resolve(resolveSelect(state, this._working));
      } catch (err) {
        reject(err);
      }
    },
  };
  return builder;
}

function resolveSelect(state: { fields: unknown; table: unknown; hasLimit: boolean; hasFor: boolean }, working: FakePlayer) {
  if (state.table === gamePlayers && state.hasFor) {
    return [{ ...working }];
  }
  if (state.table === powerUps && state.hasLimit) {
    return catalog.filter((entry) => entry.id === purchasedPowerUpId);
  }
  if (state.table === playerPowerUps && state.fields && typeof state.fields === "object" && "count" in (state.fields as object)) {
    return [{ count: committedUsageCount }];
  }
  if (state.table === playerPowerUps && !state.fields && !state.hasLimit) {
    return targetedActive.map((entry) => ({ ...entry }));
  }
  if (state.table === powerUps && !state.hasLimit) {
    return catalog.map((entry) => ({ ...entry }));
  }
  throw new Error(`unexpected select shape in fake tx (table match: ${state.table === gamePlayers ? "gamePlayers" : state.table === powerUps ? "powerUps" : state.table === playerPowerUps ? "playerPowerUps" : "unknown"})`);
}

const fakeDb = {
  select: vi.fn(() => {
    throw new Error("select() must go through a transaction, not the top-level db handle");
  }),
  update: vi.fn(() => {
    throw new Error("update() must go through a transaction, not the top-level db handle");
  }),
  insert: vi.fn(() => {
    throw new Error("insert() must go through a transaction, not the top-level db handle");
  }),
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCallCount += 1;
    let working: FakePlayer = { ...committedPlayer };
    let workingUsageCount = committedUsageCount;
    const pendingSabotageConsumes: number[] = [];
    let sabotageIdBeingConsumed: number | null = null;

    const tx = {
      select(fields?: unknown) {
        const builder = makeSelectBuilder(fields);
        builder._working = working;
        return builder;
      },
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async (_cond: unknown) => {
            if (table === gamePlayers) {
              working = { ...working, ...values };
            } else if (table === playerPowerUps) {
              // The only playerPowerUps update this function issues is
              // consuming Sabotage -- track it as consumed.
              if (sabotageIdBeingConsumed != null) pendingSabotageConsumes.push(sabotageIdBeingConsumed);
            }
          },
        }),
      }),
      insert: (_table: unknown) => ({
        values: async (_vals: unknown) => {
          if (insertShouldFail) throw new Error("simulated insert failure");
          workingUsageCount += 1;
          return [{ insertId: nextInsertId++ }];
        },
      }),
    };

    // The fake needs to know which targetedActive row is "the" Sabotage
    // before update() is called (real code passes the id only via the
    // opaque `.where()` predicate) -- resolve it once, matching the same
    // isStillActive/name logic the real function uses.
    const now = Date.now();
    const catalogNameById = Object.fromEntries(catalog.map((entry) => [entry.id, entry.name]));
    const sabotageRow = targetedActive.find(
      (entry) => entry.isActive && (!entry.expiresAt || entry.expiresAt.getTime() > now) && catalogNameById[entry.powerUpId] === "Sabotage",
    );
    sabotageIdBeingConsumed = sabotageRow?.id ?? null;

    const result = await callback(tx);
    // Commit: only reached if the callback above didn't throw.
    committedPlayer = working;
    committedUsageCount = workingUsageCount;
    sabotageConsumedIds.push(...pendingSabotageConsumes);
    return result;
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { purchasePowerUpAtomic } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

function purchase() {
  return purchasePowerUpAtomic({ gamePlayerId: 1, gameId: 5, powerUpId: purchasedPowerUpId });
}

describe("purchasePowerUpAtomic", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
    fakeDb.update.mockClear();
    fakeDb.insert.mockClear();
  });

  it("computes cost, deducts points, and creates the inventory row inside one transaction", async () => {
    const result = await purchase();

    expect(result).toEqual({ inventoryId: 1000, cost: 100 });
    expect(committedPlayer.points).toBe(400);
    expect(transactionCallCount).toBe(1);
  });

  it("applies the catalog's admin discount when computing the authoritative cost", async () => {
    catalog[0].discount = 25; // 100 -> 75
    const result = await purchase();
    expect(result.cost).toBe(75);
    expect(committedPlayer.points).toBe(425);
  });

  // The core correction: a pending coupon is read AND cleared inside the
  // same locked transaction, so it can only ever apply to the first
  // committed purchase that observes it -- a second, sequential purchase
  // (standing in for a concurrent one, since both would have to acquire
  // the same lock) sees it already cleared.
  it("a pending discount coupon applies to only the first purchase, then is cleared for the next", async () => {
    committedPlayer.pendingDiscountPercent = 50;

    const first = await purchase();
    expect(first.cost).toBe(50); // 100 * 0.5
    expect(committedPlayer.pendingDiscountPercent).toBeNull();

    const second = await purchase();
    expect(second.cost).toBe(100); // full price -- coupon already spent
  });

  // Same principle for Sabotage: it's read and consumed inside the same
  // locked transaction, so only the purchase that actually observes it
  // active pays double, and it's gone for the next one.
  it("an active Sabotage doubles the cost of only the next purchase, then is consumed", async () => {
    catalog.push({ id: 77, gameId: 5, name: "Sabotage", cost: 0, discount: 0, isEnabled: true, maxUsesPerGame: null });
    targetedActive.push({ id: 500, powerUpId: 77, isActive: true, expiresAt: null });

    const first = await purchase();
    expect(first.cost).toBe(200); // 100 * 2
    expect(sabotageConsumedIds).toEqual([500]);

    // Sabotage was consumed by the first purchase -- nothing left to
    // double the second one's cost.
    targetedActive = targetedActive.filter((entry) => entry.id !== 500);
    const second = await purchase();
    expect(second.cost).toBe(100);
  });

  it("rejects a purchase against an active Blacklist without deducting anything", async () => {
    catalog.push({ id: 66, gameId: 5, name: "Blacklist", cost: 0, discount: 0, isEnabled: true, maxUsesPerGame: null });
    targetedActive.push({ id: 600, powerUpId: 66, isActive: true, expiresAt: null });

    await expect(purchase()).rejects.toThrow("blacklisted");
    expect(committedPlayer.points).toBe(500);
  });

  it("an expired Blacklist row (past expiresAt) no longer blocks a purchase", async () => {
    catalog.push({ id: 66, gameId: 5, name: "Blacklist", cost: 0, discount: 0, isEnabled: true, maxUsesPerGame: null });
    targetedActive.push({ id: 600, powerUpId: 66, isActive: true, expiresAt: new Date(Date.now() - 1000) });

    await expect(purchase()).resolves.toEqual({ inventoryId: 1000, cost: 100 });
  });

  // Max-use eligibility is re-counted from the committed table inside the
  // same locked transaction as the purchase that would increment it, so
  // a second, sequential attempt (standing in for concurrent ones) always
  // sees the first's already-incremented count.
  it("cannot exceed maxUsesPerGame across sequential (lock-serialized) purchases", async () => {
    catalog[0].maxUsesPerGame = 1;

    const first = await purchase();
    expect(first.inventoryId).toBe(1000);

    await expect(purchase()).rejects.toThrow("already used the maximum of 1");
    expect(committedPlayer.points).toBe(400); // only the first purchase's cost was ever deducted
  });

  it("rejects if the row-locked balance can't cover the authoritative cost, without deducting anything", async () => {
    committedPlayer.points = 50;

    await expect(purchase()).rejects.toThrow("Not enough available points");
    expect(committedPlayer.points).toBe(50);
  });

  it("respects reservedPoints (Bodyguard) when re-checking the balance under the lock", async () => {
    committedPlayer.points = 500;
    committedPlayer.reservedPoints = 450; // only 50 actually available, cost is 100

    await expect(purchase()).rejects.toThrow("Not enough available points");
    expect(committedPlayer.points).toBe(500);
  });

  it("excludes Roulette from direct purchase", async () => {
    catalog[0].name = "Roulette";
    await expect(purchase()).rejects.toThrow("cannot be purchased");
  });

  it("rejects a disabled power-up", async () => {
    catalog[0].isEnabled = false;
    await expect(purchase()).rejects.toThrow("not available");
  });

  // The core "atomic" requirement: a failed inventory insert must roll
  // back the point deduction, the coupon consumption, and the Sabotage
  // consumption together -- not just the points.
  it("a failed inventory insert restores points, the coupon, and Sabotage -- nothing is left half-applied", async () => {
    committedPlayer.pendingDiscountPercent = 50;
    catalog.push({ id: 77, gameId: 5, name: "Sabotage", cost: 0, discount: 0, isEnabled: true, maxUsesPerGame: null });
    targetedActive.push({ id: 500, powerUpId: 77, isActive: true, expiresAt: null });
    insertShouldFail = true;

    await expect(purchase()).rejects.toThrow("simulated insert failure");

    expect(committedPlayer.points).toBe(500); // unchanged
    expect(committedPlayer.pendingDiscountPercent).toBe(50); // not cleared
    expect(sabotageConsumedIds).toEqual([]); // not consumed
    expect(committedUsageCount).toBe(0); // no inventory row landed
  });

  it("returns the transaction's own authoritative cost, not a value the caller could have precomputed", async () => {
    committedPlayer.pendingDiscountPercent = 20;
    catalog[0].discount = 10; // 100 -> 90, then -20% coupon -> 72
    const result = await purchase();
    expect(result.cost).toBe(72);
  });
});
