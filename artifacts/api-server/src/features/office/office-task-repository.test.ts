import { describe, expect, it } from "vitest";
import { officeTaskUpdateSet, toOfficeTaskView } from "./office-task-repository";

const row = {
  id: "10000000-0000-4000-8000-000000000001",
  officeAccountId: "20000000-0000-4000-8000-000000000001",
  taskType: "contact_verification" as const,
  title: "Verify fair contact",
  instructions: "Confirm who handles contracts.",
  organizationId: "30000000-0000-4000-8000-000000000001",
  organizationName: "County Fair",
  contactId: "40000000-0000-4000-8000-000000000001",
  contactFirstName: "Alex",
  contactLastName: "Smith",
  status: "todo" as const,
  needsHelp: false,
  coordinatorNote: null,
  ownerSortOrder: 1000,
  dueAt: null,
  createdAt: new Date("2026-08-21T12:00:00Z"),
  updatedAt: new Date("2026-08-21T12:00:00Z"),
  completedAt: null,
};

describe("office task repository helpers", () => {
  it("never exposes account ownership or private owner ordering in Office DTOs", () => {
    const view = toOfficeTaskView(row);
    expect(view).not.toHaveProperty("officeAccountId");
    expect(view).not.toHaveProperty("ownerSortOrder");
    expect(view.profile).toEqual({ id: row.organizationId, name: "County Fair" });
    expect(view.contact).toEqual({ id: row.contactId, name: "Alex Smith" });
  });

  it("sets completion time only for Done and clears it when reopened", () => {
    const now = new Date("2026-08-21T15:00:00Z");
    expect(officeTaskUpdateSet({ status: "done" }, now).completedAt).toEqual(now);
    expect(officeTaskUpdateSet({ status: "waiting" }, now).completedAt).toBeNull();
  });
});
