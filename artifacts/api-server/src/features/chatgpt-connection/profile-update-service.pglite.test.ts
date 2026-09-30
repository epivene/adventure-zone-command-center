import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { ProfileUpdateService } from "./profile-update-service";
import { profileRow } from "./read-service";
let f: Awaited<ReturnType<typeof fixture>>, service: ProfileUpdateService;
const sources = [
  {
    url: "https://fair.example",
    retrievedAt: "2026-09-30T00:00:00Z",
    eventYear: 2027,
    claim: "New public office number",
    verification: "verified" as const,
  },
];
beforeEach(async () => {
  f = await fixture();
  service = new ProfileUpdateService(f.db);
});
afterEach(async () => f.db.close());
async function propose() {
  return service.propose(
    f.principal,
    { requestKey: "proposal" },
    {
      profileId: f.profileId,
      expectedRevision: (await profileRow(f.db, f.profileId)).revision,
      values: { phone: "801-555-1234" },
      sources,
    },
  );
}
it("only applies the exact owner-approved proposal and returns the same receipt on retry", async () => {
  const proposal = await propose();
  expect((await profileRow(f.db, f.profileId)).phone).toBeNull();
  await expect(
    service.apply(
      f.principal,
      { requestKey: "forged" },
      { proposalId: proposal.recordId, approvalId: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_APPROVAL_REQUIRED" });
  await expect(
    service.approve("intruder", proposal.recordId, proposal.value.contentHash),
  ).rejects.toThrow();
  const approval = await service.approve(
    "owner",
    proposal.recordId,
    proposal.value.contentHash,
  );
  const input = {
    proposalId: proposal.recordId,
    approvalId: approval.approvalId,
  };
  const saved = await service.apply(
    f.principal,
    { requestKey: "apply" },
    input,
  );
  expect((await profileRow(f.db, f.profileId)).phone).toBe("801-555-1234");
  expect(
    await service.apply(f.principal, { requestKey: "apply" }, input),
  ).toEqual(saved);
  await expect(
    service.apply(f.principal, { requestKey: "twice" }, input),
  ).rejects.toMatchObject({ code: "CONNECTION_APPROVAL_REQUIRED" });
});
it.each(["stale", "merged", "deleted", "expired", "tampered"])(
  "rejects %s targets/approvals without overwriting",
  async (kind) => {
    const proposal = await propose();
    const approval = await service.approve(
      "owner",
      proposal.recordId,
      proposal.value.contentHash,
    );
    if (kind === "stale")
      await f.db.query(
        "UPDATE organizations SET updated_at=now()+interval '1 second'",
      );
    if (kind === "merged")
      await f.db.query("UPDATE organizations SET consolidated_into_id=$1", [
        randomUUID(),
      ]);
    if (kind === "deleted") await f.db.query("DELETE FROM organizations");
    if (kind === "expired")
      await f.db.query(
        "UPDATE chatgpt_update_proposals SET approval_expires_at=now()-interval '1 second'",
      );
    if (kind === "tampered")
      await f.db.query(
        `UPDATE chatgpt_update_proposals SET content=jsonb_set(content,'{values,phone}','"evil"')`,
      );
    await expect(
      service.apply(
        f.principal,
        { requestKey: "apply" },
        { proposalId: proposal.recordId, approvalId: approval.approvalId },
      ),
    ).rejects.toThrow();
  },
);
it("rejects business/organizer fields and unsupported organization email", async () => {
  const row = await profileRow(f.db, f.profileId);
  for (const values of [
    { status: "paid" },
    { organizer: "Joe" },
    { email: "office@example.com" },
  ])
    await expect(
      service.propose(
        f.principal,
        { requestKey: JSON.stringify(values) },
        {
          profileId: f.profileId,
          expectedRevision: row.revision,
          values,
          sources,
        },
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_INVALID_PROFILE_FIELDS" });
});
