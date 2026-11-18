CREATE TABLE `companies` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ats` text NOT NULL,
	`last_run_id` text NOT NULL,
	`last_run_at` text NOT NULL,
	`last_status` text NOT NULL,
	`last_complete` integer NOT NULL,
	`last_fetched` integer NOT NULL,
	`last_kept` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `ingest_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`run_created_at` text NOT NULL,
	`synced_at` text NOT NULL,
	`outcome` text NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	`reopened` integer DEFAULT 0 NOT NULL,
	`missing` integer DEFAULT 0 NOT NULL,
	`report` text
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`source` text NOT NULL,
	`source_job_id` text NOT NULL,
	`company_slug` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text,
	`location_text` text NOT NULL,
	`country` text,
	`workplace_type` text,
	`eligibility` text NOT NULL,
	`salary_min` real,
	`salary_max` real,
	`salary_currency` text,
	`salary_period` text,
	`description_html` text NOT NULL,
	`description_text` text NOT NULL,
	`posted_at` text,
	`updated_at` text,
	`content_hash` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`closed_at` text,
	`last_run_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `jobs_company_open_idx` ON `jobs` (`company_slug`,`closed_at`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_idx` ON `jobs` (`dedupe_key`);