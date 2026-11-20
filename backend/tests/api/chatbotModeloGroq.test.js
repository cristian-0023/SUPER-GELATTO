// Gelbot y el modelo de Groq: modelo configurable (GROQ_MODEL, por defecto openai/gpt-oss-20b, porque
// Groq retiró llama-3.1-8b-instant), compatibilidad con gpt-oss (una herramienta por turno, campo
// `reasoning`) y diagnóstico claro de fallas sin filtrar detalles al cliente.
// El modelo (Groq) y Supabase son FALSOS: estas pruebas nunca llaman a Groq de verdad.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

// Errores REALES de groq-sdk (el subpath groq-sdk/error no se reemplaza por el falso).
const { APIError } = createRequire(import.meta.url)('groq-sdk/error');
const errorGroq = (status, code, message = 'error de prueba') =>
  APIError.generate(status, { error: { message, type: 'invalid_request_error', code } }, undefined, new Headers());

const MODELO_POR_DEFECTO = 'openai/gpt-oss-20b';
const LLAVE_FALSA = 'groq-llave-falsa-de-prueba';
const MENSAJE_PRIVADO = 'cuanto vendimos hoy dato-privado-del-usuario-9137';

const ADMIN = { id_usuario: 1, nombre: 'Ana Admin', email: 'ana.admin@example.com', rol: 'admin' };
const tokenAdmin = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 1, email: ADMIN.email, rol: 'admin' })}` });

const texto = (content, extra = {}) => ({ choices: [{ message: { role: 'assistant', content, ...extra } }] });
const pideHerramienta = (name, args = {}, extra = {}) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }], ...extra } }],
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

function prepararFake() {
  fake.reiniciar();
  fake.responder('usuario', 'select', { data: ADMIN, error: null });
  fake.responder('producto', 'select', { data: [{ id_producto: 1, nombre: 'Fresa', precio: 5000, estado: true }], error: null });
}

const errores = () => vi.mocked(console.error).mock.calls;
const todoElLog = () => ['log', 'warn', 'error']
  .flatMap((n) => vi.mocked(console[n]).mock.calls)
  .map((args) => args.map((a) => (typeof a === 'string' ? a : (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)))).join(' '))
  .join('\n');

function servidor(opciones = {}) {
  const { app } = cargarServidor(fake, { groq: groqFalso, ...opciones });
  return (cuerpo, cabeceras = tokenAdmin()) => request(app).post('/api/chatbot').set(cabeceras).send(cuerpo);
}

beforeEach(() => {
  llamadasGroq = [];
  guion = [];
  prepararFake();
});

describe('modelo configurable con GROQ_MODEL', () => {
  it('sin GROQ_MODEL, las dos llamadas usan openai/gpt-oss-20b', async () => {
    const chat = servidor();
    guion = [pideHerramienta('getProducts'), texto('Tenemos Fresa.')];
    await chat({ message: 'qué productos hay' });
    expect(llamadasGroq).toHaveLength(2);
    expect(llamadasGroq[0].model).toBe(MODELO_POR_DEFECTO);
    expect(llamadasGroq[1].model).toBe(MODELO_POR_DEFECTO);
  });

  it('con GROQ_MODEL, las dos llamadas usan ese modelo', async () => {
    const chat = servidor({ groqModel: 'llama-3.3-70b-versatile' });
    guion = [pideHerramienta('getProducts'), texto('Tenemos Fresa.')];
    await chat({ message: 'qué productos hay' });
    expect(llamadasGroq.map((l) => l.model)).toEqual(['llama-3.3-70b-versatile', 'llama-3.3-70b-versatile']);
  });

  it.each([
    ['con espacios y símbolos', 'modelo raro; rm -rf /'],
    ['demasiado largo', 'a'.repeat(200)],
    ['solo espacios', '   '],
  ])('un GROQ_MODEL inválido (%s) se ignora y se usa el modelo por defecto', async (_caso, valor) => {
    const chat = servidor({ groqModel: valor });
    guion = [texto('Hola.')];
    await chat({ message: 'hola' });
    expect(llamadasGroq[0].model).toBe(MODELO_POR_DEFECTO);
  });
});

describe('compatibilidad con gpt-oss', () => {
  let chat;
  beforeAll(() => { chat = servidor(); });

  it('la primera llamada (con herramientas) pide una sola herramienta por turno: parallel_tool_calls false', async () => {
    guion = [texto('Hola.')];
    await chat({ message: 'hola' });
    expect(llamadasGroq[0].tools.length).toBeGreaterThan(0);
    expect(llamadasGroq[0].parallel_tool_calls).toBe(false);
  });

  it('la segunda llamada (sin herramientas) no lleva parallel_tool_calls', async () => {
    guion = [pideHerramienta('getProducts'), texto('Tenemos Fresa.')];
    await chat({ message: 'qué productos hay' });
    expect(llamadasGroq[1].tools).toBeUndefined();
    expect(llamadasGroq[1].parallel_tool_calls).toBeUndefined();
  });

  it('con gpt-oss se pide razonamiento bajo (reasoning_effort low) para no gastar la respuesta pensando', async () => {
    guion = [pideHerramienta('getProducts'), texto('Tenemos Fresa.')];
    await chat({ message: 'qué productos hay' });
    expect(llamadasGroq[0].reasoning_effort).toBe('low');
    expect(llamadasGroq[1].reasoning_effort).toBe('low');
  });

  it('flujo con una herramienta: tool_calls -> resultado con role tool y tool_call_id -> texto final', async () => {
    guion = [
      pideHerramienta('getProducts', {}, { content: '', reasoning: 'El admin quiere el catálogo, llamo a la herramienta.' }),
      texto('Tenemos **Fresa** a $5.000 COP.', { reasoning: 'Resumo el catálogo.' }),
    ];
    const res = await chat({ message: 'qué productos hay' });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Tenemos **Fresa** a $5.000 COP.');

    const mensajes = llamadasGroq[1].messages;
    const asistente = mensajes.find((m) => m.tool_calls);
    expect(asistente.role).toBe('assistant');
    expect(asistente.tool_calls).toHaveLength(1);
    // El razonamiento de gpt-oss no se le devuelve al modelo (solo se admite con reasoning_format, que gpt-oss no soporta).
    expect(asistente).not.toHaveProperty('reasoning');
    const resultado = mensajes.find((m) => m.role === 'tool');
    expect(resultado.tool_call_id).toBe('call_1');
    expect(resultado.name).toBe('getProducts');
  });

  it('si la respuesta final llega vacía, el cliente recibe un mensaje amable y no un texto vacío', async () => {
    guion = [pideHerramienta('getProducts'), texto('', { reasoning: 'pensando...' })];
    const res = await chat({ message: 'qué productos hay' });
    expect(res.status).toBe(200);
    expect(res.body.response.trim().length).toBeGreaterThan(0);
  });

  it('si una respuesta directa llega con content null, el cliente recibe un mensaje amable', async () => {
    guion = [texto(null, { reasoning: 'pensando...' })];
    const res = await chat({ message: 'hola' });
    expect(res.status).toBe(200);
    expect(res.body.response.trim().length).toBeGreaterThan(0);
  });
});

describe('sin GROQ_API_KEY', () => {
  it('responde "no está disponible", lo registra en el log y no lanza ninguna excepción', async () => {
    const chat = servidor({ groqApiKey: '' });
    const res = await chat({ message: MENSAJE_PRIVADO });
    expect(res.status).toBe(200);
    expect(res.body.response).toMatch(/El asistente no está disponible en este momento/);
    expect(llamadasGroq).toHaveLength(0);
    expect(todoElLog()).toContain('chatbot: GROQ_API_KEY no configurada');
    // No terminó en el catch genérico (antes: TypeError "Cannot read properties of null").
    expect(todoElLog()).not.toMatch(/TypeError|Cannot read properties/);
  });
});

describe('errores de Groq: mensaje amable al cliente y categoría en el log', () => {
  let chat;
  beforeAll(() => { chat = servidor(); });
  beforeEach(() => {
    for (const n of ['log', 'warn', 'error']) vi.mocked(console[n]).mockClear();
  });

  const FALLA = /falla técnica momentánea/;
  const DEMANDA = /mucha demanda/;

  it.each([
    ['modelo retirado (400 model_decommissioned)', () => errorGroq(400, 'model_decommissioned', 'The model `llama-3.1-8b-instant` has been decommissioned'), 'modelo', FALLA],
    ['modelo inexistente (404 model_not_found)', () => errorGroq(404, 'model_not_found', 'The model does not exist'), 'modelo', FALLA],
    ['llave inválida (401)', () => errorGroq(401, 'invalid_api_key', 'Invalid API Key'), 'llave', FALLA],
    ['límite (429)', () => errorGroq(429, 'rate_limit_exceeded', 'Rate limit reached'), 'limite', DEMANDA],
    ['otro (500)', () => errorGroq(500, 'internal_server_error', 'boom'), 'otro', FALLA],
  ])('%s', async (_caso, crearError, categoria, mensajeCliente) => {
    guion = [crearError()];
    const res = await chat({ message: MENSAJE_PRIVADO });
    expect(res.status).toBe(200);
    expect(res.body.response).toMatch(mensajeCliente);
    // Al cliente nunca le llegan detalles técnicos.
    expect(JSON.stringify(res.body)).not.toMatch(/decommissioned|model_not_found|API Key|rate_limit|status|40\d|500/i);

    const registro = errores().find((args) => args[0] === 'chatbot: error de Groq');
    expect(registro, 'debe registrar "chatbot: error de Groq"').toBeTruthy();
    expect(registro[1]).toMatchObject({ categoria });

    const log = todoElLog();
    expect(log).not.toContain(LLAVE_FALSA);
    expect(log).not.toContain('dato-privado-del-usuario-9137');
  });
});

describe('mejoras de revisión', () => {
  let chat;
  beforeAll(() => { chat = servidor(); });
  beforeEach(() => {
    for (const n of ['log', 'warn', 'error']) vi.mocked(console[n]).mockClear();
  });
  const conFin = (respuesta, finish_reason) => ({ choices: [{ ...respuesta.choices[0], finish_reason }] });

  it('cleanText quita los bloques <think>...</think> (sin distinguir mayúsculas)', async () => {
    guion = [texto('<THINK>razonamiento interno secreto</Think>Hola, ¿qué helado te provoca?')];
    const res = await chat({ message: 'hola' });
    expect(res.body.response).toBe('Hola, ¿qué helado te provoca?');
  });

  it('cleanText quita un <think> suelto sin cierre y todo lo que viene después', async () => {
    guion = [texto('Tenemos Fresa. <think>y ahora pienso en algo interno')];
    const res = await chat({ message: 'hola' });
    expect(res.body.response).toBe('Tenemos Fresa.');
  });

  it('el texto de message.reasoning nunca llega al cliente', async () => {
    guion = [
      pideHerramienta('getProducts', {}, { reasoning: 'RAZON-UNO-oculta' }),
      texto('Tenemos Fresa.', { reasoning: 'RAZON-DOS-oculta' }),
    ];
    const res = await chat({ message: 'qué productos hay' });
    expect(JSON.stringify(res.body)).not.toMatch(/RAZON-(UNO|DOS)-oculta/);
    guion = [texto('Hola.', { reasoning: 'RAZON-TRES-oculta' })];
    const directa = await chat({ message: 'hola' });
    expect(JSON.stringify(directa.body)).not.toMatch(/RAZON-TRES-oculta/);
  });

  it('con un modelo que no es gpt-oss NO se envía reasoning_effort', async () => {
    const chatLlama = servidor({ groqModel: 'llama-3.3-70b-versatile' });
    guion = [pideHerramienta('getProducts'), texto('Tenemos Fresa.')];
    await chatLlama({ message: 'qué productos hay' });
    expect(llamadasGroq).toHaveLength(2);
    expect(llamadasGroq[0]).not.toHaveProperty('reasoning_effort');
    expect(llamadasGroq[1]).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    ['primera llamada', () => [conFin(texto('Hola a medias'), 'length')]],
    ['segunda llamada', () => [pideHerramienta('getProducts'), conFin(texto('Tenemos Fre'), 'length')]],
  ])('finish_reason "length" en la %s se registra en el log con el modelo y sin el contenido', async (_caso, crearGuion) => {
    guion = crearGuion();
    await chat({ message: MENSAJE_PRIVADO });
    const registro = [...errores(), ...vi.mocked(console.warn).mock.calls]
      .find((args) => args[0] === 'chatbot: respuesta cortada por límite de tokens');
    expect(registro, 'debe registrar la respuesta cortada').toBeTruthy();
    expect(registro[1]).toMatchObject({ modelo: MODELO_POR_DEFECTO });
    const log = todoElLog();
    expect(log).not.toMatch(/Hola a medias|Tenemos Fre/);
    expect(log).not.toContain('dato-privado-del-usuario-9137');
  });

  it('un error que no es de Groq se registra como "chatbot: error interno" sin llave ni texto del usuario', async () => {
    guion = [new TypeError(`fallo raro con ${LLAVE_FALSA} y ${MENSAJE_PRIVADO} ${'x'.repeat(400)}`)];
    const res = await chat({ message: MENSAJE_PRIVADO });
    expect(res.body.response).toMatch(/falla técnica momentánea/);
    expect(errores().find((args) => args[0] === 'chatbot: error de Groq')).toBeUndefined();
    const registro = errores().find((args) => args[0] === 'chatbot: error interno');
    expect(registro, 'debe registrar "chatbot: error interno"').toBeTruthy();
    expect(registro[1].nombre).toBe('TypeError');
    expect(registro[1].mensaje.length).toBeLessThanOrEqual(200);
    expect(typeof registro[1].pila).toBe('string');
    const log = todoElLog();
    expect(log).not.toContain(LLAVE_FALSA);
    expect(log).not.toContain('dato-privado-del-usuario-9137');
  });
});
