"use client";

import { useState } from "react";
import {
  Aviso,
  Button,
  FormField,
  Input,
  Modal,
  MoneyInput,
  Nota,
  SearchField,
  Select,
  Subtabs,
  Switch,
  montoTexto,
} from "owncoding-ui";
import {
  AdminButton,
  AdminDialog,
  AdminError,
  AdminNote,
  AdminPanel,
  AdminSuccess,
  AdminTable,
} from "@/components/admin/AdminUI";
import {
  MoneyField,
  SearchField as AdminSearchField,
  SegmentedField,
  SelectField,
  SwitchField,
  TextField,
} from "@/components/admin/AdminFields";
import { formatMoney } from "@/lib/admin-format";
import type { AdminTreasuryAccountRow } from "@/lib/admin-types";

/**
 * Diálogo, campos y avisos del piloto: la parte interactiva (los estados viven
 * acá para poder abrir los dos diálogos y comparar los dos kits con los mismos
 * valores). Solo existe en /piloto-ui.
 */

const TIPOS = [
  { value: "CASH", label: "Efectivo" },
  { value: "BANK", label: "Banco" },
  { value: "CHEQUE", label: "Cheques" },
];

export function PilotoControles({ cuentas, total }: { cuentas: AdminTreasuryAccountRow[]; total: number }) {
  const [dialogoPanel, setDialogoPanel] = useState(false);
  const [dialogoLibreria, setDialogoLibreria] = useState(false);

  const [nombre, setNombre] = useState("Ueno Bank");
  const [montoPanel, setMontoPanel] = useState("12000000");
  const [montoLibreria, setMontoLibreria] = useState<number | string>(12_000_000);
  const [tipo, setTipo] = useState("BANK");
  const [busquedaPanel, setBusquedaPanel] = useState("ueno");
  const [busquedaLibreria, setBusquedaLibreria] = useState("ueno");
  const [activaPanel, setActivaPanel] = useState(true);
  const [activaLibreria, setActivaLibreria] = useState(true);
  const [vista, setVista] = useState("cuentas");

  return (
    <>
      {/* ── Diálogo ─────────────────────────────────────────────────────── */}
      <AdminPanel title="Diálogo" icon="plus" meta="AdminDialog vs Modal">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual · AdminDialog</span>
            <div className="admin-toolbar">
              <AdminButton variant="primary" icon="plus" onClick={() => setDialogoPanel(true)}>
                Abrir AdminDialog
              </AdminButton>
            </div>
          </div>
          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería · Modal (size=&quot;formulario&quot;)</span>
            <div className="flex gap-2">
              <Button onClick={() => setDialogoLibreria(true)}>Abrir Modal</Button>
              <Button variant="outline" onClick={() => setDialogoLibreria(true)}>
                Variante outline
              </Button>
            </div>
          </div>
        </div>
        <AdminNote>
          Los dos diálogos tienen el mismo contenido y el mismo contrato (rol dialog, foco al abrir, Escape, clic afuera). El de
          la librería agrega **foco atrapado** y bloqueo del scroll del body, y elige el ancho por tipo (`corto`, `formulario`,
          `amplio`, `completo`); el nuestro tiene `default/wide/ficha` y todavía no atrapa el foco.
        </AdminNote>

        {dialogoPanel ? (
          <AdminDialog title="Nueva cuenta de tesorería" icon="wallet" onClose={() => setDialogoPanel(false)}>
            <div className="admin-form-grid">
              <TextField label="Nombre" value={nombre} onChange={setNombre} maxLength={120} />
              <MoneyField label="Saldo inicial" value={montoPanel} onChange={setMontoPanel} />
              <SelectField label="Tipo" value={tipo} onChange={setTipo} options={TIPOS} />
              <SwitchField label="Activa" checked={activaPanel} onChange={setActivaPanel} />
            </div>
            <div className="admin-dialog-foot">
              <span className="admin-dialog-spacer" />
              <AdminButton icon="close" onClick={() => setDialogoPanel(false)}>
                Cancelar
              </AdminButton>
              <AdminButton variant="primary" icon="check" onClick={() => setDialogoPanel(false)}>
                Crear cuenta
              </AdminButton>
            </div>
          </AdminDialog>
        ) : null}

        <Modal open={dialogoLibreria} onClose={() => setDialogoLibreria(false)} title="Nueva cuenta de tesorería" size="formulario">
          <div className="space-y-4">
            <FormField label="Nombre" htmlFor="piloto-oc-nombre">
              <Input id="piloto-oc-nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Saldo inicial" hint="Lo que ya había en la cuenta (opcional)" htmlFor="piloto-oc-monto">
              <MoneyInput id="piloto-oc-monto" value={montoLibreria} onValueChange={setMontoLibreria} />
            </FormField>
            <FormField label="Tipo" htmlFor="piloto-oc-tipo">
              <Select id="piloto-oc-tipo" value={tipo} onChange={(event) => setTipo(event.target.value)}>
                {TIPOS.map((opcion) => (
                  <option key={opcion.value} value={opcion.value}>
                    {opcion.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Activa">
              <Switch checked={activaLibreria} onChange={(event) => setActivaLibreria(event.target.checked)} ariaLabel="Cuenta activa" />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogoLibreria(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setDialogoLibreria(false)}>Crear cuenta</Button>
            </div>
          </div>
        </Modal>
      </AdminPanel>

      {/* ── Campos ──────────────────────────────────────────────────────── */}
      <AdminPanel title="Kit de campos" icon="edit" meta="AdminFields vs Input / MoneyInput / Select / Switch / FormField">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual · kit AdminFields</span>
            <div className="admin-form-grid">
              <TextField label="Nombre" value={nombre} onChange={setNombre} hint="Cómo se ve en tesorería" maxLength={120} />
              <MoneyField label="Saldo inicial" value={montoPanel} onChange={setMontoPanel} hint="En guaraníes, sin decimales" />
              <SelectField label="Tipo" value={tipo} onChange={setTipo} options={TIPOS} hint="Efectivo, banco o cheques" />
              <AdminSearchField value={busquedaPanel} onChange={setBusquedaPanel} label="Buscar cuentas" placeholder="Buscar por nombre o banco…" />
              <SwitchField label="Activa" checked={activaPanel} onChange={setActivaPanel} hint="Solo las activas se ofrecen para movimientos" />
              <SegmentedField label="Vista" value={vista} onChange={setVista} options={[{ value: "cuentas", label: "Cuentas" }, { value: "movimientos", label: "Movimientos" }]} />
            </div>
          </div>
          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería · Input / MoneyInput / Select / Switch / FormField</span>
            <div className="space-y-4">
              <FormField label="Nombre" hint="Cómo se ve en tesorería" htmlFor="piloto-campo-nombre">
                <Input id="piloto-campo-nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} maxLength={120} />
              </FormField>
              <FormField label="Saldo inicial" hint="En guaraníes, sin decimales" htmlFor="piloto-campo-monto">
                <MoneyInput id="piloto-campo-monto" value={montoLibreria} onValueChange={setMontoLibreria} />
              </FormField>
              <FormField label="Tipo" hint="Efectivo, banco o cheques" htmlFor="piloto-campo-tipo">
                <Select id="piloto-campo-tipo" value={tipo} onChange={(event) => setTipo(event.target.value)}>
                  {TIPOS.map((opcion) => (
                    <option key={opcion.value} value={opcion.value}>
                      {opcion.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <SearchField value={busquedaLibreria} onChange={(event) => setBusquedaLibreria(event.target.value)} placeholder="Buscar por nombre o banco…" ariaLabel="Buscar cuentas" />
              <FormField label="Activa" hint="Solo las activas se ofrecen para movimientos">
                <Switch checked={activaLibreria} onChange={(event) => setActivaLibreria(event.target.checked)} ariaLabel="Cuenta activa" />
              </FormField>
              <Subtabs value={vista} onChange={setVista} items={[["cuentas", "Cuentas"], ["movimientos", "Movimientos"]]} />
            </div>
          </div>
        </div>
        <AdminTable
          view="piloto-campos"
          label="Valores en vivo de los campos"
          columns={[{ label: "Valor" }, { label: "Panel actual" }, { label: "Librería" }, { label: "Observación" }]}
        >
          <PilotoFila valor="Nombre" panel={nombre} libreria={nombre} nota="idéntico" />
          <PilotoFila valor="Saldo inicial" panel={formatMoney(Number(montoPanel) || 0)} libreria={montoTexto(montoLibreria)} nota="el de la librería omite el punto de «Gs.»" />
          <PilotoFila valor="Tipo" panel={tipo} libreria={tipo} nota="mismo select nativo" />
          <PilotoFila valor="Búsqueda" panel={busquedaPanel} libreria={busquedaLibreria} nota="la limpieza también coincide" />
          <PilotoFila valor="Activa" panel={activaPanel ? "Sí" : "No"} libreria={activaLibreria ? "Sí" : "No"} nota="la librería no dibuja el texto Sí/No" />
          <PilotoFila valor="Vista" panel={vista} libreria={vista} nota="segmentado vs Subtabs" />
        </AdminTable>
        <AdminNote>
          Formatos/máscaras del campo de dinero: los dos escriben con separador de miles y entregan el número limpio. El de la
          librería valida el máximo contra `LIMITE_MONTO_GENERAL` y marca `aria-invalid`; el nuestro no tiene tope. Sumar
          `PhoneField`, `EmailField` y `SerialField` de la librería es directo: el panel ya tiene esos tipos en su kit.
        </AdminNote>
      </AdminPanel>

      {/* ── Avisos ──────────────────────────────────────────────────────── */}
      <AdminPanel title="Avisos" icon="alert" meta="AdminNote/AdminError/AdminSuccess vs Aviso/Nota">
        <div className="piloto-grid">
          <div className="piloto-col">
            <span className="piloto-tag">Panel actual</span>
            <div className="piloto-stack">
              <AdminNote>Nota neutra del panel: la aclaración que no es resultado.</AdminNote>
              <AdminError message="No pudimos guardar la cuenta: revisá el nombre." />
              <AdminSuccess>Cuenta creada con {formatMoney(total)} de saldo inicial.</AdminSuccess>
            </div>
          </div>
          <div className="piloto-col piloto-oc">
            <span className="piloto-tag piloto-tag--oc">Librería</span>
            <div className="space-y-2">
              <Aviso tono="error">No pudimos guardar la cuenta: revisá el nombre.</Aviso>
              <Aviso tono="ok">Cuenta creada con {montoTexto(total)} de saldo inicial.</Aviso>
              <Aviso tono="warn" compact>
                El saldo no es el del banco: lo confirma el extracto.
              </Aviso>
              <Nota tono="warn">Nota ámbar: la aclaración que no es resultado.</Nota>
              <Nota tono="info" compact>
                Nota info compacta.
              </Nota>
              <Nota tono="neutro">Nota neutra.</Nota>
            </div>
          </div>
        </div>
        <AdminNote>
          `Aviso` cubre los tres tonos con `role` correcto (error = alert) y `Nota` es la aclaración sin `role`. En el panel hoy
          hay `AdminNote` (note/alert) y `AdminError`/`AdminSuccess`; el mapa es 1 a 1 y el nombre «Aviso/Nota» es el que usa el
          grupo. La única diferencia visible: la librería pinta el texto del aviso con el color del tono (el panel lo deja en
          `--a-text`).
        </AdminNote>
      </AdminPanel>

      <AdminPanel title="Cuentas del piloto" icon="finance" meta="mismo dato en las dos columnas">
        <AdminTable
          view="piloto-cuentas"
          label="Cuentas de tesorería del piloto"
          columns={[{ label: "Cuenta" }, { label: "Panel" }, { label: "Librería" }, { label: "Estado" }]}
        >
          {cuentas.map((cuenta) => (
            <PilotoFila key={cuenta.id} valor={cuenta.name} panel={formatMoney(cuenta.balance)} libreria={montoTexto(cuenta.balance)} nota={cuenta.active ? "Activa" : "Inactiva"} />
          ))}
        </AdminTable>
      </AdminPanel>
    </>
  );
}

function PilotoFila({ valor, panel, libreria, nota }: { valor: string; panel: string; libreria: string; nota: string }) {
  return (
    <div className="admin-table-row" role="row">
      <span className="admin-cell" role="cell" title={valor}>
        <strong>{valor}</strong>
      </span>
      <span className="admin-cell" role="cell" title={panel}>
        {panel}
      </span>
      <span className="admin-cell" role="cell" title={libreria}>
        {libreria}
      </span>
      <span className="admin-cell" role="cell" title={nota}>
        <span className="admin-cell-sub">{nota}</span>
      </span>
    </div>
  );
}
