// Gelbot, afinado (2026-11-25): al quitar nombres de herramientas de la respuesta no quedan restos
// (asteriscos, comillas o paréntesis vacíos, frases colgadas) y el markdown normal queda intacto.
// El modelo (Groq) y Supabase son FALSOS: estas pruebas nunca llaman a Groq de verdad.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

const requireNode = createRequire(import.meta.url);
const VACIA = /no logré armar una respuesta/i;
const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});
const cabecera = (id, rol) => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: id, email: 'alguien@example.com', rol })}` });

const fake = crearFakeSupabase();
let guion = [];
let llamadasGroq = [];
let app;
beforeEach(() => {
  guion = [];
  llamadasGroq = [];
  fake.reiniciar();
  fake.responder('usuario', 'select', { data: { id_usuario: 1, nombre: 'Ana', email: 'alguien@example.com', rol: 'admin' }, error: null });
  fake.responder('producto', 'select', { data: [{ id_producto: 1, nombre: 'Fresa', precio: 9000, imagen: '/images/f.png', estado: true }], error: null });
  ({ app } = cargarServidor(fake, {
    groq: async (p) => { llamadasGroq.push(JSON.parse(JSON.stringify(p))); return guion.shift() || texto('Listo.'); },
  }));
});

// Respuesta que ve la persona cuando el modelo escribe `contenido`. La limpieza (cleanText) solo se aplica al texto
// del modelo, que desde la opción A (2026-11-25) solo ve el admin: por eso se prueba como admin.
async function responder(contenido, cabeceras = cabecera(1, 'admin')) {
  guion = [texto(contenido)];
  return (await request(app).post('/api/chatbot').set(cabeceras).send({ message: 'hola' })).body.response;
}

describe('1. restos al quitar nombres de herramientas', () => {
  it.each([
    // lo visto en producción
    ['**¿Qué sabor te gustaría probar?** Puedes ver el menú completo con **getProducts**.', '**¿Qué sabor te gustaría probar?**'],
    ['¿Qué sabor quieres? Puedes ver el menú con **`getProducts`**.', '¿Qué sabor quieres?'],
    ['¿Qué sabor quieres? Puedes ver el menú con `getProducts`.', '¿Qué sabor quieres?'],
    ['¿Qué sabor quieres? Puedes ver el menú con "getProducts".', '¿Qué sabor quieres?'],
    ['¿Qué sabor quieres? Usa functions.getProducts para verlo.', '¿Qué sabor quieres?'],
    ['¡Hola! Puedo llamar a addToCart cuando quieras. ¿Te animas?', '¡Hola! ¿Te animas?'],
    ['**Usa getProducts. Elige tu sabor.**', '**Elige tu sabor.**'],
    ['Elige **tu sabor. Luego usa getProducts** ya. Gracias.', 'Elige **tu sabor.** Gracias.'],
    ['Tenemos fresa. Voy a usar functions.', 'Tenemos fresa.'],
    // la oración sigue teniendo sentido
    ['Tenemos fresa y mango (getProducts).', 'Tenemos fresa y mango.'],
    ['Tenemos fresa y mango (`getProducts`) hoy.', 'Tenemos fresa y mango hoy.'],
    ['Según getProducts, tenemos fresa y mango.', 'Tenemos fresa y mango.'],
    // nunca se pierde una cifra por quitar el nombre de la herramienta
    ['Según los datos de getSalesSummary, las ventas son **$15.000**.', 'Según los datos del sistema, las ventas son **$15.000**.'],
    // listas y títulos
    ['Opciones:\n• **Fresa**\n• getProducts\n• Mango', 'Opciones:\n• **Fresa**\n• Mango'],
    ['### getProducts\nTenemos fresa.', 'Tenemos fresa.'],
    // llamadas escritas como texto
    ['Tenemos fresa. addToCart{"productName":"Fresa"}', 'Tenemos fresa.'],
    ['Tenemos fresa. addToCart(productName="Fresa")', 'Tenemos fresa.'],
    ['Tenemos fresa.\n<function=addToCart>{"productName":"Fresa"}</function>', 'Tenemos fresa.'],
    // negrita vacía escrita por el modelo
    ['Hola **** amigo', 'Hola amigo'],
  ])('%j -> %j', async (modelo, esperado) => {
    expect(await responder(modelo)).toBe(esperado);
  });

  it.each([['getProducts'], ['**getProducts**'], ['Puedes ver el menú completo con **getProducts**.'], ['Usa getProducts. 🍦'], ['****']])(
    'si después de limpiar no queda nada (%j) -> mensaje amable', async (modelo) => {
      expect(await responder(modelo)).toMatch(VACIA);
    });

  it('con tarjetas, si la frase se queda vacía se usa el texto de los sabores', async () => {
    guion = [pideHerramienta('getProducts'), texto('Puedes ver el menú con **getProducts**.')];
    const { body } = await request(app).post('/api/chatbot').send({ message: 'muéstrame el menú' });
    expect(body.response).toMatch(/Estos son nuestros sabores/);
    expect(body.productos).toHaveLength(1);
  });
});

describe('1. palabras reales y markdown normal quedan intactos', () => {
  it.each([
    ['El empaque es funcional y tiene buen funcionamiento.'],
    ['Es un postre multifunctional, nada malfunctioning.'],
    ['**Fresa** **$9.000** y **Mango** **$8.500**'],
    ['### Título\n\n• **Fresa**: $9.000\n• **Mango**: $8.500\n\n1. Uno\n2. Dos'],
    ['- **Fresa** (nueva)\n- "Mango" (clásico)'],
    ['Usamos React, Node.js y Supabase.'],
  ])('%j no cambia', async (modelo) => {
    expect(await responder(modelo)).toBe(modelo);
  });

  it('el informe del admin con tabla y montos no cambia', async () => {
    const informe = '### Ventas del día\n\n| Cliente | Total |\n|---|---|\n| **Ana** | $15.000 |\n| Luis | $9.500 |\n\n• **Total:** $24.500 COP';
    expect(await responder(informe, cabecera(1, 'admin'))).toBe(informe);
  });

  it('en una tabla solo se quita el nombre de la herramienta, no la fila', async () => {
    const limpio = await responder('| Dato | Valor |\n|---|---|\n| getAllOrders | **3** |', cabecera(1, 'admin'));
    expect(limpio).toMatch(/\n\|\s*\|\s*\*\*3\*\* \|$/);
  });
});

describe('1. el prompt del cliente prohíbe nombrar herramientas', () => {
  it.each([['anónimo', () => ({})], ['cliente', () => cabecera(7, 'cliente')]])('%s', async (_r, cabeceras) => {
    await responder('Hola.', cabeceras());
    const sistema = llamadasGroq[0].messages[0].content;
    expect(sistema).toMatch(/NUNCA (escribas|nombres|menciones)[^\n]*(herramientas|funciones)/i);
    // el modelo repetía esta frase del prompt: "ver el menú completo con getProducts"
    expect(sistema).not.toMatch(/men[uú] completo usa getProducts/i);
  });
});

describe('1. la limpieza es rápida con textos raros', () => {
  it.each([
    ['asteriscos', '*'.repeat(4000)], ['llaves', '{'.repeat(4000)], ['paréntesis', '('.repeat(4000)], ['puntos', '. '.repeat(2000)],
    ['herramientas', 'getProducts '.repeat(400)], ['herramientas con (', 'getProducts('.repeat(400)], ['functions.', 'functions.'.repeat(400)],
    ['<function', '<function'.repeat(450)], ['comillas', '"getProducts'.repeat(300)], ['espacios', `a${' '.repeat(4000)}getProducts`],
    ['acentos graves', '`'.repeat(4000)], ['cierres', '.**"'.repeat(1000)], ['<think>', '<think>'.repeat(600)],
    ['negritas con herramienta', '**getProducts. '.repeat(260)],
  ])('%s: menos de 250 ms', (_n, entrada) => {
    let modulo = {};
    try { modulo = requireNode('../../gelbot/gelbotTexto.js'); } catch { /* aún no existe */ }
    expect(modulo.cleanText, 'gelbotTexto.js exporta cleanText').toBeTypeOf('function');
    const inicio = performance.now();
    modulo.cleanText(entrada);
    expect(performance.now() - inicio).toBeLessThan(250);
  });
});
