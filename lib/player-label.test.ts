import { describe, expect, it } from "vitest";
import { playerLabel } from "./player-label";

describe("playerLabel", () => {
  it("prefers a trimmed user.displayName", () => {
    expect(playerLabel({ id: 1, userId: 2, user: { displayName: "  Alice  ", name: "alice_account" } })).toBe("Alice");
  });

  it("falls back to a trimmed user.name when displayName is blank/whitespace", () => {
    expect(playerLabel({ id: 1, userId: 2, user: { displayName: "   ", name: "  Bob  " } })).toBe("Bob");
  });

  it("falls back to a flattened displayName field when there's no user object", () => {
    expect(playerLabel({ id: 1, userId: 2, displayName: " Carol " })).toBe("Carol");
  });

  it("prefers user.displayName/user.name over a flattened displayName field", () => {
    expect(playerLabel({ id: 1, userId: 2, displayName: "Flat Name", user: { displayName: "Real Name" } })).toBe("Real Name");
  });

  // The exact regression fixture from the review: the same person must
  // never render as "Player #90001" (game_players.id) in one place and
  // "Player #240007" (userId) in another -- userId is the correct and
  // only numeric fallback whenever it's present.
  it("regression: { id: 90001, userId: 240007, user: undefined } renders as Player #240007, not Player #90001", () => {
    expect(playerLabel({ id: 90001, userId: 240007, user: undefined })).toBe("Player #240007");
  });

  it("falls back to Player #${userId} when there is no name anywhere", () => {
    expect(playerLabel({ id: 5, userId: 99, user: { displayName: null, name: null } })).toBe("Player #99");
    expect(playerLabel({ id: 5, userId: 99 })).toBe("Player #99");
  });

  it("falls back to Player #${id} (game_players.id) only when userId truly does not exist", () => {
    expect(playerLabel({ id: 5, userId: null })).toBe("Player #5");
    expect(playerLabel({ id: 5 } as any)).toBe("Player #5");
  });

  it("returns a generic label for a null/undefined player", () => {
    expect(playerLabel(null)).toBe("Player");
    expect(playerLabel(undefined)).toBe("Player");
  });

  it("treats whitespace-only names as blank", () => {
    expect(playerLabel({ id: 1, userId: 7, user: { displayName: "   ", name: "   " }, displayName: "   " })).toBe("Player #7");
  });
});
