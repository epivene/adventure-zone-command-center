import { expect, test } from "@playwright/test";

test("manifest starts the installed app on Today", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest.start_url).toBe("/today");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
    ]),
  );
});

test("service worker cache never contains private responses", async ({
  page,
}) => {
  await page.goto("/today");
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });

  const privateCacheEntries = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const requests = (
      await Promise.all(
        cacheNames.map(async (name) => {
          const cache = await caches.open(name);
          return cache.keys();
        }),
      )
    ).flat();
    return requests
      .map((request) => new URL(request.url).pathname)
      .filter(
        (pathname) =>
          pathname.startsWith("/api/") ||
          pathname.startsWith("/bookings") ||
          pathname.startsWith("/sign-in"),
      );
  });

  expect(privateCacheEntries).toEqual([]);
});
