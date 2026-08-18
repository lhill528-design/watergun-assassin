import { beforeEach, describe, expect, it, vi } from "vitest";

// server/db.ts builds its drizzle client from these two driver modules --
// mocked here (rather than mocking db.ts itself, which is what's under
// test) so createGameWithAdmin runs for real against a fake transaction.
// What this actually proves: both the game insert and the admin's
// game_players insert only ever go through db.transaction()'s tx handle,
// never the top-level db handle -- so a failure partway through can't
// leave the game row committed on its own outside that transaction. This
// used to be two separate, sequential db calls (createGame() then
// joinGame()) with no such wrapping at all.
//
// Whether mysql2/TiDB itself honors the COMMIT/ROLLBACK contract once a
// real transaction is opened is the driver's own well-established
// behavior, not something this test re-verifies.
let transactionCallCount = 0;
let outerInsertCalls = 0;
let insertBehavior: (table: unknown, values: unknown, callIndex: number) => unknown = () => [{ insertId: 1 }];

function createFakeTx() {
  let callIndex = 0;
  return {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: unknown) => insertBehavior(table, values, callIndex++)),
    })),
  };
}

const fakeDb = {
  insert: vi.fn(() => {
    outerInsertCalls += 1;
    throw new Error("insert() must go through a transaction, not the top-level db handle");
  }),
  transaction: vi.fn(async (callback: (tx: ReturnType<typeof createFakeTx>) => Promise<unknown>) => {
    transactionCallCount += 1;
    return callback(createFakeTx());
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { createGameWithAdmin } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

describe("createGameWithAdmin", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    transactionCallCount = 0;
    outerInsertCalls = 0;
    insertBehavior = () => [{ insertId: 1 }];
    fakeDb.transaction.mockClear();
    fakeDb.insert.mockClear();
  });

  it("creates the game and joins the admin as its first player inside a single transaction", async () => {
    insertBehavior = (_table, _values, index) => [{ insertId: index === 0 ? 501 : 9001 }];

    const result = await createGameWithAdmin({ name: "Test Game", adminId: 7, gameType: "last_man_standing" } as any);

    expect(result).toEqual({ gameId: 501, playerId: 9001 });
    expect(transactionCallCount).toBe(1);
    expect(outerInsertCalls).toBe(0);
  });

  // The exact regression this closes: createGame() and joinGame() used to
  // be two independent calls, so a failure joining the admin left the
  // just-created game row committed and orphaned (no players, admin can't
  // see it as theirs). Now both inserts live inside one transaction call,
  // so a failure in the second can't leave the first sitting there.
  it("propagates a failure adding the admin as a player without either insert landing outside the transaction", async () => {
    insertBehavior = (_table, _values, index) => {
      if (index === 1) throw new Error("simulated admin-join failure");
      return [{ insertId: 501 }];
    };

    await expect(
      createGameWithAdmin({ name: "Test Game", adminId: 7, gameType: "last_man_standing" } as any),
    ).rejects.toThrow("simulated admin-join failure");

    expect(transactionCallCount).toBe(1);
    expect(outerInsertCalls).toBe(0);
  });
});
