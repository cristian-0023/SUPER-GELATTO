// Gelbot, arreglos de la revisión (2026-11-20): negaciones, afirmaciones cortas, cantidad, coincidencia de
// productos por palabra completa, caché de productos que se invalida, imagen validada en el carrito,
// getProducts como datos no confiables y reintento en la segunda llamada.
// El modelo (Groq) y Supabase son FALSOS: estas pruebas nunca llaman a Groq de verdad.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

const requireNode = createRequire(import.meta.url);
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { APIError } = requireNode('groq-sdk/error');
const errorGroq = (status, code) =>
  APIError.generate(status, { error: { message: 'error de prueba', type: 'invalid_request_error', code } }, undefined, new Headers());

const USUARIOS = {
  1: { id_usuario: 1, nombre: 'Ana Admin', email: 'ana.admin@example.com', rol: 'admin' },
  7: { id_usuario: 7, nombre: 'Carlos Cliente', email: 'carlos@example.com', rol: 'cliente' },
};
const bearer = (datos) => ({ Authorization: `Bearer ${tokenPrueba(datos)}` });
const tokenAdmin = () => bearer({ id_usuario: 1, email: USUARIOS[1].email, rol: 'admin' });
const tokenCliente = () => bearer({ id_usuario: 7, email: USUARIOS[7].email, rol: 'cliente' });

const FRESA = { id_producto: 1, nombre: 'Fresa Salvaje', precio: 9000, imagen: '/images/gelato_fresa.png', descripcion: 'Fresas', estado: true };
const CHOCO = { id_producto: 2, nombre: 'Chocolate Belga', precio: 12000, imagen: 'https://cdn.example.com/choco.png', descripcion: 'Cacao', estado: true };
const MANGO = { id_producto: 3, nombre: 'Mango Biche', precio: 8500, imagen: 'javascript:alert(1)', descripcion: 'Ácido', estado: true };
const PRODUCTOS = [FRESA, CHOCO, MANGO];

const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const fake = crearFakeSupabase();
let llamadasGroq = [];
let guion = [];
let productosBase = PRODUCTOS; // lo que devuelve la tabla producto (se puede cambiar dentro de una prueba)
let errorProductos = null;
const groqFalso = async (parametros) => {
  llamadasGroq.push(JSON.parse(JSON.stringify(parametros)));
  const siguiente = guion.shift();
  if (siguiente instanceof Error) throw siguiente;
  return siguiente || texto('Listo.');
};

let chat;
let app;
beforeEach(() => {
  llamadasGroq = [];
  guion = [];
  productosBase = PRODUCTOS;
  errorProductos = null;
  fake.reiniciar();
  fake.responder('usuario', 'select', (c) => {
    const filtro = c.filtros.find((f) => f[0] === 'eq');
    const u = USUARIOS[filtro ? String(filtro[2]) : ''];
    return u ? { data: u, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  });
  fake.responder('producto', 'select', () => (errorProductos ? { data: null, error: errorProductos } : { data: productosBase, error: null }));
  fake.responder('producto', 'delete', { data: [{ id_producto: 1 }], error: null });
  ({ app } = cargarServidor(fake, { groq: groqFalso }));
  chat = (cuerpo, cabeceras = tokenCliente()) => request(app).post('/api/chatbot').set(cabeceras).send(cuerpo);
});

const OFERTA_FRESA = '**Fresa Salvaje** cuesta **$9.000**. Si lo quieres, dime "agrégalo" y lo pongo en tu carrito 🍦';
const conHistorial = (contenidoAsistente) => [{ role: 'user', content: 'hola' }, { role: 'assistant', content: contenidoAsistente }];
const sistema = (i = 0) => llamadasGroq[i].messages[0].content;

describe('1. negaciones y quitar del carrito no agregan', () => {
  it.each([
    ['no quiero fresa'],
    ['no agregues la fresa'],
    ['quita la fresa del carrito'],
    ['elimina la fresa salvaje'],
    ['nunca me agregues fresa'],
    ['saca el chocolate belga del carrito'],
    ['quiero ver mi carrito'],
  ])('"%s" no agrega (ni el atajo ni el modelo)', async (mensaje) => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Ok.')];
    const res = await chat({ message: mensaje });
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
  });
});

describe('2. afirmaciones y respuestas cortas según lo que ofreció el bot', () => {
  it.each([['sí'], ['si'], ['dale'], ['listo'], ['ok'], ['claro'], ['de una'], ['por favor'], ['agrégalo'], ['la quiero'], ['Sí, por favor!']])(
    '"%s" después de que el bot ofreció agregar la Fresa -> la agrega el servidor, sin modelo', async (mensaje) => {
      const res = await chat({ message: mensaje, history: conHistorial(OFERTA_FRESA) });
      expect(llamadasGroq).toHaveLength(0);
      expect(res.body.action).toBe('addToCart');
      expect(res.body.product).toMatchObject({ id: 1, nombre: 'Fresa Salvaje', precio: 9000 });
    });

  it('"sí" sin una oferta previa no agrega nada', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('¿En qué te ayudo?')];
    const res = await chat({ message: 'sí', history: conHistorial('¡Hola! ¿En qué te ayudo hoy? 🍦 La Fresa Salvaje es deliciosa.') });
    expect(res.body.action).not.toBe('addToCart');
  });

  it('"sí" cuando la oferta menciona dos sabores -> no agrega y pregunta cuál', async () => {
    const res = await chat({ message: 'sí', history: conHistorial('Te recomiendo **Fresa Salvaje** o **Chocolate Belga**. ¿Quieres que lo agregue a tu carrito?') });
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.response).toMatch(/cu[aá]l/i);
  });

  it.each([['fresa'], ['una de fresa por favor'], ['Chocolate belga']])('"%s" justo después de "¿cuál sabor quieres?" -> agrega ese sabor', async (mensaje) => {
    const res = await chat({ message: mensaje, history: conHistorial('¡Claro! ¿Cuál sabor quieres? 🍦') });
    expect(res.body.action).toBe('addToCart');
    expect(res.body.product.id).toBe(/choco/i.test(mensaje) ? 2 : 1);
  });

  it('un sabor suelto sin que el bot haya preguntado cuál no agrega', async () => {
    guion = [texto('La Fresa Salvaje es nuestra favorita.')];
    const res = await chat({ message: 'fresa', history: conHistorial('¡Hola! ¿En qué te ayudo?') });
    expect(res.body.action).not.toBe('addToCart');
  });

  it.each([['mándame una fresa'], ['sírveme una fresa'], ['échame una fresa'], ['me pones una fresa'], ['póngame una fresa'], ['me pone una fresa salvaje'], ['tráeme una fresa'], ['tráme una fresa'], ['me vendes una fresa'], ['véndame una fresa'], ['me llevas una fresa']])(
    '"%s" cuenta como pedido', async (mensaje) => {
      guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Listo.')];
      const res = await chat({ message: mensaje });
      expect(res.body.action).toBe('addToCart');
      expect(res.body.product.id).toBe(1);
    });
});

describe('3. cantidad', () => {
  it.each([
    ['agrégame una fresa', 1],
    ['agrégame dos fresas', 2],
    ['quiero 3 fresas', 3],
    ['dame cinco de fresa salvaje', 5],
    ['agrégame diez fresas', 10],
    ['quiero una docena de fresas', 10],
    ['agrégame 50 fresas', 10],
  ])('"%s" -> quantity %i', async (mensaje, cantidad) => {
    const res = await chat({ message: mensaje });
    expect(res.body.action).toBe('addToCart');
    expect(res.body.quantity).toBe(cantidad);
  });

  it('el texto del servidor menciona la cantidad y el precio por unidad', async () => {
    const res = await chat({ message: 'agrégame dos fresas' });
    expect(res.body.response).toContain('2 × **Fresa Salvaje**');
    expect(res.body.response).toContain('$9.000 c/u');
  });

  it('el addToCart del modelo también lleva la cantidad del mensaje', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Listo.')];
    const res = await chat({ message: 'agrégame tres fresas, ¿qué ingredientes contiene?' });
    expect(llamadasGroq.length).toBeGreaterThan(0);
    expect(res.body.action).toBe('addToCart');
    expect(res.body.quantity).toBe(3);
  });

  it('un apodo con cantidad ("quiero tres del rojito de frutas") no agrega: pregunta el sabor con el menú', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Listo.')];
    const res = await chat({ message: 'quiero tres del rojito de frutas' });
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
    expect(res.body.response).toMatch(/cu[aá]l sabor quieres/i);
    expect(res.body.productos.length).toBeGreaterThan(0);
    expect(res.body.quantity).toBeUndefined();
  });
});

describe('4. coincidencia de productos (palabra completa, sin palabras genéricas)', () => {
  const FRESA_MANGO = { id_producto: 4, nombre: 'Fresa con Mango', precio: 9500, imagen: '/images/fm.png', estado: true };
  const COCO = { id_producto: 5, nombre: 'Coco & Lima', precio: 8000, imagen: '/images/coco.png', estado: true };
  const H_CHOCO = { id_producto: 6, nombre: 'Helado de Chocolate', precio: 7000, imagen: '/images/hc.png', estado: true };
  const H_FRESA = { id_producto: 7, nombre: 'Helado de Fresa', precio: 7500, imagen: '/images/hf.png', estado: true };

  it('"agrégame una fresa" con dos sabores de fresa -> no agrega y pregunta cuál', async () => {
    productosBase = [FRESA, FRESA_MANGO];
    const res = await chat({ message: 'agrégame una fresa' });
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.response).toMatch(/cu[aá]l/i);
    expect(res.body.response).toContain('Fresa Salvaje');
    expect(res.body.response).toContain('Fresa con Mango');
  });

  it('"cuánto cuesta la fresa" con dos sabores de fresa -> no da precio y pregunta cuál', async () => {
    productosBase = [FRESA, FRESA_MANGO];
    const res = await chat({ message: 'cuánto cuesta la fresa' });
    expect(llamadasGroq).toHaveLength(0);
    expect(res.body.response).toMatch(/cu[aá]l/i);
    expect(res.body.response).not.toMatch(/\$/);
  });

  it('el nombre más completo gana: "fresa con mango" elige ese sabor', async () => {
    productosBase = [FRESA, FRESA_MANGO];
    const res = await chat({ message: 'agrégame la fresa con mango' });
    expect(res.body.product?.id).toBe(4);
  });

  it('solo palabra completa: "cocoa" no es "Coco & Lima"', async () => {
    productosBase = [COCO, CHOCO];
    guion = [texto('No tenemos cocoa.')];
    const res = await chat({ message: 'agrégame una cocoa' });
    expect(res.body.action).not.toBe('addToCart');
  });

  it('"helado" es genérico: "agrégame un helado de fresa" elige Helado de Fresa', async () => {
    productosBase = [H_CHOCO, H_FRESA];
    const res = await chat({ message: 'agrégame un helado de fresa' });
    expect(res.body.product?.id).toBe(7);
  });

  it('el addToCart del modelo usa la caché de productos (no consulta la base otra vez)', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Listo.')];
    const res = await chat({ message: 'agrégame una fresa, ¿qué ingredientes contiene?' });
    expect(llamadasGroq.length).toBeGreaterThan(0);
    expect(res.body.action).toBe('addToCart');
    expect(fake.consultas('producto', 'select')).toHaveLength(1);
  });

  it('un apodo no agrega, pregunta el sabor con el menú y tampoco consulta la base otra vez', async () => {
    guion = [pideHerramienta('addToCart', { productName: 'Fresa Salvaje' }), texto('Listo.')];
    const res = await chat({ message: 'quiero el rojito de frutas' });
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
    expect(res.body.response).toMatch(/cu[aá]l sabor quieres/i);
    expect(res.body.productos.length).toBeGreaterThan(0);
    expect(fake.consultas('producto', 'select')).toHaveLength(1);
  });

  it('si el modelo pide un nombre ambiguo, no agrega y pregunta cuál', async () => {
    productosBase = [FRESA, FRESA_MANGO];
    guion = [pideHerramienta('addToCart', { productName: 'fresa' }), texto('Listo.')];
    const res = await chat({ message: 'agrégame una fresa, ¿qué ingredientes contiene?' });
    expect(llamadasGroq.length).toBeGreaterThan(0);
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.response).toMatch(/cu[aá]l de estos/i);
    expect(res.body.response).toContain('Fresa con Mango');
  });

  it('si el cliente usa un apodo y el modelo pide un nombre ambiguo, se pregunta el sabor con el menú', async () => {
    productosBase = [FRESA, FRESA_MANGO];
    guion = [pideHerramienta('addToCart', { productName: 'fresa' }), texto('Listo.')];
    const res = await chat({ message: 'quiero el rojito de frutas' });
    expect(res.body.action).not.toBe('addToCart');
    expect(res.body.product ?? null).toBeNull();
    expect(res.body.response).toMatch(/cu[aá]l sabor quieres/i);
    expect(res.body.productos.length).toBeGreaterThan(0);
  });
});

describe('5. caché de productos', () => {
  it('pide solo columnas concretas (no *)', async () => {
    guion = [texto('Hola.')];
    await chat({ message: 'hola' });
    const columnas = fake.consultas('producto', 'select')[0].columnas;
    expect(columnas).toBeTruthy();
    expect(columnas).not.toContain('*');
    for (const c of ['id_producto', 'nombre', 'precio', 'imagen']) expect(columnas).toContain(c);
  });

  it('si Supabase falla al renovar, se sigue usando la lista anterior (no se guarda [])', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      guion = [texto('Hola.'), texto('Hola.')];
      await chat({ message: 'hola' });
      vi.setSystemTime(Date.now() + 61000);
      errorProductos = { message: 'timeout' };
      await chat({ message: 'hola' });
      expect(sistema(1)).toContain('Fresa Salvaje');
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidarCacheProductos se exporta', () => {
    delete requireNode.cache[resolve(raiz, 'chatbot.js')];
    expect(typeof requireNode(resolve(raiz, 'chatbot.js')).invalidarCacheProductos).toBe('function');
  });

  it('después de que el admin borra/desactiva un producto, el chatbot ya no lo ofrece', async () => {
    guion = [texto('Hola.'), texto('Hola.')];
    await chat({ message: 'hola' });
    expect(sistema(0)).toContain('Fresa Salvaje');
    productosBase = [CHOCO, MANGO];
    const borrado = await request(app).delete('/api/admin/products/1').set(tokenAdmin());
    expect(borrado.status).toBeLessThan(400);
    await chat({ message: 'hola' });
    expect(sistema(1)).not.toContain('Fresa Salvaje');
  });
});

describe('6. imagen validada en el producto del carrito', () => {
  it('una imagen peligrosa llega como null y no se manda la descripción (el carrito no la usa)', async () => {
    const res = await chat({ message: 'agrégame un mango biche' });
    expect(res.body.action).toBe('addToCart');
    expect(res.body.product.image).toBeNull();
    expect(res.body.product).not.toHaveProperty('descripcion');
  });

  it('una imagen https válida se conserva', async () => {
    const res = await chat({ message: 'agrégame un chocolate belga' });
    expect(res.body.product.image).toBe('https://cdn.example.com/choco.png');
  });
});

describe('7. getProducts llega al modelo como datos no confiables', () => {
  it('el resultado va entre las marcas DATOS_NO_CONFIABLES', async () => {
    guion = [pideHerramienta('getProducts'), texto('Estos son nuestros sabores.')];
    await chat({ message: 'qué sabores tienen' });
    const tool = llamadasGroq[1].messages.find((m) => m.role === 'tool');
    expect(tool.content).toMatch(/^<<<DATOS_NO_CONFIABLES>>>/);
    expect(tool.content).toMatch(/<<<FIN_DATOS_NO_CONFIABLES>>>$/);
  });
});

describe('8. la segunda llamada también reintenta una vez', () => {
  it('tool_use_failed en la segunda llamada: reintenta y responde con el texto del modelo', async () => {
    guion = [pideHerramienta('getProducts'), errorGroq(400, 'tool_use_failed'), texto('Estos son nuestros sabores 🍦')];
    const res = await chat({ message: 'qué sabores tienen' });
    expect(llamadasGroq).toHaveLength(3);
    expect(llamadasGroq[2].tool_choice).toBe('none');
    expect(res.body.response).toBe('Estos son nuestros sabores 🍦');
  });

  it('si falla dos veces y no hay tarjetas (admin), igual responde con un respaldo y conserva la tabla', async () => {
    fake.responder('venta', 'select', { data: [{ id_venta: 1, total: 100, fecha: '2026-01-01', id_usuario: 7 }], error: null });
    guion = [pideHerramienta('getAllOrders'), errorGroq(400, 'tool_use_failed'), errorGroq(400, 'tool_use_failed')];
    const res = await chat({ message: 'últimas ventas' }, tokenAdmin());
    expect(llamadasGroq).toHaveLength(3);
    expect(res.body.action).toBe('showSalesTable');
    expect(res.body.actionData).toHaveLength(1);
    expect(res.body.response).not.toMatch(/falla técnica/i);
  });
});

describe('10. sin caracteres combinantes literales en el código', () => {
  it.each([['chatbot.js'], ['gelbotIntencion.js']])('%s escribe el rango de tildes con escapes \\u', (archivo) => {
    const fuente = readFileSync(resolve(raiz, archivo), 'utf8');
    expect(/[̀-ͯ]/.test(fuente)).toBe(false);
  });
});
