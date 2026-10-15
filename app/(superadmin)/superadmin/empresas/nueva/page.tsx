import { requirePlatformAdmin } from "@/lib/platform/guard";
import { loadPlanOptions } from "@/lib/platform/queries/empresas";
import { crearEmpresaAction } from "../acciones";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { NuevaEmpresaForm } from "@/components/platform/NuevaEmpresaForm";

export const dynamic = "force-dynamic";

export default async function NuevaEmpresaPage() {
  await requirePlatformAdmin();
  const plans = await loadPlanOptions();
  return (
    <PlatformShell active="empresas" title="Nueva empresa">
      <div className="platform-page">
        <section className="platform-panel platform-form-panel" aria-label="Alta de empresa">
          <p className="platform-hint">
            Crea la empresa con el plan elegido y invita por correo a las personas indicadas, cada una con su rol (dueño o administrador). Quien recibe el
            correo crea su acceso (o suma esta empresa a su cuenta si ya tiene una). El link solo viaja por correo.
          </p>
          <NuevaEmpresaForm plans={plans} createAction={crearEmpresaAction} />
        </section>
      </div>
    </PlatformShell>
  );
}
