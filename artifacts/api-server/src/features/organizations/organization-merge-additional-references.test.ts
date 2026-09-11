import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("organization merge additional references", () => {
  const source = readFileSync(
    new URL("./organization-merge-additional-references.ts", import.meta.url),
    "utf8",
  );

  it("preserves communication, note, attendance, phone, and source history", () => {
    for (const table of [
      "office_mail_activity",
      "office_email_drafts",
      "lead_gmail_draft_links",
      "communication_blocks",
      "paper_note_entries",
      "organization_phones",
      "event_attendance_history",
      "business_source_document_links",
    ]) {
      expect(source).toContain(table);
    }
  });

  it("resolves opportunity conflicts without dropping sent email history", () => {
    expect(source).toContain("UPDATE booking_opportunity_email_state duplicate_email");
    expect(source).toContain("SET state = 'cancelled'");
    expect(source).toContain("SET opportunity_id = surviving_opportunity.id");
    expect(source).toContain("INSERT INTO booking_opportunity_queue_overrides");
  });

  it("preserves optional research, derived fact, and scout history", () => {
    expect(source).toContain("derived_crm_facts");
    expect(source).toContain("profile_research_runs");
    expect(source).toContain("lead_scout_candidates");
    expect(source).toContain("scout_alert_watches");
    expect(source).toContain("scout_alerts");
  });
})

  it("preserves directory import audit records", () => {
    expect(source).toContain("'directory_import_records'");
    expect(source).toContain("UPDATE directory_import_records");
    expect(source).toContain("SET organization_id = ${primaryId}");
    expect(source).toContain("WHERE organization_id = ${duplicateId}");
  });;