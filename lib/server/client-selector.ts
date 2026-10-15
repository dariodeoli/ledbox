import { db } from "./db";
const fields = { id: true, name: true, company: true, tradeName: true, legalName: true, type: true, active: true } as const;

/** La búsqueda ocurre antes del límite; la selección actual siempre se resuelve en su empresa. */
export async function listClientSelector(organizationId: string, query: string, selectedId?: string | null, limit = 30) {
  const search = query ? { OR: ["name", "company", "tradeName", "legalName", "ruc", "email", "phone"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {};
  const clients = await db.client.findMany({ where: { organizationId, ...search }, orderBy: [{ name: "asc" }, { id: "asc" }], take: limit, select: fields });
  if (selectedId && !clients.some((row) => row.id === selectedId)) {
    const selected = await db.client.findFirst({ where: { organizationId, id: selectedId }, select: fields });
    if (selected) clients.push(selected);
  }
  return clients;
}
