/**
 * Ayuda contextual del panel («¿Qué es esto?»): fuente única por ruta.
 *
 * Cada módulo del nav (`lib/admin-policy.ts`) tiene acá su explicación: qué se
 * hace en la pantalla y para qué sirve, en 3–5 bullets concretos, con 2–3 links
 * a las pantallas que completan el trabajo. Los textos describen **solo** lo que
 * el módulo hace de verdad (nada de features inventadas) y no repiten el título
 * de la pantalla.
 *
 * La ruta se resuelve por prefijo (`/configuracion/seguridad` usa la ayuda de
 * `/configuracion`), igual que el título del topbar (`adminNavLabel`).
 */

export type AdminModuleHelpLink = {
  /** Ruta limpia del panel (las mismas del shell). */
  href: string;
  label: string;
};

export type AdminModuleHelp = {
  /** Nombre del módulo, igual que en el nav. */
  title: string;
  /** Una línea: para qué existe el módulo. */
  summary: string;
  /** 3–5 bullets cortos: qué se hace acá y para qué. */
  bullets: readonly string[];
  /** 2–3 links internos útiles. */
  links: readonly AdminModuleHelpLink[];
};

export const MODULE_HELP: Record<string, AdminModuleHelp> = {
  "/dashboard": {
    title: "Resumen",
    summary: "La foto del día: cartera, agenda, plata y equipo en una sola pantalla, sin abrir cada módulo.",
    bullets: [
      "Los indicadores salen de datos reales de la empresa activa: clientes activos, eventos no cancelados, presupuestos vigentes y leads nuevos.",
      "«Qué mirar hoy» junta vencimientos, cobros y checklist en riesgo; cada línea lleva al módulo donde se resuelve.",
      "Los bloques de próximos eventos, tareas vencidas y checklist pendiente abren el registro real.",
      "Por cobrar y por pagar se derivan de los cobros y pagos registrados: lo pendiente no cuenta como cobrado.",
    ],
    links: [
      { href: "/eventos", label: "Agenda de eventos" },
      { href: "/finanzas", label: "Cobros y pagos" },
      { href: "/presupuestos", label: "Pipeline comercial" },
    ],
  },
  "/eventos": {
    title: "Eventos",
    summary: "El corazón operativo: cada evento con su cliente, sus fechas, sus equipos y su checklist.",
    bullets: [
      "Cargá cliente, nombre, lugar y fechas; al crear el evento se genera el checklist base de montaje, desmontaje y cobro.",
      "Asigná equipos por rango de fechas: el panel avisa si se solapan con otro evento y cuánto queda disponible.",
      "Registrá salida y devolución con el estado del equipo; daños y faltantes quedan asentados en la asignación.",
      "Las tareas del checklist vencen con fecha y pueden quedar a cargo de una promotora.",
    ],
    links: [
      { href: "/inventario", label: "Equipos y disponibilidad" },
      { href: "/presupuestos", label: "Presupuestos del evento" },
      { href: "/calendario", label: "Vista del mes" },
    ],
  },
  "/calendario": {
    title: "Calendario",
    summary: "La agenda operativa que cruza eventos, cobros, pagos y vencimientos en el mismo calendario.",
    bullets: [
      "Vista de mes y de semana (en mobile, lista por día) con montajes, eventos, desmontajes, cobros y checklist.",
      "Cada día se abre en detalle y muestra de dónde sale cada movimiento.",
      "El bloque de vencimientos y checklist avisa lo que se viene y lo que quedó atrasado.",
    ],
    links: [
      { href: "/eventos", label: "Eventos y checklist" },
      { href: "/finanzas", label: "Cobros y pagos" },
    ],
  },
  "/clientes": {
    title: "Clientes",
    summary: "La cartera comercial con la ficha 360 de cada cliente, armada con datos reales.",
    bullets: [
      "Filtrá por tipo (final, mayorista, revendedor) o por deuda vencida, y ordená por monto contratado o última actividad.",
      "La ficha resume contratos, cobrado, saldo pendiente, mora, ticket promedio y frecuencia de compra.",
      "Cargá contactos directos (encargado, WhatsApp, Instagram y web) y el logo que el cliente ve en el portal.",
      "Desde la ficha se abren sus presupuestos, eventos y cobros sin salir de la pantalla.",
    ],
    links: [
      { href: "/presupuestos", label: "Presupuestos del cliente" },
      { href: "/eventos", label: "Eventos del cliente" },
      { href: "/finanzas", label: "Cobros y saldos" },
    ],
  },
  "/leads": {
    title: "Leads",
    summary: "El pipeline comercial que arranca con lo que llega desde el sitio.",
    bullets: [
      "Cada consulta entra con el pedido del sitio: productos, cantidades, días y fecha tentativa.",
      "Movés el estado del pipeline y el detalle guarda las notas internas del equipo.",
      "Un lead ganado se convierte en cliente con un clic, sin volver a tipear los datos.",
    ],
    links: [
      { href: "/clientes", label: "Cartera de clientes" },
      { href: "/presupuestos", label: "Cotizar la venta" },
    ],
  },
  "/presupuestos": {
    title: "Presupuestos",
    summary: "Lo que se cotiza y se cierra: ítems, costos, margen, portal del cliente y plan de pagos.",
    bullets: [
      "Armá la propuesta con ítems, cantidades, días, descuento y validez; el margen sale de los costos declarados.",
      "Generá el link del portal (o el QR): el cliente ve la propuesta, la aprueba con evidencia o pide cambios.",
      "Al aprobarse, los ítems vinculados al inventario reservan stock en las fechas del evento.",
      "El anticipo y las cuotas del plan de pagos alimentan los pagos esperados de Finanzas.",
      "Las solicitudes del portal se resuelven acá, aceptándolas o rechazándolas con nota.",
    ],
    links: [
      { href: "/clientes", label: "Datos del cliente" },
      { href: "/finanzas", label: "Cobros y pagos esperados" },
      { href: "/plantillas", label: "Mensajes de WhatsApp" },
    ],
  },
  "/facturacion": {
    title: "Facturación",
    summary: "El registro fiscal interno de la empresa activa, con numeración propia y libro de IVA.",
    bullets: [
      "Emití desde un presupuesto aprobado o a mano, con IVA 10 %, 5 % o exenta sobre montos enteros en guaraníes.",
      "La numeración es correlativa por empresa y sin huecos; anular exige motivo y no borra el comprobante.",
      "El libro de IVA de ventas y compras se exporta a CSV y el cierre mensual bloquea el mes.",
      "Reabrir un mes cerrado es solo de OWNER y queda auditado.",
      "Alcance: registro interno. Todavía no es la factura electrónica de SIFEN/DNIT.",
    ],
    links: [
      { href: "/presupuestos", label: "Presupuestos aprobados" },
      { href: "/finanzas", label: "Cobros y tesorería" },
    ],
  },
  "/finanzas": {
    title: "Finanzas",
    summary: "La plata de la empresa: cobros, pagos, cuentas, gastos y la conciliación del banco.",
    bullets: [
      "Registrá cobros de clientes (incluye factura a plazo y cheque) y pagos a proveedores.",
      "Las cuentas de tesorería muestran el saldo derivado del saldo inicial más los movimientos; nunca un saldo bancario estimado.",
      "Importá el extracto del banco en CSV y conciliá cada fila contra los movimientos de la cuenta.",
      "Los gastos se cargan por categoría y proyecto; los comprobantes que sube el cliente se confirman acá.",
      "Los recordatorios de cobro y los reportes del período (imprimible y CSV) salen del mismo lugar.",
    ],
    links: [
      { href: "/proveedores", label: "Trabajos y pagos a proveedores" },
      { href: "/presupuestos", label: "Plan de pagos" },
      { href: "/facturacion", label: "Registro fiscal" },
    ],
  },
  "/plantillas": {
    title: "Plantillas",
    summary: "Los mensajes de WhatsApp que el equipo reutiliza, por contexto y con variables.",
    bullets: [
      "Escribí el texto una vez con variables ({{cliente}}, {{monto}}, {{vencimiento}}, {{link_portal}}) y el panel las completa con datos reales.",
      "Solo las plantillas activas se ofrecen al enviar desde presupuestos, eventos o cobros.",
      "FINANCE administra las de cobranza, OPERATIONS las de eventos y OWNER/ADMIN todas.",
    ],
    links: [
      { href: "/presupuestos", label: "Enviar desde un presupuesto" },
      { href: "/finanzas", label: "Recordatorios de cobro" },
    ],
  },
  "/inventario": {
    title: "Inventario",
    summary: "Los equipos y consumibles que la empresa mueve, con disponibilidad real por fecha.",
    bullets: [
      "Cargá cada ítem con categoría, SKU, tipo (reutilizable, consumible o descartable), cantidad y estado.",
      "Consultá la disponibilidad de un rango concreto: el panel marca sobrecompromiso y conflictos entre eventos.",
      "Desde el evento se registra la salida y la devolución, con daños y faltantes.",
      "El CSV exporta lo que estás viendo, con los filtros puestos.",
    ],
    links: [
      { href: "/eventos", label: "Asignaciones por evento" },
      { href: "/presupuestos", label: "Ítems vinculados a stock" },
    ],
  },
  "/proveedores": {
    title: "Proveedores",
    summary: "El directorio de proveedores y el seguimiento de cada trabajo contratado.",
    bullets: [
      "Guardá rubro, contactos y condiciones de pago de cada proveedor.",
      "Cada trabajo avanza por su flujo (contratado, anticipo, producción, entrega, saldo y pagado) y el panel no deja retroceder.",
      "El saldo pendiente y los vencimientos alimentan «por pagar» en Finanzas.",
    ],
    links: [
      { href: "/finanzas", label: "Pagos y tesorería" },
      { href: "/eventos", label: "Eventos que los contratan" },
    ],
  },
  "/promotoras": {
    title: "Promotoras",
    summary: "El plantel de promotoras y su disponibilidad para las tareas de cada evento.",
    bullets: [
      "Cargá contacto, especialidades y foto; la identidad se dibuja con el avatar del panel.",
      "Declarás disponibilidad (disponible, no disponible o a definir) con motivo y fecha.",
      "En Eventos se asignan a las tareas del checklist, con el aviso cuando no están disponibles.",
    ],
    links: [
      { href: "/eventos", label: "Tareas y eventos" },
      { href: "/calendario", label: "Agenda del mes" },
    ],
  },
  "/configuracion": {
    title: "Configuración",
    summary: "Los ajustes que no viven dentro de cada operación: correo de la empresa y seguridad del panel.",
    bullets: [
      "Correo: remitente, clave del proveedor, envío de prueba e historial de envíos.",
      "Seguridad: tu PIN de desbloqueo y el tiempo de auto-bloqueo por inactividad (es de tu cuenta, no de la empresa).",
      "La sección Correo es de OWNER/ADMIN: el API responde 403 al resto de los roles.",
    ],
    links: [
      { href: "/empresa", label: "Identidad de la empresa" },
      { href: "/perfil", label: "Mi perfil" },
    ],
  },
  "/empresa": {
    title: "Empresa",
    summary: "La identidad de la empresa activa en el panel, en el portal y en los papeles.",
    bullets: [
      "El nombre se usa en el panel, en los imprimibles y en los correos; el identificador estable no se edita.",
      "Subí los dos logos: el claro para fondos oscuros y el oscuro para fondos claros; en papel siempre va el claro.",
      "Los datos de pago de los presupuestos y los datos fiscales se cargan en sus módulos.",
    ],
    links: [
      { href: "/presupuestos", label: "Datos de pago" },
      { href: "/facturacion", label: "Datos fiscales" },
    ],
  },
  "/plan": {
    title: "Plan",
    summary: "El plan contratado, el consumo del mes y el camino para cambiarlo.",
    bullets: [
      "Muestra el plan vigente, sus topes y el consumo real del mes (usuarios y eventos).",
      "Compará los planes del catálogo y pedí el cambio: la solicitud queda auditada.",
      "No hay pago en línea: el cambio efectivo lo aplica Owncoding.",
    ],
    links: [
      { href: "/usuarios", label: "Equipo y topes" },
      { href: "/sistema", label: "Estado del servicio" },
    ],
  },
  "/usuarios": {
    title: "Usuarios",
    summary: "El equipo que entra a la empresa activa y con qué rol.",
    bullets: [
      "Invitá por correo con el rol puesto; el link vence y se puede reenviar.",
      "Desactivar a alguien le corta el acceso sin borrar su historial ni su auditoría.",
      "El rol es por empresa: la misma cuenta puede tener roles distintos en cada una.",
      "Al cambiar el correo se cierran las sesiones de esa persona.",
    ],
    links: [
      { href: "/auditoria", label: "Historial de cambios" },
      { href: "/plan", label: "Topes del plan" },
    ],
  },
  "/auditoria": {
    title: "Auditoría",
    summary: "El historial de cambios de la empresa activa: quién hizo qué y con qué valores.",
    bullets: [
      "Cada alta, edición o baja registrada deja actor, fecha, entidad y los campos que cambiaron.",
      "Filtrá por entidad, actor o rango de fechas y desplegá la fila para ver el antes y el después.",
      "Solo OWNER y ADMIN entran acá: el API responde 403 al resto.",
    ],
    links: [
      { href: "/usuarios", label: "Equipo" },
      { href: "/sistema", label: "Estado del servicio" },
    ],
  },
  "/sistema": {
    title: "Sistema",
    summary: "El estado técnico del despliegue: versión, base, migraciones y respaldos.",
    bullets: [
      "Muestra la versión publicada, el estado de la base y las migraciones aplicadas.",
      "El respaldo se lee de su estado real (fecha, tamaño, resultado y último error); sin respaldo, lo dice.",
      "Solo OWNER/ADMIN; la demo pública no expone esta pantalla.",
    ],
    links: [
      { href: "/auditoria", label: "Historial de cambios" },
      { href: "/plan", label: "Plan y consumo" },
    ],
  },
  "/perfil": {
    title: "Mi perfil",
    summary: "Tus datos de cuenta y la seguridad con la que entrás al panel.",
    bullets: [
      "Editá tu nombre y tu foto; el correo lo cambia un OWNER/ADMIN desde Usuarios.",
      "Cambiá tu contraseña pidiendo la actual.",
      "Configurá el PIN y el tiempo de auto-bloqueo: con PIN, el panel se bloquea solo por inactividad.",
    ],
    links: [
      { href: "/dashboard", label: "Ir al resumen" },
      { href: "/calendario", label: "Agenda del mes" },
    ],
  },
};

/**
 * Ayuda de la ruta actual (por prefijo, como el título del topbar); `null` si la
 * ruta no es un módulo con ayuda (por ejemplo `/demo`), y entonces no se dibuja
 * el botón.
 */
export function moduleHelpFor(pathname: string): AdminModuleHelp | null {
  for (const [href, help] of Object.entries(MODULE_HELP)) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return help;
  }
  return null;
}
