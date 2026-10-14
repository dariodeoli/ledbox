import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
// @ts-expect-error módulo .mjs sin tipos
import { isIgnored, measureContext, parseDockerignore } from "../scripts/verificar-contexto-build.mjs";

const root = process.cwd();
const rules = parseDockerignore(readFileSync(join(root, ".dockerignore"), "utf8"));

test(".dockerignore excluye docs, pruebas, evidencias de QA y herramientas de agentes", () => {
  for (const path of [
    "docs/NOVEDADES.md",
    "docs/qa/run-1/trace.har.gz",
    "design/mock.png",
    "tests/foo.test.ts",
    "e2e/flow.spec.ts",
    "coverage/lcov.info",
    "playwright-report/index.html",
    "test-results/a/trace.zip",
    ".claude/agents/ledbox-ui.md",
    ".atl/x.json",
    "app/capturas/a.png",
    "lib/algo.har",
    "public/evidencia.zip",
  ]) assert.equal(isIgnored(path, rules), true, `${path} debería quedar fuera del contexto`);
});

test(".dockerignore no excluye lo que el build y el runtime necesitan", () => {
  for (const path of ["app/layout.tsx", "app/globals.css", "components/admin/AdminUI.tsx", "lib/server/db.ts", "prisma/schema.prisma", "prisma/migrations/202610170001_trash_archive_delete/migration.sql", "scripts/migrate-deploy.mjs", "public/assets/icon-192.png", "package.json", "package-lock.json", "next.config.mjs", "tailwind.config.mjs", "postcss.config.mjs", "tsconfig.json", "middleware.ts", "README.md"]) {
    assert.equal(isIgnored(path, rules), false, `${path} tiene que llegar al build`);
  }
});

test("el contexto de build actual entra en los topes (400 MB, 5 MB por archivo)", () => {
  const { included, totalBytes } = measureContext(root);
  assert.ok(totalBytes < 400 * 1024 * 1024, `contexto de ${(totalBytes / 1048576).toFixed(1)} MB`);
  const heavy = included.filter((file: { size: number }) => file.size > 5 * 1024 * 1024).map((file: { path: string }) => file.path);
  assert.deepEqual(heavy, []);
});

test("Tailwind escanea solo la librería y los dos componentes que la usan, nunca todo el repo", () => {
  const config = readFileSync(join(root, "tailwind.config.mjs"), "utf8");
  const content = config.slice(config.indexOf("content:"), config.indexOf("],", config.indexOf("content:")));
  assert.match(content, /owncodingContent/);
  assert.doesNotMatch(content, /["']\.\/\*\*|["']\*\*|docs|design|tests|public/, "content no puede tener globs amplios ni carpetas de documentación");
});

/** Imports (`import … from`, `export … from`, `import("…")`) de un archivo fuente. */
function importsOf(source: string) {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm)) {
    const spec = match[1] ?? match[2] ?? match[3];
    // `import type` no llega al bundle.
    if (match[0].startsWith("import type") || match[0].startsWith("export type")) continue;
    if (spec) out.push(spec);
  }
  return out;
}

function resolveLocal(from: string, spec: string) {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const DB_MODULES = /^(@prisma\/client|pg|mongoose|postgres)$/;

function walk(dir: string, files: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(tsx?|mjs)$/.test(name)) files.push(path);
  }
  return files;
}

test("ningún componente 'use client' llega (directo o en cadena) a la base de datos", () => {
  const sources = [...walk(join(root, "app")), ...walk(join(root, "components"))];
  const clients = sources.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
  assert.ok(clients.length > 20, "se esperaban componentes de cliente");
  const offenders: string[] = [];
  for (const entry of clients) {
    const seen = new Set<string>();
    const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [relative(root, entry)] }];
    while (stack.length) {
      const { file, chain } = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const rel = relative(root, file);
      if (rel === "lib/server/db.ts") {
        offenders.push(chain.join(" → "));
        continue;
      }
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (DB_MODULES.test(spec)) {
          offenders.push([...chain, spec].join(" → "));
          continue;
        }
        const next = resolveLocal(file, spec);
        if (next && !next.includes("node_modules")) stack.push({ file: next, chain: [...chain, relative(root, next)] });
      }
    }
  }
  assert.deepEqual(offenders, [], `cadenas de cliente a la base:\n${offenders.join("\n")}`);
});

test("ningún componente 'use client' importa lib/platform/guard ni lib/platform/queries (directo o en cadena)", () => {
  const sources = [...walk(join(root, "app")), ...walk(join(root, "components"))];
  const clients = sources.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
  const forbidden = /^lib\/platform\/(guard|queries)(\/|\.|$)/;
  const offenders: string[] = [];
  for (const entry of clients) {
    const seen = new Set<string>();
    const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [relative(root, entry)] }];
    while (stack.length) {
      const { file, chain } = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (forbidden.test(relative(root, file))) {
        offenders.push(chain.join(" → "));
        continue;
      }
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (/^@\/lib\/platform\/(guard|queries)(\/|$)/.test(spec) || /(^|\/)platform\/(guard|queries)(\/|$)/.test(spec)) {
          offenders.push([...chain, spec].join(" → "));
          continue;
        }
        const next = resolveLocal(file, spec);
        if (next && !next.includes("node_modules")) stack.push({ file: next, chain: [...chain, relative(root, next)] });
      }
    }
  }
  assert.deepEqual(offenders, [], `cadenas de cliente al guard o a las consultas de plataforma:\n${offenders.join("\n")}`);
});
