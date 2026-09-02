import { useEffect, useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { apiFetch } from "@/lib/auth-token";
export function PrivateAudioPlayer({ voicemailId, available }: { voicemailId: string; available: boolean }) {
  const [url, setUrl] = useState<string | null>(null); const [error, setError] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function play() {
    try {
      const response = await apiFetch(`/calls/voicemail/${encodeURIComponent(voicemailId)}/audio`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next = URL.createObjectURL(await response.blob());
      setUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return next; });
    } catch { setError("Audio could not be loaded. Try again."); }
  }
  if (!available) return <p className="text-sm text-muted-foreground">Audio is not available.</p>;
  return <div className="grid gap-2"><Button onClick={() => void play()} size="sm" type="button" variant="outline">Load private audio</Button>{url ? <audio aria-label="Voicemail audio" controls src={url} /> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}</div>;
}