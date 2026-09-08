import { describe, expect, it } from "vitest";

import {
  contractCoiDrafts,
  contractDrafts,
  contractFiles,
  contractSettings,
  contractStatusEvents,
  contractTemplates,
  contractVersions,
} from "@workspace/db/schema";

describe("contract schema", () => {
  it("exports the persisted contract workflow", () => {
    expect(contractTemplates.stableKey).toBeDefined();
    expect(contractSettings.internalSignerEmail).toBeDefined();
    expect(contractDrafts.revision).toBeDefined();
    expect(contractVersions.snapshot).toBeDefined();
    expect(contractFiles.kind).toBeDefined();
    expect(contractStatusEvents.toStatus).toBeDefined();
    expect(contractCoiDrafts.gmailDraftId).toBeDefined();
  });
});
