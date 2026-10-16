import { createHash, randomUUID } from "node:crypto";
import { INVENTORY_BACKUP_FIELDS } from "../inventory-backup-fields";
import { Prisma } from "@prisma/client";
import { strFromU8, strToU8, zipSync, unzipSync } from "fflate";
import { dbWithDeleted } from "./db";
import { assertSafeEntryName } from "./import-photos";
import { detectInventoryImageMime } from "@/lib/admin-types";
import { SANDBOX_FILE_QUOTA_BYTES } from "./demo-sandbox";

/** Explicit model boundary: never serialize Organization, credentials or operational records. */
export const BACKUP_MODELS = ["Supplier", "Warehouse", "InventoryCategory", "InventoryFamily", "InventoryItem", "InventoryUnit", "InventoryPriceTier", "InventoryComponent", "InventoryImage", "Collection", "CollectionItem"] as const;
export const BACKUP_LIMITS = { archive: 20 * 1024 * 1024, inflated: 20 * 1024 * 1024, assets: SANDBOX_FILE_QUOTA_BYTES, rows: 10000, entries: 2000 };
export const BACKUP_EXCLUSIONS = ["Empresa, usuarios, claves, tokens y configuración de pagos", "Clientes, eventos, presupuestos y reservas", "Caja, pagos, facturas, firmas, incidentes e historial", "Bytes de imágenes externas: se conservan sólo sus referencias"];
const models = Prisma.dmmf.datamodel.models;
const model = (name: string) => models.find(m => m.name === name)!;
const fields = (name: string) => model(name).fields.filter(f => (INVENTORY_BACKUP_FIELDS[name as keyof typeof INVENTORY_BACKUP_FIELDS] as readonly string[]).includes(f.name));
const delegate = (tx: unknown, name: string): any => (tx as Record<string, unknown>)[name[0].toLowerCase() + name.slice(1)];
export const backupHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export class BackupError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
type Row = Record<string, any>;
export type BackupData = Record<string, Row[]>;
export type BackupPackage = { data: BackupData; assets: Record<string, Uint8Array>; digest: string; summary: Record<string, number>; assetBytes: number; externalReferences: number };

/** JSON preserves exact scalar values; binaries are content-addressed, never recompressed. */
export async function exportInventoryBackup(organizationId: string): Promise<Uint8Array> {
  const assets: Record<string, Uint8Array> = {};
  const data = await dbWithDeleted.$transaction(async tx => {
    const out: BackupData = {}; let total = 0;
    for (const name of BACKUP_MODELS) {
      const rows = await delegate(tx, name).findMany({ where: { organizationId }, take: BACKUP_LIMITS.rows + 1, select: Object.fromEntries(fields(name).map(f => [f.name, true])) });
      total += rows.length; if (total > BACKUP_LIMITS.rows) throw new BackupError("El respaldo supera 10.000 registros; no se exportó un archivo parcial.", 422);
      out[name] = rows.map((row: Row) => Object.fromEntries(fields(name).map(f => {
        const value = row[f.name];
        if (value != null && f.type === "Bytes") { const bytes = new Uint8Array(value); const path = `assets/${backupHash(bytes)}`; assets[path] = bytes; return [f.name, { asset: path }]; }
        return [f.name, value instanceof Date ? value.toISOString() : value];
      })));
    }
    return out;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  const entries: Record<string, Uint8Array> = { "data.json": strToU8(JSON.stringify(data)), ...assets };
  const manifest = { format: "ledbox-inventory-backup", version: 1, exportedAt: new Date().toISOString(), exclusions: BACKUP_EXCLUSIONS,
    files: Object.entries(entries).map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: backupHash(bytes) })) };
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
  const bytes = zipSync(entries, { level: 1 });
  // Apply the identical structural and graph checks to our own output before delivery.
  readInventoryBackup(bytes);
  return bytes;
}

function fail(message: string): never { throw new BackupError(message); }
function object(value: unknown): value is Row { return !!value && typeof value === "object" && !Array.isArray(value); }
export function readInventoryBackup(bytes: Uint8Array): BackupPackage {
  if (bytes.byteLength > BACKUP_LIMITS.archive) fail("El ZIP supera 20 MiB.");
  let count = 0, inflated = 0; const names = new Set<string>(); let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter(file) {
      assertSafeEntryName(file.name);
      if (file.name !== "manifest.json" && file.name !== "data.json" && !/^assets\/[a-f0-9]{64}$/.test(file.name)) fail("Ruta fuera del formato de respaldo.");
      if (names.has(file.name)) fail("El ZIP tiene rutas duplicadas."); names.add(file.name);
      if (++count > BACKUP_LIMITS.entries || (inflated += file.originalSize) > BACKUP_LIMITS.inflated) fail("El contenido del ZIP supera los límites del respaldo.");
      return true;
    } });
  } catch (error) { throw new BackupError(error instanceof Error ? error.message : "ZIP inválido."); }
  const parse = (path: string) => { try { return JSON.parse(strFromU8(entries[path] ?? new Uint8Array())); } catch { return fail(`No se pudo leer ${path}.`); } };
  const manifest = parse("manifest.json");
  if (!object(manifest) || manifest.format !== "ledbox-inventory-backup" || manifest.version !== 1 || !Array.isArray(manifest.files)) fail("Formato o versión de respaldo no compatible.");
  const declared = new Set<string>();
  for (const file of manifest.files) {
    if (!object(file) || typeof file.path !== "string" || declared.has(file.path) || !entries[file.path] || file.bytes !== entries[file.path].byteLength || file.sha256 !== backupHash(entries[file.path])) fail("El manifiesto no coincide con los archivos del respaldo.");
    declared.add(file.path);
  }
  if (!declared.has("data.json") || Object.keys(entries).some(path => (path !== "manifest.json" && !declared.has(path)) || (path !== "data.json" && path !== "manifest.json" && !/^assets\/[a-f0-9]{64}$/.test(path)))) fail("El ZIP contiene archivos sin declarar.");
  const data = parse("data.json"); if (!object(data) || Object.keys(data).sort().join() !== [...BACKUP_MODELS].sort().join()) fail("El respaldo trae entidades fuera de su alcance.");
  const assets = Object.fromEntries(Object.entries(entries).filter(([path]) => path.startsWith("assets/")));
  let assetBytes = 0;
  for (const [path, value] of Object.entries(assets)) { if (path !== `assets/${backupHash(value)}`) fail("Ruta de asset inválida."); assetBytes += value.byteLength; }
  if (assetBytes > BACKUP_LIMITS.assets) fail("Las imágenes superan la cuota demo de 15 MiB.");
  let rows = 0; const ids = new Map<string, Set<string>>();
  for (const name of BACKUP_MODELS) {
    if (!Array.isArray(data[name]) || (rows += data[name].length) > BACKUP_LIMITS.rows) fail("Demasiados registros o entidad inválida.");
    const allowed = fields(name), byName = new Map(allowed.map(f => [f.name, f])); const seen = new Set<string>(); ids.set(name, seen);
    for (const row of data[name]) {
      if (!object(row) || Object.keys(row).some(key => !byName.has(key))) fail(`Campos no permitidos en ${name}.`);
      for (const f of allowed) {
        const value = row[f.name];
        if (value == null) { if (f.isRequired) fail(`Falta ${name}.${f.name}.`); continue; }
        const checkScalar = (v: any) => {
          if (f.kind === "enum") { const values = Prisma.dmmf.datamodel.enums.find(e => e.name === f.type)?.values.map(v => v.name); if (!values?.includes(v)) fail(`Estado inválido en ${name}.${f.name}.`); }
          else if (f.type === "String") { if (typeof v !== "string" || v.length > 10000) fail(`Texto inválido en ${name}.${f.name}.`); }
          else if (f.type === "Int") { if (!Number.isSafeInteger(v) || v < -2147483648 || v > 2147483647) fail(`Entero inválido en ${name}.${f.name}.`); }
          else if (f.type === "Boolean" && typeof v !== "boolean") fail("Booleano inválido.");
          else if (f.type === "DateTime" && (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v)) fail("Fecha inválida.");
          else if (f.type === "Bytes" && (!object(v) || Object.keys(v).join() !== "asset" || !assets[v.asset])) fail("Referencia de imagen inválida.");
        };
        if (f.isList) { if (!Array.isArray(value)) fail("Lista inválida."); value.forEach(checkScalar); } else checkScalar(value);
      }
      if (row.id !== undefined) { if (!row.id || seen.has(row.id)) fail(`Identificador duplicado en ${name}.`); seen.add(row.id); }
    }
  }
  for (const name of BACKUP_MODELS) for (const row of data[name]) for (const rel of model(name).fields.filter(f => f.kind === "object" && f.relationFromFields?.length)) {
    for (const fk of rel.relationFromFields!) if (fk !== "organizationId" && row[fk] != null && (!ids.has(rel.type) || !ids.get(rel.type)!.has(row[fk]))) fail(`Referencia ${name}.${fk} fuera del respaldo.`);
  }
  assetBytes = 0; // Quota counts stored copies, not just deduplicated ZIP assets.
  for (const name of BACKUP_MODELS) {
    // Collisions must be visible before any destination exists, not discovered by writes.
    const m = model(name);
    for (const keys of [...m.uniqueFields, ...(name === "CollectionItem" ? [["collectionId", "itemId"]] : [])]) {
      const seen = new Set<string>();
      for (const row of data[name]) {
        const values = keys.filter(key => key !== "organizationId").map(key => row[key]);
        if (values.some(value => value == null)) continue;
        const key = JSON.stringify(values); if (seen.has(key)) fail(`Colisión de claves en ${name}.`); seen.add(key);
      }
    }
    for (const row of data[name]) {
      for (const field of fields(name).filter(f => f.type === "Bytes")) if (row[field.name]) {
        assetBytes += assets[row[field.name].asset].byteLength;
        if (assetBytes > BACKUP_LIMITS.assets) fail("Las copias de imágenes almacenadas superan la cuota demo de 15 MiB.");
        const detected = detectInventoryImageMime(assets[row[field.name].asset]);
        const mime = row[field.name === "imageData" ? "imageMime" : "mime"];
        if (!detected || (mime && mime !== detected)) fail(`Imagen o MIME inválido en ${name}.`);
      }
      for (const [key, value] of Object.entries(row)) if (typeof value === "number" && /quantity|price|cost|capacity|incidentHold|incidentCycle/i.test(key) && value < 0) fail(`Valor negativo inválido en ${name}.${key}.`);
    }
  }
  for (const category of data.InventoryCategory) if (category.parentId && data.InventoryCategory.find((row: Row) => row.id === category.parentId)?.parentId) fail("Categorías cíclicas o de más de dos niveles.");
  // Non-FK family cover is deliberately checked too.
  for (const family of data.InventoryFamily) if (family.coverItemId && (!ids.get("InventoryItem")!.has(family.coverItemId) || data.InventoryItem.find((row: Row) => row.id === family.coverItemId)?.familyId !== family.id)) fail("Portada de familia fuera del respaldo.");
  for (const unit of data.InventoryUnit) {
    if (unit.stockOrigin === "EXTERNAL_RENTAL" || (unit.stockOrigin === "CONSIGNED") !== Boolean(unit.ownerSupplierId)) fail("Propiedad de unidad incoherente.");
  }
  for (const item of data.InventoryItem) {
    if (["CONSIGNED", "EXTERNAL_RENTAL"].includes(item.defaultStockOrigin) !== Boolean(item.defaultSourceSupplierId)) fail("Origen predeterminado incoherente.");
    const units = data.InventoryUnit.filter((u: Row) => u.inventoryId === item.id);
    const parts = data.InventoryComponent.filter((p: Row) => p.parentId === item.id);
    if (item.quantity < 0 || (units.length && item.quantity !== units.filter((u: Row) => u.status !== "RETIRED").length)) fail("Cantidad y unidades registradas no coinciden.");
    if ((parts.length || item.comboIncomplete) && (units.length || item.quantity !== 0)) fail("Un combo no puede tener stock propio.");
    if (parts.some((p: Row) => p.quantity <= 0 || p.componentId === item.id || data.InventoryComponent.some((c: Row) => c.parentId === p.componentId) || data.InventoryItem.find((i: Row) => i.id === p.componentId)?.comboIncomplete)) fail("Composición de combo inválida o anidada.");
  }
  return { data, assets, digest: backupHash(bytes), summary: Object.fromEntries(BACKUP_MODELS.map(name => [name, data[name].length])), assetBytes,
    externalReferences: data.InventoryItem.filter((row: Row) => row.imageUrl && !row.imageUrl.startsWith("/api/inventory-images/")).length };
}

/** Exact bounded restore in ONE transaction supplied by the caller. No commercial writer side effects. */
export async function restoreInventoryBackup(tx: Prisma.TransactionClient, organizationId: string, pack: BackupPackage) {
  const target = await tx.organization.findFirst({ where: { id: organizationId, isDemo: true, demoReady: false, demoParentId: { not: null }, demoExpiresAt: { gt: new Date() } } });
  if (!target) throw new BackupError("El destino debe ser una demo nueva y vacía.", 409);
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
  for (const name of BACKUP_MODELS) if (await delegate(tx, name).count({ where: { organizationId } })) throw new BackupError("La demo de destino ya tiene datos; no se mezclaron registros.", 409);
  const idMap = new Map<string, Map<string, string>>(BACKUP_MODELS.map(name => [name, new Map(pack.data[name].filter(row => row.id).map(row => [row.id, randomUUID()]))]));
  for (const name of BACKUP_MODELS) {
    const deferred: Array<{ id: string; parentId: string }> = [];
    for (const row of pack.data[name]) {
      const copy: Row = {};
      for (const f of fields(name)) {
        const value = row[f.name];
        copy[f.name] = value == null ? (f.type === "Json" ? Prisma.DbNull : null) : f.type === "Bytes" ? pack.assets[value.asset] : f.type === "DateTime" ? new Date(value) : value;
      }
      if (row.id) copy.id = idMap.get(name)!.get(row.id);
      for (const rel of model(name).fields.filter(f => f.kind === "object" && f.relationFromFields?.length)) for (const fk of rel.relationFromFields!) {
        if (fk === "organizationId") continue;
        if (row[fk] != null) copy[fk] = idMap.get(rel.type)!.get(row[fk]);
      }
      if (name === "InventoryCategory" && copy.parentId) { deferred.push({ id: copy.id, parentId: copy.parentId }); copy.parentId = null; }
      if (name === "InventoryFamily") copy.coverItemId = row.coverItemId ? idMap.get("InventoryItem")!.get(row.coverItemId) : null;
      // Original application URLs contain source IDs; regenerate only canonical image routes.
      if (name === "InventoryItem" && typeof row.imageUrl === "string" && row.imageUrl.startsWith("/api/inventory-images/")) copy.imageUrl = `/api/inventory-images/${copy.id}`;
      if (name === "InventoryCategory" && copy.imageData) copy.imageUrl = `/api/category-images/${copy.id}?v=${Date.now()}`;
      if (name === "InventoryImage") copy.size = copy.data.byteLength;
      await delegate(tx, name).create({ data: { ...copy, organizationId } });
    }
    for (const row of deferred) await delegate(tx, name).update({ where: { id: row.id }, data: { parentId: row.parentId } });
  }
  await tx.organization.update({ where: { id: organizationId }, data: { demoReady: true, paymentDetails: Prisma.DbNull, fiscalDetails: Prisma.DbNull } });
  return pack.summary;
}
