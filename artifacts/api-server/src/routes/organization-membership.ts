import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { setOrganizationMembership } from "@/features/organizations/organization-membership";
import {
  searchEligibleOrganizationChildren,
  searchEligibleOrganizationParents,
} from "@/features/organizations/organization-membership-query";

const router: IRouter = Router();
const uuid = z.string().uuid();
const candidateQuery = z.object({ q: z.string().trim().max(200).default("") });
const membershipInput = z.object({ organizationId: uuid });

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function membershipError(res: any, error: unknown) {
  if (error instanceof OrganizationConflictError) {
    res.status(409).json({ ok: false, error: error.message });
    return;
  }
  throw error;
}

router.get("/organizations/:id/membership-candidates", async (req, res): Promise<void> => {
  const parentOrganizationId = param(req.params.id);
  const parsedId = uuid.safeParse(parentOrganizationId);
  const parsedQuery = candidateQuery.safeParse(req.query);
  if (!parsedId.success || !parsedQuery.success) {
    res.status(400).json({ ok: false, error: "Invalid organization membership search." });
    return;
  }
  const profiles = await searchEligibleOrganizationChildren(db, parsedQuery.data.q, parentOrganizationId);
  res.json({ profiles });
});

router.get("/event-profiles/:id/organization-candidates", async (req, res): Promise<void> => {
  const childId = param(req.params.id);
  const parsedId = uuid.safeParse(childId);
  const parsedQuery = candidateQuery.safeParse(req.query);
  if (!parsedId.success || !parsedQuery.success) {
    res.status(400).json({ ok: false, error: "Invalid organization search." });
    return;
  }
  const organizations = await searchEligibleOrganizationParents(db, parsedQuery.data.q, childId);
  res.json({ organizations });
});

router.put("/event-profiles/:id/organization", async (req, res): Promise<void> => {
  const childId = param(req.params.id);
  const parsedId = uuid.safeParse(childId);
  const parsed = membershipInput.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ ok: false, error: "Choose a valid organization." });
    return;
  }
  try {
    const membership = await setOrganizationMembership(
      db,
      { childId, parentOrganizationId: parsed.data.organizationId },
      new Date(),
    );
    res.json({ ok: true, membership });
  } catch (error) {
    membershipError(res, error);
  }
});

router.delete("/event-profiles/:id/organization", async (req, res): Promise<void> => {
  const childId = param(req.params.id);
  if (!uuid.safeParse(childId).success) {
    res.status(400).json({ ok: false, error: "Invalid profile ID." });
    return;
  }
  try {
    const membership = await setOrganizationMembership(
      db,
      { childId, parentOrganizationId: null },
      new Date(),
    );
    res.json({ ok: true, membership });
  } catch (error) {
    membershipError(res, error);
  }
});

export default router;
