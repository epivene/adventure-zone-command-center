"use server";

import { revalidatePath } from "next/cache";

import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import {
  submitQuickCaller,
  type QuickCallerActionResult,
  type QuickCallerFormInput,
} from "@/features/contacts/quick-caller-service";
import { requireOwner } from "@/lib/auth/require-owner";

export async function createQuickCallerAction(
  input: QuickCallerFormInput,
): Promise<QuickCallerActionResult> {
  await requireOwner();
  const { db } = await import("@/db/client");
  const result = await submitQuickCaller(
    input,
    new DrizzleContactRepository(db),
  );
  if (!result.ok) return result;
  revalidatePath("/contacts");
  revalidatePath("/organizations");
  return result;
}
