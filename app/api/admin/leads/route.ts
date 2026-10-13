import { randomUUID } from "node:crypto";
import { LeadStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { leadSchema, validationError } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Canales de un lead cargado a mano (cómo llegó la consulta). */
const MANUAL_SOURCES = ["llamada", "whatsapp", "referido", "evento", "otro"] as const;

const manualLeadSchema = leadSchema.pick({ name: true, phone: true, email: true, company: true, message: true }).extend({
  source: z.enum(MANUAL_SOURCES).default("otro"),
});

/**
 * Alta manual de un lead desde el panel («Nuevo lead»): una consulta que llegó
 * por llamada, WhatsApp o referido y no pasó por el formulario del sitio. Exige
 * `clients.write` (el mismo permiso que mueve el pipeline) y siempre queda en la
 * empresa activa, en estado `NEW`. El alta publica de `/api/leads` no cambia.
 *
 * La constancia de consentimiento no se inventa como si fuera del sitio: el canal
 * queda en `panel-manual` y es el equipo quien declara que el contacto lo pidió.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const parsed = manualLeadSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const data = parsed.data;
  const lead = await db.lead.create({
    data: {
      id: randomUUID(),
      organizationId: auth.context.organizationId,
      name: data.name,
      phone: data.phone,
      email: data.email.trim().toLowerCase(),
      company: data.company || undefined,
      message: data.message || undefined,
      source: `manual-${data.source}`,
      status: LeadStatus.NEW,
      consentAt: new Date(),
      consentChannel: "panel-manual",
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Lead",
    entityId: lead.id,
    summary: `Cargó el lead «${lead.name}» a mano`,
    detail: { fields: { name: lead.name, source: lead.source, company: lead.company } },
  });
  return Response.json({ lead: { id: lead.id, createdAt: lead.createdAt } }, { status: 201 });
}
