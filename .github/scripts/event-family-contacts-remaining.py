from pathlib import Path

# 1. Family repository: expose relationship id on contact rows.
p = Path('artifacts/api-server/src/features/event-families/event-family-repository.ts')
s = p.read_text()
s = s.replace('SELECT efc.contact_id AS "contactId",', 'SELECT efc.id, efc.contact_id AS "contactId",')
p.write_text(s)

# 2. Event Family routes.
p = Path('artifacts/api-server/src/routes/event-families.ts')
s = p.read_text()
anchor = 'const noteBodySchema = z.object({ body: z.string().trim().min(1, "Add note text.").max(4000) });\n'
addition = anchor + '''const websiteSchema = z.object({ website: z.string().trim().max(500).nullable().or(z.literal("")) });\nconst contactSearchSchema = z.object({ q: z.string().trim().max(160).optional().default("") });\nconst familyContactSchema = z.object({\n  contactId: z.string().uuid(),\n  role: z.string().trim().max(160).nullable().optional(),\n  makePrimary: z.boolean().optional().default(false),\n});\nconst newFamilyContactSchema = z.object({\n  name: z.string().trim().min(1).max(200),\n  phone: z.string().trim().max(80).nullable().optional(),\n  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),\n  role: z.string().trim().max(160).nullable().optional(),\n  makePrimary: z.boolean().optional().default(false),\n});\nconst familyContactUpdateSchema = z.object({ role: z.string().trim().max(160).nullable(), isPrimary: z.boolean() });\n'''
if 'const websiteSchema' not in s:
    if anchor not in s: raise SystemExit('event-family schema anchor missing')
    s = s.replace(anchor, addition, 1)
helper_anchor = '''function noteRepo() {\n  return new ScopedNoteRepository(db);\n}\n'''
helper_add = helper_anchor + '''function splitName(name: string) {\n  const [firstName, ...rest] = name.trim().split(/\\s+/);\n  return { firstName: firstName ?? "", lastName: rest.join(" ") };\n}\n'''
if 'function splitName(name: string)' not in s:
    if helper_anchor not in s: raise SystemExit('split-name anchor missing')
    s = s.replace(helper_anchor, helper_add, 1)
route_anchor = '''router.get("/event-family-suggestions", async (req, res): Promise<void> => {'''
routes = '''router.patch("/event-families/:id/website", async (req, res): Promise<void> => {\n  try {\n    const familyId = idSchema.parse(req.params.id);\n    const parsed = websiteSchema.parse(req.body);\n    const changed = await repo().updateWebsite(familyId, parsed.website || null);\n    if (!changed) { res.status(404).json({ ok: false, error: "Event family not found" }); return; }\n    res.json({ ok: true });\n  } catch (error) { sendError(req, res, error); }\n});\n\nrouter.get("/event-families/:id/contact-candidates", async (req, res): Promise<void> => {\n  try {\n    const familyId = idSchema.parse(req.params.id);\n    const { q } = contactSearchSchema.parse(req.query);\n    res.json({ contacts: await repo().listContactCandidates(familyId, q.trim()) });\n  } catch (error) { sendError(req, res, error); }\n});\n\nrouter.post("/event-families/:id/contacts", async (req, res): Promise<void> => {\n  try {\n    const familyId = idSchema.parse(req.params.id);\n    const input = familyContactSchema.parse(req.body);\n    const contact = await repo().attachContact(familyId, input.contactId, input.role ?? null, input.makePrimary);\n    res.status(201).json({ ok: true, contact });\n  } catch (error) { sendError(req, res, error); }\n});\n\nrouter.post("/event-families/:id/contacts/new", async (req, res): Promise<void> => {\n  try {\n    const familyId = idSchema.parse(req.params.id);\n    const input = newFamilyContactSchema.parse(req.body);\n    const { firstName, lastName } = splitName(input.name);\n    const contact = await repo().createAndAttachContact(familyId, {\n      firstName, lastName, phone: input.phone || null, email: input.email || null, role: input.role ?? null, makePrimary: input.makePrimary,\n    });\n    res.status(201).json({ ok: true, contact });\n  } catch (error) { sendError(req, res, error); }\n});\n\nrouter.patch("/event-families/:id/contacts/:contactId", async (req, res): Promise<void> => {\n  try {\n    const familyId = idSchema.parse(req.params.id);\n    const contactId = idSchema.parse(req.params.contactId);\n    const input = familyContactUpdateSchema.parse(req.body);\n    const contact = await repo().updateFamilyContact(familyId, contactId, input);\n    res.json({ ok: true, contact });\n  } catch (error) { sendError(req, res, error); }\n});\n\nrouter.delete("/event-families/:id/contacts/:contactId", async (req, res): Promise<void> => {\n  try {\n    const familyId = idSchema.parse(req.params.id);\n    const contactId = idSchema.parse(req.params.contactId);\n    const changed = await repo().removeFamilyContact(familyId, contactId);\n    if (!changed) { res.status(404).json({ ok: false, error: "Family contact not found" }); return; }\n    res.json({ ok: true });\n  } catch (error) { sendError(req, res, error); }\n});\n\n'''+route_anchor
if 'contact-candidates' not in s:
    if route_anchor not in s: raise SystemExit('route insertion anchor missing')
    s = s.replace(route_anchor, routes, 1)
p.write_text(s)

# 3. Member profile family shared context.
p = Path('artifacts/api-server/src/routes/event-profiles.ts')
s = p.read_text()
s = s.replace('import { db } from "@workspace/db";', 'import { db, pool } from "@workspace/db";')
imp = 'import { getFamilySharedContact } from "@/features/event-families/family-shared-contact";\n'
if imp not in s:
    anchor = 'import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";\n'
    if anchor not in s: raise SystemExit('event-profile import anchor missing')
    s = s.replace(anchor, anchor + imp, 1)
response_old = 'res.json({ ...profile, familyContext, organizationContext: manualOrganizationContext, managerReviews, managerReviewAverage, assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true" });'
response_new = 'const familySharedContact = await getFamilySharedContact(pool, familyContext);\n    res.json({ ...profile, familyContext, familySharedContact, organizationContext: manualOrganizationContext, managerReviews, managerReviewAverage, assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true" });'
if response_old in s:
    s = s.replace(response_old, response_new, 1)
elif 'familySharedContact,' not in s:
    raise SystemExit('event-profile response anchor missing')
p.write_text(s)

# 4. Event Family page mount.
p = Path('artifacts/adventure-zone/src/pages/EventFamilyPage.tsx')
s = p.read_text()
imp = 'import { EventFamilyWebsiteContacts } from "@/components/event-families/event-family-website-contacts";\n'
if imp not in s:
    anchor = 'import { ProfileMemberPicker } from "@/components/event-families/profile-member-picker";\n'
    if anchor not in s: raise SystemExit('family page import anchor missing')
    s = s.replace(anchor, anchor + imp, 1)
mount_anchor = '      <EventRatingSummary average={ratingSummary.average} count={ratingSummary.count} />\n'
mount = mount_anchor + '      <EventFamilyWebsiteContacts family={family} onChanged={load} />\n'
if '<EventFamilyWebsiteContacts' not in s:
    if mount_anchor not in s: raise SystemExit('family page mount anchor missing')
    s = s.replace(mount_anchor, mount, 1)
p.write_text(s)

# 5. Event profile workspace mount.
p = Path('artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx')
s = p.read_text()
imp = 'import { FamilyContactSummary, type FamilySharedContact } from "@/components/event-profiles/family-contact-summary";\n'
if imp not in s:
    anchor = 'import { ScopedNotes } from "@/components/notes/scoped-notes";\n'
    if anchor not in s: raise SystemExit('workspace import anchor missing')
    s = s.replace(anchor, anchor + imp, 1)
s = s.replace('  assistedCallingEnabled = false,\n  familyNotes = [],', '  assistedCallingEnabled = false,\n  familySharedContact = null,\n  familyNotes = [],', 1)
s = s.replace('  assistedCallingEnabled?: boolean;\n  familyNotes?: ScopedNoteView[];', '  assistedCallingEnabled?: boolean;\n  familySharedContact?: FamilySharedContact | null;\n  familyNotes?: ScopedNoteView[];', 1)
family_context_block = '''        {profile.familyContext ? (\n          <p className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-950">'''
if '<FamilyContactSummary shared={familySharedContact}' not in s:
    if family_context_block not in s: raise SystemExit('workspace family context anchor missing')
    s = s.replace('        {profile.familyContext ? (', '        {familySharedContact ? <div className="mt-4"><FamilyContactSummary shared={familySharedContact} /></div> : null}\n        {profile.familyContext ? (', 1)
p.write_text(s)

# 6. EventProfilePage passes the shared summary.
p = Path('artifacts/adventure-zone/src/pages/EventProfilePage.tsx')
s = p.read_text()
if 'familySharedContact={data.familySharedContact ?? null}' not in s:
    anchor = '        callablePhoneByContactId={callablePhoneByContactId}\n'
    if anchor not in s: raise SystemExit('profile page prop anchor missing')
    s = s.replace(anchor, anchor + '        familySharedContact={data.familySharedContact ?? null}\n', 1)
p.write_text(s)
