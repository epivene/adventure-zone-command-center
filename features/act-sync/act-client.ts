import { ActApiError } from "@/features/act-sync/act-errors";
import type {
  ActConfig,
  ActContactInput,
  ActRateLimit,
  ActTransport,
  RemoteActContact,
} from "@/features/act-sync/act-types";

type Fetcher = typeof fetch;

type ClientOptions = {
  fetcher?: Fetcher;
  pageSize?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(value: unknown) {
  const parsed = optionalString(value);
  if (!parsed) throw new ActApiError("invalid_response", false);
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ActApiError("invalid_response", false);
  }
  return value as Record<string, unknown>;
}

function remoteContact(value: unknown): RemoteActContact {
  const record = asRecord(value);
  const address =
    record.businessAddress && typeof record.businessAddress === "object"
      ? (record.businessAddress as Record<string, unknown>)
      : {};
  const fullName = optionalString(record.fullName) ?? "";
  const fullNameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName =
    optionalString(record.firstName) ??
    (fullNameParts.length === 1
      ? (fullNameParts[0] ?? "")
      : fullNameParts.slice(0, -1).join(" "));
  const lastName =
    optionalString(record.lastName) ??
    (fullNameParts.length > 1 ? fullNameParts.at(-1)! : "");

  return {
    id: requiredString(record.id),
    firstName,
    lastName,
    organizationName: optionalString(record.company),
    jobTitle: optionalString(record.jobTitle),
    email: optionalString(record.emailAddress)?.toLocaleLowerCase("en-US") ?? null,
    phone: optionalString(record.businessPhone),
    address1: optionalString(address.line1),
    address2: optionalString(address.line2),
    city: optionalString(address.city),
    region: optionalString(address.state),
    postalCode: optionalString(address.postalCode),
    editedAt: optionalString(record.edited),
  };
}

function payload(input: ActContactInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    fullName: `${input.firstName} ${input.lastName}`.trim(),
    company: input.organizationName,
    jobTitle: input.jobTitle,
    emailAddress: input.email,
    businessPhone: input.phone,
    businessAddress: {
      line1: input.address1,
      line2: input.address2,
      city: input.city,
      state: input.region,
      postalCode: input.postalCode,
    },
  };
}

function extractToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  return requiredString(record.token ?? record.access_token ?? record.bearerToken);
}

export class ActClient implements ActTransport {
  private readonly fetcher: Fetcher;
  private readonly pageSize: number;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private token: string | null = null;
  private lastRateLimit: ActRateLimit = {
    limit: null,
    remaining: null,
    reset: null,
  };

  constructor(
    private readonly config: ActConfig,
    options: ClientOptions = {},
  ) {
    if (config.baseUrl !== "https://apius.act.com/act.web.api") {
      throw new ActApiError("not_configured", false);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.pageSize = options.pageSize ?? 200;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 5_000_000;
  }

  get rateLimit() {
    return { ...this.lastRateLimit };
  }

  async testConnection() {
    await this.getToken(true);
    return { ok: true as const };
  }

  async listContacts() {
    const records: RemoteActContact[] = [];
    let skip = 0;
    let compatibilityQuery = false;
    for (;;) {
      const query: Record<string, string> = {};
      if (!compatibilityQuery) {
        query.$select =
          "id,firstName,lastName,fullName,company,jobTitle,emailAddress,businessPhone,edited";
        query.$expand =
          "businessAddress($select=line1,line2,city,state,postalCode)";
        query.$orderby = "id";
      }
      query.$skip = String(skip);
      query.$top = String(this.pageSize);
      const value = await this.requestJson({
        path: "/api/contacts",
        method: "GET",
        query,
      });
      const page = Array.isArray(value)
        ? value
        : Array.isArray(asRecord(value).value)
          ? (asRecord(value).value as unknown[])
          : null;
      if (!page) throw new ActApiError("invalid_response", false);
      if (page.length === 0) {
        if (skip === 0 && !compatibilityQuery) {
          compatibilityQuery = true;
          continue;
        }
        break;
      }
      records.push(...page.map(remoteContact));
      skip += page.length;
    }
    return records;
  }

  async getContact(contactId: string) {
    const value = await this.requestJson({
      path: `/api/contacts/${encodeURIComponent(contactId)}`,
      method: "GET",
    });
    return remoteContact(value);
  }

  async createContact(input: ActContactInput) {
    let token: string;
    try {
      token = await this.getToken();
    } catch (error) {
      throw error instanceof ActApiError
        ? error.withWriteOutcome("not_applied")
        : error;
    }
    const value = await this.authenticatedJson(
      {
        path: "/api/contacts",
        method: "POST",
        body: payload(input),
      },
      token,
    );
    return remoteContact(value);
  }

  async updateContact(contactId: string, input: ActContactInput) {
    const value = await this.requestJson({
      path: `/api/contacts/${encodeURIComponent(contactId)}`,
      method: "PUT",
      body: payload(input),
    });
    return value === null ? this.getContact(contactId) : remoteContact(value);
  }

  async requestJson(input: {
    path: `/api/${string}`;
    method: "GET" | "POST" | "PUT";
    query?: Readonly<Record<string, string>>;
    body?: unknown;
  }) {
    return this.authenticatedJson(input);
  }

  private async getToken(force = false) {
    if (this.token && !force) return this.token;
    const credentials = Buffer.from(
      `${this.config.username}:${this.config.password}`,
      "utf8",
    ).toString("base64");
    const value = await this.fetchJson(
      `${this.config.baseUrl}/authorize`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Act-Database-Name": this.config.databaseName,
        },
      },
    );
    this.token = extractToken(value);
    return this.token;
  }

  private async authenticatedJson(
    input: {
      path: `/api/${string}`;
      method: "GET" | "POST" | "PUT";
      query?: Readonly<Record<string, string>>;
      body?: unknown;
    },
    existingToken?: string,
  ) {
    const token = existingToken ?? (await this.getToken());
    const url = new URL(`${this.config.baseUrl}${input.path}`);
    for (const [name, value] of Object.entries(input.query ?? {})) {
      url.searchParams.set(name, value);
    }
    return this.fetchJson(url.toString(), {
      method: input.method,
      ...(input.body === undefined
        ? {}
        : { body: JSON.stringify(input.body) }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Act-Database-Name": this.config.databaseName,
      },
    });
  }

  private async fetchJson(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof ActApiError) throw error;
      throw new ActApiError("unavailable", true);
    }

    this.lastRateLimit = {
      limit: response.headers.get("x-ratelimit-limit"),
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset"),
    };
    if (!response.ok) {
      if (response.status === 401) {
        throw new ActApiError(
          "authentication_failed",
          false,
          null,
          "not_applied",
        );
      }
      if (response.status === 403) {
        throw new ActApiError(
          "permission_denied",
          false,
          null,
          "not_applied",
        );
      }
      if (response.status === 429) {
        throw new ActApiError(
          "rate_limited",
          true,
          response.headers.get("x-ratelimit-reset"),
          "not_applied",
        );
      }
      throw new ActApiError("unavailable", response.status >= 500);
    }
    if (response.status === 204) return null;

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > this.maxResponseBytes) {
      throw new ActApiError("invalid_response", false);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) {
      throw new ActApiError("invalid_response", false);
    }
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text.trim();
    }
  }
}
