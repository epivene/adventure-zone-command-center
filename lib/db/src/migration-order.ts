type Dependencies = Readonly<Record<string, readonly string[]>>;

// Preserve migration filenames: existing databases track completion by name.
// Same-date alphabetical order does not guarantee prerequisite tables exist.
const migrationDependencies: Dependencies = {
  "20260909_outreach_allocation.sql": ["20260909_outreach_planner.sql"],
  "20260909_outreach_commitments.sql": ["20260909_outreach_allocation.sql"],
  "20260909_outreach_dispatch.sql": ["20260909_outreach_allocation.sql"],
};

export function orderMigrations(
  files: readonly string[],
  dependencies: Dependencies = migrationDependencies,
): string[] {
  const available = new Set(files);
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];

  function visit(file: string) {
    if (complete.has(file)) return;
    if (!available.has(file)) throw new Error(`Missing migration prerequisite: ${file}`);
    if (visiting.has(file)) throw new Error(`Cyclic migration prerequisite: ${file}`);
    visiting.add(file);
    for (const prerequisite of dependencies[file] ?? []) visit(prerequisite);
    visiting.delete(file);
    complete.add(file);
    ordered.push(file);
  }

  for (const file of [...files].sort()) visit(file);
  return ordered;
}
