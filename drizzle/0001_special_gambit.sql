CREATE TABLE `fusion_reports` (
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`period` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `kind`, `period`)
);
--> statement-breakpoint
CREATE TABLE `fusion_state` (
	`owner` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL
);
