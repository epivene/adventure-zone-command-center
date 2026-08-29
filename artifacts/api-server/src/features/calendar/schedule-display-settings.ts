import { sql } from "drizzle-orm";
import { z } from "zod";

import type { db as database } from "@/db/client";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color.");

export const DEFAULT_SCHEDULE_DISPLAY_SETTINGS = {
  eventColor: "#ec4899",
  travelColor: "#94a3b8",
} as const;

export const scheduleDisplaySettingsInputSchema = z.object({
  eventColor: hexColor,
  travelColor: hexColor,
});

export type ScheduleDisplaySettings = z.infer<typeof scheduleDisplaySettingsInputSchema>;
type DrizzleDatabase = typeof database;

type SettingsRow = {
  event_color: string;
  travel_color: string;
};

const schemaPromises = new WeakMap<object, Promise<void>>();

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) return ((result as { rows?: T[] }).rows ?? []);
  return Array.isArray(result) ? (result as T[]) : [];
}

async function ensureSchema(database: DrizzleDatabase): Promise<void> {
  const key = database as unknown as object;
  const existing = schemaPromises.get(key);
  if (existing) return existing;
  const pending = database.execute(sql.raw(`
    create table if not exists schedule_display_settings (
      singleton_key text primary key default 'global',
      event_color text not null default '#ec4899',
      travel_color text not null default '#94a3b8',
      updated_by text,
      updated_at timestamptz not null default now(),
      constraint schedule_display_settings_singleton check (singleton_key = 'global')
    );
  `)).then(() => undefined).catch((error) => {
    schemaPromises.delete(key);
    throw error;
  });
  schemaPromises.set(key, pending);
  return pending;
}

export class DrizzleScheduleDisplaySettingsRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async get(): Promise<ScheduleDisplaySettings> {
    await ensureSchema(this.database);
    const result = await this.database.execute(sql`
      select event_color, travel_color
      from schedule_display_settings
      where singleton_key = 'global'
      limit 1
    `);
    const row = rowsOf<SettingsRow>(result)[0];
    if (!row) return { ...DEFAULT_SCHEDULE_DISPLAY_SETTINGS };
    return scheduleDisplaySettingsInputSchema.parse({ eventColor: row.event_color, travelColor: row.travel_color });
  }

  async save(input: ScheduleDisplaySettings, actorId: string): Promise<ScheduleDisplaySettings> {
    const parsed = scheduleDisplaySettingsInputSchema.parse(input);
    await ensureSchema(this.database);
    const result = await this.database.execute(sql`
      insert into schedule_display_settings (singleton_key, event_color, travel_color, updated_by, updated_at)
      values ('global', ${parsed.eventColor}, ${parsed.travelColor}, ${actorId}, now())
      on conflict (singleton_key) do update set
        event_color = excluded.event_color,
        travel_color = excluded.travel_color,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning event_color, travel_color
    `);
    const row = rowsOf<SettingsRow>(result)[0];
    if (!row) throw new Error("Schedule display settings were not returned after save.");
    return { eventColor: row.event_color, travelColor: row.travel_color };
  }
}
