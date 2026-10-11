import { z } from "zod";

/** Shared AL persistence contract. No tariff/discount calculation lives here.
 * Nullable legacy terms must never be populated by reading live inventory.
 * API owners merge patches into persisted terms before validating the result.
 */
export const commercialMoneySchema = z.number().int().min(0).max(2_147_483_647);
export const commercialBpsSchema = z.number().int().min(0).max(10_000);
export const budgetDiscountModeSchema = z.enum(["AMOUNT", "PERCENT"]);
export const budgetPriceModeSchema = z.enum(["TARIFF", "MANUAL"]);
export const budgetTariffSnapshotSchema = z.object({
  version: z.literal(1),
  front: z.enum(["FINAL", "WHOLESALE"]),
  normalPrice: commercialMoneySchema,
  fromDays: z.number().int().min(0).max(9_999),
  fromPrice: commercialMoneySchema,
  minimumPrice: commercialMoneySchema,
}).strict();
export type BudgetTariffSnapshot = z.infer<typeof budgetTariffSnapshotSchema>;

const discountShape = {
  discountMode: budgetDiscountModeSchema.nullable(),
  discountValue: commercialMoneySchema.nullable(),
};
function validateDiscount(value: { discountMode?: "AMOUNT" | "PERCENT" | null; discountValue?: number | null }, context: z.RefinementCtx) {
  // On patches, omission is preservation; explicit mode/value changes are paired.
  if ((value.discountMode === undefined) !== (value.discountValue === undefined)) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Enviá modalidad y valor del descuento juntos." });
  } else if ((value.discountMode == null) !== (value.discountValue == null)) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Modalidad y valor deben ser ambos nulos o ambos explícitos." });
  } else if (value.discountMode === "PERCENT" && !commercialBpsSchema.safeParse(value.discountValue).success) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "El porcentaje debe ser entero entre 0 y 10000 basis points." });
  }
}
const itemShape = {
  priceMode: budgetPriceModeSchema.nullable(),
  tariffSnapshot: budgetTariffSnapshotSchema.nullable(),
  ...discountShape,
};
export const budgetItemCommercialInputSchema = z.object(itemShape).strict().partial().superRefine(validateDiscount);
export const budgetCommercialInputSchema = z.object({
  ...discountShape,
  advancePercentBps: commercialBpsSchema.nullable(),
}).strict().partial().superRefine(validateDiscount);
export const budgetCommercialTermsSchema = z.object({
  ...discountShape,
  advancePercentBps: commercialBpsSchema.nullable(),
}).strict().superRefine(validateDiscount);
export const budgetItemCommercialTermsSchema = z.object({
  ...itemShape,
  discountAmount: commercialMoneySchema.nullable(),
}).strict().superRefine((value, context) => {
  validateDiscount(value, context);
  if (value.priceMode === "TARIFF" && value.tariffSnapshot === null) {
    context.addIssue({ code: "custom", path: ["tariffSnapshot"], message: "La tarifa requiere snapshot del frente efectivo." });
  }
  if (value.priceMode === null && value.tariffSnapshot !== null) {
    context.addIssue({ code: "custom", path: ["priceMode"], message: "Un snapshot nuevo requiere modalidad explícita." });
  }
  if ((value.discountMode === null) !== (value.discountAmount === null)) {
    context.addIssue({ code: "custom", path: ["discountAmount"], message: "El descuento explícito requiere importe efectivo materializado." });
  }
});
export type BudgetItemCommercialTerms = z.infer<typeof budgetItemCommercialTermsSchema>;
export type BudgetCommercialTerms = z.infer<typeof budgetCommercialTermsSchema>;

/** No costs or opposite-front values can cross this projection. MANUAL retains
 * its binding floor, but has no automatic tariff-day preview.
 */
export function publicBudgetItemCommercialTerms(input: BudgetItemCommercialTerms) {
  const terms = budgetItemCommercialTermsSchema.parse(input);
  return {
    priceMode: terms.priceMode,
    tariffSnapshot: terms.priceMode === "TARIFF" ? terms.tariffSnapshot : null,
    minimumPrice: terms.tariffSnapshot?.minimumPrice ?? null,
    discountMode: terms.discountMode,
    discountValue: terms.discountValue,
    discountAmount: terms.discountAmount,
  };
}

/** Snapshot/floor retention guard for an existing line. Admin APIs must copy
 * the snapshot from same-org inventory and call this under the commercial lock;
 * public proposals cannot select priceMode/front/snapshot themselves.
 */
export function budgetTariffSnapshotRetentionError(previous: BudgetItemCommercialTerms, next: BudgetItemCommercialTerms): string | null {
  if (previous.tariffSnapshot && (!next.tariffSnapshot || next.tariffSnapshot.minimumPrice < previous.tariffSnapshot.minimumPrice)) {
    return "No se puede eliminar o reducir el piso vinculado mediante un cambio de modalidad. Usá una revisión comercial explícita.";
  }
  return null;
}
