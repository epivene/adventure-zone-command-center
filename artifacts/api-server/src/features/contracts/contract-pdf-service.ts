import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { renderContract, type RenderedContract } from "./contract-renderer";
import type { ContractValues } from "./contract-types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 14;

function pdfSafe(value: string) {
  return value
    .replaceAll("\u2011", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2022", "-")
    .replaceAll("\u00a0", " ");
}

function wrap(line: string, font: PDFFont, size: number, maxWidth: number) {
  if (!line.trim()) return [""];
  const words = pdfSafe(line).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateContractPdf(values: ContractValues): Promise<{
  bytes: Uint8Array;
  pageCount: number;
  layout: RenderedContract;
}> {
  const layout = renderContract(values);
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const stableDate = new Date(`${values.eventStartDate}T00:00:00.000Z`);
  document.setTitle(layout.title);
  document.setAuthor("The Adventure Zone Inc.");
  document.setCreator("Adventure Zone Command Center");
  document.setProducer("Adventure Zone Command Center");
  document.setCreationDate(stableDate);
  document.setModificationDate(stableDate);

  let page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const drawLine = (line: string, options: { heading?: boolean; indent?: number } = {}) => {
    const activeFont = options.heading ? bold : font;
    const size = options.heading ? 12 : BODY_SIZE;
    const indent = options.indent ?? 0;
    for (const part of wrap(line, activeFont, size, PAGE_WIDTH - (MARGIN * 2) - indent)) {
      if (y < MARGIN + 28) addPage();
      page.drawText(part, { x: MARGIN + indent, y, size, font: activeFont, color: rgb(0.08, 0.08, 0.08) });
      y -= options.heading ? 17 : LINE_HEIGHT;
    }
  };

  drawLine(layout.title, { heading: true });
  y -= 4;
  for (const section of layout.sections) {
    drawLine(section.heading, { heading: true });
    for (const paragraph of section.paragraphs) drawLine(paragraph);
    for (const bullet of section.bullets) drawLine(`- ${bullet}`, { indent: 10 });
    y -= 7;
  }

  if (y < 220) addPage();
  drawLine("Signatures - sequential order", { heading: true });
  for (const signature of layout.signatureBlocks) {
    y -= 10;
    drawLine(`${signature.order}. ${signature.name} - ${signature.role}`);
    drawLine(signature.email);
    y -= 13;
    drawLine("Signature: ________________________________    Date: ____________________");
  }

  if (document.getPageCount() < 2) addPage();
  const pages = document.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 58,
      y: 26,
      size: 8,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  });
  const bytes = await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes, pageCount: pages.length, layout };
}
