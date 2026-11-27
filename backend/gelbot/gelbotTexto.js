// Gelbot: limpieza del texto que escribe el modelo antes de mostrarlo.
// Quita razonamiento, código y nombres de herramientas SIN dejar restos: cada cosa quitada se cambia primero
// por una marca invisible y después se arregla la oración donde estaba (o se elimina si queda sin sentido).
// Las líneas sin marcas no se tocan: así las tablas, listas y títulos del admin quedan iguales.

const HERRAMIENTAS = 'getProducts|getAllOrders|getOrders|addToCart|addProduct|getAllUsers|deleteUser|deleteProduct|getSalesSummary';
// Palabra completa: "functional" o "funcional" no son "function".
const INICIO = '(?<![\\p{L}\\p{N}_])';
const FIN = '(?![\\p{L}\\p{N}_])';
const NOMBRE_HERRAMIENTA = new RegExp(`${INICIO}(?:functions?\\.)?(?:${HERRAMIENTAS})${FIN}`, 'iu');
const USO_HERRAMIENTA = new RegExp(`${NOMBRE_HERRAMIENTA.source}(?:\\([^()\\n]*\\)|\\s?\\{[^{}]*\\})?`, 'giu');
const PALABRA_TECNICA = new RegExp(`${INICIO}(?:functions?|tool_calls?)${FIN}(?:\\s?=>?)?`, 'giu');

const H = '\u0001'; // aquí había una herramienta
const C = '\u0002'; // aquí había otro código
const MARCA = /[\u0001\u0002]/;
const MARCAS = /[\u0001\u0002]/g;
const TIENE_TEXTO = /[\p{L}\p{N}]/u;

// Negrita, cursiva o comillas que encierran solo una marca, y paréntesis que contienen una.
const ENVOLTURAS = [
  /(\*\*|__|["'*_])[ ]?([\u0001\u0002])[ ]?\1/g,
  /()[“‘«\[][ ]?([\u0001\u0002])[ ]?[”’»\]]/g,
];
const PARENTESIS = / ?\([^()\n]*[\u0001\u0002][^()\n]*\)/g;
// Fin de oración: el punto puede ir seguido de cierres ("**", comillas, paréntesis) y debe seguir un espacio.
const ENTRE_ORACIONES = /(?<=[.!?…]["'*_)\]»”]{0,4})\s+/;
const PREFIJO_DE_LINEA = /^\s*(?:#{1,6}\s+|[-•*]\s+|\d{1,3}[.)]\s+)?/;
// "Según getProducts, tenemos..." -> "Tenemos..."
const ENTRADILLA = /^(\*\*)?(?:según|de acuerdo con|con|usando|mediante|al usar|a través de) (?:(?:la|el) (?:herramienta|función) )?\u0001,\s/i;
// Palabra que deja la frase colgada si lo que sigue se quita ("usando ", "con ", "voy a usar ").
const PALABRA_COLGADA = /(?:^|[\s¡¿*])(?:con|de|del|a|al|en|por|para|y|o|que|el|la|los|las|un|una|según|desde|mediante|herramienta|función|us\p{L}{1,6}|utiliz\p{L}{1,6}|ejecut\p{L}{1,6}|llam\p{L}{1,6}|consult\p{L}{1,6})[\s*]?$/iu;

const contarNegritas = (t) => t.split('**').length - 1;
const juntarEspacios = (t) => t.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Quita pares ** sin nada dentro. cerrar: además quita un ** que quedó sin pareja.
function quitarNegritasVacias(linea, cerrar) {
  const partes = linea.split('**');
  if (partes.length < 2) return linea;
  const pares = (partes.length - 1) >> 1;
  let salida = partes[0];
  let cambio = false;
  for (let i = 0; i < pares; i++) {
    const dentro = partes[2 * i + 1];
    const fuera = partes[2 * i + 2];
    if (dentro.trim()) salida += `**${dentro}**${fuera}`;
    else {
      cambio = true;
      salida = salida.endsWith(' ') ? salida + fuera.trimStart() : salida + fuera;
    }
  }
  if (partes.length % 2 === 0) { // quedó un ** sin pareja
    if (cerrar) cambio = true;
    salida += (cerrar ? '' : '**') + partes[partes.length - 1];
  }
  return cambio ? salida : linea;
}

// Oración sin la marca, o null si hay que eliminarla completa.
function arreglarOracion(oracion) {
  let o = oracion;
  const entradilla = o.match(ENTRADILLA);
  if (entradilla) o = (entradilla[1] || '') + mayuscula(o.slice(entradilla[0].length));
  if (!MARCA.test(o)) return o;
  if (o.includes(H)) {
    if (!/\d/.test(o)) return null;
    // Trae una cifra: no se pierde el dato, la herramienta se cambia por una palabra normal.
    o = o.replace(/(?:la herramienta |la función )?\u0001/gi, 'el sistema').replace(/\b(de|a) el sistema/gi, '$1l sistema');
  } else if (PALABRA_COLGADA.test(o.slice(0, o.search(MARCA))) && !/\d/.test(o)) {
    return null;
  }
  o = juntarEspacios(o.replace(MARCAS, ''));
  return TIENE_TEXTO.test(o) ? o : null;
}

// Línea con marcas: devuelve la línea arreglada, o null si se elimina.
function arreglarLinea(linea) {
  if (linea.trimStart().startsWith('|')) { // fila de tabla: se quita solo la marca
    let fila = linea;
    for (const envoltura of ENVOLTURAS) fila = fila.replace(envoltura, '');
    return fila.replace(MARCAS, '');
  }
  const prefijo = linea.match(PREFIJO_DE_LINEA)[0];
  let cuerpo = linea.slice(prefijo.length);
  for (let vuelta = 0; vuelta < 3; vuelta++) { // "**getProducts**" dentro de comillas, etc.
    for (const envoltura of ENVOLTURAS) cuerpo = cuerpo.replace(envoltura, (_t, _c, marca) => marca);
  }
  cuerpo = cuerpo.replace(PARENTESIS, '');

  let salida = '';
  let negritaPendiente = '';
  for (const oracion of cuerpo.split(ENTRE_ORACIONES)) {
    const lista = MARCA.test(oracion) ? arreglarOracion(oracion) : oracion;
    if (lista !== null) {
      salida += (salida ? ' ' : '') + negritaPendiente + lista;
      negritaPendiente = '';
    } else if (contarNegritas(oracion) % 2) {
      // La oración eliminada abría o cerraba una negrita que sigue en otra oración.
      if (contarNegritas(salida) % 2) salida += '**';
      else negritaPendiente = negritaPendiente ? '' : '**';
    }
  }
  salida = quitarNegritasVacias(salida, true).trim();
  return TIENE_TEXTO.test(salida) ? prefijo + salida : null;
}

function cleanText(text) {
  const marcado = String(text || '')
    .replace(MARCAS, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // razonamiento dentro del contenido (modelos que "piensan")
    .replace(/<think>[\s\S]*$/i, '')           // <think> sin cierre: se descarta todo lo que sigue
    .replace(/\[TIPO\s*\d+[^\]]*\]/gi, '')
    .replace(/```[a-z]*\s*[\s\S]*?```/gi, '')  // bloques de código markdown (como ```sql ... ```)
    .replace(/`([^`\n]*)`(?:\s*;)*/g, (_todo, codigo) => (NOMBRE_HERRAMIENTA.test(codigo) ? H : C))
    .replace(/<\/?(?:function|tool_call)[^>]*>/gi, C)
    .replace(USO_HERRAMIENTA, H)
    .replace(PALABRA_TECNICA, C)
    .replace(/\{[\s\S]*?\}/g, '');

  const huboMarcas = MARCA.test(marcado);
  let limpio = marcado
    .split('\n')
    .map((linea) => (MARCA.test(linea) ? arreglarLinea(linea) : quitarNegritasVacias(linea, false)))
    .filter((linea) => linea !== null)
    .join('\n');
  if (huboMarcas) limpio = limpio.replace(/\n{3,}/g, '\n\n');
  limpio = limpio.replace(/(?<!\p{L})con\s*$/iu, '').trim();
  return huboMarcas && !TIENE_TEXTO.test(limpio) ? '' : limpio;
}

// Nombre de un producto (lo escribe un admin en el panel) listo para ir dentro de un texto del chat: sin asteriscos ni
// acentos graves (romperían la negrita), sin saltos de línea, caracteres de control ni invisibles, y recortado.
// Es solo texto: nunca se usa como regex ni como instrucción.
const MAX_NOMBRE_VISIBLE = 80;
const NO_VISIBLES = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
function nombreVisible(nombre) {
  const limpio = String(nombre ?? '').normalize('NFKC').replace(NO_VISIBLES, ' ').replace(/[*`_~|<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(limpio).slice(0, MAX_NOMBRE_VISIBLE).join('').trim();
}

module.exports = { cleanText, nombreVisible, NO_VISIBLES };
