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
      void navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
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
      Offline — changes are drafts until reconnected
    </div>
  );
}
