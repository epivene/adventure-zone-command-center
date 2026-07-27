import { describe, expect, it, vi } from "vitest";

import { ActApiError } from "@/features/act-sync/act-errors";
import { ActClient } from "@/features/act-sync/act-client";
import type { ActConfig } from "@/features/act-sync/act-types";

const config: ActConfig = {
  baseUrl: "https://apius.act.com/act.web.api",
  databaseName: "TEST-ACT-DATABASE",
  username: "shared-user",
  password: "private-password",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const remoteContact = {
  id: "act-contact-1",
  firstName: "Avery",
  lastName: "Example",
  fullName: "Avery Example",
  company: "Marias Fair",
  jobTitle: "Director",
  emailAddress: "avery@example.com",
  businessPhone: "406-555-0101",
  businessAddress: {
    line1: "100 Main",
    line2: null,
    city: "Shelby",
    state: "MT",
    postalCode: "59474",
  },
  edited: "2026-07-27T12:00:00Z",
};

describe("ActClient", () => {
  it("authenticates server-side with Basic credentials and the database header", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ token: "safe-test-token" }),
    );
    const client = new ActClient(config, { fetcher });

    await client.testConnection();

    expect(fetcher).toHaveBeenCalledWith(
      "https://apius.act.com/act.web.api/authorize",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from(
            "shared-user:private-password",
          ).toString("base64")}`,
          "Act-Database-Name": "TEST-ACT-DATABASE",
        }),
      }),
    );
  });

  it("retrieves every paged contact with a bearer token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "safe-test-token" }))
      .mockResolvedValueOnce(
        jsonResponse(Array.from({ length: 2 }, (_, index) => ({
          ...remoteContact,
          id: `act-contact-${index + 1}`,
        }))),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new ActClient(config, { fetcher, pageSize: 2 });

    const contacts = await client.listContacts();

    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      id: "act-contact-1",
      firstName: "Avery",
      organizationName: "Marias Fair",
      city: "Shelby",
      region: "MT",
    });
    expect(fetcher.mock.calls[1]?.[0]).toContain("%24skip=0");
    expect(fetcher.mock.calls[1]?.[0]).toContain("%24top=2");
    expect(fetcher.mock.calls[2]?.[0]).toContain("%24skip=2");
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer safe-test-token",
        "Act-Database-Name": "TEST-ACT-DATABASE",
      }),
    });
  });

  it("continues paging when Act returns fewer contacts than requested", async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      ...remoteContact,
      id: `act-contact-${index + 1}`,
    }));
    const secondPage = Array.from({ length: 2 }, (_, index) => ({
      ...remoteContact,
      id: `act-contact-${index + 11}`,
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "safe-test-token" }))
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new ActClient(config, { fetcher, pageSize: 200 });

    const contacts = await client.listContacts();

    expect(contacts).toHaveLength(12);
    expect(fetcher.mock.calls[1]?.[0]).toContain("%24skip=0");
    expect(fetcher.mock.calls[2]?.[0]).toContain("%24skip=10");
    expect(fetcher.mock.calls[3]?.[0]).toContain("%24skip=12");
  });

  it("retries the plain contacts endpoint when Act rejects the projected query", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "safe-test-token" }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([remoteContact]))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new ActClient(config, { fetcher, pageSize: 10 });

    const contacts = await client.listContacts();

    expect(contacts).toHaveLength(1);
    expect(fetcher.mock.calls[1]?.[0]).toContain("%24select=");
    expect(fetcher.mock.calls[2]?.[0]).not.toContain("%24select=");
    expect(fetcher.mock.calls[2]?.[0]).toContain("%24skip=0");
    expect(fetcher.mock.calls[2]?.[0]).toContain("%24top=10");
  });

  it("accepts company-only Act contacts without a first name", async () => {
    const companyOnlyContact = {
      ...remoteContact,
      id: "act-company-only",
      firstName: "",
      lastName: "",
      fullName: "",
      company: "Example Fair Association",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "safe-test-token" }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([companyOnlyContact]))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new ActClient(config, { fetcher, pageSize: 10 });

    const contacts = await client.listContacts();

    expect(contacts).toEqual([
      expect.objectContaining({
        id: "act-company-only",
        firstName: "",
        lastName: "",
        organizationName: "Example Fair Association",
      }),
    ]);
  });

  it("creates and updates contacts with Act field names", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "safe-test-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ ...remoteContact, id: "created-id" }, { status: 201 }),
      )
      .mockResolvedValueOnce(jsonResponse(remoteContact));
    const client = new ActClient(config, { fetcher });
    const input = {
      firstName: "Avery",
      lastName: "Example",
      organizationName: "Marias Fair",
      jobTitle: "Director",
      email: "avery@example.com",
      phone: "406-555-0101",
      address1: "100 Main",
      address2: null,
      city: "Shelby",
      region: "MT",
      postalCode: "59474",
    };

    await client.createContact(input);
    await client.updateContact("act-contact-1", input);

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://apius.act.com/act.web.api/api/contacts",
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        firstName: "Avery",
        lastName: "Example",
        fullName: "Avery Example",
        company: "Marias Fair",
        jobTitle: "Director",
        emailAddress: "avery@example.com",
        businessPhone: "406-555-0101",
        businessAddress: {
          line1: "100 Main",
          line2: null,
          city: "Shelby",
          state: "MT",
          postalCode: "59474",
        },
      }),
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "https://apius.act.com/act.web.api/api/contacts/act-contact-1",
    );
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("sanitizes permission errors without exposing credentials or response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        "4032 API permission required private-password shared-user",
        { status: 403 },
      ),
    );
    const client = new ActClient(config, { fetcher });

    let error: unknown;
    try {
      await client.testConnection();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ActApiError);
    expect(error).toMatchObject({ code: "permission_denied" });
    expect(String(error)).not.toContain("private-password");
    expect(String(error)).not.toContain("shared-user");
    expect(String(error)).not.toContain("4032");
  });

  it("reports rate limits as retryable with the reset value", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "safe-test-token" }))
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "x-ratelimit-reset": "1785186000" },
        }),
      );
    const client = new ActClient(config, { fetcher });

    await expect(client.listContacts()).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfter: "1785186000",
    });
  });
});
