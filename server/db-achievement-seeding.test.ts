import { beforeEach, describe, expect, it, vi } from "vitest";
import { games, achievements } from "../drizzle/schema";

// Mirrors server/db-rules-seeding.test.ts's approach: mock the driver
// modules underneath server/db.ts so seedAchievements() runs for real
// against a fake transaction. The fake buffers inserts and only merges
// them into the "committed" table if the whole callback resolves --
// discarding them if it throws -- which proves the operation is
// transactional, not just that db.transaction() got called.
//
// Correction from review: seedAchievements now locks the game row with
// SELECT ... FOR UPDATE before reading existing achievement names (the
// only way to serialize concurrent seed requests for a game that has no
// achievement rows of its own yet to lock). `callOrder` below records the
// order fake operations actually ran in, so the lock-happens-first
// requirement is provable rather than assumed.
let transactionCallCount = 0;
let outerCallCount = 0;
let committedNames: string[] = [];
let insertBehavior: (name: string) => void = () => {};
let gameExists = true;
let callOrder: string[] = [];

function createFakeTx() {
  const pending: string[] = [];
  return {
    select: (_fields?: unknown) => {
      const state = { table: null as unknown, hasFor: false };
      const builder: any = {
        from: (table: unknown) => { state.table = table; return builder; },
        where: (_cond: unknown) => builder,
        for: (_strength: unknown) => { state.hasFor = true; return builder; },
        then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
          try {
            if (state.table === games && state.hasFor) {
              callOrder.push("lock-game");
              resolve(gameExists ? [{ id: 1 }] : []);
            } else if (state.table === achievements) {
              callOrder.push("read-existing");
              resolve(committedNames.map((name) => ({ name })));
            } else {
              reject(new Error("unexpected select shape in fake tx"));
            }
          } catch (err) {
            reject(err);
          }
        },
      };
      return builder;
    },
    insert: (_table: unknown) => ({
      values: async (values: { name: string }) => {
        callOrder.push(`insert:${values.name}`);
        insertBehavior(values.name);
        pending.push(values.name);
        return [{ insertId: pending.length }];
      },
    }),
    __commit: () => committedNames.push(...pending),
  };
}

const fakeDb = {
  select: vi.fn(() => {
    outerCallCount += 1;
    throw new Error("select() must go through a transaction, not the top-level db handle");
  }),
  insert: vi.fn(() => {
    outerCallCount += 1;
    throw new Error("insert() must go through a transaction, not the top-level db handle");
  }),
  transaction: vi.fn(async (callback: (tx: ReturnType<typeof createFakeTx>) => Promise<unknown>) => {
    transactionCallCount += 1;
    const tx = createFakeTx();
    const result = await callback(tx);
    tx.__commit();
    return result;
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { seedAchievements } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

function defs(names: string[]) {
  return names.map((name) => ({ name, description: "d", emoji: "🏅", pointsValue: 100, condition: "x", achievementType: "combat", category: "Game" }));
}

describe("seedAchievements", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    transactionCallCount = 0;
    outerCallCount = 0;
    committedNames = [];
    insertBehavior = () => {};
    gameExists = true;
    callOrder = [];
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
    fakeDb.insert.mockClear();
  });

  it("creates every achievement the first time, inside a single transaction", async () => {
    const result = await seedAchievements(1, defs(["First Blood", "Public Menace", "Living Legend"]));

    expect(result).toEqual({ created: 3, skipped: 0, total: 3 });
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
    expect(committedNames).toEqual(["First Blood", "Public Menace", "Living Legend"]);
  });

  // The exact idempotency requirement: seeding twice must not duplicate.
  it("seeding the same catalog twice produces skips, not duplicates", async () => {
    await seedAchievements(1, defs(["First Blood", "Public Menace"]));
    const second = await seedAchievements(1, defs(["First Blood", "Public Menace"]));

    expect(second).toEqual({ created: 0, skipped: 2, total: 2 });
    expect(committedNames).toEqual(["First Blood", "Public Menace"]); // still two, not four
  });

  it("only creates achievements that are actually missing when the catalog partially overlaps", async () => {
    await seedAchievements(1, defs(["First Blood", "Public Menace"]));
    const second = await seedAchievements(1, defs(["First Blood", "Public Menace", "Living Legend"]));

    expect(second).toEqual({ created: 1, skipped: 2, total: 3 });
    expect(committedNames).toEqual(["First Blood", "Public Menace", "Living Legend"]);
  });

  it("rolls back entirely if a failure happens partway through the load", async () => {
    insertBehavior = (name) => {
      if (name === "Public Menace") throw new Error("simulated insert failure");
    };

    await expect(seedAchievements(1, defs(["First Blood", "Public Menace", "Living Legend"]))).rejects.toThrow("simulated insert failure");

    expect(committedNames).toEqual([]);
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
  });

  it("rejects when the game doesn't exist, without reading or inserting achievements", async () => {
    gameExists = false;
    await expect(seedAchievements(1, defs(["First Blood"]))).rejects.toThrow("Game not found");
    expect(callOrder).toEqual(["lock-game"]);
  });

  // The actual correction: the game row must be locked (SELECT ... FOR
  // UPDATE) before existing achievement names are read, and before any
  // insert -- proving the operation order, not just that a lock query
  // exists somewhere.
  it("locks the game row before reading existing achievement names or inserting anything", async () => {
    await seedAchievements(1, defs(["First Blood", "Public Menace"]));

    expect(callOrder[0]).toBe("lock-game");
    expect(callOrder.indexOf("lock-game")).toBeLessThan(callOrder.indexOf("read-existing"));
    expect(callOrder.indexOf("read-existing")).toBeLessThan(callOrder.indexOf("insert:First Blood"));
  });
});
