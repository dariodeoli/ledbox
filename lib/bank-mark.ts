/**
 * Marca de un banco — paso 4 de `docs/ADOPCION-OWNCODING-UI.md` (issue #47).
 *
 * Fuente única: el catálogo de `owncoding-ui` (`BANCOS_PARAGUAY`) y sus
 * utilidades: `normalizarBanco` para la clave, `logoDeBanco` para resolver el
 * nombre (con alias) y `sugerenciasDeBanco` para el autocompletado del campo.
 * Acá **no hay lista de bancos propia**: la misma marca y el mismo catálogo que
 * dibujan las otras apps (MobOS, ScaleOS, PagaYa).
 *
 * Regla de la app para logos (docs/REGLAS-GENERALES.md): asset del repo → marca
 * vectorial → monograma. El registro de la librería apunta a archivos del host
 * (`/bancos/<archivo>`) y a marcas vectoriales que esta app todavía no versiona;
 * `REPO_ASSETS` traduce la referencia de la librería al archivo real del repo
 * cuando existe y, sin archivo, el banco cae al monograma (nunca una imagen
 * rota).
 *
 * Ojo: los utils de la librería viven en un bundle `"use client"`, así que este
 * módulo se consume del lado cliente (los módulos del panel y la isla de
 * impresión `PrintBankData`). No llamarlo desde componentes de servidor.
 */

import {
  BANCOS_PARAGUAY,
  colorDeBanco,
  inicialesDeBanco,
  logoDeBanco,
  normalizarBanco,
  sugerenciasDeBanco,
} from "owncoding-ui";

export type BankMark = {
  /** Clave normalizada del banco (ej.: `banco continental`). */
  key: string;
  /** Nombre para mostrar (el canónico del catálogo, o el tipeado tal cual). */
  label: string;
  /** Iniciales del monograma (1–3 letras). */
  initials: string;
  /** Color de marca o de la paleta compartida, en hex. */
  color: string;
  /** Asset del repositorio o `null` mientras no haya logo versionado. */
  asset: string | null;
};

/**
 * Registro real de `logoDeBanco`: archivo del host, marca vectorial compartida
 * o monograma. El `.d.ts` de v0.14.0 publica un tipo viejo (`string | null`)
 * mientras el runtime devuelve este objeto; se ajusta acá, en un solo lugar,
 * junto con el catálogo (declarado como objetos, exportado como nombres).
 */
type LogoBanco =
  | { banco: string; tipo: "archivo"; archivo: string; chip?: boolean; generico?: boolean }
  | { banco: string; tipo: "marca"; marca: string; generico?: boolean }
  | { banco: string; tipo: "monograma"; iniciales?: string; color?: string; generico?: boolean };

const resolverLogo = logoDeBanco as unknown as (nombre: string) => LogoBanco | null;
const CATALOGO = BANCOS_PARAGUAY as unknown as string[];

/**
 * Assets versionados en el repo, por la referencia que devuelve la librería
 * (`marca:<marca>` o `archivo:<archivo>`). Al versionar un logo nuevo se agrega
 * la línea acá y el banco deja de dibujar el monograma; el archivo vive en
 * `public/assets/banks`.
 */
const REPO_ASSETS: Record<string, string> = {
  "marca:ueno": "/assets/banks/ueno.svg",
};

function repoAsset(logo: LogoBanco): string | null {
  if (logo.tipo === "archivo") return REPO_ASSETS[`archivo:${logo.archivo}`] ?? null;
  if (logo.tipo === "marca") return REPO_ASSETS[`marca:${logo.marca}`] ?? null;
  return null;
}

/** ¿El texto tiene alguna mayúscula? (`texto !== texto.toLowerCase()`). */
function conMayusculas(text: string): boolean {
  return text !== text.toLowerCase();
}

/**
 * Nombre para mostrar: el canónico del catálogo (resuelve alias como «itau» o
 * «bnf»). Si el canónico de la librería viene todo en minúsculas (p. ej.
 * «ueno bank»), se respeta el tipeo capitalizado de la empresa.
 */
function displayLabel(typed: string, canonico: string): string {
  if (conMayusculas(canonico)) return canonico;
  return conMayusculas(typed) ? typed : canonico;
}

/** Clave canónica del banco: la normalización de la librería. */
export function bankKey(bank: string | null | undefined): string {
  return normalizarBanco(String(bank ?? ""));
}

/**
 * Sugerencias del catálogo para lo tipeado (sin acentos y con alias); sin texto
 * devuelve el catálogo completo. Alimenta el autocompletado del campo Banco.
 */
export function bankSuggestions(query: string | null | undefined): string[] {
  return [...sugerenciasDeBanco(String(query ?? ""), CATALOGO)];
}

/** Marca del banco a partir del nombre tipeado por la empresa; `null` sin nombre. */
export function bankMark(bank: string | null | undefined): BankMark | null {
  const typed = String(bank ?? "").trim();
  if (!typed) return null;
  const logo = resolverLogo(typed);
  if (!logo) return null;
  const monograma = logo.tipo === "monograma" ? logo : null;
  return {
    key: bankKey(typed),
    label: displayLabel(typed, logo.banco),
    initials: monograma?.iniciales || inicialesDeBanco(typed),
    color: monograma?.color || colorDeBanco(typed),
    asset: repoAsset(logo),
  };
}
