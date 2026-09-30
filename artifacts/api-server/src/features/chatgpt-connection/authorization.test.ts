import { it, expect } from "vitest";
import { verifyConnectionAccessToken } from "./authorization";
const resource = "https://app.example/api/chatgpt/mcp";
const row = {
  id: "connection",
  owner_id: "owner",
  client_id: "client",
  scopes: ["crm:read"],
  grant_id: "grant",
  revoked_at: null,
};
const db = { query: async () => ({ rows: [row] }) };
const token = {
  accountId: "owner",
  clientId: "client",
  grantId: "grant",
  aud: resource,
  scope: "crm:read",
  exp: Math.floor(Date.now() / 1000) + 300,
};
it("derives identity from the provider and stored grant", async () => {
  expect(
    await verifyConnectionAccessToken("opaque", {
      resource,
      db,
      find: async () => token,
    }),
  ).toEqual({
    ownerId: "owner",
    connectionId: "connection",
    clientId: "client",
    scopes: ["crm:read"],
  });
});
it.each([
  { aud: "https://other" },
  { exp: 1 },
  { scope: "crm:update" },
  { accountId: "intruder" },
  { grantId: undefined },
])("rejects invalid audience, expiry, scope or actor %j", async (override) => {
  await expect(
    verifyConnectionAccessToken("opaque", {
      resource,
      db,
      find: async () => ({ ...token, ...override }),
    }),
  ).rejects.toThrow();
});
it("rejects owner/import tokens, absent tokens and revoked connections", async () => {
  for (const value of ["owner.123.sig", "import-secret", ""])
    await expect(
      verifyConnectionAccessToken(value, {
        resource,
        db,
        find: async () => undefined,
      }),
    ).rejects.toThrow();
  await expect(
    verifyConnectionAccessToken("opaque", {
      resource,
      db: {
        query: async () => ({ rows: [{ ...row, revoked_at: new Date() }] }),
      },
      find: async () => token,
    }),
  ).rejects.toThrow();
});
