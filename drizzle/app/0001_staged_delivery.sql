ALTER TABLE `queue` ADD `file_path` text;--> statement-breakpoint
ALTER TABLE `queue` ADD `deliver_retries` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `queue` ADD `deliver_retry_after` integer;