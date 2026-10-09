import { test, expect } from "@playwright/test";
import { crew, event, leg } from "./fixtures.mjs";

async function snapshots(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("adventure-zone-manager", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("crew-snapshots", "readonly");
        const request = tx.objectStore("crew-snapshots").getAll();
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}

test("prepared production shell reopens crew travel with all networking offline, then rechecks and removes revoked records", async ({ page, context, request }, testInfo) => {
  const network = await context.newCDPSession(page);
  const reportConnectivity = offline => network.send("Network.overrideNetworkState", {
    offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  const setDeviceOffline = async offline => {
    // Context emulation blocks traffic in every target (including the SW).
    // Chromium can reset the renderer's navigator.onLine on a SW navigation;
    // explicitly report the same physical state using its supported CDP API.
    await context.setOffline(offline);
    await reportConnectivity(offline);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
  };
  // Authenticate through the real UI; never seed identity or private IDB rows.
  await page.goto("/manager/sign-in");
  await page.getByLabel("Travel leg").selectOption(leg.id);
  await page.getByLabel("Password", { exact: true }).fill("isolated-fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/manager$/);
  await page.goto(`/manager/operations?bookingId=${event.bookingId}`);
  await expect(page.getByRole("heading", { name: "Trip operations" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assigned event", exact: true })).toHaveValue(event.bookingId);
  const card = page.getByTestId("card-crew-travel");
  const stop = page.getByTestId("crew-stop-offline-test-stop");
  await expect(stop).toContainText(crew.crewLocation.stops[0].notes);
  await expect.poll(async () => (await snapshots(page)).length).toBe(1);
  const original = (await snapshots(page))[0];
  expect(original.legId).toBe(leg.id);
  expect(original.data).toEqual(crew);
  expect(original.loadedAt).toMatch(/^\d{4}-/);

  // Use the same public production SW preparation protocol as workspace-shell.
  // No development module imports, fake service worker, or preseeded caches.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const registration = await navigator.serviceWorker.ready;
    const message = type => new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(new Error("Offline preparation timed out")), 60_000);
      channel.port1.onmessage = ({ data }) => {
        if (data.type === "progress") return;
        clearTimeout(timeout);
        channel.port1.close();
        data.type === "error" ? reject(new Error(data.error)) : resolve(data);
      };
      registration.active.postMessage({ type }, [channel.port2]);
    });
    const complete = await message("PREPARE_OFFLINE_SHELL");
    if (complete.type !== "complete") throw new Error("Shell preparation did not complete");
    const status = await message("OFFLINE_SHELL_STATUS");
    if (!status.ready) throw new Error("Prepared shell is not ready");
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const beforeOffline = await (await request.get("/__test/state")).json();
  const shellResponses = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/manager/operations" || /\/assets\/.*\.(js|css)$/.test(new URL(response.url()).pathname)) {
      shellResponses.push({ url: response.url(), fromServiceWorker: response.fromServiceWorker() });
    }
  });
  try {
    await setDeviceOffline(true); // Everything, including HTML, chunks, maps and API.
    await page.reload({ waitUntil: "domcontentloaded" });
    await reportConnectivity(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page).toHaveURL(new RegExp(`/manager/operations\\?bookingId=${event.bookingId}$`));
    await expect(page.getByRole("heading", { name: "Trip operations" })).toBeVisible();
    await expect(page.locator("header")).toContainText(leg.name);
    await expect(page.getByRole("combobox", { name: "Assigned event", exact: true })).toHaveValue(event.bookingId);
    await expect(page.getByRole("combobox", { name: "Assigned event", exact: true }).locator("option:checked")).toContainText("(saved copy)");
    await expect(card).toContainText("Offline / stale saved copy");
    await expect(card).toContainText("Maps and external directions need a connection");
    await expect(card).toContainText("Last loaded:");
    await expect(card).toContainText(crew.crewLocation.venue);
    await expect(card).toContainText("Crew gate, 12 Festival Road (30.1250, -97.2500)");
    await expect(stop).toContainText("34 Supply Road, Test city, TX");
    await expect(stop).toContainText("Directions destination: 30.25, -97.5");
    await expect(stop).toContainText(crew.crewLocation.stops[0].notes);
    for (const label of ["Rig fit", "Hookups", "Overnight allowed", "Max rig length"]) {
      await expect(stop.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd")).toContainText("Unknown");
    }
    await expect(stop.getByRole("link", { name: "Directions", exact: true })).toHaveAttribute("href", /destination=30.25,-97.5/);
    expect((await snapshots(page))[0]).toEqual(original);
    const offlineState = await (await request.get("/__test/state")).json();
    expect(offlineState.requests).toBe(beforeOffline.requests);
    expect(shellResponses.some(response => response.url.includes("/manager/operations?") && response.fromServiceWorker)).toBe(true);
    expect(shellResponses.some(response => response.url.includes("/assets/") && response.fromServiceWorker)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("fully-offline-crew.jpg"), fullPage: true });

    // A real online event must revalidate identity and assignment and refresh
    // staff notes, rather than continuing to show a stale authorized snapshot.
    await request.put("/__test/state", { data: { crewVersion: 2 } });
    await setDeviceOffline(false);
    await expect.poll(async () => (await (await request.get("/__test/state")).json()).identityReads).toBeGreaterThan(beforeOffline.identityReads);
    await expect.poll(async () => (await (await request.get("/__test/state")).json()).mapReads).toBeGreaterThan(beforeOffline.mapReads);
    await expect(stop).toContainText("Refreshed authorized staff notes");
    await expect(card).not.toContainText("Offline / stale saved copy");
    await expect.poll(async () => (await snapshots(page))[0]?.data.crewLocation.stops[0].notes).toBe("Refreshed authorized staff notes");

    // Revoke while disconnected. Reconnect rechecks authorization, clears IDB
    // and the visible copy; a second full offline reload cannot resurrect it.
    await setDeviceOffline(true);
    await request.put("/__test/state", { data: { revoked: true } });
    await setDeviceOffline(false);
    await expect.poll(async () => (await snapshots(page)).length).toBe(0);
    await expect(stop).not.toBeVisible();
    await expect(page.getByRole("combobox", { name: "Assigned event", exact: true })).not.toBeVisible();
    await setDeviceOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await reportConnectivity(true);
    await expect(page.getByRole("heading", { name: "Trip operations" })).toBeVisible();
    await expect(stop).not.toBeVisible();
    await expect(page.getByRole("combobox", { name: "Assigned event", exact: true })).not.toBeVisible();
    expect(await snapshots(page)).toEqual([]);

    // Session revocation additionally removes the saved identity and token.
    await request.put("/__test/state", { data: { expired: true } });
    await setDeviceOffline(false);
    await expect(page).toHaveURL(/\/manager\/sign-in$/);
    expect(await page.evaluate(() => ({
      identity: localStorage.getItem("az_manager_offline_leg"),
      token: localStorage.getItem("az_manager_token"),
    }))).toEqual({ identity: null, token: null });
    expect(await snapshots(page)).toEqual([]);
    // Public CacheStorage must never contain an authenticated API response.
    const cachedPaths = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(req => new URL(req.url).pathname)))).flat());
    expect(cachedPaths.some(path => path.startsWith("/api/"))).toBe(false);
  } finally {
    await context.setOffline(false);
    await reportConnectivity(false);
    await network.detach();
  }
});
