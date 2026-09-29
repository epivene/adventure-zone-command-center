import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { validateSelectionAccess } from "./selection-access";
import { emptySelection } from "./contracts";
it("accepts existing profile scope and rejects missing records and attached authority", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE organizations(id uuid primary key); INSERT INTO organizations VALUES ('11111111-1111-4111-8111-111111111111')",
    );
    const actor = { id: "owner", role: "owner" as const, connectionId: null };
    const scope = {
      ...emptySelection(),
      organizationIds: ["11111111-1111-4111-8111-111111111111"],
    };
    expect(await validateSelectionAccess(db, actor, scope)).toEqual(scope);
    await expect(
      validateSelectionAccess(db, actor, {
        ...scope,
        organizationIds: ["22222222-2222-4222-8222-222222222222"],
      }),
    ).rejects.toThrow();
    await expect(
      validateSelectionAccess(db, actor, { ...scope, threadId: "unrelated" }),
    ).rejects.toThrow();
    await expect(
      validateSelectionAccess(db, { ...actor, role: "manager" } as any, scope),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
