import { useCallback, useEffect, useState } from "react";

const preferenceKey = "az-assistant-workspace-layout";
const coarseQuery = "(pointer: coarse)";
const resultsQuery = "(min-width: 1280px)";
const historyQuery = "(min-width: 1536px)";
type Preference = "focused" | "expanded" | null;

function readPreference(): Preference {
  try {
    const value = window.localStorage.getItem(preferenceKey);
    return value === "focused" || value === "expanded" ? value : null;
  } catch {
    return null;
  }
}

function readViewport() {
  const matches = (query: string) =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches;
  return {
    coarse: matches(coarseQuery),
    resultsWide: matches(resultsQuery),
    historyWide: matches(historyQuery),
  };
}

/** Keep the grid, panel presentation and panel controls on one layout decision. */
export function useWorkspaceLayout() {
  const [preference, setPreference] = useState<Preference>(readPreference);
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const queries = [coarseQuery, resultsQuery, historyQuery].map((query) =>
      window.matchMedia(query),
    );
    const update = () =>
      setViewport({
        coarse: queries[0].matches,
        resultsWide: queries[1].matches,
        historyWide: queries[2].matches,
      });
    update();
    for (const query of queries) query.addEventListener("change", update);
    return () => {
      for (const query of queries) query.removeEventListener("change", update);
    };
  }, []);

  const focused =
    preference === "focused" || (preference === null && viewport.coarse);
  const setFocused = useCallback((next: boolean) => {
    const value = next ? "focused" : "expanded";
    setPreference(value);
    try {
      window.localStorage.setItem(preferenceKey, value);
    } catch {
      // The current choice still works when browser storage is unavailable.
    }
  }, []);
  return {
    focused,
    setFocused,
    historyInline: !focused && viewport.historyWide,
    resultsInline: !focused && viewport.resultsWide,
  };
}
