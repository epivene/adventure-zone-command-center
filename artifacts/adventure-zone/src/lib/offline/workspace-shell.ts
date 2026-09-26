type ShellMessage =
  | { type: "progress"; completed: number; total: number }
  | { type: "complete" }
  | { type: "ready"; ready: boolean }
  | { type: "error"; error: string };

function basePath() { return import.meta.env.BASE_URL.replace(/\/?$/, "/"); }

function supported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof MessageChannel !== "undefined";
}

async function activatedWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) throw new Error("The offline worker could not be started.");
  if (worker.state === "activated") return worker;
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); worker.removeEventListener("statechange", changed); };
    const changed = () => {
      if (worker.state === "activated") { cleanup(); resolve(worker); }
      else if (worker.state === "redundant") { cleanup(); reject(new Error("The offline worker was replaced. Please prepare again.")); }
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("The offline worker did not become ready. Please try again.")); }, 30_000);
    worker.addEventListener("statechange", changed);
    changed();
  });
}

function askWorker(worker: ServiceWorker, command: "PREPARE_OFFLINE_SHELL" | "OFFLINE_SHELL_STATUS", onProgress?: (completed: number, total: number) => void): Promise<ShellMessage> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); };
    const armTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { cleanup(); reject(new Error("Offline preparation stopped responding. Please try again while connected.")); }, command === "PREPARE_OFFLINE_SHELL" ? 120_000 : 5_000);
    };
    channel.port1.onmessage = (event: MessageEvent<ShellMessage>) => {
      const message = event.data;
      if (message?.type === "progress" && command === "PREPARE_OFFLINE_SHELL") {
        armTimeout();
        onProgress?.(message.completed, message.total);
      } else if (message?.type === "error") {
        cleanup(); reject(new Error(message.error));
      } else if ((message?.type === "complete" && command === "PREPARE_OFFLINE_SHELL") || (message?.type === "ready" && command === "OFFLINE_SHELL_STATUS")) {
        cleanup(); resolve(message);
      }
    };
    armTimeout();
    try { worker.postMessage({ type: command }, [channel.port2]); }
    catch (error) { cleanup(); reject(error); }
  });
}

/** Explicitly download and verify the complete public production application. */
export async function prepareOfflineShell(onProgress?: (completed: number, total: number) => void): Promise<void> {
  if (!supported()) throw new Error("Offline preparation is not supported by this browser.");
  const base = basePath();
  const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "none" });
  await askWorker(await activatedWorker(registration), "PREPARE_OFFLINE_SHELL", onProgress);
}

/** Registration alone says nothing about the completeness of browser storage. */
export async function isOfflineShellReady(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const base = basePath();
    const registration = await navigator.serviceWorker.getRegistration(base);
    if (!registration?.active || registration.scope !== new URL(base, window.location.origin).href) return false;
    const response = await askWorker(registration.active, "OFFLINE_SHELL_STATUS");
    return response.type === "ready" && response.ready === true;
  } catch { return false; }
}
