UPDATE `game_players` gp
INNER JOIN (
  SELECT ppu.`gamePlayerId`, COUNT(*) AS `rouletteCount`
  FROM `player_power_ups` ppu
  INNER JOIN `power_ups` pu ON pu.`id` = ppu.`powerUpId`
  WHERE pu.`name` = 'Roulette'
    AND ppu.`status` IN ('inventory', 'pending_payment', 'active')
  GROUP BY ppu.`gamePlayerId`
) refunds ON refunds.`gamePlayerId` = gp.`id`
SET gp.`points` = COALESCE(gp.`points`, 0) + (refunds.`rouletteCount` * 50);
--> statement-breakpoint
UPDATE `player_power_ups` ppu
INNER JOIN `power_ups` pu ON pu.`id` = ppu.`powerUpId`
SET ppu.`status` = 'consumed',
    ppu.`isActive` = false,
    ppu.`expiresAt` = NOW()
WHERE pu.`name` = 'Roulette'
  AND ppu.`status` IN ('inventory', 'pending_payment', 'active');
--> statement-breakpoint
UPDATE `power_ups`
SET `cost` = 50,
    `discount` = 0,
    `duration` = NULL,
    `effect` = 'Pay 50 points and spin directly from the Shop banner',
    `description` = 'Roulette is opened from the Shop banner. It is not purchased, stored, or activated as an inventory power-up.'
WHERE `name` = 'Roulette';
