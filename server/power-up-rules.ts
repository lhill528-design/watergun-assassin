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

// Auto-assign, unlike derangedTargetPermutation above (which reassigns
// existing targets for something like Freaky Friday and specifically
// avoids anyone keeping their current target), builds a fresh circular
// chain from scratch: shuffle the alive players, then each targets the
// next one in the shuffled order, wrapping around. Two players is enough
// (each targets the other); derangedTargetPermutation's >=3 requirement
// doesn't apply here since there's no existing assignment to avoid.
export function circularTargetChain(playerIds: number[]): Array<{ playerId: number; targetId: number }> {
  if (playerIds.length < 2) throw new Error("Need at least 2 alive players to assign targets");
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((playerId, index) => ({ playerId, targetId: shuffled[(index + 1) % shuffled.length] }));
}

// Used to gate starting a round: every alive player must have exactly one
// target, targeting another alive player, nobody targeting themselves,
// and every alive player targeted by exactly one other alive player (a
// bijection over the alive set) -- not just "everyone has *a* target".
export function isValidOneToOneTargetAssignment(alivePlayers: Array<{ id: number; targetId: number | null }>): boolean {
  if (alivePlayers.length < 2) return false;
  const aliveIds = new Set(alivePlayers.map(player => player.id));
  const targetedCounts = new Map<number, number>();
  for (const player of alivePlayers) {
    if (player.targetId == null) return false;
    if (player.targetId === player.id) return false;
    if (!aliveIds.has(player.targetId)) return false;
    targetedCounts.set(player.targetId, (targetedCounts.get(player.targetId) ?? 0) + 1);
  }
  return alivePlayers.every(player => targetedCounts.get(player.id) === 1);
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
