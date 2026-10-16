import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { withIdempotency, requestHashOf } from "./idempotency";
import { lockInventoryItems } from "./inventory-availability";
import { markOwnPrice } from "./inventory-families";
import { replaceAudienceTiers } from "./price-tier-store";
import { recordAudit, type AuditContext } from "./audit";
import { readSelectedPrices, selectedPriceValue, type SelectedPriceRow, type SelectedPriceResult, type SelectedPriceField } from "../import-selected-prices";
import { type PriceTier, tiersForAudience } from "../price-tiers";
import { jsonError } from "./http";
const MANIFEST_SCOPE = "import:selected-prices:manifest:v1";
const ROW_SCOPE = "import:selected-prices:row:v1";
const ISSUER = "ledbox:import-price-preview";
const AUDIENCE = "ledbox:import-price-apply";
const selection = { id: true, sku: true, name: true, archivedAt: true, familyId: true, variantOwnPrice: true, listPrice: true, wholesalePrice: true, minimumPrice: true, comboIncomplete: true, _count: { select: { components: true } } } as const;
type Expectation = {
    fila: number;
    id: string;
    fingerprint: string;
};
type Manifest = {
    lote: string;
    hash: string;
    actorId: string | null;
    rows: SelectedPriceRow[];
    expected: Expectation[];
};
function secret() {
    const value = process.env.JWT_SECRET || process.env.AUTH_SECRET;
    if (!value)
        throw new Error("La confirmación de importación no está configurada.");
    return new TextEncoder().encode(value);
}
function changedFields(row: SelectedPriceRow) { return Object.entries(row.cambios).filter(([, op]) => op!.op !== "KEEP") as Array<[
    SelectedPriceField,
    NonNullable<SelectedPriceRow["cambios"][SelectedPriceField]>
]>; }
async function snapshot(client: Pick<typeof db, "inventoryItem" | "inventoryPriceTier">, organizationId: string, row: SelectedPriceRow, id?: string) {
    const item = await client.inventoryItem.findFirst({ where: { organizationId, ...(id ? { id } : { sku: row.codigo }) }, select: selection });
    if (!item || item.archivedAt || item.sku !== row.codigo)
        return null;
    const tiers = await client.inventoryPriceTier.findMany({ where: { organizationId, inventoryId: item.id }, orderBy: [{ audience: "asc" }, { fromDays: "asc" }], select: { audience: true, fromDays: true, mode: true, price: true } });
    const values: Record<string, unknown> = {};
    for (const [field] of changedFields(row))
        values[field] = field === "tarifasFinal" ? tiersForAudience(tiers, "RETAIL") : field === "tarifasMayorista" ? tiersForAudience(tiers, "WHOLESALE") : item[field];
    const fingerprint = requestHashOf({ id: item.id, sku: item.sku, familyId: item.familyId, variantOwnPrice: item.variantOwnPrice, comboIncomplete: item.comboIncomplete, components: item._count.components, values });
    return { item, values, fingerprint };
}
function differences(row: SelectedPriceRow, before: Record<string, unknown>): Array<{
    campo: string;
    antes: unknown;
    despues: unknown;
}> {
    return changedFields(row).map(([campo, instruction]) => ({ campo, antes: before[campo], despues: selectedPriceValue(instruction, campo) }));
}
export async function previewSelectedPrices(context: AuditContext, raw: unknown) {
    const parsed = readSelectedPrices(raw);
    if (!parsed.ok)
        return jsonError(parsed.error, 400);
    const expected: Expectation[] = [], filas = [];
    for (const row of parsed.rows) {
        const current = row.errores.length ? null : await snapshot(db, context.organizationId, row);
        const errors = [...row.errores];
        if (!row.errores.length && !current)
            errors.push("El código no existe activo en esta empresa; este modo no crea productos.");
        if (current)
            expected.push({ fila: row.fila, id: current.item.id, fingerprint: current.fingerprint });
        filas.push({ fila: row.fila, codigo: row.codigo, nombre: current?.item.name ?? row.codigo, accion: errors.length ? "omitir" : "actualizar", detalle: errors.join(" ") || (current?.item.familyId && changedFields(row).length ? "Sólo precios; la variante pasa a precio propio." : "Sólo los precios elegidos; el resto se conserva."), cambios: current ? differences(row, current.values) : [], errores: errors });
    }
    const hash = requestHashOf({ catalogo: raw });
    const confirmationToken = await new SignJWT({ organizationId: context.organizationId, actorId: context.user.id, hash, expected })
        .setProtectedHeader({ alg: "HS256" }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime("15m").sign(secret());
    return Response.json({ importMode: "UPDATE_SELECTED", catalogo: raw, confirmationToken, zip: false, tarjetas: [{ clave: "actualizar", etiqueta: "Filas revisables de precios", valor: filas.filter(r => !r.errores.length).length }], problemas: filas.flatMap(r => r.errores.map(mensaje => ({ nivel: "error", tipo: "precio-selectivo", codigo: r.codigo, fila: r.fila, mensaje }))), filas });
}
function emptyResult(row: SelectedPriceRow): SelectedPriceResult { return { fila: row.fila, codigo: row.codigo, estado: row.errores.length ? "invalida" : "pendiente", mensaje: row.errores.join(" ") || "Sin resultado comprometido. Revisá o reintentá este lote; sus éxitos no se repetirán." }; }
async function manifestOf(organizationId: string, lote: string) {
    const stored = await db.idempotencyKey.findFirst({ where: { organizationId, scope: MANIFEST_SCOPE, key: lote, expiresAt: { gt: new Date() } }, select: { response: true } });
    return stored?.response as unknown as Manifest | undefined;
}
export async function selectedPriceReport(organizationId: string, lote: string) {
    const manifest = await manifestOf(organizationId, lote);
    if (!manifest)
        return jsonError("No hay un reporte vigente de ese lote en esta empresa.", 404);
    const rows = await db.idempotencyKey.findMany({ where: { organizationId, scope: ROW_SCOPE, key: { in: manifest.rows.map(r => `${lote}:${r.fila}`) }, expiresAt: { gt: new Date() } }, select: { key: true, response: true } });
    const resultRows = manifest.rows.map(row => (rows.find(r => r.key === `${lote}:${row.fila}`)?.response as unknown as SelectedPriceResult | undefined) ?? emptyResult(row));
    return Response.json({ lote, importMode: "UPDATE_SELECTED", creados: [], actualizados: resultRows.filter(r => r.estado === "aplicada").length, juegos: 0, fotos: 0, omitidos: resultRows.filter(r => !["aplicada", "conservada"].includes(r.estado)).length, fallidos: resultRows.filter(r => !["aplicada", "conservada"].includes(r.estado)).map(r => ({ codigo: r.codigo, mensaje: r.mensaje })), filasPrecio: resultRows, reintento: { productos: manifest.rows.filter(row => !row.errores.length && resultRows.some(r => r.fila === row.fila && (r.estado === "conflicto" || r.estado === "pendiente"))).map(({ codigo, cambios }) => ({ codigo, cambios })) }, avisos: [{ codigo: "Reporte", mensaje: "Recuperable por 7 días. Sólo precios; fotos, estados y otros datos se conservaron." }], tarjetas: ["aplicada", "conservada", "invalida", "conflicto", "pendiente"].map(estado => ({ etiqueta: estado, valor: resultRows.filter(r => r.estado === estado).length })) });
}
/** A row's complete selected price group and its replay receipt commit together. */
export async function applySelectedPrices(context: AuditContext, raw: unknown, token: string, lote: string, request: Request) {
    const parsed = readSelectedPrices(raw);
    if (!parsed.ok)
        return jsonError(parsed.error, 400);
    if (!/^[0-9a-f-]{36}$/i.test(lote))
        return jsonError("Falta un identificador válido del lote.", 400);
    const hash = requestHashOf({ catalogo: raw });
    let manifest = await manifestOf(context.organizationId, lote);
    if (manifest && (manifest.hash !== hash || manifest.actorId !== context.user.id))
        return jsonError("El lote corresponde a otro contenido o actor; generá una vista previa nueva.", 409);
    const cleanRequest = new Request(request.url); // caller header never replaces a per-row key
    if (!manifest) {
        let expected: Expectation[];
        try {
            const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
            if (payload.organizationId !== context.organizationId || payload.actorId !== context.user.id || payload.hash !== hash || !Array.isArray(payload.expected))
                throw new Error("Scope mismatch");
            expected = payload.expected as Expectation[];
        }
        catch {
            return jsonError("La vista previa venció o cambió. Generá una nueva antes de aplicar.", 409);
        }
        const candidate: Manifest = { lote, hash, actorId: context.user.id, rows: parsed.rows, expected };
        const receipt = await withIdempotency({ request: cleanRequest, organizationId: context.organizationId, scope: MANIFEST_SCOPE, body: { idempotencyKey: lote, hash, actorId: context.user.id } }, async () => ({ status: 200, body: candidate }));
        if (!receipt.ok)
            return receipt;
        manifest = await receipt.json() as Manifest;
    }
    for (const row of manifest.rows) {
        if (row.errores.length)
            continue;
        const expectation = manifest.expected.find(e => e.fila === row.fila);
        const rowReceipt = await withIdempotency({ request: cleanRequest, organizationId: context.organizationId, scope: ROW_SCOPE, body: { idempotencyKey: `${lote}:${row.fila}`, hash, row } }, async (tx) => {
            const result = (estado: SelectedPriceResult["estado"], mensaje: string, cambios?: SelectedPriceResult["cambios"]) => ({ status: 200, body: { fila: row.fila, codigo: row.codigo, estado, mensaje, ...(cambios ? { cambios } : {}) } });
            if (!expectation)
                return result("invalida", "El código no estaba disponible en la vista previa; no se crea ni se modifica.");
            await lockInventoryItems(tx, context.organizationId, [expectation.id]);
            const current = await snapshot(tx as unknown as typeof db, context.organizationId, row, expectation.id);
            if (!current || current.fingerprint !== expectation.fingerprint)
                return result("conflicto", "Los precios, la identidad o la estructura cambiaron desde la vista previa. No se sobrescribió nada; generá una vista previa nueva.");
            const changes = differences(row, current.values).filter(c => requestHashOf({ value: c.antes }) !== requestHashOf({ value: c.despues }));
            if (!changes.length)
                return result("conservada", "Los precios elegidos ya eran iguales; no se reescribieron.", []);
            const data: Record<string, number> = {};
            for (const [field, instruction] of changedFields(row)) {
                const value = selectedPriceValue(instruction, field)!;
                if (field === "tarifasFinal" || field === "tarifasMayorista")
                    await replaceAudienceTiers(tx, context.organizationId, current.item.id, field === "tarifasFinal" ? "RETAIL" : "WHOLESALE", value as PriceTier[]);
                else
                    data[field] = value as number;
            }
            if (Object.keys(data).length)
                await tx.inventoryItem.update({ where: { id: current.item.id }, data });
            await markOwnPrice(tx, context.organizationId, [current.item.id]);
            if (current.item.familyId && !current.item.variantOwnPrice)
                changes.push({ campo: "variantOwnPrice", antes: false, despues: true });
            await recordAudit({ context, action: "update", entity: "InventoryItem", entityId: current.item.id, summary: "Actualización selectiva de precios por importación", detail: { fields: { lote, fila: row.fila }, changes: Object.fromEntries(changes.map(c => [c.campo, { from: c.antes, to: c.despues }])) } }, tx);
            return result("aplicada", current.item.familyId ? "Precios guardados; esta variante usa precio propio." : "Precios guardados. Los demás campos se conservaron.", changes);
        });
        if (!rowReceipt.ok) return rowReceipt;
    }
    return selectedPriceReport(context.organizationId, lote);
}
