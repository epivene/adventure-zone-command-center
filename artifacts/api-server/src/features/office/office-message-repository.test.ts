import { describe, expect, it } from "vitest";
import { isOfficeMessageUnreadFor } from "./office-message-repository";

describe("Office message unread semantics", () => {
  it("counts owner replies unread for Office until Office reads them", () => {
    expect(isOfficeMessageUnreadFor({ actorKind: "owner", readByOfficeAt: null, readByOwnerAt: new Date() }, "office")).toBe(true);
    expect(isOfficeMessageUnreadFor({ actorKind: "owner", readByOfficeAt: new Date(), readByOwnerAt: new Date() }, "office")).toBe(false);
  });

  it("counts Office messages unread for owner until owner reads them", () => {
    expect(isOfficeMessageUnreadFor({ actorKind: "office", readByOfficeAt: new Date(), readByOwnerAt: null }, "owner")).toBe(true);
    expect(isOfficeMessageUnreadFor({ actorKind: "office", readByOfficeAt: new Date(), readByOwnerAt: new Date() }, "owner")).toBe(false);
  });
});
