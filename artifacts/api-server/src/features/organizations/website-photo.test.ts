import { expect, it } from "vitest";
import { extractWebsiteImages, publicImageAddress } from "./website-photo";
it("selects website logos and social images and resolves relative URLs", () => {
 const images = extractWebsiteImages('<meta property="og:image" content="/event.jpg"><img src="/logo.png" alt="Festival logo"><img src="data:image/png;base64,x"><img src="/event.jpg">', 'https://fair.example/event');
 expect(images.map(i=>i.url)).toEqual(['https://fair.example/event.jpg','https://fair.example/logo.png']);
});
it("rejects private, mapped and reserved addresses", () => {
 for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','::1','::ffff:7f00:1','fc00::1','2001:db8::1']) expect(publicImageAddress(address)).toBe(false);
 expect(publicImageAddress('8.8.8.8')).toBe(true);
 expect(publicImageAddress('2606:4700::1111')).toBe(true);
});
