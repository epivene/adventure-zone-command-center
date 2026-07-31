import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn() }));

import { creationSchema } from "@/app/(private)/event-profiles/new/page";

const base = {
  event: { id: null, name: "Event", city: "Denver", region: "CO" },
  contacts: [{ id: null, name: "Avery Example", phone: "", email: "", role: "" }],
  booking: { enabled: false, name: "", nextActionKind: "call", nextActionDueAt: "" },
};

describe("event profile creation validation", () => {
  it("rejects malformed email addresses at the server boundary", () => {
    expect(creationSchema.safeParse({ ...base, contacts: [{ ...base.contacts[0], email: "not-an-email" }] }).success).toBe(false);
  });

  it("rejects malformed new-event state codes at the server boundary", () => {
    expect(creationSchema.safeParse({ ...base, event: { ...base.event, region: "Colorado" } }).success).toBe(false);
  });
});
