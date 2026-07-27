CREATE TABLE `bounties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`targetPlayerId` int NOT NULL,
	`placedByPlayerId` int NOT NULL,
	`amount` int NOT NULL,
	`isActive` boolean DEFAULT true,
	`claimedByPlayerId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bounties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`gameId` int,
	`type` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `kill_feed` MODIFY COLUMN `eventType` enum('elimination_approved','elimination_denied','revival','purge_start','purge_end','round_start','round_end','game_start','game_end','power_up_used','achievement_earned','bounty_placed','bounty_claimed','location_disabled') NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `powerUpIcon` varchar(10);--> statement-breakpoint
ALTER TABLE `game_players` ADD `locationEnabled` boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE `game_players` ADD `bountyPoints` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `game_players` ADD `bountyCount` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `games` ADD `joinCode` varchar(10);--> statement-breakpoint
ALTER TABLE `games` ADD `inheritTarget` boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE `games` ADD `startingPoints` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `games` ADD `eliminationPoints` int DEFAULT 100;--> statement-breakpoint
ALTER TABLE `games` ADD `locationPingInterval` int DEFAULT 15;--> statement-breakpoint
ALTER TABLE `power_ups` ADD `description` text;