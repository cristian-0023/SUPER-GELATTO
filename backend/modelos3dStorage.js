// ─── Modelos 3D en Supabase Storage (bucket "modelos-3d") ──────
// Tripo entrega cada modelo con un enlace que vence a los pocos minutos. Cuando la tarea termina, el
// servidor descarga el GLB, comprueba que de verdad sea un GLB y lo sube a nuestro bucket: así la
// tienda tiene un enlace permanente. El bucket lo crea la migración 20261118120000_bucket_modelos_3d
// (lectura pública; solo service_role puede subir o borrar).

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

const rutaDelModelo = (idProducto, taskId) => `producto-${idProducto}/${taskId}.glb`;

// Solo el dominio va al log: la URL de Tripo trae una firma de acceso en la consulta.
function dominioDe(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(URL inválida)';
  }
}

// Descarga el modelo con tiempo y tamaño máximos.
// Devuelve { buffer } | { motivo: 'reintentar' | 'vencido' | 'muy_grande' }.
async function descargarModelo(urlTripo, { fetchFn, timeoutMs, maxBytes }) {
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
    const respuesta = await Promise.race([fetchFn(urlTripo, { signal: controlador.signal }), tiempoAgotado]);
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
// Devuelve { ok: true, url, ruta } | { ok: false, motivo: 'reintentar' | 'vencido' | 'muy_grande' }.
// Nunca devuelve detalles internos: el detalle va al log.
async function copiarModeloATienda({
  supabase, idProducto, taskId, urlTripo,
  fetchFn = fetch, timeoutMs = TIEMPO_MAXIMO_DESCARGA_MS, maxBytes = TAMANO_MAXIMO_MODELO,
}) {
  if (!Number.isSafeInteger(idProducto) || idProducto <= 0 || typeof taskId !== 'string' || !FORMATO_ID_TAREA.test(taskId)) {
    console.error('Copia de modelo 3D con un producto o tarea de formato inesperado.');
    return { ok: false, motivo: 'reintentar' };
  }

  const ruta = rutaDelModelo(idProducto, taskId);
  if (copiasEnCurso.has(ruta)) return copiasEnCurso.get(ruta);
  const copia = descargarYSubir({ supabase, ruta, taskId, urlTripo, fetchFn, timeoutMs, maxBytes })
    .finally(() => copiasEnCurso.delete(ruta));
  copiasEnCurso.set(ruta, copia);
  return copia;
}

async function descargarYSubir({ supabase, ruta, taskId, urlTripo, fetchFn, timeoutMs, maxBytes }) {
  const descarga = await descargarModelo(urlTripo, { fetchFn, timeoutMs, maxBytes });
  if (!descarga.buffer) return { ok: false, motivo: descarga.motivo };

  // Tripo a veces responde una página HTML o un JSON de error con código 200: eso no se sube.
  if (descarga.buffer.length < FIRMA_GLB.length || !descarga.buffer.subarray(0, FIRMA_GLB.length).equals(FIRMA_GLB)) {
    console.warn(`Lo que entregó Tripo para la tarea ${taskId} no es un GLB; se reintentará.`);
    return { ok: false, motivo: 'reintentar' };
  }

  try {
    const bucket = supabase.storage.from(BUCKET_MODELOS_3D);
    // upsert: si otra instancia sube el mismo modelo a la vez, las dos escriben el mismo archivo en la misma ruta.
    const { error: subirErr } = await bucket.upload(ruta, descarga.buffer, { contentType: TIPO_GLB, upsert: true });
    if (subirErr) {
      console.error(`No se pudo subir el modelo 3D a Storage (${ruta}):`, subirErr.message || subirErr);
      return { ok: false, motivo: 'reintentar' };
    }
    const { data } = bucket.getPublicUrl(ruta);
    return { ok: true, url: data.publicUrl, ruta };
  } catch (err) {
    // Sin Storage (la base simulada de desarrollo no lo tiene) o un fallo inesperado del cliente.
    console.error(`No se pudo subir el modelo 3D a Storage (${ruta}):`, err?.message);
    return { ok: false, motivo: 'reintentar' };
  }
}

// Borra del bucket el modelo anterior de un producto (al regenerar). Solo toca archivos de NUESTRO
// bucket con la forma producto-<id>/<tarea>.glb; cualquier otra URL se ignora. Nunca lanza error.
async function borrarModeloAnterior({ supabase, url }) {
  try {
    if (typeof url !== 'string' || !url) return;
    const bucket = supabase.storage.from(BUCKET_MODELOS_3D);
    const prefijo = bucket.getPublicUrl('').data.publicUrl; // <SUPABASE_URL>/storage/v1/object/public/modelos-3d/
    if (!url.startsWith(prefijo)) return;
    const ruta = url.slice(prefijo.length);
    if (!FORMATO_RUTA_MODELO.test(ruta)) return;
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
