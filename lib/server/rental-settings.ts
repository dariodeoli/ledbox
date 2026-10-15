import { randomUUID } from "node:crypto";
import type { OrganizationRentalSettings, Prisma } from "@prisma/client";
import type { AdminRentalSettings } from "../admin-types";
import { securityDepositAmountValid } from "../budget-security-deposit";
import {
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_DAMAGE_PERCENT,
  DEFAULT_LATE_FEE,
  CUSTOM_CHARGE_UNITS,
  cancellationPolicyOf,
  isDepositCalc,
  isDepositMode,
  isDepositPurpose,
  isLateFeeKind,
  isLateFeeUnit,
  parseCancellationPolicy,
  type CustomChargeType,
  type DepositRule,
} from "../rental-charges";
import { isTrashPurgeDays } from "../trash-shared";
import { isCatalogAccessMode } from "../catalog-access-mode";
import { parseStorefrontAccent } from "../storefront-theme";
import { BUDGET_INT_MAX } from "../budget-payment-plan";
import { db } from "./db";
import { DEFAULT_HOLD_TTL_MINUTES } from "./inventory-availability";

/**
 * Ajustes de alquiler por empresa (fase 2b). Una fila por empresa; sin fila rigen
 * los valores por defecto (sin política de seña, retención de 48 h, sin tiempos).
 * Los tiempos y la vigencia se guardan en minutos; la UI los muestra en horas.
 */

export type RentalSettingsView = AdminRentalSettings;

export const RENTAL_SETTINGS_DEFAULTS: RentalSettingsView = {
  depositPercent: null,
  securityDepositDefault: null,
  securityDepositMode: "NONE",
  securityDepositPurpose: "DAMAGES",
  securityDepositCalc: "FIXED",
  securityDepositPercent: null,
  securityDepositRules: [],
  lateFeeKind: DEFAULT_LATE_FEE.kind,
  lateFeeUnit: DEFAULT_LATE_FEE.unit,
  lateFeeValue: DEFAULT_LATE_FEE.value,
  lateGraceMinutes: DEFAULT_LATE_FEE.graceMinutes,
  damageChargePercent: DEFAULT_DAMAGE_PERCENT,
  customCharges: [],
  cancellationPolicy: DEFAULT_CANCELLATION_POLICY.map((tier) => ({ ...tier })),
  rentalTerms: null,
  holdTtlMinutes: DEFAULT_HOLD_TTL_MINUTES,
  deliveryBufferMin: 0,
  returnBufferMin: 0,
  prepBufferMin: 0,
  transportBufferMin: 0,
  cleaningBufferMin: 0,
  publicCatalogEnabled: false,
  publicShowPrices: true,
  whatsappPhone: null,
  storefrontTagline: null,
  storefrontAccent: null,
  storefrontEmail: null,
  catalogAccessMode: "OPEN",
  trashPurgeDays: null,
};

const BUFFER_KEYS = ["deliveryBufferMin", "returnBufferMin", "prepBufferMin", "transportBufferMin", "cleaningBufferMin"] as const;
const BUFFER_LABELS: Record<(typeof BUFFER_KEYS)[number], string> = {
  deliveryBufferMin: "El tiempo de entrega",
  returnBufferMin: "El tiempo de devolución",
  prepBufferMin: "El tiempo de preparación",
  transportBufferMin: "El tiempo de transporte",
  cleaningBufferMin: "El tiempo de limpieza",
};

/** Largo máximo de la frase de la portada de la tienda. */
export const STOREFRONT_TAGLINE_MAX = 140;

/** Tope de un tiempo: 30 días en minutos. Tope de la retención: 90 días. */
export const MAX_RENTAL_BUFFER_MIN = 30 * 24 * 60;
export const MAX_HOLD_TTL_MIN = 90 * 24 * 60;

export const RENTAL_SETTINGS_FIELDS = [
  "depositPercent",
  "securityDepositDefault",
  "securityDepositMode",
  "securityDepositPurpose",
  "securityDepositCalc",
  "securityDepositPercent",
  "securityDepositRules",
  "lateFeeKind",
  "lateFeeUnit",
  "lateFeeValue",
  "lateGraceMinutes",
  "damageChargePercent",
  "customCharges",
  "cancellationPolicy",
  "rentalTerms",
  "holdTtlMinutes",
  ...BUFFER_KEYS,
  "publicCatalogEnabled",
  "publicShowPrices",
  "whatsappPhone",
  "storefrontTagline",
  "storefrontAccent",
  "storefrontEmail",
  "catalogAccessMode",
  "trashPurgeDays",
] as const;

export function readDepositRules(value: unknown): DepositRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): DepositRule[] => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const amount = record.amount;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return [];
    const inventoryId = typeof record.inventoryId === "string" && record.inventoryId ? record.inventoryId : null;
    const categoryId = typeof record.categoryId === "string" && record.categoryId ? record.categoryId : null;
    return inventoryId || categoryId ? [{ inventoryId, categoryId: inventoryId ? null : categoryId, amount }] : [];
  });
}

export function readCustomCharges(value: unknown): CustomChargeType[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): CustomChargeType[] => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.amount !== "number") return [];
    const unit = (CUSTOM_CHARGE_UNITS as readonly string[]).includes(record.unit as string) ? (record.unit as CustomChargeType["unit"]) : "PIECE";
    return [{ id: record.id, name: record.name, amount: record.amount, unit, categoryId: typeof record.categoryId === "string" && record.categoryId ? record.categoryId : null }];
  });
}

export const RENTAL_TERMS_MAX = 4000;

export function toRentalSettingsView(row: OrganizationRentalSettings | null): RentalSettingsView {
  if (!row) return { ...RENTAL_SETTINGS_DEFAULTS };
  return {
    depositPercent: row.depositPercent,
    securityDepositDefault: row.securityDepositDefault,
    securityDepositMode: isDepositMode(row.securityDepositMode) ? row.securityDepositMode : "NONE",
    securityDepositPurpose: isDepositPurpose(row.securityDepositPurpose) ? row.securityDepositPurpose : "DAMAGES",
    securityDepositCalc: isDepositCalc(row.securityDepositCalc) ? row.securityDepositCalc : "FIXED",
    securityDepositPercent: row.securityDepositPercent,
    securityDepositRules: readDepositRules(row.securityDepositRules),
    lateFeeKind: isLateFeeKind(row.lateFeeKind) ? row.lateFeeKind : DEFAULT_LATE_FEE.kind,
    lateFeeUnit: isLateFeeUnit(row.lateFeeUnit) ? row.lateFeeUnit : DEFAULT_LATE_FEE.unit,
    lateFeeValue: row.lateFeeValue,
    lateGraceMinutes: row.lateGraceMinutes,
    damageChargePercent: row.damageChargePercent,
    customCharges: readCustomCharges(row.customCharges),
    cancellationPolicy: cancellationPolicyOf(row.cancellationPolicy),
    rentalTerms: row.rentalTerms,
    holdTtlMinutes: row.holdTtlMinutes,
    deliveryBufferMin: row.deliveryBufferMin,
    returnBufferMin: row.returnBufferMin,
    prepBufferMin: row.prepBufferMin,
    transportBufferMin: row.transportBufferMin,
    cleaningBufferMin: row.cleaningBufferMin,
    publicCatalogEnabled: row.publicCatalogEnabled,
    publicShowPrices: row.publicShowPrices,
    whatsappPhone: row.whatsappPhone,
    storefrontTagline: row.storefrontTagline,
    storefrontAccent: row.storefrontAccent,
    storefrontEmail: row.storefrontEmail,
    catalogAccessMode: isCatalogAccessMode(row.catalogAccessMode) ? row.catalogAccessMode : "OPEN",
    trashPurgeDays: row.trashPurgeDays,
  };
}

/** Valida un parche parcial: `undefined` = no tocar el campo. */
export function parseRentalSettingsPatch(
  body: unknown,
): { ok: true; data: Partial<RentalSettingsView> } | { ok: false; error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const data: Partial<RentalSettingsView> = {};

  if (record.depositPercent !== undefined) {
    if (record.depositPercent === null || record.depositPercent === "") {
      data.depositPercent = null;
    } else {
      const percent = Number(record.depositPercent);
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
        return { ok: false, error: "La seña debe ser un porcentaje entero entre 0 y 100." };
      }
      data.depositPercent = percent;
    }
  }
  if (record.securityDepositDefault !== undefined) {
    if (record.securityDepositDefault === null || record.securityDepositDefault === "" || record.securityDepositDefault === 0) {
      data.securityDepositDefault = null;
    } else {
      const amount = record.securityDepositDefault;
      if (typeof amount !== "number" || !securityDepositAmountValid(amount)) {
        return { ok: false, error: "La garantía por defecto debe ser un monto entero en guaraníes mayor a cero." };
      }
      data.securityDepositDefault = amount;
    }
  }
  if (record.holdTtlMinutes !== undefined) {
    const minutes = Number(record.holdTtlMinutes);
    if (record.holdTtlMinutes === null || record.holdTtlMinutes === "" || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_HOLD_TTL_MIN) {
      return { ok: false, error: "La retención debe durar entre 1 minuto y 90 días." };
    }
    data.holdTtlMinutes = minutes;
  }
  if (record.securityDepositMode !== undefined) {
    if (!isDepositMode(record.securityDepositMode)) return { ok: false, error: "La política de garantía debe ser No uso, Opcional o Siempre." };
    data.securityDepositMode = record.securityDepositMode;
  }
  if (record.securityDepositPurpose !== undefined) {
    if (!isDepositPurpose(record.securityDepositPurpose)) return { ok: false, error: "La garantía es para Reserva o para Daños." };
    data.securityDepositPurpose = record.securityDepositPurpose;
  }
  if (record.securityDepositCalc !== undefined) {
    if (!isDepositCalc(record.securityDepositCalc)) return { ok: false, error: "La garantía se calcula con monto fijo, % del pedido o por producto." };
    data.securityDepositCalc = record.securityDepositCalc;
  }
  if (record.securityDepositPercent !== undefined) {
    if (record.securityDepositPercent === null || record.securityDepositPercent === "") data.securityDepositPercent = null;
    else {
      const percent = record.securityDepositPercent;
      if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 1 || percent > 100) return { ok: false, error: "El % de garantía debe ser un entero entre 1 y 100." };
      data.securityDepositPercent = percent;
    }
  }
  if (record.securityDepositRules !== undefined) {
    const rules = record.securityDepositRules === null ? [] : record.securityDepositRules;
    if (!Array.isArray(rules) || rules.length > 200) return { ok: false, error: "Las reglas de garantía no son válidas." };
    const parsed = readDepositRules(rules);
    if (parsed.length !== rules.length) return { ok: false, error: "Cada regla de garantía necesita un producto o categoría y un monto entero mayor a cero." };
    if (parsed.some((rule) => rule.amount > BUDGET_INT_MAX)) return { ok: false, error: "El monto de una regla supera el límite." };
    const keys = parsed.map((rule) => rule.inventoryId ?? `c:${rule.categoryId}`);
    if (new Set(keys).size !== keys.length) return { ok: false, error: "Hay dos reglas para el mismo producto o categoría." };
    data.securityDepositRules = parsed;
  }
  if (record.lateFeeKind !== undefined) {
    if (!isLateFeeKind(record.lateFeeKind)) return { ok: false, error: "El recargo por demora es un porcentaje o un monto fijo." };
    data.lateFeeKind = record.lateFeeKind;
  }
  if (record.lateFeeUnit !== undefined) {
    if (!isLateFeeUnit(record.lateFeeUnit)) return { ok: false, error: "El recargo por demora se cobra por día o por hora." };
    data.lateFeeUnit = record.lateFeeUnit;
  }
  if (record.lateFeeValue !== undefined) {
    const value = record.lateFeeValue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > BUDGET_INT_MAX) return { ok: false, error: "El recargo por demora debe ser un entero mayor o igual a cero." };
    data.lateFeeValue = value;
  }
  if (record.lateGraceMinutes !== undefined) {
    const value = record.lateGraceMinutes;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 24 * 60) return { ok: false, error: "La tolerancia debe estar entre 0 minutos y 24 horas." };
    data.lateGraceMinutes = value;
  }
  if (record.damageChargePercent !== undefined) {
    const value = record.damageChargePercent;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 500) return { ok: false, error: "El % de rotura o faltante debe ser un entero entre 0 y 500." };
    data.damageChargePercent = value;
  }
  if (record.customCharges !== undefined) {
    const list = record.customCharges === null ? [] : record.customCharges;
    if (!Array.isArray(list) || list.length > 100) return { ok: false, error: "Los cargos personalizados no son válidos." };
    const seen = new Set<string>();
    const parsed: CustomChargeType[] = [];
    for (const row of list) {
      const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const name = typeof item.name === "string" ? item.name.replace(/\s+/g, " ").trim() : "";
      if (!name || name.length > 80) return { ok: false, error: "Cada cargo necesita un nombre de hasta 80 caracteres." };
      if (typeof item.amount !== "number" || !Number.isInteger(item.amount) || item.amount <= 0 || item.amount > BUDGET_INT_MAX) return { ok: false, error: `El monto de «${name}» debe ser un entero en guaraníes mayor a cero.` };
      if (!(CUSTOM_CHARGE_UNITS as readonly string[]).includes(item.unit as string)) return { ok: false, error: `«${name}» se cobra por pieza o por evento.` };
      if (seen.has(name.toLowerCase())) return { ok: false, error: `El cargo «${name}» está repetido.` };
      seen.add(name.toLowerCase());
      const id = typeof item.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) ? item.id : randomUUID();
      parsed.push({ id, name, amount: item.amount, unit: item.unit as CustomChargeType["unit"], categoryId: typeof item.categoryId === "string" && item.categoryId ? item.categoryId : null });
    }
    data.customCharges = parsed;
  }
  if (record.cancellationPolicy !== undefined) {
    if (record.cancellationPolicy === null) data.cancellationPolicy = DEFAULT_CANCELLATION_POLICY.map((tier) => ({ ...tier }));
    else {
      const parsed = parseCancellationPolicy(record.cancellationPolicy);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      data.cancellationPolicy = parsed.tiers;
    }
  }
  if (record.rentalTerms !== undefined) {
    if (record.rentalTerms === null || record.rentalTerms === "") data.rentalTerms = null;
    else if (typeof record.rentalTerms !== "string") return { ok: false, error: "Las condiciones del alquiler no son válidas." };
    else {
      const terms = record.rentalTerms.replace(/\r\n/g, "\n").trim();
      if (terms.length > RENTAL_TERMS_MAX) return { ok: false, error: `Las condiciones no pueden superar los ${RENTAL_TERMS_MAX} caracteres.` };
      data.rentalTerms = terms || null;
    }
  }
  for (const key of BUFFER_KEYS) {
    if (record[key] === undefined) continue;
    const minutes = Number(record[key]);
    if (record[key] === null || record[key] === "" || !Number.isInteger(minutes) || minutes < 0 || minutes > MAX_RENTAL_BUFFER_MIN) {
      return { ok: false, error: `${BUFFER_LABELS[key]} debe estar entre 0 y 30 días.` };
    }
    data[key] = minutes;
  }
  for (const key of ["publicCatalogEnabled", "publicShowPrices"] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== "boolean") return { ok: false, error: "Las opciones del catálogo público deben ser sí o no." };
    data[key] = record[key] as boolean;
  }
  if (record.whatsappPhone !== undefined) {
    if (record.whatsappPhone === null || record.whatsappPhone === "") {
      data.whatsappPhone = null;
    } else if (typeof record.whatsappPhone !== "string") {
      return { ok: false, error: "El WhatsApp no es válido." };
    } else {
      const digits = record.whatsappPhone.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) return { ok: false, error: "Ingresá un número de WhatsApp válido con código de país." };
      data.whatsappPhone = `+${digits}`;
    }
  }
  if (record.storefrontTagline !== undefined) {
    if (record.storefrontTagline === null || record.storefrontTagline === "") {
      data.storefrontTagline = null;
    } else if (typeof record.storefrontTagline !== "string") {
      return { ok: false, error: "La frase de la tienda no es válida." };
    } else {
      const tagline = record.storefrontTagline.replace(/\s+/g, " ").trim();
      if (tagline.length > STOREFRONT_TAGLINE_MAX) return { ok: false, error: `La frase de la tienda no puede superar los ${STOREFRONT_TAGLINE_MAX} caracteres.` };
      data.storefrontTagline = tagline || null;
    }
  }
  if (record.storefrontAccent !== undefined) {
    const accent = parseStorefrontAccent(record.storefrontAccent);
    if (!accent.ok) return { ok: false, error: accent.error };
    data.storefrontAccent = accent.accent;
  }
  if (record.storefrontEmail !== undefined) {
    if (record.storefrontEmail === null || record.storefrontEmail === "") {
      data.storefrontEmail = null;
    } else if (typeof record.storefrontEmail !== "string") {
      return { ok: false, error: "El correo de la tienda no es válido." };
    } else {
      const email = record.storefrontEmail.trim().toLowerCase();
      if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Ingresá un correo de contacto válido." };
      data.storefrontEmail = email;
    }
  }
  if (record.catalogAccessMode !== undefined) {
    if (!isCatalogAccessMode(record.catalogAccessMode)) return { ok: false, error: "El acceso al catálogo tiene que ser Abierto, Con solicitud o Privado." };
    data.catalogAccessMode = record.catalogAccessMode;
  }
  if (record.trashPurgeDays !== undefined) {
    if (record.trashPurgeDays === null || record.trashPurgeDays === "") {
      data.trashPurgeDays = null;
    } else if (typeof record.trashPurgeDays !== "number" || !isTrashPurgeDays(record.trashPurgeDays)) {
      return { ok: false, error: "El vaciado automático debe ser nunca, 30, 60, 90 o 180 días." };
    } else {
      data.trashPurgeDays = record.trashPurgeDays;
    }
  }
  return { ok: true, data };
}

/** Ajustes de la empresa (los valores por defecto si todavía no se guardó nada). */
export async function getRentalSettings(organizationId: string): Promise<RentalSettingsView> {
  return toRentalSettingsView(await db.organizationRentalSettings.findUnique({ where: { organizationId } }));
}

/**
 * Las reglas de garantía y los cargos por categoría apuntan a productos y categorías: tienen que ser
 * de esta empresa (un id ajeno se rechaza, nunca se guarda).
 */
export async function validateRentalSettingsRefs(organizationId: string, data: Partial<RentalSettingsView>): Promise<string | null> {
  const inventoryIds = [...new Set((data.securityDepositRules ?? []).flatMap((rule) => (rule.inventoryId ? [rule.inventoryId] : [])))];
  const categoryIds = [
    ...new Set([
      ...(data.securityDepositRules ?? []).flatMap((rule) => (rule.categoryId ? [rule.categoryId] : [])),
      ...(data.customCharges ?? []).flatMap((charge) => (charge.categoryId ? [charge.categoryId] : [])),
    ]),
  ];
  if (inventoryIds.length > 0 && (await db.inventoryItem.count({ where: { organizationId, id: { in: inventoryIds } } })) !== inventoryIds.length) return "Alguna regla de garantía apunta a un producto que no existe.";
  if (categoryIds.length > 0 && (await db.inventoryCategory.count({ where: { organizationId, id: { in: categoryIds } } })) !== categoryIds.length) return "Alguna regla o cargo apunta a una categoría que no existe.";
  return null;
}

/** Guarda el parche sobre la fila de la empresa (la crea la primera vez). */
export async function saveRentalSettings(organizationId: string, data: Partial<RentalSettingsView>): Promise<RentalSettingsView> {
  const row = await db.organizationRentalSettings.upsert({
    where: { organizationId },
    create: { ...(data as Prisma.OrganizationRentalSettingsUncheckedCreateInput), id: randomUUID(), organizationId },
    update: data as Prisma.OrganizationRentalSettingsUncheckedUpdateInput,
  });
  return toRentalSettingsView(row);
}
