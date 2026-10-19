import { z } from "zod";
import { resolveSalesCatalogCbm, type SalesCatalogVolumeInput } from "./sales-catalog-volume";

const decimalPattern = /^\d+(?:\.\d+)?$/;
const decimalInputSchema = z.union([
  z.string().trim().max(48).regex(decimalPattern, "Usá un decimal no negativo con punto."),
  z.number().finite().nonnegative().refine((value) => decimalPattern.test(String(value)), "Usá un decimal sin notación exponencial."),
]).nullable();

const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/, "Usá un código ISO 4217 de tres letras.");

const moneyComponentSchema = z.object({
  amount: decimalInputSchema,
  currency: currencySchema,
  /** PYG por unidad de moneda. Para PYG puede omitirse o informarse 1. */
  pygPerCurrency: decimalInputSchema,
}).strict().superRefine((component, context) => {
  if (component.currency === "PYG" && component.pygPerCurrency !== null && String(component.pygPerCurrency) !== "1") {
    context.addIssue({ code: "custom", path: ["pygPerCurrency"], message: "Para PYG, el cambio debe ser 1 o null." });
  }
  if (component.currency !== "PYG" && component.amount !== null && component.pygPerCurrency === null) {
    context.addIssue({ code: "custom", path: ["pygPerCurrency"], message: "Informá el cambio PYG por unidad de moneda para convertir este costo." });
  }
  if (component.currency !== "PYG" && component.pygPerCurrency !== null && Number(component.pygPerCurrency) <= 0) {
    context.addIssue({ code: "custom", path: ["pygPerCurrency"], message: "El cambio PYG por unidad de moneda debe ser mayor que cero." });
  }
});

/**
 * Structured, non-persistent input for reviewing unit acquisition cost.
 * Null means unknown; zero must be entered explicitly when confirmed.
 */
export const salesCatalogCostingInputSchema = z.object({
  purchaseCost: moneyComponentSchema,
  transportToChinaPort: moneyComponentSchema,
  otherCosts: z.array(moneyComponentSchema).max(100),
  volume: z.object({
    altoCm: decimalInputSchema,
    anchoCm: decimalInputSchema,
    largoCm: decimalInputSchema,
    cbm: decimalInputSchema,
  }).strict(),
  freight: z.object({
    usdPerCbm: decimalInputSchema,
    pygPerUsd: decimalInputSchema,
  }).strict().superRefine((freight, context) => {
    if (freight.pygPerUsd !== null && Number(freight.pygPerUsd) <= 0) {
      context.addIssue({ code: "custom", path: ["pygPerUsd"], message: "El cambio PYG por USD debe ser mayor que cero." });
    }
  }),
  importation: z.object({
    percent: decimalInputSchema,
    /** Explicitly selected taxable basis in PYG; no CIF/customs basis is inferred. */
    basisPyg: decimalInputSchema,
  }).strict(),
}).strict();

export type SalesCatalogCostingInput = z.infer<typeof salesCatalogCostingInputSchema>;

type Decimal = { digits: bigint; scale: number };

function decimal(value: number | string | null | undefined): Decimal | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const raw = String(value).trim();
  if (!decimalPattern.test(raw) || raw.length > 48) return null;
  const [whole, fraction = ""] = raw.split(".");
  return normalize({ digits: BigInt(`${whole}${fraction}`), scale: fraction.length });
}

function normalize(value: Decimal): Decimal {
  let { digits, scale } = value;
  while (scale > 0 && digits % BigInt(10) === BigInt(0)) {
    digits /= BigInt(10);
    scale -= 1;
  }
  return { digits, scale };
}

function decimalString(value: Decimal): string {
  const digits = value.digits.toString().padStart(value.scale + 1, "0");
  if (value.scale === 0) return digits;
  const whole = digits.slice(0, -value.scale);
  const fraction = digits.slice(-value.scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function add(values: Decimal[]): Decimal {
  const scale = Math.max(0, ...values.map((value) => value.scale));
  const digits = values.reduce((sum, value) => sum + value.digits * (BigInt(10) ** BigInt(scale - value.scale)), BigInt(0));
  return normalize({ digits, scale });
}

function multiply(left: Decimal, right: Decimal): Decimal {
  return normalize({ digits: left.digits * right.digits, scale: left.scale + right.scale });
}

function toPyg(component: SalesCatalogCostingInput["purchaseCost"]): Decimal | null {
  const amount = decimal(component.amount);
  if (!amount) return null;
  if (component.currency === "PYG") return amount;
  const rate = decimal(component.pygPerCurrency);
  return rate ? multiply(amount, rate) : null;
}

function percentOf(base: Decimal, percent: Decimal): Decimal {
  return normalize({ digits: base.digits * percent.digits, scale: base.scale + percent.scale + 2 });
}

function ceilPyg(value: Decimal): string {
  if (value.scale === 0) return value.digits.toString();
  const divisor = BigInt(10) ** BigInt(value.scale);
  const quotient = value.digits / divisor;
  return (value.digits % divisor === BigInt(0) ? quotient : quotient + BigInt(1)).toString();
}

export type SalesCatalogPriceSuggestions = {
  margin20: string;
  margin30: string;
  margin40: string;
  margin50: string;
  custom: (marginPercent: number | string) => string | null;
};

/**
 * Suggest a PYG unit price for a gross margin on the sale price (not markup).
 * It rounds upward to a whole PYG so the suggested margin is never rounded down.
 */
export function suggestSalesCatalogPricePyg(costPyg: number | string | null | undefined, marginPercent: number | string): string | null {
  const cost = decimal(costPyg);
  const margin = decimal(marginPercent);
  if (!cost || !margin || margin.digits >= BigInt(100) * (BigInt(10) ** BigInt(margin.scale))) return null;
  const numerator = cost.digits * BigInt(100) * (BigInt(10) ** BigInt(margin.scale));
  const denominator = (BigInt(100) * (BigInt(10) ** BigInt(margin.scale)) - margin.digits) * (BigInt(10) ** BigInt(cost.scale));
  if (denominator <= BigInt(0)) return null;
  const quotient = numerator / denominator;
  return (numerator % denominator === BigInt(0) ? quotient : quotient + BigInt(1)).toString();
}

export function salesCatalogPriceSuggestions(costPyg: number | string): SalesCatalogPriceSuggestions {
  return {
    margin20: suggestSalesCatalogPricePyg(costPyg, "20")!,
    margin30: suggestSalesCatalogPricePyg(costPyg, "30")!,
    margin40: suggestSalesCatalogPricePyg(costPyg, "40")!,
    margin50: suggestSalesCatalogPricePyg(costPyg, "50")!,
    custom: (marginPercent) => suggestSalesCatalogPricePyg(costPyg, marginPercent),
  };
}

export type SalesCatalogCostingResult =
  | { status: "invalid"; field: string }
  | { status: "incomplete"; missing: string[]; knownComponentsPyg: Record<string, string> }
  | { status: "complete"; cbm: string; freightUsd: string; freightPyg: string; importationPyg: string; landedCostPyg: string; priceSuggestions: SalesCatalogPriceSuggestions };

/**
 * Calculates a preview only. Importation is a configured percentage of an
 * explicitly supplied basis; this function does not guess customs law, CIF,
 * taxes, exchange rates, cost allocations, or persist anything.
 */
export function calculateSalesCatalogCosting(input: SalesCatalogCostingInput): SalesCatalogCostingResult {
  const validated = salesCatalogCostingInputSchema.safeParse(input);
  if (!validated.success) {
    return { status: "invalid", field: validated.error.issues[0]?.path.join(".") || "input" };
  }
  input = validated.data;
  const volume = resolveSalesCatalogCbm(input.volume as SalesCatalogVolumeInput);
  if (volume.status === "invalid") return { status: "invalid", field: volume.field };
  if (volume.status === "conflict") return { status: "invalid", field: "volume.cbm" };

  const missing: string[] = [];
  const known: Record<string, Decimal> = {};
  const purchase = toPyg(input.purchaseCost);
  const transport = toPyg(input.transportToChinaPort);
  if (!purchase) missing.push("purchaseCost"); else known.purchaseCostPyg = purchase;
  if (!transport) missing.push("transportToChinaPort"); else known.transportToChinaPortPyg = transport;

  input.otherCosts.forEach((component, index) => {
    const amount = toPyg(component);
    if (!amount) missing.push(`otherCosts.${index}`);
    else known[`otherCost${index + 1}Pyg`] = amount;
  });

  if (volume.status !== "known") missing.push("volume.cbm");
  const freightRate = decimal(input.freight.usdPerCbm);
  const pygPerUsd = decimal(input.freight.pygPerUsd);
  if (!freightRate) missing.push("freight.usdPerCbm");
  if (!pygPerUsd) missing.push("freight.pygPerUsd");

  let freightUsd: Decimal | null = null;
  let freightPyg: Decimal | null = null;
  if (volume.status === "known" && freightRate && pygPerUsd) {
    const cbm = decimal(volume.cbm);
    if (!cbm) return { status: "invalid", field: "volume.cbm" };
    freightUsd = multiply(cbm, freightRate);
    freightPyg = multiply(freightUsd, pygPerUsd);
    known.freightPyg = freightPyg;
  }

  const importPercent = decimal(input.importation.percent);
  const importBasis = decimal(input.importation.basisPyg);
  if (!importPercent) missing.push("importation.percent");
  if (!importBasis) missing.push("importation.basisPyg");
  let importationPyg: Decimal | null = null;
  if (importPercent && importBasis) {
    importationPyg = percentOf(importBasis, importPercent);
    known.importationPyg = importationPyg;
  }

  if (missing.length) {
    return { status: "incomplete", missing, knownComponentsPyg: Object.fromEntries(Object.entries(known).map(([key, value]) => [key, decimalString(value)])) };
  }

  if (volume.status !== "known" || !freightRate || !pygPerUsd || !freightUsd || !freightPyg || !importPercent || !importBasis || !importationPyg) {
    return { status: "invalid", field: "costing" };
  }
  const landedCost = add(Object.values(known));

  return {
    status: "complete",
    cbm: volume.cbm,
    freightUsd: decimalString(freightUsd),
    freightPyg: decimalString(freightPyg),
    importationPyg: decimalString(importationPyg),
    landedCostPyg: decimalString(landedCost),
    priceSuggestions: salesCatalogPriceSuggestions(decimalString(landedCost)),
  };
}

export function parseSalesCatalogCostingInput(input: unknown) {
  return salesCatalogCostingInputSchema.safeParse(input);
}
