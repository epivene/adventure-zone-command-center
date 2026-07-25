"use server";

import { revalidatePath } from "next/cache";

import {
  TravelLegService,
} from "@/features/routes/travel-leg-editor";
import {
  travelLegConfigurationSchema,
  type TravelLegConfiguration,
} from "@/features/routes/travel-leg-input";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export type TravelLegActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateTravelLegsAction(
  input: TravelLegConfiguration,
): Promise<TravelLegActionResult> {
  await requireOwner();
  const parsed = travelLegConfigurationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review all four travel-leg names and colors." };
  }

  const { db } = await import("@/db/client");
  const result = await new TravelLegService(
    new DrizzleTravelLegRepository(db),
  ).updateConfiguration(parsed.data);
  if (!result.ok) {
    return {
      ok: false,
      error: "Travel-leg records changed. Refresh before editing them again.",
    };
  }

  revalidatePath("/routes");
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  return { ok: true };
}
