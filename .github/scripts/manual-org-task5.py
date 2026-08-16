from pathlib import Path

# Form
p = Path('artifacts/adventure-zone/src/components/event-profiles/event-profile-form.tsx')
s = p.read_text()
s = s.replace('  familyId: string | null;\n};', '  familyId: string | null;\n  parentOrganizationId: string | null;\n};', 1)
s = s.replace('  initialFamilyId?: string;\n  eventProfiles?:', '  initialFamilyId?: string;\n  initialOrganizationId?: string;\n  initialOrganizationName?: string;\n  eventProfiles?:', 1)
s = s.replace('  initialFamilyId = "",\n  eventProfiles = {},', '  initialFamilyId = "",\n  initialOrganizationId = "",\n  initialOrganizationName = "",\n  eventProfiles = {},', 1)
s = s.replace('        familyId: familyId || null,\n      });', '        familyId: familyId || null,\n        parentOrganizationId: initialOrganizationId || null,\n      });', 1)
existing_block = '''        <label className="grid gap-1.5 font-medium">
          Or reuse an existing profile
          <select aria-label="Use an existing profile" onChange={(event) => void selectEvent(event.currentTarget.value)} value={eventId}>
            <option value="">Create a new profile</option>
            {events.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city && item.region ? ` — ${item.city}, ${item.region}` : ""}</option>)}
          </select>
        </label>'''
replacement = '''        {initialOrganizationId ? (
          <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900">
            Part of {initialOrganizationName || "selected organization"}
          </p>
        ) : (
          <label className="grid gap-1.5 font-medium">
            Or reuse an existing profile
            <select aria-label="Use an existing profile" onChange={(event) => void selectEvent(event.currentTarget.value)} value={eventId}>
              <option value="">Create a new profile</option>
              {events.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city && item.region ? ` — ${item.city}, ${item.region}` : ""}</option>)}
            </select>
          </label>
        )}'''
if existing_block not in s:
    raise SystemExit('form existing-profile block missing')
s = s.replace(existing_block, replacement, 1)
p.write_text(s)

# New page
p = Path('artifacts/adventure-zone/src/pages/EventProfileNewPage.tsx')
s = p.read_text()
s = s.replace('  const initialFamilyId = params.get("familyId") ?? "";\n', '  const initialFamilyId = params.get("familyId") ?? "";\n  const initialOrganizationId = params.get("organizationId") ?? "";\n', 1)
s = s.replace('  const [families, setFamilies] = useState<any[]>([]);\n  const [loading, setLoading] = useState(true);', '  const [families, setFamilies] = useState<any[]>([]);\n  const [initialOrganizationName, setInitialOrganizationName] = useState("");\n  const [loading, setLoading] = useState(true);', 1)
s = s.replace('      apiGet<any>("/contacts?page=1&pageSize=100").catch(() => null),\n    ]).then(([legs, orgs, contactPage]) => {', '      apiGet<any>("/contacts?page=1&pageSize=100").catch(() => null),\n      initialOrganizationId ? apiGet<any>(`/organizations/${initialOrganizationId}`).catch(() => null) : Promise.resolve(null),\n    ]).then(([legs, orgs, contactPage, parentDetail]) => {', 1)
s = s.replace('      setContacts(\n', '      setInitialOrganizationName(parentDetail?.organization?.name ?? "");\n      setContacts(\n', 1)
s = s.replace('  }, []);', '  }, [initialOrganizationId]);', 1)
s = s.replace('        initialFamilyId={initialFamilyId}\n        travelLegs={travelLegs}', '        initialFamilyId={initialFamilyId}\n        initialOrganizationId={initialOrganizationId}\n        initialOrganizationName={initialOrganizationName}\n        travelLegs={travelLegs}', 1)
p.write_text(s)

# API create flow
p = Path('artifacts/api-server/src/routes/event-profiles.ts')
s = p.read_text()
s = s.replace('  familyId: z.string().uuid().nullable().optional().default(null),\n}).superRefine', '  familyId: z.string().uuid().nullable().optional().default(null),\n  parentOrganizationId: z.string().uuid().nullable().optional().default(null),\n}).superRefine', 1)
anchor = '''      if (organizationId) {
        const [found] = await transaction.select({ id: organizations.id, city: organizations.city, region: organizations.region, consolidatedIntoId: organizations.consolidatedIntoId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);'''
insert = '''      if (organizationId && parsed.data.parentOrganizationId) {
        throw new Error("ORGANIZATION_CREATE_REQUIRES_NEW_PROFILE");
      }
      if (organizationId) {
        const [found] = await transaction.select({ id: organizations.id, city: organizations.city, region: organizations.region, consolidatedIntoId: organizations.consolidatedIntoId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);'''
if anchor not in s: raise SystemExit('create existing profile anchor missing')
s = s.replace(anchor, insert, 1)
old_create = '        const [created] = await transaction.insert(organizations).values({ name: parsed.data.event.name.trim(), city: eventCity || null, region: eventRegion || null, placeType: "festival_event", createdAt: now, updatedAt: now }).returning({ id: organizations.id });'
new_create = '''        if (parsed.data.parentOrganizationId) {
          const [parent] = await transaction.select({ id: organizations.id, consolidatedIntoId: organizations.consolidatedIntoId, parentOrganizationId: organizations.parentOrganizationId }).from(organizations).where(eq(organizations.id, parsed.data.parentOrganizationId)).limit(1);
          if (!parent) throw new Error("PARENT_ORGANIZATION_NOT_FOUND");
          if (parent.consolidatedIntoId || parent.parentOrganizationId) throw new Error("PARENT_ORGANIZATION_INVALID");
        }
        const [created] = await transaction.insert(organizations).values({ name: parsed.data.event.name.trim(), city: eventCity || null, region: eventRegion || null, placeType: "festival_event", parentOrganizationId: parsed.data.parentOrganizationId, createdAt: now, updatedAt: now }).returning({ id: organizations.id });'''
if old_create not in s: raise SystemExit('create insert anchor missing')
s = s.replace(old_create, new_create, 1)
error_anchor = '    if (error instanceof Error && ["EVENT_NOT_FOUND", "CONTACT_NOT_FOUND", "EVENT_FAMILY_NOT_FOUND"].includes(error.message)) {'
error_insert = '''    if (error instanceof Error && ["PARENT_ORGANIZATION_NOT_FOUND", "PARENT_ORGANIZATION_INVALID", "ORGANIZATION_CREATE_REQUIRES_NEW_PROFILE"].includes(error.message)) {
      res.status(error.message === "PARENT_ORGANIZATION_NOT_FOUND" ? 400 : 409).json({ ok: false, error: "That organization can no longer accept this event. Refresh and try again." });
      return;
    }
    if (error instanceof Error && ["EVENT_NOT_FOUND", "CONTACT_NOT_FOUND", "EVENT_FAMILY_NOT_FOUND"].includes(error.message)) {'''
if error_anchor not in s: raise SystemExit('create error anchor missing')
s = s.replace(error_anchor, error_insert, 1)
p.write_text(s)
