-- Baseline: IF NOT EXISTS (edited by hand) so it is also a no-op on databases that predate Drizzle.
CREATE TABLE IF NOT EXISTS `error_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`url` text NOT NULL,
	`error` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`resource_id` text,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`block_reason` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`retry_after` integer DEFAULT 0,
	`error` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `resource` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`duration` integer,
	`cached_at` integer DEFAULT (unixepoch())
);
