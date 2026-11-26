// Gelbot: cuando el cliente pide sin decir el sabor, pide el menú o una recomendación, la respuesta trae SIEMPRE
// las tarjetas con foto (2026-11-25: antes solo salían si el modelo llamaba a una herramienta).
// Handler REAL, catálogo real y modelo TRAMPOSO. Groq y Supabase son FALSOS.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';
import { CATALOGO_REAL } from '../helpers/catalogoReal.js';

const { APIError } = createRequire(import.meta.url)('groq-sdk/error');
const errorGroq = (status, code) => APIError.generate(status, { error: { message: 'x', code } }, undefined, new Headers());
const bearer = (id, rol) => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: id, email: 'x@example.com', rol })}` });
const tokenCliente = () => bearer(7, 'cliente');
const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const fake = crearFakeSupabase();
let llamadasGroq = [];
let productosBase = CATALOGO_REAL;
beforeEach(() => {
  llamadasGroq = [];
  productosBase = CATALOGO_REAL;
  fake.reiniciar();
  fake.responder('usuario', 'select', { data: { id_usuario: 7, nombre: 'Carlos', email: 'x@example.com', rol: 'cliente' }, error: null });
  fake.responder('producto', 'select', () => ({ data: productosBase, error: null }));
});

async function enviar(message, { history = [], guion = [texto('Claro.')], cabeceras = tokenCliente() } = {}) {
  const pasos = [...guion];
  const { app } = cargarServidor(fake, {
    groq: async (p) => {
      llamadasGroq.push(p);
      const paso = pasos.shift() || texto('Claro.');
      if (paso instanceof Error) throw paso;
      return paso;
    },
  });
  return (await request(app).post('/api/chatbot').set(cabeceras).send({ message, history })).body;
}

const bot = (content) => [{ role: 'user', content: 'hola' }, { role: 'assistant', content }];
const HISTORIALES = [
  ['sin historial', []],
  ['tras una oferta', bot('**Fresa Salvaje** cuesta **$9.000**. Si lo quieres, dime "agrégalo" y lo pongo en tu carrito 🍦')],
  ['tras "¿cuál sabor quieres?"', bot('¿Cuál sabor quieres? 🍦')],
];
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
// Todo lo que puede hacer el modelo con un pedido sin sabor: contestar, inventar, agregar o llamar mal.
const TRAMPAS = [
  ['contesta con texto', [texto('¿Qué sabor prefieres?')]],
  ['intenta agregar', [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Agregado.')]],
  ['intenta agregar algo ambiguo', [pideHerramienta('addToCart', { productName: 'fresa y mango' }), texto('Agregado.')]],
  ['mira los pedidos', [pideHerramienta('getOrders'), texto('Claro.')]],
  ['consulta el catálogo', [pideHerramienta('getProducts'), texto('Claro.')]],
];

function esperaTarjetas(body) {
  expect(body.action ?? null).toBeNull();
  expect(body.product ?? null).toBeNull();
  expect(body.quantity).toBeUndefined();
  expect(body.productos?.length).toBe(13); // los 13 sabores reales (el tope del chat es 24)
  expect(body.productos[0]).toEqual({ id: 1, nombre: 'Fresa Salvaje', precio: 9000, image: '/images/1.png' });
  expect(body.response).toBeTruthy();
  expect(body.response).not.toMatch(/agr[eé]galo|fue añadido/i);
}

describe('1. sin sabor y sin duda: lo resuelve el servidor, sin modelo', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it.each([
      ['quiero un helado'], ['dame algo rico'], ['quiero uno'], ['quiero dos helados por favor'], ['hola, quiero un helado'], ['me das un helado?'], ['quiero pedir'], ['quiero comprar un helado'],
      ['necesito un helado'], ['recomiéndame algo'], ['qué me recomiendas'], ['¿qué me recomiendas?'], ['recomiéndame un helado rico'], ['¿cuál me recomiendas?'], ['no sé qué pedir, recomiéndame algo'],
      ['dame una recomendación'], ['quiero hacer un pedido'], ['quiero algo para mi mamá'], ['¿cuál es el más vendido?'],
    ])('"%s"', async (frase) => {
      for (const mensaje of [frase, sinTildes(frase)]) {
        const body = await enviar(mensaje, { history });
        esperaTarjetas(body);
        expect(body.response).toMatch(/cu[aá]l sabor quieres/i);
      }
      expect(llamadasGroq).toHaveLength(0);
    });
  });

  it('sin productos en la base no se promete un menú vacío', async () => {
    productosBase = [];
    const body = await enviar('quiero un helado');
    expect(body.productos ?? []).toHaveLength(0);
    expect(body.response).not.toMatch(/estos son/i);
  });
});

describe('2. apodos, menú y sabores: si responde el modelo, el servidor adjunta las tarjetas', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it.each([
      ['quiero el rojito de frutas'], ['dame el de la abuela'], ['ver menú'], ['menú'], ['muéstrame el menú'], ['muéstrame los sabores'], ['qué sabores tienen'], ['¿qué sabores hay?'],
      ['helados disponibles'], ['¿qué helados tienen?'], ['quiero ver el menú'], ['¿me pasas el menú?'], ['¿cuáles son los sabores?'], ['sabores'], ['¿qué venden?'], ['ver el catálogo'],
      ['la carta por favor'], ['hola, ¿qué sabores tienen hoy?'],
    ])('"%s"', async (frase) => {
      for (const [nombre, guion] of TRAMPAS) {
        const body = await enviar(frase, { history, guion });
        expect(body.productos, nombre).toBeDefined();
        esperaTarjetas(body);
      }
      esperaTarjetas(await enviar(sinTildes(frase), { history, cabeceras: {} }));
    });
  });

  it('si Groq falla, el menú igual se muestra', async () => {
    for (const guion of [[errorGroq(429, 'rate_limit_exceeded')], [errorGroq(500, 'x')]]) {
      const body = await enviar('muéstrame los sabores', { guion });
      esperaTarjetas(body);
      expect(body.response).toMatch(/estos son nuestros sabores/i);
    }
  });

  it('"gracias, muéstrame el menú" muestra el menú y no cierra el chat', async () => {
    esperaTarjetas(await enviar('gracias, muéstrame el menú'));
  });
});

describe('3. sin tarjetas cuando no se está preguntando el sabor', () => {
  it.each([
    ['hola'], ['buenas tardes'], ['gracias'], ['chao'], ['adiós'], ['no me gustó el helado'], ['el menú no carga'], ['no me gustan sus sabores'], ['quiero reclamar'], ['pedí un helado y no llegó'],
    ['cuánto cuesta la fresa'], ['¿qué ingredientes tiene la fresa?'], ['agrégame una fresa'], ['quiero un mango'], ['¿dónde están ubicados?'], ['¿tienen domicilio?'], ['quiero ver mis pedidos'],
    ['quiero mi factura'], ['necesito hablar con un asesor'], ['quiero saber el horario'], ['dame tu teléfono'], ['quiero pagar'], ['qué ricos sabores'], ['¿me recomiendas la fresa?'], ['dame un momento'],
    ['no quiero un helado'], ['soy alérgico a la leche'], ['quiero un descuento'], ['dame un consejo'], ['necesito ayuda'],
  ])('"%s"', async (frase) => {
    expect((await enviar(frase)).productos).toBeUndefined();
  });

  it.each([['quiero un helado'], ['muéstrame los sabores'], ['qué me recomiendas']])('admin: "%s" no trae tarjetas y va al modelo', async (frase) => {
    const body = await enviar(frase, { cabeceras: bearer(1, 'admin') });
    expect(body.productos).toBeUndefined();
    expect(llamadasGroq).toHaveLength(1);
  });

  it('las tarjetas salen de la caché del catálogo: una sola consulta', async () => {
    await enviar('quiero el rojito de frutas');
    expect(fake.consultas('producto', 'select')).toHaveLength(1);
  });
});
