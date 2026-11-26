// Gelbot, segunda tanda (2026-11-20): la segunda llamada a Groq ya no falla con tool_use_failed,
// solo se agrega al carrito cuando el cliente lo pide, el precio lo escribe el servidor y la lista de
// helados trae fotos (datos de la base, nunca del modelo).
// El modelo (Groq) y Supabase son FALSOS: estas pruebas nunca llaman a Groq de verdad.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

// Errores REALES de groq-sdk (el subpath groq-sdk/error no se reemplaza por el falso).
const { APIError } = createRequire(import.meta.url)('groq-sdk/error');
const errorGroq = (status, code, extra = {}) =>
  APIError.generate(status, { error: { message: 'error de prueba', type: 'invalid_request_error', code, ...extra } }, undefined, new Headers());

const MENSAJE_FALLA = /falla técnica/i;
const MENSAJE_RESPUESTA_VACIA = /no logré armar una respuesta/i;

const USUARIOS = {
  1: { id_usuario: 1, nombre: 'Ana Admin', email: 'ana.admin@example.com', rol: 'admin' },
  7: { id_usuario: 7, nombre: 'Carlos Cliente', email: 'carlos@example.com', rol: 'cliente' },
};
const bearer = (datos) => ({ Authorization: `Bearer ${tokenPrueba(datos)}` });
const tokenAdmin = () => bearer({ id_usuario: 1, email: USUARIOS[1].email, rol: 'admin' });
const tokenCliente = () => bearer({ id_usuario: 7, email: USUARIOS[7].email, rol: 'cliente' });

const PRODUCTOS = [
  { id_producto: 1, nombre: 'Fresa Salvaje', precio: 9000, imagen: '/images/gelato_fresa.png', descripcion: 'Fresas frescas', estado: true },
  { id_producto: 2, nombre: 'Chocolate Belga', precio: 12000, imagen: 'https://cdn.example.com/choco.png', descripcion: 'Cacao 70%', estado: true },
  { id_producto: 3, nombre: 'Mango Biche', precio: 8500, imagen: 'javascript:alert(1)', descripcion: 'Ácido', estado: true },
];

const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}, content = null) => ({
  choices: [{ message: { role: 'assistant', content, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const fake = crearFakeSupabase();
let llamadasGroq = [];
let guion = [];
const groqFalso = async (parametros) => {
  llamadasGroq.push(JSON.parse(JSON.stringify(parametros)));
  const siguiente = guion.shift();
  if (siguiente instanceof Error) throw siguiente;
  return siguiente || texto('Listo.');
};

function prepararFake(productos = PRODUCTOS) {
  fake.reiniciar();
  fake.responder('usuario', 'select', (c) => {
    const filtro = c.filtros.find((f) => f[0] === 'eq');
    const u = USUARIOS[filtro ? String(filtro[2]) : ''];
    return u ? { data: u, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  });
  fake.responder('producto', 'select', { data: productos, error: null });
}

// Servidor nuevo en cada prueba: la caché de productos de chatbot.js vive en el módulo.
let chat;
beforeEach(() => {
  llamadasGroq = [];
  guion = [];
  prepararFake();
  const { app } = cargarServidor(fake, { groq: groqFalso });
  chat = (cuerpo, cabeceras = {}) => request(app).post('/api/chatbot').set(cabeceras).send(cuerpo);
});

const nombres = (llamada) => (llamada?.tools || []).map((t) => t.function.name).sort();

describe('1. segunda llamada sin tool_use_failed', () => {
  // Opción A (2026-11-25): clientes y visitantes hacen UNA sola llamada (sin segunda llamada ni texto del modelo).
  it.each([
    ['anónimo', () => ({}), ['addToCart', 'elegirTema', 'getProducts']],
    ['cliente', tokenCliente, ['addToCart', 'elegirTema', 'getOrders', 'getProducts']],
  ])('%s: una sola llamada, con SOLO sus herramientas permitidas; las tarjetas salen de la base', async (_r, cabeceras, esperadas) => {
    guion = [pideHerramienta('getProducts'), texto('Estos son nuestros sabores.')];
    const res = await chat({ message: 'hola, a ver' }, cabeceras());
    expect(llamadasGroq).toHaveLength(1);
    expect(nombres(llamadasGroq[0])).toEqual(esperadas);
    expect(llamadasGroq[0].parallel_tool_calls).toBe(false);
    expect(res.body.productos).toHaveLength(3);
  });

  it('admin: la segunda llamada lleva las mismas herramientas de la primera y tool_choice "none"', async () => {
    guion = [pideHerramienta('getProducts'), texto('Catálogo.')];
    await chat({ message: 'catálogo' }, tokenAdmin());
    expect(llamadasGroq[1].tool_choice).toBe('none');
    expect(nombres(llamadasGroq[1])).toEqual(nombres(llamadasGroq[0]));
  });

  it('si la segunda respuesta igual trae tool_calls (admin pide deleteUser), se ignoran: no hay propuesta ni borrado', async () => {
    guion = [pideHerramienta('getProducts'), pideHerramienta('deleteUser', { identifier: '7' })];
    const res = await chat({ message: 'catálogo' }, tokenAdmin());
    expect(llamadasGroq).toHaveLength(2);
    expect(res.body.requiereConfirmacion).toBeUndefined();
    expect(res.body.tokenConfirmacion).toBeUndefined();
    expect(fake.consultas('usuario', 'delete')).toHaveLength(0);
    expect(res.body.response).toMatch(MENSAJE_RESPUESTA_VACIA);
  });

  it('si la segunda respuesta de un cliente trae addToCart, no se agrega nada al carrito', async () => {
    guion = [pideHerramienta('getProducts'), pideHerramienta('addToCart', { productName: 'Fresa Salvaje' })];
    const res = await chat({ message: 'hmm, a ver' }, tokenCliente()); // un mensaje que sí llega al modelo
    expect(llamadasGroq).toHaveLength(1); // una sola llamada: no hay segunda
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
  });

  it('tool_use_failed en la primera llamada: se reintenta UNA vez y responde bien', async () => {
    // el texto del modelo solo lo ve el admin (opción A): el reintento se prueba con el admin
    guion = [errorGroq(400, 'tool_use_failed', { failed_generation: '<function=x>' }), texto('¡Hola! 🍦')];
    const res = await chat({ message: 'hola' }, tokenAdmin());
    expect(llamadasGroq).toHaveLength(2);
    expect(llamadasGroq[1].tools).toBeDefined();
    expect(res.body.response).toMatch(/Hola/);
  });

  it('tool_use_failed dos veces seguidas: solo 2 intentos y mensaje de falla', async () => {
    guion = [errorGroq(400, 'tool_use_failed'), errorGroq(400, 'tool_use_failed'), texto('no debería llegar')];
    const res = await chat({ message: 'hola' }, tokenAdmin());
    expect(llamadasGroq).toHaveLength(2);
    expect(res.body.response).toMatch(MENSAJE_FALLA);
  });

  it('otro error 400 (no tool_use_failed) no se reintenta', async () => {
    guion = [errorGroq(400, 'invalid_request_error'), texto('no debería llegar')];
    const res = await chat({ message: 'hola' }, tokenAdmin());
    expect(llamadasGroq).toHaveLength(1);
    expect(res.body.response).toMatch(MENSAJE_FALLA);
  });
});

describe('2. agregar al carrito solo cuando el cliente lo pide', () => {
  it.each([
    ['cuánto cuesta la fresa'],
    ['Cuánto cuesta el helado de fresa'],
    ['quiero saber cuánto cuesta la fresa'],
    ['dame el precio de la fresa'],
    ['¿qué ingredientes tiene la fresa?'],
  ])('"%s": aunque el modelo llame a addToCart, NO se agrega y se responde con la info del producto', async (mensaje) => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa' }), texto('Fresa agregada.')];
    const res = await chat({ message: mensaje }, tokenCliente());
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
    expect(res.body.response).toMatch(/Fresa Salvaje/);
  });

  // Antes: el texto nombraba el sabor que eligió el modelo (Fresa Salvaje). Con la opción A la pista del modelo solo
  // vale si el cliente nombró el sabor: con un apodo no se nombra ninguno y se muestran los precios en las tarjetas.
  it('pregunta de precio con un apodo ("cuánto cuesta el rojito de frutas"): no agrega ni elige el sabor del modelo', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa' }), texto('Fresa agregada.')];
    const res = await chat({ message: 'cuánto cuesta el rojito de frutas' }, tokenCliente());
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
    expect(res.body.response).not.toContain('Fresa');
    expect(res.body.response).toMatch(/precio/i);
    expect(res.body.productos).toHaveLength(3);
  });

  it.each([
    ['agrégame una fresa'],
    ['Agregame la fresa salvaje porfa'],
    ['añade una fresa al carrito'],
    ['quiero una fresa'],
    ['dame un chocolate belga'],
    ['me llevo la fresa'],
    // pedidos amables con signos de pregunta (muy comunes en Colombia)
    ['¿Me das una fresa?'],
    ['¿me regalas una fresa salvaje?'],
    ['¿me da un chocolate belga, por favor?'],
  ])('"%s": sí se agrega al carrito con el producto real de la base', async (mensaje) => {
    guion = [pideHerramienta('addToCart', { productName: /choco/i.test(mensaje) ? 'Chocolate Belga' : 'Fresa Salvaje' }), texto('Listo.')];
    const res = await chat({ message: mensaje }, tokenCliente());
    expect(res.body.action).toBe('addToCart');
    expect([1, 2]).toContain(res.body.product.id);
  });

  it('el atajo sin modelo reconoce "agrégame una fresa" (sin llamar a Groq)', async () => {
    const res = await chat({ message: 'agrégame una fresa' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(0);
    expect(res.body.action).toBe('addToCart');
    expect(res.body.product).toMatchObject({ id: 1, nombre: 'Fresa Salvaje', precio: 9000 });
  });

  it('el atajo sin modelo NO agrega cuando solo se pregunta el precio (lo responde el atajo de precios)', async () => {
    guion = [texto('La Fresa Salvaje cuesta $9.000.')];
    const res = await chat({ message: 'cuánto cuesta la fresa' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(0);
    expect(res.body.action ?? null).toBeNull();
  });

  it.each([['anónimo', () => ({})], ['cliente', tokenCliente]])('%s: el prompt pide addToCart solo con pedido explícito', async (_r, cabeceras) => {
    guion = [texto('Hola.')];
    await chat({ message: 'hola' }, cabeceras());
    const sistema = llamadasGroq[0].messages[0].content;
    expect(sistema).not.toMatch(/INMEDIATAMENTE/);
    expect(sistema).not.toMatch(/NO preguntes confirmaci[oó]n/i);
    expect(sistema).toMatch(/addToCart SOLO cuando/i);
    expect(sistema).toMatch(/agr[eé]game/i);
  });
});

describe('3. el precio lo escribe el servidor', () => {
  it('addToCart: aunque el modelo diga "$12.000", el cliente lee el precio real "$9.000"', async () => {
    // pedido y pregunta a la vez: no lo resuelve el atajo, pasa por el modelo.
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('**Fresa** cuesta **$12.000 COP** y ya está en tu carrito.')];
    const res = await chat({ message: 'agrégame una fresa, ¿qué ingredientes contiene?' }, tokenCliente());
    expect(llamadasGroq.length).toBeGreaterThan(0);
    expect(res.body.action).toBe('addToCart');
    expect(res.body.product).toMatchObject({ id: 1, precio: 9000 });
    expect(res.body.response).toContain('Fresa Salvaje');
    expect(res.body.response).toContain('$9.000');
    expect(res.body.response).not.toMatch(/12\.000/);
  });

  it('un apodo ("quiero el rojito de frutas") no deja que el modelo elija: no agrega y pregunta el sabor con el menú', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('**Fresa** cuesta **$12.000 COP** y ya está en tu carrito.')];
    const res = await chat({ message: 'quiero el rojito de frutas' }, tokenCliente());
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
    expect(res.body.response).toMatch(/cu[aá]l sabor quieres/i);
    expect(res.body.productos.length).toBeGreaterThan(0);
    expect(res.body.response).not.toMatch(/12\.000/);
  });

  it('el atajo sin modelo escribe el precio como "$9.000"', async () => {
    const res = await chat({ message: 'agrégame una fresa' }, tokenCliente());
    expect(res.body.response).toContain('$9.000');
  });

  it('pregunta de precio con addToCart del modelo: el texto lleva el precio real "$9.000"', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa' }), texto('Fresa cuesta $12.000.')];
    const res = await chat({ message: 'cuánto cuesta la fresa' }, tokenCliente());
    expect(res.body.response).toContain('$9.000');
    expect(res.body.response).not.toMatch(/12\.000/);
  });

  it.each([['anónimo', () => ({})], ['cliente', tokenCliente]])('%s: "Cuánto cuesta el helado de fresa" lo responde el servidor con $9.000, sin modelo', async (_r, cabeceras) => {
    guion = [texto('**Fresa** cuesta **$12.000 COP**')];
    const res = await chat({ message: 'Cuánto cuesta el helado de fresa' }, cabeceras());
    expect(llamadasGroq).toHaveLength(0);
    expect(res.body.response).toContain('Fresa Salvaje');
    expect(res.body.response).toContain('$9.000');
    expect(res.body.response).not.toMatch(/12\.000/);
    expect(res.body.action ?? null).toBeNull();
  });

  it.each([
    ['ningún producto coincide', 'cuánto cuesta el de menta'],
    ['no menciona producto', 'cuánto cuestan los helados'],
  ])('si %s, la pregunta de precio pasa al modelo', async (_c, mensaje) => {
    guion = [texto('Te cuento los precios.')];
    await chat({ message: mensaje }, tokenCliente());
    expect(llamadasGroq).toHaveLength(1);
  });

  // Revisión: si coinciden varios sabores, el servidor pregunta cuál (sin dar precio ni llamar al modelo).
  it('si varios productos coinciden, el servidor pregunta cuál sin dar precio', async () => {
    const res = await chat({ message: 'cuánto cuestan la fresa y el chocolate' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(0);
    expect(res.body.response).toMatch(/cu[aá]l/i);
    expect(res.body.response).not.toMatch(/\$/);
  });

  it('el admin no usa el atajo de precios', async () => {
    guion = [texto('Fresa Salvaje: $9.000.')];
    await chat({ message: 'cuánto cuesta la fresa' }, tokenAdmin());
    expect(llamadasGroq).toHaveLength(1);
  });

  it('el catálogo del prompt trae los precios reales de la base', async () => {
    guion = [texto('Hola.')];
    await chat({ message: 'hola' }, tokenCliente());
    const sistema = llamadasGroq[0].messages[0].content;
    expect(sistema).toContain('Fresa Salvaje - $9.000');
    expect(sistema).toContain('Chocolate Belga - $12.000');
    expect(sistema).toContain('Mango Biche - $8.500');
  });
});

describe('4. fotos de los helados en la lista', () => {
  it('tras getProducts, la respuesta trae `productos` con datos de la base (no del modelo)', async () => {
    guion = [pideHerramienta('getProducts'), texto('Estos son nuestros sabores 🍦')];
    const res = await chat({ message: 'qué sabores de helado tienen' }, tokenCliente());
    expect(res.body.response).toMatch(/sabores/);
    expect(res.body.productos).toEqual([
      { id: 1, nombre: 'Fresa Salvaje', precio: 9000, image: '/images/gelato_fresa.png' },
      { id: 2, nombre: 'Chocolate Belga', precio: 12000, image: 'https://cdn.example.com/choco.png' },
      // URL de imagen peligrosa: se descarta (el navegador pondrá una foto por defecto)
      { id: 3, nombre: 'Mango Biche', precio: 8500, image: null },
    ]);
  });

  // Tope subido de 12 a 24 (decisión del dueño, 2026-11-25).
  it('máximo 24 productos y solo activos', async () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ id_producto: i + 1, nombre: `Sabor ${i + 1}`, precio: 1000 * (i + 1), imagen: `/images/s${i + 1}.png`, estado: i !== 0 }));
    prepararFake(muchos);
    guion = [pideHerramienta('getProducts'), texto('Estos son nuestros sabores 🍦')];
    const res = await chat({ message: 'muéstrame el menú' }, tokenCliente());
    expect(res.body.productos).toHaveLength(24);
    expect(res.body.productos.map((p) => p.id)).not.toContain(1);
    expect(res.body.productos[0]).toEqual({ id: 2, nombre: 'Sabor 2', precio: 2000, image: '/images/s2.png' });
  });

  it.each([
    ['http (no https)', 'http://cdn.example.com/a.png'],
    ['protocolo relativo', '//evil.example.com/a.png'],
    ['con ..', '/images/../../etc/passwd'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['con usuario y clave', 'https://user:pass@cdn.example.com/a.png'],
  ])('imagen inválida (%s) llega como null', async (_c, imagen) => {
    prepararFake([{ id_producto: 9, nombre: 'Coco', precio: 7000, imagen, estado: true }]);
    guion = [pideHerramienta('getProducts'), texto('Sabores.')];
    const res = await chat({ message: 'menú' }, tokenCliente());
    expect(res.body.productos).toEqual([{ id: 9, nombre: 'Coco', precio: 7000, image: null }]);
  });

  it('sin getProducts no hay campo productos', async () => {
    guion = [texto('¡Hola!')];
    const res = await chat({ message: 'hola' }, tokenCliente());
    expect(res.body.productos).toBeUndefined();
  });

  it('si la segunda llamada falla, igual se muestran los sabores con un texto amable', async () => {
    // la segunda llamada reintenta una vez: fallan las dos
    guion = [pideHerramienta('getProducts'), errorGroq(400, 'tool_use_failed'), errorGroq(400, 'tool_use_failed')];
    const res = await chat({ message: 'qué sabores de helado tienen' }, tokenCliente());
    expect(res.body.productos).toHaveLength(3);
    expect(res.body.response).toMatch(/sabores/i);
    expect(res.body.response).not.toMatch(MENSAJE_FALLA);
  });
});
