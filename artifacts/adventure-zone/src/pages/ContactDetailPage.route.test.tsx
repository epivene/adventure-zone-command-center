import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "ContactDetailPage.tsx"), "utf8");

describe("ContactDetailPage route wiring", () => {
  it("uses the contactId prop supplied by the /contacts/:id route", () => {
    expect(source).toContain("export default function ContactDetailPage({ contactId }");
    expect(source).not.toContain("useParams<{ contactId: string }>()");
  });
});
