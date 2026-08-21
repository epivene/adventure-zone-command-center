import { describe, expect, it } from "vitest";

import { SafeWebsiteAuditHttpClient } from "./website-audit-http";

function clientFor(input?: {
  addresses?: Record<string, string[]>;
  responses?: Record<string, { status: number; headers?: Record<string, string>; body?: string }>;
}) {
  const addresses = input?.addresses ?? { "example.org": ["93.184.216.34"] };
  const responses = input?.responses ?? {
    "https://example.org/": { status: 200, headers: { "content-type": "text/html" }, body: "<html><title>Example Fair</title><body>Example Fair Bismarck ND</body></html>" },
  };
  return new SafeWebsiteAuditHttpClient({
    resolve: async (hostname) => addresses[hostname] ?? ["93.184.216.34"],
    fetch: async (url) => {
      const response = responses[url];
      if (!response) throw new TypeError(`No fake response for ${url}`);
      return new Response(response.body ?? "", { status: response.status, headers: response.headers });
    },
    timeoutMs: 50,
  });
}

describe("SafeWebsiteAuditHttpClient", () => {
  for (const unsafe of [
    "http://127.0.0.1",
    "http://localhost",
    "http://169.254.169.254",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "file:///etc/passwd",
  ]) {
    it(`rejects unsafe target ${unsafe}`, async () => {
      const result = await clientFor({ addresses: { localhost: ["127.0.0.1"] } }).inspect(unsafe);
      expect(result.reachable).toBe(false);
      expect(result.failure).toBe("unsafe_url");
    });
  }

  it("permits a public HTTPS page and retains only bounded page evidence", async () => {
    const result = await clientFor().inspect("https://example.org");
    expect(result).toMatchObject({ reachable: true, finalUrl: "https://example.org/", statusCode: 200, title: "Example Fair" });
    expect(result.textSample).toContain("Example Fair Bismarck ND");
    expect(result.textSample.length).toBeLessThanOrEqual(12_000);
  });

  it("revalidates redirect targets and refuses redirects into private networks", async () => {
    const client = clientFor({
      addresses: { "example.org": ["93.184.216.34"], "internal.example": ["10.0.0.2"] },
      responses: {
        "https://example.org/": { status: 302, headers: { location: "http://internal.example/secret" } },
      },
    });
    const result = await client.inspect("https://example.org");
    expect(result.failure).toBe("unsafe_url");
  });

  it("caps redirect chains at five hops", async () => {
    const responses: Record<string, { status: number; headers: Record<string, string> }> = {};
    for (let i = 0; i < 6; i += 1) {
      responses[`https://example.org/${i}`] = { status: 302, headers: { location: `https://example.org/${i + 1}` } };
    }
    const result = await clientFor({ addresses: { "example.org": ["93.184.216.34"] }, responses }).inspect("https://example.org/0");
    expect(result.reachable).toBe(false);
    expect(result.failure).toBe("http_error");
  });
});
