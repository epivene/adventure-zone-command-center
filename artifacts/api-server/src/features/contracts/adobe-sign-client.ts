import { createHmac, timingSafeEqual } from "node:crypto";
import { readAdobeSignConfig } from "./adobe-sign-config";

export type AdobeAgreementStatus =
  | "OUT_FOR_SIGNATURE"
  | "SIGNED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "ABORTED"
  | "DOCUMENTS_NOT_YET_PROCESSED";

export type AdobeAgreement = {
  id: string;
  status: AdobeAgreementStatus | string;
  name?: string;
  createdDate?: string;
  lastEventDate?: string;
};

function authFailure(message: string) {
  const error = new Error(message);
  error.name = "AdobeSignConfigurationError";
  return error;
}

export class AdobeSignClient {
  private readonly config = readAdobeSignConfig();
  private accessToken: string | null = null;

  readiness() {
    return this.config.readiness;
  }

  verifyWebhook(rawBody: string, signature: string | undefined) {
    if (!this.config.webhookSecret || !signature) return false;
    const expected = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    const actual = signature.replace(/^sha256=/, "");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  }

  private async token() {
    if (!this.config.readiness.signApiAvailable) throw authFailure(this.config.readiness.reason);
    if (this.accessToken) return this.accessToken;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
    });
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw authFailure(`Acrobat Sign OAuth token request failed (${response.status}).`);
    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token) throw authFailure("Acrobat Sign OAuth response did not include an access token.");
    this.accessToken = payload.access_token;
    return this.accessToken;
  }

  private async request(path: string, init: RequestInit = {}) {
    const token = await this.token();
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    if (response.status === 401) {
      this.accessToken = null;
      throw authFailure("Acrobat Sign rejected the configured access token.");
    }
    if (!response.ok) throw new Error(`Acrobat Sign request failed (${response.status}).`);
    return response;
  }

  async createAgreement(input: {
    name: string;
    message: string;
    customerName: string;
    customerEmail: string;
    davidName: string;
    davidEmail: string;
    pdf: Uint8Array;
  }) {
    const form = new FormData();
    const pdfBuffer = Uint8Array.from(input.pdf).buffer as ArrayBuffer;
    form.append("File", new Blob([pdfBuffer], { type: "application/pdf" }), `${input.name}.pdf`);
    form.append("AgreementInfo", JSON.stringify({
      name: input.name,
      message: input.message,
      signatureType: "ESIGN",
      state: "IN_PROCESS",
      reminderFrequency: "DAILY_UNTIL_SIGNED",
      participantSetsInfo: [
        { memberInfos: [{ email: input.customerEmail, name: input.customerName }], order: 1, role: "SIGNER" },
        { memberInfos: [{ email: input.davidEmail, name: input.davidName }], order: 2, role: "SIGNER" },
      ],
    }));
    const response = await this.request("/agreements", { method: "POST", body: form });
    return await response.json() as { id: string };
  }

  async getAgreement(id: string) {
    const response = await this.request(`/agreements/${encodeURIComponent(id)}`);
    return await response.json() as AdobeAgreement;
  }

  async cancelAgreement(id: string, comment: string) {
    await this.request(`/agreements/${encodeURIComponent(id)}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "CANCELLED", comment }),
    });
  }

  async signedPdf(id: string) {
    const response = await this.request(`/agreements/${encodeURIComponent(id)}/combinedDocument`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async auditTrail(id: string) {
    const response = await this.request(`/agreements/${encodeURIComponent(id)}/auditTrail`);
    return new Uint8Array(await response.arrayBuffer());
  }
}