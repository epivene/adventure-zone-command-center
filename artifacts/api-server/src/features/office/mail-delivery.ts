import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

export type MailDeliveryInput = { to: string; subject: string; body: string };
export interface MailDelivery { send(input: MailDeliveryInput): Promise<{ messageId: string }>; }
export type SmtpConfig = { host: string; port: number; secure: boolean; user: string | null; password: string | null };
export type SmtpTransport = { send(input: { from: string; to: string; subject: string; text: string }): Promise<{ messageId: string }> };
export type SmtpTransportFactory = (config: SmtpConfig) => SmtpTransport;

export class MailConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "MailConfigurationError"; }
}

function sanitizeHeader(value: string, label: string) {
  if (/\r|\n/.test(value)) throw new Error(`${label} contains invalid line breaks.`);
  return value.trim();
}

function responseReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = "";
  const queue: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = [];
  const flush = () => {
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    let assembled = "";
    for (const line of lines) {
      assembled += `${line}\n`;
      if (/^\d{3} /.test(line)) queue.shift()?.resolve(assembled.trim());
    }
  };
  socket.on("data", (chunk) => { buffer += chunk.toString("utf8"); flush(); });
  socket.on("error", (error) => { while (queue.length) queue.shift()?.reject(error); });
  return () => new Promise<string>((resolve, reject) => queue.push({ resolve, reject }));
}

function responseCode(response: string) { return Number(response.match(/^(\d{3})/m)?.[1] ?? 0); }
async function expectCode(read: () => Promise<string>, allowed: number[]) {
  const response = await read();
  const code = responseCode(response);
  if (!allowed.includes(code)) throw new Error(`SMTP ${code || "error"}: ${response.slice(0, 500)}`);
  return response;
}
function write(socket: net.Socket | tls.TLSSocket, value: string) { socket.write(`${value}\r\n`); }

class BasicSmtpTransport implements SmtpTransport {
  constructor(private readonly config: SmtpConfig) {}

  async send(input: { from: string; to: string; subject: string; text: string }): Promise<{ messageId: string }> {
    const from = sanitizeHeader(input.from, "From");
    const to = sanitizeHeader(input.to, "Recipient");
    const subject = sanitizeHeader(input.subject, "Subject");
    const envelopeFrom = from.match(/<([^>]+)>/)?.[1] ?? from;
    const messageId = `<${randomUUID()}@${this.config.host}>`;

    let socket: net.Socket | tls.TLSSocket = this.config.secure
      ? tls.connect({ host: this.config.host, port: this.config.port, servername: this.config.host })
      : net.connect({ host: this.config.host, port: this.config.port });
    await new Promise<void>((resolve, reject) => {
      const event = this.config.secure ? "secureConnect" : "connect";
      socket.once(event, () => resolve()); socket.once("error", reject);
    });
    let read = responseReader(socket);
    await expectCode(read, [220]);
    write(socket, `EHLO adventure-zone.local`);
    let hello = await expectCode(read, [250]);

    if (!this.config.secure && /STARTTLS/i.test(hello)) {
      write(socket, "STARTTLS");
      await expectCode(read, [220]);
      socket = tls.connect({ socket: socket as net.Socket, servername: this.config.host });
      await new Promise<void>((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
      read = responseReader(socket);
      write(socket, "EHLO adventure-zone.local");
      hello = await expectCode(read, [250]);
    }

    if (this.config.user && this.config.password) {
      write(socket, "AUTH LOGIN"); await expectCode(read, [334]);
      write(socket, Buffer.from(this.config.user).toString("base64")); await expectCode(read, [334]);
      write(socket, Buffer.from(this.config.password).toString("base64")); await expectCode(read, [235]);
    }

    write(socket, `MAIL FROM:<${sanitizeHeader(envelopeFrom, "Envelope sender")}>`); await expectCode(read, [250]);
    write(socket, `RCPT TO:<${to}>`); await expectCode(read, [250, 251]);
    write(socket, "DATA"); await expectCode(read, [354]);
    const text = input.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      ".",
    ].join("\r\n");
    socket.write(`${headers}\r\n`);
    await expectCode(read, [250]);
    write(socket, "QUIT");
    socket.end();
    return { messageId };
  }
}

export function createMailDeliveryFromEnv(factory: SmtpTransportFactory = (config) => new BasicSmtpTransport(config)): MailDelivery {
  const host = process.env.OFFICE_MAIL_SMTP_HOST?.trim();
  const port = Number(process.env.OFFICE_MAIL_SMTP_PORT ?? "");
  const from = process.env.OFFICE_MAIL_FROM?.trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from) {
    throw new MailConfigurationError("Outbound email is not configured. Set the Office mail SMTP host, port, and From address.");
  }
  const user = process.env.OFFICE_MAIL_SMTP_USER?.trim() || null;
  // Google displays app passwords in four groups separated by spaces. Accept
  // that copy/paste format while still passing the 16-character credential to
  // SMTP. Other providers' passwords are left unchanged unless they contain
  // whitespace.
  const password = process.env.OFFICE_MAIL_SMTP_PASSWORD?.replace(/\s/g, "") || null;
  if (Boolean(user) !== Boolean(password)) throw new MailConfigurationError("SMTP username and password must either both be set or both be omitted.");
  const secure = (process.env.OFFICE_MAIL_SMTP_SECURE ?? "false").toLowerCase() === "true";
  const transport = factory({ host, port, secure, user, password });
  return {
    send: (input) => transport.send({ from, to: input.to, subject: input.subject, text: input.body }),
  };
}
