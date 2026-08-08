# Watergun Assassin — Manus Merge Instructions

This package is a **merge patch**, not a replacement project. Merge the included paths into the current complete Manus project and preserve all other files.

## Required deployment steps

1. Merge every file in this package at the same relative path.
2. Run `pnpm install --frozen-lockfile` (adds the Expo 54-compatible video picker).
3. Run database migrations `drizzle/0009_powerup_rules_and_game_lifecycle.sql` and then `drizzle/0010_roulette_banner_only.sql` exactly once through the normal Drizzle deployment process.
4. In each existing game, open **Admin → Power-Up Setup → Load Full Catalog** once. `seedAll` now updates matching catalog rows instead of inserting duplicates. It also migrates the old `Doppleganger` and `Care package` names.
5. Run `pnpm test` and `pnpm check` in the complete Manus project.
6. Test against a staging/test game before publishing.

## Important: files missing from the supplied archive

The archive provided to Codex did not contain the project's `components/` or `assets/` directories and also omitted several framework files already imported by the app, including:

- `constants/oauth`
- `server/_core/env`, `cookies`, `context`, `notification`, and the server entry file
- `shared/_core/errors`

Do not delete or replace those files in the complete Manus project. Their absence is the only remaining TypeScript-check failure in Codex's copy.

## Database and behavior changes

- Adds 6-hour bounty expirations and submission-time bounty/base-point snapshots.
- Adds round-scoped and purge-paused power-up state, Bodyguard point reservations, duel stakes/evidence, purge scheduling, temporary safe objects, and permanent game deletion support.
- Existing incomplete Sniper's Duel records are safely marked rejected during migration because they have no stakes or submitted evidence.
- Completed games are excluded from active games and remain in Game History. Permanent deletion requires the exact game name and removes related game data.
- Roulette is banner-only and always costs 50 points per spin. It cannot be purchased or activated from inventory. Point outcomes preserve the spin charge, and power-up outcomes insert an eligible power-up into inventory.
- Migration 0010 refunds 50 points for each legacy unused/active Roulette inventory item, consumes those obsolete items, and updates the catalog description.

## Verification already completed

- `pnpm install --frozen-lockfile`: passed.
- `pnpm test`: 5/5 rule tests passed, including Roulette balance calculations.
- Server/schema syntax checks: passed.
- `pnpm check`: changed logic has no type errors; the remaining errors are only unresolved imports for the files absent from the supplied archive, listed above.

## Focused staging checklist

1. Reseed/update the catalog and confirm it remains one row per power-up.
2. Buy a 100-point Bounty; submit before its 6-hour expiry and approve after it; confirm the eliminator receives the correct submission-time payout.
3. Activate Recon and confirm the saved report includes active and unused inventory but does not update after the scan.
4. Test Lucky Charm before a banked Vampire life; confirm Lucky Charm is consumed first and the attacker keeps the kill/points.
5. Test Boomerang against an attacker with and without a defense.
6. Complete a Sniper's Duel: challenger stake, opponent equal/higher stake, witness/result submission, admin approve/reject, 350-point award.
7. Place one visible and one hidden map pickup. Confirm another player's open map refreshes within 15 seconds. Discover the hidden item within 100 m and collect either item within 50 m.
8. Record/select an elimination video, upload it, open it from Admin Review, then approve/deny.
9. Complete a game and verify it appears only in Game History. Create a test game and verify typed-name permanent deletion.
10. Spin Roulette from the Shop banner and confirm exactly 50 points are charged. Force/test a power-up result and confirm the named prize appears in inventory. Confirm Roulette is absent from the purchasable catalog.
