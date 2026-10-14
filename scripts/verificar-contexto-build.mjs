#!/usr/bin/env node
/**
 * Controla el tamaño del contexto de build: suma los archivos versionados que
 * `.dockerignore` no excluye y falla si el total pasa el tope o si algún archivo pesa
 * demasiado. Coolify construye con Railpack (BuildKit) y el `Dockerfile` queda como
 * alternativa. El tope protege igual el tamaño del repo; que Railpack respete
 * `.dockerignore` está sin verificar (ver docs/OPERACION.md).
 * Antecedente: en Agendese, evidencias de QA commiteadas (docs/qa, ~19.600
 * .har.gz/.json) llevaron el contexto de 300 MB a 2 GB y el build se cortaba.
 *
 *   node scripts/verificar-contexto-build.mjs [--max-total-mb 400] [--max-file-mb 5]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
export const MAX_TOTAL_MB = flag("--max-total-mb", 400);
export const MAX_FILE_MB = flag("--max-file-mb", 5);
const MB = 1024 * 1024;

/** Regla de `.dockerignore` a RegExp (semántica de Docker: rutas desde la raíz, `**` cruza carpetas). */
export function dockerignoreRule(line) {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return null;
  const negate = pattern.startsWith("!");
  if (negate) pattern = pattern.slice(1);
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      source += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // Una regla que nombra una carpeta excluye todo lo que tiene adentro.
  return { negate, regex: new RegExp(`^${source}(?:/.*)?$`) };
}

export function parseDockerignore(text) {
  return text.split(/\r?\n/).map(dockerignoreRule).filter(Boolean);
}

/** La última regla que coincide decide (igual que Docker). */
export function isIgnored(path, rules) {
  let ignored = false;
  for (const rule of rules) if (rule.regex.test(path)) ignored = !rule.negate;
  return ignored;
}

export function measureContext(cwd = process.cwd()) {
  const rules = parseDockerignore(readFileSync(join(cwd, ".dockerignore"), "utf8"));
  const files = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 256 * MB }).split("\0").filter(Boolean);
  const included = [];
  let excludedBytes = 0;
  for (const path of files) {
    let size = 0;
    try {
      size = statSync(join(cwd, path)).size;
    } catch {
      continue; // borrado en el árbol de trabajo
    }
    if (isIgnored(path, rules)) excludedBytes += size;
    else included.push({ path, size });
  }
  const totalBytes = included.reduce((sum, file) => sum + file.size, 0);
  return { included, totalBytes, excludedBytes, files: files.length };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { included, totalBytes, excludedBytes } = measureContext();
  const heavy = included.filter((file) => file.size > MAX_FILE_MB * MB).sort((a, b) => b.size - a.size);
  const mb = (bytes) => (bytes / MB).toFixed(1);
  console.log(`Contexto de build: ${mb(totalBytes)} MB en ${included.length} archivos (excluidos por .dockerignore: ${mb(excludedBytes)} MB).`);
  let failed = false;
  if (totalBytes > MAX_TOTAL_MB * MB) {
    failed = true;
    console.error(`✖ El contexto pasa el tope de ${MAX_TOTAL_MB} MB. Los 15 más pesados:`);
    for (const file of [...included].sort((a, b) => b.size - a.size).slice(0, 15)) console.error(`  ${mb(file.size)} MB  ${file.path}`);
  }
  if (heavy.length) {
    failed = true;
    console.error(`✖ Archivos de más de ${MAX_FILE_MB} MB en el contexto (excluilos en .dockerignore o sacalos del repo):`);
    for (const file of heavy) console.error(`  ${mb(file.size)} MB  ${file.path}`);
  }
  if (failed) process.exit(1);
}
