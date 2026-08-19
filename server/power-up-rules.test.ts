import { describe, expect, it } from "vitest";
import {
  calculateKillAwards,
  circularTargetChain,
  derangedTargetPermutation,
  distanceMeters,
  isOpenSeasonSubmissionEligible,
  isValidOneToOneTargetAssignment,
  openSeasonWindow,
  pointFiveMilesAway,
  rouletteBalanceAfterOutcome,
} from "./power-up-rules";

describe("power-up rules", () => {
  it("places a Decoy five miles from its anchor", () => {
    const decoy = pointFiveMilesAway(35.2271, -80.8431, 0);
    expect(distanceMeters(35.2271, -80.8431, decoy.latitude, decoy.longitude)).toBeCloseTo(8046.72, 0);
  });

  it("includes the five-minute Open Season upload grace", () => {
    const activated = Date.UTC(2026, 7, 3, 12);
    const window = openSeasonWindow(activated);
    expect(isOpenSeasonSubmissionEligible(window.startsAt - 1, activated)).toBe(false);
    expect(isOpenSeasonSubmissionEligible(window.submissionsCloseAt, activated)).toBe(true);
    expect(isOpenSeasonSubmissionEligible(window.submissionsCloseAt + 1, activated)).toBe(false);
  });

  it("reassigns targets one-to-one without self or retained targets", () => {
    const players = [{ id: 1, targetId: 2 }, { id: 2, targetId: 3 }, { id: 3, targetId: 1 }];
    const result = derangedTargetPermutation(players);
    expect(new Set(result.map(pair => pair.targetId)).size).toBe(3);
    expect(result.every(pair => pair.playerId !== pair.targetId)).toBe(true);
    expect(result.every(pair => players.find(player => player.id === pair.playerId)?.targetId !== pair.targetId)).toBe(true);
  });

  it("keeps bounty payouts fixed while Jackpot doubles base only", () => {
    expect(calculateKillAwards({ basePoints: 100, jackpot: false, bountyActive: true, bountyHunter: false })).toEqual({ baseAward: 100, bountyAward: 100, total: 200 });
    expect(calculateKillAwards({ basePoints: 100, jackpot: true, bountyActive: true, bountyHunter: true })).toEqual({ baseAward: 200, bountyAward: 350, total: 550 });
  });

  it("charges 50 points for every Roulette spin before applying its outcome", () => {
    expect(rouletteBalanceAfterOutcome(100, "nothing")).toBe(50);
    expect(rouletteBalanceAfterOutcome(100, "points_bonus", 50)).toBe(100);
    expect(rouletteBalanceAfterOutcome(100, "points_penalty", 25)).toBe(25);
  });
});

describe("circularTargetChain", () => {
  it("rejects fewer than 2 players", () => {
    expect(() => circularTargetChain([1])).toThrow("at least 2");
    expect(() => circularTargetChain([])).toThrow("at least 2");
  });

  it("builds a one-to-one circular chain: no self-targets, every player targeted exactly once", () => {
    const ids = [1, 2, 3, 4, 5];
    const chain = circularTargetChain(ids);

    expect(chain).toHaveLength(5);
    expect(chain.every(pair => pair.playerId !== pair.targetId)).toBe(true);
    expect(new Set(chain.map(pair => pair.playerId))).toEqual(new Set(ids));
    // Every player is targeted by exactly one other player -- a bijection.
    const targetCounts = new Map<number, number>();
    for (const pair of chain) targetCounts.set(pair.targetId, (targetCounts.get(pair.targetId) ?? 0) + 1);
    for (const id of ids) expect(targetCounts.get(id)).toBe(1);
  });

  it("works for exactly 2 players -- each targets the other", () => {
    const chain = circularTargetChain([10, 20]);
    expect(chain).toHaveLength(2);
    expect(chain.find(pair => pair.playerId === 10)?.targetId).toBe(20);
    expect(chain.find(pair => pair.playerId === 20)?.targetId).toBe(10);
  });
});

describe("isValidOneToOneTargetAssignment", () => {
  it("accepts a valid circular chain", () => {
    const players = [{ id: 1, targetId: 2 }, { id: 2, targetId: 3 }, { id: 3, targetId: 1 }];
    expect(isValidOneToOneTargetAssignment(players)).toBe(true);
  });

  it("rejects fewer than 2 players", () => {
    expect(isValidOneToOneTargetAssignment([{ id: 1, targetId: null }])).toBe(false);
  });

  it("rejects a missing target", () => {
    const players = [{ id: 1, targetId: 2 }, { id: 2, targetId: null }];
    expect(isValidOneToOneTargetAssignment(players)).toBe(false);
  });

  it("rejects self-targeting", () => {
    const players = [{ id: 1, targetId: 1 }, { id: 2, targetId: 1 }];
    expect(isValidOneToOneTargetAssignment(players)).toBe(false);
  });

  it("rejects a target outside the alive set", () => {
    const players = [{ id: 1, targetId: 99 }, { id: 2, targetId: 1 }];
    expect(isValidOneToOneTargetAssignment(players)).toBe(false);
  });

  it("rejects a player targeted by more than one other player (not a bijection)", () => {
    const players = [{ id: 1, targetId: 3 }, { id: 2, targetId: 3 }, { id: 3, targetId: 1 }];
    expect(isValidOneToOneTargetAssignment(players)).toBe(false);
  });

  it("rejects a player targeted by nobody", () => {
    // 1 -> 2, 2 -> 1, 3 -> 1: player 3 is never targeted.
    const players = [{ id: 1, targetId: 2 }, { id: 2, targetId: 1 }, { id: 3, targetId: 1 }];
    expect(isValidOneToOneTargetAssignment(players)).toBe(false);
  });
});
