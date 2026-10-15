"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizarBusqueda } from "owncoding-ui/utils";
import { adminApiGet, adminSend, newIdempotencyKey, requestAdminRefresh } from "@/lib/admin-api";
import { ADMIN_ROOT_ID } from "@/lib/admin-theme";
import { publicConfig } from "@/lib/public-config";
import { formatMoney } from "@/lib/admin-format";
import { COLLECTED_PAYMENT_METHODS, PAYMENT_METHODS, TERM_PAYMENT_METHODS } from "@/lib/admin-types";
import { canWriteFinance } from "@/lib/admin-policy";
import {
  IA_TEXTO_MAX,
  IA_TIPOS,
  IA_TIPO_LABEL,
  dividirMonto,
  hoyDelPanel,
  parteEsPendiente,
  sumaPartes,
  type IaAnalisis,
  type IaCandidato,
  type IaTipo,
} from "@/lib/ia-carga";
import type { AdminRole } from "@/lib/admin-types";
import type { IaAccionExistente } from "@/lib/ia-carga";
import {
  Combobox,
  DateField,
  EmailField,
  MoneyField,
  NumberField,
  PhoneField,
  RucField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "./AdminFields";
import { AdminBadge, AdminButton, AdminDialog, AdminEmpty, AdminNote } from "./AdminUI";
import { AdminAvatar } from "./AdminAvatar";
import { AdminImageBox } from "./AdminImageBox";

/**
 * «Carga con IA» (issues #120 y #122): el diálogo de pegado, revisión y
 * aplicación.
 *
 * El panel aplica con los **endpoints existentes** (clientes, eventos,
 * productos y el cobro de Finanzas): mismos permisos, mismo aislamiento por
 * empresa y misma auditoría. El análisis server-side no escribe nada y el
 * texto pegado no se persiste (docs/PRIVACIDAD.md T10).
 *
 * #122: cada registro detectado se compara contra lo existente y la persona
 * elige **vincular** o **crear**; los cobros («me pagó X») se registran con
 * `finance.write` y las fechas y montos llegan resueltos y visibles.
 */

type ConfigIa = { configurada: boolean; modelo: string | null; tipos: IaTipo[] };

type ClienteEdit = {
  clave: string;
  incluir: boolean;
  accion: IaAccionExistente;
  existenteId: string;
  existenteNombre: string | null;
  confianza: number | null;
  candidatos: IaCandidato[];
  /** Campos que no están en el texto (issue #126): exigen confirmación. */
  inventados: string[];
  confirmado: boolean;
  nombre: string;
  empresa: string;
  tipo: "FINAL" | "RESELLER";
  ruc: string;
  telefono: string;
  correo: string;
  avisos: string[];
};

type EventoEdit = {
  clave: string;
  incluir: boolean;
  nombre: string;
  clienteNombre: string | null;
  clienteId: string;
  candidatos: IaCandidato[];
  inventados: string[];
  confirmado: boolean;
  inicio: string;
  fin: string;
  lugar: string;
  ciudad: string;
  avisos: string[];
};

type ProductoEdit = {
  clave: string;
  incluir: boolean;
  accion: IaAccionExistente;
  /** Editar precios de un ítem vinculado exige marcarlo (issue #128). */
  actualizarPrecios: boolean;
  existenteId: string;
  existenteNombre: string | null;
  confianza: number | null;
  candidatos: IaCandidato[];
  inventados: string[];
  confirmado: boolean;
  nombre: string;
  categoria: string;
  cantidad: string;
  precioLista: string;
  precioMayorista: string;
  precioMinimo: string;
  avisos: string[];
};

/** Parte de un cobro dividido (issue #128): monto y fecha propia. */
type ParteEdit = { clave: string; monto: string; fecha: string };

type CobroEdit = {
  clave: string;
  incluir: boolean;
  cuentaId: string;
  /** Sin dividir = `null`; dividido, una parte por pago. */
  partes: ParteEdit[] | null;
  clienteId: string;
  clienteNombre: string | null;
  candidatos: IaCandidato[];
  monto: string;
  montoTexto: string | null;
  fecha: string | null;
  fechaTexto: string | null;
  metodo: string;
  referencia: string;
  /** A crédito/plazo (issue #126): no se registra; `vencimiento` estimado. */
  plazo: boolean;
  vencimiento: string | null;
  inventados: string[];
  confirmado: boolean;
  avisos: string[];
};

type ClienteOpcion = { value: string; label: string };

/** Fila creada por el lote: se puede abrir en su módulo y anular (issue #130). */
type FilaResultado = {
  clave: string;
  tipo: "cliente" | "evento" | "producto" | "cobro";
  id: string;
  etiqueta: string;
  /** Cobros: estado real; los cobrados no se cancelan desde Finanzas. */
  estado?: "RECEIVED" | "PENDING";
  anulado?: boolean;
  error?: string;
};

type Resultado = {
  lote: string;
  creados: { clientes: number; eventos: number; productos: number; cobros: number };
  vinculados: { clientes: number; productos: number };
  filas: FilaResultado[];
  errores: string[];
  advertencias: string[];
};

/** Módulo donde vive cada tipo creado (para «Abrir»). */
const RUTA_TIPO: Record<FilaResultado["tipo"], string> = {
  cliente: "/clientes",
  evento: "/eventos",
  producto: "/inventario",
  cobro: "/finanzas",
};
const ETIQUETA_TIPO: Record<FilaResultado["tipo"], string> = {
  cliente: "Cliente",
  evento: "Evento",
  producto: "Producto",
  cobro: "Cobro",
};

const TIPO_CLIENTE: Array<{ value: string; label: string }> = [
  { value: "FINAL", label: "Cliente final" },
  { value: "RESELLER", label: "Mayorista" },
];

/** Métodos que Finanzas acepta para un cobro a plazo (saldo), issue #135. */
const METODOS_PLAZO: string[] = [...TERM_PAYMENT_METHODS];

const METODO_PAGO: Array<{ value: string; label: string }> = PAYMENT_METHODS.map((metodo) => ({
  value: metodo,
  label: metodo,
}));

const aTexto = (valor: number | null | undefined) => (valor === null || valor === undefined ? "" : String(valor));

const aNumero = (valor: string): number => {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
};

const listar = (cantidad: number, singular: string, plural: string) => `${cantidad} ${cantidad === 1 ? singular : plural}`;

/**
 * Avisos del evento/cobro sin los que ya no aplican: «elegí el cliente» cuando
 * quedó resuelto y el detalle del plazo cuando la tarjeta ya lo muestra.
 */
const avisosVigentes = (avisos: string[], clienteId: string): string[] =>
  avisos.filter((aviso) => {
    if (clienteId && /(coincide con varios|Encontramos)/.test(aviso)) return false;
    if (/^A crédito\/plazo/.test(aviso)) return false;
    return true;
  });

/** Opciones de acción+existente en un solo select: `crear` o `vincular:<id>`. */
function opcionesDeAccion(candidatos: IaCandidato[]): ClienteOpcion[] {
  const opciones: ClienteOpcion[] = [{ value: "crear", label: "Crear nuevo" }];
  const vistos = new Set<string>();
  for (const candidato of candidatos) {
    if (vistos.has(candidato.id)) continue;
    vistos.add(candidato.id);
    opciones.push({ value: `vincular:${candidato.id}`, label: `Vincular a «${candidato.nombre}» (${candidato.confianza} %)` });
  }
  return opciones;
}

const seleccionDeAccion = (fila: { accion: IaAccionExistente; existenteId: string }) =>
  fila.accion === "vincular" && fila.existenteId ? `vincular:${fila.existenteId}` : "crear";

/** Imagen del candidato elegido (o del sugerido cuando hay que elegir). */
function imagenDeCandidato(
  fila: { accion: IaAccionExistente; existenteId: string; candidatos: IaCandidato[] },
): string | null {
  const id = fila.accion === "vincular" ? fila.existenteId : fila.candidatos[0]?.id ?? "";
  return fila.candidatos.find((candidato) => candidato.id === id)?.imagenUrl ?? null;
}

/** Diálogo del asistente: entrada, revisión editable y aplicación con confirmación. */
export function AdminCargaIaDialog({ onClose, rol }: { onClose: () => void; rol: AdminRole | null }) {
  const puedeCobrar = canWriteFinance(rol);
  const contador = useRef(0);
  const siguienteClave = (prefijo: string) => {
    contador.current += 1;
    return `${prefijo}-${contador.current}`;
  };

  const [config, setConfig] = useState<ConfigIa | null>(null);
  const [configError, setConfigError] = useState("");
  const [reintento, setReintento] = useState(0);
  const formId = useId();
  const [texto, setTexto] = useState("");
  const [fase, setFase] = useState<"entrada" | "revision" | "listo">("entrada");
  const [analizando, setAnalizando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [clientes, setClientes] = useState<ClienteEdit[]>([]);
  const [eventos, setEventos] = useState<EventoEdit[]>([]);
  const [productos, setProductos] = useState<ProductoEdit[]>([]);
  const [cobros, setCobros] = useState<CobroEdit[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [confirmandoAnular, setConfirmandoAnular] = useState<string | null>(null);
  const [opcionesCliente, setOpcionesCliente] = useState<ClienteOpcion[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const clientSearchRequest = useRef<AbortController | null>(null);
  const [cartera, setCartera] = useState<{ clientes: number; productos: number } | null>(null);
  const [cuentas, setCuentas] = useState<Array<{ id: string; nombre: string; banco: string | null }>>([]);
  const [cargandoCuentas, setCargandoCuentas] = useState(false);

  useEffect(() => {
    let activo = true;
    void (async () => {
      const result = await adminApiGet<ConfigIa>("/api/admin/ia/carga", { fresh: true });
      if (!activo) return;
      if (!result.ok) {
        setConfigError(result.error);
        return;
      }
      setConfig({
        configurada: Boolean(result.data.configurada),
        modelo: result.data.modelo ?? null,
        tipos: result.data.tipos ?? [],
      });
    })();
    return () => {
      activo = false;
    };
  }, [reintento]);

  const incluidos = useMemo(
    () => ({
      clientes: clientes.filter((fila) => fila.incluir).length,
      eventos: eventos.filter((fila) => fila.incluir).length,
      productos: productos.filter((fila) => fila.incluir).length,
      cobros: cobros.filter((fila) => fila.incluir).length,
    }),
    [clientes, eventos, productos, cobros],
  );
  const totalIncluidos = incluidos.clientes + incluidos.eventos + incluidos.productos + incluidos.cobros;
  /**
   * Registros incluidos que bloquean «Aplicar todo»: los escalares marcados
   * (issue #126) que no se confirmaron. El vínculo preseleccionado no bloquea
   * (issue #127): se cambia a un toque si no es.
   */
  const pendientes = [...clientes, ...productos, ...eventos, ...cobros].filter((fila) => {
    if (!fila.incluir) return false;
    const accion = "accion" in fila ? fila.accion : "crear";
    if (accion === "vincular") return false; // lo vinculado no aplica sus datos
    return fila.inventados.length > 0 && !fila.confirmado;
  }).length;

  const actualizarCliente = (clave: string, patch: Partial<ClienteEdit>) =>
    setClientes((actuales) => actuales.map((fila) => (fila.clave === clave ? { ...fila, ...patch } : fila)));
  const actualizarEvento = (clave: string, patch: Partial<EventoEdit>) =>
    setEventos((actuales) => actuales.map((fila) => (fila.clave === clave ? { ...fila, ...patch } : fila)));
  const actualizarProducto = (clave: string, patch: Partial<ProductoEdit>) =>
    setProductos((actuales) => actuales.map((fila) => (fila.clave === clave ? { ...fila, ...patch } : fila)));
  const actualizarCobro = (clave: string, patch: Partial<CobroEdit>) =>
    setCobros((actuales) => actuales.map((fila) => (fila.clave === clave ? { ...fila, ...patch } : fila)));

  /**
   * El cobro (y el evento) acompañan al cliente elegido en el preview (issue
   * #125): al vincular un cliente se encadena su id por nombre; al pasar a
   * «crear», se limpia para que lo resuelva el alta del lote.
   */
  function encadenarCliente(nombre: string, clienteId: string | null) {
    const clave = normalizarBusqueda(nombre);
    setEventos((actuales) =>
      actuales.map((fila) =>
        fila.clienteId === "" && normalizarBusqueda(fila.clienteNombre ?? "") === clave
          ? { ...fila, clienteId: clienteId ?? "", incluir: Boolean(clienteId) }
          : fila,
      ),
    );
    setCobros((actuales) =>
      actuales.map((fila) =>
        fila.clienteId === "" && normalizarBusqueda(fila.clienteNombre ?? "") === clave
          ? {
              ...fila,
              clienteId: clienteId ?? "",
              incluir: Boolean(clienteId) && puedeCobrar && !fila.plazo && aNumero(fila.monto) > 0,
            }
          : fila,
      ),
    );
  }

  /** Duplica una fila del preview con clave nueva (issue #128). */
  function duplicarRegistro<T extends { clave: string }>(fila: T, prefijo: string): T {
    return { ...fila, clave: siguienteClave(prefijo) };
  }

  /** Registros nuevos a mano (issue #128). */
  function agregarCliente() {
    setClientes((actuales) => [
      ...actuales,
      {
        clave: siguienteClave("cliente"),
        incluir: true,
        accion: "crear",
        existenteId: "",
        existenteNombre: null,
        confianza: null,
        candidatos: [],
        inventados: [],
        confirmado: true,
        nombre: "",
        empresa: "",
        tipo: "FINAL",
        ruc: "",
        telefono: "",
        correo: "",
        avisos: [],
      },
    ]);
  }

  function agregarEvento() {
    setEventos((actuales) => [
      ...actuales,
      {
        clave: siguienteClave("evento"),
        incluir: false,
        nombre: "",
        clienteNombre: null,
        clienteId: "",
        candidatos: [],
        inventados: [],
        confirmado: true,
        inicio: "",
        fin: "",
        lugar: "",
        ciudad: "",
        avisos: [],
      },
    ]);
  }

  function agregarProducto() {
    setProductos((actuales) => [
      ...actuales,
      {
        clave: siguienteClave("producto"),
        incluir: true,
        accion: "crear",
        actualizarPrecios: false,
        existenteId: "",
        existenteNombre: null,
        confianza: null,
        candidatos: [],
        inventados: [],
        confirmado: true,
        nombre: "",
        categoria: "General",
        cantidad: "1",
        precioLista: "",
        precioMayorista: "",
        precioMinimo: "",
        avisos: [],
      },
    ]);
  }

  function agregarCobro() {
    setCobros((actuales) => [
      ...actuales,
      {
        clave: siguienteClave("cobro"),
        incluir: false,
        cuentaId: "",
        partes: null,
        clienteId: "",
        clienteNombre: null,
        candidatos: [],
        monto: "",
        montoTexto: null,
        fecha: null,
        fechaTexto: null,
        metodo: "",
        referencia: "",
        plazo: false,
        vencimiento: null,
        inventados: [],
        confirmado: true,
        avisos: [],
      },
    ]);
  }

  /** Divide un cobro en partes iguales (el resto se reparte de a 1). */
  function dividirCobro(cobro: CobroEdit, cantidad = 2) {
    const partes = dividirMonto(aNumero(cobro.monto), cantidad).map((monto) => ({
      clave: siguienteClave("parte"),
      monto: String(monto),
      fecha: "",
    }));
    actualizarCobro(cobro.clave, { partes });
  }

  function agregarParte(cobro: CobroEdit) {
    const actuales = cobro.partes ?? [];
    const diferencia = aNumero(cobro.monto) - sumaPartes(actuales.map((parte) => aNumero(parte.monto)));
    actualizarCobro(cobro.clave, {
      partes: [...actuales, { clave: siguienteClave("parte"), monto: diferencia > 0 ? String(diferencia) : "", fecha: "" }],
    });
  }

  function quitarParte(cobro: CobroEdit, claveParte: string) {
    const restantes = (cobro.partes ?? []).filter((parte) => parte.clave !== claveParte);
    actualizarCobro(cobro.clave, { partes: restantes.length > 0 ? restantes : null });
  }

  const actualizarParte = (cobro: CobroEdit, claveParte: string, patch: Partial<ParteEdit>) =>
    actualizarCobro(cobro.clave, {
      partes: (cobro.partes ?? []).map((parte) => (parte.clave === claveParte ? { ...parte, ...patch } : parte)),
    });

  const cuentaOpciones: ClienteOpcion[] = [
    { value: "", label: "— Primera cuenta activa —" },
    ...cuentas.map((cuenta) => ({ value: cuenta.id, label: cuenta.banco ? `${cuenta.nombre} · ${cuenta.banco}` : cuenta.nombre })),
  ];
  const hoy = hoyDelPanel();

  /** Aplica la selección `crear` / `vincular:<id>` de un cliente. */
  function elegirAccionCliente(cliente: ClienteEdit, valor: string) {
    if (valor.startsWith("vincular:")) {
      const id = valor.slice("vincular:".length);
      const candidato = cliente.candidatos.find((fila) => fila.id === id);
      actualizarCliente(cliente.clave, {
        accion: "vincular",
        existenteId: id,
        existenteNombre: candidato?.nombre ?? cliente.existenteNombre,
        confianza: candidato?.confianza ?? cliente.confianza,
      });
      encadenarCliente(cliente.nombre, id);
      return;
    }
    actualizarCliente(cliente.clave, { accion: "crear", existenteId: "" });
    encadenarCliente(cliente.nombre, null);
  }

  /** Aplica la selección `crear` / `vincular:<id>` de un producto. */
  function elegirAccionProducto(producto: ProductoEdit, valor: string) {
    if (valor.startsWith("vincular:")) {
      const id = valor.slice("vincular:".length);
      const candidato = producto.candidatos.find((fila) => fila.id === id);
      actualizarProducto(producto.clave, {
        accion: "vincular",
        existenteId: id,
        existenteNombre: candidato?.nombre ?? producto.existenteNombre,
        confianza: candidato?.confianza ?? producto.confianza,
      });
      return;
    }
    actualizarProducto(producto.clave, { accion: "crear", existenteId: "" });
  }

  async function cargarCuentas() {
    setCargandoCuentas(true);
    const result = await adminApiGet<{ accounts?: Array<{ id: string; name: string; bank: string | null; active: boolean }> }>(
      "/api/admin/treasury",
      { fresh: true },
    );
    setCargandoCuentas(false);
    if (!result.ok) return;
    setCuentas(
      (result.data.accounts ?? [])
        .filter((cuenta) => cuenta.active)
        .map((cuenta) => ({ id: cuenta.id, nombre: cuenta.name, banco: cuenta.bank })),
    );
  }

  async function cargarClientes(query = "") {
    clientSearchRequest.current?.abort();
    const controller = new AbortController();
    clientSearchRequest.current = controller;
    setCargandoClientes(true);
    const result = await adminApiGet<{ clients?: Array<{ id: string; name: string; company: string | null }> }>(
      `/api/admin/clients?fields=selector&q=${encodeURIComponent(query)}`,
      { fresh: true, signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    setCargandoClientes(false);
    if (!result.ok) return;
    setOpcionesCliente((previous) => [
      ...(result.data.clients ?? []).map((cliente) => ({
        value: cliente.id,
        label: cliente.company?.trim() ? `${cliente.name} · ${cliente.company}` : cliente.name,
      })),
      ...previous.filter((option) => [...eventos.map((row) => row.clienteId), ...cobros.map((row) => row.clienteId)].includes(option.value) && !(result.data.clients ?? []).some((client) => client.id === option.value)),
    ]);
  }

  async function analizar() {
    if (!texto.trim() || analizando) return;
    setAnalizando(true);
    setError("");
    const result = await adminSend<{ registros?: IaAnalisis }>("/api/admin/ia/carga", { texto: texto.trim() });
    setAnalizando(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const registros = result.data.registros;
    if (!registros) {
      setError("La respuesta no trajo registros.");
      return;
    }
    setAvisos(registros.avisos ?? []);
    setCartera(registros.cartera ?? null);
    setClientes(
      registros.clientes.map((cliente) => ({
        clave: siguienteClave("cliente"),
        incluir: true,
        accion: cliente.accion,
        existenteId: cliente.existenteId ?? "",
        existenteNombre: cliente.existenteNombre,
        confianza: cliente.confianza,
        candidatos: cliente.candidatos ?? [],
        inventados: cliente.inventados ?? [],
        confirmado: (cliente.inventados ?? []).length === 0,
        nombre: cliente.nombre,
        empresa: cliente.empresa ?? "",
        tipo: cliente.tipo,
        ruc: cliente.ruc ?? "",
        telefono: cliente.telefono ?? "",
        correo: cliente.correo ?? "",
        avisos: cliente.avisos,
      })),
    );
    setEventos(
      registros.eventos.map((evento) => ({
        clave: siguienteClave("evento"),
        incluir: Boolean(evento.clienteId),
        nombre: evento.nombre,
        clienteNombre: evento.clienteNombre,
        clienteId: evento.clienteId ?? "",
        candidatos: evento.candidatos ?? [],
        inventados: evento.inventados ?? [],
        confirmado: (evento.inventados ?? []).length === 0,
        inicio: evento.inicio ?? "",
        fin: evento.fin ?? "",
        lugar: evento.lugar ?? "",
        ciudad: evento.ciudad ?? "",
        avisos: evento.avisos,
      })),
    );
    setProductos(
      registros.productos.map((producto) => ({
        clave: siguienteClave("producto"),
        incluir: true,
        accion: producto.accion,
        actualizarPrecios: false,
        existenteId: producto.existenteId ?? "",
        existenteNombre: producto.existenteNombre,
        confianza: producto.confianza,
        candidatos: producto.candidatos ?? [],
        inventados: producto.inventados ?? [],
        confirmado: (producto.inventados ?? []).length === 0,
        nombre: producto.nombre,
        categoria: producto.categoria,
        cantidad: String(producto.cantidad),
        precioLista: aTexto(producto.precioLista),
        precioMayorista: aTexto(producto.precioMayorista),
        precioMinimo: aTexto(producto.precioMinimo),
        avisos: producto.avisos,
      })),
    );
    setCobros(
      registros.cobros.map((cobro) => ({
        clave: siguienteClave("cobro"),
        incluir: puedeCobrar && !cobro.plazo && Boolean(cobro.clienteId) && Boolean(cobro.monto),
        cuentaId: "",
        partes: null,
        clienteId: cobro.clienteId ?? "",
        clienteNombre: cobro.clienteNombre,
        candidatos: cobro.candidatos ?? [],
        monto: aTexto(cobro.monto),
        montoTexto: cobro.montoTexto,
        fecha: cobro.fecha,
        fechaTexto: cobro.fechaTexto,
        // Un cobro de esta carga ya entró: método real por defecto (issue #135).
        metodo: cobro.metodo || "Transferencia",
        referencia: cobro.referencia ?? "",
        plazo: cobro.plazo ?? false,
        vencimiento: cobro.vencimiento ?? null,
        inventados: cobro.inventados ?? [],
        confirmado: (cobro.inventados ?? []).length === 0,
        avisos: cobro.avisos,
      })),
    );
    setResultado(null);
    setFase("revision");
    void cargarClientes();
    void cargarCuentas();
  }

  async function aplicarTodo() {
    if (creando || totalIncluidos === 0) return;
    setCreando(true);
    setError("");
    const creados = { clientes: 0, eventos: 0, productos: 0, cobros: 0 };
    const vinculados = { clientes: 0, productos: 0 };
    const errores: string[] = [];
    const advertencias: string[] = [];
    const filas: FilaResultado[] = [];
    const indice = new Map<string, string>();
    // Lote de la carga (issue #130): agrupa lo aplicado en la auditoría y
    // permite anular por fila desde el resultado.
    const lote = newIdempotencyKey();

    for (const cliente of clientes.filter((fila) => fila.incluir)) {
      if (cliente.accion === "vincular") {
        vinculados.clientes += 1;
        continue;
      }
      if (cliente.inventados.length > 0 && !cliente.confirmado) {
        errores.push(`Cliente «${cliente.nombre}»: hay datos marcados sin confirmar (${cliente.inventados.join(", ")}).`);
        continue;
      }
      const result = await adminSend<{ client?: { id?: string } }>(
        "/api/admin/clients",
        {
          name: cliente.nombre,
          company: cliente.empresa.trim() || null,
          type: cliente.tipo,
          ruc: cliente.ruc.trim() || null,
          phone: cliente.telefono.trim() || null,
          email: cliente.correo.trim() || null,
        },
        "POST",
        { idempotencyKey: true },
      );
      const id = result.ok ? result.data.client?.id : undefined;
      if (id) {
        creados.clientes += 1;
        indice.set(normalizarBusqueda(cliente.nombre), id);
        filas.push({ clave: siguienteClave("fila"), tipo: "cliente", id, etiqueta: cliente.nombre });
      } else {
        errores.push(`Cliente «${cliente.nombre}»: ${result.ok ? "la respuesta no trajo el id" : result.error}`);
      }
    }

    for (const evento of eventos.filter((fila) => fila.incluir)) {
      if (evento.inventados.length > 0 && !evento.confirmado) {
        errores.push(`Evento «${evento.nombre}»: hay datos marcados sin confirmar (${evento.inventados.join(", ")}).`);
        continue;
      }
      const clienteId = evento.clienteId || indice.get(normalizarBusqueda(evento.clienteNombre ?? "")) || "";
      if (!clienteId) {
        errores.push(`Evento «${evento.nombre}»: falta el cliente (elegilo o creá el cliente primero).`);
        continue;
      }
      const result = await adminSend(
        "/api/admin/events",
        {
          clientId: clienteId,
          name: evento.nombre,
          location: evento.lugar.trim() || undefined,
          city: evento.ciudad.trim() || undefined,
          startsAt: evento.inicio || undefined,
          endsAt: evento.fin || undefined,
        },
        "POST",
        { idempotencyKey: true },
      );
      if (result.ok) {
        creados.eventos += 1;
        const idEvento = (result.data as { event?: { id?: string } } | undefined)?.event?.id;
        if (idEvento) filas.push({ clave: siguienteClave("fila"), tipo: "evento", id: idEvento, etiqueta: evento.nombre });
      } else {
        errores.push(`Evento «${evento.nombre}»: ${result.error}`);
      }
    }

    for (const producto of productos.filter((fila) => fila.incluir)) {
      if (producto.accion === "vincular") {
        vinculados.productos += 1;
        // Editar precios de un ítem existente exige el switch explícito (#128).
        if (producto.actualizarPrecios && producto.existenteId) {
          const result = await adminSend(
            "/api/admin/inventory",
            {
              kind: "prices",
              id: producto.existenteId,
              listPrice: producto.precioLista.trim() || undefined,
              wholesalePrice: producto.precioMayorista.trim() || undefined,
              minimumPrice: producto.precioMinimo.trim() || undefined,
            },
            "POST",
            { idempotencyKey: true },
          );
          if (result.ok) advertencias.push(`Precios actualizados en «${producto.existenteNombre ?? producto.nombre}».`);
          else errores.push(`Precios de «${producto.nombre}»: ${result.error}`);
        }
        continue;
      }
      if (producto.inventados.length > 0 && !producto.confirmado) {
        errores.push(`Producto «${producto.nombre}»: hay datos marcados sin confirmar (${producto.inventados.join(", ")}).`);
        continue;
      }
      const cantidad = Math.min(100_000, Math.max(1, Math.floor(aNumero(producto.cantidad)) || 1));
      const result = await adminSend<{ inventory?: { id?: string }; warning?: string }>(
        "/api/admin/resources",
        {
          kind: "inventory",
          name: producto.nombre,
          category: producto.categoria.trim() || "General",
          quantity: cantidad,
          listPrice: aNumero(producto.precioLista),
          wholesalePrice: aNumero(producto.precioMayorista),
          minimumPrice: aNumero(producto.precioMinimo),
        },
        "POST",
        { idempotencyKey: true },
      );
      if (result.ok) {
        creados.productos += 1;
        const idProducto = result.data.inventory?.id;
        if (idProducto) filas.push({ clave: siguienteClave("fila"), tipo: "producto", id: idProducto, etiqueta: producto.nombre });
        if (result.data.warning) advertencias.push(`Producto «${producto.nombre}»: ${result.data.warning}`);
      } else {
        errores.push(`Producto «${producto.nombre}»: ${result.error}`);
      }
    }

    for (const cobro of cobros.filter((fila) => fila.incluir)) {
      const etiqueta = cobro.clienteNombre ?? "sin cliente";
      if (cobro.plazo) {
        errores.push(`Cobro de «${etiqueta}»: es a crédito/plazo y no se registra en esta carga.`);
        continue;
      }
      if (cobro.inventados.length > 0 && !cobro.confirmado) {
        errores.push(`Cobro de «${etiqueta}»: hay datos marcados sin confirmar (${cobro.inventados.join(", ")}).`);
        continue;
      }
      if (!puedeCobrar) {
        errores.push(`Cobro de «${etiqueta}»: tu rol no puede registrar cobros (los registra Finanzas).`);
        continue;
      }
      const clienteId = cobro.clienteId || indice.get(normalizarBusqueda(cobro.clienteNombre ?? "")) || "";
      if (!clienteId) {
        errores.push(`Cobro de «${etiqueta}»: falta el cliente.`);
        continue;
      }
      const monto = aNumero(cobro.monto);
      if (monto <= 0) {
        errores.push(`Cobro de «${etiqueta}»: falta el monto.`);
        continue;
      }
      const cuenta = cobro.cuentaId || undefined;

      // Cobro dividido en partes (issue #128): cada parte es un pago.
      if (cobro.partes && cobro.partes.length > 0) {
        const partes = cobro.partes;
        const suma = sumaPartes(partes.map((parte) => aNumero(parte.monto)));
        if (suma !== monto) {
          errores.push(`Cobro de «${etiqueta}»: las partes suman ${formatMoney(suma)} y el total es ${formatMoney(monto)}.`);
          continue;
        }
        for (const parte of partes) {
          const montoParte = aNumero(parte.monto);
          if (montoParte <= 0) {
            errores.push(`Cobro de «${etiqueta}»: una parte quedó sin monto.`);
            continue;
          }
          const pendiente = parteEsPendiente(parte.fecha, hoy);
          if (pendiente) {
            const metodoPlazo = METODOS_PLAZO.includes(cobro.metodo) ? cobro.metodo : "";
            if (!metodoPlazo) {
              errores.push(`Cobro de «${etiqueta}»: el saldo a plazo necesita método (pendiente, transferencia, efectivo o cheque).`);
              continue;
            }
            const result = await adminSend<{ payment?: { id?: string; status?: string } }>(
              "/api/admin/finance",
              {
                kind: "client",
                clientId: clienteId,
                amount: montoParte,
                status: "PENDING",
                method: metodoPlazo,
                dueAt: parte.fecha,
                treasuryAccountId: cuenta,
              },
              "POST",
              { idempotencyKey: true },
            );
            if (result.ok) {
              creados.cobros += 1;
              const idPago = result.data.payment?.id;
              if (idPago) {
                filas.push({
                  clave: siguienteClave("fila"),
                  tipo: "cobro",
                  id: idPago,
                  etiqueta: `Saldo de «${etiqueta}» · ${formatMoney(montoParte)} · vence ${parte.fecha}`,
                  estado: "PENDING",
                });
              }
              advertencias.push(`Saldo de «${etiqueta}»: ${formatMoney(montoParte)} a cobrar el ${parte.fecha}.`);
            } else {
              errores.push(`Saldo de «${etiqueta}»: ${result.error}`);
            }
            continue;
          }
          const result = await adminSend<{ payment?: { id?: string; status?: string } }>(
            "/api/admin/finance",
            {
              kind: "client",
              clientId: clienteId,
              amount: montoParte,
              method: cobro.metodo || undefined,
              reference: cobro.referencia.trim() || undefined,
              treasuryAccountId: cuenta,
            },
            "POST",
            { idempotencyKey: true },
          );
          if (result.ok) {
            creados.cobros += 1;
            const idPago = result.data.payment?.id;
            if (idPago) {
              filas.push({
                clave: siguienteClave("fila"),
                tipo: "cobro",
                id: idPago,
                etiqueta: `Cobro de «${etiqueta}» · ${formatMoney(montoParte)}`,
                estado: "RECEIVED",
              });
            }
          } else {
            errores.push(`Cobro de «${etiqueta}»: ${result.error}`);
          }
        }
        continue;
      }

      // Un cobro cobrado necesita método real (issue #135): «Pendiente» solo
      // vale para saldos a plazo (arriba), no para plata que ya entró.
      if (!(COLLECTED_PAYMENT_METHODS as readonly string[]).includes(cobro.metodo)) {
        errores.push(`Cobro de «${etiqueta}»: elegí el método real con el que entró la plata (no «Pendiente»).`);
        continue;
      }

      const result = await adminSend<{ payment?: { id?: string; status?: string } }>(
        "/api/admin/finance",
        {
          kind: "client",
          clientId: clienteId,
          amount: monto,
          method: cobro.metodo || undefined,
          reference: cobro.referencia.trim() || undefined,
          treasuryAccountId: cuenta,
        },
        "POST",
        { idempotencyKey: true },
      );
      if (result.ok) {
        creados.cobros += 1;
        const idPago = result.data.payment?.id;
        if (idPago) {
          filas.push({
            clave: siguienteClave("fila"),
            tipo: "cobro",
            id: idPago,
            etiqueta: `Cobro de «${etiqueta}» · ${formatMoney(monto)}`,
            estado: "RECEIVED",
          });
        }
      } else {
        errores.push(`Cobro de «${etiqueta}»: ${result.error}`);
      }
    }

    // Constancia del lote en la auditoría (issue #130): agrupa lo creado.
    if (filas.length > 0) {
      const loteResult = await adminSend("/api/admin/ia/lote", {
        lote,
        creados: {
          clientes: filas.filter((fila) => fila.tipo === "cliente").map((fila) => ({ id: fila.id, etiqueta: fila.etiqueta })),
          eventos: filas.filter((fila) => fila.tipo === "evento").map((fila) => ({ id: fila.id, etiqueta: fila.etiqueta })),
          productos: filas.filter((fila) => fila.tipo === "producto").map((fila) => ({ id: fila.id, etiqueta: fila.etiqueta })),
          cobros: filas.filter((fila) => fila.tipo === "cobro").map((fila) => ({ id: fila.id, etiqueta: fila.etiqueta })),
        },
      });
      if (!loteResult.ok) advertencias.push(`No pudimos registrar el lote en la auditoría: ${loteResult.error}`);
    }

    requestAdminRefresh();
    setResultado({ lote, creados, vinculados, filas, errores, advertencias });
    setCreando(false);
    setFase("listo");
  }

  function opcionesDeClienteEvento(evento: EventoEdit): ClienteOpcion[] {
    const opciones: ClienteOpcion[] = [{ value: "", label: "— Elegí el cliente —" }, ...opcionesCliente];
    for (const candidato of evento.candidatos) {
      const etiqueta = candidato.confianza < 100 ? `${candidato.nombre} (${candidato.confianza} %)` : candidato.nombre;
      if (!opciones.some((opcion) => opcion.value === candidato.id)) opciones.push({ value: candidato.id, label: etiqueta });
    }
    return opciones;
  }

  function opcionesDeClienteCobro(cobro: CobroEdit): ClienteOpcion[] {
    const opciones: ClienteOpcion[] = [{ value: "", label: "— Elegí el cliente —" }, ...opcionesCliente];
    for (const candidato of cobro.candidatos) {
      const etiqueta = candidato.confianza < 100 ? `${candidato.nombre} (${candidato.confianza} %)` : candidato.nombre;
      if (!opciones.some((opcion) => opcion.value === candidato.id)) opciones.push({ value: candidato.id, label: etiqueta });
    }
    return opciones;
  }

  /** Anula un registro creado por el lote (issue #130). */
  async function anularFila(fila: FilaResultado) {
    setConfirmandoAnular(null);
    const result =
      fila.tipo === "cobro"
        ? await adminSend(
            "/api/admin/finance",
            { kind: "client", paymentId: fila.id, action: "cancel" },
            "PATCH",
            { idempotencyKey: true },
          )
        : await adminSend("/api/admin/ia/anular", { tipo: fila.tipo, id: fila.id, lote: resultado?.lote ?? "" });
    setResultado((actual) => {
      if (!actual) return actual;
      return {
        ...actual,
        filas: actual.filas.map((actualFila) =>
          actualFila.clave === fila.clave
            ? result.ok
              ? { ...actualFila, anulado: true, error: undefined }
              : { ...actualFila, error: result.error }
            : actualFila,
        ),
      };
    });
    requestAdminRefresh();
  }

  const partesDetectadas = [
    listar(clientes.length, "cliente", "clientes"),
    listar(eventos.length, "evento", "eventos"),
    listar(productos.length, "producto", "productos"),
    listar(cobros.length, "cobro", "cobros"),
  ];

  const partesCreadas = [
    creadosDe(resultado, "clientes"),
    creadosDe(resultado, "eventos"),
    creadosDe(resultado, "productos"),
    creadosDe(resultado, "cobros"),
  ].filter((parte): parte is string => Boolean(parte));

  function creadosDe(resultadoActual: Resultado | null, tipo: keyof Resultado["creados"]): string | null {
    const cantidad = resultadoActual?.creados[tipo] ?? 0;
    if (cantidad <= 0) return null;
    const nombres: Record<keyof Resultado["creados"], [string, string]> = {
      clientes: ["cliente", "clientes"],
      eventos: ["evento", "eventos"],
      productos: ["producto", "productos"],
      cobros: ["cobro", "cobros"],
    };
    return listar(cantidad, nombres[tipo][0], nombres[tipo][1]);
  }

  const footer =
    config && !config.configurada ? (
      <>
            <span className="admin-dialog-spacer" />
            <AdminButton icon="refresh" onClick={() => setReintento((valor) => valor + 1)}>
              Volver a chequear
            </AdminButton>
            <AdminButton variant="primary" icon="check" onClick={onClose}>
              Entendido
            </AdminButton>
    </>
    ) : config?.configurada && fase === "entrada" ? (
      <>
            <span className="admin-dialog-spacer" />
            <AdminButton icon="close" onClick={onClose} disabled={analizando}>
              Cancelar
            </AdminButton>
            <AdminButton variant="primary" icon="sparkles" type="submit" form={formId} busy={analizando} disabled={!texto.trim()}>
              Analizar con IA
            </AdminButton>
    </>
    ) : config?.configurada && fase === "revision" ? (
      <>
            <span className="admin-dialog-spacer" />
            <AdminButton icon="arrow-left" onClick={() => setFase("entrada")} disabled={creando}>
              Volver
            </AdminButton>
            <AdminButton
              variant="primary"
              icon="check"
              busy={creando}
              disabled={creando || totalIncluidos === 0 || pendientes > 0}
              onClick={() => void aplicarTodo()}
            >
              {`Aplicar todo (${totalIncluidos})`}
            </AdminButton>
    </>
    ) : fase === "listo" && resultado ? (
      <>
            <span className="admin-dialog-spacer" />
            <AdminButton
              icon="refresh"
              onClick={() => {
                setTexto("");
                setResultado(null);
                setError("");
                setAvisos([]);
                setFase("entrada");
              }}
            >
              Cargar otro texto
            </AdminButton>
            <AdminButton variant="primary" icon="check" onClick={onClose}>
              Listo
            </AdminButton>
    </>
    ) : undefined;

  // Portal a la raíz del panel (mismo patrón que la paleta): el topbar tiene
  // `backdrop-filter` y eso ancla los `fixed` a su caja; además la raíz
  // (`.admin-root`) es donde viven los tokens del tema (issue #120).
  return createPortal(
    <AdminDialog title="Carga con IA" icon="sparkles" size="ficha" onClose={onClose} footer={footer}>
      {!config && !configError ? <p className="admin-dialog-text">Consultando la configuración…</p> : null}

      {configError ? <AdminNote tone="error">{configError}</AdminNote> : null}

      {config && !config.configurada ? (
        <>
          <AdminNote tone="warn" variant="alert">
            La IA no está configurada en el servidor. Se activa cargando <code>IA_API_KEY</code> (el modelo y la base se
            ajustan con <code>IA_MODELO</code> y <code>IA_BASE_URL</code>).
          </AdminNote>
          <p className="admin-dialog-text">
            Mientras tanto, los clientes, eventos y productos se cargan a mano desde cada módulo, sin perder nada.
          </p>
        </>
      ) : null}

      {config?.configurada && fase === "entrada" ? (
        <form
          id={formId}
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void analizar();
          }}
        >
          <TextAreaField
            label="Texto para cargar"
            hint={`Pegá mensajes, listas o catálogos (${(config.tipos.length > 0 ? config.tipos : IA_TIPOS).map((tipo) => IA_TIPO_LABEL[tipo].toLowerCase()).join(", ")} a la vez). Máximo ${IA_TEXTO_MAX.toLocaleString("es-PY")} caracteres.`}
            rows={10}
            maxLength={IA_TEXTO_MAX}
            value={texto}
            onChange={setTexto}
            disabled={analizando}
            placeholder={"Ejemplo:\nJuan Pérez me pagó 750 mil por transferencia\nEvento: cierre de año de Constructora Sur, 20/12/2026, salón Los Lapachos\nProducto: pantalla LED 3x2, cantidad 4, lista 1.500.000"}
            wide
          />
          <p className="admin-dialog-text admin-ia-privacy">
            Se manda solo este texto al proveedor de IA configurado{config.modelo ? ` (${config.modelo})` : ""} para armar
            la vista previa; no se guarda en EventOS ni se toca la base.{" "}
            <Link href={`${publicConfig.siteUrl}/privacidad`} target="_blank" rel="noopener">
              Política de privacidad
            </Link>
            .
          </p>
          {error ? <AdminNote tone="error">{error}</AdminNote> : null}
        </form>
      ) : null}

      {config?.configurada && fase === "revision" ? (
        <>
          <p className="admin-dialog-text">
            Detectamos <strong>{partesDetectadas.join(", ")}</strong>. Revisá, corregí o descartá: nada se aplica sin tu
            confirmación.
          </p>
          {avisos.length > 0 ? <AdminNote tone="warn">{avisos.join(" ")}</AdminNote> : null}
          {error ? <AdminNote tone="error">{error}</AdminNote> : null}

          {clientes.length + eventos.length + productos.length + cobros.length === 0 ? (
            <AdminEmpty
              title="No detectamos registros"
              icon="sparkles"
              hint="Probá con un texto más completo (nombres, fechas o precios) o volvé a pegar."
            />
          ) : null}

          {clientes.length > 0 ? (
            <section className="admin-ia-section" aria-label={`Clientes detectados (${clientes.length})`}>
              <div className="admin-ia-section-head">
                <h3 className="admin-ia-section-title">
                  {IA_TIPO_LABEL.clientes} <span>{clientes.length}</span>
                </h3>
                <AdminButton icon="plus" title="Agregar cliente a mano" aria-label="Agregar cliente" onClick={agregarCliente}>
                  Agregar
                </AdminButton>
              </div>
              {cartera && cartera.clientes === 0 ? (
                <AdminNote tone="warn">No hay clientes cargados en esta empresa: lo detectado se crearía de cero.</AdminNote>
              ) : null}
              {clientes.map((cliente) => (
                <article key={cliente.clave} className="admin-ia-card" data-off={!cliente.incluir}>
                  <header className="admin-ia-card-head">
                    <span className="admin-ia-contexto">
                      <AdminAvatar
                        name={cliente.nombre}
                        src={imagenDeCandidato(cliente)}
                        size={40}
                        title={imagenDeCandidato(cliente) ? `Logo de ${cliente.existenteNombre ?? cliente.nombre}` : `Monograma de ${cliente.nombre}`}
                      />
                      <span className="admin-ia-card-title">{cliente.nombre}</span>
                    </span>
                    <span className="admin-ia-card-tools">
                      <SwitchField
                        label="Incluir"
                        checked={cliente.incluir}
                        onChange={(incluir) => actualizarCliente(cliente.clave, { incluir })}
                      />
                      <AdminButton
                        icon="copy"
                        title="Duplicar"
                        aria-label={`Duplicar ${cliente.nombre}`}
                        onClick={() => setClientes((actuales) => [...actuales, duplicarRegistro(cliente, "cliente")])}
                      />
                      <AdminButton
                        icon="trash"
                        title="Quitar"
                        aria-label={`Quitar ${cliente.nombre}`}
                        onClick={() => setClientes((actuales) => actuales.filter((fila) => fila.clave !== cliente.clave))}
                      />
                    </span>
                  </header>
                  {cliente.avisos.length > 0 ? <AdminNote tone="warn">{cliente.avisos.join(" ")}</AdminNote> : null}
                  {cliente.inventados.length > 0 ? (
                    <>
                      <AdminNote tone="warn">
                        {`No está en el texto: ${cliente.inventados.join(" · ")}.`}
                        {cliente.accion === "vincular" ? " Al vincular no se aplican." : ""}
                      </AdminNote>
                      {cliente.accion !== "vincular" ? (
                        <div className="admin-ia-grid">
                          <SwitchField
                            label="Confirmo los datos marcados"
                            checked={cliente.confirmado}
                            onChange={(confirmado) => actualizarCliente(cliente.clave, { confirmado })}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="admin-ia-grid">
                    <SelectField
                      label="Acción"
                      options={opcionesDeAccion(cliente.candidatos)}
                      value={seleccionDeAccion(cliente)}
                      onChange={(valor) => elegirAccionCliente(cliente, valor)}
                      hint={
                        cliente.candidatos.length > 0
                          ? `Candidatos: ${cliente.candidatos.map((fila) => `${fila.nombre} (${fila.confianza} %)`).join(" · ")}`
                          : undefined
                      }
                      disabled={!cliente.incluir}
                    />
                  </div>
                  {cliente.accion === "vincular" ? (
                    <p className="admin-ia-match">
                      Se vincula a <strong>{cliente.existenteNombre ?? "el existente"}</strong>
                      {cliente.confianza !== null ? ` (${cliente.confianza} %)` : ""}: no se crea un cliente nuevo.
                    </p>
                  ) : (
                    <div className="admin-ia-grid">
                      <TextField
                        label="Nombre"
                        value={cliente.nombre}
                        onChange={(nombre) => actualizarCliente(cliente.clave, { nombre })}
                        disabled={!cliente.incluir}
                      />
                      <TextField
                        label="Empresa"
                        value={cliente.empresa}
                        onChange={(empresa) => actualizarCliente(cliente.clave, { empresa })}
                        disabled={!cliente.incluir}
                      />
                      <SelectField
                        label="Tipo"
                        options={TIPO_CLIENTE}
                        value={cliente.tipo}
                        onChange={(tipo) => actualizarCliente(cliente.clave, { tipo: tipo === "RESELLER" ? "RESELLER" : "FINAL" })}
                        disabled={!cliente.incluir}
                      />
                      <RucField
                        label="RUC / C.I."
                        maxLength={30}
                        value={cliente.ruc}
                        onChange={(ruc) => actualizarCliente(cliente.clave, { ruc })}
                        disabled={!cliente.incluir}
                      />
                      <PhoneField
                        label="Teléfono"
                        value={cliente.telefono}
                        onChange={(telefono) => actualizarCliente(cliente.clave, { telefono })}
                        disabled={!cliente.incluir}
                      />
                      <EmailField
                        label="Correo"
                        value={cliente.correo}
                        onChange={(correo) => actualizarCliente(cliente.clave, { correo })}
                        disabled={!cliente.incluir}
                      />
                    </div>
                  )}
                </article>
              ))}
            </section>
          ) : null}

          {eventos.length > 0 ? (
            <section className="admin-ia-section" aria-label={`Eventos detectados (${eventos.length})`}>
              <div className="admin-ia-section-head">
                <h3 className="admin-ia-section-title">
                  {IA_TIPO_LABEL.eventos} <span>{eventos.length}</span>
                </h3>
                <AdminButton icon="plus" title="Agregar evento a mano" aria-label="Agregar evento" onClick={agregarEvento}>
                  Agregar
                </AdminButton>
              </div>
              {eventos.map((evento) => (
                <article key={evento.clave} className="admin-ia-card" data-off={!evento.incluir}>
                  <header className="admin-ia-card-head">
                    <span className="admin-ia-card-title">{evento.nombre}</span>
                    <span className="admin-ia-card-tools">
                      <SwitchField
                        label="Incluir"
                        checked={evento.incluir}
                        disabled={!evento.clienteId}
                        onChange={(incluir) => actualizarEvento(evento.clave, { incluir })}
                      />
                      <AdminButton
                        icon="copy"
                        title="Duplicar"
                        aria-label={`Duplicar ${evento.nombre}`}
                        onClick={() => setEventos((actuales) => [...actuales, duplicarRegistro(evento, "evento")])}
                      />
                      <AdminButton
                        icon="trash"
                        title="Quitar"
                        aria-label={`Quitar ${evento.nombre}`}
                        onClick={() => setEventos((actuales) => actuales.filter((fila) => fila.clave !== evento.clave))}
                      />
                    </span>
                  </header>
                  {avisosVigentes(evento.avisos, evento.clienteId).length > 0 ? <AdminNote tone="warn">{avisosVigentes(evento.avisos, evento.clienteId).join(" ")}</AdminNote> : null}
                  {evento.inventados.length > 0 ? (
                    <>
                      <AdminNote tone="warn">{`No está en el texto: ${evento.inventados.join(" · ")}.`}</AdminNote>
                      <div className="admin-ia-grid">
                        <SwitchField
                          label="Confirmo los datos marcados"
                          checked={evento.confirmado}
                          onChange={(confirmado) => actualizarEvento(evento.clave, { confirmado })}
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="admin-ia-grid">
                    <TextField
                      label="Nombre"
                      value={evento.nombre}
                      onChange={(nombre) => actualizarEvento(evento.clave, { nombre })}
                      disabled={!evento.incluir}
                    />
                    <Combobox
                      onSearch={(query) => void cargarClientes(query)}
                      label="Cliente"
                      hint={evento.clienteNombre ? `En el texto: ${evento.clienteNombre}` : "Sin cliente en el texto"}
                      options={opcionesDeClienteEvento(evento)}
                      value={evento.clienteId}
                      onChange={(clienteId) => actualizarEvento(evento.clave, { clienteId, incluir: Boolean(clienteId) })}
                      emptyLabel={cargandoClientes ? "Buscando clientes…" : "Sin coincidencias."}
                      error={!evento.clienteId ? "Elegí el cliente para poder crear el evento." : null}
                    />
                    <DateField
                      label="Inicio"
                      value={evento.inicio}
                      onChange={(inicio) => actualizarEvento(evento.clave, { inicio })}
                      disabled={!evento.incluir}
                    />
                    <DateField
                      label="Fin"
                      value={evento.fin}
                      onChange={(fin) => actualizarEvento(evento.clave, { fin })}
                      disabled={!evento.incluir}
                    />
                    <TextField
                      label="Lugar"
                      value={evento.lugar}
                      onChange={(lugar) => actualizarEvento(evento.clave, { lugar })}
                      disabled={!evento.incluir}
                    />
                    <TextField
                      label="Ciudad"
                      value={evento.ciudad}
                      onChange={(ciudad) => actualizarEvento(evento.clave, { ciudad })}
                      disabled={!evento.incluir}
                    />
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {productos.length > 0 ? (
            <section className="admin-ia-section" aria-label={`Productos detectados (${productos.length})`}>
              <div className="admin-ia-section-head">
                <h3 className="admin-ia-section-title">
                  {IA_TIPO_LABEL.productos} <span>{productos.length}</span>
                </h3>
                <AdminButton icon="plus" title="Agregar producto a mano" aria-label="Agregar producto" onClick={agregarProducto}>
                  Agregar
                </AdminButton>
              </div>
              {cartera && cartera.productos === 0 ? (
                <AdminNote tone="warn">No hay productos cargados en Inventario: lo detectado se crearía de cero.</AdminNote>
              ) : null}
              {productos.map((producto) => (
                <article key={producto.clave} className="admin-ia-card" data-off={!producto.incluir}>
                  <header className="admin-ia-card-head">
                    <span className="admin-ia-contexto">
                      <AdminImageBox
                        imageUrl={imagenDeCandidato(producto)}
                        size={40}
                        title={imagenDeCandidato(producto) ? `Foto de ${producto.existenteNombre ?? producto.nombre}` : `Sin foto: ${producto.nombre}`}
                      />
                      <span className="admin-ia-card-title">{producto.nombre}</span>
                    </span>
                    <span className="admin-ia-card-tools">
                      <SwitchField
                        label="Incluir"
                        checked={producto.incluir}
                        onChange={(incluir) => actualizarProducto(producto.clave, { incluir })}
                      />
                      <AdminButton
                        icon="copy"
                        title="Duplicar"
                        aria-label={`Duplicar ${producto.nombre}`}
                        onClick={() => setProductos((actuales) => [...actuales, duplicarRegistro(producto, "producto")])}
                      />
                      <AdminButton
                        icon="trash"
                        title="Quitar"
                        aria-label={`Quitar ${producto.nombre}`}
                        onClick={() => setProductos((actuales) => actuales.filter((fila) => fila.clave !== producto.clave))}
                      />
                    </span>
                  </header>
                  {producto.avisos.length > 0 ? <AdminNote tone="warn">{producto.avisos.join(" ")}</AdminNote> : null}
                  {producto.inventados.length > 0 ? (
                    <>
                      <AdminNote tone="warn">
                        {`No está en el texto: ${producto.inventados.join(" · ")}.`}
                        {producto.accion === "vincular" ? " Al vincular no se aplican." : ""}
                      </AdminNote>
                      {producto.accion !== "vincular" ? (
                        <div className="admin-ia-grid">
                          <SwitchField
                            label="Confirmo los datos marcados"
                            checked={producto.confirmado}
                            onChange={(confirmado) => actualizarProducto(producto.clave, { confirmado })}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="admin-ia-grid">
                    <SelectField
                      label="Acción"
                      options={opcionesDeAccion(producto.candidatos)}
                      value={seleccionDeAccion(producto)}
                      onChange={(valor) => elegirAccionProducto(producto, valor)}
                      hint={
                        producto.candidatos.length > 0
                          ? `Candidatos: ${producto.candidatos.map((fila) => `${fila.nombre} (${fila.confianza} %)`).join(" · ")}`
                          : undefined
                      }
                      disabled={!producto.incluir}
                    />
                  </div>
                  {producto.accion === "vincular" ? (
                    <>
                      <p className="admin-ia-match">
                        Se vincula a <strong>{producto.existenteNombre ?? "el ítem existente"}</strong>
                        {producto.confianza !== null ? ` (${producto.confianza} %)` : ""}: no se crea un producto nuevo.
                      </p>
                      {producto.actualizarPrecios ? (
                        <div className="admin-ia-grid">
                          <SwitchField
                            label="Actualizar los precios del producto"
                            checked
                            hint="Al desactivarlo, el ítem del inventario no se toca."
                            onChange={(actualizarPrecios) => actualizarProducto(producto.clave, { actualizarPrecios })}
                            disabled={!producto.incluir}
                          />
                          <MoneyField
                            label="Precio de lista"
                            value={producto.precioLista}
                            onChange={(precioLista) => actualizarProducto(producto.clave, { precioLista })}
                            disabled={!producto.incluir}
                          />
                          <MoneyField
                            label="Precio mayorista"
                            value={producto.precioMayorista}
                            onChange={(precioMayorista) => actualizarProducto(producto.clave, { precioMayorista })}
                            disabled={!producto.incluir}
                          />
                          <MoneyField
                            label="Precio mínimo"
                            value={producto.precioMinimo}
                            onChange={(precioMinimo) => actualizarProducto(producto.clave, { precioMinimo })}
                            disabled={!producto.incluir}
                          />
                        </div>
                      ) : (
                        <div>
                          {/* Issue #136: el producto vinculado no pide precios; la
                              edición de los maestros es una acción explícita. */}
                          <AdminButton
                            icon="edit"
                            onClick={() => actualizarProducto(producto.clave, { actualizarPrecios: true })}
                            disabled={!producto.incluir}
                          >
                            Editar precios del producto
                          </AdminButton>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="admin-ia-grid">
                      <TextField
                        label="Nombre"
                        value={producto.nombre}
                        onChange={(nombre) => actualizarProducto(producto.clave, { nombre })}
                        disabled={!producto.incluir}
                      />
                      <TextField
                        label="Categoría"
                        value={producto.categoria}
                        onChange={(categoria) => actualizarProducto(producto.clave, { categoria })}
                        disabled={!producto.incluir}
                      />
                      <NumberField
                        label="Cantidad"
                        value={producto.cantidad}
                        onChange={(cantidad) => actualizarProducto(producto.clave, { cantidad })}
                        disabled={!producto.incluir}
                        maxLength={6}
                      />
                      <MoneyField
                        label="Precio de lista"
                        value={producto.precioLista}
                        onChange={(precioLista) => actualizarProducto(producto.clave, { precioLista })}
                        disabled={!producto.incluir}
                      />
                      <MoneyField
                        label="Precio mayorista"
                        value={producto.precioMayorista}
                        onChange={(precioMayorista) => actualizarProducto(producto.clave, { precioMayorista })}
                        disabled={!producto.incluir}
                      />
                      <MoneyField
                        label="Precio mínimo"
                        value={producto.precioMinimo}
                        onChange={(precioMinimo) => actualizarProducto(producto.clave, { precioMinimo })}
                        disabled={!producto.incluir}
                      />
                    </div>
                  )}
                </article>
              ))}
            </section>
          ) : null}

          {cobros.length > 0 ? (
            <section className="admin-ia-section" aria-label={`Cobros detectados (${cobros.length})`}>
              <div className="admin-ia-section-head">
                <h3 className="admin-ia-section-title">
                  {IA_TIPO_LABEL.cobros} <span>{cobros.length}</span>
                </h3>
                <AdminButton icon="plus" title="Agregar cobro a mano" aria-label="Agregar cobro" onClick={agregarCobro}>
                  Agregar
                </AdminButton>
              </div>
              {cobros.map((cobro) => (
                <article key={cobro.clave} className="admin-ia-card" data-off={!cobro.incluir}>
                  <header className="admin-ia-card-head">
                    <span className="admin-ia-card-title">{`Cobro de «${cobro.clienteNombre ?? "sin cliente"}»`}</span>
                    <span className="admin-ia-card-tools">
                      <SwitchField
                        label="Registrar"
                        checked={cobro.incluir && !cobro.plazo}
                        disabled={!puedeCobrar || cobro.plazo || !cobro.clienteId || aNumero(cobro.monto) <= 0}
                        onChange={(incluir) => actualizarCobro(cobro.clave, { incluir })}
                      />
                      <AdminButton
                        icon="copy"
                        title="Duplicar"
                        aria-label={`Duplicar ${cobro.clienteNombre ?? "sin cliente"}`}
                        onClick={() => setCobros((actuales) => [...actuales, duplicarRegistro(cobro, "cobro")])}
                      />
                      <AdminButton
                        icon="trash"
                        title="Quitar"
                        aria-label={`Quitar ${cobro.clienteNombre ?? "sin cliente"}`}
                        onClick={() => setCobros((actuales) => actuales.filter((fila) => fila.clave !== cobro.clave))}
                      />
                    </span>
                  </header>
                  {!puedeCobrar ? (
                    <AdminNote tone="warn">Tu rol no puede registrar cobros: los registra Finanzas. El cobro queda solo como aviso.</AdminNote>
                  ) : null}
                  {cobro.plazo ? (
                    <AdminNote tone="warn">
                      {cobro.vencimiento
                        ? `A crédito/plazo: vence el ${cobro.vencimiento}. No se registra como cobrado en esta carga.`
                        : "A crédito/plazo: no se registra como cobrado en esta carga."}
                    </AdminNote>
                  ) : null}
                  {cobro.inventados.length > 0 ? (
                    <>
                      <AdminNote tone="warn">{`No está en el texto: ${cobro.inventados.join(" · ")}.`}</AdminNote>
                      <div className="admin-ia-grid">
                        <SwitchField
                          label="Confirmo los datos marcados"
                          checked={cobro.confirmado}
                          onChange={(confirmado) => actualizarCobro(cobro.clave, { confirmado })}
                        />
                      </div>
                    </>
                  ) : null}
                  {avisosVigentes(cobro.avisos, cobro.clienteId).length > 0 ? <AdminNote tone="warn">{avisosVigentes(cobro.avisos, cobro.clienteId).join(" ")}</AdminNote> : null}
                  <div className="admin-ia-grid">
                    <Combobox
                      onSearch={(query) => void cargarClientes(query)}
                      label="Cliente"
                      options={opcionesDeClienteCobro(cobro)}
                      value={cobro.clienteId}
                      onChange={(clienteId) => actualizarCobro(cobro.clave, { clienteId, incluir: Boolean(clienteId) && !cobro.plazo && aNumero(cobro.monto) > 0 })}
                      disabled={!puedeCobrar}
                      emptyLabel={cargandoClientes ? "Buscando clientes…" : "Sin coincidencias."}
                      error={!cobro.clienteId ? "Elegí el cliente del cobro." : null}
                    />
                    <MoneyField
                      label="Monto"
                      hint={cobro.montoTexto ? `En el texto: ${cobro.montoTexto}` : "No vino el monto en el texto"}
                      value={cobro.monto}
                      onChange={(monto) => actualizarCobro(cobro.clave, { monto, incluir: Boolean(cobro.clienteId) && !cobro.plazo && aNumero(monto) > 0 })}
                      disabled={!puedeCobrar}
                    />
                    <SelectField
                      label="Método"
                      options={METODO_PAGO}
                      value={cobro.metodo}
                      onChange={(metodo) => actualizarCobro(cobro.clave, { metodo })}
                      disabled={!puedeCobrar}
                    />
                    <SelectField
                      label="Cuenta de la empresa"
                      options={cuentaOpciones}
                      value={cobro.cuentaId}
                      onChange={(cuentaId) => actualizarCobro(cobro.clave, { cuentaId })}
                      hint={cargandoCuentas ? "Cargando cuentas…" : cuentas.length === 0 ? "No hay cuentas de tesorería: se registra sin cuenta." : undefined}
                      disabled={!puedeCobrar || cargandoCuentas}
                    />
                    <TextField
                      label="Referencia"
                      value={cobro.referencia}
                      onChange={(referencia) => actualizarCobro(cobro.clave, { referencia })}
                      placeholder="Nro. de transferencia, cheque…"
                      disabled={!puedeCobrar}
                    />
                  </div>
                  {!cobro.plazo ? (
                    <div className="admin-ia-split">
                      <div className="admin-ia-split-head">
                        <span className="admin-ia-split-title">
                          {cobro.partes ? `Dividido en ${cobro.partes.length} partes` : "En una sola vez"}
                        </span>
                        {cobro.partes ? (
                          <AdminButton icon="plus" onClick={() => agregarParte(cobro)} disabled={!puedeCobrar}>
                            Agregar parte
                          </AdminButton>
                        ) : (
                          <AdminButton onClick={() => dividirCobro(cobro, 2)} disabled={!puedeCobrar || aNumero(cobro.monto) <= 0}>
                            Dividir en 2 partes
                          </AdminButton>
                        )}
                      </div>
                      {cobro.partes ? (
                        <>
                          {cobro.partes.map((parte) => (
                            <div key={parte.clave} className="admin-ia-split-row">
                              <MoneyField
                                label="Monto de la parte"
                                value={parte.monto}
                                onChange={(monto) => actualizarParte(cobro, parte.clave, { monto })}
                                disabled={!puedeCobrar}
                              />
                              <DateField
                                label="Fecha"
                                value={parte.fecha}
                                onChange={(fecha) => actualizarParte(cobro, parte.clave, { fecha })}
                                hint={parteEsPendiente(parte.fecha, hoy) ? "Queda a cobrar ese día (saldo)" : "Se registra ahora"}
                                disabled={!puedeCobrar}
                              />
                              <AdminButton
                                icon="trash"
                                title="Quitar la parte"
                                aria-label="Quitar parte"
                                onClick={() => quitarParte(cobro, parte.clave)}
                                disabled={!puedeCobrar}
                              />
                            </div>
                          ))}
                          <p className="admin-ia-match">
                            {sumaPartes(cobro.partes.map((parte) => aNumero(parte.monto))) === aNumero(cobro.monto)
                              ? `Las partes suman ${formatMoney(aNumero(cobro.monto))}. Las que tienen fecha futura quedan a cobrar (saldo).`
                              : `Las partes suman ${formatMoney(sumaPartes(cobro.partes.map((parte) => aNumero(parte.monto))))} y el total es ${formatMoney(aNumero(cobro.monto))}: ajustá los montos.`}
                          </p>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {cobro.fechaTexto || cobro.fecha ? (
                    <p className="admin-ia-match">
                      {`Fecha en el texto: «${cobro.fechaTexto ?? "—"}»`}
                      {cobro.fecha ? ` → ${cobro.fecha}` : " (no pudimos leerla)"}
                      {". El cobro se sella con la fecha del registro."}
                    </p>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          {pendientes > 0 ? (
            <AdminNote tone="warn">
              {`Resolvé ${listar(pendientes, "registro", "registros")}: elegí si refieren a un existente o marcalos como «Crear nuevo».`}
            </AdminNote>
          ) : null}
        </>
      ) : null}

      {fase === "listo" && resultado ? (
        <>
          <AdminNote tone="ok">
            {partesCreadas.length > 0 ? `Creamos ${partesCreadas.join(", ")}.` : "No se creó ningún registro."}
          </AdminNote>
          {resultado.vinculados.clientes + resultado.vinculados.productos > 0 ? (
            <AdminNote tone="ok">
              {`Vinculamos ${[
                resultado.vinculados.clientes > 0 ? listar(resultado.vinculados.clientes, "cliente", "clientes") : null,
                resultado.vinculados.productos > 0 ? listar(resultado.vinculados.productos, "producto", "productos") : null,
              ]
                .filter(Boolean)
                .join(" y ")} a lo existente.`}
            </AdminNote>
          ) : null}
          {resultado.advertencias.map((advertencia) => (
            <AdminNote key={advertencia} tone="warn">
              {advertencia}
            </AdminNote>
          ))}
          {resultado.errores.length > 0 ? (
            <AdminNote tone="error">{`No pudimos aplicar ${resultado.errores.length} acción(es): ${resultado.errores.join(" · ")}`}</AdminNote>
          ) : null}
          {resultado.filas.length > 0 ? (
            <div className="admin-ia-lote">
              <p className="admin-dialog-text">
                {`Lote ${resultado.lote.slice(0, 8)} · abrí cada registro en su módulo o anulá lo que no corresponda:`}
              </p>
              {resultado.filas.map((fila) => (
                <div key={fila.clave} className="admin-ia-lote-row" data-off={fila.anulado}>
                  <span className="admin-ia-lote-label">
                    <strong>{ETIQUETA_TIPO[fila.tipo]}</strong> {fila.etiqueta}
                  </span>
                  {fila.error ? <span className="admin-ia-lote-error">{fila.error}</span> : null}
                  <span className="admin-ia-lote-actions">
                    <Link className="admin-panel-link" href={RUTA_TIPO[fila.tipo]} title={`Abrir ${ETIQUETA_TIPO[fila.tipo].toLowerCase()} en su módulo`}>
                      Abrir
                    </Link>
                    {fila.anulado ? (
                      <AdminBadge tone="neutral">Anulado</AdminBadge>
                    ) : confirmandoAnular === fila.clave ? (
                      <>
                        <AdminButton icon="check" onClick={() => void anularFila(fila)}>
                          Sí, anular
                        </AdminButton>
                        <AdminButton icon="close" onClick={() => setConfirmandoAnular(null)}>
                          No
                        </AdminButton>
                      </>
                    ) : (
                      <AdminButton icon="trash" title={`Anular ${ETIQUETA_TIPO[fila.tipo].toLowerCase()}`} onClick={() => setConfirmandoAnular(fila.clave)}>
                        Anular
                      </AdminButton>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="admin-dialog-text">
            Lo aplicado quedó auditado como cualquier operación del panel (los cobros con su movimiento de tesorería); las
            pantallas abiertas se actualizaron solas.
          </p>
        </>
      ) : null}
    </AdminDialog>,
    document.getElementById(ADMIN_ROOT_ID) ?? document.body,
  );
}
