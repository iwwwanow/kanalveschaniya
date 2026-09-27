CREATE TABLE `account_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`retry_after` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`proxy_id` integer,
	`vendor_ref` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_service_id_proxy_id_unique` ON `accounts` (`service_id`,`proxy_id`);--> statement-breakpoint
CREATE TABLE `cookies` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`blob_encrypted` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `proxies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url_pattern` text NOT NULL,
	`requires_cookie` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_name_unique` ON `services` (`name`);