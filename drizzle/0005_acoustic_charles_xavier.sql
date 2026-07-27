CREATE TABLE `power_up_usage_fees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`gamePlayerId` int NOT NULL,
	`playerPowerUpId` int NOT NULL,
	`amountCents` int NOT NULL,
	`status` enum('pending','paid','waived') NOT NULL DEFAULT 'pending',
	`markedByUserId` int,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `power_up_usage_fees_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `player_power_ups` MODIFY COLUMN `isActive` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `player_power_ups` MODIFY COLUMN `activatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `game_players` ADD `nextRoundTargetId` int;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `status` enum('inventory','pending_payment','active','consumed','expired') DEFAULT 'inventory' NOT NULL;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `purchasedAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `targetPlayerId` int;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `activationData` json;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `usesRemaining` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `power_ups` ADD `usageFeeCents` int DEFAULT 0 NOT NULL;