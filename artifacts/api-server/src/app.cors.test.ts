import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "./app";

describe("application CORS", () => {
  it("allows every header used by invoice document uploads", async () => {
    const response = await request(app)
      .options("/api/business-documents/upload")
      .set("Origin", "https://adventure-zone-command-center-1.onrender.com")
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,content-type,x-file-name,x-document-name,x-document-category",
      );

    expect(response.status).toBe(204);
    const allowedHeaders = String(response.headers["access-control-allow-headers"] ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim());
    expect(allowedHeaders).toEqual(expect.arrayContaining([
      "authorization",
      "content-type",
      "x-file-name",
      "x-document-name",
      "x-document-category",
    ]));
  });
});
