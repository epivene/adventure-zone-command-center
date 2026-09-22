import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCoverageProfiles, retryCoverageItem, reviewCoverageFact, startCoverageRun } from "./event-date-coverage-api";

describe("event date coverage API", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))); });
  it("encodes list filters and uses explicit owner actions", async () => {
    await getCoverageProfiles({ search: "River Days", status: "missing" });
    await startCoverageRun({ batchSize: 25 });
    await retryCoverageItem("item/1");
    await reviewCoverageFact("fact/1", "approve_expected");
    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[0]?.[0])).toContain("search=River+Days&status=missing");
    expect(calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ batchSize: 25 }) });
    expect(String(calls[2]?.[0])).toContain("item%2F1/retry");
    expect(calls[3]?.[1]).toMatchObject({ body: JSON.stringify({ decision: "approve_expected" }) });
  });
});
