// Pruebas de backend/modelos3dStorage.js: copia el GLB que genera Tripo al bucket propio "modelos-3d".
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
const { copiarModeloATienda, borrarModeloAnterior } = requireNode('../../modelos3dStorage.js');

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
    expect(subidas()).toHaveLength(1);
    const [subida] = subidas();
    expect(subida.bucket).toBe('modelos-3d');
    expect(subida.ruta).toBe('producto-5/T-1.glb');
    expect(Buffer.from(subida.archivo).equals(GLB)).toBe(true);
    expect(subida.opciones).toEqual({ contentType: 'model/gltf-binary', upsert: true });
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

  it('ruta segura aunque el taskId o el id vengan raros: no sube nada', async () => {
    const r1 = await copiar({ taskId: '../otro' });
    const r2 = await copiar({ idProducto: 'abc' });
    expect(r1).toEqual({ ok: false, motivo: 'reintentar' });
    expect(r2).toEqual({ ok: false, motivo: 'reintentar' });
    expect(subidas()).toHaveLength(0);
  });
});

describe('borrarModeloAnterior', () => {
  it('borra el archivo del bucket propio', async () => {
    await borrarModeloAnterior({ supabase: fake.client, url: `${BASE_PUBLICA}producto-5/T-1.glb` });
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
    ['vacía', ''],
    ['nula', null],
    ['no es texto', 42],
  ])('ignora URLs de otros dominios o buckets (%s)', async (_, url) => {
    await borrarModeloAnterior({ supabase: fake.client, url });
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it('si Storage falla, no lanza error: solo lo registra', async () => {
    fake.responderStorage('remove', { data: null, error: { message: 'Storage caído' } });
    await expect(borrarModeloAnterior({ supabase: fake.client, url: `${BASE_PUBLICA}producto-5/T-1.glb` })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('si Storage lanza una excepción, tampoco lanza error', async () => {
    fake.responderStorage('remove', () => { throw new Error('boom'); });
    await expect(borrarModeloAnterior({ supabase: fake.client, url: `${BASE_PUBLICA}producto-5/T-1.glb` })).resolves.toBeUndefined();
  });
});
