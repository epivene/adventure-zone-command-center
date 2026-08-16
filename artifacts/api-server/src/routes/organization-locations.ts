/**
 * CRUD routes for organization_locations -- explicit named locations within an
 * organization profile.
 *
 * All routes are nested under /organizations/:id and mounted in organizations.ts.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ScopedNoteRepository } from "@/features/notes/scoped-note-repository";
import {
  DrizzleLocationRepository,
} from "@/features/organization-locations/location-repository";

// Express mergeParams:true merges parent `:id` into child params at runtime
// but the TypeScript definition doesn't carry that through. Cast via this type.
type OrgLocationsRequest = Request<{ id: string; locationId?: string }>;

const router = Router({ mergeParams: true });

function locationRepo() {
  return new DrizzleLocationRepository(db);
}
function noteRepo() { return new ScopedNoteRepository(db); }
const noteBodySchema = z.object({ body: z.string().trim().min(1, "Add note text.").max(4000) });

//  Input schemas

const coordinateFields = {
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
};

const coordinateRefine = (data: { lat?: number | null; lng?: number | null }) =>
  (data.lat == null) === (data.lng == null);
const coordinateMessage = "lat and lng must both be provided or both omitted";

const createLocationSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required").max(240),
    venueName: z.string().trim().max(240).optional().nullable(),
    address1: z.string().trim().max(400).optional().nullable(),
    address2: z.string().trim().max(400).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    region: z.string().trim().max(120).optional().nullable(),
    postalCode: z.string().trim().max(20).optional().nullable(),
    website: z.string().trim().max(2048).optional().nullable(),
    phone: z.string().trim().max(80).optional().nullable(),
    email: z.string().trim().max(320).optional().nullable(),
    localStatus: z.string().trim().max(120).optional().nullable(),
    travelLegId: z.string().uuid().optional().nullable(),
    ...coordinateFields,
  })
  .refine(coordinateRefine, { message: coordinateMessage });

const patchLocationSchema = z
  .object({
    label: z.string().trim().min(1).max(240).optional(),
    venueName: z.string().trim().max(240).optional().nullable(),
    address1: z.string().trim().max(400).optional().nullable(),
    address2: z.string().trim().max(400).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    region: z.string().trim().max(120).optional().nullable(),
    postalCode: z.string().trim().max(20).optional().nullable(),
    website: z.string().trim().max(2048).optional().nullable(),
    phone: z.string().trim().max(80).optional().nullable(),
    email: z.string().trim().max(320).optional().nullable(),
    localStatus: z.string().trim().max(120).optional().nullable(),
    travelLegId: z.string().uuid().optional().nullable(),
    ...coordinateFields,
  })
  .refine(
    (data) => {
      // If only one of lat/lng is present in the patch, reject.
      const hasLat = "lat" in data && data.lat != null;
      const hasLng = "lng" in data && data.lng != null;
      if (hasLat !== hasLng) return false;
      return true;
    },
    { message: coordinateMessage },
  );

//  Helpers

function extractId(param: string | string[] | undefined): string {
  return Array.isArray(param) ? (param[0] ?? "") : (param ?? "");
}

//  Rollup counts

router.get("/rollup", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  try {
    const rollup = await locationRepo().rollupForOrganization(organizationId);
    res.json({ rollup });
  } catch (err) {
    req.log.error({ err }, "Failed to compute location rollup");
    res.status(500).json({ error: "Failed to compute location rollup" });
  }
});

//  List summaries

router.get("/", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  try {
    const locations = await locationRepo().findByOrganization(organizationId);
    res.json({ locations });
  } catch (err) {
    req.log.error({ err }, "Failed to list organization locations");
    res.status(500).json({ error: "Failed to list locations" });
  }
});

router.get("/options/travel-legs", async (req: OrgLocationsRequest, res): Promise<void> => {
  try {
    const travelLegs = await locationRepo().listAvailableTravelLegs();
    res.json({ travelLegs });
  } catch (err) {
    req.log.error({ err }, "Failed to list location travel legs");
    res.status(500).json({ error: "Failed to list travel legs" });
  }
});

//  Create

router.post("/", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const parsed = createLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid location data",
    });
    return;
  }
  try {
    const { id } = await locationRepo().create(organizationId, parsed.data, new Date());
    res.status(201).json({ ok: true, id });
  } catch (err) {
    if (err instanceof Error && err.message === "ORGANIZATION_NOT_FOUND") {
      res.status(404).json({ ok: false, error: "Organization not found" });
      return;
    }
    if (err instanceof Error && err.message === "INCOMPLETE_COORDINATE") {
      res.status(400).json({ ok: false, error: "lat and lng must both be provided or both omitted" });
      return;
    }
    if (err instanceof Error && err.message === "TRAVEL_LEG_NOT_FOUND") {
      res.status(400).json({ ok: false, error: "Selected travel leg does not exist" });
      return;
    }
    req.log.error({ err }, "Failed to create organization location");
    res.status(500).json({ ok: false, error: "Failed to create location" });
  }
});

//  Location notes

router.get("/:locationId/notes", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  try {
    if (!(await locationRepo().findById(organizationId, locationId))) { res.status(404).json({ error: "Location not found" }); return; }
    res.json({ notes: await noteRepo().list({ kind: "organization_location", id: locationId }) });
  } catch (err) { req.log.error({ err }, "Failed to list location notes"); res.status(500).json({ error: "Failed to list location notes" }); }
});

router.post("/:locationId/notes", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  const parsed = noteBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note" }); return; }
  try {
    if (!(await locationRepo().findById(organizationId, locationId))) { res.status(404).json({ error: "Location not found" }); return; }
    const result = await noteRepo().create({ kind: "organization_location", id: locationId }, parsed.data.body);
    if (!result.ok) { res.status(404).json({ ok: false, error: "Note owner not found" }); return; }
    res.status(201).json({ ok: true, note: result.note });
  } catch (err) { req.log.error({ err }, "Failed to create location note"); res.status(500).json({ error: "Failed to create location note" }); }
});

router.patch("/:locationId/notes/:noteId", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  const noteId = extractId((req.params as any).noteId);
  const parsed = noteBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note" }); return; }
  try {
    if (!(await locationRepo().findById(organizationId, locationId))) { res.status(404).json({ error: "Location not found" }); return; }
    const result = await noteRepo().update({ kind: "organization_location", id: locationId }, noteId, parsed.data.body);
    if (!result.ok) { res.status(404).json({ ok: false, error: "Note not found for this owner" }); return; }
    res.json({ ok: true, note: result.note });
  } catch (err) { req.log.error({ err }, "Failed to update location note"); res.status(500).json({ error: "Failed to update location note" }); }
});

router.delete("/:locationId/notes/:noteId", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  const noteId = extractId((req.params as any).noteId);
  try {
    if (!(await locationRepo().findById(organizationId, locationId))) { res.status(404).json({ error: "Location not found" }); return; }
    const result = await noteRepo().remove({ kind: "organization_location", id: locationId }, noteId);
    if (!result.ok) { res.status(404).json({ ok: false, error: "Note not found for this owner" }); return; }
    res.json({ ok: true });
  } catch (err) { req.log.error({ err }, "Failed to delete location note"); res.status(500).json({ error: "Failed to delete location note" }); }
});

//  Activities page (cursor-keyed)

router.get("/:locationId/activities", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  try {
    const data = await locationRepo().findLocationActivities(organizationId, locationId, cursor);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to list location activities");
    res.status(500).json({ error: "Failed to list location activities" });
  }
});

//  Detail

router.get("/:locationId", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  try {
    const location = await locationRepo().findById(organizationId, locationId);
    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }
    res.json({ location });
  } catch (err) {
    req.log.error({ err }, "Failed to get organization location");
    res.status(500).json({ error: "Failed to get location" });
  }
});

//  Update

router.patch("/:locationId", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  const parsed = patchLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid location data",
    });
    return;
  }
  try {
    const updated = await locationRepo().update(
      organizationId,
      locationId,
      parsed.data,
      new Date(),
    );
    if (!updated) {
      res.status(404).json({ ok: false, error: "Location not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "INCOMPLETE_COORDINATE") {
      res.status(400).json({ ok: false, error: "lat and lng must both be provided or both omitted" });
      return;
    }
    if (err instanceof Error && err.message === "TRAVEL_LEG_NOT_FOUND") {
      res.status(400).json({ ok: false, error: "Selected travel leg does not exist" });
      return;
    }
    req.log.error({ err }, "Failed to update organization location");
    res.status(500).json({ ok: false, error: "Failed to update location" });
  }
});

//  Delete

router.delete("/:locationId", async (req: OrgLocationsRequest, res): Promise<void> => {
  const organizationId = extractId(req.params.id);
  const locationId = extractId(req.params.locationId);
  try {
    const result = await locationRepo().remove(organizationId, locationId);
    if (result === "not_found") {
      res.status(404).json({ ok: false, error: "Location not found" });
      return;
    }
    if (result === "has_dependents") {
      res.status(409).json({
        ok: false,
        error:
          "This location has contacts, bookings, activities, follow-ups, or calls associated with it. " +
          "Reassign or remove those records before deleting the location.",
      });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete organization location");
    res.status(500).json({ ok: false, error: "Failed to delete location" });
  }
});

export default router;
