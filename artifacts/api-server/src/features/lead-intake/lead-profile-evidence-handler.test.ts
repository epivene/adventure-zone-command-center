import { describe, expect, it } from "vitest";

import { createLeadProfileEvidenceHandler } from "./lead-profile-evidence-handler";

function responseRecorder() {
  const result = { statusCode: 200, body: undefined as unknown };
  return {
    result,
    response: {
      status(code: number) { result.statusCode = code; return this; },
      json(body: unknown) { result.body = body; },
    },
  };
}

describe("createLeadProfileEvidenceHandler", () => {
  it("rejects a malformed organization id without querying evidence", async () => {
    let calls = 0;
    const handler = createLeadProfileEvidenceHandler({ load: async () => { calls += 1; return null; } });
    const { result, response } = responseRecorder();
    await handler({ params: { organizationId: "bad" } }, response);
    expect(result).toEqual({ statusCode: 400, body: { error: "Invalid profile." } });
    expect(calls).toBe(0);
  });

  it("returns only the bounded evidence payload", async () => {
    const evidence = { organization: { id: "10000000-0000-4000-8000-000000000001", name: "Alamosa" }, contacts: [], actText: [], emailCandidates: [] };
    const handler = createLeadProfileEvidenceHandler({ load: async () => evidence as never });
    const { result, response } = responseRecorder();
    await handler({ params: { organizationId: "10000000-0000-4000-8000-000000000001" } }, response);
    expect(result).toEqual({ statusCode: 200, body: { evidence } });
  });

  it("returns not found for a missing or consolidated profile", async () => {
    const handler = createLeadProfileEvidenceHandler({ load: async () => null });
    const { result, response } = responseRecorder();
    await handler({ params: { organizationId: "10000000-0000-4000-8000-000000000001" } }, response);
    expect(result).toEqual({ statusCode: 404, body: { error: "Profile not found." } });
  });
});
