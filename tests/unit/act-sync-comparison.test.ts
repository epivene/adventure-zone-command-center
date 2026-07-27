import { describe, expect, it } from "vitest";

import type { RemoteActContact } from "@/features/act-sync/act-types";
import {
  compareContactSets,
  type LocalSyncContact,
} from "@/features/act-sync/sync-comparison";
import {
  canonicalContactSnapshot,
  contactSnapshotsEqual,
} from "@/features/act-sync/contact-snapshot";

const fields = {
  firstName: "Avery",
  lastName: "Example",
  organizationName: "Marias Fair",
  jobTitle: "Director",
  email: "avery@example.com",
  phone: "406-555-0101",
  address1: "100 Main",
  address2: null,
  city: "Shelby",
  region: "MT",
  postalCode: "59474",
};

function local(
  overrides: Partial<LocalSyncContact> = {},
): LocalSyncContact {
  return {
    id: "local-1",
    actRecordId: "act-1",
    ...fields,
    baseSnapshot: canonicalContactSnapshot(fields),
    actEditedAt: "2026-07-26T12:00:00Z",
    ...overrides,
  };
}

function remote(
  overrides: Partial<RemoteActContact> = {},
): RemoteActContact {
  return {
    id: "act-1",
    editedAt: "2026-07-26T12:00:00Z",
    ...fields,
    ...overrides,
  };
}

describe("canonical contact snapshots", () => {
  it("ignores harmless whitespace, casing, and empty optional strings", () => {
    const left = canonicalContactSnapshot(fields);
    const right = canonicalContactSnapshot({
      ...fields,
      firstName: " AVERY ",
      organizationName: "  marias   fair ",
      email: " AVERY@EXAMPLE.COM ",
      address2: " ",
    });

    expect(contactSnapshotsEqual(left, right)).toBe(true);
  });
});

describe("compareContactSets", () => {
  it("uses a stable Act record ID before an email match", () => {
    const rows = compareContactSets(
      [
        local({ id: "linked", email: "linked@example.com" }),
        local({
          id: "email-only",
          actRecordId: null,
          email: "avery@example.com",
        }),
      ],
      [remote()],
    );

    expect(rows.find((row) => row.actRecordId === "act-1")).toMatchObject({
      category: "changed_in_app",
      localContactId: "linked",
      matchReason: "act_record_id",
    });
  });

  it("classifies new records in either system", () => {
    const rows = compareContactSets(
      [local({ id: "local-new", actRecordId: null, baseSnapshot: null })],
      [
        remote({
          id: "act-new",
          firstName: "Different",
          lastName: "Person",
          organizationName: "Different Company",
          email: "different@example.com",
        }),
      ],
    );

    expect(rows.map((row) => row.category).sort()).toEqual([
      "new_in_act",
      "new_in_app",
    ]);
  });

  it("classifies every one-sided and two-sided edit against the base snapshot", () => {
    const base = canonicalContactSnapshot(fields);
    const rows = compareContactSets(
      [
        local({ id: "same", actRecordId: "same", baseSnapshot: base }),
        local({
          id: "act-change",
          actRecordId: "act-change",
          baseSnapshot: base,
        }),
        local({
          id: "app-change",
          actRecordId: "app-change",
          baseSnapshot: base,
          phone: "406-555-9999",
        }),
        local({
          id: "both-change",
          actRecordId: "both-change",
          baseSnapshot: base,
          phone: "406-555-9999",
        }),
      ],
      [
        remote({ id: "same" }),
        remote({ id: "act-change", jobTitle: "Owner" }),
        remote({ id: "app-change" }),
        remote({ id: "both-change", jobTitle: "Owner" }),
      ],
    );

    expect(
      Object.fromEntries(
        rows.map((row) => [row.localContactId, row.category]),
      ),
    ).toEqual({
      same: "already_matched",
      "act-change": "changed_in_act",
      "app-change": "changed_in_app",
      "both-change": "changed_in_both",
    });
  });

  it("creates a possible match instead of guessing across duplicate emails", () => {
    const rows = compareContactSets(
      [
        local({
          id: "first",
          actRecordId: null,
          baseSnapshot: null,
        }),
        local({
          id: "second",
          actRecordId: null,
          baseSnapshot: null,
        }),
      ],
      [remote({ id: "remote-ambiguous" })],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        category: "possible_match",
        actRecordId: "remote-ambiguous",
        candidateLocalContactIds: ["first", "second"],
      }),
    ]);
  });

  it("allows distinct stable Act IDs to share an email", () => {
    const rows = compareContactSets(
      [
        local({ id: "first", actRecordId: "act-1" }),
        local({ id: "second", actRecordId: "act-2" }),
      ],
      [remote({ id: "act-1" }), remote({ id: "act-2" })],
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.category === "already_matched")).toBe(true);
  });

  it("uses a unique company and name only after email cannot match", () => {
    const rows = compareContactSets(
      [
        local({
          actRecordId: null,
          email: null,
          baseSnapshot: canonicalContactSnapshot({ ...fields, email: null }),
        }),
      ],
      [remote({ id: "company-name", email: null })],
    );

    expect(rows[0]).toMatchObject({
      localContactId: "local-1",
      actRecordId: "company-name",
      matchReason: "organization_contact",
      category: "already_matched",
    });
  });

  it("flags a linked local record missing from Act without deleting it", () => {
    const rows = compareContactSets([local()], []);

    expect(rows[0]).toMatchObject({
      category: "missing_from_act",
      localContactId: "local-1",
      allowedDecisions: ["skip"],
    });
  });
});
