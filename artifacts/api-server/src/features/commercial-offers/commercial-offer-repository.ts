import { asc, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { commercialOfferRules } from "@/db/schema";
import type { CommercialOfferInput } from "./commercial-offer-input";

type Database = typeof database;
export type CommercialOfferRecord = typeof commercialOfferRules.$inferSelect;

type CommercialOfferSeedInput = Omit<
  CommercialOfferInput,
  "state" | "appliesToPackageCodes"
> & {
  state: "proposed";
  appliesToPackageCodes: readonly string[];
  sourceDocumentId: string | null;
};

export class CommercialOfferRepository {
  constructor(private readonly database: Database) {}

  listAll(): Promise<CommercialOfferRecord[]> {
    return this.database
      .select()
      .from(commercialOfferRules)
      .orderBy(asc(commercialOfferRules.name));
  }

  async getById(id: string): Promise<CommercialOfferRecord | null> {
    return (
      (
        await this.database
          .select()
          .from(commercialOfferRules)
          .where(eq(commercialOfferRules.id, id))
          .limit(1)
      )[0] ?? null
    );
  }

  async getByCode(code: string): Promise<CommercialOfferRecord | null> {
    return (
      (
        await this.database
          .select()
          .from(commercialOfferRules)
          .where(eq(commercialOfferRules.code, code))
          .limit(1)
      )[0] ?? null
    );
  }

  async seedMissing(values: readonly CommercialOfferSeedInput[]): Promise<void> {
    for (const value of values) {
      await this.database
        .insert(commercialOfferRules)
        .values({
          ...value,
          appliesToPackageCodes: [...value.appliesToPackageCodes],
        })
        .onConflictDoNothing({ target: commercialOfferRules.code });
    }
  }

  async create(
    input: CommercialOfferInput,
    sourceDocumentId: string | null = null,
  ): Promise<CommercialOfferRecord> {
    const [row] = await this.database
      .insert(commercialOfferRules)
      .values({ ...input, sourceDocumentId })
      .returning();
    if (!row) throw new Error("COMMERCIAL_OFFER_CREATE_FAILED");
    return row;
  }

  async update(id: string, input: CommercialOfferInput): Promise<CommercialOfferRecord | null> {
    const [row] = await this.database
      .update(commercialOfferRules)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(commercialOfferRules.id, id))
      .returning();
    return row ?? null;
  }

  async setState(
    id: string,
    state: "proposed" | "active" | "archived",
    actorId: string,
  ): Promise<CommercialOfferRecord | null> {
    const [row] = await this.database
      .update(commercialOfferRules)
      .set({
        state,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(commercialOfferRules.id, id))
      .returning();
    return row ?? null;
  }
}
