from pathlib import Path

path = Path("lib/db/src/migrations.ts")
s = path.read_text()
if 'name: "043_event_family_website_contacts.sql"' not in s:
    anchor = '''  {
    name: "042_manual_organization_membership.sql",
    markerSql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'organizations'
        AND column_name = 'parent_organization_id'
    ) AS ready`,
  },
'''
    addition = anchor + '''  {
    name: "043_event_family_website_contacts.sql",
    markerSql: `SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'event_families'
          AND column_name = 'website'
      )
      AND to_regclass(current_schema() || '.event_family_contacts') IS NOT NULL
      AND to_regclass(current_schema() || '.event_family_contacts_one_primary_per_family') IS NOT NULL AS ready`,
  },
'''
    if anchor not in s:
        raise SystemExit("migration registry anchor missing")
    s = s.replace(anchor, addition, 1)
    path.write_text(s)
