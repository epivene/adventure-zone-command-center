import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { generateContractPdf } from "./contract-pdf-service";
import { guaranteedFeeSnapshot } from "./fixtures/guaranteed-fee.snapshot";

describe("generateContractPdf", () => {
  it("creates a readable multi-page PDF with ordered signature and date lines", async () => {
    const result = await generateContractPdf(guaranteedFeeSnapshot);
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
    const document = await PDFDocument.load(result.bytes);
    expect(document.getPageCount()).toBe(result.pageCount);
    expect(result.pageCount).toBeGreaterThanOrEqual(2);
    expect(result.layout.title).toContain("Dinosaur Stone Age");
    expect(result.layout.signatureBlocks).toEqual([
      expect.objectContaining({ name: "Pat Organizer", order: 1, hasDateLine: true }),
      expect.objectContaining({ name: "Dave Gordon", order: 2, hasDateLine: true }),
    ]);
  });

  it("generates identical bytes for the same immutable snapshot", async () => {
    const first = await generateContractPdf(guaranteedFeeSnapshot);
    const second = await generateContractPdf(guaranteedFeeSnapshot);
    expect(second.bytes).toEqual(first.bytes);
  });
});
