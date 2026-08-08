# Implementation Summary

## Roulette banner-only correction

- Removed Roulette from the purchasable Shop catalog; the banner is its only player entry point.
- Enforced a fixed 50-point server-side spin charge and corrected point outcomes so they no longer overwrite that charge with the pre-spin balance.
- Power-up outcomes now add a named, eligible power-up to inventory, including the default random “Free Power-Up” outcome.
- Added migration `0010_roulette_banner_only.sql` to consume and refund legacy Roulette inventory items.
- Added automated Roulette balance tests.

The code now implements the finalized rules across catalog descriptions, activation validation, map visibility, elimination approval, points, revival priority, notifications/feed events, admin approval flows, game lifecycle, and evidence upload.

Key corrected paths include:

- Recon one-use saved snapshot of the current normal target.
- Open Season 5-minute warning + 30 minutes + 5-minute submission grace, with approval-later eligibility.
- Bounty price 100, six-hour expiry, stacking, Raise the Stakes without bounty creation, and submission-time payout snapshots.
- Lucky Charm-before-Vampire priority; Vampire earns lives from other approved eliminations game-wide.
- Boomerang redirects onto the attacker; Fall Guy and Vendetta use their special target-chain rules.
- Killswitch destroys active effects except Sanctuary; Strip Search destroys any alive player's active Immunity Shield.
- Public shield/Untouchable badges and admin-review protection visibility.
- Decoy manual/automatic anchors with a fixed marker exactly five miles away.
- Doppelganger conflicts and chained location swaps.
- Sanctuary address/current-location submission, admin approve/return, and public 30 m map zone.
- Sniper's Duel stakes, mandatory response, one-hour lowest-value auto-stake fallback, evidence/witness result submission, admin review, 350 points, and stake transfer/return.
- Pickpocket and Care Package named kill-feed entries.
- Revive, Respawn, and Lifeline validation, fee queue behavior, notifications, and target-chain repair.
- Smoke Screen blocks map list/proximity/guess/claim; hidden map coordinates remain redacted until discovery; collection is distance-validated.
- Direct Roulette no longer charges when no outcomes are configured.
- Admin permanent-delete workflow, active/history separation, and real video evidence upload.
