# Power-up inventory implementation

## Files to install

- `drizzle/schema.ts` → database schema
- `server/db.ts` → server database module
- `server/routers.ts` → server tRPC router
- `server/push-service.ts` → push-notification helper required by the newer router
- `app/(tabs)/shop.tsx` → player shop and inventory screen
- `app/admin/power-ups.tsx` → administrator power-up and fee screen
- `app/admin/achievements.tsx` → administrator achievement screen
- `drizzle/0004_careless_jubilee.sql` and `drizzle/meta/*` → generated Drizzle migration

Run the normal Manus/Drizzle migration process before deploying the updated server. The generated `0004_careless_jubilee.sql` migration preserves existing active inventory records.

## New purchase and activation flow

1. Purchasing deducts points and creates an `inventory` record.
2. No timer starts at purchase time.
3. The player selects any required target or option and taps **Activate**.
4. If the power-up has a manual cash fee, activation creates a pending fee instead.
5. The game administrator marks the fee **Paid** or **Waived**.
6. The player taps **Activate** again; the effect begins and its timer starts.

## Manual fees seeded from the spreadsheet

- Bounty: $5.00
- Raise the Stakes: $10.00
- Clean Slate: $5.00
- Revive: $15.00
- Respawn: $7.50
- Witness Protection: $5.00
- Sanctuary: $5.00
- Lifeline: $5.00
- Wildcard: $5.00

Amounts are stored as integer cents to avoid floating-point money errors.

## Server-enforced effects included

- Inventory and delayed activation for every power-up
- Blacklist, Asset Freeze, and Sabotage shop restrictions
- Bounty, Raise the Stakes, Clean Slate, and Frame Job bounty changes
- Killswitch and Strip Search removal
- Immunity Shield, Untouchable, Witness Protection, Lucky Charm, Bodyguard, Fall Guy, and Boomerang elimination handling
- Jackpot, Bounty Hunter, Hitman's Cut, and Open Season point bonuses
- Radar, Blackout, Dead Zone, Burner Phone, Doppleganger, and Smoke Screen visibility changes
- Reassignment, Freaky Friday, and Wildcard target changes
- Revive, Respawn, Lifeline, Pickpocket, Care package, Monkey Wrench, and Mirror, Mirror actions
- Expiration cleanup and once-used inventory consumption

## Effects requiring additional game-rule decisions

The inventory framework stores and times these items, but the following mechanics need product-specific input before they can be fully enforced:

- **Sniper's Duel:** exact duel acceptance, cancellation, and winner rules
- **Vendetta:** whether prior targets persist for one round or the entire game
- **Vampire:** whether extra lives revive automatically and what happens to target assignments
- **Decoy:** how the player chooses a fake map location
- **Radar Detector:** notification cooldown to prevent repeated alerts from map refreshes
- **Sanctuary:** how its physical boundary is selected and verified
- **Roulette power-up:** whether activating it opens the existing wheel for free or immediately performs a server-side spin

These should not be guessed because each choice changes competitive outcomes. The new `activationData` field is designed to store the selections once those rules are confirmed.
