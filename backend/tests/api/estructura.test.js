// Estructura de carpetas: los módulos del backend viven agrupados (gelbot/, datos/, servicios/)
// y exportan exactamente lo mismo que antes de moverlos. La raíz del repo queda limpia.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const requireNode = createRequire(import.meta.url);
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const raizRepo = resolve(backend, '..');

// Lista de exportaciones tomada de los archivos antes de moverlos.
const MODULOS = {
  'gelbot/chatbot.js': ['ejecutarHerramientasAdmin', 'functions', 'handleChatbotRequest', 'invalidarCacheProductos'],
  'gelbot/gelbotCliente.js': ['REGLA_SALUD', 'quiereAgregar', 'responderCliente'],
  'gelbot/gelbotFichas.js': ['CONFIRMA', 'MENSAJE_CONSULTA_FICHA', 'avisoSinIngrediente', 'conOfertaTrasSalud', 'leerConsultaFicha', 'leerOfertaTrasSalud', 'pideInformacion', 'productosNombrados', 'respuestaFicha', 'textoDeConsulta', 'textoFicha', 'traeOfertaTrasSalud'],
  'gelbot/gelbotIntencion.js': ['MAX_CANTIDAD', 'SEPARADOR', 'analizarMensaje', 'botOfrecioAgregar', 'botPreguntoCual', 'buscarProductos', 'esAfirmacion', 'esConsulta', 'estaRechazado', 'leerCantidad', 'leerCantidadDe', 'normalizarTexto', 'preguntaPrecio', 'resolverPedido', 'soloNombra', 'soloPalabras', 'tieneIntencionDeCompra', 'variantes'],
  'gelbot/gelbotMenu.js': ['leerPedidoDeMenu', 'pideOtraCosa'],
  'gelbot/gelbotRespuestas.js': ['MAX_LARGO_MENSAJE', 'MAX_PRODUCTOS_TARJETAS', 'MENSAJE_NADA_AGREGADO', 'MENSAJE_NADA_AGREGADO_RELATO', 'MENSAJE_PRECIOS', 'MENSAJE_SABORES', 'TEMAS', 'TEXTOS', 'formatearCOP', 'limpiarHistorial', 'normalizarEntrada', 'paraCliente', 'productoParaCarrito', 'productosParaTarjetas', 'rechazaOCuenta', 'respaldaTema', 'respuestaAgregar', 'respuestaCual', 'respuestaDeTemaFijo', 'respuestaElegirSabor', 'respuestaMenu', 'temaPorPalabras', 'textoAgregadoAlCarrito', 'textoCualProducto', 'textoInfoProducto', 'textoPedidos', 'textoPersonalizado', 'textoPuntos', 'ultimoMensajeDelBot'],
  'gelbot/gelbotTexto.js': ['NO_VISIBLES', 'cleanText', 'nombreVisible'],
  'datos/datosSabores.js': ['FLAVOR_DATA_MAP', 'fichaPropia', 'getFlavorData'],
  'servicios/modelos3dStorage.js': ['BUCKET_MODELOS_3D', 'TAMANO_MAXIMO_MODELO', 'TIEMPO_MAXIMO_DESCARGA_MS', 'borrarModeloAnterior', 'copiarModeloATienda'],
  'servicios/imagenProducto.js': ['imagenProductoValida'],
  'servicios/correoIlike.js': ['correoParaIlike'],
};

beforeAll(() => {
  for (const n of ['log', 'warn', 'error']) vi.spyOn(console, n).mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

describe('módulos del backend en sus carpetas', () => {
  it.each(Object.entries(MODULOS))('%s carga y exporta lo mismo que antes', (ruta, claves) => {
    const modulo = requireNode(resolve(backend, ruta));
    expect(Object.keys(modulo).sort()).toEqual(claves);
  });

  it.each(Object.keys(MODULOS))('ya no existe la copia vieja de %s en backend/', (ruta) => {
    const nombre = ruta.split('/').pop();
    expect(existsSync(resolve(backend, nombre))).toBe(false);
  });

  it('server.js sigue en backend/', () => {
    expect(existsSync(resolve(backend, 'server.js'))).toBe(true);
  });
});

describe('raíz del repositorio limpia', () => {
  it.each([
    ['migration.sql', 'supabase/historico/migration.sql'],
    ['VALIDATIONS.md', 'docs/historico/VALIDATIONS.md'],
  ])('%s se movió a %s', (viejo, nuevo) => {
    expect(existsSync(resolve(raizRepo, viejo))).toBe(false);
    expect(existsSync(resolve(raizRepo, nuevo))).toBe(true);
  });

  it('VALIDATIONS.md avisa que es histórico', () => {
    const primera = readFileSync(resolve(raizRepo, 'docs/historico/VALIDATIONS.md'), 'utf8').split('\n')[0];
    expect(primera).toMatch(/hist[oó]rico/i);
  });

  // Configuración local del editor: puede seguir en el disco, pero no en git.
  it.each([['mcp.json'], ['skills-lock.json'], ['.cursor'], ['.agents']])('%s no está en git y está en .gitignore', (ruta) => {
    const enGit = execSync(`git ls-files -- "${ruta}"`, { cwd: raizRepo, encoding: 'utf8' }).trim();
    expect(enGit).toBe('');
    expect(readFileSync(resolve(raizRepo, '.gitignore'), 'utf8')).toContain(ruta);
  });
});
