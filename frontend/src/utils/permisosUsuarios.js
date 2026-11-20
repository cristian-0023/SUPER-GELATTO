// Permisos de la tabla de usuarios del panel de administración.
// El servidor es quien decide de verdad (PUT /api/admin/users/:id/role); esto solo evita ofrecer en
// pantalla un cambio que el servidor va a rechazar.

// ¿Puede quien mira el panel cambiar el rol de esta cuenta? Solo el super admin cambia roles
// (ascender o bajar), y nadie toca el rol de la cuenta del super admin, ni él mismo.
//  - esObjetivoSuperAdmin: la cuenta de la fila es la del super admin.
//  - soySuperAdmin: quien mira el panel es el super admin.
export function puedeEditarRol({ esObjetivoSuperAdmin, soySuperAdmin }) {
  return soySuperAdmin === true && esObjetivoSuperAdmin !== true;
}
