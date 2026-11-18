CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`ats` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`supported` integer NOT NULL,
	`note` text,
	`via` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`source_text` text,
	`open_jobs` integer,
	`matching_jobs` integer,
	`check_error` text,
	`checked_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `suggestions_status_idx` ON `suggestions` (`status`);