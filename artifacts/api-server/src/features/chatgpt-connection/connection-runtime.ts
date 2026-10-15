import { ContactCreateService } from "./contact-create-service";
import { ConnectionConventionService } from "./convention-tools";
import { WebsiteInquiryReads } from "./website-inquiry-reads";
import { WebsiteInquiryReviewService } from "../website-inquiries/website-inquiry-review-service";
import { DrizzleWebsiteInquiryRepository } from "../website-inquiries/website-inquiry-repository";
import { GmailDraftFilingService } from "./gmail-draft-filing-service";
import { TodayReadService } from "./today-read-service";
import { loadMasterTodayQueue } from "../today/master-work-queue-repository";
import { createEmailAttentionService } from "../google-workspace/email-thread-attention-runtime";
import { BookingWorkService } from "../booking-work/service";
import { ProfileMergeService } from "./profile-merge-service";
import { randomBytes } from "node:crypto";
import { consentHtml } from "./consent-page";
import express, { type Express } from "express";
import { pool, db as appDatabase } from "@workspace/db";
import { OAuthStore } from "./oauth-store";
import {
  createConnectionOAuthProvider,
  type ConnectionOAuth,
} from "./oauth-provider";
import { verifyConnectionAccessToken } from "./authorization";
import { ConnectionReadService } from "./read-service";
import { LeadNoteService } from "./lead-note-service";
import { ProfileUpdateService } from "./profile-update-service";
import { DraftFollowupService } from "./draft-followup-service";
import { OperationStore } from "./operation-store";
import { createChatGPTConnectionRouter } from "../../routes/chatgpt-connection";
import { createChatGPTMcpRouter } from "../../routes/chatgpt-mcp";
import { connectionScopes, type ConnectionDatabase } from "./contracts";
export function mountChatGPTConnection(
  app: Express,
  options: { db?: ConnectionDatabase; env?: NodeJS.ProcessEnv } = {},
) {
  const db = options.db ?? pool;
  const env = options.env ?? process.env;
  const enabled = env.CHATGPT_CONNECTION_ENABLED === "true";
  const apiOrigin =
    env.CHATGPT_CONNECTION_ORIGIN ??
    "https://adventure-zone-command-center.onrender.com";
  const appOrigin = env.CHATGPT_CONNECTION_APP_ORIGIN ?? apiOrigin;
  const resource = apiOrigin + "/api/chatgpt/mcp",
    issuer = apiOrigin + "/api/chatgpt/oauth";
  let oauth: ConnectionOAuth | undefined;
  if (enabled) {
    if (
      new URL(apiOrigin).origin !== apiOrigin ||
      new URL(appOrigin).origin !== appOrigin ||
      !env.CHATGPT_CONNECTION_ENCRYPTION_KEY ||
      !env.CHATGPT_CONNECTION_COOKIE_KEY ||
      !env.CHATGPT_CONNECTION_JWKS
    )
      throw new Error(
        "Configure the fixed connection origin, encryption key, cookie key and signing JWKS before enabling",
      );
    oauth = createConnectionOAuthProvider(
      {
        issuer,
        resource,
        appOrigin,
        cookieKeys: [env.CHATGPT_CONNECTION_COOKIE_KEY],
        jwks: JSON.parse(env.CHATGPT_CONNECTION_JWKS),
      },
      new OAuthStore(
        db,
        Buffer.from(env.CHATGPT_CONNECTION_ENCRYPTION_KEY, "base64"),
      ),
    );
    app.get("/chatgpt-connection/consent", (req, res) => {
      if (req.get("Host") !== new URL(apiOrigin).host)
        return res.sendStatus(403);
      const nonce = randomBytes(24).toString("base64");
      res.set({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
      });
      return res.type("html").send(consentHtml(nonce));
    });
    app.get(
      "/.well-known/oauth-authorization-server/api/chatgpt/oauth",
      (_req, res) =>
        res.json({
          issuer,
          authorization_endpoint: issuer + "/auth",
          token_endpoint: issuer + "/token",
          revocation_endpoint: issuer + "/token/revocation",
          jwks_uri: issuer + "/jwks",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: connectionScopes,
        }),
    );
    app.get(
      "/.well-known/oauth-protected-resource/api/chatgpt/mcp",
      (_req, res) =>
        res.json({
          resource,
          authorization_servers: [issuer],
          scopes_supported: connectionScopes,
          bearer_methods_supported: ["header"],
        }),
    );
    app.use(
      "/api/chatgpt/oauth",
      (req, res, next) => {
        if (req.get("Host") !== new URL(apiOrigin).host)
          return res.status(403).json({ error: "invalid_host" });
        return next();
      },
      oauth.provider.callback(),
    );
  }
  app.use(
    "/api/chatgpt-connection",
    (req, res, next) => {
      const origin = req.get("Origin");
      res.vary("Origin");
      if (origin === appOrigin || origin === apiOrigin) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, X-Connection-CSRF",
        );
      }
      if (req.method === "OPTIONS")
        return res.sendStatus(
          origin === appOrigin || origin === apiOrigin ? 204 : 403,
        );
      return next();
    },
    express.json({ limit: "128kb" }),
    createChatGPTConnectionRouter({
      enabled,
      resource,
      appOrigin,
      db,
      oauth,
    }),
  );
  app.use(
    "/api/chatgpt/mcp",
    createChatGPTMcpRouter({
      enabled,
      resource,
      allowedOrigins: [apiOrigin, appOrigin, "https://chatgpt.com"],
      db,
      verify: (token) => {
        if (!oauth) throw Error("CONNECTION_DISABLED");
        return verifyConnectionAccessToken(token, {
          resource,
          db,
          find: (value) => oauth!.provider.AccessToken.find(value),
        });
      },
      services: {
        contacts: new ContactCreateService(db),
        conventions: new ConnectionConventionService(db),
        inquiries: new WebsiteInquiryReads(db, new WebsiteInquiryReviewService({repository:new DrizzleWebsiteInquiryRepository(appDatabase)}), appOrigin),
        today: new TodayReadService(db,now=>loadMasterTodayQueue(appDatabase,now)),
        attention: createEmailAttentionService(db),
        work: new BookingWorkService(db),
        reads: new ConnectionReadService(db),
        notes: new LeadNoteService(db),
        updates: new ProfileUpdateService(db),
        merges: new ProfileMergeService(db),
        drafts: new DraftFollowupService(db),
        draftFiling: new GmailDraftFilingService(db),
        operations: new OperationStore(db),
      },
    }),
  );
}


