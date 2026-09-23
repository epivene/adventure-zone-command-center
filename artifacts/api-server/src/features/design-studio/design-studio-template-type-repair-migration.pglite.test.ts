import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const repairMigrationUrl = new URL(
  "../../../../../lib/db/migrations/20260923b_design_studio_proposal_type_repair.sql",
  import.meta.url,
);

async function loadRepairMigration(): Promise<string> {
  try {
    return await readFile(repairMigrationUrl, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

describe("Design Studio proposal type repair migration", () => {
  let client: PGlite | undefined;

  afterEach(async () => client?.close());

  it("allows proposals when the legacy type checks are still installed", async () => {
    client = new PGlite();
    await client.exec(`
      create table design_templates (
        id uuid primary key default gen_random_uuid(),
        type text not null,
        constraint design_templates_type_check
          check (type in ('flyer','social_post','email','brochure','review_request','contract','blank'))
      );
      create table design_projects (
        id uuid primary key default gen_random_uuid(),
        type text not null,
        constraint design_projects_type_check
          check (type in ('flyer','social_post','email','brochure','review_request','contract','blank'))
      );
      alter table design_templates add constraint design_templates_type_valid
        check (type in ('flyer','social_post','email','brochure','review_request','contract','proposal','blank'));
      alter table design_projects add constraint design_projects_type_valid
        check (type in ('flyer','social_post','email','brochure','review_request','contract','proposal','blank'));
    `);

    await client.exec(await loadRepairMigration());

    await client.exec(`
      insert into design_templates (type) values ('proposal');
      insert into design_projects (type) values ('proposal');
    `);
    await expect(client.query(`
      select 'template' as source, type from design_templates
      union all
      select 'project' as source, type from design_projects
      order by source
    `)).resolves.toMatchObject({
      rows: [
        { source: "project", type: "proposal" },
        { source: "template", type: "proposal" },
      ],
    });
  });
});
