import { describe, expect, it } from "vitest";

import {
  assistantConversations,
  assistantMessageSources,
  assistantMessages,
  businessKnowledgeEntries,
  derivedCrmFacts,
} from "./booking-assistant-schema";

describe("booking assistant schema", () => {
  it("exports the five assistant persistence tables", () => {
    expect(businessKnowledgeEntries).toBeDefined();
    expect(derivedCrmFacts).toBeDefined();
    expect(assistantConversations).toBeDefined();
    expect(assistantMessages).toBeDefined();
    expect(assistantMessageSources).toBeDefined();
  });

  it("keeps derived facts separate from source CRM records", () => {
    expect(derivedCrmFacts.organizationId).toBeDefined();
    expect(derivedCrmFacts.contactId).toBeDefined();
    expect(derivedCrmFacts.bookingId).toBeDefined();
    expect(derivedCrmFacts.sourceActivityId).toBeDefined();
    expect(derivedCrmFacts.sourceRecordId).toBeDefined();
    expect(derivedCrmFacts.sourceVersionId).toBeDefined();
    expect(derivedCrmFacts.extractionFingerprint).toBeDefined();
  });

  it("stores answer mode and source links without provider reasoning fields", () => {
    expect(assistantMessages.answerMode).toBeDefined();
    expect(assistantMessages.confidence).toBeDefined();
    expect(assistantMessageSources.sourceKind).toBeDefined();
    expect(assistantMessageSources.sourceRecordId).toBeDefined();
    expect("prompt" in assistantMessages).toBe(false);
    expect("reasoning" in assistantMessages).toBe(false);
  });
});
