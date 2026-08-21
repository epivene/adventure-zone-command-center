import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { paperNotePages } from "@/db/schema";

function contextObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validPaperYear(value: unknown): number | null {
  const year = typeof value === "number" ? value : Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}

export async function setPaperNotePageYear(pageId: string, paperYear: number) {
  const [page] = await db.select({ pageContext: paperNotePages.pageContext })
    .from(paperNotePages)
    .where(eq(paperNotePages.id, pageId))
    .limit(1);
  if (!page) return;
  await db.update(paperNotePages)
    .set({ pageContext: { ...contextObject(page.pageContext), paperYear } })
    .where(eq(paperNotePages.id, pageId));
}

export async function getPaperNotePageYear(pageId: string): Promise<number | null> {
  const [page] = await db.select({ pageContext: paperNotePages.pageContext })
    .from(paperNotePages)
    .where(eq(paperNotePages.id, pageId))
    .limit(1);
  if (!page) return null;
  return validPaperYear(contextObject(page.pageContext).paperYear);
}
