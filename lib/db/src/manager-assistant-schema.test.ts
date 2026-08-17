import { describe, expect, it } from "vitest";

import {
  managerAdminQuestionResponses,
  managerAdminQuestions,
  operationsKnowledgeEntries,
} from "./manager-assistant-schema";

describe("manager assistant schema", () => {
  it("exports admin question, response, and reusable operations knowledge tables", () => {
    expect(managerAdminQuestions).toBeDefined();
    expect(managerAdminQuestionResponses).toBeDefined();
    expect(operationsKnowledgeEntries).toBeDefined();
  });

  it("keeps offline retry identity and leg scope on every admin question", () => {
    expect(managerAdminQuestions.clientMutationId).toBeDefined();
    expect(managerAdminQuestions.travelLegId).toBeDefined();
    expect(managerAdminQuestions.managerSessionSubject).toBeDefined();
    expect(managerAdminQuestions.contextSnapshot).toBeDefined();
    expect(managerAdminQuestions.checkedSourceRefs).toBeDefined();
  });

  it("stores admin responses separately from official booking and route data", () => {
    expect(managerAdminQuestionResponses.questionId).toBeDefined();
    expect(managerAdminQuestionResponses.actorType).toBeDefined();
    expect(managerAdminQuestionResponses.body).toBeDefined();
    expect(operationsKnowledgeEntries.sourceAdminQuestionId).toBeDefined();
    expect(operationsKnowledgeEntries.scope).toBeDefined();
  });
});
