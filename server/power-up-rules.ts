export const BOUNTY_PURCHASE_COST = 100;
export const BOUNTY_TOTAL_PAYOUT = 200;
export const BOUNTY_DURATION_MS = 6 * 60 * 60 * 1000;
export const OPEN_SEASON_WARNING_MS = 5 * 60 * 1000;
export const OPEN_SEASON_ACTIVE_MS = 30 * 60 * 1000;
export const OPEN_SEASON_UPLOAD_GRACE_MS = 5 * 60 * 1000;
export const MAP_DISCOVERY_METERS = 100;
export const MAP_CLAIM_METERS = 50;
export const ROULETTE_SPIN_COST = 50;

export function rouletteBalanceAfterOutcome(
  startingPoints: number,
  outcomeType: string,
  outcomeValue = 0,
) {
  const balanceAfterSpin = Math.max(0, startingPoints - ROULETTE_SPIN_COST);
  if (outcomeType === "points_bonus") return balanceAfterSpin + Math.max(0, outcomeValue);
  if (outcomeType === "points_penalty") return Math.max(0, balanceAfterSpin - Math.max(0, outcomeValue));
  return balanceAfterSpin;
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointFiveMilesAway(latitude: number, longitude: number, angleRadians = Math.random() * Math.PI * 2) {
  const distanceMeters = 5 * 1609.344;
  const earthRadius = 6371000;
  const angularDistance = distanceMeters / earthRadius;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(angleRadians));
  const lon2 = lon1 + Math.atan2(
    Math.sin(angleRadians) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { latitude: lat2 * 180 / Math.PI, longitude: lon2 * 180 / Math.PI };
}

export function openSeasonWindow(activatedAtMs: number) {
  const startsAt = activatedAtMs + OPEN_SEASON_WARNING_MS;
  const activeEndsAt = startsAt + OPEN_SEASON_ACTIVE_MS;
  return { startsAt, activeEndsAt, submissionsCloseAt: activeEndsAt + OPEN_SEASON_UPLOAD_GRACE_MS };
}

export function isOpenSeasonSubmissionEligible(submittedAtMs: number, activatedAtMs: number) {
  const window = openSeasonWindow(activatedAtMs);
  return submittedAtMs >= window.startsAt && submittedAtMs <= window.submissionsCloseAt;
}

export function derangedTargetPermutation(players: Array<{ id: number; targetId: number | null }>) {
  if (players.length < 3) throw new Error("At least three alive players are required");
  const ids = players.map(player => player.id);
  for (let shift = 1; shift < ids.length; shift++) {
    const proposed = players.map((player, index) => ({ playerId: player.id, targetId: ids[(index + shift) % ids.length] }));
    if (proposed.every(pair => pair.playerId !== pair.targetId && players.find(player => player.id === pair.playerId)?.targetId !== pair.targetId)) {
      return proposed;
    }
  }
  throw new Error("No valid one-to-one target reassignment is possible");
}

export function calculateKillAwards(args: {
  basePoints: number;
  jackpot: boolean;
  bountyActive: boolean;
  bountyHunter: boolean;
  bountyBonusPoints?: number;
}) {
  const baseAward = args.basePoints * (args.jackpot ? 2 : 1);
  const bountyAward = !args.bountyActive ? 0 : args.bountyHunter
    ? Math.max(0, 450 - args.basePoints)
    : Math.max(0, args.bountyBonusPoints ?? (BOUNTY_TOTAL_PAYOUT - args.basePoints));
  return { baseAward, bountyAward, total: baseAward + bountyAward };
}
