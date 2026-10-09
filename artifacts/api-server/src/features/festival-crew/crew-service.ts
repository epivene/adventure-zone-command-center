import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { festivalEditions, festivalCrewStops, organizations } from "@/db/schema";
import type { FestivalCrewStopInput, FestivalVenuePinInput } from "@workspace/api-zod";
import { validCoordinates } from "./places-provider";

export class CrewRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const scope = (id: string, year: number) => and(eq(festivalEditions.organizationId, id), eq(festivalEditions.year, year));
function pinFrom(details: Record<string, string>) {
  const latitude = Number(details.venueLatitude), longitude = Number(details.venueLongitude);
  if (!details.venue || details.venuePinAddress !== details.venue || !details.venueLatitude || !details.venueLongitude || !validCoordinates(latitude, longitude)) return null;
  return { latitude, longitude, displayName: details.venuePinLabel || details.venue };
}
export function stopResponse(row: typeof festivalCrewStops.$inferSelect) {
  return { ...row.data, sourceKey: row.sourceKey, id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function getCrewLocation(id: string, year: number, database = db) {
  const [organization] = await database.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id));
  if (!organization) throw new CrewRequestError(404, "Profile not found.");
  const [edition] = await database.select().from(festivalEditions).where(scope(id, year));
  if (!edition) return { venue: "", editionUpdatedAt: null, location: null, stops: [] };
  const rows = await database.select().from(festivalCrewStops).where(eq(festivalCrewStops.editionId, edition.id));
  return { venue: edition.details.venue || "", editionUpdatedAt: edition.updatedAt.toISOString(), location: pinFrom(edition.details), stops: rows.map(stopResponse) };
}
export async function saveVenuePin(id: string, year: number, input: FestivalVenuePinInput, database = db) {
  await database.transaction(async tx => {
    // Use the same org-first lock order as the existing annual-details editor.
    await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).for("update");
    const [edition] = await tx.select().from(festivalEditions).where(scope(id, year)).for("update");
    if (!edition?.details.venue?.trim()) throw new CrewRequestError(409, "Add this year's venue in event details before confirming its map pin.");
    if (edition.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new CrewRequestError(409, "This event year changed. Reload before confirming the venue pin.");
    const details = { ...edition.details, venueLatitude: String(input.latitude), venueLongitude: String(input.longitude), venuePinAddress: edition.details.venue, venuePinLabel: input.displayName.trim() || edition.details.venue };
    await tx.update(festivalEditions).set({ details, updatedAt: new Date(Math.max(Date.now(), edition.updatedAt.getTime() + 1)) }).where(eq(festivalEditions.id, edition.id));
  });
  return getCrewLocation(id, year, database);
}
export async function saveCrewStop(id: string, year: number, stopId: string | null, input: FestivalCrewStopInput, database = db) {
  return database.transaction(async tx => {
    const [edition] = await tx.select().from(festivalEditions).where(scope(id, year)).for("update");
    if (!edition) throw new CrewRequestError(409, "Add an event-year record before saving crew stops.");
    const { expectedUpdatedAt, sourceKey, ...data } = input;
    data.name = data.name.trim();
    const where = stopId ? and(eq(festivalCrewStops.id, stopId), eq(festivalCrewStops.editionId, edition.id)) : undefined;
    const [current] = where ? await tx.select().from(festivalCrewStops).where(where).for("update") : [];
    if (stopId && !current) throw new CrewRequestError(404, "This stop does not belong to the selected event year.");
    if (stopId && current!.updatedAt.toISOString() !== expectedUpdatedAt) throw new CrewRequestError(409, "This stop changed in another session. Reload before saving.");
    if (!stopId && expectedUpdatedAt !== null) throw new CrewRequestError(400, "New stops must not have an update timestamp.");
    if (sourceKey) {
      const [duplicate] = await tx.select({ id: festivalCrewStops.id }).from(festivalCrewStops).where(and(eq(festivalCrewStops.editionId, edition.id), eq(festivalCrewStops.sourceKey, sourceKey)));
      if (duplicate && duplicate.id !== stopId) throw new CrewRequestError(409, "That suggested place is already saved. Edit its saved crew stop instead.");
    }
    const [saved] = current
      ? await tx.update(festivalCrewStops).set({ data, sourceKey, updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) }).where(where!).returning()
      : await tx.insert(festivalCrewStops).values({ editionId: edition.id, sourceKey, data }).returning();
    return stopResponse(saved);
  });
}
export async function removeCrewStop(id: string, year: number, stopId: string, expected: string, database = db) {
  await database.transaction(async tx => {
    const [edition] = await tx.select().from(festivalEditions).where(scope(id, year)).for("update");
    if (!edition) throw new CrewRequestError(404, "Event year not found.");
    const where = and(eq(festivalCrewStops.id, stopId), eq(festivalCrewStops.editionId, edition.id));
    const [stop] = await tx.select().from(festivalCrewStops).where(where).for("update");
    if (!stop) throw new CrewRequestError(404, "This stop does not belong to the selected event year.");
    if (stop.updatedAt.toISOString() !== expected) throw new CrewRequestError(409, "This stop changed. Reload before removing it.");
    await tx.delete(festivalCrewStops).where(where);
  });
}
