import { afterEach, describe, expect, it } from "vitest";

import app from "./app";

let server: ReturnType<typeof app.listen> | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = null;
});

describe("public health endpoint", () => {
  it("allows Render health checks without owner authentication", async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
