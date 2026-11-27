// Pruebas de backend/servicios/modelos3dStorage.js: copia el GLB que genera Tripo al bucket propio "modelos-3d".
// Contrato:
//  - Solo se sube un GLB de verdad (los primeros 4 bytes son "glTF"); HTML o JSON de error no se suben.
//  - Descarga con tiempo máximo y tamaño máximo: si se cuelga o pesa demasiado, se corta sin subir nada.
//  - Ruta fija producto-<id>/<taskId>.glb con upsert (dos consultas a la vez escriben el mismo archivo).
//  - Tripo responde 403/404/410 -> 'vencido' (el enlace ya no sirve); cualquier otra falla -> 'reintentar'.
//  - Nunca devuelve detalles internos: solo { ok:false, motivo }. El detalle va al log.
//  - borrarModeloAnterior solo borra archivos del bucket propio y nunca lanza error.
// Tripo y Storage son falsos: nunca se sale a la red.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';

const requireNode = createRequire(import.meta.url);
const { copiarModeloATienda, borrarModeloAnterior } = requireNode('../../servicios/modelos3dStorage.js');

const URL_TRIPO = 'https://cdn.tripo.test/modelo.glb?firma=abc';
const BASE_PUBLICA = 'http://supabase.fake.local/storage/v1/object/public/modelos-3d/';
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(64, 1)]);

const fake = crearFakeSupabase();
const subidas = () => fake.storage('upload');

// Cuerpo que entrega los trozos de a uno y anota si alguien lo leyó
// (highWaterMark 0: no se pide ningún trozo hasta que alguien lee).
function cuerpoPorTrozos(trozos, registro = {}) {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      registro.leido = true;
      if (i < trozos.length) ctrl.enqueue(new Uint8Array(trozos[i++]));
      else ctrl.close();
    },
  }, { highWaterMark: 0 });
}

const copiar = (extra = {}) => copiarModeloATienda({
  supabase: fake.client, idProducto: 5, taskId: 'T-1', urlTripo: URL_TRIPO,
  fetchFn: async () => new Response(GLB, { status: 200 }), ...extra,
});

beforeEach(() => {
  fake.reiniciar();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('copiarModeloATienda', () => {
  it('GLB válido se sube a producto-<id>/<taskId>.glb con contentType model/gltf-binary y upsert true y devuelve la URL pública', async () => {
    const fetchFn = vi.fn(async () => new Response(GLB, { status: 200 }));

    const r = await copiar({ fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(URL_TRIPO);
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchFn.mock.calls[0][1].redirect).toBe('manual'); // las redirecciones se revisan a mano
    expect(subidas()).toHaveLength(1);
    const [subida] = subidas();
    expect(subida.bucket).toBe('modelos-3d');
    expect(subida.ruta).toBe('producto-5/T-1.glb');
    expect(Buffer.from(subida.archivo).equals(GLB)).toBe(true);
    // La ruta lleva el taskId: el archivo nunca cambia, así que se puede guardar en caché un año.
    expect(subida.opciones).toEqual({ contentType: 'model/gltf-binary', upsert: true, cacheControl: '31536000' });
    expect(r).toEqual({ ok: true, ruta: 'producto-5/T-1.glb', url: `${BASE_PUBLICA}producto-5/T-1.glb` });
  });

  it('acepta el GLB aunque llegue en varios trozos', async () => {
    const trozos = [GLB.subarray(0, 2), GLB.subarray(2, 10), GLB.subarray(10)];
    const r = await copiar({ fetchFn: async () => new Response(cuerpoPorTrozos(trozos), { status: 200 }) });
    expect(r.ok).toBe(true);
    expect(Buffer.from(subidas()[0].archivo).equals(GLB)).toBe(true);
  });

  it.each([
    ['HTML', '<!doctype html><html><body>Access denied</body></html>'],
    ['JSON', '{"code":1001,"message":"error"}'],
    ['vacío', ''],
  ])('%s no se sube -> reintentar', async (_, texto) => {
    const r = await copiar({ fetchFn: async () => new Response(texto, { status: 200 }) });
    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
    expect(subidas()).toHaveLength(0);
  });

  it('Content-Length > maxBytes -> muy_grande sin leer el cuerpo', async () => {
    const registro = {};
    const fetchFn = async () => new Response(cuerpoPorTrozos([GLB], registro), {
      status: 200, headers: { 'content-length': '1000' },
    });

    const r = await copiar({ fetchFn, maxBytes: 999 });

    expect(r).toEqual({ ok: false, motivo: 'muy_grande' });
    expect(registro.leido).not.toBe(true);
    expect(subidas()).toHaveLength(0);
  });

  it('cuerpo que supera maxBytes al leer -> muy_grande', async () => {
    const registro = {};
    const trozos = [GLB, Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)];
    const fetchFn = async () => new Response(cuerpoPorTrozos(trozos, registro), { status: 200 });

    const r = await copiar({ fetchFn, maxBytes: 150 });

    expect(r).toEqual({ ok: false, motivo: 'muy_grande' });
    expect(subidas()).toHaveLength(0);
  });

  it('timeout (Tripo no contesta) -> reintentar', async () => {
    const fetchFn = (_url, { signal }) => new Promise((_resolver, rechazar) => {
      signal.addEventListener('abort', () => rechazar(signal.reason));
    });

    const r = await copiar({ fetchFn, timeoutMs: 30 });

    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
    expect(subidas()).toHaveLength(0);
  });

  it('timeout (la descarga se cuelga a mitad) -> reintentar', async () => {
    const colgado = new ReadableStream({
      start(ctrl) { ctrl.enqueue(new Uint8Array(GLB.subarray(0, 8))); }, // y nunca termina
    });
    const fetchFn = async () => new Response(colgado, { status: 200 });

    const r = await copiar({ fetchFn, timeoutMs: 30 });

    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
    expect(subidas()).toHaveLength(0);
  });

  it('falla de red -> reintentar', async () => {
    const r = await copiar({ fetchFn: async () => { throw new TypeError('fetch failed'); } });
    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
  });

  it.each([403, 404, 410])('Tripo responde %i -> vencido', async (status) => {
    const r = await copiar({ fetchFn: async () => new Response('<Error>AccessDenied</Error>', { status }) });
    expect(r).toEqual({ ok: false, motivo: 'vencido' });
    expect(subidas()).toHaveLength(0);
  });

  it.each([500, 502, 429])('Tripo responde %i -> reintentar', async (status) => {
    const r = await copiar({ fetchFn: async () => new Response('x', { status }) });
    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
  });

  it('error de upload -> reintentar y log sin datos internos al cliente', async () => {
    fake.responderStorage('upload', { data: null, error: { statusCode: '403', message: 'new row violates row-level security policy' } });

    const r = await copiar();

    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
    expect(JSON.stringify(r)).not.toMatch(/row-level|403/);
    expect(console.error).toHaveBeenCalled();
  });

  it('dos copias simultáneas del mismo modelo: una sola descarga y una sola subida (el panel consulta cada 3 s)', async () => {
    const pendientes = [];
    const soltar = () => pendientes.forEach((resolver) => resolver(new Response(GLB, { status: 200 })));
    const fetchFn = vi.fn(() => new Promise((resolver) => pendientes.push(resolver)));

    const p1 = copiar({ fetchFn });
    const p2 = copiar({ fetchFn });
    await new Promise((r) => setTimeout(r, 5));
    soltar();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(subidas()).toHaveLength(1);
    expect(r1).toEqual(r2);
    expect(r1.ok).toBe(true);

    // Terminada la copia, una consulta posterior puede volver a intentarlo (no queda "pegada").
    await copiar();
    expect(subidas()).toHaveLength(2);
  });

  it('subida que nunca responde -> reintentar al vencer el tiempo, y la copia en curso se libera', async () => {
    fake.responderStorage('upload', () => new Promise(() => {})); // Storage colgado

    const r = await copiar({ timeoutSubidaMs: 30 });

    expect(r).toEqual({ ok: false, motivo: 'reintentar' });
    // Una consulta posterior vuelve a intentarlo (no queda esperando la subida colgada).
    fake.responderStorage('upload', { data: { path: 'producto-5/T-1.glb' }, error: null });
    const r2 = await copiar({ timeoutSubidaMs: 30 });
    expect(r2.ok).toBe(true);
    expect(subidas()).toHaveLength(2);
  });

  it('sin Storage (base simulada de desarrollo) o si upload lanza -> reintentar, sin lanzar error', async () => {
    await expect(copiar({ supabase: {} })).resolves.toEqual({ ok: false, motivo: 'reintentar' });
    fake.responderStorage('upload', () => { throw new Error('boom'); });
    await expect(copiar()).resolves.toEqual({ ok: false, motivo: 'reintentar' });
  });

  it('ruta segura aunque el taskId o el id vengan raros: no sube nada', async () => {
    const r1 = await copiar({ taskId: '../otro' });
    const r2 = await copiar({ idProducto: 'abc' });
    expect(r1).toEqual({ ok: false, motivo: 'reintentar' });
    expect(r2).toEqual({ ok: false, motivo: 'reintentar' });
    expect(subidas()).toHaveLength(0);
  });
});


describe('copiarModeloATienda: solo descarga de hosts públicos (SSRF)', () => {
  const descargaDesde = async (urlTripo, extra = {}) => {
    const fetchFn = vi.fn(async () => new Response(GLB, { status: 200 }));
    const r = await copiar({ urlTripo, fetchFn, ...extra });
    return { r, fetchFn };
  };

  it.each([
    ['no es https', 'http://cdn.tripo.test/modelo.glb'],
    ['IPv4 literal', 'https://8.8.8.8/modelo.glb'],
    ['loopback 127/8', 'https://127.0.0.1/modelo.glb'],
    ['red privada 10/8', 'https://10.0.0.5/modelo.glb'],
    ['red privada 172.16/12', 'https://172.16.3.4/modelo.glb'],
    ['red privada 192.168/16', 'https://192.168.1.1/modelo.glb'],
    ['metadatos 169.254/16', 'https://169.254.169.254/latest/meta-data'],
    ['0/8', 'https://0.0.0.0/modelo.glb'],
    ['IPv4 escrita como número', 'https://2130706433/modelo.glb'],
    ['IPv4 en hexadecimal', 'https://0x7f.0.0.1/modelo.glb'],
    ['IPv6 ::1', 'https://[::1]/modelo.glb'],
    ['IPv6 fc00::/7', 'https://[fd12::1]/modelo.glb'],
    ['IPv6 fe80::/10', 'https://[fe80::1]/modelo.glb'],
    ['IPv6 con IPv4 adentro', 'https://[::ffff:127.0.0.1]/modelo.glb'],
    ['localhost', 'https://localhost/modelo.glb'],
    ['subdominio de localhost', 'https://algo.localhost/modelo.glb'],
    ['con usuario y clave', 'https://user:pass@cdn.tripo.test/modelo.glb'],
    ['no es una URL', 'no-es-url'],
  ])('rechaza %s antes de pedir -> url_invalida', async (_, url) => {
    const { r, fetchFn } = await descargaDesde(url);
    expect(r).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(subidas()).toHaveLength(0);
  });

  it('con lista de hosts (TRIPO_CDN_HOSTS), solo acepta esos sufijos', async () => {
    const hostsPermitidos = ['tripo3d.com', 'cdn.tripo.test'];
    expect((await descargaDesde('https://assets.tripo3d.com/m.glb', { hostsPermitidos })).r.ok).toBe(true);
    expect((await descargaDesde('https://tripo3d.com/m.glb', { hostsPermitidos })).r.ok).toBe(true);
    expect((await descargaDesde('https://cdn.tripo.test/m.glb', { hostsPermitidos })).r.ok).toBe(true);
    for (const url of ['https://eviltripo3d.com/m.glb', 'https://tripo3d.com.malo.test/m.glb', 'https://otro.test/m.glb']) {
      const { r, fetchFn } = await descargaDesde(url, { hostsPermitidos });
      expect(r).toEqual({ ok: false, motivo: 'url_invalida' });
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('lee la lista de la variable de entorno TRIPO_CDN_HOSTS (separada por comas)', async () => {
    const antes = process.env.TRIPO_CDN_HOSTS;
    process.env.TRIPO_CDN_HOSTS = ' tripo3d.com , cdn.tripo.test ';
    try {
      expect((await descargaDesde('https://cdn.tripo.test/m.glb')).r.ok).toBe(true);
      expect((await descargaDesde('https://otro.test/m.glb')).r).toEqual({ ok: false, motivo: 'url_invalida' });
    } finally {
      if (antes === undefined) delete process.env.TRIPO_CDN_HOSTS;
      else process.env.TRIPO_CDN_HOSTS = antes;
    }
  });

  it('sigue hasta 3 redirecciones a mano, revalidando cada salto', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === URL_TRIPO) return new Response(null, { status: 302, headers: { location: 'https://cdn2.tripo.test/a' } });
      if (url === 'https://cdn2.tripo.test/a') return new Response(null, { status: 301, headers: { location: '/b' } });
      if (url === 'https://cdn2.tripo.test/b') return new Response(null, { status: 307, headers: { location: 'https://cdn3.tripo.test/c.glb' } });
      return new Response(GLB, { status: 200 });
    });

    const r = await copiar({ fetchFn });

    expect(r.ok).toBe(true);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([URL_TRIPO, 'https://cdn2.tripo.test/a', 'https://cdn2.tripo.test/b', 'https://cdn3.tripo.test/c.glb']);
    expect(fetchFn.mock.calls.every((c) => c[1].redirect === 'manual')).toBe(true);
  });

  it('más de 3 redirecciones -> url_invalida', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: `https://cdn.tripo.test/salto-${++n}` } }));
    const r = await copiar({ fetchFn });
    expect(r).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(subidas()).toHaveLength(0);
  });

  it.each([
    ['la red interna', 'https://169.254.169.254/latest/meta-data'],
    ['http', 'http://cdn.tripo.test/m.glb'],
    ['localhost', 'https://localhost:8080/admin'],
  ])('una redirección hacia %s se rechaza sin pedirla -> url_invalida', async (_, destino) => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: destino } }));
    const r = await copiar({ fetchFn });
    expect(r).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('redirección sin Location -> url_invalida', async () => {
    const r = await copiar({ fetchFn: async () => new Response(null, { status: 302 }) });
    expect(r).toEqual({ ok: false, motivo: 'url_invalida' });
  });
});

describe('borrarModeloAnterior', () => {
  const borrar = (url, extra = {}) => borrarModeloAnterior({ supabase: fake.client, url, idProducto: 5, rutaNueva: 'producto-5/T-2.glb', ...extra });

  it('borra el archivo anterior del mismo producto en el bucket propio', async () => {
    await borrar(`${BASE_PUBLICA}producto-5/T-1.glb`);
    const borrados = fake.storage('remove');
    expect(borrados).toHaveLength(1);
    expect(borrados[0].bucket).toBe('modelos-3d');
    expect(borrados[0].rutas).toEqual(['producto-5/T-1.glb']);
  });

  it.each([
    ['otro dominio', 'https://cdn.tripo.test/producto-5/T-1.glb'],
    ['otro dominio con la misma ruta', 'https://malo.test/storage/v1/object/public/modelos-3d/producto-5/T-1.glb'],
    ['otro bucket', 'http://supabase.fake.local/storage/v1/object/public/helados/producto-5/T-1.glb'],
    ['ruta con ..', `${BASE_PUBLICA}producto-5/../../helados/fresa.png`],
    ['ruta con .. codificado', `${BASE_PUBLICA}producto-5/%2e%2e/T-1.glb`],
    ['ruta que no es un modelo', `${BASE_PUBLICA}otra-cosa.txt`],
    ['modelo de OTRO producto', `${BASE_PUBLICA}producto-7/T-1.glb`],
    ['producto con prefijo parecido', `${BASE_PUBLICA}producto-55/T-1.glb`],
    ['la misma ruta que el modelo nuevo', `${BASE_PUBLICA}producto-5/T-2.glb`],
    ['vacía', ''],
    ['nula', null],
    ['no es texto', 42],
  ])('no borra nada si la URL es de %s', async (_, url) => {
    await borrar(url);
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it('sin idProducto no borra nada', async () => {
    await borrar(`${BASE_PUBLICA}producto-5/T-1.glb`, { idProducto: undefined });
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it('si Storage falla, no lanza error: solo lo registra', async () => {
    fake.responderStorage('remove', { data: null, error: { message: 'Storage caído' } });
    await expect(borrar(`${BASE_PUBLICA}producto-5/T-1.glb`)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('si Storage lanza una excepción, tampoco lanza error', async () => {
    fake.responderStorage('remove', () => { throw new Error('boom'); });
    await expect(borrar(`${BASE_PUBLICA}producto-5/T-1.glb`)).resolves.toBeUndefined();
  });
});
