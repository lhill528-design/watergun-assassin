import { beforeEach, describe, expect, it, vi } from "vitest";
import { games, gamePlayers, playerPowerUps, powerUps } from "../drizzle/schema";

// Same approach as server/db-targets.test.ts: mock the driver modules
// underneath server/db.ts so startRoundAtomic() runs for real against a
// fake transaction, and pull the literal value back out of real (opaque)
// drizzle `eq()` conditions via their queryChunks shape. Proves this
// code's own precondition checks and the atomicity of the round-state
// writes (including, per the review correction, Wildcard swaps/
// consumption/returns), not MySQL/TiDB's own locking.
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
  userId: number;
  status: string;
  targetId: number | null;
  nextRoundTargetId: number | null;
}
interface FakePowerUp {
  id: number;
  gameId: number;
  gamePlayerId: number;
  powerUpId: number;
  status: string;
  isActive: boolean;
  expiresAt: Date | null;
  targetPlayerId: number | null;
  activationData: unknown;
  activatedRound: number | null;
}
interface FakeCatalogEntry {
  id: number;
  gameId: number;
  name: string;
}

let committedGame: FakeGame;
let committedPlayers: FakePlayer[];
let committedPowerUps: FakePowerUp[];
let committedCatalog: FakeCatalogEntry[];
let transactionCallCount = 0;
let outerCallCount = 0;

function resetFakeState() {
  committedGame = { id: 1, currentRound: 0, roundEndTime: null, roundLength: 72, status: "active", deletedAt: null };
  committedPlayers = [];
  committedPowerUps = [];
  committedCatalog = [{ id: 1, gameId: 1, name: "Wildcard" }];
  transactionCallCount = 0;
  outerCallCount = 0;
}
resetFakeState();

function makeTx(state: { game: FakeGame; players: FakePlayer[]; powerUps: FakePowerUp[]; catalog: FakeCatalogEntry[] }) {
  return {
    select: (_fields?: unknown) => {
      const local = { table: null as unknown };
      const builder: any = {
        from: (table: unknown) => { local.table = table; return builder; },
        where: (_cond: unknown) => builder,
        for: (_strength: unknown) => builder,
        then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
          try {
            if (local.table === games) resolve([{ ...state.game }]);
            else if (local.table === gamePlayers) resolve(state.players.map((player) => ({ ...player })));
            else if (local.table === playerPowerUps) resolve(state.powerUps.filter((item) => item.isActive).map((item) => ({ ...item })));
            else if (local.table === powerUps) resolve(state.catalog.map((entry) => ({ ...entry })));
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
            state.game = { ...state.game, ...values };
          } else if (table === gamePlayers && column === "id") {
            state.players = state.players.map((player) => (player.id === value ? { ...player, ...values } : player));
          } else if (table === playerPowerUps && column === "id") {
            state.powerUps = state.powerUps.map((item) => (item.id === value ? { ...item, ...values } : item));
          }
        },
      }),
    }),
  };
}

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
    const state = {
      game: { ...committedGame },
      players: committedPlayers.map((player) => ({ ...player })),
      powerUps: committedPowerUps.map((item) => ({ ...item })),
      catalog: committedCatalog.map((entry) => ({ ...entry })),
    };
    const tx = makeTx(state);

    const result = await callback(tx);
    committedGame = state.game; // commit: only reached if callback didn't throw
    committedPlayers = state.players;
    committedPowerUps = state.powerUps;
    committedCatalog = state.catalog;
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
    { id: 1, userId: 101, status: "alive", targetId: 2, nextRoundTargetId: null },
    { id: 2, userId: 102, status: "alive", targetId: 3, nextRoundTargetId: null },
    { id: 3, userId: 103, status: "alive", targetId: 1, nextRoundTargetId: null },
  ];
}

// 1 -> 2 -> 3 -> 4 -> 5 -> 1, big enough that a Wildcard swap doesn't
// collide a player with themselves.
function validCycleOfFive(): FakePlayer[] {
  return [
    { id: 1, userId: 201, status: "alive", targetId: 2, nextRoundTargetId: null },
    { id: 2, userId: 202, status: "alive", targetId: 3, nextRoundTargetId: null },
    { id: 3, userId: 203, status: "alive", targetId: 4, nextRoundTargetId: null },
    { id: 4, userId: 204, status: "alive", targetId: 5, nextRoundTargetId: null },
    { id: 5, userId: 205, status: "alive", targetId: 1, nextRoundTargetId: null },
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
    // Player 1 requeues the same target it already has -- a no-op
    // promotion that still exercises the nextRoundTargetId clearing path
    // without producing an invalid effective assignment.
    committedPlayers[0].nextRoundTargetId = 2;

    const result = await startRoundAtomic(1);

    expect(result.currentRound).toBe(1);
    expect(committedGame.currentRound).toBe(1);
    expect(committedGame.status).toBe("active");
    expect(committedGame.roundEndTime).toBeInstanceOf(Date);
    expect(committedPlayers[0].targetId).toBe(2);
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
    committedPlayers = [{ id: 1, userId: 101, status: "alive", targetId: null, nextRoundTargetId: null }];
    await expect(startRoundAtomic(1)).rejects.toThrow("at least 2");
  });

  it("rejects an invalid (non-bijective) target assignment among alive players", async () => {
    committedPlayers = [
      { id: 1, userId: 101, status: "alive", targetId: 2, nextRoundTargetId: null },
      { id: 2, userId: 102, status: "alive", targetId: null, nextRoundTargetId: null }, // no target at all
    ];
    await expect(startRoundAtomic(1)).rejects.toThrow("valid one-to-one targets");
    expect(committedGame.currentRound).toBe(0);
  });

  it("ignores eliminated/safe players when validating the target assignment", async () => {
    committedPlayers = [
      ...validTrio(),
      { id: 4, userId: 104, status: "eliminated", targetId: null, nextRoundTargetId: null }, // shouldn't block the valid alive trio
    ];
    const result = await startRoundAtomic(1);
    expect(result.currentRound).toBe(1);
  });

  it("rolls back the round advance if a write partway through fails", async () => {
    committedPlayers = validTrio();
    fakeDb.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCallCount += 1;
      const state = {
        game: { ...committedGame },
        players: committedPlayers.map((player) => ({ ...player })),
        powerUps: committedPowerUps.map((item) => ({ ...item })),
        catalog: committedCatalog.map((entry) => ({ ...entry })),
      };
      const tx = {
        ...makeTx(state),
        update: (_table: unknown) => ({
          set: (_values: unknown) => ({
            where: async () => {
              throw new Error("simulated write failure");
            },
          }),
        }),
      };
      return await callback(tx); // no commit on throw -- module-level committed* stay untouched
    });

    await expect(startRoundAtomic(1)).rejects.toThrow("simulated write failure");
    expect(committedGame.currentRound).toBe(0);
    expect(committedGame.roundEndTime).toBeNull();
  });

  // --- Task 2: effective assignment (nextRoundTargetId ?? targetId) ---

  it("rejects when current targets are valid but the queued picks would make the chain invalid, leaving the round and every target untouched", async () => {
    committedPlayers = validTrio();
    // Player 1 queues a pick that collides with player 2's own queued
    // effective target, breaking the one-to-one chain once promoted.
    committedPlayers[0].nextRoundTargetId = 3;
    committedPlayers[1].nextRoundTargetId = 3;

    await expect(startRoundAtomic(1)).rejects.toThrow("valid one-to-one targets");

    expect(committedGame.currentRound).toBe(0);
    expect(committedGame.roundEndTime).toBeNull();
    expect(committedPlayers[0].targetId).toBe(2);
    expect(committedPlayers[0].nextRoundTargetId).toBe(3);
    expect(committedPlayers[1].targetId).toBe(3);
    expect(committedPlayers[1].nextRoundTargetId).toBe(3);
  });

  it("applies queued picks that produce a valid new chain", async () => {
    committedPlayers = validCycleOfFive();
    // Requeue the entire 5-cycle by one step: 1->3, 2->4, 3->5, 4->1, 5->2.
    // Still a valid one-to-one bijection across all five alive players.
    committedPlayers[0].nextRoundTargetId = 3;
    committedPlayers[1].nextRoundTargetId = 4;
    committedPlayers[2].nextRoundTargetId = 5;
    committedPlayers[3].nextRoundTargetId = 1;
    committedPlayers[4].nextRoundTargetId = 2;

    const result = await startRoundAtomic(1);

    expect(result.currentRound).toBe(1);
    expect(committedPlayers.map((p) => p.targetId)).toEqual([3, 4, 5, 1, 2]);
    expect(committedPlayers.every((p) => p.nextRoundTargetId === null)).toBe(true);
  });

  // --- Task 3: Wildcard swaps/consumption/returns inside the transaction ---

  it("swaps targets for a valid Wildcard and consumes it, within the same transaction as the round advance", async () => {
    committedPlayers = validCycleOfFive();
    committedPowerUps = [
      {
        id: 501,
        gameId: 1,
        gamePlayerId: 1, // owner: player 1, whose effective target is player 2
        powerUpId: 1, // "Wildcard" per committedCatalog
        status: "active",
        isActive: true,
        expiresAt: null,
        targetPlayerId: 4, // owner wants to hunt player 4 instead
        activationData: null,
        activatedRound: null,
      },
    ];

    const result = await startRoundAtomic(1);

    expect(result.currentRound).toBe(1);
    expect(result.wildcardReturns).toEqual([]);
    // owner (1) now hunts the selected target (4); the player who used to
    // hunt 4 (player 3) inherits owner's old target (2); everyone else
    // unchanged.
    const byId = new Map(committedPlayers.map((p) => [p.id, p.targetId]));
    expect(byId.get(1)).toBe(4);
    expect(byId.get(3)).toBe(2);
    expect(byId.get(2)).toBe(3);
    expect(byId.get(4)).toBe(5);
    expect(byId.get(5)).toBe(1);

    const wildcard = committedPowerUps.find((w) => w.id === 501)!;
    expect(wildcard.status).toBe("consumed");
    expect(wildcard.isActive).toBe(false);
  });

  it("returns an invalid Wildcard to inventory instead of applying it, and reports it in wildcardReturns", async () => {
    committedPlayers = validCycleOfFive();
    committedPowerUps = [
      {
        id: 502,
        gameId: 1,
        gamePlayerId: 1,
        powerUpId: 1,
        status: "active",
        isActive: true,
        expiresAt: null,
        targetPlayerId: 999, // no such player -- selection no longer valid
        activationData: { picked: true },
        activatedRound: null,
      },
    ];

    const result = await startRoundAtomic(1);

    expect(result.currentRound).toBe(1);
    expect(result.wildcardReturns).toEqual([{ ownerUserId: 201 }]); // player 1's userId per validCycleOfFive
    // no target changes from the invalid Wildcard
    expect(committedPlayers.map((p) => p.targetId)).toEqual([2, 3, 4, 5, 1]);

    const wildcard = committedPowerUps.find((w) => w.id === 502)!;
    expect(wildcard.status).toBe("inventory");
    expect(wildcard.isActive).toBe(false);
    expect(wildcard.targetPlayerId).toBeNull();
    expect(wildcard.activationData).toBeNull();
  });

  it("rolls back everything -- round advance, target promotions, and Wildcard state -- if a failure happens during Wildcard processing", async () => {
    committedPlayers = validCycleOfFive();
    committedPowerUps = [
      {
        id: 503,
        gameId: 1,
        gamePlayerId: 1,
        powerUpId: 1,
        status: "active",
        isActive: true,
        expiresAt: null,
        targetPlayerId: 4,
        activationData: null,
        activatedRound: null,
      },
    ];

    fakeDb.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCallCount += 1;
      const state = {
        game: { ...committedGame },
        players: committedPlayers.map((player) => ({ ...player })),
        powerUps: committedPowerUps.map((item) => ({ ...item })),
        catalog: committedCatalog.map((entry) => ({ ...entry })),
      };
      const baseTx = makeTx(state);
      let updateCount = 0;
      const tx = {
        ...baseTx,
        update: (table: unknown) => {
          updateCount += 1;
          if (table === playerPowerUps) {
            return {
              set: (_values: unknown) => ({
                where: async () => {
                  throw new Error("simulated Wildcard write failure");
                },
              }),
            };
          }
          return (baseTx as any).update(table);
        },
      };
      return await callback(tx); // no commit on throw
    });

    await expect(startRoundAtomic(1)).rejects.toThrow("simulated Wildcard write failure");

    expect(committedGame.currentRound).toBe(0);
    expect(committedGame.roundEndTime).toBeNull();
    expect(committedPlayers.map((p) => p.targetId)).toEqual([2, 3, 4, 5, 1]); // unchanged
    expect(committedPowerUps[0].status).toBe("active"); // unchanged
  });
});
