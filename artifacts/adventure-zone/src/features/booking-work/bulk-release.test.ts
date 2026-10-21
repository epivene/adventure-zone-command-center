import { describe, it, expect } from "vitest";
import { previewRelease, releaseBatch } from "./bulk-release";
import type { Request } from "./bulk-release";
import type { WorkActivity } from "./client";

const card = (id: string, extra = {}) => ({
  id, revision: 7, status: "queued", assignedTo: { kind: "connection", id: "old" }, ...extra,
}) as WorkActivity;

describe("bulk owner release", () => {
  it("previews all pages, keeps filters, excludes closed, owner and unassigned work", async () => {
    const paths: string[] = [];
    const request = (async (path: string) => {
      paths.push(path);
      return path.includes("cursor=next")
        ? { items: [card("second"), card("first")], nextCursor: null }
        : { items: [card("first"), card("done", { status: "completed" }), card("cancelled", {status: "cancelled"}),
          card("owner", {assignedTo: {kind: "owner", id: "owner"}}), card("free", {assignedTo: null})], nextCursor: "next" };
    }) as Request;
    expect((await previewRelease("eventYear=2027&queue=replies", request)).map(a => a.id)).toEqual(["first", "second"]);
    expect(paths).toHaveLength(2);
    expect(paths.every(p => p.includes("eventYear=2027") && p.includes("queue=replies"))).toBe(true);
  });
  it("uses exact preview revisions and only changes assignment; skips conflicts", async () => {
    const calls: unknown[] = [];
    const request = (async (path: string, method: string, body: unknown) => {
      calls.push([path, method, body]);
      if (path.includes("/changed/")) throw {status: 409};
      return {};
    }) as Request;
    const result = await releaseBatch([card("first"), card("changed"), card("last")], request, () => {});
    expect(result.released).toBe(2);
    expect(result.skipped.map(a => a.id)).toEqual(["changed"]);
    expect(calls[0]).toEqual(["/first/reassign", "POST", {revision: 7, actor: null}]);
  });
  it("stops on uncertain errors without retrying or processing later cards", async () => {
    let calls = 0;
    const request = (async () => { calls++; throw new Error("Network lost"); }) as Request;
    await expect(releaseBatch([card("first"), card("later")], request, () => {})).rejects.toThrow("Network lost");
    expect(calls).toBe(1);
  });
  it("honors stop between requests and reports progress", async () => {
    let stopped = false;
    const result = await releaseBatch([card("first"), card("later")], (async () => ({})) as Request,
      () => { stopped = true; }, () => stopped);
    expect(result.released).toBe(1);
  });
  it("rejects a repeated pagination cursor", async () => {
    await expect(previewRelease("", (async () => ({items: [], nextCursor: "loop"})) as Request)).rejects.toThrow("Preview again");
  });
});
