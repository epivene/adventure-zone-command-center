import { expect, it } from "vitest";
import { extractSnapshotLinks } from "./email-template-snapshot-links";

it("lets Dave verify real email and telephone links, but not empty or executable URLs", () => {
  const links = extractSnapshotLinks('<a href="mailto:hello@example.com?subject=Hello">Email us</a><a href="tel:+14357605583">Call</a><a href="mailto:">Empty</a><a href="javascript:alert(1)">Bad</a>');
  expect(links.safeLinks).toEqual([
    {href:"mailto:hello@example.com?subject=Hello",label:"Email us"},
    {href:"tel:+14357605583",label:"Call"},
  ]);
  expect(links.blockedLinks).toHaveLength(2);
});
