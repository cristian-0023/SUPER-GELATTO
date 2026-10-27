// Figura 2 · "El viaje de una compra" (flujo).
// Una cinta transportadora lleva el pedido por cuatro estaciones:
// carrito (CartContext) → pago (POST /api/payments/process) → caja registradora (registrar_venta)
// → tablero de estados con buzón (correo al cliente al cambiar el estado).
// Uso: node viaje-compra.mjs   (escribe ../viaje-compra.svg y ../viaje-compra.html)
import { k, helpers, basePlate, namePlate, staticSvg, livePage, write } from "./common.mjs";

const WIDTH = 720;
const HEIGHT = 305;
const BASE = { x: -272, y: -122, w: 520, d: 176, r: 10 };
const BELT_Y = 15.5;
const STOP = { carrito: -212, pago: -92, caja: 0, estados: 124 };
const LAMP_X = [100, 118, 136, 154];
const ESTADOS = ["Pagado", "En proceso", "Enviado", "Entregado"];
const TRIES_MAX = 10;
const DIAL = { x: -122, y: -24, r: 8.4, z: 33 };

const P = k.fitProjection(
  [...k.boxCorners(BASE, -15, 0), [-92, -24, 48], [14, -40, 44], [205, -30, 40], [-230, -46, 40]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 60 },
);
const { at, S, L, D, byDepth } = helpers(P);

function belt() {
  const out = [];
  const back = { x: -254, y: 2, w: 482, d: 3, r: 0.8 };
  for (const x of [-246, -120, 0, 120, 220]) out.push(S(k.slabOf({ x: x - 3, y: 0, w: 6, d: 31, r: 1 }, 0, 2, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf(back, 2, 9, P, 3, 0.4), { tone: "mid" }));
  const band = { x: -250, y: 5, w: 474, d: 21, r: 3 };
  const slats = [];
  for (let x = band.x + 8; x < band.x + band.w - 6; x += 12) slats.push(k.lineOnTop([x, band.y], [x, band.y + band.d], 9, P));
  out.push(S(k.slabOf(band, 5, 4, P, 4), { tone: "lo", inner: L(slats.join(""), { tone: "faint" }) }));
  return out.join("");
}

function beltFront() {
  const out = [];
  const front = { x: -254, y: 26, w: 482, d: 3, r: 0.8 };
  out.push(S(k.slabOf(front, 2, 9, P, 3, 0.4), { tone: "mid" }));
  const dots = [];
  for (let x = front.x + 10; x < front.x + front.w; x += 40) dots.push(at([x, 27.5, 11]));
  out.push(D(dots, { size: 0.42 }));
  for (const x of [-258, 228]) out.push(S(k.slabOf({ x, y: 0, w: 4, d: 31, r: 1 }, 2, 11, P, 3, 0.4), { tone: "mid" }));
  return out.join("");
}

function carrito() {
  const out = [];
  const chassis = { x: -234, y: -48, w: 36, d: 30, r: 2 };
  for (const [x, y] of byDepth(k.corners(chassis, 3))) out.push(S(k.cylinder(x, y, 2.6, 0, 4.4, P, 18), { tone: "lo" }));
  out.push(S(k.slabOf(chassis, 4.4, 2.2, P, 3, 0.3), { tone: "mid" }));
  for (const [x, y] of byDepth(k.corners(chassis, 4))) out.push(S(k.cylinder(x, y, 0.9, 6.6, 5.4, P, 10), { tone: "mid", crease: "none" }));
  const basket = { x: -236, y: -50, w: 40, d: 34, r: 2 };
  const mesh = [];
  for (let x = basket.x + 5; x < basket.x + basket.w; x += 5) mesh.push(k.segment([x, basket.y + basket.d, 12], [x, basket.y + basket.d, 26], P));
  for (let y = basket.y + 5; y < basket.y + basket.d; y += 5) mesh.push(k.segment([basket.x + basket.w, y, 12], [basket.x + basket.w, y, 26], P));
  out.push(S(k.slabOf(basket, 12, 14, P, 3, 0.4), { tone: "mid", inner: L(mesh.join("") + k.sideSeam(basket, 19, P, 3), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(basket, 1.6), 26, P, 3), { tone: "lo" }));
  // asa del carrito
  for (const y of [-46, -20]) out.push(S(k.cylinder(-234, y, 0.9, 26, 12, P, 10), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: -235.4, y: -50, w: 2.8, d: 34, r: 1.2 }, 38, 2.4, P, 3), { tone: "mid" }));
  // helados dentro del carrito
  for (const [x, y] of byDepth([[-222, -40], [-210, -36], [-216, -26]])) {
    out.push(S(k.cylinder(x, y, 4, 26, 4, P, 20), { tone: "mid" }));
    out.push(S(k.cylinder(x, y, 4.8, 30, 3.6, P, 20, 1), { tone: "hi", crease: "lo" }));
  }
  return out.join("");
}

function dialNeedle(tries) {
  const span = (300 * Math.PI) / 180, from = (120 * Math.PI) / 180;
  const a = from + (span * Math.min(tries, TRIES_MAX)) / TRIES_MAX;
  const tip = [DIAL.x + Math.cos(a) * (DIAL.r - 0.3), DIAL.y + Math.sin(a) * (DIAL.r - 0.3)];
  const tail = [DIAL.x - Math.cos(a) * 2, DIAL.y - Math.sin(a) * 2];
  return k.lineOnTop(tail, tip, DIAL.z + 0.2, P);
}

function pago() {
  const out = [];
  const foot = { x: -152, y: -50, w: 44, d: 32, r: 2 };
  const body = { x: -150, y: -48, w: 40, d: 28, r: 2 };
  out.push(S(k.slabOf(foot, 0, 3, P, 4), { tone: "lo" }));
  out.push(S(k.slabOf(body, 3, 27, P, 4, 0.5), { tone: "mid", inner: L(k.sideSeam(body, 8, P, 4), { tone: "faint" }) }));
  // teclado y ranura de tarjeta
  const keys = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) keys.push(at([-145 + i * 4.4, -43 + j * 4.4, 30]));
  out.push(D(keys, { size: 0.75, tone: "mid" }));
  out.push(L(k.planOutline({ x: -146, y: -26, w: 14, d: 1.4, r: 0.6 }, 30, P, 3), { tone: "lo" }));
  // pantallita
  out.push(S(k.slabOf({ x: -128, y: -45, w: 14, d: 8, r: 1 }, 30, 2.4, P, 3), { tone: "hi", crease: "lo" }));
  // contador de intentos: 10 marcas, una por intento permitido por minuto
  out.push(S(k.cylinder(DIAL.x, DIAL.y, DIAL.r + 1.4, 30, 3, P, 40, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.ring(DIAL.x, DIAL.y, DIAL.r, DIAL.z, P, 40), { tone: "lo" }));
  const ticks = k.radialTicks(DIAL.x, DIAL.y, DIAL.r, TRIES_MAX, 1, DIAL.z, [1.6, 1.6], P, (120 * Math.PI) / 180, (300 * Math.PI) / 180 * (1 + 1 / TRIES_MAX));
  out.push(L(ticks.minor + ticks.major, { tone: "mid" }));
  out.push(`<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" d="${dialNeedle(0)}" style="stroke-width:1"/>`);
  out.push(D([at([DIAL.x, DIAL.y, DIAL.z + 0.2])], { size: 0.8, tone: "hi" }));
  return out.join("");
}

function scanner() {
  const out = [];
  out.push(S(k.cylinder(-92, -24, 4, 0, 2, P, 20), { tone: "lo" }));
  out.push(S(k.cylinder(-92, -24, 2.2, 2, 42, P, 18), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: -96, y: -28, w: 8, d: 44, r: 1.2 }, 44, 4, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([-92, -24, 48]), at([-92, 12, 48])], { size: 0.45 }));
  const head = { x: -99, y: 8, w: 14, d: 12, r: 1.6 };
  out.push(S(k.slabOf(head, 38, 6, P, 3, 0.4), { tone: "hi", crease: "lo", inner: L(k.sideSeam(head, 40.5, P, 3), { tone: "faint" }) }));
  return out.join("");
}

// Papelera donde caen las etiquetas de precio del navegador (no se usan).
function bin() {
  const out = [];
  const b = { x: -82, y: -30, w: 16, d: 16, r: 2 };
  out.push(S(k.slabOf(b, 0, 11, P, 4, 0.4), { tone: "mid", inner: L(k.segment([-74, -14, 0], [-74, -14, 11], P), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(b, 1.4), 11, P, 4), { tone: "lo" }));
  out.push(`<g data-part="bin-tag" opacity="0">${S(k.slabOf({ x: -78, y: -25, w: 8, d: 6, r: 0.4 }, 11, 0.8, P, 2), { tone: "hi", crease: "lo" })}</g>`);
  return out.join("");
}

function ledgers() {
  const out = [];
  [{ y: -50, name: "venta" }, { y: -32, name: "detalle" }].forEach(({ y }, book) => {
    const cover = { x: -60, y, w: 24, d: 15, r: 1 };
    out.push(S(k.slabOf(k.insetPlan(cover, -0.8), 0, 1.6, P, 3), { tone: "mid" }));
    for (let i = 0; i < 3; i++) {
      const sheet = S(k.slabOf(k.insetPlan(cover, 0.6), 1.6 + i * 1.4, 1.4, P, 2), { tone: "hi", crease: "lo", inner: L(k.lineOnTop([cover.x + 3, y + 4], [cover.x + 15, y + 4], 3 + i * 1.4, P) + k.lineOnTop([cover.x + 3, y + 7], [cover.x + 11, y + 7], 3 + i * 1.4, P), { tone: "faint", free: true }) });
      out.push(i === 2 ? `<g data-sheet="${book}" opacity="0">${sheet}</g>` : sheet);
    }
  });
  return out.join("");
}

// Cajón de la caja: se reconstruye al abrirse.
function drawerSvg(K, P, open) {
  const parts = [];
  if (open > 0.3) {
    parts.push(K.solidSvg(K.slabOf({ x: -18, y: -12, w: 36, d: open, r: 0.4 }, 15, 6, P, 2), { tone: "mid" }));
    for (const x of [-12, -4, 4, 12]) parts.push(K.lineSvg(K.lineOnTop([x, -12], [x, -12 + open], 21, P), { tone: "faint" }));
  }
  parts.push(K.solidSvg(K.slabOf({ x: -20, y: -12 + open, w: 40, d: 1.6, r: 0.5 }, 14.6, 7, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  parts.push(K.solidSvg(K.slabOf({ x: -5, y: -10.4 + open, w: 10, d: 1.2, r: 0.4 }, 17, 1.8, P, 2), { tone: "mid" }));
  return parts.join("");
}

function caja() {
  const out = [];
  const stand = { x: -28, y: -52, w: 56, d: 44, r: 2 };
  out.push(S(k.slabOf(stand, 0, 14, P, 4, 0.5), { tone: "mid", inner: L(k.sideSeam(stand, 4, P, 4), { tone: "faint" }) }));
  const body = { x: -22, y: -46, w: 44, d: 34, r: 2.4 };
  out.push(S(k.slabOf(body, 14, 15, P, 4, 0.6), { tone: "hi", crease: "lo" }));
  out.push(k.faceTextSvg(k.sideMatrix([-23, -8], 10.4, P, "left"), "registrar_venta", { size: 5, tone: "hi" }));
  // teclado, rollo de recibos, visor y piloto de rechazo
  const keys = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) keys.push(at([-16 + i * 5, -26 + j * 5, 29]));
  out.push(D(keys, { size: 0.9, tone: "mid" }));
  out.push(L(k.planOutline({ x: -18, y: -29.5, w: 21, d: 17, r: 1 }, 29, P, 3), { tone: "faint" }));
  out.push(S(k.cylinder(-12, -39, 3.4, 29, 5, P, 20), { tone: "mid", inner: L(k.sideArc(-12, -39, 3.4, 31.5, P, 16), { tone: "faint" }) }));
  out.push(S(k.cylinder(14, -38, 1.6, 29, 7, P, 14), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: 5, y: -42, w: 18, d: 6, r: 1 }, 36, 7, P, 3, 0.4), { tone: "mid" }));
  out.push(`<g data-part="alarm">${S(k.cylinder(14, -22, 2.4, 29, 3, P, 18), { tone: "hi", crease: "lo" })}</g>`);
  out.push(`<g data-part="drawer">${drawerSvg(k, P, 0)}</g>`);
  return out.join("");
}

// Estante de stock: tres pilas de potes. La pila A es la del pedido.
const STACKS = [[48, -46], [66, -46], [57, -28]];
function stock() {
  const out = [];
  const shelf = { x: 36, y: -58, w: 42, d: 42, r: 2 };
  out.push(S(k.slabOf(shelf, 0, 4, P, 4, 0.5), { tone: "mid", inner: L(k.sideSeam(shelf, 2, P, 4), { tone: "faint" }) }));
  out.push(S(k.slabOf({ x: 36, y: -60, w: 42, d: 2, r: 0.6 }, 4, 22, P, 2), { tone: "lo" }));
  for (const [x, y, si] of byDepth(STACKS.map(([x, y], i) => [x, y, i]))) {
    for (let level = 0; level < 3; level++) {
      const z = 4 + level * 6.4;
      const tub = S(k.cylinder(x, y, 6, z, 6, P, 28, 0.6), { tone: "mid", inner: L(k.sideArc(x, y, 6, z + 4.6, P, 20), { tone: "faint" }) });
      out.push(si === 0 && level > 0 ? `<g data-tub="${level}">${tub}</g>` : tub);
    }
  }
  return out.join("");
}

function estados() {
  const out = [];
  const board = { x: 90, y: -42, w: 74, d: 26, r: 2 };
  out.push(S(k.slabOf(board, 0, 6, P, 4, 0.5), { tone: "mid", inner: L(k.sideSeam(board, 2.4, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline({ x: 96, y: -26, w: 62, d: 4, r: 2 }, 6, P, 4), { tone: "lo" }));
  out.push(D(k.corners(board, 3).map(([x, y]) => at([x, y, 6])), { size: 0.42 }));
  LAMP_X.forEach((x, i) => out.push(`<g data-lamp="${i}">${S(k.cylinder(x, -34, 3.4, 6, 3, P, 24, 0.4), { tone: "hi", crease: "lo" })}</g>`));
  // marcas bajo cada lámpara, en la regla del tablero
  out.push(L(LAMP_X.map((x) => k.lineOnTop([x, -26], [x, -24], 6, P)).join(""), { tone: "mid" }));
  out.push(`<g data-part="slider" transform="${k.translateAlong(P, [LAMP_X[0], 0, 0])}">${S(k.slabOf({ x: -3, y: -27, w: 6, d: 6, r: 1 }, 6, 3.6, P, 3, 0.4), { tone: "hi", crease: "lo" })}</g>`);
  return out.join("");
}

function buzon() {
  const out = [];
  out.push(S(k.cylinder(205, -30, 4, 0, 2, P, 20), { tone: "lo" }));
  out.push(S(k.cylinder(205, -30, 2, 2, 20, P, 16), { tone: "mid", crease: "none" }));
  const box = { x: 192, y: -40, w: 26, d: 18, r: 5 };
  out.push(S(k.slabOf(box, 22, 13, P, 6, 0.5), { tone: "mid", inner: L(k.sideSeam(box, 25, P, 6), { tone: "faint" }) }));
  out.push(L(k.planOutline({ x: 197, y: -32, w: 16, d: 2, r: 1 }, 35, P, 3), { tone: "lo" }));
  out.push(`<g data-part="letter" opacity="0">${S(k.slabOf({ x: 198, y: -32, w: 14, d: 1.2, r: 0.3 }, 35, 9, P, 2), { tone: "hi", crease: "lo" })}</g>`);
  out.push(S(k.cylinder(219.4, -30, 0.9, 24, 4, P, 10), { tone: "mid" }));
  out.push(`<g data-part="flag">${S(k.slabOf({ x: 218.8, y: -31, w: 1.2, d: 2, r: 0.2 }, 22, 12, P, 2), { tone: "mid" })}${S(k.slabOf({ x: 218.8, y: -31, w: 1.2, d: 8, r: 0.3 }, 30, 4, P, 2), { tone: "hi", crease: "lo" })}</g>`);
  return out.join("");
}

function puck() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -11, y: BELT_Y - 7, w: 22, d: 14, r: 3 }, 9, 0.1, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf({ x: -12, y: BELT_Y - 8, w: 24, d: 16, r: 2.4 }, 9, 3, P, 3, 0.4), { tone: "mid" }));
  out.push(`<g data-part="tag">${S(k.cylinder(-8, BELT_Y - 5, 0.6, 12, 18, P, 8), { tone: "mid", crease: "none" })}${S(k.slabOf({ x: -7.4, y: BELT_Y - 5.6, w: 8, d: 1.2, r: 0.3 }, 24, 6, P, 2), { tone: "hi", crease: "lo" })}</g>`);
  for (const x of [-4, 5]) {
    out.push(S(k.cylinder(x, BELT_Y + 1, 3.8, 12, 8, P, 24), { tone: "hi", lit: true }));
    out.push(S(k.cylinder(x, BELT_Y + 1, 4.6, 20, 4.6, P, 24, 1.2), { tone: "hi", lit: true }));
  }
  return out.join("");
}

const PLATES = [
  [{ x: -246, y: 32, w: 62 }, "1 CARRITO"],
  [{ x: -120, y: 32, w: 56 }, "2 PAGO"],
  [{ x: -28, y: 32, w: 56 }, "3 CAJA"],
  [{ x: 98, y: 32, w: 62 }, "4 ESTADOS"],
  [{ x: 178, y: 32, w: 56 }, "5 CORREO"],
];

const LABEL =
  "El viaje de una compra. Una cinta transportadora lleva un pedido de dos helados por cuatro estaciones: el carrito, el pago (que revisa el carrito, tira a la papelera la etiqueta de precio que mandó el navegador y cuenta los intentos), la caja registradora registrar_venta (que guarda la venta y su detalle y descuenta los potes del estante, todo o nada) y el tablero de estados con un buzón que envía un correo cada vez que cambia el estado.";

function drawing(pose) {
  return [
    basePlate(P, BASE, { extraFeet: [[-12, -100], [-12, 26]] }),
    carrito(),
    pago(),
    ledgers(),
    scanner(),
    bin(),
    caja(),
    stock(),
    estados(),
    buzon(),
    belt(),
    ...PLATES.map(([plan, text]) => namePlate(P, { ...plan, d: 14 }, text, { size: 8.6 })),
    `<g data-part="puck" transform="${k.translateAlong(P, [pose.x, 0, 0])}">${puck()}</g>`,
    beltFront(),
  ].join("");
}

// ---------- SVG estático: el pedido llegó a estados, la venta quedó guardada ----------
let still = drawing({ x: STOP.estados });
still = still
  .replace(/<g data-part="tag">[\s\S]*?<\/g><\/g>/, "")
  .replace(`<g data-part="bin-tag" opacity="0">`, `<g data-part="bin-tag">`)
  .replace(/<g data-sheet="(\d)" opacity="0">/g, `<g data-sheet="$1">`)
  .replace(/<g data-tub="\d">[\s\S]*?<\/g><\/g>/g, "")
  .replace(`<g data-lamp="1"><g class="iso-solid"`, `<g data-lamp="1"><g class="iso-solid" data-lit=""`)
  .replace(/<g data-part="slider" transform="[^"]*">/, `<g data-part="slider" transform="${k.translateAlong(P, [LAMP_X[1], 0, 0])}">`)
  .replace(/<path data-part="needle"([^>]*) d="[^"]*"/, `<path data-part="needle"$1 d="${dialNeedle(1)}"`)
  .replace(`<g data-part="flag">`, `<g data-part="flag" transform="${k.translateAlong(P, [0, 0, 6])}">`)
  .replace(`<g data-part="letter" opacity="0">`, `<g data-part="letter" transform="${k.translateAlong(P, [0, 0, 5])}">`);

const LEGEND = [
  { n: "1", name: "Carrito", what: "CartContext, en la página web" },
  { n: "2", name: "Pago", what: "POST /api/payments/process" },
  { n: "3", name: "Caja registradora", what: "registrar_venta, en la base" },
  { n: "4", name: "Estados de la venta", what: "Pagado → En proceso → Enviado…" },
  { n: "5", name: "Correo al cliente", what: "cuando el estado cambia" },
  { n: "!", name: "Si falta stock", what: "STOCK_INSUFICIENTE: no se guarda nada" },
];
const CAPTION =
  "El pedido sale del carrito. En el pago, la cocina revisa que el carrito tenga sentido, tira a la papelera los precios que mandó el navegador y cuenta los intentos (por defecto, máximo 10 por minuto). La caja registradora registrar_venta busca los precios reales en la base, guarda la venta y su detalle y descuenta los potes del estante, todo junto o nada: si falta un pote responde STOCK_INSUFICIENTE y no queda nada guardado. La venta queda «Pagado» y luego avanza (En proceso → Enviado → Entregado…); en cada cambio sale un correo al cliente.";

write(
  "viaje-compra.svg",
  staticSvg({
    width: WIDTH,
    height: HEIGHT,
    drawing: still,
    label: LABEL,
    fig: "Fig 2",
    title: "El viaje de una compra",
    hint: "Versión interactiva: viaje-compra.html",
    readout: "venta guardada · En proceso · correo enviado",
    legend: LEGEND,
    caption: CAPTION,
  }),
);

// ---------- Página interactiva ----------
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL, body: drawing({ x: STOP.carrito }) });
const spot = (point) => k.iso(point, P).map((v) => Math.round(v * 10) / 10);
const HOT = [
  ["carrito", spot([-216, -33, 26])],
  ["pago", spot([-115, -30, 30])],
  ["caja", spot([10, -30, 28])],
  ["estados", spot([127, -30, 6])],
  ["correo", spot([205, -30, 30])],
];

// Pasos del recorrido. Cada paso dice dónde está el pedido y cómo está cada pieza.
const base = { tag: 1, bin: 0, tries: 0, drawer: 0, tubs: 3, sheet: 0, status: -1, mail: 0, alarm: 0 };
const step = (prev, change, secs, text) => ({ ...prev, ...change, secs, text });
const OK = [];
OK.push(step(base, { x: STOP.carrito }, 2.6, "1 · carrito: el cliente junta 2 helados"));
OK.push(step(OK[0], { x: STOP.pago }, 1.6, "2 · pago: llega el carrito"));
OK.push(step(OK[1], { tag: 0, bin: 1, tries: 1 }, 2.6, "2 · ignora precios del navegador · intento 1 de 10/min"));
OK.push(step(OK[2], { x: STOP.caja }, 1.4, "3 · registrar_venta: todo o nada"));
OK.push(step(OK[3], { drawer: 1, tubs: 1, sheet: 1 }, 2.8, "3 · guarda venta + detalle y descuenta 2 potes"));
OK.push(step(OK[4], { x: STOP.estados, drawer: 0, status: 0 }, 2.2, "4 · venta «Pagado»"));
OK.push(step(OK[5], { status: 1, mail: 1 }, 2, "4 · En proceso · correo al cliente"));
OK.push(step(OK[6], { status: 2, mail: 2 }, 2, "4 · Enviado · correo al cliente"));
OK.push(step(OK[7], { status: 3, mail: 3 }, 2.4, "4 · Entregado · correo al cliente"));
const NO = [];
NO.push(step(base, { x: STOP.carrito, tubs: 1, tries: 1, sheet: 0 }, 2.6, "1 · otro pedido de 2: queda 1 pote"));
NO.push(step(NO[0], { x: STOP.pago }, 1.4, "2 · pago: llega el carrito"));
NO.push(step(NO[1], { tag: 0, bin: 1, tries: 2 }, 2.2, "2 · carrito válido · intento 2 de 10"));
NO.push(step(NO[2], { x: STOP.caja }, 1.4, "3 · registrar_venta: falta stock"));
NO.push(step(NO[3], { alarm: 1 }, 2.8, "3 · STOCK_INSUFICIENTE: no se guarda nada"));
NO.push(step(NO[4], { x: STOP.carrito, alarm: 0 }, 3, "el pedido vuelve; la venta no existe"));

const live = `
const P = ${JSON.stringify(P)};
const STOP = ${JSON.stringify(STOP)};
const LAMP_X = ${JSON.stringify(LAMP_X)};
const HOT = ${JSON.stringify(HOT)};
const RUNS = { ok: ${JSON.stringify(OK)}, no: ${JSON.stringify(NO)} };
const DIAL = ${JSON.stringify(DIAL)}, TRIES_MAX = ${TRIES_MAX};
const K = { slabOf, solidSvg, lineSvg, lineOnTop };
const drawerSvg = ${drawerSvg.toString()};
const dialNeedle = ${dialNeedle.toString().replace("k.lineOnTop", "lineOnTop")};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (s) => svg.querySelector(s);
const puck = $('[data-part="puck"]'), tag = $('[data-part="tag"]'), binTag = $('[data-part="bin-tag"]');
const needle = $('[data-part="needle"]'), drawer = $('[data-part="drawer"]'), slider = $('[data-part="slider"]');
const flag = $('[data-part="flag"]'), letter = $('[data-part="letter"]'), alarm = $('[data-part="alarm"] .iso-solid');
const tubs = [...svg.querySelectorAll("[data-tub]")], sheets = [...svg.querySelectorAll("[data-sheet]")];
const lamps = [...svg.querySelectorAll("[data-lamp] .iso-solid")];
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const ORDER = ["ok", "no"];
let run = "ok", index = 0, clock = 0, touring = !still.matches, visible = false, frame = 0, last = 0, idle = 0;
let S = { ...RUNS.ok[0] };
const v = { x: S.x, tag: 1, bin: 0, tries: 0, drawer: 0, tub1: 1, tub2: 1, sheet: 0, slider: LAMP_X[0], mail: 0, letter: 1, alarm: 0 };
let lastSay = "", lastDrawer = -1;
const ease = (from, to, dt, tau) => (still.matches ? to : Math.abs(to - from) < 0.002 ? to : from + (to - from) * (1 - Math.exp(-dt / tau)));
function goal() { return RUNS[run][index]; }
function draw() {
  puck.setAttribute("transform", translateAlong(P, [v.x, 0, 0]));
  tag.setAttribute("opacity", v.tag.toFixed(3));
  binTag.setAttribute("opacity", v.bin.toFixed(3));
  needle.setAttribute("d", dialNeedle(v.tries));
  if (Math.abs(v.drawer - lastDrawer) > 0.03) { drawer.innerHTML = drawerSvg(K, P, v.drawer * 10); lastDrawer = v.drawer; }
  tubs.forEach((t) => t.setAttribute("opacity", (t.dataset.tub === "1" ? v.tub1 : v.tub2).toFixed(3)));
  sheets.forEach((s) => s.setAttribute("opacity", v.sheet.toFixed(3)));
  slider.setAttribute("transform", translateAlong(P, [v.slider, 0, 0]));
  slider.setAttribute("opacity", S.status < 0 ? "0.35" : "1");
  lamps.forEach((l, i) => l.toggleAttribute("data-lit", i === S.status && Math.abs(v.slider - LAMP_X[i]) < 1));
  const rise = v.letter < 1 ? Math.sin(Math.PI * Math.min(1, v.letter * 1.4)) : 0;
  flag.setAttribute("transform", translateAlong(P, [0, 0, 6 * Math.min(1, rise * 2)]));
  letter.setAttribute("transform", translateAlong(P, [0, 0, 12 * v.letter]));
  letter.setAttribute("opacity", (v.letter < 1 ? Math.sin(Math.PI * v.letter) : 0).toFixed(3));
  alarm.toggleAttribute("data-lit", S.alarm === 1);
  const arrived = Math.abs(v.x - S.x) < 2;
  const where = { [STOP.carrito]: "el carrito", [STOP.pago]: "el pago", [STOP.caja]: "la caja", [STOP.estados]: "los estados" }[S.x];
  const text = arrived ? S.text : "el pedido va hacia " + where;
  if (text !== lastSay) { readout.textContent = text; lastSay = text; }
}
function set(nextRun, nextIndex) {
  const before = S.mail;
  run = nextRun; index = nextIndex; S = { ...goal() };
  if (S.mail > before) v.letter = 0;
  if (S.mail < before) v.letter = 1;
  stage.setAttribute("aria-valuetext", S.text + (run === "no" ? " (sin stock)" : " (con stock)"));
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) {
    clock += dt;
    if (clock > goal().secs && Math.abs(v.x - S.x) < 0.5) {
      clock = 0;
      if (index + 1 < RUNS[run].length) set(run, index + 1); else set(run === "ok" ? "no" : "ok", 0);
    }
  }
  const gap = S.x - v.x, speed = Math.min(Math.abs(gap) / 0.45, 110);
  v.x = still.matches ? S.x : v.x + Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
  const atStop = Math.abs(v.x - S.x) < 0.5;
  v.tag = ease(v.tag, S.tag, dt, 0.25);
  v.bin = ease(v.bin, S.bin, dt, 0.25);
  v.tries = ease(v.tries, S.tries, dt, 0.2);
  v.drawer = ease(v.drawer, atStop || S.drawer === 0 ? S.drawer : v.drawer, dt, 0.22);
  v.tub1 = ease(v.tub1, S.tubs >= 2 ? 1 : 0, dt, 0.3);
  v.tub2 = ease(v.tub2, S.tubs >= 3 ? 1 : 0, dt, 0.3);
  v.sheet = ease(v.sheet, S.sheet, dt, 0.3);
  v.slider = ease(v.slider, LAMP_X[Math.max(0, S.status)], dt, 0.25);
  if (v.letter < 1) v.letter = still.matches ? 1 : Math.min(1, v.letter + dt / 1.3);
  draw();
  const settled = !touring && atStop && v.letter === 1 && [["tag", S.tag], ["bin", S.bin], ["tries", S.tries], ["drawer", S.drawer], ["sheet", S.sheet], ["slider", LAMP_X[Math.max(0, S.status)]]].every(([k, t]) => v[k] === t);
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const go = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
function hold() { touring = false; clearTimeout(idle); idle = setTimeout(() => { touring = !still.matches; clock = 0; go(); }, 3600); go(); }
function toStation(name) {
  const list = RUNS[run];
  const x = name === "correo" ? STOP.estados : STOP[name];
  let pick = -1;
  list.forEach((s, i) => { if (s.x === x && (name !== "correo" || s.mail > 0)) pick = i; });
  if (pick < 0) { run = "ok"; return toStation(name); }
  if (name === "estados") pick = list.findIndex((s) => s.x === x);
  if (pick !== index || RUNS[run] !== list) set(run, pick);
  hold();
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) go(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const px = ((event.clientX - box.left) / box.width) * vb.width, py = ((event.clientY - box.top) / box.height) * vb.height;
  let best = HOT[0], dist = Infinity;
  for (const hot of HOT) { const d = Math.hypot(hot[1][0] - px, hot[1][1] - py); if (d < dist) { dist = d; best = hot; } }
  if (stage.dataset.hot !== best[0]) { stage.dataset.hot = best[0]; toStation(best[0]); }
});
stage.addEventListener("pointerleave", () => { delete stage.dataset.hot; });
stage.addEventListener("click", () => { set(run === "ok" ? "no" : "ok", 0); hold(); });
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") to = Math.min(RUNS[run].length - 1, index + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = Math.max(0, index - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = RUNS[run].length - 1;
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); set(run === "ok" ? "no" : "ok", 0); hold(); return; }
  if (to === null) return;
  event.preventDefault();
  set(run, to);
  hold();
});
set("ok", 0);
draw();
`;

const plate = k.plateHtml({
  fig: "Fig 2",
  title: "El viaje de una compra",
  hint: "Cursor: estaciones · clic: con o sin stock",
  readout: OK[0].text,
  keys: [
    { mark: "lit", label: "El pedido (dos helados)" },
    { mark: "raised", label: "Las estaciones del viaje" },
    { mark: "flat", label: "Etiqueta de precio del navegador: se tira" },
  ],
  caption:
    "1 Carrito (CartContext) · 2 Pago: POST /api/payments/process · 3 Caja registradora: registrar_venta · 4 Estados: Pagado → En proceso → Enviado → Entregado · 5 Correo al cliente en cada cambio. " +
    CAPTION,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="El viaje de una compra: las flechas avanzan o retroceden un paso; Espacio cambia entre compra con stock y sin stock" aria-valuetext="${OK[0].text}">${svg}</div>`,
});

write("viaje-compra.html", livePage({ title: "El viaje de una compra", plate, script: live }));
