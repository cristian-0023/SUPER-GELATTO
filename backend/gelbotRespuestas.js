// Gelbot: TODOS los textos que reciben los clientes y los visitantes (opción A, decisión del dueño, 2026-11-25).
// Regla de oro: el modelo solo ayuda a entender qué pide la persona (un tema o una herramienta). Ningún texto suyo
// llega al cliente: aquí se arma cada respuesta con plantillas fijas y datos de la base o de la ficha.
//  - paraCliente: la frontera. Toda respuesta a un cliente sale por aquí y solo con estos campos.
//  - TEXTOS / textoDeTema: las plantillas de cada tema (2 o 3 variantes elegidas sin azar, según el mensaje).
//  - temaPorPalabras: si el modelo no da un tema claro (o está caído), el servidor entiende lo básico solo.
//  - textos con datos: precio, carrito, pedidos, Super Points y helado 3D (números de la base, nunca del modelo).
// Nombres de productos: los escribe un admin; siempre pasan por nombreVisible (sin *, `, saltos ni invisibles).
const { imagenProductoValida } = require('./imagenProducto');
const { soloPalabras, analizarMensaje, preguntaPrecio } = require('./gelbotIntencion');
const { nombreVisible, NO_VISIBLES } = require('./gelbotTexto');
const { pideOtraCosa } = require('./gelbotMenu');

// ── La frontera ───────────────────────────────────────────────
// Solo estos campos, con valores del servidor. action: null, 'addToCart' o 'closeChat'.
function paraCliente({ response, action = null, product = null, quantity, productos } = {}) {
  const salida = { response: String(response || TEXTOS.otro[0]), action: ['addToCart', 'closeChat'].includes(action) ? action : null, product: product || null };
  if (salida.action === 'addToCart' && Number.isInteger(quantity)) salida.quantity = quantity;
  if (Array.isArray(productos) && productos.length) salida.productos = productos;
  return salida;
}

// ── Entrada ───────────────────────────────────────────────────
// Letras de ancho completo y otras formas raras a su forma normal (NFKC), y fuera los caracteres invisibles (con
// ellos "fre\u200bsa" no se reconocería como "fresa"). Se aplica al mensaje del cliente antes de todo.
const normalizarEntrada = (mensaje) => String(mensaje || '').normalize('NFKC').replace(NO_VISIBLES, (c) => (c === '\n' || c === '\t' ? ' ' : ''));

// Historial: solo turnos { role: 'user'|'assistant', content: texto } (nada de 'system' ni 'tool'), los últimos 20.
const MAX_LARGO_MENSAJE = 1000;
const MAX_HISTORIAL = 20;
function limpiarHistorial(history) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORIAL)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LARGO_MENSAJE) }));
}
// Último mensaje del bot (para entender "sí", "dale" o un sabor suelto).
function ultimoMensajeDelBot(history) {
  const turnos = limpiarHistorial(history);
  for (let i = turnos.length - 1; i >= 0; i--) if (turnos[i].role === 'assistant') return turnos[i].content;
  return '';
}

// ── Productos ─────────────────────────────────────────────────
const formatearCOP = (valor) => '$' + new Intl.NumberFormat('es-CO').format(Number(valor) || 0);
const MAX_PRODUCTOS_TARJETAS = 24;

// Tarjetas con foto: de la base, solo activos, máximo 24 y con la URL de la imagen validada.
function productosParaTarjetas(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((p) => p && p.estado !== false && Number.isInteger(Number(p.id_producto)) && typeof p.nombre === 'string')
    .slice(0, MAX_PRODUCTOS_TARJETAS)
    .map((p) => ({ id: p.id_producto, nombre: nombreVisible(p.nombre), precio: p.precio, image: imagenProductoValida(p.imagen) }));
}
// Producto que recibe el carrito del navegador (el carrito no usa la descripción: no se manda).
const productoParaCarrito = (p) => ({ id: p.id_producto, nombre: nombreVisible(p.nombre), precio: p.precio, image: imagenProductoValida(p.imagen) });

const textoInfoProducto = (p) =>
  `**${nombreVisible(p.nombre)}** cuesta **${formatearCOP(p.precio)}**. Si lo quieres, dime "agrégalo" y lo pongo en tu carrito 🍦`;
function textoAgregadoAlCarrito(p, cantidad = 1) {
  const nombre = nombreVisible(p.nombre);
  if (cantidad > 1) return `¡Excelente elección! 🍦 ${cantidad} × **${nombre}** (${formatearCOP(p.precio)} c/u) añadidos a tu carrito. ¿Deseas algo más?`;
  return `¡Excelente elección! 🍦 **${nombre}** (${formatearCOP(p.precio)}) fue añadido a tu carrito. ¿Deseas algo más?`;
}
// Varios sabores coinciden (o ninguno claro): se pregunta cuál, sin precios ni agregar nada.
function textoCualProducto(lista = []) {
  if (!lista.length) return '¿Cuál sabor quieres? 🍦';
  return `¿Cuál de estos quieres? ${lista.slice(0, 5).map((p) => `**${nombreVisible(p.nombre)}**`).join(', ')} 🍦`;
}

const MENSAJE_SABORES = 'Estos son nuestros sabores 🍦 Toca uno para agregarlo al carrito.';
const MENSAJE_SIN_SABORES = 'En este momento no tengo sabores para mostrarte 🍦 Inténtalo más tarde.';
const MENSAJE_PRECIOS = 'Cada tarjeta muestra el precio del sabor 🍦 Toca uno para agregarlo al carrito.';
const MENSAJE_NADA_AGREGADO_RELATO = 'Entendido, no puse nada en tu carrito 🍦 Cuéntame en qué te puedo ayudar.';
const MENSAJE_NADA_AGREGADO = 'Entendido, no puse nada en tu carrito 🍦 ¿Cuál sabor quieres?';

// aviso: una línea extra (por ejemplo "Ojo: la ficha de ... indica Azúcar de caña.").
const respuestaAgregar = (p, cantidad, aviso = '') => ({
  response: aviso ? `${textoAgregadoAlCarrito(p, cantidad)}\n${aviso}` : textoAgregadoAlCarrito(p, cantidad),
  action: 'addToCart', product: productoParaCarrito(p), quantity: cantidad,
});
const respuestaCual = (lista) => ({ response: textoCualProducto(lista), action: null, product: null });
// Pidió sin decir el sabor ("quiero un helado"): se pregunta con el menú a la vista.
function respuestaElegirSabor(productos) {
  const tarjetas = productosParaTarjetas(productos);
  return { response: tarjetas.length ? '¿Cuál sabor quieres? 🍦 Estos son los que tenemos:' : '¿Cuál sabor quieres? 🍦', action: null, product: null, productos: tarjetas };
}
function respuestaMenu(productos, texto = MENSAJE_SABORES) {
  const tarjetas = productosParaTarjetas(productos);
  return { response: tarjetas.length ? texto : MENSAJE_SIN_SABORES, action: null, product: null, productos: tarjetas };
}

// ── Temas ─────────────────────────────────────────────────────
const TEMAS = ['saludo', 'despedida', 'gracias', 'menu', 'precio', 'ficha', 'alergenos', 'agregar', 'pedidos', 'pagar', 'superpoints',
  'personalizado', 'queja', 'ayuda', 'contacto', 'quien', 'otro'];

// Sin "agrégalo" ni "cuál": esas palabras harían que un "sí" o un sabor suelto después agregaran algo.
const TEXTOS = {
  saludo: [
    '¡Hola! Soy Gelbot 🍦 Puedo mostrarte el menú, decirte el precio o los ingredientes de un sabor, o agregar uno a tu carrito.',
    '¡Hola, qué gusto saludarte! Soy Gelbot 🍦 ¿Te muestro el menú o buscas un sabor en especial?',
    '¡Bienvenido a Super Gelatto! Soy Gelbot 🍦 Pídeme el menú, el precio de un sabor o sus ingredientes.',
  ],
  despedida: ['¡Gracias por visitarnos! Vuelve pronto 🍦', '¡Hasta pronto! Que disfrutes tu helado 🍦'],
  gracias: ['¡Con gusto! ¿Te ayudo con algo más? 🍦', '¡Para eso estoy! 🍦 Si quieres, te muestro el menú.', '¡Gracias a ti! 🍦 Aquí sigo si necesitas algo más.'],
  pagar: [
    'Para pagar, abre tu carrito 🛒 y pulsa «Continuar al Pago». Ahí revisas tu pedido y eliges PSE, Nequi o Botón Bancolombia. Necesitas tener la sesión iniciada.',
    'El pago se hace desde tu carrito 🛒: pulsa «Continuar al Pago», revisa tu pedido y elige PSE, Nequi o Botón Bancolombia. Recuerda tener la sesión iniciada.',
    'Abre tu carrito 🛒 y pulsa «Continuar al Pago»: ahí confirmas tu pedido y pagas con PSE, Nequi o Botón Bancolombia (con la sesión iniciada).',
  ],
  // Preguntan por efectivo, Daviplata, tarjeta...: solo se dice lo que existe en la tienda.
  mediosPago: 'En la tienda se paga en línea con PSE, Nequi o Botón Bancolombia 🛒 Abre tu carrito y pulsa «Continuar al Pago».',
  ayuda: [
    'Te ayudo con gusto 🍦 Puedo mostrarte el menú, decirte el precio o los ingredientes de un sabor, agregar uno a tu carrito o contarte cómo pagar.',
    'Claro, te ayudo 🍦 Puedo enseñarte los sabores, darte precios e ingredientes, armar tu carrito y mostrarte tus pedidos.',
    'Con mucho gusto 🍦 Puedo mostrarte los sabores con su precio, contarte sus ingredientes y ayudarte con tu carrito.',
  ],
  // Rechaza o cuenta algo de un sabor ("no me gusta el mango"): sin precio ni oferta.
  neutro: 'Entendido 🍦 Si quieres, te muestro el menú para que encuentres otro sabor.',
  varios: 'Aquí tienes los sabores que nombraste 🍦 Toca el que prefieras para agregarlo al carrito.',
  superpoints: 'Con cada compra ganas Super Points y puedes usarlos para pagar parte de tus siguientes compras. Tu saldo y tu nivel están en tu Perfil.',
  personalizado: 'Puedes crear tu propio helado en el creador 3D de la página de inicio: ahí eliges envase, sabores y toppings, y ves el precio al momento.',
  queja: 'Siento mucho lo que pasó 🙏 Desde el chat no puedo resolver reclamos: pídele ayuda al equipo de Super Gelatto. El estado de tus pedidos está en tu Perfil, en «Tus Pedidos».',
  contacto: [
    'No tengo ese dato; pregúntale al equipo de Super Gelatto 🍦 Aquí puedo mostrarte el menú, los precios y los ingredientes de cada sabor, y armar tu carrito.',
    'No tengo ese dato; pregúntale al equipo de Super Gelatto 🍦 Mientras tanto, te puedo mostrar los sabores o ayudarte con tu carrito.',
    'No tengo ese dato; pregúntale al equipo de Super Gelatto 🍦 Yo te ayudo con el menú, los precios, los ingredientes y tu carrito.',
  ],
  quien: 'Soy Gelbot, el asistente virtual de Super Gelatto 🍦 Te ayudo con el menú, los precios y los ingredientes de cada sabor, y con tu carrito.',
  otro: [
    'No estoy seguro de haberte entendido. Puedo mostrarte el menú, el precio o los ingredientes de un sabor, o agregar uno a tu carrito 🍦',
    'Perdona, no te entendí bien 🍦 Pídeme el menú, el precio o los ingredientes de un sabor, o agregar uno a tu carrito.',
    'Mmm, no logré entenderte 🍦 Puedo ayudarte con el menú, los precios, los ingredientes de cada sabor o tu carrito.',
  ],
  pedidosSinSesion: 'Para ver tus pedidos inicia sesión 🍦 Luego los encuentras en tu Perfil, en «Tus Pedidos».',
  pedidosVacio: 'Aún no tienes pedidos registrados 🍦 Cuando compres, los verás aquí y en tu Perfil.',
  pedidosError: 'No pude consultar tus pedidos en este momento. Míralos en tu Perfil, en «Tus Pedidos».',
};

// La misma variante para el mismo mensaje (sin azar: las respuestas se pueden probar).
function variante(opciones, mensaje) {
  const lista = [opciones].flat();
  const semilla = Array.from(soloPalabras(mensaje)).reduce((suma, c) => (suma + c.charCodeAt(0)) % 9973, 0);
  return lista[semilla % lista.length];
}

// ── Textos con datos de la base ───────────────────────────────
const esPositivo = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });

// pedidos: lo que devuelve functions.getOrders (lista, { message } sin pedidos, o { error }).
function textoPedidos(pedidos) {
  if (!Array.isArray(pedidos)) return pedidos?.error ? TEXTOS.pedidosError : TEXTOS.pedidosVacio;
  const lineas = pedidos.slice(0, 5).map((p) => {
    const id = Number.isSafeInteger(Number(p?.id_venta)) ? Number(p.id_venta) : null;
    const fecha = new Date(p?.fecha);
    const partes = [id !== null ? `Pedido #SG-${id}` : 'Pedido'];
    if (!Number.isNaN(fecha.getTime())) partes.push(FORMATO_FECHA.format(fecha));
    if (Number.isFinite(Number(p?.total))) partes.push(formatearCOP(p.total));
    const estado = nombreVisible(p?.estado).replace(/\d/g, '').slice(0, 30).trim();
    if (estado) partes.push(estado);
    return `• ${partes.join(' · ')}`;
  });
  if (!lineas.length) return TEXTOS.pedidosVacio;
  return ['Estos son tus últimos pedidos:', ...lineas, 'El detalle está en tu Perfil, en «Tus Pedidos».'].join('\n');
}

// reglas: lo que devuelve public.super_points_reglas() (o null si no se pudo leer).
function textoPuntos(reglas) {
  const niveles = Array.isArray(reglas?.niveles) ? reglas.niveles.slice(0, 10) : [];
  const validos = niveles.every((n) => typeof n?.nombre === 'string' && nombreVisible(n.nombre) && esPositivo(n.pct) && n.pct <= 100);
  if (!esPositivo(reglas?.pesos_por_punto) || !esPositivo(reglas?.valor_punto) || !niveles.length || !validos) return TEXTOS.superpoints;
  const topes = niveles.map((n) => `${nombreVisible(n.nombre).replace(/\d/g, '').slice(0, 20).trim()} ${n.pct} %`).join(', ');
  return `Con Super Points ganas 1 punto por cada ${formatearCOP(reglas.pesos_por_punto)} que pagas, y cada punto vale ${formatearCOP(reglas.valor_punto)} al usarlo en una compra. `
    + `Según tu nivel puedes pagar con puntos hasta: ${topes}. Tu saldo y tu nivel están en tu Perfil.`;
}

// datos: { componentes: [{ tipo, precio }], reglas: { max_sabores, max_toppings } } (o null).
function textoPersonalizado(datos) {
  const componentes = Array.isArray(datos?.componentes) ? datos.componentes : [];
  const desde = (tipo) => {
    const precios = componentes.filter((c) => c?.tipo === tipo).map((c) => Number(c.precio)).filter(esPositivo);
    return precios.length ? Math.min(...precios) : null;
  };
  const [envase, sabor, topping] = ['envase', 'sabor', 'topping'].map(desde);
  const { max_sabores: maxSabores, max_toppings: maxToppings } = datos?.reglas || {};
  if (!envase || !sabor || !topping || !Number.isInteger(maxSabores) || !Number.isInteger(maxToppings) || maxSabores < 1 || maxSabores > 10 || maxToppings < 0 || maxToppings > 10) {
    return TEXTOS.personalizado;
  }
  return `Puedes crear tu propio helado en el creador 3D de la página de inicio: eliges un envase (desde ${formatearCOP(envase)}), `
    + `de 1 a ${maxSabores} sabores (desde ${formatearCOP(sabor)} c/u) y hasta ${maxToppings} toppings (desde ${formatearCOP(topping)} c/u). Ahí mismo ves el precio final.`;
}

// ── El servidor entiende lo básico solo ───────────────────────
// Para cuando el modelo no da un tema válido (escribió texto, JSON roto, herramienta inventada, caído, sin llave).
// "gracias" ya no despide: solo adiós, chao, hasta luego, nos vemos, me voy...
const DESPEDIDA = /\b(?:adios|chao|chau|hasta luego|hasta pronto|hasta manana|nos vemos|bye|me voy|me retiro)\b/;
const QUEJA = /\b(?:reclam\w*|quej\w*|derreti\w*|no (?:me )?(?:llego|ha llegado|carga|funciona|sirve|gusto|gustan|gustaron)|nunca llego|cobra(?:ron|do) (?:dos|doble|de mas)|reembols\w*|devoluci\w*|estafa\w*|pesim\w*|horrible|mal servicio|(?:esta|estan|estuvo|fue|muy) mal[oa]?s?|problemas?|equivoc\w*|llego otro|nadie me (?:responde|contesta)|molest[oa]s?|furios[oa]|enojad[oa])\b/;
// Pide ayuda o pregunta qué puede hacer Gelbot (no es una queja). "gracias por la ayuda" no cuenta.
const AYUDA = /\b(?:ayuda|ayudame|ayudarme|me ayudas|me puedes ayudar|puedes ayudarme|soporte|que puedes hacer|que sabes hacer|en que me (?:puedes )?ayudar|como funcionas)\b/;
const GRACIAS_POR_AYUDA = /\bgracias por (?:la|tu|su) ayuda\b/g;
const AYUDA_CON_SABOR = /\b(?:sabor\w*|helados?|escoger|elegir|pedir|recomend\w*|menu|carta)\b/;
const MEDIOS_PAGO = /\b(?:efectivo|daviplata|tarjetas?|credito|debito|transferencia|paypal|contraentrega|contra entrega)\b/;
const CARO = /\b(?:caro|caros|cara|caras|costos[oa]s?|barat[oa]s?|economic[oa]s?)\b/;
const PEDIDOS = /\b(?:mis? (?:pedidos?|ordene?s?|compras|facturas?|recibos?|historial)|donde esta mi|estado de mi|ya pague|mi factura|que he comprado)\b/;
const PAGAR = /\b(?:pagar|pago|pague|pagos|(?:ver|ir al|abrir|abre|donde esta el|mi) carrito|checkout|tarjetas?|efectivo|nequi|pse|bancolombia|daviplata|credito|debito|transferencia|contraentrega|contra entrega)\b/;
const PUNTOS = /\b(?:super ?points?|puntos?|nivel(?:es)?)\b/;
const PERSONALIZADO = /\b(?:3d|personaliz\w*|armar\w*|arma mi|mi propio|creador)\b/;
const CONTACTO = /\b(?:horarios?|hora|abren|abre|cierran|cierra|abiert[oa]s?|domingos?|festivos?|direccion|ubica\w*|donde (?:estan|quedan|queda|esta la tienda)|telefonos?|whatsapp|celular|contacto|correo|email|domicilios?|envios?|envian|entregas?|delivery|sucursal\w*|locales|tiendas?|promo\w*|descuentos?|cupon\w*|humano|asesor\w*|gerente|located)\b/;
const QUIEN = /\b(?:quien eres|que eres|eres (?:un |una )?(?:bot|robot|humano|ia|persona|maquina|real)|como te llamas|tu nombre|que haces)\b/;
const SALUDO = /^(?:hola+|ola+|holi\w*|buenas|buen dia|buenos dias|buenas (?:tardes|noches)|hey|hello|hi|que tal|q tal|que mas|k onda|que onda|saludos)\b/;
const GRACIAS = /\b(?:gracias|grasias|thanks|thank you|te agradezco|muy amable)\b/;

// tema ('producto' = no hay tema, pero nombra un sabor del catálogo: lo decide quien llama) y si van tarjetas.
// Si nombra un sabor, ni saludo ni gracias ("qué tal el mango" pregunta por el mango).
function temaPorPalabras(mensaje, { nombraProducto = false } = {}) {
  const t = soloPalabras(mensaje).slice(0, MAX_LARGO_MENSAJE);
  const sinGraciasPorAyuda = t.replace(GRACIAS_POR_AYUDA, 'gracias');
  const reglas = [[QUEJA, 'queja'], [PEDIDOS, 'pedidos'], [PAGAR, 'pagar'], [AYUDA, 'ayuda'], [PERSONALIZADO, 'personalizado'], [PUNTOS, 'superpoints'],
    [QUIEN, 'quien'], [CONTACTO, 'contacto'], [DESPEDIDA, 'despedida'], ...(nombraProducto ? [] : [[SALUDO, 'saludo'], [GRACIAS, 'gracias']])];
  const encontrado = reglas.find(([patron]) => patron.test(sinGraciasPorAyuda));
  if (encontrado) return encontrado[1];
  if (nombraProducto) return 'producto';
  if (preguntaPrecio(mensaje) || CARO.test(t)) return 'precio';
  return 'otro';
}

// ¿Las palabras del mensaje respaldan un tema de baja gravedad que eligió el modelo? (queja, despedida, pedidos)
const RESPALDO = { queja: QUEJA, despedida: DESPEDIDA, pedidos: PEDIDOS };
const respaldaTema = (tema, mensaje) => !RESPALDO[tema] || RESPALDO[tema].test(soloPalabras(mensaje));
// ¿El mensaje rechaza o cuenta algo? (entonces no se ofrece agregar)
const rechazaOCuenta = (mensaje, productos) => {
  const { negacion, relato } = analizarMensaje(mensaje, productos);
  return negacion || relato;
};

// "otro" muestra el menú, salvo en quejas, rechazos o si pide otra cosa ("dame un momento", "quiero un descuento").
// Tampoco si el mensaje anterior del bot ya fue un "no te entendí" (fuera de tema repetido: el menú ya está a la vista).
function otroConTarjetas(mensaje, productos, textoBot = '') {
  const t = soloPalabras(mensaje);
  const { negacion, relato } = analizarMensaje(mensaje, productos);
  const yaSeMostro = TEXTOS.otro.some((v) => String(textoBot).includes(v));
  return !negacion && !relato && !QUEJA.test(t) && !pideOtraCosa(t) && !yaSeMostro;
}

// Texto de un tema sin datos ni producto (los demás los arma quien llama). null si el tema necesita datos.
function respuestaDeTemaFijo(tema, mensaje, productos, textoBot = '') {
  const t = soloPalabras(mensaje);
  if (tema === 'despedida') return { response: variante(TEXTOS.despedida, mensaje), action: 'closeChat' };
  if (tema === 'pagar') return { response: MEDIOS_PAGO.test(t) ? TEXTOS.mediosPago : variante(TEXTOS.pagar, mensaje) };
  if (tema === 'ayuda') {
    const texto = variante(TEXTOS.ayuda, mensaje);
    return AYUDA_CON_SABOR.test(t) ? respuestaMenu(productos, `${texto} Estos son nuestros sabores:`) : { response: texto };
  }
  if (['saludo', 'gracias', 'queja', 'contacto', 'quien'].includes(tema)) return { response: variante(TEXTOS[tema], mensaje) };
  if (tema === 'menu') return respuestaMenu(productos);
  if (tema === 'agregar') return respuestaElegirSabor(productos);
  if (tema === 'otro') {
    const texto = variante(TEXTOS.otro, mensaje);
    return { response: texto, ...(otroConTarjetas(mensaje, productos, textoBot) ? { productos: productosParaTarjetas(productos) } : {}) };
  }
  return null;
}

module.exports = {
  paraCliente, normalizarEntrada, limpiarHistorial, ultimoMensajeDelBot, formatearCOP, productosParaTarjetas, productoParaCarrito,
  textoInfoProducto, textoAgregadoAlCarrito, textoCualProducto, respuestaAgregar, respuestaCual, respuestaElegirSabor, respuestaMenu,
  textoPedidos, textoPuntos, textoPersonalizado, temaPorPalabras, respaldaTema, rechazaOCuenta, respuestaDeTemaFijo, TEMAS, TEXTOS, MENSAJE_SABORES, MENSAJE_PRECIOS,
  MENSAJE_NADA_AGREGADO, MENSAJE_NADA_AGREGADO_RELATO, MAX_LARGO_MENSAJE, MAX_PRODUCTOS_TARJETAS,
};
