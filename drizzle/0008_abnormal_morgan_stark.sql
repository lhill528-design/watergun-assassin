CREATE TABLE `duels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`challengerId` int NOT NULL,
	`opponentId` int NOT NULL,
	`status` enum('pending','resolved') NOT NULL DEFAULT 'pending',
	`winnerId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `duels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `game_players` ADD `reviveCredits` int DEFAULT 0;
