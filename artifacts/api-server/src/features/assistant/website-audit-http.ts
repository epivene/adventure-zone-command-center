import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type WebsiteFetchResult = {
  requestedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  reachable: boolean;
  redirected: boolean;
  title: string | null;
  textSample: string;
  failure: "timeout" | "dns" | "unsafe_url" | "http_error" | null;
};

export interface WebsiteAuditHttpClient {
  inspect(url: string): Promise<WebsiteFetchResult>;
}

type Resolve = (hostname: string) => Promise<string[]>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 5;
const MAX_TEXT_SAMPLE = 12_000;
const MAX_BODY_BYTES = 256_000;
const DEFAULT_TIMEOUT_MS = 8_000;

function normalizeInputUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function ipv4Parts(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isUnsafeAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4) {
    const [a, b] = ipv4;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a >= 224;
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase().split("%")[0] ?? address.toLowerCase();
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("::ffff:127.")
      || normalized.startsWith("::ffff:10.")
      || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function validateTarget(url: URL, resolve: Resolve): Promise<"ok" | "unsafe_url" | "dns"> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "unsafe_url";
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return "unsafe_url";
  try {
    const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
    if (!addresses.length || addresses.some(isUnsafeAddress)) return "unsafe_url";
    return "ok";
  } catch {
    return "dns";
  }
}

function decodeHtmlEvidence(html: string) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const decode = (value: string) => value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const title = titleMatch?.[1]
    ? decode(titleMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300) || null
    : null;
  const textSample = decode(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_SAMPLE);
  return { title, textSample };
}

async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return "";
  const text = await response.text();
  return text.slice(0, MAX_BODY_BYTES);
}

export class SafeWebsiteAuditHttpClient implements WebsiteAuditHttpClient {
  private readonly resolve: Resolve;
  private readonly fetchFn: Fetch;
  private readonly timeoutMs: number;

  constructor(input?: { resolve?: Resolve; fetch?: Fetch; timeoutMs?: number }) {
    this.resolve = input?.resolve ?? defaultResolve;
    this.fetchFn = input?.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, input?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  }

  async inspect(value: string): Promise<WebsiteFetchResult> {
    const requested = normalizeInputUrl(value);
    const base: WebsiteFetchResult = {
      requestedUrl: value,
      finalUrl: requested?.toString() ?? null,
      statusCode: null,
      reachable: false,
      redirected: false,
      title: null,
      textSample: "",
      failure: null,
    };
    if (!requested) return { ...base, failure: "unsafe_url" };

    let current = requested;
    let redirected = false;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const safety = await validateTarget(current, this.resolve);
      if (safety !== "ok") return { ...base, finalUrl: current.toString(), redirected, failure: safety };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchFn(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "AdventureZoneWebsiteAudit/1.0", accept: "text/html,application/xhtml+xml" },
        });
      } catch (error) {
        clearTimeout(timeout);
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return { ...base, finalUrl: current.toString(), redirected, failure: "timeout" };
        }
        return { ...base, finalUrl: current.toString(), redirected, failure: "http_error" };
      }
      clearTimeout(timeout);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) {
          return { ...base, finalUrl: current.toString(), statusCode: response.status, redirected: true, failure: "http_error" };
        }
        try {
          current = new URL(location, current);
        } catch {
          return { ...base, finalUrl: current.toString(), statusCode: response.status, redirected: true, failure: "http_error" };
        }
        redirected = true;
        continue;
      }

      if (response.status < 200 || response.status >= 400) {
        return { ...base, finalUrl: current.toString(), statusCode: response.status, redirected, failure: "http_error" };
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      let title: string | null = null;
      let textSample = "";
      if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || !contentType) {
        const evidence = decodeHtmlEvidence(await boundedText(response));
        title = evidence.title;
        textSample = evidence.textSample;
      }
      return {
        requestedUrl: value,
        finalUrl: current.toString(),
        statusCode: response.status,
        reachable: true,
        redirected,
        title,
        textSample,
        failure: null,
      };
    }
    return { ...base, finalUrl: current.toString(), redirected, failure: "http_error" };
  }
}
