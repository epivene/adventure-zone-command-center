import { describe, expect, it } from "vitest";
import { InMemoryActOutcomeRepository } from "./outcome-repository";

describe("InMemoryActOutcomeRepository", () => {
  it("seeds one outcome per source and is idempotent", async () => {
    const repo = new InMemoryActOutcomeRepository();
    const row = { runId: "r", sourceRecordId: "s", sourceVersionId: "v", state: "pending" as const };
    expect(await repo.seed(row)).toMatchObject(row);
    expect(await repo.seed({ ...row, state: "ready" })).toMatchObject(row);
    expect(await repo.list("r")).toHaveLength(1);
  });
});
