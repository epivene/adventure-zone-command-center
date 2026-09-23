import { useMemo, useState } from "react";
import { FileSignature, FileText, Mail, Search } from "lucide-react";

import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/avz-crm/components/ui/tabs";
import type { DesignTemplate } from "@/lib/design-studio-api";

type TemplateFamily = "email" | "contract" | "proposal";

export function TemplateCatalog({
  templates,
  creatingId,
  onUse,
  compact = false,
}: {
  templates: DesignTemplate[];
  creatingId?: string | null;
  onUse: (template: DesignTemplate) => void;
  compact?: boolean;
}) {
  const [family, setFamily] = useState<TemplateFamily>("email");
  const [search, setSearch] = useState("");

  const active = useMemo(
    () => templates.filter((template) => template.state !== "archived"),
    [templates],
  );
  const counts = useMemo(() => ({
    email: active.filter((template) => template.templateFamily === "email").length,
    contract: active.filter((template) => template.templateFamily === "contract").length,
    proposal: active.filter((template) => template.templateFamily === "proposal").length,
  }), [active]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return active.filter((template) => {
      if (template.templateFamily !== family) return false;
      if (!query) return true;
      return [
        template.name,
        template.description ?? "",
        ...(template.tags ?? []),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [active, family, search]);

  const icon = family === "email"
    ? <Mail className="h-5 w-5" />
    : family === "contract"
      ? <FileSignature className="h-5 w-5" />
      : <FileText className="h-5 w-5" />;

  return (
    <Tabs value={family} onValueChange={(value) => setFamily(value as TemplateFamily)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList aria-label="Template type">
          <TabsTrigger value="email">Emails ({counts.email})</TabsTrigger>
          <TabsTrigger value="contract">Contracts ({counts.contract})</TabsTrigger>
          <TabsTrigger value="proposal">Proposals ({counts.proposal})</TabsTrigger>
        </TabsList>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search templates"
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search current templates"
            value={search}
          />
        </div>
      </div>
      {(["email", "contract", "proposal"] as const).map((tab) => (
        <TabsContent key={tab} value={tab}>
          {visible.length ? (
            <div className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
              {visible.map((template) => (
                <article className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm" key={template.id}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-black text-foreground">{template.name}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {template.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(template.tags ?? []).slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="capitalize">
                        {tag.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    className="mt-4 w-full"
                    disabled={creatingId === template.id}
                    onClick={() => onUse(template)}
                  >
                    {creatingId === template.id ? "Creating draft..." : "Use this template"}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-7 text-center text-sm text-muted-foreground">
              No current {tab} templates match this search.
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
