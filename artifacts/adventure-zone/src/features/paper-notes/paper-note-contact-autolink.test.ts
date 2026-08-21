import { describe, expect, it } from "vitest";

import { findUnambiguousSavedContact } from "./paper-note-contact-autolink";

const paper = {
  key: "contact-0",
  mode: "new_contact" as const,
  selectedContactId: null,
  name: "Deborah Lay",
  role: null,
  email: null,
  primary: true,
  phones: [{
    key: "phone-0",
    number: "435-890-6349",
    extension: null,
    type: "mobile" as const,
    label: null,
    instructions: null,
    status: "active" as const,
    primary: true,
    crossedOut: false,
    importAsStructuredValue: true,
  }],
};

const deborah = {
  id: "50000000-0000-4000-8000-000000000001",
  name: "Deborah Lay",
  role: null,
  email: null,
  phones: [{
    id: "60000000-0000-4000-8000-000000000001",
    number: "4358906349",
    extension: null,
    type: "mobile" as const,
    label: null,
    instructions: null,
    status: "active" as const,
    primary: true,
  }],
};

describe("findUnambiguousSavedContact", () => {
  it("selects one saved contact when the phone is an exact match", () => {
    expect(findUnambiguousSavedContact(paper, [deborah])).toEqual(deborah);
  });

  it("can use an exact unique name when no phone or email is available", () => {
    const noPhone = { ...paper, phones: [] };
    expect(findUnambiguousSavedContact(noPhone, [deborah])).toEqual(deborah);
  });

  it("does not auto-link when the best evidence is tied", () => {
    const duplicate = { ...deborah, id: "50000000-0000-4000-8000-000000000002" };
    expect(findUnambiguousSavedContact(paper, [deborah, duplicate])).toBeNull();
  });
});
