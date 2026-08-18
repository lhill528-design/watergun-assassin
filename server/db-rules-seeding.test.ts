import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors server/db-game-creation.test.ts's approach: mock the driver
// modules underneath server/db.ts (not db.ts itself, which is what's
// under test) so seedStandardRules() runs for real against a fake
// transaction. The fake tx buffers its inserts and only merges them into
// the "committed" table if the whole callback resolves -- discarding them
// if it throws -- which is what actually proves the operation is
// transactional, not just that db.transaction() got called.
let transactionCallCount = 0;
let outerCallCount = 0;
let committedRules: string[] = [];
let insertBehavior: (ruleText: string) => void = () => {};

function createFakeTx() {
  const pending: string[] = [];
  return {
    select: () => ({
      from: () => ({
        where: async () => committedRules.map((ruleText) => ({ ruleText })),
      }),
    }),
    insert: () => ({
      values: async (values: { ruleText: string }) => {
        insertBehavior(values.ruleText);
        pending.push(values.ruleText);
        return [{ insertId: pending.length }];
      },
    }),
    __commit: () => committedRules.push(...pending),
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

const { seedStandardRules } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

describe("seedStandardRules", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    transactionCallCount = 0;
    outerCallCount = 0;
    committedRules = [];
    insertBehavior = () => {};
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
    fakeDb.insert.mockClear();
  });

  it("creates every rule the first time, inside a single transaction", async () => {
    const result = await seedStandardRules(1, ["Rule A", "Rule B", "Rule C"]);

    expect(result).toEqual({ created: 3, skipped: 0, total: 3 });
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
    expect(committedRules).toEqual(["Rule A", "Rule B", "Rule C"]);
  });

  // The exact idempotency requirement: loading standard rules again must
  // not create duplicates.
  it("loading the same standard rules again creates zero duplicates", async () => {
    await seedStandardRules(1, ["Rule A", "Rule B", "Rule C"]);
    const second = await seedStandardRules(1, ["Rule A", "Rule B", "Rule C"]);

    expect(second).toEqual({ created: 0, skipped: 3, total: 3 });
    expect(committedRules).toEqual(["Rule A", "Rule B", "Rule C"]); // still just the three, not six
  });

  it("only creates the rules that are actually missing when the set partially overlaps", async () => {
    await seedStandardRules(1, ["Rule A", "Rule B"]);
    const second = await seedStandardRules(1, ["Rule A", "Rule B", "Rule C"]);

    expect(second).toEqual({ created: 1, skipped: 2, total: 3 });
    expect(committedRules).toEqual(["Rule A", "Rule B", "Rule C"]);
  });

  // Transactional: a failure partway through the load must not leave the
  // standard-rule set half-loaded.
  it("rolls back entirely if a failure happens partway through the load", async () => {
    insertBehavior = (ruleText) => {
      if (ruleText === "Rule B") throw new Error("simulated insert failure");
    };

    await expect(seedStandardRules(1, ["Rule A", "Rule B", "Rule C"])).rejects.toThrow("simulated insert failure");

    // Rule A was inserted before the failure, but since it was never
    // committed (the transaction as a whole rejected), it must not be
    // sitting in the table either.
    expect(committedRules).toEqual([]);
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
  });
});
