CREATE TABLE `plants` (
	`owner` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Мојата централа' NOT NULL,
	`capacity_kw` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`start` text NOT NULL,
	`eur_cents` integer NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_price_revisions_start` ON `price_revisions` (`start`);--> statement-breakpoint
CREATE TABLE `prices` (
	`start` text PRIMARY KEY NOT NULL,
	`market_date` text NOT NULL,
	`eur_cents` integer NOT NULL,
	`fetched_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prices_market_date` ON `prices` (`market_date`);--> statement-breakpoint
CREATE TABLE `reading_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`start` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reading_revisions_owner_start` ON `reading_revisions` (`owner`,`start`);--> statement-breakpoint
CREATE TABLE `readings` (
	`owner` text NOT NULL,
	`start` text NOT NULL,
	`production_kwh` real NOT NULL,
	`export_kwh` real,
	`power_kw` real,
	`observed_at` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `start`)
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`market_date` text PRIMARY KEY NOT NULL,
	`attempted_at` text NOT NULL,
	`succeeded_at` text,
	`error` text
);
