/**
 * CRUD routes for organization_locations — explicit named locations within an
 * organization profile.
 *
 * All routes are nested under /organizations/:id and mounted in organizations.ts.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
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

// ── Input schemas ─────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractId(param: string | string[] | undefined): string {
  return Array.isArray(param) ? (param[0] ?? "") : (param ?? "");
}

// ── Rollup counts ─────────────────────────────────────────────────────────────

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

// ── List summaries ────────────────────────────────────────────────────────────

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

// ── Create ────────────────────────────────────────────────────────────────────

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
    req.log.error({ err }, "Failed to create organization location");
    res.status(500).json({ ok: false, error: "Failed to create location" });
  }
});

// ── Activities page (cursor-keyed) ────────────────────────────────────────────

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

// ── Detail ────────────────────────────────────────────────────────────────────

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

// ── Update ────────────────────────────────────────────────────────────────────

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
    req.log.error({ err }, "Failed to update organization location");
    res.status(500).json({ ok: false, error: "Failed to update location" });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────

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
          "This location has contacts, bookings, activities, or follow-ups associated with it. " +
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
