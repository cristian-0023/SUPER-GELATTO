// Gelbot, afinado (2026-11-25): qué mensajes agregan al carrito, cuál producto y cuántos.
// Todas las frases pasan por el handler REAL con un modelo TRAMPOSO: siempre pide addToCart del sabor
// indicado, así se prueba también la defensa del servidor (no solo los atajos).
// El modelo (Groq) y Supabase son FALSOS: estas pruebas nunca llaman a Groq de verdad.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

const intencion = createRequire(import.meta.url)('../../gelbotIntencion.js');
const USUARIO = { id_usuario: 7, nombre: 'Carlos Cliente', email: 'carlos@example.com', rol: 'cliente' };
const tokenCliente = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 7, email: USUARIO.email, rol: 'cliente' })}` });

const producto = (id, nombre, precio = 9000) => ({ id_producto: id, nombre, precio, imagen: `/images/${id}.png`, estado: true });
const FRESA = producto(1, 'Fresa');
const MANGO = producto(2, 'Mango', 8500);
const VAINILLA = producto(3, 'Vainilla', 7000);
const FRESA_SALVAJE = producto(4, 'Fresa Salvaje', 9500);
const FRESA_CREMA = producto(5, 'Fresa con crema', 9800);
const CHOCO = producto(6, 'Chocolate Belga', 12000);
const FRESA_MANGO = producto(7, 'Fresa con Mango', 9900);
const CATALOGO = [FRESA, MANGO, VAINILLA, CHOCO];

const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const fake = crearFakeSupabase();
let llamadasGroq = [];
let guion = [];
let productosBase = CATALOGO;
beforeEach(() => {
  llamadasGroq = [];
  guion = [];
  productosBase = CATALOGO;
  fake.reiniciar();
  fake.responder('usuario', 'select', { data: USUARIO, error: null });
  fake.responder('producto', 'select', () => ({ data: productosBase, error: null }));
});

const CUAL = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: '¡Claro! ¿Cuál sabor quieres? 🍦' }];
const OFERTA = [{ role: 'user', content: 'cuánto cuesta la fresa' }, { role: 'assistant', content: '**Fresa** cuesta **$9.000**. Si lo quieres, dime "agrégalo" y lo pongo en tu carrito 🍦' }];
const HISTORIALES = [['sin historial', []], ['tras una oferta', OFERTA], ['tras "¿cuál sabor quieres?"', CUAL]];

async function enviar(message, { history = [], tramposo = 'Fresa', catalogo = CATALOGO, cabeceras = tokenCliente() } = {}) {
  productosBase = catalogo;
  // Servidor nuevo en cada mensaje: la caché de productos de chatbot.js vive en el módulo.
  const { app } = cargarServidor(fake, { groq: async (p) => { llamadasGroq.push(p); return guion.shift() || texto('Listo.'); } });
  guion = [pideHerramienta('addToCart', { productName: tramposo }), texto('Ok.')];
  return (await request(app).post('/api/chatbot').set(cabeceras).send({ message, history })).body;
}
function esperaAgregado(body, id, cantidad) {
  expect(body.action).toBe('addToCart');
  expect(body.product.id).toBe(id);
  expect(body.quantity).toBe(cantidad);
}
function esperaSinAgregar(body) {
  expect(body.action ?? null).not.toBe('addToCart');
  expect(body.product ?? null).toBeNull();
  expect(body.quantity).toBeUndefined();
}

describe('4. el nombre exacto gana', () => {
  const FRESAS = [FRESA, FRESA_SALVAJE, FRESA_CREMA];
  it.each([
    ['agrégame una fresa', 1, 1],
    ['agrégame dos fresas', 1, 2],
    ['agrégame una fresa salvaje', 4, 1],
    ['agrégame tres fresas salvajes', 4, 3],
    ['quiero una fresa con crema', 5, 1],
  ])('atajo de compra: "%s" -> producto %i', async (mensaje, id, cantidad) => {
    esperaAgregado(await enviar(mensaje, { catalogo: FRESAS }), id, cantidad);
    esperaAgregado(await enviar(mensaje, { catalogo: [...FRESAS].reverse() }), id, cantidad);
    expect(llamadasGroq).toHaveLength(0);
  });

  it.each([['cuánto cuesta la fresa', 'Fresa', '$9.000'], ['cuánto cuesta la fresa salvaje', 'Fresa Salvaje', '$9.500'], ['precio de la fresa con crema', 'Fresa con crema', '$9.800']])(
    'atajo de precio: "%s" -> %s', async (mensaje, nombre, precio) => {
      const body = await enviar(mensaje, { catalogo: FRESAS });
      expect(body.response).toContain(`**${nombre}** cuesta **${precio}**`);
      expect(llamadasGroq).toHaveLength(0);
    });

  it.each([['Fresa', 1], ['fresa salvaje', 4], ['Fresa con crema', 5]])('addToCart del modelo: "%s" -> producto %i', async (nombre, id) => {
    esperaAgregado(await enviar('quiero el rojito de frutas', { catalogo: FRESAS, tramposo: nombre }), id, 1);
  });

  it('"sí" después de la oferta de Fresa -> Fresa (no pregunta por las otras)', async () => {
    esperaAgregado(await enviar('sí', { catalogo: FRESAS, history: OFERTA }), 1, 1);
  });

  it('"sí" cuando el bot nombró Fresa y Fresa Salvaje -> pregunta cuál', async () => {
    const history = [{ role: 'assistant', content: '¿Cuál de estos quieres? **Fresa Salvaje**, **Fresa** 🍦' }];
    const body = await enviar('sí', { catalogo: FRESAS, history });
    esperaSinAgregar(body);
    expect(body.response).toMatch(/cu[aá]l/i);
  });

  it.each([
    ['sin nombre exacto', 'agrégame una fresa', [FRESA_SALVAJE, FRESA_CREMA]],
    ['dos con el mismo nombre', 'agrégame una fresa', [FRESA, producto(9, ' FRESÁ ', 5000), FRESA_SALVAJE]],
    ['dos nombres exactos', 'agrégame una fresa y un mango', [FRESA, MANGO, FRESA_MANGO]],
    ['exacto más otro sabor a medias', 'agrégame una fresa y un mango', [FRESA, producto(8, 'Mango Biche')]],
    ['palabra extra que apunta a otro', 'agrégame una fresa crema', FRESAS],
  ])('pregunta cuál: %s', async (_c, mensaje, catalogo) => {
    const body = await enviar(mensaje, { catalogo });
    esperaSinAgregar(body);
    expect(body.response).toMatch(/cu[aá]l/i);
  });

  it('dos con el mismo nombre: también pregunta en el precio y en el addToCart del modelo', async () => {
    const catalogo = [FRESA, producto(9, 'fresa', 5000)];
    expect((await enviar('cuánto cuesta la fresa', { catalogo })).response).toMatch(/cu[aá]l/i);
    const body = await enviar('quiero el rojito de frutas', { catalogo, tramposo: 'Fresa' });
    esperaSinAgregar(body);
    expect(body.response).toMatch(/cu[aá]l/i);
  });

  it('un nombre hecho solo de palabras genéricas no gana ("Helado" no tapa a Fresa Salvaje)', async () => {
    esperaAgregado(await enviar('dame un helado de fresa', { catalogo: [producto(9, 'Helado'), FRESA_SALVAJE] }), 4, 1);
  });
});

describe('2. la negación solo bloquea si afecta al pedido', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it.each([
      ['no quiero fresa'], ['No quiero fresa'], ['no me agregues la fresa'], ['no agregues nada'], ['ya no quiero la fresa'],
      ['tampoco quiero mango'], ['nunca pedí fresa'], ['quita la fresa'], ['elimina la fresa del carrito'], ['cancela el pedido'],
      ['no, gracias'], ['mejor no'], ['no'],
      // el pedido se arrepiente al final, o la negación viene de otras palabras
      ['dame una fresa, mejor no'], ['quiero una fresa, no, espera'], ['dame una fresa no de mango'],
      ['no sé si quiero fresa'], ['no quiero que, por favor, agregues la fresa'], ['deja de agregar fresa'], ['olvida la fresa'],
      ['ni loco quiero fresa'], ['jamás dame fresa'], ['en vez de fresa dame otra cosa'], ['cámbiame la fresa'],
      ['si no hay mango, dame una fresa'], ['nada de fresa'], ['no llegó, quiero reclamar por la fresa'],
      ['no me gustó, quiero la devolución de la fresa'], ['quiero que no me agregues fresa'], ['¿por qué no me agregaste la fresa?'],
      ['quiero una fresa, ya no importa'], ['no quiero fresa pero tampoco mango'],
      // "sin" + sabor
      ['sin fresa'], ['un helado sin fresa'], ['dame un helado sin fresa'], ['quiero algo sin fresa ni mango'], ['dame un helado sin una fresa por favor'],
    ])('"%s" NO agrega (aunque el modelo lo pida)', async (mensaje) => {
      for (const tramposo of ['Fresa', 'Mango']) {
        const body = await enviar(mensaje, { history, tramposo });
        esperaSinAgregar(body);
        // la respuesta no vuelve a ofrecer lo rechazado (un "ok" después lo agregaría)
        expect(body.response).not.toMatch(/agr[eé]galo/i);
      }
    });

    it.each([
      ['no sé, dame una fresa', 1, 1],
      ['no, mejor dame una de mango', 2, 1],
      ['no mucho, ponme una de vainilla', 3, 1],
      ['¿por qué no me das una fresa?', 1, 1],
      ['quiero una fresa, no importa el tamaño', 1, 1],
      ['dame una fresa sin azúcar', 1, 1],
      ['quiero una fresa sin crema', 1, 1],
      ['dame dos mangos sin azúcar ni crema', 2, 2],
      ['dame un mango sin fresa', 2, 1],
      // pedido corregido
      ['no quiero fresa, quiero mango', 2, 1],
      ['quita la fresa y dame mango', 2, 1],
      ['no quiero dos fresas, quiero un mango', 2, 1],
      ['no me des tres fresas; dame dos de mango', 2, 2],
      ['ya no quiero la fresa pero dame una vainilla porfa', 3, 1],
      ['agrégame una fresa nada más', 1, 1],
    ])('"%s" agrega el producto %i x%i', async (mensaje, id, cantidad) => {
      for (const tramposo of ['Fresa', 'Chocolate Belga']) {
        esperaAgregado(await enviar(mensaje, { history, tramposo }), id, cantidad);
      }
    });
  });

  it.each([
    ['contradictorio', 'no quiero fresa, dame una fresa'],
    ['dos sabores', 'no quiero fresa, dame mango y vainilla'],
    ['rechaza y pide algo que no está en el catálogo', 'no quiero fresa, dame el rojito de frutas'],
  ])('ante la duda no agrega y pregunta: %s', async (_c, mensaje) => {
    const body = await enviar(mensaje);
    esperaSinAgregar(body);
    expect(body.response).toMatch(/cu[aá]l/i);
  });

  it('lo rechazado es amplio: "no quiero fresa, dame mango" nunca agrega "Fresa con Mango"', async () => {
    const body = await enviar('no quiero fresa, dame mango', { catalogo: [FRESA_MANGO, FRESA], tramposo: 'Fresa con Mango' });
    esperaSinAgregar(body);
    expect(body.response).toMatch(/cu[aá]l/i);
  });

  it('"sin crema" descarta "Fresa con crema", aunque sea la única fresa', async () => {
    esperaAgregado(await enviar('quiero una fresa sin crema', { catalogo: [FRESA_CREMA, FRESA_SALVAJE] }), 4, 1);
    esperaSinAgregar(await enviar('quiero una fresa sin crema', { catalogo: [FRESA_CREMA], tramposo: 'Fresa con crema' }));
  });

  it('un producto que se llama "... sin ..." se puede pedir por su nombre', async () => {
    const catalogo = [FRESA, producto(9, 'Vainilla sin azúcar'), VAINILLA];
    esperaAgregado(await enviar('dame una vainilla sin azúcar', { catalogo }), 9, 1);
    esperaAgregado(await enviar('dame una vainilla', { catalogo }), 3, 1);
    esperaAgregado(await enviar('dame una fresa sin azúcar', { catalogo }), 1, 1);
  });

  it('si el modelo intenta agregar lo rechazado, se responde sin ofrecerlo', async () => {
    const body = await enviar('no quiero fresa');
    expect(body.response).toMatch(/no puse nada/i);
    expect(body.response).not.toContain('Fresa');
  });
});

describe('3. pedido sin verbo (cantidad + sabor, o sabor + por favor)', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it.each([
      ['una de fresa por favor', 1, 1],
      ['una fresa por favor', 1, 1],
      ['dos de mango porfa', 2, 2],
      ['media docena de vainilla', 3, 6],
      ['2 de fresa', 1, 2],
      ['una fresa', 1, 1],
      ['fresa por favor', 1, 1],
      ['hola, dos fresas porfis', 1, 2],
      ['un chocolate belga, gracias', 6, 1],
      ['una fresa sin azúcar por favor', 1, 1],
      ['50 de mango', 2, 10],
    ])('"%s" agrega el producto %i x%i', async (mensaje, id, cantidad) => {
      esperaAgregado(await enviar(mensaje, { history, tramposo: 'Vainilla' }), id, cantidad);
      expect(llamadasGroq).toHaveLength(0);
    });

    it.each([
      ['¿una fresa cuánto vale?'], ['una pregunta'], ['una duda sobre la fresa'], ['¿tienen una de fresa?'], ['dos preguntas'], ['a las 2 abren?'],
      ['¿una de fresa?'], ['una fresa es muy rica'], ['gracias por una fresa'], ['ayer comí dos fresas'], ['una fresa engorda'], ['la fresa es la número 1'],
      ['info de la fresa por favor'], ['cuéntame de la fresa por favor'], ['fresa 9000'],
      ['sin fresa por favor'], ['un helado sin fresa por favor'], ['una fresa no por favor'],
    ])('"%s" NO agrega (aunque el modelo lo pida)', async (mensaje) => {
      for (const tramposo of ['Fresa', 'Mango']) esperaSinAgregar(await enviar(mensaje, { history, tramposo }));
    });
  });

  it.each([['sin historial', []], ['tras una oferta', OFERTA]])('"fresa" solo, %s, NO agrega', async (_h, history) => {
    esperaSinAgregar(await enviar('fresa', { history }));
    esperaSinAgregar(await enviar('la fresa', { history }));
  });

  it.each([
    ['sin nombre exacto', 'una fresa', [FRESA_SALVAJE, FRESA_CREMA]],
    ['mismo nombre', 'una fresa por favor', [FRESA, producto(9, 'FRESA')]],
    ['dos sabores', 'una de fresa y dos de mango por favor', CATALOGO],
    ['dos cantidades para un sabor combinado', 'una de fresa y dos de mango', [FRESA_MANGO]],
  ])('pregunta cuál: %s', async (_c, mensaje, catalogo) => {
    const body = await enviar(mensaje, { catalogo });
    esperaSinAgregar(body);
    expect(body.response).toMatch(/cu[aá]l/i);
  });
});

describe('5. después de "¿cuál?" solo vale un sabor o una afirmación', () => {
  it.each([
    ['cuéntame de la fresa'], ['cuéntame de la fresa por favor'], ['háblame de la fresa'], ['la fresa es rica'], ['me gusta la fresa'], ['¿fresa?'],
    ['y la fresa qué tal'], ['la fresa engorda'], ['el rojito de frutas'], ['mi mamá es alérgica a la fresa'], ['ayer me dieron fresa'],
    ['gracias'], ['hola'], ['ok'], ['sí'],
  ])('"%s" NO agrega (aunque el modelo lo pida)', async (mensaje) => {
    for (const tramposo of ['Fresa', 'Mango']) esperaSinAgregar(await enviar(mensaje, { history: CUAL, tramposo }));
  });

  it.each([
    ['fresa', 1, 1], ['la fresa', 1, 1], ['la de fresa', 1, 1], ['Fresa!', 1, 1], ['sí, fresa', 1, 1], ['mejor mango', 2, 1], ['dos de mango', 2, 2],
    ['una de fresa por favor', 1, 1], ['el chocolate belga', 6, 1], ['belga', 6, 1], ['helado de vainilla', 3, 1], ['fresa sin azúcar', 1, 1],
  ])('"%s" agrega el producto %i x%i', async (mensaje, id, cantidad) => {
    esperaAgregado(await enviar(mensaje, { history: CUAL, tramposo: 'Vainilla' }), id, cantidad);
  });

  it('se puede elegir por el nombre completo un sabor que lleva "sin"', async () => {
    const catalogo = [FRESA, VAINILLA, producto(9, 'Vainilla sin azúcar')];
    esperaAgregado(await enviar('vainilla sin azúcar', { history: CUAL, catalogo }), 9, 1);
    esperaAgregado(await enviar('vainilla', { history: CUAL, catalogo }), 3, 1);
  });

  it('entre las opciones que dio el bot, basta la palabra que las distingue', async () => {
    const history = [{ role: 'assistant', content: '¿Cuál de estos quieres? **Fresa Salvaje**, **Fresa con crema** 🍦' }];
    esperaAgregado(await enviar('la salvaje', { history, catalogo: [FRESA_SALVAJE, FRESA_CREMA] }), 4, 1);
    esperaSinAgregar(await enviar('la segunda', { history, catalogo: [FRESA_SALVAJE, FRESA_CREMA], tramposo: 'Fresa con crema' }));
  });
});

describe('seguridad y velocidad', () => {
  it('las defensas no dependen del rol que diga el cuerpo: un visitante tampoco agrega lo rechazado', async () => {
    esperaSinAgregar(await enviar('no quiero fresa', { cabeceras: {} }));
    esperaAgregado(await enviar('no quiero fresa, quiero mango', { cabeceras: {} }), 2, 1);
  });

  // 1000 caracteres es el límite real del mensaje.
  const MIL = (t) => t.repeat(Math.ceil(1000 / t.length)).slice(0, 1000);
  const GRANDE = Array.from({ length: 200 }, (_, i) => producto(i + 1, `Sabor especial sin azúcar número ${i} fresa con mango`));
  it.each([
    ['no '], ['por que no '], ['sin '], ['no importa '], ['si '], ['dale '], ['ok'], ['una de '], ['fresa '], ['y dame '], [' y '], [','], ['!'], [' '], ['\n'],
    ['a'], ['é'], ['si no es mucha '], ['nada '], ['media docena '], ['agreg'], ['anad'], ['quit'], ['9'], ['9 '], ['- '], ['…'], ['sin azúcar y '],
    ['por favor '], ['sí, dale ok '], ['sabor especial sin '], ['me da '], ['cual '],
  ])('mensaje de 1000 caracteres con %j: menos de 150 ms', (trozo) => {
    const mensaje = MIL(trozo);
    for (const f of ['analizarMensaje', 'resolverPedido', 'tieneIntencionDeCompra', 'esConsulta', 'preguntaPrecio', 'esAfirmacion', 'botOfrecioAgregar', 'botPreguntoCual', 'leerCantidad', 'buscarProductos']) {
      let mejor = Infinity; // el mejor de 3: con la máquina ocupada una sola medida no sirve
      for (let i = 0; i < 3; i++) {
        const inicio = performance.now();
        intencion[f](mensaje, GRANDE, { trasCual: true });
        mejor = Math.min(mejor, performance.now() - inicio);
      }
      expect(mejor, f).toBeLessThan(150);
    }
  });
});

describe('4. los números del nombre no son la cantidad', () => {
  const LECHES = producto(10, 'Tres Leches');
  it.each([
    ['dame una tres leches', 1], ['quiero tres leches', 1], ['tres leches por favor', 1], ['dame dos tres leches', 2], ['dos de tres leches', 2],
  ])('"%s" -> Tres Leches x%i', async (mensaje, cantidad) => {
    esperaAgregado(await enviar(mensaje, { catalogo: [FRESA, LECHES] }), 10, cantidad);
  });

  it('el addToCart del modelo tampoco lee la cantidad del nombre', async () => {
    const body = await enviar('quiero el de la abuela', { catalogo: [FRESA, LECHES], tramposo: 'Tres Leches' });
    esperaAgregado(body, 10, 1);
  });
});

describe('2. otras formas de decir que no', () => {
  it.each([['nooo quiero fresa'], ['noo la quiero, la fresa'], ['nop quiero fresa'], ['nah quiero fresa pues'], ['nel quiero una fresa']])('"%s" NO agrega', async (mensaje) => {
    esperaSinAgregar(await enviar(mensaje));
    esperaSinAgregar(await enviar(mensaje, { history: CUAL }));
  });

  it('"nooo, dame mango" sí agrega el mango', async () => {
    esperaAgregado(await enviar('nooo, dame mango'), 2, 1);
  });
});

describe('el modelo no puede cambiar el sabor que nombró el cliente', () => {
  it.each([['agrégame una fresa, ¿cuánto vale?'], ['ayer compramos fresa, ¿hay mango?']])('"%s" con addToCart(Mango) NO agrega', async (mensaje) => {
    esperaSinAgregar(await enviar(mensaje, { tramposo: 'Mango' }));
  });

  it('si el sabor es el que nombró, sí se agrega', async () => {
    esperaAgregado(await enviar('agrégame una fresa, ¿cuánto vale?', { tramposo: 'Fresa' }), 1, 1);
  });
});

// Tabla de aceptación: todas las frases pedidas, por el handler real y con el modelo tramposo.
describe('tabla de aceptación', () => {
  const NO = null;
  const FRESAS = [FRESA, FRESA_SALVAJE, FRESA_CREMA];
  const PARECIDAS = [FRESA_SALVAJE, FRESA_CREMA];
  const REPETIDAS = [FRESA, producto(9, 'fresa')];
  it.each([
    // frase, historial, catálogo, producto (NO = no agrega), cantidad
    ['Agrégame dos de fresa', [], CATALOGO, 1, 2],
    ['quiero una fresa', [], CATALOGO, 1, 1],
    ['no quiero fresa', [], CATALOGO, NO],
    ['no me agregues la fresa', [], CATALOGO, NO],
    ['no agregues nada', [], CATALOGO, NO],
    ['ya no quiero la fresa', [], CATALOGO, NO],
    ['tampoco quiero mango', [], CATALOGO, NO],
    ['nunca pedí fresa', [], CATALOGO, NO],
    ['quita la fresa', [], CATALOGO, NO],
    ['elimina la fresa del carrito', [], CATALOGO, NO],
    ['cancela el pedido', [], CATALOGO, NO],
    ['no, gracias', [], CATALOGO, NO],
    ['mejor no', OFERTA, CATALOGO, NO],
    ['no', OFERTA, CATALOGO, NO],
    ['no sé, dame una fresa', [], CATALOGO, 1, 1],
    ['no, mejor dame una de mango', [], CATALOGO, 2, 1],
    ['no mucho, ponme una de vainilla', [], CATALOGO, 3, 1],
    ['¿por qué no me das una fresa?', [], CATALOGO, 1, 1],
    ['quiero una fresa, no importa el tamaño', [], CATALOGO, 1, 1],
    ['dame una fresa sin azúcar', [], CATALOGO, 1, 1],
    ['quiero una fresa sin crema', [], CATALOGO, 1, 1],
    ['sin fresa', [], CATALOGO, NO],
    ['un helado sin fresa', [], CATALOGO, NO],
    ['no quiero fresa, quiero mango', [], CATALOGO, 2, 1],
    ['quita la fresa y dame mango', [], CATALOGO, 2, 1],
    ['una de fresa por favor', [], CATALOGO, 1, 1],
    ['una fresa por favor', [], CATALOGO, 1, 1],
    ['dos de mango porfa', [], CATALOGO, 2, 2],
    ['media docena de vainilla', [], CATALOGO, 3, 6],
    ['2 de fresa', [], CATALOGO, 1, 2],
    ['fresa', [], CATALOGO, NO],
    ['¿una fresa cuánto vale?', [], CATALOGO, NO],
    ['una pregunta', [], CATALOGO, NO],
    ['una duda sobre la fresa', [], CATALOGO, NO],
    ['¿tienen una de fresa?', [], CATALOGO, NO],
    ['dos preguntas', [], CATALOGO, NO],
    ['a las 2 abren?', [], CATALOGO, NO],
    ['agrégame una fresa', [], FRESAS, 1, 1],
    ['agrégame una fresa salvaje', [], FRESAS, 4, 1],
    ['una fresa', [], PARECIDAS, NO],
    ['una fresa', [], REPETIDAS, NO],
    ['cuéntame de la fresa', CUAL, CATALOGO, NO],
    ['fresa', CUAL, CATALOGO, 1, 1],
  ])('"%s"', async (frase, history, catalogo, id, cantidad) => {
    for (const tramposo of ['Fresa', 'Mango', 'Chocolate Belga']) {
      const body = await enviar(frase, { history, catalogo, tramposo });
      if (id === NO) esperaSinAgregar(body);
      else esperaAgregado(body, id, cantidad);
    }
  });
});

// Segunda ronda de aceptación: frases de la revisión de código. [frase, producto o null si no agrega, cantidad]
async function comprobarFrase(frase, id, cantidad, history) {
  for (const tramposo of ['Fresa', 'Mango', 'Chocolate Belga']) {
    const body = await enviar(frase, { history, tramposo });
    if (id === null) {
      esperaSinAgregar(body);
    } else esperaAgregado(body, id, cantidad);
  }
}

describe('aceptación 2: compras contadas, en futuro o de otra persona', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it.each([
      ['ayer compramos fresa'], ['compramos mango ayer y estaba dañado'], ['mi esposo compró mango'], ['mi esposo compro mango'],
      ['voy a comprar mango mañana'], ['comprar mango es caro?'], ['cuando compré fresa estaba rica'], ['cuando compre fresa estaba rica'],
      ['ayer me compraron un mango'], ['me regalaron una fresa'], ['ayer agregué una fresa'], ['ya agregaste la fresa'], ['mi hija pide mango'],
      ['mañana compraré una fresa'], ['siempre compro fresa aquí'], ['para qué sirve la fresa'], ['ella se llevó un mango'], ['mi tía me llevó mango'],
    ])('"%s" NO agrega', (frase) => comprobarFrase(frase, null, 0, history));

    it.each([
      ['compro una fresa', 1, 1], ['cómprame una fresa', 1, 1], ['quiero comprar una fresa', 1, 1], ['te compro dos de mango', 2, 2],
      ['me llevo una fresa', 1, 1], ['hoy compro un mango', 2, 1], ['Hola, te compro una fresa', 1, 1],
    ])('"%s" agrega el producto %i x%i', (frase, id, cantidad) => comprobarFrase(frase, id, cantidad, history));
  });
});

describe('aceptación 2: "llevo" suelto', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it('"llevo una hora esperando mi mango" NO agrega', () => comprobarFrase('llevo una hora esperando mi mango', null, 0, history));
    it('"me llevo un mango" agrega', () => comprobarFrase('me llevo un mango', 2, 1, history));
  });

  it.each([['lo llevo'], ['me la llevo'], ['Sí, me lo llevo']])('"%s" tras la oferta agrega lo ofrecido', (frase) => comprobarFrase(frase, 1, 1, OFERTA));
  it('"lo llevo" sin oferta NO agrega', () => comprobarFrase('lo llevo', null, 0, []));
});

describe('aceptación 2: quejas y reclamos', () => {
  describe.each(HISTORIALES)('%s', (_h, history) => {
    it.each([
      ['quiero reclamar por el mango'], ['tengo un problema con el mango'], ['pedí fresa y no llegó'], ['pedí mango hace una hora'],
      ['mi mango llegó derretido'], ['soy alérgico a la fresa'], ['quiero quejarme del mango'], ['necesito ayuda con el mango'],
      ['quiero hablar del mango'], ['quisiera hacer una pregunta de la fresa'], ['pedí mango y quiero mi plata del mango'],
      ['pedí mango, quiero que me traigan el mango'], ['compré mango, quiero el reembolso del mango'], ['dame una fresa como la que compré ayer'],
    ])('"%s" NO agrega', (frase) => comprobarFrase(frase, null, 0, history));

    it.each([
      ['ya, dame una fresa', 1, 1], ['dame el de mango', 2, 1], ['quiero el mango', 2, 1], ['antes de irme dame una fresa', 1, 1],
      ['ayer compré fresa y me encantó, dame otra fresa', 1, 1], ['compré mango ayer, dame dos de vainilla', 3, 2],
      ['quiero probar el mango', 2, 1], ['quiero pedir una fresa', 1, 1],
    ])('"%s" agrega el producto %i x%i', (frase, id, cantidad) => comprobarFrase(frase, id, cantidad, history));
  });

  it('si el modelo intenta agregar en una queja, la respuesta no ofrece el producto', async () => {
    for (const frase of ['quiero reclamar por el mango', 'pedí mango hace una hora', 'ayer compramos fresa']) {
      const { response } = await enviar(frase, { tramposo: 'Mango' });
      expect(response).toMatch(/no puse nada/i);
      expect(response).not.toMatch(/agr[eé]galo|cuesta/i);
    }
  });
});
