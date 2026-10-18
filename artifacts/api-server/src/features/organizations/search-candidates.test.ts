import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it, vi } from "vitest";
import { organizationListQuerySchema } from "./last-resort-input";

it("keeps candidate filters, deterministic ordering and limits without loading profile details", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  const pg = new PGlite();
  try {
    const { DrizzleOrganizationRepository } = await import("./organization-repository");
    // Deliberately omit business-detail tables: candidate lookup must not need them.
    await pg.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text,region text);
      INSERT INTO organizations VALUES
      ('10000000-0000-4000-8000-000000000001','Zulu','UT'),
      ('10000000-0000-4000-8000-000000000002','Alpha','UT'),
      ('10000000-0000-4000-8000-000000000003','Aardvark','CO');`);
    const repository = new DrizzleOrganizationRepository(drizzle(pg) as never);
    const query = { ...organizationListQuerySchema.parse({ region: "ut", pageSize: "1" }), showMembers: true, includeRetired: true };
    expect(await repository.listOrganizationIds(query)).toEqual(["10000000-0000-4000-8000-000000000002"]);
  } finally {
    await pg.close(); vi.unstubAllEnvs();
  }
});
