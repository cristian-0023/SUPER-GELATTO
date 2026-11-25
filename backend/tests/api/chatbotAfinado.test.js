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
let app;
beforeEach(() => {
  llamadasGroq = [];
  guion = [];
  productosBase = CATALOGO;
  fake.reiniciar();
  fake.responder('usuario', 'select', { data: USUARIO, error: null });
  fake.responder('producto', 'select', () => ({ data: productosBase, error: null }));
  ({ app } = cargarServidor(fake, { groq: async (p) => { llamadasGroq.push(p); return guion.shift() || texto('Listo.'); } }));
});

const CUAL = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: '¡Claro! ¿Cuál sabor quieres? 🍦' }];
const OFERTA = [{ role: 'user', content: 'cuánto cuesta la fresa' }, { role: 'assistant', content: '**Fresa** cuesta **$9.000**. Si lo quieres, dime "agrégalo" y lo pongo en tu carrito 🍦' }];
const HISTORIALES = [['sin historial', []], ['tras una oferta', OFERTA], ['tras "¿cuál sabor quieres?"', CUAL]];

async function enviar(message, { history = [], tramposo = 'Fresa', catalogo = CATALOGO, cabeceras = tokenCliente() } = {}) {
  productosBase = catalogo;
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
