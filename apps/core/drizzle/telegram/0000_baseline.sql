-- Baseline: IF NOT EXISTS (edited by hand) so it is also a no-op on databases that predate Drizzle.
CREATE TABLE IF NOT EXISTS `telegram_reply_refs` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `telegram_resource_refs` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`channel_message_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`username` text,
	`first_seen` integer DEFAULT (unixepoch())
);
