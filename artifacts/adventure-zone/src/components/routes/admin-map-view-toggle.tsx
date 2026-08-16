export type AdminMapView = "admin" | "manager-preview";

export function AdminMapViewToggle({ view, onChange }: { view: AdminMapView; onChange: (view: AdminMapView) => void }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Map view">
      <button type="button" aria-pressed={view === "admin"} className={view === "admin" ? "button-primary" : "button-secondary"} onClick={() => onChange("admin")}>Admin view</button>
      <button type="button" aria-pressed={view === "manager-preview"} className={view === "manager-preview" ? "button-primary" : "button-secondary"} onClick={() => onChange("manager-preview")}>Manager preview</button>
    </div>
  );
}
