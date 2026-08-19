import { beforeEach, describe, expect, it, vi } from "vitest";
import { gamePlayers, playerPowerUps } from "../drizzle/schema";

// Mirrors server/db-game-creation.test.ts and server/db-rules-seeding.test.ts:
// mock the driver modules underneath server/db.ts (not db.ts itself) so
// purchasePowerUpAtomic() runs for real against a fake transaction. The
// fake buffers writes in a per-call "working" snapshot and only merges
// them into the "committed" player row if the whole callback resolves --
// discarding them if it throws -- which is what actually proves the
// operation is transactional (a failed insert can't leave points
// deducted), not just that db.transaction() got called.
//
// Real concurrent-request serialization is MySQL/TiDB's own row-locking
// behavior once `SELECT ... FOR UPDATE` is issued inside a transaction --
// not something a fake can re-prove. What IS tested here, and is this
// code's own responsibility to get right: the balance check reads from
// the transaction's own locked row (which reflects any prior commit),
// never from a value captured before the transaction opened. Two
// sequential calls sharing the same fake "database" state stand in for
// "the second request only ever sees an up-to-date balance."
let committedPlayer: { id: number; points: number; reservedPoints: number; pendingDiscountPercent: number | null };
let transactionCallCount = 0;
let outerCallCount = 0;
let insertShouldFail = false;
let nextInsertId = 1000;
let sabotageUpdateCalls: Array<Record<string, unknown>> = [];

function resetFakeState() {
  committedPlayer = { id: 1, points: 500, reservedPoints: 0, pendingDiscountPercent: null };
  transactionCallCount = 0;
  outerCallCount = 0;
  insertShouldFail = false;
  nextInsertId = 1000;
  sabotageUpdateCalls = [];
}
resetFakeState();

const fakeDb = {
  select: vi.fn(() => {
    outerCallCount += 1;
    throw new Error("select() must go through a transaction, not the top-level db handle");
  }),
  update: vi.fn(() => {
    outerCallCount += 1;
    throw new Error("update() must go through a transaction, not the top-level db handle");
  }),
  insert: vi.fn(() => {
    outerCallCount += 1;
    throw new Error("insert() must go through a transaction, not the top-level db handle");
  }),
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCallCount += 1;
    let working = { ...committedPlayer };
    const pendingSabotageUpdates: Array<Record<string, unknown>> = [];

    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => [{ ...working }],
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (table === gamePlayers) working = { ...working, ...values };
            else if (table === playerPowerUps) pendingSabotageUpdates.push(values);
          },
        }),
      }),
      insert: () => ({
        values: async () => {
          if (insertShouldFail) throw new Error("simulated insert failure");
          return [{ insertId: nextInsertId++ }];
        },
      }),
    };

    const result = await callback(tx);
    // Commit: only reached if the callback above didn't throw.
    committedPlayer = working;
    sabotageUpdateCalls.push(...pendingSabotageUpdates);
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

describe("purchasePowerUpAtomic", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
    fakeDb.update.mockClear();
    fakeDb.insert.mockClear();
  });

  it("deducts points, creates the inventory row, and consumes Sabotage all inside one transaction", async () => {
    const result = await purchasePowerUpAtomic({
      gamePlayerId: 1,
      gameId: 5,
      powerUpId: 9,
      cost: 200,
      clearPendingDiscount: true,
      sabotageIdToConsume: 42,
    });

    expect(result).toEqual({ inventoryId: 1000 });
    expect(committedPlayer.points).toBe(300);
    expect(committedPlayer.pendingDiscountPercent).toBeNull();
    expect(sabotageUpdateCalls).toEqual([expect.objectContaining({ status: "consumed" })]);
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
  });

  // The core "atomic" requirement: a failed inventory insert must not
  // leave points deducted with no power-up granted in return.
  it("rolls back the point deduction if the inventory insert fails", async () => {
    insertShouldFail = true;

    await expect(
      purchasePowerUpAtomic({ gamePlayerId: 1, gameId: 5, powerUpId: 9, cost: 200, clearPendingDiscount: false }),
    ).rejects.toThrow("simulated insert failure");

    expect(committedPlayer.points).toBe(500); // unchanged
    expect(sabotageUpdateCalls).toEqual([]);
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
  });

  it("rejects if the row-locked balance can't cover the cost, without deducting anything", async () => {
    committedPlayer.points = 100;

    await expect(
      purchasePowerUpAtomic({ gamePlayerId: 1, gameId: 5, powerUpId: 9, cost: 200, clearPendingDiscount: false }),
    ).rejects.toThrow("Not enough available points");

    expect(committedPlayer.points).toBe(100);
  });

  it("respects reservedPoints (Bodyguard) when re-checking the balance under the lock", async () => {
    committedPlayer.points = 500;
    committedPlayer.reservedPoints = 400; // only 100 actually available

    await expect(
      purchasePowerUpAtomic({ gamePlayerId: 1, gameId: 5, powerUpId: 9, cost: 200, clearPendingDiscount: false }),
    ).rejects.toThrow("Not enough available points");

    expect(committedPlayer.points).toBe(500); // untouched
  });

  // The concurrency-safety proxy described above: the second call must
  // see the first's committed balance, not a value from before either
  // transaction opened.
  it("a second purchase right after a first correctly sees the already-decremented balance and can be rejected", async () => {
    const first = await purchasePowerUpAtomic({ gamePlayerId: 1, gameId: 5, powerUpId: 9, cost: 300, clearPendingDiscount: false });
    expect(first.inventoryId).toBe(1000);
    expect(committedPlayer.points).toBe(200);

    // A second, equally-priced purchase should now fail -- 200 < 300 --
    // even though both requests could have read the original 500-point
    // balance if either read happened outside a lock.
    await expect(
      purchasePowerUpAtomic({ gamePlayerId: 1, gameId: 5, powerUpId: 11, cost: 300, clearPendingDiscount: false }),
    ).rejects.toThrow("Not enough available points");

    expect(committedPlayer.points).toBe(200); // the failed second attempt deducted nothing
    expect(transactionCallCount).toBe(2);
  });
});
