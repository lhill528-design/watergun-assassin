import { beforeEach, describe, expect, it, vi } from "vitest";
import { gamePlayers, achievements, playerAchievements, killFeed, notifications } from "../drizzle/schema";

// Same approach as server/db-start-round.test.ts: mock the driver modules
// underneath server/db.ts so awardAchievementAtomic() runs for real
// against a fake transaction, pulling literal values back out of real
// (opaque) drizzle eq()/and() conditions via their queryChunks shape.
// Proves this code's own locking, duplicate-guard, and atomicity, not
// MySQL/TiDB's own locking.
function extractEqColumnAndValue(cond: unknown): { column?: string; value?: unknown } {
  const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks;
  const column = (chunks?.[1] as { name?: string } | undefined)?.name;
  const value = (chunks?.[3] as { value?: unknown } | undefined)?.value;
  return { column, value };
}
// and(eq(a, x), eq(b, y)) nests the two eq() SQL fragments inside one
// combined SQL fragment at queryChunks[1], joined by a literal " and "
// StringChunk in between -- filter to the fragments that carry their own
// queryChunks (the eq()s) and extract each the same way as a bare eq().
function extractAndEqPairs(cond: unknown): Array<{ column?: string; value?: unknown }> {
  const inner = (cond as { queryChunks?: unknown[] })?.queryChunks?.[1] as { queryChunks?: unknown[] } | undefined;
  const innerChunks = inner?.queryChunks ?? [];
  return innerChunks.filter((c): c is { queryChunks: unknown[] } => !!(c as any)?.queryChunks).map(extractEqColumnAndValue);
}

interface FakePlayer {
  id: number;
  gameId: number;
  userId: number;
  points: number;
}
interface FakeAchievement {
  id: number;
  gameId: number;
  name: string;
  emoji?: string;
  description?: string;
  pointsValue: number;
}
interface FakePlayerAchievement {
  id: number;
  gamePlayerId: number;
  achievementId: number;
}

let committedPlayers: FakePlayer[];
let committedAchievements: FakeAchievement[];
let committedPlayerAchievements: FakePlayerAchievement[];
let committedKillFeed: Array<Record<string, unknown>>;
let committedNotifications: Array<Record<string, unknown>>;
let transactionCallCount = 0;
let nextPlayerAchievementId = 1;

function resetFakeState() {
  committedPlayers = [{ id: 5, gameId: 1, userId: 42, points: 100 }];
  committedAchievements = [{ id: 9, gameId: 1, name: "First Blood", emoji: "🏅", description: "Get a kill", pointsValue: 50 }];
  committedPlayerAchievements = [];
  committedKillFeed = [];
  committedNotifications = [];
  transactionCallCount = 0;
  nextPlayerAchievementId = 1;
}
resetFakeState();

function makeTx(state: { players: FakePlayer[]; achievements: FakeAchievement[]; playerAchievements: FakePlayerAchievement[]; killFeed: Array<Record<string, unknown>>; notifications: Array<Record<string, unknown>> }) {
  return {
    select: (_fields?: unknown) => {
      const local = { table: null as unknown };
      const builder: any = {
        from: (table: unknown) => { local.table = table; return builder; },
        where: (cond: unknown) => {
          builder.__cond = cond;
          return builder;
        },
        for: (_strength: unknown) => builder,
        __cond: undefined as unknown,
        then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
          try {
            if (local.table === gamePlayers) {
              const { value } = extractEqColumnAndValue(builder.__cond);
              resolve(state.players.filter((p) => p.id === value).map((p) => ({ ...p })));
            } else if (local.table === achievements) {
              const { value } = extractEqColumnAndValue(builder.__cond);
              resolve(state.achievements.filter((a) => a.id === value).map((a) => ({ ...a })));
            } else if (local.table === playerAchievements) {
              const pairs = extractAndEqPairs(builder.__cond);
              const gamePlayerId = pairs.find((p) => p.column === "gamePlayerId")?.value;
              const achievementId = pairs.find((p) => p.column === "achievementId")?.value;
              resolve(state.playerAchievements.filter((pa) => pa.gamePlayerId === gamePlayerId && pa.achievementId === achievementId).map((pa) => ({ ...pa })));
            } else {
              reject(new Error("unexpected table in fake select"));
            }
          } catch (err) {
            reject(err);
          }
        },
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === playerAchievements) {
          state.playerAchievements.push({ id: nextPlayerAchievementId++, gamePlayerId: values.gamePlayerId as number, achievementId: values.achievementId as number });
        } else if (table === killFeed) {
          state.killFeed.push({ ...values });
        } else if (table === notifications) {
          state.notifications.push({ ...values });
        } else {
          throw new Error("unexpected insert table in fake tx");
        }
        return [{ insertId: 1 }];
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          const { column, value } = extractEqColumnAndValue(cond);
          if (table === gamePlayers && column === "id") {
            state.players = state.players.map((p) => (p.id === value ? { ...p, ...values } : p));
          } else {
            throw new Error("unexpected update in fake tx");
          }
        },
      }),
    }),
  };
}

const fakeDb = {
  select: vi.fn(() => {
    throw new Error("select() must go through a transaction, not the top-level db handle");
  }),
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCallCount += 1;
    const state = {
      players: committedPlayers.map((p) => ({ ...p })),
      achievements: committedAchievements.map((a) => ({ ...a })),
      playerAchievements: committedPlayerAchievements.map((pa) => ({ ...pa })),
      killFeed: committedKillFeed.map((k) => ({ ...k })),
      notifications: committedNotifications.map((n) => ({ ...n })),
    };
    const tx = makeTx(state);
    const result = await callback(tx);
    committedPlayers = state.players;
    committedAchievements = state.achievements;
    committedPlayerAchievements = state.playerAchievements;
    committedKillFeed = state.killFeed;
    committedNotifications = state.notifications;
    return result;
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { awardAchievementAtomic } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

describe("awardAchievementAtomic", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
    fakeDb.transaction.mockClear();
    fakeDb.select.mockClear();
  });

  it("adds the exact pointsValue on a first-time manual award", async () => {
    const result = await awardAchievementAtomic(5, 9, 1);

    expect(result).toEqual({ awarded: true, pointsAdded: 50, newBalance: 150, achievementName: "First Blood" });
    expect(committedPlayers[0].points).toBe(150);
    expect(committedPlayerAchievements).toHaveLength(1);
  });

  it("repeating the same award adds zero points and reports awarded: false", async () => {
    await awardAchievementAtomic(5, 9, 1);
    const second = await awardAchievementAtomic(5, 9, 1);

    expect(second).toEqual({ awarded: false, pointsAdded: 0, newBalance: 150, achievementName: "First Blood" });
    expect(committedPlayers[0].points).toBe(150); // unchanged by the repeat
    expect(committedPlayerAchievements).toHaveLength(1); // no duplicate row
  });

  it("two achievements awarded to the same player add cumulatively, not overwriting each other", async () => {
    committedAchievements.push({ id: 10, gameId: 1, name: "Public Menace", emoji: "💥", description: "Cause chaos", pointsValue: 30 });

    const first = await awardAchievementAtomic(5, 9, 1);
    const second = await awardAchievementAtomic(5, 10, 1);

    expect(first.newBalance).toBe(150); // 100 + 50
    expect(second.newBalance).toBe(180); // 150 + 30, not 100 + 30
    expect(committedPlayers[0].points).toBe(180);
    expect(committedPlayerAchievements).toHaveLength(2);
  });

  it("preserves and increments the player's existing balance rather than replacing it", async () => {
    committedPlayers[0].points = 275;
    const result = await awardAchievementAtomic(5, 9, 1);
    expect(result.newBalance).toBe(325);
    expect(committedPlayers[0].points).toBe(325);
  });

  it("rolls back both the badge and the points if a write partway through fails", async () => {
    fakeDb.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCallCount += 1;
      const state = {
        players: committedPlayers.map((p) => ({ ...p })),
        achievements: committedAchievements.map((a) => ({ ...a })),
        playerAchievements: committedPlayerAchievements.map((pa) => ({ ...pa })),
        killFeed: committedKillFeed.map((k) => ({ ...k })),
        notifications: committedNotifications.map((n) => ({ ...n })),
      };
      const baseTx = makeTx(state);
      const tx = {
        ...baseTx,
        insert: (table: unknown) => {
          if (table === killFeed) {
            return { values: async () => { throw new Error("simulated kill feed write failure"); } };
          }
          return (baseTx as any).insert(table);
        },
      };
      return await callback(tx); // no commit on throw
    });

    await expect(awardAchievementAtomic(5, 9, 1)).rejects.toThrow("simulated kill feed write failure");

    expect(committedPlayers[0].points).toBe(100); // unchanged
    expect(committedPlayerAchievements).toHaveLength(0); // badge never landed either
  });

  it("only fires the feed event and notification for a newly awarded achievement, not a repeat", async () => {
    await awardAchievementAtomic(5, 9, 1);
    expect(committedKillFeed).toHaveLength(1);
    expect(committedNotifications).toHaveLength(1);

    await awardAchievementAtomic(5, 9, 1); // repeat
    expect(committedKillFeed).toHaveLength(1); // still just the one from the real award
    expect(committedNotifications).toHaveLength(1);
  });

  it("rejects a player/achievement combination that don't belong to the same game", async () => {
    committedPlayers[0].gameId = 1;
    committedAchievements[0].gameId = 2; // achievement belongs to a different game

    await expect(awardAchievementAtomic(5, 9, 1)).rejects.toThrow("Achievement not found in this game");
    expect(committedPlayers[0].points).toBe(100);
    expect(committedPlayerAchievements).toHaveLength(0);
  });

  it("rejects when the player itself belongs to a different game than claimed", async () => {
    committedPlayers[0].gameId = 2; // player is actually in game 2

    await expect(awardAchievementAtomic(5, 9, 1)).rejects.toThrow("Player not found in this game");
    expect(committedPlayerAchievements).toHaveLength(0);
  });
});
