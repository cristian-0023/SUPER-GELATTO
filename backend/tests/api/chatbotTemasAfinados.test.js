// Gelbot, afinado de temas (2026-11-25, tras las revisiones de la opción A): "gracias" no cierra el chat, "ayuda" no es
// queja, lo inequívoco se responde sin el modelo, un tema de baja gravedad del modelo se comprueba con las palabras,
// la confirmación tras una alergia es estricta, variantes de texto, medios de pago y defensa extra del admin.
// Groq y Supabase son FALSOS: estas pruebas nunca llaman a Groq de verdad.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';
import { CATALOGO_REAL } from '../helpers/catalogoReal.js';

const requireNode = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const { APIError } = requireNode('groq-sdk/error');
const errorGroq = (status, code) => APIError.generate(status, { error: { message: 'x', code } }, undefined, new Headers());
const intencion = requireNode('../../gelbotIntencion.js');

const bearer = (id, rol) => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: id, email: 'x@example.com', rol })}` });
const ROLES = [['visitante', () => ({})], ['cliente', () => bearer(7, 'cliente')]];
const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}) => ({
  choices: [{ message: { role: 'assistant', content: 'MENTIRA-42', tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});
const tema = (nombre, producto) => pideHerramienta('elegirTema', producto ? { tema: nombre, producto } : { tema: nombre });
const sinLlave = Symbol('sin llave');

const fake = crearFakeSupabase();
let llamadasGroq = [];
let productosBase = CATALOGO_REAL;
beforeEach(() => {
  llamadasGroq = [];
  productosBase = CATALOGO_REAL;
  fake.reiniciar();
  fake.responder('usuario', 'select', { data: { id_usuario: 7, nombre: 'Carlos', email: 'x@example.com', rol: 'cliente' }, error: null });
  fake.responder('producto', 'select', () => ({ data: productosBase, error: null }));
  fake.responder('venta', 'select', { data: [{ id_venta: 31, fecha: '2026-11-20T15:00:00Z', total: 27000, estado: 'Pagado' }], error: null });
});

async function enviar(message, { history = [], guion = [texto('Claro.')], cabeceras = bearer(7, 'cliente') } = {}) {
  let opciones;
  if (guion === sinLlave) opciones = { groqApiKey: '' };
  else {
    const pasos = [...guion];
    opciones = {
      groq: async (p) => {
        llamadasGroq.push(JSON.parse(JSON.stringify(p)));
        const paso = pasos.length > 1 ? pasos.shift() : pasos[0];
        if (paso instanceof Error) throw paso;
        return paso;
      },
    };
  }
  const { app } = cargarServidor(fake, opciones);
  return (await request(app).post('/api/chatbot').set(cabeceras).send({ message, history })).body;
}

const GUIONES = [
  ['el modelo dice despedida', [tema('despedida')]], ['el modelo dice queja', [tema('queja')]], ['el modelo escribe', [texto('Adiós')]],
  ['caído', [errorGroq(500, 'x')]], ['429', [errorGroq(429, 'rate_limit_exceeded')]], ['sin llave', sinLlave],
];
const GRACIAS = /con gusto|para eso estoy|a ti/i;
const SIENTO = /siento mucho/i;

describe('1. "gracias" no cierra el chat', () => {
  describe.each(ROLES)('%s', (_r, cabeceras) => {
    it.each(GUIONES)('%s', async (_n, guion) => {
      for (const frase of ['gracias', 'muchas gracias', 'gracias por todo', '¡Gracias!', 'mil gracias']) {
        const body = await enviar(frase, { guion, cabeceras: cabeceras() });
        expect(body.response, frase).toMatch(GRACIAS);
        expect(body.action ?? null, frase).toBeNull();
      }
      for (const frase of ['adiós', 'chao', 'hasta luego', 'nos vemos', 'me voy', 'chao, gracias']) {
        const body = await enviar(frase, { guion, cabeceras: cabeceras() });
        expect(body.action, frase).toBe('closeChat');
      }
      expect((await enviar('gracias, y cómo pago', { guion, cabeceras: cabeceras() })).response).toMatch(/Continuar al Pago/);
      const otra = await enviar('gracias, otra pregunta: a qué hora abren', { guion, cabeceras: cabeceras() });
      expect(otra.response).toMatch(/no tengo ese dato/i);
      expect(otra.action ?? null).toBeNull();
    });
  });
});

describe('2. "ayuda" no es una queja', () => {
  it('"necesito ayuda para escoger un sabor": qué puede hacer Gelbot, con el menú', async () => {
    for (const guion of [[tema('queja')], [tema('ayuda')], [texto('x')], [errorGroq(500, 'x')]]) {
      const body = await enviar('necesito ayuda para escoger un sabor', { guion });
      expect(body.response).not.toMatch(SIENTO);
      expect(body.response).toMatch(/menú|sabor/i);
      expect(body.productos).toHaveLength(13);
    }
  });
  it('"necesito ayuda" y "¿qué puedes hacer?": texto de ayuda, sin "Siento mucho"', async () => {
    for (const frase of ['necesito ayuda', '¿qué puedes hacer?', 'ayúdame']) {
      for (const guion of [[tema('queja')], [errorGroq(500, 'x')]]) {
        const body = await enviar(frase, { guion });
        expect(body.response, frase).not.toMatch(SIENTO);
        expect(body.response, frase).toMatch(/puedo|te ayudo/i);
      }
    }
  });
  it('"están muy caros": respuesta neutra con los precios en las tarjetas', async () => {
    for (const guion of [[tema('queja')], [texto('x')], [errorGroq(500, 'x')]]) {
      const body = await enviar('están muy caros', { guion });
      expect(body.response).not.toMatch(SIENTO);
      expect(body.response).toMatch(/precio/i);
      expect(body.productos).toHaveLength(13);
    }
  });
  it('el tema "ayuda" existe y la queja ya no dice "o ayuda"', async () => {
    await enviar('hmm a ver');
    const elegir = llamadasGroq[0].tools.find((t) => t.function.name === 'elegirTema').function.parameters.properties.tema;
    expect(elegir.enum).toContain('ayuda');
    expect(elegir.description).not.toMatch(/queja \(o ayuda\)/);
  });
  it('una queja de verdad sigue siendo queja', async () => {
    for (const frase of ['mi helado llegó derretido', 'quiero poner una queja', 'esto está mal']) {
      expect((await enviar(frase, { guion: [tema('queja')] })).response, frase).toMatch(SIENTO);
    }
  });
});

describe('3. lo inequívoco sin el modelo; los temas del modelo se comprueban con las palabras', () => {
  it.each([
    ['muchas gracias', GRACIAS], ['chao', /pronto|visitarnos/i], ['¿cómo pago?', /Continuar al Pago/], ['¿quién eres?', /soy Gelbot/i],
    ['¿a qué hora abren?', /no tengo ese dato/i], ['¿cómo funcionan los super points?', /Super Points/], ['quiero armar mi propio helado', /creador 3D/],
  ])('"%s" se responde sin llamar al modelo', async (frase, esperado) => {
    const body = await enviar(frase, { guion: [tema('queja')] });
    expect(llamadasGroq).toHaveLength(0);
    expect(body.response).toMatch(esperado);
  });

  it('si el modelo elige queja, despedida o pedidos sin que las palabras lo respalden, no se le cree', async () => {
    const malos = [[tema('queja')], [tema('despedida')], [tema('pedidos')], [pideHerramienta('getOrders')]];
    for (const guion of malos) {
      const hola = await enviar('hola', { guion });
      expect(hola.response).toMatch(/hola|bienvenid/i);
      expect(hola.action ?? null).toBeNull();
      const barato = await enviar('¿cuál es el más barato?', { guion });
      expect(barato.response).not.toMatch(SIENTO);
      expect(barato.response).not.toMatch(/#SG-|inicia sesión|pronto/i);
      expect(barato.productos).toHaveLength(13);
    }
  });

  it('si el modelo pide addToCart y no hay pedido: "quiero pagar" va a pagar y "mi pedido llegó derretido" a queja', async () => {
    const guion = [pideHerramienta('addToCart', { productName: 'Mango Tropical' })];
    const pagar = await enviar('quiero pagar', { guion });
    expect(pagar.response).toMatch(/Continuar al Pago/);
    expect(pagar.response).not.toMatch(/no puse nada/i);
    const queja = await enviar('mi pedido llegó derretido', { guion });
    expect(queja.response).toMatch(SIENTO);
    expect(queja.response).not.toMatch(/no puse nada/i);
    expect(queja.action ?? null).toBeNull();
  });
});

describe('4. información, salud, rechazos y comparaciones', () => {
  it('"cayó mal", "dieta", "sienta mal" y "engorda" con un sabor: la ficha, sin oferta', async () => {
    for (const frase of ['el mango tropical me cayó mal', '¿el mango tropical sirve para mi dieta?', 'el mango tropical me sienta mal']) {
      const body = await enviar(frase);
      expect(body.response, frase).toContain('Esto dice la ficha de **Mango Tropical**');
      expect(body.response, frase).not.toMatch(/agr[eé]galo/i);
    }
  });
  it('"no me gusta el mango tropical": neutro, sin precio ni oferta', async () => {
    for (const guion of [[texto('x')], [tema('precio', 'Mango Tropical')], [errorGroq(500, 'x')]]) {
      const body = await enviar('no me gusta el mango tropical', { guion });
      expect(body.response).not.toMatch(/agr[eé]galo|cuesta/i);
      expect(intencion.botOfrecioAgregar(body.response)).toBe(false);
      expect(body.action ?? null).toBeNull();
    }
  });
  it('"mango o fresa cuál es mejor": no elige uno; pregunta o muestra las dos tarjetas', async () => {
    for (const guion of [[texto('x')], [tema('precio', 'Mango Tropical')], [tema('otro')], [errorGroq(500, 'x')]]) {
      const body = await enviar('mango o fresa cuál es mejor', { guion });
      expect(body.response).not.toMatch(/^\*\*[^*]+\*\* cuesta/);
      const ids = (body.productos || []).map((p) => p.id).sort();
      const pregunta = /cu[aá]l de estos/i.test(body.response) && body.response.includes('Mango Tropical') && body.response.includes('Fresa Salvaje');
      expect(pregunta || JSON.stringify(ids) === JSON.stringify([1, 3])).toBe(true);
    }
  });
});

describe('5. confirmación tras una alergia: solo "sí, agrégalo", "agrégalo" o "sí"', () => {
  const pedir = () => enviar('soy celíaco, dame una fresa');
  it.each([['sí, agrégalo'], ['Sí agrégalo!'], ['si agregalo'], ['agrégalo'], ['sí'], ['¡Sí!'], ['si']])('"%s" confirma', async (si) => {
    const { response } = await pedir();
    const body = await enviar(si, { history: [{ role: 'assistant', content: response }] });
    expect(body.action).toBe('addToCart');
    expect(body.product.id).toBe(1);
  });
  it.each([['ok'], ['dale'], ['si porfa'], ['listo'], ['claro'], ['sí, por favor']])('"%s" NO confirma ese caso', async (si) => {
    const { response } = await pedir();
    const body = await enviar(si, { history: [{ role: 'assistant', content: response }] });
    expect(body.action ?? null).toBeNull();
    expect(body.product ?? null).toBeNull();
  });
  it('"dale" y "ok" siguen valiendo tras una oferta normal de precio', async () => {
    const oferta = await enviar('cuánto cuesta la fresa salvaje');
    for (const si of ['dale', 'ok']) {
      expect((await enviar(si, { history: [{ role: 'assistant', content: oferta.response }] })).action, si).toBe('addToCart');
    }
  });
});

describe('6. nombres en tarjetas y carrito', () => {
  it('las tarjetas y el producto del carrito llevan el nombre limpio', async () => {
    productosBase = [{ ...CATALOGO_REAL[0], nombre: 'Fresa**`Salvaje`\n' }];
    const menu = await enviar('muéstrame el menú');
    expect(menu.productos[0].nombre).toBe('Fresa Salvaje');
    const pedido = await enviar('dame una fresa');
    expect(pedido.product.nombre).toBe('Fresa Salvaje');
  });
});

describe('7. reintento de tool_use_failed para un cliente', () => {
  it('reintenta UNA vez (con otra temperatura y las mismas herramientas) y responde el servidor', async () => {
    const body = await enviar('hmm a ver', { guion: [errorGroq(400, 'tool_use_failed'), tema('menu')] });
    expect(llamadasGroq).toHaveLength(2);
    expect(llamadasGroq[1].temperature).toBe(0.3);
    expect(llamadasGroq[1].tools).toEqual(llamadasGroq[0].tools);
    expect(body.response).toMatch(/estos son nuestros sabores/i);
  });
  it('si falla dos veces, solo 2 intentos y el mensaje seguro', async () => {
    const body = await enviar('hmm a ver', { guion: [errorGroq(400, 'tool_use_failed')] });
    expect(llamadasGroq).toHaveLength(2);
    expect(body.response).not.toMatch(/falla técnica|MENTIRA/i);
    expect(body.productos).toHaveLength(13);
  });
});

describe('8. defensa en profundidad: el ejecutor de herramientas del admin no corre sin admin', () => {
  it('sin admin, ninguna herramienta toca la base ni crea propuestas', async () => {
    cargarServidor(fake, { groq: async () => texto('x') });
    const { ejecutarHerramientasAdmin } = requireNode(resolve(aqui, '../../chatbot.js'));
    expect(ejecutarHerramientasAdmin).toBeTypeOf('function');
    const llamada = (name, args = {}) => ({ id: `c_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const messages = [];
    fake.reiniciar();
    const r = await ejecutarHerramientasAdmin(
      [llamada('deleteUser', { identifier: '50' }), llamada('getAllUsers'), llamada('getSalesSummary', { periodo: 'todo' })],
      { supabase: fake.client, isAdmin: false, userId: 7, message: 'borra', history: [], estadosCobrados: [], messages },
    );
    expect(fake.llamadas).toHaveLength(0);
    expect(r.propuesta).toBeNull();
    expect(r.actionData).toBeNull();
    expect(messages.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual(Array(3).fill(JSON.stringify({ error: 'Acceso denegado.' })));
  });
});

describe('9. variedad mínima y menú sin repetir', () => {
  const distintos = async (frases, guion) => new Set(await Promise.all(frases.map(async (f) => (await enviar(f, { guion })).response))).size;
  it('otro, contacto, pagar y ayuda tienen al menos 2 variantes', async () => {
    expect(await distintos(['xyz', 'ñam', 'blablá', 'qwerty', 'zzz', 'pfff'], [tema('otro')])).toBeGreaterThanOrEqual(2);
    expect(await distintos(['¿a qué hora abren?', '¿tienen domicilio?', '¿dónde quedan?', '¿cuál es el teléfono?', '¿hacen envíos?'], [tema('contacto')])).toBeGreaterThanOrEqual(2);
    expect(await distintos(['¿cómo pago?', 'quiero pagar', '¿dónde está el carrito?', 'cómo hago el pago', 'quiero ir al carrito'], [tema('pagar')])).toBeGreaterThanOrEqual(2);
    expect(await distintos(['necesito ayuda', 'ayúdame', '¿qué puedes hacer?', 'me puedes ayudar', 'quiero ayuda'], [tema('ayuda')])).toBeGreaterThanOrEqual(2);
  });
  it('"qué tal el mango tropical" no es un saludo', async () => {
    const body = await enviar('qué tal el mango tropical', { guion: [errorGroq(500, 'x')] });
    expect(body.response).not.toMatch(/hola|bienvenid|soy gelbot/i);
    expect(body.response).toContain('Mango Tropical');
  });
  it('fuera de tema repetido: el menú no se vuelve a mostrar', async () => {
    const primero = await enviar('asdfgh', { guion: [tema('otro')] });
    expect(primero.productos).toHaveLength(13);
    const segundo = await enviar('te amo', { guion: [tema('otro')], history: [{ role: 'user', content: 'asdfgh' }, { role: 'assistant', content: primero.response }] });
    expect(segundo.productos).toBeUndefined();
    expect(segundo.response).toMatch(/entend/i);
  });
});

describe('10. medios de pago', () => {
  it.each([['¿aceptan efectivo?'], ['¿puedo pagar con Daviplata?'], ['¿reciben tarjeta de crédito?'], ['¿se puede pagar contraentrega?']])('"%s"', async (frase) => {
    for (const guion of [[tema('pagar')], [errorGroq(500, 'x')]]) {
      const body = await enviar(frase, { guion });
      expect(body.response).toMatch(/se paga en línea con PSE, Nequi o Botón Bancolombia/);
      expect(body.response).not.toMatch(/aceptamos|recibimos|s[ií], (?:se )?puede/i);
    }
  });
});
