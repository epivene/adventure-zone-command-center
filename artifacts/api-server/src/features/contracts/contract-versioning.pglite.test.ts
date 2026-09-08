import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DrizzleContractRepository } from "./contract-repository";
import { guaranteedFeeSnapshot } from "./fixtures/guaranteed-fee.snapshot";
import type { ContractReadiness } from "./contract-types";

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.close())); });

const notReady: ContractReadiness = {
  ready: false,
  errors: [{ path: "contract", code: "CONTRACT_INCOMPLETE", message: "Complete the contract." }],
  warnings: [],
  coiMissing: ["certificateHolderName", "certificateHolderAddress", "additionalInsuredWording"],
};

async function setup() {
  const client = new PGlite();
  databases.push(client);
  await client.exec(`
    create table organizations (id uuid primary key);
    create table bookings (id uuid primary key, organization_id uuid references organizations(id));
  `);
  const migration = await readFile(
    fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)),
    "utf8",
  );
  await client.exec(migration);
  await client.exec(`
    insert into organizations values ('11111111-1111-4111-8111-111111111111');
    insert into bookings values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
    insert into contract_templates (id, stable_key, version, state, created_by)
    values ('33333333-3333-4333-8333-333333333333', 'adventure-zone-standard', 1, 'active', 'owner');
  `);
  return { client, repository: new DrizzleContractRepository(drizzle(client) as never) };
}

describe("DrizzleContractRepository versioning", () => {
  it("enforces optimistic draft revisions", async () => {
    const { repository } = await setup();
    const draft = await repository.createDraft({
      bookingId: guaranteedFeeSnapshot.bookingId, organizationId: guaranteedFeeSnapshot.organizationId,
      templateId: "33333333-3333-4333-8333-333333333333", templateVersion: 1,
      storedValues: { contract: {}, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" } },
      validationState: notReady, predecessorVersionId: null, actorId: "owner", now: new Date("2026-09-08T18:00:00Z"),
    });
    const first = await repository.saveDraft({
      draftId: draft.id, expectedRevision: 1, arrangement: "guaranteed_fee",
      storedValues: { contract: guaranteedFeeSnapshot, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" } },
      validationState: { ...notReady, ready: true, errors: [] }, actorId: "owner", now: new Date("2026-09-08T18:01:00Z"),
    });
    expect(first).toMatchObject({ kind: "saved", draft: { revision: 2 } });
    expect(await repository.saveDraft({
      draftId: draft.id, expectedRevision: 1, arrangement: "guaranteed_fee",
      storedValues: { contract: guaranteedFeeSnapshot, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" } },
      validationState: { ...notReady, ready: true, errors: [] }, actorId: "owner", now: new Date("2026-09-08T18:02:00Z"),
    })).toMatchObject({ kind: "stale", current: { revision: 2 } });
  });

  it("finalizes one immutable version per draft and links a replacement", async () => {
    const { repository } = await setup();
    const draft = await repository.createDraft({
      bookingId: guaranteedFeeSnapshot.bookingId, organizationId: guaranteedFeeSnapshot.organizationId,
      templateId: "33333333-3333-4333-8333-333333333333", templateVersion: 1,
      storedValues: { contract: guaranteedFeeSnapshot, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" } },
      validationState: { ...notReady, ready: true, errors: [] }, predecessorVersionId: null,
      actorId: "owner", now: new Date("2026-09-08T18:00:00Z"),
    });
    const input = {
      draftId: draft.id,
      snapshot: {
        values: guaranteedFeeSnapshot,
        template: { stableKey: "adventure-zone-standard", version: 1 },
        insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" },
        finalizedAt: "2026-09-08T18:00:00.000Z",
      },
      renderedLegalText: "Agreement version one",
      signerSnapshot: [guaranteedFeeSnapshot.eventSigner, guaranteedFeeSnapshot.internalSigner],
      actorId: "owner",
      finalizedAt: new Date("2026-09-08T18:00:00Z"),
    };
    const [first, retry] = await Promise.all([repository.finalizeDraft(input), repository.finalizeDraft(input)]);
    expect(first.version.id).toBe(retry.version.id);
    expect([first.reused, retry.reused].sort()).toEqual([false, true]);
    expect(first.version.versionNumber).toBe(1);

    const replacement = await repository.createDraft({
      bookingId: draft.bookingId, organizationId: draft.organizationId, templateId: draft.templateId, templateVersion: 1,
      storedValues: draft.storedValues, validationState: draft.validationState,
      predecessorVersionId: first.version.id, actorId: "owner", now: new Date("2026-09-08T19:00:00Z"),
    });
    const finalizedReplacement = await repository.finalizeDraft({ ...input, draftId: replacement.id, renderedLegalText: "Agreement version two" });
    expect(finalizedReplacement.version.versionNumber).toBe(2);
    expect(finalizedReplacement.version.predecessorVersionId).toBe(first.version.id);
    expect(await repository.getVersion(first.version.id)).toMatchObject({
      status: "superseded",
      supersedingVersionId: finalizedReplacement.version.id,
    });
  });
});
