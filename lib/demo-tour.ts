/**
 * Recorrido y casos fuertes de la demo pública (issue #58).
 *
 * Datos puros: los pasos del recorrido guiado y los accesos rápidos a los casos
 * difíciles que la demo siembra a propósito (mora, cheques rechazados, equipos
 * dañados, checklists incompletos, promotoras no disponibles, gastos «A definir»
 * y comprobantes por confirmar). Los conteos salen de la base en la portada de la
 * demo (`DemoStrongCaseId` los pide completos por tipo); acá viven sólo las
 * rutas y los textos, para que el test verifique que llevan a módulos reales.
 *
 * Las rutas son los módulos que la cuenta demo (VIEWER) sí puede abrir; los
 * módulos de administración (Usuarios, Empresa, Configuración, Auditoría y
 * Sistema) se resumen en la portada y no se enlazan desde acá.
 */

export type DemoTourStep = {
  id: string;
  /** Título corto del paso («Eventos»). */
  title: string;
  /** Qué mirar, en una línea. */
  what: string;
  /** Ruta del panel donde vive el paso. */
  href: string;
};

/** Recorrido corto: 5 pasos en el orden en que conviene ver la demo. */
export const DEMO_TOUR_STEPS: readonly DemoTourStep[] = [
  {
    id: "resumen",
    title: "Resumen",
    what: "Los números del día: qué está en juego, qué vence y qué queda por cerrar.",
    href: "/dashboard",
  },
  {
    id: "eventos",
    title: "Eventos",
    what: "Uno en curso con el checklist incompleto y otro en riesgo: probá el tablero y el arrastre.",
    href: "/eventos",
  },
  {
    id: "presupuestos",
    title: "Presupuestos y portal",
    what: "El pendiente con su QR y el aprobado con plan de pagos: probá la autogestión del cliente.",
    href: "/presupuestos",
  },
  {
    id: "finanzas",
    title: "Finanzas",
    what: "Mora, cheque rechazado, comprobantes por confirmar y gastos «A definir».",
    href: "/finanzas",
  },
  {
    id: "operacion",
    title: "Inventario y proveedores",
    what: "Equipos dañados o faltantes y trabajos de proveedor atrasados o abiertos.",
    href: "/inventario",
  },
];

export type DemoStrongCaseId =
  | "mora"
  | "cheques"
  | "comprobantes"
  | "equipos"
  | "checklist"
  | "promotoras"
  | "gastos"
  | "proveedores"
  | "leads";

export type DemoStrongCase = {
  id: DemoStrongCaseId;
  /** Etiqueta del acceso («Mora»). */
  label: string;
  /** Qué se ve al entrar. */
  hint: string;
  /** Módulo del panel donde está el caso. */
  href: string;
  /** Tono del conteo; sin tono queda neutro. */
  tone?: "accent" | "ok" | "warn" | "danger";
};

/**
 * Casos fuertes de la demo, en el orden de la portada. `count` sale de la base
 * (`Record<DemoStrongCaseId, number>` en la página): un caso sin dato no se
 * dibuja como número inventado, el conteo es el real y puede ser 0.
 */
export const DEMO_STRONG_CASES: readonly DemoStrongCase[] = [
  {
    id: "mora",
    label: "Cobros vencidos",
    hint: "Mora viva con su monto y días de atraso: cobrala o seguila por WhatsApp.",
    href: "/finanzas",
    tone: "danger",
  },
  {
    id: "cheques",
    label: "Cheque rechazado",
    hint: "Un cheque entró en cartera y fue rechazado: mirá el movimiento y su reversión.",
    href: "/finanzas",
    tone: "danger",
  },
  {
    id: "comprobantes",
    label: "Por confirmar",
    hint: "Comprobantes en revisión y esperados vencidos: lo esperado no es plata cobrada.",
    href: "/finanzas",
    tone: "warn",
  },
  {
    id: "checklist",
    label: "Checklist en riesgo",
    hint: "Eventos de esta semana sin ninguna tarea cumplida.",
    href: "/eventos",
    tone: "danger",
  },
  {
    id: "equipos",
    label: "Equipos dañados o faltantes",
    hint: "Salidas y devoluciones con daño o faltante sobre el inventario asignado.",
    href: "/inventario",
    tone: "warn",
  },
  {
    id: "promotoras",
    label: "Promotoras no disponibles",
    hint: "Una promotora no disponible y otra con disponibilidad «a definir».",
    href: "/promotoras",
    tone: "warn",
  },
  {
    id: "gastos",
    label: "Gastos «A definir»",
    hint: "Gastos sin proyecto asignado: probá asignarlos desde la fila en Finanzas.",
    href: "/finanzas",
    tone: "warn",
  },
  {
    id: "proveedores",
    label: "Proveedores con trabajos abiertos",
    hint: "Trabajos por estado con anticipos, vencimientos y atrasos.",
    href: "/proveedores",
    tone: "accent",
  },
  {
    id: "leads",
    label: "Leads sin contactar",
    hint: "Uno entró hace semanas: mirá el pipeline y pasalo a contacto.",
    href: "/leads",
    tone: "accent",
  },
];
