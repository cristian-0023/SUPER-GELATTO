// Alta de productos (POST /api/admin/products) con las MISMAS reglas que el editor, y rutas sueltas
// (/price, /category, /stock, /featured) con id validado y 404 si el producto no existe.
// Contrato:
//  - Todo se valida ANTES de insertar en la base y ANTES de llamar a Tripo: si algo falla, 400 en español.
//  - Nombre 1-120 (recortado), precio entero 1..99.999.999, stock entero 0..2.147.483.647 (0 por defecto),
//    categoría de la lista, descripción hasta 2000, imagen https o ruta local (nunca data:, ni con usuario/clave).
//  - La respuesta devuelve solo las columnas públicas del producto (más el alias id que usa el panel).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
let app;
let fetchFalso;
beforeAll(() => {
  // Con llave de Tripo (ficticia): así la prueba de "no se llama a Tripo" puede fallar de verdad.
  ({ app } = cargarServidor(fake, { tripoApiKey: 'tripo-llave-falsa-de-prueba' }));
});
beforeEach(() => {
  fake.reiniciar();
  fetchFalso = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: { task_id: 'T-9' } }) }));
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => vi.unstubAllGlobals());

const post = (body) => request(app).post('/api/admin/products').set(authAdmin()).send(body);
const put = (url, body) => request(app).put(url).set(authAdmin()).send(body);
const llamadasATripo = () => fetchFalso.mock.calls.filter(([url]) => String(url).includes('tripo3d'));
const primera = (llamada) => [].concat(llamada.payload)[0];

const VALIDO = { name: 'Helado nuevo', price: 5000, category: 'Clásico' };
const COLUMNAS = ['id_producto', 'nombre', 'precio', 'stock', 'descripcion', 'imagen', 'categoria', 'estado', 'destacado'];

// Cada caso: cuerpo inválido -> 400, sin insert y sin Tripo (aunque venga un prompt 3D válido).
async function esperarRechazo(cuerpo) {
  const res = await post({ ...cuerpo, prompt3d: 'cono de helado de fresa' });
  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(typeof res.body.message).toBe('string');
  expect(fake.consultas('producto', 'insert')).toHaveLength(0);
  expect(llamadasATripo()).toHaveLength(0);
}

describe('alta: nombre', () => {
  it.each([
    ['vacío', ''], ['solo espacios', '   '], ['de 121 caracteres', 'a'.repeat(121)], ['número', 5], ['arreglo', ['x']], ['null', null],
  ])('nombre %s -> 400', async (_, name) => {
    await esperarRechazo({ ...VALIDO, name });
  });
  it('sin nombre -> 400', async () => {
    const { name, ...sinNombre } = VALIDO;
    await esperarRechazo(sinNombre);
  });
  it('recorta el nombre antes de guardarlo', async () => {
    const res = await post({ ...VALIDO, name: '  Fresa  ' });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).nombre).toBe('Fresa');
  });
});

describe('alta: precio', () => {
  it.each([
    ['decimal', 1.5], ['0', 0], ['negativo', -3], ['texto', 'abc'], ['true', true], ['[5]', [5]], ['vacío', ''],
    ['null', null], ['mayor al tope', 100000000], ['texto decimal', '12.5'],
  ])('precio %s -> 400', async (_, price) => {
    await esperarRechazo({ ...VALIDO, price });
  });
  it('sin precio -> 400', async () => {
    const { price, ...sinPrecio } = VALIDO;
    await esperarRechazo(sinPrecio);
  });
  it('price inválido no se "salva" con precio (no se usa price || precio)', async () => {
    await esperarRechazo({ ...VALIDO, price: 0, precio: 5000 });
  });
  it('acepta "precio" (nombre en español) y texto numérico entero', async () => {
    const { price, ...base } = VALIDO;
    const res = await post({ ...base, precio: '4500' });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).precio).toBe(4500);
  });
});

describe('alta: categoría', () => {
  it.each([['vacía', ''], ['inexistente', 'Otra'], ['en minúsculas', 'gourmet'], ['null', null]])('categoría %s -> 400', async (_, category) => {
    await esperarRechazo({ ...VALIDO, category });
  });
  it('sin categoría -> 400', async () => {
    const { category, ...sinCategoria } = VALIDO;
    await esperarRechazo(sinCategoria);
  });
  it.each(['Clásico', 'Vegano', 'Temporada', 'Gourmet'])('acepta %s (también como "categoria")', async (c) => {
    const { category, ...base } = VALIDO;
    const res = await post({ ...base, categoria: c });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).categoria).toBe(c);
  });
});

describe('alta: stock', () => {
  it.each([['decimal', 2.5], ['negativo', -1], ['texto', 'mucho'], ['true', true], ['[5]', [5]], ['mayor al tope', 2147483648]])(
    'stock %s -> 400', async (_, stock) => {
      await esperarRechazo({ ...VALIDO, stock });
    });
  // Decisión del usuario: sin stock (o vacío) vale 50, como antes.
  it('sin stock -> se guarda 50', async () => {
    const res = await post(VALIDO);
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).stock).toBe(50);
  });
  it("stock '' -> se guarda 50", async () => {
    const res = await post({ ...VALIDO, stock: '' });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).stock).toBe(50);
  });
  it('stock 0 explícito -> se guarda 0', async () => {
    const res = await post({ ...VALIDO, stock: 0 });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).stock).toBe(0);
  });
  it('acepta el tope 2147483647', async () => {
    expect((await post({ ...VALIDO, stock: 2147483647 })).status).toBe(201);
  });
});

describe('alta: descripción', () => {
  it.each([['de 2001 caracteres', 'a'.repeat(2001)], ['número', 7], ['objeto', { a: 1 }]])('descripción %s -> 400', async (_, description) => {
    await esperarRechazo({ ...VALIDO, description });
  });
  it('acepta 2000 caracteres (también como "descripcion")', async () => {
    const res = await post({ ...VALIDO, descripcion: 'a'.repeat(2000) });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).descripcion).toHaveLength(2000);
  });
});

describe('alta: imagen', () => {
  it.each([
    ['data:', 'data:image/png;base64,AAAA'], ['javascript:', 'javascript:alert(1)'], ['http:', 'http://cdn.example.com/a.png'],
    ['//', '//otro.com/a.png'], ['..', '/images/../secreto.png'], ['con usuario y clave', 'https://user:pass@cdn.example.com/a.png'],
    ['con solo usuario', 'https://user@cdn.example.com/a.png'], ['número', 5],
  ])('imagen %s -> 400', async (_, image) => {
    await esperarRechazo({ ...VALIDO, image });
  });
  it.each([undefined, null, ''])('imagen %j -> imagen por defecto según el nombre', async (image) => {
    const res = await post({ ...VALIDO, name: 'Chocolate intenso', image });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).imagen).toBe('/images/gelato_chocolate.png');
  });
  it('https válida -> se guarda normalizada', async () => {
    const res = await post({ ...VALIDO, image: 'HTTPS://Cdn.Example.com/a b.png' });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).imagen).toBe('https://cdn.example.com/a%20b.png');
  });
  it('ruta local con espacios -> se guarda tal cual', async () => {
    const res = await post({ ...VALIDO, image: '/images/caramelo salado.png' });
    expect(res.status).toBe(201);
    expect(primera(fake.consultas('producto', 'insert')[0]).imagen).toBe('/images/caramelo salado.png');
  });
});

describe('alta: éxito', () => {
  it('pide a la base solo las columnas públicas y responde solo esas (más id)', async () => {
    const res = await post({ ...VALIDO, stock: 12, description: 'rico', featured: true });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const insert = fake.consultas('producto', 'insert')[0];
    expect(insert.columnasRetorno).toBe(COLUMNAS.join(', '));
    expect(Object.keys(res.body.product).sort()).toEqual([...COLUMNAS, 'id'].sort());
    expect(res.body.product).toMatchObject({
      id: res.body.product.id_producto, nombre: 'Helado nuevo', precio: 5000, stock: 12, descripcion: 'rico',
      categoria: 'Clásico', destacado: true,
    });
    expect(res.body.product).not.toHaveProperty('rating');
    expect(fake.errores).toEqual([]);
  });

  it('con prompt válido y datos válidos sí inicia la tarea en Tripo', async () => {
    // La reserva del modelo (update ... maybeSingle) encuentra la fila recién creada.
    fake.responder('producto', 'update', { data: { id_producto: 1 }, error: null });
    const res = await post({ ...VALIDO, prompt3d: 'cono de helado de fresa' });
    expect(res.status).toBe(201);
    expect(llamadasATripo().length).toBeGreaterThan(0);
  });
});

describe('/image: URL con usuario o clave', () => {
  it.each(['https://user:pass@cdn.example.com/a.png', 'https://user@cdn.example.com/a.png', 'https://:pass@cdn.example.com/a.png'])(
    'rechaza %s sin tocar la base', async (image) => {
      const res = await put('/api/admin/products/7/image', { image });
      expect(res.status).toBe(400);
      expect(fake.consultas('producto')).toHaveLength(0);
    });
});

describe('rutas sueltas: id inválido -> 400 sin tocar la base', () => {
  const CASOS = [
    ['/price', { precio: 3000 }], ['/category', { categoria: 'Vegano' }], ['/stock', { stock: 3 }], ['/featured', { destacado: true }],
  ];
  const IDS = ['abc', '0', '-1', '1.5', '2147483648', '5abc'];
  for (const [ruta, cuerpo] of CASOS) {
    it.each(IDS)(`${ruta} con id %j -> 400`, async (id) => {
      const res = await put(`/api/admin/products/${id}${ruta}`, cuerpo);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(fake.consultas('producto')).toHaveLength(0);
    });
  }
});

describe('rutas sueltas: producto inexistente -> 404', () => {
  const CASOS = [
    ['/price', { precio: 3000 }], ['/category', { categoria: 'Vegano' }], ['/stock', { stock: 3 }], ['/featured', { destacado: true }],
  ];
  it.each(CASOS)('%s -> 404 si la base no actualizó ninguna fila', async (ruta, cuerpo) => {
    // Como PostgREST: update ... select ... maybeSingle sin filas -> data null.
    fake.responder('producto', 'update', { data: null, error: null });
    const res = await put(`/api/admin/products/999${ruta}`, cuerpo);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
  it.each(CASOS)('%s -> 200 si el producto existe', async (ruta, cuerpo) => {
    fake.responder('producto', 'update', { data: { id_producto: 5 }, error: null });
    const res = await put(`/api/admin/products/5${ruta}`, cuerpo);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('rutas sueltas: valores con las reglas compartidas', () => {
  it.each([[1.5], [0], [true], [[5]], [100000000]])('/price con %j -> 400', async (precio) => {
    expect((await put('/api/admin/products/5/price', { precio })).status).toBe(400);
  });
  it.each([[2.5], [-1], [true], [2147483648]])('/stock con %j -> 400', async (stock) => {
    expect((await put('/api/admin/products/5/stock', { stock })).status).toBe(400);
  });
});

describe('/featured: solo verdadero o falso', () => {
  it.each([[true, true], [false, false], ['true', true], ['false', false]])('destacado %j -> guarda %j', async (destacado, esperado) => {
    fake.responder('producto', 'update', { data: { id_producto: 5 }, error: null });
    const res = await put('/api/admin/products/5/featured', { destacado });
    expect(res.status).toBe(200);
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ destacado: esperado });
    expect(res.body.destacado).toBe(esperado);
  });
  it.each([[1], [0], ['si'], ['TRUE'], [''], [null], [[true]], [{}]])('destacado %j -> 400 sin tocar la base', async (destacado) => {
    const res = await put('/api/admin/products/5/featured', { destacado });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(fake.consultas('producto')).toHaveLength(0);
  });
  it('sin destacado -> 400', async () => {
    expect((await put('/api/admin/products/5/featured', {})).status).toBe(400);
  });
});

describe('alta: el log no se puede falsificar con el nombre', () => {
  it('el nombre va al log entre comillas JSON (un salto de línea queda escapado)', async () => {
    const espia = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await post({ ...VALIDO, name: 'Fresa\n✅ Producto 1 precio=1 actualizado.' });
      expect(res.status).toBe(201);
      const linea = espia.mock.calls.map((args) => args.join(' ')).find((l) => l.includes('Producto agregado'));
      expect(linea).toBeDefined();
      expect(linea).not.toContain('\n');
      expect(linea).toContain(JSON.stringify('Fresa\n✅ Producto 1 precio=1 actualizado.'));
    } finally {
      espia.mockRestore();
    }
  });
});
