/**
 * Precarga del presupuesto desde un lead (Lead → Presupuesto). Función pura:
 * solo usa lo que el cliente dejó en el sitio (nunca las notas internas) y no
 * inventa nada cuando falta un dato.
 */
export type LeadBudgetSource = {
  name: string;
  company: string | null;
  reason: string | null;
  message: string | null;
  eventDate: Date | string | null;
  location: string | null;
};

export type LeadBudgetDraft = { title: string; notes: string; eventDate: string | null };

const TITLE_MAX = 160;
const NOTES_MAX = 2000;

const dayFormat = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Asuncion" });

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function leadBudgetDraft(lead: LeadBudgetSource): LeadBudgetDraft {
  const reason = clean(lead.reason);
  const date = lead.eventDate ? new Date(lead.eventDate) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const who = clean(lead.company) || clean(lead.name);
  const title = (reason || (validDate ? `Evento del ${dayFormat.format(validDate)}` : `Presupuesto para ${who}`)).slice(0, TITLE_MAX);
  const lines: string[] = [];
  if (validDate) lines.push(`Fecha del evento: ${dayFormat.format(validDate)}`);
  const location = clean(lead.location);
  if (location) lines.push(`Lugar: ${location}`);
  const message = (lead.message ?? "").trim();
  if (message) lines.push(`Pedido: ${message}`);
  return {
    title,
    notes: lines.join("\n").slice(0, NOTES_MAX),
    eventDate: validDate ? validDate.toISOString().slice(0, 10) : null,
  };
}
