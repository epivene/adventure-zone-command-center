from pathlib import Path

schema_path = Path("lib/db/src/schema/index.ts")
schema = schema_path.read_text()

resource_status = '''export const resourceStatusValues = [
  "available",
  "unavailable",
  "maintenance",
  "archived",
] as const;
export type ResourceStatus = (typeof resourceStatusValues)[number];
'''
resource_status_replacement = resource_status + '''\nexport const packageCountCategoryValues = [
  "main_attraction",
  "game_extra",
  "special_shared",
] as const;
export type PackageCountCategory = (typeof packageCountCategoryValues)[number];
'''
if "packageCountCategoryValues" not in schema:
    assert resource_status in schema
    schema = schema.replace(resource_status, resource_status_replacement, 1)

package_fields = '''    baseAttractionCount: integer("base_attraction_count").notNull(),
    active: boolean("active").default(true).notNull(),
'''
package_fields_replacement = '''    baseAttractionCount: integer("base_attraction_count").notNull(),
    minimumAttractionCount: integer("minimum_attraction_count").notNull(),
    maximumAttractionCount: integer("maximum_attraction_count").notNull(),
    customerDescription: text("customer_description"),
    bookingTalkingPoints: text("booking_talking_points"),
    operationalRequirements: text("operational_requirements"),
    setupNotes: text("setup_notes"),
    active: boolean("active").default(true).notNull(),
'''
if "minimumAttractionCount: integer" not in schema:
    assert package_fields in schema
    schema = schema.replace(package_fields, package_fields_replacement, 1)

package_check = '''    check(
      "package_templates_base_attraction_count_positive",
      sql`${table.baseAttractionCount} > 0`,
    ),
'''
package_check_replacement = package_check + '''    check(
      "package_templates_minimum_attraction_count_positive",
      sql`${table.minimumAttractionCount} > 0`,
    ),
    check(
      "package_templates_maximum_attraction_count_valid",
      sql`${table.maximumAttractionCount} >= ${table.minimumAttractionCount}`,
    ),
'''
if "package_templates_minimum_attraction_count_positive" not in schema:
    assert package_check in schema
    schema = schema.replace(package_check, package_check_replacement, 1)

resource_fields = '''    category: text("category").notNull(),
    countsAsAttraction: boolean("counts_as_attraction").default(false).notNull(),
'''
resource_fields_replacement = '''    category: text("category").notNull(),
    countsAsAttraction: boolean("counts_as_attraction").default(false).notNull(),
    packageCountCategory: text("package_count_category")
      .$type<PackageCountCategory>()
      .default("main_attraction")
      .notNull(),
'''
if "packageCountCategory: text" not in schema:
    assert resource_fields in schema
    schema = schema.replace(resource_fields, resource_fields_replacement, 1)

resource_check = '''    check(
      "resources_status_valid",
      sql`${table.status} in (${sqlTextValues(resourceStatusValues)})`,
    ),
'''
resource_check_replacement = resource_check + '''    check(
      "resources_package_count_category_valid",
      sql`${table.packageCountCategory} in (${sqlTextValues(packageCountCategoryValues)})`,
    ),
'''
if "resources_package_count_category_valid" not in schema:
    assert resource_check in schema
    schema = schema.replace(resource_check, resource_check_replacement, 1)

schema_path.write_text(schema)

migrations_path = Path("lib/db/src/migrations.ts")
migrations = migrations_path.read_text()
if 'name: "044_package_intelligence.sql"' not in migrations:
    anchor = '''  {
    name: "043_act_archive_full_recovery.sql",
    markerSql: `SELECT
      to_regclass(current_schema() || '.act_archive_recovery_runs') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_recovery_items') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_recovery_decisions') IS NOT NULL
      AS ready`,
  },
'''
    addition = anchor + '''  {
    name: "044_package_intelligence.sql",
    markerSql: `SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'package_templates'
          AND column_name = 'minimum_attraction_count'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'resources'
          AND column_name = 'package_count_category'
      ) AS ready`,
  },
'''
    assert anchor in migrations
    migrations = migrations.replace(anchor, addition, 1)
    migrations_path.write_text(migrations)
