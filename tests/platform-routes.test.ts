import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const BASE = join(root, "app", "(superadmin)");

function walk(dir: string, files: string[] = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

/** Archivos que sirven algo: page, layout, route, y cualquier módulo con "use server". */
function platformEntrypoints(files: string[]) {
  return files.filter((file) => {
    if (/(^|[\\/])(page|layout|route|default|template)\.(tsx?|jsx?|mjs)$/.test(file)) return true;
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) return false;
    return /^\s*["']use server["']/m.test(readFileSync(file, "utf8"));
  });
}

/** Funciones exportadas de un archivo "use server" (cada una es una server action). */
function exportedFunctions(source: string) {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1], body: m[0] }))
    .concat([...source.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?:=>)?\s*\{([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1], body: m[0] })));
}

function platformViolations(files: string[]) {
  const offenders: string[] = [];
  for (const file of platformEntrypoints(files)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(root, file);
    if (/^\s*["']use server["']/m.test(source) && !/(^|[\\/])(page|layout|route)\.(tsx?|jsx?|mjs)$/.test(file)) {
      for (const fn of exportedFunctions(source)) {
        if (!fn.body.includes("requirePlatformAdmin(")) offenders.push(`${rel}#${fn.name}`);
      }
      continue;
    }
    if (!source.includes("requirePlatformAdmin(")) offenders.push(rel);
  }
  return offenders;
}

test("todo page, layout, route o server action de app/(superadmin) llama a requirePlatformAdmin(", () => {
  const files = walk(BASE);
  assert.deepEqual(platformViolations(files), [], "falta requirePlatformAdmin( en:\n" + platformViolations(files).join("\n"));
});

test("la detección falla ante un page, layout, route o server action sin guard (y pasa con guard)", () => {
  const fixtures: Array<[string, string]> = [
    ["page.tsx", "export default function P() { return null; }\n"],
    ["layout.tsx", "export default function L({ children }: any) { return children; }\n"],
    ["exportar/route.ts", "export async function GET() { return new Response('x'); }\n"],
  ];
  const dir = mkdtempSync(join(tmpdir(), "plat-routes-"));
  try {
    for (const [name, body] of fixtures) {
      const file = join(dir, name);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, body);
      assert.equal(platformViolations([file]).length, 1, `${name} sin guard debe fallar`);
      writeFileSync(file, `import { requirePlatformAdmin } from "@/lib/platform/guard";\nawait requirePlatformAdmin();\n${body}`);
      assert.equal(platformViolations([file]).length, 0, `${name} con guard debe pasar`);
    }
    const action = join(dir, "acciones.ts");
    writeFileSync(action, '"use server";\nexport async function sinGuard() {\n  return 1;\n}\nexport async function conGuard() {\n  await requirePlatformAdmin();\n}\n');
    assert.deepEqual(platformViolations([action]).map((x) => x.split("#")[1]), ["sinGuard"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el alta de empresa (página y server actions) está cubierta por el guard", () => {
  const files = walk(BASE).map((file) => relative(root, file).split("\\").join("/"));
  assert.ok(files.includes("app/(superadmin)/superadmin/empresas/nueva/page.tsx"), "falta la página de alta");
  assert.ok(files.includes("app/(superadmin)/superadmin/empresas/acciones.ts"), "faltan las acciones de alta");
  const actions = readFileSync(join(BASE, "superadmin", "empresas", "acciones.ts"), "utf8");
  assert.deepEqual(
    exportedFunctions(actions).map((fn) => fn.name).sort(),
    ["crearEmpresaAction", "reenviarInvitacionAction"],
  );
  assert.deepEqual(platformViolations(walk(BASE)), []);
});
