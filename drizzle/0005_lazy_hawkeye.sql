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
CREATE TABLE `push_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` text NOT NULL,
	`platform` varchar(10) DEFAULT 'expo',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `push_tokens_id` PRIMARY KEY(`id`)
);
