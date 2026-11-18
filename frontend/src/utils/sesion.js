// Guardado de la sesión en el navegador, compartido por Login y Register.
// Token y usuario van a localStorage y sessionStorage con las mismas claves que leen App.jsx y api.js.
// Devuelve true si había token (sesión guardada) y false si no (el que llama decide qué hacer).

const CLAVE_TOKEN = 'superGelatto_token';
const CLAVE_USUARIO = 'superGelatto_user';

function guardarEn(almacen, clave, valor) {
  try {
    almacen?.setItem(clave, valor);
  } catch {
    // Navegador sin almacenamiento (modo privado estricto, cuota llena): la sesión sigue en memoria.
  }
}

export function guardarSesion(
  { token, user } = {},
  { local = globalThis.localStorage, sesion = globalThis.sessionStorage } = {}
) {
  if (typeof token !== 'string' || !token) return false;
  const usuario = user && typeof user === 'object' ? JSON.stringify(user) : null;
  for (const almacen of [local, sesion]) {
    guardarEn(almacen, CLAVE_TOKEN, token);
    if (usuario) guardarEn(almacen, CLAVE_USUARIO, usuario);
  }
  return true;
}
