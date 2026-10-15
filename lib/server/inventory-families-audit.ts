import { recordAudit, type AuditContext } from "./audit";
import type { VariantRename } from "./inventory-families";

/** Una entrada de auditoría por producto cuyo nombre reescribió la familia (queda el nombre anterior). */
export async function auditRenames(context: AuditContext, renamed: readonly VariantRename[], reason: string): Promise<void> {
  for (const rename of renamed) {
    await recordAudit({
      context,
      action: "update",
      entity: "InventoryItem",
      entityId: rename.id,
      summary: `${reason}: «${rename.before}» pasó a llamarse «${rename.after}»`,
      detail: { changes: { name: { from: rename.before, to: rename.after } } },
    });
  }
}
