from pathlib import Path

workspace = Path('artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx')
s = workspace.read_text()
if 'organization-membership-drawer' not in s:
    s = s.replace('import { PossibleLocationsDrawer } from "@/components/organizations/possible-locations-drawer";\n', 'import { PossibleLocationsDrawer } from "@/components/organizations/possible-locations-drawer";\nimport { OrganizationMembershipDrawer } from "@/components/organizations/organization-membership-drawer";\n', 1)

old = '''  familyNotesError = null,\n  retryFamilyNotes,\n}: {\n  profile: EventProfile;\n  context?: EventProfileWorkspaceContext;\n  callablePhoneByContactId?: Record<string, string | null>;\n  assistedCallingEnabled?: boolean;\n  familyNotes?: ScopedNoteView[];\n  familyNotesError?: string | null;\n  retryFamilyNotes?: () => void;\n}) {'''
new = '''  familyNotesError = null,\n  retryFamilyNotes,\n  organizationContext = { parent: null, children: [] },\n  onOrganizationChanged = () => {},\n}: {\n  profile: EventProfile;\n  context?: EventProfileWorkspaceContext;\n  callablePhoneByContactId?: Record<string, string | null>;\n  assistedCallingEnabled?: boolean;\n  familyNotes?: ScopedNoteView[];\n  familyNotesError?: string | null;\n  retryFamilyNotes?: () => void;\n  organizationContext?: { parent: { id: string; name: string; city: string | null; region: string | null } | null; children: { id: string; name: string; city: string | null; region: string | null }[] };\n  onOrganizationChanged?: () => void;\n}) {'''
if old not in s:
    raise SystemExit('workspace props anchor missing')
s = s.replace(old, new, 1)

state_anchor = '  const [followUpItems, setFollowUpItems] = useState(profile.followUps);\n'
if 'membershipDrawer' not in s:
    s = s.replace(state_anchor, state_anchor + '  const [membershipDrawer, setMembershipDrawer] = useState<"add-child" | "choose-parent" | null>(null);\n', 1)

website_anchor = '  const websiteHref = normalizeExternalWebsite(profile.place.website);\n'
if 'organizationLike' not in s:
    s = s.replace(website_anchor, website_anchor + '''  const organizationLike = organizationContext.children.length > 0 || ["company", "association", "city_government", "tribe", "school"].includes(profile.place.placeType);\n''', 1)

insert_anchor = '''        {profile.place.lastResort ? (\n          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-950" role="alert">'''
block = '''        <div className="mt-4 grid gap-3">\n          {organizationContext.parent ? (\n            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">\n              <p className="font-semibold text-sky-950">Part of <Link className="underline" href={`/event-profiles/${organizationContext.parent.id}`}>{organizationContext.parent.name}</Link></p>\n              <button className="button-secondary" onClick={() => setMembershipDrawer("choose-parent")} type="button">Change organization…</button>\n            </div>\n          ) : !organizationLike ? (\n            <button className="button-secondary justify-self-start" onClick={() => setMembershipDrawer("choose-parent")} type="button">Add to organization…</button>\n          ) : null}\n\n          {organizationLike ? (\n            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-labelledby="locations-events-title">\n              <div className="flex flex-wrap items-center justify-between gap-2">\n                <h2 className="text-lg font-bold" id="locations-events-title">Locations &amp; Events</h2>\n                <button className="button-secondary" onClick={() => setMembershipDrawer("add-child")} type="button">+ Add location/event</button>\n              </div>\n              {organizationContext.children.length ? (\n                <ul className="mt-3 grid gap-2">\n                  {organizationContext.children.map((child) => (\n                    <li key={child.id}>\n                      <Link className="block rounded-lg bg-white px-3 py-2 font-semibold hover:text-orange-700" href={`/event-profiles/${child.id}`}>\n                        {child.name}{child.city || child.region ? ` — ${[child.city, child.region].filter(Boolean).join(", ")}` : ""}\n                      </Link>\n                    </li>\n                  ))}\n                </ul>\n              ) : <p className="mt-2 text-sm text-slate-600">No locations or events have been added yet.</p>}\n            </section>\n          ) : null}\n        </div>\n        {membershipDrawer ? (\n          <OrganizationMembershipDrawer\n            mode={membershipDrawer}\n            profileId={profile.id}\n            parentOrganization={membershipDrawer === "add-child" ? { id: profile.id, name: profile.place.name } : null}\n            currentParent={organizationContext.parent ? { id: organizationContext.parent.id, name: organizationContext.parent.name } : null}\n            open\n            onClose={() => setMembershipDrawer(null)}\n            onChanged={onOrganizationChanged}\n          />\n        ) : null}\n'''
if block not in s:
    if insert_anchor not in s:
        raise SystemExit('workspace organization UI anchor missing')
    s = s.replace(insert_anchor, block + insert_anchor, 1)
workspace.write_text(s)

page = Path('artifacts/adventure-zone/src/pages/EventProfilePage.tsx')
p = page.read_text()
start = p.index('  useEffect(() => {\n    if (!profileId) return;')
end = p.index('\n\n  function retryFamilyNotes()', start)
old_effect = p[start:end]
body = old_effect
body = body.replace('  useEffect(() => {\n    if (!profileId) return;\n', '  async function loadProfile() {\n    if (!profileId) return;\n')
body = body.replace('    apiGet<any>(`/event-profiles/${profileId}?${qs.toString()}`)\n      .then(async (d) => {', '    try {\n      const d = await apiGet<any>(`/event-profiles/${profileId}?${qs.toString()}`);\n      {')
body = body.replace('        setData(normalized);\n        setLoading(false);\n      })\n      .catch((e) => { setError(e.message); setLoading(false); });\n  }, [profileId, contactId]);', '        setData(normalized);\n        setError(null);\n        setLoading(false);\n      }\n    } catch (e: any) {\n      setError(e.message);\n      setLoading(false);\n    }\n  }\n\n  useEffect(() => {\n    void loadProfile();\n  }, [profileId, contactId]);')
p = p[:start] + body + p[end:]
pass_anchor = '        retryFamilyNotes={retryFamilyNotes}\n'
if 'organizationContext={data.organizationContext' not in p:
    p = p.replace(pass_anchor, pass_anchor + '        organizationContext={data.organizationContext ?? { parent: null, children: [] }}\n        onOrganizationChanged={() => void loadProfile()}\n', 1)
page.write_text(p)
