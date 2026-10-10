import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AttachmentInput, BancoField, CityField, Combobox, EmailField, MoneyField, PercentField, PhoneField, SearchField } from "../../components/admin/AdminFields";
import { AdminButton, AdminDialog, AdminKpi, AdminNote } from "../../components/admin/AdminUI";

function Kit() {
  const [phone, setPhone] = useState("+54 91123456789");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("2147483647");
  const [percent, setPercent] = useState("12,5");
  const [city, setCity] = useState("Asunción");
  const [department, setDepartment] = useState("Asunción");
  const [bank, setBank] = useState("Ueno Bank");
  const [entity, setEntity] = useState("");
  const [search, setSearch] = useState("");
  const [created, setCreated] = useState("");
  const [attachment, setAttachment] = useState("");
  const [open, setOpen] = useState(false);
  const fields = <form className="admin-form-grid" onSubmit={(event) => event.preventDefault()}>
    <PhoneField id="phone" label="Teléfono" value={phone} onChange={setPhone} required />
    <EmailField id="email" label="Correo" value={email} onChange={setEmail} required />
    <MoneyField id="amount" label="Monto PYG" value={amount} onChange={setAmount} required />
    <PercentField id="percent" label="Porcentaje" value={percent} onChange={setPercent} />
    <CityField id="city" label="Ciudad" value={city} onChange={setCity} onSelect={(_city, nextDepartment) => setDepartment(nextDepartment)} />
    <BancoField id="bank" label="Banco" value={bank} onChange={setBank} required />
    <Combobox id="entity" name="entity" label="Cliente" value={entity} onChange={setEntity} required options={[
      { value: "a", label: "Cliente A", description: "Producción", keywords: "sonido" },
      { value: "b", label: "Cliente B", description: "Administración", keywords: "luces" },
    ]} onCreate={setCreated} />
    <SearchField label="Buscar" value={search} onChange={setSearch} />
    <AttachmentInput id="attachment" onSelect={(file) => setAttachment(file?.name ?? "")} />
    <AdminButton type="submit" variant="primary">Guardar</AdminButton>
    <AdminButton type="button" busy>Guardando</AdminButton>
    <AdminNote tone="ok">Estado confirmado por respuesta</AdminNote>
  </form>;
  return <main className="admin-module-page">
    <h1>Kit de formularios · Refs #173</h1>
    <div className="admin-kpis" id="high-total-kpis">
      <AdminKpi label="Vigentes" value="3" note="Presupuestos vigentes" />
      <AdminKpi label="Aprobados" value="1" />
      <AdminKpi label="Pendientes" value="2" />
      <AdminKpi label="Monto en juego" icon="finance" value="Gs 2.148.384.798" note="Σ de los vigentes" />
    </div>
    <AdminButton type="button" onClick={() => setOpen(true)} id="open-dialog">Probar en diálogo</AdminButton>
    {open ? <AdminDialog title="Kit en diálogo" onClose={() => setOpen(false)}>{fields}</AdminDialog> : fields}
    <output id="state" hidden>{JSON.stringify({ phone, email, amount, percent, city, department, bank, entity, created, attachment })}</output>
  </main>;
}

createRoot(document.getElementById("kit")!).render(<Kit />);
