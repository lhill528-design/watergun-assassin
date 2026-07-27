ALTER TABLE `power_ups` MODIFY COLUMN `category` enum('offensive','defensive','utility','special','chaos') NOT NULL DEFAULT 'utility';--> statement-breakpoint
ALTER TABLE `achievements` ADD `achievementType` varchar(50);--> statement-breakpoint
ALTER TABLE `achievements` ADD `category` varchar(50);--> statement-breakpoint
ALTER TABLE `users` ADD `isSuperAdmin` boolean DEFAULT false;