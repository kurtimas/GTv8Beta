CREATE TABLE `bins` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`crop` varchar(64) NOT NULL,
	`capacityLbs` int NOT NULL,
	`currentLbs` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `eod_reports` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`day` varchar(10) NOT NULL,
	`sheetsOpened` int NOT NULL DEFAULT 0,
	`loadCount` int NOT NULL DEFAULT 0,
	`completedCount` int NOT NULL DEFAULT 0,
	`inboundLbs` int NOT NULL DEFAULT 0,
	`outboundLbs` int NOT NULL DEFAULT 0,
	`inboundBu` double NOT NULL DEFAULT 0,
	`outboundBu` double NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `eod_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `farmers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(64),
	`email` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `farmers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `landlords` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `landlords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loads` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sheetId` bigint unsigned NOT NULL,
	`loadNo` int NOT NULL,
	`truckId` varchar(64),
	`driverName` varchar(255),
	`binId` bigint unsigned,
	`grossLbs` int,
	`tareLbs` int,
	`netLbs` int,
	`grossAt` timestamp,
	`tareAt` timestamp,
	`moisturePct` double,
	`dockagePct` double,
	`testWeightLbs` double,
	`proteinPct` double,
	`shrinkPct` double,
	`grossBushels` double,
	`netBushels` double,
	`changeReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`farmerId` bigint unsigned NOT NULL,
	`landlordId` bigint unsigned,
	`code` varchar(64) NOT NULL,
	`crop` varchar(64) NOT NULL,
	`landlordSplitPct` double NOT NULL DEFAULT 0,
	`status` enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `lots_id` PRIMARY KEY(`id`),
	CONSTRAINT `lots_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` text,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `sheet_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sheetId` bigint unsigned NOT NULL,
	`loadId` bigint unsigned,
	`action` varchar(64) NOT NULL,
	`detail` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sheet_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`location` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`direction` enum('PUSH','PULL','RECEIVE') NOT NULL,
	`status` enum('OK','ERROR') NOT NULL,
	`detail` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sync_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weight_sheets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`ticketNo` varchar(32) NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`farmerId` bigint unsigned NOT NULL,
	`lotId` bigint unsigned,
	`landlordId` bigint unsigned,
	`crop` varchar(64) NOT NULL,
	`direction` enum('INBOUND','OUTBOUND') NOT NULL DEFAULT 'INBOUND',
	`status` enum('OPEN','FULL','CLOSED') NOT NULL DEFAULT 'OPEN',
	`closeReason` varchar(16),
	`maxLoads` int NOT NULL DEFAULT 10,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`closedAt` timestamp,
	CONSTRAINT `weight_sheets_id` PRIMARY KEY(`id`),
	CONSTRAINT `weight_sheets_ticketNo_unique` UNIQUE(`ticketNo`)
);
--> statement-breakpoint
CREATE INDEX `bins_site_idx` ON `bins` (`siteId`);--> statement-breakpoint
CREATE INDEX `eod_site_idx` ON `eod_reports` (`siteId`);--> statement-breakpoint
CREATE INDEX `eod_day_idx` ON `eod_reports` (`day`);--> statement-breakpoint
CREATE INDEX `loads_sheet_idx` ON `loads` (`sheetId`);--> statement-breakpoint
CREATE INDEX `loads_truck_idx` ON `loads` (`truckId`);--> statement-breakpoint
CREATE INDEX `loads_created_idx` ON `loads` (`createdAt`);--> statement-breakpoint
CREATE INDEX `lots_farmer_idx` ON `lots` (`farmerId`);--> statement-breakpoint
CREATE INDEX `lots_code_idx` ON `lots` (`code`);--> statement-breakpoint
CREATE INDEX `events_sheet_idx` ON `sheet_events` (`sheetId`);--> statement-breakpoint
CREATE INDEX `sheets_farmer_idx` ON `weight_sheets` (`farmerId`);--> statement-breakpoint
CREATE INDEX `sheets_lot_idx` ON `weight_sheets` (`lotId`);--> statement-breakpoint
CREATE INDEX `sheets_landlord_idx` ON `weight_sheets` (`landlordId`);--> statement-breakpoint
CREATE INDEX `sheets_status_idx` ON `weight_sheets` (`status`);--> statement-breakpoint
CREATE INDEX `sheets_created_idx` ON `weight_sheets` (`createdAt`);