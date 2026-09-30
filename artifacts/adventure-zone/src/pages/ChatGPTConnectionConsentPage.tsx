import { useEffect, useState } from "react";
import { connectionRequest } from "@/features/chatgpt-connection/client";
export default function ChatGPTConnectionConsentPage() {
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const uid = new URLSearchParams(window.location.search).get("interaction");
    if (!uid) {
      setError("Missing connection request. Start again from ChatGPT.");
      return;
    }
    void connectionRequest()
      .then((settings) => {
        const api = new URL(settings.endpoint);
        if (api.protocol !== "https:") throw Error("Invalid connection host");
        setTarget(
          `${api.origin}/chatgpt-connection/consent?interaction=${encodeURIComponent(uid)}`,
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="mx-auto grid w-full max-w-xl gap-5 p-4">
      <h1 className="text-2xl font-semibold">
        Authorize Command Center access
      </h1>
      <p>
        Continue on the Command Center API host to sign in and review
        permissions.
      </p>
      {error && <p role="alert">{error}</p>}
      {target && (
        <a className="underline" href={target} referrerPolicy="no-referrer">
          Continue to secure consent
        </a>
      )}
    </main>
  );
}
