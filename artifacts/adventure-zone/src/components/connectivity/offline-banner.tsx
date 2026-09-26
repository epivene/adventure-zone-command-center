"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const updateConnection = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    const initialCheck = window.setTimeout(updateConnection, 0);

    if ("serviceWorker" in navigator) {
      const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
      void navigator.serviceWorker
        .register(`${base}sw.js`, {
          scope: base,
          updateViaCache: "none",
        })
        .catch(() => undefined);
    }

    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-bold text-amber-950 shadow-sm"
      role="status"
    >
      Offline. <a className="underline underline-offset-2" href={`${import.meta.env.BASE_URL.replace(/\/?$/, "/")}assistant/offline`}>Open saved records and local drafts</a>
    </div>
  );
}
