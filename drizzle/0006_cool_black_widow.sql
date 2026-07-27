ALTER TABLE `power_ups` ADD `maxUsesPerGame` int;
--> statement-breakpoint
UPDATE `power_ups`
SET `maxUsesPerGame` = CASE `name`
  WHEN 'Sniper''s Duel' THEN 1
  WHEN 'Jackpot' THEN 1
  WHEN 'Vampire' THEN 1
  WHEN 'Fall Guy' THEN 1
  WHEN 'Frame Job' THEN 1
  WHEN 'Boomerang' THEN 1
  WHEN 'Clean Slate' THEN 1
  WHEN 'Revive' THEN 1
  WHEN 'Untouchable' THEN 1
  WHEN 'Bodyguard' THEN 1
  WHEN 'Respawn' THEN 1
  WHEN 'Sanctuary' THEN 1
  WHEN 'Hitman''s Cut' THEN 2
  WHEN 'Reassignment' THEN 2
  WHEN 'Freaky Friday' THEN 2
  WHEN 'Lifeline' THEN 2
  WHEN 'Bounty Hunter' THEN 3
  WHEN 'Lucky Charm' THEN 3
  WHEN 'Pickpocket' THEN 3
  WHEN 'Wildcard' THEN 3
END
WHERE `maxUsesPerGame` IS NULL
  AND `name` IN (
    'Sniper''s Duel', 'Jackpot', 'Vampire', 'Fall Guy', 'Frame Job', 'Boomerang',
    'Clean Slate', 'Revive', 'Untouchable', 'Bodyguard', 'Respawn', 'Sanctuary',
    'Hitman''s Cut', 'Reassignment', 'Freaky Friday', 'Lifeline',
    'Bounty Hunter', 'Lucky Charm', 'Pickpocket', 'Wildcard'
  );
