/** Roles y activación pertenecen a la empresa; nombre/correo pertenecen a la cuenta.
 * Una empresa no puede modificar la identidad compartida con otras empresas.
 * El titular conserva su edición propia (nombre desde Mi perfil; identidad desde Usuarios con permiso). */
export function canEditTeamAccount(input: { actorId: string; userId: string; membershipCount: number }): boolean {
  return input.actorId === input.userId || input.membershipCount <= 1;
}

export const SHARED_ACCOUNT_EDIT_ERROR = "Esta cuenta tiene acceso a otras empresas. Solo su titular puede actualizar su nombre y correo desde Usuarios. Podés cambiar su rol y acceso a esta empresa.";
