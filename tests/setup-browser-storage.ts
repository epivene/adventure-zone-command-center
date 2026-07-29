const browserWindow = (
  globalThis as typeof globalThis & { jsdom: { window: Window } }
).jsdom.window;

for (const storageName of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, storageName, {
    configurable: true,
    get: () => browserWindow[storageName],
  });
}
