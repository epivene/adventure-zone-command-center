import { it, expect, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import express from "express";
import request from "supertest";
import { randomBytes, createHash, generateKeyPairSync } from "node:crypto";
import { fixture } from "./test-database";
import { mountChatGPTConnection } from "./connection-runtime";
import { issueToken } from "../../lib/auth";
it("supports split UI/API hosting with first-party OAuth consent and exact owner CORS", async () => {
  process.env.OWNER_PASSWORD = "test";
  process.env.SESSION_SECRET = "split-test-secret";
  const f = await fixture();
  try {
    const app = express();
    app.set("trust proxy", true);
    const key = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({ format: "jwk" });
    mountChatGPTConnection(app, {
      db: f.db,
      env: {
        CHATGPT_CONNECTION_ENABLED: "true",
        CHATGPT_CONNECTION_ORIGIN: "https://api.example",
        CHATGPT_CONNECTION_APP_ORIGIN: "https://web.example",
        CHATGPT_CONNECTION_COOKIE_KEY: "cookie-test",
        CHATGPT_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString(
          "base64",
        ),
        CHATGPT_CONNECTION_JWKS: JSON.stringify({
          keys: [{ ...key, use: "sig", alg: "RS256", kid: "test" }],
        }),
      },
    });
    const preflight = await request(app)
      .options("/api/chatgpt-connection")
      .set("Origin", "https://web.example")
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,content-type,x-connection-csrf",
      );
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(
      "https://web.example",
    );
    const bad = await request(app)
      .options("/api/chatgpt-connection")
      .set("Origin", "https://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const token = issueToken()!.token;
    const status = await request(app)
      .get("/api/chatgpt-connection")
      .set("Origin", "https://web.example")
      .auth(token, { type: "bearer" });
    expect(status.status).toBe(200);
    expect(status.headers["access-control-allow-origin"]).toBe(
      "https://web.example",
    );
    const client = await request(app)
      .post("/api/chatgpt-connection/clients")
      .auth(token, { type: "bearer" })
      .set("Origin", "https://web.example")
      .set("X-Connection-CSRF", status.body.csrfToken)
      .send({
        name: "ChatGPT",
        redirectUris: ["https://client.example/callback"],
      });
    expect(client.status).toBe(201);
    const headers = { host: "api.example", "x-forwarded-proto": "https" };
    const auth = await request(app)
      .get("/api/chatgpt/oauth/auth")
      .set(headers)
      .query({
        client_id: client.body.clientId,
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        scope: "openid crm:read crm:append",
        resource: "https://api.example/api/chatgpt/mcp",
        code_challenge: createHash("sha256")
          .update(randomBytes(32))
          .digest("base64url"),
        code_challenge_method: "S256",
      });
    expect(auth.status, auth.text).toBe(303);
    const target = new URL(auth.headers.location);
    expect(target.origin).toBe("https://api.example");
    const page = await request(app)
      .get(target.pathname + target.search)
      .set(headers);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Authorize Command Center access");
    expect(page.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    const cookies = (auth.headers["set-cookie"] as unknown as string[]).map(
      (s) => s.split(";")[0],
    );
    const route =
      "/api/chatgpt-connection/interactions/" +
      target.searchParams.get("interaction");
    const details = await request(app)
      .get(route)
      .set(headers)
      .set("Cookie", cookies)
      .auth(token, { type: "bearer" });
    expect(details.status, details.text).toBe(200);
    expect(details.body.defaultScopes).toEqual(["crm:read"]);
    const consent = await request(app)
      .post(route)
      .set(headers)
      .set("Cookie", cookies)
      .auth(token, { type: "bearer" })
      .set("Origin", "https://api.example")
      .set("X-Connection-CSRF", details.body.csrfToken)
      .send({ approve: true, scopes: ["crm:read"] });
    expect(consent.status, consent.text).toBe(200);
    const resume = await request(app)
      .get(new URL(consent.body.redirectTo).pathname)
      .set(headers)
      .set("Cookie", cookies);
    expect(resume.status, resume.text).toBe(303);
    expect(
      new URL(resume.headers.location).searchParams.get("code"),
    ).toBeTruthy();
  } finally {
    await f.db.close();
  }
});
