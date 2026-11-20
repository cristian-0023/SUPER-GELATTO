// Gelbot: cómo se entiende el mensaje del cliente (sin modelo de IA).
//  - tieneIntencionDeCompra: ¿pide agregar o comprar? (las negaciones y "quitar" nunca cuentan)
//  - esAfirmacion / botOfrecioAgregar / botPreguntoCual: respuestas cortas ("sí", "dale", "fresa")
//  - leerCantidad: "dos fresas" -> 2 (tope 10)
//  - buscarProductos: qué productos del catálogo nombra un texto (palabra completa, sin palabras genéricas)
// Todo trabaja sobre texto en minúsculas y sin tildes: así \b (que solo entiende letras ASCII) funciona
// con "agrégame", "añade" o "tráeme".

const TILDES = /[\u0300-\u036f]/g;
const normalizarTexto = (t) => String(t || '').toLowerCase().normalize('NFD').replace(TILDES, '');
// Solo letras, números y espacios (para comparar palabras sueltas).
const soloPalabras = (t) => normalizarTexto(t).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "no quiero", "quita la fresa", "cancela"...: nunca es un pedido para agregar.
const NEGACION_O_QUITAR = /\b(no|nunca|tampoco|sin|quit\w*|elimin\w*|saca\w*|cancel\w*|devolv\w*|borra\w*)\b/;
// Verbos que siempre piden agregar o comprar. ("carrito" solo ya no cuenta: "quiero ver mi carrito".)
const VERBOS_DE_CARRITO = /\b(agreg\w*|anad\w*|compr[ao]\w*|comprar|llevo|me lleva\w*|pido|pide|pedir|ordeno|ordenar|mand(a|e|en|ar|ame|eme)|sirv\w*|echa\w*|me pon\w*|ponga\w*|tra(e|i)?(me|game)|me vendes|vendame)\b/;
// Verbos de deseo: cuentan solo si el mensaje no es una consulta ("quiero saber cuánto cuesta" no es compra).
// "¿Me das una fresa?" es un pedido amable: el signo de pregunta solo no la vuelve consulta.
const VERBOS_DE_DESEO = /\b(quiero|quisiera|dame|deme|ponme|me das|me da|regala\w*|me gustaria|necesito|antoja|antojo)\b/;
const PALABRAS_DE_CONSULTA = /\b(cuanto|cuesta|cuestan|precios?|vale|valor|ingredientes?|contiene|hecho|cuales|tienen|hay|saber|informacion|info|sabores|menu|catalogo|opciones|ver)\b/;
const PALABRAS_DE_PRECIO = /\b(cuanto|cuesta|cuestan|precios?|vale|valen|valor)\b/;

const hayNegacion = (mensaje) => NEGACION_O_QUITAR.test(normalizarTexto(mensaje));
const esConsulta = (mensaje) => PALABRAS_DE_CONSULTA.test(normalizarTexto(mensaje));
const preguntaPrecio = (mensaje) => PALABRAS_DE_PRECIO.test(normalizarTexto(mensaje));

function tieneIntencionDeCompra(mensaje) {
  const t = normalizarTexto(mensaje);
  if (NEGACION_O_QUITAR.test(t)) return false;
  return VERBOS_DE_CARRITO.test(t) || (VERBOS_DE_DESEO.test(t) && !PALABRAS_DE_CONSULTA.test(t));
}

// Mensaje que es SOLO una afirmación ("sí", "dale", "sí, por favor", "agrégalo", "la quiero").
const AFIRMACION = /^(?:(?:si|dale|listo|ok|okey|okay|claro|de una|por favor|porfa|agregalo|agregala|agregamelo|agregamela|anadelo|anadela|lo quiero|la quiero|lo compro|la compro|perfecto|va)\s?)+$/;
const esAfirmacion = (mensaje) => AFIRMACION.test(soloPalabras(mensaje));

// ¿El último mensaje del bot ofreció agregar algo, o preguntó cuál sabor?
const OFERTA_DE_AGREGAR = /\b(agregalo|agregala|agregarlo|agregarla|agregue|agrego|anadirlo|anadirla|lo pongo en tu carrito|la pongo en tu carrito|lo quieres|la quieres)\b/;
const PREGUNTA_CUAL = /\bcual\b/;
const botOfrecioAgregar = (textoBot) => OFERTA_DE_AGREGAR.test(normalizarTexto(textoBot));
const botPreguntoCual = (textoBot) => PREGUNTA_CUAL.test(normalizarTexto(textoBot));

// Cantidad pedida: dígitos o palabras de uno a diez, "docena". Mínimo 1, máximo 10.
const MAX_CANTIDAD = 10;
const NUMEROS = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
function leerCantidad(mensaje) {
  const t = soloPalabras(mensaje);
  let cantidad = 1;
  const digitos = t.match(/\b(\d{1,4})\b/);
  if (digitos) cantidad = Number(digitos[1]);
  else if (/\bmedia docena\b/.test(t)) cantidad = 6;
  else if (/\bdocenas?\b/.test(t)) cantidad = 12;
  else {
    const palabra = t.split(' ').find((p) => NUMEROS[p]);
    if (palabra) cantidad = NUMEROS[palabra];
  }
  return Math.min(MAX_CANTIDAD, Math.max(1, cantidad));
}

// Palabras que no distinguen un sabor de otro ("Helado de Fresa" se reconoce por "fresa").
const PALABRAS_GENERICAS = new Set(['helado', 'helados', 'gelato', 'gelatos', 'sabor', 'sabores', 'copa', 'vaso', 'para', 'especial', 'artesanal']);
const MIN_LETRAS = 4;

// Palabras del texto, con su singular ("fresas" -> "fresa", "limones" -> "limon").
function palabrasDelTexto(texto) {
  const palabras = new Set();
  for (const p of soloPalabras(texto).split(' ')) {
    if (!p) continue;
    palabras.add(p);
    if (p.endsWith('es')) palabras.add(p.slice(0, -2));
    if (p.endsWith('s')) palabras.add(p.slice(0, -1));
  }
  return palabras;
}

const palabrasClave = (nombre) =>
  soloPalabras(nombre).split(' ').filter((p) => p.length >= MIN_LETRAS && !PALABRAS_GENERICAS.has(p));

// Productos que nombra el texto. Gana el que coincide en más palabras completas; si empatan varios, se
// devuelven todos (el que llama pregunta cuál). [] si no nombra ninguno.
function buscarProductos(texto, productos) {
  if (!Array.isArray(productos) || !texto) return [];
  const palabras = palabrasDelTexto(texto);
  let mejores = [];
  let mejorPuntaje = 0;
  for (const p of productos) {
    if (!p || typeof p.nombre !== 'string') continue;
    const puntaje = palabrasClave(p.nombre).filter((c) => palabras.has(c)).length;
    if (puntaje === 0 || puntaje < mejorPuntaje) continue;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejores = []; }
    mejores.push(p);
  }
  return mejores;
}

module.exports = {
  normalizarTexto,
  tieneIntencionDeCompra,
  hayNegacion,
  esConsulta,
  preguntaPrecio,
  esAfirmacion,
  botOfrecioAgregar,
  botPreguntoCual,
  leerCantidad,
  buscarProductos,
  MAX_CANTIDAD,
};
