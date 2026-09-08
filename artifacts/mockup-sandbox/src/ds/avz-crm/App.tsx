import { useEffect, useState, type ComponentType } from "react";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

const modules = import.meta.glob("./mockups/**/*.tsx") as ModuleMap;

function resolveComponent(mod: Record<string, unknown>, name: string) {
  const functions = Object.values(mod).filter(
    (value) => typeof value === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    functions[functions.length - 1]
  );
}

function previewPath() {
  const path = window.location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
  return path || null;
}

export default function App() {
  const [path, setPath] = useState(previewPath());
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setPath(previewPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const loader = modules[`./mockups/${path}.tsx`];
    setComponent(null);
    setError(null);
    if (!loader) {
      setError(`No component found at ${path}.tsx`);
      return;
    }
    void loader()
      .then((mod) => {
        if (cancelled) return;
        const component = resolveComponent(mod, path.split("/").pop()!);
        if (component) setComponent(() => component);
        else setError(`No exported React component found in ${path}.tsx`);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <pre className="p-8 text-destructive">{error}</pre>;
  if (Component) return <Component />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center">
      <div>
        <h1 className="text-2xl font-bold">Avz CRM mockups</h1>
        <p className="mt-2 text-muted-foreground">Choose a component preview in the URL hash.</p>
      </div>
    </div>
  );
}