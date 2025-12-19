CREATE TABLE `queue_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`priority` integer DEFAULT 0,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_tasks_url_unique` ON `queue_tasks` (`url`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`filepath` text NOT NULL,
	`source_url` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resources_source_url_unique` ON `resources` (`source_url`);