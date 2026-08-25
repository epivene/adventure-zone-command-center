import { z } from "zod";

const nullableCell = z.string().max(10_000).nullable();
const originalValuesSchema = z.record(z.string().min(1).max(500), nullableCell).superRefine((value, context) => {
  if (Object.keys(value).length > 500) {
    context.addIssue({ code: "custom", message: "A source row cannot contain more than 500 columns." });
  }
});

export const leadImportRowSchema = z.object({
  sheetName: z.string().trim().min(1).max(255),
  rowNumber: z.number().int().positive().max(1_000_000),
  company: z.string().max(10_000),
  phone: nullableCell,
  address1: nullableCell,
  address2: nullableCell,
  city: nullableCell,
  state: nullableCell,
  zipCode: nullableCell,
  website: nullableCell,
  industry: nullableCell,
  originalValues: originalValuesSchema,
}).strict();

export const importLeadWorkbookSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255).regex(/\.xlsx?$/i),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(leadImportRowSchema).min(1).max(5_000),
}).strict();
