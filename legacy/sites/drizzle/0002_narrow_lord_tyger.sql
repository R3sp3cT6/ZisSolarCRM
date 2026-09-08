PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_readings` (
	`owner` text NOT NULL,
	`start` text NOT NULL,
	`production_kwh` real,
	`export_kwh` real,
	`power_kw` real,
	`observed_at` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `start`)
);
--> statement-breakpoint
INSERT INTO `__new_readings`("owner", "start", "production_kwh", "export_kwh", "power_kw", "observed_at", "source", "updated_at") SELECT "owner", "start", "production_kwh", "export_kwh", "power_kw", "observed_at", "source", "updated_at" FROM `readings`;--> statement-breakpoint
DROP TABLE `readings`;--> statement-breakpoint
ALTER TABLE `__new_readings` RENAME TO `readings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;