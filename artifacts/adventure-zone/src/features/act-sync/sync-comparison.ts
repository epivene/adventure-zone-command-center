import type { RemoteActContact } from "@/features/act-sync/act-types";
import {
  canonicalContactSnapshot,
  contactSnapshotsEqual,
  type ContactSnapshot,
} from "@/features/act-sync/contact-snapshot";
import type { ContactFields } from "@/features/contacts/contact-types";

export type LocalSyncContact = ContactFields & {
  id: string;
  actRecordId: string | null;
  baseSnapshot: ContactSnapshot | null;
  actEditedAt: string | null;
};

export const syncComparisonCategories = [
  "new_in_act",
  "new_in_app",
  "changed_in_act",
  "changed_in_app",
  "changed_in_both",
  "possible_match",
  "already_matched",
  "missing_from_act",
  "error",
] as const;

export type SyncComparisonCategory =
  (typeof syncComparisonCategories)[number];

export const syncDecisionValues = [
  "pull",
  "push",
  "keep_act",
  "keep_app",
  "link",
  "keep_separate",
  "skip",
] as const;

export type SyncDecision = (typeof syncDecisionValues)[number];

export type SyncMatchReason =
  | "act_record_id"
  | "email"
  | "organization_contact"
  | "none";

export type SyncComparisonRow = {
  rowId: string;
  category: SyncComparisonCategory;
  matchReason: SyncMatchReason;
  localContactId: string | null;
  actRecordId: string | null;
  candidateLocalContactIds: string[];
  candidateActRecordIds: string[];
  baseSnapshot: ContactSnapshot | null;
  localSnapshot: ContactSnapshot | null;
  actSnapshot: ContactSnapshot | null;
  actEditedAt: string | null;
  allowedDecisions: SyncDecision[];
  messages: string[];
};

const decisionsByCategory: Record<
  SyncComparisonCategory,
  SyncDecision[]
> = {
  new_in_act: ["pull", "skip"],
  new_in_app: ["push", "skip"],
  changed_in_act: ["pull", "skip"],
  changed_in_app: ["push", "skip"],
  changed_in_both: ["keep_act", "keep_app", "skip"],
  possible_match: ["link", "keep_separate", "skip"],
  already_matched: [],
  missing_from_act: ["skip"],
  error: ["skip"],
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function emailKey(fields: ContactFields) {
  return fields.email ? normalize(fields.email) : null;
}

function organizationContactKey(fields: ContactFields) {
  if (!fields.organizationName) return null;
  return `${normalize(fields.organizationName)}\u0000${normalize(
    `${fields.firstName} ${fields.lastName}`,
  )}`;
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string | null) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function matchedRow(
  local: LocalSyncContact,
  remote: RemoteActContact,
  matchReason: SyncMatchReason,
): SyncComparisonRow {
  const localSnapshot = canonicalContactSnapshot(local);
  const actSnapshot = canonicalContactSnapshot(remote);
  const baseSnapshot = local.baseSnapshot
    ? canonicalContactSnapshot(local.baseSnapshot)
    : null;
  let category: SyncComparisonCategory;

  if (!baseSnapshot) {
    category = contactSnapshotsEqual(localSnapshot, actSnapshot)
      ? "already_matched"
      : "changed_in_both";
  } else {
    const localChanged = !contactSnapshotsEqual(localSnapshot, baseSnapshot);
    const actChanged = !contactSnapshotsEqual(actSnapshot, baseSnapshot);
    if (!localChanged && !actChanged) category = "already_matched";
    else if (!localChanged && actChanged) category = "changed_in_act";
    else if (localChanged && !actChanged) category = "changed_in_app";
    else category = "changed_in_both";
  }

  return {
    rowId: `match:${remote.id}:${local.id}`,
    category,
    matchReason,
    localContactId: local.id,
    actRecordId: remote.id,
    candidateLocalContactIds: [local.id],
    candidateActRecordIds: [remote.id],
    baseSnapshot,
    localSnapshot,
    actSnapshot,
    actEditedAt: remote.editedAt,
    allowedDecisions: decisionsByCategory[category],
    messages:
      category === "changed_in_both"
        ? ["Both Command Center and Act! changed since the last sync."]
        : [],
  };
}

function possibleMatchRow(
  key: string,
  locals: readonly LocalSyncContact[],
  remotes: readonly RemoteActContact[],
  reason: Extract<SyncMatchReason, "email" | "organization_contact">,
): SyncComparisonRow {
  const [singleLocal] = locals.length === 1 ? locals : [];
  const [singleRemote] = remotes.length === 1 ? remotes : [];
  return {
    rowId: `possible:${reason}:${key}`,
    category: "possible_match",
    matchReason: reason,
    localContactId: singleLocal?.id ?? null,
    actRecordId: singleRemote?.id ?? null,
    candidateLocalContactIds: locals.map((contact) => contact.id).sort(),
    candidateActRecordIds: remotes.map((contact) => contact.id).sort(),
    baseSnapshot: singleLocal?.baseSnapshot ?? null,
    localSnapshot: singleLocal
      ? canonicalContactSnapshot(singleLocal)
      : null,
    actSnapshot: singleRemote
      ? canonicalContactSnapshot(singleRemote)
      : null,
    actEditedAt: singleRemote?.editedAt ?? null,
    allowedDecisions: decisionsByCategory.possible_match,
    messages: [
      `Multiple records share the same ${reason.replaceAll("_", " ")}.`,
    ],
  };
}

function unmatchedRow(
  category: "new_in_act" | "new_in_app" | "missing_from_act",
  local: LocalSyncContact | null,
  remote: RemoteActContact | null,
): SyncComparisonRow {
  return {
    rowId:
      category === "new_in_act"
        ? `act:${remote!.id}`
        : `${category}:${local!.id}`,
    category,
    matchReason: "none",
    localContactId: local?.id ?? null,
    actRecordId: remote?.id ?? local?.actRecordId ?? null,
    candidateLocalContactIds: local ? [local.id] : [],
    candidateActRecordIds: remote ? [remote.id] : [],
    baseSnapshot: local?.baseSnapshot ?? null,
    localSnapshot: local ? canonicalContactSnapshot(local) : null,
    actSnapshot: remote ? canonicalContactSnapshot(remote) : null,
    actEditedAt: remote?.editedAt ?? local?.actEditedAt ?? null,
    allowedDecisions: decisionsByCategory[category],
    messages:
      category === "missing_from_act"
        ? ["The linked contact was not returned by Act!. It will not be deleted."]
        : [],
  };
}

export function compareContactSets(
  localContacts: readonly LocalSyncContact[],
  remoteContacts: readonly RemoteActContact[],
): SyncComparisonRow[] {
  const rows: SyncComparisonRow[] = [];
  const matchedLocalIds = new Set<string>();
  const matchedRemoteIds = new Set<string>();
  const remoteById = new Map(
    remoteContacts.map((contact) => [contact.id, contact]),
  );

  const match = (
    local: LocalSyncContact,
    remote: RemoteActContact,
    reason: SyncMatchReason,
  ) => {
    rows.push(matchedRow(local, remote, reason));
    matchedLocalIds.add(local.id);
    matchedRemoteIds.add(remote.id);
  };

  for (const local of localContacts) {
    if (!local.actRecordId) continue;
    const remote = remoteById.get(local.actRecordId);
    if (remote) match(local, remote, "act_record_id");
  }

  const matchByKey = (
    localKey: (contact: LocalSyncContact) => string | null,
    remoteKey: (contact: RemoteActContact) => string | null,
    reason: Extract<SyncMatchReason, "email" | "organization_contact">,
  ) => {
    const availableLocals = localContacts.filter(
      (contact) => !matchedLocalIds.has(contact.id),
    );
    const availableRemotes = remoteContacts.filter(
      (contact) => !matchedRemoteIds.has(contact.id),
    );
    const localGroups = groupBy(availableLocals, localKey);
    const remoteGroups = groupBy(availableRemotes, remoteKey);
    for (const [key, locals] of localGroups) {
      const remotes = remoteGroups.get(key);
      if (!remotes?.length) continue;
      if (locals.length === 1 && remotes.length === 1) {
        match(locals[0]!, remotes[0]!, reason);
        continue;
      }
      rows.push(possibleMatchRow(key, locals, remotes, reason));
      locals.forEach((contact) => matchedLocalIds.add(contact.id));
      remotes.forEach((contact) => matchedRemoteIds.add(contact.id));
    }
  };

  matchByKey(emailKey, emailKey, "email");
  matchByKey(
    organizationContactKey,
    organizationContactKey,
    "organization_contact",
  );

  for (const remote of remoteContacts) {
    if (!matchedRemoteIds.has(remote.id)) {
      rows.push(unmatchedRow("new_in_act", null, remote));
    }
  }
  for (const local of localContacts) {
    if (matchedLocalIds.has(local.id)) continue;
    rows.push(
      unmatchedRow(
        local.actRecordId ? "missing_from_act" : "new_in_app",
        local,
        null,
      ),
    );
  }

  return rows.sort((left, right) => left.rowId.localeCompare(right.rowId));
}
