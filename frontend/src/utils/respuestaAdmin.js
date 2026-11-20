// Qué hace el panel de administración cuando una ruta de admin no responde bien.
// Pensado para rutas cuyo único 403 es el de requireAdmin ("la sesión es válida pero no es de admin"):
// el panel de datos (/api/admin/dashboard) y la consulta del modelo 3D.
//  - 'sesion-vencida' (401): apiFetch ya borró la sesión y mandó a /login; no hay nada más que hacer.
//  - 'sin-permiso' (403): la sesión ya no es de administrador; se avisa, se borra la sesión y se sale a la portada.
//  - 'reintentable' (500 o más): falla pasajera del servidor; un sondeo puede volver a preguntar.
//  - 'error': cualquier otro problema (400, 404…); se avisa y no se reintenta.
export function decidirAnteErrorPanel(status) {
  if (status === 401) return 'sesion-vencida';
  if (status === 403) return 'sin-permiso';
  if (status >= 500) return 'reintentable';
  return 'error';
}

// Mensaje del servidor si trae uno; si no, el texto por defecto.
export function mensajeDeError(data, porDefecto) {
  return typeof data?.message === 'string' && data.message.trim() ? data.message : porDefecto;
}
