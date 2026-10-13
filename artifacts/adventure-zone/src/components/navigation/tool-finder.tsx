import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { cn } from "@workspace/avz-crm/lib/utils";

export type ToolFinderItem = {
  href: string;
  label: string;
  category?: string;
  keywords?: string[];
};

export function ToolFinder({ items, variant = "sidebar" }: {
  items: ToolFinderItem[];
  variant?: "sidebar" | "menu";
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const [, setLocation] = useLocation();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    const uniqueItems = [...new Map(items.map(item => [item.href, item])).values()];
    return uniqueItems
      .map(item => {
        const label = item.label.toLocaleLowerCase();
        const searchable = [item.label, item.href, item.category, ...(item.keywords ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        const score = label.startsWith(normalizedQuery) ? 0 : label.includes(normalizedQuery) ? 1 : 2;
        return { item, searchable, score };
      })
      .filter(result => result.searchable.includes(normalizedQuery))
      .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
      .slice(0, 8)
      .map(result => result.item);
  }, [items, normalizedQuery]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  function navigateTo(item: ToolFinderItem) {
    setQuery("");
    setFocused(false);
    setActiveIndex(-1);
    setLocation(item.href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActiveIndex(current => current < 0 ? 0 : (current + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex(current => current < 0 ? results.length - 1 : (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && results.length) {
      event.preventDefault();
      navigateTo(results[activeIndex] ?? results[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFocused(false);
      setActiveIndex(-1);
    }
  }

  const showResults = focused && normalizedQuery.length > 0;
  const listboxId = `${inputId}-results`;

  return (
    <div className={cn("relative min-w-0", variant === "menu" && "w-full")} ref={rootRef}>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={inputId}
          type="search"
          aria-label="Search pages and tools"
          aria-autocomplete="list"
          aria-controls={showResults ? listboxId : undefined}
          aria-expanded={showResults}
          aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          className="h-10 bg-background pl-9 text-sm"
          data-testid={`tool-finder-input-${variant}`}
          onChange={event => { setQuery(event.target.value); setActiveIndex(-1); }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search pages and tools"
          value={query}
        />
      </div>
      {showResults ? (
        <div className={cn(
          "z-50 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
          variant === "menu" ? "mt-2 w-full" : "absolute left-0 right-0 top-full mt-2",
        )}>
          {results.length ? (
            <ul aria-label="Search results" className="grid max-h-72 gap-0.5 overflow-y-auto" id={listboxId} role="listbox">
              {results.map((item, index) => (
                <li
                  aria-selected={activeIndex === index}
                  className="rounded-sm text-sm"
                  id={`${listboxId}-${index}`}
                  key={`${item.href}:${item.label}`}
                  role="option"
                >
                  <Link
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-3 rounded-sm px-2.5 py-2 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                      activeIndex === index && "bg-accent text-accent-foreground",
                    )}
                    data-testid={`tool-finder-result-${item.href.replaceAll(/[^a-z0-9]+/gi, "-")}`}
                    href={item.href}
                    onClick={() => { setQuery(""); setFocused(false); setActiveIndex(-1); }}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.category ? <span className="shrink-0 text-xs text-muted-foreground">{item.category}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-3 text-sm text-muted-foreground" role="status">No matching pages or tools.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
