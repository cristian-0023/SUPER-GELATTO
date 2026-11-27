// ─── Modelos 3D en Supabase Storage (bucket "modelos-3d") ──────
// Tripo entrega cada modelo con un enlace que vence a los pocos minutos. Cuando la tarea termina, el
// servidor descarga el GLB, comprueba que de verdad sea un GLB y lo sube a nuestro bucket: así la
// tienda tiene un enlace permanente. El bucket lo crea la migración 20261118120000_bucket_modelos_3d
// (lectura pública; solo service_role puede subir o borrar).

const net = require('net');

const BUCKET_MODELOS_3D = 'modelos-3d';
const TIPO_GLB = 'model/gltf-binary';
const FIRMA_GLB = Buffer.from('glTF'); // los primeros 4 bytes de todo archivo .glb
// Límites de la descarga: 60 s y 50 MB (igual que file_size_limit del bucket).
const TIEMPO_MAXIMO_DESCARGA_MS = 60 * 1000;
const TAMANO_MAXIMO_MODELO = 50 * 1024 * 1024;
// Códigos con los que Tripo (o su CDN) dice que el enlace ya no sirve: no tiene sentido reintentar.
const CODIGOS_ENLACE_VENCIDO = [403, 404, 410];
const FORMATO_ID_TAREA = /^[A-Za-z0-9_-]{1,200}$/;
const FORMATO_RUTA_MODELO = /^producto-\d+\/[A-Za-z0-9_-]{1,200}\.glb$/;
// La subida a Storage también tiene tiempo máximo: si Storage no contesta, se reintenta en la próxima consulta.
const TIEMPO_MAXIMO_SUBIDA_MS = 30 * 1000;
// La ruta lleva el taskId, así que el archivo nunca cambia: el navegador y la CDN lo guardan un año.
const CACHE_MODELO_SEGUNDOS = '31536000';
// Redirecciones que se siguen a mano (cada salto se revisa con urlDescargaPermitida).
const CODIGOS_REDIRECCION = [301, 302, 303, 307, 308];
const MAXIMO_REDIRECCIONES = 3;

const rutaDelModelo = (idProducto, taskId) => `producto-${idProducto}/${taskId}.glb`;

// TRIPO_CDN_HOSTS (opcional): sufijos de host separados por coma, por ejemplo "tripo3d.com,tripo3d.ai".
// Si está definida, solo se descarga de esos hosts (y sus subdominios).
const leerHostsPermitidos = (valor = process.env.TRIPO_CDN_HOSTS) => String(valor || '')
  .split(',').map((h) => h.trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean);

// Evita que el servidor descargue de su propia red (SSRF): solo https, sin usuario ni clave, nunca una IP
// escrita a mano (v4 o v6: así quedan fuera 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, ::1,
// fc00::/7 y fe80::/10, también escritas como número o en hexadecimal, que el parser normaliza) ni localhost.
function urlDescargaPermitida(urlTexto, hostsPermitidos) {
  let url;
  try {
    url = new URL(urlTexto);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || net.isIP(host) || /^[\d.]+$/.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (hostsPermitidos.length && !hostsPermitidos.some((s) => host === s || host.endsWith(`.${s}`))) return false;
  return true;
}

// Solo el dominio va al log: la URL de Tripo trae una firma de acceso en la consulta.
function dominioDe(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(URL inválida)';
  }
}

// Descarga el modelo con tiempo y tamaño máximos.
// Devuelve { buffer } | { motivo: 'reintentar' | 'vencido' | 'muy_grande' | 'url_invalida' }.
async function descargarModelo(urlTripo, { fetchFn, timeoutMs, maxBytes, hostsPermitidos }) {
  const controlador = new AbortController();
  let reloj;
  // El mismo reloj corta la conexión y también la lectura del cuerpo (una descarga que se cuelga a mitad).
  const tiempoAgotado = new Promise((_resolver, rechazar) => {
    reloj = setTimeout(() => {
      controlador.abort();
      rechazar(new Error(`la descarga superó ${timeoutMs} ms`));
    }, timeoutMs);
  });
  tiempoAgotado.catch(() => {});
  let lector;
  try {
    // Las redirecciones se siguen a mano: cada destino se revisa ANTES de pedirlo.
    let url = urlTripo;
    let respuesta;
    for (let saltos = 0; ; saltos++) {
      if (!urlDescargaPermitida(url, hostsPermitidos)) {
        console.warn(`Descarga de modelo rechazada: el enlace no es un host público permitido (${dominioDe(url)}).`);
        return { motivo: 'url_invalida' };
      }
      respuesta = await Promise.race([fetchFn(url, { signal: controlador.signal, redirect: 'manual' }), tiempoAgotado]);
      if (!CODIGOS_REDIRECCION.includes(respuesta.status)) break;
      respuesta.body?.cancel().catch(() => {});
      const destino = respuesta.headers?.get('location');
      if (!destino || saltos >= MAXIMO_REDIRECCIONES) {
        console.warn(`Descarga de modelo rechazada: redirección sin destino o más de ${MAXIMO_REDIRECCIONES} saltos.`);
        return { motivo: 'url_invalida' };
      }
      try {
        url = new URL(destino, url).href;
      } catch {
        return { motivo: 'url_invalida' };
      }
    }
    if (!respuesta.ok) {
      respuesta.body?.cancel().catch(() => {});
      const motivo = CODIGOS_ENLACE_VENCIDO.includes(respuesta.status) ? 'vencido' : 'reintentar';
      console.warn(`Tripo respondió ${respuesta.status} al descargar el modelo (${dominioDe(urlTripo)}).`);
      return { motivo };
    }

    // Si el tamaño anunciado ya supera el máximo, no se lee nada.
    const largoAnunciado = Number(respuesta.headers?.get('content-length'));
    if (Number.isFinite(largoAnunciado) && largoAnunciado > maxBytes) {
      respuesta.body?.cancel().catch(() => {});
      console.warn(`El modelo de Tripo anuncia ${largoAnunciado} bytes; el máximo es ${maxBytes}.`);
      return { motivo: 'muy_grande' };
    }
    if (!respuesta.body) return { motivo: 'reintentar' };

    // Se lee por partes y se corta apenas se pasa del máximo (el anuncio puede faltar o mentir).
    lector = respuesta.body.getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await Promise.race([lector.read(), tiempoAgotado]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        lector.cancel().catch(() => {});
        console.warn(`El modelo de Tripo supera el máximo de ${maxBytes} bytes.`);
        return { motivo: 'muy_grande' };
      }
      partes.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    return { buffer: Buffer.concat(partes, total) };
  } catch (err) {
    lector?.cancel().catch(() => {});
    console.error(`No se pudo descargar el modelo de Tripo (${dominioDe(urlTripo)}):`, err?.message);
    return { motivo: 'reintentar' };
  } finally {
    clearTimeout(reloj);
  }
}

// Copias en marcha en esta instancia, por ruta. El panel consulta cada 3 s y una descarga puede tardar más:
// las consultas que llegan mientras tanto esperan la misma copia en vez de descargar y subir otra vez.
const copiasEnCurso = new Map();

// Copia el modelo terminado de Tripo al bucket propio.
// Devuelve { ok: true, url, ruta } | { ok: false, motivo: 'reintentar' | 'vencido' | 'muy_grande' | 'url_invalida' }.
// Nunca devuelve detalles internos: el detalle va al log.
async function copiarModeloATienda({
  supabase, idProducto, taskId, urlTripo,
  fetchFn = fetch, timeoutMs = TIEMPO_MAXIMO_DESCARGA_MS, maxBytes = TAMANO_MAXIMO_MODELO,
  timeoutSubidaMs = TIEMPO_MAXIMO_SUBIDA_MS, hostsPermitidos = leerHostsPermitidos(),
}) {
  if (!Number.isSafeInteger(idProducto) || idProducto <= 0 || typeof taskId !== 'string' || !FORMATO_ID_TAREA.test(taskId)) {
    console.error('Copia de modelo 3D con un producto o tarea de formato inesperado.');
    return { ok: false, motivo: 'reintentar' };
  }

  const ruta = rutaDelModelo(idProducto, taskId);
  if (copiasEnCurso.has(ruta)) return copiasEnCurso.get(ruta);
  const copia = descargarYSubir({ supabase, ruta, taskId, urlTripo, fetchFn, timeoutMs, maxBytes, timeoutSubidaMs, hostsPermitidos })
    .finally(() => copiasEnCurso.delete(ruta));
  copiasEnCurso.set(ruta, copia);
  return copia;
}

async function descargarYSubir({ supabase, ruta, taskId, urlTripo, fetchFn, timeoutMs, maxBytes, timeoutSubidaMs, hostsPermitidos }) {
  const descarga = await descargarModelo(urlTripo, { fetchFn, timeoutMs, maxBytes, hostsPermitidos });
  if (!descarga.buffer) return { ok: false, motivo: descarga.motivo };

  // Tripo a veces responde una página HTML o un JSON de error con código 200: eso no se sube.
  if (descarga.buffer.length < FIRMA_GLB.length || !descarga.buffer.subarray(0, FIRMA_GLB.length).equals(FIRMA_GLB)) {
    console.warn(`Lo que entregó Tripo para la tarea ${taskId} no es un GLB; se reintentará.`);
    return { ok: false, motivo: 'reintentar' };
  }

  let reloj;
  try {
    const bucket = supabase.storage.from(BUCKET_MODELOS_3D);
    const tiempoAgotado = new Promise((_resolver, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error(`la subida superó ${timeoutSubidaMs} ms`)), timeoutSubidaMs);
    });
    // upsert: si otra instancia sube el mismo modelo a la vez, las dos escriben el mismo archivo en la misma ruta.
    const { error: subirErr } = await Promise.race([
      bucket.upload(ruta, descarga.buffer, { contentType: TIPO_GLB, upsert: true, cacheControl: CACHE_MODELO_SEGUNDOS }),
      tiempoAgotado,
    ]);
    if (subirErr) {
      console.error(`No se pudo subir el modelo 3D a Storage (${ruta}):`, subirErr.message || subirErr);
      return { ok: false, motivo: 'reintentar' };
    }
    const { data } = bucket.getPublicUrl(ruta);
    return { ok: true, url: data.publicUrl, ruta };
  } catch (err) {
    // Storage no contestó a tiempo, no existe (la base simulada de desarrollo no lo tiene) o falló el cliente.
    console.error(`No se pudo subir el modelo 3D a Storage (${ruta}):`, err?.message);
    return { ok: false, motivo: 'reintentar' };
  } finally {
    clearTimeout(reloj);
  }
}

// Borra del bucket el modelo ANTERIOR de un producto, después de guardar el nuevo como "listo".
// Solo toca archivos de NUESTRO bucket que sean de ESE producto (producto-<id>/<tarea>.glb) y distintos
// del modelo nuevo; cualquier otra URL se ignora. Nunca lanza error.
async function borrarModeloAnterior({ supabase, url, idProducto, rutaNueva }) {
  try {
    if (typeof url !== 'string' || !url || !Number.isSafeInteger(idProducto) || idProducto <= 0) return;
    const bucket = supabase.storage.from(BUCKET_MODELOS_3D);
    const prefijo = bucket.getPublicUrl('').data.publicUrl; // <SUPABASE_URL>/storage/v1/object/public/modelos-3d/
    if (!url.startsWith(prefijo)) return;
    const ruta = url.slice(prefijo.length);
    if (!FORMATO_RUTA_MODELO.test(ruta) || !ruta.startsWith(`producto-${idProducto}/`) || ruta === rutaNueva) return;
    const { error } = await bucket.remove([ruta]);
    if (error) console.error(`No se pudo borrar el modelo 3D anterior (${ruta}):`, error.message || error);
  } catch (err) {
    console.error('No se pudo borrar el modelo 3D anterior:', err?.message);
  }
}

module.exports = {
  BUCKET_MODELOS_3D,
  TIEMPO_MAXIMO_DESCARGA_MS,
  TAMANO_MAXIMO_MODELO,
  copiarModeloATienda,
  borrarModeloAnterior,
};
