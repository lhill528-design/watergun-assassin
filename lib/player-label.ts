// Shared display-name resolver for a game_players row. Several screens
// used to fall back to different id spaces when no display name was
// available -- Shop fell back to candidate.id (game_players.id), while
// other screens fell back to userId -- so the exact same person could
// show up as "Player #90001" in one place and "Player #240007" in
// another. game_players.id is an internal join-table row id with no
// meaning to a user; userId is the actual account id and is what every
// fallback here should use.
export interface PlayerLike {
  id: number;
  userId?: number | null;
  displayName?: string | null;
  user?: { displayName?: string | null; name?: string | null } | null;
}

export function playerLabel(player: PlayerLike | null | undefined): string {
  if (!player) return "Player";
  const userDisplayName = player.user?.displayName?.trim();
  if (userDisplayName) return userDisplayName;
  const userName = player.user?.name?.trim();
  if (userName) return userName;
  // Some player-shaped objects (e.g. killFeed actors) carry a flattened
  // displayName directly on the row instead of a nested `user` object.
  const flatDisplayName = player.displayName?.trim();
  if (flatDisplayName) return flatDisplayName;
  // userId (the account id) is the correct fallback id space -- only
  // fall back to game_players.id itself if userId truly isn't present.
  if (player.userId != null) return `Player #${player.userId}`;
  return `Player #${player.id}`;
}
