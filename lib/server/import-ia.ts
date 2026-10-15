/**
 * Camino «IA de LedBox» de «Importar»: reutiliza el proveedor, la credencial y
 * el parseo de JSON de la Carga con IA (`lib/server/ia-carga.ts`), pero con un
 * «modo» por módulo: las instrucciones salen del registro
 * (`lib/import-modules.ts`) y la salida va por la misma normalización que el
 * JSON de ChatGPT, así que termina en la misma vista previa.
 *
 * Privacidad (docs/PRIVACIDAD.md T10): se manda solo el texto pegado; la
 * base nunca sale. La IA lee texto: de un PDF o una foto hay que pegar el
 * texto (hoy no hay lectura de imagen ni de PDF en el proveedor configurado).
 */

import { IA_TEXTO_MAX, IA_REGISTROS_MAX, IA_TOKENS_MAX } from "@/lib/ia-carga";
import { IaError, parsearSalidaIa, type IaProvider } from "@/lib/server/ia-carga";
import type { ImportModule } from "@/lib/import-modules";

/**
 * ¿Puede esta empresa mandar texto al proveedor de IA? La demo (solo lectura,
 * datos públicos) no manda nada afuera.
 */
export function salidaPermitida(context: { demo: boolean }): boolean {
  return !context.demo;
}

export function mensajesDeImportacion(module: ImportModule, texto: string) {
  return [
    { role: "system" as const, content: module.iaInstructions },
    {
      role: "user" as const,
      content: `Extraé los ${module.label.toLowerCase()} de este texto (como máximo ${IA_REGISTROS_MAX}):\n"""\n${texto}\n"""`,
    },
  ];
}

/** JSON crudo que devuelve la IA para el módulo (sin validar: lo valida `normalizeCatalog`). */
export async function analizarImportacion(module: ImportModule, texto: string, proveedor: IaProvider): Promise<unknown> {
  if (texto.length > IA_TEXTO_MAX) throw new IaError(`El texto supera el máximo de ${IA_TEXTO_MAX.toLocaleString("es-PY")} caracteres.`);
  const crudo = await proveedor.analizar(mensajesDeImportacion(module, texto), { maxTokens: IA_TOKENS_MAX });
  return parsearSalidaIa(crudo);
}
