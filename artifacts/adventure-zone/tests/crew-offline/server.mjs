// Isolated HTTP fixtures, not Playwright route interception: service-worker
// fetches and real browser offline mode must obey the same network boundary.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { crew, event, leg, manager, map } from "./fixtures.mjs";

const root = resolve(fileURLToPath(new URL("../../dist/public/", import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, "offline-shell-manifest.json"), "utf8"));
if (manifest.shell !== "/index.html") throw new Error("Build this regression with BASE_PATH=/.");
let state = { revoked: false, expired: false, identityReads: 0, mapReads: 0, crewReads: 0, requests: 0, crewVersion: 1 };
const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/__test/state") {
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const changes = JSON.parse(body);
        for (const key of ["revoked", "expired", "crewVersion"]) if (key in changes) state[key] = changes[key];
      }
      return json(res, 200, state);
    }
    state.requests++;
    if (path.startsWith("/api/")) {
      if (path === "/api/manager/auth/legs") return json(res, 200, { legs: [leg] });
      if (path === "/api/manager/auth/login") {
        return json(res, 200, { token: "isolated-regression-token", manager });
      }
      if (req.headers.authorization !== "Bearer isolated-regression-token" || state.expired) {
        return json(res, 401, { error: "Session expired" });
      }
      if (path === "/api/manager/auth/me") {
        state.identityReads++;
        return json(res, 200, { manager });
      }
      if (path === "/api/manager/map") {
        state.mapReads++;
        return json(res, 200, { ...map, events: state.revoked ? [] : [event] });
      }
      if (path === `/api/manager/bookings/${event.bookingId}/crew-location`) {
        state.crewReads++;
        if (state.revoked) return json(res, 403, { error: "Event assignment revoked" });
        return json(res, 200, state.crewVersion === 1 ? crew : {
          ...crew, crewLocation: { ...crew.crewLocation, stops: crew.crewLocation.stops.map(stop => ({ ...stop, notes: "Refreshed authorized staff notes" })) },
        });
      }
      if (path === "/api/manager/dashboard") return json(res, 200, { ...map, legId: leg.id, nextEvent: null, currentLifecycle: null, lifecycle: null, incompleteWrapUps: [], wrapUps: [] });
      if (path === "/api/manager/year-end-inspections") return json(res, 200, { inspection: null });
      if (path === "/api/manager/messages/conversations") return json(res, 200, { conversations: [] });
      // Unrelated panels may show their own unavailable state. Never pretend
      // unknown API paths succeeded with a shape the application does not use.
      return json(res, 404, { error: `No fixture for ${path}` });
    }
    const target = resolve(root, `.${decodeURIComponent(path)}`);
    if (!target.startsWith(`${root}/`)) return json(res, 400, { error: "Invalid path" });
    let data;
    try { data = await readFile(target); }
    catch {
      if (extname(path)) return json(res, 404, { error: "Missing static file" });
      data = await readFile(resolve(root, "index.html"));
    }
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? (extname(path) ? "application/octet-stream" : "text/html"), "Cache-Control": "no-store" });
    res.end(data);
  } catch (error) { json(res, 500, { error: error.message }); }
});
server.listen(4179, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit()));
