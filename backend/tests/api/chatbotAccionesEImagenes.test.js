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
  it.each([
    ['anónimo', () => ({}), ['addToCart', 'getProducts']],
    ['cliente', tokenCliente, ['addToCart', 'getOrders', 'getProducts']],
  ])('%s: la segunda llamada lleva SOLO sus herramientas permitidas y tool_choice "none"', async (_r, cabeceras, esperadas) => {
    guion = [pideHerramienta('getProducts'), texto('Estos son nuestros sabores.')];
    await chat({ message: 'qué sabores de helado tienen' }, cabeceras());
    expect(llamadasGroq).toHaveLength(2);
    expect(llamadasGroq[1].tool_choice).toBe('none');
    expect(nombres(llamadasGroq[1])).toEqual(esperadas);
    expect(nombres(llamadasGroq[1])).toEqual(nombres(llamadasGroq[0]));
    expect(llamadasGroq[1]).not.toHaveProperty('parallel_tool_calls');
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
    const res = await chat({ message: 'qué sabores tienen' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(2);
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
  });

  it('tool_use_failed en la primera llamada: se reintenta UNA vez y responde bien', async () => {
    guion = [errorGroq(400, 'tool_use_failed', { failed_generation: '<function=x>' }), texto('¡Hola! 🍦')];
    const res = await chat({ message: 'hola' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(2);
    expect(llamadasGroq[1].tools).toBeDefined();
    expect(res.body.response).toMatch(/Hola/);
  });

  it('tool_use_failed dos veces seguidas: solo 2 intentos y mensaje de falla', async () => {
    guion = [errorGroq(400, 'tool_use_failed'), errorGroq(400, 'tool_use_failed'), texto('no debería llegar')];
    const res = await chat({ message: 'hola' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(2);
    expect(res.body.response).toMatch(MENSAJE_FALLA);
  });

  it('otro error 400 (no tool_use_failed) no se reintenta', async () => {
    guion = [errorGroq(400, 'invalid_request_error'), texto('no debería llegar')];
    const res = await chat({ message: 'hola' }, tokenCliente());
    expect(llamadasGroq).toHaveLength(1);
    expect(res.body.response).toMatch(MENSAJE_FALLA);
  });
});
