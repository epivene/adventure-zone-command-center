import { describe, expect, it } from "vitest";
import { auditInternalEventDateEvidence, type InternalEventDateEvidence } from "./internal-event-date-evidence";
import { extractProfileHistoryEventDateEvidence } from "@/features/profile-research/profile-research-history-clues";

const evidence = (sourceType: string, startsOn: string, kind: InternalEventDateEvidence["evidenceKind"] = "published_exact"): InternalEventDateEvidence => ({
  startsOn, endsOn: null, evidenceKind: kind, sourceKind: "internal",
  sourceType, sourceId: sourceType + "-1", sourceLabel: sourceType, excerpt: startsOn,
});

describe("auditInternalEventDateEvidence", () => {
  it.each(["activity_note", "email", "source_document", "act_import", "attendance_history", "prior_research"])(
    "accepts unambiguous exact evidence from %s",
    (sourceType) => {
      expect(auditInternalEventDateEvidence({
        today: "2026-09-21", evidence: [evidence(sourceType, "2027-06-10")],
      })).toMatchObject({ resolution: "confirmed", startsOn: "2027-06-10" });
    },
  );

  it("returns a future booking immediately", () => {
    expect(auditInternalEventDateEvidence({
      today: "2026-09-21",
      evidence: [evidence("booking", "2027-07-01", "booking"), evidence("email", "2027-06-01")],
    })).toMatchObject({ resolution: "booked", startsOn: "2027-07-01" });
  });

  it("sends disagreeing exact sources to review", () => {
    expect(auditInternalEventDateEvidence({
      today: "2026-09-21",
      evidence: [evidence("email", "2027-06-01"), evidence("source_document", "2027-06-08")],
    }).resolution).toBe("needs_review");
  });

  it("sends an exact and recurrence disagreement to review", () => {
    expect(auditInternalEventDateEvidence({
      today: "2026-09-21",
      evidence: [
        evidence("email", "2027-06-01"),
        { ...evidence("attendance_history", "2027-06-08", "recurrence_clue"), recurrenceRule: { kind: "annual_date", month: 6, day: 8, durationDays: 1 } },
      ],
    }).resolution).toBe("needs_review");
  });

  it("extracts only explicitly labelled event dates from activity history", () => {
    const notes = [
      { id: "note-1", body: "Called 2026-10-01. Event dates: 2027-06-10 to 2027-06-12", subject: "Dates", importedFromAct: false },
      { id: "note-2", body: "Invoice due 2027-07-01", subject: null, importedFromAct: false },
    ];
    expect(extractProfileHistoryEventDateEvidence({ notes } as never)).toEqual([
      expect.objectContaining({ startsOn: "2027-06-10", endsOn: "2027-06-12", sourceId: "note-1" }),
    ]);
  });

});
