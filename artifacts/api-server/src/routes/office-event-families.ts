import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { EventFamilyRepository } from "@/features/event-families/event-family-repository";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const families = new EventFamilyRepository();
const uuid = z.string().uuid();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/office/event-families/:familyId", requireOffice, async (req, res): Promise<void> => {
  const familyId = param(req.params.familyId);
  if (!uuid.safeParse(familyId).success) {
    res.status(400).json({ error: "Invalid event family ID." });
    return;
  }
  try {
    const family = await families.getFamily(familyId);
    if (!family) {
      res.status(404).json({ error: "Event family not found." });
      return;
    }
    res.json({
      family: {
        id: family.id,
        name: family.name,
        description: family.description ?? null,
        memberCount: family.memberCount,
        members: (family.members ?? []).map((member: any) => ({
          id: member.id,
          name: member.name,
          city: member.city ?? null,
          region: member.region ?? null,
          contactCount: Number(member.contactCount ?? 0),
          bookingCount: Number(member.bookingCount ?? 0),
        })),
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Office Coordinator event family");
    res.status(500).json({ error: "Could not load the event family." });
  }
});

export default router;
