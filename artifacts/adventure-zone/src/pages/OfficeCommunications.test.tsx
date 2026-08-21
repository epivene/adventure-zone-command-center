// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const email=readFileSync("src/components/office/office-email-editor.tsx","utf8");
const mail=readFileSync("src/pages/OfficeMailPage.tsx","utf8");
const messages=readFileSync("src/pages/OfficeMessagesPage.tsx","utf8");

describe("Office Coordinator communications",()=>{
  it("allows draft submission but never renders a send-email action",()=>{
    expect(email).toContain("Save Draft");
    expect(email).toContain("Submit Email");
    expect(email).not.toMatch(/>Send<\/button>/);
    expect(email).not.toContain('/send`');
    expect(email).toContain("Needs Changes");
    expect(email).toContain("Sent");
  });
  it("tracks brochure preparation and mailed completion",()=>{
    expect(mail).toContain("Mark Prepared");
    expect(mail).toContain("Mark Mailed");
    expect(mail).toContain("Correct profile info");
  });
  it("keeps messages as a simple work thread",()=>{
    expect(messages).toContain("Messages");
    expect(messages).toContain("Send Message");
    expect(messages).not.toContain("manager/");
  });
});
