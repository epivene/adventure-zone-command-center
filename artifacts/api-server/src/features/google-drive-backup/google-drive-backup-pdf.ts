import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type {
  FollowUpBackupSnapshot,
  FollowUpBackupSummary,
  ProfileBackupSnapshot,
} from "./google-drive-backup-types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const BODY_SIZE = 10;
const BODY_LINE_HEIGHT = 14;
const SECTION_SIZE = 14;
const SECTION_GAP = 12;

function safePdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maximumWidth: number,
): string[] {
  const words = safePdfText(value).split(" ").filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maximumWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maximumWidth) {
      current = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const next = fragment + character;
      if (font.widthOfTextAtSize(next, size) > maximumWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines;
}

class PdfWriter {
  private page: PDFPage;
  private y = PAGE_HEIGHT - MARGIN;

  constructor(
    private readonly document: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }

  private ensure(height: number): void {
    if (this.y - height >= MARGIN) return;
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  title(value: string): void {
    const lines = wrapText(value, this.bold, 20, PAGE_WIDTH - MARGIN * 2);
    this.ensure(lines.length * 25 + 8);
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN,
        y: this.y,
        size: 20,
        font: this.bold,
        color: rgb(0.13, 0.17, 0.24),
      });
      this.y -= 25;
    }
    this.y -= 8;
  }

  section(value: string): void {
    this.ensure(SECTION_SIZE + SECTION_GAP + 4);
    this.y -= SECTION_GAP;
    this.page.drawText(safePdfText(value), {
      x: MARGIN,
      y: this.y,
      size: SECTION_SIZE,
      font: this.bold,
      color: rgb(0.77, 0.12, 0.38),
    });
    this.y -= SECTION_SIZE + 6;
  }

  line(value: string, options?: { muted?: boolean; indent?: number }): void {
    const indent = options?.indent ?? 0;
    const lines = wrapText(
      value,
      this.regular,
      BODY_SIZE,
      PAGE_WIDTH - MARGIN * 2 - indent,
    );
    this.ensure(lines.length * BODY_LINE_HEIGHT + 2);
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y,
        size: BODY_SIZE,
        font: this.regular,
        color: options?.muted
          ? rgb(0.42, 0.45, 0.5)
          : rgb(0.16, 0.18, 0.22),
      });
      this.y -= BODY_LINE_HEIGHT;
    }
    this.y -= 2;
  }

  empty(): void {
    this.line("None", { muted: true });
  }
}

async function createDocument(
  title: string,
  generatedAt: Date,
): Promise<{ document: PDFDocument; writer: PdfWriter }> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(title);
  document.setAuthor("Adventure Zone Command Center");
  document.setCreator("Adventure Zone Command Center");
  document.setProducer("Adventure Zone Command Center");
  document.setCreationDate(generatedAt);
  document.setModificationDate(generatedAt);
  return { document, writer: new PdfWriter(document, regular, bold) };
}

function displayDate(value: string | null): string {
  if (!value) return "Date not set";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().replace("T", " ").replace(".000Z", " UTC")
    : "Date unavailable";
}

function writeFollowUp(
  writer: PdfWriter,
  item: FollowUpBackupSummary,
): void {
  const booking = item.bookingName ? ` — ${item.bookingName}` : "";
  writer.line(
    `${displayDate(item.dueAt)} — ${item.kind}${booking}`,
  );
  if (item.completedAt) {
    writer.line(
      `Completed ${displayDate(item.completedAt)}${item.outcome
        ? ` — ${item.outcome}`
        : ""}`,
      { muted: true, indent: 12 },
    );
  }
}

export async function renderProfileSummaryPdf(
  snapshot: ProfileBackupSnapshot,
): Promise<Uint8Array> {
  const title = `Profile Summary — ${snapshot.displayName}`;
  const { document, writer } = await createDocument(title, snapshot.generatedAt);
  writer.title(title);
  writer.line(`Updated: ${displayDate(snapshot.generatedAt.toISOString())}`, {
    muted: true,
  });
  writer.line(`Command Center: ${snapshot.appUrl}`, { muted: true });

  writer.section("Contact details");
  if (snapshot.contactDetails.length === 0) writer.empty();
  for (const item of snapshot.contactDetails) {
    writer.line(`${item.label}: ${item.value}`);
  }

  writer.section("Bookings and events");
  if (snapshot.bookings.length === 0) writer.empty();
  for (const booking of snapshot.bookings) {
    writer.line(
      `${booking.name} — ${booking.status} — ${displayDate(
        booking.startsAt,
      )}${booking.location ? ` — ${booking.location}` : ""}`,
    );
  }

  writer.section("Recent activity");
  if (snapshot.recentActivity.length === 0) writer.empty();
  for (const activity of snapshot.recentActivity) {
    writer.line(
      `${displayDate(activity.occurredAt)} — ${activity.kind}: ${activity.title}`,
    );
  }

  writer.section("Recent email summaries");
  if (snapshot.emailSummaries.length === 0) writer.empty();
  for (const email of snapshot.emailSummaries) {
    writer.line(
      `${displayDate(email.occurredAt)} — From: ${email.sender} — Subject: ${email.subject}`,
    );
    if (email.summary) writer.line(email.summary, { indent: 12 });
    writer.line(`Open in Command Center: ${email.appUrl}`, {
      muted: true,
      indent: 12,
    });
  }

  return document.save({ useObjectStreams: false });
}

export async function renderFollowUpsPdf(
  snapshot: FollowUpBackupSnapshot,
): Promise<Uint8Array> {
  const title = `Follow-ups — ${snapshot.displayName}`;
  const { document, writer } = await createDocument(title, snapshot.generatedAt);
  writer.title(title);
  writer.line(`Updated: ${displayDate(snapshot.generatedAt.toISOString())}`, {
    muted: true,
  });
  writer.line(`Command Center: ${snapshot.appUrl}`, { muted: true });

  writer.section("Due and open");
  if (snapshot.open.length === 0) writer.empty();
  snapshot.open.forEach((item) => writeFollowUp(writer, item));

  writer.section("Scheduled");
  if (snapshot.scheduled.length === 0) writer.empty();
  snapshot.scheduled.forEach((item) => writeFollowUp(writer, item));

  writer.section("Recently completed");
  if (snapshot.completedRecent.length === 0) writer.empty();
  snapshot.completedRecent.forEach((item) => writeFollowUp(writer, item));

  return document.save({ useObjectStreams: false });
}
