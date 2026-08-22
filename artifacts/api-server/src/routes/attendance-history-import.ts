import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  attendanceImportRows,
  organizationLocations,
  organizations,
} from "@/db/schema";
import { AttendanceImportRepository } from "@/features/attendance/attendance-import-repository";
import { ensureAttendanceImportSeed } from "@/features/attendance/attendance-import-seed";
import {
  chooseAttendanceMatch,
  findPlausibleAttendanceCandidates,
  normalizeAttendanceText,
} from "@/features/attendance/attendance-matcher";

const router: IRouter = Router();
const repository = new AttendanceImportRepository(db);
const rowIdSchema = z.string().uuid();
const stateSchema = z.enum([
  "pending",
  "confident",
  "approved",
  "new_profile_candidate",
  "rejected",
]);
const approveSchema = z.object({
  organizationId: z.string().uuid(),
  organizationLocationId: z.string().uuid().nullable().optional(),
}).strict();
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function activeOrganization(organizationId: string) {
  return (
    (
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, organizationId),
            isNull(organizations.consolidatedIntoId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

router.get("/imports/attendance-history", async (req, res): Promise<void> => {
  const rawState = typeof req.query.state === "string" ? req.query.state : undefined;
  const parsedState = rawState ? stateSchema.safeParse(rawState) : null;
  if (parsedState && !parsedState.success) {
    res.status(400).json({ error: "Unknown attendance import state." });
    return;
  }
  try {
    await ensureAttendanceImportSeed(db);
    const rows = await repository.listForReview(parsedState?.success ? parsedState.data : undefined);
    res.json({ rows });
  } catch (err) {
    req.log.error({ err }, "Failed to load attendance-history import review");
    res.status(500).json({ error: "Could not load attendance history review." });
  }
});

router.get("/imports/attendance-history/profile-options", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.json({ options: [] });
    return;
  }
  await ensureAttendanceImportSeed(db);
  const normalizedQuery = normalizeAttendanceText(query);
  const terms = normalizedQuery.split(" ").filter(Boolean);
  const candidates = await repository.listActiveProfileLocationCandidates();
  const options = candidates
    .filter((candidate) => {
      const haystack = normalizeAttendanceText(
        [candidate.organizationName, candidate.city, candidate.region].filter(Boolean).join(" "),
      );
      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, 30)
    .map((candidate) => ({
      organizationId: candidate.organizationId,
      organizationName: candidate.organizationName,
      organizationLocationId: candidate.locationId,
      city: candidate.city,
      region: candidate.region,
    }));
  res.json({ options });
});

router.post("/imports/attendance-history/:rowId/approve", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  const parsedId = rowIdSchema.safeParse(rowId);
  const parsed = approveSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: "Choose a valid source row and profile." });
    return;
  }
  await ensureAttendanceImportSeed(db);

  const [importRow] = await db
    .select({ id: attendanceImportRows.id })
    .from(attendanceImportRows)
    .where(eq(attendanceImportRows.id, rowId))
    .limit(1);
  if (!importRow) {
    res.status(404).json({ error: "Attendance source row not found." });
    return;
  }

  if (!(await activeOrganization(parsed.data.organizationId))) {
    res.status(404).json({ error: "Active profile not found." });
    return;
  }

  const organizationLocationId = parsed.data.organizationLocationId ?? null;
  if (organizationLocationId) {
    const [location] = await db
      .select({ id: organizationLocations.id })
      .from(organizationLocations)
      .where(
        and(
          eq(organizationLocations.id, organizationLocationId),
          eq(organizationLocations.organizationId, parsed.data.organizationId),
        ),
      )
      .limit(1);
    if (!location) {
      res.status(400).json({ error: "The selected location does not belong to that profile." });
      return;
    }
  }

  const result = await repository.approve({
    importRowId: rowId,
    organizationId: parsed.data.organizationId,
    organizationLocationId,
    actorId: String((req as any).userId ?? "owner"),
  });
  if (!result.ok) {
    res.status(404).json({ error: "Attendance source row not found." });
    return;
  }
  res.json(result);
});

router.post("/imports/attendance-history/:rowId/reject", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  const parsedId = rowIdSchema.safeParse(rowId);
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid source row." : "Add a reason for rejecting this match." });
    return;
  }
  await ensureAttendanceImportSeed(db);
  const row = await repository.reject(rowId, parsed.data.reason);
  if (!row) {
    res.status(404).json({ error: "Attendance source row not found." });
    return;
  }
  res.json({ row });
});

router.post("/imports/attendance-history/:rowId/rematch", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  if (!rowIdSchema.safeParse(rowId).success) {
    res.status(400).json({ error: "Invalid source row." });
    return;
  }
  await ensureAttendanceImportSeed(db);
  const [row] = await db
    .select()
    .from(attendanceImportRows)
    .where(eq(attendanceImportRows.id, rowId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Attendance source row not found." });
    return;
  }
  if (row.matchState === "approved") {
    res.status(409).json({ error: "Approved history cannot be rematched without first reviewing the approved record." });
    return;
  }

  const allCandidates = await repository.listActiveProfileLocationCandidates();
  const plausible = findPlausibleAttendanceCandidates(row.originalEventName, allCandidates);
  const suggestion = chooseAttendanceMatch(
    { importRowId: row.id, eventName: row.originalEventName, location: row.originalLocation },
    plausible,
  );
  await repository.updateMatch(suggestion);
  res.json({ suggestion });
});

export default router;
