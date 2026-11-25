// Gelbot: cómo se entiende el mensaje del cliente (sin modelo de IA).
// Regla de oro: ante la duda, NO se agrega (agregar algo rechazado es peor que preguntar otra vez).
//  - analizarMensaje: qué parte del mensaje pide, qué parte rechaza ("no quiero fresa, quiero mango")
//  - resolverPedido: a qué producto y cantidad equivale el mensaje, o si hay que preguntar cuál
//  - esAfirmacion / botOfrecioAgregar / botPreguntoCual: respuestas cortas ("sí", "dale", "fresa")
//  - leerCantidad: "dos fresas" -> 2 (tope 10)
//  - buscarProductos: qué productos del catálogo nombra un texto (palabra completa, sin palabras genéricas)
// Todo trabaja sobre texto en minúsculas y sin tildes: así \b (que solo entiende letras ASCII) funciona
// con "agrégame", "añade" o "tráeme".

const TILDES = /[\u0300-\u036f]/g;
const normalizarTexto = (t) => String(t || '').toLowerCase().normalize('NFD').replace(TILDES, '');
// Solo letras, números y espacios (para comparar palabras sueltas).
const soloPalabras = (t) => normalizarTexto(t).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "no quiero", "quita la fresa", "cancela", "en vez de"...: esa parte del mensaje rechaza, no pide.
// ("nada más" no rechaza: "dame una fresa nada más".) "sin" y "ni" se tratan aparte: pueden ser un atributo.
const NEGACION = /\b(no|nunca|jamas|tampoco|ningun\w*|quit\w*|elimin\w*|saca\w*|cancel\w*|devolv\w*|devuelv\w*|devoluci\w*|borra\w*|retir\w*|remuev\w*|remov\w*|descart\w*|olvid\w*|evit\w*|cambi\w*|dej(?:a|e|es|en) de|en (?:vez|lugar) de|excepto|salvo|menos|nada(?! mas\b))\b/;
const NEGACION_NI = /\bni\b/;
// Verbos que siempre piden agregar o comprar. ("carrito" solo ya no cuenta: "quiero ver mi carrito".)
const VERBOS_DE_CARRITO = /\b(agreg\w*|anad\w*|compr[ao]\w*|comprar|llevo|me lleva\w*|pido|pide|pedir|ordeno|ordenar|mand(a|e|en|ar|ame|eme)|sirv\w*|echa\w*|me pon\w*|ponga\w*|tra(e|i)?(me|game)|me vendes|vendame)\b/;
// Verbos de deseo: cuentan solo si el mensaje no es una consulta ("quiero saber cuánto cuesta" no es compra).
// "¿Me das una fresa?" es un pedido amable: el signo de pregunta solo no la vuelve consulta.
const VERBOS_DE_DESEO = /\b(quiero|quisiera|dame|deme|ponme|me das|me da|regala\w*|me gustaria|necesito|antoja|antojo)\b/;
const PALABRAS_DE_CONSULTA = /\b(cuanto|cuesta|cuestan|precios?|vale|valor|ingredientes?|contiene|hecho|cuales|tienen|hay|saber|informacion|info|sabores|menu|catalogo|opciones|ver)\b/;
const PALABRAS_DE_PRECIO = /\b(cuanto|cuesta|cuestan|precios?|vale|valen|valor)\b/;

const esConsulta = (mensaje) => PALABRAS_DE_CONSULTA.test(normalizarTexto(mensaje));
const preguntaPrecio = (mensaje) => PALABRAS_DE_PRECIO.test(normalizarTexto(mensaje));

// Pedidos inconfundibles. Después de una negación solo cuentan estos ("no sé, dame una fresa").
const PEDIDOS_CLAROS = 'quiero|quisiera|dame|deme|ponme|pongame|agregame|agregueme|agrega|anademe|anade|traeme|traigame|sirveme|mandame|echame|regalame|regaleme|vendeme|vendame|me llevo|me das?|me regalas?|me vendes?|me pones?';
const PEDIDO_CLARO = new RegExp(`\\b(?:${PEDIDOS_CLAROS})\\b`);
// "quita la fresa y dame mango": el conector antes de un pedido claro empieza otra parte del mensaje.
const CONECTOR_Y_PEDIDO = new RegExp(` (?:y|e|pero|mejor|sino|entonces) (?=(?:mejor |entonces |por favor )?(?:${PEDIDOS_CLAROS})\\b)`, 'g');
const SEPARADOR = /[,.;:!?¡¿()\n\r\u2026]+|\s[-\u2013\u2014]\s/;
// Negaciones que no rechazan nada.
const POR_QUE_NO_ME_DAS = /\bpor que no (?=(?:me|nos) (?:das?|agregas?|pones?|regalas?|vendes?|sirves?|mandas?)\b)/g;
const SI_NO_ES_MOLESTIA = /\bsi no es (?:mucha )?molestia\b/g;
const NO_IMPORTA = /(?<!\bya )\bno importa (?=(?:el|la|los|las|lo|cual|cuanto|que|como|si)\b)/g;
const CONDICION = /^\s*(?:y )?si no\b/; // "si no hay mango, dame fresa": no se puede saber si se cumple
// Marcas internas (el mensaje no las puede traer: se quitan al empezar).
const MARCAS_INTERNAS = /[\u0003\u0004]/g;
const SIN_DE_NOMBRE = 's\u0003n';   // el "sin" que hace parte del nombre de un producto
const PARTE_SIN_PESO = '\u0004';    // "no importa el tamaño"
const OTRO_PEDIDO = /\b(?:y|mas) (?:un|una|uno|\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|docena)\b/;

// El "sin" de un producto llamado "Vainilla sin azúcar" no es una exclusión.
function protegerNombresConSin(t, productos) {
  let protegido = t;
  for (const p of Array.isArray(productos) ? productos : []) {
    const nombre = soloPalabras(p?.nombre);
    if (/\bsin\b/.test(nombre)) protegido = protegido.split(nombre).join(nombre.replace(/\bsin\b/g, SIN_DE_NOMBRE));
  }
  return protegido;
}

// Divide el mensaje en partes y dice cuáles piden y cuáles rechazan:
//  - negacion: alguna parte rechaza;  - exclusion: hay un "sin ..."
//  - pide: hay un pedido en pie;      - duda: "sin azúcar y una de mango" (no es claro qué abarca el "sin")
//  - positivo / rechazado: el texto donde buscar lo que pide y lo que no quiere
function analizarMensaje(mensaje, productos = []) {
  const t = protegerNombresConSin(normalizarTexto(mensaje).replace(MARCAS_INTERNAS, ''), productos)
    .replace(POR_QUE_NO_ME_DAS, '')
    .replace(SI_NO_ES_MOLESTIA, '')
    .replace(NO_IMPORTA, `, ${PARTE_SIN_PESO}`)
    .replace(CONECTOR_Y_PEDIDO, ', ');
  const restaurar = (texto) => texto.replace(/\u0003/g, 'i');
  const consulta = PALABRAS_DE_CONSULTA.test(t);

  const positivas = []; // { texto, despuesDeNegar }
  const rechazadas = [];
  let negacion = false;
  let exclusion = false;
  let duda = false;
  let condicion = false;
  for (const parte of t.split(SEPARADOR)) {
    if (!parte.trim()) continue;
    const corte = parte.search(/\bsin\b/);
    const inicio = corte < 0 ? parte : parte.slice(0, corte);
    const cola = corte < 0 ? '' : parte.slice(corte);
    if (NEGACION.test(inicio) || NEGACION_NI.test(inicio) || NEGACION.test(cola)) {
      negacion = true;
      condicion = condicion || CONDICION.test(parte);
      rechazadas.push(parte);
      positivas.length = 0; // lo pedido antes de una negación ya no es seguro
      continue;
    }
    if (parte.startsWith(PARTE_SIN_PESO)) continue;
    if (cola) {
      exclusion = true;
      duda = duda || OTRO_PEDIDO.test(cola);
      rechazadas.push(cola);
    }
    positivas.push(inicio);
  }

  let pide;
  if (negacion) {
    // Solo cuenta desde el primer pedido claro que venga después de la última negación.
    const desde = positivas.findIndex((p) => PEDIDO_CLARO.test(p));
    pide = desde >= 0 && !consulta && !condicion;
    positivas.splice(0, pide ? desde : positivas.length);
  } else {
    const texto = positivas.join(' ');
    pide = VERBOS_DE_CARRITO.test(texto) || (VERBOS_DE_DESEO.test(texto) && !consulta);
  }
  return {
    negacion, exclusion, duda, pide,
    positivo: restaurar(positivas.join(' ')),
    rechazado: restaurar(rechazadas.join(' ')),
  };
}

const tieneIntencionDeCompra = (mensaje) => analizarMensaje(mensaje).pide;

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

// Una palabra y su singular ("fresas" -> "fresa", "limones" -> "limon").
function variantes(palabra) {
  const formas = [palabra];
  if (palabra.endsWith('es')) formas.push(palabra.slice(0, -2));
  if (palabra.endsWith('s')) formas.push(palabra.slice(0, -1));
  return formas;
}

const listaDePalabras = (texto) => soloPalabras(texto).split(' ').filter(Boolean);
const palabrasClave = (nombre) => listaDePalabras(nombre).filter((p) => p.length >= MIN_LETRAS && !PALABRAS_GENERICAS.has(p));

// Productos cuyo nombre COMPLETO está en el texto (palabras seguidas). Los nombres largos van primero y
// "gastan" sus palabras: en "fresa salvaje" no cuenta además "Fresa". Devuelve también las palabras sin gastar.
function buscarNombresCompletos(palabras, productos) {
  const formas = palabras.map(variantes);
  const libres = palabras.map(() => true);
  const porNombre = new Map();
  for (const p of productos) {
    const nombre = listaDePalabras(p.nombre);
    // Un nombre de solo palabras genéricas ("Helado") no distingue un sabor.
    if (!nombre.some((n) => n.length >= 3 && !PALABRAS_GENERICAS.has(n))) continue;
    const clave = nombre.join(' ');
    if (!porNombre.has(clave)) porNombre.set(clave, { nombre, productos: [] });
    porNombre.get(clave).productos.push(p);
  }
  const completos = [];
  const grupos = [...porNombre.values()].sort((x, y) => y.nombre.length - x.nombre.length);
  for (const grupo of grupos) {
    const n = grupo.nombre.length;
    let aparece = false;
    for (let i = 0; i + n <= palabras.length; i++) {
      if (!grupo.nombre.every((parte, k) => libres[i + k] && formas[i + k].includes(parte))) continue;
      libres.fill(false, i, i + n);
      aparece = true;
    }
    if (aparece) completos.push(...grupo.productos);
  }
  return { completos, restantes: palabras.filter((_, i) => libres[i]) };
}

// Los que coinciden en más palabras clave con el texto.
function buscarPorPalabras(palabras, productos) {
  const presentes = new Set(palabras.flatMap(variantes));
  let mejores = [];
  let mejorPuntaje = 0;
  for (const p of productos) {
    const puntaje = palabrasClave(p.nombre).filter((c) => presentes.has(c)).length;
    if (puntaje === 0 || puntaje < mejorPuntaje) continue;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejores = []; }
    mejores.push(p);
  }
  return mejores;
}

// Productos que nombra el texto. Gana el nombre completo ("fresa" es "Fresa" aunque exista "Fresa Salvaje");
// si no hay, el que coincide en más palabras. Si quedan varios se devuelven todos (el que llama pregunta
// cuál); también si sobran palabras que apuntan a otro sabor. [] si no nombra ninguno.
function buscarProductos(texto, productos) {
  if (!Array.isArray(productos) || !texto) return [];
  const validos = productos.filter((p) => p && typeof p.nombre === 'string');
  const { completos, restantes } = buscarNombresCompletos(listaDePalabras(texto), validos);
  const otros = buscarPorPalabras(restantes, validos.filter((p) => !completos.includes(p)));
  return [...completos, ...otros];
}

// ¿El texto rechazado toca este producto? Basta UNA palabra de su nombre ("no quiero fresa" rechaza todas).
function estaRechazado(producto, rechazado) {
  if (!rechazado) return false;
  const palabras = listaDePalabras(rechazado);
  const presentes = new Set(palabras.flatMap(variantes));
  return palabrasClave(producto.nombre).some((c) => presentes.has(c)) || buscarNombresCompletos(palabras, [producto]).completos.length > 0;
}

// Palabras que acompañan un pedido sin cambiarle el sentido.
const RELLENO = new Set(('a al de del la el las los lo un una uno unos unas me y porfa porfavor porfis gracias helado helados gelato '
  + 'gelatos sabor copa vaso mejor entonces pues solo nada mas otro otra mi carrito docena docenas media').split(' '));
const PALABRAS_DE_PEDIDO = new Set(PEDIDOS_CLAROS.replace(/\?/g, '').split(/[| ]/).concat('da', 'regala', 'vende', 'pone'));
const SALUDOS_Y_AFIRMACIONES = new Set('hola buenas buenos dias tardes noches si dale listo ok okey claro bueno esa ese'.split(' '));
const POR_FAVOR = /\b(?:por favor|por fa|porfa|porfavor|porfis)\b/;
const ES_NUMERO = /^\d{1,2}$/;

// ¿El texto es solo el nombre de esos productos, con cantidad y cortesía? (nada de "una duda sobre la fresa").
function soloNombra(texto, productos, extra) {
  const nombres = new Set(productos.flatMap((p) => listaDePalabras(p.nombre)));
  return listaDePalabras(soloPalabras(texto).replace(POR_FAVOR, '')).every((p) =>
    RELLENO.has(p) || extra.has(p) || NUMEROS[p] || ES_NUMERO.test(p) || variantes(p).some((v) => nombres.has(v)));
}

// El texto sin el nombre del producto: en "dos tres leches", el "tres" es del nombre y no de la cantidad.
const sinNombre = (texto, producto) => buscarNombresCompletos(listaDePalabras(texto), [producto]).restantes.join(' ');
const leerCantidadDe = (texto, producto) => leerCantidad(sinNombre(texto, producto));

// Cuántas cantidades dice el texto ("una fresa y dos" dice dos; "media docena" es una sola).
function contarCantidades(texto) {
  return listaDePalabras(soloPalabras(texto).replace(/\b(?:[a-z0-9]{1,6} )?docenas?\b/g, 'seis'))
    .filter((p) => p === 'un' || p === 'una' || p === 'uno' || NUMEROS[p] || ES_NUMERO.test(p)).length;
}

// Pedido sin verbo: "dos de mango", "fresa por favor", o el sabor solo si el bot acaba de preguntar cuál.
// Solo vale si el mensaje no dice nada más y no pregunta.
function esPedidoSinVerbo(mensaje, positivo, encontrados, trasCual) {
  if (/[?¿]/.test(mensaje) || !soloNombra(positivo, encontrados, SALUDOS_Y_AFIRMACIONES)) return false;
  const texto = encontrados.reduce(sinNombre, positivo);
  return trasCual || contarCantidades(texto) > 0 || POR_FAVOR.test(soloPalabras(mensaje));
}

// A qué equivale el mensaje: { producto, cantidad }, { cual: [productos] } si hay que preguntar, o null si
// no es un pedido claro (decide el modelo, con sus propias defensas).
// trasCual: el último mensaje del bot preguntó cuál sabor quiere.
function resolverPedido(mensaje, productos, { trasCual = false } = {}) {
  const a = analizarMensaje(mensaje, productos);
  if (esConsulta(mensaje) || (a.negacion && !a.pide)) return null;
  const encontrados = buscarProductos(a.positivo, productos);
  if (!encontrados.length) return null;
  if (!a.pide && !esPedidoSinVerbo(mensaje, a.positivo, encontrados, trasCual)) return null;
  // Con una negación en el mensaje, el pedido tiene que ser limpio (nada de "quiero reclamar por la fresa").
  if (a.negacion && !soloNombra(a.positivo, encontrados, PALABRAS_DE_PEDIDO)) return null;
  const permitidos = encontrados.filter((p) => !estaRechazado(p, a.rechazado));
  if (a.duda) return { cual: [] };
  if (permitidos.length !== 1) return { cual: permitidos };
  const [producto] = permitidos;
  if (!a.pide && contarCantidades(sinNombre(a.positivo, producto)) > 1) return { cual: permitidos };
  return { producto, cantidad: leerCantidadDe(a.positivo, producto) };
}

module.exports = {
  normalizarTexto,
  analizarMensaje,
  tieneIntencionDeCompra,
  resolverPedido,
  estaRechazado,
  esConsulta,
  preguntaPrecio,
  esAfirmacion,
  botOfrecioAgregar,
  botPreguntoCual,
  leerCantidad,
  leerCantidadDe,
  buscarProductos,
  MAX_CANTIDAD,
};
