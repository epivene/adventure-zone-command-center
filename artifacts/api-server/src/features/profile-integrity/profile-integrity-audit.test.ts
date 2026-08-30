import { describe, expect, it } from "vitest";

import { ProfileIntegrityAuditService } from "./profile-integrity-audit";

type Row = Record<string, unknown>;

class FakePool {
  constructor(private readonly responses: Array<{ marker: string; rows: Row[] }>) {}

  async query(sql: string): Promise<{ rows: Row[] }> {
    const match = this.responses.find((response) => sql.includes(response.marker));
    return { rows: match?.rows ?? [] };
  }
}

describe("ProfileIntegrityAuditService", () => {
  it("reports profile coverage, exact duplicate appearances, and structured calendar status mismatches", async () => {
    const pool = new FakePool([
      {
        marker: "WITH profile_contacts AS",
        rows: [{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Pirate Fest",
          city: "Northglenn",
          region: "CO",
          act_record_id: "ACT-COMPANY-1",
          updated_at: "2026-08-30T12:00:00.000Z",
          contact_count: "2",
          appearance_count: "2",
          act_appearance_count: "1",
          timeline_count: "8",
          first_timeline_at: "2025-01-02T12:00:00.000Z",
          latest_timeline_at: "2026-08-28T12:00:00.000Z",
          open_follow_up_count: "1",
          gmail_thread_count: "3",
          calendar_link_count: "1",
          pending_calendar_review_count: "0",
        }],
      },
      {
        marker: "WITH candidates AS (\n  SELECT b.id",
        rows: [{
          organization_id: "11111111-1111-4111-8111-111111111111",
          profile_name: "Pirate Fest",
          event_name: "Pirate Fest - 2026",
          city: "northglenn",
          region: "CO",
          starts_on: "2026-09-18",
          ends_on: "2026-09-19",
          duplicate_count: "2",
          appearance_ids: [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
          ],
          statuses: ["pending_decision", "confirmed"],
          act_record_ids: ["ACT-OPPORTUNITY-1"],
        }],
      },
      {
        marker: "FROM google_workspace_connections\n ORDER BY role",
        rows: [{
          account_email: "booking@example.com",
          role: "workspace",
          status: "connected",
        }],
      },
      {
        marker: "FROM google_workspace_validation_state s",
        rows: [{
          account_email: "booking@example.com",
          validation_status: "approved",
          mapped_message_count: "6",
          mapped_thread_count: "3",
          mapped_profile_count: "1",
        }],
      },
      {
        marker: "FROM google_operational_calendar_links l\n  JOIN bookings b",
        rows: [{
          organization_id: "11111111-1111-4111-8111-111111111111",
          profile_name: "Pirate Fest",
          booking_id: "22222222-2222-4222-8222-222222222222",
          status: "pending_decision",
          google_event_id: "google-event-1",
          calendar_id: "primary",
          package_key: "zone",
          starts_at: "2026-09-18T12:00:00.000Z",
          ends_at: "2026-09-19T12:00:00.000Z",
        }],
      },
    ]);

    const report = await new ProfileIntegrityAuditService(pool).run(
      new Date("2026-08-30T18:00:00.000Z"),
    );

    expect(report.mode).toBe("read_only");
    expect(report.summary.profileCount).toBe(1);
    expect(report.summary.profileWithActSourceCount).toBe(1);
    expect(report.summary.profileWithGmailCount).toBe(1);
    expect(report.summary.profileWithCalendarCount).toBe(1);
    expect(report.summary.duplicateAppearanceGroupCount).toBe(1);
    expect(report.issues.map((item) => item.code)).toEqual([
      "calendar_status_mismatch",
      "duplicate_appearance_exact",
    ]);
    expect(report.issues.every((item) => item.autoFixable)).toBe(true);
  });

  it("does not silently merge ambiguous duplicate contacts or missing ACT company matches", async () => {
    const pool = new FakePool([
      {
        marker: "WITH profile_contacts AS",
        rows: [{
          id: "44444444-4444-4444-8444-444444444444",
          name: "Example Fair",
          city: "Example",
          region: "ND",
          act_record_id: null,
          contact_count: "2",
          appearance_count: "1",
          act_appearance_count: "0",
          timeline_count: "4",
          open_follow_up_count: "0",
          gmail_thread_count: "0",
          calendar_link_count: "0",
          pending_calendar_review_count: "0",
        }],
      },
      {
        marker: "WITH candidates AS (\n  SELECT oc.organization_id",
        rows: [{
          organization_id: "44444444-4444-4444-8444-444444444444",
          profile_name: "Example Fair",
          contact_name: "Alex Smith",
          email: "alex@example.com",
          normalized_phone: "7015551212",
          duplicate_count: "2",
          contact_ids: [
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
          ],
          act_record_ids: [],
        }],
      },
    ]);

    const report = await new ProfileIntegrityAuditService(pool).run(
      new Date("2026-08-30T18:00:00.000Z"),
    );

    expect(report.issues.map((item) => item.code)).toEqual([
      "duplicate_profile_contact",
      "profile_without_act_company_id",
    ]);
    expect(report.issues.every((item) => item.autoFixable === false)).toBe(true);
  });
});
