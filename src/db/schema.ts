import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  integer,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("viewer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  stationCode: varchar("station_code", { length: 100 }).unique().notNull(),
  stationName: varchar("station_name", { length: 255 }).notNull(),
  capacity: decimal("capacity"),
  address: text("address"),
  contactPerson: varchar("contact_person", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productionDaily = pgTable(
  "production_daily",
  {
    id: serial("id").primaryKey(),
    stationCode: varchar("station_code", { length: 100 }).notNull(),
    collectDate: date("collect_date").notNull(),
    inverterPower: decimal("inverter_power"),
    feedInPower: decimal("feed_in_power"),
    usePower: decimal("use_power"),
    revenue: decimal("revenue"),
    installedCapacity: decimal("installed_capacity"),
    performanceRatio: decimal("performance_ratio"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_station_date_idx").on(
      table.stationCode,
      table.collectDate
    ),
  ]
);

export const productionMonthly = pgTable(
  "production_monthly",
  {
    id: serial("id").primaryKey(),
    stationCode: varchar("station_code", { length: 100 }).notNull(),
    collectMonth: date("collect_month").notNull(),
    inverterPower: decimal("inverter_power"),
    feedInPower: decimal("feed_in_power"),
    usePower: decimal("use_power"),
    revenue: decimal("revenue"),
    installedCapacity: decimal("installed_capacity"),
    performanceRatio: decimal("performance_ratio"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("monthly_station_month_idx").on(
      table.stationCode,
      table.collectMonth
    ),
  ]
);

export const productionYearly = pgTable(
  "production_yearly",
  {
    id: serial("id").primaryKey(),
    stationCode: varchar("station_code", { length: 100 }).notNull(),
    collectYear: integer("collect_year").notNull(),
    inverterPower: decimal("inverter_power"),
    feedInPower: decimal("feed_in_power"),
    usePower: decimal("use_power"),
    revenue: decimal("revenue"),
    installedCapacity: decimal("installed_capacity"),
    performanceRatio: decimal("performance_ratio"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("yearly_station_year_idx").on(
      table.stationCode,
      table.collectYear
    ),
  ]
);

export const stationRealtime = pgTable("station_realtime", {
  id: serial("id").primaryKey(),
  stationCode: varchar("station_code", { length: 100 }).unique().notNull(),
  dayPower: decimal("day_power"),
  monthPower: decimal("month_power"),
  totalPower: decimal("total_power"),
  dayIncome: decimal("day_income"),
  totalIncome: decimal("total_income"),
  realHealthState: integer("real_health_state"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncLog = pgTable("sync_log", {
  id: serial("id").primaryKey(),
  syncType: varchar("sync_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  errorMessage: text("error_message"),
  recordsSynced: integer("records_synced"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
