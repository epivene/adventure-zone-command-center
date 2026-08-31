import { X } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  assetImageUrl,
  isImageAsset,
  type DesignAsset,
} from "@/lib/design-studio-api";
import { STARTER_PHOTO_LIBRARY } from "@/lib/design-studio/canva-starters";

export type PickerAsset = DesignAsset & { builtin?: boolean };

function builtInAssets(): PickerAsset[] {
  return STARTER_PHOTO_LIBRARY.map((photo) => ({
    id: photo.id,
    name: photo.name,
    scope: "company",
    mimeType: photo.url.includes(".png") ? "image/png" : "image/jpeg",
    altText: photo.name,
    url: photo.url,
    builtin: true,
  }));
}

export function AssetPickerSheet({
  assets,
  onChoose,
  onClose,
}: {
  assets: DesignAsset[];
  onChoose: (asset: PickerAsset) => void;
  onClose: () => void;
}) {
  const allAssets = [
    ...builtInAssets(),
    ...assets.filter(isImageAsset).map((asset) => ({ ...asset, builtin: false })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45" role="dialog" aria-modal="true" aria-label="Choose Adventure Zone photo">
      <div className="max-h-[78dvh] w-full overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-primary">Adventure Zone library</p>
            <h2 className="text-lg font-black">Choose a photo</h2>
          </div>
          <Button aria-label="Close photo picker" onClick={onClose} size="icon" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>

        <div className="grid max-h-[65dvh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4">
          {allAssets.map((asset) => {
            const src = assetImageUrl(asset);
            return (
              <button
                key={`${asset.builtin ? "builtin" : "asset"}-${asset.id}`}
                aria-label={`Use ${asset.name}`}
                className="overflow-hidden rounded-xl border border-border bg-background text-left transition hover:border-primary hover:shadow-md"
                onClick={() => onChoose(asset)}
                type="button"
              >
                <div className="aspect-[4/3] bg-muted">
                  {src ? <img alt={asset.altText ?? asset.name} className="h-full w-full object-cover" src={src} /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">Preview unavailable</div>}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-bold">{asset.name}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{asset.builtin ? "Built in" : "Brand library"}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
