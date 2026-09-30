import { expect, it } from "vitest";
import { eventDatesSchema, formatResearchNote } from "./research-details";
const source = {url:"https://event.example/dates", retrievedAt:"2026-09-30T12:00:00Z", eventYear:2027, claim:"May 13–16, 2027. Organizer unknown.", verification:"verified" as const};
it("renders readable facts and links without exposing provider or JSON metadata", () => {
 const note = formatResearchNote("Family festival.\nChatGPT researched this.", [source]);
 expect(note).toContain("Family festival.");
 expect(note).toContain(source.url);
 expect(note).not.toMatch(/chatgpt|retrievedAt|\{"/i);
});
it("rejects impossible dates, reversed ranges and unsupported estimates", () => {
 const base = {startsOn:"2027-05-13",endsOn:"2027-05-16",status:"confirmed",sourceUrl:source.url,rationale:"Published 2027 festival dates"};
 expect(eventDatesSchema.safeParse(base).success).toBe(true);
 expect(eventDatesSchema.safeParse({...base,startsOn:"2027-02-30"}).success).toBe(false);
 expect(eventDatesSchema.safeParse({...base,endsOn:"2027-05-12"}).success).toBe(false);
 expect(eventDatesSchema.safeParse({...base,status:"expected",rationale:""}).success).toBe(false);
});
