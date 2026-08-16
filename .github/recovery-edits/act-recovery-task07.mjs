import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`No change: ${path}`);
    return;
  }
  await writeFile(path, after);
  console.log(`Updated: ${path}`);
}

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`Missing ${label}`);
  return text.replace(before, after);
}

await edit("artifacts/api-server/src/features/activities/activity-repository.ts", (text) => {
  text = replaceRequired(
    text,
    `    callOutcome,\n    hasLinkedCallSession: callOutcome !== null,\n  };`,
    `    callOutcome,\n    hasLinkedCallSession: callOutcome !== null,\n    importedFromAct: Boolean(activity.sourceRecordId),\n    actSourceType:\n      activity.sourceType === "note" ||\n      activity.sourceType === "history" ||\n      activity.sourceType === "activity"\n        ? activity.sourceType\n        : null,\n  };`,
    "activity provenance projection",
  );
  text = replaceRequired(
    text,
    `      if (!before) return err({ code: "ACTIVITY_NOT_FOUND" });\n\n      const [linkedCallSession] = input.callOutcome`,
    `      if (!before) return err({ code: "ACTIVITY_NOT_FOUND" });\n      if (before.sourceRecordId) {\n        return err({\n          code: "INVALID_ACTIVITY_INPUT",\n          message: "Imported ACT history is read-only. Add a new note to record a correction.",\n        });\n      }\n\n      const [linkedCallSession] = input.callOutcome`,
    "imported ACT edit guard",
  );
  return text;
});

await edit("artifacts/api-server/src/features/event-profiles/event-profile-repository.ts", (text) => {
  text = replaceRequired(
    text,
    `import { and, asc, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";`,
    `import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";`,
    "isNotNull import",
  );
  text = replaceRequired(
    text,
    `export type EventProfileActivityRecord = {\n  id: string;\n  contactId: string | null;\n  bookingId: string | null;\n  kind: string;\n  body: string;\n  occurredAt: Date;\n};`,
    `export type EventProfileActivityRecord = {\n  id: string;\n  contactId: string | null;\n  bookingId: string | null;\n  kind: string;\n  body: string;\n  occurredAt: Date;\n  createdAt: Date;\n  updatedAt: Date;\n  importedFromAct: boolean;\n  actSourceType: string | null;\n};`,
    "event profile activity type",
  );
  text = replaceRequired(
    text,
    `        kind: activities.kind,\n        body: activities.body,\n        occurredAt: activities.timelineSortAt,\n      }).from(activities)`,
    `        kind: activities.kind,\n        body: activities.body,\n        occurredAt: activities.timelineSortAt,\n        createdAt: activities.createdAt,\n        updatedAt: activities.updatedAt,\n        importedFromAct: isNotNull(activities.sourceRecordId),\n        actSourceType: activities.sourceType,\n      }).from(activities)`,
    "event profile activity provenance select",
  );
  return text;
});

await edit("artifacts/adventure-zone/src/features/event-profiles/event-profile-repository.ts", (text) => {
  text = replaceRequired(
    text,
    `  occurredAt: Date;\n  createdAt: Date;\n  updatedAt: Date;\n};`,
    `  occurredAt: Date;\n  createdAt: Date;\n  updatedAt: Date;\n  importedFromAct?: boolean;\n  actSourceType?: string | null;\n};`,
    "client event profile activity provenance type",
  );
  return text;
});

await edit("artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx", (text) => {
  text = replaceRequired(
    text,
    `                  callOutcome: null,\n                  hasLinkedCallSession: false,\n                }))}`,
    `                  callOutcome: null,\n                  hasLinkedCallSession: false,\n                  importedFromAct: Boolean(note.importedFromAct),\n                  actSourceType:\n                    note.actSourceType === "note" ||\n                    note.actSourceType === "history" ||\n                    note.actSourceType === "activity"\n                      ? note.actSourceType\n                      : null,\n                }))}`,
    "workspace ACT provenance mapping",
  );
  return text;
});

await edit("artifacts/adventure-zone/src/components/activities/activity-timeline.tsx", (text) => {
  text = replaceRequired(
    text,
    `function formatCallOutcome(outcome: PersistedCallDisposition) {\n  const label = outcome.replaceAll("_", " ");\n  return label.charAt(0).toUpperCase() + label.slice(1);\n}\n`,
    `function formatCallOutcome(outcome: PersistedCallDisposition) {\n  const label = outcome.replaceAll("_", " ");\n  return label.charAt(0).toUpperCase() + label.slice(1);\n}\n\nfunction formatActSourceType(sourceType: ActivityTimelineItem["actSourceType"]) {\n  if (!sourceType) return "History";\n  return sourceType.charAt(0).toUpperCase() + sourceType.slice(1);\n}\n`,
    "ACT source label helper",
  );
  text = replaceRequired(
    text,
    `                  <p className="text-sm font-semibold capitalize">\n                    {activity.kind.replaceAll("_", " ")}\n                  </p>`,
    `                  <div>\n                    <p className="text-sm font-semibold capitalize">\n                      {activity.kind.replaceAll("_", " ")}\n                    </p>\n                    {activity.importedFromAct ? (\n                      <p className="mt-1 text-xs font-semibold text-amber-800">\n                        Imported from ACT · {formatActSourceType(activity.actSourceType)}\n                      </p>\n                    ) : null}\n                  </div>`,
    "ACT provenance timeline label",
  );
  text = replaceRequired(
    text,
    `                {editActivity ? (`,
    `                {editActivity && !activity.importedFromAct ? (`,
    "hide ACT edit control",
  );
  text = replaceRequired(
    text,
    `                {deleteActivity ? (`,
    `                {deleteActivity && !activity.importedFromAct ? (`,
    "hide ACT delete control",
  );
  return text;
});
