import { describe, expect, it } from "vitest";

import { ownerAccounts } from "./owner-auth-schema";

describe("owner auth schema", () => {
  it("exports one database-backed owner credential table", () => {
    expect(ownerAccounts).toBeDefined();
    expect(ownerAccounts.id).toBeDefined();
    expect(ownerAccounts.singletonKey).toBeDefined();
    expect(ownerAccounts.loginName).toBeDefined();
    expect(ownerAccounts.displayName).toBeDefined();
    expect(ownerAccounts.role).toBeDefined();
    expect(ownerAccounts.passwordHash).toBeDefined();
    expect(ownerAccounts.passwordSalt).toBeDefined();
    expect(ownerAccounts.enabled).toBeDefined();
    expect(ownerAccounts.sessionVersion).toBeDefined();
    expect(ownerAccounts.createdAt).toBeDefined();
    expect(ownerAccounts.updatedAt).toBeDefined();
  });
});
