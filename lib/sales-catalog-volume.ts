/**
 * Resolves a sale-catalog item's shipping volume without applying freight,
 * import charges, exchange rates, or inventory changes.
 * Decimal values are returned as strings so callers don't lose precision.
 */

export type SalesCatalogVolumeInput = {
  altoCm?: number | string | null;
  anchoCm?: number | string | null;
  largoCm?: number | string | null;
  cbm?: number | string | null;
};

type DimensionKey = "altoCm" | "anchoCm" | "largoCm";
type DecimalParse = { kind: "missing" } | { kind: "valid"; digits: bigint; decimals: number } | { kind: "invalid" };

export type SalesCatalogVolumeResult =
  | { status: "missing"; cbm: null }
  | { status: "incomplete"; cbm: null; missing: DimensionKey[] }
  | { status: "invalid"; cbm: null; field: DimensionKey | "cbm" }
  | { status: "known"; cbm: string; source: "dimensions" | "provided"; dimensionsCbm?: string }
  | { status: "conflict"; cbm: null; providedCbm: string; dimensionsCbm: string };

const DIMENSION_KEYS: DimensionKey[] = ["altoCm", "anchoCm", "largoCm"];

function parseDecimal(value: number | string | null | undefined, allowZero = false): DecimalParse {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return { kind: "missing" };
  const raw = typeof value === "number" ? String(value) : value.trim();
  // Avoid locale ambiguity and exponent notation in portable JSON inputs.
  if (raw.length > 48 || !/^\d+(?:\.\d+)?$/.test(raw)) return { kind: "invalid" };
  const [whole, fraction = ""] = raw.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  if (digits < BigInt(0) || (!allowZero && digits === BigInt(0))) return { kind: "invalid" };
  return { kind: "valid", digits, decimals: fraction.length };
}

function decimalString(numerator: bigint, decimalPlaces: number): string {
  const digits = numerator.toString().padStart(decimalPlaces + 1, "0");
  const whole = decimalPlaces ? digits.slice(0, -decimalPlaces) : digits;
  const fraction = decimalPlaces ? digits.slice(-decimalPlaces).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

function parseCbm(value: number | string | null | undefined): { kind: "missing" } | { kind: "valid"; value: string } | { kind: "invalid" } {
  const parsed = parseDecimal(value);
  if (parsed.kind !== "valid") return parsed.kind === "missing" ? parsed : { kind: "invalid" };
  return { kind: "valid", value: decimalString(parsed.digits, parsed.decimals) };
}

/** Calculate m³ exactly from positive centimetre dimensions. */
function calculateDimensionsCbm(dimensions: { digits: bigint; decimals: number }[]): string {
  const numerator = dimensions.reduce((product, dimension) => product * dimension.digits, BigInt(1));
  const decimalPlaces = dimensions.reduce((sum, dimension) => sum + dimension.decimals, 0) + 6;
  return decimalString(numerator, decimalPlaces);
}

/**
 * Explicit CBM is accepted when dimensions are absent. If both are present,
 * they must agree exactly at their supplied precision; conflicts need review.
 */
export function resolveSalesCatalogCbm(input: SalesCatalogVolumeInput): SalesCatalogVolumeResult {
  const dimensionResults = DIMENSION_KEYS.map(key => [key, parseDecimal(input[key])] as const);
  const invalidDimension = dimensionResults.find(([, parsed]) => parsed.kind === "invalid");
  if (invalidDimension) return { status: "invalid", cbm: null, field: invalidDimension[0] };

  const validDimensions = dimensionResults.flatMap(([, parsed]) => parsed.kind === "valid" ? [parsed] : []);
  const missingDimensions = dimensionResults.flatMap(([key, parsed]) => parsed.kind === "missing" ? [key] : []);
  const provided = parseCbm(input.cbm);
  if (provided.kind === "invalid") return { status: "invalid", cbm: null, field: "cbm" };

  if (missingDimensions.length === 3) {
    return provided.kind === "valid"
      ? { status: "known", cbm: provided.value, source: "provided" }
      : { status: "missing", cbm: null };
  }

  if (missingDimensions.length > 0) {
    return { status: "incomplete", cbm: null, missing: missingDimensions };
  }

  const dimensionsCbm = calculateDimensionsCbm(validDimensions);
  if (provided.kind === "valid" && provided.value !== dimensionsCbm) {
    return { status: "conflict", cbm: null, providedCbm: provided.value, dimensionsCbm };
  }
  return {
    status: "known",
    cbm: dimensionsCbm,
    source: "dimensions",
    ...(provided.kind === "valid" ? { dimensionsCbm } : {}),
  };
}

export type SalesCatalogFreightResult =
  | { status: "missing"; freightUsd: null }
  | { status: "invalid"; freightUsd: null; field: "cbm" | "usdPerCbm" }
  | { status: "known"; freightUsd: string };

/** Calculates only CBM × the company's configured USD rate; no default rate is assumed. */
export function calculateSalesCatalogFreightUsd(
  cbm: number | string | null | undefined,
  usdPerCbm: number | string | null | undefined,
): SalesCatalogFreightResult {
  const volume = parseDecimal(cbm);
  if (volume.kind === "invalid") return { status: "invalid", freightUsd: null, field: "cbm" };
  if (volume.kind === "missing") return { status: "missing", freightUsd: null };

  const rate = parseDecimal(usdPerCbm, true);
  if (rate.kind === "invalid") return { status: "invalid", freightUsd: null, field: "usdPerCbm" };
  if (rate.kind === "missing") return { status: "missing", freightUsd: null };

  return { status: "known", freightUsd: decimalString(volume.digits * rate.digits, volume.decimals + rate.decimals) };
}
