import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("toda consulta de lib/platform/queries usa el filtro único de sin-demo", () => {
  const files = walk(join(root, "lib", "platform", "queries")).filter((file) => /\.tsx?$/.test(file));
  assert.ok(files.length >= 2, "hay consultas de plataforma");
  const offenders = files.filter((file) => {
    const source = readFileSync(file, "utf8");
    const imports = /from\s+["']@\/lib\/platform\/sin-demo["']/.test(source);
    const uses = /\b(orgReal|usuarioReal)\(/.test(source);
    const raw = /\$queryRaw|\$queryRawUnsafe|runMetric\(/.test(source);
    // trafico.ts lee WebView y DemoSession: no tienen organizationId, la demo es un HOST. Su regla
    // equivalente: las vistas de ese host solo salen marcadas aparte (`isDemo`), vía demoHost().
    if (file.endsWith("trafico.ts")) return !/isDemo: row\.host === demo/.test(source) || !/function demoHost\(/.test(source);
    return raw && !(imports && uses);
  });
  assert.deepEqual(offenders.map((file) => relative(root, file)), []);
});

test("cada SQL con tablas de datos aplica orgReal/usuarioReal (no solo lo importa)", () => {
  const source = readFileSync(join(root, "lib", "platform", "queries", "resumen.ts"), "utf8");
  for (const table of ["Organization", "AuditLog", "AdminActivityDay", "AdminSession", "Event", "Budget", "ClientPayment"]) {
    const re = new RegExp(`FROM "${table}" (\\w+)`, "g");
    for (const match of source.matchAll(re)) {
      const block = source.slice(match.index!, match.index! + 900);
      assert.match(block, /orgReal\(|usuarioReal\(|orgDemo\(/, `${table} sin filtro de demo`);
    }
  }
});

test("las consultas son parametrizadas: sin $queryRawUnsafe ni interpolación de texto en SQL", () => {
  for (const file of walk(join(root, "lib", "platform")).filter((f) => /\.tsx?$/.test(f))) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\$queryRawUnsafe|\$executeRawUnsafe/, relative(root, file));
  }
});

test("ningún componente cliente importa guard, queries ni la base", () => {
  const dirs = [join(root, "components", "platform"), join(root, "app", "(superadmin)")];
  for (const dir of dirs) {
    for (const file of walk(dir).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(source)) continue;
      assert.doesNotMatch(source, /lib\/platform\/(guard|queries|aggregate)|lib\/server\/db/, relative(root, file));
    }
  }
});

test("lo que se pasa a los componentes no tiene campos de hash ni token", () => {
  for (const file of ["lib/platform/queries/resumen.ts", "lib/platform/queries/actividad.ts"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /passwordHash|pinHash|tokenHash|jtiHash|publicToken|apiKey/i, file);
  }
});

test("components/platform no usa la etiqueta <nav>: globals.css la fija arriba (regla del sitio público)", () => {
  for (const file of walk(join(root, "components", "platform")).filter((f) => /\.tsx$/.test(f))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /<\/?nav[\s>]/, relative(root, file));
  }
});

test("las consultas de usuarios nunca leen hashes: solo «IS [NOT] NULL» y ningún token", () => {
  const source = readFileSync(join(root, "lib", "platform", "queries", "usuarios.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const match of source.matchAll(/(passwordHash|pinHash)/g)) {
    const around = source.slice(match.index!, match.index! + 40);
    assert.match(around, /^(passwordHash|pinHash)" IS (NOT )?NULL/, `uso inseguro: ${around}`);
  }
  assert.doesNotMatch(source, /tokenHash|jtiHash|publicToken/);
});

test("platform-routes: los dos exportar existen y llaman a requirePlatformAdmin(", () => {
  for (const dir of ["empresas", "usuarios"]) {
    const source = readFileSync(join(root, "app", "(superadmin)", "superadmin", dir, "exportar", "route.ts"), "utf8");
    assert.match(source, /requirePlatformAdmin\(/);
    assert.match(source, /rateLimit\(/);
    assert.match(source, /csvResponse\(/);
  }
});

test("sin-demo filtra por isDemo (vitrina y sandboxes), no solo por el slug", () => {
  const source = readFileSync(join(root, "lib", "platform", "sin-demo.ts"), "utf8");
  assert.match(source, /"isDemo" = true/, "orgDemo/orgReal usan isDemo");
  assert.match(source, /o\."isDemo" = false/, "usuarioReal exige una empresa con isDemo = false");
});
