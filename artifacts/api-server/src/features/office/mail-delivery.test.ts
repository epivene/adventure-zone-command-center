import { afterEach, describe, expect, it, vi } from "vitest";
import { MailConfigurationError, createMailDeliveryFromEnv, type SmtpTransportFactory } from "./mail-delivery";

afterEach(() => {
  for (const key of ["OFFICE_MAIL_SMTP_HOST","OFFICE_MAIL_SMTP_PORT","OFFICE_MAIL_SMTP_SECURE","OFFICE_MAIL_SMTP_USER","OFFICE_MAIL_SMTP_PASSWORD","OFFICE_MAIL_FROM"]) delete process.env[key];
});

describe("owner mail delivery", () => {
  it("fails clearly when SMTP is not configured", () => {
    expect(() => createMailDeliveryFromEnv()).toThrow(MailConfigurationError);
  });

  it("maps server-only env config and message fields into the SMTP transport", async () => {
    process.env.OFFICE_MAIL_SMTP_HOST = "smtp.example.com";
    process.env.OFFICE_MAIL_SMTP_PORT = "587";
    process.env.OFFICE_MAIL_SMTP_SECURE = "false";
    process.env.OFFICE_MAIL_SMTP_USER = "mailer@example.com";
    process.env.OFFICE_MAIL_SMTP_PASSWORD = "secret";
    process.env.OFFICE_MAIL_FROM = "Adventure Zone <bookings@example.com>";

    const send = vi.fn(async () => ({ messageId: "message-123" }));
    const factory: SmtpTransportFactory = vi.fn(() => ({ send }));
    const delivery = createMailDeliveryFromEnv(factory);
    await expect(delivery.send({ to: "fair@example.org", subject: "Hello", body: "Email body" })).resolves.toEqual({ messageId: "message-123" });

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false, user: "mailer@example.com", password: "secret" }));
    expect(send).toHaveBeenCalledWith({ from: "Adventure Zone <bookings@example.com>", to: "fair@example.org", subject: "Hello", text: "Email body" });
  });

  it("normalizes spaces from a copied Google app password", () => {
    process.env.OFFICE_MAIL_SMTP_HOST = "smtp.gmail.com";
    process.env.OFFICE_MAIL_SMTP_PORT = "465";
    process.env.OFFICE_MAIL_SMTP_SECURE = "true";
    process.env.OFFICE_MAIL_SMTP_USER = "mailer@example.com";
    process.env.OFFICE_MAIL_SMTP_PASSWORD = "abcd efgh ijkl mnop";
    process.env.OFFICE_MAIL_FROM = "Adventure Zone <mailer@example.com>";

    const factory: SmtpTransportFactory = vi.fn(() => ({ send: vi.fn() }));
    createMailDeliveryFromEnv(factory);

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ password: "abcdefghijklmnop" }));
  });
});
