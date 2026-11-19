CREATE TABLE `tailored_resumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`model` text NOT NULL,
	`resume_hash` text NOT NULL,
	`job_hash` text NOT NULL,
	`tailoring` text NOT NULL,
	`checks` text NOT NULL,
	`decisions` text DEFAULT '{}' NOT NULL,
	`usage` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tailored_resumes_job_version_idx` ON `tailored_resumes` (`job_id`,`version`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `applied_resume_id` integer;