import { describe, it, expect } from "vitest";
import { replaceEmailVideoLinks } from "./email-video-links";

describe("website video destinations", () => {
  it("maps the three known videos while preserving template markup", () => {
    for (const [id, page] of [["MWD0SdAWZpc", "adventure-zone"], ["tgjwa1LvghI", "pirates-rebellion"], ["-xTjCJz9RmI", "warriors-playground"]]) {
      for (const url of [`https://youtu.be/${id}?feature=shared`, `https://www.youtube.com/watch?v=${id}&amp;t=1`, `https://www.youtube.com/embed/${id}`]) {
        const input = `<a href="${url}" title="Watch"><img src="keep.gif">Watch {{eventName}}</a>`;
        const expected = input.replace(url, `https://www.the-adventure-zone.com/${page}-package`);
        expect(replaceEmailVideoLinks(input)).toBe(expected);
        expect(replaceEmailVideoLinks(expected)).toBe(expected);
      }
    }
  });
  it("leaves other links, image sources and plain text untouched", () => {
    const html = '<a href="https://youtu.be/unrelated">Other</a><a href="https://example.com/MWD0SdAWZpc">Other</a><img src="https://youtu.be/MWD0SdAWZpc"><p>https://youtu.be/MWD0SdAWZpc</p><a href="mailto:test@example.com">Email</a>';
    expect(replaceEmailVideoLinks(html)).toBe(html);
  });
});
