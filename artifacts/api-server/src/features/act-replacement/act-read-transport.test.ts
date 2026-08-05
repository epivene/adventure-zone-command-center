import { describe, expect, it } from "vitest";

import {
  GetOnlyActTransport,
  type ActReadRequest,
  type ActReadTransport,
} from "@/features/act-replacement/act-read-transport";
import type { ActTransport } from "@/features/act-sync/act-types";

function recordingActTransport() {
  const requests: Parameters<ActTransport["requestJson"]>[0][] = [];
  const delegate: ActTransport = {
    async testConnection() {
      return { ok: true };
    },
    async requestJson(request) {
      requests.push(request);
      return { value: [{ id: "contact-1" }] };
    },
    rateLimit: { limit: "100", remaining: "99", reset: "1785700000" },
  };
  return { delegate, requests };
}

describe("GetOnlyActTransport", () => {
  it("delegates a read as GET without a body", async () => {
    const { delegate, requests } = recordingActTransport();
    const transport: ActReadTransport = new GetOnlyActTransport(delegate);

    await transport.getJson({
      path: "/api/contacts",
      query: { $skip: "0", $top: "100" },
    });

    expect(requests).toEqual([
      {
        path: "/api/contacts",
        method: "GET",
        query: { $skip: "0", $top: "100" },
      },
    ]);
  });

  it("strips a write method and body supplied by an untyped caller", async () => {
    const { delegate, requests } = recordingActTransport();
    const transport = new GetOnlyActTransport(delegate);

    await transport.getJson({
      path: "/api/contacts/contact-1",
      method: "PUT",
      body: { private: "value" },
    } as ActReadRequest);

    expect(requests).toEqual([
      { path: "/api/contacts/contact-1", method: "GET" },
    ]);
  });

  it("exposes the delegate rate-limit state", () => {
    const { delegate } = recordingActTransport();
    const transport = new GetOnlyActTransport(delegate);

    expect(transport.rateLimit).toEqual({
      limit: "100",
      remaining: "99",
      reset: "1785700000",
    });
  });
});
