import { describe, expect, it } from "vitest";
import { normalizeCompany } from "@/features/act-replacement/normalizers/company-normalizer";
import { normalizeContact } from "@/features/act-replacement/normalizers/contact-normalizer";
import { normalizeGroup } from "@/features/act-replacement/normalizers/group-normalizer";
import { normalizeOpportunity } from "@/features/act-replacement/normalizers/opportunity-normalizer";
import { normalizeTimeline } from "@/features/act-replacement/normalizers/timeline-normalizer";

const captured = "2026-08-01T15:30:00.000Z";
describe("pure Act normalization", () => {
  it("normalizes camel/Pascal organization addresses and reports safe unknown paths", () => {
    expect(
      normalizeCompany({
        Name: "Fair",
        Address: { Value: { Line1: "1 Main", City: "Austin", State: "TX" } },
        customFields: { secret: "x" },
        extra: "private@example.com",
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: "organization",
        name: "Fair",
        phone: null,
        website: null,
        industry: null,
        address1: "1 Main",
        address2: null,
        city: "Austin",
        region: "TX",
        postalCode: null,
      },
      warnings: ["unsupported_source_fields"],
      unsupportedFieldPaths: ["customFields[]", "unknownFields[]"],
    });
  });
  it("normalizes contact address and marks shared mailbox unsafe", () => {
    expect(
      normalizeContact({
        FirstName: "A",
        LastName: "B",
        EmailAddress: "Bookings+one@example.com",
        BusinessAddress: { line1: "1", city: "Austin", state: "TX" },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "contact",
        emailIdentityMatchSafe: false,
        address1: "1",
        city: "Austin",
      },
      warnings: ["shared_mailbox_email_identity_unsafe"],
    });
  });
  it("normalizes opportunity fields and exact local literals", () => {
    expect(
      normalizeOpportunity(
        {
          name: "Show",
          city: "Austin",
          state: "TX",
          venueName: "Hall",
          estimatedCloseDate: "2026-10-01T12:00:00Z",
          actualCloseDate: "2026-10-01T14:00:00Z",
          status: "confirmed",
          probability: 80,
          total: 1250,
          notes: "Bring power",
        },
        { organizationSourceId: "company-1" },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "booking",
        localStatus: "confirmed",
        probabilityPercent: 80,
        amount: "1250",
        organizationSourceId: "company-1",
      },
    });
  });
  it("flags unmapped literals without values in diagnostics", () => {
    const result = normalizeOpportunity({
      name: "Show",
      city: "Austin",
      state: "TX",
      status: "private status",
      probability: "private probability",
    });
    expect(result).toMatchObject({
      ok: true,
      warnings: [
        "unmapped_opportunity_probability",
        "unmapped_opportunity_status",
      ],
      unsupportedFieldPaths: ["probability", "status"],
    });
    expect(JSON.stringify(result.warnings)).not.toContain("private");
  });
  it.each([
    ["2026-02-30T12:00:00Z", "estimatedCloseDate"],
    ["1.5", "actualCloseDate"],
  ])("rejects malformed opportunity date %s at %s", (date, path) => {
    const raw =
      path === "estimatedCloseDate"
        ? {
            name: "Show",
            city: "Austin",
            state: "TX",
            estimatedCloseDate: date,
          }
        : { name: "Show", city: "Austin", state: "TX", actualCloseDate: date };
    expect(normalizeOpportunity(raw)).toMatchObject({
      ok: true,
      value:
        path === "estimatedCloseDate" ? { startsAt: null } : { endsAt: null },
      warnings: ["malformed_opportunity_date"],
      unsupportedFieldPaths: [path],
    });
  });
  it("flags an out-of-range opportunity probability", () => {
    expect(
      normalizeOpportunity({
        name: "Show",
        city: "Austin",
        state: "TX",
        probability: 101,
      }),
    ).toMatchObject({
      ok: true,
      value: { probabilityPercent: null, localProbability: null },
      warnings: ["unmapped_opportunity_probability"],
      unsupportedFieldPaths: ["probability"],
    });
  });
  it("normalizes group members only from supplied relationships", () => {
    expect(
      normalizeGroup(
        { Name: "Calls", description: "private" },
        { staticMemberSourceIds: ["b", "a", "b"] },
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: "calling_list",
        name: "Calls",
        staticMemberSourceIds: ["a", "b"],
        unsupportedFilter: null,
      },
      warnings: ["group_description_archived_only"],
      unsupportedFieldPaths: ["description"],
    });
  });
  it("maps note/history/activity and keeps undated activity out of calendar", () => {
    expect(
      normalizeTimeline(
        { subject: "N", body: "Note", createDate: "2026-07-01T00:00:00Z" },
        captured,
        "note",
      ),
    ).toMatchObject({
      ok: true,
      value: {
        category: "note",
        sourceType: "note",
        sourceOccurredAt: "2026-07-01T00:00:00Z",
        dateIsImportFallback: false,
        calendarCapable: false,
      },
    });
    expect(
      normalizeTimeline({ subject: "A", details: "Call back" }, captured),
    ).toMatchObject({
      ok: true,
      value: {
        category: "act_history",
        sourceOccurredAt: null,
        timelineSortAt: captured,
        dateIsImportFallback: true,
        calendarCapable: false,
      },
      warnings: ["source_date_unavailable"],
    });
    expect(
      normalizeTimeline(
        { details: "Call", scheduleDate: "2026-07-02T00:00:00Z", duration: 60 },
        captured,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        category: "calendar",
        calendarCapable: true,
        dateIsImportFallback: false,
      },
    });
  });
  it("flags activity duration as unsupported until an apply mapping exists", () => {
    expect(
      normalizeTimeline(
        { details: "Call", scheduleDate: "2026-07-02T00:00:00Z", duration: 60 },
        captured,
      ),
    ).toMatchObject({
      ok: true,
      warnings: ["unsupported_activity_duration"],
      unsupportedFieldPaths: ["duration"],
    });
  });
  it("returns precise partial issues and is deterministic without mutation or fetch", () => {
    const raw = Object.freeze({ phone: "1" });
    const first = normalizeCompany(raw);
    const second = normalizeCompany(raw);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: false,
      issueCode: "missing_required_name",
    });
    expect(raw).toEqual({ phone: "1" });
  });
});
