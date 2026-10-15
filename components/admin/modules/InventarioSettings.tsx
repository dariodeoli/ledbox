"use client";

import { useId, useMemo, useState } from "react";
import { adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import type { AdminInventoryCategoryRow, AdminWarehouseRow } from "@/lib/admin-types";
import { CATEGORY_ICONS, CATEGORY_TONES, buildCategoryTree, type CategoryNode } from "@/lib/inventory-categories";
import { FIELD_MESSAGES, INVENTORY_TAXONOMY_NAME_MAX, normalizeWarehouseCode, warehouseCodeValid } from "@/lib/field-rules";
import { formatNumber } from "@/lib/admin-format";
import { useAdminSession } from "../AdminShell";
import { AdminBadge, AdminButton, AdminCell, AdminConfirmDialog, AdminDataState, AdminDialog, AdminNote, AdminPanel, AdminRow, AdminTable } from "../AdminUI";
import { FileField, NumberField, SelectField, TextField } from "../AdminFields";

/**
 * Ajustes → Inventario (rediseño E1, `org.manage`: solo OWNER y ADMIN): categorías con su
 * subcategoría (renombrar, mover, color, ícono, unir, archivar) y depósitos (código, nombre,
 * principal, archivar). Todo lo valida el servidor contra la empresa activa.
 */

const TONE_LABEL: Record<string, string> = { neutral: "Gris", info: "Azul", ok: "Verde", warn: "Naranja", danger: "Rojo", accent: "Violeta" };
const ICON_LABEL: Record<string, string> = {
  inventory: "Inventario", events: "Eventos", calendar: "Calendario", clients: "Clientes", suppliers: "Proveedores",
  promoters: "Promotoras", building: "Edificio", image: "Imagen", globe: "Globo", settings: "Ajustes",
};

export function InventarioSettings() {
  const { demo } = useAdminSession();
  const categories = useAdminResource("/api/admin/inventory/categories", (payload) => ((payload as { categories?: AdminInventoryCategoryRow[] }).categories ?? []));
  const warehouses = useAdminResource("/api/admin/inventory/warehouses", (payload) => ((payload as { warehouses?: AdminWarehouseRow[] }).warehouses ?? []));
  const rows = useMemo(() => categories.data ?? [], [categories.data]);
  const tree = useMemo(() => buildCategoryTree(rows), [rows]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editCategory, setEditCategory] = useState<CategoryNode | null>(null);
  const [editWarehouse, setEditWarehouse] = useState<AdminWarehouseRow | null>(null);

  return (
    <div className="admin-stack">
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      <AdminPanel title="Categorías" icon="inventory" meta="Categoría › Subcategoría">
        <AdminDataState loading={categories.loading} error={categories.error} onRetry={categories.reload} rows={4}>
          <NewCategoryForm
            disabled={demo}
            onDone={(message) => {
              setNotice(message);
              setError("");
              categories.reload();
            }}
            onError={setError}
          />
          {tree.length === 0 ? (
            <AdminNote>Todavía no hay categorías. Se crean al cargar productos o desde este formulario.</AdminNote>
          ) : (
            <AdminTable
              view="ajustes-categorias"
              label="Categorías y subcategorías de inventario"
              columns={[{ label: "Nombre" }, { label: "Productos", end: true }, { label: "Acciones", end: true }]}
            >
              {tree.flatMap((root) => [root, ...root.children]).map((node) => (
                <AdminRow key={node.id}>
                  <AdminCell title={node.parentId ? `${tree.find((entry) => entry.id === node.parentId)?.name} › ${node.name}` : node.name}>
                    <span className={node.parentId ? "admin-cat-child" : "admin-cat-root"}>{node.parentId ? "↳ " : ""}{node.name}</span>
                    {node.archivedAt ? <AdminBadge tone="neutral">Archivada</AdminBadge> : node.color && (CATEGORY_TONES as readonly string[]).includes(node.color) ? <AdminBadge tone={node.color as (typeof CATEGORY_TONES)[number]}>{TONE_LABEL[node.color]}</AdminBadge> : null}
                  </AdminCell>
                  <AdminCell end>{formatNumber(node.itemCount)}</AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      <AdminButton icon="edit" title={`Editar ${node.name}`} aria-label={`Editar la categoría ${node.name}`} disabled={demo} onClick={() => setEditCategory(node)} />
                    </span>
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          )}
        </AdminDataState>
      </AdminPanel>

      <AdminPanel title="Depósitos" icon="building" meta="Código y ubicación en cada unidad">
        <AdminDataState loading={warehouses.loading} error={warehouses.error} onRetry={warehouses.reload} rows={3}>
          <NewWarehouseForm
            disabled={demo}
            onDone={(message) => {
              setNotice(message);
              setError("");
              warehouses.reload();
            }}
            onError={setError}
          />
          <AdminTable
            view="ajustes-depositos"
            label="Depósitos de inventario"
            columns={[{ label: "Código" }, { label: "Nombre" }, { label: "Uds.", end: true }, { label: "Acciones", end: true }]}
          >
            {(warehouses.data ?? []).map((warehouse) => (
              <AdminRow key={warehouse.id}>
                <AdminCell><span className="admin-code">{warehouse.code}</span></AdminCell>
                <AdminCell title={warehouse.address ?? warehouse.name}>
                  {warehouse.name}
                  {warehouse.archivedAt ? <AdminBadge tone="neutral">Archivado</AdminBadge> : warehouse.isDefault ? <AdminBadge tone="accent">Principal</AdminBadge> : null}
                </AdminCell>
                <AdminCell end>{formatNumber(warehouse.unitCount)}</AdminCell>
                <AdminCell end className="admin-cell--actions">
                  <span className="admin-actions">
                    <AdminButton icon="edit" title={`Editar ${warehouse.name}`} aria-label={`Editar el depósito ${warehouse.name}`} disabled={demo} onClick={() => setEditWarehouse(warehouse)} />
                  </span>
                </AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        </AdminDataState>
      </AdminPanel>

      {editCategory ? (
        <CategoryDialog
          node={editCategory}
          roots={tree}
          onClose={() => setEditCategory(null)}
          onDone={(message) => {
            setEditCategory(null);
            setNotice(message);
            setError("");
            categories.reload();
          }}
        />
      ) : null}
      {editWarehouse ? (
        <WarehouseDialog
          warehouse={editWarehouse}
          onClose={() => setEditWarehouse(null)}
          onDone={(message) => {
            setEditWarehouse(null);
            setNotice(message);
            setError("");
            warehouses.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function NewCategoryForm({ disabled, onDone, onError }: { disabled: boolean; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!category.trim()) return onError("Ingresá el nombre de la categoría.");
    setBusy(true);
    const result = await adminSend<{ category: { text: string } }>("/api/admin/inventory/categories", { kind: "create", category, subcategory });
    setBusy(false);
    if (!result.ok) return onError(result.error);
    setCategory("");
    setSubcategory("");
    onDone(`Categoría «${result.data.category.text}» lista: si ya existía se usó la misma, sin duplicar.`);
  }
  return (
    <form className="admin-form admin-form-grid" onSubmit={(event) => void submit(event)} aria-label="Agregar categoría">
      <TextField label="Categoría" value={category} onChange={setCategory} maxLength={INVENTORY_TAXONOMY_NAME_MAX} placeholder="Ej.: Vajilla" disabled={disabled || busy} />
      <TextField label="Subcategoría" value={subcategory} onChange={setSubcategory} maxLength={INVENTORY_TAXONOMY_NAME_MAX} placeholder="Ej.: Copas" hint="Opcional." disabled={disabled || busy} />
      <div className="admin-form-actions">
        <AdminButton variant="primary" icon="plus" type="submit" busy={busy} busyLabel="Agregando…" disabled={disabled}>
          Agregar categoría
        </AdminButton>
      </div>
    </form>
  );
}

function NewWarehouseForm({ disabled, onDone, onError }: { disabled: boolean; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return onError("Ingresá el nombre del depósito.");
    if (!warehouseCodeValid(code)) return onError(FIELD_MESSAGES.warehouseCode);
    setBusy(true);
    const result = await adminSend<{ warehouse: { name: string; code: string } }>("/api/admin/inventory/warehouses", { kind: "create", code, name, address });
    setBusy(false);
    if (!result.ok) return onError(result.error);
    setCode("");
    setName("");
    setAddress("");
    onDone(`Depósito «${result.data.warehouse.name}» (${result.data.warehouse.code}) creado.`);
  }
  return (
    <form className="admin-form admin-form-grid" onSubmit={(event) => void submit(event)} aria-label="Agregar depósito">
      <TextField label="Código" value={code} onChange={(value) => setCode(normalizeWarehouseCode(value))} maxLength={6} placeholder="Ej.: D2" hint="Una letra y hasta 5 letras o números." disabled={disabled || busy} />
      <TextField label="Nombre" value={name} onChange={setName} maxLength={INVENTORY_TAXONOMY_NAME_MAX} placeholder="Ej.: Depósito Planta Alta" disabled={disabled || busy} />
      <TextField label="Dirección" value={address} onChange={setAddress} maxLength={400} hint="Opcional." wide disabled={disabled || busy} />
      <div className="admin-form-actions">
        <AdminButton variant="primary" icon="plus" type="submit" busy={busy} busyLabel="Agregando…" disabled={disabled}>
          Agregar depósito
        </AdminButton>
      </div>
    </form>
  );
}

type Op = { label: string; send: () => Promise<{ ok: boolean; error?: string }>; done: string };

function CategoryDialog({ node, roots, onClose, onDone }: { node: CategoryNode; roots: CategoryNode[]; onClose: () => void; onDone: (message: string) => void }) {
  const formId = useId();
  const [name, setName] = useState(node.name);
  const [color, setColor] = useState(node.color ?? "");
  const [icon, setIcon] = useState(node.icon ?? "");
  const [sortOrder, setSortOrder] = useState(String(node.sortOrder));
  const [parentId, setParentId] = useState(node.parentId ?? "");
  const [mergeInto, setMergeInto] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isRoot = !node.parentId;
  const all = roots.flatMap((root) => [root, ...root.children]).filter((entry) => entry.id !== node.id && !entry.archivedAt);
  const parentChoices = roots.filter((root) => root.id !== node.id && !root.archivedAt);
  const canMove = node.children.length === 0;

  async function run(op: Op) {
    setBusy(true);
    setError("");
    const result = await op.send();
    setBusy(false);
    if (!result.ok) {
      setConfirmMerge(false);
      return setError(result.error ?? "No se pudo guardar.");
    }
    onDone(op.done);
  }
  const post = (body: Record<string, unknown>) => adminSend("/api/admin/inventory/categories", { id: node.id, ...body });

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const order = Number(sortOrder);
    if (!Number.isInteger(order) || order < 0) return setError("El orden es un número entero de 0 en adelante.");
    setBusy(true);
    setError("");
    // Renombrar, mover y estilo son operaciones separadas del servidor; se aplican en orden y se corta al primer error.
    const steps: Array<() => ReturnType<typeof post>> = [];
    if (name.trim() !== node.name) steps.push(() => post({ kind: "rename", name }));
    if (parentId !== (node.parentId ?? "")) steps.push(() => post({ kind: "move", parentId: parentId || null }));
    if (color !== (node.color ?? "") || icon !== (node.icon ?? "") || order !== node.sortOrder) steps.push(() => post({ kind: "style", color: color || null, icon: icon || null, sortOrder: order }));
    for (const step of steps) {
      const result = await step();
      if (!result.ok) {
        setBusy(false);
        return setError(result.error);
      }
    }
    setBusy(false);
    onDone(steps.length ? `Categoría «${name.trim()}» guardada. Los productos ya muestran el nombre nuevo.` : "No había cambios para guardar.");
  }

  return (
    <>
      <AdminDialog
        title={`${isRoot ? "Categoría" : "Subcategoría"} · ${node.name}`}
        icon="inventory"
        size="md"
        description={`${formatNumber(node.itemCount)} producto${node.itemCount === 1 ? "" : "s"}. Renombrar o mover reescribe el texto de sus productos.`}
        error={error}
        onClose={() => !busy && onClose()}
        footer={({ requestClose }) => (
          <>
            <AdminButton type="button" icon="close" onClick={requestClose} disabled={busy}>Cerrar</AdminButton>
            <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Guardando…">Guardar</AdminButton>
          </>
        )}
      >
        <form id={formId} className="admin-form admin-form-grid" onSubmit={(event) => void save(event)}>
          <TextField label="Nombre" required value={name} onChange={setName} maxLength={INVENTORY_TAXONOMY_NAME_MAX} disabled={busy} hint="Sin «/», «>» ni «›»." />
          <SelectField
            label="Mover a…"
            value={parentId}
            onChange={setParentId}
            disabled={busy || !canMove}
            options={[{ value: "", label: "Categoría principal (sin padre)" }, ...parentChoices.map((root) => ({ value: root.id, label: `Dentro de ${root.name}` }))]}
            hint={canMove ? "Hay un solo nivel de subcategoría." : "Tiene subcategorías: movelas o unilas antes."}
          />
          <SelectField label="Color" value={color} onChange={setColor} disabled={busy} options={[{ value: "", label: "Sin color" }, ...CATEGORY_TONES.map((tone) => ({ value: tone, label: TONE_LABEL[tone] }))]} />
          <SelectField label="Ícono" value={icon} onChange={setIcon} disabled={busy} options={[{ value: "", label: "Sin ícono" }, ...CATEGORY_ICONS.map((entry) => ({ value: entry, label: ICON_LABEL[entry] ?? entry }))]} />
          <NumberField label="Orden" value={sortOrder} onChange={setSortOrder} maxLength={4} hint="Las más chicas van primero." disabled={busy} />
        </form>
        <CategoryPhoto node={node} disabled={busy} onChanged={() => onDone(`Foto de «${node.name}» actualizada.`)} onError={setError} />
        <div className="admin-form admin-form-grid">
          <SelectField
            label="Unir con otra categoría"
            value={mergeInto}
            onChange={setMergeInto}
            disabled={busy || node.children.length > 0}
            options={[{ value: "", label: "Elegir categoría de destino" }, ...all.map((entry) => ({ value: entry.id, label: entry.parentId ? `${roots.find((root) => root.id === entry.parentId)?.name} › ${entry.name}` : entry.name }))]}
            hint={node.children.length > 0 ? "Tiene subcategorías: movelas o unilas primero." : "Los productos pasan al destino y esta categoría se elimina."}
          />
          <div className="admin-form-actions">
            <AdminButton type="button" icon="refresh" disabled={busy || !mergeInto} onClick={() => setConfirmMerge(true)}>Unir…</AdminButton>
            {node.archivedAt ? (
              <AdminButton type="button" icon="refresh" disabled={busy} onClick={() => void run({ label: "Restaurar", send: () => post({ kind: "restore" }), done: `Categoría «${node.name}» restaurada.` })}>Restaurar</AdminButton>
            ) : (
              <AdminButton type="button" icon="inventory" disabled={busy} onClick={() => void run({ label: "Archivar", send: () => post({ kind: "archive" }), done: `Categoría «${node.name}» archivada: deja de ofrecerse, sus productos no cambian.` })}>Archivar</AdminButton>
            )}
          </div>
        </div>
      </AdminDialog>
      {confirmMerge ? (
        <AdminConfirmDialog
          title="Unir categorías"
          message={`Los ${formatNumber(node.itemCount)} productos de «${node.name}» pasan a «${all.find((entry) => entry.id === mergeInto)?.name ?? ""}» y «${node.name}» se elimina. No se puede deshacer.`}
          confirmLabel="Unir categorías"
          busy={busy}
          danger
          onClose={() => setConfirmMerge(false)}
          onConfirm={() => void run({ label: "Unir", send: () => adminSend("/api/admin/inventory/categories", { kind: "merge", fromId: node.id, intoId: mergeInto }), done: `Categorías unidas: «${node.name}» ya no existe y sus productos están en el destino.` })}
        />
      ) : null}
    </>
  );
}

function WarehouseDialog({ warehouse, onClose, onDone }: { warehouse: AdminWarehouseRow; onClose: () => void; onDone: (message: string) => void }) {
  const formId = useId();
  const [code, setCode] = useState(warehouse.code);
  const [name, setName] = useState(warehouse.name);
  const [address, setAddress] = useState(warehouse.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const post = (body: Record<string, unknown>) => adminSend("/api/admin/inventory/warehouses", { id: warehouse.id, ...body });

  async function run(send: () => ReturnType<typeof post>, done: string) {
    setBusy(true);
    setError("");
    const result = await send();
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone(done);
  }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!warehouseCodeValid(code)) return setError(FIELD_MESSAGES.warehouseCode);
    void run(() => post({ kind: "update", code, name, address }), `Depósito «${name.trim()}» guardado. Las ubicaciones de sus unidades se ven con el código nuevo.`);
  }
  return (
    <AdminDialog
      title={`Depósito · ${warehouse.name}`}
      icon="building"
      size="md"
      description={`${formatNumber(warehouse.unitCount)} unidad${warehouse.unitCount === 1 ? "" : "es"}. Un depósito con unidades se archiva, no se borra.`}
      error={error}
      onClose={() => !busy && onClose()}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" icon="close" onClick={requestClose} disabled={busy}>Cerrar</AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Guardando…">Guardar</AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form admin-form-grid" onSubmit={save}>
        <TextField label="Código" required value={code} onChange={(value) => setCode(normalizeWarehouseCode(value))} maxLength={6} disabled={busy} hint="Cambiarlo no rompe las ubicaciones: se guardan aparte." />
        <TextField label="Nombre" required value={name} onChange={setName} maxLength={INVENTORY_TAXONOMY_NAME_MAX} disabled={busy} />
        <TextField label="Dirección" value={address} onChange={setAddress} maxLength={400} wide disabled={busy} />
      </form>
      <div className="admin-form-actions">
        {warehouse.isDefault ? null : (
          <AdminButton type="button" icon="check" disabled={busy || Boolean(warehouse.archivedAt)} onClick={() => void run(() => post({ kind: "default" }), `«${warehouse.name}» es ahora el depósito principal.`)}>Marcar como principal</AdminButton>
        )}
        {warehouse.archivedAt ? (
          <AdminButton type="button" icon="refresh" disabled={busy} onClick={() => void run(() => post({ kind: "restore" }), `Depósito «${warehouse.name}» restaurado.`)}>Restaurar</AdminButton>
        ) : (
          <AdminButton type="button" icon="inventory" disabled={busy || warehouse.isDefault} title={warehouse.isDefault ? "Es el principal: marcá otro antes de archivarlo." : undefined} onClick={() => void run(() => post({ kind: "archive" }), `Depósito «${warehouse.name}» archivado.`)}>Archivar</AdminButton>
        )}
        {warehouse.unitCount === 0 && !warehouse.isDefault ? (
          <AdminButton type="button" icon="trash" disabled={busy} onClick={() => void run(() => post({ kind: "delete" }), `Depósito «${warehouse.name}» eliminado.`)}>Eliminar</AdminButton>
        ) : null}
      </div>
    </AdminDialog>
  );
}

/** Foto propia de la categoría: subir, cambiar o quitar (JPG/PNG/WebP cuadrada, hasta 1 MB). */
function CategoryPhoto({ node, disabled, onChanged, onError }: { node: CategoryNode; disabled: boolean; onChanged: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    onError("");
    const form = new FormData();
    form.set("id", node.id);
    form.set("file", file);
    const result = await adminApiUpload("/api/admin/inventory/categories/image", form);
    setBusy(false);
    if (!result.ok) return onError(result.error);
    onChanged();
  }
  async function clear() {
    setBusy(true);
    onError("");
    const result = await adminSend("/api/admin/inventory/categories", { kind: "image-clear", id: node.id });
    setBusy(false);
    if (!result.ok) return onError(result.error);
    onChanged();
  }
  return (
    <div className="admin-form admin-form-grid" role="group" aria-label={`Foto de ${node.name}`}>
      <div>
        <strong>Foto de la categoría</strong>
        <p className="admin-muted">JPG, PNG o WebP cuadrada, hasta 1 MB. La tienda la muestra en la categoría; sin foto usa la de su primer producto.</p>
        {node.imageUrl ? <img src={node.imageUrl} alt={`Foto de ${node.name}`} width={96} height={96} className="admin-cat-photo" /> : <span className="admin-muted">Sin foto propia.</span>}
      </div>
      <FileField label={node.imageUrl ? "Cambiar foto" : "Subir foto"} accept="image/jpeg,image/png,image/webp" maxBytes={1024 * 1024} disabled={disabled || busy} file={null} onSelect={(file) => void upload(file)} />
      {node.imageUrl ? <div className="admin-form-actions"><AdminButton type="button" icon="trash" disabled={disabled || busy} onClick={() => void clear()}>Quitar foto</AdminButton></div> : null}
    </div>
  );
}
