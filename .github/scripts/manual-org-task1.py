from pathlib import Path

schema = Path("lib/db/src/schema/index.ts")
s = schema.read_text()
field_anchor = '  website: text("website"),\n  /** Set when this profile has been retired via the consolidation workflow. */'
field_insert = '''  website: text("website"),
  /** Optional non-destructive parent organization for manual event/location membership. */
  parentOrganizationId: uuid("parent_organization_id").references(
    (): AnyPgColumn => organizations.id,
    { onDelete: "restrict" },
  ),
  /** Set when this profile has been retired via the consolidation workflow. */'''
if 'parentOrganizationId: uuid("parent_organization_id")' not in s:
    if field_anchor not in s:
        raise SystemExit("organization field anchor missing")
    s = s.replace(field_anchor, field_insert, 1)

index_anchor = '  index("organizations_normalized_phone_idx").on(table.normalizedPhone),\n]);'
index_insert = '''  index("organizations_normalized_phone_idx").on(table.normalizedPhone),
  index("organizations_parent_organization_id_idx").on(table.parentOrganizationId),
]);'''
if "organizations_parent_organization_id_idx" not in s:
    if index_anchor not in s:
        raise SystemExit("organization index anchor missing")
    s = s.replace(index_anchor, index_insert, 1)
schema.write_text(s)

Path("lib/db/migrations/042_manual_organization_membership.sql").write_text('''ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_parent_organization_id_fkey'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_parent_organization_id_fkey
      FOREIGN KEY (parent_organization_id)
      REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_parent_organization_id_idx
  ON organizations(parent_organization_id)
  WHERE parent_organization_id IS NOT NULL;
''')

registry = Path("lib/db/src/migrations.ts")
r = registry.read_text()
registry_anchor = '''  {
  name: "040_leg_incidents.sql",
  markerSql: "SELECT to_regclass(current_schema() || '.leg_incidents') IS NOT NULL AND to_regclass(current_schema() || '.leg_incident_attachments') IS NOT NULL AS ready",
},
] as const;'''
registry_insert = '''  {
  name: "040_leg_incidents.sql",
  markerSql: "SELECT to_regclass(current_schema() || '.leg_incidents') IS NOT NULL AND to_regclass(current_schema() || '.leg_incident_attachments') IS NOT NULL AS ready",
},
  {
    name: "042_manual_organization_membership.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'organizations'
        AND column_name = 'parent_organization_id'
    ) AS ready`,
  },
] as const;'''
if '042_manual_organization_membership.sql' not in r:
    if registry_anchor not in r:
        raise SystemExit("migration registry anchor missing")
    r = r.replace(registry_anchor, registry_insert, 1)
registry.write_text(r)
