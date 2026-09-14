import { useState } from "react";

export function EmailBuilderPreview({ html }: { html: string }) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  return <section className="grid gap-2 rounded-xl border bg-white p-3" aria-label="Live email preview">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Live email preview</h3><p className="text-xs text-slate-500">See how the finished HTML email will look.</p></div><div className="flex overflow-hidden rounded-lg border"><button type="button" className="min-h-11 px-3 text-sm" aria-label="Desktop preview" aria-pressed={mode === "desktop"} onClick={() => setMode("desktop")}>Desktop</button><button type="button" className="min-h-11 border-l px-3 text-sm" aria-label="Mobile preview" aria-pressed={mode === "mobile"} onClick={() => setMode("mobile")}>Mobile</button></div></div>
    <div className="max-h-[44rem] overflow-auto bg-slate-100 p-2"><iframe title="Compiled email preview" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={html} className="mx-auto block min-h-[38rem] border-0 bg-white transition-[width]" style={{ width: mode === "mobile" ? 390 : 700, maxWidth: "100%" }} /></div>
  </section>;
}
