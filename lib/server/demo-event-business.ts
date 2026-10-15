import type { Prisma } from "@prisma/client";
import type { DemoCompletion } from "./demo-data-completa";
import type { DemoBudgetSeed } from "./demo-data";

/** Casos ficticios de una empresa de alquileres; el mismo seed alimenta vitrina y sandbox. */
export function buildDemoEventBusiness(organizationId: string, base: Date): Pick<DemoCompletion,
  "clients" | "events" | "budgetSeeds" | "inventoryItems" | "inventoryUnits" | "inventoryComponents" | "assignments" | "incidents" | "payments" | "expectedPayments"> & { tasks: Prisma.EventTaskUncheckedCreateInput[] } {
  const at = (days: number, hour = 9) => new Date(base.getTime() + days * 86_400_000 + hour * 3_600_000);
  const org = { organizationId };
  const clientSpecs = [
    ["boda", "Lucía Benítez", null, "FINAL", "Boda íntima · vajilla y mobiliario"],
    ["catering", "Martín Vera", "Sabores del Patio · Demo", "RESELLER", "Catering y reposición de vajilla"],
    ["agencia", "Elena Acosta", "Nexo Eventos · Demo", "RESELLER", "Agencia corporativa con contacto de producción y facturación"],
    ["infantil", "Camila Torres", "Ronda Kids · Demo", "RESELLER", "Cumpleaños infantiles y livings"],
    ["exterior", "Diego Ríos", "Aire Libre Producciones · Demo", "RESELLER", "Carpas, exterior y energía"],
    ["particular", "Sofía Duarte", null, "FINAL", "Cumpleaños familiar; presupuesto por confirmar"],
  ] as const;
  const clients: DemoCompletion["clients"] = clientSpecs.map(([key, name, company, type, notes], index) => ({
    id: `demo_client_rental_${key}`, ...org, name, company, tradeName: company, legalName: company ? `${company} S.R.L. (ficticia)` : null,
    type, email: `${key}@alquileres.demo`, phone: `+595 981 00010${index}`, contactName: name, contactEmail: `${key}@alquileres.demo`,
    city: "Asunción", address: "Dirección ficticia de demostración", notes: `${notes}. Datos ficticios; sin envíos reales.`,
    contacts: company ? [{ name: `Equipo de producción ${index + 1}`, role: "Producción", email: `produccion.${key}@alquileres.demo` }, { name: `Administración ${index + 1}`, role: "Facturación", email: `pagos.${key}@alquileres.demo` }] : [],
    createdAt: at(-45 + index),
  }));
  const specs = [
    ["mesa_redonda", "Mesa redonda para 8 personas", "Mobiliario / Mesas", 12, 90_000, 750_000, "Ø 1,50 m · altura 0,75 m", 8],
    ["sillon_lino", "Sillón de lino de dos cuerpos", "Mobiliario / Living", 6, 250_000, 2_400_000, "1,60 × 0,80 m", 2],
    ["copa_agua", "Copa de agua cristal", "Vajilla / Copas", 48, 4_000, 22_000, "350 ml", null],
    ["plato_blanco", "Plato llano blanco", "Vajilla / Platos", 48, 5_000, 32_000, "Ø 27 cm", null],
    ["cubiertos", "Juego de cubiertos acero", "Vajilla / Cubiertos", 48, 6_000, 38_000, "Tenedor, cuchillo y cuchara", null],
    ["chafing", "Chafing dish doble", "Catering / Equipos", 4, 120_000, 890_000, "8 litros", null],
    ["gazebo", "Gazebo plegable blanco", "Exteriores / Carpas", 3, 350_000, 2_800_000, "3 × 3 m", null],
    ["estufa", "Estufa de exterior tipo hongo", "Exteriores / Climatización", 3, 230_000, 1_900_000, "Altura 2,20 m", null],
    ["par_led", "Par LED RGBW inalámbrico", "Iluminación / LED", 8, 95_000, 950_000, "6 × 18 W", null],
    ["parlante_portatil", "Parlante portátil para ceremonia", "Sonido / Parlantes", 2, 220_000, 2_600_000, "Batería hasta 6 horas", null],
    ["barra_medida", "Barra móvil a medida", "Mobiliario / Barras", 2, 0, 3_200_000, "Consultar terminación y medidas", null],
    ["alfombra", "Alfombra para ceremonia", "Decoración / Textiles", 1, 150_000, 900_000, "2 × 6 m", null],
  ] as const;
  const inventoryItems: DemoCompletion["inventoryItems"] = specs.map(([key, name, category, quantity, listPrice, replacementCost, dimensions, capacity]) => ({
    id: `demo_inv_rental_${key}`, ...org, name, category, sku: `ALQ-${key.toUpperCase().replaceAll("_", "-")}`, kind: "REUSABLE", quantity,
    listPrice, wholesalePrice: Math.round(listPrice * 0.8), replacementCost, dailyCost: Math.round(listPrice * 0.15), dimensions, capacity,
    status: key === "alfombra" ? "MAINTENANCE" : "AVAILABLE", billingUnit: "DAILY", visibleOnWeb: true, catalogAudience: "BOTH",
    publicDescription: listPrice ? `${name}. Se entrega limpio y revisado. Coordiná entrega y retiro para tu evento.` : "Cotización según terminación, montaje y fecha. Consultar precio y disponibilidad.",
    notes: "Producto ficticio de demostración; los movimientos y las incidencias explican la disponibilidad.", createdAt: at(-60),
  }));
  const inventoryUnits: DemoCompletion["inventoryUnits"] = specs.flatMap(([key, , , quantity, , cost], productIndex) =>
    Array.from({ length: quantity + (key === "mesa_redonda" ? 1 : 0) }, (_, index) => ({
      id: `demo_unit_rental_${key}_${index + 1}`, ...org, inventoryId: `demo_inv_rental_${key}`, code: `ALQ${String(productIndex + 1).padStart(2, "0")}-${String(index + 1).padStart(3, "0")}`,
      status: key === "mesa_redonda" && index === quantity ? "RETIRED" : key === "alfombra" || (key === "chafing" && index === 0) ? "MAINTENANCE" : key === "copa_agua" && index === 0 ? "DAMAGED" : "AVAILABLE",
      purchaseCost: cost, createdAt: at(-60),
    })));
  const inventoryComponents: DemoCompletion["inventoryComponents"] = [];
  for (const [key, name, price, capacity, components] of [
    ["mesa_ocho", "Mesa completa para 8 invitados", 330_000, 8, [["mesa_redonda", 1], ["copa_agua", 8], ["plato_blanco", 8], ["cubiertos", 8]]],
    ["buffet", "Estación buffet con iluminación", 380_000, null, [["chafing", 2], ["par_led", 2]]],
  ] as const) {
    const id = `demo_inv_rental_${key}`;
    inventoryItems.push({ id, ...org, name, category: "Combos", sku: `ALQ-${key.toUpperCase()}`, kind: "REUSABLE", quantity: 0, listPrice: price, wholesalePrice: price - 40_000, dailyCost: components.reduce((sum, [component, count]) => sum + Number(inventoryItems.find((item) => item.id === `demo_inv_rental_${component}`)?.dailyCost ?? 0) * count, 0) + (key === "mesa_ocho" ? 8 * 3_000 : 0), capacity, visibleOnWeb: true, catalogAudience: "BOTH", publicDescription: "Combo con componentes reales del inventario. El stock se calcula según sus componentes.", createdAt: at(-20) });
    for (const [component, quantity] of components) inventoryComponents.push({ id: `demo_component_rental_${key}_${component}`, ...org, parentId: id, componentId: `demo_inv_rental_${component}`, quantity });
  }
  inventoryComponents.push({ id: "demo_component_rental_mesa_ocho_sillas", ...org, parentId: "demo_inv_rental_mesa_ocho", componentId: "demo_inv_silla_cross_natural", quantity: 8 });
  const eventSpecs = [
    ["boda", "Boda Lucía y Andrés · vajilla y living", 12, "CONFIRMED"],
    ["catering", "Buffet de empresa · entrega en curso", 0, "IN_PROGRESS"],
    ["agencia", "Presentación Nexo · producción corporativa", 20, "CONFIRMED"],
    ["exterior", "Encuentro Aire Libre · devolución con novedades", -6, "COMPLETED"],
  ] as const;
  const events: DemoCompletion["events"] = eventSpecs.map(([key, name, day, status]) => ({
    id: `demo_event_rental_${key}`, ...org, clientId: `demo_client_rental_${key}`, name, status, location: "Salón de demostración · Asunción",
    setupAt: at(day === 0 ? -1 : day, 7), startsAt: at(day, 0), endsAt: at(day === 0 ? 1 : day, 23), strikeAt: at(day + 1, 8),
    notes: "Caso ficticio para probar preparación, entrega, devolución y cobros sin afectar a clientes reales.",
  }));
  const tasks: Prisma.EventTaskUncheckedCreateInput[] = events.flatMap((event) => [
    { id: `${event.id}_task_setup`, eventId: event.id, type: "SETUP", title: "Revisar cantidades, limpieza y carga del pedido", dueAt: event.setupAt, completedAt: event.status === "COMPLETED" || event.status === "IN_PROGRESS" ? event.setupAt : null },
    { id: `${event.id}_task_event`, eventId: event.id, type: "EVENT", title: "Confirmar recepción y contacto del responsable", dueAt: event.startsAt, completedAt: event.status === "COMPLETED" ? event.startsAt : null },
    { id: `${event.id}_task_return`, eventId: event.id, type: "STRIKE", title: "Contar devolución y separar piezas con novedades", dueAt: event.strikeAt, completedAt: event.status === "COMPLETED" ? event.strikeAt : null },
  ]);
  const assignments: DemoCompletion["assignments"] = [
    { id: "demo_asg_rental_boda_mesa", ...org, eventId: "demo_event_rental_boda", inventoryId: "demo_inv_rental_mesa_redonda", quantity: 3, startsAt: at(12, 7), endsAt: at(13, 8) },
    { id: "demo_asg_rental_buffet", ...org, eventId: "demo_event_rental_catering", inventoryId: "demo_inv_rental_chafing", quantity: 2, startsAt: at(-1, 7), endsAt: at(1, 8), checkedOut: true, checkedOutAt: at(-1, 10), checkoutQuantity: 2, conditionOut: "Bueno" },
    { id: "demo_asg_rental_exterior", ...org, eventId: "demo_event_rental_exterior", inventoryId: "demo_inv_rental_copa_agua", quantity: 24, startsAt: at(-6, 7), endsAt: at(-5, 8), checkedOut: true, checkedIn: true, checkedOutAt: at(-6, 8), checkedInAt: at(-5, 10), checkoutQuantity: 24, returnedQuantity: 24, damagedQuantity: 1, missingQuantity: 0, conditionOut: "Bueno", conditionIn: "Una copa astillada", damageNotes: "Copa apartada; pendiente de reposición." },
  ];
  // Las reservas de las piezas del combo se materializan sobre el stock físico.
  for (const [key, quantity] of [["copa_agua", 24], ["plato_blanco", 24], ["cubiertos", 24], ["sillon_lino", 2]] as const) {
    assignments.push({ id: `demo_asg_rental_boda_${key}`, ...org, eventId: "demo_event_rental_boda", inventoryId: `demo_inv_rental_${key}`, quantity, startsAt: at(12, 7), endsAt: at(13, 8) });
  }
  assignments.push({ id: "demo_asg_rental_boda_sillas", ...org, eventId: "demo_event_rental_boda", inventoryId: "demo_inv_silla_cross_natural", quantity: 24, startsAt: at(12, 7), endsAt: at(13, 8) });
  for (const [key, quantity] of [["par_led", 4], ["parlante_portatil", 1]] as const) assignments.push({ id: `demo_asg_rental_agencia_${key}`, ...org, eventId: "demo_event_rental_agencia", inventoryId: `demo_inv_rental_${key}`, quantity, startsAt: at(20, 7), endsAt: at(21, 8) });
  assignments.push({ id: "demo_asg_rental_buffet_platos", ...org, eventId: "demo_event_rental_catering", inventoryId: "demo_inv_rental_plato_blanco", quantity: 24, startsAt: at(-1, 7), endsAt: at(1, 8), checkedOut: true, checkedOutAt: at(-1, 10), checkoutQuantity: 24, conditionOut: "Bueno" });
  assignments.push({ id: "demo_asg_rental_exterior_gazebo", ...org, eventId: "demo_event_rental_exterior", inventoryId: "demo_inv_rental_gazebo", quantity: 1, startsAt: at(-6, 7), endsAt: at(-5, 8), checkedOut: true, checkedIn: true, checkedOutAt: at(-6, 8), checkedInAt: at(-5, 10), checkoutQuantity: 1, returnedQuantity: 1, conditionOut: "Bueno", conditionIn: "Bueno" });
  const incidents: DemoCompletion["incidents"] = [
    { id: "demo_inc_rental_copa", ...org, inventoryId: "demo_inv_rental_copa_agua", unitId: "demo_unit_rental_copa_agua_1", eventId: "demo_event_rental_exterior", assignmentId: "demo_asg_rental_exterior", kind: "DAMAGE", status: "OPEN", quantity: 1, notes: "Borde astillado en devolución; no se ofrece para alquiler.", openedAt: at(-5, 10) },
    { id: "demo_inc_rental_chafing", ...org, inventoryId: "demo_inv_rental_chafing", unitId: "demo_unit_rental_chafing_1", kind: "REPAIR", status: "IN_REPAIR", quantity: 1, cost: 180_000, notes: "Cambio de bisagra; quedan tres unidades aptas, dos entregadas.", openedAt: at(-3) },
    { id: "demo_inc_rental_alfombra", ...org, inventoryId: "demo_inv_rental_alfombra", unitId: "demo_unit_rental_alfombra_1", kind: "CLEANING", status: "OPEN", quantity: 1, notes: "Lavado y secado; no disponible hasta completar limpieza.", openedAt: at(-2) },
    { id: "demo_inc_rental_mesa", ...org, inventoryId: "demo_inv_rental_mesa_redonda", unitId: "demo_unit_rental_mesa_redonda_13", kind: "DAMAGE", status: "WRITTEN_OFF", quantity: 1, notes: "Estructura irrecuperable, retirada sin contar como stock activo.", openedAt: at(-15), resolvedAt: at(-12), resolvedById: "demo_user_valeria" },
  ];
  const budgetSeeds: DemoBudgetSeed[] = clientSpecs.map(([key, name], index) => {
    const approved = index < 3 || key === "exterior";
    const lineSpecs = key === "boda" ? [["mesa_ocho", 3], ["sillon_lino", 2]] as const : key === "catering" ? [["chafing", 2], ["plato_blanco", 24]] as const : key === "agencia" ? [["par_led", 4], ["parlante_portatil", 1]] as const : key === "exterior" ? [["copa_agua", 24], ["gazebo", 1]] as const : [["sillon_lino", 2]] as const;
    const items = lineSpecs.map(([itemKey, quantity], lineIndex) => {
      const item = inventoryItems.find((entry) => entry.id === `demo_inv_rental_${itemKey}`)!;
      return { id: `demo_bi_rental_${key}_${lineIndex}`, inventoryId: item.id, name: item.name, quantity, days: 1, unitPrice: Number(item.listPrice), costPrice: Number(item.dailyCost ?? 0) };
    });
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const advance = Math.floor(total / 2);
    return { id: `demo_budget_rental_${key}`, clientId: `demo_client_rental_${key}`, event: approved ? { id: `demo_event_rental_${key}`, clientId: `demo_client_rental_${key}` } : undefined,
      title: `Alquiler · ${clientSpecs[index][4]}`, status: approved ? "APPROVED" : key === "infantil" ? "NEGOTIATING" : "DRAFT", discount: 0, validUntil: at(7, 18), deliveryAt: approved ? undefined : at(30, 9),
      notes: "Datos ficticios. Los pagos pendientes no se contabilizan como dinero recibido.", createdAt: at(-10), items,
      approval: approved ? { at: at(-8), byName: name, method: "manual", note: "Aceptación simulada del ejemplo demo." } : undefined,
      revision: key === "infantil" ? { at: at(-1), note: "Cambiar color de los sillones y confirmar invitados." } : undefined,
      plan: { advance, terms: "50% de seña y saldo antes de la entrega.", installments: [{ label: "Saldo", amount: total - advance, dueInDays: key === "exterior" ? -7 : 8 }] },
    };
  });
  const payments: DemoCompletion["payments"] = [];
  const expectedPayments: DemoCompletion["expectedPayments"] = [];
  for (const budget of budgetSeeds.filter((row) => row.status === "APPROVED")) {
    const key = budget.id.replace("demo_budget_rental_", "");
    for (const concept of ["advance", "balance"] as const) {
      const amount = concept === "advance" ? budget.plan!.advance : budget.plan!.installments[0].amount;
      const received = concept === "advance" || key === "exterior";
      const paymentId = `demo_pay_rental_${key}_${concept}`;
      if (received) payments.push({ id: paymentId, ...org, budgetId: budget.id, clientId: budget.clientId!, amount, status: "RECEIVED", paidAt: at(concept === "advance" ? -7 : -5), collectedAt: at(concept === "advance" ? -7 : -5), method: "Transferencia", reference: `DEMO-${key}-${concept}`, treasuryAccountId: "demo_treasury_ueno", notes: "Cobro ficticio para demostración." });
      expectedPayments.push({ id: `demo_expected_rental_${key}_${concept}`, ...org, budgetId: budget.id, concept: concept === "advance" ? "advance" : "installment", slot: concept === "advance" ? "advance" : "installment:1", installmentNumber: concept === "advance" ? null : 1, label: concept === "advance" ? "Seña 50%" : "Saldo", amount, paidAmount: received ? amount : 0, dueAt: at(concept === "advance" ? -7 : key === "exterior" ? -5 : 8), status: received ? "CONFIRMED" : "AWAITING", paymentId: received ? paymentId : null, confirmedAt: received ? at(concept === "advance" ? -7 : -5) : null, confirmedById: received ? "demo_user_valeria" : null, expectedAccountId: "demo_treasury_ueno" });
    }
  }
  return { clients, events, tasks, budgetSeeds, inventoryItems, inventoryUnits, inventoryComponents, assignments, incidents, payments, expectedPayments };
}
