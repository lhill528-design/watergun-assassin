CREATE TABLE `map_power_up_guesses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mapPowerUpId` int NOT NULL,
	`gamePlayerId` int NOT NULL,
	`guessLatitude` text NOT NULL,
	`guessLongitude` text NOT NULL,
	`guessAddress` text,
	`isCorrect` boolean DEFAULT false,
	`distanceMeters` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `map_power_up_guesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `push_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` text NOT NULL,
	`platform` varchar(10) DEFAULT 'expo',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `push_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `player_power_ups` MODIFY COLUMN `isActive` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `player_power_ups` MODIFY COLUMN `activatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `power_ups` MODIFY COLUMN `category` enum('offensive','defensive','utility','special','chaos') NOT NULL DEFAULT 'utility';--> statement-breakpoint
ALTER TABLE `achievements` ADD `achievementType` varchar(50);--> statement-breakpoint
ALTER TABLE `achievements` ADD `category` varchar(50);--> statement-breakpoint
ALTER TABLE `game_players` ADD `nextRoundTargetId` int;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `status` enum('inventory','pending_payment','active','consumed','expired') DEFAULT 'inventory' NOT NULL;--> statement-breakpoint
UPDATE `player_power_ups` SET `status` = 'active' WHERE `isActive` = true;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `purchasedAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `targetPlayerId` int;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `activationData` json;--> statement-breakpoint
ALTER TABLE `player_power_ups` ADD `usesRemaining` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `power_ups` ADD `usageFeeCents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `isSuperAdmin` boolean DEFAULT false;
