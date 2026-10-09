import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { parseFestivalNetLines, parseFestivalNetPdf } from "./pdf-parser";

const lines = [
  "10/8/26, 5:50 PM Test Art Festival 2026, an Art Competition in Eagle, Idaho",
  "TEST ART FESTIVAL Show Rating:",
  "Status: Updated 2/17/2026 Promoter Rating:",
  "October 3 - 10, 2026",
  "Test Venue, Eagle, ID 83616",
  "Event Address: 132 Example Street",
  "Event Type: Art Competition… Inside or Out: Both",
  "Attendance #: 1,500 # of Years: 12th",
  "Show Promoter: Test Organizer",
  "Main Email: test@example.org Web: Test Art Festival",
  "Show Director: Example Director Ph.: (208) 555-0100 E:",
  "test@example.org",
  "# Exhibitors: na Juried: yes",
  "Booth Fees: na Deadline: na",
  "Apply/Jury fee: $75-$150 Prize Money: $4,000",
  "What is allowed: fine art",
  "Handmade %: 100% Handmade, no commercial/retail allowed",
  "How/Where apply: example.org/artis… Insurance: No Insurance Required",
  "Food Booths: na Deadline: na",
  "Food Booth Fees: na",
  "# of Stages: no entertainment Deadline: na",
  "Other Activities: Workshops and awards",
  "Admission: Free",
  "Description: A painting celebration.",
  "Artists can compete throughout the week.",
  "https://festivalnet.com/999999001/Eagle-Idaho/Art-Competitions/Test-Art-Festival 1/1",
];
const links = [
  { label: "Test Art Festival", url: "https://example.org/" },
  { label: "example.org/artis…", url: "https://example.org/artist-registration/" },
];

describe("FestivalNet PDF extraction", () => {
  it("separates dates, profile facts, annual facts and actual embedded application URLs", () => {
    const { draft } = parseFestivalNetLines(lines, links, "test.pdf");
    expect(draft).toMatchObject({ name: "TEST ART FESTIVAL", year: 2026, city: "Eagle", region: "ID", postalCode: "83616", contactName: "Example Director" });
    expect(draft.details).toMatchObject({
      startsOn: "2026-10-03", endsOn: "2026-10-10", attendance: "1,500", setting: "Both",
      applicationUrl: "https://example.org/artist-registration/", insurance: "No Insurance Required",
      description: "A painting celebration. Artists can compete throughout the week.",
      mainEmail: "test@example.org",
    });
  });
  it("omits unavailable values without erasing explicit no/free information", () => {
    const { draft } = parseFestivalNetLines(lines, links, "test.pdf");
    expect(draft.details.boothFee).toBeUndefined();
    expect(draft.details.applicationDeadline).toBeUndefined();
    expect(draft.details.stages).toBe("no entertainment");
    expect(draft.details.admission).toBe("Free");
  });
  it("rejects unrelated and combined-event PDFs instead of inventing fields", () => {
    expect(() => parseFestivalNetLines(["A random invoice"], [], "invoice.pdf")).toThrow("FestivalNet event link");
    expect(() => parseFestivalNetLines([...lines, "https://festivalnet.com/999999002/Other-Event"], links, "combined.pdf")).toThrow("more than one event");
  });
  it("reads PDF bytes with the production extractor and hashes its source", async () => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    lines.map(line => line.replaceAll("…", "...")).forEach((line, index) => page.drawText(line, { x: 20, y: 760 - index * 23, size: 8, font }));
    const result = await parseFestivalNetPdf(await doc.save(), "generated.pdf");
    expect(result.draft.name).toBe("TEST ART FESTIVAL");
    expect(result.draft.details.importFileSha256).toMatch(/^[a-f0-9]{64}$/);
    const qa = await PDFDocument.create(); const qaFont = await qa.embedFont(StandardFonts.Helvetica);
    const qaPage = qa.addPage([612, 792]);
    lines.map(line => line.replaceAll("…", "...").replaceAll("TEST ART FESTIVAL", "QA FESTIVALNET IMPORT"))
      .forEach((line, index) => qaPage.drawText(line, { x: 20, y: 760 - index * 23, size: 8, font: qaFont }));
    await writeFile("/tmp/festivalnet-import-browser.pdf", await qa.save());
  });
  it("rejects malformed and scanned PDFs with a useful explanation", async () => {
    await expect(parseFestivalNetPdf(new Uint8Array([1, 2, 3]), "bad.pdf")).rejects.toThrow("valid PDF");
    const blank = await PDFDocument.create(); blank.addPage();
    await expect(parseFestivalNetPdf(await blank.save(), "scan.pdf")).rejects.toThrow("scan");
  });
  it("extracts the user's supplied print layout when the reference file is available", async () => {
    const root = new URL("../../../../../attached_assets/", import.meta.url);
    const filename = (await readdir(root).catch(() => [])).find(name => name.startsWith("Eagle_Plein_Air_Festival_2026") && name.endsWith(".pdf"));
    if (!filename) return; // Synthetic PDF cases above remain portable without the user's reference.
    const result = await parseFestivalNetPdf(await readFile(new URL(filename, root)), "sample.pdf");
    expect(result.draft.name).toBe("EAGLE PLEIN AIR FESTIVAL");
    expect(result.draft.details).toMatchObject({ startsOn: "2026-10-03", endsOn: "2026-10-10", applicationUrl: "https://www.eaglepleinair.com/artist-registration/" });
    expect(result.draft.city).toBe("Eagle");
  });
});
