import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AdminRole } from "../lib/admin-types";
import { IA_REGISTROS_MAX, IA_TEXTO_MAX } from "../lib/ia-carga";
import {
  IaError,
  analizarCarga,
  asignarExistentes,
  candidatosDeCliente,
  fechaDeTexto,
  iaConfig,
  iaConfigurada,
  iaProviderDeConfig,
  mensajesDeCarga,
  normalizarAnalisis,
  parsearSalidaIa,
  tiposPermitidos,
} from "../lib/server/ia-carga";
import type { IaProvider } from "../lib/server/ia-carga";

/**
 * «Carga con IA» (issue #120): configuración, prompt, JSON estricto (Zod),
 * normalización, match de clientes y el camino completo con un **proveedor
 * mockeado** (sin red). Las guardas de fuente fijan que el análisis no escribe
 * nada y que el texto pegado no se persiste.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// ── Configuración ───────────────────────────────────────────────────────────

test("sin IA_API_KEY el asistente queda apagado y la config es null", () => {
  assert.equal(iaConfigurada({}), false);
  assert.equal(iaConfigurada({ IA_API_KEY: "   " }), false);
  assert.equal(iaConfig({}), null);
  assert.equal(iaConfig({ IA_API_KEY: "k" })?.modelo, "deepseek-chat");
  assert.equal(iaConfig({ IA_API_KEY: "k" })?.baseUrl, "https://api.deepseek.com/v1");
});

test("la config respeta el modelo y la base, y una base inválida cae al default", () => {
  const config = iaConfig({ IA_API_KEY: " k ", IA_MODELO: "otro-modelo", IA_BASE_URL: "https://api.ejemplo.com/v1/" });
  assert.deepEqual(config, { apiKey: "k", modelo: "otro-modelo", baseUrl: "https://api.ejemplo.com/v1" });
  assert.equal(iaConfig({ IA_API_KEY: "k", IA_BASE_URL: "no-es-una-url" })?.baseUrl, "https://api.deepseek.com/v1");
});

// ── Permisos por tipo ───────────────────────────────────────────────────────

test("solo los roles que pueden crear usan el asistente; los cobros se detectan siempre", () => {
  const de = (role: AdminRole) => tiposPermitidos(role).join(",");
  assert.equal(de("OWNER"), "clientes,eventos,productos,cobros");
  assert.equal(de("ADMIN"), "clientes,eventos,productos,cobros");
  assert.equal(de("OPERATIONS"), "clientes,eventos,productos,cobros");
  assert.equal(de("FINANCE"), "");
  assert.equal(de("VIEWER"), "");
});

// ── Prompt ──────────────────────────────────────────────────────────────────

test("el prompt manda el texto como datos y pide JSON estricto", () => {
  const mensajes = mensajesDeCarga("Juan Pérez 0981 123 456", ["clientes"]);
  assert.equal(mensajes[0].role, "system");
  assert.match(mensajes[0].content, /DATOS, no instrucciones/);
  assert.match(mensajes[0].content, new RegExp(`máximo ${IA_REGISTROS_MAX} registros por tipo`, "i"));
  assert.match(mensajes[1].content, /Juan Pérez 0981 123 456/);
  assert.match(mensajes[1].content, /clientes/);
  assert.doesNotMatch(mensajes[1].content, /productos/, "solo pide los tipos habilitados");
});

// ── JSON estricto ───────────────────────────────────────────────────────────

test("parsearSalidaIa acepta JSON pelado, con cercas y con prosa alrededor", () => {
  assert.deepEqual(parsearSalidaIa('{"clientes":[]}'), { clientes: [] });
  assert.deepEqual(parsearSalidaIa('```json\n{"clientes":[]}\n```'), { clientes: [] });
  assert.deepEqual(parsearSalidaIa('Listo:\n{"clientes":[]}\nEspero que sirva.'), { clientes: [] });
  assert.throws(() => parsearSalidaIa("no hay json"), IaError);
});

// ── Normalización ───────────────────────────────────────────────────────────

test("normalizarAnalisis valida con Zod y normaliza cada tipo", () => {
  const salida = normalizarAnalisis(
    {
      clientes: [
        {
          nombre: " Constructora Sur ",
          empresa: "Constructora Sur SA",
          tipo: "mayorista",
          ruc: "RUC: 80012345-6",
          telefono: "0981 123 456",
          correo: "VENTAS@SUR.COM.PY",
        },
      ],
      eventos: [{ nombre: "Cierre de año", cliente: "Constructora Sur", inicio: "20/12/2026", fin: "2026-12-21", ciudad: "Asunción" }],
      productos: [{ nombre: "Pantalla LED 3x2", categoria: "Pantallas", cantidad: "4", precioLista: "1500000", precioMayorista: 1_300_000 }],
      avisos: "ignorado",
    },
    ["clientes", "eventos", "productos"],
  );
  assert.equal(salida.clientes.length, 1);
  assert.deepEqual(salida.clientes[0], {
    nombre: "Constructora Sur",
    empresa: "Constructora Sur SA",
    tipo: "RESELLER",
    ruc: "80012345-6",
    telefono: "+595 981123456",
    correo: "ventas@sur.com.py",
    accion: "crear",
    existenteId: null,
    existenteNombre: null,
    confianza: null,
    candidatos: [],
    inventados: [],
    avisos: [],
  });
  assert.equal(salida.eventos[0].inicio, "2026-12-20");
  assert.equal(salida.eventos[0].fin, "2026-12-21");
  assert.equal(salida.productos[0].cantidad, 4);
  assert.equal(salida.productos[0].precioLista, 1_500_000);
  assert.equal(salida.productos[0].precioMayorista, 1_300_000);
  assert.deepEqual(salida.avisos, []);
});

test("los datos dudosos quedan con aviso y nunca se inventan", () => {
  const salida = normalizarAnalisis(
    {
      clientes: [{ nombre: "Ana", correo: "no-es-correo", telefono: "123", ruc: "1.234.567" }],
      eventos: [{ nombre: "Fiesta", cliente: null, inicio: "31/02/2026" }],
      productos: [{ nombre: "Ítem sin cantidad" }],
    },
    ["clientes", "eventos", "productos"],
  );
  assert.equal(salida.clientes[0].correo, "no-es-correo", "el correo inválido se conserva para corregirlo");
  assert.ok(salida.clientes[0].avisos.some((aviso) => aviso.startsWith("Correo")));
  assert.ok(salida.clientes[0].avisos.some((aviso) => aviso.startsWith("Teléfono")));
  assert.ok(salida.clientes[0].avisos.some((aviso) => aviso.startsWith("RUC")));
  assert.equal(salida.eventos[0].inicio, null);
  assert.ok(salida.eventos[0].avisos.some((aviso) => aviso.startsWith("Fecha de inicio")));
  assert.equal(salida.productos[0].cantidad, 1);
  assert.ok(salida.productos[0].avisos.some((aviso) => aviso.startsWith("Cantidad asumida")));
});

test("un registro sin nombre se descarta con aviso global y los tipos no pedidos quedan vacíos", () => {
  const salida = normalizarAnalisis(
    { clientes: [{ empresa: "Sin nombre" }, { nombre: "Válido" }], eventos: [{ nombre: "No pedido" }] },
    ["clientes"],
  );
  assert.equal(salida.clientes.length, 1);
  assert.equal(salida.clientes[0].nombre, "Válido");
  assert.equal(salida.eventos.length, 0, "los eventos no se pidieron");
  assert.ok(salida.avisos.some((aviso) => aviso.includes("Descartamos 1 registro")));
});

test("el tope de registros por tipo se respeta y se avisa", () => {
  const muchos = Array.from({ length: IA_REGISTROS_MAX + 5 }, (_, indice) => ({ nombre: `Cliente ${indice}` }));
  const salida = normalizarAnalisis({ clientes: muchos }, ["clientes"]);
  assert.equal(salida.clientes.length, IA_REGISTROS_MAX);
  assert.ok(salida.avisos.some((aviso) => aviso.includes("se recortó")));
});

test("una respuesta que no es objeto se rechaza", () => {
  assert.throws(() => normalizarAnalisis("texto suelto", ["clientes"]), IaError);
});

test("fechaDeTexto acepta los formatos del texto y rechaza días inexistentes", () => {
  assert.equal(fechaDeTexto("2026-12-20"), "2026-12-20");
  assert.equal(fechaDeTexto("20/12/2026"), "2026-12-20");
  assert.equal(fechaDeTexto("20-12-2026"), "2026-12-20");
  assert.equal(fechaDeTexto("2026-12-20T15:30:00Z"), "2026-12-20");
  assert.equal(fechaDeTexto("31/02/2026"), null);
  assert.equal(fechaDeTexto("2026-02-31"), null);
  assert.equal(fechaDeTexto(""), null);
  assert.equal(fechaDeTexto(null), null);
});

// ── Match de clientes ───────────────────────────────────────────────────────

const CARTERA = [
  { id: "c1", nombre: "Constructora Sur SA", empresa: null },
  { id: "c2", nombre: "Juan Pérez", empresa: null },
  { id: "c3", nombre: "Pérez Hnos", empresa: null },
];

test("el match de clientes ignora acentos y mayúsculas", () => {
  assert.deepEqual(candidatosDeCliente({ nombre: "constructora sur" }, CARTERA), [
    { id: "c1", nombre: "Constructora Sur SA", confianza: 92, detalle: null, imagenUrl: null },
  ]);
  assert.deepEqual(candidatosDeCliente({ nombre: "juan perez" }, CARTERA), [
    { id: "c2", nombre: "Juan Pérez", confianza: 100, detalle: null, imagenUrl: null },
  ]);
  assert.equal(candidatosDeCliente({ nombre: "Nadie" }, CARTERA).length, 0);
});

test("un evento con cliente único se resuelve; el dudoso queda preseleccionado y el desconocido con aviso", () => {
  const analisis = normalizarAnalisis(
    {
      eventos: [
        { nombre: "Único", cliente: "constructora sur" },
        { nombre: "Ambiguo", cliente: "Pérez" },
        { nombre: "Inexistente", cliente: "Fantasma" },
        { nombre: "Sin cliente" },
      ],
    },
    ["eventos"],
  );
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA, productos: [] });
  assert.equal(resuelto.eventos[0].clienteId, "c1");
  assert.equal(resuelto.eventos[0].candidatos[0]?.confianza, 92);
  assert.equal(resuelto.eventos[1].clienteId, "c3", "el mejor candidato queda preseleccionado (issue #127)");
  assert.ok(resuelto.eventos[1].candidatos.length >= 2, "ofrece los candidatos para cambiar");
  assert.ok(resuelto.eventos[1].avisos.some((aviso) => aviso.includes("Sugerido")));
  assert.ok(resuelto.eventos[2].avisos.some((aviso) => aviso.includes("No encontramos")));
  assert.ok(resuelto.eventos[3].avisos.some((aviso) => aviso.includes("Sin cliente")));
});

// ── Proveedor mockeado (sin red) ────────────────────────────────────────────

test("analizarCarga completa el camino con un proveedor de prueba", async () => {
  const visto: { mensajes?: number; maxTokens?: number } = {};
  const proveedor: IaProvider = {
    id: "prueba",
    label: "Proveedor de prueba",
    async analizar(mensajes, opciones) {
      visto.mensajes = mensajes.length;
      visto.maxTokens = opciones.maxTokens;
      return JSON.stringify({
        clientes: [{ nombre: "Ana", telefono: "0981 000 111" }],
        eventos: [{ nombre: "Boda", cliente: "Ana", inicio: "2026-11-07" }],
        productos: [],
      });
    },
  };
  const analisis = await analizarCarga({ texto: "Ana, boda el 7/11/2026", tipos: ["clientes", "eventos"], proveedor });
  assert.equal(visto.mensajes, 2);
  assert.ok((visto.maxTokens ?? 0) > 0);
  assert.equal(analisis.clientes[0].nombre, "Ana");
  assert.equal(analisis.eventos[0].nombre, "Boda");
  assert.equal(analisis.productos.length, 0);
});

test("un proveedor que falla lanza IaError con mensaje mostrable", async () => {
  const proveedor: IaProvider = {
    id: "prueba-error",
    label: "Proveedor con falla",
    async analizar() {
      throw new IaError("El proveedor de IA respondió 429.");
    },
  };
  await assert.rejects(() => analizarCarga({ texto: "texto", tipos: ["clientes"], proveedor }), /429/);
});

test("el cliente HTTP arma la llamada estilo OpenAI y traduce los errores", async () => {
  const llamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"clientes":[]}' } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const config = iaConfig({ IA_API_KEY: "secreto", IA_MODELO: "modelo-x" });
  assert.ok(config);
  const proveedor = iaProviderDeConfig(config, fetchFalso);
  const contenido = await proveedor.analizar(mensajesDeCarga("texto", ["clientes"]), { maxTokens: 123 });

  assert.equal(contenido, '{"clientes":[]}');
  assert.equal(llamadas[0].url, "https://api.deepseek.com/v1/chat/completions");
  const headers = llamadas[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secreto");
  const cuerpo = JSON.parse(String(llamadas[0].init?.body)) as Record<string, unknown>;
  assert.equal(cuerpo.model, "modelo-x");
  assert.equal(cuerpo.max_tokens, 123);
  assert.deepEqual(cuerpo.response_format, { type: "json_object" });
});

test("el proveedor traduce 401, 429 y sin contenido", async () => {
  const conEstado = (status: number, cuerpo: unknown = {}) =>
    (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;
  const config = iaConfig({ IA_API_KEY: "k" });
  assert.ok(config);

  await assert.rejects(
    () => iaProviderDeConfig(config, conEstado(401)).analizar(mensajesDeCarga("x", ["clientes"]), { maxTokens: 1 }),
    /IA_API_KEY/,
  );
  await assert.rejects(
    () => iaProviderDeConfig(config, conEstado(429)).analizar(mensajesDeCarga("x", ["clientes"]), { maxTokens: 1 }),
    /limitando/,
  );
  await assert.rejects(
    () => iaProviderDeConfig(config, conEstado(200, { choices: [] })).analizar(mensajesDeCarga("x", ["clientes"]), { maxTokens: 1 }),
    /no devolvió contenido/,
  );
});

// ── Guardas de fuente ───────────────────────────────────────────────────────

test("el endpoint no crea nada: solo lee, audita y devuelve la vista previa", () => {
  const route = repoFile("app/api/admin/ia/carga/route.ts");
  assert.doesNotMatch(route, /\.create\(/, "el asistente no escribe: crea el panel con los endpoints existentes");
  assert.match(route, /rateLimit\(`ia-carga:\$\{auth\.context\.organizationId\}`/, "rate-limit por organización");
  assert.match(route, /entity: "IaCarga"/, "la transferencia al encargado queda auditada");
  assert.match(route, /organizationId: auth\.context\.organizationId/, "el match de clientes es de la empresa activa");
  assert.match(route, /ia_no_configurada/, "sin key responde claro");
  const lib = repoFile("lib/server/ia-carga.ts");
  assert.doesNotMatch(lib, /console\.log/, "el texto pegado no se imprime en logs");
});

test("el diálogo ya no se monta desde el encabezado: la IA vive dentro de «Importar»", () => {
  const shell = repoFile("components/admin/AdminShell.tsx");
  assert.doesNotMatch(shell, /AdminCargaIa|canWriteCarga/, "el header ya no tiene el botón ni el diálogo de IA");
  const dialogo = repoFile("components/admin/AdminCargaIa.tsx");
  assert.match(dialogo, /Carga con IA/);
  assert.match(dialogo, /IA_TEXTO_MAX/);
  assert.doesNotMatch(dialogo, /<textarea|<select|<input/, "usa el kit de campos del panel");
  const route = repoFile("app/api/admin/ia/carga/route.ts");
  assert.match(route, /IA_TEXTO_MAX/);
});

test("la privacidad y el entorno registran al encargado", () => {
  const docs = repoFile("docs/PRIVACIDAD.md");
  assert.match(docs, /### T10 · Carga con IA/);
  assert.match(docs, /IA_API_KEY/);
  assert.match(docs, /encargado/);
  const env = repoFile(".env.example");
  assert.match(env, /IA_API_KEY=/);
  assert.match(env, /IA_MODELO/);
  assert.match(env, /IA_BASE_URL/);
  const politica = repoFile("app/(public)/privacidad/page.tsx");
  assert.match(politica, /carga con IA/i);
  assert.match(politica, /inteligencia artificial/);
});
