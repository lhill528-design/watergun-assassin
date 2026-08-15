CREATE TABLE `achievements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`emoji` varchar(10),
	`pointsValue` int DEFAULT 0,
	`condition` text,
	`achievementType` varchar(50),
	`category` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `achievements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bounties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`targetPlayerId` int NOT NULL,
	`placedByPlayerId` int NOT NULL,
	`amount` int NOT NULL,
	`isActive` boolean DEFAULT true,
	`claimedByPlayerId` int,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bounties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`userId` int NOT NULL,
	`message` text NOT NULL,
	`isSystem` boolean DEFAULT false,
	`powerUpIcon` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `duels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`challengerId` int NOT NULL,
	`opponentId` int NOT NULL,
	`status` enum('awaiting_opponent_stake','awaiting_result','pending_review','resolved','rejected') NOT NULL DEFAULT 'awaiting_opponent_stake',
	`winnerId` int,
	`proposedWinnerId` int,
	`challengerStakeId` int,
	`opponentStakeId` int,
	`stakeDeadline` timestamp,
	`evidenceUrl` text,
	`witnessName` varchar(255),
	`submissionNotes` text,
	`submittedAt` timestamp,
	`reviewedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `duels_id` PRIMARY KEY(`id`)
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
	`basePointsAtSubmission` int,
	`bountyPointsAtSubmission` int DEFAULT 0,
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
	`pendingDiscountPercent` int,
	`reviveCredits` int DEFAULT 0,
	`reservedPoints` int DEFAULT 0,
	`kills` int DEFAULT 0,
	`deaths` int DEFAULT 0,
	`targetId` int,
	`nextRoundTargetId` int,
	`partnerId` int,
	`teamId` int,
	`currentSafeObject` varchar(255),
	`latitude` text,
	`longitude` text,
	`locationUpdatedAt` timestamp,
	`locationEnabled` boolean DEFAULT true,
	`bountyPoints` int DEFAULT 0,
	`bountyCount` int DEFAULT 0,
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
	`purgeScheduledAt` timestamp,
	`purgeEndTime` timestamp,
	`roundEndTime` timestamp,
	`endCondition` varchar(255),
	`showLocationsDuringPurge` boolean DEFAULT true,
	`joinCode` varchar(10),
	`inheritTarget` boolean DEFAULT true,
	`startingPoints` int DEFAULT 0,
	`eliminationPoints` int DEFAULT 100,
	`purgeEliminationPoints` int,
	`locationPingInterval` int DEFAULT 15,
	`temporarySafeObject` varchar(255),
	`temporarySafeObjectExpiresAt` timestamp,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `games_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kill_feed` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`eventType` enum('elimination_approved','elimination_denied','revival','purge_start','purge_end','round_start','round_end','game_start','game_end','power_up_used','achievement_earned','bounty_placed','bounty_claimed','location_disabled') NOT NULL,
	`actorId` int,
	`targetId` int,
	`message` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kill_feed_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
	`status` enum('inventory','pending_payment','active','consumed','expired') NOT NULL DEFAULT 'inventory',
	`isActive` boolean DEFAULT false,
	`purchasedAt` timestamp NOT NULL DEFAULT (now()),
	`activatedAt` timestamp,
	`expiresAt` timestamp,
	`targetPlayerId` int,
	`activationData` json,
	`activatedRound` int,
	`pausedAt` timestamp,
	`remainingDurationSeconds` int,
	`lockedForDuelId` int,
	`usesRemaining` int NOT NULL DEFAULT 1,
	CONSTRAINT `player_power_ups_id` PRIMARY KEY(`id`)
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
CREATE TABLE `power_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`emoji` varchar(10) NOT NULL,
	`effect` text NOT NULL,
	`cost` int NOT NULL,
	`usageFeeCents` int NOT NULL DEFAULT 0,
	`duration` int,
	`maxUsesPerGame` int,
	`isEnabled` boolean DEFAULT true,
	`discount` int DEFAULT 0,
	`category` enum('offensive','defensive','utility','special','chaos') NOT NULL DEFAULT 'utility',
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `power_ups_id` PRIMARY KEY(`id`)
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
CREATE TABLE `roulette_outcomes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`emoji` varchar(10) NOT NULL,
	`type` enum('power_up','points_bonus','points_penalty','discount_coupon','nothing','custom') NOT NULL,
	`value` int DEFAULT 0,
	`powerUpId` int,
	`weight` int NOT NULL DEFAULT 1,
	`description` text,
	`isEnabled` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roulette_outcomes_id` PRIMARY KEY(`id`)
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
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clerkId` varchar(64) NOT NULL,
	`name` text,
	`displayName` varchar(50),
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`isSuperAdmin` boolean DEFAULT false,
	`avatarUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_clerkId_unique` UNIQUE(`clerkId`)
);
