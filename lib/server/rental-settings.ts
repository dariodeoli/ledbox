import { randomUUID } from "node:crypto";
import type { OrganizationRentalSettings } from "@prisma/client";
import type { AdminRentalSettings } from "../admin-types";
import { securityDepositAmountValid } from "../budget-security-deposit";
import { parseStorefrontAccent } from "../storefront-theme";
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
  "holdTtlMinutes",
  ...BUFFER_KEYS,
  "publicCatalogEnabled",
  "publicShowPrices",
  "whatsappPhone",
  "storefrontTagline",
  "storefrontAccent",
  "storefrontEmail",
] as const;

export function toRentalSettingsView(row: OrganizationRentalSettings | null): RentalSettingsView {
  if (!row) return { ...RENTAL_SETTINGS_DEFAULTS };
  return {
    depositPercent: row.depositPercent,
    securityDepositDefault: row.securityDepositDefault,
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
  return { ok: true, data };
}

/** Ajustes de la empresa (los valores por defecto si todavía no se guardó nada). */
export async function getRentalSettings(organizationId: string): Promise<RentalSettingsView> {
  return toRentalSettingsView(await db.organizationRentalSettings.findUnique({ where: { organizationId } }));
}

/** Guarda el parche sobre la fila de la empresa (la crea la primera vez). */
export async function saveRentalSettings(organizationId: string, data: Partial<RentalSettingsView>): Promise<RentalSettingsView> {
  const row = await db.organizationRentalSettings.upsert({
    where: { organizationId },
    create: { id: randomUUID(), organizationId, ...data },
    update: data,
  });
  return toRentalSettingsView(row);
}
