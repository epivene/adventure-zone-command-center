import { createHmac } from "node:crypto";

const localOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

export class InquiryOriginError extends Error {
  constructor() {
    super("WEBSITE_INQUIRY_ORIGIN_REJECTED");
    this.name = "InquiryOriginError";
  }
}

function normalizeConfiguredOrigin(value: string): string {
  const candidate = value.trim().replace(/\/$/, "");
  const url = new URL(candidate);
  if (url.origin !== candidate || url.username || url.password) {
    throw new Error(`Invalid website inquiry origin: ${value}`);
  }
  return url.origin;
}

export function readWebsiteInquiryAllowedOrigins(
  env: NodeJS.ProcessEnv,
  nodeEnv: string | undefined,
): ReadonlySet<string> {
  const configured = (env.WEBSITE_INQUIRY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeConfiguredOrigin);

  if (nodeEnv === "production" && configured.length === 0) {
    throw new Error(
      "WEBSITE_INQUIRY_ALLOWED_ORIGINS is required in production",
    );
  }

  return new Set(
    nodeEnv === "production" ? configured : [...configured, ...localOrigins],
  );
}

export function assertAllowedInquiryPage(
  headerOrigin: string | undefined,
  pageUrl: string,
  allowed: ReadonlySet<string>,
): { origin: string } {
  if (!headerOrigin) throw new InquiryOriginError();

  let normalizedHeader: string;
  let page: URL;
  try {
    normalizedHeader = normalizeConfiguredOrigin(headerOrigin);
    page = new URL(pageUrl);
  } catch {
    throw new InquiryOriginError();
  }

  if (!allowed.has(normalizedHeader) || page.origin !== normalizedHeader) {
    throw new InquiryOriginError();
  }
  return { origin: normalizedHeader };
}

type RateWindow = { count: number; resetsAt: number };

export class FixedWindowInquiryRateLimiter {
  private readonly windows = new Map<string, RateWindow>();
  private readonly now: () => number;

  constructor(
    private readonly options: {
      limit: number;
      windowMs: number;
      secret: string;
      now?: () => number;
    },
  ) {
    if (!options.secret) throw new Error("A rate-limit secret is required");
    this.now = options.now ?? Date.now;
  }

  consume(rawClientAddress: string): {
    allowed: boolean;
    retryAfterSeconds: number;
  } {
    const now = this.now();
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key);
    }

    const digest = createHmac("sha256", this.options.secret)
      .update(rawClientAddress || "unknown")
      .digest("base64url");
    const current = this.windows.get(digest);
    if (!current) {
      this.windows.set(digest, {
        count: 1,
        resetsAt: now + this.options.windowMs,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.options.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.resetsAt - now) / 1000),
        ),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
