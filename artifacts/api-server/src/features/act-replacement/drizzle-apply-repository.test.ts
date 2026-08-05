import { describe, expect, it } from "vitest";
import { DrizzleApplyRepository, createDrizzleApplyRepository } from "./drizzle-apply-repository";

describe("DrizzleApplyRepository", () => {
  it("advertises durable apply and is created lazily from an injected database", () => {
    const database = {} as never;
    const repository = createDrizzleApplyRepository(database);
    expect(repository).toBeInstanceOf(DrizzleApplyRepository);
    expect(repository.durableApply).toBe(true);
  });

  it("fails closed for unsupported target types before any SQL is issued", async () => {
    const database = { execute: async () => { throw new Error("SQL must not run"); } } as never;
    const repository = new DrizzleApplyRepository(database);
    await expect(repository.createTarget("arbitrary_table", { normalized: {} }, "source-1"))
      .rejects.toMatchObject({ code: "unsupported_target_type" });
  });
});
