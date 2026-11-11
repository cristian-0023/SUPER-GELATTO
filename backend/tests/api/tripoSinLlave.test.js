// La llave de Tripo solo vive en la variable de entorno TRIPO_API_KEY. Contrato sin llave:
//  - El servidor arranca igual (aviso en el log), también en producción.
//  - Las rutas que usan Tripo responden 503 en español, sin llamarlo y sin tocar el estado de los modelos.
//  - Crear un producto sigue funcionando, sin modelo 3D.
//  - Lo ya generado se sigue viendo: un modelo listo no necesita la llave.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin } from '../helpers/cargarServidor.js';

const ARCHIVO_MODELOS = 'tripo_models_state.json';
const ID_GENERANDO = 55;
const ID_LISTO = 56;
const MODELO = 'https://tripo.test/listo.glb';

describe('server.js no trae ninguna llave escrita', () => {
  const fuente = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

  it('TRIPO_API_KEY sale solo de la variable de entorno, sin valor por defecto', () => {
    const lineas = fuente.split('\n').filter((l) => l.includes('process.env.TRIPO_API_KEY'));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).not.toMatch(/\|\||\?\?/);
  });

  it('no hay llaves de Tripo en el código', () => {
    expect(fuente).not.toMatch(/tsk_[A-Za-z0-9_-]{10,}/);
  });
});

describe('arranque sin TRIPO_API_KEY', () => {
  const avisos = () => console.warn.mock.calls.flat().join(' ');

  it.each([['producción', true], ['desarrollo', false]])('%s: arranca y avisa en el log', (_, produccion) => {
    const { app } = cargarServidor(crearFakeSupabase(), { tripoApiKey: '', produccion });

    expect(app).toBeTruthy();
    expect(avisos()).toMatch(/TRIPO_API_KEY/);
  });

  it('con llave no avisa', () => {
    vi.restoreAllMocks();
    cargarServidor(crearFakeSupabase());

    expect(avisos()).not.toMatch(/TRIPO_API_KEY/);
  });
});

describe.each([['vacía', ''], ['con solo espacios', '   ']])('rutas 3D con la llave %s', (_, tripoApiKey) => {
  const fake = crearFakeSupabase();
  let app;
  let escrituras;
  let fetchFalso;

  // El estado de los modelos vive en la base (producto.model_3d_*), ya no en un archivo: "no dejar estado"
  // significa que no se escribe nada en producto (ni archivos).
  const escriturasDeModelos = () => [
    ...escrituras.mock.calls.filter(([ruta]) => String(ruta).endsWith(ARCHIVO_MODELOS)),
    ...fake.consultas('producto', 'update'),
  ];
  const llamadasATripo = () => fetchFalso.mock.calls.filter(([url]) => String(url).includes('tripo3d'));

  // La base ya trae una tarea a medias y un modelo terminado de cuando había llave.
  const FILAS_GUARDADAS = {
    [ID_GENERANDO]: { id_producto: ID_GENERANDO, model_3d_task_id: 'T-9', model_3d_prompt: 'cono', model_3d_estado: 'generando', model_3d_url: null },
    [ID_LISTO]: { id_producto: ID_LISTO, model_3d_task_id: 'T-8', model_3d_prompt: 'copa', model_3d_estado: 'listo', model_3d_url: MODELO },
  };

  beforeAll(() => {
    ({ app, escrituras } = cargarServidor(fake, { tripoApiKey }));
  });

  beforeEach(() => {
    fake.reiniciar();
    fake.responder('producto', 'select', (llamada) => {
      const id = llamada.filtros.find(([op, col]) => op === 'eq' && col === 'id_producto')?.[2];
      return { data: FILAS_GUARDADAS[id] ?? null, error: null };
    });
    escrituras.mockClear();
    fetchFalso = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: { task_id: 'NO-DEBE-PASAR', status: 'running' } }) }));
    vi.stubGlobal('fetch', fetchFalso);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('regenerar modelo -> 503 en español, sin llamar a Tripo y sin dejar estado', async () => {
    const res = await request(app).post('/api/admin/products/40/regenerate-3d').set(authAdmin()).send({ prompt: 'un cono' });

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/modelos? 3D/i);
    expect(llamadasATripo()).toHaveLength(0);
    expect(escriturasDeModelos()).toHaveLength(0);

    const estado = await request(app).get('/api/admin/products/40/model-3d').set(authAdmin());
    expect(estado.body.estado).toBe('idle');
  });

  it('regenerar sin sesión de admin sigue siendo 401', async () => {
    const res = await request(app).post('/api/admin/products/40/regenerate-3d').send({ prompt: 'un cono' });
    expect(res.status).toBe(401);
  });

  it('consultar una tarea a medias -> 503, sin llamar a Tripo y conservando la tarea', async () => {
    const res = await request(app).get(`/api/admin/products/${ID_GENERANDO}/model-3d`).set(authAdmin());

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(llamadasATripo()).toHaveLength(0);
    expect(escriturasDeModelos()).toHaveLength(0);
  });

  it('un modelo ya listo se sigue consultando sin llave', async () => {
    const res = await request(app).get(`/api/admin/products/${ID_LISTO}/model-3d`).set(authAdmin());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'listo', url: MODELO });
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('crear producto con prompt -> 201 sin modelo, sin llamar a Tripo y sin estado roto', async () => {
    const res = await request(app).post('/api/admin/products').set(authAdmin())
      .send({ name: 'Sin 3D', price: 4000, prompt3d: 'cono de helado' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.model).toBeNull();
    expect(fake.consultas('producto', 'insert')).toHaveLength(1);
    expect(llamadasATripo()).toHaveLength(0);
    expect(escriturasDeModelos()).toHaveLength(0);

    const estado = await request(app).get(`/api/admin/products/${res.body.product.id}/model-3d`).set(authAdmin());
    expect(estado.status).toBe(200);
    expect(estado.body.estado).toBe('idle');
  });

  it('crear producto sin prompt -> 201 normal', async () => {
    const res = await request(app).post('/api/admin/products').set(authAdmin()).send({ name: 'Simple', price: 3000 });

    expect(res.status).toBe(201);
    expect(res.body.model).toBeNull();
  });
});
