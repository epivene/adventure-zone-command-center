import type {
  GoogleCalendarEvent,
  GoogleGmailDraft,
  GoogleGmailLabelMutationClient,
  GoogleCalendarSummary,
  DriveCreateFileInput,
  DriveUpdateFileInput,
  GoogleDriveBackupFile,
  GoogleDriveFile,
  GoogleDrivePage,
  GoogleLabelSummary,
  GoogleMessageMetadata,
  GoogleMessagePage,
  GoogleMessageRef,
  GoogleThreadAttachment,
  GoogleThreadDetail,
  GoogleWorkspaceFetch,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

export const GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export const GOOGLE_WORKSPACE_READ_SCOPES = [
  "openid",
  "email",
  GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE,
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE,
] as const;
export const GOOGLE_WORKSPACE_REQUIRED_SCOPES = [...GOOGLE_WORKSPACE_READ_SCOPES] as const;

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const userInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
const gmailBaseEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me";
const labelsEndpoint = `${gmailBaseEndpoint}/labels`;
const draftsEndpoint = `${gmailBaseEndpoint}/drafts`;
const calendarListEndpoint =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const calendarBaseEndpoint = "https://www.googleapis.com/calendar/v3/calendars";
const driveFilesEndpoint = "https://www.googleapis.com/drive/v3/files";
const driveUploadEndpoint = "https://www.googleapis.com/upload/drive/v3/files";
const driveFolderMimeType = "application/vnd.google-apps.folder";
const driveFileFields =
  "id,name,mimeType,parents,webViewLink,md5Checksum";

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type GoogleWorkspaceClientError = Error & { code: string; retryAfterSeconds?: number };

function clientError(code: string): GoogleWorkspaceClientError {
  return Object.assign(new Error(code), { code });
}

function retryableClientError(code: string, response: Response): GoogleWorkspaceClientError {
  const header = response.headers.get("retry-after");
  const numeric = header === null ? NaN : Number(header);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(header ?? "") - Date.now()) / 1000;
  return Object.assign(clientError(code), {
    retryAfterSeconds: Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60,
  });
}

function gmailHeader(value: string): string {
  if (!value.trim() || /[\r\n]/.test(value)) throw clientError("GOOGLE_WORKSPACE_GMAIL_HEADER_INVALID");
  return value.trim();
}
function wrapBase64(value: string): string { return value.match(/.{1,76}/g)?.join("\r\n") ?? ""; }
export function buildGmailRawMessage(input: {
  to: string;
  subject: string;
  body: string;
  bodyFormat?: "plain_text" | "html";
  inReplyTo?: string;
  references?: string;
}): string {
  const to = gmailHeader(input.to).toLowerCase();
  const subject = gmailHeader(input.subject);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !input.body) throw clientError("GOOGLE_WORKSPACE_GMAIL_MESSAGE_INVALID");
  const encodedSubject = /^[\x20-\x7E]+$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const mimeType = input.bodyFormat === "html" ? "text/html" : "text/plain";
  const mime = [
    "MIME-Version: 1.0", `To: ${to}`, `Subject: ${encodedSubject}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${gmailHeader(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${gmailHeader(input.references)}`] : []),
    `Content-Type: ${mimeType}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "",
    wrapBase64(Buffer.from(input.body, "utf8").toString("base64")),
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

function scopeList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}


function googleForbiddenCode(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  const error =
    payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : {};
  const reasons = Array.isArray(error.errors)
    ? error.errors.flatMap((entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).reason === "string"
          ? [String((entry as Record<string, unknown>).reason)]
          : [],
      )
    : [];
  if (reasons.some((reason) =>
    /^(rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded)$/i
      .test(reason)
  )) {
    return "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED";
  }
  if (reasons.some((reason) =>
    /^(authError|insufficientPermissions)$/i.test(reason)
  )) {
    return "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED";
  }
  return fallback;
}

function googleLabelSummary(value: unknown): GoogleLabelSummary {
  if (!value || typeof value !== "object") {
    throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_RESPONSE_INVALID");
  }
  const label = value as Record<string, unknown>;
  if (
    typeof label.id !== "string" ||
    !label.id.trim() ||
    typeof label.name !== "string" ||
    !label.name.trim()
  ) {
    throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_RESPONSE_INVALID");
  }
  return {
    id: label.id.trim(),
    name: label.name.trim(),
    type: label.type === "system" ? "system" : "user",
  };
}

function gmailMutationLabelIds(input: {
  addLabelIds: string[];
  removeLabelIds: string[];
}): { addLabelIds: string[]; removeLabelIds: string[] } {
  const clean = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  const addLabelIds = clean(input.addLabelIds);
  const removeLabelIds = clean(input.removeLabelIds);
  if (addLabelIds.some((id) => removeLabelIds.includes(id))) {
    throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_MUTATION_INVALID");
  }
  return { addLabelIds, removeLabelIds };
}

function partHasAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  if (typeof part.filename === "string" && part.filename.trim()) return true;
  if (part.body && typeof part.body === "object") {
    const body = part.body as Record<string, unknown>;
    if (typeof body.attachmentId === "string" && body.attachmentId.trim()) {
      return true;
    }
  }
  return Array.isArray(part.parts) && part.parts.some(partHasAttachment);
}

function calendarEventTime(value: unknown): GoogleCalendarEvent["start"] | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const date = typeof item.date === "string" ? item.date : undefined;
  const dateTime = typeof item.dateTime === "string" ? item.dateTime : undefined;
  const timeZone = typeof item.timeZone === "string" ? item.timeZone : undefined;
  if (Boolean(date) === Boolean(dateTime)) return null;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) return null;
  }
  if (dateTime && !Number.isFinite(new Date(dateTime).valueOf())) return null;
  if (timeZone) { try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { return null; } }
  return { ...(date ? { date } : { dateTime: dateTime! }), ...(timeZone ? { timeZone } : {}) };
}

function headerValue(headers: unknown[], name: string): string {
  const found = headers.find((value) => {
    if (!value || typeof value !== "object") return false;
    const header = value as Record<string, unknown>;
    return (
      typeof header.name === "string" &&
      header.name.toLowerCase() === name.toLowerCase()
    );
  });
  if (!found || typeof found !== "object") return "";
  const value = (found as Record<string, unknown>).value;
  return typeof value === "string" ? value : "";
}

function decodeBase64Url(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function decodeBase64UrlBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value) {
    throw clientError("GOOGLE_WORKSPACE_ATTACHMENT_RESPONSE_INVALID");
  }
  try {
    return new Uint8Array(Buffer.from(value, "base64url"));
  } catch {
    throw clientError("GOOGLE_WORKSPACE_ATTACHMENT_RESPONSE_INVALID");
  }
}

function textFromHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function bodyTextFromPart(value: unknown): { plain: string; html: string } {
  if (!value || typeof value !== "object") return { plain: "", html: "" };
  const part = value as Record<string, unknown>;
  const mimeType = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
  const body = part.body && typeof part.body === "object"
    ? (part.body as Record<string, unknown>)
    : {};
  const decoded = decodeBase64Url(body.data);
  let plain = mimeType === "text/plain" ? decoded : "";
  let html = mimeType === "text/html" ? decoded : "";
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const nested = bodyTextFromPart(child);
      if (!plain && nested.plain) plain = nested.plain;
      if (!html && nested.html) html = nested.html;
    }
  }
  return { plain, html };
}

function attachmentsFromPart(
  value: unknown,
  messageId: string,
): GoogleThreadAttachment[] {
  if (!value || typeof value !== "object") return [];
  const part = value as Record<string, unknown>;
  const body = part.body && typeof part.body === "object"
    ? (part.body as Record<string, unknown>)
    : {};
  const filename = typeof part.filename === "string" ? part.filename.trim() : "";
  const attachmentId =
    typeof body.attachmentId === "string" ? body.attachmentId.trim() : "";
  const own =
    filename && attachmentId
      ? [{
          attachmentId,
          filename,
          mimeType:
            typeof part.mimeType === "string" && part.mimeType.trim()
              ? part.mimeType.trim()
              : "application/octet-stream",
          sizeBytes:
            typeof body.size === "number" && Number.isFinite(body.size)
              ? Math.max(0, Math.trunc(body.size))
              : 0,
          messageId,
        }]
      : [];
  const nested = Array.isArray(part.parts)
    ? part.parts.flatMap((child) => attachmentsFromPart(child, messageId))
    : [];
  return [...own, ...nested];
}

export function createGoogleWorkspaceReadClient(input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken?: string;
  fetcher?: GoogleWorkspaceFetch;
  gmailDraftTimeoutMs?: number;
}): GoogleWorkspaceReadClient & GoogleGmailLabelMutationClient {
  const fetcher = input.fetcher ?? fetch;
  const gmailDraftTimeoutMs =
    typeof input.gmailDraftTimeoutMs === "number" &&
    Number.isFinite(input.gmailDraftTimeoutMs) &&
    input.gmailDraftTimeoutMs > 0
      ? Math.min(input.gmailDraftTimeoutMs, 30_000)
      : 10_000;
  let refreshToken = input.refreshToken?.trim() || null;
  let accessToken: { value: string; expiresAtMs: number } | null = null;

  // Cache only within this account-bound client; never share labels across accounts.
  let labelCache: { labels: GoogleLabelSummary[]; expiresAt: number } | null = null;
  let labelRead: Promise<GoogleLabelSummary[]> | null = null;
  let labelGeneration = 0;
  function invalidateLabels() {
    labelGeneration++;
    labelCache = null;
    labelRead = null;
  }

  async function requestToken(
    body: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<TokenResponse> {
    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    const payload = (await responseJson(response)) as TokenResponse;
    if (!response.ok) {
      if (payload.error === "invalid_grant") {
        throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
      }
      throw clientError("GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED");
    }
    return payload;
  }

  function cacheAccessToken(payload: TokenResponse): string {
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw clientError("GOOGLE_WORKSPACE_OAUTH_RESPONSE_INVALID");
    }
    const expiresInSeconds =
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? Math.max(0, payload.expires_in)
        : 3600;
    accessToken = {
      value: payload.access_token,
      expiresAtMs: Date.now() + Math.max(0, expiresInSeconds - 60) * 1000,
    };
    return payload.access_token;
  }

  async function currentAccessToken(forceRefresh = false, signal?: AbortSignal): Promise<string> {
    if (!forceRefresh && accessToken && Date.now() < accessToken.expiresAtMs) {
      return accessToken.value;
    }
    if (!refreshToken) {
      throw clientError("GOOGLE_WORKSPACE_NOT_AUTHENTICATED");
    }

    const payload = await requestToken(
      new URLSearchParams({
        client_id: input.environment.clientId,
        client_secret: input.environment.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal,
    );
    return cacheAccessToken(payload);
  }

  async function authorizedJson(
    url: string,
    retryUnauthorized = true,
  ): Promise<Record<string, unknown>> {
    const token = await currentAccessToken(!retryUnauthorized);
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && retryUnauthorized) {
      accessToken = null;
      return authorizedJson(url, false);
    }
    if (response.status === 401) {
      throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    if (response.status === 403) {
      const code = googleForbiddenCode(await responseJson(response), "GOOGLE_WORKSPACE_API_REQUEST_FAILED");
      throw code === "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED"
        ? retryableClientError(code, response) : clientError(code);
    }
    if (response.status === 404) {
      throw clientError("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND");
    }
    if (response.status === 429) {
      throw retryableClientError("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED", response);
    }
    if (response.status >= 500) {
      throw retryableClientError("GOOGLE_WORKSPACE_GMAIL_RETRYABLE_FAILURE", response);
    }
    if (!response.ok) {
      throw clientError("GOOGLE_WORKSPACE_API_REQUEST_FAILED");
    }
    return responseJson(response);
  }


  async function authorizedMutation(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
    retryUnauthorized = true,
  ): Promise<Record<string, unknown>> {
    const changesLabels = url === labelsEndpoint || url.startsWith(`${labelsEndpoint}/`);
    if (changesLabels) invalidateLabels();
    const token = await currentAccessToken(!retryUnauthorized);
    const response = await fetcher(url, {
      method,
      headers: body
        ? {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          }
        : { authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    }).finally(() => { if (changesLabels) invalidateLabels(); });
    if (response.status === 401 && retryUnauthorized) {
      accessToken = null;
      return authorizedMutation(url, method, body, false);
    }
    if (response.status === 401) {
      throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    if (response.status === 403) {
      const code = googleForbiddenCode(await responseJson(response), "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED");
      throw code === "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED"
        ? retryableClientError(code, response) : clientError(code);
    }
    if (response.status === 404) {
      throw clientError("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND");
    }
    if (response.status === 409) {
      throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT");
    }
    if (response.status === 429) {
      throw retryableClientError("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED", response);
    }
    if (response.status >= 500) {
      throw retryableClientError("GOOGLE_WORKSPACE_GMAIL_RETRYABLE_FAILURE", response);
    }
    if (!response.ok) {
      throw clientError("GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED");
    }
    return response.status === 204 ? {} : responseJson(response);
  }

  function requiredDriveValue(value: string, code: string): string {
    const normalized = value.normalize("NFC").trim();
    if (!normalized || normalized.length > 500 || /[\r\n\0]/.test(normalized)) {
      throw clientError(code);
    }
    return normalized;
  }

  function driveSearchLiteral(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  }

  function driveBackupFile(value: unknown): GoogleDriveBackupFile {
    if (!value || typeof value !== "object") {
      throw clientError("GOOGLE_WORKSPACE_DRIVE_RESPONSE_INVALID");
    }
    const file = value as Record<string, unknown>;
    if (
      typeof file.id !== "string" ||
      !file.id.trim() ||
      typeof file.name !== "string" ||
      !file.name.trim() ||
      typeof file.mimeType !== "string" ||
      !file.mimeType.trim()
    ) {
      throw clientError("GOOGLE_WORKSPACE_DRIVE_RESPONSE_INVALID");
    }
    return {
      id: file.id.trim(),
      name: file.name.trim(),
      mimeType: file.mimeType.trim(),
      parents: Array.isArray(file.parents)
        ? file.parents.filter((parent): parent is string =>
            typeof parent === "string" && Boolean(parent.trim())
          )
        : [],
      webViewLink:
        typeof file.webViewLink === "string" && file.webViewLink.trim()
          ? file.webViewLink.trim()
          : null,
      md5Checksum:
        typeof file.md5Checksum === "string" && file.md5Checksum.trim()
          ? file.md5Checksum.trim()
          : null,
    };
  }

  function driveMultipartBody(
    metadata: Record<string, unknown>,
    mimeType: string,
    bytes: Uint8Array,
  ): { body: ArrayBuffer; contentType: string } {
    const boundary = `azcc-drive-${Math.random().toString(36).slice(2)}`;
    const before = Buffer.from(
      [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        "",
        "",
      ].join("\r\n"),
      "utf8",
    );
    const after = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const combined = Buffer.concat([before, Buffer.from(bytes), after]);
    const body = new ArrayBuffer(combined.byteLength);
    new Uint8Array(body).set(combined);
    return {
      body,
      contentType: `multipart/related; boundary=${boundary}`,
    };
  }

  async function authorizedDriveRequest(
    url: string,
    init: Omit<RequestInit, "headers"> & {
      headers?: Record<string, string>;
    } = {},
    retryUnauthorized = true,
  ): Promise<Record<string, unknown>> {
    const token = await currentAccessToken(!retryUnauthorized);
    const response = await fetcher(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 401 && retryUnauthorized) {
      accessToken = null;
      return authorizedDriveRequest(url, init, false);
    }
    const payload = await responseJson(response);
    if (response.status === 401) {
      throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    if (response.status === 403) {
      const error =
        payload.error && typeof payload.error === "object"
          ? payload.error as Record<string, unknown>
          : {};
      const reasons = Array.isArray(error.errors)
        ? error.errors.flatMap((entry) =>
            entry &&
            typeof entry === "object" &&
            typeof (entry as Record<string, unknown>).reason === "string"
              ? [String((entry as Record<string, unknown>).reason)]
              : [],
          )
        : [];
      if (reasons.some((reason) =>
        /^(rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded)$/i
          .test(reason)
      )) {
        throw clientError("GOOGLE_WORKSPACE_DRIVE_RETRYABLE_FAILURE");
      }
      throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    if (response.status === 429 || response.status >= 500) {
      throw clientError("GOOGLE_WORKSPACE_DRIVE_RETRYABLE_FAILURE");
    }
    if (response.status === 404) {
      throw clientError("GOOGLE_WORKSPACE_DRIVE_SOURCE_NOT_FOUND");
    }
    if (!response.ok) {
      throw clientError("GOOGLE_WORKSPACE_DRIVE_WRITE_FAILED");
    }
    return payload;
  }

  async function authorizedBytes(url: string, retryUnauthorized = true): Promise<Uint8Array> {
    const token = await currentAccessToken(!retryUnauthorized);
    const response = await fetcher(url, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 401 && retryUnauthorized) {
      accessToken = null;
      return authorizedBytes(url, false);
    }
    if (!response.ok) throw clientError("GOOGLE_WORKSPACE_API_REQUEST_FAILED");
    return new Uint8Array(await response.arrayBuffer());
  }

  return {
    driveBackup: {
      async findChild(
        parentId: string,
        name: string,
        mimeType?: string,
      ): Promise<GoogleDriveBackupFile | null> {
        const parent = requiredDriveValue(
          parentId,
          "GOOGLE_WORKSPACE_DRIVE_PARENT_INVALID",
        );
        const childName = requiredDriveValue(
          name,
          "GOOGLE_WORKSPACE_DRIVE_NAME_INVALID",
        );
        const url = new URL(driveFilesEndpoint);
        const clauses = [
          `'${driveSearchLiteral(parent)}' in parents`,
          `name = '${driveSearchLiteral(childName)}'`,
          "trashed = false",
        ];
        if (mimeType) {
          clauses.push(
            `mimeType = '${driveSearchLiteral(requiredDriveValue(
              mimeType,
              "GOOGLE_WORKSPACE_DRIVE_MIME_INVALID",
            ))}'`,
          );
        }
        url.searchParams.set("q", clauses.join(" and "));
        url.searchParams.set("pageSize", "2");
        url.searchParams.set("fields", `files(${driveFileFields})`);
        const payload = await authorizedDriveRequest(url.toString());
        const files = Array.isArray(payload.files) ? payload.files : [];
        return files.length ? driveBackupFile(files[0]) : null;
      },

      async createFolder(
        parentId: string,
        name: string,
      ): Promise<GoogleDriveBackupFile> {
        const parent = requiredDriveValue(
          parentId,
          "GOOGLE_WORKSPACE_DRIVE_PARENT_INVALID",
        );
        const folderName = requiredDriveValue(
          name,
          "GOOGLE_WORKSPACE_DRIVE_NAME_INVALID",
        );
        const url = new URL(driveFilesEndpoint);
        url.searchParams.set("fields", driveFileFields);
        return driveBackupFile(await authorizedDriveRequest(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: folderName,
            mimeType: driveFolderMimeType,
            parents: [parent],
          }),
        }));
      },

      async createFile(
        createInput: DriveCreateFileInput,
      ): Promise<GoogleDriveBackupFile> {
        const parent = requiredDriveValue(
          createInput.parentId,
          "GOOGLE_WORKSPACE_DRIVE_PARENT_INVALID",
        );
        const name = requiredDriveValue(
          createInput.name,
          "GOOGLE_WORKSPACE_DRIVE_NAME_INVALID",
        );
        const mimeType = requiredDriveValue(
          createInput.mimeType,
          "GOOGLE_WORKSPACE_DRIVE_MIME_INVALID",
        );
        const multipart = driveMultipartBody(
          { name, mimeType, parents: [parent] },
          mimeType,
          createInput.bytes,
        );
        const url = new URL(driveUploadEndpoint);
        url.searchParams.set("uploadType", "multipart");
        url.searchParams.set("fields", driveFileFields);
        return driveBackupFile(await authorizedDriveRequest(url.toString(), {
          method: "POST",
          headers: { "content-type": multipart.contentType },
          body: multipart.body,
        }));
      },

      async updateFile(
        updateInput: DriveUpdateFileInput,
      ): Promise<GoogleDriveBackupFile> {
        const fileId = requiredDriveValue(
          updateInput.fileId,
          "GOOGLE_WORKSPACE_DRIVE_FILE_INVALID",
        );
        const metadata: Record<string, unknown> = {};
        if (updateInput.name !== undefined) {
          metadata.name = requiredDriveValue(
            updateInput.name,
            "GOOGLE_WORKSPACE_DRIVE_NAME_INVALID",
          );
        }
        if (updateInput.mimeType !== undefined) {
          metadata.mimeType = requiredDriveValue(
            updateInput.mimeType,
            "GOOGLE_WORKSPACE_DRIVE_MIME_INVALID",
          );
        }
        const moving = updateInput.parentId !== undefined ||
          updateInput.currentParentId !== undefined;
        if (moving && (!updateInput.parentId || !updateInput.currentParentId)) {
          throw clientError("GOOGLE_WORKSPACE_DRIVE_MOVE_INVALID");
        }
        if (!updateInput.bytes && !moving && Object.keys(metadata).length === 0) {
          throw clientError("GOOGLE_WORKSPACE_DRIVE_UPDATE_EMPTY");
        }
        const url = new URL(
          `${updateInput.bytes ? driveUploadEndpoint : driveFilesEndpoint}/${encodeURIComponent(fileId)}`,
        );
        url.searchParams.set("fields", driveFileFields);
        if (updateInput.bytes) url.searchParams.set("uploadType", "multipart");
        if (moving) {
          url.searchParams.set(
            "addParents",
            requiredDriveValue(
              updateInput.parentId!,
              "GOOGLE_WORKSPACE_DRIVE_PARENT_INVALID",
            ),
          );
          url.searchParams.set(
            "removeParents",
            requiredDriveValue(
              updateInput.currentParentId!,
              "GOOGLE_WORKSPACE_DRIVE_PARENT_INVALID",
            ),
          );
        }
        if (updateInput.bytes) {
          const mimeType = requiredDriveValue(
            updateInput.mimeType ?? "application/octet-stream",
            "GOOGLE_WORKSPACE_DRIVE_MIME_INVALID",
          );
          const multipart = driveMultipartBody(
            metadata,
            mimeType,
            updateInput.bytes,
          );
          return driveBackupFile(await authorizedDriveRequest(url.toString(), {
            method: "PATCH",
            headers: { "content-type": multipart.contentType },
            body: multipart.body,
          }));
        }
        return driveBackupFile(await authorizedDriveRequest(url.toString(), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metadata),
        }));
      },

      async getFile(fileId: string): Promise<GoogleDriveBackupFile> {
        const id = requiredDriveValue(
          fileId,
          "GOOGLE_WORKSPACE_DRIVE_FILE_INVALID",
        );
        const url = new URL(`${driveFilesEndpoint}/${encodeURIComponent(id)}`);
        url.searchParams.set("fields", driveFileFields);
        return driveBackupFile(await authorizedDriveRequest(url.toString()));
      },
    },

    authorizationUrl({ state }: { state: string }): string {
      if (!state.trim()) {
        throw clientError("GOOGLE_WORKSPACE_OAUTH_STATE_INVALID");
      }
      const url = new URL(authorizationEndpoint);
      url.searchParams.set("client_id", input.environment.clientId);
      url.searchParams.set("redirect_uri", input.environment.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GOOGLE_WORKSPACE_REQUIRED_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "false");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode(code: string) {
      if (!code.trim()) {
        throw clientError("GOOGLE_WORKSPACE_AUTHORIZATION_CODE_INVALID");
      }
      const payload = await requestToken(
        new URLSearchParams({
          code,
          client_id: input.environment.clientId,
          client_secret: input.environment.clientSecret,
          redirect_uri: input.environment.redirectUri,
          grant_type: "authorization_code",
        }),
      );
      cacheAccessToken(payload);
      if (typeof payload.refresh_token === "string" && payload.refresh_token.trim()) {
        invalidateLabels();
        refreshToken = payload.refresh_token.trim();
      }
      if (!refreshToken) {
        throw clientError("GOOGLE_WORKSPACE_REFRESH_TOKEN_MISSING");
      }
      return {
        refreshToken,
        scopes: scopeList(payload.scope),
      };
    },

    async getGmailDraftRaw(draftId) {
      const payload=await authorizedJson(`${draftsEndpoint}/${encodeURIComponent(draftId)}?format=raw`);
      const message=payload.message as Record<string,unknown>|undefined;
      if(typeof payload.id!=="string"||typeof message?.id!=="string"||typeof message?.raw!=="string")throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_RESPONSE_INVALID");
      return {draftId:payload.id,messageId:message.id,threadId:typeof message.threadId==="string"?message.threadId:null,raw:message.raw};
    },
    async getGmailMessageRaw(messageId) {
      const payload=await authorizedJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=raw`);
      if(typeof payload.id!=="string"||typeof payload.threadId!=="string"||typeof payload.raw!=="string")throw clientError("GOOGLE_WORKSPACE_GMAIL_MESSAGE_RESPONSE_INVALID");
      return {messageId:payload.id,threadId:payload.threadId,raw:payload.raw,labelIds:Array.isArray(payload.labelIds)?payload.labelIds.filter((v):v is string=>typeof v==="string"):[]};
    },
    async listGmailDrafts(query, pageToken) {
      const payload=await authorizedJson(`${draftsEndpoint}?maxResults=25&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      return {drafts:Array.isArray(payload.drafts)?payload.drafts as {id:string;message:{id:string;threadId:string}}[]:[],nextPageToken:typeof payload.nextPageToken==="string"?payload.nextPageToken:null};
    },
    async createGmailDraft(input): Promise<GoogleGmailDraft> {
      if (!/^[A-Za-z0-9_-]+$/.test(input.raw)) throw clientError("GOOGLE_WORKSPACE_GMAIL_MESSAGE_INVALID");
      let response: Response;
      let payload: Record<string, unknown>;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), gmailDraftTimeoutMs);
      try {
        const token = await currentAccessToken(false, controller.signal);
        response = await fetcher(draftsEndpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: { raw: input.raw, ...(input.threadId ? {threadId: input.threadId} : {}) } }),
          signal: controller.signal,
        });
        payload = await responseJson(response);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
        ) {
          throw error;
        }
        throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN");
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_CREATE_FAILED");
      const message = payload.message && typeof payload.message === "object" ? payload.message as Record<string, unknown> : null;
      if (typeof payload.id !== "string" || !payload.id.trim() || !message || typeof message.id !== "string" || !message.id.trim()) throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN");
      return {
        draftId: payload.id.trim(),
        messageId: message.id.trim(),
        threadId:
          typeof message.threadId === "string" && message.threadId.trim()
            ? message.threadId.trim()
            : null,
      };
    },

    async updateGmailDraft(input): Promise<GoogleGmailDraft> {
      if (!input.draftId.trim() || !/^[A-Za-z0-9_-]+$/.test(input.raw)) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_MESSAGE_INVALID");
      }
      let response: Response;
      let payload: Record<string, unknown>;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), gmailDraftTimeoutMs);
      try {
        const token = await currentAccessToken(false, controller.signal);
        response = await fetcher(
          `${draftsEndpoint}/${encodeURIComponent(input.draftId.trim())}`,
          {
            method: "PUT",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ message: { raw: input.raw, ...(input.threadId ? {threadId: input.threadId} : {}) } }),
            signal: controller.signal,
          },
        );
        payload = await responseJson(response);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
        ) {
          throw error;
        }
        throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN");
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_UPDATE_FAILED");
      const message = payload.message && typeof payload.message === "object"
        ? payload.message as Record<string, unknown>
        : null;
      if (
        typeof payload.id !== "string" ||
        !payload.id.trim() ||
        !message ||
        typeof message.id !== "string" ||
        !message.id.trim()
      ) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN");
      }
      return {
        draftId: payload.id.trim(),
        messageId: message.id.trim(),
        threadId:
          typeof message.threadId === "string" && message.threadId.trim()
            ? message.threadId.trim()
            : null,
      };
    },

    async accountIdentity() {
      const payload = await authorizedJson(userInfoEndpoint);
      if (typeof payload.email !== "string" || !payload.email.trim()) {
        throw clientError("GOOGLE_WORKSPACE_ACCOUNT_IDENTITY_INVALID");
      }
      return {
        subject:
          typeof payload.sub === "string" && payload.sub.trim()
            ? payload.sub.trim()
            : null,
        email: payload.email.trim().toLowerCase(),
      };
    },

    async listLabels(): Promise<GoogleLabelSummary[]> {
      const copy = (labels: GoogleLabelSummary[]) => labels.map(label => ({ ...label }));
      if (labelCache && Date.now() < labelCache.expiresAt) return copy(labelCache.labels);
      if (labelRead) return copy(await labelRead);
      const generation = labelGeneration;
      const pending = (async () => {
      const payload = await authorizedJson(labelsEndpoint);
      const labels = Array.isArray(payload.labels) ? payload.labels : [];
      return labels.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const label = value as Record<string, unknown>;
        if (typeof label.id !== "string" || typeof label.name !== "string") {
          return [];
        }
        return [{
          id: label.id,
          name: label.name,
          type: label.type === "system" ? "system" as const : "user" as const,
        }];
      });
      })();
      labelRead = pending;
      try {
        const labels = await pending;
        if (generation === labelGeneration) labelCache = { labels, expiresAt: Date.now() + 30_000 };
        return copy(labels);
      } finally {
        if (labelRead === pending) labelRead = null;
      }
    },


    async createLabel(name: string): Promise<GoogleLabelSummary> {
      const value = name.normalize("NFC").trim();
      if (!value || value.length > 225 || /[\r\n\0]/.test(value)) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_NAME_INVALID");
      }
      return googleLabelSummary(await authorizedMutation(labelsEndpoint, "POST", {
        name: value,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }));
    },

    async renameLabel(input): Promise<GoogleLabelSummary> {
      const labelId = input.labelId.trim();
      const name = input.name.normalize("NFC").trim();
      if (!labelId || !name || name.length > 225 || /[\r\n\0]/.test(name)) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_NAME_INVALID");
      }
      return googleLabelSummary(await authorizedMutation(
        `${labelsEndpoint}/${encodeURIComponent(labelId)}`,
        "PATCH",
        { name },
      ));
    },

    async deleteLabel(labelId: string): Promise<void> {
      const value = labelId.trim();
      if (!value) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_ID_INVALID");
      }
      await authorizedMutation(
        `${labelsEndpoint}/${encodeURIComponent(value)}`,
        "DELETE",
      );
    },

    async modifyThreadLabels(input): Promise<void> {
      const threadId = input.threadId.trim();
      if (!threadId) throw clientError("GOOGLE_WORKSPACE_GMAIL_THREAD_ID_INVALID");
      const labels = gmailMutationLabelIds(input);
      await authorizedMutation(
        `${gmailBaseEndpoint}/threads/${encodeURIComponent(threadId)}/modify`,
        "POST",
        labels,
      );
    },

    async modifyMessageLabels(input): Promise<void> {
      const messageId = input.messageId.trim();
      if (!messageId) throw clientError("GOOGLE_WORKSPACE_MESSAGE_ID_INVALID");
      const labels = gmailMutationLabelIds(input);
      await authorizedMutation(
        `${gmailBaseEndpoint}/messages/${encodeURIComponent(messageId)}/modify`,
        "POST",
        labels,
      );
    },

    async listCalendars(): Promise<GoogleCalendarSummary[]> {
      const calendars: GoogleCalendarSummary[] = [];
      let pageToken: string | null = null;
      do {
        const url = new URL(calendarListEndpoint);
        url.searchParams.set("maxResults", "250");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await authorizedJson(url.toString());
        const items = Array.isArray(payload.items) ? payload.items : [];
        for (const value of items) {
          if (!value || typeof value !== "object") continue;
          const calendar = value as Record<string, unknown>;
          if (typeof calendar.id !== "string" || !calendar.id.trim()) continue;
          const summary =
            typeof calendar.summaryOverride === "string" &&
            calendar.summaryOverride.trim()
              ? calendar.summaryOverride.trim()
              : typeof calendar.summary === "string" && calendar.summary.trim()
                ? calendar.summary.trim()
                : calendar.id;
          calendars.push({
            id: calendar.id,
            summary,
            primary: calendar.primary === true,
          });
        }
        pageToken =
          typeof payload.nextPageToken === "string" && payload.nextPageToken
            ? payload.nextPageToken
            : null;
      } while (pageToken);
      return calendars;
    },

    async listCalendarEvents(input): Promise<GoogleCalendarEvent[]> {
      const calendarIds = [...new Set(input.calendarIds.map((id) => id.trim()))].filter(Boolean);
      const timeMin = new Date(input.timeMin);
      const timeMax = new Date(input.timeMax);
      if (!calendarIds.length || !Number.isFinite(timeMin.valueOf()) || !Number.isFinite(timeMax.valueOf()) || timeMin >= timeMax) {
        throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENTS_INPUT_INVALID");
      }
      const events: GoogleCalendarEvent[] = [];
      for (const calendarId of calendarIds) {
        let pageToken: string | null = null;
        do {
          const url = new URL(`${calendarBaseEndpoint}/${encodeURIComponent(calendarId)}/events`);
          url.searchParams.set("timeMin", input.timeMin);
          url.searchParams.set("timeMax", input.timeMax);
          url.searchParams.set("singleEvents", "true");
          url.searchParams.set("showDeleted", "false");
          url.searchParams.set("maxResults", "250");
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const payload = await authorizedJson(url.toString());
          if (typeof payload.timeZone !== "string" || !payload.timeZone.trim() || !Array.isArray(payload.items)) throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID");
          const calendarTimeZone = payload.timeZone.trim();
          try { new Intl.DateTimeFormat("en-US", { timeZone: calendarTimeZone }); } catch { throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID"); }
          const values = payload.items;
          for (const value of values) {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID");
            const event = value as Record<string, unknown>;
            if (event.status === "cancelled") continue;
            if (typeof event.id !== "string" || !event.id.trim()) throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID");
            const start = calendarEventTime(event.start);
            const end = calendarEventTime(event.end);
            const originalStartTime = event.originalStartTime === undefined || event.originalStartTime === null ? null : calendarEventTime(event.originalStartTime);
            const updated = event.updated === undefined || event.updated === null ? null : typeof event.updated === "string" && event.updated.trim() && Number.isFinite(new Date(event.updated).valueOf()) ? event.updated : null;
            if (!start || !end || Boolean(start.date) !== Boolean(end.date)
              || (start.date && start.date >= end.date!)
              || (start.dateTime && new Date(start.dateTime) >= new Date(end.dateTime!))
              || (event.originalStartTime !== undefined && event.originalStartTime !== null && !originalStartTime)
              || (event.updated !== undefined && event.updated !== null && !updated)) {
              throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID");
            }
            events.push({
              calendarId, calendarTimeZone, id: event.id, iCalUid: typeof event.iCalUID === "string" && event.iCalUID.trim() ? event.iCalUID.trim() : null,
              summary: typeof event.summary === "string" ? event.summary : "", description: typeof event.description === "string" ? event.description : "",
              start, end, updated,
              recurringEventId: typeof event.recurringEventId === "string" ? event.recurringEventId : null,
              originalStartTime,
            });
          }
          if (payload.nextPageToken !== undefined && (typeof payload.nextPageToken !== "string" || !payload.nextPageToken.trim())) throw clientError("GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID");
          pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : null;
        } while (pageToken);
      }
      return events;
    },

    async listRecentMessageRefs(limit: number): Promise<GoogleMessageRef[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_LIMIT_INVALID");
      }
      const refs: GoogleMessageRef[] = [];
      let pageToken: string | null = null;
      do {
        const url = new URL(`${gmailBaseEndpoint}/messages`);
        url.searchParams.set("maxResults", String(Math.min(100, limit - refs.length)));
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await authorizedJson(url.toString());
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        for (const value of messages) {
          if (refs.length >= limit) break;
          if (!value || typeof value !== "object") continue;
          const message = value as Record<string, unknown>;
          if (
            typeof message.id !== "string" ||
            !message.id.trim() ||
            typeof message.threadId !== "string" ||
            !message.threadId.trim()
          ) {
            continue;
          }
          refs.push({ id: message.id, threadId: message.threadId });
        }
        pageToken =
          refs.length < limit && typeof payload.nextPageToken === "string" && payload.nextPageToken
            ? payload.nextPageToken
            : null;
      } while (pageToken && refs.length < limit);
      return refs;
    },

    async listMessagePage(input): Promise<GoogleMessagePage> {
      if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 250) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_LIMIT_INVALID");
      }
      const url = new URL(`${gmailBaseEndpoint}/messages`);
      url.searchParams.set("maxResults", String(input.maxResults));
      url.searchParams.set("includeSpamTrash", "false");
      const labelIds = [...new Set((input.labelIds ?? []).map((id) => id.trim()))]
        .filter(Boolean);
      if (labelIds.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_LABEL_ID_INVALID");
      }
      for (const labelId of labelIds) url.searchParams.append("labelIds", labelId);
      if (input.query !== undefined && input.query !== null) {
        const query = input.query.trim();
        if (!query || query.length > 2_000) {
          throw clientError("GOOGLE_WORKSPACE_MESSAGE_QUERY_INVALID");
        }
        url.searchParams.set("q", query);
      }
      const pageToken = input.pageToken?.trim();
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await authorizedJson(url.toString());
      const values = Array.isArray(payload.messages) ? payload.messages : [];
      const messages = values.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const message = value as Record<string, unknown>;
        if (
          typeof message.id !== "string" ||
          !message.id.trim() ||
          typeof message.threadId !== "string" ||
          !message.threadId.trim()
        ) return [];
        return [{ id: message.id, threadId: message.threadId }];
      });
      return {
        messages,
        nextPageToken:
          typeof payload.nextPageToken === "string" && payload.nextPageToken.trim()
            ? payload.nextPageToken.trim()
            : null,
      };
    },

    async getThreadLabelIds(threadId: string): Promise<string[]> {
      const id = threadId.trim();
      if (!id) throw clientError("GOOGLE_WORKSPACE_GMAIL_THREAD_ID_INVALID");
      const url = new URL(
        `${gmailBaseEndpoint}/threads/${encodeURIComponent(id)}`,
      );
      url.searchParams.set("format", "metadata");
      url.searchParams.set("fields", "id,messages(id,labelIds)");
      const payload = await authorizedJson(url.toString());
      if (payload.id !== id || !Array.isArray(payload.messages)) {
        throw clientError("GOOGLE_WORKSPACE_GMAIL_THREAD_RESPONSE_INVALID");
      }
      return [...new Set(payload.messages.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const labelIds = (value as Record<string, unknown>).labelIds;
        return Array.isArray(labelIds)
          ? labelIds.filter((label): label is string =>
              typeof label === "string" && Boolean(label.trim())
            )
          : [];
      }))].sort();
    },

    async getMessageMetadata(id: string): Promise<GoogleMessageMetadata> {
      const messageId = id.trim();
      if (!messageId) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_ID_INVALID");
      }
      const url = new URL(`${gmailBaseEndpoint}/messages/${encodeURIComponent(messageId)}`);
      url.searchParams.set("format", "metadata");
      for (const header of ["From", "To", "Cc", "Subject", "Date"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      const payload = await authorizedJson(url.toString());
      if (
        typeof payload.id !== "string" ||
        typeof payload.threadId !== "string"
      ) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_METADATA_INVALID");
      }
      const messagePayload =
        payload.payload && typeof payload.payload === "object"
          ? (payload.payload as Record<string, unknown>)
          : {};
      const headers = Array.isArray(messagePayload.headers)
        ? messagePayload.headers
        : [];
      const rawInternalDate =
        typeof payload.internalDate === "string"
          ? Number(payload.internalDate)
          : typeof payload.internalDate === "number"
            ? payload.internalDate
            : NaN;
      const parts = Array.isArray(messagePayload.parts) ? messagePayload.parts : [];
      return {
        id: payload.id,
        threadId: payload.threadId,
        labelIds: Array.isArray(payload.labelIds)
          ? payload.labelIds.filter((label): label is string => typeof label === "string")
          : [],
        internalDateMs: Number.isFinite(rawInternalDate) ? rawInternalDate : null,
        snippet: typeof payload.snippet === "string" ? payload.snippet : "",
        headers: {
          from: headerValue(headers, "From"),
          to: headerValue(headers, "To"),
          cc: headerValue(headers, "Cc"),
          subject: headerValue(headers, "Subject"),
          date: headerValue(headers, "Date"),
        },
        hasAttachments: parts.some(partHasAttachment),
      };
    },

    async getAttachment({ messageId, attachmentId }): Promise<Uint8Array> {
      const message = messageId.trim();
      const attachment = attachmentId.trim();
      if (!message || !attachment) {
        throw clientError("GOOGLE_WORKSPACE_ATTACHMENT_ID_INVALID");
      }
      const url = new URL(
        `${gmailBaseEndpoint}/messages/${encodeURIComponent(message)}/attachments/${encodeURIComponent(attachment)}`,
      );
      const payload = await authorizedJson(url.toString());
      return decodeBase64UrlBytes(payload.data);
    },

    async getThreadDetail(threadId: string): Promise<GoogleThreadDetail> {
      const id = threadId.trim();
      if (!id) throw clientError("GOOGLE_WORKSPACE_THREAD_ID_INVALID");
      const url = new URL(`${gmailBaseEndpoint}/threads/${encodeURIComponent(id)}`);
      url.searchParams.set("format", "full");
      const payload = await authorizedJson(url.toString());
      if (typeof payload.id !== "string" || !Array.isArray(payload.messages)) {
        throw clientError("GOOGLE_WORKSPACE_THREAD_DETAIL_INVALID");
      }

      const messages = payload.messages.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const message = value as Record<string, unknown>;
        if (typeof message.id !== "string") return [];
        const messagePayload =
          message.payload && typeof message.payload === "object"
            ? (message.payload as Record<string, unknown>)
            : {};
        const headers = Array.isArray(messagePayload.headers)
          ? messagePayload.headers
          : [];
        const labels = Array.isArray(message.labelIds)
          ? message.labelIds.filter((entry): entry is string => typeof entry === "string")
          : [];
        const rawInternalDate =
          typeof message.internalDate === "string"
            ? Number(message.internalDate)
            : typeof message.internalDate === "number"
              ? message.internalDate
              : NaN;
        const bodies = bodyTextFromPart(messagePayload);
        return [{
          id: message.id,
          internalDateMs: Number.isFinite(rawInternalDate) ? rawInternalDate : null,
          from: headerValue(headers, "From"),
          to: headerValue(headers, "To"),
          cc: headerValue(headers, "Cc"),
          subject: headerValue(headers, "Subject"),
          date: headerValue(headers, "Date"),
          direction: labels.includes("SENT")
            ? "outgoing" as const
            : labels.includes("INBOX")
              ? "incoming" as const
              : "unknown" as const,
          bodyText: (bodies.plain || textFromHtml(bodies.html)).trim(),
          attachments: attachmentsFromPart(messagePayload, message.id),
        }];
      }).sort((left, right) =>
        (left.internalDateMs ?? 0) - (right.internalDateMs ?? 0) ||
        left.id.localeCompare(right.id),
      );

      return {
        id: payload.id,
        subject: messages.find((message) => message.subject.trim())?.subject ?? "",
        originalGmailUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(payload.id)}`,
        messages,
      };
    },

    async listDriveFiles(parentId: string, pageToken?: string | null): Promise<GoogleDrivePage> {
      const parent = parentId.trim();
      if (!parent || parent.length > 500) throw clientError("GOOGLE_WORKSPACE_DRIVE_PARENT_INVALID");
      const url = new URL(driveFilesEndpoint);
      url.searchParams.set("q", `'${parent.replaceAll("'", "\\'")}' in parents and trashed = false`);
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,size,parents,webViewLink)");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await authorizedJson(url.toString());
      const files = (Array.isArray(payload.files) ? payload.files : []).flatMap((value): GoogleDriveFile[] => {
        if (!value || typeof value !== "object") return [];
        const file = value as Record<string, unknown>;
        if (typeof file.id !== "string" || typeof file.name !== "string" || typeof file.mimeType !== "string") return [];
        return [{
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: typeof file.modifiedTime === "string" ? file.modifiedTime : null,
          size: typeof file.size === "string" && /^\d+$/.test(file.size) ? Number(file.size) : null,
          parents: Array.isArray(file.parents) ? file.parents.filter((item): item is string => typeof item === "string") : [],
          webViewLink: typeof file.webViewLink === "string" ? file.webViewLink : null,
        }];
      });
      return { files, nextPageToken: typeof payload.nextPageToken === "string" ? payload.nextPageToken : null };
    },

    async downloadDriveFile(fileId: string, mimeType = "application/octet-stream") {
      const id = fileId.trim();
      if (!id) throw clientError("GOOGLE_WORKSPACE_DRIVE_FILE_INVALID");
      const exports: Record<string, string> = {
        "application/vnd.google-apps.document": "application/pdf",
        "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.google-apps.presentation": "application/pdf",
      };
      const exportMime = exports[mimeType];
      const url = new URL(`${driveFilesEndpoint}/${encodeURIComponent(id)}${exportMime ? "/export" : ""}`);
      if (exportMime) url.searchParams.set("mimeType", exportMime);
      else url.searchParams.set("alt", "media");
      return authorizedBytes(url.toString());
    },
  };
}

export type {
  GoogleCalendarSummary,
  GoogleLabelSummary,
  GoogleMessageMetadata,
  GoogleMessagePage,
  GoogleMessageRef,
  GoogleThreadDetail,
  GoogleWorkspaceReadClient,
} from "./google-api-types";


