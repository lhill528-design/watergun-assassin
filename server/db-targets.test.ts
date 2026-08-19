import { beforeEach, describe, expect, it, vi } from "vitest";
import { gamePlayers } from "../drizzle/schema";

// Mirrors server/db-purchase-atomicity.test.ts's approach: mock the
// driver modules underneath server/db.ts so assignTargetsAtomic() and
// clearTargetsAtomic() run for real against a fake transaction. Real
// drizzle `eq()` conditions are opaque AST objects this fake can't
// generically parse, but its shape is stable enough in practice to pull
// the literal comparison value back out (queryChunks[3]) -- used only to
// know which player row a given per-row update() targeted, not to
// reimplement SQL filtering. This proves the operation is transactional
// and produces a correct one-to-one chain / a real NULL clear; it does
// NOT prove MySQL/TiDB's own row-locking, which is the database's own,
// separately-documented behavior.
function extractEqColumnAndValue(cond: unknown): { column?: string; value?: unknown } {
  const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks;
  const column = (chunks?.[1] as { name?: string } | undefined)?.name;
  const value = (chunks?.[3] as { value?: unknown } | undefined)?.value;
  return { column, value };
}

let committedPlayers: Array<{ id: number; targetId: number | null }>;
let transactionCallCount = 0;
let outerCallCount = 0;

function resetFakeState() {
  committedPlayers = [];
  transactionCallCount = 0;
  outerCallCount = 0;
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
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCallCount += 1;
    let working = committedPlayers.map((player) => ({ ...player }));

    const tx = {
      select: (_fields?: unknown) => {
        const builder: any = {
          from: (_table: unknown) => builder,
          where: (_cond: unknown) => builder,
          for: (_strength: unknown) => builder,
          then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
            try {
              resolve(working.map((player) => ({ id: player.id })));
            } catch (err) {
              reject(err);
            }
          },
        };
        return builder;
      },
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async (cond: unknown) => {
            if (table !== gamePlayers) return;
            const { column, value } = extractEqColumnAndValue(cond);
            if (column === "id") {
              working = working.map((player) => (player.id === value ? { ...player, ...values } : player));
            } else {
              // clearTargetsAtomic's bulk update conditions on gameId, not
              // a specific player id -- applies to every working row.
              working = working.map((player) => ({ ...player, ...values }));
            }
          },
        }),
      }),
    };

    const result = await callback(tx);
    committedPlayers = working; // commit: only reached if callback didn't throw
    return result;
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { assignTargetsAtomic, clearTargetsAtomic } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

describe("assignTargetsAtomic", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
    fakeDb.update.mockClear();
  });

  it("assigns a one-to-one circular chain inside a single transaction", async () => {
    committedPlayers = [{ id: 1, targetId: null }, { id: 2, targetId: null }, { id: 3, targetId: null }, { id: 4, targetId: null }];

    const result = await assignTargetsAtomic(5);

    expect(result).toEqual({ affected: 4 });
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
    expect(committedPlayers.every((player) => player.targetId != null)).toBe(true);
    expect(committedPlayers.every((player) => player.targetId !== player.id)).toBe(true);
    const targetCounts = new Map<number, number>();
    for (const player of committedPlayers) targetCounts.set(player.targetId!, (targetCounts.get(player.targetId!) ?? 0) + 1);
    for (const player of committedPlayers) expect(targetCounts.get(player.id)).toBe(1);
  });

  it("works with exactly 2 alive players", async () => {
    committedPlayers = [{ id: 1, targetId: null }, { id: 2, targetId: null }];
    const result = await assignTargetsAtomic(5);
    expect(result).toEqual({ affected: 2 });
    expect(committedPlayers.find((p) => p.id === 1)?.targetId).toBe(2);
    expect(committedPlayers.find((p) => p.id === 2)?.targetId).toBe(1);
  });

  it("rejects fewer than 2 alive players without committing anything", async () => {
    committedPlayers = [{ id: 1, targetId: null }];
    await expect(assignTargetsAtomic(5)).rejects.toThrow("at least 2");
    expect(committedPlayers).toEqual([{ id: 1, targetId: null }]);
  });

  it("rejects zero alive players", async () => {
    committedPlayers = [];
    await expect(assignTargetsAtomic(5)).rejects.toThrow("at least 2");
  });
});

describe("clearTargetsAtomic", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
    fakeDb.transaction.mockClear();
  });

  it("clears every player's targetId to a real NULL, not a sentinel like 0", async () => {
    committedPlayers = [{ id: 1, targetId: 2 }, { id: 2, targetId: 3 }, { id: 3, targetId: 1 }];

    const result = await clearTargetsAtomic(5);

    expect(result).toEqual({ affected: 3 });
    expect(committedPlayers.every((player) => player.targetId === null)).toBe(true);
    // Specifically not the old client's targetId: 0 sentinel.
    expect(committedPlayers.some((player) => (player.targetId as unknown) === 0)).toBe(false);
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
  });

  it("returns affected: 0 for a game with no players, without erroring", async () => {
    committedPlayers = [];
    const result = await clearTargetsAtomic(5);
    expect(result).toEqual({ affected: 0 });
  });
});
