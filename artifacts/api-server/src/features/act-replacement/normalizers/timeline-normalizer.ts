import {
  bad,
  d,
  ok,
  record,
  text,
  unknown,
  validDate,
  type NormalizeResult,
} from "./value-readers";
export type Timeline = {
  kind: "timeline";
  category: "note" | "act_history" | "calendar";
  sourceType: "note" | "history" | "activity";
  subject: string | null;
  body: string;
  sourceOccurredAt: string | null;
  timelineSortAt: string;
  dateIsImportFallback: boolean;
  endsAt: string | null;
  status: string | null;
  calendarCapable: boolean;
};
const allowed = new Set([
  "subject",
  "Subject",
  "body",
  "Body",
  "details",
  "Details",
  "createDate",
  "CreateDate",
  "scheduleDate",
  "ScheduleDate",
  // Alternate start-date field names returned by some Act! API versions
  "startDate",
  "StartDate",
  "date",
  "Date",
  "activityDate",
  "ActivityDate",
  // End-date fields for multi-day calendar events
  "endDate",
  "EndDate",
  "endTime",
  "EndTime",
  // Act! Web API field names observed in real payloads
  "startTime",
  "StartTime",
  "created",
  "Created",
  "edited",
  "Edited",
  "displayDate",
  "DisplayDate",
  "noteText",
  "NoteText",
  "regarding",
  "Regarding",
  "duration",
  "Duration",
  "status",
  "Status",
  "id",
  "Id",
  "ID",
  "customFields",
  "CustomFields",
]);
export const normalizeTimeline = (
  raw: unknown,
  capturedAt: string,
  sourceType: Timeline["sourceType"] = "activity",
): NormalizeResult<Timeline> => {
  const z = d(),
    r = record(raw);
  if (!r) return bad({}, "invalid_source_record", z);
  const date = text(
    r,
    sourceType === "activity"
      ? [
          // Primary Act! field name, then alternate names returned by older
          // or customized Act! API deployments. The Act! Web API returns
          // "startTime" for activities.
          "scheduleDate",
          "ScheduleDate",
          "startTime",
          "StartTime",
          "startDate",
          "StartDate",
          "activityDate",
          "ActivityDate",
          "date",
          "Date",
        ]
      : sourceType === "note"
        ? // Act! Web API notes carry the user-visible date in "displayDate";
          // fall back to the record creation timestamp.
          ["displayDate", "DisplayDate", "createDate", "CreateDate", "created", "Created"]
        : // Act! Web API histories carry the event time in "startTime";
          // fall back to the record creation timestamp.
          ["startTime", "StartTime", "createDate", "CreateDate", "created", "Created"],
  );
  const occurred = validDate(date) ? date : null;
  if (!occurred) z.w.add("source_date_unavailable");
  if (date && !occurred)
    z.p.add(sourceType === "activity" ? "scheduleDate" : "createDate");

  // Extract end date for multi-day calendar events (fairs, festivals, etc.)
  const endDateRaw =
    sourceType === "activity"
      ? text(r, ["endDate", "EndDate", "endTime", "EndTime"])
      : null;
  const endsAt =
    endDateRaw && validDate(endDateRaw) ? endDateRaw : null;

  const body =
    text(
      r,
      sourceType === "note"
        ? // Act! Web API notes carry their content in "noteText"
          ["noteText", "NoteText", "body", "Body"]
        : ["details", "Details", "body", "Body"],
    ) ?? "";
  // Act! histories/activities frequently have an empty details field but a
  // meaningful one-line summary in "regarding" (histories) or "subject"
  // (activities). Treat that summary as the subject and accept it as the
  // body when no long-form content exists, instead of rejecting the record.
  const subject = text(r, ["subject", "Subject", "regarding", "Regarding"]);
  const effectiveBody = body || subject || "";
  const category: Timeline["category"] =
    sourceType === "note"
      ? "note"
      : sourceType === "activity" && occurred
        ? "calendar"
        : "act_history";
  const v = {
    kind: "timeline" as const,
    category,
    sourceType,
    subject,
    body: effectiveBody,
    sourceOccurredAt: occurred,
    timelineSortAt: occurred ?? capturedAt,
    dateIsImportFallback: !occurred,
    endsAt,
    status: sourceType === "activity" ? text(r, ["status", "Status"]) : null,
    calendarCapable: sourceType === "activity" && !!occurred,
  };
  unknown(r, allowed, z);
  if (Object.hasOwn(r, "duration") || Object.hasOwn(r, "Duration")) {
    z.w.add("unsupported_activity_duration");
    z.p.add("duration");
  }
  if (!validDate(capturedAt)) return bad(v, "invalid_capture_timestamp", z);
  return effectiveBody ? ok(v, z) : bad(v, "missing_required_timeline_body", z);
};
