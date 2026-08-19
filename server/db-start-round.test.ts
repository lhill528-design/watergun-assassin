import { beforeEach, describe, expect, it, vi } from "vitest";
import { games, gamePlayers } from "../drizzle/schema";

// Same approach as server/db-targets.test.ts: mock the driver modules
// underneath server/db.ts so startRoundAtomic() runs for real against a
// fake transaction, and pull the literal value back out of real (opaque)
// drizzle `eq()` conditions via their queryChunks shape. Proves this
// code's own precondition checks and the atomicity of the round-state
// writes, not MySQL/TiDB's own locking.
function extractEqColumnAndValue(cond: unknown): { column?: string; value?: unknown } {
  const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks;
  const column = (chunks?.[1] as { name?: string } | undefined)?.name;
  const value = (chunks?.[3] as { value?: unknown } | undefined)?.value;
  return { column, value };
}

interface FakeGame {
  id: number;
  currentRound: number;
  roundEndTime: Date | null;
  roundLength: number;
  status: string;
  deletedAt: Date | null;
}
interface FakePlayer {
  id: number;
  status: string;
  targetId: number | null;
  nextRoundTargetId: number | null;
}

let committedGame: FakeGame;
let committedPlayers: FakePlayer[];
let transactionCallCount = 0;
let outerCallCount = 0;

function resetFakeState() {
  committedGame = { id: 1, currentRound: 0, roundEndTime: null, roundLength: 72, status: "active", deletedAt: null };
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
    let workingGame = { ...committedGame };
    let workingPlayers = committedPlayers.map((player) => ({ ...player }));

    const tx = {
      select: (_fields?: unknown) => {
        const state = { table: null as unknown };
        const builder: any = {
          from: (table: unknown) => {
            state.table = table;
            return builder;
          },
          where: (_cond: unknown) => builder,
          for: (_strength: unknown) => builder,
          then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
            try {
              if (state.table === games) resolve([{ ...workingGame }]);
              else if (state.table === gamePlayers) resolve(workingPlayers.map((player) => ({ ...player })));
              else reject(new Error("unexpected table in fake select"));
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
            const { column, value } = extractEqColumnAndValue(cond);
            if (table === games && column === "id") {
              workingGame = { ...workingGame, ...values };
            } else if (table === gamePlayers && column === "id") {
              workingPlayers = workingPlayers.map((player) => (player.id === value ? { ...player, ...values } : player));
            }
          },
        }),
      }),
    };

    const result = await callback(tx);
    committedGame = workingGame; // commit: only reached if callback didn't throw
    committedPlayers = workingPlayers;
    return result;
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { startRoundAtomic } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

function validTrio(): FakePlayer[] {
  return [
    { id: 1, status: "alive", targetId: 2, nextRoundTargetId: null },
    { id: 2, status: "alive", targetId: 3, nextRoundTargetId: null },
    { id: 3, status: "alive", targetId: 1, nextRoundTargetId: null },
  ];
}

describe("startRoundAtomic", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
    fakeDb.update.mockClear();
  });

  it("advances the round and promotes queued nextRoundTargetId picks inside one transaction", async () => {
    committedPlayers = validTrio();
    committedPlayers[0].nextRoundTargetId = 3; // player 1 picked (e.g. via Wildcard) a new target for this round

    const result = await startRoundAtomic(1);

    expect(result.currentRound).toBe(1);
    expect(committedGame.currentRound).toBe(1);
    expect(committedGame.status).toBe("active");
    expect(committedGame.roundEndTime).toBeInstanceOf(Date);
    expect(committedPlayers[0].targetId).toBe(3);
    expect(committedPlayers[0].nextRoundTargetId).toBeNull();
    expect(transactionCallCount).toBe(1);
    expect(outerCallCount).toBe(0);
  });

  it("rejects starting a round on a deleted game", async () => {
    committedGame.deletedAt = new Date();
    committedPlayers = validTrio();
    await expect(startRoundAtomic(1)).rejects.toThrow("deleted");
    expect(committedGame.currentRound).toBe(0);
  });

  it("rejects starting a round on a completed game", async () => {
    committedGame.status = "completed";
    committedPlayers = validTrio();
    await expect(startRoundAtomic(1)).rejects.toThrow("already ended");
  });

  it("rejects starting a second round while one is already active", async () => {
    committedGame.roundEndTime = new Date(Date.now() + 1000 * 60 * 60);
    committedPlayers = validTrio();
    await expect(startRoundAtomic(1)).rejects.toThrow("already active");
    expect(committedGame.currentRound).toBe(0);
  });

  it("rejects with fewer than 2 alive players", async () => {
    committedPlayers = [{ id: 1, status: "alive", targetId: null, nextRoundTargetId: null }];
    await expect(startRoundAtomic(1)).rejects.toThrow("at least 2");
  });

  it("rejects an invalid (non-bijective) target assignment among alive players", async () => {
    committedPlayers = [
      { id: 1, status: "alive", targetId: 2, nextRoundTargetId: null },
      { id: 2, status: "alive", targetId: null, nextRoundTargetId: null }, // no target at all
    ];
    await expect(startRoundAtomic(1)).rejects.toThrow("valid one-to-one targets");
    expect(committedGame.currentRound).toBe(0);
  });

  it("ignores eliminated/safe players when validating the target assignment", async () => {
    committedPlayers = [
      ...validTrio(),
      { id: 4, status: "eliminated", targetId: null, nextRoundTargetId: null }, // shouldn't block the valid alive trio
    ];
    const result = await startRoundAtomic(1);
    expect(result.currentRound).toBe(1);
  });

  it("rolls back the round advance if a write partway through fails", async () => {
    committedPlayers = validTrio();
    fakeDb.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCallCount += 1;
      let workingGame = { ...committedGame };
      const tx = {
        select: (_fields?: unknown) => {
          const state = { table: null as unknown };
          const builder: any = {
            from: (table: unknown) => { state.table = table; return builder; },
            where: (_cond: unknown) => builder,
            for: (_strength: unknown) => builder,
            then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
              if (state.table === games) resolve([{ ...workingGame }]);
              else if (state.table === gamePlayers) resolve(committedPlayers.map((player) => ({ ...player })));
              else reject(new Error("unexpected table"));
            },
          };
          return builder;
        },
        update: (_table: unknown) => ({
          set: (_values: unknown) => ({
            where: async () => {
              throw new Error("simulated write failure");
            },
          }),
        }),
      };
      try {
        return await callback(tx);
      } catch (err) {
        // rollback: committedGame/committedPlayers untouched
        throw err;
      }
    });

    await expect(startRoundAtomic(1)).rejects.toThrow("simulated write failure");
    expect(committedGame.currentRound).toBe(0);
    expect(committedGame.roundEndTime).toBeNull();
  });
});
