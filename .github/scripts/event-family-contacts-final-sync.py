from pathlib import Path

registry = Path("lib/db/src/migrations.ts")
text = registry.read_text()
if '044_event_family_website_contacts.sql' not in text:
    marker = '] as const;'
    entry = '''  {
    name: "044_event_family_website_contacts.sql",
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
    if marker not in text:
        raise SystemExit("migration registry terminator missing")
    registry.write_text(text.replace(marker, entry + marker, 1))

test_file = Path("artifacts/api-server/src/features/event-families/event-family-contacts.test.ts")
if test_file.exists():
    test_file.write_text(test_file.read_text().replace(
        "043_event_family_website_contacts",
        "044_event_family_website_contacts",
    ))
