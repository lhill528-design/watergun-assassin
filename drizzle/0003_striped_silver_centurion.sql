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
