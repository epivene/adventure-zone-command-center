import { describe, expect, it, vi } from "vitest";

import {
  ActAuthorizationRequiredError,
  ActClient,
} from "@/features/act-sync/act-client";
import type { ActReadRequest } from "@/features/act-replacement/act-read-transport";
import { ActApiError } from "@/features/act-sync/act-errors";
import type { ActConfig } from "@/features/act-sync/act-types";

const config: ActConfig = {
  baseUrl: "https://apius.act.com/act.web.api",
  databaseName: "PRIVATE-DATABASE",
  username: "private-user",
  password: "private-password",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function clientReturning(result: Response | Error) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ token: "private-token" }));
  if (result instanceof Response) {
    fetcher.mockResolvedValueOnce(result);
  } else {
    fetcher.mockRejectedValueOnce(result);
  }
  return { client: new ActClient(config, { fetcher }), fetcher };
}

function delayedBodyFailure(error: Error) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => controller.error(error), 0);
      },
    }),
    { status: 200, headers: { "x-private-detail": "private-header" } },
  );
}

async function capturedError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ActApiError);
    return error as ActApiError;
  }
  throw new Error("Expected ActClient operation to reject.");
}

describe("ActClient error classification", () => {
  it("classifies a 400 OData GET as query_rejected", async () => {
    const { client } = clientReturning(
      new Response("private-body", { status: 400 }),
    );

    await expect(
      client.requestJson({
        path: "/api/contacts",
        method: "GET",
        query: { $select: "id", $skip: "0" },
      }),
    ).rejects.toMatchObject({ code: "query_rejected", retryable: false });
  });

  it.each([
    {
      name: "an authorization request",
      operation: (client: ActClient) => client.testConnection(),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private-body", { status: 400 })),
    },
    {
      name: "a GET without OData options",
      operation: (client: ActClient) =>
        client.requestJson({ path: "/api/contacts", method: "GET" }),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
        .mockResolvedValueOnce(new Response("private-body", { status: 400 })),
    },
    {
      name: "a POST containing OData options",
      operation: (client: ActClient) =>
        client.requestJson({
          path: "/api/contacts",
          method: "POST",
          query: { $select: "id" },
          body: { private: "body" },
        }),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
        .mockResolvedValueOnce(new Response("private-body", { status: 400 })),
    },
    {
      name: "a PUT containing OData options",
      operation: (client: ActClient) =>
        client.requestJson({
          path: "/api/contacts/contact-1",
          method: "PUT",
          query: { $expand: "company" },
          body: { private: "body" },
        }),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
        .mockResolvedValueOnce(new Response("private-body", { status: 400 })),
    },
  ])(
    "keeps 400 from $name classified as invalid_response",
    async ({ operation, fetcher }) => {
      const client = new ActClient(config, { fetcher });

      await expect(operation(client)).rejects.toMatchObject({
        code: "invalid_response",
        retryable: false,
      });
    },
  );

  it.each([
    { status: 401, code: "authentication_failed", retryable: false },
    { status: 403, code: "permission_denied", retryable: false },
    { status: 404, code: "not_found", retryable: false },
    { status: 405, code: "endpoint_unsupported", retryable: false },
    { status: 429, code: "rate_limited", retryable: true },
    { status: 500, code: "unavailable", retryable: true },
    { status: 503, code: "unavailable", retryable: true },
  ])(
    "classifies HTTP $status as $code",
    async ({ status, code, retryable }) => {
      const { client } = clientReturning(
        new Response("private-body", {
          status,
          headers: { "x-ratelimit-reset": "1785700000" },
        }),
      );

      await expect(
        client.requestJson({ path: "/api/contacts", method: "GET" }),
      ).rejects.toMatchObject({ code, retryable });
    },
  );

  it("classifies a fetch timeout separately from a network failure", async () => {
    const timeout = new Error("private timeout detail");
    timeout.name = "TimeoutError";
    const timeoutClient = clientReturning(timeout).client;
    const networkClient = clientReturning(
      new TypeError("private network detail"),
    ).client;

    await expect(
      timeoutClient.requestJson({ path: "/api/contacts", method: "GET" }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
    await expect(
      networkClient.requestJson({ path: "/api/contacts", method: "GET" }),
    ).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });

  it("classifies a post-header body timeout with a fixed safe timeout error", async () => {
    const timeout = new Error(
      "private-body private-header private-user private-password private-token",
    );
    timeout.name = "TimeoutError";
    const { client } = clientReturning(delayedBodyFailure(timeout));

    const error = await capturedError(() =>
      client.requestJson({ path: "/api/contacts", method: "GET" }),
    );

    expect(error).toMatchObject({ code: "timeout", retryable: true });
    expect(error.message).toBe("The Act! request timed out. Try again later.");
    expect(String(error)).not.toContain("private-body");
    expect(String(error)).not.toContain("private-header");
    expect(String(error)).not.toContain(config.username);
    expect(String(error)).not.toContain(config.password);
    expect(String(error)).not.toContain("private-token");
  });

  it("classifies another body read failure with a fixed safe unavailable error", async () => {
    const bodyFailure = new TypeError(
      "private-body private-header private-user private-password private-token",
    );
    const { client } = clientReturning(delayedBodyFailure(bodyFailure));

    const error = await capturedError(() =>
      client.requestJson({ path: "/api/contacts", method: "GET" }),
    );

    expect(error).toMatchObject({ code: "unavailable", retryable: true });
    expect(error.message).toBe("Act! could not be reached. Try again later.");
    expect(String(error)).not.toContain("private-body");
    expect(String(error)).not.toContain("private-header");
    expect(String(error)).not.toContain(config.username);
    expect(String(error)).not.toContain(config.password);
    expect(String(error)).not.toContain("private-token");
  });

  it("uses fixed safe messages without body, header, or credential text", async () => {
    const secrets = [
      "private-body",
      "private-header",
      config.databaseName,
      config.username,
      config.password,
      "private-token",
    ];
    const { client } = clientReturning(
      new Response("private-body private-user private-password private-token", {
        status: 403,
        headers: { "x-private-detail": "private-header" },
      }),
    );

    const error = await capturedError(() =>
      client.requestJson({ path: "/api/contacts", method: "GET" }),
    );

    for (const secret of secrets) {
      expect(error.message).not.toContain(secret);
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("ActClient read transport", () => {
  it("strips a write method and body supplied by an untyped caller", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new ActClient(config, { fetcher });

    await client.getJson({
      path: "/api/contacts",
      method: "POST",
      body: { private: "value" },
    } as ActReadRequest);

    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
    expect(fetcher.mock.calls[1]?.[1]?.body).toBeUndefined();
  });

  it("requires an explicit one-fetch authorization before an authorized-only GET", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "contact-1" }]));
    const client = new ActClient(config, { fetcher });
    const now = new Date("2026-08-04T12:00:00.000Z");

    expect(client.hasValidAuthorization(now)).toBe(false);
    await expect(
      client.getJsonAuthorized({ path: "/api/contacts" }),
    ).rejects.toBeInstanceOf(ActAuthorizationRequiredError);
    expect(fetcher).toHaveBeenCalledTimes(0);

    await client.authorize();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.hasValidAuthorization(now)).toBe(true);

    await expect(
      client.getJsonAuthorized({ path: "/api/contacts" }),
    ).resolves.toEqual([{ id: "contact-1" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidates rejected bearer authorization without a hidden retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }));
    const client = new ActClient(config, { fetcher });

    await client.authorize();
    await expect(
      client.getJsonAuthorized({ path: "/api/contacts" }),
    ).rejects.toBeInstanceOf(ActAuthorizationRequiredError);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.hasValidAuthorization(new Date())).toBe(false);
  });

  it("treats an expired token as cold without attempting a data fetch", async () => {
    const expiredToken = `header.${Buffer.from(
      JSON.stringify({ exp: 946684800 }),
    ).toString("base64url")}.signature`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: expiredToken }));
    const client = new ActClient(config, { fetcher });

    await client.authorize();
    expect(client.hasValidAuthorization(new Date())).toBe(false);
    await expect(
      client.getJsonAuthorized({ path: "/api/contacts" }),
    ).rejects.toBeInstanceOf(ActAuthorizationRequiredError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("ActClient projected contact fallback", () => {
  const contact = {
    id: "contact-1",
    firstName: "Avery",
    lastName: "Example",
  };

  it("retries the first projected page in plain mode after query_rejected", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
      .mockResolvedValueOnce(
        new Response("projection rejected", { status: 400 }),
      )
      .mockResolvedValueOnce(jsonResponse([contact]))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new ActClient(config, { fetcher, pageSize: 100 });

    await expect(client.listContacts()).resolves.toEqual([
      expect.objectContaining({ id: "contact-1" }),
    ]);
    expect(
      new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.has("$select"),
    ).toBe(true);
    const plainQuery = new URL(String(fetcher.mock.calls[2]?.[0])).searchParams;
    expect(Object.fromEntries(plainQuery)).toEqual({ $skip: "0", $top: "100" });
  });

  it("does not fall back when a projected request fails for another reason", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "private-token" }))
      .mockResolvedValueOnce(
        new Response("permission denied", { status: 403 }),
      );
    const client = new ActClient(config, { fetcher });

    await expect(client.listContacts()).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
