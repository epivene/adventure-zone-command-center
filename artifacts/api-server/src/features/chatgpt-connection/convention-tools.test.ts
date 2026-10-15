import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  ConnectionConventionService,
  conventionTools,
} from "./convention-tools";
import { recordSources } from "./profile-record-sources";
import type { ConnectionPrincipal, ConnectionDatabase } from "./contracts";
const p: ConnectionPrincipal = {
  ownerId: "owner",
  connectionId: "00000000-0000-0000-0000-000000000001",
  clientId: "client",
  scopes: ["crm:read", "crm:append"],
};
const edition = "00000000-0000-0000-0000-000000000002";
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text); CREATE TABLE contacts(id uuid PRIMARY KEY,organization_id uuid,email text); CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);
 CREATE TABLE chatgpt_connections(id uuid PRIMARY KEY,owner_id text,client_id text,scopes text[],revoked_at timestamptz);
 INSERT INTO chatgpt_connections VALUES('${p.connectionId}','owner','client',ARRAY['crm:read','crm:append'],NULL);`);
  await db.exec(
    readFileSync(
      new URL(
        "../../../../../lib/db/migrations/20260909c_convention_outreach.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    "INSERT INTO convention_editions(id,convention,year) VALUES($1,$2,$3)",
    [edition, "Test convention", 2027],
  );
  const adapter: ConnectionDatabase = {
    query: (s, v) => db.query(s, v),
    transaction: (work) =>
      db.transaction((tx) => work({ query: (s, v) => tx.query(s, v) })),
  };
  return { db, service: new ConnectionConventionService(adapter) };
}
describe("convention connector", () => {
  it("previews without writes; adds once with receipt and preserves an existing source key", async () => {
    const { db, service } = await fixture();
    try {
      const rows = [
        {
          sourceKey: "verified-event",
          event: "Test fair",
          sources: "Owner supplied test source",
        },
      ];
      const preview = await service.preview(p, { editionId: edition, rows });
      expect(preview.revision).toBe(1);
      expect(
        (await db.query("SELECT * FROM convention_members")).rows,
      ).toHaveLength(0);
      const input = {
        editionId: edition,
        rows,
        expectedRevision: 1,
        requestKey: "add-1",
      };
      const result = await service.add(p, input);
      expect(result.added).toBe(1);
      expect(result.operationId).toBeTruthy();
      expect(await service.add(p, input)).toEqual(result);
      const retained = await service.add(p, {
        ...input,
        rows: [{ ...rows[0], event: "Do not overwrite" }],
        expectedRevision: 2,
        requestKey: "add-2",
      });
      expect(retained.retained).toBe(1);
      expect(
        (
          await db.query<{ data: { event: string } }>(
            "SELECT data FROM convention_members",
          )
        ).rows[0].data.event,
      ).toBe("Test fair");
      expect(
        (await db.query("SELECT * FROM convention_history")).rows,
      ).toHaveLength(2);
      await expect(
        service.add(p, { ...input, rows: [{ ...rows[0], event: "Changed" }] }),
      ).rejects.toThrow("different content");
      await expect(
        service.add(p, { ...input, requestKey: "stale" }),
      ).rejects.toThrow("changed");
    } finally {
      await db.close();
    }
  });
  it("rejects read-only, foreign-owner and revoked grants without writing", async () => {
    const { db, service } = await fixture();
    try {
      const input = {
        editionId: edition,
        rows: [{ sourceKey: "x", event: "Test fair", sources: "Test source" }],
        expectedRevision: 1,
        requestKey: "x",
      };
      await expect(
        service.add({ ...p, scopes: ["crm:read"] }, input),
      ).rejects.toThrow("CONNECTION_ACCESS_DENIED");
      await expect(
        service.add({ ...p, ownerId: "someone-else" }, input),
      ).rejects.toThrow("CONNECTION_ACCESS_DENIED");
      await db.exec("UPDATE chatgpt_connections SET revoked_at=now()");
      await expect(service.add(p, input)).rejects.toThrow("CONNECTION_REVOKED");
      expect(
        (await db.query("SELECT * FROM convention_members")).rows,
      ).toHaveLength(0);
    } finally {
      await db.close();
    }
  });
  it("advertises correct scopes and avoids credentials in Boss read projections", () => {
    const service = new ConnectionConventionService({
      query: async () => ({ rows: [] }),
    });
    expect(
      conventionTools(service, p).map((t) => [t.name, t.scope, t.readOnly]),
    ).toEqual([
      ["preview_convention_additions", "crm:read", true],
      ["add_convention_members", "crm:append", false],
    ]);
    for (const key of [
      "boss_assignments",
      "boss_work_requests",
      "boss_work_request_history",
      "boss_convention_submissions",
      "boss_template_reviews",
    ] as const) {
      expect(recordSources[key].fields).toContain("id");
      expect(JSON.stringify(recordSources[key])).not.toMatch(
        /password|salt|token|session_version/,
      );
    }
  });
});

it("executes every new Boss projection against the app migration schemas", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE office_accounts(id uuid PRIMARY KEY); CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY); CREATE TABLE follow_ups(id uuid PRIMARY KEY); CREATE TABLE communication_templates(id uuid PRIMARY KEY);",
    );
    for (const name of [
      "20260905_boss_workspace.sql",
      "20260909b_boss_work_requests.sql",
    ])
      await db.exec(
        readFileSync(
          new URL("../../../../../lib/db/migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    for (const key of [
      "boss_assignments",
      "boss_work_requests",
      "boss_work_request_history",
      "boss_convention_submissions",
      "boss_template_reviews",
    ] as const) {
      const source = recordSources[key];
      await db.query(
        "SELECT " +
          source.fields.map((f) => "r." + f).join(",") +
          " FROM " +
          source.table +
          " r WHERE ($1::uuid IS NULL OR (" +
          source.where +
          "))",
        [null],
      );
    }
  } finally {
    await db.close();
  }
});
