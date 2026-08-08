import { describe, expect, it } from "vitest";
import {
  calculateKillAwards,
  derangedTargetPermutation,
  distanceMeters,
  isOpenSeasonSubmissionEligible,
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
