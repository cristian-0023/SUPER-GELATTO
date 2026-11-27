// Figura 3 · "El mesero que solo lee del menú impreso" (el chatbot Gelbot para clientes).
// Un intérprete (la IA de Groq) escucha al cliente y solo entrega una tarjeta con un tema.
// El mesero (el servidor) toma el menú impreso (plantillas y datos de la base) y lee la respuesta.
// Lo que escribe el intérprete va a la papelera: nunca llega al cliente.
// Uso: node gelbot-mesero.mjs   (escribe ../gelbot-mesero.svg y ../gelbot-mesero.html)
import { k, helpers, basePlate, namePlate, staticSvg, livePage, write } from "./common.mjs";

const WIDTH = 720;
const HEIGHT = 300;
const BASE = { x: -262, y: -96, w: 520, d: 170, r: 10 };

const P = k.fitProjection(
  [...k.boxCorners(BASE, -15, 0), [-230, -60, 70], [40, -70, 70], [180, -60, 70]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 55 },
);
const { at, S, L, D } = helpers(P);

// Una caja con tapa, tornillos y una línea de unión.
function caja(plan, h, tone = "mid") {
  const out = [S(k.slabOf(plan, 0, h, P, 4, 0.5), { tone, inner: L(k.sideSeam(plan, h * 0.55, P, 4), { tone: "faint" }) })];
  out.push(L(k.planOutline(k.insetPlan(plan, 2.4), h, P, 4), { tone: "lo" }));
  const tornillos = k.corners(plan, 4);
  out.push(D(tornillos.map(([x, y]) => at([x, y, h])), { size: 0.45 }));
  return out.join("");
}

// 1 · Cliente: cuerpo, cabeza y un globo con tres renglones.
function cliente() {
  const out = [];
  out.push(S(k.cylinder(-218, -22, 11, 0, 3, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(-218, -22, 8, 3, 26, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(-218, -22, 5.6, 29, 5, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(-218, -22, 6.4, 34, 12, P, 24, 1), { tone: "hi" }));
  const globo = { x: -200, y: -42, w: 42, d: 3, r: 1.2 };
  out.push(S(k.slabOf(globo, 40, 20, P, 3, 0.4), { tone: "mid" }));
  const frente = globo.y + globo.d;
  const renglones = [47, 52, 57].map((z, i) => k.segment([globo.x + 5, frente, z], [globo.x + globo.w - 5 - i * 6, frente, z], P));
  out.push(L(renglones.join(""), { tone: "hi" }));
  return out.join("");
}

// 2 · Intérprete (la IA): una cabina con una oreja y una ranura por donde sale UNA tarjeta con un tema.
function interprete() {
  const out = [];
  const plan = { x: -140, y: -44, w: 62, d: 46, r: 3 };
  out.push(caja(plan, 34));
  out.push(S(k.cylinder(-109, -21, 9, 34, 4, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(-109, -21, 6, 38, 14, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(-109, -21, 12, 52, 3, P, 24, 0.6), { tone: "hi" })); // la oreja que escucha
  const tarjeta = { x: -124, y: 4, w: 30, d: 2, r: 0.6 };
  out.push(S(k.slabOf(tarjeta, 16, 16, P, 3, 0.3), { tone: "lit" })); // la tarjeta del tema
  const frente = tarjeta.y + tarjeta.d;
  out.push(L([20, 25, 30].map((z) => k.segment([tarjeta.x + 4, frente, z], [tarjeta.x + tarjeta.w - 4, frente, z], P)).join(""), { tone: "lo" }));
  return out.join("");
}

// Papelera: aquí cae todo lo que escribe el intérprete.
function papelera() {
  const out = [S(k.cylinder(-176, 34, 13, 0, 24, P, 28, 0.6), { tone: "lo" })];
  out.push(S(k.cylinder(-176, 34, 10.5, 24, 1.4, P, 28), { tone: "faint", crease: "none" }));
  return out.join("");
}

// 3 · Mesero (el servidor): cuerpo, cabeza y una bandeja con la respuesta.
function mesero() {
  const out = [];
  out.push(S(k.cylinder(-12, -18, 12, 0, 3, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(-12, -18, 9, 3, 32, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(-12, -18, 9.6, 22, 3, P, 24), { tone: "lo" })); // cinturón
  out.push(S(k.cylinder(-12, -18, 6.4, 35, 11, P, 24, 1), { tone: "hi" }));
  const bandeja = { x: 6, y: -32, w: 34, d: 24, r: 5 };
  out.push(S(k.slabOf(bandeja, 30, 2.4, P, 8, 0.6), { tone: "hi" }));
  out.push(S(k.cylinder(23, -20, 6, 32.4, 4, P, 20), { tone: "lit" })); // el plato servido
  return out.join("");
}

// 4 · Menú impreso: una pizarra con renglones fijos (plantillas) y precios.
function menu() {
  const out = [];
  for (const x of [66, 126]) out.push(S(k.slabOf({ x: x - 2, y: -30, w: 4, d: 14, r: 1 }, 0, 3, P, 3), { tone: "lo" }));
  const tablero = { x: 62, y: -26, w: 68, d: 5, r: 1.6 };
  out.push(S(k.slabOf(tablero, 3, 52, P, 4, 0.6), { tone: "mid" }));
  const frente = tablero.y + tablero.d;
  const filas = [];
  for (const z of [14, 22, 30, 38, 46]) {
    filas.push(k.segment([tablero.x + 6, frente, z], [tablero.x + 40, frente, z], P));
    filas.push(k.segment([tablero.x + 48, frente, z], [tablero.x + tablero.w - 6, frente, z], P));
  }
  out.push(L(filas.join(""), { tone: "lo" }));
  out.push(L(k.segment([tablero.x + 5, frente, 51], [tablero.x + tablero.w - 5, frente, 51], P), { tone: "hi" }));
  return out.join("");
}

// 5 · Base de datos y fichas: cajones con las fichas de cada sabor.
function bodega() {
  const out = [];
  const plan = { x: 164, y: -50, w: 62, d: 52, r: 3 };
  out.push(caja(plan, 40, "mid"));
  const frente = plan.y + plan.d;
  for (const z of [10, 22, 34]) {
    out.push(L(k.segment([plan.x + 6, frente, z], [plan.x + plan.w - 6, frente, z], P), { tone: "lo" }));
    out.push(D([at([plan.x + plan.w / 2, frente, z - 3.2])], { size: 0.7 }));
  }
  return out.join("");
}

// Riel del piso que une las piezas (el camino del mensaje).
function riel() {
  const plan = { x: -240, y: 8, w: 480, d: 7, r: 2 };
  return S(k.slabOf(plan, 0, 1.6, P, 4), { tone: "lo", crease: "none" });
}

const piezas = [
  [-218, -22, cliente],
  [-109, -21, interprete],
  [-176, 34, papelera],
  [-12, -18, mesero],
  [96, -24, menu],
  [195, -24, bodega],
];

const plates = [
  [{ x: -246, y: 22, w: 60 }, "1 CLIENTE"],
  [{ x: -152, y: 44, w: 76 }, "2 INTÉRPRETE"],
  [{ x: -34, y: 10, w: 50 }, "3 MESERO"],
  [{ x: 70, y: 10, w: 66 }, "4 MENÚ"],
  [{ x: 168, y: 10, w: 64 }, "5 FICHAS"],
];

function drawing() {
  const ordenadas = [...piezas].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  return [
    basePlate(P, BASE, { extraFeet: [[-31, -92], [-31, 70]] }),
    riel(),
    ...ordenadas.map(([, , f]) => f()),
    ...plates.map(([plan, text]) => namePlate(P, { ...plan, d: 12 }, text, { size: 7.6 })),
  ].join("");
}

const LABEL =
  "El mesero que solo lee del menú impreso. En fila sobre un banco: el cliente con un globo de texto; el intérprete (la IA), una cabina con una oreja que solo entrega una tarjeta con un tema, y a su lado una papelera donde cae todo lo que escribe; el mesero (el servidor), con una bandeja; el menú impreso con renglones fijos; y las fichas de los sabores en cajones.";
const LEGEND = [
  { n: "1", name: "Cliente", what: "escribe en el chat" },
  { n: "2", name: "Intérprete (IA de Groq)", what: "solo elige un tema" },
  { n: "3", name: "Mesero (el servidor)", what: "arma y entrega la respuesta" },
  { n: "4", name: "Menú impreso", what: "plantillas fijas por tema" },
  { n: "5", name: "Fichas y base de datos", what: "precios e ingredientes" },
  { n: "!", name: "Papelera", what: "el texto del modelo se descarta" },
];
const CAPTION =
  "El cliente escribe. El intérprete (la IA, un modelo de Groq) solo puede devolver una tarjeta con un tema o una herramienta; todo lo que escriba se descarta. El mesero (el servidor) lee la respuesta del menú impreso, es decir, de las plantillas de cada tema, y toma los precios y las fichas de ingredientes de la base de datos. Si el intérprete falla, el servidor entiende lo básico con sus propias palabras clave. Para el administrador el flujo es otro: ver docs/chatbot_documentation.md.";

write(
  "gelbot-mesero.svg",
  staticSvg({
    width: WIDTH,
    height: HEIGHT,
    drawing: drawing(),
    label: LABEL,
    fig: "Fig 3",
    title: "El mesero que solo lee del menú",
    hint: "Versión interactiva: gelbot-mesero.html",
    readout: "una llamada al modelo · respuesta del servidor",
    legend: LEGEND,
    caption: CAPTION,
  }),
);

const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL, body: drawing() });
const plate = k.plateHtml({
  fig: "Fig 3",
  title: "El mesero que solo lee del menú",
  hint: "Figura estática",
  readout: "una llamada al modelo · respuesta del servidor",
  keys: [
    { mark: "lit", label: "La tarjeta con el tema y el plato servido" },
    { mark: "raised", label: "Las piezas del chat" },
  ],
  caption: CAPTION,
  body: `<div class="iso-stage" role="img" aria-label="${LABEL.replace(/"/g, "&quot;")}">${svg}</div>`,
});
write("gelbot-mesero.html", livePage({ title: "El mesero que solo lee del menú", plate, script: "" }));
