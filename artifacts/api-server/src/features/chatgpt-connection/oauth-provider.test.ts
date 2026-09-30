import { it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { generateKeyPairSync, createHash, randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import { ensureChatGPTConnectionSchema } from "../../db/chatgpt-connection-schema";
import { OAuthStore } from "./oauth-store";
import { createConnectionOAuthProvider } from "./oauth-provider";
import { verifyConnectionAccessToken } from "./authorization";
let db: PGlite,
  app: ReturnType<typeof express>,
  oauth: ReturnType<typeof createConnectionOAuthProvider>,
  clientId: string;
const resource = "https://app.example/api/chatgpt/mcp",
  redirect = "https://client.example/callback";
beforeEach(async () => {
  db = new PGlite();
  await ensureChatGPTConnectionSchema(db);
  const store = new OAuthStore(db, Buffer.alloc(32, 1));
  clientId = (
    await store.registerClient("owner", {
      name: "Test",
      redirectUris: [redirect],
    })
  ).clientId;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = privateKey.export({ format: "jwk" });
  oauth = createConnectionOAuthProvider(
    {
      issuer: "https://app.example/api/chatgpt/oauth",
      resource,
      appOrigin: "https://app.example",
      cookieKeys: ["test-cookie-secret"],
      jwks: { keys: [{ ...key, use: "sig", alg: "RS256", kid: "test" }] },
    },
    store,
  );
  app = express();
  app.set("trust proxy", true);
  // Test-only owner interaction. Production uses authenticated owner route + CSRF.
  app.post("/approve/:uid", async (req, res) => {
    try {
      const url = await oauth.consent(
        req,
        res,
        req.params.uid,
        ["crm:read"],
        true,
      );
      res.json({ url });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });
  app.use("/api/chatgpt/oauth", oauth.provider.callback());
});
afterEach(async () => db.close());
const headers = { "x-forwarded-proto": "https", host: "app.example" };
async function code() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await request(app)
    .get("/api/chatgpt/oauth/auth")
    .set(headers)
    .query({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid crm:read offline_access",
      resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "state",
    });
  expect(response.status, response.text).toBe(303);
  const uid = new URL(response.headers.location).searchParams.get(
    "interaction",
  )!;
  const cookies = (response.headers["set-cookie"] as unknown as string[]).map(
    (s) => s.split(";")[0],
  );
  const approval = await request(app)
    .post("/approve/" + uid)
    .set(headers)
    .set("Cookie", cookies);
  expect(approval.status, approval.text).toBe(200);
  const resumed = await request(app)
    .get(new URL(approval.body.url).pathname)
    .set(headers)
    .set("Cookie", cookies);
  expect(resumed.status, resumed.text).toBe(303);
  const final = new URL(resumed.headers.location);
  expect(final.origin, resumed.headers.location).toBe("https://client.example");
  expect(final.searchParams.get("error"), resumed.headers.location).toBeNull();
  return { code: final.searchParams.get("code"), verifier };
}
it("uses PKCE, rotates refresh tokens and rejects reused authorization codes", async () => {
  const issued = await code();
  const form = {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirect,
    code: issued.code,
    code_verifier: issued.verifier,
    resource,
  };
  const token = await request(app)
    .post("/api/chatgpt/oauth/token")
    .set(headers)
    .type("form")
    .send(form);
  expect(token.status, token.text).toBe(200);
  expect(token.body.expires_in).toBe(300);
  const p = await verifyConnectionAccessToken(token.body.access_token, {
    resource,
    db,
    find: (t) => oauth.provider.AccessToken.find(t),
  });
  expect(p.scopes).toEqual(["crm:read"]);
  const refresh = await request(app)
    .post("/api/chatgpt/oauth/token")
    .set(headers)
    .type("form")
    .send({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: token.body.refresh_token,
      resource,
    });
  expect(refresh.status, refresh.text).toBe(200);
  expect(refresh.body.refresh_token).not.toBe(token.body.refresh_token);
  const replay = await request(app)
    .post("/api/chatgpt/oauth/token")
    .set(headers)
    .type("form")
    .send(form);
  expect(replay.status).toBe(400);
  await oauth.store.revoke("owner", p.connectionId);
  await expect(
    verifyConnectionAccessToken(refresh.body.access_token, {
      resource,
      db,
      find: (t) => oauth.provider.AccessToken.find(t),
    }),
  ).rejects.toThrow();
});
it("rejects a mismatched PKCE verifier and unregistered redirects", async () => {
  const issued = await code();
  const bad = await request(app)
    .post("/api/chatgpt/oauth/token")
    .set(headers)
    .type("form")
    .send({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirect,
      code: issued.code,
      code_verifier: "x".repeat(43),
      resource,
    });
  expect(bad.status).toBe(400);
  const redirectAttempt = await request(app)
    .get("/api/chatgpt/oauth/auth")
    .set(headers)
    .query({
      client_id: clientId,
      redirect_uri: "https://evil.example",
      response_type: "code",
      scope: "crm:read",
    });
  expect(redirectAttempt.status).toBe(400);
  expect(redirectAttempt.headers.location).toBeUndefined();
});
