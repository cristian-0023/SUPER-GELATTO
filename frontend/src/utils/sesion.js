// Sesión en el navegador, igual para todos los caminos (contraseña, Google, facial y registro).
// Token y usuario van a localStorage y sessionStorage con las mismas claves que leen App.jsx y api.js.
// La sesión no dura más que el token: el servidor lo firma por 24 h y rechaza uno vencido (401).

const CLAVE_TOKEN = 'superGelatto_token';
const CLAVE_USUARIO = 'superGelatto_user';
const CLAVES_SESION = [CLAVE_TOKEN, CLAVE_USUARIO, 'superGelatto_face_verified', 'superGelatto_face_verified_at'];

const almacenesPorDefecto = () => ({ local: globalThis.localStorage, sesion: globalThis.sessionStorage });

function enCadaAlmacen({ local, sesion }, accion) {
  for (const almacen of [local, sesion]) {
    if (!almacen) continue;
    try {
      accion(almacen);
    } catch {
      // Navegador sin almacenamiento (modo privado estricto, cuota llena): la sesión sigue en memoria.
    }
  }
}

const esUsuario = (user) => !!user && typeof user === 'object';

// Guarda token y usuario. Devuelve true si se guardó y false si falta alguno de los dos (no deja una
// sesión a medias: el que llama decide qué hacer, por ejemplo mandar a /login).
export function guardarSesion({ token, user } = {}, almacenes = almacenesPorDefecto()) {
  if (typeof token !== 'string' || !token || !esUsuario(user)) return false;
  const usuario = JSON.stringify(user);
  enCadaAlmacen(almacenes, (a) => {
    a.setItem(CLAVE_TOKEN, token);
    a.setItem(CLAVE_USUARIO, usuario);
  });
  return true;
}

// Datos nuevos del usuario (editar perfil, foto): se actualizan en los dos almacenes; el token no cambia.
export function actualizarUsuarioGuardado(user, almacenes = almacenesPorDefecto()) {
  if (!esUsuario(user)) return false;
  const usuario = JSON.stringify(user);
  enCadaAlmacen(almacenes, (a) => a.setItem(CLAVE_USUARIO, usuario));
  return true;
}

// Cerrar sesión: borra token, usuario y la verificación facial de los dos almacenes (el carrito queda).
export function borrarSesion(almacenes = almacenesPorDefecto()) {
  enCadaAlmacen(almacenes, (a) => CLAVES_SESION.forEach((clave) => a.removeItem(clave)));
}

// Vencimiento (ms) que trae el token, o null si no se puede leer. Solo para saber si sigue vigente:
// la firma la comprueba el servidor en cada pedido.
function venceEn(token) {
  try {
    const parte = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(parte));
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function leer({ local, sesion }, clave) {
  for (const almacen of [local, sesion]) {
    try {
      const valor = almacen?.getItem(clave);
      if (valor) return valor;
    } catch {
      // Sin almacenamiento: se sigue con el otro.
    }
  }
  return null;
}

// Al abrir la app: devuelve el usuario guardado solo si su token sigue vigente. Si falta, venció o está
// dañado, borra la sesión (así nadie aparece conectado con un token que el servidor ya rechaza).
export function leerUsuarioGuardado({
  local = globalThis.localStorage, sesion = globalThis.sessionStorage, ahora = Date.now(),
} = {}) {
  const almacenes = { local, sesion };
  const token = leer(almacenes, CLAVE_TOKEN);
  const usuarioTexto = leer(almacenes, CLAVE_USUARIO);
  const vence = token ? venceEn(token) : null;
  let usuario = null;
  try {
    usuario = usuarioTexto ? JSON.parse(usuarioTexto) : null;
  } catch {
    usuario = null;
  }
  if (vence !== null && vence > ahora && esUsuario(usuario)) return usuario;
  if (token || usuarioTexto) borrarSesion(almacenes);
  return null;
}
