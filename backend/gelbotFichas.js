// Gelbot: ingredientes, alérgenos y dietas. Los responde el servidor con la ficha (datosSabores), NUNCA el modelo.
// Regla de oro: es un tema de salud. Ante la duda no se agrega al carrito, no se deduce nada y no se promete nada:
// se muestra lo que dice la ficha, o se dice que no está registrada, y siempre se remite al equipo.
//  - leerConsultaFicha: ¿el mensaje pregunta por la ficha? ¿de qué productos? ¿además hace un pedido?
//  - respuestaFicha / textoFicha: los textos (sin palabras que armen un "sí, agrégalo": ver gelbotIntencion)
//  - hablaDeSalud: ¿este texto del modelo da datos de ingredientes o salud? (entonces no se muestra)
// Nombres y etiquetas vienen de la base: se comparan como texto, nunca como regex ni como instrucciones.
const { soloPalabras, soloNombra, variantes, SEPARADOR, analizarMensaje, resolverPedido, buscarProductos, preguntaPrecio } = require('./gelbotIntencion');
const { fichaPropia } = require('./datosSabores');

// ── Textos ────────────────────────────────────────────────────
const CONFIRMA = 'Si tienes alergia, confirma con el equipo antes de comer: puede haber contacto cruzado.';
const AVISO = `⚠️ Es la información de la ficha. ${CONFIRMA}`;
const AVISO_SIN_FICHA = `⚠️ ${CONFIRMA}`;
const PIDE_SABOR = 'te muestro su ficha'; // con esta frase se reconoce, en el turno siguiente, un sabor suelto
const INICIO_FICHA = 'Esto dice la ficha de';
const NOMBRE_PERSONALIZADO = 'Helado personalizado 3D';
const MAX_LISTA = 40;
const MENSAJE_CONSULTA_FICHA = `Ese dato no te lo puedo dar de memoria: está en la ficha de cada sabor, o pregúntale al equipo. Dime el nombre de un sabor y ${PIDE_SABOR} 🍦\n${AVISO_SIN_FICHA}`;

// ── Vocabulario ───────────────────────────────────────────────
const ALERGENO = '(?:leche|lacteos?|lactosa|huevos?|yemas?|gluten|trigo|frutos secos|nuez|nueces|mani|cacahuates?|almendras?|avellanas?|pistachos?|coco|cacao|cafeina|cafe|avena|soya|soja|miel|mantequilla|crema de leche|mascarpone|alcohol|licor|gelatina|azucar|azucares|endulzantes?|edulcorantes?|colorantes?|conservantes?)';
const LISTA_ALERGENOS = `${ALERGENO}(?: (?:y|o|u|e|ni)(?: sin)? ${ALERGENO})*`;
const ALGO_DE = '(?: (?:algo|algun|alguna|rastros?|trazas?|nada|mucha?|poca?|cuanta?)(?: de)?)?';
// También pueden ser sabores del menú: "¿tienen coco?" pregunta si hay, no qué lleva.
const TAMBIEN_SABOR = /\b(?:coco|pistachos?|cacao|cafe|miel|almendras?|avellanas?|mani|nuez|nueces|licor|mantequilla)\b/;

// Declara una condición, o pide "sin" algo que es de salud: aunque pida un sabor, primero ve la ficha.
const CONDICION_DE_SALUD = new RegExp('\\b(?:alergi\\w*|intoleran\\w*|celiac\\w*|diabet\\w*'
  + '|(?:sin|libres? de) (?:lactosa|lacteos?|leche|gluten|trigo|huevos?|frutos secos|nuez|nueces|mani|cacahuates?|soya|soja))\\b');
// Preguntas que no dejan duda.
const PREGUNTA_FUERTE = new RegExp('\\b(?:ingredientes?|alergen\\w*|lacteos?|lactosa|gluten|frutos secos|vegan\\w*|vegetarian\\w*|calori\\w*|nutri(?:cion|cional|cionales|entes?)|engorda\\w*'
  + '|(?:esta|estan|es|son) hech[oa]s? (?:de|con)|de que (?:esta|estan|es|son) hech[oa]s?|hech[oa]s? con|con que (?:esta|estan|lo|la|los|las|se) (?:hech[oa]s?|hacen?|preparan?)'
  + '|que le (?:ponen|echan)|(?:libres? de|sin) ' + ALERGENO + ')\\b');
const HECHO = /\bhech[oa]s?\b/;
// "tiene leche", "lleva huevo", "no puedo tomar leche": el verbo y el alérgeno seguidos.
const VERBO_Y_ALERGENO = new RegExp('\\b(?:tienen?|tengan?|contienen?|contengan?|llevan?|lleven?|traen?|traigan?|incluyen?|hay|usan|come|como|comer|tomo|tomar|consumo|consumir|tolero|tolera)'
  + `${ALGO_DE} (?:(?:la|el|los) (?=leche|huevos?|gluten|lactosa))?${LISTA_ALERGENOS}\\b`);
const CUANTO_ALERGENO = new RegExp(`\\bcuant[oa]s? ${ALERGENO}\\b`);
// Solo cuentan si nombran un sabor ("¿qué lleva la fresa?", no "¿qué lleva mi pedido?").
const PREGUNTA_DEBIL = new RegExp('\\b(?:que (?:es lo que )?(?:tienen?|llevan?|contienen?|traen?|incluyen?)(?! de\\b)'
  + '|como (?:(?:se|lo|la|los|las) )?(?:hacen?|preparan?)|como (?:esta|estan) hech[oa]s?|pued(?:o|e|en|es) (?:comer|tomar|consumir)(?:l[oa]s?)?|apt[oa]s?|segur[oa]s?|hacen? dano|caen? mal)\\b');
const DEL_PEDIDO = /\b(?:mi|mis|el|un|nuestro) (?:pedidos?|orden|carrito|compras?|domicilio|envio|cuenta|factura)\b/;
const PIDE_INFORMACION = /\b(?:quiero|quisiera|necesito|me gustaria) que me (?:dig|cuent|expli|inform|aclar)\w*/;
const PERSONALIZADO = /\b(?:personalizad[oa]s?|creador|3d)\b/;
const PREGUNTA_NUTRICION = /\b(?:calori\w*|nutri(?:cion|cional|cionales|entes?)|engorda\w*)\b/;
const PREGUNTA_CUANTO_CUESTA = /\b(?:cuesta|cuestan|precios?|vale|valen)\b/;

// Pregunta por todo el menú, aunque nombre un sabor ("soy alérgico al coco, ¿qué puedo comer?").
const SOBRE_TODOS = new RegExp('\\b(?:cual(?:es)?|que (?:helados?|sabores|sabor|gelatos?|opciones|puedo|puede|podria|me recom\\w*)'
  + '|algun(?:o|a|os|as)?(?= (?:helados?|sabor|sabores|gelatos?|que|sin|con|vegan\\w*)\\b|$)|algo (?:sin|que|vegan\\w*|libre)|ningun\\w*|tod[oa]s (?:los|las|sus) (?:helados|sabores|gelatos))\\b');
const CUAL_DATO = /\bcual(?:es)? (?:es|son) (?:el|la|los|las|su|sus) (?=(?:ingredientes?|alergenos?|calorias|componentes|lista|informacion|valor))/g;
// Habla en singular de algo ya nombrado ("¿y tiene huevo?").
const HABLA_DE_UNO = /\b(?:tiene|contiene|lleva|trae|incluye|es|esta|comerl[oa]|tomarl[oa])\b|^(?:y )?(?:los |las |sus )?(?:ingredientes|calorias|alergenos)$/;

// Trozos que nombran un alérgeno y no el sabor por el que preguntan: se quitan antes de buscar el producto.
const ALERGICO_A = /\b(?:alergi\w*|intoleran\w*) (?:al?|de|por) (?:(?:la|el|los|las) )?(frutos secos|crema de leche|[a-z0-9]+(?: (?:y|e|o|ni) (?:al? )?(?:(?:la|el|los|las) )?[a-z0-9]+){0,4})/g;
const TROZOS_DE_ALERGENO = new RegExp('\\b(?:tienen?|tengan?|contienen?|contengan?|llevan?|lleven?|traen?|traigan?|incluyen?|hay|usan|come|como|comer|tomo|tomar|consumo|consumir|tolero|tolera|sin|libres? de|cuant[oa]s?)'
  + `${ALGO_DE} ((?:(?:la|el|los) (?=leche|huevos?|gluten|lactosa))?${LISTA_ALERGENOS})\\b`, 'g');
const FRUTOS_SECOS = /\bfrutos secos\b/g;

const CANONICO = {
  leche: 'lacteos', lactosa: 'lacteos', lacteo: 'lacteos', lacteos: 'lacteos', yema: 'huevo', yemas: 'huevo', huevos: 'huevo', cafe: 'cafeina', trigo: 'gluten', chocolate: 'cacao',
  pistachos: 'pistacho',
};

// Dietas: la etiqueta la pone la tienda (tags); si la ficha la contradice, no se cita.
const DIETAS = [
  { nombre: 'vegano', pregunta: /\bvegan\w*/, etiqueta: 'vegano', choca: ['lacteos', 'huevo'] },
  { nombre: 'vegetariano', pregunta: /\bvegetarian\w*/, etiqueta: 'vegetariano', choca: [] },
  { nombre: 'sin gluten', pregunta: /\b(?:gluten|celiac\w*)\b/, etiqueta: 'sin gluten', choca: ['gluten', 'avena'] },
  { nombre: 'sin lácteos', pregunta: /\b(?:lacteos?|lactosa)\b/, etiqueta: 'sin lacteos', choca: ['lacteos'] },
  { nombre: 'sin azúcar', pregunta: /\b(?:sin azucar\w*|diabet\w*)\b/, etiqueta: 'sin azucar', choca: ['azucar'] },
];

// ── Productos y fichas ────────────────────────────────────────
const conVariantes = (texto) => new Set(soloPalabras(texto).split(' ').flatMap(variantes));
const alergenosDe = (ficha) => ficha.allergens.filter((a) => soloPalabras(a) !== 'ninguno');
const etiquetasDe = (p) => (typeof p.tags === 'string' ? p.tags.split(',') : Array.isArray(p.tags) ? p.tags : []).filter((t) => typeof t === 'string');

// Como buscarProductos, y además por la palabra de la ficha ("chocolate" -> Cioccolato Nero) si nadie se
// nombró completo. "pistacho" nombra entonces a los dos pistachos, y se pregunta de cuál.
function productosNombrados(texto, productos) {
  const encontrados = buscarProductos(texto, productos);
  const palabras = conVariantes(texto);
  const completo = encontrados.some((p) => {
    const clave = soloPalabras(p.nombre).split(' ').filter((w) => w.length >= 3 && w !== 'helado' && w !== 'del');
    return clave.length > 0 && clave.every((w) => palabras.has(w));
  });
  if (completo) return encontrados;
  const porFicha = productos.filter((p) => !encontrados.includes(p) && fichaPropia(p?.nombre)?.keys.some((k) => palabras.has(soloPalabras(k))));
  return [...encontrados, ...porFicha];
}

// El sabor del que venía hablando el bot: los nombres que puso en negrita.
function productosDelBot(textoBot, productos) {
  const negritas = (String(textoBot || '').match(/\*\*[^*\n]{1,120}\*\*/g) || []).slice(0, MAX_LISTA);
  return negritas.length ? buscarProductos(negritas.join(' '), productos) : [];
}

// El mensaje sin los nombres de productos que por sí solos parecen una pregunta ("Vainilla sin azúcar").
function sinNombresEnganosos(t, productos) {
  let limpio = t;
  for (const p of productos) {
    const nombre = soloPalabras(p?.nombre);
    if (nombre.includes(' ') && (PREGUNTA_FUERTE.test(nombre) || CONDICION_DE_SALUD.test(nombre))) limpio = limpio.split(nombre).join('producto');
  }
  return limpio;
}

// ── ¿Pregunta por la ficha? ───────────────────────────────────
// 'salud' (declara una condición), 'pregunta', 'atributo' ("sin azúcar") o null.
function tipoDePregunta(t, hayProducto) {
  if (CONDICION_DE_SALUD.test(t)) return 'salud';
  const delPedido = DEL_PEDIDO.test(t);
  const fuerte = t.match(PREGUNTA_FUERTE);
  if (fuerte && !(delPedido && HECHO.test(fuerte[0]))) return fuerte[0].startsWith('sin ') ? 'atributo' : 'pregunta';
  if (delPedido) return null;
  if (CUANTO_ALERGENO.test(t)) return 'pregunta';
  const conVerbo = t.match(VERBO_Y_ALERGENO);
  if (conVerbo) {
    const puedeSerSabor = TAMBIEN_SABOR.test(conVerbo[0]) && !hayProducto && !SOBRE_TODOS.test(t);
    if (!puedeSerSabor) return 'pregunta';
  }
  return hayProducto && PREGUNTA_DEBIL.test(t) ? 'pregunta' : null;
}

// Lo que preguntan sin los alérgenos nombrados, y esos alérgenos.
function separarAlergenos(t) {
  const alergenos = [];
  const guardar = (_todo, nombrado) => { alergenos.push(nombrado); return ' '; };
  const sujeto = t.replace(ALERGICO_A, guardar).replace(TROZOS_DE_ALERGENO, guardar).replace(FRUTOS_SECOS, (todo) => guardar(todo, todo));
  return { sujeto, alergenos: alergenos.join(' ') };
}

const PALABRAS_DE_SEGUIMIENTO = new Set('y e que tal hola si ok dale pues ese esa'.split(' '));

// Un sabor suelto ("¿y el mango?", "fresa salvaje por favor") después de que el bot habló de fichas.
function esSeguimiento(mensaje, textoBot, productos) {
  if (preguntaPrecio(mensaje) || analizarMensaje(mensaje, productos).pide) return [];
  const bot = String(textoBot || '');
  const pidioSabor = bot.includes(PIDE_SABOR);
  if (!pidioSabor && !bot.includes(INICIO_FICHA)) return [];
  if (!pidioSabor && resolverPedido(mensaje, productos)) return []; // "dos de mango" sí es un pedido
  const nombrados = productosNombrados(mensaje, productos);
  const claves = nombrados.flatMap((p) => fichaPropia(p.nombre)?.keys || []);
  return nombrados.length && soloNombra(mensaje, nombrados, new Set([...PALABRAS_DE_SEGUIMIENTO, ...claves])) ? nombrados : [];
}

// Pedido claro en otra parte del mensaje: "agrégame una fresa, ¿qué ingredientes contiene?".
function hayPedidoAparte(mensaje, productos) {
  if (!analizarMensaje(mensaje, productos).pide) return false;
  const partes = mensaje.split(SEPARADOR).filter((parte) => {
    const t = soloPalabras(parte);
    return t && !PIDE_INFORMACION.test(t) && tipoDePregunta(t, true) === null;
  });
  return partes.length > 0 && resolverPedido(partes.join(', '), productos) !== null;
}

// null si el mensaje no pregunta por la ficha. Si pregunta: { productos (vacío = todo el menú), personalizado,
// alergenos (los que nombró), texto, pedido }. pedido: 'no' = no se agrega nada; 'aparte' = además pide en otra
// parte del mensaje; 'posible' = "sin azúcar" es un atributo: si es un pedido claro, gana el pedido.
function leerConsultaFicha(mensaje, textoBot, catalogo) {
  const productos = (Array.isArray(catalogo) ? catalogo : []).filter((p) => p && typeof p.nombre === 'string' && p.nombre.trim());
  const completo = soloPalabras(mensaje).replace(CUAL_DATO, '');
  const t = sinNombresEnganosos(completo, productos);
  const { alergenos, sujeto } = separarAlergenos(t);
  const nombrados = productosNombrados(t === completo ? sujeto : completo, productos);

  const tipo = tipoDePregunta(t, nombrados.length > 0 || PERSONALIZADO.test(t));
  if (!tipo) {
    const seguimiento = esSeguimiento(mensaje, textoBot, productos);
    return seguimiento.length ? { productos: seguimiento, alergenos: '', pedido: 'no', texto: t } : null;
  }
  const consulta = { productos: [], alergenos, pedido: 'no', texto: t };
  if (tipo === 'atributo') consulta.pedido = 'posible';
  else if (tipo === 'pregunta' && hayPedidoAparte(mensaje, productos)) consulta.pedido = 'aparte';

  if (PERSONALIZADO.test(t) && !nombrados.length) return { ...consulta, personalizado: true };
  if (SOBRE_TODOS.test(t)) return consulta;
  if (nombrados.length) return { ...consulta, productos: nombrados };
  if (HABLA_DE_UNO.test(t)) {
    const delBot = productosDelBot(textoBot, productos);
    if (delBot.length === 1) return { ...consulta, productos: delBot };
  }
  return consulta;
}

// ── Respuestas ────────────────────────────────────────────────
const enumerar = (lista) => (lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}` : lista.join(''));
const textoSinFicha = (nombre) =>
  `No tengo la lista de ingredientes de **${nombre}**: su ficha de alérgenos no está registrada. Pregúntale al equipo antes de pedirlo.`;

// Lo que se sabe de una dieta: { etiqueta } de la tienda, { registra } alérgenos que la contradicen, o {} (sin dato).
function datoDeDieta(dieta, producto, ficha) {
  const registrados = alergenosDe(ficha).filter((a) => dieta.choca.includes(soloPalabras(a)));
  const etiqueta = etiquetasDe(producto).find((e) => soloPalabras(e) === dieta.etiqueta);
  const ingredienteChoca = ficha.ingredients.some((i) => soloPalabras(i).split(' ').some((w) => dieta.choca.includes(w)));
  if (etiqueta) return registrados.length || ingredienteChoca ? {} : { etiqueta: etiqueta.trim() };
  return registrados.length ? { registra: enumerar(registrados) } : {};
}

function lineaDeDieta(dieta, producto, ficha) {
  const { etiqueta, registra } = datoDeDieta(dieta, producto, ficha);
  if (etiqueta) return `• La tienda lo etiqueta como "${etiqueta}".`;
  if (registra) return `• Sobre ${dieta.nombre}: la ficha registra ${registra}.`;
  return `• Sobre ${dieta.nombre}: no tengo esa información.`;
}

function lineaDeNutricion({ calorias, grasas, carbos, proteinas }) {
  return `• Calorías: ${calorias} · grasas: ${grasas} · carbohidratos: ${carbos} · proteínas: ${proteinas}`;
}

// La ficha completa de UN producto (o que no está registrada), siempre con el aviso al final.
function textoFicha(producto, texto = '') {
  const ficha = fichaPropia(producto.nombre);
  if (!ficha) return `${textoSinFicha(producto.nombre)}\n${AVISO_SIN_FICHA}`;
  const alergenos = alergenosDe(ficha);
  return [
    `${INICIO_FICHA} **${producto.nombre}**:`,
    `• Ingredientes: ${ficha.ingredients.join(', ')}`,
    alergenos.length ? `• Alérgenos: ${alergenos.join(', ')}` : '• Alérgenos: la ficha no registra alérgenos',
    ...DIETAS.filter((d) => d.pregunta.test(texto)).map((d) => lineaDeDieta(d, producto, ficha)),
    ...(PREGUNTA_NUTRICION.test(texto) ? [lineaDeNutricion(ficha.nutrition)] : []),
    AVISO,
  ].join('\n');
}

// Ingredientes que nombran lo que preguntó, si la ficha no lo registra ya como alérgeno (la de Matcha no
// registra coco, pero lleva aceite de coco).
const SIN_PESO = new Set('a al de la el los las y e o u ni sin algo algun alguna nada mucha mucho poca poco rastro rastros traza trazas'.split(' '));
function ingredientesQueNombran(ficha, alergenos) {
  const registrados = new Set(alergenosDe(ficha).map((a) => soloPalabras(a)));
  const buscadas = soloPalabras(alergenos).split(' ').filter((w) => w.length >= 3 && !SIN_PESO.has(w) && !registrados.has(w) && !registrados.has(CANONICO[w]));
  if (!buscadas.length) return [];
  const formas = new Set(buscadas.flatMap(variantes));
  return ficha.ingredients.filter((i) => soloPalabras(i).split(' ').flatMap(variantes).some((w) => formas.has(w)));
}

function lineaDeLista(producto, dietas, { alergenos, texto }) {
  const ficha = fichaPropia(producto.nombre);
  if (!ficha) return `• **${producto.nombre}**: ficha no registrada: pregunta al equipo`;
  const registrados = alergenosDe(ficha);
  const nombran = ingredientesQueNombran(ficha, alergenos);
  const etiquetas = dietas.map((d) => datoDeDieta(d, producto, ficha).etiqueta).filter(Boolean);
  return `• **${producto.nombre}**: ${registrados.length ? registrados.join(', ') : 'la ficha no registra alérgenos'}`
    + (nombran.length ? ` (entre sus ingredientes: ${nombran.join(', ')})` : '')
    + (etiquetas.length ? ` (etiqueta de la tienda: ${etiquetas.join(', ')})` : '')
    + (PREGUNTA_NUTRICION.test(texto) ? ` (calorías: ${ficha.nutrition.calorias})` : '');
}

// El menú completo con los alérgenos que registra cada ficha. Nunca se omite un sabor sin ficha.
function textoLista(productos, consulta) {
  const dietas = DIETAS.filter((d) => d.pregunta.test(consulta.texto));
  const sinDato = dietas.filter((d) => !productos.some((p) => fichaPropia(p.nombre) && datoDeDieta(d, p, fichaPropia(p.nombre)).etiqueta));
  return [
    `Estos son los alérgenos que registra la ficha de cada helado. Dime el nombre de un sabor y ${PIDE_SABOR} con todos sus ingredientes:`,
    ...productos.slice(0, MAX_LISTA).map((p) => lineaDeLista(p, dietas, consulta)),
    ...(productos.length > MAX_LISTA ? [`…y ${productos.length - MAX_LISTA} más: pregúntame por su nombre.`] : []),
    ...sinDato.map((d) => `Sobre ${d.nombre}: no tengo esa información.`),
    AVISO,
  ].join('\n');
}

const textoDeQueSabor = (productos) =>
  `Dime el nombre de un sabor y ${PIDE_SABOR}: ${productos.slice(0, 6).map((p) => `**${p.nombre}**`).join(', ')}.\n${AVISO_SIN_FICHA}`;

// Respuesta lista para el cliente. formatearPrecio: para "¿cuánto cuesta y qué lleva?" (el precio sale de la base).
function respuestaFicha(consulta, catalogo, formatearPrecio) {
  const { productos, texto } = consulta;
  let response;
  if (consulta.personalizado) response = `${textoSinFicha(NOMBRE_PERSONALIZADO)}\n${AVISO_SIN_FICHA}`;
  else if (productos.length > 1) response = textoDeQueSabor(productos);
  else if (productos.length === 1) {
    const [producto] = productos;
    const precio = PREGUNTA_CUANTO_CUESTA.test(texto) ? `**${producto.nombre}** cuesta **${formatearPrecio(producto.precio)}**.\n` : '';
    response = precio + textoFicha(producto, texto);
  } else {
    const conNombre = catalogo.filter((p) => p && typeof p.nombre === 'string' && p.nombre.trim());
    response = conNombre.length ? textoLista(conNombre, consulta) : MENSAJE_CONSULTA_FICHA;
  }
  return { response, action: null, product: null };
}

// ── Filtro del texto del modelo ───────────────────────────────
const SALUD = new RegExp('\\b(?:ingredientes?|alergen\\w*|alergi\\w*|intoleran\\w*|celiac\\w*|diabet\\w*|gluten|lactosa|lacteos?|leche|huevos?|yemas?|frutos secos|nuez|nueces|mani'
  + '|vegan\\w*|vegetarian\\w*|calori\\w*|sin azucar\\w*|(?:es|son|seria) segur[oa]s?|apt[oa]s? para|contacto cruzado|contiene trazas)\\b');
function hablaDeSalud(texto, catalogo) {
  let t = soloPalabras(texto);
  if (!SALUD.test(t)) return false;
  for (const p of Array.isArray(catalogo) ? catalogo : []) {
    const nombre = soloPalabras(p?.nombre);
    if (nombre && SALUD.test(nombre)) t = t.split(nombre).join(' ');
  }
  return SALUD.test(t);
}

module.exports = { leerConsultaFicha, respuestaFicha, textoFicha, hablaDeSalud, MENSAJE_CONSULTA_FICHA };
