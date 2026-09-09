import { describe, expect, it } from "vitest";
import {
  bossConventionDrafts,
  bossConventionSubmissions,
  bossWorkRequestEvents,
  bossWorkRequests,
  communicationTemplateReviews,
  communicationTemplates,
} from "@/db/schema";

describe("Boss work request schema", () => {
  it("exports the complete durable aggregate", () => {
    expect(Object.keys(bossWorkRequests)).toEqual(expect.arrayContaining([
      "id", "type", "state", "priority", "instructions", "dueAt",
      "createdByOwnerId", "assignedBossAccountId", "deduplicationKey",
      "createdAt", "updatedAt",
    ]));
    expect(Object.keys(bossWorkRequestEvents)).toEqual(expect.arrayContaining([
      "requestId", "actorKind", "actorId", "priorState", "newState", "note", "createdAt",
    ]));
    expect(Object.keys(bossConventionDrafts)).toEqual(expect.arrayContaining([
      "requestId", "bossAccountId", "clientRevision", "payload", "updatedAt",
    ]));
    expect(Object.keys(bossConventionSubmissions)).toEqual(expect.arrayContaining([
      "requestId", "clientMutationId", "payload", "editVersion",
      "appliedOrganizationId", "appliedContactId", "appliedAt",
    ]));
    expect(Object.keys(communicationTemplateReviews)).toEqual(expect.arrayContaining([
      "requestId", "templateId", "templateVersion", "contentFingerprint",
      "subjectSnapshot", "bodySnapshot", "bodyFormatSnapshot", "decision", "note",
    ]));
    expect(Object.keys(communicationTemplates)).toContain("bodyFormat");
  });
});
