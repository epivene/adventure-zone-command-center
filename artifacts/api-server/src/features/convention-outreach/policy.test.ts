import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { matchProfile, nextYearMember, validateMember } from "./policy";

describe("convention history policy", () => {
  it("does not match a shared inbox or name coincidence", () => {
    const candidates = [
      {
        organizationId: "a",
        contactId: "c",
        email: "fair@example.com",
        name: "County Fair",
      },
      {
        organizationId: "b",
        contactId: "d",
        email: "fair@example.com",
        name: "County Fair",
      },
    ];
    assert.equal(
      matchProfile(
        { email: "fair@example.com", event: "County Fair" },
        candidates,
      ),
      null,
    );
    assert.equal(
      matchProfile({ email: "", event: "County Fair" }, candidates),
      null,
    );
    assert.equal(
      matchProfile(
        { email: "other@example.com", event: "County Fair" },
        candidates,
      ),
      null,
    );
  });
  it("requires unique email plus organization evidence", () => {
    const candidate = {
      organizationId: "a",
      contactId: "c",
      email: "fair@example.com",
      name: "County Fair",
    };
    assert.deepEqual(
      matchProfile({ email: " FAIR@example.com ", event: " county fair " }, [
        candidate,
      ]),
      candidate,
    );
    assert.equal(
      matchProfile({ email: "fair@example.com", event: "Another Fair" }, [
        candidate,
      ]),
      null,
    );
  });
  it("carries context but resets annual outcomes and attendance", () => {
    const original = validateMember({
      sourceKey: "s1",
      event: "Fair",
      group: "new",
      outcome: "interested",
      attendance: "confirmed",
      notes: "Asked about five attractions",
      offerId: "old-offer",
    });
    const next = nextYearMember(original);
    assert.equal(next.outcome, "not_contacted");
    assert.equal(next.attendance, "unknown");
    assert.equal(next.group, "returning");
    assert.equal(next.notes, original.notes);
    assert.equal("offerId" in next, false);
    assert.equal(original.outcome, "interested");
  });
  it("preserves replacement and special handling in next year", () => {
    for (const group of ["replacement", "special", "confirm"] as const) {
      const next = nextYearMember(
        validateMember({
          sourceKey: group,
          event: "Fair",
          group,
          outcome: "do_not_contact",
        }),
      );
      assert.equal(next.group, group);
      assert.equal(next.outcome, "do_not_contact");
    }
  });
  it("does not call an uncontacted prospect returning merely by copying", () => {
    assert.equal(
      nextYearMember(
        validateMember({ sourceKey: "a", event: "Fair", group: "new" }),
      ).group,
      "new",
    );
  });
  it("rejects unsupported groups and incomplete records", () => {
    assert.throws(() => validateMember({ event: "Fair" }));
    assert.throws(() =>
      validateMember({ sourceKey: "a", event: "Fair", group: "send_everyone" }),
    );
  });
});
