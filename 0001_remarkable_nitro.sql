CREATE TABLE `achievements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`emoji` varchar(10),
	`pointsValue` int DEFAULT 0,
	`condition` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `achievements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`userId` int NOT NULL,
	`message` text NOT NULL,
	`isSystem` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `eliminations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`eliminatorId` int NOT NULL,
	`eliminatedId` int NOT NULL,
	`videoUrl` text,
	`status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
	`reviewedBy` int,
	`round` int DEFAULT 1,
	`pointsAwarded` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	CONSTRAINT `eliminations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_players` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('alive','eliminated','safe') NOT NULL DEFAULT 'alive',
	`hasPaid` boolean DEFAULT false,
	`points` int DEFAULT 0,
	`kills` int DEFAULT 0,
	`deaths` int DEFAULT 0,
	`targetId` int,
	`partnerId` int,
	`teamId` int,
	`currentSafeObject` varchar(255),
	`latitude` text,
	`longitude` text,
	`locationUpdatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `game_players_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`ruleText` text NOT NULL,
	`isStandard` boolean DEFAULT false,
	`isEnabled` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `game_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`gameType` enum('last_man_standing','highest_points','most_eliminations','teams') NOT NULL,
	`status` enum('setup','active','paused','completed') NOT NULL DEFAULT 'setup',
	`entryFee` int DEFAULT 0,
	`roundLength` int DEFAULT 72,
	`currentRound` int DEFAULT 0,
	`safeObject` varchar(255),
	`targetAssignment` enum('auto','manual') NOT NULL DEFAULT 'auto',
	`purgeActive` boolean DEFAULT false,
	`purgeEndTime` timestamp,
	`roundEndTime` timestamp,
	`endCondition` varchar(255),
	`showLocationsDuringPurge` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `games_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kill_feed` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`eventType` enum('elimination_approved','elimination_denied','revival','purge_start','purge_end','round_start','round_end','game_start','game_end','power_up_used','achievement_earned') NOT NULL,
	`actorId` int,
	`targetId` int,
	`message` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kill_feed_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `map_power_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`powerUpId` int NOT NULL,
	`latitude` text NOT NULL,
	`longitude` text NOT NULL,
	`isVisible` boolean DEFAULT true,
	`clue` text,
	`claimedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `map_power_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `player_achievements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gamePlayerId` int NOT NULL,
	`achievementId` int NOT NULL,
	`earnedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `player_achievements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `player_power_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gamePlayerId` int NOT NULL,
	`powerUpId` int NOT NULL,
	`gameId` int NOT NULL,
	`isActive` boolean DEFAULT true,
	`activatedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `player_power_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `power_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`emoji` varchar(10) NOT NULL,
	`effect` text NOT NULL,
	`cost` int NOT NULL,
	`duration` int,
	`isEnabled` boolean DEFAULT true,
	`discount` int DEFAULT 0,
	`category` enum('offensive','defensive','utility','special') NOT NULL DEFAULT 'utility',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `power_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatarUrl` text;