import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import {
  DUDA_MOTIVO_LABEL,
  dudaMotivo,
  buildPublicDescription,
  catalogSpecs,
  normalizeCatalog,
  parseCatalogJson,
  planCatalog,
  type ExistingItem,
} from "../lib/import-catalog";
import { IMPORT_MODULES, importHeaders, importModule } from "../lib/import-modules";
import { buildCsv, buildXlsx, parseCsv, readSheetFile, readXlsx, templateCsv, templateXlsx } from "../lib/server/import-tabular";
import { ImportZipError, preparePhoto, readPhotoZip } from "../lib/server/import-photos";
import { analizarImportacion } from "../lib/server/import-ia";

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const productos = importModule("productos")!;

const base = {
  empresa: "La Vajilla Alquileres",
  moneda: "PYG",
  productos: [
    { codigo: "743", nombre: "Puff", categoria: "Sector living", tipo: "unidad", precio: 90000, cantidad: 40, medidas: null, capacidad: null, descripcion: null, componentes: [], foto: "743.jpg", pagina: 5, dudas: null },
    { codigo: "527", nombre: "Lounge Oslo", categoria: "Sector living", tipo: "juego", precio: 660000, cantidad: null, medidas: "1.60x0.75", capacidad: "8 personas", descripcion: "Sofá con mesa.", componentes: [{ codigo: "743", cantidad: 2 }], foto: "527.jpg", pagina: 4, dudas: "Precio poco legible" },
  ],
};

function plan(raw: unknown, existing: Record<string, ExistingItem> = {}, photos: string[] | null = ["743.jpg", "527.jpg"]) {
  const parsed = normalizeCatalog(raw);
  assert.ok(parsed.ok);
  return planCatalog({
    products: parsed.value.doc.productos,
    parseProblems: parsed.value.problems,
    existing: new Map(Object.entries(existing)),
    photoNames: photos ? new Set(photos) : null,
  });
}

test("parser: catálogo válido, juegos y dudas como aviso", () => {
  const result = parseCatalogJson(JSON.stringify(base));
  assert.ok(result.ok);
  assert.equal(result.value.doc.productos.length, 2);
  assert.equal(result.value.doc.productos[0].cobro, "dia", "sin «cobro» rige por día (lo normal en alquileres)");
  const preview = plan(base);
  assert.deepEqual(preview.summary, { total: 2, crear: 2, actualizar: 0, omitidos: 0, juegos: 1, incompletos: 0, convertidos: 0, fotos: 2, fotosCategoria: 0, errores: 0, avisos: 1 });
  assert.ok(preview.problems.some((p) => p.tipo === "duda" && p.mensaje.includes("poco legible")));
});

test("parser: rechaza JSON roto, moneda ajena y exceso de tamaño", () => {
  assert.equal(parseCatalogJson("{no es json").ok, false);
  assert.equal(parseCatalogJson(JSON.stringify({ moneda: "USD", productos: [{ codigo: "1A", nombre: "X1" }] })).ok, false);
  assert.equal(parseCatalogJson(JSON.stringify({ productos: [] })).ok, false);
  assert.equal(parseCatalogJson(`{"productos":[{"nombre":"${"a".repeat(2 * 1024 * 1024)}"}]}`).ok, false);
});

test("validaciones: código repetido, precio 0, precio inválido, cobro y tipo", () => {
  const raw = {
    productos: [
      { codigo: "AA1", nombre: "Uno", precio: 0 },
      { codigo: "AA1", nombre: "Uno bis", precio: 10 },
      { codigo: "BB2", nombre: "Dos", precio: -5 },
      { codigo: "CC3", nombre: "Tres", precio: "660.000", cobro: "día" },
      { codigo: "DD4", nombre: "Cuatro", cobro: "semana" },
      { codigo: "EE5", nombre: "Cinco", tipo: "paquete" },
      { codigo: "x/y", nombre: "Siete" },
    ],
  };
  const result = plan(raw, {}, null);
  const kinds = result.problems.map((p) => p.tipo);
  assert.ok(kinds.includes("codigo-repetido"));
  assert.ok(kinds.includes("precio-cero"));
  assert.ok(kinds.includes("precio-invalido"));
  assert.ok(kinds.includes("cobro-invalido"));
  assert.ok(kinds.includes("tipo-invalido"));
  assert.ok(kinds.includes("codigo-invalido"));
  const parsed = normalizeCatalog(raw);
  assert.ok(parsed.ok);
  const tres = parsed.value.doc.productos.find((p) => p.codigo === "CC3")!;
  assert.equal(tres.precio, 660000);
  assert.equal(tres.cobro, "dia");
});

test("componentes inexistentes, juegos anidados y juegos de un componente omitido", () => {
  const raw = {
    productos: [
      { codigo: "J10", nombre: "Juego A", tipo: "juego", componentes: [{ codigo: "NOEXISTE", cantidad: 1 }] },
      { codigo: "U20", nombre: "Unidad", cantidad: 3 },
      { codigo: "J30", nombre: "Juego B", tipo: "juego", componentes: [{ codigo: "U20", cantidad: 1 }] },
      { codigo: "J40", nombre: "Juego C", tipo: "juego", componentes: [{ codigo: "J30", cantidad: 1 }] },
      { codigo: "J50", nombre: "Juego D", tipo: "juego", componentes: [{ codigo: "J10", cantidad: 1 }] },
    ],
  };
  const result = plan(raw, {}, null);
  const byCode = new Map(result.items.map((i) => [i.product.codigo, i.accion]));
  assert.equal(byCode.get("J10"), "omitir");
  assert.equal(byCode.get("U20"), "crear");
  assert.equal(byCode.get("J30"), "crear");
  assert.equal(byCode.get("J40"), "omitir", "juego dentro de juego");
  assert.equal(byCode.get("J50"), "omitir", "su componente fue omitido");
  assert.ok(result.problems.some((p) => p.tipo === "componente-inexistente" && p.mensaje.includes("NOEXISTE")));
  assert.ok(result.problems.some((p) => p.tipo === "juego-anidado"));
});

test("existentes: mismo código actualiza; papelera y cambio de tipo se omiten; componente del inventario sirve", () => {
  const existing: Record<string, ExistingItem> = {
    "743": { id: "i1", name: "Puff", isCombo: false, inTrash: false, units: 40 },
    "527": { id: "i2", name: "Lounge", isCombo: false, inTrash: false, units: 0, reservas: 2 },
    "900": { id: "i3", name: "Mesa", isCombo: false, inTrash: true, units: 1 },
  };
  const result = plan({ ...base, productos: [...base.productos, { codigo: "900", nombre: "Mesa baja" }] }, existing);
  const accion = new Map(result.items.map((i) => [i.product.codigo, i.accion]));
  assert.equal(accion.get("743"), "actualizar");
  assert.equal(accion.get("527"), "omitir", "era unidad con reservas y el archivo la trae como juego: no se convierte");
  assert.ok(result.problems.some((p) => p.tipo === "juego-no-convertible" && p.nivel === "error" && p.codigo === "527"), "aviso bloqueante en la vista previa");
  assert.equal(accion.get("900"), "omitir");
  assert.ok(result.problems.some((p) => p.tipo === "sku-papelera"));
  const withStock = plan({ productos: [{ codigo: "J1X", nombre: "Juego X", tipo: "juego", componentes: [{ codigo: "743", cantidad: 2 }] }] }, existing, null);
  assert.equal(withStock.items[0].accion, "crear", "el componente existe en el inventario");
});

test("fotos: faltante, sobrante y sin ZIP", () => {
  const withZip = plan(base, {}, ["743.jpg", "extra.png"]);
  assert.ok(withZip.problems.some((p) => p.tipo === "foto-faltante" && p.codigo === "527"));
  assert.ok(withZip.problems.some((p) => p.tipo === "foto-sobrante" && p.mensaje.includes("extra.png")));
  assert.equal(withZip.summary.fotos, 1);
  const noZip = plan(base, {}, null);
  assert.ok(noZip.problems.some((p) => p.tipo === "foto-sin-zip"));
  const byCode = plan({ productos: [{ codigo: "743", nombre: "Puff", foto: null }] }, {}, ["743.webp"]);
  assert.equal(byCode.summary.fotos, 1, "sin «foto» se busca <codigo>.<ext>");
});

test("descripción pública: medidas, capacidad y descripción, con tope de 600", () => {
  assert.equal(buildPublicDescription({ medidas: "1.60x0.75", capacidad: "8 personas", descripcion: "Sofá con mesa." }).text, "Sofá con mesa.");
  // Lo que no entra en los campos propios (no es un número / es muy largo) se conserva en la descripción.
  assert.equal(buildPublicDescription({ medidas: "x".repeat(70), capacidad: "para muchos", descripcion: null }).text, `Medidas: ${"x".repeat(70)}. Capacidad: para muchos.`);
  assert.deepEqual(catalogSpecs({ medidas: " Ø 1,40  m ", capacidad: "10 personas" }), { capacity: 10, dimensions: "Ø 1,40 m" });
  assert.deepEqual(catalogSpecs({ medidas: null, capacidad: "varias" }), { capacity: null, dimensions: null });
  assert.equal(buildPublicDescription({ medidas: null, capacidad: null, descripcion: null }).text, null);
  const long = buildPublicDescription({ medidas: null, capacidad: null, descripcion: "x".repeat(900) });
  assert.equal(long.text!.length, 600);
  assert.ok(long.truncated);
});

// ── ZIP ─────────────────────────────────────────────────────────────────────

const jpeg = async (width = 3000, height = 2000) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#d33" } }).jpeg().toBuffer());

test("ZIP válido: acepta fotos, ignora basura de Mac y avisa de lo que no es imagen", async () => {
  const zip = zipSync({
    "527.jpg": await jpeg(100, 100),
    "carpeta/743.JPG": await jpeg(100, 100),
    "__MACOSX/._527.jpg": strToU8("basura"),
    ".DS_Store": strToU8("x"),
    "falsa.jpg": strToU8("esto no es una imagen, es texto renombrado"),
    "notas.txt": strToU8("hola"),
  });
  const read = readPhotoZip(zip);
  assert.deepEqual([...read.photos.keys()].sort(), ["527.jpg", "743.jpg"]);
  assert.equal(read.problems.filter((p) => p.tipo === "foto-invalida").length, 2);
});

test("ZIP malicioso: ../, rutas absolutas, exceso de archivos y no-ZIP se rechazan", async () => {
  const img = await jpeg(50, 50);
  assert.throws(() => readPhotoZip(zipSync({ "../../etc/evil.jpg": img })), ImportZipError);
  assert.throws(() => readPhotoZip(zipSync({ "a/../../evil.jpg": img })), ImportZipError);
  assert.throws(() => readPhotoZip(zipSync({ "/abs/evil.jpg": img })), ImportZipError);
  assert.throws(() => readPhotoZip(zipSync({ "C:\\windows\\evil.jpg": img })), ImportZipError);
  const many: Record<string, Uint8Array> = {};
  for (let i = 0; i < 401; i += 1) many[`f${i}.jpg`] = img;
  assert.throws(() => readPhotoZip(zipSync(many)), /más de 400/);
  assert.throws(() => readPhotoZip(strToU8("no soy un zip, ni de lejos")), ImportZipError);
});

test("fotos: se redimensionan a 1600 px y se guardan como WebP ≤ 2 MB", async () => {
  const prepared = await preparePhoto(await jpeg(4000, 2500));
  assert.ok(prepared);
  assert.equal(prepared.mime, "image/webp");
  assert.ok(prepared.data.byteLength <= 2 * 1024 * 1024);
  const meta = await sharp(prepared.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width!, meta.height!), 1600);
  assert.equal(await preparePhoto(strToU8("no es imagen")), null);
});

// ── Planilla y plantilla ────────────────────────────────────────────────────

test("plantilla: .xlsx y .csv traen las columnas exactas, un ejemplo y las instrucciones", () => {
  const headers = importHeaders(productos);
  assert.deepEqual(headers, ["codigo", "nombre", "categoria", "subcategoria", "tipo", "precio", "cobro", "precios_dias", "cantidad", "deposito", "ubicacion", "medidas", "capacidad", "descripcion", "componentes", "foto", "pagina", "dudas"]);
  const xlsx = templateXlsx(productos);
  const rows = readXlsx(xlsx, "Productos");
  assert.deepEqual(rows[0], headers);
  assert.equal(rows[1][0], "527");
  assert.equal(rows.length, 2, "encabezado + una fila de ejemplo");
  const instructions = readXlsx(xlsx, "Instrucciones");
  assert.equal(instructions[0][0], "Instrucciones");
  assert.ok(instructions.some((row) => row[0] === "componentes"));
  const csv = templateCsv(productos);
  assert.ok(csv.startsWith("﻿codigo,nombre"), "CSV con BOM UTF-8");
  assert.deepEqual(parseCsv(csv)[0], headers);
});

test("planilla: .xlsx y .csv completos se leen igual y la fila de ejemplo no se importa", () => {
  const headers = importHeaders(productos);
  const row = (values: Record<string, string>) => headers.map((key) => values[key] ?? "");
  const matrix = [
    headers,
    ...productos.columns.length ? [productos.columns.map((c) => c.example)] : [],
    row({ codigo: "743", nombre: "Puff, azul", categoria: "Sector living", precio: "90000", cantidad: "40" }),
    row({ codigo: "527", nombre: "Lounge Oslo", tipo: "juego", precio: "660.000", componentes: "743x2", capacidad: "8 \"personas\"" }),
  ];
  const csvRead = readSheetFile(productos, new TextEncoder().encode(buildCsv(matrix, ";")));
  assert.ok(csvRead.ok);
  assert.equal(csvRead.rows.length, 2);
  assert.equal(csvRead.rows[0].nombre, "Puff, azul");
  assert.equal(csvRead.rows[1].capacidad, '8 "personas"');
  const xlsxRead = readSheetFile(productos, buildXlsx([{ name: "Productos", rows: matrix }]));
  assert.ok(xlsxRead.ok);
  assert.deepEqual(xlsxRead.rows, csvRead.rows);
  const bad = readSheetFile(productos, new TextEncoder().encode("codigo,nombre\n1,2\n"));
  assert.equal(bad.ok, false);
});

// ── Los tres caminos, una sola vista previa ─────────────────────────────────

test("planilla, JSON de ChatGPT e IA de LedBox producen la misma vista previa", async () => {
  const headers = importHeaders(productos);
  const fromJson = plan(base);
  // Planilla: las mismas filas pasadas por CSV.
  const matrix = [
    headers,
    ...base.productos.map((p) =>
      headers.map((key) => {
        const value = (p as Record<string, unknown>)[key];
        if (key === "componentes") return (p.componentes as Array<{ codigo: string; cantidad: number }>).map((c) => `${c.codigo}x${c.cantidad}`).join("; ");
        return value === null || value === undefined ? "" : String(value);
      }),
    ),
  ];
  const sheet = readSheetFile(productos, new TextEncoder().encode(buildCsv(matrix)));
  assert.ok(sheet.ok);
  const fromSheet = plan({ ...base, productos: sheet.rows });
  // IA: un proveedor falso devuelve el mismo catálogo (con cercas de markdown).
  const raw = await analizarImportacion(productos, "texto del catálogo", {
    id: "falso",
    label: "falso",
    analizar: async () => "```json\n" + JSON.stringify(base) + "\n```",
  });
  const fromIa = plan(raw);
  const strip = (p: ReturnType<typeof plan>) => ({ summary: p.summary, problems: p.problems.map((x) => [x.nivel, x.tipo, x.codigo, x.mensaje]), items: p.items.map((i) => [i.product.codigo, i.accion, i.esCombo, i.foto, i.publicDescription]) });
  assert.deepEqual(strip(fromSheet), strip(fromJson));
  assert.deepEqual(strip(fromIa), strip(fromJson));
});

test("la IA no manda nada afuera en la demo: la ruta usa el punto central de salidas", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/admin/import/[modulo]/route.ts", "utf8");
  assert.match(route, /from "@\/lib\/server\/demo-sandbox"/);
  assert.match(route, /context\.demo \|\| !\("ok" in \(await salidaPermitida\(\{ organizationId: context\.organizationId, canal: "ia" \}\)\)\)\) return fail\("La IA no está disponible en la demo\."/);
  assert.match(route, /cuotaArchivosOk\(context\.organizationId, bytes\)/);
});

// ── Prompt, registro y encabezado ───────────────────────────────────────────

test("el prompt para ChatGPT incluye las reglas del módulo", () => {
  const prompt = productos.chatgptPrompt;
  for (const piece of ["juego", "componentes", "<codigo>.jpg", "fotos.zip", "PYG", "entero", "null", "dudas", "NO inventes", 'cobro: "evento"'.replace("cobro: ", ""), '"cobro": "dia" (precio por día de alquiler) salvo que el catálogo diga que el precio es total por evento']) {
    assert.ok(prompt.includes(piece), `falta «${piece}» en el prompt`);
  }
  for (const key of importHeaders(productos)) assert.ok(prompt.includes(`"${key}"`) || prompt.includes(key), `el prompt no nombra ${key}`);
});

test("registro: solo Productos está implementado; gastos, clientes y stock quedan declarados", () => {
  assert.equal(importModule("productos")?.id, "productos");
  for (const id of ["gastos", "clientes", "movimientos-stock"] as const) {
    assert.equal(IMPORT_MODULES[id].estado, "planificado");
    assert.equal(importModule(id), null);
  }
  assert.equal(importModule("../etc"), null);
});

test("el encabezado ya no tiene el botón de Carga con IA y la pantalla de Inventario tiene Importar", () => {
  const shell = repoFile("components/admin/AdminShell.tsx");
  assert.doesNotMatch(shell, /AdminCargaIa|openCarga|canWriteCarga/);
  assert.throws(() => repoFile("components/admin/AdminCargaIaButton.tsx"));
  const inventario = repoFile("components/admin/modules/InventarioModule.tsx");
  assert.match(inventario, /canImportCatalog\(role\)/);
  assert.match(inventario, /Importar\n\s*<\/AdminButton>/, "el encabezado de Inventario dice «Importar»");
  const route = repoFile("app/api/admin/import/[modulo]/route.ts");
  assert.match(route, /canImportCatalog/);
  assert.match(route, /rateLimit\(/);
  assert.match(route, /requireAdminContext\(module\.capability\)/);
  assert.doesNotMatch(route, /console\.log/);
});

test("catálogo real: precio null es aviso (no bloquea), códigos con sufijo o SC-n valen y las dudas se agrupan por motivo", () => {
  const result = plan({
    productos: [
      { codigo: "625-b", nombre: "Camino de mesa", precio: null, dudas: "No se lee el precio" },
      { codigo: "129-c", nombre: "Servilleta", precio: null, dudas: null },
      { codigo: "SC-1", nombre: "Toldo sin código", precio: null, dudas: "El código no figura en el catálogo" },
      { codigo: "SC-2", nombre: "Mantel", precio: 5000, dudas: "Foto borrosa" },
    ],
  }, {}, null);
  assert.equal(result.summary.errores, 0, "ningún error: se importan los 4");
  assert.equal(result.summary.crear, 4);
  const ceros = result.problems.filter((p) => p.tipo === "precio-cero");
  assert.equal(ceros.length, 3);
  assert.ok(ceros.every((p) => p.nivel === "aviso" && p.mensaje.includes("Consultar")));
  const parsed = normalizeCatalog({ productos: [{ codigo: "625-b", nombre: "Camino", precio: null }] });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.doc.productos[0].precio, null);
  const dudas = result.problems.filter((p) => p.tipo === "duda");
  assert.deepEqual(dudas.map((d) => d.motivo).sort(), ["codigo", "foto", "precio"]);
  assert.equal(dudaMotivo("Cantidad de unidades dudosa"), "cantidad");
  assert.equal(dudaMotivo("No sé qué incluye el juego"), "componentes");
  assert.equal(dudaMotivo("algo raro"), "otro");
  assert.ok(Object.keys(DUDA_MOTIVO_LABEL).includes("otro"));
});

test("fotos compartidas: varias fichas pueden apuntar al mismo archivo", () => {
  const result = plan({ productos: [{ codigo: "10", nombre: "Silla A", foto: "silla.jpg" }, { codigo: "11", nombre: "Silla B", foto: "silla.jpg" }] }, {}, ["silla.jpg"]);
  assert.equal(result.summary.fotos, 2);
  assert.equal(result.problems.filter((p) => p.nivel === "error").length, 0);
  assert.ok(!result.problems.some((p) => p.tipo === "foto-sobrante"));
});

test("la aplicación responde en NDJSON con progreso y la vista previa filtra dudas por motivo", () => {
  const route = repoFile("app/api/admin/import/[modulo]/route.ts");
  assert.match(route, /application\/x-ndjson/);
  assert.match(route, /progreso/);
  const panel = repoFile("components/admin/AdminImportPanel.tsx");
  assert.match(panel, /DUDA_MOTIVO_LABEL/);
  assert.match(panel, /Buscar en las dudas/);
  assert.match(panel, /progreso/);
});

// ── Pendientes de la carga real (juego incompleto, unidad → juego, precio a consultar, categorías) ──

test("cantidad null sigue creando 1 unidad (decisión del dueño)", () => {
  const result = plan({ productos: [{ codigo: "A1", nombre: "Plato", cantidad: null }] });
  assert.equal(result.items[0].unidades, 1);
  assert.equal(result.items[0].esCombo, false);
});

test("juego sin componentes: se importa como juego incompleto, sin stock propio, y la vista previa lo anuncia", () => {
  const result = plan({ productos: [{ codigo: "PK-1", nombre: "Juego de mesa", tipo: "juego", cantidad: 12, componentes: [] }] });
  const item = result.items[0];
  assert.equal(item.esCombo, true);
  assert.equal(item.incompleto, true);
  assert.equal(item.unidades, 0, "un juego no tiene unidades propias, ni aunque traiga cantidad");
  assert.equal(item.accion, "crear");
  assert.equal(result.summary.incompletos, 1);
  const warning = result.problems.find((p) => p.tipo === "juego-sin-componentes");
  assert.equal(warning?.nivel, "aviso");
  assert.match(warning!.mensaje, /juego incompleto/);
  assert.match(warning!.mensaje, /no se puede reservar/);
});

test("juego sin componentes sobre una unidad existente la conserva como unidad (no la convierte)", () => {
  const result = plan({ productos: [{ codigo: "743", nombre: "Puff", tipo: "juego", componentes: [] }] }, { "743": { id: "i1", name: "Puff", isCombo: false, inTrash: false, units: 3 } });
  assert.equal(result.items[0].esCombo, false);
  assert.equal(result.items[0].convertir, false);
  assert.equal(result.items[0].accion, "actualizar");
});

test("juego incompleto existente: con piezas en el archivo se completa; sin piezas sigue incompleto; un combo completo conserva las suyas", () => {
  const incomplete: Record<string, ExistingItem> = { "PK-1": { id: "g1", name: "Juego", isCombo: false, incompleto: true, inTrash: false, units: 0 }, "743": { id: "i1", name: "Puff", isCombo: false, inTrash: false, units: 5 } };
  const completes = plan({ productos: [{ codigo: "PK-1", nombre: "Juego", tipo: "juego", componentes: [{ codigo: "743", cantidad: 2 }] }] }, incomplete, null);
  assert.equal(completes.items[0].accion, "actualizar");
  assert.equal(completes.items[0].incompleto, false);
  assert.equal(completes.items[0].convertir, false);
  const stays = plan({ productos: [{ codigo: "PK-1", nombre: "Juego", tipo: "juego", componentes: [] }] }, incomplete, null);
  assert.equal(stays.items[0].incompleto, true);
  assert.equal(stays.items[0].accion, "actualizar");
  const full = plan({ productos: [{ codigo: "PK-2", nombre: "Combo", tipo: "juego", componentes: [] }] }, { "PK-2": { id: "g2", name: "Combo", isCombo: true, inTrash: false, units: 0 } }, null);
  assert.equal(full.items[0].incompleto, false, "no pasa a incompleto por reimportar sin piezas");
  assert.equal(full.items[0].accion, "actualizar");
});

test("unidad existente + juego con componentes: se convierte sin reservas ni historial; con cualquiera de los dos es bloqueante", () => {
  const raw = { productos: [{ codigo: "743", nombre: "Puff", cantidad: 5 }, { codigo: "J1", nombre: "Juego puff", tipo: "juego", componentes: [{ codigo: "743", cantidad: 2 }] }] };
  const clean = plan(raw, { J1: { id: "j", name: "Juego puff", isCombo: false, inTrash: false, units: 2, reservas: 0, unidadesConHistorial: 0 } }, null);
  const converted = clean.items.find((i) => i.product.codigo === "J1")!;
  assert.equal(converted.accion, "actualizar");
  assert.equal(converted.convertir, true);
  assert.equal(clean.summary.convertidos, 1);
  assert.ok(clean.problems.some((p) => p.tipo === "juego-convertido" && p.nivel === "aviso"));
  for (const blocker of [{ reservas: 1 }, { unidadesConHistorial: 1 }]) {
    const blocked = plan(raw, { J1: { id: "j", name: "Juego puff", isCombo: false, inTrash: false, units: 2, ...blocker } }, null);
    const item = blocked.items.find((i) => i.product.codigo === "J1")!;
    assert.equal(item.accion, "omitir");
    assert.equal(item.convertir, false);
    const error = blocked.problems.find((p) => p.tipo === "juego-no-convertible");
    assert.equal(error?.nivel, "error");
    assert.match(error!.mensaje, /no se puede convertir en juego/);
  }
});

test("precio null o 0: aviso con el texto «a consultar» y «falta precio»; un precio real no avisa", () => {
  const result = plan({ productos: [{ codigo: "A1", nombre: "Sin dato", precio: null }, { codigo: "A2", nombre: "Cero", precio: 0 }, { codigo: "A3", nombre: "Con precio", precio: 5000 }] }, {}, null);
  const warnings = result.problems.filter((p) => p.tipo === "precio-cero");
  assert.deepEqual(warnings.map((p) => p.codigo), ["A1", "A2"]);
  for (const warning of warnings) {
    assert.match(warning.mensaje, /a consultar/);
    assert.match(warning.mensaje, /Consultar/);
    assert.match(warning.mensaje, /falta precio/);
  }
});

test("parser de categorias: nombre normalizado, orden, foto, repetidas e inválidas como aviso", () => {
  const parsed = normalizeCatalog({
    productos: [{ codigo: "A1", nombre: "Plato" }],
    categorias: [
      { nombre: "Platos", foto: "cat-platos.jpg", orden: 3 },
      { nombre: "  vajilla / copas ", foto: null },
      { nombre: "PLATOS", foto: "otra.jpg" },
      { nombre: "", foto: "x.jpg" },
      { nombre: "Mesas", orden: -4 },
      "texto suelto",
    ],
  });
  assert.ok(parsed.ok);
  const categories = parsed.value.doc.categorias;
  assert.deepEqual(categories.map((c) => [c.categoria, c.subcategoria, c.foto, c.orden]), [
    ["Platos", null, "cat-platos.jpg", 3],
    ["vajilla", "copas", null, null],
    ["Mesas", null, null, null],
  ]);
  const kinds = parsed.value.problems.map((p) => p.tipo);
  assert.ok(kinds.includes("categoria-repetida"));
  assert.equal(kinds.filter((k) => k === "categoria-invalida").length, 3);
  assert.equal(parsed.value.problems.some((p) => p.nivel === "error"), false, "las categorías nunca bloquean");
  assert.deepEqual(normalizeCatalog({ productos: [{ codigo: "A1", nombre: "Plato" }] }).ok && (normalizeCatalog({ productos: [{ codigo: "A1", nombre: "Plato" }] }) as { value: { doc: { categorias: unknown[] } } }).value.doc.categorias, [], "sin sección: lista vacía");
});

test("vista previa: «N fotos de categoría» cruza el ZIP por nombre exacto y avisa las que faltan", () => {
  const parsed = normalizeCatalog({
    productos: [{ codigo: "A1", nombre: "Plato", foto: null }],
    categorias: [{ nombre: "Platos", foto: "cat-platos.jpg" }, { nombre: "Copas", foto: "CAT-COPAS.JPG" }, { nombre: "Mesas", foto: "cat-mesas.jpg" }],
  });
  assert.ok(parsed.ok);
  const result = planCatalog({ products: parsed.value.doc.productos, parseProblems: parsed.value.problems, existing: new Map(), photoNames: new Set(["cat-platos.jpg", "cat-copas.jpg"]), categories: parsed.value.doc.categorias });
  assert.equal(result.summary.fotosCategoria, 2);
  assert.ok(result.problems.some((p) => p.tipo === "categoria-foto-faltante" && p.mensaje.includes("cat-mesas.jpg")));
  assert.equal(result.problems.some((p) => p.tipo === "foto-sobrante"), false, "las fotos de categoría no son sobrantes");
  const noZip = planCatalog({ products: parsed.value.doc.productos, existing: new Map(), photoNames: null, categories: parsed.value.doc.categorias });
  assert.equal(noZip.summary.fotosCategoria, 0);
});
