import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source=readFileSync("src/features/office/office-owner-attention.ts","utf8");

describe("Office Coordinator owner attention",()=>{
  it("counts only active Needs Help tasks",()=>{
    expect(source).toContain('eq(officeTasks.needsHelp,true)');
    expect(source).toContain("not in ('done','cancelled')");
  });
  it("counts only submitted email drafts for owner review",()=>{
    expect(source).toContain('eq(officeEmailDrafts.state,"submitted")');
    expect(source).not.toContain('eq(officeEmailDrafts.state,"needs_changes")');
    expect(source).not.toContain('eq(officeEmailDrafts.state,"sent")');
  });
  it("limits each preview list to five rows",()=>{
    expect((source.match(/\.limit\(5\)/g)??[]).length).toBe(2);
  });
});
