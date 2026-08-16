from pathlib import Path

p = Path("artifacts/api-server/src/routes/event-profiles.ts")
s = p.read_text()
import_anchor = 'import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";'
import_line = 'import { getOrganizationMembershipContext } from "@/features/organizations/organization-membership-query";'
if import_line not in s:
    if import_anchor not in s:
        raise SystemExit("event profile repository import anchor missing")
    s = s.replace(import_anchor, import_anchor + "\n" + import_line, 1)

profile_anchor = '    if (!profile) { res.status(404).json({ error: "Not found" }); return; }\n    const [membership] = await db'
profile_insert = '    if (!profile) { res.status(404).json({ error: "Not found" }); return; }\n    const manualOrganizationContext = await getOrganizationMembershipContext(db, id);\n    const [membership] = await db'
if 'const manualOrganizationContext = await getOrganizationMembershipContext(db, id);' not in s:
    if profile_anchor not in s:
        raise SystemExit("profile detail anchor missing")
    s = s.replace(profile_anchor, profile_insert, 1)

response_anchor = '    res.json({ ...profile, familyContext, managerReviews, managerReviewAverage, assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true" });'
response_insert = '    res.json({ ...profile, familyContext, organizationContext: manualOrganizationContext, managerReviews, managerReviewAverage, assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true" });'
if 'organizationContext: manualOrganizationContext' not in s:
    if response_anchor not in s:
        raise SystemExit("profile response anchor missing")
    s = s.replace(response_anchor, response_insert, 1)

p.write_text(s)
