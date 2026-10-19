import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./test-database";
import { ProfileMergeService } from "./profile-merge-service";
import type { SqlQuery } from "./contracts";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.db.close();
});
async function setup() {
  f = await fixture();
  const duplicate = randomUUID();
  await f.db.query(
    "INSERT INTO organizations(id,name,city,region) VALUES($1,'County Fair old','Town','UT')",
    [duplicate],
  );
  await f.db.exec(`CREATE TABLE deadline_notifications(
    id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
    title text,active boolean,dismissed_at timestamptz,email_state text);
    CREATE TABLE audit_entries(id uuid DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);`);
  // Exercise the deployed review constraints, including its non-cascading FKs.
  await f.db.exec(
    readFileSync(
      resolve(
        __dirname,
        "../../../../../lib/db/migrations/20261018_deadline_attention_reviews.sql",
      ),
      "utf8",
    ),
  );
  for (const [profile, group] of [
    [f.profileId, "owner"],
    [duplicate, "waiting"],
  ] as const) {
    const followup = randomUUID(),
      notice = randomUUID();
    await f.db.query(
      "INSERT INTO follow_ups(id,organization_id,kind,due_at) VALUES($1,$2,'Call organizer','2026-11-01')",
      [followup, profile],
    );
    await f.db.query(
      "INSERT INTO deadline_notifications VALUES($1,$2,'Follow up',true,'2026-10-16','disabled')",
      [notice, profile],
    );
    await f.db.query(
      `INSERT INTO deadline_attention_reviews(notification_id,follow_up_id,organization_id,source_kind,source_due_at,source_updated_at,review_group,next_action,reviewed_on,batch_key)
      VALUES($1,$2,$3,'Call organizer','2026-11-01','2026-10-16',$4,'Keep the original decision','2026-10-16','review-batch')`,
      [notice, followup, profile, group],
    );
  }
  const input = {
    primaryId: f.profileId,
    duplicateIds: [duplicate],
    reason: "Verified duplicate event",
    sources: [
      {
        url: "https://fair.example/about",
        retrievedAt: "2026-10-19T16:00:00Z",
        eventYear: 2027,
        claim: "Same event and venue",
        verification: "verified" as const,
      },
    ],
  };
  const core = async (tx: SqlQuery, primary: string, ids: string[]) => {
    await tx.query(
      "UPDATE follow_ups SET organization_id=$1 WHERE organization_id=ANY($2::uuid[])",
      [primary, ids],
    );
    await tx.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [ids]);
  };
  const service = new ProfileMergeService(f.db, core);
  const preview = await service.preview(
    f.principal,
    { requestKey: "preview" },
    input,
  );
  return { duplicate, service, preview, core };
}

it("approves and applies a merge preserving deadline review decisions and original association evidence", async () => {
  const { duplicate, service, preview } = await setup();
  expect(preview.value.blockers).toEqual([]);
  const before = (
    await f.db.query("SELECT * FROM deadline_attention_reviews ORDER BY id")
  ).rows;
  const notices = (
    await f.db.query("SELECT * FROM deadline_notifications ORDER BY id")
  ).rows;
  const approval = await service.approve(
    "owner",
    preview.recordId,
    preview.value.contentHash,
    true,
  );
  const input = {
    proposalId: preview.recordId,
    approvalId: approval.approvalId,
  };
  const receipt = await service.apply(
    f.principal,
    { requestKey: "merge" },
    input,
  );
  const after = (
    await f.db.query("SELECT * FROM deadline_attention_reviews ORDER BY id")
  ).rows;
  expect(after).toEqual(
    before.map((r) => ({ ...r, organization_id: f.profileId })),
  );
  expect(
    (await f.db.query("SELECT * FROM deadline_notifications ORDER BY id")).rows,
  ).toEqual(notices.map((r) => ({ ...r, organization_id: f.profileId })));
  // This is the join used by deadline summary; the historical review stays visible.
  expect(
    (
      await f.db.query(`SELECT a.id FROM deadline_attention_reviews a
    JOIN deadline_notifications n ON n.id=a.notification_id AND n.organization_id=a.organization_id
    JOIN follow_ups u ON u.id=a.follow_up_id AND u.organization_id=a.organization_id`)
    ).rows,
  ).toHaveLength(2);
  const audit = (
    await f.db.query(
      `SELECT "before","after" FROM audit_entries WHERE action='merge_sync_references'`,
    )
  ).rows[0];
  expect(audit.before.tables.deadline_attention_reviews).toHaveLength(2);
  expect(
    audit.before.tables.deadline_attention_reviews.some(
      (r: any) => r.organization_id === duplicate,
    ),
  ).toBe(true);
  expect(
    audit.after.tables.deadline_attention_reviews.every(
      (r: any) => r.organization_id === f.profileId,
    ),
  ).toBe(true);
  expect(
    (await service.apply(f.principal, { requestKey: "merge" }, input))
      .operationId,
  ).toBe(receipt.operationId);
});

it.each(["edit", "new"])(
  "rejects a changed deadline review (%s) after approval",
  async (change) => {
    const { duplicate, service, preview } = await setup();
    const approval = await service.approve(
      "owner",
      preview.recordId,
      preview.value.contentHash,
      true,
    );
    if (change === "edit")
      await f.db.query(
        "UPDATE deadline_attention_reviews SET next_action='New owner decision' WHERE organization_id=$1",
        [duplicate],
      );
    else
      await f.db.query(
        `INSERT INTO deadline_attention_reviews(notification_id,follow_up_id,organization_id,source_kind,source_due_at,source_updated_at,review_group,next_action,reviewed_on,batch_key)
    SELECT notification_id,follow_up_id,organization_id,source_kind,source_due_at,source_updated_at,'calls','New review','2026-10-19','new-batch' FROM deadline_attention_reviews WHERE organization_id=$1`,
        [duplicate],
      );
    await expect(
      service.apply(
        f.principal,
        { requestKey: "merge" },
        { proposalId: preview.recordId, approvalId: approval.approvalId },
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_STALE_MERGE" });
    expect((await f.db.query("SELECT * FROM organizations")).rows).toHaveLength(
      2,
    );
  },
);

it("rolls back deadline review moves and audit when a later merge step fails", async () => {
  const { service, preview, core } = await setup();
  const before = (
    await f.db.query("SELECT * FROM deadline_attention_reviews ORDER BY id")
  ).rows;
  const notices = (
    await f.db.query("SELECT * FROM deadline_notifications ORDER BY id")
  ).rows;
  const approval = await service.approve(
    "owner",
    preview.recordId,
    preview.value.contentHash,
    true,
  );
  const failing = new ProfileMergeService(f.db, async (tx, primary, ids) => {
    await core(tx, primary, ids);
    throw Error("later failure");
  });
  await expect(
    failing.apply(
      f.principal,
      { requestKey: "merge" },
      { proposalId: preview.recordId, approvalId: approval.approvalId },
    ),
  ).rejects.toThrow("later failure");
  expect(
    (await f.db.query("SELECT * FROM deadline_attention_reviews ORDER BY id"))
      .rows,
  ).toEqual(before);
  expect(
    (await f.db.query("SELECT * FROM deadline_notifications ORDER BY id")).rows,
  ).toEqual(notices);
  expect((await f.db.query("SELECT * FROM audit_entries")).rows).toEqual([]);
});
