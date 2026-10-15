import { randomBytes } from "node:crypto";

/**
 * Espacio de nombres del seed de la demo (docs/DEMO-INTERACTIVA.md §1).
 *
 * El dataset se escribe con ids `demo_<k>`. Para una sandbox se reescriben en el borde de la escritura a
 * `sbx_<ns>_<k>` (`sid`), así dos sandboxes —y la vitrina— nunca chocan. Sin `ns` nada cambia: mismos ids.
 * También se sortean por sandbox los tokens públicos y los códigos de firma, y los correos de los colaboradores
 * llevan `+<ns>` (el correo del usuario es único en toda la base).
 */

const NS_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** `ns` de 10 caracteres base32 (minúsculas), al azar. */
export function newSandboxNs(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i += 1) out += NS_ALPHABET[bytes[i] % 32];
  return out;
}

export function isValidNs(ns: string): boolean {
  return /^[a-z2-7]{10}$/.test(ns);
}

/** Token con la forma `XXXX-XXXX-XXXX-XXXX[-XXXX]` del alfabeto sin ambigüedades, al azar. */
export function randomGroupedToken(groups = 5): string {
  const bytes = randomBytes(groups * 4);
  const parts: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    let part = "";
    for (let i = 0; i < 4; i += 1) part += CODE_ALPHABET[bytes[g * 4 + i] % CODE_ALPHABET.length];
    parts.push(part);
  }
  return parts.join("-");
}

const GROUPED_TOKEN = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3,4}$/;
const OPAQUE_TOKEN_PREFIX = /^(demo-pedido-|demo-link-mayorista-|lbxw_demo-)/;

export type SeedIds = {
  ns: string;
  /** `demo_<k>` (vitrina) o `sbx_<ns>_<k>` (sandbox). */
  sid: (k: string) => string;
  /** Reescribe ids, correos y tokens dentro de un texto. */
  mapString: (value: string) => string;
  /** Igual que `mapString` sobre objetos/arreglos simples (fechas, buffers y valores de Prisma se respetan). */
  mapDeep: <T>(value: T) => T;
  /** Token público al azar (uno por token literal y por sandbox). */
  tk: (literal: string) => string;
  /** Sal para los códigos públicos de firma. */
  codeSalt: string;
};

/** Reescritor de la sandbox `ns`. Con `ns` indefinido no se usa: la vitrina escribe sus ids tal cual. */
export function makeSeedIds(ns: string): SeedIds {
  if (!isValidNs(ns)) throw new Error("ns de sandbox inválido.");
  const tokens = new Map<string, string>();
  const issued = new Set<string>();
  const tk = (literal: string): string => {
    let token = tokens.get(literal);
    if (!token) {
      if (GROUPED_TOKEN.test(literal)) token = randomGroupedToken(literal.split("-").length);
      else if (literal.startsWith("lbxw_")) token = `lbxw_${randomBytes(18).toString("base64url")}`;
      else token = randomBytes(18).toString("base64url");
      tokens.set(literal, token);
      issued.add(token);
    }
    return token;
  };
  const sid = (k: string) => `sbx_${ns}_${k}`;
  const mapString = (value: string): string => {
    if (value.length > 4000 && value.startsWith("data:")) return value;
    if (issued.has(value)) return value;
    if (GROUPED_TOKEN.test(value) || OPAQUE_TOKEN_PREFIX.test(value)) return tk(value);
    let out = value;
    if (out.includes("demo_")) out = out.replace(/(?<![A-Za-z0-9])demo_/g, `sbx_${ns}_`);
    if (out.includes("@ledbox.demo")) out = out.replace(/([A-Za-z0-9._+-]+)@ledbox\.demo/g, (all, local: string) => (local.endsWith(`+${ns}`) ? all : `${local}+${ns}@ledbox.demo`));
    return out;
  };
  const mapDeep = <T,>(value: T): T => {
    if (typeof value === "string") return mapString(value) as unknown as T;
    if (Array.isArray(value)) return value.map((item) => mapDeep(item)) as unknown as T;
    if (value && typeof value === "object") {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = mapDeep(item);
      return out as T;
    }
    return value;
  };
  return { ns, sid, mapString, mapDeep, tk, codeSalt: ns };
}

/**
 * Envuelve el cliente de la transacción: los argumentos de toda operación de modelo pasan por `mapDeep`
 * (ids, claves foráneas, correos y tokens). Los métodos `$…` (SQL crudo) quedan sin tocar.
 */
export function wrapTx<T extends object>(tx: T, ids: SeedIds): T {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || prop.startsWith("$") || prop.startsWith("_") || !value || typeof value !== "object") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return new Proxy(value as object, {
        get(model, method) {
          const fn = Reflect.get(model, method);
          if (typeof fn !== "function") return fn;
          return (...args: unknown[]) => fn.apply(model, args.map((arg) => ids.mapDeep(arg)));
        },
      });
    },
  });
}
