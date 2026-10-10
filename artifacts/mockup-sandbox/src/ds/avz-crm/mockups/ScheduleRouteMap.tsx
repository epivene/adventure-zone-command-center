import { useState } from "react";
import { MapPinned } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import type { CrmWorkItem } from "./WholeCrmRouteScreens";

const availableLegs = ["North Route", "Central Circuit", "Coastal Loop"];

export function ScheduleRouteMap({
  workItems,
  assignedLegs,
}: {
  workItems: CrmWorkItem[];
  assignedLegs: Record<string, string>;
}) {
  const [activeLeg, setActiveLeg] = useState(availableLegs[0]!);
  const routeItems = workItems.filter(
    (item) => assignedLegs[item.id] === activeLeg || item.suggestedLeg === activeLeg,
  );
  const plottedItems = routeItems.map((item, index) => ({
    item,
    x: routeItems.length === 1 ? 360 : 96 + (index * 528) / (routeItems.length - 1),
    y: index % 2 === 0 ? 94 : 202,
    assigned: assignedLegs[item.id] === activeLeg,
    suggested: item.suggestedLeg === activeLeg,
  }));
  const routePoints = plottedItems.map(({ x, y }) => `${x},${y}`).join(" ");
  const assignedCount = plottedItems.filter((item) => item.assigned).length;
  const suggestedCount = plottedItems.filter((item) => item.suggested).length;

  return (
    <Card>
      <CardHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPinned className="h-5 w-5 text-primary" />
              Schedule route map
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              See saved event locations beside the existing assignment and suggested leg.
            </p>
          </div>
          <Select onValueChange={setActiveLeg} value={activeLeg}>
            <SelectTrigger aria-label="Choose a route to view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableLegs.map((leg) => (
                <SelectItem key={leg} value={leg}>{leg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Boss · {assignedCount} current assignment{assignedCount === 1 ? "" : "s"}</Badge>
          <Badge variant="secondary">Des · {suggestedCount} suggested leg{suggestedCount === 1 ? "" : "s"}</Badge>
          <Badge variant="outline">Schematic · not to scale</Badge>
        </div>
        {plottedItems.length ? (
          <figure className="grid gap-2">
            <div className="overflow-hidden rounded-lg bg-muted p-2 sm:p-4">
              <svg
                aria-label={`${activeLeg} event stops: ${plottedItems.map(({ item }) => `${item.event}, ${item.city}, ${item.state}`).join("; ")}`}
                className="h-56 w-full sm:h-64"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                viewBox="0 0 720 280"
              >
                <title>{activeLeg} route overview, schematic only</title>
                <path className="fill-none stroke-border" d="M20 244 C132 202 164 224 256 181 S394 114 490 142 S623 146 700 84" strokeWidth="5" />
                <path className="fill-none stroke-border" d="M42 56 C145 110 194 64 275 119 S411 208 505 177 S625 77 690 220" strokeWidth="3" strokeDasharray="10 10" />
                <path className="fill-none stroke-border" d="M114 20 C152 82 132 138 194 269 M518 20 C478 81 568 163 538 265" strokeWidth="2" />
                {plottedItems.length > 1 ? (
                  <polyline className="fill-none stroke-primary" points={routePoints} strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
                ) : null}
                {plottedItems.map(({ item, x, y, assigned, suggested }) => (
                  <g key={item.id}>
                    <circle
                      className={assigned ? "fill-primary stroke-background" : "fill-background stroke-primary"}
                      cx={x}
                      cy={y}
                      r="17"
                      strokeWidth="4"
                    />
                    <circle className={assigned ? "fill-primary-foreground" : "fill-primary"} cx={x} cy={y} r="5" />
                    <text className="fill-foreground text-xs font-semibold" textAnchor="middle" x={x} y={y + 34}>
                      {item.city}, {item.state}
                    </text>
                    <text className="fill-muted-foreground text-xs" textAnchor="middle" x={x} y={y + 49}>
                      {assigned && suggested ? "Assigned + suggested" : assigned ? "Currently assigned" : "Suggested"}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <figcaption className="text-xs text-muted-foreground">
              Illustrative stop sequence only—not a verified driving route, distance, or turn-by-turn map. Event dates and locations remain the source of record.
            </figcaption>
          </figure>
        ) : (
          <div className="rounded-lg border border-border bg-muted p-4">
            <p className="font-semibold">No event stops on {activeLeg} yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Choose a route with saved assignments or planning suggestions to see its event locations.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
