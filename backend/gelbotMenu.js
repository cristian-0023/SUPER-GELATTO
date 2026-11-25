// Gelbot: ¿el cliente necesita ver el menú con fotos? (pide sin decir el sabor, pide el menú o una recomendación)
// Devuelve 'servidor' (inequívoco: lo responde el servidor con las tarjetas), 'modelo' (responde el modelo y el
// servidor adjunta las tarjetas) o null. Nunca en quejas, precios, ni si ya nombró un sabor del catálogo.
const { soloPalabras, analizarMensaje, buscarProductos, esConsulta, preguntaPrecio } = require('./gelbotIntencion');

const MENU = '(?:menu|carta|catalogo|sabores|helados|gelatos)';
const ANTES_DE_MENU = '(?: (?:el|la|los|las|sus|tus|su|tu|de|todos|todas|que|cuales|son|mas|otros|otras|tipos|clases|variedad|lista)){0,4}';
const PIDE_MENU = new RegExp(`\\b(?:ver|veo|conocer|mirar|muestra(?:me|nos)?|muestre(?:me|nos)?|mostrar(?:me|nos)?|ensena(?:me|nos)?|dame|deme|pasame|me (?:das|pasas|muestras|ensenas)|quiero|quisiera|hay|tienen|tienes|manejan|venden|ofrecen)${ANTES_DE_MENU} ${MENU}\\b`);
const QUE_SABORES = /\b(?:que|cuales|cuantos) (?:(?:son|otros|tipos?|clases?|variedad|de|los|sus|las) ){0,3}(?:sabores|helados|gelatos|opciones)\b/;
const SABORES_DISPONIBLES = /\b(?:sabores|helados|gelatos|opciones) (?:disponibles?|hay|tienen|tienes|manejan|venden|ofrecen)\b/;
const QUE_VENDEN = /^(?:hola |buenas )?que (?:hay|venden|tienen|ofrecen|manejan)(?: hoy| disponible| de rico| para hoy| para ofrecer)?$/;
const MENU_SOLO = new RegExp(`^(?:hola |buenas )?(?:el |la |los |sus )?${MENU}(?: por favor| porfa| disponibles?| completo| completa)?$`);
const pideMenu = (t) => [PIDE_MENU, QUE_SABORES, SABORES_DISPONIBLES, QUE_VENDEN, MENU_SOLO].some((r) => r.test(t));

const RECOMENDACION = /\b(?:recomiend(?:a|as|ame|anos|eme|en|an)|recomendar(?:me|nos)?|recomendacion(?:es)?|sugier(?:es|eme|ame)|sugieres|sugerencias?|me aconsejas)\b|\b(?:cual|que) (?:es|son) (?:el|los) (?:mejor|mejores|mas (?:ricos?|vendidos?|pedidos?|populares?))\b/;

// Palabras de un pedido que no dice el sabor: si el mensaje es solo esto, no hace falta el modelo.
const PALABRAS_SIN_SABOR = new Set(('hola buenas buenos dias tardes noches quiero quisiera dame deme me das da pones pone regala regalas regalame necesito gustaria provoca antoja antojo antojado '
  + 'ponme traeme sirveme vendeme pasame un una uno unos unas el la los las lo de del al a y algo alguno alguna cosa helado helados gelato gelatos sabor sabores rico ricos rica delicioso deliciosa dulce frio '
  + 'fresco refrescante bueno buena postre comprar pedir ordenar comer probar tomar llevar otro otra mas por favor porfa porfis gracias hoy ahora ya si ok pues entonces para mi '
  + 'dos tres cuatro cinco seis siete ocho nueve diez docena media').split(' '));
const soloPideHelado = (t) => t.split(' ').every((p) => PALABRAS_SIN_SABOR.has(p) || /^\d{1,2}$/.test(p));

// "quiero mi factura", "dame tu teléfono", "quiero un descuento": no está pidiendo un helado.
const OTRA_COSA = new RegExp('\\b(?:mis?|tus?|sus?|nuestr[oa]s?|factura|recibo|cuenta|pedidos?|orden|domicilios?|envio|ayuda|soporte|direccion|ubicacion|telefono|numero|celular|whatsapp|correo|email|contacto'
  + '|humano|persona|asesor\\w*|gerente|administrador|admin|root|momento|minuto|segundo|rato|tiempo|opinion|trabajo|empleo|contrasena|clave|sesion|registr\\w*|descuentos?|cupon\\w*|puntos|plata|dinero|reembolso'
  + '|horarios?|foto|fotos|informacion|info|datos|usuarios?|ventas?|permiso|acceso|carrito|pago|pagar|tarjeta|efectivo|que|chiste|consejos?|abrazo|beso|paz|animo|gracias)\\b');
const NO_SE = /\bno se(?: (?:que|cual)(?: (?:pedir|comprar|elegir|escoger|quiero|comer|probar))?)?\b/g;

const PARA_ALGUIEN = /\bpara (?:mis?|tus?|sus?|nuestr[oa]s?) [a-z]+\b/g; // para mi mamá no es mi factura
const QUIERE_VER = /\b(?:quiero|quisiera|necesito|me gustaria) (?=(?:ver|conocer|mirar) )/g; // no es queja ni rechazo
const HACER_PEDIDO = /^(?:hola |buenas )?(?:quiero|quisiera|me gustaria|necesito|puedo|como puedo) (?:hacer|realizar) (?:un|mi) pedido(?: por favor)?$/;

function leerPedidoDeMenu(mensaje, productos) {
  const t = soloPalabras(soloPalabras(mensaje).replace(PARA_ALGUIEN, ' '));
  if (preguntaPrecio(mensaje) || buscarProductos(mensaje, productos).length) return null;
  if (HACER_PEDIDO.test(t)) return 'servidor';
  // "no sé qué pedir, recomiéndame algo" no rechaza nada.
  const { pide, negacion, relato } = analizarMensaje(t.replace(NO_SE, ' ').replace(QUIERE_VER, ''), productos);
  if ((negacion || relato) && !pide) return null;
  if (RECOMENDACION.test(t)) return 'servidor';
  if (pideMenu(t)) return 'modelo';
  if (!pide || esConsulta(mensaje) || !analizarMensaje(mensaje, productos).pide) return null;
  if (soloPideHelado(t)) return 'servidor';
  return OTRA_COSA.test(t) ? null : 'modelo';
}

module.exports = { leerPedidoDeMenu };
